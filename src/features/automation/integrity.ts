import {
  AutomationError,
  type AutomationState,
  type OwnedContext,
} from "./contracts";

// Core Task/Project rows are the source of truth: entries for deleted core
// records are dropped from the loaded view and committed by the next mutation.
export function reconcileOwned(
  state: AutomationState,
  context: OwnedContext,
): AutomationState {
  const projects = new Set(context.projectIds);
  state.tasks = state.tasks.filter(
    (t) => !t.projectId || projects.has(t.projectId),
  );
  const tasks = new Set(state.tasks.map((t) => t.id));
  for (const task of state.tasks)
    task.dependencies = task.dependencies.filter((id) => tasks.has(id));
  state.workflows = state.workflows
    .map((w) => ({ ...w, taskIds: w.taskIds.filter((id) => tasks.has(id)) }))
    .filter((w) => projects.has(w.projectId) && w.taskIds.length);
  state.occurrences = state.occurrences.filter((o) => tasks.has(o.taskId));
  for (const recommendation of state.recommendations)
    if (recommendation.linkedTaskId && !tasks.has(recommendation.linkedTaskId))
      recommendation.linkedTaskId = null;
  return state;
}
export function assertAutomationIntegrity(
  state: AutomationState,
  context: OwnedContext,
): void {
  const ids = new Set(state.tasks.map((t) => t.id));
  if (ids.size !== state.tasks.length)
    throw new AutomationError(
      "conflict",
      "Duplicate task records require reconciliation.",
    );
  const taskMap = new Map(state.tasks.map((t) => [t.id, t]));
  const pending = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const task of state.tasks) {
    if (task.projectId && !context.projectIds.includes(task.projectId))
      throw new AutomationError(
        "forbidden_or_missing",
        "Task project is unavailable in this workspace.",
      );
    if (
      new Set(task.dependencies).size !== task.dependencies.length ||
      task.dependencies.some((id) => id === task.id || !taskMap.has(id))
    )
      throw new AutomationError(
        "invalid_input",
        "Task dependencies must be distinct owned predecessor records.",
      );
    pending.set(task.id, task.dependencies.length);
    for (const dependency of task.dependencies) {
      if (taskMap.get(dependency)!.projectId !== task.projectId)
        throw new AutomationError(
          "invalid_input",
          "Task dependencies must belong to the same project.",
        );
      successors.set(dependency, [
        ...(successors.get(dependency) ?? []),
        task.id,
      ]);
    }
  }
  const ready = [...pending]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    visited++;
    for (const id of successors.get(ready[index]) ?? []) {
      const count = pending.get(id)! - 1;
      pending.set(id, count);
      if (count === 0) ready.push(id);
    }
  }
  if (visited !== state.tasks.length)
    throw new AutomationError(
      "invalid_input",
      "Circular task dependencies are not allowed.",
    );
  for (const workflow of state.workflows)
    if (
      !context.projectIds.includes(workflow.projectId) ||
      workflow.taskIds.some(
        (id) => !taskMap.has(id) || taskMap.get(id)!.workflowId !== workflow.id,
      )
    )
      throw new AutomationError(
        "forbidden_or_missing",
        "Workflow references require reconciliation.",
      );
  if (state.routines.some((r) => r.ownerId !== context.ownerId))
    throw new AutomationError(
      "forbidden_or_missing",
      "Routine owner is unavailable in this workspace.",
    );
}
