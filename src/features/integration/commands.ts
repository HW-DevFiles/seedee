import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSecurityContext } from "@/lib/security/request";
import { consumeOperationLimit } from "@/lib/security/rate-limit";
import { createEngineActions } from "../agency-engine/actions";
import { createIntegratedServices } from "./services";
import { createWorkspaceService } from "../workspace/service";
import { createFinanceService } from "../finance/service";
import {
  DomainError,
  onboardingSchema,
  actualSchema,
  type Provenance,
} from "../workspace/contracts";
import { applyTeamEvidence } from "../finance/team";
import { emptyReadiness } from "../finance/readiness";
import { readinessSchema, forecastSchema } from "../finance/contracts";
import { monthsEnding, D } from "../finance/decimal";
import { pitchFacts } from "./view";
import type { IntegratedRead } from "./read";
import type { AutomationCommand } from "../automation/contracts";
const strings = (v: unknown) => z.array(z.string()).parse(v ?? []);
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
const lines = (v: unknown) =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
export async function executeProductCommand(
  data: IntegratedRead,
  type: string,
  input: Record<string, unknown>,
  meta: {
    id?: string;
    version: number | null;
    key: string;
    recordVersions?: Record<string, number>;
  },
) {
  const context = await requireSecurityContext(true);
  if (context.userId !== data.context.userId)
    throw new DomainError("unauthenticated", "Sign in again.");
  const { workspace: w, engine: e, automation: a } = data;
  const services = createIntegratedServices(db);
  const core = createWorkspaceService(db, context.userId);
  const finance = createFinanceService(db, context.userId);
  const engine = createEngineActions(services.engine, {
    requireContext: requireSecurityContext,
    consumeGenerationLimit: async () =>
      consumeOperationLimit(db, { ...context, operation: "generation" }),
  });
  const s = (name: string) => String(input[name] ?? "");
  const n = (name: string) =>
    input[name] === null || input[name] === undefined
      ? null
      : Number(input[name]);
  const expectedVersion = meta.version;
  const id = meta.id;
  const edited = { id, expectedVersion };
  const agencyId = w.agency?.id;
  const provenance = (
    asOf: unknown,
    source: unknown,
    origin: Provenance["origin"] = w.agency?.sampleWorkspace
      ? "sample"
      : "user_entered",
  ): Provenance => ({
    origin,
    asOf: iso(asOf) ?? new Date().toISOString(),
    sourceReference: String(source || "Owner-entered workspace record"),
    reviewStatus: "owner_attested",
    reviewer: null,
    reviewedAt: null,
    reviewReference: null,
  });
  const eng = async (type: string, input: unknown) => {
    const result = await engine.command({ type, input });
    if (!result.ok)
      throw new DomainError(result.error.code, result.error.message);
    return result.data;
  };
  const auto = async (command: AutomationCommand) => {
    if (!agencyId || !a)
      throw new DomainError(
        "forbidden_or_missing",
        "Create your agency first.",
      );
    const result = await services.automation.command(context.userId, {
      agencyId,
      expectedVersion: a.state.version,
      idempotencyKey: meta.key,
      command,
    });
    if (!result.ok) throw new DomainError(result.code, result.message);
    return result.workspace;
  };
  switch (type) {
    case "onboarding.save":
      return core.command({
        type,
        input: {
          expectedVersion,
          data: {
            ...input,
            proposedName: s("proposedName"),
            description: s("description"),
            existingOffers: s("existingOffers"),
            biography: "",
            skills: "",
          },
        },
      });
    case "agency.generate": {
      if (!w.onboarding)
        throw new DomainError("invalid_input", "Save your practice first.");
      const d = onboardingSchema.parse(w.onboarding.data),
        previous = e.drafts.filter((x) => x.content).at(-1);
      return eng("generateAgency", {
        idempotencyKey: meta.key,
        input: {
          practices: d.practices,
          description: d.description,
          targetBuyer: d.targetBuyer,
          goal: d.goal,
          weeklyCapacityHours: d.weeklyCapacityHours,
          proposedName: d.proposedName,
          currency: d.currency,
        },
        ...(previous
          ? {
              previousDraftId: previous.id,
              regenerateFields: [
                "name",
                "positioning",
                "buyer",
                "packages",
                "roles",
                "workflows",
              ],
            }
          : {}),
      });
    }
    case "agency.draft.edit": {
      const d = e.drafts.find((x) => x.id === id);
      if (!d?.content)
        throw new DomainError("forbidden_or_missing", "Draft unavailable.");
      return eng("editDraft", {
        draftId: id,
        expectedVersion,
        content: {
          ...d.content,
          name: s("name"),
          positioning: s("positioning"),
          buyer: s("buyer"),
        },
      });
    }
    case "agency.accept":
      return core.command({
        type,
        input: { draftId: id, expectedVersion, idempotencyKey: meta.key },
      });
    case "agency.update":
      return core.command({ type, input: { ...edited, ...input } });
    case "package.create":
    case "package.update": {
      const previous = w.packages.find((p) => p.id === id);
      const body = {
        title: s("title"),
        deliverables: lines(input.deliverables),
        exclusions: lines(input.exclusions),
        revisionLimit: n("revisionLimit"),
        turnaroundDays: n("turnaroundDays"),
        laborHours: n("laborHours"),
        priceMinor: n("priceMinor"),
        currency: "USD",
        freeSample: input.freeSample === true,
        pricingBasis: {
          kind: "illustrative_assumption",
          laborRateMinor: n("laborRateMinor"),
          directCostMinor: n("directCostMinor"),
          targetMarginBps: n("targetMarginBps"),
          note: "Owner-entered pricing assumptions; not market validation.",
        },
        sopVersion: input.sopVersion || null,
        sopCreatedAt: iso(input.sopCreatedAt),
        acceptanceChecklist: lines(input.acceptanceChecklist),
        draft: previous?.draft ?? false,
      };
      return core.command({
        type,
        input: type.endsWith("update") ? { ...edited, data: body } : body,
      });
    }
    case "client.create":
    case "client.update": {
      const body = {
        ...input,
        organization: s("organization"),
        note: s("note"),
        contactEmail: input.contactEmail || null,
      };
      return core.command({
        type,
        input: type.endsWith("update") ? { ...edited, data: body } : body,
      });
    }
    case "package.archive":
    case "client.archive":
    case "project.archive":
      return core.command({ type, input: { ...edited, archived: true } });
    case "project.create":
    case "project.update": {
      const body = {
        title: s("title"),
        brief: s("brief"),
        clientId: input.clientId || null,
        packageId: input.packageId || null,
        dueAt: iso(input.dueAt),
        budgetMinor: n("budgetMinor"),
      };
      return core.command({
        type,
        input: type.endsWith("update") ? { ...edited, data: body } : body,
      });
    }
    case "project.transition":
      return core.command({ type, input: { ...edited, status: input.status } });
    case "task.create":
    case "task.update": {
      const task = w.tasks.find((t) => t.id === id);
      const body = {
        title: s("title"),
        input: s("input"),
        projectId: type === "task.create" ? id : (task?.projectId ?? null),
        assignedRoleKey: input.assignedRoleKey || null,
        dueAt: iso(input.dueAt),
        priority: input.priority,
        reviewNeeded: true,
        predecessorIds: input.predecessorIds ?? [],
      };
      return core.command({
        type,
        input: type.endsWith("update") ? { ...edited, data: body } : body,
      });
    }
    case "task.reschedule": {
      const task = w.tasks.find((t) => t.id === id);
      if (!task)
        throw new DomainError("forbidden_or_missing", "Task unavailable.");
      if (a?.state.tasks.some((t) => t.id === id))
        return auto({
          type: "reschedule_task",
          taskId: task.id,
          expectedTaskVersion: expectedVersion!,
          dueAt: iso(input.dueAt),
          reason: s("reason"),
        });
      return core.command({
        type: "task.update",
        input: {
          ...edited,
          data: {
            title: task.title,
            input: task.input,
            projectId: task.projectId,
            assignedRoleKey: task.assignedRoleKey,
            dueAt: iso(input.dueAt),
            priority: task.priority,
            reviewNeeded: task.reviewNeeded,
            predecessorIds: task.predecessors.map((p) => p.predecessorId),
          },
        },
      });
    }
    case "task.transition": {
      const task = a?.state.tasks.find((t) => t.id === id);
      if (task) {
        const artifact =
          task.artifactId ??
          task.dependencies
            .map((dep) => a!.state.tasks.find((t) => t.id === dep)?.artifactId)
            .find(Boolean);
        return auto({
          type: "transition_task",
          taskId: task.id,
          expectedTaskVersion: expectedVersion!,
          to: input.status as "done",
          reason: s("reason") || "Owner-requested transition",
          ...((task.kind === "work" || task.kind === "human_review") && artifact
            ? { artifactId: artifact }
            : {}),
        });
      }
      return core.command({
        type,
        input: { ...edited, status: input.status, note: s("reason") },
      });
    }
    case "workflow.instantiate":
      return auto({
        type: "instantiate_workflow",
        projectId: id!,
        templateKey: input.templateKey as "creative_delivery",
        dueAt:
          w.projects.find((p) => p.id === id)?.dueAt?.toISOString() ?? null,
      });
    case "delivery.record":
      return auto({
        type: "record_delivery",
        projectId: id!,
        deliveryDate: iso(input.deliveryDate)!,
        note: s("note"),
      });
    case "closeout.save":
      return core.command({
        type,
        input: {
          projectId: id,
          expectedVersion,
          data: {
            ...input,
            deliveryDate: iso(input.deliveryDate),
            repeatabilityNotes: s("repeatabilityNotes"),
            provenance: provenance(
              input.deliveryDate,
              `Project closeout ${id}`,
            ),
          },
        },
      });
    case "run.queue": {
      const t = w.tasks.find((t) => t.id === id);
      if (!t)
        throw new DomainError("forbidden_or_missing", "Task unavailable.");
      const d = w.onboarding ? onboardingSchema.parse(w.onboarding.data) : null;
      return eng("queueRun", {
        agencyId,
        taskId: t.id,
        projectId: t.projectId,
        expectedTaskVersion: expectedVersion,
        idempotencyKey: meta.key,
        input: {
          roleKey: t.assignedRoleKey ?? "creative_lead",
          title: t.title,
          brief: t.input || t.title,
          objective: "Prepare internal work for owner review.",
          practices: d?.practices ?? ["designer"],
          revisionNote: "",
        },
      });
    }
    case "run.advance":
      return eng("advanceRun", { agencyId, runId: id });
    case "run.approve":
    case "run.revise":
    case "run.retry":
    case "run.cancel":
      return eng(
        {
          "run.approve": "approveRun",
          "run.revise": "requestRevision",
          "run.retry": "retryRun",
          "run.cancel": "cancelRun",
        }[type],
        {
          agencyId,
          runId: id,
          expectedVersion,
          idempotencyKey: meta.key,
          ...(type === "run.revise" ? { note: s("feedback") } : {}),
        },
      );
    case "routine.enable":
      return auto({
        type: "configure_routine",
        routineId: `routine-${input.templateKey}`,
        templateKey: input.templateKey as "weekly_planning",
        timezone: s("timezone"),
        nextDueAt: new Date().toISOString(),
        enabled: true,
      });
    case "routine.pause": {
      const r = a?.state.routines.find((r) => r.id === input.routineId);
      if (!r)
        throw new DomainError("forbidden_or_missing", "Routine unavailable.");
      return auto({
        type: "configure_routine",
        routineId: r.id,
        templateKey: r.templateKey,
        timezone: r.timezone,
        nextDueAt: r.nextDueAt,
        enabled: false,
      });
    }
    case "routine.runDue":
      return auto({ type: "run_due_routines" });
    case "notification.readAll":
      return auto({ type: "mark_notifications_read" });
    case "capacity.save":
      return core.command({
        type: "evidence.save",
        input: {
          id: null,
          expectedVersion: null,
          data: {
            category: "product_operations",
            metricKey: "human_capacity",
            value: {
              availableHours: n("availableHours"),
              plannedHours: n("plannedHours"),
            },
            provenance: provenance(input.asOfDate, input.sourceReference),
          },
        },
      });
    case "sop.review": {
      const p = w.packages.find((p) => p.id === input.packageId);
      if (
        !p?.sopVersion ||
        !p.sopCreatedAt ||
        !strings(p.acceptanceChecklist).length
      )
        throw new DomainError(
          "invalid_input",
          "Save a versioned SOP, its creation date and acceptance checks on this package first.",
        );
      return core.command({
        type: "evidence.save",
        input: {
          id: null,
          expectedVersion: null,
          data: {
            category: "product_operations",
            metricKey: "reviewed_sop",
            value: { packageId: p.id, sopVersion: p.sopVersion },
            sourceRecordId: p.id,
            provenance: provenance(input.asOfDate, input.sourceReference),
          },
        },
      });
    }
    case "growth.refresh":
      return auto({ type: "refresh_growth" });
    case "recommendation.task":
    case "recommendation.dismiss":
      return auto({
        type:
          type === "recommendation.task"
            ? "recommendation_task"
            : "dismiss_recommendation",
        recommendationKey: s("recommendationId"),
      });
    case "actual.save": {
      const body = {
        ...input,
        currency: "USD",
        provenance: provenance(input.asOfDate, input.sourceReference),
      };
      delete (body as Record<string, unknown>).asOfDate;
      delete (body as Record<string, unknown>).sourceReference;
      return core.command({
        type,
        input: {
          expectedVersion: meta.recordVersions?.[s("yearMonth")] ?? null,
          data: body,
        },
      });
    }
    case "team.human":
    case "team.backup":
    case "team.hours":
    case "team.capacity":
    case "team.owner": {
      const kind = type.split(".")[1];
      const data =
        kind === "human"
          ? {
              id: s("entryId"),
              role: s("role"),
              isFounder: input.isFounder === true,
              simulated: false,
              compensationMinor: n("compensationMinor"),
              agreementStart: iso(input.agreementStart),
              agreementEnd: iso(input.agreementEnd),
            }
          : kind === "backup"
            ? {
                serviceId: s("serviceId"),
                humanId: s("humanId"),
                acceptedAt: iso(input.acceptedAt),
              }
            : kind === "hours"
              ? {
                  humanId: s("humanId"),
                  date: iso(input.deliveryDate),
                  hours: n("hours"),
                }
              : kind === "capacity"
                ? {
                    id: s("entryId"),
                    period: s("period"),
                    availableHours: n("availableHours"),
                    plannedHours: n("plannedHours"),
                    attestedAt: iso(input.attestedAt),
                    humanIds: strings(input.humanIds),
                    serviceIds: lines(input.serviceIds),
                  }
                : { note: s("note"), asOf: iso(input.asOfDate) };
      return finance.command({
        type: "finance.team",
        input: {
          entryId: s("entryId"),
          expectedVersion:
            meta.recordVersions?.[`${kind}:${s("entryId")}`] ?? null,
          record: { kind, data },
          provenance: provenance(input.asOfDate, input.sourceReference),
        },
      });
    }
    case "milestone.preview":
      return finance.command({
        type: "finance.milestone",
        input: {
          baselineId: s("baselineId"),
          milestone: s("milestone"),
          revenueMinor: [n("revenue1"), n("revenue2"), n("revenue3")],
        },
      });
    case "readiness.create": {
      const asOf = iso(input.asOfDate)!;
      const prior = w.snapshots.find(
        (s) =>
          s.kind === "readiness" &&
          s.asOf.toISOString().slice(0, 10) === asOf.slice(0, 10),
      );
      let v = emptyReadiness(
        asOf,
        w.agency?.sampleWorkspace ? "sample" : "user_entered",
      );
      if (prior) {
        const saved = { ...(prior.input as Record<string, unknown>) };
        delete saved.actualVersions;
        delete saved.evidenceVersions;
        v = readinessSchema.parse(saved);
      }
      v.months = w.actuals
        .filter((r) => monthsEnding(new Date(asOf), 6).includes(r.yearMonth))
        .map((r) => {
          const d = actualSchema.parse(r.data);
          return {
            period: r.yearMonth,
            revenueMinor: d.recognizedRevenueMinor,
            closed: true,
            provenance: d.provenance,
          };
        });
      return finance.command({
        type: "finance.readiness",
        input: { input: applyTeamEvidence(v, w.evidence) },
      });
    }
    case "scenario.create": {
      const prior = w.snapshots.find(
        (row) => row.id === input.baseScenarioId && row.kind === "forecast",
      );
      const dollars = (name: string) =>
        input[name] === null ? null : D(n(name)!).div(100).toString();
      const raw: Record<string, unknown> = prior
        ? { ...(prior.input as Record<string, unknown>) }
        : {
            asOf: iso(input.asOfDate),
            currency: "USD",
            horizon: Number(input.horizonMonths),
            services: [
              {
                id: "service",
                title: s("serviceTitle"),
                demandUnits: s("demandUnits"),
                unitPrice: dollars("unitPriceMinor"),
                unitDirectCost: dollars("unitDirectCostMinor"),
                hoursPerPool: { humans: s("hoursPerUnit") },
              },
            ],
            pools: [
              {
                id: "humans",
                availableHours: s("availableHours"),
                hireAdditionalHours: s("hireAdditionalHours") || "0",
              },
            ],
            openingCash: dollars("openingCashMinor"),
            openingReceivables: dollars("openingReceivablesMinor"),
            openingPayables: dollars("openingPayablesMinor"),
            openingDeferredRevenue: dollars("openingDeferredRevenueMinor"),
            openingDebt: dollars("openingDebtMinor"),
            overhead: dollars("overheadMinor"),
            overheadGrowth: s("overheadGrowth"),
            founderCompensation: dollars("founderPayMinor"),
            founderDeliveryHours: null,
            fixedFounderPremium: "0",
            hireMonthlyCost: dollars("hireMonthlyCostMinor"),
            capexMonth1: dollars("capexMinor"),
            taxRate: s("taxRate"),
            contingency: s("contingencyRate"),
            financingCosts: dollars("fixedFinancingCostsMinor"),
            provenance: provenance(
              input.asOfDate,
              "Owner-entered hypothetical assumptions",
              "assumption",
            ),
          };
      delete raw.name;
      const v = forecastSchema.parse({
        ...raw,
        horizon: Number(input.horizonMonths),
        volumeMultiplier: s("volumeMultiplier"),
        growth: s("monthlyGrowthRate"),
        collectionFraction: s("currentCollectionFraction"),
        founderDeliveryPayFraction:
          input.founderDeliveryPayFraction === null
            ? null
            : s("founderDeliveryPayFraction"),
        hireMonth: n("hireMonth"),
        reserve: dollars("reserveTargetMinor"),
        contingency:
          input.contingencyRate === null
            ? raw.contingency
            : s("contingencyRate"),
        financingCosts:
          input.fixedFinancingCostsMinor === null
            ? raw.financingCosts
            : dollars("fixedFinancingCostsMinor"),
        founderReplacementHourlyRate: dollars(
          "founderReplacementHourlyRateMinor",
        ),
        founderReplacementHours:
          input.founderReplacementHours === null
            ? null
            : s("founderReplacementHours"),
        retainedFounderNonDeliveryPay: dollars(
          "retainedFounderNonDeliveryPayMinor",
        ),
      });
      v.provenance = {
        ...v.provenance,
        origin: "assumption",
        sourceReference: "Owner-edited hypothetical scenario",
      };
      return finance.command({
        type: "finance.forecast",
        input: { name: s("name"), input: v },
      });
    }
    case "equity.create": {
      const dollars = (name: string) =>
        D(n(name) ?? 0)
          .div(100)
          .toString();
      return finance.command({
        type: "finance.equity",
        input: {
          asOf: new Date().toISOString(),
          provenance: provenance(
            new Date(),
            "Hypothetical equity assumptions",
            "assumption",
          ),
          input: {
            preMoney: dollars("preMoneyMinor"),
            newCash: dollars("newCashMinor"),
            totalPreShares: D(n("founderShares") ?? 0)
              .add(n("poolShares") ?? 0)
              .toString(),
            holders: [
              {
                id: "founders",
                shares: s("founderShares"),
                unallocatedPool: false,
              },
              { id: "pool", shares: s("poolShares"), unallocatedPool: true },
            ],
            safes:
              input.kind === "cap_only_safe"
                ? ["A", "B"]
                    .filter((k) => n(`safe${k}AmountMinor`)! > 0)
                    .map((k) => ({
                      id: k,
                      amount: dollars(`safe${k}AmountMinor`),
                      cap: dollars(`safe${k}CapMinor`),
                      funded: true,
                      terms: "post_money_cap_only",
                    }))
                : [],
            finalPoolTarget:
              input.finalPoolFraction === null ? null : s("finalPoolFraction"),
            hypothetical: input.hypothetical,
          },
        },
      });
    }
    case "evidence.save":
      return core.command({
        type,
        input: {
          id: null,
          expectedVersion: null,
          data: {
            category: s("category"),
            metricKey: s("title"),
            value: { note: s("note") },
            sourceUrl: input.sourceUrl || null,
            sourceRecordId: null,
            provenance: {
              ...provenance(
                input.asOfDate,
                input.sourceUrl || input.title,
                input.origin as Provenance["origin"],
              ),
              reviewStatus: input.reviewStatus,
              reviewer: input.reviewer || null,
              reviewedAt: iso(input.reviewedAt),
              reviewReference: input.reviewReference || null,
            },
          },
        },
      });
    case "checklist.save": {
      const old = w.checklist.find((c) => c.category === input.category);
      return core.command({
        type,
        input: {
          id: old?.id ?? null,
          expectedVersion: meta.recordVersions?.[s("category")] ?? null,
          data: {
            category: input.category,
            title: s("category").replaceAll("_", " "),
            state: input.status,
            note: s("reason"),
            evidenceIds: input.reference ? [input.reference] : [],
            period: null,
            reviewedAt: ["owner_attested", "externally_reviewed"].includes(
              s("status"),
            )
              ? new Date().toISOString()
              : null,
            ownerLabel: "Workspace owner",
            sourceUrl: null,
          },
        },
      });
    }
    case "pitch.generate": {
      const selected = strings(input.sourceIds),
        facts = pitchFacts(data).filter((f) => selected.includes(f.id));
      if (facts.length !== selected.length)
        throw new DomainError("conflict", "Reload the saved fact choices.");
      return eng("draftPitch", {
        agencyId,
        idempotencyKey: meta.key,
        input: {
          company: w.agency!.name,
          positioning:
            w.agency!.positioning ||
            w.agency!.description ||
            "[Evidence needed]",
          buyer: w.agency!.buyer || "[Evidence needed]",
          facts,
          riskNotes: ["Private preparation only; evidence may be incomplete."],
          fundingInterest: true,
        },
        ...(e.pitches.at(-1) ? { previousPitchId: e.pitches.at(-1)!.id } : {}),
      });
    }
    case "pitch.update": {
      const p = e.pitches.find((p) => p.id === id);
      if (!p?.content)
        throw new DomainError("forbidden_or_missing", "Pitch unavailable.");
      return eng("editPitch", {
        agencyId,
        pitchId: id,
        expectedVersion,
        content: {
          ...p.content,
          sections: p.content.sections.map((section) => ({
            ...section,
            body: s(section.key),
          })),
        },
      });
    }
    case "export.create": {
      await consumeOperationLimit(db, { ...context, operation: "export" });
      return finance.command({
        type,
        input: {
          idempotencyKey: meta.key,
          snapshotIds: [
            ...strings(input.snapshotIds),
            ...(input.forecastId ? [s("forecastId")] : []),
          ],
          evidenceIds: strings(input.evidenceIds),
          pitchId: input.pitchId || null,
          actualOrigin: w.agency?.sampleWorkspace ? "sample" : "user_entered",
          confirmReviewed: true,
        },
      });
    }
    case "workspace.reset":
      return core.command({
        type,
        input: { confirmation: "RESET MY SAMPLE WORKSPACE" },
      });
    default:
      throw new DomainError("invalid_input", "Unknown action.");
  }
}
