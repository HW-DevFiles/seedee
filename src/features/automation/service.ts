import "server-only";
import { createHash } from "node:crypto";
import {
  AutomationError,
  requestSchema,
  type AutomationResult,
  type AutomationState,
  type OwnedContext,
  type WorkspaceView,
} from "./contracts";
import {
  applyCommand,
  emptyState,
  recordReceipt,
  workspaceView,
} from "./engine";
import { checkedInstant, type Clock } from "./clock";
import { assertAutomationIntegrity, reconcileOwned } from "./integrity";
import { automationStateSchema } from "./state-schema";

export type AutomationTransaction = {
  // Must load all foreign references only for the session-derived owner, and
  // hydrate core task versions before interpreting a transition.
  loadOwned(
    userId: string,
    agencyId: string,
  ): Promise<{ state: AutomationState | null; context: OwnedContext }>;
  // Aggregate CAS and core task/event projection MUST share one DB transaction.
  // A mismatch throws conflict and rolls back every dependent write.
  saveOwned(
    userId: string,
    previousVersion: number,
    next: AutomationState,
  ): Promise<void>;
};
export type AutomationRepository = {
  transaction<T>(work: (tx: AutomationTransaction) => Promise<T>): Promise<T>;
};
function owned(
  userId: string,
  agencyId: string,
  loaded: { state: AutomationState | null; context: OwnedContext },
) {
  if (
    loaded.context.ownerId !== userId ||
    loaded.context.agencyId !== agencyId ||
    (loaded.state && loaded.state.agencyId !== agencyId)
  )
    throw new AutomationError(
      "forbidden_or_missing",
      "Workspace is unavailable.",
    );
  return loaded;
}
export function createAutomationService(
  repository: AutomationRepository,
  clock: Clock,
) {
  async function readWorkspace(
    userId: string,
    agencyId: string,
  ): Promise<WorkspaceView> {
    if (!userId)
      throw new AutomationError("unauthenticated", "Sign in to continue.");
    const now = checkedInstant(clock());
    return repository.transaction(async (tx) => {
      const { state, context } = owned(
        userId,
        agencyId,
        await tx.loadOwned(userId, agencyId),
      );
      // A GET/read has no routine, notification or milestone side effects.
      const current = reconcileOwned(
        structuredClone(state ?? emptyState(agencyId)),
        context,
      );
      assertAutomationIntegrity(current, context);
      return workspaceView(current, context, now);
    });
  }
  async function command(
    userId: string,
    input: unknown,
  ): Promise<AutomationResult> {
    if (!userId)
      return {
        ok: false,
        code: "unauthenticated",
        message: "Sign in to continue.",
      };
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        code: "invalid_input",
        message: "Check the command fields and try again.",
      };
    const request = parsed.data;
    const now = checkedInstant(clock());
    try {
      return await repository.transaction(async (tx) => {
        const { state: saved, context } = owned(
          userId,
          request.agencyId,
          await tx.loadOwned(userId, request.agencyId),
        );
        const state = reconcileOwned(
          structuredClone(saved ?? emptyState(request.agencyId)),
          context,
        );
        assertAutomationIntegrity(state, context);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(request.command))
          .digest("hex");
        const receipt = state.receipts.find(
          (r) => r.key === request.idempotencyKey,
        );
        // Replays precede version checks: a response lost after commit is safe to retry.
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new AutomationError(
              "conflict",
              "That request key was already used for different work.",
            );
          return {
            ok: true,
            replayed: true,
            workspace: workspaceView(state, context, now),
          };
        }
        if (state.version !== request.expectedVersion)
          return {
            ok: false,
            code: "conflict",
            message:
              "Workspace changed. Reload the current version before retrying.",
            current: workspaceView(state, context, now),
          };
        applyCommand(
          state,
          context,
          request.command,
          request.idempotencyKey,
          now,
        );
        assertAutomationIntegrity(state, context);
        if (
          request.command.type === "run_due_routines" &&
          // Normalise key order: persisted state is schema-parsed on load.
          JSON.stringify(automationStateSchema.parse(state)) ===
            JSON.stringify(saved && automationStateSchema.parse(saved))
        )
          return {
            ok: true,
            replayed: false,
            workspace: workspaceView(state, context, now),
          };
        recordReceipt(state, { key: request.idempotencyKey, fingerprint });
        state.version += 1;
        await tx.saveOwned(userId, saved?.version ?? 0, state);
        return {
          ok: true,
          replayed: false,
          workspace: workspaceView(state, context, now),
        };
      });
    } catch (error) {
      if (error instanceof AutomationError) {
        // Return current state for optimistic conflicts without exposing internals.
        const current =
          error.code === "conflict"
            ? await readWorkspace(userId, request.agencyId).catch(
                () => undefined,
              )
            : undefined;
        return {
          ok: false,
          code: error.code,
          message: error.message,
          ...(current ? { current } : {}),
        };
      }
      return {
        ok: false,
        code: "provider_failed",
        message:
          "Automation could not be saved. Reload and retry with the same request key.",
      };
    }
  }
  return { readWorkspace, command };
}
