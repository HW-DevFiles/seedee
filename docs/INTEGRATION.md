# Integrated local demo

The integration branch merges all six package histories into the foundation. Product pages now bind to the workspace, finance, agency-engine, automation and security services. The sample interface tour (`?preview=sample`) remains explicitly read-only; it is not a fallback for a failed owned read.

## Run and review

Follow README's install, environment, migration and seed steps. `npm run db:seed` runs the reserved-identity seed followed by the complete domain seed. Repeating it preserves saved data. Use the local synthetic account for sample finance outputs, or sign up for an empty workspace and accept your own agency draft.

1. Save Creative Practice & Goals. Generate a draft, edit it, then explicitly accept it. Agency shows saved packages; Crew shows seven simulated roles. No clients or revenue are created by acceptance.
2. Create a client and project. Instantiate a delivery workflow. Follow its task order: run and review Brief, Plan and Draft; request a revision when needed. Each saved run has an explicit run/resume control and version-specific approval.
3. For Human review, use the task-state control to start, request review, and complete review of the predecessor's approved artifact. Record internal delivery on the project, then complete the Delivery recorded task. Nothing is sent outside the app.
4. Move the project through Active and Review to Completed. Only the verified terminal administrative Closeout task may remain open. Save closeout with earned revenue, receipts, delivery cost and founder treatment separately; then finish that final task. Completion alone never records money. Growth reads the closeout ledger, not a sum of closeouts and manual actuals.
5. Record closed-month actuals and calculate readiness. Unknown inputs remain unknown and earn no unsupported credit. Financial scenarios are separate hypothetical snapshots: choose saved assumptions or enter a complete one-service model with explicit opening balances and human capacity. Existing sample scenarios retain their saved results. Scenario changes do not update readiness actuals.
6. Generate a private pitch from selected canonical saved facts, edit its twelve sections, and review unresolved support. Select readiness/evidence plus **one** forecast for CSV, optionally include the reviewed pitch, and confirm before creating an immutable export. Both download formats recheck the current session and owner.
7. Enable weekly/monthly routines, run due work, and pause a routine. Workspace entry invokes the same authenticated mutation after hydration. GET rendering never creates routine work. Record human capacity and reviewed SOP evidence from Growth; simulated roles add no human hours.

The normal local demo uses development mode. Production mode deliberately rejects the known public demo password and requires HTTPS for secure cookies and mutation origins. The integration rehearsal used a separate temporary seeded database, rotated the synthetic password to a private temporary value, and served the production build behind a loopback-only HTTPS proxy. This does not weaken startup checks or authorize deployment.

## Integration contracts

- `services.ts` composes the real Prisma engine and automation repositories. The lifecycle callback stays inside the engine transaction. Automation-owned tasks call `recordRunEvent` once; standalone tasks use a distinct core path with `syncTaskApproval` for saved current-artifact approval. Projection failures roll back both sides.
- The growth loader scopes every record to the current owner, consolidates client buying groups, preserves null amounts and source labels, and reads human capacity only from entered evidence. Current `dueAt` supplies notification identity; original committed deadlines remain separate for delivery evidence. Equivalent UTC timestamp spellings share a notification key.
- Snapshot pitch facts must exactly match an owned immutable `FinanceSnapshot.output.facts`. Evidence-row facts use the engine's original version/provenance validator. `actual_revision` audit rows and seeded forecasts without canonical facts are excluded from pitch source choices.
- Server actions use the shared security context and one operation quota wrapper. Browser owner IDs never become session identity. Nested project/task URLs verify the pair. Export downloads use the shared private attachment guard and persistent export quota.
- The project-completion exception is based on validated persisted automation metadata, never a task title or submitted exclusion list. It requires the same agency/project/workflow, terminal closeout kind, matching core version/status, complete predecessor set and recorded internal delivery. The closeout task still requires an explicit saved closeout.

## Verification

`tests/integration.test.ts` executes the combined migration and services for draft acceptance, workflow revision/approval, standalone approval, cross-owner denial, current-deadline re-notification, and all six delivery steps. It checks early completion denial, the standalone task named Closeout, the saved-closeout requirement, and separate revenue/receipt totals. The circular-gate test failed before the correction.

`tests/integration-actions.test.ts` executes the actual form parser/action adapters and saved SQLite services from onboarding through agency edit/accept, client/project/task/run approval, six manual months, readiness, a new forecast, pitch editing, evidence and Markdown/CSV export. It also rejects stale month-form writes without replacing the newer actual. Authentication/origin is supplied by a test boundary; the independent security and workspace-action suites cover that boundary and actual download authorization.

Package suites now use the production migrations for shared tables rather than recreating competing contract DDL. Browser tests retain account/session isolation, stored-markup safety, signed-out routes, read-only preview behavior, 360px width and keyboard navigation. `E2E_EXTERNAL_SERVER=1 E2E_BASE_URL=https://127.0.0.1:<port> npm run test:e2e` can target an already-running private HTTPS production rehearsal; CI runs the browser suite with `E2E_PRODUCTION=1` against its production build. The suite also signs into the seeded sample, checks its saved 73.4 readiness score and finance records, and records desktop/mobile screenshots. For a self-contained production run, use `npm run build -- --webpack` then `E2E_PRODUCTION=1 npm run test:e2e`. Playwright prepares a temporary seeded database with a per-run synthetic password and starts Next behind a loopback HTTPS proxy with an ephemeral certificate (`openssl` required). It leaves all application origin, cookie and public-demo startup guards enabled.

Local validation results and browser proof are recorded in the integration handoff. CI and the no-mistakes shipping run remain separate gates; this document does not claim deployment or a merged pull request.
