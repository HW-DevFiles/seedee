import "server-only";
import { createHash } from "node:crypto";
import {
  AutomationError,
  type AutomationState,
  type TaskStatus,
} from "./contracts";
import {
  applyCommand,
  emptyState,
  queueEligibility,
  dependenciesSatisfied,
  refreshGrowth,
} from "./engine";
import { assertAutomationIntegrity } from "./integrity";
import { checkedInstant } from "./clock";
import type { AutomationTransaction } from "./service";

export type RunEvent = {
  userId: string;
  agencyId: string;
  taskId: string;
  expectedTaskVersion: number;
  eventKey: string;
  runId: string;
  artifactId?: string;
  status:
    | "queued"
    | "running"
    | "awaiting_review"
    | "approved"
    | "failed"
    | "cancelled"
    | "retry"
    | "revision_requested";
};
// Internal engine callback only. Pass a port bound to the *existing* engine DB
// transaction. Saved engine artifact facts must be visible to loadOwned there.
// A failure propagates and rolls back both engine and core/automation state.
export async function recordRunEvent(
  tx: AutomationTransaction,
  event: RunEvent,
  now: Date,
): Promise<AutomationState> {
  const loaded = await tx.loadOwned(event.userId, event.agencyId);
  if (
    loaded.context.ownerId !== event.userId ||
    loaded.context.agencyId !== event.agencyId
  )
    throw new AutomationError(
      "forbidden_or_missing",
      "Workspace is unavailable.",
    );
  const state = structuredClone(loaded.state ?? emptyState(event.agencyId));
  assertAutomationIntegrity(state, loaded.context);
  const key = `engine:${event.eventKey}`;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        taskId: event.taskId,
        runId: event.runId,
        artifactId: event.artifactId ?? null,
        status: event.status,
      }),
    )
    .digest("hex");
  const receipt = state.receipts.find((r) => r.key === key);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint)
      throw new AutomationError(
        "conflict",
        "Engine event key already has a different result.",
      );
    return state;
  }
  const task = state.tasks.find((t) => t.id === event.taskId);
  if (!task)
    throw new AutomationError("forbidden_or_missing", "Task is unavailable.");
  if (task.version !== event.expectedTaskVersion)
    throw new AutomationError(
      "conflict",
      "Task changed before the run event was saved.",
    );
  if (
    task.runId &&
    task.runId !== event.runId &&
    event.status !== "retry" &&
    event.status !== "revision_requested"
  )
    throw new AutomationError(
      "conflict",
      "A different run is already attached to this task.",
    );
  const to: TaskStatus = {
    queued: "queued",
    running: "in_progress",
    awaiting_review: "awaiting_review",
    approved: "done",
    failed: "failed",
    cancelled: "cancelled",
    retry: "queued",
    revision_requested: "in_progress",
  }[event.status] as TaskStatus;
  const reservation =
    event.status === "queued" ||
    (event.status === "running" && task.status === "in_progress");
  if (event.status === "running" && task.status === "queued")
    queueEligibility(state, task.id, event.expectedTaskVersion);
  if (reservation) {
    if (
      !["queued", "in_progress"].includes(task.status) ||
      !dependenciesSatisfied(state, task)
    )
      throw new AutomationError(
        "conflict",
        "Task is not eligible for a run reservation.",
      );
    task.history.push({
      at: checkedInstant(now).toISOString(),
      actor: event.userId,
      from: task.status,
      to: task.status,
      reason: `Saved simulated run event: ${event.status}.`,
      artifactId: task.artifactId,
    });
    task.version += 1;
    refreshGrowth(state, loaded.context, checkedInstant(now));
  } else
    applyCommand(
      state,
      loaded.context,
      {
        type: "transition_task",
        taskId: task.id,
        expectedTaskVersion: task.version,
        to,
        reason: `Saved simulated run event: ${event.status}.`,
        ...(event.artifactId ? { artifactId: event.artifactId } : {}),
        runId: event.runId,
      },
      key,
      checkedInstant(now),
    );
  // Non-artifact events still retain their run identity. Retry/revision clears
  // that identity so a linked next attempt can attach its own run.
  if (event.status !== "retry" && event.status !== "revision_requested")
    task.runId = event.runId;
  assertAutomationIntegrity(state, loaded.context);
  state.receipts.push({ key, fingerprint });
  state.version += 1;
  await tx.saveOwned(event.userId, loaded.state?.version ?? 0, state);
  return state;
}
