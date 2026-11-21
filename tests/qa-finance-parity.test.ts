import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { forecast, sampleForecast } from "@/features/finance/forecast";
import { money } from "@/features/finance/decimal";

// Ellis's independent parity check. This file re-derives Rowan's
// agency-finance-v1.1 fixture from the formulas in his published report
// (section 4) with its own decimal arithmetic, then compares every month
// against the application engine and the report's published figures. It
// deliberately shares no calculation code with src/features/finance.
const X = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const now = "2026-11-21T00:00:00Z";
const services = [
  { units: 1, price: 6000, cost: 2600, hours: 60 },
  { units: 1, price: 9000, cost: 4000, hours: 90 },
  { units: 2, price: 3000, cost: 1200, hours: 30 },
];
const scenarios = {
  base: { volume: "1", growth: "0.015", collect: "0.8" },
  downside: { volume: "0.8", growth: "0", collect: "0.6" },
  upside: { volume: "1.1", growth: "0.025", collect: "0.8" },
} as const;
type Scenario = keyof typeof scenarios;

function independent(
  name: Scenario,
  options: { premium?: number; hireMonth?: number | null } = {},
) {
  const s = scenarios[name];
  const hireMonth = options.hireMonth === undefined ? 13 : options.hireMonth;
  const premium = new X(options.premium ?? 0);
  let cash = new X(35000);
  let previousRevenue = new X(0);
  const rows = [];
  for (let t = 1; t <= 24; t++) {
    const hired = hireMonth !== null && t >= hireMonth;
    const demand = services.map((x) =>
      new X(x.units).times(s.volume).times(new X(1).plus(s.growth).pow(t - 1)),
    );
    const hoursNeeded = demand.reduce(
      (a, q, i) => a.plus(q.times(services[i].hours)),
      new X(0),
    );
    const available = new X(hired ? 450 : 300);
    const scale = X.min(1, available.times("0.85").div(hoursNeeded));
    const delivered = demand.map((q) => q.times(scale));
    const revenue = delivered.reduce(
      (a, q, i) => a.plus(q.times(services[i].price)),
      new X(0),
    );
    const direct = delivered.reduce(
      (a, q, i) => a.plus(q.times(services[i].cost)),
      new X(0),
    );
    const overhead = new X(10000)
      .times(new X("1.0025").pow(t - 1))
      .plus(hired ? 3500 : 0)
      .plus(premium);
    const surplus = revenue.minus(direct).minus(overhead);
    const tax = X.max(surplus, 0).times("0.2");
    const receipts = new X(s.collect)
      .times(revenue)
      .plus(t === 1 ? 4200 : new X(1).minus(s.collect).times(previousRevenue));
    const capex = t === 1 ? 3000 : 0;
    const net = receipts.minus(direct).minus(overhead).minus(tax).minus(capex);
    cash = cash.plus(net);
    rows.push({
      revenue,
      direct,
      overhead,
      tax,
      receipts,
      arClose: new X(1).minus(s.collect).times(revenue),
      netCashFlow: net,
      cashClose: cash,
      unserved: scale.lt(1),
    });
    previousRevenue = revenue;
  }
  const minimum = X.min(35000, ...rows.map((r) => r.cashClose));
  const gap = X.max(0, new X(30000).minus(minimum));
  const ending = rows
    .slice(-3)
    .reduce((a, r) => a.plus(r.netCashFlow), new X(0))
    .div(3);
  const deficit = rows.findIndex((r) => r.cashClose.lt(0));
  return {
    rows,
    firstDeficit: deficit < 0 ? null : deficit + 1,
    planningCapital: gap.times("1.15").plus(5000),
    ending,
  };
}

const cents = (v: Decimal.Value) =>
  new X(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

function appRows(name: Scenario, patch: Record<string, unknown> = {}) {
  const result = forecast({ ...sampleForecast(name), ...patch }, now);
  if (result.status !== "complete") throw new Error("incomplete forecast");
  return result;
}

describe("agency-finance-v1.1 independent recomputation", () => {
  it.each(Object.keys(scenarios) as Scenario[])(
    "%s matches the engine in every month and field",
    (name) => {
      const mine = independent(name);
      const app = appRows(name);
      expect(app.rows).toHaveLength(24);
      const fields = [
        "revenue",
        "direct",
        "overhead",
        "tax",
        "receipts",
        "arClose",
        "netCashFlow",
        "cashClose",
      ] as const;
      for (let i = 0; i < 24; i++)
        for (const field of fields)
          expect(
            new X(app.rows[i][field])
              .minus(mine.rows[i][field])
              .abs()
              .lt("1e-30"),
            `${name} t${i + 1} ${field}`,
          ).toBe(true);
      expect(app.firstDeficitMonth).toBe(mine.firstDeficit);
      expect(app.rows.map((r) => r.unserved)).toEqual(
        mine.rows.map((r) => r.unserved),
      );
    },
  );

  it("reproduces Rowan's published annual totals to the cent", () => {
    // Report section 4, "Scenario / year" table.
    const published = {
      base: [
        ["273865.44", "117370.90", "121663.83", "6966.14", "59117.18"],
        ["327438.50", "140330.78", "167364.35", "3948.67", "73944.07"],
      ],
      downside: [
        ["201600.00", "86400.00", "121663.83", "0.00", "23016.17"],
        ["201600.00", "86400.00", "167364.35", "0.00", "-29148.18"],
      ],
      upside: [
        ["299921.19", "128537.65", "121663.83", "9943.94", "70875.77"],
        ["424006.36", "181717.01", "167364.35", "14985.00", "128265.76"],
      ],
    } as const;
    for (const name of Object.keys(published) as Scenario[]) {
      const rows = independent(name).rows;
      published[name].forEach((expected, year) => {
        const slice = rows.slice(year * 12, year * 12 + 12);
        const sum = (k: "revenue" | "direct" | "overhead" | "tax") =>
          cents(slice.reduce((a, r) => a.plus(r[k]), new X(0)));
        expect(
          [
            sum("revenue"),
            sum("direct"),
            sum("overhead"),
            sum("tax"),
            cents(slice.at(-1)!.cashClose),
          ],
          `${name} year ${year + 1}`,
        ).toEqual(expected);
      });
    }
  });

  it("matches the downside deficit, planning capital and ending burn (C6)", () => {
    const mine = independent("downside");
    const app = appRows("downside");
    expect(cents(mine.rows[16].cashClose)).toBe("1737.13");
    expect(cents(mine.rows[17].cashClose)).toBe("-2596.48");
    expect(mine.firstDeficit).toBe(18);
    expect(cents(mine.planningCapital)).toBe("73020.40");
    expect(cents(mine.ending)).toBe("-4464.70");
    expect(money(app.planningCapital)).toBe(cents(mine.planningCapital));
    expect(money(app.horizonMeanNetCashFlow)).toBe(cents(mine.ending));
    expect(money(app.horizonNetBurn)).toBe("4464.70");
    expect(app.minimumAtHorizon).toBe(true);
  });

  it("matches Blair's no-hire downside and constant founder premiums (C5, C3)", () => {
    const noHire = independent("downside", { hireMonth: null });
    expect(cents(noHire.rows[23].cashClose)).toBe("12851.82");
    expect(noHire.firstDeficit).toBeNull();
    expect(
      money(appRows("downside", { hireMonth: null }).rows[23].cashClose),
    ).toBe("12851.82");
    for (const [premium, baseCash, deficit] of [
      [2300, "27951.37", 11],
      [3500, "752.77", 8],
    ] as const) {
      expect(cents(independent("base", { premium }).rows[23].cashClose)).toBe(
        baseCash,
      );
      expect(independent("downside", { premium }).firstDeficit).toBe(deficit);
      expect(
        money(
          appRows("base", { fixedFounderPremium: String(premium) }).rows[23]
            .cashClose,
        ),
      ).toBe(baseCash);
    }
  });

  it("reclassifies founder pay for display without changing cash (C3)", () => {
    const app = appRows("base");
    const t1 = app.rows[0];
    // 70% of $4,000 founder pay moves from overhead to delivery for display.
    expect(money(t1.founderLoadedDirect!)).toBe("11800.00");
    expect(money(t1.founderLoadedOverhead!)).toBe("7200.00");
    expect(new X(t1.founderLoadedDeliveryMargin!).times(100).toFixed(2)).toBe(
      "43.81",
    );
    expect(new X(t1.grossMargin!).times(100).toFixed(2)).toBe("57.14");
    expect(money(t1.cashClose)).toBe(
      cents(independent("base").rows[0].cashClose),
    );
    // C7: forward core-cost stress is $35,000 / $19,000, not runway.
    expect(new X(app.forwardReceiptsStopMonths!).toFixed(2)).toBe("1.84");
  });

  it("formats money half-up from exact decimals (C9)", () => {
    expect(money("1.005")).toBe("1.01");
    expect(money("-2596.475")).toBe("-2596.48");
    expect(money("0.125")).toBe("0.13");
  });
});
