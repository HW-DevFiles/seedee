import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { factSchema } from "@/lib/ai/contracts";
import { getAIProvider } from "@/lib/ai";
import { AgencyEngine, fingerprint } from "../agency-engine/service";
import { EngineError } from "../agency-engine/contracts";
import { createPrismaEngineRepository } from "../agency-engine/repository";
import {
  createWorkspaceEngineBridge,
  loadEngineArtifactFacts,
} from "../agency-engine/workspace-bridge";
import { createCoreAutomationBridge } from "../automation/core-bridge";
import {
  createPrismaAutomationRepository,
  createPrismaAutomationTransaction,
} from "../automation/prisma-repository";
import { createAutomationService } from "../automation/service";
import { recordRunEvent } from "../automation/run-bridge";
import { provenanceSchema, DomainError } from "../workspace/contracts";
import { requireOwnedAgency, syncTaskApproval } from "../workspace/service";

export function createIntegratedServices(
  db: PrismaClient,
  clock = () => new Date(),
) {
  const coreBridge = createCoreAutomationBridge(
    async (tx, userId, agencyId) => {
      const agency = await requireOwnedAgency(tx, userId, agencyId);
      const [projects, offers, tasks, evidence, checklist, artifacts] =
        await Promise.all([
          tx.project.findMany({
            where: { agencyId },
            include: { closeout: true, client: true },
          }),
          tx.servicePackage.findMany({ where: { agencyId } }),
          tx.task.findMany({ where: { agencyId } }),
          tx.evidenceItem.findMany({ where: { agencyId } }),
          tx.dataRoomItem.findMany({ where: { agencyId } }),
          loadEngineArtifactFacts(tx, { userId, agencyId }),
        ]);
      const now = clock();
      const closeouts = projects.flatMap((p) =>
        p.closeout
          ? [
              {
                row: p.closeout,
                data: {
                  ...p.closeout,
                  provenance: provenanceSchema.parse(p.closeout.provenance),
                },
              },
            ]
          : [],
      );
      const origins = new Set(closeouts.map((c) => c.data.provenance.origin));
      if (origins.has("sample") && origins.has("user_entered"))
        throw new DomainError(
          "invalid_input",
          "Sample and real closeouts require separate workspaces.",
        );
      const capacitySchema = z.object({
        availableHours: z.number().nonnegative().nullable(),
        plannedHours: z.number().nonnegative().nullable(),
      });
      const capacity = evidence
        .filter((e) => e.metricKey === "human_capacity")
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .find(
          (e) =>
            capacitySchema.safeParse((e.value as { content?: unknown }).content)
              .success,
        );
      const overdue = tasks.filter(
        (t) =>
          t.dueAt && t.dueAt < now && !["done", "cancelled"].includes(t.status),
      );
      return {
        artifacts,
        recordedDeliveryProjectIds: [], // AutomationState owns explicit internal-delivery records.
        growth: {
          period: {
            from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(),
            through: now.toISOString(),
          },
          origin: agency.sampleWorkspace
            ? ("sample" as const)
            : ("user-entered" as const),
          offers: offers.map((o) => ({
            id: o.id,
            active: !o.archivedAt && !o.draft,
          })),
          projects: projects.map((p) => ({
            id: p.id,
            completedAt: p.completedAt?.toISOString() ?? null,
            economicClientGroupId: p.client?.economicGroupId ?? null,
          })),
          closeouts: closeouts.map(({ row, data }) => ({
            id: row.projectId,
            projectId: row.projectId,
            recognizedRevenueMinor: data.recognizedRevenueMinor,
            receiptsMinor: data.receiptsMinor,
            deliveryCostMinor: data.deliveryCostMinor,
          })),
          overdueTaskIds: overdue.map((t) => t.id),
          overdueTasks: overdue.map((t) => ({
            id: t.id,
            dueAt: t.dueAt!.toISOString(),
          })),
          reviewedSopIds: evidence
            .filter(
              (e) =>
                e.metricKey === "reviewed_sop" &&
                provenanceSchema.parse(e.provenance).reviewStatus !==
                  "unreviewed",
            )
            .map((e) => e.id),
          capacity: capacity
            ? {
                evidenceId: capacity.id,
                ...capacitySchema.parse(
                  (capacity.value as { content?: unknown }).content,
                ),
                asOf: provenanceSchema.parse(capacity.provenance).asOf,
              }
            : null,
          investorGaps: checklist
            .filter((c) => ["missing", "draft"].includes(c.state))
            .map((c) => ({
              key: c.id,
              title: c.title,
              reason: c.note || "Supporting evidence needs review.",
              evidenceIds: z.array(z.string()).parse(c.evidenceIds),
            })),
          investorEvidenceComplete: checklist.length
            ? checklist.every((c) => !["missing", "draft"].includes(c.state))
            : null,
          investorEvidenceIds: [
            ...new Set(
              checklist.flatMap((c) =>
                z.array(z.string()).parse(c.evidenceIds),
              ),
            ),
          ],
        },
      };
    },
    clock,
  );
  const automation = createAutomationService(
    createPrismaAutomationRepository(db, coreBridge),
    clock,
  );
  const bridge = createWorkspaceEngineBridge(async (tx, scope, event) => {
    if (!scope.agencyId)
      throw new EngineError("forbidden_or_missing", "Workspace unavailable.");
    const port = createPrismaAutomationTransaction(tx, coreBridge);
    const owned = await port.loadOwned(scope.userId, scope.agencyId);
    if (owned.state?.tasks.some((t) => t.id === event.taskId)) {
      const state = await recordRunEvent(
        port,
        { ...event, userId: scope.userId, agencyId: scope.agencyId },
        clock(),
      );
      return {
        taskVersion: state.tasks.find((t) => t.id === event.taskId)!.version,
      };
    }
    // Standalone tasks use the core approval guard, in this same engine transaction.
    const task = await tx.task.findFirst({
      where: { id: event.taskId, agencyId: scope.agencyId },
      include: { predecessors: { include: { predecessor: true } } },
    });
    if (!task)
      throw new EngineError("forbidden_or_missing", "Task unavailable.");
    if (
      task.version !== event.expectedTaskVersion ||
      task.predecessors.some((p) => p.predecessor.status !== "done")
    )
      throw new EngineError("conflict", "Task or dependencies changed.");
    if (event.status === "approved") {
      const artifact = (await loadEngineArtifactFacts(tx, scope)).find(
        (a) =>
          a.id === event.artifactId &&
          a.current &&
          a.reviewedAt &&
          a.reviewedByUserId === scope.userId,
      );
      if (!artifact)
        throw new EngineError(
          "conflict",
          "Current owner approval is required.",
        );
      const saved = await syncTaskApproval(tx, scope.userId, scope.agencyId, {
        ...artifact,
        reviewedByUserId: scope.userId,
        reviewedAt: artifact.reviewedAt!,
      });
      return { taskVersion: saved.version };
    }
    const statuses = {
      queued: "queued",
      running: "in_progress",
      awaiting_review: "awaiting_review",
      failed: "failed",
      cancelled: "cancelled",
      retry: "queued",
      revision_requested: "in_progress",
    };
    const saved = await tx.task.update({
      where: { id: task.id, version: task.version },
      data: {
        status: statuses[event.status],
        version: { increment: 1 },
        approvedArtifact: undefined,
      },
    });
    return { taskVersion: saved.version };
  });
  const evidenceFacts = bridge.facts;
  bridge.facts = async (tx, scope, facts) => {
    if (!scope.agencyId)
      throw new EngineError("forbidden_or_missing", "Workspace unavailable.");
    await requireOwnedAgency(tx, scope.userId, scope.agencyId);
    for (const fact of facts) {
      const snapshot = await tx.financeSnapshot.findFirst({
        where: { id: fact.sourceRef, agencyId: scope.agencyId },
      });
      if (!snapshot) {
        await evidenceFacts(tx, scope, [fact]);
        continue;
      }
      const output = z
        .object({ facts: z.array(factSchema) })
        .parse(snapshot.output);
      if (
        !output.facts.some(
          (saved) => fingerprint(saved) === fingerprint(factSchema.parse(fact)),
        )
      )
        throw new EngineError(
          "conflict",
          "Pitch fact differs from its saved calculation.",
        );
    }
  };
  const engine = new AgencyEngine(
    createPrismaEngineRepository(db, bridge),
    getAIProvider(),
    clock,
  );
  return { automation, engine, coreBridge };
}
