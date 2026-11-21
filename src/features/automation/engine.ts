import { createHash } from "node:crypto";
import {
  AutomationError,
  type AutomationCommand,
  type AutomationState,
  type OwnedContext,
  type Task,
  type TaskStatus,
  type WorkspaceView,
} from "./contracts";
import { checkTimezone, checkedInstant, dueSlots } from "./clock";
import { growthMetrics } from "./growth";
import {
  milestoneDefinitions,
  routineTemplates,
  workflowTemplates,
} from "./templates";

export function stableId(namespace: string, key: string): string {
  return `${namespace}_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}
export function emptyState(agencyId: string): AutomationState {
  return {
    schemaVersion: 1,
    agencyId,
    version: 0,
    tasks: [],
    workflows: [],
    routines: [],
    occurrences: [],
    notifications: [],
    milestones: milestoneDefinitions.map((d) => ({
      ...d,
      completedAt: null,
      evidenceIds: [],
      completion: null,
      attestation: null,
    })),
    recommendations: [],
    deliveries: [],
    receipts: [],
  };
}
function requireRecord<T>(record: T | undefined): T {
  if (!record)
    throw new AutomationError(
      "forbidden_or_missing",
      "The requested record is unavailable in this workspace.",
    );
  return record;
}
function newTask(
  id: string,
  title: string,
  input: string,
  dueAt: string | null,
): Task {
  return {
    id,
    title,
    input,
    dueAt: dueAt ? checkedInstant(dueAt).toISOString() : null,
    originalCommittedDueAt: dueAt ? checkedInstant(dueAt).toISOString() : null,
    projectId: null,
    workflowId: null,
    roleKey: null,
    kind: "work",
    dependencies: [],
    status: "queued",
    version: 0,
    attempt: 1,
    artifactId: null,
    runId: null,
    history: [],
    dueDateRevisions: [],
  };
}
function notify(
  state: AutomationState,
  kind: AutomationState["notifications"][number]["kind"],
  key: string,
  target: { type: "task" | "milestone"; id: string },
  at: string,
) {
  if (state.notifications.some((n) => n.eventKey === key)) return;
  const message = {
    awaiting_review: "An internal draft is awaiting your review.",
    failed_run: "Simulated work failed. Review the task before retrying.",
    overdue_task:
      "A task is overdue. Review its original commitment and current schedule.",
    milestone_completed: "A growth milestone has recorded completion evidence.",
  }[kind];
  state.notifications.push({
    id: stableId("notice", key),
    eventKey: key,
    kind,
    message,
    target,
    createdAt: at,
    readAt: null,
  });
}
export function dependenciesSatisfied(
  state: AutomationState,
  task: Task,
): boolean {
  return task.dependencies.every((id) =>
    state.tasks.some(
      (predecessor) => predecessor.id === id && predecessor.status === "done",
    ),
  );
}
export function queueEligibility(
  state: AutomationState,
  taskId: string,
  expectedTaskVersion: number,
) {
  const task = requireRecord(state.tasks.find((t) => t.id === taskId));
  if (task.version !== expectedTaskVersion)
    throw new AutomationError(
      "conflict",
      "Task changed. Reload its current version before retrying.",
    );
  if (task.status !== "queued" || !dependenciesSatisfied(state, task))
    throw new AutomationError(
      "conflict",
      "Finish and review all predecessors before starting this task.",
    );
  return {
    taskId: task.id,
    projectId: task.projectId,
    roleKey: task.roleKey,
    taskVersion: task.version,
    dependencySatisfied: true as const,
  };
}
const allowed: Record<TaskStatus, TaskStatus[]> = {
  blocked: ["cancelled"],
  queued: ["in_progress", "cancelled"],
  in_progress: ["awaiting_review", "failed", "cancelled"],
  awaiting_review: ["done", "in_progress", "cancelled"],
  failed: ["queued", "cancelled"],
  cancelled: ["queued"],
  done: [],
};
function changeTask(
  state: AutomationState,
  ctx: OwnedContext,
  command: Extract<AutomationCommand, { type: "transition_task" }>,
  at: string,
) {
  const task = requireRecord(state.tasks.find((t) => t.id === command.taskId));
  if (task.version !== command.expectedTaskVersion)
    throw new AutomationError(
      "conflict",
      "Task changed. Reload its current version before retrying.",
    );
  if (!allowed[task.status].includes(command.to))
    throw new AutomationError(
      "conflict",
      "That task transition is not allowed.",
    );
  if (command.to !== "cancelled" && !dependenciesSatisfied(state, task))
    throw new AutomationError(
      "conflict",
      "A predecessor still needs completion and review.",
    );
  if (command.to === "in_progress" && task.status === "queued")
    queueEligibility(state, task.id, task.version);
  if (command.artifactId) {
    const artifact = requireRecord(
      ctx.artifacts.find(
        (a) =>
          a.id === command.artifactId &&
          a.current &&
          (a.taskId === task.id ||
            (task.kind === "human_review" &&
              task.dependencies.includes(a.taskId))),
      ),
    );
    if (command.runId && artifact.runId !== command.runId)
      throw new AutomationError(
        "invalid_input",
        "Artifact and run do not match.",
      );
    task.artifactId = artifact.id;
    task.runId = artifact.runId;
  }
  if (
    command.to === "awaiting_review" &&
    (task.kind === "work" || task.kind === "human_review") &&
    !task.artifactId
  )
    throw new AutomationError(
      "invalid_input",
      "Record an internal artifact before requesting review.",
    );
  if (command.to === "done") {
    if (task.kind === "work" || task.kind === "human_review") {
      const artifact = requireRecord(
        ctx.artifacts.find(
          (a) =>
            a.id === task.artifactId &&
            a.current &&
            (a.taskId === task.id ||
              (task.kind === "human_review" &&
                task.dependencies.includes(a.taskId))),
        ),
      );
      if (
        artifact.status !== "approved" ||
        artifact.reviewedByUserId !== ctx.ownerId ||
        !artifact.reviewedAt ||
        checkedInstant(artifact.reviewedAt) > checkedInstant(at)
      )
        throw new AutomationError(
          "conflict",
          "Owner approval of the current artifact is required.",
        );
    }
    if (
      task.kind === "delivery_record" &&
      (!task.projectId ||
        (!ctx.recordedDeliveryProjectIds.includes(task.projectId) &&
          !state.deliveries.some((d) => d.projectId === task.projectId)))
    )
      throw new AutomationError(
        "conflict",
        "Record internal delivery before completing this step.",
      );
    if (
      task.kind === "closeout" &&
      (!task.projectId || !ctx.closeoutProjectIds.includes(task.projectId))
    )
      throw new AutomationError(
        "conflict",
        "Save project closeout facts before completing this step.",
      );
  }
  const previous = task.status;
  task.history.push({
    at,
    actor: ctx.ownerId,
    from: previous,
    to: command.to,
    reason: command.reason,
    artifactId: task.artifactId,
  });
  if (
    (command.to === "queued" &&
      (previous === "failed" || previous === "cancelled")) ||
    (previous === "awaiting_review" && command.to === "in_progress")
  ) {
    task.attempt += 1;
    task.artifactId = null;
    task.runId = null;
  }
  task.status = command.to;
  task.version += 1;
  if (command.to === "awaiting_review" || command.to === "failed")
    notify(
      state,
      command.to === "failed" ? "failed_run" : "awaiting_review",
      `${task.id}:${task.attempt}:${command.to}`,
      { type: "task", id: task.id },
      at,
    );
  for (const successor of state.tasks) {
    if (
      successor.status === "blocked" &&
      dependenciesSatisfied(state, successor)
    ) {
      successor.history.push({
        at,
        actor: ctx.ownerId,
        from: "blocked",
        to: "queued",
        reason: "All predecessors completed.",
        artifactId: null,
      });
      successor.status = "queued";
      successor.version += 1;
    }
  }
}
export function refreshGrowth(
  state: AutomationState,
  ctx: OwnedContext,
  now: Date,
) {
  const metrics = growthMetrics(state, ctx.growth, now);
  const at = now.toISOString();
  const capacity = ctx.growth.capacity;
  const capacityAge = capacity
    ? now.getTime() - checkedInstant(capacity.asOf).getTime()
    : Infinity;
  const completedProjects = new Set(
    ctx.growth.projects
      .filter(
        (p) =>
          p.completedAt &&
          checkedInstant(p.completedAt) >=
            checkedInstant(ctx.growth.period.from) &&
          checkedInstant(p.completedAt) <=
            checkedInstant(ctx.growth.period.through),
      )
      .map((p) => p.id),
  );
  const ruleEvidence: Record<string, string[]> = {
    first_offer: ctx.growth.offers.filter((p) => p.active).map((p) => p.id),
    reviewed_process: ctx.growth.reviewedSopIds,
    paid_project: ctx.growth.closeouts
      .filter(
        (c) =>
          completedProjects.has(c.projectId) &&
          c.recognizedRevenueMinor !== null &&
          c.recognizedRevenueMinor > 0 &&
          c.receiptsMinor !== null &&
          c.receiptsMinor > 0,
      )
      .map((c) => c.id),
    repeat_client: metrics.repeatClients > 0 ? [...completedProjects] : [],
    capacity_review:
      capacity &&
      capacity.availableHours !== null &&
      capacity.plannedHours !== null &&
      capacityAge >= 0 &&
      capacityAge <= 30 * 86400000
        ? [capacity.evidenceId]
        : [],
    investor_evidence:
      ctx.growth.investorEvidenceComplete === true
        ? ctx.growth.investorEvidenceIds
        : [],
  };
  for (const milestone of state.milestones) {
    const evidence = ruleEvidence[milestone.key] ?? [];
    if (milestone.completion !== "manual_attestation") {
      const wasCompleted = milestone.completedAt;
      milestone.completedAt = evidence.length
        ? (milestone.completedAt ?? at)
        : null;
      milestone.completion = evidence.length ? "rule" : null;
      milestone.evidenceIds = [...new Set(evidence)];
      if (!wasCompleted && milestone.completedAt)
        notify(
          state,
          "milestone_completed",
          `milestone:${milestone.key}`,
          { type: "milestone", id: milestone.key },
          at,
        );
    }
  }
  const gaps = [
    ...state.milestones
      .filter((m) => !m.completedAt)
      .map((m) => ({
        key: `milestone:${m.key}`,
        title: m.title,
        reason: m.target,
        evidenceIds: m.evidenceIds,
      })),
    ...ctx.growth.investorGaps.map((g) => ({ ...g, key: `investor:${g.key}` })),
  ];
  for (const taskId of ctx.growth.overdueTaskIds) {
    if (!state.tasks.some((t) => t.id === taskId))
      notify(
        state,
        "overdue_task",
        `overdue:${taskId}`,
        { type: "task", id: taskId },
        at,
      );
  }
  const priorRecommendations = state.recommendations;
  state.recommendations = gaps.map((gap) => {
    const prior = state.recommendations.find((r) => r.key === gap.key);
    return {
      ...gap,
      dismissedAt: prior?.dismissedAt ?? null,
      linkedTaskId: prior?.linkedTaskId ?? null,
      resolvedAt: null,
    };
  });
  state.recommendations.push(
    ...priorRecommendations
      .filter((r) => !gaps.some((g) => g.key === r.key))
      .map((r) => ({ ...r, resolvedAt: r.resolvedAt ?? at })),
  );
  for (const task of state.tasks)
    if (
      task.dueAt &&
      checkedInstant(task.dueAt) < now &&
      task.status !== "done" &&
      task.status !== "cancelled"
    )
      notify(
        state,
        "overdue_task",
        `overdue:${task.id}:${task.originalCommittedDueAt ?? task.dueAt}`,
        { type: "task", id: task.id },
        at,
      );
}
export function applyCommand(
  state: AutomationState,
  ctx: OwnedContext,
  command: AutomationCommand,
  key: string,
  now: Date,
): void {
  const at = now.toISOString();
  switch (command.type) {
    case "record_delivery": {
      if (!ctx.projectIds.includes(command.projectId))
        throw new AutomationError(
          "forbidden_or_missing",
          "Project is unavailable in this workspace.",
        );
      if (checkedInstant(command.deliveryDate) > now)
        throw new AutomationError(
          "invalid_input",
          "Recorded delivery cannot be in the future.",
        );
      const record = {
        projectId: command.projectId,
        deliveryDate: checkedInstant(command.deliveryDate).toISOString(),
        note: command.note,
        recordedAt: at,
        recordedByUserId: ctx.ownerId,
      };
      const previous = state.deliveries.findIndex(
        (d) => d.projectId === command.projectId,
      );
      if (previous < 0) state.deliveries.push(record);
      else state.deliveries[previous] = record;
      break;
    }
    case "instantiate_workflow": {
      if (!ctx.workflowProjectIds.includes(command.projectId))
        throw new AutomationError(
          "forbidden_or_missing",
          "Project is unavailable in this workspace.",
        );
      const template = requireRecord(
        workflowTemplates.find((t) => t.key === command.templateKey),
      );
      const workflowId = stableId("workflow", `${state.agencyId}:${key}`);
      const taskIds = template.steps.map((_, i) =>
        stableId("task", `${workflowId}:${i}`),
      );
      state.workflows.push({
        id: workflowId,
        projectId: command.projectId,
        templateKey: template.key,
        templateVersion: template.version,
        taskIds,
        createdAt: at,
      });
      template.steps.forEach((step, i) =>
        state.tasks.push({
          ...newTask(
            taskIds[i],
            step.title,
            `Internal ${step.title.toLowerCase()} for owner review. Nothing is sent externally.`,
            command.dueAt,
          ),
          projectId: command.projectId,
          workflowId,
          roleKey: step.roleKey,
          kind: step.kind,
          dependencies: i ? [taskIds[i - 1]] : [],
          status: i ? "blocked" : "queued",
        }),
      );
      break;
    }
    case "transition_task":
      changeTask(state, ctx, command, at);
      break;
    case "reschedule_task": {
      const task = requireRecord(
        state.tasks.find((t) => t.id === command.taskId),
      );
      if (task.version !== command.expectedTaskVersion)
        throw new AutomationError(
          "conflict",
          "Task changed. Reload before changing its due date.",
        );
      task.dueDateRevisions.push({
        at,
        previous: task.dueAt,
        next: command.dueAt
          ? checkedInstant(command.dueAt).toISOString()
          : null,
        reason: command.reason,
      });
      if (
        !task.originalCommittedDueAt &&
        command.dueAt &&
        task.dueDateRevisions.every((r) => r.previous === null)
      )
        task.originalCommittedDueAt = checkedInstant(
          command.dueAt,
        ).toISOString();
      task.dueAt = command.dueAt
        ? checkedInstant(command.dueAt).toISOString()
        : null;
      task.version += 1;
      break;
    }
    case "configure_routine": {
      checkTimezone(command.timezone);
      const previous = state.routines.find((r) => r.id === command.routineId);
      if (previous && previous.templateKey !== command.templateKey)
        throw new AutomationError(
          "invalid_input",
          "A routine's template cannot be changed.",
        );
      // Pausing/resuming never rewrites its due slot to hide missed intervals.
      if (previous) {
        previous.enabled = command.enabled;
      } else
        state.routines.push({
          id: command.routineId,
          templateKey: command.templateKey,
          templateVersion: "routines-v1",
          cadence:
            command.templateKey === "weekly_planning" ? "weekly" : "monthly",
          timezone: command.timezone,
          nextDueAt: checkedInstant(command.nextDueAt).toISOString(),
          anchorAt: checkedInstant(command.nextDueAt).toISOString(),
          nextSlotIndex: 0,
          enabled: command.enabled,
          ownerId: ctx.ownerId,
        });
      break;
    }
    case "run_due_routines": {
      for (const routine of state.routines) {
        if (!routine.enabled || checkedInstant(routine.nextDueAt) > now)
          continue;
        const slot = routine.nextDueAt;
        const occurrenceKey = `${routine.id}:${slot}`;
        const template = requireRecord(
          routineTemplates.find((t) => t.key === routine.templateKey),
        );
        const advance = dueSlots(
          routine.anchorAt,
          routine.timezone,
          routine.cadence,
          now,
          routine.nextSlotIndex,
        );
        if (!state.occurrences.some((o) => o.key === occurrenceKey)) {
          const taskId = stableId(
            "routine_task",
            `${state.agencyId}:${occurrenceKey}`,
          );
          state.tasks.push(newTask(taskId, template.title, template.input, at));
          state.occurrences.push({
            key: occurrenceKey,
            routineId: routine.id,
            slot,
            taskId,
            skippedCount: advance.skippedCount,
            createdAt: at,
          });
        }
        routine.nextDueAt = advance.nextDueAt;
        routine.nextSlotIndex = advance.nextSlotIndex;
      }
      break;
    }
    case "refresh_growth":
      break;
    case "mark_notifications_read": {
      if (
        command.notificationIds?.some(
          (id) => !state.notifications.some((n) => n.id === id),
        )
      )
        throw new AutomationError(
          "forbidden_or_missing",
          "A notification is unavailable in this workspace.",
        );
      for (const notice of state.notifications)
        if (
          !command.notificationIds ||
          command.notificationIds.includes(notice.id)
        )
          notice.readAt ??= at;
      break;
    }
    case "recommendation_task": {
      const recommendation = requireRecord(
        state.recommendations.find((r) => r.key === command.recommendationKey),
      );
      if (recommendation.resolvedAt)
        throw new AutomationError(
          "conflict",
          "This recommendation no longer has an evidence gap.",
        );
      if (!recommendation.linkedTaskId) {
        const taskId = stableId(
          "recommendation_task",
          `${state.agencyId}:${recommendation.key}`,
        );
        if (!state.tasks.some((t) => t.id === taskId))
          state.tasks.push(
            newTask(taskId, recommendation.title, recommendation.reason, null),
          );
        recommendation.linkedTaskId = taskId;
      }
      break;
    }
    case "dismiss_recommendation":
      requireRecord(
        state.recommendations.find((r) => r.key === command.recommendationKey),
      ).dismissedAt ??= at;
      break;
    case "attest_milestone": {
      const milestone = requireRecord(
        state.milestones.find((m) => m.key === command.milestoneKey),
      );
      const knownEvidence = new Set([
        ...ctx.growth.offers.map((o) => o.id),
        ...ctx.growth.closeouts.map((c) => c.id),
        ...ctx.growth.reviewedSopIds,
        ...ctx.growth.investorEvidenceIds,
        ...(ctx.growth.capacity ? [ctx.growth.capacity.evidenceId] : []),
      ]);
      if (command.evidenceIds.some((id) => !knownEvidence.has(id)))
        throw new AutomationError(
          "forbidden_or_missing",
          "Attestation must reference owned evidence.",
        );
      milestone.completion = "manual_attestation";
      milestone.completedAt = at;
      milestone.attestation = command.statement;
      milestone.evidenceIds = command.evidenceIds;
      notify(
        state,
        "milestone_completed",
        `milestone:${milestone.key}`,
        { type: "milestone", id: milestone.key },
        at,
      );
      break;
    }
  }
  refreshGrowth(state, ctx, now);
}
export function workspaceView(
  state: AutomationState,
  ctx: OwnedContext,
  now: Date,
): WorkspaceView {
  return {
    state,
    metrics: growthMetrics(state, ctx.growth, now),
    templates: workflowTemplates,
    routineTemplates,
  };
}
