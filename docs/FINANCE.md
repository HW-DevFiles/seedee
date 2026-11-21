# Deterministic finance contract

Implemented versions: `readiness-v1.1`, `agency-finance-v1.1`, `dilution-education-v1.0`, following Rowan's frozen v1.1 handoff and Blair's C1–C12 corrections. These are preparation heuristics and educational models. They are not validated funding predictors, researched agency thresholds, accounting statements, legal instruments or investment recommendations.

Required copy is exported as `DISCLAIMER`: “Educational planning only. Not financial, investment, accounting, tax or legal advice. No funding or return guarantee. Consult qualified advisers before acting.” Hypothetical scenarios use “Hypothetical planning scenario — not an offer of securities.” Any sample snapshot uses “Demo preview · Sample data · Not actual business performance.”

## Arithmetic and evidence

Actual amounts are bounded signed/nonnegative integer cents as appropriate. Forecast/scenario numbers are unambiguous decimal strings. Decimal.js is cloned at 50 significant digits with half-up rounding. Intermediate forecast values and annual aggregates remain unrounded. Display uses Decimal rounding; no binary-number money formatting. Actual score thresholds compare integer-cent products through Decimal. Currency is USD; dates are UTC; all scorers and date helpers receive an explicit evaluation instant.

Historical input months are the six closed UTC months ending at asOf. Missing is null, confirmed zero is zero. Recognition is a shared ledger partitioned by month, economic client group and service, with package/SOP/contract/delivery references. Credits require linked references; negative net activity is flagged for adjustment review. Monthly totals must reconcile to recognition. Common buying control uses one group ID. Assumptions cannot be historical traction, and sample/user actuals cannot be combined. Saved reads do not silently recalculate old snapshots when the clock advances.

Supporting IP records include per-deliverable assignment/license inventory and attestation, asset rights classifications, brand permissions, and distinct permissioned completed-client outcome cases. Human records distinguish paid humans from simulated roles, current agreements, accepted nonfounder handoffs, named paid pools and logged founder hours. Current capacity evidence is asOf-anchored within 30 days; market records use an asOf-anchored 180-day window. Coverage describes populated inputs, not independent verification.

## Readiness

| Component | Maximum | Rule                                                                                                                                                                                                                   |
| --------- | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R         |      18 | Mean final-three-month revenue: ≥$25k 18; ≥$15k 14; ≥$5k 8; positive 3; otherwise 0. All three closed months required.                                                                                                 |
| G         |      12 | Final-three/prior-three minus one: ≥25% 12; ≥10% 9; ≥0% 6; ≥−10% 3; otherwise 0. Prior-three must total ≥$15k; a smaller positive base earns 0 with `growth_small_base` but remains available. Zero base is undefined. |
| C         |      15 | Largest economic group / six-month revenue: ≤20% 15; ≤35% 11; ≤50% 6; otherwise 0. Missing attribution is unavailable. Zero activity is known but undefined.                                                           |
| D         |      20 | `8 × qualifiedPackageShare + 6 × earnedRetainerShare + 6 × onTimeShare`. Allocations can overlap but never add revenue.                                                                                                |
| H         |      10 | Five two-point checks: accountable human, two paid humans (founder counts only if paid), accepted nonfounder backups, complete paid capacity within 85%, founder delivery share ≤60%.                                  |
| I         |      15 | Chain of title 5, asset register 4, brand permissions 3, two permissioned outcome cases 3.                                                                                                                             |
| M         |      10 | Segment/buyer/geography/problem 2, five dated buyer organizations 3, three recent priced alternatives 2, complete bottom-up SAM/SOM sensitivity 3.                                                                     |

Qualified packages require fixed scope/cost basis, SOP/checklist existing by delivery and completed use by two client groups in W6. Retainers require entered cadence/terms and earned service periods. W90 is asOf and the preceding 89 days. Original deadlines control; overdue unfinished work remains in the denominator. Dated cancellations are preserved. AI crew never counts as human headcount, backup or paid capacity.

`SAM=N×annualSpend`. `SOM12=min(reachableProspects×winRate×annualRevenuePerClient,capacityCeiling,SAM)`; downside win rate cannot exceed base. The model evaluates completeness, not market truth. No creator-economy total or venture median is a default.

Unavailable subrules earn zero points without changing null facts or reweighting. Known false/zero can remain available. Sum points, half-up to one decimal, then classify the displayed score: below40 Build the foundations; below60 Document traction; below80 Strengthen the evidence; otherwise Assemble the diligence pack. Prefix Provisional for coverage below80%, missing six-month history or age>45 UTC days. Saved snapshots keep their points, coverage and stored stage; the Investor Readiness page and newly generated export packs re-derive only the Provisional label at read/export time (`readinessFreshness`). Independent cash, rights, cap-table, concentration, capacity and unpaid-labor risks remain visible. Gap cards sort unearned points descending, then R/G/C/D/H/I/M. `simulateReadiness` accepts a complete reconciled hypothetical, calls the same scorer/time/version and subtracts displayed scores; proposals never update actuals.

## Cash and capacity

Monthly demanded units follow one explicit volume/growth schedule. For each resource pool `scale=min(1, 0.85×availableHours/demandHours)`; a shared minimum scales all services proportionally. Unserved units are not sales or automatic backlog. `Revenue=sum(delivered×price)`; `Direct=sum(delivered×unitDirectCost)`; `GrossProfit=Revenue−Direct`; `Surplus=GrossProfit−Overhead`. Gross margin/break-even are undefined at invalid/zero denominators. Pricing floor is `directCost/(1−targetMargin)`; it is a direct-cost floor, not market validation or full overhead recovery.

Collections preserve opening AR and entered cohort timing: first receipts = current fraction×revenue + scheduled opening AR; later receipts = current fraction×current revenue + previous uncollected cohort. `ARclose=ARopen+earned invoices−receipts`. Cash closes from opening cash plus receipts/entered financing minus direct/overhead/tax/capex outflows. The curve may go negative to show a planning deficit, never available overdraft permission. Nonzero unsupported opening AP/deferred revenue/debt or missing tax schedules return incomplete, not zero obligations.

The sample's 20% positive-surplus tax buffer is synthetic. Its planned month13 hire increases fixed capacity and expense without lowering per-unit labor, conservatively double-counting hire-served labor. A separate no-hire scenario is supported. Founder pay sits once in overhead. Explicit pay allocation moves existing compensation into the loaded delivery display without changing cash/surplus. Replacement hours/rate and retained nondelivery pay are separate assumptions; normalized compensation replaces existing pay once. Missing replacement assumptions remain unknown; founder team-hour share never supplies a pay allocation.

Historical net burn includes actual direct/overhead cash, tax and interest, excluding capex/principal/financing/owner flows. Historical receipts-stop stress is a separate actual-outflow denominator. Forward receipts-stop uses first projected direct+overhead, visibly excluding tax/interest/capex/principal; neither stress metric is runway. Unknown actual cash remains unknown. Runway is undefined at no burn and no available cash is labeled explicitly.

For fixed reserve R, gap = max(0,R−minimum unfinanced cash), planning capital = unrounded gap×(1+contingency)+fixed financing costs. Show signed final-three-month cash flow, positive ending burn and whether minimum cash is at horizon end. A finite modeled injection does not resolve continuing burn indefinitely.

## Equity education

Only hypothetical simple priced primary rounds and funded post-money cap-only SAFEs are supported. Reject unsupported terms, duplicates, nonfinite/invalid amounts, nonreconciled initial shares, invalid pool denominators, Q≥1 and below-cap rounds. No legal document or actual ownership is issued.

Simple round: price=preMoney/preShares; newShares=newCash/price; new-investor fraction=newCash/(preMoney+newCash). SAFE fractions `q_i=amount_i/cap_i`, `Q=sum(q_i)`, post-conversion shares `S=B/(1−Q)`, SAFE shares `q_i×S`, cap price `cap_i/S`. Subsequent round pre-money includes converted SAFEs. Check round price against every cap before showing ownership. SAFE cash is not received again on conversion.

For final unallocated pool target p and r=newCash/preMoney, add `x=max(0,(p(1+r)S−existingPool)/(1−p(1+r)))`. Pool additions are excluded from SAFE capitalization but included in priced-round pre-money. Recompute price and recheck cap binding; a below-cap result is unsupported. A nonpositive numerator means the existing pool already meets target; never shrink it. Fractional modeled shares remain unrounded until display.

## Frozen verification fixtures

The explicit synthetic fixture computes R14/G9/C11/D14.4/H6/I12/M7 =73.4, populated coverage100%, and gap order D/R/C. Nov21/Dec15/Dec16 evaluations keep points and coverage unchanged; only Dec16 is stale. The four complete milestone proposals produce79.4/80.4/78.4/75.4 under their distinct reconciled allocations.

Base cash: month1 $33,600, month24 $73,944.07. Downside opening AR remains $4,200; month1 receipts $14,280, AR $6,720, cash $29,080; first deficit month18 (April2028), after month17 $1,737.13. Upside unmet demand is months6–12 and22–24. Downside planning capital is $73,020.40 with ending mean flow −$4,464.70/month. No-hire downside ends $12,851.82 without a modeled deficit. Fixed founder premiums $2,300/$3,500 reproduce base ending $27,951.37/$752.77 and downside first deficits11/8. Loaded sample margin is43.81% beside recorded57.14%, with no cash reclassification effect.

Priced round ownership is72/8/20%. Two-SAFE no-top-up ownership is61.2/6.8/8/4/20%; a15% pool yields54.3442623/15/7.1038251/3.5519126/20%. At pre-money$4.5m/new cash$2m the no-top-up price$0.3825 binds both caps, but a15% pool makes price$0.327459… below cap price$0.34 and is unsupported. A5% target at the original$8m/$2m round clamps additions to zero. These are test values, never performance or fundraising claims.
