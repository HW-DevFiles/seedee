import { z } from "zod";
import { idSchema, text } from "@/lib/ai/contracts";
import { SAMPLE_DISCLOSURE } from "@/lib/ai/pitch";

const decimal = text(40).regex(/^\d+(?:\.\d{1,10})?$/);
const componentSchema = z.strictObject({
  key: z.enum(["R", "G", "C", "D", "H", "I", "M"]),
  points: decimal,
  maxPoints: decimal,
  unearnedPoints: decimal,
  rawDisplay: text(1000).nullable(),
  availability: z.enum(["available", "missing", "invalid"]),
  sourceIds: z.array(idSchema).max(100),
  reasonCode: text(100),
  nextAction: text(1000),
});
export const explanationInputSchema = z
  .strictObject({
    snapshotId: idSchema,
    rubricVersion: z.literal("readiness-v1.1"),
    scoreDisplay: decimal,
    stage: text(100),
    coverageDisplay: text(100),
    asOf: z.iso.date(),
    evaluatedAt: z.iso.datetime(),
    sample: z.boolean(),
    provisional: z.boolean(),
    components: z.array(componentSchema).length(7),
    riskFlags: z.array(text(1000)).max(40),
  })
  .refine(
    (value) => new Set(value.components.map((row) => row.key)).size === 7,
    "All seven components must be supplied",
  );
const order = ["R", "G", "C", "D", "H", "I", "M"];
// Compare supplied decimal gaps exactly for ordering. No score, threshold or what-if is computed here.
const sortable = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(10, "0"));
};
export function explainReadiness(raw: unknown) {
  const value = explanationInputSchema.parse(raw);
  const components = value.components.map((row) => ({
    ...row,
    explanation: `${row.key}: ${row.points}/${row.maxPoints}. ${row.rawDisplay ?? "Unknown — evidence needed"}. ${row.reasonCode}. Sources: ${row.sourceIds.join(", ") || "[Evidence needed]"}.`,
  }));
  const gaps = value.components
    .filter((row) => sortable(row.unearnedPoints) > BigInt(0))
    .sort((a, b) => {
      const delta = sortable(b.unearnedPoints) - sortable(a.unearnedPoints);
      return delta > BigInt(0)
        ? 1
        : delta < BigInt(0)
          ? -1
          : order.indexOf(a.key) - order.indexOf(b.key);
    });
  return {
    snapshotId: value.snapshotId,
    rubricVersion: value.rubricVersion,
    asOf: value.asOf,
    evaluatedAt: value.evaluatedAt,
    summary: `${value.scoreDisplay} / 100 · ${value.provisional ? "Provisional — " : ""}${value.stage}. Populated evidence: ${value.coverageDisplay}; not independently verified. ${value.sample ? SAMPLE_DISCLOSURE : "User-entered evidence is self-reported."} This score organizes preparation and does not predict funding.`,
    components,
    riskFlags: value.riskFlags,
    recommendations: gaps.slice(0, 3).map((row) => ({
      key: row.key,
      reason: row.reasonCode,
      action: row.nextAction,
      sourceIds: row.sourceIds,
      label:
        "Proposed action; factual evidence changes only if achieved and evidenced.",
    })),
    remainingGapCount: Math.max(0, gaps.length - 3),
  };
}
