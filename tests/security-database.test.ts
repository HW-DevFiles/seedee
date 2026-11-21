import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
import {
  assertAgencyReference,
  assertOwnerReference,
  requireAgencyOwner,
} from "@/lib/security/ownership";
import {
  consumeOperationLimit,
  OPERATION_LIMITS,
  OPERATION_WINDOW_MS,
} from "@/lib/security/rate-limit";
import { downloadPrivateSnapshot } from "@/lib/security/exports";
import {
  createSession,
  findSessionUser,
  revokeSession,
  clearAuthAttempts,
  consumeAuthAttempt,
} from "@/lib/auth/service";

const directory = mkdtempSync(join(tmpdir(), "seedee-security-"));
const url = `file:${join(directory, "test.db")}`;
const db = createDatabase(url);
const now = new Date("2026-11-21T00:00:00Z");
const owner = "security-owner";
const other = "security-other";
const agencyId = "security-agency";
const otherAgencyId = "security-other-agency";

beforeAll(async () => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    },
  );
  for (const id of [owner, other]) {
    await db.user.create({
      data: {
        id,
        name: id,
        email: `${id}@example.test`,
        passwordHash: "unused-test-fixture",
      },
    });
  }
  await db.agency.create({
    data: { id: agencyId, ownerId: owner, name: "Owner agency" },
  });
  await db.agency.create({
    data: { id: otherAgencyId, ownerId: other, name: "Other agency" },
  });
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe("database ownership and transactional reference guard", () => {
  it("allows only the session owner and makes missing/foreign agencies indistinguishable", async () => {
    await expect(requireAgencyOwner(db, owner, agencyId)).resolves.toEqual({
      id: agencyId,
      ownerId: owner,
    });
    for (const id of [agencyId, "missing-agency", "bad/id"])
      await expect(requireAgencyOwner(db, other, id)).rejects.toMatchObject({
        code: "forbidden_or_missing",
        message: "This item is unavailable.",
      });
    await expect(requireAgencyOwner(db, null, agencyId)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    const session = await createSession(db, owner, now);
    await revokeSession(db, session.token);
    const user = await findSessionUser(db, session.token, now);
    await expect(
      requireAgencyOwner(db, user?.id, agencyId),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("rolls back a write if a nested reference belongs to another owner", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await requireAgencyOwner(tx, owner, agencyId);
        await tx.agency.update({
          where: { id: agencyId },
          data: { name: "must roll back" },
        });
        // Child records use the same agencyId contract; adapter supplies DB-loaded data.
        const reference = await tx.agency.findUniqueOrThrow({
          where: { id: otherAgencyId },
        });
        assertAgencyReference({ agencyId: reference.id }, agencyId);
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    expect(
      (await db.agency.findUniqueOrThrow({ where: { id: agencyId } })).name,
    ).toBe("Owner agency");
  });
  it("protects pre-agency drafts using session owner identity", () => {
    const draft = { id: "draft", userId: owner };
    expect(assertOwnerReference(draft, owner)).toBe(draft);
    expect(() => assertOwnerReference(draft, other)).toThrow(
      "This item is unavailable.",
    );
    expect(() => assertOwnerReference(null, other)).toThrow(
      "This item is unavailable.",
    );
    expect(() => assertOwnerReference(draft, null)).toThrow("Sign in");
  });

  // These are contract-fixture rows, not claims that unmerged endpoints exist.
  it.each([
    "client",
    "project",
    "task",
    "run",
    "artifact",
    "evidence",
    "notification",
    "export",
  ])(
    "rejects second-user reads/writes and forged nested %s references in the shared contract",
    async (kind) => {
      const records = new Map([
        ["owned", { id: "owned", agencyId, kind, value: "private" }],
        [
          "foreign",
          { id: "foreign", agencyId: otherAgencyId, kind, value: "other" },
        ],
      ]);
      const read = async (userId: string, scope: string, id: string) => {
        await requireAgencyOwner(db, userId, scope);
        return assertAgencyReference(records.get(id), scope);
      };
      const write = async (
        userId: string,
        scope: string,
        id: string,
        nested: string,
      ) => {
        const record = await read(userId, scope, id);
        await read(userId, scope, nested);
        record.value = "changed";
      };
      await expect(read(owner, agencyId, "owned")).resolves.toMatchObject({
        value: "private",
      });
      await expect(read(other, otherAgencyId, "owned")).rejects.toMatchObject({
        code: "forbidden_or_missing",
      });
      await expect(
        write(other, agencyId, "owned", "owned"),
      ).rejects.toMatchObject({ code: "forbidden_or_missing" });
      await expect(
        write(owner, agencyId, "owned", "foreign"),
      ).rejects.toMatchObject({ code: "forbidden_or_missing" });
      expect(records.get("owned")?.value).toBe("private");
    },
  );
});

describe("persistent operation quotas", () => {
  it.each(["generation", "export"] as const)(
    "enforces %s account limit, separate operations and exact window reset",
    async (operation) => {
      const context = {
        userId: `limit-${operation}`,
        clientIp: null,
        operation,
      };
      for (let i = 0; i < OPERATION_LIMITS[operation].account; i++)
        await consumeOperationLimit(db, context, now);
      await expect(
        consumeOperationLimit(db, context, now),
      ).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 900 });
      await expect(
        consumeOperationLimit(
          db,
          {
            ...context,
            operation: operation === "generation" ? "export" : "generation",
          },
          now,
        ),
      ).resolves.toBeUndefined();
      const restarted = createDatabase(url);
      try {
        await expect(
          consumeOperationLimit(restarted, context, now),
        ).rejects.toMatchObject({ code: "rate_limited" });
        await expect(
          consumeOperationLimit(
            restarted,
            context,
            new Date(now.getTime() + OPERATION_WINDOW_MS),
          ),
        ).resolves.toBeUndefined();
      } finally {
        await restarted.$disconnect();
      }
    },
  );
  it.each(["generation", "export"] as const)(
    "limits %s across different accounts sharing a trusted IP",
    async (operation) => {
      const clientIp = operation === "generation" ? "192.0.2.90" : "192.0.2.91";
      for (let i = 0; i < OPERATION_LIMITS[operation].ip; i++)
        await consumeOperationLimit(
          db,
          { userId: `ip-${operation}-${i}`, clientIp, operation },
          now,
        );
      await expect(
        consumeOperationLimit(
          db,
          { userId: `fresh-${operation}`, clientIp, operation },
          now,
        ),
      ).rejects.toMatchObject({ code: "rate_limited" });
      await expect(
        consumeOperationLimit(
          db,
          { userId: `fresh-${operation}`, clientIp: null, operation },
          now,
        ),
      ).resolves.toBeUndefined();
    },
  );
  it("admits no more than the quota under concurrent requests and hashes identifying keys", async () => {
    const context = {
      userId: "concurrent-private-owner",
      clientIp: "192.0.2.33",
      operation: "export" as const,
    };
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => consumeOperationLimit(db, context, now)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(10);
    for (const result of results.filter((item) => item.status === "rejected"))
      expect(result.reason).toMatchObject({ code: "rate_limited" });
    const rows = await db.authThrottle.findMany({
      where: { key: { startsWith: "security:v1:" } },
    });
    expect(JSON.stringify(rows)).not.toContain(context.userId);
    expect(JSON.stringify(rows)).not.toContain(context.clientIp);
  });
  it("cannot reset operation quotas by signing in successfully", async () => {
    const context = {
      userId: "login-cannot-reset",
      clientIp: "192.0.2.34",
      operation: "export" as const,
    };
    for (let i = 0; i < 10; i++) await consumeOperationLimit(db, context, now);
    await consumeAuthAttempt(db, "login@example.test", context.clientIp, now);
    await clearAuthAttempts(db, "login@example.test", context.clientIp);
    await expect(consumeOperationLimit(db, context, now)).rejects.toMatchObject(
      { code: "rate_limited" },
    );
  });
});

describe("authenticated private snapshot download", () => {
  const snapshot = {
    id: "snapshot-1",
    agencyId,
    markdown: "Private owner content",
    csv: '"private"\r\n',
  };
  it("rechecks signed-in ownership, keeps failed responses private, and never calls loaders anonymously", async () => {
    const load = vi.fn(async () => snapshot);
    const anonymous = await downloadPrivateSnapshot(
      db,
      { userId: "", clientIp: null },
      snapshot.id,
      "markdown",
      load,
      now,
    );
    expect(anonymous.status).toBe(401);
    expect(load).not.toHaveBeenCalled();
    for (const id of [snapshot.id, "missing-snapshot"]) {
      const response = await downloadPrivateSnapshot(
        db,
        { userId: other, clientIp: null },
        id,
        "markdown",
        async (key) => (key === snapshot.id ? snapshot : null),
        now,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(snapshot.markdown);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
    const response = await downloadPrivateSnapshot(
      db,
      { userId: owner, clientIp: null },
      snapshot.id,
      "markdown",
      load,
      now,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(snapshot.markdown);
    expect(snapshot).toEqual({
      id: "snapshot-1",
      agencyId,
      markdown: "Private owner content",
      csv: '"private"\r\n',
    });
  });
  it("returns visible 429 and Retry-After after authorized downloads exhaust quota", async () => {
    const time = new Date("2026-11-22T00:00:00Z");
    for (let i = 0; i < 10; i++) {
      const response = await downloadPrivateSnapshot(
        db,
        { userId: owner, clientIp: null },
        snapshot.id,
        "csv",
        async () => snapshot,
        time,
      );
      expect(response.status).toBe(200);
    }
    const response = await downloadPrivateSnapshot(
      db,
      { userId: owner, clientIp: null },
      snapshot.id,
      "csv",
      async () => snapshot,
      time,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
    expect(await response.text()).not.toContain(snapshot.csv);
  });
});
