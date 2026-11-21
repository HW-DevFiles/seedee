import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { factSchema, type EvidenceFact } from "@/lib/ai/contracts";
import { EngineError, stateSchema, type Scope } from "./contracts";
import type { EngineBridge } from "./repository";
import { fingerprint } from "./service";

function json(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}
function utcDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime())
    ? instant.toISOString().slice(0, 10)
    : null;
}
async function owned(tx: Prisma.TransactionClient, scope: Scope) {
  if (
    !scope.agencyId ||
    !(await tx.agency.findFirst({
      where: { id: scope.agencyId, ownerId: scope.userId },
      select: { id: true },
    }))
  )
    throw new EngineError("forbidden_or_missing", "Workspace unavailable.");
}
/** Lifecycle is supplied by Remy's recordRunEvent transaction binding, never a second transaction. */
export function createWorkspaceEngineBridge(
  lifecycle: EngineBridge["lifecycle"],
): EngineBridge {
  return {
    lifecycle,
    async task(tx, scope, taskId, projectId) {
      await owned(tx, scope);
      const rows = await tx.$queryRaw<
        {
          id: string;
          agencyId: string;
          projectId: string | null;
          status: string;
          version: number;
        }[]
      >`SELECT "id","agencyId","projectId","status","version" FROM "Task" WHERE "id"=${taskId} AND "agencyId"=${scope.agencyId}`;
      const task = rows[0];
      if (!task || task.projectId !== projectId)
        throw new EngineError("forbidden_or_missing", "Task unavailable.");
      if (projectId) {
        const projects = await tx.$queryRaw<
          { id: string; archivedAt: unknown; status: string }[]
        >`SELECT "id","archivedAt","status" FROM "Project" WHERE "id"=${projectId} AND "agencyId"=${scope.agencyId}`;
        if (!projects[0])
          throw new EngineError("forbidden_or_missing", "Project unavailable.");
        if (projects[0].archivedAt || projects[0].status === "archived")
          throw new EngineError(
            "conflict",
            "Restore the project before running work.",
          );
      }
      const dependencies = await tx.$queryRaw<
        { agencyId: string | null; status: string | null }[]
      >`SELECT p."agencyId",p."status" FROM "TaskDependency" d LEFT JOIN "Task" p ON p."id"=d."predecessorId" WHERE d."taskId"=${taskId}`;
      if (dependencies.some((row) => row.agencyId !== scope.agencyId))
        throw new EngineError(
          "forbidden_or_missing",
          "Dependency unavailable.",
        );
      return {
        taskId: task.id,
        projectId: task.projectId,
        version: task.version,
        status: task.status,
        dependenciesDone: dependencies.every((row) => row.status === "done"),
      };
    },
    async facts(tx, scope, facts) {
      await owned(tx, scope);
      for (const fact of facts) {
        const rows = await tx.$queryRaw<
          {
            id: string;
            agencyId: string;
            version: number;
            value: unknown;
            provenance: unknown;
          }[]
        >`SELECT "id","agencyId","version","value","provenance" FROM "EvidenceItem" WHERE "id"=${fact.id} AND "agencyId"=${scope.agencyId}`;
        const row = rows[0];
        if (!row)
          throw new EngineError(
            "forbidden_or_missing",
            "Evidence unavailable.",
          );
        if (row.version !== (fact.sourceVersion ?? 1))
          throw new EngineError(
            "conflict",
            "Evidence changed. Refresh the pitch inputs.",
          );
        const value = json(row.value),
          provenance = json(row.provenance);
        const parsed = factSchema.safeParse(
          typeof value === "object" && value !== null && "pitchFact" in value
            ? value.pitchFact
            : null,
        );
        if (!parsed.success)
          throw new EngineError(
            "invalid_input",
            "This evidence has no typed pitch fact. Save a referenced fact before drafting.",
          );
        const normalized = (item: EvidenceFact) => ({
          ...item,
          sourceVersion: item.sourceVersion ?? 1,
        });
        if (
          fingerprint(normalized(parsed.data)) !== fingerprint(normalized(fact))
        )
          throw new EngineError(
            "invalid_input",
            "Pitch facts must match saved evidence exactly.",
          );
        if (
          typeof provenance !== "object" ||
          provenance === null ||
          !("origin" in provenance) ||
          provenance.origin !== fact.origin ||
          !("asOf" in provenance) ||
          utcDate(provenance.asOf) !== fact.asOf ||
          !("reviewStatus" in provenance) ||
          provenance.reviewStatus !== fact.reviewStatus ||
          !("sourceReference" in provenance) ||
          provenance.sourceReference !== fact.sourceRef ||
          (fact.reviewStatus === "externally_reviewed" &&
            (!("reviewer" in provenance) ||
              !provenance.reviewer ||
              !("reviewedAt" in provenance) ||
              !provenance.reviewedAt ||
              !("reviewReference" in provenance) ||
              !provenance.reviewReference))
        )
          throw new EngineError(
            "invalid_input",
            "Evidence provenance does not match the saved fact.",
          );
      }
    },
  };
}

/** Repository-owned approval facts for Remy's loader; superseded artifacts are never current. */
export async function loadEngineArtifactFacts(
  tx: Prisma.TransactionClient,
  scope: Scope,
) {
  await owned(tx, scope);
  const rows = await tx.$queryRaw<
    { payload: string }[]
  >`SELECT "payload" FROM "AgencyEngineState" WHERE "id"=${scope.userId} AND "agencyId"=${scope.agencyId}`;
  if (!rows[0] || rows[0].payload === "{}") return [];
  const state = stateSchema.parse(JSON.parse(rows[0].payload));
  return state.artifacts.flatMap((artifact) => {
    if (artifact.agencyId !== scope.agencyId || artifact.status === "cancelled")
      return [];
    return [
      {
        id: artifact.id,
        agencyId: artifact.agencyId,
        taskId: artifact.taskId,
        runId: artifact.runId,
        status: artifact.status,
        reviewedByUserId: artifact.reviewedByUserId,
        reviewedAt: artifact.reviewedAt,
        current:
          !state.artifacts.some(
            (next) => next.previousRevisionId === artifact.id,
          ) &&
          !state.runs.some((next) => next.previousArtifactId === artifact.id),
      },
    ];
  });
}
