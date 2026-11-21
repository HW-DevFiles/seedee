import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  DomainError,
  actualSchema,
  packageSchema,
  checklistCategories,
} from "../src/features/workspace/contracts";
import { json } from "../src/features/workspace/json";
import { sampleAgencyDraft } from "../src/features/workspace/fixtures";
import { sampleReadiness } from "../src/features/finance/fixtures";
import { sampleForecast, forecast } from "../src/features/finance/forecast";
import { scoreReadiness } from "../src/features/finance/readiness";
import {
  READINESS_VERSION,
  FINANCE_VERSION,
  readinessEvidenceIds,
  readinessSchema,
} from "../src/features/finance/contracts";
import { buildFacts } from "../src/features/finance/facts";
const fixtureUserId = "seedee-demo-user-v1",
  fixtureAgencyId = "seedee-demo-agency-v1";
// Called only by explicit local seed tooling after Vera's reserved identity seed.
// No public action accepts IDs or sets the sample marker.
export async function initializeSyntheticWorkspace(
  db: PrismaClient,
  now: Date,
) {
  if (process.env.NODE_ENV === "production")
    throw new DomainError(
      "forbidden_or_missing",
      "Synthetic domain seeding is disabled in production.",
    );
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: fixtureUserId } }),
      agency = await tx.agency.findUnique({ where: { id: fixtureAgencyId } });
    if (
      !user ||
      user.email !== "demo@seedee.local" ||
      !agency ||
      agency.ownerId !== user.id
    )
      throw new DomainError(
        "forbidden_or_missing",
        "Initialize the reserved local fixture identity first; no account adoption is allowed.",
      );
    const key = "sample-domain-v1";
    if (
      await tx.activityEvent.findUnique({
        where: {
          agencyId_correlationKey: { agencyId: agency.id, correlationKey: key },
        },
      })
    )
      return { initialized: false, agencyId: agency.id };
    if (
      (await tx.project.count({ where: { agencyId: agency.id } })) ||
      (await tx.evidenceItem.count({ where: { agencyId: agency.id } })) ||
      (await tx.financialActualPeriod.count({
        where: { agencyId: agency.id },
      })) ||
      (await tx.servicePackage.count({ where: { agencyId: agency.id } }))
    )
      throw new DomainError(
        "conflict",
        "The reserved workspace has domain data; refusing to relabel or overwrite it.",
      );
    const draft = sampleAgencyDraft();
    await tx.agency.update({
      where: { id: agency.id },
      data: {
        sampleWorkspace: true,
        rolesAndWorkflows: json({
          roles: draft.roles,
          workflows: draft.workflows,
        }),
        version: { increment: 1 },
      },
    });
    for (const { key, ...raw } of draft.packages) {
      const data = packageSchema.parse(raw);
      await tx.servicePackage.create({
        data: {
          ...data,
          agencyId: agency.id,
          pricingBasis: json({ ...data.pricingBasis, templateKey: key }),
          deliverables: json(data.deliverables),
          exclusions: json(data.exclusions),
          acceptanceChecklist: json(data.acceptanceChecklist),
          sopCreatedAt: null,
        },
      });
    }
    for (const category of checklistCategories)
      await tx.dataRoomItem.create({
        data: {
          agencyId: agency.id,
          category,
          title: category.replaceAll("_", " "),
          state: "missing",
          note: "Synthetic local sample; evidence metadata only",
          evidenceIds: [],
          ownerLabel: "Sample owner",
        },
      });
    const fixture = sampleReadiness(),
      sourceKeys = new Set(readinessEvidenceIds(fixture));
    const prefix = (v: unknown): unknown =>
      typeof v === "string" && sourceKeys.has(v)
        ? `${agency.id}:${v}`
        : Array.isArray(v)
          ? v.map(prefix)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, prefix(x)]),
              )
            : v;
    const input = readinessSchema.parse(prefix(fixture));
    for (const evidenceId of readinessEvidenceIds(input))
      await tx.evidenceItem.create({
        data: {
          id: evidenceId,
          agencyId: agency.id,
          category: "synthetic_fixture",
          metricKey: evidenceId.split(":").at(-1)!,
          value: {
            note: "Synthetic reference only; not independently verified",
          },
          provenance: json(input.provenance),
        },
      });
    for (const month of input.months) {
      const actual = actualSchema.parse({
        yearMonth: month.period,
        currency: "USD",
        sourceMode: "manual",
        recognizedRevenueMinor: month.revenueMinor,
        cashReceiptsMinor: null,
        deliveryCostsMinor: null,
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
        provenance: input.provenance,
      });
      await tx.financialActualPeriod.create({
        data: {
          agencyId: agency.id,
          yearMonth: month.period,
          sourceMode: "manual",
          data: json(actual),
          provenance: json(input.provenance),
        },
      });
    }
    const sid = randomUUID(),
      output = scoreReadiness(input, now.toISOString());
    await tx.financeSnapshot.create({
      data: {
        id: sid,
        agencyId: agency.id,
        kind: "readiness",
        asOf: new Date(input.asOf),
        evaluatedAt: now,
        formulaVersion: READINESS_VERSION,
        input: json(input),
        output: json({
          ...output,
          facts: buildFacts(
            sid,
            input.asOf,
            READINESS_VERSION,
            input.provenance,
            [
              {
                key: "score",
                label: "Sample preparation score",
                value: output.score,
                section: "traction",
              },
            ],
          ),
        }),
        provenance: json(input.provenance),
      },
    });
    for (const name of ["base", "downside", "upside"] as const) {
      const input = sampleForecast(name);
      await tx.financeSnapshot.create({
        data: {
          agencyId: agency.id,
          kind: "forecast",
          asOf: new Date(input.asOf),
          evaluatedAt: now,
          formulaVersion: FINANCE_VERSION,
          input: json({ name, ...input }),
          output: json(forecast(input, now.toISOString())),
          provenance: json(input.provenance),
        },
      });
    }
    await tx.activityEvent.create({
      data: {
        agencyId: agency.id,
        actorUserId: user.id,
        kind: "sample.initialized",
        subjectId: agency.id,
        correlationKey: key,
        metadata: { fixtureVersion: "sample-domain-v1", origin: "sample" },
      },
    });
    return { initialized: true, agencyId: agency.id };
  });
}
