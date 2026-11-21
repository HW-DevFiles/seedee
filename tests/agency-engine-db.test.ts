import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
import { DemoProvider } from "@/lib/ai/demo-provider";
import { AgencyEngine } from "@/features/agency-engine/service";
import {
  createPrismaEngineRepository,
  type EngineBridge,
} from "@/features/agency-engine/repository";
import {
  createWorkspaceEngineBridge,
  loadEngineArtifactFacts,
} from "@/features/agency-engine/workspace-bridge";
import { EngineError, stateSchema } from "@/features/agency-engine/contracts";
import {
  agencyFixture,
  taskFixture,
  pitchFixture,
} from "@/features/agency-engine/fixtures";

const directory = mkdtempSync(join(tmpdir(), "seedee-engine-")),
  url = `file:${join(directory, "engine.db")}`;
let db = createDatabase(url);
let rollback = false;
const bridge: EngineBridge = createWorkspaceEngineBridge(
  async (tx, scope, event) => {
    // Deliberately small test projection of Remy's callback contract. Not the production automation bridge.
    if (event.artifactId && event.status === "approved") {
      const facts = await loadEngineArtifactFacts(tx, scope);
      const artifact = facts.find((row) => row.id === event.artifactId);
      if (
        !artifact?.current ||
        artifact.status !== "approved" ||
        artifact.reviewedByUserId !== scope.userId
      )
        throw new EngineError(
          "conflict",
          "Approval was not persisted before the event.",
        );
    }
    const status = {
      queued: "queued",
      running: "in_progress",
      awaiting_review: "awaiting_review",
      approved: "done",
      failed: "failed",
      cancelled: "cancelled",
      retry: "queued",
      revision_requested: "in_progress",
    }[event.status];
    const count =
      await tx.$executeRaw`UPDATE "Task" SET "status"=${status},"version"="version"+1 WHERE "id"=${event.taskId} AND "agencyId"=${scope.agencyId} AND "version"=${event.expectedTaskVersion}`;
    if (count !== 1)
      throw new EngineError("conflict", "Task changed during callback.");
    await tx.$executeRaw`INSERT INTO "TestRunEvents" ("key","status") VALUES (${event.eventKey},${event.status})`;
    if (rollback)
      throw new EngineError("conflict", "Injected projection failure.");
    return { taskVersion: event.expectedTaskVersion + 1 };
  },
);
const clock = () => new Date("2026-11-21T00:00:00Z");
const engine = () =>
  new AgencyEngine(
    createPrismaEngineRepository(db, bridge),
    new DemoProvider(),
    clock,
  );

beforeAll(async () => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  // Core tables come from the combined production migrations.
  await db.$executeRaw`CREATE TABLE "TestRunEvents" ("key" TEXT PRIMARY KEY,"status" TEXT NOT NULL)`;
  await db.user.createMany({
    data: [
      {
        id: "owner",
        name: "Test owner",
        email: "owner@example.test",
        passwordHash: "not-a-login-fixture",
      },
      {
        id: "other",
        name: "Other owner",
        email: "other@example.test",
        passwordHash: "not-a-login-fixture",
      },
    ],
  });
  await db.agency.createMany({
    data: [
      { id: "agency", ownerId: "owner", name: "Test studio" },
      { id: "other-agency", ownerId: "other", name: "Other studio" },
    ],
  });
  await db.project.createMany({
    data: [
      { id: "project", agencyId: "agency", title: "Project", status: "active" },
      {
        id: "other-project",
        agencyId: "other-agency",
        title: "Other project",
        status: "active",
      },
    ],
  });
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
async function task(id: string) {
  await db.task.create({
    data: {
      id,
      agencyId: "agency",
      projectId: "project",
      title: id,
      version: 0,
    },
  });
  return {
    agencyId: "agency",
    taskId: id,
    projectId: "project",
    expectedTaskVersion: 0,
    idempotencyKey: `queue-${id}`,
    input: taskFixture,
  };
}
const args = (run: { id: string; version: number }, key: string) => ({
  agencyId: "agency",
  runId: run.id,
  expectedVersion: run.version,
  idempotencyKey: key,
});

describe("SQLite engine persistence and same-transaction task projection", () => {
  it("saves drafts without an agency and preserves them after reconnect", async () => {
    await db.user.create({
      data: {
        id: "fresh",
        email: "fresh@example.test",
        name: "Fresh creative",
        passwordHash: "not-a-login-fixture",
      },
    });
    const draft = await engine().generateAgency("fresh", {
      idempotencyKey: "fresh",
      input: agencyFixture,
    });
    expect(draft.status).toBe("generated");
    expect(
      await db.agency.findUnique({ where: { ownerId: "fresh" } }),
    ).toBeNull();
    await db.$disconnect();
    db = createDatabase(url);
    expect(
      (await engine().readWorkspace("fresh")).drafts[0].content?.name,
    ).toBe("Moss Studio");
  });
  it("projects queue, running, review and approval; persists artifact before callback", async () => {
    const queued = await engine().queueRun("owner", await task("happy"));
    expect(queued.taskVersion).toBe(1);
    const review = await engine().advanceRun("owner", {
      agencyId: "agency",
      runId: queued.id,
    });
    expect(review).toMatchObject({ status: "awaiting_review", taskVersion: 3 });
    const approved = await engine().approveRun(
      "owner",
      args(review, "approve-happy"),
    );
    expect(approved).toMatchObject({ status: "completed", taskVersion: 4 });
    const rows = await db.$queryRaw<
      { status: string; version: number }[]
    >`SELECT "status","version" FROM "Task" WHERE "id"='happy'`;
    expect(rows[0]).toEqual({ status: "done", version: 4 });
    const count = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) AS count FROM "TestRunEvents"`;
    expect(Number(count[0].count)).toBe(4);
    expect(
      (await engine().approveRun("owner", args(review, "approve-happy")))
        .taskVersion,
    ).toBe(4);
  });
  it("rolls engine approval, core task and event insert back together", async () => {
    const queued = await engine().queueRun("owner", await task("rollback"));
    const review = await engine().advanceRun("owner", {
      agencyId: "agency",
      runId: queued.id,
    });
    rollback = true;
    try {
      await expect(
        engine().approveRun("owner", args(review, "rollback-approval")),
      ).rejects.toMatchObject({ code: "conflict" });
    } finally {
      rollback = false;
    }
    const state = await engine().readWorkspace("owner", "agency");
    expect(state.runs.find((run) => run.id === queued.id)?.status).toBe(
      "awaiting_review",
    );
    expect(state.artifacts.find((row) => row.runId === queued.id)?.status).toBe(
      "draft",
    );
    const rows = await db.$queryRaw<
      { status: string; version: number }[]
    >`SELECT "status","version" FROM "Task" WHERE "id"='rollback'`;
    expect(rows[0]).toEqual({ status: "awaiting_review", version: 3 });
    expect(
      (await engine().approveRun("owner", args(review, "rollback-approval")))
        .status,
    ).toBe("completed");
  });
  it("recovers queued work after DB reconnect with one artifact", async () => {
    const queued = await engine().queueRun("owner", await task("restart"));
    await createPrismaEngineRepository(db, bridge).transact(
      { userId: "owner", agencyId: "agency" },
      (tx) => {
        const run = tx.state.runs.find((row) => row.id === queued.id)!;
        run.status = "running";
        run.version++;
        Object.assign(run.steps[0], {
          status: "completed",
          completedAt: clock().toISOString(),
        });
      },
    );
    await db.$disconnect();
    db = createDatabase(url);
    const review = await engine().advanceRun("owner", {
      agencyId: "agency",
      runId: queued.id,
    });
    expect(review.status).toBe("awaiting_review");
    await db.$disconnect();
    db = createDatabase(url);
    await engine().advanceRun("owner", {
      agencyId: "agency",
      runId: queued.id,
    });
    expect(
      (await engine().readWorkspace("owner", "agency")).artifacts.filter(
        (row) => row.runId === queued.id,
      ),
    ).toHaveLength(1);
  });
  it("projects revisions without an old-run cancellation cancelling the new task", async () => {
    const queued = await engine().queueRun("owner", await task("revision"));
    const review = await engine().advanceRun("owner", {
      agencyId: "agency",
      runId: queued.id,
    });
    const next = await engine().requestRevision("owner", {
      ...args(review, "revision-db"),
      note: "Revise scope",
    });
    expect(next.taskVersion).toBe(4);
    const latest = await engine().advanceRun("owner", {
      agencyId: "agency",
      runId: next.id,
    });
    expect(latest.status).toBe("awaiting_review");
    const facts = await db.$transaction((tx) =>
      loadEngineArtifactFacts(tx, { userId: "owner", agencyId: "agency" }),
    );
    expect(facts.find((row) => row.runId === queued.id)?.current).toBe(false);
    expect(facts.find((row) => row.runId === next.id)?.current).toBe(true);
  });
  it("enforces same-owner task/project/dependency scope and archive state", async () => {
    const command = await task("scope");
    await expect(engine().queueRun("other", command)).rejects.toMatchObject({
      code: "forbidden_or_missing",
    });
    await expect(
      engine().queueRun("owner", { ...command, projectId: "other-project" }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    await db.task.create({
      data: {
        id: "foreign",
        agencyId: "other-agency",
        projectId: "other-project",
        title: "Foreign task",
        version: 0,
        status: "done",
      },
    });
    await db.$executeRaw`INSERT INTO "TaskDependency" ("taskId","predecessorId") VALUES ('scope','foreign')`;
    await expect(engine().queueRun("owner", command)).rejects.toMatchObject({
      code: "forbidden_or_missing",
    });
    await db.$executeRaw`DELETE FROM "TaskDependency" WHERE "taskId"='scope'`;
    await db.$executeRaw`UPDATE "Project" SET "archivedAt"=${clock()} WHERE "id"='project'`;
    await expect(engine().queueRun("owner", command)).rejects.toMatchObject({
      code: "conflict",
    });
    await db.$executeRaw`UPDATE "Project" SET "archivedAt"=NULL WHERE "id"='project'`;
    await expect(
      engine().readWorkspace("missing", "agency"),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("validates saved evidence versions and provenance, rejecting forged numeric values", async () => {
    const fact = {
      id: "fact",
      section: "traction" as const,
      label: "Earned revenue",
      displayValue: "USD 120",
      origin: "user_entered" as const,
      sourceRef: "ledger-october",
      sourceVersion: 1,
      asOf: "2026-10-31",
      formulaVersion: "agency-finance-v1.1",
      reviewStatus: "owner_attested" as const,
    };
    await db.evidenceItem.create({
      data: {
        id: "fact",
        agencyId: "agency",
        category: "financials",
        metricKey: "revenue",
        value: { pitchFact: fact },
        provenance: {
          origin: fact.origin,
          asOf: `${fact.asOf}T00:00:00Z`,
          sourceReference: fact.sourceRef,
          reviewStatus: fact.reviewStatus,
        },
      },
    });
    const command = {
      agencyId: "agency",
      idempotencyKey: "pitch-fact",
      input: { ...pitchFixture, facts: [fact] },
    };
    expect((await engine().draftPitch("owner", command)).status).toBe(
      "generated",
    );
    await expect(
      engine().draftPitch("owner", {
        ...command,
        idempotencyKey: "forged",
        input: {
          ...command.input,
          facts: [{ ...fact, displayValue: "USD 999999" }],
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      engine().draftPitch("owner", {
        ...command,
        idempotencyKey: "old",
        input: { ...command.input, facts: [{ ...fact, sourceVersion: 2 }] },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      engine().draftPitch("other", {
        ...command,
        agencyId: "other-agency",
        idempotencyKey: "foreign-fact",
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
  });
  it("refuses CAS loss without overwriting the preserved state", async () => {
    const repo = createPrismaEngineRepository(db, {
        ...bridge,
        facts: async (tx) => {
          await tx.$executeRaw`UPDATE "AgencyEngineState" SET "version"="version"+1 WHERE "id"='owner'`;
        },
      }),
      before = await repo.read({ userId: "owner", agencyId: "agency" });
    await expect(
      repo.transact({ userId: "owner", agencyId: "agency" }, async (tx) => {
        tx.state.drafts = [];
        await tx.facts([]);
      }),
    ).rejects.toBeDefined();
    const after = await repo.read({ userId: "owner", agencyId: "agency" });
    expect(stateSchema.parse(after)).toEqual(before);
  });
});
