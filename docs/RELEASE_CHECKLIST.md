# Owner-review release checklist

Record the commit, UTC time, Node/npm or Docker versions, commands, result and evidence path for every completed gate. A green foundation/platform check does not certify the complete product. Feature placeholders and fixture-only adapters cannot pass the owner-review release gate.

## Package and integration gates

- [ ] Install from the lockfile in a clean checkout; copy only `.env.example`. No external credentials or paid services are requested.
- [ ] Apply Kuba's committed migrations on a fresh DB. Seed twice without duplicated or overwritten records; sample marker/provenance survives all domain adapters.
- [ ] Run `npm run platform:rehearse`, platform safety tests and `npm run platform:runtime-check` after building. Record each actual result.
- [ ] Launch an isolated Compose project, verify the sample login, save a record, restart and verify the saved record. Record container CI/rehearsal evidence; a missing Docker binary is an unverified gate.
- [ ] Run lint, formatting, strict types, unit/domain tests, production build and Ellis's complete browser suite on the integrated commit.
- [ ] Verify production rejects both enabled public-demo configuration and the public password retained in a database with the flag disabled. Unsupported AI configuration fails before ready.
- [ ] Confirm no primary action is a placeholder; Parker's views call the actual Kuba/Nolan/Remy services. Review pending, empty, conflict, invalid and recoverable error states.
- [ ] Attach Ellis's R01–R26 route/requirement matrix and Maximus's second-owner/security matrix. Finance parity uses readiness-v1.1, agency-finance-v1.1 and dilution-education-v1.0.
- [ ] Confirm no secrets/real customer data/DBs are committed, no live payments/model calls occur, no public shares/posts are created, and exports remain private.
- [ ] Owner can follow the walkthrough below at 360px and desktop widths by keyboard; visible sample, assumption and unknown labels remain intact.

## Review walkthrough

Use two isolated accounts plus the separately seeded sample. These are acceptance instructions; unchecked items are not claims of implementation.

| Step | Action / expected observation                                                                                                                                                                                                                       | Evidence owner         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1    | Signed out, visit `/app` and a saved export URL. Both deny private data. Sign up; no agency/traction is prepopulated.                                                                                                                               | Ellis / Maximus        |
| 2    | Save multi-practice onboarding, refresh/resume, generate a deterministic draft, edit/revise and accept once. Three offers, seven simulated roles and two workflows appear; repeat accept creates no duplicate agency.                               | Kuba / Nolan / Parker  |
| 3    | Create a client/project and instantiate Brief → Plan → Draft → Human review → Delivery recorded → Closeout. Blocked dependencies cannot be bypassed.                                                                                                | Kuba / Remy            |
| 4    | Run a simulated task, inspect provider/template/input provenance, request a revision, then approve it. Test failure/retry and cancel; restart recovers persisted steps without duplicate artifacts. Generation alone never marks delivery complete. | Nolan / Remy           |
| 5    | Record delivery and closeout with earned revenue, receipts, cash costs and founder labor separately. Correct the closeout; growth/evidence updates once. Refresh and sign in again to confirm persistence.                                          | Kuba / Remy            |
| 6    | Enable weekly/monthly routines, process due work twice and pause. One occurrence/notification/task per event; catch-up and timezone behavior are visible. Complete a rule-backed milestone; unsupported evidence remains missing.                   | Remy                   |
| 7    | Enter actuals or open the isolated sample snapshot. Inspect score components, weighted availability, explicit evaluation date and gaps. Unknown is distinct from zero and self-report is distinct from verification.                                | Kuba / Rowan / Ellis   |
| 8    | Inspect base/downside/upside cash, AR, capacity, founder pay/allocation/replacement assumptions and continuing burn. Scenario edits leave historical readiness unchanged; repeat Rowan/Blair boundary fixtures.                                     | Kuba / Parker / Ellis  |
| 9    | Inspect supported and unsupported equity illustrations. No securities execution, checkout, investor solicitation or guarantee appears.                                                                                                              | Kuba / Ellis           |
| 10   | Draft/edit the evidence-linked pitch; missing support remains a placeholder. Download versioned Markdown/CSV after authentication. Sample exports have conspicuous banners; mixed sample/actual aggregation is rejected.                            | Nolan / Kuba / Maximus |
| 11   | Try each saved object ID from the second account, including nested mutations/downloads. No private data or mutation leaks across owners.                                                                                                            | Maximus / Ellis        |
| 12   | Confirm scoped in-app synthetic reset requires ownership, sample marker and confirmation; another account survives. Repeat local seed/reset and container restart rehearsal.                                                                        | Kuba / Vera / Ellis    |

Preserve the educational boundary near finance controls and exports: “Educational planning only. Not financial, investment, accounting, tax or legal advice. No funding or return guarantee. Consult qualified advisers before acting.” Inspect actual rendered pitch/export CTA language under Blair's phrase-based safeguard, rather than banning explanatory words.

## Evidence in the platform package

The package supplies executable environment/fixture safety tests, a local CLI/reconnect rehearsal, an actual production-startup probe and a container launch/restart CI job. The integration branch replaces the foundation placeholders with connected services and records combined-schema, form-adapter and local production-browser evidence in [INTEGRATION.md](INTEGRATION.md). Ellis's independent release review and the shipping pipeline remain separate gates. The repository's CI run and the worker's validation handoff must provide results for the exact reviewed commit; this document deliberately does not pre-check unrun gates.

No public hosting, production migration, live AI/payment integration or distribution of promo material is part of this package. Keep the release private for owner review until the remaining integration gates are satisfied.

## Local package rehearsal record

Vera's worker, 2026-11-21 UTC, macOS arm64: Node 26.13.1 / npm 11.20.0 were available. Node 22 remains the supported runtime pinned for CI/container validation. `npm ci` completed with zero audit vulnerabilities; the initial sandboxed attempt could not update Prisma's cache, so installation was repeated with that filesystem access. No external credentials or model services were used.

- Passed: `npm run platform:rehearse` (fresh migration, separate seed processes twice, reconnect persistence, reset twice, unrelated owner retained).
- Passed: `npm test` (18 tests across three files, including five platform safety cases), lint, formatting and strict typecheck.
- Passed: `npm run build -- --webpack`. Default Turbopack builds were denied local port binding by the worker sandbox; Firstmate authorized the webpack rehearsal rather than further sandbox retries.
- Unverified locally: actual Next start/restart runtime probe and browser tests. `npm run platform:runtime-check` stopped at `listen EPERM` on `127.0.0.1` before launching Next; it did not report a product failure. CI includes this probe against the built server and the existing browser suite.
- Not executed here: Docker launch/restart and production-image build. Docker is not installed on this Mac; Firstmate explicitly declined installation for this task. The separate container CI job must supply that evidence.
- Pending: integrated domain fixtures/sample markers, all full-product walkthrough steps and Ellis/Maximus's final matrices. These depend on the parallel feature packages; this branch does not claim they are complete.

The exact commit and CI results belong in the validation handoff after the pipeline runs. No local result above replaces that check of the pushed commit.
