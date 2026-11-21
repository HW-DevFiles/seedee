import { equitySchema, EQUITY_VERSION, HYPOTHETICAL } from "./contracts";
import { D, total } from "./decimal";
export function calculateEquity(raw: unknown) {
  const v = equitySchema.parse(raw),
    unsupported = (reason: string) => ({
      supported: false as const,
      formulaVersion: EQUITY_VERSION,
      label: HYPOTHETICAL,
      reason,
      ownership: null,
    });
  if (v.unsupportedTerms.length)
    return unsupported(
      "Unsupported conversion terms: " + v.unsupportedTerms.join(", "),
    );
  if (
    new Set([
      ...v.holders.map((h) => h.id),
      ...v.safes.map((s) => s.id),
      "new_money",
    ]).size !==
    v.holders.length + v.safes.length + 1
  )
    return unsupported("Duplicate holder or instrument IDs.");
  const B = new D(v.totalPreShares),
    V = new D(v.preMoney),
    J = new D(v.newCash);
  if (!total(v.holders.map((h) => h.shares)).eq(B))
    return unsupported("Starting shares do not reconcile.");
  if (v.safes.some((s) => !s.funded))
    return unsupported(
      "Unfunded SAFEs cannot be converted; enter a separately funded hypothetical.",
    );
  const q = v.safes.map((s) => new D(s.amount).div(s.cap)),
    Q = total(q);
  if (Q.gte(1))
    return unsupported(
      "SAFE purchase/cap fractions must sum to less than one.",
    );
  const S = B.div(new D(1).minus(Q)),
    r = J.div(V),
    U = total(v.holders.filter((h) => h.unallocatedPool).map((h) => h.shares));
  if (v.holders.filter((h) => h.unallocatedPool).length > 1)
    return unsupported("Use one reconciled unallocated pool row.");
  let x = new D(0),
    alreadyMeetsTarget = false;
  if (v.finalPoolTarget !== null) {
    if (!v.holders.some((h) => h.unallocatedPool))
      return unsupported(
        "Pool top-up requires an explicit unallocated pool row.",
      );
    const p = new D(v.finalPoolTarget),
      denominator = new D(1).minus(p.times(new D(1).plus(r)));
    if (denominator.lte(0))
      return unsupported("Pool target denominator must be positive.");
    const numerator = p.times(new D(1).plus(r)).times(S).minus(U);
    alreadyMeetsTarget = numerator.lte(0);
    x = D.max(0, numerator.div(denominator));
  }
  const price = V.div(S.plus(x)),
    capPrices = v.safes.map((s) => new D(s.cap).div(S));
  if (capPrices.some((c) => price.lt(c)))
    return unsupported(
      "Round-price conversion required; this cap-binding illustration does not apply.",
    );
  const newShares = J.div(price),
    T = S.plus(x).plus(newShares);
  const rows = [
    ...v.holders.map((h) => ({
      id: h.id,
      shares: new D(h.shares).plus(h.unallocatedPool ? x : 0),
    })),
    ...v.safes.map((s, i) => ({ id: s.id, shares: q[i].times(S) })),
    { id: "new_money", shares: newShares },
  ];
  if (
    total(rows.map((row) => row.shares))
      .minus(T)
      .abs()
      .gt("0.000000000000000000000000000001")
  )
    return unsupported("Final shares do not reconcile.");
  return {
    supported: true as const,
    formulaVersion: EQUITY_VERSION,
    label: HYPOTHETICAL,
    reason: null,
    pricePerShare: price.toString(),
    postMoney: V.plus(J).toString(),
    postShares: T.toString(),
    poolAddedShares: x.toString(),
    poolAlreadyMeetsTarget: alreadyMeetsTarget,
    capPrices: capPrices.map((x) => x.toString()),
    safeCashAtConversion: "0",
    ownership: rows.map((row) => ({
      id: row.id,
      shares: row.shares.toString(),
      fraction: row.shares.div(T).toString(),
      percent: row.shares.div(T).times(100).toString(),
    })),
    assumptions: [
      "Fully diluted simplified basis; fractional educational shares.",
      "SAFE cash was received earlier and is not received again at conversion.",
      "No discounts, MFN, interest, warrants, pro rata exercise, secondary sales or unusual side letters.",
    ],
  };
}
