// Explicit fixture adapter: never imported by live actions. All evidence is sample.
import {
  AutomationError,
  type AutomationState,
  type OwnedContext,
} from "./contracts";
import { type AutomationRepository } from "./service";
export function fixtureContext(
  ownerId = "sample-owner",
  agencyId = "sample-agency",
): OwnedContext {
  return {
    ownerId,
    agencyId,
    projectIds: ["sample-project"],
    workflowProjectIds: ["sample-project"],
    artifacts: [],
    recordedDeliveryProjectIds: [],
    closeoutProjectIds: [],
    growth: {
      period: {
        from: "2026-11-01T00:00:00.000Z",
        through: "2026-11-30T23:59:59.999Z",
      },
      origin: "sample",
      offers: [],
      projects: [],
      closeouts: [],
      overdueTaskIds: [],
      reviewedSopIds: [],
      capacity: null,
      investorGaps: [],
      investorEvidenceComplete: null,
      investorEvidenceIds: [],
    },
  };
}
export function createFixtureRepository(
  context = fixtureContext(),
  initial: AutomationState | null = null,
) {
  let saved = initial ? structuredClone(initial) : null;
  let serial: Promise<unknown> = Promise.resolve();
  const repository: AutomationRepository = {
    transaction<T>(
      work: Parameters<AutomationRepository["transaction"]>[0],
    ): Promise<T> {
      const run = serial.then(async () => {
        let draft = saved ? structuredClone(saved) : null;
        const result = await work({
          async loadOwned(userId, agencyId) {
            if (context.ownerId !== userId || context.agencyId !== agencyId)
              throw new AutomationError(
                "forbidden_or_missing",
                "Workspace is unavailable.",
              );
            return { state: draft, context: structuredClone(context) };
          },
          async saveOwned(userId, version, next) {
            if (
              context.ownerId !== userId ||
              next.agencyId !== context.agencyId
            )
              throw new AutomationError(
                "forbidden_or_missing",
                "Workspace is unavailable.",
              );
            if ((draft?.version ?? 0) !== version)
              throw new AutomationError("conflict", "Workspace changed.");
            draft = structuredClone(next);
          },
        });
        saved = draft;
        return result;
      });
      serial = run.catch(() => undefined);
      return run as Promise<T>;
    },
  };
  return { repository, context, snapshot: () => structuredClone(saved) };
}
