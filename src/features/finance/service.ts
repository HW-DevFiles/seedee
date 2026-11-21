import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import {
  factSchema,
  pitchDraftSchema,
  pitchInputSchema,
} from "@/lib/ai/contracts";
import {
  DomainError,
  actualSchema,
  id,
  provenanceSchema,
  dateTime,
  type Provenance,
} from "../workspace/contracts";
import {
  json,
  requireOwnedAgency,
  validateProvenance,
  type Transaction,
} from "../workspace/service";
import {
  readinessEvidenceIds,
  readinessSchema,
  forecastSchema,
  equitySchema,
  READINESS_VERSION,
  FINANCE_VERSION,
  EQUITY_VERSION,
  DISCLAIMER,
  HYPOTHETICAL,
  SAMPLE_BANNER,
} from "./contracts";
import { scoreReadiness } from "./readiness";
import { forecast, financialCsv } from "./forecast";
import { calculateEquity } from "./equity";
import { buildFacts } from "./facts";
import { D, money } from "./decimal";

export const financeCommandSchemas = {
  "finance.readiness": z.object({ input: readinessSchema }),
  "finance.forecast": z.object({
    name: z.string().trim().min(1).max(100),
    input: forecastSchema,
  }),
  "finance.equity": z.object({
    asOf: dateTime,
    input: equitySchema,
    provenance: provenanceSchema,
  }),
  "export.create": z.object({
    idempotencyKey: id,
    snapshotIds: z.array(id).max(20),
    evidenceIds: z.array(id).max(500),
    pitchId: id.nullable().default(null),
    actualOrigin: z.enum(["sample", "user_entered"]),
    confirmReviewed: z.literal(true),
  }),
} as const;
export type FinanceCommand = {
  [K in keyof typeof financeCommandSchemas]: {
    type: K;
    input: z.input<(typeof financeCommandSchemas)[K]>;
  };
}[keyof typeof financeCommandSchemas];
export type SavedPitch = {
  id: string;
  version: number;
  content: string;
  origin: Provenance["origin"];
  sourceIds: string[];
  reviewed: boolean;
  templateVersion: string;
};
export type FinanceBridge = {
  loadPitch: (
    tx: Transaction,
    userId: string,
    agencyId: string,
    pitchId: string,
  ) => Promise<SavedPitch>;
};
export function markdownText(text: string) {
  return text
    .replaceAll("\\", "\\\\")
    .replace(/[<>`*_[\]#|]/g, (c) => `\\${c}`)
    .replace(/\r/g, "");
}
function assertOrigins(origins: Iterable<string>) {
  const set = new Set(origins);
  if (set.has("sample") && set.has("user_entered"))
    throw new DomainError(
      "invalid_input",
      "Sample and real actuals cannot share a snapshot. Export them separately.",
    );
  return set.has("sample");
}
const pitchSections = [
  "Agency thesis",
  "Buyer problem",
  "Offer",
  "Delivery system",
  "Traction",
  "Retention and concentration",
  "Unit economics",
  "Market",
  "IP and brand evidence",
  "Human team",
  "Milestones and financial scenarios",
  "Capital-planning scenario",
];
export function createFinanceService(
  db: PrismaClient,
  userId: string,
  clock: () => Date = () => new Date(),
  bridge: FinanceBridge = { loadPitch: loadPersistedPitch },
) {
  return {
    async command(command: FinanceCommand | { type: string; input: unknown }) {
      return db.$transaction(async (tx) => {
        const agency = await requireOwnedAgency(tx, userId),
          now = clock(),
          agencyId = agency.id;
        switch (command.type) {
          case "finance.readiness": {
            const { input } = financeCommandSchemas[command.type].parse(
                command.input,
              ),
              p = validateProvenance(input.provenance, now);
            const actuals = await tx.financialActualPeriod.findMany({
              where: { agencyId },
            });
            for (const month of input.months) {
              const actual = actuals.find((a) => a.yearMonth === month.period);
              if (!actual)
                throw new DomainError(
                  "invalid_input",
                  `Save actuals for ${month.period} before calculating readiness.`,
                );
              const parsed = actualSchema.parse(actual.data);
              if (
                parsed.recognizedRevenueMinor !== month.revenueMinor ||
                parsed.provenance.origin !== month.provenance.origin
              )
                throw new DomainError(
                  "conflict",
                  "Readiness inputs differ from saved actuals. Refresh the evidence snapshot.",
                );
            }
            // References are agency-scoped evidence, never arbitrary browser assertions of verification.
            const sourceIds = readinessEvidenceIds(input);
            const evidence = await tx.evidenceItem.findMany({
              where: { agencyId, id: { in: sourceIds } },
            });
            if (
              new Set(evidence.map((e) => e.id)).size !==
              new Set(sourceIds).size
            )
              throw new DomainError(
                "forbidden_or_missing",
                "Save and reference your evidence in this agency before scoring.",
              );
            assertOrigins([
              ...input.months.map((m) => m.provenance.origin),
              ...evidence.map(
                (e) => provenanceSchema.parse(e.provenance).origin,
              ),
              p.origin,
            ]);
            const latest = actuals.find(
                (a) => a.yearMonth === input.asOf.slice(0, 7),
              ),
              lastActual = latest ? actualSchema.parse(latest.data) : null;
            const savedRisks = [
              ...input.riskFlags,
              ...(!lastActual || lastActual.cashMinor === null
                ? ["cash_unknown"]
                : lastActual.cashMinor <= 0
                  ? ["cash_not_positive"]
                  : []),
            ];
            const capEvidence = await tx.evidenceItem.findMany({
              where: { agencyId, metricKey: "reconciled_cap_table" },
            });
            if (!capEvidence.length) savedRisks.push("cap_table_incomplete");
            const projections = await tx.financeSnapshot.findMany({
              where: { agencyId, kind: "forecast", asOf: new Date(input.asOf) },
              orderBy: { createdAt: "desc" },
              take: 3,
            });
            for (const snapshot of projections) {
              const output = snapshot.output as {
                rows?: { cashClose: string; unserved: boolean }[];
              };
              if (output.rows?.some((r) => new D(r.cashClose).lt(0)))
                savedRisks.push("negative_projected_cash");
              if (output.rows?.some((r) => r.unserved))
                savedRisks.push("unserved_demand");
            }
            const sid = randomUUID(),
              output = scoreReadiness(
                { ...input, riskFlags: savedRisks },
                now.toISOString(),
              ),
              facts = buildFacts(sid, input.asOf, READINESS_VERSION, p, [
                {
                  key: "score",
                  label: "Seedee preparation score",
                  value: output.score,
                  section: "traction",
                },
                {
                  key: "coverage",
                  label: "Populated evidence, not verification",
                  value: output.coveragePercent,
                  section: "milestones",
                },
              ]);
            return tx.financeSnapshot.create({
              data: {
                id: sid,
                agencyId,
                kind: "readiness",
                formulaVersion: READINESS_VERSION,
                asOf: new Date(input.asOf),
                evaluatedAt: now,
                input: json({
                  ...input,
                  actualVersions: actuals
                    .filter((a) =>
                      input.months.some((m) => m.period === a.yearMonth),
                    )
                    .map((a) => ({ id: a.id, version: a.version })),
                  evidenceVersions: evidence.map((e) => ({
                    id: e.id,
                    version: e.version,
                  })),
                }),
                output: json({ ...output, facts }),
                provenance: json(p),
              },
            });
          }
          case "finance.forecast": {
            const { name, input } = financeCommandSchemas[command.type].parse(
                command.input,
              ),
              p = validateProvenance(input.provenance, now),
              sid = randomUUID(),
              output = forecast(input, now.toISOString());
            const projectedProvenance = {
              ...p,
              origin:
                p.origin === "sample"
                  ? ("sample" as const)
                  : ("assumption" as const),
            };
            const facts = buildFacts(
              sid,
              input.asOf,
              FINANCE_VERSION,
              projectedProvenance,
              output.status === "complete"
                ? [
                    {
                      key: "closing_cash",
                      label: `${name}: projected horizon cash, USD`,
                      value: money(output.rows.at(-1)!.cashClose),
                      section: "economics",
                    },
                    {
                      key: "planning_capital",
                      label: "Hypothetical planning capital, USD",
                      value: money(output.planningCapital),
                      section: "capital",
                    },
                  ]
                : [],
            );
            return tx.financeSnapshot.create({
              data: {
                id: sid,
                agencyId,
                kind: "forecast",
                formulaVersion: FINANCE_VERSION,
                asOf: new Date(input.asOf),
                evaluatedAt: now,
                input: json({ name, ...input }),
                output: json({ ...output, facts }),
                provenance: json(projectedProvenance),
              },
            });
          }
          case "finance.equity": {
            const v = financeCommandSchemas[command.type].parse(command.input),
              p = validateProvenance(v.provenance, now);
            if (new Date(v.asOf) > now)
              throw new DomainError(
                "invalid_input",
                "Scenario date cannot be in the future.",
              );
            return tx.financeSnapshot.create({
              data: {
                agencyId,
                kind: "equity",
                formulaVersion: EQUITY_VERSION,
                asOf: new Date(v.asOf),
                evaluatedAt: now,
                input: json(v.input),
                output: json(calculateEquity(v.input)),
                provenance: json({
                  ...p,
                  origin: p.origin === "sample" ? "sample" : "assumption",
                }),
              },
            });
          }
          case "export.create": {
            const v = financeCommandSchemas[command.type].parse(command.input),
              old = await tx.exportSnapshot.findUnique({
                where: {
                  agencyId_idempotencyKey: {
                    agencyId,
                    idempotencyKey: v.idempotencyKey,
                  },
                },
              });
            if (old) {
              const previous = old.manifest as {
                snapshotIds?: string[];
                evidenceIds?: string[];
                pitchId?: string | null;
              };
              if (
                JSON.stringify(previous.snapshotIds) !==
                  JSON.stringify(v.snapshotIds) ||
                JSON.stringify(previous.evidenceIds) !==
                  JSON.stringify(v.evidenceIds) ||
                previous.pitchId !== v.pitchId ||
                (old.manifest as { actualOrigin?: string }).actualOrigin !==
                  v.actualOrigin
              )
                throw new DomainError(
                  "conflict",
                  "Export request key was already used with different sources.",
                );
              return old;
            }
            if (
              new Set(v.snapshotIds).size !== v.snapshotIds.length ||
              new Set(v.evidenceIds).size !== v.evidenceIds.length
            )
              throw new DomainError(
                "invalid_input",
                "Duplicate export references.",
              );
            const snapshots = await tx.financeSnapshot.findMany({
                where: { agencyId, id: { in: v.snapshotIds } },
              }),
              evidence = await tx.evidenceItem.findMany({
                where: { agencyId, id: { in: v.evidenceIds } },
              }),
              actuals = await tx.financialActualPeriod.findMany({
                where: { agencyId },
                orderBy: { yearMonth: "asc" },
              }),
              packages = await tx.servicePackage.findMany({
                where: { agencyId },
              }),
              checklist = await tx.dataRoomItem.findMany({
                where: { agencyId },
              });
            if (
              snapshots.length !== v.snapshotIds.length ||
              evidence.length !== v.evidenceIds.length
            )
              throw new DomainError(
                "forbidden_or_missing",
                "An export source is unavailable.",
              );
            const pitch = v.pitchId
              ? await bridge.loadPitch(tx, userId, agencyId, v.pitchId)
              : null;
            if (pitch && !pitch.reviewed)
              throw new DomainError(
                "conflict",
                "Review and accept the current pitch before exporting.",
              );
            for (const sourceId of pitch?.sourceIds ?? [])
              if (
                !evidence.some((e) => e.id === sourceId) &&
                !snapshots.some((s) => s.id === sourceId)
              )
                throw new DomainError(
                  "invalid_input",
                  "Include every source referenced by the pitch in this export.",
                );
            const selectedActuals = actuals.filter(
              (a) =>
                provenanceSchema.parse(a.provenance).origin === v.actualOrigin,
            );
            const sample = assertOrigins([
              ...selectedActuals.map(
                (a) => provenanceSchema.parse(a.provenance).origin,
              ),
              ...evidence.map(
                (e) => provenanceSchema.parse(e.provenance).origin,
              ),
              ...snapshots.map(
                (s) => provenanceSchema.parse(s.provenance).origin,
              ),
              ...(pitch ? [pitch.origin] : []),
            ]);
            const generatedAt = now.toISOString(),
              manifest = {
                schemaVersion: "preparation-pack-v1",
                agencyId,
                agencyVersion: agency.version,
                generatedAt,
                snapshotIds: v.snapshotIds,
                evidenceIds: v.evidenceIds,
                pitchId: v.pitchId,
                pitchVersion: pitch?.version ?? null,
                actualOrigin: v.actualOrigin,
                confirmReviewed: v.confirmReviewed,
                sample,
                versions: {
                  readiness: READINESS_VERSION,
                  finance: FINANCE_VERSION,
                  equity: EQUITY_VERSION,
                  pitch: pitch?.templateVersion ?? null,
                },
                actualVersions: selectedActuals.map((a) => ({
                  id: a.id,
                  version: a.version,
                  origin: provenanceSchema.parse(a.provenance).origin,
                })),
                evidenceVersions: evidence.map((e) => ({
                  id: e.id,
                  version: e.version,
                })),
                unknowns: [
                  ...(!selectedActuals.length
                    ? ["No saved historical actuals"]
                    : []),
                  ...(!pitch ? ["No reviewed pitch selected"] : []),
                ],
              };
            const blocks = [
              `# ${markdownText(agency.name)} · Private preparation pack`,
              sample
                ? `**${SAMPLE_BANNER}**`
                : "**Owner-entered evidence · Self-reported, not independently verified**",
              DISCLAIMER,
              HYPOTHETICAL,
              `Generated ${generatedAt}\n\nAgency ${agencyId} · ${READINESS_VERSION} · ${FINANCE_VERSION} · ${EQUITY_VERSION}`,
              "## Agency and offers",
              markdownText(agency.positioning),
              ...packages.map(
                (p) =>
                  `### ${markdownText(p.title)}\n\nUSD ${money(new D(p.priceMinor).div(100))} · ${p.freeSample ? "explicit free/sample" : "illustrative pricing basis"}\n\n${markdownText(JSON.stringify({ deliverables: p.deliverables, exclusions: p.exclusions, pricingBasis: p.pricingBasis }))}`,
              ),
              "## Actuals · Revenue and cash remain separate",
              ...selectedActuals.map(
                (a) =>
                  `${a.yearMonth} · ${provenanceSchema.parse(a.provenance).origin} · source ${a.id} v${a.version}\n\n${markdownText(JSON.stringify(a.data))}`,
              ),
              ...snapshots.map(
                (s) =>
                  `## ${s.kind} · ${s.formulaVersion}\n\nAs of ${s.asOf.toISOString()} · evaluated ${s.evaluatedAt.toISOString()} · ${provenanceSchema.parse(s.provenance).origin} · source ${s.id}\n\n${markdownText(JSON.stringify(s.output, null, 2))}\n\nInputs and assumptions\n\n${markdownText(JSON.stringify(s.input, null, 2))}`,
              ),
              "## Evidence and source register",
              ...evidence.map(
                (e) =>
                  `### ${markdownText(e.metricKey)}\n\n${e.id} v${e.version} · ${markdownText(JSON.stringify(e.provenance))}\n\n${markdownText(JSON.stringify(e.value))}`,
              ),
              "## Preparation checklist",
              ...checklist.map(
                (c) =>
                  `- ${markdownText(c.category)} / ${markdownText(c.title)}: ${c.state}. ${markdownText(c.note)} · review ${c.reviewedAt?.toISOString() ?? "unknown"} · sources ${markdownText(JSON.stringify(c.evidenceIds))}`,
              ),
              "## Private pitch",
              pitch
                ? markdownText(pitch.content)
                : pitchSections
                    .map((title, i) => `${i + 1}. ${title}: [Evidence needed]`)
                    .join("\n\n"),
              "## Unknowns and risk notes",
              ...manifest.unknowns.map((s) => `- ${s}`),
              "Sample data and hypothetical scenarios are not actual business performance. Self-reported records may be incomplete or incorrect. Missing rights, cash, capacity and cap-table evidence remain unresolved. No legal compliance or funding outcome is certified.",
            ];
            const forecastSnapshot = snapshots.find(
              (s) => s.kind === "forecast",
            );
            const forecastInput = forecastSnapshot
              ? { ...(forecastSnapshot.input as Record<string, unknown>) }
              : null;
            if (forecastInput) delete forecastInput.name;
            const forecastOutput =
              forecastSnapshot && forecastInput
                ? forecast(
                    forecastInput,
                    forecastSnapshot.evaluatedAt.toISOString(),
                  )
                : null;
            // Named scenario metadata is not part of the arithmetic input schema.
            const csv = forecastOutput
              ? withCsvProvenance(
                  financialCsv(forecastOutput),
                  provenanceSchema.parse(forecastSnapshot!.provenance),
                  forecastSnapshot!.formulaVersion,
                )
              : actualCsv(
                  selectedActuals.map((a) => actualSchema.parse(a.data)),
                );
            return tx.exportSnapshot.create({
              data: {
                agencyId,
                idempotencyKey: v.idempotencyKey,
                manifest: json(manifest),
                markdown: blocks.join("\n\n"),
                csv,
              },
            });
          }
          default:
            throw new DomainError("invalid_input", "Unknown finance command.");
        }
      });
    },
    async download(snapshotId: string) {
      id.parse(snapshotId);
      return db.$transaction(async (tx) => {
        const agency = await requireOwnedAgency(tx, userId),
          snapshot = await tx.exportSnapshot.findFirst({
            where: { id: snapshotId, agencyId: agency.id },
          });
        if (!snapshot)
          throw new DomainError(
            "forbidden_or_missing",
            "Export is unavailable.",
          );
        return snapshot;
      });
    },
  };
}
function actualCsv(rows: z.infer<typeof actualSchema>[]) {
  const headers = [
    "yearMonth",
    "recognizedRevenueMinor",
    "cashReceiptsMinor",
    "deliveryCostsMinor",
    "overheadMinor",
    "founderPayMinor",
    "cashTaxPaymentsMinor",
    "cashInterestPaymentsMinor",
    "cashMinor",
    "receivablesMinor",
  ] as const;
  return [
    headers.join(",") +
      ",origin,asOf,sourceReference,reviewStatus,formulaVersion",
    ...rows.map(
      (r) =>
        headers
          .map((k) => (r[k] === null ? "unknown" : String(r[k])))
          .join(",") +
        "," +
        [
          r.provenance.origin,
          r.provenance.asOf,
          r.provenance.sourceReference,
          r.provenance.reviewStatus,
          "actual-cents-v1",
        ]
          .map(csvText)
          .join(","),
    ),
  ].join("\r\n");
}

function csvText(value: string) {
  const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function withCsvProvenance(
  table: string,
  p: Provenance,
  formulaVersion: string,
) {
  return table
    .split("\r\n")
    .map(
      (row, i) =>
        row +
        "," +
        (i === 0
          ? "origin,asOf,sourceReference,reviewStatus,formulaVersion"
          : [
              p.origin,
              p.asOf,
              p.sourceReference,
              p.reviewStatus,
              formulaVersion,
            ]
              .map(csvText)
              .join(",")),
    )
    .join("\r\n");
}
async function loadPersistedPitch(
  tx: Transaction,
  userId: string,
  agencyId: string,
  pitchId: string,
): Promise<SavedPitch> {
  await requireOwnedAgency(tx, userId, agencyId);
  const row = await tx.agencyEngineState.findUnique({ where: { id: userId } });
  if (!row || row.agencyId !== agencyId)
    throw new DomainError("forbidden_or_missing", "Pitch is unavailable.");
  const schema = z
    .object({
      pitches: z.array(
        z
          .object({
            id,
            agencyId: id,
            version: z.number().int().positive(),
            previousPitchId: id.nullable(),
            input: pitchInputSchema,
            content: pitchDraftSchema.nullable(),
            status: z.enum(["generating", "generated", "failed"]),
          })
          .passthrough(),
      ),
    })
    .passthrough();
  const state = schema.parse(JSON.parse(row.payload)),
    pitch = state.pitches.find(
      (p) => p.id === pitchId && p.agencyId === agencyId,
    );
  if (!pitch || pitch.status !== "generated" || !pitch.content)
    throw new DomainError(
      "conflict",
      "Choose a saved, generated pitch before reviewing its export.",
    );
  if (
    state.pitches.some(
      (p) => p.previousPitchId === pitch.id && p.status === "generated",
    )
  )
    throw new DomainError(
      "conflict",
      "A newer pitch version exists. Review that version first.",
    );
  const sources = new Set<string>();
  for (const fact of pitch.input.facts) {
    const evidence = await tx.evidenceItem.findFirst({
      where: { id: fact.id, agencyId },
    });
    if (evidence) {
      const stored = (evidence.value as { pitchFact?: unknown }).pitchFact,
        p = provenanceSchema.parse(evidence.provenance);
      if (
        !stored ||
        evidence.version !== (fact.sourceVersion ?? 1) ||
        JSON.stringify(factSchema.parse(stored)) !==
          JSON.stringify(factSchema.parse(fact)) ||
        p.origin !== fact.origin ||
        p.asOf.slice(0, 10) !== fact.asOf ||
        p.sourceReference !== fact.sourceRef ||
        p.reviewStatus !== fact.reviewStatus
      )
        throw new DomainError(
          "conflict",
          "Pitch evidence changed; regenerate and review the pitch.",
        );
      sources.add(evidence.id);
      continue;
    }
    const snapshot = await tx.financeSnapshot.findFirst({
        where: { id: fact.sourceRef, agencyId },
      }),
      facts = snapshot
        ? (snapshot.output as { facts?: unknown[] }).facts
        : undefined;
    if (
      !snapshot ||
      !facts?.some(
        (saved) =>
          JSON.stringify(factSchema.parse(saved)) ===
          JSON.stringify(factSchema.parse(fact)),
      )
    )
      throw new DomainError(
        "forbidden_or_missing",
        "A pitch fact has no matching saved source.",
      );
    sources.add(snapshot.id);
  }
  const origins = pitch.input.facts.map((f) => f.origin);
  const sample = assertOrigins(origins);
  return {
    id: pitch.id,
    version: pitch.version,
    content: [
      pitch.content.title,
      pitch.content.disclosure,
      ...pitch.content.sections.map(
        (s) =>
          s.heading +
          "\n\n" +
          s.body +
          "\n\nSources: " +
          s.sourceIds.join(", "),
      ),
      ...pitch.content.unresolvedClaims,
      ...pitch.content.riskNotes,
    ].join("\n\n"),
    sourceIds: [...sources],
    origin: sample
      ? "sample"
      : origins.includes("user_entered")
        ? "user_entered"
        : "assumption",
    reviewed: true,
    templateVersion: pitch.content.templateVersion,
  };
}
