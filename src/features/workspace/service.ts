import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { automationStateSchema } from "../automation/state-schema";
import { factSchema } from "@/lib/ai/contracts";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  actualSchema,
  agencyContentSchema,
  packageSchema,
  checklistCategories,
  commandSchemas,
  DomainError,
  provenanceSchema,
  type WorkspaceCommand,
} from "./contracts";
import { total } from "../finance/decimal";

export type Transaction = Prisma.TransactionClient;
import { json } from "./json";
export { json } from "./json";
function missing(): never {
  throw new DomainError("forbidden_or_missing", "This record is unavailable.");
}
const conflict = (current: unknown): never => {
  throw new DomainError(
    "conflict",
    "This record changed. Reload and retry your edit.",
    current,
  );
};
function expected(current: { version: number } | null, v: number | null) {
  if (current ? current.version !== v : v !== null) conflict(current);
}
const date = (v: string | null) => (v ? new Date(v) : null);
export async function requireOwnedAgency(
  tx: Transaction,
  userId: string,
  agencyId?: string,
) {
  if (
    !userId ||
    !(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))
  )
    throw new DomainError("unauthenticated", "Sign in to continue.");
  const agency = await tx.agency.findUnique({ where: { ownerId: userId } });
  if (!agency || (agencyId && agency.id !== agencyId)) missing();
  return agency;
}
async function ownedUser(tx: Transaction, userId: string) {
  if (
    !userId ||
    !(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))
  )
    throw new DomainError("unauthenticated", "Sign in to continue.");
}
async function scoped<T extends { agencyId: string }>(
  row: T | null,
  agencyId: string,
): Promise<T> {
  if (!row || row.agencyId !== agencyId) missing();
  return row;
}
export function validateProvenance(
  raw: unknown,
  now: Date,
  previous?: unknown,
) {
  const p = provenanceSchema.parse(raw);
  if (new Date(p.asOf) > now || (p.reviewedAt && new Date(p.reviewedAt) > now))
    throw new DomainError(
      "invalid_input",
      "Evidence dates cannot be in the future.",
    );
  if (previous && provenanceSchema.parse(previous).origin !== p.origin)
    throw new DomainError(
      "invalid_input",
      "Origin is preserved on revisions; create a separate source record.",
    );
  return p;
}
async function event(
  tx: Transaction,
  agencyId: string,
  userId: string,
  kind: string,
  subjectId: string,
  metadata: unknown = {},
) {
  await tx.activityEvent.create({
    data: {
      agencyId,
      actorUserId: userId,
      kind,
      subjectId,
      correlationKey: randomUUID(),
      metadata: json(metadata),
    },
  });
}
async function projectReferences(
  tx: Transaction,
  agencyId: string,
  clientId: string | null,
  packageId: string | null,
  old?: { clientId: string | null; packageId: string | null },
) {
  if (clientId) {
    const c = await scoped(
      await tx.client.findUnique({ where: { id: clientId } }),
      agencyId,
    );
    if (c.archivedAt && old?.clientId !== clientId)
      throw new DomainError(
        "invalid_input",
        "Choose an active client for new work.",
      );
  }
  if (packageId) {
    const p = await scoped(
      await tx.servicePackage.findUnique({ where: { id: packageId } }),
      agencyId,
    );
    if (p.archivedAt && old?.packageId !== packageId)
      throw new DomainError(
        "invalid_input",
        "Choose an active offer for new work.",
      );
  }
}
async function taskReferences(
  tx: Transaction,
  agencyId: string,
  taskId: string,
  input: {
    projectId: string | null;
    assignedRoleKey: string | null;
    predecessorIds: string[];
  },
) {
  if (input.projectId) {
    const p = await scoped(
      await tx.project.findUnique({ where: { id: input.projectId } }),
      agencyId,
    );
    if (p.archivedAt)
      throw new DomainError(
        "invalid_input",
        "Archived projects cannot receive task changes.",
      );
  }
  if (input.assignedRoleKey) {
    const agency = await tx.agency.findUniqueOrThrow({
      where: { id: agencyId },
    });
    const data = agency.rolesAndWorkflows as { roles?: { key: string }[] };
    if (!data.roles?.some((r) => r.key === input.assignedRoleKey))
      throw new DomainError(
        "invalid_input",
        "Choose an agency crew role or yourself.",
      );
  }
  if (new Set(input.predecessorIds).size !== input.predecessorIds.length)
    throw new DomainError("invalid_input", "Duplicate dependencies.");
  const all = await tx.task.findMany({
      where: { agencyId },
      include: { predecessors: true },
    }),
    graph = new Map(
      all.map((t) => [t.id, t.predecessors.map((p) => p.predecessorId)]),
    );
  graph.set(taskId, input.predecessorIds);
  for (const predecessorId of input.predecessorIds) {
    const predecessor = all.find((t) => t.id === predecessorId);
    if (!predecessor) missing();
    if (predecessor.projectId !== input.projectId)
      throw new DomainError(
        "invalid_input",
        "Dependencies must share a project or both be workspace tasks.",
      );
  }
  const active = new Set<string>(),
    done = new Set<string>();
  function walk(node: string) {
    if (active.has(node))
      throw new DomainError(
        "invalid_input",
        "Task dependencies cannot contain cycles.",
      );
    if (done.has(node)) return;
    active.add(node);
    for (const p of graph.get(node) ?? []) walk(p);
    active.delete(node);
    done.add(node);
  }
  walk(taskId);
}
async function automationOwns(
  tx: Transaction,
  agencyId: string,
  taskId: string,
) {
  const row = await tx.automationState.findUnique({ where: { agencyId } });
  if (row) {
    let state: unknown;
    try {
      state = JSON.parse(row.stateJson);
    } catch {
      throw new DomainError("conflict", "Automation state needs recovery.");
    }
    const tasks = (state as { tasks?: { id: string }[] }).tasks;
    if (tasks?.some((t) => t.id === taskId))
      throw new DomainError(
        "conflict",
        "Use the workflow action for this task so its history stays synchronized.",
      );
  }
}
function mentions(value: unknown, id: string): boolean {
  return value === id
    ? true
    : Array.isArray(value)
      ? value.some((v) => mentions(v, id))
      : value && typeof value === "object"
        ? Object.values(value).some((v) => mentions(v, id))
        : false;
}
async function preserveActualRevision(
  tx: Transaction,
  row: {
    id: string;
    agencyId: string;
    version: number;
    data: Prisma.JsonValue;
    provenance: Prisma.JsonValue;
  },
  now: Date,
) {
  const id = `${row.id}-v${row.version}`;
  if (await tx.financeSnapshot.findUnique({ where: { id } })) return;
  const p = provenanceSchema.parse(row.provenance);
  await tx.financeSnapshot.create({
    data: {
      id,
      agencyId: row.agencyId,
      kind: "actual_revision",
      formulaVersion: "actual-cents-v1",
      asOf: new Date(p.asOf),
      evaluatedAt: now,
      input: json({ actualId: row.id, version: row.version, data: row.data }),
      output: json({ data: row.data }),
      provenance: json(p),
    },
  });
}
async function recalculateCloseoutPeriod(
  tx: Transaction,
  agencyId: string,
  period: string,
  now: Date,
) {
  const actual = await tx.financialActualPeriod.findUnique({
    where: { agencyId_yearMonth: { agencyId, yearMonth: period } },
  });
  if (actual) await preserveActualRevision(tx, actual, now);
  if (actual?.sourceMode === "manual")
    throw new DomainError(
      "conflict",
      "This month has a manual total. Choose project-derived actuals before changing project evidence.",
      actual,
    );
  const start = new Date(`${period}-01T00:00:00Z`),
    end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
  const rows = await tx.projectCloseout.findMany({
    where: { agencyId, deliveryDate: { gte: start, lt: end } },
  });
  if (!rows.length) {
    if (actual)
      await tx.financialActualPeriod.delete({ where: { id: actual.id } });
    return;
  }
  const origins = new Set(
    rows.map((r) => provenanceSchema.parse(r.provenance).origin),
  );
  if (
    (origins.has("sample") && origins.has("user_entered")) ||
    origins.has("assumption")
  )
    throw new DomainError(
      "invalid_input",
      "Project actuals cannot mix sample, real or assumed evidence.",
    );
  const sum = (
    key: "recognizedRevenueMinor" | "receiptsMinor" | "deliveryCostMinor",
  ) =>
    rows.some((r) => r[key] === null)
      ? null
      : total(rows.map((r) => r[key]!)).toNumber();
  const p = provenanceSchema.parse(rows[0].provenance);
  const data = actualSchema.parse({
    yearMonth: period,
    currency: "USD",
    sourceMode: "derived",
    recognizedRevenueMinor: sum("recognizedRevenueMinor"),
    cashReceiptsMinor: sum("receiptsMinor"),
    deliveryCostsMinor: sum("deliveryCostMinor"),
    overheadMinor: null,
    founderPayMinor: null,
    cashTaxPaymentsMinor: null,
    cashInterestPaymentsMinor: null,
    cashMinor: null,
    receivablesMinor: null,
    capexMinor: null,
    principalPaymentsMinor: null,
    financingMinor: null,
    ownerContributionsMinor: null,
    ownerDistributionsMinor: null,
    provenance: {
      ...p,
      asOf: now.toISOString(),
      sourceReference: `Project closeout ledger ${period}`,
      reviewStatus: "owner_attested",
    },
  });
  const saved = await tx.financialActualPeriod.upsert({
    where: { agencyId_yearMonth: { agencyId, yearMonth: period } },
    create: {
      agencyId,
      yearMonth: period,
      sourceMode: "derived",
      data: json(data),
      provenance: json(data.provenance),
    },
    update: {
      data: json(data),
      provenance: json(data.provenance),
      version: { increment: 1 },
    },
  });
  await preserveActualRevision(tx, saved, now);
}
export function createWorkspaceService(
  db: PrismaClient,
  userId: string,
  clock: () => Date = () => new Date(),
) {
  return {
    async readWorkspace() {
      return db.$transaction(async (tx) => {
        await ownedUser(tx, userId);
        const onboarding = await tx.onboardingDraft.findUnique({
            where: { userId },
          }),
          agency = await tx.agency.findUnique({ where: { ownerId: userId } }),
          drafts = await tx.agencyDraft.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
          });
        if (!agency)
          return {
            agency: null,
            onboarding,
            drafts,
            packages: [],
            clients: [],
            projects: [],
            tasks: [],
            actuals: [],
            evidence: [],
            snapshots: [],
            checklist: [],
            exports: [],
            home: {
              activeProjects: 0,
              awaitingReview: 0,
              completedProjects: 0,
              taskCount: 0,
              nextActions: [
                {
                  label: "Describe your creative practice",
                  href: "/app/onboarding",
                },
              ],
            },
          };
        const where = { agencyId: agency.id };
        const [
          packages,
          clients,
          projects,
          tasks,
          actuals,
          evidence,
          snapshots,
          checklist,
          exports,
        ] = await Promise.all([
          tx.servicePackage.findMany({ where, orderBy: { createdAt: "asc" } }),
          tx.client.findMany({
            where,
            include: {
              projects: { select: { id: true, title: true, status: true } },
            },
            orderBy: { name: "asc" },
          }),
          tx.project.findMany({
            where,
            include: { closeout: true },
            orderBy: { createdAt: "desc" },
          }),
          tx.task.findMany({
            where,
            include: { predecessors: true },
            orderBy: { createdAt: "asc" },
          }),
          tx.financialActualPeriod.findMany({
            where,
            orderBy: { yearMonth: "asc" },
          }),
          tx.evidenceItem.findMany({ where }),
          tx.financeSnapshot.findMany({
            where,
            orderBy: { createdAt: "desc" },
          }),
          tx.dataRoomItem.findMany({ where }),
          tx.exportSnapshot.findMany({
            where,
            select: { id: true, createdAt: true, manifest: true },
            orderBy: { createdAt: "desc" },
          }),
        ]);
        const activeProjects = projects.filter(
            (p) => !p.archivedAt && ["active", "review"].includes(p.status),
          ).length,
          awaitingReview = tasks.filter(
            (t) => t.status === "awaiting_review",
          ).length,
          completedProjects = projects.filter(
            (p) => p.status === "completed",
          ).length;
        return {
          agency,
          onboarding,
          drafts,
          packages,
          clients,
          projects,
          tasks,
          actuals,
          evidence,
          snapshots,
          checklist,
          exports,
          home: {
            activeProjects,
            awaitingReview,
            completedProjects,
            taskCount: tasks.length,
            nextActions: [
              ...(packages.length
                ? []
                : [{ label: "Define your first offer", href: "/app/agency" }]),
              {
                label: `${activeProjects} active projects`,
                href: "/app/projects?status=active",
              },
              {
                label: `${awaitingReview} awaiting review`,
                href: "/app/crew?status=awaiting_review",
              },
              {
                label: `${completedProjects} completed projects`,
                href: "/app/projects?status=completed",
              },
            ],
          },
        };
      });
    },
    async command(
      command: WorkspaceCommand | { type: string; input: unknown },
    ) {
      if (!(command.type in commandSchemas))
        throw new DomainError("invalid_input", "Unknown workspace command.");
      return db.$transaction(async (tx) => {
        await ownedUser(tx, userId);
        const now = clock();
        switch (command.type) {
          case "onboarding.save": {
            const { data, expectedVersion } = commandSchemas[
                command.type
              ].parse(command.input),
              current = await tx.onboardingDraft.findUnique({
                where: { userId },
              });
            expected(current, expectedVersion);
            return tx.onboardingDraft.upsert({
              where: { userId },
              create: { userId, data: json(data) },
              update: { data: json(data), version: { increment: 1 } },
            });
          }
          case "draft.save": {
            const v = commandSchemas[command.type].parse(command.input),
              onboarding = await tx.onboardingDraft.findUnique({
                where: { userId },
              });
            if (onboarding?.version !== v.onboardingVersion)
              conflict(onboarding);
            return tx.agencyDraft.create({
              data: {
                userId,
                onboardingVersion: v.onboardingVersion,
                content: json(v.content),
                providerVersion: v.providerVersion,
                templateVersion: v.templateVersion,
                inputHash: v.inputHash,
              },
            });
          }
          case "draft.edit": {
            const v = commandSchemas[command.type].parse(command.input),
              draft = await tx.agencyDraft.findFirst({
                where: { id: v.id, userId },
              });
            if (!draft) missing();
            expected(draft, v.expectedVersion);
            if (draft.status === "accepted")
              throw new DomainError(
                "conflict",
                "Accepted drafts are immutable. Generate another version.",
              );
            return tx.agencyDraft.update({
              where: { id: draft.id, version: v.expectedVersion },
              data: { content: json(v.content), version: { increment: 1 } },
            });
          }
          case "agency.accept": {
            const v = commandSchemas[command.type].parse(command.input),
              existing = await tx.agency.findUnique({
                where: { ownerId: userId },
              });
            if (existing) {
              if (
                existing.acceptedDraftId === v.draftId &&
                existing.acceptanceKey === v.idempotencyKey
              )
                return existing;
              throw new DomainError(
                "conflict",
                "An agency already exists; update it without replacing operational records.",
              );
            }
            let draft = await tx.agencyDraft.findFirst({
              where: { id: v.draftId, userId },
            });
            if (!draft) {
              const engine = await tx.agencyEngineState.findUnique({
                where: { id: userId },
              });
              const payload = engine
                ? (JSON.parse(engine.payload) as {
                    drafts?: {
                      id: string;
                      status: string;
                      version: number;
                      content: unknown;
                      inputHash: string;
                    }[];
                  })
                : null;
              const generated = payload?.drafts?.find(
                (d) => d.id === v.draftId,
              );
              if (!generated || generated.status !== "generated") missing();
              expected(generated, v.expectedVersion);
              const source = agencyContentSchema.parse(generated.content),
                onboarding = await tx.onboardingDraft.findUnique({
                  where: { userId },
                });
              draft = await tx.agencyDraft.create({
                data: {
                  id: generated.id,
                  userId,
                  onboardingVersion: onboarding?.version ?? 1,
                  content: json(source),
                  providerVersion: source.meta.providerVersion,
                  templateVersion: source.meta.templateVersion,
                  inputHash: generated.inputHash,
                  version: generated.version,
                },
              });
            }
            expected(draft, v.expectedVersion);
            const content = agencyContentSchema.parse(draft.content),
              onboarding = await tx.onboardingDraft.findUnique({
                where: { userId },
              }),
              settings = onboarding
                ? commandSchemas["onboarding.save"].shape.data.parse(
                    onboarding.data,
                  )
                : null;
            const agency = await tx.agency.create({
              data: {
                ownerId: userId,
                name: content.name,
                description: content.positioning,
                positioning: content.positioning,
                buyer: content.buyer,
                practices: json(content.practices),
                goal: content.goal,
                weeklyCapacityHours: content.weeklyCapacityHours,
                currency: "USD",
                timezone: settings?.timezone ?? "UTC",
                acceptedDraftId: draft.id,
                acceptanceKey: v.idempotencyKey,
                rolesAndWorkflows: json({
                  roles: content.roles,
                  workflows: content.workflows,
                }),
              },
            });
            for (const p of content.packages) {
              const { key, ...offer } = p;
              const data = packageSchema.parse(offer);
              await tx.servicePackage.create({
                data: {
                  ...data,
                  agencyId: agency.id,
                  deliverables: json(data.deliverables),
                  exclusions: json(data.exclusions),
                  pricingBasis: json({
                    ...data.pricingBasis,
                    templateKey: key,
                  }),
                  sopCreatedAt: date(data.sopCreatedAt),
                  acceptanceChecklist: json(data.acceptanceChecklist),
                },
              });
            }
            await tx.agencyDraft.update({
              where: { id: draft.id, version: v.expectedVersion },
              data: {
                status: "accepted",
                acceptedAt: now,
                version: { increment: 1 },
              },
            });
            await tx.agencyEngineState.updateMany({
              where: { id: userId, agencyId: null },
              data: { agencyId: agency.id, version: { increment: 1 } },
            });
            for (const category of checklistCategories)
              await tx.dataRoomItem.create({
                data: {
                  agencyId: agency.id,
                  category,
                  title: category.replaceAll("_", " "),
                  state: "missing",
                  note: "",
                  evidenceIds: [],
                  ownerLabel: "Agency owner",
                },
              });
            await event(tx, agency.id, userId, "agency.accepted", agency.id, {
              draftId: draft.id,
            });
            return agency;
          }
        }
        const agency = await requireOwnedAgency(tx, userId),
          agencyId = agency.id;
        switch (command.type) {
          case "agency.update": {
            const v = commandSchemas[command.type].parse(command.input);
            if (v.id !== agencyId) missing();
            expected(agency, v.expectedVersion);
            return tx.agency.update({
              where: { id: agencyId, version: v.expectedVersion },
              data: {
                name: v.name,
                positioning: v.positioning,
                buyer: v.buyer,
                goal: v.goal,
                version: { increment: 1 },
              },
            });
          }
          case "package.create": {
            const data = commandSchemas[command.type].parse(command.input);
            return tx.servicePackage.create({
              data: {
                ...data,
                agencyId,
                deliverables: json(data.deliverables),
                exclusions: json(data.exclusions),
                acceptanceChecklist: json(data.acceptanceChecklist),
                pricingBasis: json(data.pricingBasis),
                sopCreatedAt: date(data.sopCreatedAt),
              },
            });
          }
          case "package.update": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.servicePackage.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            const data = v.data;
            return tx.servicePackage.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                ...data,
                deliverables: json(data.deliverables),
                exclusions: json(data.exclusions),
                acceptanceChecklist: json(data.acceptanceChecklist),
                pricingBasis: json(data.pricingBasis),
                sopCreatedAt: date(data.sopCreatedAt),
                version: { increment: 1 },
              },
            });
          }
          case "package.archive": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.servicePackage.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            return tx.servicePackage.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                archivedAt: v.archived ? now : null,
                version: { increment: 1 },
              },
            });
          }
          case "package.delete": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.servicePackage.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            if (
              !row.draft ||
              (await tx.project.count({ where: { packageId: row.id } })) ||
              (
                await tx.financeSnapshot.findMany({
                  where: { agencyId },
                  select: { input: true },
                })
              ).some((s) => mentions(s.input, row.id)) ||
              (await tx.evidenceItem.count({
                where: { agencyId, sourceRecordId: row.id },
              }))
            )
              throw new DomainError(
                "conflict",
                "Archive referenced or accepted offers instead of deleting them.",
              );
            return tx.servicePackage.delete({
              where: { id: row.id, version: v.expectedVersion },
            });
          }
          case "client.create": {
            const data = commandSchemas[command.type].parse(command.input);
            return tx.client.create({ data: { agencyId, ...data } });
          }
          case "client.update": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.client.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            return tx.client.update({
              where: { id: row.id, version: v.expectedVersion },
              data: { ...v.data, version: { increment: 1 } },
            });
          }
          case "client.archive": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.client.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            return tx.client.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                archivedAt: v.archived ? now : null,
                version: { increment: 1 },
              },
            });
          }
          case "project.create": {
            const v = commandSchemas[command.type].parse(command.input);
            await projectReferences(tx, agencyId, v.clientId, v.packageId);
            const p = v.packageId
              ? await tx.servicePackage.findUniqueOrThrow({
                  where: { id: v.packageId },
                })
              : null;
            return tx.project.create({
              data: {
                ...v,
                agencyId,
                brief:
                  v.brief || (p ? JSON.stringify(p.deliverables) : "") || "",
                budgetMinor: v.budgetMinor ?? p?.priceMinor ?? null,
                dueAt: date(v.dueAt),
              },
            });
          }
          case "project.update": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.project.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            await projectReferences(
              tx,
              agencyId,
              v.data.clientId,
              v.data.packageId,
              row,
            );
            return tx.project.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                ...v.data,
                dueAt: date(v.data.dueAt),
                version: { increment: 1 },
              },
            });
          }
          case "project.archive": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.project.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            return tx.project.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                archivedAt: v.archived ? now : null,
                version: { increment: 1 },
              },
            });
          }
          case "project.transition": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.project.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            const allowed: Record<string, string[]> = {
              planned: ["active"],
              active: ["review", "planned"],
              review: ["active", "completed"],
              completed: ["active"],
            };
            if (row.archivedAt || !allowed[row.status]?.includes(v.status))
              throw new DomainError(
                "conflict",
                "This project transition is unavailable.",
              );
            if (v.status === "completed") {
              const pending = await tx.task.findMany({
                where: {
                  projectId: row.id,
                  agencyId,
                  status: { notIn: ["done", "cancelled"] },
                },
                include: { predecessors: { include: { predecessor: true } } },
              });
              const aggregate = pending.length
                ? await tx.automationState.findUnique({
                    where: { agencyId },
                  })
                : null;
              const automation =
                aggregate && aggregate.stateJson !== "{}"
                  ? automationStateSchema.parse(JSON.parse(aggregate.stateJson))
                  : null;
              const administrativeCloseout = (
                task: (typeof pending)[number],
              ) => {
                if (
                  !automation ||
                  automation.agencyId !== agencyId ||
                  automation.version !== aggregate!.version
                )
                  return false;
                const saved = automation.tasks.find(
                  (t) =>
                    t.id === task.id &&
                    t.projectId === row.id &&
                    t.kind === "closeout" &&
                    t.version === task.version &&
                    t.status === task.status,
                );
                const workflow = saved?.workflowId
                  ? automation.workflows.find(
                      (f) =>
                        f.id === saved.workflowId &&
                        f.projectId === row.id &&
                        f.taskIds.at(-1) === task.id,
                    )
                  : null;
                return Boolean(
                  saved &&
                  workflow &&
                  automation.deliveries.some((d) => d.projectId === row.id) &&
                  saved.dependencies.length &&
                  saved.dependencies.length === task.predecessors.length &&
                  task.predecessors.every(
                    (p) =>
                      saved.dependencies.includes(p.predecessorId) &&
                      p.predecessor.agencyId === agencyId &&
                      p.predecessor.projectId === row.id &&
                      p.predecessor.status === "done",
                  ),
                );
              };
              if (pending.some((task) => !administrativeCloseout(task)))
                throw new DomainError(
                  "conflict",
                  "Finish or explicitly cancel outstanding delivery and review tasks first.",
                );
            }
            const saved = await tx.project.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                status: v.status,
                completedAt: v.status === "completed" ? now : null,
                version: { increment: 1 },
              },
            });
            await event(tx, agencyId, userId, `project.${v.status}`, row.id);
            return saved;
          }
          case "task.create": {
            const v = commandSchemas[command.type].parse(command.input),
              taskId = randomUUID();
            await taskReferences(tx, agencyId, taskId, v);
            const { predecessorIds, ...data } = v;
            const blocked = await tx.task.count({
              where: { id: { in: predecessorIds }, status: { not: "done" } },
            });
            return tx.task.create({
              data: {
                ...data,
                id: taskId,
                agencyId,
                dueAt: date(v.dueAt),
                originalCommittedDueAt: date(v.dueAt),
                status: blocked ? "blocked" : "queued",
                predecessors: {
                  create: predecessorIds.map((predecessorId) => ({
                    predecessorId,
                  })),
                },
              },
            });
          }
          case "task.update": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.task.findUnique({ where: { id: v.id } }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            await automationOwns(tx, agencyId, row.id);
            await taskReferences(tx, agencyId, row.id, v.data);
            const { predecessorIds, ...data } = v.data;
            const successors = await tx.taskDependency.findMany({
              where: { predecessorId: row.id },
              include: { task: true },
            });
            if (successors.some((e) => e.task.projectId !== data.projectId))
              throw new DomainError(
                "invalid_input",
                "Move dependent tasks together; cross-project edges are not allowed.",
              );
            await tx.taskDependency.deleteMany({ where: { taskId: row.id } });
            const history: unknown[] = Array.isArray(row.dueDateHistory)
              ? row.dueDateHistory
              : [];
            if (row.dueAt?.toISOString() !== date(v.data.dueAt)?.toISOString())
              history.push(
                json({ old: row.dueAt, new: v.data.dueAt, changedAt: now }),
              );
            return tx.task.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                ...data,
                dueAt: date(v.data.dueAt),
                originalCommittedDueAt:
                  row.originalCommittedDueAt ?? date(v.data.dueAt),
                dueDateHistory: json(history),
                version: { increment: 1 },
                predecessors: {
                  create: predecessorIds.map((predecessorId) => ({
                    predecessorId,
                  })),
                },
              },
            });
          }
          case "task.transition": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await scoped(
                await tx.task.findUnique({
                  where: { id: v.id },
                  include: { predecessors: { include: { predecessor: true } } },
                }),
                agencyId,
              );
            expected(row, v.expectedVersion);
            await automationOwns(tx, agencyId, row.id);
            const allowed: Record<string, string[]> = {
              blocked: ["queued", "cancelled"],
              queued: ["in_progress", "cancelled"],
              in_progress: ["awaiting_review", "failed", "cancelled"],
              awaiting_review: ["done", "in_progress", "cancelled"],
              failed: ["queued", "cancelled"],
              done: [],
              cancelled: [],
            };
            if (!allowed[row.status]?.includes(v.status))
              throw new DomainError(
                "conflict",
                "This task transition is unavailable.",
              );
            if (
              v.status !== "cancelled" &&
              row.predecessors.some((d) => d.predecessor.status !== "done")
            )
              throw new DomainError(
                "conflict",
                "Complete predecessor tasks first.",
              );
            if (v.status === "done" && row.assignedRoleKey)
              throw new DomainError(
                "conflict",
                "Approve the current generated artifact through the crew review action.",
              );
            if (v.status === "cancelled" && !v.note)
              throw new DomainError(
                "invalid_input",
                "Record a cancellation reason.",
              );
            const saved = await tx.task.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                status: v.status,
                acceptedAt: v.status === "done" ? now : row.acceptedAt,
                ...(v.status === "cancelled"
                  ? { cancellationRecord: json({ date: now, reason: v.note }) }
                  : {}),
                version: { increment: 1 },
              },
            });
            if (v.status === "done")
              await unlockSuccessors(tx, agencyId, row.id);
            await event(tx, agencyId, userId, `task.${v.status}`, row.id);
            return saved;
          }
          case "closeout.save": {
            const v = commandSchemas[command.type].parse(command.input),
              project = await scoped(
                await tx.project.findUnique({ where: { id: v.projectId } }),
                agencyId,
              ),
              old = await tx.projectCloseout.findUnique({
                where: { projectId: project.id },
              });
            expected(old, v.expectedVersion);
            const p = validateProvenance(
              v.data.provenance,
              now,
              old?.provenance,
            );
            if (p.origin === "assumption")
              throw new DomainError(
                "invalid_input",
                "Closeout records earned work, not assumptions.",
              );
            if (new Date(v.data.deliveryDate) > now)
              throw new DomainError(
                "invalid_input",
                "Delivery cannot be in the future.",
              );
            if (project.status !== "completed")
              throw new DomainError(
                "conflict",
                "Record internal delivery and complete the project before closeout.",
              );
            const data = {
              ...v.data,
              provenance: json(p),
              deliveryDate: new Date(v.data.deliveryDate),
            };
            const saved = await tx.projectCloseout.upsert({
              where: { projectId: project.id },
              create: { ...data, projectId: project.id, agencyId },
              update: { ...data, version: { increment: 1 } },
            });
            await tx.evidenceItem.upsert({
              where: {
                agencyId_sourceRecordId_metricKey: {
                  agencyId,
                  sourceRecordId: project.id,
                  metricKey: "project_closeout",
                },
              },
              create: {
                agencyId,
                sourceRecordId: project.id,
                metricKey: "project_closeout",
                category: "customers_delivery",
                value: json({ ...v.data, projectId: project.id }),
                provenance: json(p),
              },
              update: {
                value: json({ ...v.data, projectId: project.id }),
                provenance: json(p),
                version: { increment: 1 },
              },
            });
            for (const period of new Set([
              v.data.deliveryDate.slice(0, 7),
              ...(old ? [old.deliveryDate.toISOString().slice(0, 7)] : []),
            ]))
              await recalculateCloseoutPeriod(tx, agencyId, period, now);
            await event(tx, agencyId, userId, "project.closeout", project.id, {
              version: saved.version,
            });
            return saved;
          }
          case "actual.source": {
            const v = commandSchemas[command.type].parse(command.input),
              row = await tx.financialActualPeriod.findUnique({
                where: {
                  agencyId_yearMonth: { agencyId, yearMonth: v.yearMonth },
                },
              });
            expected(row, v.expectedVersion);
            if (!row) missing();
            if (v.sourceMode === row.sourceMode) return row;
            await preserveActualRevision(tx, row, now);
            const data = actualSchema.parse(row.data);
            await tx.financialActualPeriod.update({
              where: { id: row.id, version: v.expectedVersion },
              data: {
                sourceMode: v.sourceMode,
                data: json({ ...data, sourceMode: v.sourceMode }),
                version: { increment: 1 },
              },
            });
            if (v.sourceMode === "derived")
              await recalculateCloseoutPeriod(tx, agencyId, v.yearMonth, now);
            await event(tx, agencyId, userId, "actual.source_changed", row.id, {
              from: row.sourceMode,
              to: v.sourceMode,
            });
            const final = await tx.financialActualPeriod.findUnique({
              where: { id: row.id },
            });
            if (final) await preserveActualRevision(tx, final, now);
            return final;
          }
          case "actual.save": {
            const v = commandSchemas[command.type].parse(command.input),
              old = await tx.financialActualPeriod.findUnique({
                where: {
                  agencyId_yearMonth: { agencyId, yearMonth: v.data.yearMonth },
                },
              });
            expected(old, v.expectedVersion);
            validateProvenance(v.data.provenance, now, old?.provenance);
            if (v.data.provenance.origin === "assumption")
              throw new DomainError(
                "invalid_input",
                "Historical actuals cannot be assumptions.",
              );
            if (v.data.sourceMode !== "manual")
              throw new DomainError(
                "invalid_input",
                "Derived totals are saved from project closeout, not manually supplied.",
              );
            if (old?.sourceMode === "derived")
              throw new DomainError(
                "conflict",
                "This month uses project-derived totals. Correct project closeouts rather than adding a manual total.",
                old,
              );
            const start = new Date(`${v.data.yearMonth}-01T00:00:00Z`);
            if (
              new Date(
                Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
              ) > now
            )
              throw new DomainError(
                "invalid_input",
                "Actuals must use a closed UTC calendar month.",
              );
            if (old) await preserveActualRevision(tx, old, now);
            const saved = await tx.financialActualPeriod.upsert({
              where: {
                agencyId_yearMonth: { agencyId, yearMonth: v.data.yearMonth },
              },
              create: {
                agencyId,
                yearMonth: v.data.yearMonth,
                sourceMode: "manual",
                data: json(v.data),
                provenance: json(v.data.provenance),
              },
              update: {
                data: json(v.data),
                provenance: json(v.data.provenance),
                version: { increment: 1 },
              },
            });
            await preserveActualRevision(tx, saved, now);
            return saved;
          }
          case "evidence.save": {
            const v = commandSchemas[command.type].parse(command.input),
              old = v.id
                ? await scoped(
                    await tx.evidenceItem.findUnique({ where: { id: v.id } }),
                    agencyId,
                  )
                : null;
            expected(old, v.expectedVersion);
            validateProvenance(v.data.provenance, now, old?.provenance);
            if (v.data.sourceRecordId) {
              const ref = v.data.sourceRecordId;
              const exists =
                (await tx.project.findFirst({
                  where: { id: ref, agencyId },
                })) ||
                (await tx.servicePackage.findFirst({
                  where: { id: ref, agencyId },
                })) ||
                (await tx.task.findFirst({ where: { id: ref, agencyId } })) ||
                (await tx.financeSnapshot.findFirst({
                  where: { id: ref, agencyId },
                }));
              if (!exists) missing();
            }
            const recordId = old?.id ?? randomUUID();
            const proposed =
              v.data.value &&
              typeof v.data.value === "object" &&
              !Array.isArray(v.data.value) &&
              "pitchFact" in v.data.value
                ? (v.data.value as { pitchFact: unknown }).pitchFact
                : null;
            const fact = proposed
              ? factSchema.parse({
                  ...factSchema.parse(proposed),
                  id: recordId,
                  sourceVersion: old ? old.version + 1 : 1,
                  origin: v.data.provenance.origin,
                  sourceRef: v.data.provenance.sourceReference,
                  asOf: v.data.provenance.asOf.slice(0, 10),
                  reviewStatus: v.data.provenance.reviewStatus,
                })
              : null;
            const data = {
              category: v.data.category,
              metricKey: v.data.metricKey,
              value: json(
                fact
                  ? { pitchFact: fact, sourceUrl: v.data.sourceUrl }
                  : { content: v.data.value, sourceUrl: v.data.sourceUrl },
              ),
              sourceRecordId: v.data.sourceRecordId,
              provenance: json(v.data.provenance),
            };
            return old
              ? tx.evidenceItem.update({
                  where: { id: old.id, version: v.expectedVersion! },
                  data: { ...data, version: { increment: 1 } },
                })
              : tx.evidenceItem.create({
                  data: { ...data, id: recordId, agencyId },
                });
          }
          case "checklist.save": {
            const v = commandSchemas[command.type].parse(command.input),
              old = v.id
                ? await scoped(
                    await tx.dataRoomItem.findUnique({ where: { id: v.id } }),
                    agencyId,
                  )
                : null;
            expected(old, v.expectedVersion);
            for (const eid of v.data.evidenceIds)
              await scoped(
                await tx.evidenceItem.findUnique({ where: { id: eid } }),
                agencyId,
              );
            if (v.data.reviewedAt && new Date(v.data.reviewedAt) > now)
              throw new DomainError(
                "invalid_input",
                "Review date cannot be in the future.",
              );
            if (v.data.state === "externally_reviewed") {
              const evidence = await tx.evidenceItem.findMany({
                where: { id: { in: v.data.evidenceIds }, agencyId },
              });
              if (
                !evidence.length ||
                evidence.some(
                  (e) =>
                    provenanceSchema.parse(e.provenance).reviewStatus !==
                    "externally_reviewed",
                )
              )
                throw new DomainError(
                  "invalid_input",
                  "External review needs explicitly documented review evidence.",
                );
            }
            const data = {
              ...v.data,
              evidenceIds: json(v.data.evidenceIds),
              reviewedAt: date(v.data.reviewedAt),
            };
            return old
              ? tx.dataRoomItem.update({
                  where: { id: old.id, version: v.expectedVersion! },
                  data: { ...data, version: { increment: 1 } },
                })
              : tx.dataRoomItem.create({ data: { ...data, agencyId } });
          }
          case "workspace.reset": {
            commandSchemas[command.type].parse(command.input);
            if (
              process.env.NODE_ENV === "production" ||
              !agency.sampleWorkspace
            )
              throw new DomainError(
                "forbidden_or_missing",
                "Only your local synthetic sample workspace can be reset.",
              );
            const sourceEvidence = await tx.evidenceItem.findMany({
                where: { agencyId },
              }),
              sourceActuals = await tx.financialActualPeriod.findMany({
                where: { agencyId },
              });
            if (
              [...sourceEvidence, ...sourceActuals].some(
                (row) =>
                  provenanceSchema.parse(row.provenance).origin ===
                  "user_entered",
              )
            )
              throw new DomainError(
                "conflict",
                "This sample workspace contains user-entered business evidence; preserve it in a separate workspace before reset.",
              );
            await tx.agencyEngineState.deleteMany({ where: { id: userId } });
            await tx.agencyDraft.deleteMany({ where: { userId } });
            await tx.onboardingDraft.deleteMany({ where: { userId } });
            await tx.taskDependency.deleteMany({
              where: { task: { agencyId } },
            });
            await tx.task.deleteMany({ where: { agencyId } });
            await tx.project.deleteMany({ where: { agencyId } });
            await tx.agency.delete({
              where: { id: agencyId, ownerId: userId },
            });
            return { reset: true };
          }
          default:
            throw new DomainError(
              "invalid_input",
              "Unknown workspace command.",
            );
        }
      });
    },
  };
}
async function unlockSuccessors(
  tx: Transaction,
  agencyId: string,
  taskId: string,
) {
  const edges = await tx.taskDependency.findMany({
    where: { predecessorId: taskId },
    include: {
      task: { include: { predecessors: { include: { predecessor: true } } } },
    },
  });
  for (const { task } of edges)
    if (
      task.agencyId === agencyId &&
      task.status === "blocked" &&
      task.predecessors.every((p) => p.predecessor.status === "done")
    )
      await tx.task.updateMany({
        where: { id: task.id, version: task.version, status: "blocked" },
        data: { status: "queued", version: { increment: 1 } },
      });
}
export async function syncTaskApproval(
  tx: Transaction,
  userId: string,
  agencyId: string,
  artifact: {
    taskId: string;
    artifactId?: string;
    id?: string;
    runId: string;
    status: string;
    reviewedByUserId: string;
    reviewedAt: string;
    current?: boolean;
  },
) {
  await requireOwnedAgency(tx, userId, agencyId);
  const task = await scoped(
    await tx.task.findUnique({
      where: { id: artifact.taskId },
      include: { predecessors: { include: { predecessor: true } } },
    }),
    agencyId,
  );
  if (
    artifact.reviewedByUserId !== userId ||
    artifact.status !== "approved" ||
    artifact.current === false ||
    task.predecessors.some((p) => p.predecessor.status !== "done")
  )
    throw new DomainError(
      "conflict",
      "Current owner approval and complete dependencies are required.",
    );
  const engine = await tx.agencyEngineState.findFirst({
    where: { id: userId, agencyId },
  });
  const facts = engine
    ? z
        .object({
          artifacts: z.array(
            z
              .object({
                id: z.string(),
                agencyId: z.string(),
                taskId: z.string(),
                runId: z.string(),
                previousRevisionId: z.string().nullable(),
                status: z.string(),
                reviewedByUserId: z.string().nullable(),
                reviewedAt: z.string().nullable(),
              })
              .passthrough(),
          ),
        })
        .passthrough()
        .parse(JSON.parse(engine.payload)).artifacts
    : [];
  const savedArtifact = facts.find(
    (a) => a.id === (artifact.artifactId ?? artifact.id),
  );
  if (
    !savedArtifact ||
    savedArtifact.agencyId !== agencyId ||
    savedArtifact.taskId !== task.id ||
    savedArtifact.runId !== artifact.runId ||
    savedArtifact.status !== "approved" ||
    savedArtifact.reviewedByUserId !== userId ||
    !savedArtifact.reviewedAt ||
    new Date(savedArtifact.reviewedAt).getTime() !==
      new Date(artifact.reviewedAt).getTime() ||
    facts.some((a) => a.previousRevisionId === savedArtifact.id)
  )
    throw new DomainError(
      "conflict",
      "Approval must reference the current saved owner-reviewed artifact.",
    );
  await automationOwns(tx, agencyId, task.id);
  if (task.status === "done") return task;
  if (task.status !== "awaiting_review")
    throw new DomainError("conflict", "Task is not awaiting review.");
  const saved = await tx.task.update({
    where: { id: task.id, version: task.version },
    data: {
      status: "done",
      acceptedAt: new Date(artifact.reviewedAt),
      approvedArtifact: json(artifact),
      version: { increment: 1 },
    },
  });
  await unlockSuccessors(tx, agencyId, task.id);
  return saved;
}
export type WorkspaceRead = Awaited<
  ReturnType<ReturnType<typeof createWorkspaceService>["readWorkspace"]>
>;
