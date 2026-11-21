import { DomainError } from "../workspace/contracts";
import { D, assertClosedMonth, monthsEnding, total } from "./decimal";
import {
  readinessSchema,
  READINESS_VERSION,
  SAMPLE_BANNER,
  type ReadinessInput,
} from "./contracts";

type Component = {
  key: string;
  points: string;
  maxPoints: number;
  rawValue: string | null;
  unit: string;
  availability: boolean;
  sourceIds: string[];
  reasonCode: string;
  nextThreshold: string;
};
const day = (date: string) => new Date(date).toISOString().slice(0, 10);
function inWindow(date: string, end: Date, days: number) {
  const x = new Date(`${day(date)}T00:00:00Z`).getTime();
  return x <= end.getTime() && x >= end.getTime() - (days - 1) * 86400000;
}
function unique(values: string[]) {
  return new Set(values).size === values.length;
}
export function scoreReadiness(raw: unknown, now: string) {
  const v = readinessSchema.parse(raw),
    { asOf, day: asOfDay, now: n } = assertClosedMonth(v.asOf, now);
  const end = new Date(asOfDay),
    months = monthsEnding(asOf, 6),
    components: Component[] = [],
    flags = [...v.riskFlags];
  const dates: string[] = [
    v.provenance.asOf,
    ...v.months.map((m) => m.provenance.asOf),
    ...(v.recognition ?? []).flatMap((r) => [
      r.deliveryDate,
      r.provenance.asOf,
    ]),
    ...v.packages.map((p) => p.sopCreatedAt),
    ...v.contracts.flatMap((c) => [c.serviceStart]),
    ...(v.deliveries ?? []).flatMap((d) => [
      ...[d.completedAt, d.cancelledAt].filter((x): x is string => !!x),
    ]),
    ...(v.backups ?? []).map((b) => b.acceptedAt),
    ...(v.capacity ?? []).map((c) => c.attestedAt),
    ...(v.deliveryHours ?? []).map((h) => h.date),
    ...(v.market.interviews ?? []).map((i) => i.date),
    ...(v.market.alternatives ?? []).map((a) => a.checkedAt),
  ];
  if (dates.some((d) => new Date(d).getTime() > n.getTime()))
    throw new DomainError("invalid_input", "Evidence contains a future date.");
  if (
    !unique(v.months.map((m) => m.period)) ||
    !unique((v.recognition ?? []).map((r) => r.id)) ||
    !unique(v.packages.map((p) => p.id)) ||
    !unique(v.contracts.map((c) => c.id)) ||
    !unique((v.deliveries ?? []).map((d) => d.id)) ||
    !unique((v.humans ?? []).map((h) => h.id))
  )
    throw new DomainError(
      "invalid_input",
      "Duplicate finance record IDs or periods.",
    );
  if (v.months.some((m) => !months.includes(m.period)))
    throw new DomainError(
      "invalid_input",
      "Use only the six closed UTC months ending at asOf.",
    );
  const origins = new Set([
    v.provenance.origin,
    ...v.months.map((m) => m.provenance.origin),
    ...(v.recognition ?? []).map((r) => r.provenance.origin),
  ]);
  if (origins.has("sample") && origins.has("user_entered"))
    throw new DomainError(
      "invalid_input",
      "Separate sample and user-entered snapshots.",
    );
  if (origins.has("assumption"))
    throw new DomainError(
      "invalid_input",
      "Assumptions cannot be historical traction.",
    );
  const sample = origins.has("sample");
  const get = (period: string) =>
    v.months.find((m) => m.period === period && m.closed)?.revenueMinor ?? null;
  const revenues = months.map(get),
    recent = revenues.slice(3),
    previous = revenues.slice(0, 3);
  const known = (a: (number | null)[]) =>
    a.every((x): x is number => x !== null);
  const negative =
    revenues.some((x) => x !== null && x < 0) ||
    (v.recognition ?? []).some((r) => r.amountMinor < 0 && !r.creditReference);
  const W3 = known(recent) ? total(recent) : null,
    P3 = known(previous) ? total(previous) : null,
    T = known(revenues) ? total(revenues) : null;
  if (negative) flags.push("adjustment_review_required");
  const add = (
    key: string,
    maxPoints: number,
    available: boolean,
    points: string | number,
    rawValue: string | null,
    unit: string,
    reasonCode: string,
    nextThreshold: string,
    sourceIds: string[] = [],
  ) => {
    components.push({
      key,
      maxPoints,
      availability: available,
      points: available ? new D(points).toString() : "0",
      rawValue,
      unit,
      reasonCode: available ? reasonCode : "missing_or_invalid_evidence",
      nextThreshold,
      sourceIds,
    });
  };
  const rAvailable = W3 !== null && !negative;
  const rPoints =
    W3 === null
      ? 0
      : W3.gte(7500000)
        ? 18
        : W3.gte(4500000)
          ? 14
          : W3.gte(1500000)
            ? 8
            : W3.gt(0)
              ? 3
              : 0;
  add(
    "R",
    18,
    rAvailable,
    rPoints,
    W3?.div(300).toString() ?? null,
    "USD/month",
    "revenue_evidence",
    "Three closed months of earned revenue",
    months.slice(3),
  );
  const gAvailable = W3 !== null && P3 !== null && !negative,
    growth = P3?.gt(0) && W3 ? W3.div(P3).minus(1) : null;
  const gPoints =
    !gAvailable || !P3 || !W3 || P3.lt(1500000)
      ? 0
      : W3.times(100).gte(P3.times(125))
        ? 12
        : W3.times(100).gte(P3.times(110))
          ? 9
          : W3.gte(P3)
            ? 6
            : W3.times(100).gte(P3.times(90))
              ? 3
              : 0;
  add(
    "G",
    12,
    gAvailable,
    gPoints,
    growth?.toString() ?? null,
    "fraction",
    !P3?.gt(0)
      ? "growth_undefined"
      : P3.lt(1500000)
        ? "growth_small_base"
        : "growth_evidence",
    "Prior three months must total at least $15,000",
    months,
  );
  const lines = v.recognition ?? [];
  const attributionValid =
    v.recognition !== null &&
    T !== null &&
    months.every((period) =>
      total(
        lines.filter((l) => l.period === period).map((l) => l.amountMinor),
      ).eq(get(period) ?? -1),
    ) &&
    lines.every((l) => months.includes(l.period));
  const byGroup = new Map<string, InstanceType<typeof D>>();
  for (const line of lines)
    byGroup.set(
      line.clientGroupId,
      (byGroup.get(line.clientGroupId) ?? new D(0)).plus(line.amountMinor),
    );
  const groupNegative = [...byGroup.values()].some((a) => a.lt(0));
  if (groupNegative) flags.push("adjustment_review_required");
  if (v.recognition !== null && !attributionValid)
    flags.push("recognition_reconciliation_required");
  const maxGroup = D.max(0, ...byGroup.values()),
    cAvailable = attributionValid && !negative && !groupNegative;
  const concentration = T?.gt(0) && cAvailable ? maxGroup.div(T) : null;
  const cPoints = !T?.gt(0)
    ? 0
    : maxGroup.times(5).lte(T)
      ? 15
      : maxGroup.times(100).lte(T.times(35))
        ? 11
        : maxGroup.times(2).lte(T)
          ? 6
          : 0;
  add(
    "C",
    15,
    cAvailable,
    cPoints,
    concentration?.toString() ?? null,
    "fraction",
    T?.gt(0) ? "client_concentration" : "no_activity",
    "Largest economic client group at 20%, 35%, 50% boundaries",
    lines.map((l) => l.id),
  );
  if (concentration?.gt("0.5")) flags.push("client_concentration_high");
  const eligiblePackages = new Set(
    v.packages
      .filter((p) => {
        const uses = (v.deliveries ?? []).filter(
          (d) =>
            d.packageId === p.id &&
            d.sopVersion === p.sopVersion &&
            d.completedAt &&
            months.includes(d.completedAt.slice(0, 7)) &&
            new Date(p.sopCreatedAt) <= new Date(d.completedAt),
        );
        return new Set(uses.map((d) => d.clientGroupId)).size >= 2;
      })
      .map((p) => p.id),
  );
  const packageRevenue = total(
    lines
      .filter((l) => {
        const p = v.packages.find((p) => p.id === l.packageId),
          d = v.deliveries?.find((d) => d.id === l.deliveryId);
        return (
          p &&
          d &&
          eligiblePackages.has(p.id) &&
          l.sopVersion === p.sopVersion &&
          d.sopVersion === p.sopVersion &&
          d.completedAt &&
          new Date(p.sopCreatedAt) <= new Date(l.deliveryDate) &&
          day(d.completedAt) === day(l.deliveryDate) &&
          d.clientGroupId === l.clientGroupId &&
          d.serviceId === l.serviceId
        );
      })
      .map((l) => l.amountMinor),
  );
  const retainerRevenue = total(
    lines
      .filter((l) => {
        const c = v.contracts.find((c) => c.id === l.contractId);
        return (
          c &&
          new Date(c.serviceStart) <= new Date(l.deliveryDate) &&
          new Date(c.serviceEnd) >= new Date(l.deliveryDate)
        );
      })
      .map((l) => l.amountMinor),
  );
  const p = T?.gt(0) ? packageRevenue.div(T) : null,
    r = T?.gt(0) ? retainerRevenue.div(T) : null;
  const deliveries =
    v.deliveries?.filter(
      (d) =>
        inWindow(d.originalDueAt, end, 90) &&
        !(
          d.cancelledAt &&
          d.cancellationReason &&
          new Date(d.cancelledAt) <= end
        ),
    ) ?? [];
  const onTime = deliveries.filter(
    (d) =>
      d.completedAt && new Date(d.completedAt) <= new Date(d.originalDueAt),
  ).length;
  const o = deliveries.length ? new D(onTime).div(deliveries.length) : null;
  add(
    "D_package",
    8,
    cAvailable && v.deliveries !== null && !!p?.gte(0) && !!p?.lte(1),
    p?.times(8).toString() ?? 0,
    p?.toString() ?? null,
    "fraction",
    T?.gt(0) ? "qualified_package_revenue" : "no_activity",
    "Fixed scope, cost basis, checklist and SOP at delivery for two client groups",
    lines.map((l) => l.id),
  );
  // Known zero denominator is available with no activity, not missing.
  if (cAvailable && T?.eq(0))
    components[components.length - 1] = {
      ...components[components.length - 1],
      availability: true,
      reasonCode: "no_activity",
    };
  add(
    "D_retainer",
    6,
    cAvailable && (r === null || (r.gte(0) && r.lte(1))),
    r?.times(6).toString() ?? 0,
    r?.toString() ?? null,
    "fraction",
    T?.gt(0) ? "earned_recurring_contract" : "no_activity",
    "Earned work under recurring contract",
    lines.map((l) => l.id),
  );
  add(
    "D_ontime",
    6,
    v.deliveries !== null,
    o?.times(6).toString() ?? 0,
    o?.toString() ?? null,
    "fraction",
    deliveries.length ? "original_due_dates" : "no_activity",
    "Completed by original commitment, including overdue unfinished work",
    deliveries.map((d) => d.id),
  );
  const checked = (
    key: string,
    max: number,
    check: ReadinessInput["accountableOwner"],
    threshold: string,
    supported = true,
  ) =>
    add(
      key,
      max,
      check.value !== null &&
        (check.value === false ||
          (check.sourceIds.length > 0 && !!check.note && supported)),
      check.value ? max : 0,
      check.value === null ? null : String(check.value),
      "boolean",
      "owner_reported",
      threshold,
      check.sourceIds,
    );
  checked(
    "H_owner",
    2,
    v.accountableOwner,
    "Accountable human owner with evidence",
  );
  const humans = v.humans?.filter(
    (h) =>
      !h.simulated &&
      h.compensationMinor > 0 &&
      new Date(h.agreementStart) <= end &&
      (!h.agreementEnd || new Date(h.agreementEnd) >= end),
  );
  add(
    "H_paid",
    2,
    v.humans !== null,
    (humans?.length ?? 0) >= 2 ? 2 : 0,
    humans ? String(humans.length) : null,
    "humans",
    "paid_humans",
    "Two distinct paid humans with documented roles",
    humans?.flatMap((h) => h.sourceIds) ?? [],
  );
  const serviceTotals = new Map<string, InstanceType<typeof D>>();
  lines.forEach((l) =>
    serviceTotals.set(
      l.serviceId,
      (serviceTotals.get(l.serviceId) ?? new D(0)).plus(l.amountMinor),
    ),
  );
  const material = [...serviceTotals]
    .filter(([, a]) => T?.gt(0) && a.times(10).gte(T))
    .map(([k]) => k);
  const materialServices = material.length
    ? material
    : (v.capacity ?? [])
        .filter((c) => c.plannedHours !== null && c.plannedHours > 0)
        .map((c) => c.id);
  const backup =
    materialServices.length > 0 &&
    materialServices.every((serviceId) =>
      v.backups?.some(
        (b) =>
          b.serviceId === serviceId &&
          new Date(b.acceptedAt) <= end &&
          humans?.some((h) => h.id === b.humanId && !h.isFounder),
      ),
    );
  add(
    "H_backup",
    2,
    v.backups !== null && materialServices.length > 0,
    backup ? 2 : 0,
    v.backups === null ? null : String(backup),
    "boolean",
    "nonfounder_backup",
    "Named nonfounder accepts each material service",
    v.backups?.map((b) => b.sourceId) ?? [],
  );
  const nextMonth = monthsEnding(
    new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 2, 0)),
    1,
  )[0];
  const capAvailable =
    v.capacity !== null &&
    v.capacity.length > 0 &&
    v.capacity.every(
      (c) =>
        c.availableHours !== null &&
        c.plannedHours !== null &&
        c.period === nextMonth &&
        inWindow(c.attestedAt, end, 30),
    );
  const capOK =
    capAvailable &&
    materialServices.length > 0 &&
    materialServices.every((s) =>
      v.capacity!.some((c) => c.id === s || c.serviceIds.includes(s)),
    ) &&
    v.capacity!.every(
      (c) =>
        c.humanIds.every((h) => humans?.some((person) => person.id === h)) &&
        new D(c.availableHours!).gt(0) &&
        new D(c.plannedHours!)
          .times(100)
          .lte(new D(c.availableHours!).times(85)),
    );
  add(
    "H_capacity",
    2,
    capAvailable,
    capOK ? 2 : 0,
    capAvailable ? String(capOK) : null,
    "boolean",
    "capacity_plan",
    "Current paid resource pools within 85%",
    v.capacity?.map((c) => c.sourceId) ?? [],
  );
  const logs = v.deliveryHours?.filter((h) => inWindow(h.date, end, 90)),
    logValid = logs?.every((l) =>
      v.humans?.some((h) => h.id === l.humanId && !h.simulated),
    );
  const allHours = total(logs?.map((l) => l.hours) ?? []),
    founderHours = total(
      logs
        ?.filter((l) =>
          v.humans?.some((h) => h.id === l.humanId && h.isFounder),
        )
        .map((l) => l.hours) ?? [],
    );
  const founderShare = allHours.gt(0) ? founderHours.div(allHours) : null;
  add(
    "H_founder",
    2,
    v.deliveryHours !== null && !!logValid,
    founderShare && founderShare.lte("0.6") ? 2 : 0,
    founderShare?.toString() ?? null,
    "fraction",
    allHours.gt(0) ? "founder_delivery_share" : "no_activity",
    "Founder share at most 60%",
    logs?.map((l) => l.sourceId) ?? [],
  );
  if (founderHours.gt(0) && !humans?.some((h) => h.isFounder))
    flags.push("founder_unpaid_labor");
  checked(
    "I_chain",
    5,
    v.ip.chainOfTitle,
    "Per-deliverable assignments/licenses and owner-attested chain of title",
    !!v.ip.inventory?.length &&
      v.ip.inventory
        .filter((i) => i.material)
        .every((i) => !!i.assignmentOrLicenseRef && i.ownerAttested),
  );
  checked(
    "I_assets",
    4,
    v.ip.assetRegister,
    "Reusable asset inventory with rights classifications",
    !!v.ip.assets?.length,
  );
  checked(
    "I_brand",
    3,
    v.ip.brandPermissions,
    "Consistent identity and recorded asset permissions",
    !!v.ip.identity,
  );
  checked(
    "I_cases",
    3,
    v.ip.caseStudies,
    "Two distinct completed-client outcome cases with permission",
    new Set(
      v.ip.cases
        ?.filter(
          (c) =>
            new Date(c.completedAt) <= end &&
            v.deliveries?.some(
              (d) =>
                d.clientGroupId === c.clientGroupId &&
                d.completedAt &&
                new Date(d.completedAt) <= end,
            ),
        )
        .map((c) => c.clientGroupId),
    ).size >= 2,
  );
  if (v.ip.chainOfTitle.value !== true) flags.push("missing_ip_rights");
  const target = [
    v.market.segment,
    v.market.buyer,
    v.market.geography,
    v.market.problem,
  ];
  add(
    "M_target",
    2,
    target.every((x) => x !== null),
    target.every((x) => !!x?.trim()) ? 2 : 0,
    target.some((x) => x === null) ? null : target.join(" / "),
    "text",
    "market_definition",
    "Segment, buyer, geography and problem",
  );
  const interviews = v.market.interviews?.filter((i) =>
    inWindow(i.date, end, 180),
  );
  add(
    "M_interviews",
    3,
    v.market.interviews !== null,
    new Set(interviews?.map((i) => i.organization)).size >= 5 ? 3 : 0,
    interviews
      ? String(new Set(interviews.map((i) => i.organization)).size)
      : null,
    "organizations",
    "buyer_interviews",
    "Five distinct dated target-buyer organizations",
    interviews?.map((i) => i.sourceId) ?? [],
  );
  const alternatives = v.market.alternatives?.filter((a) =>
    inWindow(a.checkedAt, end, 180),
  );
  add(
    "M_alternatives",
    2,
    v.market.alternatives !== null,
    new Set(alternatives?.map((a) => a.id)).size >= 3 ? 2 : 0,
    alternatives ? String(alternatives.length) : null,
    "alternatives",
    "priced_alternatives",
    "Three priced alternatives with recent HTTPS sources",
    alternatives?.map((a) => a.id) ?? [],
  );
  const model = v.market.model;
  if (model && new D(model.downsideWinRate).gt(model.winRate))
    throw new DomainError(
      "invalid_input",
      "Downside win rate exceeds base win rate.",
    );
  const SAM = model ? new D(model.buyers).times(model.annualSpend) : null;
  const SOM =
    model && SAM
      ? D.min(
          new D(model.reachableProspects)
            .times(model.winRate)
            .times(model.annualRevenuePerClient),
          model.capacityCeiling,
          SAM,
        )
      : null;
  add(
    "M_model",
    3,
    v.market.modelAssessed,
    model ? 3 : 0,
    SOM?.toString() ?? null,
    "USD/12months",
    model ? "bottom_up_market" : "model_not_completed",
    "Sourced and labeled SAM/SOM with downside sensitivity",
    model?.sourceIds ?? [],
  );
  const rawScore = total(components.map((c) => c.points)),
    score = rawScore.toDecimalPlaces(1),
    coverage = total(
      components.filter((c) => c.availability).map((c) => c.maxPoints),
    );
  const age = Math.floor(
    (Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - asOfDay) /
      86400000,
  );
  const provisional = coverage.lt(80) || !known(revenues) || age > 45;
  const stage = score.gte(80)
    ? "Assemble the diligence pack"
    : score.gte(60)
      ? "Strengthen the evidence"
      : score.gte(40)
        ? "Document traction"
        : "Build the foundations";
  const order = ["R", "G", "C", "D", "H", "I", "M"];
  const grouped = order.map((key) => ({
    key,
    maxPoints: components
      .filter((c) => c.key.startsWith(key))
      .reduce((a, c) => a + c.maxPoints, 0),
    points: total(
      components.filter((c) => c.key.startsWith(key)).map((c) => c.points),
    ).toString(),
  }));
  const gaps = grouped
    .map((c) => ({
      ...c,
      unearned: new D(c.maxPoints).minus(c.points).toString(),
    }))
    .filter((c) => new D(c.unearned).gt(0))
    .sort(
      (a, b) =>
        new D(b.unearned).cmp(a.unearned) ||
        order.indexOf(a.key) - order.indexOf(b.key),
    );
  return {
    formulaVersion: READINESS_VERSION,
    asOf: v.asOf,
    evaluatedAt: now,
    score: score.toFixed(1),
    rawScore: rawScore.toString(),
    coveragePercent: coverage.toString(),
    coverageDenominator: 100,
    stage: `${provisional ? "Provisional · " : ""}${stage}`,
    provisional,
    ageDays: age,
    components,
    grouped,
    gaps: gaps.slice(0, 3),
    allGaps: gaps,
    riskFlags: [...new Set(flags)],
    sampleBanner: sample ? SAMPLE_BANNER : null,
    verification: "Self-reported or sample; not independently verified",
    market: {
      sam: SAM?.toString() ?? null,
      som: SOM?.toString() ?? null,
      downsideSom:
        model && SAM
          ? D.min(
              new D(model.reachableProspects)
                .times(model.downsideWinRate)
                .times(model.annualRevenuePerClient),
              model.capacityCeiling,
              SAM,
            ).toString()
          : null,
    },
  };
}
export function simulateReadiness(
  baseline: unknown,
  completeHypothetical: unknown,
  now: string,
) {
  const before = scoreReadiness(baseline, now),
    after = scoreReadiness(completeHypothetical, now);
  if (after.riskFlags.includes("recognition_reconciliation_required"))
    throw new DomainError(
      "invalid_input",
      "Hypothetical patch must reconcile all recognition dimensions.",
    );
  return {
    label: "If achieved and evidenced; hypothetical only",
    baseline: before,
    hypothetical: after,
    totalDelta: new D(after.score)
      .minus(before.score)
      .toDecimalPlaces(1)
      .toFixed(1),
    proposal: readinessSchema.parse(completeHypothetical),
  };
}
export function emptyReadiness(
  asOf: string,
  origin: "sample" | "user_entered" = "user_entered",
): ReadinessInput {
  const blank = { value: null, sourceIds: [], note: "" };
  return readinessSchema.parse({
    asOf,
    currency: "USD",
    months: [],
    recognition: null,
    packages: [],
    contracts: [],
    deliveries: null,
    humans: null,
    accountableOwner: blank,
    backups: null,
    capacity: null,
    deliveryHours: null,
    ip: {
      chainOfTitle: blank,
      assetRegister: blank,
      brandPermissions: blank,
      caseStudies: blank,
    },
    market: {
      segment: null,
      buyer: null,
      geography: null,
      problem: null,
      interviews: null,
      alternatives: null,
      model: null,
      modelAssessed: false,
    },
    riskFlags: ["cash_unknown", "cap_table_incomplete"],
    provenance: {
      origin,
      asOf,
      sourceReference: "Owner workspace",
      reviewStatus: "unreviewed",
    },
  });
}
export type ReadinessResult = ReturnType<typeof scoreReadiness>;

const PROVISIONAL = "Provisional · ";
// C4 read-time freshness for an immutable saved snapshot. Points, coverage
// and evaluatedAt never change; only the Provisional label is re-derived at
// the caller's explicit `now`. Completeness reasons come from the saved input
// and output, not from the stored Boolean, which may hold a historical age.
export function readinessFreshness(
  savedInput: unknown,
  saved: Pick<ReadinessResult, "asOf" | "coveragePercent" | "stage">,
  now: string,
) {
  const input = { ...(savedInput as Record<string, unknown>) };
  delete input.actualVersions;
  delete input.evidenceVersions;
  const parsed = readinessSchema.safeParse(input);
  const asOf = new Date(saved.asOf),
    n = new Date(now);
  const asOfDay = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  );
  const ageDays = Math.floor(
    (Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - asOfDay) /
      86400000,
  );
  const reasons: string[] = [];
  if (new D(saved.coveragePercent).lt(80)) reasons.push("coverage_below_80");
  if (!parsed.success) reasons.push("saved_input_unreadable");
  else if (
    monthsEnding(asOf, 6).some(
      (period) =>
        !parsed.data.months.some(
          (m) => m.period === period && m.closed && m.revenueMinor !== null,
        ),
    )
  )
    reasons.push("fewer_than_six_closed_months");
  if (ageDays > 45) reasons.push("older_than_45_days");
  const base = saved.stage.startsWith(PROVISIONAL)
    ? saved.stage.slice(PROVISIONAL.length)
    : saved.stage;
  return {
    provisional: reasons.length > 0,
    reasons,
    ageDays,
    assessedAt: n.toISOString(),
    stage: `${reasons.length ? PROVISIONAL : ""}${base}`,
  };
}
