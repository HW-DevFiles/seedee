import "server-only";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
  AutomationError,
  type AutomationState,
  type OwnedContext,
} from "./contracts";
import { automationStateSchema } from "./state-schema";
import type { AutomationRepository, AutomationTransaction } from "./service";

export type AutomationBridge = {
  // Reads core records and saved engine approval facts in this transaction.
  loadContext(
    tx: Prisma.TransactionClient,
    userId: string,
    agencyId: string,
  ): Promise<OwnedContext>;
  // Reject core/aggregate version divergence or reconcile through the same guards.
  hydrateTasks(
    tx: Prisma.TransactionClient,
    state: AutomationState,
  ): Promise<AutomationState>;
  // Projects workflow/routine tasks, dependencies, original dates and histories to
  // core records. Never derive payment, revenue, client acceptance or verification.
  syncTasks(
    tx: Prisma.TransactionClient,
    userId: string,
    previous: AutomationState | null,
    next: AutomationState,
  ): Promise<void>;
};
// Reuse an existing engine/core transaction rather than nesting a transaction.
export function createPrismaAutomationTransaction(
  tx: Prisma.TransactionClient,
  bridge: AutomationBridge,
): AutomationTransaction {
  let previous: AutomationState | null = null;
  let loadedAgency: string | null = null;
  return {
    async loadOwned(userId, agencyId) {
      const agency = await tx.agency.findFirst({
        where: { id: agencyId, ownerId: userId },
        select: { id: true },
      });
      if (!agency)
        throw new AutomationError(
          "forbidden_or_missing",
          "Workspace is unavailable.",
        );
      // Raw tagged SQL allows this adapter to compile on the foundation
      // before Kuba's single shared migration adds the accepted table.
      const rows = await tx.$queryRaw<
        { stateJson: string; version: number }[]
      >`SELECT "stateJson", "version" FROM "AutomationState" WHERE "agencyId" = ${agencyId}`;
      const row = rows[0];
      let state: AutomationState | null = null;
      if (row && row.stateJson !== "{}") {
        state = automationStateSchema.parse(JSON.parse(row.stateJson));
        if (state.agencyId !== agencyId || state.version !== row.version)
          throw new AutomationError(
            "conflict",
            "Automation storage needs reconciliation.",
          );
        state = automationStateSchema.parse(
          await bridge.hydrateTasks(tx, state),
        );
      } else if (row && row.version !== 0)
        throw new AutomationError(
          "conflict",
          "Automation storage needs reconciliation.",
        );
      previous = state ? structuredClone(state) : null;
      loadedAgency = agencyId;
      const context = await bridge.loadContext(tx, userId, agencyId);
      return { state, context };
    },
    async saveOwned(userId, version, next) {
      if (loadedAgency !== next.agencyId)
        throw new AutomationError(
          "forbidden_or_missing",
          "Workspace is unavailable.",
        );
      const agency = await tx.agency.findFirst({
        where: { id: next.agencyId, ownerId: userId },
        select: { id: true },
      });
      if (!agency)
        throw new AutomationError(
          "forbidden_or_missing",
          "Workspace is unavailable.",
        );
      automationStateSchema.parse(next);
      await tx.$executeRaw`INSERT INTO "AutomationState" ("agencyId", "version", "stateJson", "updatedAt") VALUES (${next.agencyId}, 0, '{}', CURRENT_TIMESTAMP) ON CONFLICT ("agencyId") DO NOTHING`;
      const count =
        await tx.$executeRaw`UPDATE "AutomationState" SET "version" = ${next.version}, "stateJson" = ${JSON.stringify(next)}, "updatedAt" = CURRENT_TIMESTAMP WHERE "agencyId" = ${next.agencyId} AND "version" = ${version}`;
      if (count !== 1)
        throw new AutomationError(
          "conflict",
          "Workspace changed. Reload and retry.",
        );
      await bridge.syncTasks(tx, userId, previous, next);
    },
  };
}
export function createPrismaAutomationRepository(
  db: PrismaClient,
  bridge: AutomationBridge,
): AutomationRepository {
  return {
    transaction(work) {
      return db.$transaction((tx) =>
        work(createPrismaAutomationTransaction(tx, bridge)),
      );
    },
  };
}
