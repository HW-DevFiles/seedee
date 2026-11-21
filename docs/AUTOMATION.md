# Delivery and growth automation

Remy's package implements R11–R13, the automation boundary of R14, and R15–R16. It runs entirely in-process with an injected clock. There is no scheduler, outbound notification, AI call, payment or finance scorer in this package. Human approval, recorded internal delivery, project completion, recognized revenue and customer receipts are separate facts.

## Binding the packages

`src/features/automation/index.ts` exports the service, typed command/result/view contracts, templates, repository and core bridge. Import presentation-only types directly from `contracts.ts`; the barrel contains server-only services.

The live composition is:

1. Kuba's shared migration provides `AutomationState {agencyId PK + Agency Cascade, version Int default 0, stateJson String default '{}', updatedAt}` plus core Project, Task, TaskDependency and ProjectCloseout models. This package does not create or change that migration.
2. Bind `createCoreAutomationBridge(loadEvidence, clock)`. Its required `loadEvidence(tx,userId,agencyId)` loads current engine artifact review facts and `GrowthFacts` from owned core/evidence records **inside that transaction**. It must reject mixed sample/real actual aggregates, preserve nulls, resolve economic buying groups, and distinguish paid-human capacity from simulated role cards. There is no default success or sample fallback.
3. Bind `createPrismaAutomationRepository(db, bridge)` and `createAutomationService(repository, clock)`. The real clock is `() => new Date()`; tests inject fixed instants. Do not expose an environment or browser clock override.
4. Bind `createAutomationBoundary(service, authorize)`, where `authorize(mutation)` calls the shared session/origin security context. It must return the session-derived `userId`; a browser cannot select identity. `readWorkspace(agencyId)` invokes `authorize(false)`; `command(request)` invokes `authorize(true)` even for a replay. A thin Next Server Action calls this boundary. Every repository operation independently rechecks ownership.
5. Parker maps `WorkspaceView` to workflow, routine, task, notification and growth screens. After workspace entry, issue a same-origin authenticated `run_due_routines` mutation. A GET/render only calls `readWorkspace`; it never creates an occurrence, task, notification or completed milestone. Run the same mutation from the visible **Run due routines** control. Handle a version conflict by displaying `current`, refreshing versions and retaining user input.

Core metadata, engine artifact/evidence loader binding and UI route/action composition are separate package integration work. The foundation-only checkout lacks those models and routes. The included SQLite suites execute the agreed model contracts in isolated databases; they do not claim the whole product loop is integrated or owner-review ready.

## Command and view contract

A request is `{agencyId, expectedVersion, idempotencyKey, command}`. A successful result is `{ok:true,replayed,workspace}`. A failure is `{ok:false,code,message,current?}` using the agreed unauthenticated, forbidden_or_missing, invalid_input, conflict and provider_failed codes. `current` is supplied when safely available on a conflict. Version-conflict UI should retain the submitted fields and offer a deliberate retry. Retry an uncertain response with the **same** key and command. Reusing that key for another command is rejected. Keys starting with `engine:` are reserved for engine run events and are rejected as invalid input. The idempotency window is the latest 500 receipts per workspace (user commands and engine events together). A retry older than that window is no longer recognized as a replay; it is then guarded only by `expectedVersion`. A `run_due_routines` that changes nothing commits nothing: it records no receipt and does not bump the version.

| UI action                                            | Command fields beyond `type`                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Instantiate a delivery workflow                      | `instantiate_workflow`: `projectId`, `templateKey` (`creative_delivery` or `content_delivery`), nullable `dueAt`                    |
| Start, fail, retry, revise, cancel or approve a task | `transition_task`: `taskId`, `expectedTaskVersion`, `to`, bounded `reason`, optional `artifactId`/`runId`                           |
| Change a deadline                                    | `reschedule_task`: `taskId`, `expectedTaskVersion`, nullable `dueAt`, `reason`                                                      |
| Record internal delivery                             | `record_delivery`: `projectId`, `deliveryDate`, `note`                                                                              |
| Create/enable/pause a routine                        | `configure_routine`: `routineId`, `templateKey` (`weekly_planning` or `monthly_evidence`), named `timezone`, `nextDueAt`, `enabled` |
| Process due routines                                 | `run_due_routines`                                                                                                                  |
| Refresh evidence-based growth                        | `refresh_growth`                                                                                                                    |
| Mark selected/all notifications read                 | `mark_notifications_read`: optional `notificationIds`; omit for all                                                                 |
| Make an evidence-gap task                            | `recommendation_task`: `recommendationKey`                                                                                          |
| Dismiss a recommendation                             | `dismiss_recommendation`: `recommendationKey`                                                                                       |
| Explicit manual milestone completion                 | `attest_milestone`: `milestoneKey`, `statement`, owned `evidenceIds`                                                                |

`WorkspaceView` contains persisted `state`, growth `metrics`, and workflow/routine template definitions. Reads leave saved state unchanged. Refresh growth through a mutation after project closeout/evidence changes. Routine creation snapshots cadence, timezone, owner, version, anchor and next slot. Subsequent configure commands enable/pause the existing schedule; they do not overwrite its anchor or timezone. Show the saved schedule after a toggle.

The delivery template snapshots Brief → Plan → Draft → Human review → Delivery recorded → Closeout. Starting requires completed predecessors. A task follows queued → in_progress → awaiting_review → done; blocked tasks unlock only when all dependencies are done. Failures return to queued on explicit retry; cancellation can be explicitly requeued. Revision from awaiting_review returns to in_progress with a new attempt, retaining the prior artifact reference in history. There is no terminal shortcut from queued/in_progress to done. All work/review outputs require a **current saved artifact**, approved by the authenticated owner. A human-review step may review its predecessor's artifact. Delivery and closeout steps require separate saved records.

`record_delivery` stores/corrects one internal delivery reference per project; it neither sends a client message nor creates closeout revenue/receipts. Task completion never changes project financial actuals. The core bridge checks a saved ProjectCloseout for the final closeout gate. Core Task/Project rows are the source of truth on load. Automation tasks whose core row or project was deleted are dropped, along with their workflow entries, routine occurrences, dependency references and recommendation links. A core edit of a task's title/input is adopted (with its core version) and raises an internal `task_reconciled` notification. Reads only reflect these corrections; the next authenticated mutation commits them. Any other direct change to an automation-owned core task (status, version, project, role, dates or dependencies) is rejected as a reconciliation conflict; core/UI actions must forward their lifecycle/deadline changes to this service. Never catch a projection error and commit only one side.

## Engine transaction hook

Nolan's engine saves its changed aggregate first, then calls the lifecycle bridge in that **same** database transaction:

```ts
const port = createPrismaAutomationTransaction(tx, coreAutomationBridge);
const state = await recordRunEvent(
  port,
  {
    userId: scope.userId,
    agencyId: scope.agencyId,
    taskId,
    expectedTaskVersion,
    eventKey,
    runId,
    artifactId, // when an artifact exists
    status,
  },
  now,
);
return state.tasks.find((task) => task.id === taskId)!.version;
```

Supported events are queued, running, awaiting_review, approved, failed, cancelled, retry and revision_requested. Persist the returned task version back into the run before commit. Queued reservations retain run identity without starting execution. Revision/retry clears the prior run/artifact association and retains the linked history. The evidence loader must see saved engine artifact facts; `current:true` is supplied only for the latest usable revision. The approved callback cannot grant approval itself. An exception rolls back engine state, aggregate, notifications, receipts, task projection and dependency changes together. Event keys are persisted; exact replays are harmless. Never call this hook from a public provider callback or expose it as a browser action.

## Routine and notification behavior

Slots advance by local calendar week or month, not fixed UTC-hour durations. Local wall time is retained across DST. A spring-gap time shifts forward by the DST gap; a repeated fall time uses the first occurrence. Monthly slots clamp to month end while retaining the original anchor, so January 31 → February 28 → March 31. Every slot is persisted in UTC with its named timezone and anchor index.

Paused routines produce nothing. A due mutation creates one task for the oldest unprocessed due slot, coalesces the remaining missed slots, stores `skippedCount`, and advances strictly beyond the injected now. The routine task is due at the end of the cadence period of the latest elapsed slot (the template's `duePeriods`, one week or one calendar month), never at the command time, so a fresh routine task is not overdue. Occurrence keys and aggregate CAS prevent duplicate tasks on retries or concurrent requests. Processing requires no background service. Dates older than 10,000 intervals require explicit schedule correction rather than an unbounded request loop.

Internal events cover awaiting review, failed simulated work, overdue tasks, completed milestones and reconciled core edits. An overdue notice is keyed by the task's current due date, so a missed rescheduled deadline notifies again. A milestone notice is keyed by its completion time, so a reopened and re-completed milestone notifies again. Unread notifications are always kept. The latest 200 read notifications and the latest 200 routine occurrences are retained; a read notice whose condition still holds (for example a still-overdue task) is never pruned, so it cannot fire again. Notifications contain fixed safe messages and typed internal targets. `notificationHref` emits only fixed internal routes with encoded IDs. Read/read-all is owner-scoped. Deadline revisions retain the first committed deadline and reason history; moving a deadline does not erase the original commitment. No notification asserts an external delivery or completed payment.

## Growth and evidence

Metrics expose period, source origin and the `completed_project_closeouts` basis. Revenue/collections are recorded closeout amounts for projects completed in that period, **not monthly cash-flow actuals**. No manual monthly total is added to them. Missing closeouts/amounts yield null, an entered zero remains zero, and duplicate project closeout references are rejected. Monetary sums check safe integer cents; delivery margin is an exact numerator/denominator pair with a null result at a zero/unknown denominator. The bridge does not infer payments from status or projections.

The view includes completed-project and repeat-economic-client counts, closeout coverage count, recorded revenue/receipts, delivery margin, overdue work, reviewed SOP count and separately entered human capacity/as-of. The loader supplies scoped overdue core-task IDs so non-workflow tasks are included without duplication.

Milestones cover first active offer, reviewed SOP, paid-project evidence, repeat client, current human-capacity review and investor checklist gaps. Each publishes its target and evidence references. Paid-project evidence requires a completed project with positive earned revenue and positive receipts; a current capacity review requires both hours fields and evidence no older than 30 days. Corrections recompute rule milestones and can reopen them. Manual attestation is visibly `manual_attestation`, with statement and owned evidence references; it cannot change historical facts or readiness scores.

Recommendations explain the missing rule/evidence, can be dismissed, and convert to one stable task even across different request keys. Resolved recommendations retain their dismissal/task linkage through later corrections. Filter actionable recommendations to `resolvedAt === null && dismissedAt === null`. The package reports no potential finance-score delta; any later total must come from Rowan's full reconciled hypothetical re-score through the finance service.

## Verification

- `tests/automation.test.ts`: workflow gates, ownership, duplicate/concurrent commands, retries/revisions, original due dates, routines/DST/catch-up/month-end, unknown/zero growth, corrected evidence, attestation and recommendation conversion.
- `tests/automation-persistence.test.ts`: real SQLite aggregate CAS, restart/replay, ownership, corrupt-state rejection and rollback after an injected task-projection failure.
- `tests/automation-bridge.test.ts`: executable agreed core schema, task/dependency projection, lifecycle approval and replay, rollback of an engine transaction, archived-project denial, recorded-delivery separation, external core edit detection and session/origin boundary invocation.

The test-only DDL lives solely in temporary databases. Kuba owns the production migration; Ellis must additionally run these adapters against that actual migration and the assembled UI/engine/evidence loaders. Green package tests do not establish the full signup-to-export flow.
