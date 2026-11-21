import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
import { createAutomationService } from "@/features/automation/service";
import {
  createPrismaAutomationRepository,
  type AutomationBridge,
} from "@/features/automation/prisma-repository";
import { fixtureContext } from "@/features/automation/fixtures";
import { emptyState } from "@/features/automation/engine";
import type {
  AutomationRequest,
  AutomationState,
} from "@/features/automation/contracts";

const directory = mkdtempSync(join(tmpdir(), "seedee-automation-"));
const url = `file:${join(directory, "test.db")}`;
const db = createDatabase(url);
const context = fixtureContext("owner", "agency");
let failProjection = false;
const bridge: AutomationBridge = {
  async loadContext() {
    return structuredClone(context);
  },
  async hydrateTasks(_tx, state) {
    return state;
  },
  async syncTasks(tx, _userId, _previous, next) {
    for (const task of next.tasks)
      await tx.$executeRaw`INSERT INTO "TestCoreTask" ("id", "status") VALUES (${task.id}, ${task.status}) ON CONFLICT ("id") DO UPDATE SET "status" = ${task.status}`;
    if (failProjection) throw new Error("Injected projection failure");
  },
};
const clock = () => new Date("2026-11-21T12:00:00Z");
const repository = createPrismaAutomationRepository(db, bridge);
const service = createAutomationService(repository, clock);
const request: AutomationRequest = {
  agencyId: "agency",
  expectedVersion: 0,
  idempotencyKey: "workflow-request",
  command: {
    type: "instantiate_workflow",
    projectId: "sample-project",
    templateKey: "creative_delivery",
    dueAt: null,
  },
};
beforeAll(async () => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  await db.user.create({
    data: {
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      passwordHash: "not-a-login",
    },
  });
  await db.user.create({
    data: {
      id: "second",
      name: "Second",
      email: "second@example.test",
      passwordHash: "not-a-login",
    },
  });
  await db.agency.create({
    data: { id: "agency", ownerId: "owner", name: "Fixture" },
  });
  // The agreed schema is provisioned only in this isolated contract test until
  // Kuba's shared migration lands. This never modifies the development database.
  await db.$executeRaw`CREATE TABLE "TestCoreTask" ("id" TEXT NOT NULL PRIMARY KEY, "status" TEXT NOT NULL)`;
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
describe("transactional automation repository", () => {
  it("rolls back aggregate, task projection and idempotency receipt on partial failure", async () => {
    failProjection = true;
    expect(await service.command("owner", request)).toMatchObject({
      ok: false,
      code: "provider_failed",
    });
    expect(await db.$queryRaw`SELECT * FROM "AutomationState"`).toEqual([]);
    expect(await db.$queryRaw`SELECT * FROM "TestCoreTask"`).toEqual([]);
    failProjection = false;
    expect(await service.command("owner", request)).toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(await db.$queryRaw`SELECT * FROM "TestCoreTask"`).toHaveLength(6);
  });
  it("survives a client restart and replays a committed request without duplicate writes", async () => {
    const restarted = createDatabase(url);
    try {
      const recovered = createAutomationService(
        createPrismaAutomationRepository(restarted, bridge),
        clock,
      );
      expect(
        (await recovered.readWorkspace("owner", "agency")).state.tasks,
      ).toHaveLength(6);
      expect(await recovered.command("owner", request)).toMatchObject({
        ok: true,
        replayed: true,
      });
      expect(
        await restarted.$queryRaw`SELECT * FROM "TestCoreTask"`,
      ).toHaveLength(6);
    } finally {
      await restarted.$disconnect();
    }
  });
  it("rejects cross-owner references before loading aggregate data", async () => {
    await expect(
      service.readWorkspace("second", "agency"),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    expect(await service.command("second", request)).toMatchObject({
      ok: false,
      code: "forbidden_or_missing",
    });
  });
  it("rejects a stale CAS even when a caller bypasses the service version guard", async () => {
    const before = await service.readWorkspace("owner", "agency");
    await expect(
      repository.transaction(async (tx) => {
        await tx.loadOwned("owner", "agency");
        const state = structuredClone(before.state);
        state.version += 1;
        await tx.saveOwned("owner", 0, state);
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await service.readWorkspace("owner", "agency")).state).toEqual(
      before.state,
    );
  });
  it("fails closed on corrupt or mismatched persisted state", async () => {
    const before = await service.readWorkspace("owner", "agency");
    await db.$executeRaw`UPDATE "AutomationState" SET "stateJson" = '{}' , "version" = 4 WHERE "agencyId" = 'agency'`;
    expect(
      await service.command("owner", { ...request, idempotencyKey: "corrupt" }),
    ).toMatchObject({ ok: false, code: "conflict" });
    const wrong: AutomationState = emptyState("other-agency");
    wrong.version = 1;
    await db.$executeRaw`UPDATE "AutomationState" SET "stateJson" = ${JSON.stringify(wrong)}, "version" = 1 WHERE "agencyId" = 'agency'`;
    expect(await service.command("owner", request)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    await db.$executeRaw`UPDATE "AutomationState" SET "stateJson" = ${JSON.stringify(before.state)}, "version" = ${before.state.version} WHERE "agencyId" = 'agency'`;
  });
  it("commits nothing for a no-op run_due_routines after a schema-parsed load", async () => {
    const routines = async (key: string) =>
      service.command("owner", {
        agencyId: "agency",
        expectedVersion: (await service.readWorkspace("owner", "agency")).state
          .version,
        idempotencyKey: key,
        command: { type: "run_due_routines" },
      });
    expect(await routines("routines-first")).toMatchObject({ ok: true });
    const stored = async () =>
      db.$queryRaw<
        { version: number; stateJson: string }[]
      >`SELECT "version", "stateJson" FROM "AutomationState" WHERE "agencyId" = 'agency'`;
    const before = await stored();
    expect(await routines("routines-noop")).toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(await stored()).toEqual(before);
  });
});
