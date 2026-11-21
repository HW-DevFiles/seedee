import "server-only";
import { z } from "zod";
import { idSchema } from "@/lib/ai/contracts";
import { AgencyEngine, engineResult } from "./service";
import { EngineError } from "./contracts";

const commandSchema = z.strictObject({
  type: z.enum([
    "generateAgency",
    "editDraft",
    "queueRun",
    "advanceRun",
    "approveRun",
    "requestRevision",
    "retryRun",
    "cancelRun",
    "draftPitch",
    "editPitch",
  ]),
  input: z.unknown(),
});
export interface EngineBoundary {
  /** Must derive identity from the current request/session and enforce mutation origin. */
  requireContext(mutation: boolean): Promise<{ userId: string }>;
  /** Maximus's generation bucket, shared across agency/task/pitch operations. */
  consumeGenerationLimit(context: { userId: string }): Promise<void>;
}

/** Bind inside thin Next Server Actions. Required callbacks have no permissive defaults. */
export function createEngineActions(
  engine: AgencyEngine,
  boundary: EngineBoundary,
) {
  return {
    async readWorkspace(agencyId?: string) {
      return engineResult(async () => {
        const { userId } = await boundary.requireContext(false);
        return engine.readWorkspace(
          userId,
          agencyId === undefined ? undefined : idSchema.parse(agencyId),
        );
      });
    },
    async command(raw: unknown) {
      return engineResult(async () => {
        const context = await boundary.requireContext(true);
        if (!context.userId)
          throw new EngineError("unauthenticated", "Sign in to continue.");
        const command = commandSchema.parse(raw);
        const scope = z
          .object({ agencyId: idSchema.optional() })
          .parse(command.input);
        // Authorize before quota or computation; no browser-supplied owner is forwarded.
        const state = await engine.readWorkspace(
          context.userId,
          scope.agencyId,
        );
        let providerWork = false;
        if (
          command.type === "generateAgency" ||
          command.type === "draftPitch"
        ) {
          const { idempotencyKey } = z
            .object({ idempotencyKey: idSchema })
            .parse(command.input);
          const record = (
            command.type === "generateAgency" ? state.drafts : state.pitches
          ).find((row) => row.idempotencyKey === idempotencyKey);
          providerWork = !record || record.status === "generating";
        } else if (command.type === "advanceRun") {
          const { runId } = z.object({ runId: idSchema }).parse(command.input);
          const run = state.runs.find(
            (row) => row.id === runId && row.agencyId === scope.agencyId,
          );
          providerWork = Boolean(
            run && ["queued", "running"].includes(run.status),
          );
        }
        if (providerWork) await boundary.consumeGenerationLimit(context);
        return engine[command.type](context.userId, command.input);
      });
    },
  };
}
