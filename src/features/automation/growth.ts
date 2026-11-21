import {
  AutomationError,
  type AutomationState,
  type GrowthFacts,
  type GrowthMetrics,
} from "./contracts";
import { checkedInstant } from "./clock";

function total(values: (number | null)[]): number | null {
  if (!values.length || values.some((v) => v === null)) return null;
  let result = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value))
      throw new AutomationError(
        "invalid_input",
        "Growth amounts must be safe integer cents.",
      );
    result += value!;
    if (!Number.isSafeInteger(result))
      throw new AutomationError(
        "invalid_input",
        "Growth total exceeds the supported range.",
      );
  }
  return result;
}
export function completedInPeriod(facts: GrowthFacts) {
  const start = checkedInstant(facts.period.from).getTime();
  const end = checkedInstant(facts.period.through).getTime();
  if (end < start)
    throw new AutomationError("invalid_input", "Invalid growth period.");
  return facts.projects.filter(
    (p) =>
      p.completedAt &&
      checkedInstant(p.completedAt).getTime() >= start &&
      checkedInstant(p.completedAt).getTime() <= end,
  );
}
export function repeatClientProjects(
  completed: GrowthFacts["projects"],
): GrowthFacts["projects"] {
  const groups = new Map<string, number>();
  for (const project of completed)
    if (project.economicClientGroupId)
      groups.set(
        project.economicClientGroupId,
        (groups.get(project.economicClientGroupId) ?? 0) + 1,
      );
  return completed.filter(
    (p) => p.economicClientGroupId && groups.get(p.economicClientGroupId)! >= 2,
  );
}
export function growthMetrics(
  state: AutomationState,
  facts: GrowthFacts,
  now: Date,
): GrowthMetrics {
  const completed = completedInPeriod(facts);
  const ids = new Set(completed.map((p) => p.id));
  const closeouts = facts.closeouts.filter((c) => ids.has(c.projectId));
  if (new Set(closeouts.map((c) => c.projectId)).size !== closeouts.length)
    throw new AutomationError(
      "invalid_input",
      "Closeouts must be reconciled by stable project reference.",
    );
  // Missing closeouts and missing amounts remain unknown, rather than understating totals.
  const completeCoverage = closeouts.length === completed.length;
  const revenue = completeCoverage
    ? total(closeouts.map((c) => c.recognizedRevenueMinor))
    : null;
  const costs = completeCoverage
    ? total(closeouts.map((c) => c.deliveryCostMinor))
    : null;
  return {
    basis: "completed_project_closeouts",
    note: "Recognized revenue and receipts are recorded closeout amounts for projects completed in this window; these are not monthly cash-flow actuals.",
    period: facts.period,
    origin: facts.origin,
    completedProjects: completed.length,
    repeatClients: new Set(
      repeatClientProjects(completed).map((p) => p.economicClientGroupId),
    ).size,
    recognizedRevenueMinor: revenue,
    collectionsMinor: completeCoverage
      ? total(closeouts.map((c) => c.receiptsMinor))
      : null,
    deliveryMargin:
      revenue !== null && revenue > 0 && costs !== null
        ? {
            numeratorMinor: total([revenue, -costs])!,
            denominatorMinor: revenue,
          }
        : null,
    closeoutCount: closeouts.length,
    overdueTasks: new Set([
      ...facts.overdueTaskIds,
      ...state.tasks
        .filter(
          (task) =>
            task.dueAt &&
            checkedInstant(task.dueAt) < now &&
            task.status !== "done" &&
            task.status !== "cancelled",
        )
        .map((t) => t.id),
    ]).size,
    reviewedSops: new Set(facts.reviewedSopIds).size,
    humanCapacity: facts.capacity,
  };
}
