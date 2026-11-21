import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  AutomationError,
  type AutomationState,
  type OwnedContext,
  type Task,
  taskStatusSchema,
} from "./contracts";
import { checkedInstant, type Clock } from "./clock";
import type { AutomationBridge } from "./prisma-repository";

type CoreTask = {
  id: string;
  agencyId: string;
  projectId: string | null;
  title: string;
  input: string;
  assignedRoleKey: string | null;
  status: string;
  dueAt: Date | string | number | null;
  originalCommittedDueAt: Date | string | number | null;
  version: number;
};
type Dependency = { taskId: string; predecessorId: string };
export type AutomationEvidenceLoader = (
  tx: Prisma.TransactionClient,
  userId: string,
  agencyId: string,
) => Promise<
  Pick<OwnedContext, "artifacts" | "recordedDeliveryProjectIds" | "growth">
>;
const iso = (value: CoreTask["dueAt"]) =>
  value === null
    ? null
    : checkedInstant(
        typeof value === "number" ? new Date(value) : value,
      ).toISOString();
function conflict(message: string): never {
  throw new AutomationError("conflict", message);
}
function sameDependencies(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

// Concrete Task/TaskDependency projection for Kuba's agreed core schema. Evidence
// meaning stays in the loader: this module never treats generated text as facts.
export function createCoreAutomationBridge(
  loadEvidence: AutomationEvidenceLoader,
  clock: Clock,
): AutomationBridge {
  return {
    async loadContext(tx, userId, agencyId) {
      const agency = await tx.agency.findFirst({
        where: { id: agencyId, ownerId: userId },
        select: { id: true },
      });
      if (!agency)
        throw new AutomationError(
          "forbidden_or_missing",
          "Workspace is unavailable.",
        );
      const projects = await tx.$queryRaw<
        { id: string; archivedAt: unknown; status: string }[]
      >`SELECT "id","archivedAt","status" FROM "Project" WHERE "agencyId"=${agencyId}`;
      const closeouts = await tx.$queryRaw<
        { projectId: string }[]
      >`SELECT "projectId" FROM "ProjectCloseout" WHERE "agencyId"=${agencyId}`;
      const evidence = await loadEvidence(tx, userId, agencyId);
      return {
        ...evidence,
        ownerId: userId,
        agencyId,
        projectIds: projects.map((p) => p.id),
        workflowProjectIds: projects
          .filter((p) => p.archivedAt === null && p.status !== "archived")
          .map((p) => p.id),
        closeoutProjectIds: closeouts.map((c) => c.projectId),
      };
    },
    async hydrateTasks(tx, state) {
      const rows = await tx.$queryRaw<
        CoreTask[]
      >`SELECT "id","agencyId","projectId","title","input","assignedRoleKey","status","dueAt","originalCommittedDueAt","version" FROM "Task" WHERE "agencyId"=${state.agencyId}`;
      const dependencies = await tx.$queryRaw<
        Dependency[]
      >`SELECT d."taskId",d."predecessorId" FROM "TaskDependency" d JOIN "Task" t ON t."id"=d."taskId" WHERE t."agencyId"=${state.agencyId}`;
      // Never silently repair conflicting edits. All lifecycle writes for these
      // tasks must call the engine event bridge or automation command service.
      for (const task of state.tasks) {
        const row = rows.find((r) => r.id === task.id);
        if (
          !row ||
          row.version !== task.version ||
          row.projectId !== task.projectId ||
          row.status !== task.status ||
          row.title !== task.title ||
          row.input !== task.input ||
          row.assignedRoleKey !== task.roleKey ||
          iso(row.dueAt) !==
            (task.dueAt ? checkedInstant(task.dueAt).toISOString() : null) ||
          iso(row.originalCommittedDueAt) !==
            (task.originalCommittedDueAt
              ? checkedInstant(task.originalCommittedDueAt).toISOString()
              : null) ||
          !sameDependencies(
            task.dependencies,
            dependencies
              .filter((d) => d.taskId === task.id)
              .map((d) => d.predecessorId),
          )
        )
          conflict(
            "Core task changed outside its workflow. Reload and reconcile the workflow before retrying.",
          );
        taskStatusSchema.parse(row.status);
      }
      return state;
    },
    async syncTasks(tx, userId, previous, next) {
      const agency = await tx.agency.findFirst({
        where: { id: next.agencyId, ownerId: userId },
        select: { id: true },
      });
      if (!agency)
        throw new AutomationError(
          "forbidden_or_missing",
          "Workspace is unavailable.",
        );
      const evidence = await loadEvidence(tx, userId, next.agencyId);
      const at = checkedInstant(clock());
      for (const task of next.tasks) {
        const prior = previous?.tasks.find((t) => t.id === task.id);
        if (prior && JSON.stringify(prior) === JSON.stringify(task)) continue;
        if (task.projectId) {
          const project = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "Project" WHERE "id"=${task.projectId} AND "agencyId"=${next.agencyId}`;
          if (!project.length)
            throw new AutomationError(
              "forbidden_or_missing",
              "Task project is unavailable.",
            );
        }
        const approved = evidence.artifacts.find(
          (a) =>
            a.id === task.artifactId &&
            a.current &&
            a.status === "approved" &&
            a.reviewedByUserId === userId &&
            a.reviewedAt,
        );
        const approvedJson = approved
          ? JSON.stringify({ ...approved, artifactId: approved.id })
          : null;
        const cancellation =
          task.status === "cancelled"
            ? JSON.stringify(task.history.at(-1))
            : null;
        const acceptedAt =
          task.status === "done"
            ? checkedInstant(task.history.at(-1)!.at)
            : null;
        const historyJson = JSON.stringify(task.dueDateRevisions);
        if (prior) {
          const count =
            await tx.$executeRaw`UPDATE "Task" SET "title"=${task.title},"input"=${task.input},"assignedRoleKey"=${task.roleKey},"status"=${task.status},"dueAt"=${task.dueAt ? checkedInstant(task.dueAt) : null},"originalCommittedDueAt"=${task.originalCommittedDueAt ? checkedInstant(task.originalCommittedDueAt) : null},"dueDateHistory"=${historyJson},"acceptedAt"=${acceptedAt},"cancellationRecord"=${cancellation},"approvedArtifact"=${approvedJson},"reviewNeeded"=${task.kind === "work" || task.kind === "human_review"},"version"=${task.version},"updatedAt"=${at} WHERE "id"=${task.id} AND "agencyId"=${next.agencyId} AND "version"=${prior.version}`;
          if (count !== 1)
            conflict("Core task version changed. Reload before retrying.");
        } else {
          const existing = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "Task" WHERE "id"=${task.id}`;
          if (existing.length) conflict("Task identifier is already in use.");
          await tx.$executeRaw`INSERT INTO "Task" ("id","agencyId","projectId","title","input","assignedRoleKey","status","priority","dueAt","originalCommittedDueAt","dueDateHistory","acceptedAt","cancellationRecord","approvedArtifact","reviewNeeded","version","createdAt","updatedAt") VALUES (${task.id},${next.agencyId},${task.projectId},${task.title},${task.input},${task.roleKey},${task.status},'normal',${task.dueAt ? checkedInstant(task.dueAt) : null},${task.originalCommittedDueAt ? checkedInstant(task.originalCommittedDueAt) : null},${historyJson},${acceptedAt},${cancellation},${approvedJson},${task.kind === "work" || task.kind === "human_review"},${task.version},${at},${at})`;
        }
      }
      // All task rows exist before edges are inserted; predecessor authorization
      // is repeated here even though the pure engine validates its own graph.
      for (const task of next.tasks) {
        const prior = previous?.tasks.find((t) => t.id === task.id);
        if (prior && sameDependencies(prior.dependencies, task.dependencies))
          continue;
        await tx.$executeRaw`DELETE FROM "TaskDependency" WHERE "taskId"=${task.id}`;
        for (const predecessorId of task.dependencies) {
          const parent = await tx.$queryRaw<
            { id: string; projectId: string | null }[]
          >`SELECT "id","projectId" FROM "Task" WHERE "id"=${predecessorId} AND "agencyId"=${next.agencyId}`;
          if (!parent.length || parent[0].projectId !== task.projectId)
            throw new AutomationError(
              "forbidden_or_missing",
              "Predecessor is unavailable in this project.",
            );
          await tx.$executeRaw`INSERT INTO "TaskDependency" ("taskId","predecessorId") VALUES (${task.id},${predecessorId})`;
        }
      }
    },
  };
}
// For core/UI routing: automation-owned tasks must be mutated through this
// service, preserving the exact expected task version and human-review gates.
export function isAutomationTask(
  state: AutomationState,
  taskId: string,
): Task | undefined {
  return state.tasks.find((task) => task.id === taskId);
}
