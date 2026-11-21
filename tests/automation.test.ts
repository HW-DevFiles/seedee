import { describe, expect, it } from "vitest";
import { createAutomationService } from "@/features/automation/service";
import {
  createFixtureRepository,
  fixtureContext,
} from "@/features/automation/fixtures";
import { nextSlot } from "@/features/automation/clock";
import {
  type AutomationCommand,
  type AutomationResult,
  type Task,
} from "@/features/automation/contracts";

const now = new Date("2026-11-21T12:00:00Z");
function setup() {
  const fixture = createFixtureRepository();
  const service = createAutomationService(fixture.repository, () => now);
  let key = 0;
  async function command(
    command: AutomationCommand,
    idempotencyKey = `request-${++key}`,
    expectedVersion = fixture.snapshot()?.version ?? 0,
  ) {
    return service.command(fixture.context.ownerId, {
      agencyId: fixture.context.agencyId,
      expectedVersion,
      idempotencyKey,
      command,
    });
  }
  return { ...fixture, service, command };
}
function success(result: AutomationResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.workspace;
}
async function instantiate(s: ReturnType<typeof setup>, key?: string) {
  return success(
    await s.command(
      {
        type: "instantiate_workflow",
        projectId: "sample-project",
        templateKey: "creative_delivery",
        dueAt: "2026-11-20T12:00:00Z",
      },
      key,
    ),
  );
}
async function transition(
  s: ReturnType<typeof setup>,
  task: Task,
  to: Task["status"],
  artifactId?: string,
) {
  return s.command({
    type: "transition_task",
    taskId: task.id,
    expectedTaskVersion: task.version,
    to,
    reason: "Owner requested transition.",
    ...(artifactId ? { artifactId } : {}),
  });
}
describe("delivery automation", () => {
  it("snapshots the six-step workflow and rejects predecessor bypass and foreign project references", async () => {
    const s = setup();
    const { state } = await instantiate(s);
    expect(state.tasks.map((t) => t.title)).toEqual([
      "Brief",
      "Plan",
      "Draft",
      "Human review",
      "Delivery recorded",
      "Closeout",
    ]);
    expect(state.tasks.map((t) => t.status)).toEqual([
      "queued",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
    ]);
    expect(await transition(s, state.tasks[1], "in_progress")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(
      await s.command({
        type: "instantiate_workflow",
        projectId: "other-project",
        templateKey: "creative_delivery",
        dueAt: null,
      }),
    ).toMatchObject({ ok: false, code: "forbidden_or_missing" });
    expect(s.snapshot()!.workflows).toHaveLength(1);
  });
  it("deduplicates concurrent retries, rejects reused keys, and exposes current state on stale versions", async () => {
    const s = setup();
    const command: AutomationCommand = {
      type: "instantiate_workflow",
      projectId: "sample-project",
      templateKey: "creative_delivery",
      dueAt: null,
    };
    const results = await Promise.all([
      s.command(command, "same", 0),
      s.command(command, "same", 0),
    ]);
    expect(results.map((r) => r.ok && r.replayed)).toEqual([false, true]);
    expect(s.snapshot()!.tasks).toHaveLength(6);
    expect(
      await s.command({ ...command, dueAt: now.toISOString() }, "same", 1),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(await s.command(command, "fresh", 0)).toMatchObject({
      ok: false,
      code: "conflict",
      current: { state: { version: 1 } },
    });
  });
  it("requires saved owner approval, unlocks once, and persists retry/revision links", async () => {
    const s = setup();
    let { state } = await instantiate(s);
    let task = state.tasks[0];
    state = success(await transition(s, task, "in_progress")).state;
    task = state.tasks[0];
    expect(await transition(s, task, "done")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    s.context.artifacts.push({
      id: "draft",
      taskId: task.id,
      runId: "run",
      status: "draft",
      current: true,
      reviewedByUserId: null,
      reviewedAt: null,
    });
    state = success(
      await transition(s, task, "awaiting_review", "draft"),
    ).state;
    task = state.tasks[0];
    expect(await transition(s, task, "done")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    s.context.artifacts[0].status = "approved";
    s.context.artifacts[0].reviewedAt = now.toISOString();
    s.context.artifacts[0].reviewedByUserId = "someone-else";
    expect(await transition(s, task, "done")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    s.context.artifacts[0].reviewedByUserId = s.context.ownerId;
    state = success(await transition(s, task, "done")).state;
    expect(state.tasks[1]).toMatchObject({ status: "queued", version: 1 });
    expect(state.tasks[1].history).toHaveLength(1);
    expect(await transition(s, state.tasks[0], "done")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    state = success(await transition(s, state.tasks[1], "in_progress")).state;
    state = success(await transition(s, state.tasks[1], "failed")).state;
    expect(
      state.notifications.filter((n) => n.kind === "failed_run"),
    ).toHaveLength(1);
    state = success(await transition(s, state.tasks[1], "queued")).state;
    expect(state.tasks[1]).toMatchObject({
      attempt: 2,
      artifactId: null,
      runId: null,
    });
    expect(state.tasks[1].history.at(-1)).toMatchObject({
      from: "failed",
      to: "queued",
    });
  });
  it("never treats approved drafts as recorded delivery or closeout", async () => {
    const s = setup();
    let { state } = await instantiate(s);
    for (let i = 0; i < 4; i++) {
      state = success(await transition(s, state.tasks[i], "in_progress")).state;
      const source = i === 3 ? state.tasks[2] : state.tasks[i];
      const artifactId = `artifact-${i}`;
      s.context.artifacts.push({
        id: artifactId,
        taskId: source.id,
        runId: `run-${i}`,
        status: "approved",
        current: true,
        reviewedByUserId: s.context.ownerId,
        reviewedAt: now.toISOString(),
      });
      state = success(
        await transition(s, state.tasks[i], "awaiting_review", artifactId),
      ).state;
      state = success(await transition(s, state.tasks[i], "done")).state;
    }
    state = success(await transition(s, state.tasks[4], "in_progress")).state;
    state = success(
      await transition(s, state.tasks[4], "awaiting_review"),
    ).state;
    expect(await transition(s, state.tasks[4], "done")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    s.context.recordedDeliveryProjectIds.push("sample-project");
    state = success(await transition(s, state.tasks[4], "done")).state;
    state = success(await transition(s, state.tasks[5], "in_progress")).state;
    state = success(
      await transition(s, state.tasks[5], "awaiting_review"),
    ).state;
    expect(await transition(s, state.tasks[5], "done")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    s.context.closeoutProjectIds.push("sample-project");
    const view = success(await transition(s, state.tasks[5], "done"));
    expect(view.state.tasks.every((t) => t.status === "done")).toBe(true);
    expect(view.metrics.recognizedRevenueMinor).toBeNull();
  });
  it("preserves the original commitment and due-date revision reason", async () => {
    const s = setup();
    const { state } = await instantiate(s);
    const task = state.tasks[0];
    const next = success(
      await s.command({
        type: "reschedule_task",
        taskId: task.id,
        expectedTaskVersion: task.version,
        dueAt: "2027-01-01T00:00:00Z",
        reason: "Owner revised the schedule.",
      }),
    );
    expect(next.state.tasks[0].originalCommittedDueAt).toBe(task.dueAt);
    expect(next.state.tasks[0].dueDateRevisions[0]).toMatchObject({
      previous: task.dueAt,
      reason: "Owner revised the schedule.",
    });
  });
  it("authorizes reads, mutations and notifications independently and rejects invalid input", async () => {
    const s = setup();
    await instantiate(s);
    await expect(
      s.service.readWorkspace("other-owner", s.context.agencyId),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    expect(await s.service.command("", {})).toMatchObject({
      ok: false,
      code: "unauthenticated",
    });
    expect(
      await s.service.command("other-owner", {
        agencyId: s.context.agencyId,
        expectedVersion: 1,
        idempotencyKey: "bad",
        command: { type: "refresh_growth" },
      }),
    ).toMatchObject({ ok: false, code: "forbidden_or_missing" });
    expect(
      await s.command({
        type: "mark_notifications_read",
        notificationIds: ["foreign"],
      }),
    ).toMatchObject({ ok: false, code: "forbidden_or_missing" });
    expect(
      await s.service.command(s.context.ownerId, {
        agencyId: s.context.agencyId,
        expectedVersion: 1,
        idempotencyKey: "bad",
        command: { type: "transition_task", to: "done" },
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      success(
        await s.command({ type: "mark_notifications_read" }),
      ).state.notifications.every((n) => n.readAt),
    ).toBe(true);
    const saved = s.snapshot();
    await s.service.readWorkspace(s.context.ownerId, s.context.agencyId);
    expect(s.snapshot()).toEqual(saved);
  });
});
describe("routines and deterministic local calendar", () => {
  it("pauses, coalesces missed slots once and advances to the next future slot", async () => {
    const s = setup();
    success(
      await s.command({
        type: "configure_routine",
        routineId: "weekly",
        templateKey: "weekly_planning",
        timezone: "America/New_York",
        nextDueAt: "2026-11-01T14:00:00Z",
        enabled: false,
      }),
    );
    expect(
      success(await s.command({ type: "run_due_routines" })).state.tasks,
    ).toHaveLength(0);
    success(
      await s.command({
        type: "configure_routine",
        routineId: "weekly",
        templateKey: "weekly_planning",
        timezone: "America/New_York",
        nextDueAt: now.toISOString(),
        enabled: true,
      }),
    );
    const request = { type: "run_due_routines" } as const;
    const results = await Promise.all([
      s.command(request, "due", 3),
      s.command(request, "due", 3),
    ]);
    const state = success(results[0]).state;
    expect(state.tasks).toHaveLength(1);
    expect(state.occurrences[0].skippedCount).toBe(2);
    expect(state.routines[0].nextDueAt).toBe("2026-11-22T14:00:00.000Z");
    expect(success(await s.command(request)).state.tasks).toHaveLength(1);
  });
  it("retains wall time through DST, resolves missing/repeated hours and clamps month ends", () => {
    expect(
      nextSlot("2026-03-01T14:00:00Z", "America/New_York", "weekly", 1),
    ).toBe("2026-03-08T13:00:00.000Z");
    expect(
      nextSlot("2026-03-01T07:30:00Z", "America/New_York", "weekly", 1),
    ).toBe("2026-03-08T07:30:00.000Z");
    expect(
      nextSlot("2026-10-25T05:30:00Z", "America/New_York", "weekly", 1),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      nextSlot("2026-01-31T14:00:00Z", "America/New_York", "monthly", 1),
    ).toBe("2026-02-28T14:00:00.000Z");
    expect(
      nextSlot("2026-01-31T14:00:00Z", "America/New_York", "monthly", 2),
    ).toBe("2026-03-31T13:00:00.000Z");
  });
  it("rejects an invalid timezone without persisting a routine", async () => {
    const s = setup();
    expect(
      await s.command({
        type: "configure_routine",
        routineId: "bad",
        templateKey: "monthly_evidence",
        timezone: "Mars/Sea",
        nextDueAt: now.toISOString(),
        enabled: true,
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(s.snapshot()).toBeNull();
  });
});
describe("growth and recommendations", () => {
  it("keeps empty/partial facts unknown and corrects by stable closeout reference", async () => {
    const s = setup();
    let view = success(await s.command({ type: "refresh_growth" }));
    expect(view.metrics).toMatchObject({
      recognizedRevenueMinor: null,
      collectionsMinor: null,
      deliveryMargin: null,
      completedProjects: 0,
      humanCapacity: null,
    });
    s.context.growth.projects = [
      {
        id: "sample-project",
        completedAt: now.toISOString(),
        economicClientGroupId: "group",
      },
      {
        id: "project-two",
        completedAt: now.toISOString(),
        economicClientGroupId: "group",
      },
    ];
    s.context.growth.closeouts = [
      {
        id: "closeout-one",
        projectId: "sample-project",
        recognizedRevenueMinor: 10000,
        receiptsMinor: 7000,
        deliveryCostMinor: 2000,
      },
    ];
    view = success(await s.command({ type: "refresh_growth" }));
    expect(view.metrics.recognizedRevenueMinor).toBeNull();
    expect(view.metrics.repeatClients).toBe(1);
    s.context.growth.closeouts.push({
      id: "closeout-two",
      projectId: "project-two",
      recognizedRevenueMinor: 0,
      receiptsMinor: 0,
      deliveryCostMinor: 0,
    });
    view = success(await s.command({ type: "refresh_growth" }));
    expect(view.metrics).toMatchObject({
      recognizedRevenueMinor: 10000,
      collectionsMinor: 7000,
      deliveryMargin: { numeratorMinor: 8000, denominatorMinor: 10000 },
    });
    s.context.growth.closeouts[0].recognizedRevenueMinor = 9000;
    view = success(await s.command({ type: "refresh_growth" }));
    expect(view.metrics.recognizedRevenueMinor).toBe(9000);
    expect(view.metrics.closeoutCount).toBe(2);
    expect(
      view.state.notifications.filter((n) => n.kind === "milestone_completed"),
    ).toHaveLength(2);
    expect(view.metrics.origin).toBe("sample");
  });
  it("converts recommendations to one task across different request keys, and labels manual attestations", async () => {
    const s = setup();
    let view = success(await s.command({ type: "refresh_growth" }));
    const key = view.state.recommendations[0].key;
    view = success(
      await s.command({ type: "recommendation_task", recommendationKey: key }),
    );
    const id = view.state.recommendations[0].linkedTaskId;
    view = success(
      await s.command({ type: "recommendation_task", recommendationKey: key }),
    );
    expect(view.state.tasks).toHaveLength(1);
    expect(view.state.recommendations[0].linkedTaskId).toBe(id);
    view = success(
      await s.command({
        type: "dismiss_recommendation",
        recommendationKey: key,
      }),
    );
    expect(view.state.recommendations[0].dismissedAt).toBe(now.toISOString());
    s.context.growth.offers = [{ id: "offer", active: false }];
    view = success(
      await s.command({
        type: "attest_milestone",
        milestoneKey: "first_offer",
        statement: "Owner attests this scoped draft offer is ready for review.",
        evidenceIds: ["offer"],
      }),
    );
    expect(view.state.milestones[0]).toMatchObject({
      completion: "manual_attestation",
      evidenceIds: ["offer"],
    });
    expect(view.metrics.recognizedRevenueMinor).toBeNull();
  });
  it("rejects duplicate closeout totals and unsafe cents instead of inflating growth", async () => {
    const s = setup();
    const ctx = fixtureContext();
    s.context.growth.projects = [
      {
        id: "sample-project",
        completedAt: now.toISOString(),
        economicClientGroupId: null,
      },
    ];
    s.context.growth.closeouts = [
      {
        id: "one",
        projectId: "sample-project",
        recognizedRevenueMinor: 1,
        receiptsMinor: 1,
        deliveryCostMinor: 0,
      },
      {
        id: "two",
        projectId: "sample-project",
        recognizedRevenueMinor: 1,
        receiptsMinor: 1,
        deliveryCostMinor: 0,
      },
    ];
    expect(await s.command({ type: "refresh_growth" })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    s.context.growth.closeouts.splice(1);
    s.context.growth.closeouts[0].receiptsMinor = 0.5;
    expect(await s.command({ type: "refresh_growth" })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(ctx.growth.capacity).toBeNull();
  });
});

describe("integrity and corrected evidence", () => {
  it("rejects self/circular and cross-project dependencies before mutation", async () => {
    const s = setup();
    const view = await instantiate(s);
    const initial = structuredClone(view.state);
    initial.tasks[0].dependencies = [initial.tasks[0].id];
    const invalid = createFixtureRepository(s.context, initial);
    const service = createAutomationService(invalid.repository, () => now);
    await expect(
      service.readWorkspace(s.context.ownerId, s.context.agencyId),
    ).rejects.toMatchObject({ code: "invalid_input" });
    initial.tasks[0].dependencies = [initial.tasks[1].id];
    const cycle = createAutomationService(
      createFixtureRepository(s.context, initial).repository,
      () => now,
    );
    await expect(
      cycle.readWorkspace(s.context.ownerId, s.context.agencyId),
    ).rejects.toMatchObject({ code: "invalid_input" });
    initial.tasks[0].dependencies = [];
    initial.tasks[1].projectId = "foreign-project";
    const cross = createAutomationService(
      createFixtureRepository(s.context, initial).repository,
      () => now,
    );
    await expect(
      cross.readWorkspace(s.context.ownerId, s.context.agencyId),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
  });
  it("rejects old approved revisions and clears artifact identity on revision", async () => {
    const s = setup();
    let { state } = await instantiate(s);
    state = success(await transition(s, state.tasks[0], "in_progress")).state;
    s.context.artifacts.push({
      id: "old",
      taskId: state.tasks[0].id,
      runId: "old-run",
      status: "approved",
      reviewedByUserId: s.context.ownerId,
      reviewedAt: now.toISOString(),
      current: false,
    });
    expect(
      await transition(s, state.tasks[0], "awaiting_review", "old"),
    ).toMatchObject({ ok: false, code: "forbidden_or_missing" });
    s.context.artifacts[0].current = true;
    state = success(
      await transition(s, state.tasks[0], "awaiting_review", "old"),
    ).state;
    state = success(await transition(s, state.tasks[0], "in_progress")).state;
    expect(state.tasks[0]).toMatchObject({
      artifactId: null,
      runId: null,
      attempt: 2,
    });
    expect(state.tasks[0].history.at(-1)).toMatchObject({
      from: "awaiting_review",
      to: "in_progress",
      artifactId: "old",
    });
  });
  it("preserves dismissal/conversion when a recommendation resolves and later reopens", async () => {
    const s = setup();
    success(await s.command({ type: "refresh_growth" }));
    const recommendationKey = "milestone:first_offer";
    success(
      await s.command({ type: "recommendation_task", recommendationKey }),
    );
    success(
      await s.command({ type: "dismiss_recommendation", recommendationKey }),
    );
    s.context.growth.offers = [{ id: "offer", active: true }];
    let view = success(await s.command({ type: "refresh_growth" }));
    expect(
      view.state.recommendations.find((r) => r.key === recommendationKey),
    ).toMatchObject({
      resolvedAt: now.toISOString(),
      dismissedAt: now.toISOString(),
    });
    expect(
      await s.command({ type: "recommendation_task", recommendationKey }),
    ).toMatchObject({ ok: false, code: "conflict" });
    s.context.growth.offers[0].active = false;
    view = success(await s.command({ type: "refresh_growth" }));
    expect(
      view.state.milestones.find((m) => m.key === "first_offer")!.completedAt,
    ).toBeNull();
    expect(
      view.state.recommendations.find((r) => r.key === recommendationKey),
    ).toMatchObject({ resolvedAt: null, dismissedAt: now.toISOString() });
    view = success(
      await s.command({ type: "recommendation_task", recommendationKey }),
    );
    expect(view.state.tasks).toHaveLength(1);
  });
  it("keeps a monthly anchor across individually processed month-end occurrences", async () => {
    const fixture = createFixtureRepository();
    let clock = new Date("2026-01-31T14:00:00Z");
    const service = createAutomationService(fixture.repository, () => clock);
    let key = 0;
    const command = (command: AutomationCommand) =>
      service.command(fixture.context.ownerId, {
        agencyId: fixture.context.agencyId,
        expectedVersion: fixture.snapshot()?.version ?? 0,
        idempotencyKey: `monthly-${++key}`,
        command,
      });
    success(
      await command({
        type: "configure_routine",
        routineId: "monthly",
        templateKey: "monthly_evidence",
        timezone: "America/New_York",
        nextDueAt: clock.toISOString(),
        enabled: true,
      }),
    );
    success(await command({ type: "run_due_routines" }));
    clock = new Date("2026-02-28T14:00:00Z");
    const view = success(await command({ type: "run_due_routines" }));
    expect(view.state.routines[0].nextDueAt).toBe("2026-03-31T13:00:00.000Z");
    expect(view.state.occurrences.map((o) => o.skippedCount)).toEqual([0, 0]);
  });
});
