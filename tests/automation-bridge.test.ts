import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
import { createAutomationService } from "@/features/automation/service";
import {
  createPrismaAutomationRepository,
  createPrismaAutomationTransaction,
} from "@/features/automation/prisma-repository";
import { createCoreAutomationBridge } from "@/features/automation/core-bridge";
import {
  recordRunEvent,
  type RunEvent,
} from "@/features/automation/run-bridge";
import {
  fixtureContext,
  createFixtureRepository,
} from "@/features/automation/fixtures";
import { createAutomationBoundary } from "@/features/automation/boundary";
import {
  type AutomationCommand,
  type AutomationResult,
} from "@/features/automation/contracts";

const directory = mkdtempSync(join(tmpdir(), "seedee-core-automation-"));
const url = `file:${join(directory, "test.db")}`;
const db = createDatabase(url);
const context = fixtureContext("owner", "agency");
const now = new Date("2026-11-21T12:00:00Z");
const clock = () => now;
const bridge = createCoreAutomationBridge(
  async () => ({
    artifacts: structuredClone(context.artifacts),
    recordedDeliveryProjectIds: [],
    growth: structuredClone(context.growth),
  }),
  clock,
);
const service = createAutomationService(
  createPrismaAutomationRepository(db, bridge),
  clock,
);
let key = 0;
async function command(command: AutomationCommand): Promise<AutomationResult> {
  const current = await service.readWorkspace("owner", "agency");
  return service.command("owner", {
    agencyId: "agency",
    expectedVersion: current.state.version,
    idempotencyKey: `command-${++key}`,
    command,
  });
}
function success(result: AutomationResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.workspace;
}
const runEvent = (event: RunEvent) =>
  db.$transaction((tx) =>
    recordRunEvent(createPrismaAutomationTransaction(tx, bridge), event, now),
  );
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
  await db.agency.create({
    data: { id: "agency", ownerId: "owner", name: "Fixture" },
  });
  // Executable SQL contract for the core fields handed off by Kuba; replaced
  // by the shared migration in the assembled-branch verification.
  await db.$executeRaw`CREATE TABLE "AutomationState" ("agencyId" TEXT NOT NULL PRIMARY KEY REFERENCES "Agency"("id") ON DELETE CASCADE,"version" INTEGER NOT NULL DEFAULT 0,"stateJson" TEXT NOT NULL DEFAULT '{}',"updatedAt" DATETIME NOT NULL)`;
  await db.$executeRaw`CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY,"agencyId" TEXT NOT NULL,"status" TEXT NOT NULL,"archivedAt" DATETIME)`;
  await db.$executeRaw`CREATE TABLE "ProjectCloseout" ("projectId" TEXT NOT NULL PRIMARY KEY,"agencyId" TEXT NOT NULL)`;
  await db.$executeRaw`CREATE TABLE "Task" ("id" TEXT NOT NULL PRIMARY KEY,"agencyId" TEXT NOT NULL,"projectId" TEXT,"title" TEXT NOT NULL,"input" TEXT NOT NULL,"assignedRoleKey" TEXT,"status" TEXT NOT NULL,"priority" TEXT NOT NULL,"dueAt" DATETIME,"originalCommittedDueAt" DATETIME,"dueDateHistory" JSONB NOT NULL,"acceptedAt" DATETIME,"cancellationRecord" JSONB,"approvedArtifact" JSONB,"reviewNeeded" BOOLEAN NOT NULL,"version" INTEGER NOT NULL,"createdAt" DATETIME NOT NULL,"updatedAt" DATETIME NOT NULL)`;
  await db.$executeRaw`CREATE TABLE "TaskDependency" ("taskId" TEXT NOT NULL REFERENCES "Task"("id"),"predecessorId" TEXT NOT NULL REFERENCES "Task"("id"),PRIMARY KEY("taskId","predecessorId"))`;
  await db.$executeRaw`INSERT INTO "Project" ("id","agencyId","status") VALUES ('sample-project','agency','active'),('archived-project','agency','archived')`;
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
describe("core automation and engine bridge", () => {
  it("projects six tasks and dependencies atomically and refuses new work for archived projects", async () => {
    expect(
      await command({
        type: "instantiate_workflow",
        projectId: "archived-project",
        templateKey: "creative_delivery",
        dueAt: null,
      }),
    ).toMatchObject({ ok: false, code: "forbidden_or_missing" });
    const view = success(
      await command({
        type: "instantiate_workflow",
        projectId: "sample-project",
        templateKey: "creative_delivery",
        dueAt: "2026-12-01T12:00:00Z",
      }),
    );
    expect(await db.$queryRaw`SELECT * FROM "Task"`).toHaveLength(6);
    expect(await db.$queryRaw`SELECT * FROM "TaskDependency"`).toHaveLength(5);
    expect((await service.readWorkspace("owner", "agency")).state).toEqual(
      view.state,
    );
  });
  it("records running/review/approval callbacks in the engine's existing transaction, with safe event replays", async () => {
    const task = (await service.readWorkspace("owner", "agency")).state
      .tasks[0];
    const event: RunEvent = {
      userId: "owner",
      agencyId: "agency",
      taskId: task.id,
      expectedTaskVersion: task.version,
      eventKey: "running",
      runId: "run-one",
      status: "running",
    };
    const queued = await runEvent({
      ...event,
      eventKey: "queued",
      status: "queued",
    });
    expect(queued.tasks[0]).toMatchObject({
      status: "queued",
      runId: "run-one",
    });
    event.expectedTaskVersion = queued.tasks[0].version;
    const running = await runEvent(event);
    expect(running.tasks[0]).toMatchObject({
      status: "in_progress",
      runId: "run-one",
    });
    const replay = await runEvent(event);
    expect(replay.version).toBe(running.version);
    context.artifacts.push({
      id: "artifact",
      taskId: task.id,
      runId: "run-one",
      status: "draft",
      reviewedByUserId: null,
      reviewedAt: null,
      current: true,
    });
    const review = await runEvent({
      ...event,
      eventKey: "review",
      expectedTaskVersion: running.tasks[0].version,
      status: "awaiting_review",
      artifactId: "artifact",
    });
    await expect(
      runEvent({
        ...event,
        eventKey: "approval",
        expectedTaskVersion: review.tasks[0].version,
        status: "approved",
        artifactId: "artifact",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    context.artifacts[0].status = "approved";
    context.artifacts[0].reviewedByUserId = "owner";
    context.artifacts[0].reviewedAt = now.toISOString();
    const approved = await runEvent({
      ...event,
      eventKey: "approval",
      expectedTaskVersion: review.tasks[0].version,
      status: "approved",
      artifactId: "artifact",
    });
    expect(approved.tasks[0].status).toBe("done");
    expect(approved.tasks[1].status).toBe("queued");
    const core = await db.$queryRaw<
      { status: string; approvedArtifact: string }[]
    >`SELECT "status","approvedArtifact" FROM "Task" WHERE "id"=${task.id}`;
    expect(core[0].status).toBe("done");
    expect(
      typeof core[0].approvedArtifact === "string"
        ? JSON.parse(core[0].approvedArtifact)
        : core[0].approvedArtifact,
    ).toMatchObject({
      artifactId: "artifact",
      reviewedByUserId: "owner",
    });
    await expect(
      db.$transaction(async (tx) => {
        await recordRunEvent(
          createPrismaAutomationTransaction(tx, bridge),
          {
            ...event,
            taskId: approved.tasks[1].id,
            expectedTaskVersion: approved.tasks[1].version,
            eventKey: "rolled-back",
            status: "running",
            runId: "run-two",
          },
          now,
        );
        throw new Error("Engine save failed");
      }),
    ).rejects.toThrow("Engine save failed");
    expect(
      (await service.readWorkspace("owner", "agency")).state.tasks[1].status,
    ).toBe("queued");
  });
  it("projects failure, retry and linked revision events without reusing an old artifact", async () => {
    const before = await service.readWorkspace("owner", "agency");
    const task = before.state.tasks[1];
    const event: RunEvent = {
      userId: "owner",
      agencyId: "agency",
      taskId: task.id,
      expectedTaskVersion: task.version,
      eventKey: "second-running",
      runId: "run-two",
      status: "running",
    };
    let state = await runEvent(event);
    state = await runEvent({
      ...event,
      eventKey: "second-failed",
      expectedTaskVersion: state.tasks[1].version,
      status: "failed",
    });
    expect(
      state.notifications.some(
        (n) => n.kind === "failed_run" && n.target.id === task.id,
      ),
    ).toBe(true);
    state = await runEvent({
      ...event,
      eventKey: "second-retry",
      runId: "run-three",
      expectedTaskVersion: state.tasks[1].version,
      status: "retry",
    });
    expect(state.tasks[1]).toMatchObject({
      status: "queued",
      attempt: 2,
      artifactId: null,
      runId: null,
    });
    state = await runEvent({
      ...event,
      eventKey: "third-running",
      runId: "run-three",
      expectedTaskVersion: state.tasks[1].version,
      status: "running",
    });
    context.artifacts.push({
      id: "second-artifact",
      taskId: task.id,
      runId: "run-three",
      status: "draft",
      reviewedByUserId: null,
      reviewedAt: null,
      current: true,
    });
    state = await runEvent({
      ...event,
      eventKey: "third-review",
      runId: "run-three",
      expectedTaskVersion: state.tasks[1].version,
      status: "awaiting_review",
      artifactId: "second-artifact",
    });
    context.artifacts[1].status = "revision_requested";
    context.artifacts[1].current = false;
    state = await runEvent({
      ...event,
      eventKey: "fourth-revision",
      runId: "run-four",
      expectedTaskVersion: state.tasks[1].version,
      status: "revision_requested",
    });
    expect(state.tasks[1]).toMatchObject({
      status: "in_progress",
      attempt: 3,
      artifactId: null,
      runId: null,
    });
    state = await runEvent({
      ...event,
      eventKey: "fourth-running",
      runId: "run-four",
      expectedTaskVersion: state.tasks[1].version,
      status: "running",
    });
    expect(state.tasks[1]).toMatchObject({
      status: "in_progress",
      runId: "run-four",
    });
  });
  it("records delivery internally without generating revenue and preserves the stable project reference", async () => {
    expect(
      await command({
        type: "record_delivery",
        projectId: "sample-project",
        deliveryDate: "2027-01-01T00:00:00Z",
        note: "Future delivery",
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    let view = success(
      await command({
        type: "record_delivery",
        projectId: "sample-project",
        deliveryDate: now.toISOString(),
        note: "Owner recorded an internal delivery.",
      }),
    );
    view = success(
      await command({
        type: "record_delivery",
        projectId: "sample-project",
        deliveryDate: now.toISOString(),
        note: "Corrected delivery note.",
      }),
    );
    expect(view.state.deliveries).toHaveLength(1);
    expect(view.metrics.recognizedRevenueMinor).toBeNull();
  });
  it("fails closed on a core task edited outside its automation transaction", async () => {
    const before = await service.readWorkspace("owner", "agency");
    const id = before.state.tasks[1].id;
    await db.$executeRaw`UPDATE "Task" SET "version"="version"+1 WHERE "id"=${id}`;
    await expect(
      service.readWorkspace("owner", "agency"),
    ).rejects.toMatchObject({ code: "conflict" });
    await db.$executeRaw`UPDATE "Task" SET "version"="version"-1 WHERE "id"=${id}`;
    expect((await service.readWorkspace("owner", "agency")).state).toEqual(
      before.state,
    );
  });
  it("adopts an edited core title/input on load and commits it only on a mutation", async () => {
    const before = await service.readWorkspace("owner", "agency");
    const id = before.state.tasks[2].id;
    await db.$executeRaw`UPDATE "Task" SET "title"='Edited draft',"version"="version"+1 WHERE "id"=${id}`;
    const stored =
      await db.$queryRaw`SELECT "stateJson","version" FROM "AutomationState"`;
    const view = await service.readWorkspace("owner", "agency");
    expect(view.state.tasks[2]).toMatchObject({
      title: "Edited draft",
      version: before.state.tasks[2].version + 1,
    });
    expect(
      view.state.notifications.filter((n) => n.kind === "task_reconciled"),
    ).toHaveLength(1);
    expect(
      await db.$queryRaw`SELECT "stateJson","version" FROM "AutomationState"`,
    ).toEqual(stored);
    success(await command({ type: "refresh_growth" }));
    const committed = await db.$queryRaw<
      { stateJson: string }[]
    >`SELECT "stateJson" FROM "AutomationState"`;
    expect(JSON.parse(committed[0].stateJson).tasks[2].title).toBe(
      "Edited draft",
    );
    const task = (await service.readWorkspace("owner", "agency")).state
      .tasks[2];
    expect(
      success(
        await command({
          type: "reschedule_task",
          taskId: task.id,
          expectedTaskVersion: task.version,
          dueAt: "2026-12-05T12:00:00Z",
          reason: "Owner moved the draft.",
        }),
      ).state.tasks[2].version,
    ).toBe(task.version + 1);
  });
  it("prunes automation entries for a deleted project instead of failing to load", async () => {
    await db.$executeRaw`DELETE FROM "TaskDependency"`;
    await db.$executeRaw`DELETE FROM "Task" WHERE "projectId"='sample-project'`;
    await db.$executeRaw`DELETE FROM "Project" WHERE "id"='sample-project'`;
    const view = await service.readWorkspace("owner", "agency");
    expect(view.state.tasks).toHaveLength(0);
    expect(view.state.workflows).toHaveLength(0);
    const next = success(await command({ type: "refresh_growth" }));
    expect(next.state.tasks).toHaveLength(0);
    expect((await service.readWorkspace("owner", "agency")).state).toEqual(
      next.state,
    );
  });
});
describe("session-derived automation boundary", () => {
  it("requires the mutation boundary even on retries and never accepts a browser owner id", async () => {
    const fixture = createFixtureRepository();
    const service = createAutomationService(fixture.repository, clock);
    const calls: boolean[] = [];
    const boundary = createAutomationBoundary(service, async (mutation) => {
      calls.push(mutation);
      return { userId: fixture.context.ownerId };
    });
    await boundary.readWorkspace(fixture.context.agencyId);
    const request = {
      userId: "attacker",
      agencyId: fixture.context.agencyId,
      expectedVersion: 0,
      idempotencyKey: "refresh",
      command: { type: "refresh_growth" },
    };
    expect(await boundary.command(request)).toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(await boundary.command(request)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(calls).toEqual([false, true, true]);
  });
});
