import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { EvidenceFact } from "@/lib/ai/contracts";
import {
  emptyState,
  EngineError,
  stateSchema,
  type CrewRun,
  type EngineRepository,
  type EngineState,
  type Scope,
  type TaskGate,
} from "./contracts";

export interface EngineBridge {
  task(
    tx: Prisma.TransactionClient,
    scope: Scope,
    taskId: string,
    projectId: string | null,
  ): Promise<TaskGate>;
  lifecycle(
    tx: Prisma.TransactionClient,
    scope: Scope,
    event: RunLifecycleEvent,
  ): Promise<{ taskVersion: number }>;
  facts(
    tx: Prisma.TransactionClient,
    scope: Scope,
    facts: EvidenceFact[],
  ): Promise<void>;
}
export type RunLifecycleEvent = {
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
function lifecycleEvents(
  before: EngineState,
  after: EngineState,
): { run: CrewRun; event: RunLifecycleEvent }[] {
  return after.runs.flatMap((run) => {
    const old = before.runs.find((row) => row.id === run.id);
    if (old?.status === run.status && old.attempt === run.attempt) return [];
    if (
      run.status === "cancelled" &&
      after.runs.some((next) => next.previousRunId === run.id)
    )
      return [];
    const status =
      !old && run.previousRunId
        ? "revision_requested"
        : old?.status === "failed" && run.status === "queued"
          ? "retry"
          : run.status === "completed"
            ? "approved"
            : run.status;
    return [
      {
        run,
        event: {
          taskId: run.taskId,
          expectedTaskVersion: run.taskVersion,
          eventKey: `engine:${run.id}:${run.version}:${status}`,
          runId: run.id,
          ...(run.artifactId ? { artifactId: run.artifactId } : {}),
          status,
        },
      },
    ];
  });
}
type Row = {
  id: string;
  agencyId: string | null;
  version: number;
  payload: string;
};
async function authorize(tx: Prisma.TransactionClient, scope: Scope) {
  if (
    !scope.userId ||
    !(await tx.user.findUnique({
      where: { id: scope.userId },
      select: { id: true },
    }))
  )
    throw new EngineError("unauthenticated", "Sign in to continue.");
  if (
    scope.agencyId &&
    !(await tx.agency.findFirst({
      where: { id: scope.agencyId, ownerId: scope.userId },
      select: { id: true },
    }))
  )
    throw new EngineError(
      "forbidden_or_missing",
      "This workspace is unavailable.",
    );
}
async function load(tx: Prisma.TransactionClient, scope: Scope) {
  await authorize(tx, scope);
  // Fixed table/column names; tagged parameters prevent IDs or payloads becoming SQL.
  const rows = await tx.$queryRaw<
    Row[]
  >`SELECT "id", "agencyId", "version", "payload" FROM "AgencyEngineState" WHERE "id" = ${scope.userId}`;
  const row = rows[0];
  if (row?.agencyId && scope.agencyId && row.agencyId !== scope.agencyId)
    throw new EngineError(
      "forbidden_or_missing",
      "This workspace is unavailable.",
    );
  const state =
    row && row.payload !== "{}"
      ? stateSchema.parse(JSON.parse(row.payload))
      : emptyState();
  return { row, state };
}

/** Kuba owns the table migration. Missing storage fails closed, never falls back to fixtures. */
export function createPrismaEngineRepository(
  db: PrismaClient,
  bridge: EngineBridge,
): EngineRepository {
  return {
    read: (scope) =>
      db.$transaction(async (tx) =>
        structuredClone((await load(tx, scope)).state),
      ),
    async transact(scope, work) {
      try {
        return await db.$transaction(async (tx) => {
          const loaded = await load(tx, scope),
            state = loaded.state,
            before = structuredClone(state);
          let row = loaded.row;
          const result = await work({
            state,
            task: (id, projectId) => bridge.task(tx, scope, id, projectId),
            approved: async (artifact) => {
              if (
                artifact.status !== "approved" ||
                artifact.reviewedByUserId !== scope.userId ||
                !artifact.reviewedAt
              )
                throw new EngineError(
                  "conflict",
                  "Explicit owner approval is required.",
                );
            },
            facts: (facts) => bridge.facts(tx, scope, facts),
          });
          const persist = async () => {
            const payload = JSON.stringify(stateSchema.parse(state)),
              stamp = new Date();
            if (row) {
              const count =
                await tx.$executeRaw`UPDATE "AgencyEngineState" SET "payload"=${payload}, "version"="version"+1, "agencyId"=${scope.agencyId ?? row.agencyId}, "updatedAt"=${stamp} WHERE "id"=${scope.userId} AND "version"=${row.version}`;
              if (count !== 1)
                throw new EngineError(
                  "conflict",
                  "Workspace changed. Reload and retry.",
                );
              row = { ...row, version: row.version + 1, payload };
            } else {
              await tx.$executeRaw`INSERT INTO "AgencyEngineState" ("id","agencyId","version","payload","updatedAt") VALUES (${scope.userId},${scope.agencyId ?? null},1,${payload},${stamp})`;
              row = {
                id: scope.userId,
                agencyId: scope.agencyId ?? null,
                version: 1,
                payload,
              };
            }
          };
          const events = lifecycleEvents(before, state);
          await persist();
          for (const { run, event } of events) {
            const result = await bridge.lifecycle(tx, scope, event);
            if (
              !Number.isSafeInteger(result.taskVersion) ||
              result.taskVersion < run.taskVersion
            )
              throw new EngineError(
                "conflict",
                "Invalid task projection version.",
              );
            run.taskVersion = result.taskVersion;
          }
          if (events.length) await persist();
          return structuredClone(result);
        });
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;
        if (code === "P2002" || code === "P2034" || code === "P1008")
          throw new EngineError(
            "conflict",
            "Workspace changed. Reload and retry.",
          );
        throw error;
      }
    },
  };
}

/** Tests and UI preview only. Callers must opt in and label the fixture explicitly. */
export class FixtureEngineRepository implements EngineRepository {
  readonly fixture = true;
  private state: EngineState;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private ownerId: string,
    private agencyId: string,
    initial = emptyState(),
    private gates: Record<string, TaskGate> = {},
  ) {
    this.state = structuredClone(initial);
  }
  private authorize(scope: Scope) {
    if (
      scope.userId !== this.ownerId ||
      (scope.agencyId && scope.agencyId !== this.agencyId)
    )
      throw new EngineError(
        "forbidden_or_missing",
        "This fixture is unavailable.",
      );
  }
  async read(scope: Scope) {
    this.authorize(scope);
    return structuredClone(this.state);
  }
  async transact<T>(
    scope: Scope,
    work: Parameters<EngineRepository["transact"]>[1],
  ): Promise<T> {
    this.authorize(scope);
    const operation = this.tail.then(async () => {
      const state = structuredClone(this.state);
      const result = await work({
        state,
        task: async (id, projectId) => {
          const gate = this.gates[id];
          if (!gate || gate.projectId !== projectId)
            throw new EngineError("forbidden_or_missing", "Task unavailable.");
          return structuredClone(gate);
        },
        approved: async () => {},
        facts: async (facts) => {
          if (facts.some((fact) => fact.origin !== "sample"))
            throw new EngineError(
              "invalid_input",
              "Fixture accepts sample evidence only.",
            );
        },
      });
      this.state = stateSchema.parse(state);
      return structuredClone(result) as T;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
