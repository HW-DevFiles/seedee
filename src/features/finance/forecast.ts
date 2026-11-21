import { DomainError } from "../workspace/contracts";
import { D, assertClosedMonth, total, ratio, money } from "./decimal";
import {
  forecastSchema,
  FINANCE_VERSION,
  HYPOTHETICAL,
  type ForecastInput,
} from "./contracts";

export function forecast(raw: unknown, now: string) {
  const v = forecastSchema.parse(raw),
    { asOf } = assertClosedMonth(v.asOf, now);
  const fail = (message: string): never => {
    throw new DomainError("invalid_input", message);
  };
  if (new D(v.growth).lt(-1)) fail("Demand growth must be at least -100%.");
  if (
    new Set(v.services.map((s) => s.id)).size !== v.services.length ||
    new Set(v.pools.map((p) => p.id)).size !== v.pools.length
  )
    fail("Duplicate service or pool IDs.");
  if (
    v.services.some((s) =>
      Object.keys(s.hoursPerPool).some((k) => !v.pools.some((p) => p.id === k)),
    )
  )
    fail("Service references an unknown capacity pool.");
  if (
    v.services.some(
      (s) => !Object.values(s.hoursPerPool).some((h) => new D(h).gt(0)),
    )
  )
    fail("Each service needs entered positive human delivery hours.");
  if (new D(v.founderCompensation).gt(v.overhead))
    fail("Founder compensation must be included once in overhead.");
  const incomplete = [
    ...(new D(v.openingPayables).gt(0)
      ? ["opening_payables_schedule_required"]
      : []),
    ...(new D(v.openingDeferredRevenue).gt(0)
      ? ["deferred_revenue_schedule_required"]
      : []),
    ...(new D(v.openingDebt).gt(0) ? ["debt_schedule_required"] : []),
    ...(v.taxRate === null &&
    (!v.taxSchedule || v.taxSchedule.length !== v.horizon)
      ? ["tax_cash_estimate_incomplete"]
      : []),
  ];
  if (incomplete.length)
    return {
      formulaVersion: FINANCE_VERSION,
      status: "incomplete" as const,
      reasons: incomplete,
      rows: [],
      label: HYPOTHETICAL,
    };
  if (v.taxRate !== null && v.taxSchedule !== null)
    fail(
      "Choose a synthetic tax buffer or entered cash tax schedule, not both.",
    );
  if (v.financing.length && v.financing.length !== v.horizon)
    fail("Financing schedule must cover the complete horizon.");
  let cash = new D(v.openingCash),
    ar = new D(v.openingReceivables),
    prior = new D(0);
  const warnings = [
    "Proportional expected-value capacity allocation; unserved demand is not revenue or backlog.",
    "Invoiced when earned; no deposits, defaults, refunds or cost deferrals.",
    "Capacity hire retains per-unit labor cost, conservatively double-counting labor on hire-served units.",
  ];
  if (v.taxRate !== null)
    warnings.push(
      "Synthetic cash tax buffer, not a jurisdictional tax calculation.",
    );
  if (
    v.founderReplacementHourlyRate === null ||
    v.founderReplacementHours === null ||
    v.retainedFounderNonDeliveryPay === null
  )
    warnings.push("Founder replacement cost not entered.");
  if (
    v.founderDeliveryHours !== null &&
    new D(v.founderDeliveryHours).gt(0) &&
    new D(v.founderCompensation).eq(0)
  )
    warnings.push(
      "Founder labor is unpaid or unknown in this model; recorded margins and cash omit replacement pay.",
    );
  if (
    v.founderDeliveryHours !== null &&
    new D(v.founderDeliveryHours).gt(0) &&
    (v.founderDeliveryPayFraction === null ||
      new D(v.founderDeliveryPayFraction).eq(0))
  )
    warnings.push(
      "Founder delivery-pay allocation is missing or zero despite recorded delivery hours.",
    );
  const rows = Array.from({ length: v.horizon }, (_, index) => {
    const t = index + 1,
      growth = new D(1).plus(v.growth).pow(index).times(v.volumeMultiplier);
    const units = v.services.map((s) => new D(s.demandUnits).times(growth));
    const demandHours = v.pools.map((p) =>
      total(
        v.services.map((s, i) => units[i].times(s.hoursPerPool[p.id] ?? 0)),
      ),
    );
    const hired = v.hireMonth !== null && t >= v.hireMonth;
    const available = v.pools.map((p) =>
      new D(p.availableHours).plus(hired ? p.hireAdditionalHours : 0),
    );
    const scale = D.min(
      1,
      ...demandHours.map((h, i) =>
        h.gt(0) ? available[i].times("0.85").div(h) : new D(1),
      ),
    );
    const delivered = units.map((u) => u.times(scale));
    const revenue = total(
        v.services.map((s, i) => delivered[i].times(s.unitPrice)),
      ),
      direct = total(
        v.services.map((s, i) => delivered[i].times(s.unitDirectCost)),
      );
    const inflation = new D(1).plus(v.overheadGrowth).pow(index);
    const overhead = new D(v.overhead)
      .times(inflation)
      .plus(v.fixedFounderPremium)
      .plus(hired ? v.hireMonthlyCost : 0);
    const founderPay = new D(v.founderCompensation)
      .times(inflation)
      .plus(v.fixedFounderPremium);
    const grossProfit = revenue.minus(direct),
      surplus = grossProfit.minus(overhead);
    const tax = v.taxSchedule
      ? new D(v.taxSchedule[index])
      : D.max(surplus, 0).times(v.taxRate!);
    const receipts = revenue
      .times(v.collectionFraction)
      .plus(
        index === 0
          ? v.openingReceivables
          : prior.times(new D(1).minus(v.collectionFraction)),
      );
    const arOpen = ar;
    ar = ar.plus(revenue).minus(receipts);
    if (ar.lt(0)) fail("Receipts exceed invoice balances.");
    const capex = new D(index === 0 ? v.capexMonth1 : 0),
      financing = new D(v.financing[index] ?? 0);
    const flow = receipts
        .minus(direct)
        .minus(overhead)
        .minus(tax)
        .minus(capex)
        .plus(financing),
      cashOpen = cash;
    cash = cash.plus(flow);
    prior = revenue;
    const founderDelivery =
      v.founderDeliveryPayFraction === null
        ? null
        : founderPay.times(v.founderDeliveryPayFraction);
    const loadedMargin =
      founderDelivery === null
        ? null
        : ratio(revenue.minus(direct).minus(founderDelivery), revenue);
    const replacement =
      v.founderReplacementHourlyRate !== null &&
      v.founderReplacementHours !== null
        ? new D(v.founderReplacementHourlyRate).times(v.founderReplacementHours)
        : null;
    const normalizedCost =
      replacement !== null && v.retainedFounderNonDeliveryPay !== null
        ? replacement.plus(v.retainedFounderNonDeliveryPay)
        : null;
    return {
      month: t,
      period: new Date(
        Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + t, 1),
      )
        .toISOString()
        .slice(0, 7),
      classification: "projected",
      revenue: revenue.toString(),
      direct: direct.toString(),
      overhead: overhead.toString(),
      grossProfit: grossProfit.toString(),
      grossMargin: ratio(grossProfit, revenue),
      operatingSurplus: surplus.toString(),
      tax: tax.toString(),
      receipts: receipts.toString(),
      arOpen: arOpen.toString(),
      arClose: ar.toString(),
      capex: capex.toString(),
      financing: financing.toString(),
      netCashFlow: flow.toString(),
      cashOpen: cashOpen.toString(),
      cashClose: cash.toString(),
      scale: scale.toString(),
      unserved: units.some((u, i) => u.gt(delivered[i])),
      services: v.services.map((s, i) => ({
        id: s.id,
        demanded: units[i].toString(),
        delivered: delivered[i].toString(),
        unserved: units[i].minus(delivered[i]).toString(),
      })),
      capacity: v.pools.map((p, i) => ({
        id: p.id,
        demandHours: demandHours[i].toString(),
        availableHours: available[i].toString(),
        deliveredHours: demandHours[i].times(scale).toString(),
        utilization: ratio(demandHours[i].times(scale), available[i]),
      })),
      founderPay: founderPay.toString(),
      founderDeliveryPay: founderDelivery?.toString() ?? null,
      founderLoadedDirect: founderDelivery?.plus(direct).toString() ?? null,
      founderLoadedOverhead:
        founderDelivery === null
          ? null
          : overhead.minus(founderDelivery).toString(),
      founderLoadedDeliveryMargin: loadedMargin,
      replacementDeliveryCost: replacement?.toString() ?? null,
      normalizedFounderCost: normalizedCost?.toString() ?? null,
      normalizedDeliveryMargin:
        replacement === null
          ? null
          : ratio(revenue.minus(direct).minus(replacement), revenue),
      replacementStressOverhead:
        normalizedCost === null
          ? null
          : overhead.minus(founderPay).plus(normalizedCost).toString(),
      breakEven:
        grossProfit.gt(0) && revenue.gt(0)
          ? overhead.div(grossProfit.div(revenue)).toString()
          : null,
      riskFlags: [
        ...(cash.lte(0) ? ["cash_not_positive"] : []),
        ...(cash.lt(0) ? ["negative_projected_cash"] : []),
        ...(scale.lt(1) ? ["unserved_demand"] : []),
        ...(grossProfit.lte(0) ? ["no_finite_break_even"] : []),
      ],
    };
  });
  const minimum = D.min(v.openingCash, ...rows.map((r) => r.cashClose)),
    gap = D.max(0, new D(v.reserve).minus(minimum));
  const horizonFlow = total(rows.slice(-3).map((r) => r.netCashFlow)).div(3),
    firstDeficit = rows.find((r) => new D(r.cashClose).lt(0));
  const years = [
    rows.slice(0, 12),
    ...(v.horizon === 24 ? [rows.slice(12)] : []),
  ].map((ys, index) => ({
    year: index + 1,
    revenue: total(ys.map((r) => r.revenue)).toString(),
    direct: total(ys.map((r) => r.direct)).toString(),
    overhead: total(ys.map((r) => r.overhead)).toString(),
    operatingSurplus: total(ys.map((r) => r.operatingSurplus)).toString(),
    tax: total(ys.map((r) => r.tax)).toString(),
    cashClose: ys[ys.length - 1].cashClose,
  }));
  return {
    formulaVersion: FINANCE_VERSION,
    status: "complete" as const,
    label: HYPOTHETICAL,
    rows,
    years,
    warnings,
    firstDeficitMonth: firstDeficit?.month ?? null,
    firstDeficitPeriod: firstDeficit?.period ?? null,
    fullyFundedMonths: firstDeficit ? firstDeficit.month - 1 : v.horizon,
    deficitLabel: firstDeficit
      ? `First deficit in month ${firstDeficit.month}`
      : `No deficit within ${v.horizon} modeled months`,
    minimumCash: minimum.toString(),
    gap: gap.toString(),
    planningCapital: gap
      .times(new D(1).plus(v.contingency))
      .plus(v.financingCosts)
      .toString(),
    horizonMeanNetCashFlow: horizonFlow.toString(),
    horizonNetBurn: D.max(0, horizonFlow.negated()).toString(),
    minimumAtHorizon: new D(rows[rows.length - 1].cashClose).eq(minimum),
    forwardReceiptsStopMonths: ratio(
      v.openingCash,
      new D(rows[0].direct).plus(rows[0].overhead),
    ),
    forwardReceiptsStopExclusions: [
      "tax buffer",
      "interest",
      "capex",
      "principal",
    ],
    historicalReceiptsStopMonths: null,
  };
}
export function priceFloor(directCostMinor: number, targetMarginBps: number) {
  if (
    !Number.isSafeInteger(directCostMinor) ||
    directCostMinor < 0 ||
    !Number.isInteger(targetMarginBps) ||
    targetMarginBps < 0 ||
    targetMarginBps >= 10000
  )
    throw new DomainError(
      "invalid_input",
      "Pricing requires nonnegative integer cents and margin below 100%.",
    );
  return new D(directCostMinor)
    .times(10000)
    .div(10000 - targetMarginBps)
    .ceil()
    .toString();
}
export function historicalTreasury(
  cashMinor: number | null,
  rows: {
    cashReceiptsMinor: number | null;
    deliveryCostsMinor: number | null;
    overheadMinor: number | null;
    cashTaxPaymentsMinor: number | null;
    cashInterestPaymentsMinor: number | null;
  }[],
) {
  if (
    rows.length !== 3 ||
    cashMinor === null ||
    rows.some((r) => Object.values(r).some((x) => x === null))
  )
    return {
      netBurnMinor: null,
      runwayMonths: null,
      historicalReceiptsStopMonths: null,
      label: "Actual cash observations incomplete",
    };
  const outflows = rows.map((r) =>
    total([
      r.deliveryCostsMinor!,
      r.overheadMinor!,
      r.cashTaxPaymentsMinor!,
      r.cashInterestPaymentsMinor!,
    ]),
  );
  const averageOutflow = total(outflows).div(3),
    burn = D.max(
      0,
      total(outflows.map((o, i) => o.minus(rows[i].cashReceiptsMinor!))).div(3),
    );
  return {
    netBurnMinor: burn.toString(),
    runwayMonths:
      cashMinor > 0 && burn.gt(0)
        ? new D(cashMinor).div(burn).toString()
        : null,
    historicalReceiptsStopMonths:
      cashMinor > 0 && averageOutflow.gt(0)
        ? new D(cashMinor).div(averageOutflow).toString()
        : null,
    label:
      cashMinor <= 0
        ? "No available runway"
        : burn.eq(0)
          ? "No current net burn under this period"
          : "Based on three closed months of actual cash",
    excluded: [
      "capex",
      "principal",
      "financing",
      "owner contributions",
      "owner distributions",
    ],
  };
}
export function financialCsv(result: ReturnType<typeof forecast>) {
  const headers = [
    "period",
    "classification",
    "revenue",
    "direct",
    "overhead",
    "operatingSurplus",
    "tax",
    "receipts",
    "arClose",
    "netCashFlow",
    "cashClose",
  ] as const;
  return [
    headers.join(","),
    ...result.rows.map((r) =>
      headers
        .map((k) =>
          k === "period" || k === "classification" ? r[k] : money(r[k]),
        )
        .join(","),
    ),
  ].join("\r\n");
}
export function sampleForecast(
  scenario: "base" | "downside" | "upside" = "base",
): ForecastInput {
  return forecastSchema.parse({
    asOf: "2026-10-31T00:00:00Z",
    currency: "USD",
    horizon: 24,
    services: [
      {
        id: "brand",
        title: "Brand system",
        demandUnits: "1",
        unitPrice: "6000",
        unitDirectCost: "2600",
        hoursPerPool: { delivery: "60" },
      },
      {
        id: "website",
        title: "Launch website",
        demandUnits: "1",
        unitPrice: "9000",
        unitDirectCost: "4000",
        hoursPerPool: { delivery: "90" },
      },
      {
        id: "retainer",
        title: "Care retainer",
        demandUnits: "2",
        unitPrice: "3000",
        unitDirectCost: "1200",
        hoursPerPool: { delivery: "30" },
      },
    ],
    pools: [
      { id: "delivery", availableHours: "300", hireAdditionalHours: "150" },
    ],
    volumeMultiplier:
      scenario === "base" ? "1" : scenario === "downside" ? "0.8" : "1.1",
    growth:
      scenario === "base" ? "0.015" : scenario === "downside" ? "0" : "0.025",
    collectionFraction: scenario === "downside" ? "0.6" : "0.8",
    openingCash: "35000",
    openingReceivables: "4200",
    openingPayables: "0",
    openingDeferredRevenue: "0",
    openingDebt: "0",
    overhead: "10000",
    overheadGrowth: "0.0025",
    founderCompensation: "4000",
    founderDeliveryPayFraction: "0.7",
    founderDeliveryHours: "147",
    founderReplacementHourlyRate: null,
    founderReplacementHours: "147",
    retainedFounderNonDeliveryPay: "1200",
    fixedFounderPremium: "0",
    hireMonth: 13,
    hireMonthlyCost: "3500",
    capexMonth1: "3000",
    taxRate: "0.2",
    reserve: "30000",
    contingency: "0.15",
    financingCosts: "5000",
    provenance: {
      origin: "sample",
      asOf: "2026-10-31T00:00:00Z",
      sourceReference: "Rowan agency-finance-v1.1 synthetic fixture",
      reviewStatus: "unreviewed",
    },
  });
}
