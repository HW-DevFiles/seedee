import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
import { createIntegratedServices } from "@/features/integration/services";
import { createWorkspaceService } from "@/features/workspace/service";
import { agencyFixture } from "@/features/agency-engine/fixtures";
import { z } from "zod";
const dir = mkdtempSync(join(tmpdir(), "seedee-integrated-")),
  url = `file:${join(dir, "test.db")}`,
  db = createDatabase(url);
let now = new Date("2026-11-21T12:00:00Z");
const clock = () => now,
  core = createWorkspaceService(db, "owner", clock),
  services = createIntegratedServices(db, clock);
const record = (v: unknown) =>
  z.object({ id: z.string(), version: z.number() }).parse(v);
let agencyId: string, projectId: string;
beforeAll(async () => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  for (const id of ["owner", "other"])
    await db.user.create({
      data: {
        id,
        name: id,
        email: `${id}@example.test`,
        passwordHash: "unused",
      },
    });
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
it("persists draft acceptance and executes the real workflow engine bridge through revision and approval", async () => {
  const draft = await services.engine.generateAgency("owner", {
    idempotencyKey: "draft-one",
    input: agencyFixture,
  });
  expect((await core.readWorkspace()).agency).toBeNull();
  const accepted = await core.command({
    type: "agency.accept",
    input: {
      draftId: draft.id,
      expectedVersion: draft.version,
      idempotencyKey: "accept-one",
    },
  });
  agencyId = record(accepted).id;
  const p = record(
    await core.command({
      type: "project.create",
      input: {
        title: "Photographer delivery",
        brief: "A thoughtful internal photo plan",
      },
    }),
  );
  projectId = p.id;
  const flow = await services.automation.command("owner", {
    agencyId,
    expectedVersion: 0,
    idempotencyKey: "flow-one",
    command: {
      type: "instantiate_workflow",
      projectId,
      templateKey: "creative_delivery",
      dueAt: null,
    },
  });
  expect(flow.ok).toBe(true);
  if (!flow.ok) throw new Error(flow.message);
  const task = flow.workspace.state.tasks[0];
  const run = await services.engine.queueRun("owner", {
    agencyId,
    taskId: task.id,
    projectId,
    expectedTaskVersion: task.version,
    idempotencyKey: "run-one",
    input: {
      roleKey: "creative_lead",
      title: task.title,
      brief: "Prepare the internal shoot brief.",
      objective: "Owner review",
      practices: ["photographer"],
    },
  });
  let generated = await services.engine.advanceRun("owner", {
    agencyId,
    runId: run.id,
  });
  expect(generated.status).toBe("awaiting_review");
  const revision = await services.engine.requestRevision("owner", {
    agencyId,
    runId: run.id,
    expectedVersion: generated.version,
    idempotencyKey: "revision-one",
    note: "Include lighting constraints.",
  });
  generated = await services.engine.advanceRun("owner", {
    agencyId,
    runId: revision.id,
  });
  await services.engine.approveRun("owner", {
    agencyId,
    runId: generated.id,
    expectedVersion: generated.version,
    idempotencyKey: "approve-one",
  });
  const loaded = await services.automation.readWorkspace("owner", agencyId);
  expect(loaded.state.tasks[0].status).toBe("done");
  expect(loaded.state.tasks[1].status).toBe("queued");
  expect(
    (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status,
  ).toBe("done");
  await expect(
    services.engine.readWorkspace("other", agencyId),
  ).rejects.toMatchObject({ code: "forbidden_or_missing" });
});
it("runs standalone core tasks through the separate current-artifact approval guard", async () => {
  const task = record(
    await core.command({
      type: "task.create",
      input: {
        title: "Standalone review",
        input: "Prepare an internal checklist",
        projectId,
        assignedRoleKey: "creative_lead",
      },
    }),
  );
  const run = await services.engine.queueRun("owner", {
    agencyId,
    taskId: task.id,
    projectId,
    expectedTaskVersion: task.version,
    idempotencyKey: "standalone-run",
    input: {
      roleKey: "creative_lead",
      title: "Standalone review",
      brief: "Prepare a checklist",
      objective: "Owner review",
      practices: ["designer"],
    },
  });
  const generated = await services.engine.advanceRun("owner", {
    agencyId,
    runId: run.id,
  });
  await services.engine.approveRun("owner", {
    agencyId,
    runId: run.id,
    expectedVersion: generated.version,
    idempotencyKey: "standalone-approve",
  });
  expect(
    (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status,
  ).toBe("done");
});
it("notifies again for a rescheduled core deadline and canonicalizes timestamp representations", async () => {
  let task = record(
    await core.command({
      type: "task.create",
      input: {
        title: "Current deadline",
        input: "Check deadline identity",
        dueAt: "2026-11-20T00:00:00Z",
      },
    }),
  );
  const refresh = async (key: string) => {
    const view = await services.automation.readWorkspace("owner", agencyId);
    const result = await services.automation.command("owner", {
      agencyId,
      expectedVersion: view.state.version,
      idempotencyKey: key,
      command: { type: "refresh_growth" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    return result.workspace.state.notifications.filter(
      (n) => n.target.id === task.id && n.kind === "overdue_task",
    );
  };
  expect(await refresh("miss-a")).toHaveLength(1);
  task = record(
    await core.command({
      type: "task.update",
      input: {
        id: task.id,
        expectedVersion: task.version,
        data: {
          title: "Current deadline",
          input: "Check deadline identity",
          dueAt: "2026-11-23T00:00:00Z",
        },
      },
    }),
  );
  expect(await refresh("before-b")).toHaveLength(1);
  now = new Date("2026-11-24T00:00:00Z");
  expect(await refresh("miss-b")).toHaveLength(2);
  expect(await refresh("repeat-b")).toHaveLength(2);
  await core.command({
    type: "task.update",
    input: {
      id: task.id,
      expectedVersion: task.version,
      data: {
        title: "Current deadline",
        input: "Check deadline identity",
        dueAt: "2026-11-23T00:00:00.000Z",
      },
    },
  });
  expect(await refresh("same-instant")).toHaveLength(2);
});

it("finishes the six-step workflow without a project/closeout circular gate", async () => {
  const auto = async (command: unknown) => {
    const view = await services.automation.readWorkspace("owner", agencyId);
    const result = await services.automation.command("owner", {
      agencyId,
      expectedVersion: view.state.version,
      idempotencyKey: crypto.randomUUID(),
      command,
    });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
  };
  for (const status of ["active", "review"]) {
    const p = (await core.readWorkspace()).projects.find(
      (p) => p.id === projectId,
    )!;
    await core.command({
      type: "project.transition",
      input: { id: p.id, expectedVersion: p.version, status },
    });
  }
  {
    const p = (await core.readWorkspace()).projects.find(
      (p) => p.id === projectId,
    )!;
    await expect(
      core.command({
        type: "project.transition",
        input: { id: p.id, expectedVersion: p.version, status: "completed" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  }
  for (const title of ["Plan", "Draft"]) {
    const t = (
      await services.automation.readWorkspace("owner", agencyId)
    ).state.tasks.find((t) => t.title === title)!;
    const r = await services.engine.queueRun("owner", {
      agencyId,
      taskId: t.id,
      projectId,
      expectedTaskVersion: t.version,
      idempotencyKey: crypto.randomUUID(),
      input: {
        roleKey: t.roleKey,
        title: t.title,
        brief: t.input,
        objective: "Owner review",
        practices: ["photographer"],
      },
    });
    const generated = await services.engine.advanceRun("owner", {
      agencyId,
      runId: r.id,
    });
    await services.engine.approveRun("owner", {
      agencyId,
      runId: r.id,
      expectedVersion: generated.version,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  const transition = async (title: string) => {
    for (const to of ["in_progress", "awaiting_review", "done"]) {
      const view = await services.automation.readWorkspace("owner", agencyId),
        task = view.state.tasks.find((t) => t.title === title)!;
      const artifact =
        task.artifactId ??
        task.dependencies
          .map((id) => view.state.tasks.find((t) => t.id === id)?.artifactId)
          .find(Boolean);
      await auto({
        type: "transition_task",
        taskId: task.id,
        expectedTaskVersion: task.version,
        to,
        reason: "Owner-reviewed workflow gate",
        ...((task.kind === "work" || task.kind === "human_review") && artifact
          ? { artifactId: artifact }
          : {}),
      });
    }
  };
  await transition("Human review");
  await auto({
    type: "record_delivery",
    projectId,
    deliveryDate: clock().toISOString(),
    note: "Internal delivery only",
  });
  await transition("Delivery recorded");
  const pretend = record(
    await core.command({
      type: "task.create",
      input: {
        title: "Closeout",
        input: "A standalone task is not the administrative gate",
        projectId,
      },
    }),
  );
  {
    const p = (await core.readWorkspace()).projects.find(
      (p) => p.id === projectId,
    )!;
    await expect(
      core.command({
        type: "project.transition",
        input: { id: p.id, expectedVersion: p.version, status: "completed" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  }
  await core.command({
    type: "task.transition",
    input: {
      id: pretend.id,
      expectedVersion: pretend.version,
      status: "cancelled",
      note: "Explicitly cancel this test task",
    },
  });
  for (const status of ["completed"]) {
    const p = (await core.readWorkspace()).projects.find(
      (p) => p.id === projectId,
    )!;
    await core.command({
      type: "project.transition",
      input: { id: p.id, expectedVersion: p.version, status },
    });
  }
  const beforeCloseout = await services.automation.readWorkspace(
    "owner",
    agencyId,
  );
  const finalTask = beforeCloseout.state.tasks.find(
    (t) => t.kind === "closeout",
  )!;
  await auto({
    type: "transition_task",
    taskId: finalTask.id,
    expectedTaskVersion: finalTask.version,
    to: "in_progress",
    reason: "Prepare closeout",
  });
  await auto({
    type: "transition_task",
    taskId: finalTask.id,
    expectedTaskVersion: finalTask.version + 1,
    to: "awaiting_review",
    reason: "Review closeout",
  });
  const pendingView = await services.automation.readWorkspace(
    "owner",
    agencyId,
  );
  expect(
    await services.automation.command("owner", {
      agencyId,
      expectedVersion: pendingView.state.version,
      idempotencyKey: "missing-closeout",
      command: {
        type: "transition_task",
        taskId: finalTask.id,
        expectedTaskVersion: finalTask.version + 2,
        to: "done",
        reason: "Cannot finish without facts",
      },
    }),
  ).toMatchObject({ ok: false, code: "conflict" });
  await core.command({
    type: "closeout.save",
    input: {
      projectId,
      expectedVersion: null,
      data: {
        deliveryDate: clock().toISOString(),
        recognizedRevenueMinor: 120000,
        receiptsMinor: 60000,
        deliveryCostMinor: 30000,
        founderLaborHours: null,
        founderCostTreatment: "included_in_overhead",
        repeatabilityNotes: "Reviewed process",
        recurrenceType: "one_off",
        provenance: {
          origin: "user_entered",
          asOf: clock().toISOString(),
          sourceReference: "Owner closeout",
          reviewStatus: "owner_attested",
        },
      },
    },
  });
  await auto({
    type: "transition_task",
    taskId: finalTask.id,
    expectedTaskVersion: finalTask.version + 2,
    to: "done",
    reason: "Explicit closeout saved",
  });
  await auto({ type: "refresh_growth" });
  const view = await services.automation.readWorkspace("owner", agencyId);
  expect(
    view.state.tasks
      .filter((t) => t.workflowId)
      .every((t) => t.status === "done"),
  ).toBe(true);
  expect(view.metrics).toMatchObject({
    completedProjects: 1,
    recognizedRevenueMinor: 120000,
    collectionsMinor: 60000,
  });
});
