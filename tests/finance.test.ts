import { describe, it, expect } from "vitest";
import { sampleReadiness } from "@/features/finance/fixtures";
import {
  scoreReadiness,
  emptyReadiness,
  simulateReadiness,
} from "@/features/finance/readiness";
import {
  sampleForecast,
  forecast,
  priceFloor,
  historicalTreasury,
} from "@/features/finance/forecast";
import { calculateEquity } from "@/features/finance/equity";
import { money, D } from "@/features/finance/decimal";
const now = "2026-11-21T00:00:00Z";
const component = (r: ReturnType<typeof scoreReadiness>, key: string) =>
  r.components.find((c) => c.key === key)!;
describe("readiness-v1.1", () => {
  it("computes the frozen score, weighted coverage, provenance and ranked gaps", () => {
    const r = scoreReadiness(sampleReadiness(), now);
    expect(r.score).toBe("73.4");
    expect(r.coveragePercent).toBe("100");
    expect(r.grouped.map((c) => c.points)).toEqual([
      "14",
      "9",
      "11",
      "14.4",
      "6",
      "12",
      "7",
    ]);
    expect(r.gaps.map((g) => g.key)).toEqual(["D", "R", "C"]);
    expect(r.sampleBanner).toContain("Sample data");
    expect(r.provisional).toBe(false);
  });
  it("keeps historical points and coverage stable while the freshness label ages", () => {
    const input = sampleReadiness();
    const a = scoreReadiness(input, now),
      b = scoreReadiness(input, "2026-12-15T23:59:00Z"),
      c = scoreReadiness(input, "2026-12-16T00:00:00Z");
    expect([a.score, b.score, c.score]).toEqual(["73.4", "73.4", "73.4"]);
    expect([a.coveragePercent, b.coveragePercent, c.coveragePercent]).toEqual([
      "100",
      "100",
      "100",
    ]);
    expect([a.provisional, b.provisional, c.provisional]).toEqual([
      false,
      false,
      true,
    ]);
  });
  it("preserves all-unknown business values", () => {
    const r = scoreReadiness(emptyReadiness("2026-10-31T00:00:00Z"), now);
    expect(r.score).toBe("0.0");
    expect(r.coveragePercent).toBe("0");
    expect(r.components.every((c) => c.rawValue === null)).toBe(true);
    expect(r.provisional).toBe(true);
  });
  it.each([
    [0, 0],
    [1, 3],
    [500000, 8],
    [1500000, 14],
    [2500000, 18],
  ])(
    "scores monthly revenue cents %i at inclusive brackets",
    (amount, points) => {
      const input = sampleReadiness();
      input.months.slice(3).forEach((m) => (m.revenueMinor = amount));
      input.recognition = null;
      expect(component(scoreReadiness(input, now), "R").points).toBe(
        String(points),
      );
    },
  );
  it.each([
    [0.899999, 0],
    [0.9, 3],
    [0.999999, 3],
    [1, 6],
    [1.099999, 6],
    [1.1, 9],
    [1.249999, 9],
    [1.25, 12],
  ])("scores exact growth ratio %s", (ratio, points) => {
    const input = sampleReadiness();
    input.months.forEach(
      (m, i) =>
        (m.revenueMinor =
          i < 3 ? 1000000 : new D(1000000).times(String(ratio)).toNumber()),
    );
    input.recognition = null;
    expect(component(scoreReadiness(input, now), "G").points).toBe(
      String(points),
    );
  });
  it("scores a known small comparison base zero while retaining availability", () => {
    const v = sampleReadiness();
    v.months.forEach((m, i) => (m.revenueMinor = i < 3 ? 499999 : 1000000));
    v.recognition = null;
    const g = component(scoreReadiness(v, now), "G");
    expect(g).toMatchObject({
      points: "0",
      availability: true,
      reasonCode: "growth_small_base",
    });
  });
  it("keeps a zero denominator distinct from missing history", () => {
    const v = sampleReadiness();
    v.months.slice(0, 3).forEach((m) => (m.revenueMinor = 0));
    v.recognition = null;
    expect(component(scoreReadiness(v, now), "G")).toMatchObject({
      availability: true,
      rawValue: null,
      points: "0",
    });
    v.months[0].revenueMinor = null;
    expect(component(scoreReadiness(v, now), "G").availability).toBe(false);
  });
  it("rejects mixed provenance, duplicate IDs, future dates, and unclosed months", () => {
    const v = sampleReadiness();
    v.months[0].provenance = { ...v.provenance, origin: "user_entered" };
    expect(() => scoreReadiness(v, now)).toThrow("Separate");
    const duplicate = sampleReadiness();
    duplicate.recognition!.push(duplicate.recognition![0]);
    expect(() => scoreReadiness(duplicate, now)).toThrow("Duplicate");
    expect(() =>
      scoreReadiness(
        { ...sampleReadiness(), asOf: "2026-11-30T00:00:00Z" },
        now,
      ),
    ).toThrow("future");
    expect(() =>
      scoreReadiness(
        { ...sampleReadiness(), asOf: "2026-10-30T00:00:00Z" },
        now,
      ),
    ).toThrow("closed");
  });
  it("keeps overdue unfinished deliveries and original due dates in the denominator", () => {
    const v = sampleReadiness();
    const r = scoreReadiness(v, now);
    expect(component(r, "D_ontime").rawValue).toBe("0.9");
    v.deliveries!.find((d) => d.id === "review-9")!.completedAt =
      "2026-11-01T00:00:00Z";
    expect(component(scoreReadiness(v, now), "D_ontime").rawValue).toBe("0.9");
  });
  it("withholds unreconciled/negative recognition rather than clipping it", () => {
    const v = sampleReadiness();
    v.recognition![0].amountMinor = -1;
    v.recognition![0].creditReference = "credit-1";
    const r = scoreReadiness(v, now);
    expect(component(r, "C").availability).toBe(false);
    expect(r.riskFlags).toContain("recognition_reconciliation_required");
  });
  it("counts founder plus one paid human and rejects AI headcount", () => {
    const v = sampleReadiness();
    v.humans = v.humans!.slice(0, 2);
    expect(component(scoreReadiness(v, now), "H_paid").points).toBe("2");
    v.humans[0].compensationMinor = 0;
    expect(component(scoreReadiness(v, now), "H_paid").points).toBe("0");
    v.humans[0].compensationMinor = 400000;
    v.humans[1].simulated = true;
    expect(component(scoreReadiness(v, now), "H_paid").points).toBe("0");
  });
  it("requires a reconciled complete hypothetical for total deltas without mutating baseline", () => {
    const v = sampleReadiness(),
      proposed = structuredClone(v);
    proposed.ip.caseStudies = {
      value: true,
      sourceIds: ["two-permissioned-cases"],
      note: "Two documented outcomes",
    };
    proposed.ip.cases = [0, 1].map((i) => ({
      clientGroupId: `group-${i}`,
      completedAt: "2026-10-01T00:00:00Z",
      outcomeMetric: "Owner-reported outcome",
      outcomeValue: "Recorded result",
      sourceId: `case-${i}`,
      permissionId: `permission-${i}`,
    }));
    const r = simulateReadiness(v, proposed, now);
    expect(r.totalDelta).toBe("3.0");
    expect(scoreReadiness(v, now).score).toBe("73.4");
    proposed.months[5].revenueMinor! += 100;
    expect(() => simulateReadiness(v, proposed, now)).toThrow("reconcile");
  });
  it.each([
    ["fixed", [1700000, 1800000, 1900000, 2400000, 2500000, 2600000], "79.4"],
    ["ratios", [1700000, 1800000, 1900000, 2400000, 2500000, 2600000], "80.4"],
    [
      "proportional",
      [2550000, 2700000, 2850000, 2850000, 3000000, 3150000],
      "78.4",
    ],
    [
      "additive",
      [2650000, 2750000, 2850000, 2850000, 2950000, 3050000],
      "75.4",
    ],
  ] as const)(
    "fully re-scores the %s milestone snapshot",
    (mode, amounts, expected) => {
      const v = sampleReadiness(),
        baseline = [1700000, 1800000, 1900000, 1900000, 2000000, 2100000],
        retainers = [950000, 1000000, 1050000, 1050000, 1050000, 600000];
      v.months.forEach((m, i) => (m.revenueMinor = amounts[i]));
      for (const line of v.recognition!) {
        const m = v.months.findIndex((x) => x.period === line.period),
          g = Number(line.clientGroupId.split("-")[1]),
          share = [30, 25, 20, 15, 10][g] / 100;
        const group =
          mode === "proportional" || mode === "additive"
            ? g === 0
              ? baseline[m] * 0.3
              : (amounts[m] - baseline[m] * 0.3) / 4
            : amounts[m] * share;
        const pack =
            mode === "ratios" ? group * 0.75 : baseline[m] * share * 0.75,
          ret = mode === "ratios" ? group * 0.5 : retainers[m] * share;
        line.amountMinor = line.id.endsWith("-retainer")
          ? ret
          : line.id.endsWith("-package")
            ? pack - ret
            : group - pack;
      }
      expect(scoreReadiness(v, now).score).toBe(expected);
    },
  );
  it("tests the exact growth-floor cents and requires named support for true evidence", () => {
    const v = sampleReadiness();
    v.recognition = null;
    [499999, 500000, 500000, 625000, 625000, 625000].forEach(
      (amount, i) => (v.months[i].revenueMinor = amount),
    );
    expect(component(scoreReadiness(v, now), "G")).toMatchObject({
      points: "0",
      reasonCode: "growth_small_base",
      availability: true,
    });
    v.months[0].revenueMinor = 500000;
    expect(component(scoreReadiness(v, now), "G").points).toBe("12");
    const noInventory = sampleReadiness();
    noInventory.ip.inventory = null;
    expect(
      component(scoreReadiness(noInventory, now), "I_chain").availability,
    ).toBe(false);
  });
});
describe("agency-finance-v1.1", () => {
  it.each([
    ["base", "73944.07", null],
    ["downside", "-29148.18", 18],
    ["upside", "128265.76", null],
  ] as const)("reproduces %s cash and deficit", (scenario, cash, deficit) => {
    const r = forecast(sampleForecast(scenario), now);
    expect(r.status).toBe("complete");
    if (r.status !== "complete") return;
    expect(money(r.rows[23].cashClose)).toBe(cash);
    expect(r.firstDeficitMonth).toBe(deficit);
    for (const row of r.rows) {
      expect(
        new D(row.cashOpen)
          .plus(row.netCashFlow)
          .minus(row.cashClose)
          .abs()
          .lt("1e-35"),
      ).toBe(true);
      expect(
        new D(row.arOpen)
          .plus(row.revenue)
          .minus(row.receipts)
          .minus(row.arClose)
          .abs()
          .lt("1e-35"),
      ).toBe(true);
      expect(
        row.capacity.every((c) =>
          new D(c.deliveredHours).lte(
            new D(c.availableHours).times("0.85").plus("1e-35"),
          ),
        ),
      ).toBe(true);
    }
  });
  it("matches all published base rows and founder reclassification without changing cash", () => {
    const r = forecast(sampleForecast(), now);
    if (r.status !== "complete") throw Error("incomplete");
    const expected = [
      [0, "21000.00", "21000.00", "33600.00"],
      [5, "22622.96", "22556.10", "43178.09"],
      [11, "24736.93", "24663.81", "59117.18"],
      [12, "25107.98", "25033.77", "59477.58"],
      [17, "27048.43", "26968.48", "63587.14"],
      [23, "29575.92", "29488.50", "73944.07"],
    ] as const;
    for (const [i, revenue, receipts, cash] of expected) {
      expect(money(r.rows[i].revenue)).toBe(revenue);
      expect(money(r.rows[i].receipts)).toBe(receipts);
      expect(money(r.rows[i].cashClose)).toBe(cash);
    }
    expect(
      money(new D(r.rows[0].founderLoadedDeliveryMargin!).times(100)),
    ).toBe("43.81");
    expect(
      new D(r.rows[0].founderLoadedDirect!)
        .plus(r.rows[0].founderLoadedOverhead!)
        .eq(new D(r.rows[0].direct).plus(r.rows[0].overhead)),
    ).toBe(true);
  });
  it("preserves downside opening AR and reports capital alongside ending burn", () => {
    const r = forecast(sampleForecast("downside"), now);
    if (r.status !== "complete") throw Error("incomplete");
    expect(money(r.rows[0].receipts)).toBe("14280.00");
    expect(money(r.rows[0].arClose)).toBe("6720.00");
    expect(money(r.rows[0].cashClose)).toBe("29080.00");
    expect(money(r.rows[16].cashClose)).toBe("1737.13");
    expect(money(r.rows[17].cashClose)).toBe("-2596.48");
    expect(money(r.planningCapital)).toBe("73020.40");
    expect(money(r.horizonMeanNetCashFlow)).toBe("-4464.70");
    expect(r.minimumAtHorizon).toBe(true);
    expect(
      new D(r.forwardReceiptsStopMonths!).toDecimalPlaces(2).toString(),
    ).toBe("2.03");
    expect(r.historicalReceiptsStopMonths).toBeNull();
  });
  it("reports upside unmet demand in precisely the capacity-limited months", () => {
    const r = forecast(sampleForecast("upside"), now);
    expect(r.rows.filter((r) => r.unserved).map((r) => r.month)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 22, 23, 24,
    ]);
  });
  it.each([
    ["2300", "27951.37", 11],
    ["3500", "752.77", 8],
  ])("keeps fixed founder premium %s uninflated", (premium, cash, deficit) => {
    const base = forecast(
        { ...sampleForecast(), fixedFounderPremium: premium },
        now,
      ),
      down = forecast(
        { ...sampleForecast("downside"), fixedFounderPremium: premium },
        now,
      );
    expect(money(base.rows[23].cashClose)).toBe(cash);
    expect(down.status === "complete" ? down.firstDeficitMonth : null).toBe(
      deficit,
    );
  });
  it("reproduces the no-hire downside without executing a hire", () => {
    const r = forecast({ ...sampleForecast("downside"), hireMonth: null }, now);
    expect(money(r.rows[23].cashClose)).toBe("12851.82");
    expect(r.status === "complete" ? r.firstDeficitMonth : null).toBeNull();
  });
  it("leaves unsupported working capital and missing tax incomplete", () => {
    expect(
      forecast({ ...sampleForecast(), openingPayables: "1" }, now).status,
    ).toBe("incomplete");
    expect(forecast({ ...sampleForecast(), taxRate: null }, now).status).toBe(
      "incomplete",
    );
  });
  it("handles exact rounding and invalid pricing denominator", () => {
    expect(money("1.005")).toBe("1.01");
    expect(priceFloor(10000, 4000)).toBe("16667");
    expect(() => priceFloor(10000, 10000)).toThrow();
  });
  it("keeps historical tax/interest in burn while excluding capex and financing", () => {
    const row = {
      cashReceiptsMinor: 10000,
      deliveryCostsMinor: 6000,
      overheadMinor: 5000,
      cashTaxPaymentsMinor: 1000,
      cashInterestPaymentsMinor: 500,
    };
    expect(historicalTreasury(35000, [row, row, row])).toMatchObject({
      netBurnMinor: "2500",
      runwayMonths: "14",
    });
    expect(
      historicalTreasury(35000, [
        { ...row, cashTaxPaymentsMinor: null },
        row,
        row,
      ]).netBurnMinor,
    ).toBeNull();
    expect(historicalTreasury(0, [row, row, row]).runwayMonths).toBeNull();
  });
});
const equity = {
  preMoney: "8000000",
  newCash: "2000000",
  totalPreShares: "10000000",
  holders: [
    { id: "founder", shares: "9000000", unallocatedPool: false },
    { id: "pool", shares: "1000000", unallocatedPool: true },
  ],
  safes: [
    {
      id: "A",
      amount: "300000",
      cap: "3000000",
      funded: true,
      terms: "post_money_cap_only",
    },
    {
      id: "B",
      amount: "200000",
      cap: "4000000",
      funded: true,
      terms: "post_money_cap_only",
    },
  ],
  finalPoolTarget: null,
  hypothetical: true,
};
describe("dilution-education-v1.0", () => {
  it("computes the simple priced round", () => {
    const r = calculateEquity({
      ...equity,
      preMoney: "4000000",
      newCash: "1000000",
      safes: [],
    });
    expect(r.ownership?.map((x) => x.percent)).toEqual(["72", "8", "20"]);
  });
  it("solves simultaneous SAFE conversion and preserves reconciliation", () => {
    const r = calculateEquity(equity);
    expect(
      r.ownership?.map((x) => new D(x.percent).toDecimalPlaces(5).toString()),
    ).toEqual(["61.2", "6.8", "8", "4", "20"]);
  });
  it("solves the final pool target and rechecks cap binding", () => {
    const r = calculateEquity({ ...equity, finalPoolTarget: "0.15" });
    expect(r.supported).toBe(true);
    expect(
      r.ownership?.map((x) => new D(x.percent).toDecimalPlaces(7).toString()),
    ).toEqual(["54.3442623", "15", "7.1038251", "3.5519126", "20"]);
    expect(calculateEquity({ ...equity, preMoney: "4500000" }).supported).toBe(
      true,
    );
    expect(
      calculateEquity({
        ...equity,
        preMoney: "4500000",
        finalPoolTarget: "0.15",
      }).supported,
    ).toBe(false);
  });
  it("clamps pool additions, rejects below-cap rounds and unsupported terms", () => {
    const r = calculateEquity({ ...equity, finalPoolTarget: "0.05" });
    if (!r.supported) throw Error("unsupported");
    expect(r.poolAddedShares).toBe("0");
    expect(r.poolAlreadyMeetsTarget).toBe(true);
    expect(calculateEquity({ ...equity, preMoney: "1000000" }).supported).toBe(
      false,
    );
    expect(
      calculateEquity({ ...equity, unsupportedTerms: ["MFN"] }).ownership,
    ).toBeNull();
    expect(calculateEquity({ ...equity, totalPreShares: "1" }).supported).toBe(
      false,
    );
  });
});
