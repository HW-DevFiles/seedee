import { z } from "zod";
import { DomainError, cents, id } from "../workspace/contracts";
import { READINESS_VERSION, readinessSchema } from "./contracts";
import { D, monthsEnding, total } from "./decimal";
import { scoreReadiness, simulateReadiness } from "./readiness";

export const milestoneSchema = z
  .object({
    baselineId: id,
    milestone: z.literal("revenue_fixed_dollars"),
    revenueMinor: z.tuple([cents, cents, cents]),
  })
  .strict();
export const milestoneTitle = "Grow three-month earned revenue";
export const milestoneAssumptions = [
  "Package and retainer dollars stay fixed; remaining revenue is allocated across existing client/service delivery lines in their original proportions, rounded to cents.",
  "All other saved evidence is carried forward as a hypothetical assumption. No additional staffing, delivery, rights or market evidence is asserted.",
  "Targets describe an alternative to the saved three-month window, not a forecast or achieved performance. Actuals and actual readiness do not change.",
];
export function readinessBaseline(input: unknown) {
  const saved = { ...z.record(z.string(), z.unknown()).parse(input) };
  delete saved.actualVersions;
  delete saved.evidenceVersions;
  return readinessSchema.parse(saved);
}
export function previewMilestone(
  input: unknown,
  targets: [number, number, number],
  now: string,
) {
  const baseline = readinessBaseline(input);
  const periods = monthsEnding(new Date(baseline.asOf), 6);
  const before = scoreReadiness(baseline, now);
  const needed = () =>
    new DomainError(
      "invalid_input",
      "Evidence needed: save six known closed months and reconciled client/service recognition before previewing this milestone.",
    );
  if (
    periods.some(
      (period) =>
        !baseline.months.some(
          (m) => m.period === period && m.closed && m.revenueMinor !== null,
        ),
    ) ||
    !baseline.recognition?.length ||
    before.riskFlags.includes("recognition_reconciliation_required") ||
    baseline.recognition.some((l) => l.amountMinor < 0)
  )
    throw needed();
  const proposal = structuredClone(baseline);
  for (const [i, period] of periods.slice(3).entries()) {
    const target = cents.parse(targets[i]);
    const lines = proposal.recognition!.filter((l) => l.period === period);
    const flexible = lines.filter(
      (l) => l.packageId === null && l.contractId === null,
    );
    const fixed = total(
      lines.filter((l) => !flexible.includes(l)).map((l) => l.amountMinor),
    );
    const remainder = new D(target).minus(fixed);
    const weights = total(flexible.map((l) => l.amountMinor));
    if (remainder.lt(0) || !flexible.length || !weights.gt(0))
      throw new DomainError(
        "invalid_input",
        "Evidence needed: each target must cover fixed package/retainer dollars and have positive uncommitted client/service allocation.",
      );
    // Largest remainder allocation preserves exact monthly cents and every dimension.
    const shares = flexible.map((line, index) => {
      const exact = remainder.times(line.amountMinor).div(weights);
      return {
        line,
        index,
        cents: exact.floor(),
        fraction: exact.minus(exact.floor()),
      };
    });
    const residual = remainder
      .minus(total(shares.map((s) => s.cents)))
      .toNumber();
    [...shares]
      .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index)
      .slice(0, residual)
      .forEach((s) => {
        s.cents = s.cents.plus(1);
      });
    shares.forEach((s) => {
      s.line.amountMinor = s.cents.toNumber();
    });
    proposal.months.find((m) => m.period === period)!.revenueMinor = target;
  }
  return {
    ...simulateReadiness(baseline, proposal, now),
    formulaVersion: READINESS_VERSION,
    milestone: "revenue_fixed_dollars" as const,
    title: milestoneTitle,
    assumptions: milestoneAssumptions,
    targets: periods
      .slice(3)
      .map((period, i) => ({ period, revenueMinor: targets[i] })),
    evaluatedAt: now,
  };
}
export type MilestonePreview = ReturnType<typeof previewMilestone> & {
  sourceSnapshotId: string;
  sourceVersion: string;
};
