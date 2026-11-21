import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { NextRequest } from "next/server";
import { createDatabase } from "@/lib/db-client";
const state = vi.hoisted(() => ({
  db: null as unknown as PrismaClient,
  user: null as { id: string; name: string; email: string } | null,
  origin: "http://localhost:3000",
  host: "localhost:3000",
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => state.user,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host, origin: state.origin }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { readWorkspace, workspaceCommand } from "@/features/workspace/actions";
import { GET } from "@/app/app/exports/[id]/route";
const directory = mkdtempSync(join(tmpdir(), "seedee-actions-")),
  url = `file:${join(directory, "test.db")}`;
beforeAll(async () => {
  state.db = createDatabase(url);
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  await state.db.user.create({
    data: {
      id: "boundary-owner",
      name: "Owner",
      email: "owner@example.test",
      passwordHash: "unused",
    },
  });
  await state.db.agency.create({
    data: {
      id: "boundary-agency",
      ownerId: "boundary-owner",
      name: "Private agency",
    },
  });
  await state.db.exportSnapshot.create({
    data: {
      id: "saved-export",
      agencyId: "boundary-agency",
      idempotencyKey: "one",
      manifest: {},
      markdown: "# Saved private snapshot",
      csv: "yearMonth,revenue\r\n2026-10,unknown",
    },
  });
});
afterAll(async () => {
  await state.db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
const request = (format = "markdown") =>
  new NextRequest(
    `http://localhost:3000/app/exports/saved-export?format=${format}`,
  );
const params = { params: Promise.resolve({ id: "saved-export" }) };
describe("authenticated server actions and private downloads", () => {
  it("returns safe unauthenticated results for direct action invocation and no-store 401 for GET", async () => {
    state.user = null;
    expect(await readWorkspace()).toMatchObject({
      ok: false,
      error: { code: "unauthenticated" },
    });
    expect(
      await workspaceCommand({
        type: "client.create",
        input: { name: "Forged" },
      }),
    ).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
    const response = await GET(request(), params);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("Saved private snapshot");
  });
  it("rejects cross-origin mutations before any side effect", async () => {
    state.user = {
      id: "boundary-owner",
      name: "Owner",
      email: "owner@example.test",
    };
    state.origin = "https://attacker.example";
    expect(
      await workspaceCommand({
        type: "client.create",
        input: { name: "Injected", economicGroupId: "group" },
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden_or_missing" } });
    expect(await state.db.client.count()).toBe(0);
    state.origin = "http://localhost:3000";
  });
  it("derives owner from the session, ignores no owner override, and serializes saved UTC dates", async () => {
    expect(
      await workspaceCommand({
        type: "client.create",
        input: {
          name: "Owned",
          economicGroupId: "group",
          ownerId: "another-owner",
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const response = await workspaceCommand({
      type: "client.create",
      input: { name: "Owned", economicGroupId: "group" },
    });
    expect(response.ok).toBe(true);
    const read = await readWorkspace();
    if (!read.ok) throw Error("failed");
    expect(read.data.clients).toHaveLength(1);
    expect(typeof read.data.clients[0].createdAt).toBe("string");
    expect(read.data.clients[0].agencyId).toBe("boundary-agency");
  });
  it("streams only saved snapshots as private attachments without GET mutations", async () => {
    const before = await state.db.exportSnapshot.count();
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("# Saved private snapshot");
    expect(await state.db.exportSnapshot.count()).toBe(before);
    const csv = await GET(request("csv"), params);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("2026-10,unknown");
  });
  it("reauthorizes downloads per request and rejects unknown formats", async () => {
    const bad = await GET(request("html"), params);
    expect(bad.status).toBe(400);
    await state.db.user.create({
      data: {
        id: "second-boundary-owner",
        name: "Other",
        email: "other-boundary@example.test",
        passwordHash: "unused",
      },
    });
    await state.db.agency.create({
      data: { ownerId: "second-boundary-owner", name: "Other" },
    });
    state.user = {
      id: "second-boundary-owner",
      name: "Other",
      email: "other-boundary@example.test",
    };
    const denied = await GET(request(), params);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toContain("no-store");
    expect(await denied.text()).not.toContain("Saved private snapshot");
  });
});
