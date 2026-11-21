# Deterministic agency and crew engine

Nolan's package implements R03, the draft-generation/editing seam of R04, R07–R08, the explanation seam of R16, and pitch generation/versioning in R19. It extends Theo's `AIProvider` with `generateAgency`, `simulateTask` and `draftPitch`. Only `AI_PROVIDER=demo` is registered. There is no model/network request, payment, external delivery, background agent or finance calculation in this package.

## Contracts and templates

Import runtime DTO validators and presentation types directly from `src/lib/ai/contracts.ts` or `src/features/agency-engine/contracts.ts`. The feature barrel includes server-only services and repositories; client components must not import that barrel at runtime.

- `agencyInputSchema` accepts practices, description, targetBuyer, goal, weeklyCapacityHours, proposedName and USD currency. Practices normalize to a sorted, deduplicated list. All seven named practices have scoped discipline-specific templates; Other provides an owner-defined pilot. Normalized input and fixed provider/template versions produce identical output.
- `agencyDraftSchema` is the shared acceptance validator for Kuba. A draft contains editable name, positioning, buyer, practices, goal, capacity, three packages, seven simulated roles and two ordered workflows. Every role exposes responsibility, inputs, output and human approval. The package estimates are explicitly synthetic labor/direct-cost/margin assumptions, not market research.
- `taskInputSchema` accepts a role, title, brief, objective, practices and optional revision note. Simulation emits only internal text, checklists or plans, never creative asset files or external work.
- `pitchInputSchema` accepts agency identity and typed evidence facts. Facts carry source ID/reference/version, origin, as-of date, formula version and review metadata. The provider copies `displayValue` verbatim; it does not calculate revenue, cash, dilution, score, market size or milestone gains. Sample and user actuals cannot be combined.

Versions are `agency-engine-v1.0`, `creative-templates-v1.0` and `private-pitch-v1.0`. Output metadata includes provider/mode/version/input summary and `requiresReview:true`. No template invents customers, revenue, incorporation, rights clearance, human capacity or investment outcomes. User-supplied text stays text; render it through React text nodes, never HTML.

## Service and UI boundary

`new AgencyEngine(repository, provider, clock?, timeoutMs?)` exposes these operations. Production uses the real UTC clock; tests inject one. Provider calls have a five-second default bound. Database errors or missing integrations fail closed; the service never falls back to a sample success.

| Operation                             | Input after session-derived user ID                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `readWorkspace`                       | Optional owned agency ID; returns drafts, runs, artifacts, pitches and request receipts; no writes                      |
| `generateAgency`                      | `{idempotencyKey,input,previousDraftId?,regenerateFields?}`; an existing draft requires an explicit selected field list |
| `editDraft`                           | `{draftId,expectedVersion,content}`; validates the full editable content and retains original provider metadata         |
| `queueRun`                            | `{agencyId,taskId,projectId,expectedTaskVersion,idempotencyKey,input}`                                                  |
| `advanceRun`                          | `{agencyId,runId}`; explicit mutation, safe to replay after restart                                                     |
| `approveRun`, `cancelRun`, `retryRun` | `{agencyId,runId,idempotencyKey,expectedVersion}`                                                                       |
| `requestRevision`                     | Same run command plus bounded `note`; returns a linked new run                                                          |
| `draftPitch`                          | `{agencyId,idempotencyKey,input,previousPitchId?}`; retains earlier drafts                                              |
| `editPitch`                           | `{agencyId,pitchId,expectedVersion,content}`; creates a new immutable revision                                          |

`createEngineActions(engine,boundary)` returns `readWorkspace(agencyId?)` and `command({type,input})`. Bind them inside Parker's thin Next Server Actions. Its required callbacks are `requireContext(mutation)` and `consumeGenerationLimit(context)`. Bind context to Maximus's `requireSecurityContext`, and quota to `consumeOperationLimit(db,{...context,operation:'generation'})`. Context runs for reads and every command/replay; mutations require origin validation. Browser owner IDs are rejected by strict command schemas. The repository independently checks user and agency ownership inside each transaction.

Results use `{ok:true,data}` or `{ok:false,error:{code,message,current?}}`. Codes are unauthenticated, forbidden_or_missing, invalid_input, conflict, rate_limited and provider_failed. Show conflicts with refreshed versions while preserving form input. Retry an uncertain response with the same key and same input; a changed payload under the same key is rejected. Generation failures save the normalized input and a safe error code. Start a new generation request to retry a failed agency/pitch draft. An interrupted `generating` request can resume with its original key.

Quota applies before new provider computation: fresh/resumed agency or pitch generation and queued/running run advancement. Persisted terminal results reauthorize and replay without charging or recomputing. Queue, retry, revision, cancellation and approval only mutate saved state; their later provider advancement consumes quota.

Generation and editing never create an active Agency. Kuba owns the atomic acceptance transaction and unique owner constraint. Acceptance should copy validated draft content into operational records; later regeneration creates a separate draft and cannot overwrite those records. Individual draft edits require the saved version. Selective regeneration preserves all unselected user edits and the previous saved draft.

## Persistence and transaction binding

Kuba owns the shared migration, including `AgencyEngineState {id: user ID primary key with User Cascade, agencyId: nullable unique Agency Cascade, version: integer default 0, payload: string default '{}', updatedAt}`. This package deliberately adds no competing migration. `createPrismaEngineRepository(db,bridge)` uses parameterized SQL so it can compile on the foundation while the shared schema lands. Missing tables are an error, never a fixture fallback. Before integration, the foundation alone cannot run these application mutations.

The aggregate stores generation versions, normalized fingerprints, runs, attempted steps, artifact revision links, owner reviews, pitch versions and idempotency receipts. Writes use CAS in the same Prisma transaction as task projection. Reads do not create the aggregate. A new account can persist a draft before it owns an agency.

`createWorkspaceEngineBridge(lifecycle)` supplies owned Task/Project/TaskDependency lookups and strict EvidenceItem validation against Kuba's agreed core model. It rejects foreign references, archived projects, unfinished predecessors, stale task versions, forged fact displays and mismatched provenance. Evidence intended for pitch drafting stores `value: {pitchFact: EvidenceFact}`; its ID/version must match the fact and its provenance must retain the same origin/asOf/reviewStatus. An omitted sourceVersion means version 1. Existing finance results should become typed referenced evidence facts; the engine does not reinterpret an opaque finance JSON object.

The required `lifecycle` callback binds Remy's implementation without a nested transaction:

```ts
const engineBridge = createWorkspaceEngineBridge(async (tx, scope, event) => {
  if (!scope.agencyId)
    throw new EngineError("forbidden_or_missing", "Workspace unavailable.");
  const state = await recordRunEvent(
    createPrismaAutomationTransaction(tx, coreAutomationBridge),
    { ...event, userId: scope.userId, agencyId: scope.agencyId },
    clock(),
  );
  return {
    taskVersion: state.tasks.find((task) => task.id === event.taskId)!.version,
  };
});
```

`recordRunEvent` is exported by `features/automation/run-bridge.ts`; `createPrismaAutomationTransaction` comes from its Prisma repository. `coreAutomationBridge` must use the real owned growth/evidence loader. `loadEngineArtifactFacts(tx,scope)` supplies the engine part of that loader, including `current` only for the latest usable revision. It excludes cancelled artifacts. Simulated roles never become paid humans or added capacity.

The repository persists changed engine state first, then calls lifecycle within that open transaction, captures the returned task version, and saves the final state before commit. A callback exception rolls back both writes. Events cover queued reservation, running, awaiting_review, approved, failed, cancelled, retry and revision_requested. Superseding a run does not emit a second cancellation that could cancel its successor. Task versions follow each projected event.

## Review, recovery and private pitch behavior

A run follows queued → running → awaiting_review → completed. Only authenticated owner approval completes it; generation never establishes client acceptance, recorded delivery, project completion, revenue or collected money. Failed runs retry explicitly on the same run with attempted-step history. Retry requests are idempotent. Cancellation stops pending steps and makes late generation results inert. Revisions retain the old artifact as revision_requested and link a fresh run/artifact version.

Running rows are durable recovery markers. Replaying their deterministic computation after restart is safe; a stable artifact ID and transactional state check prevent duplicates. Provider calls run outside SQLite transactions. No transaction is held while waiting on the provider. Concurrent cancellation wins before final artifact commit. Call `advanceRun` from an explicit authenticated mutation, never during a GET render.

The pitch has twelve evidence-oriented sections, a private educational disclaimer, sample/source labels, risk notes and literal `[Evidence needed]` placeholders. Missing source support stays unresolved. Numeric fact values retain their supplied source and date. Owner-edited section prose is explicitly marked as needing evidence review; existing references do not verify added claims. Solicitation checks reject call-to-invest phrases in actual rendered draft content while allowing the required educational disclaimer. Optional capital use appears only under “Hypothetical planning scenario — not an offer of securities.” Earlier generated/edited versions remain saved. Export authorization and final owner acceptance belong to Kuba's snapshot/export boundary.

`explainReadiness` consumes already-computed readiness-v1.1 display values, reasons, gaps and source IDs. It preserves unknowns and all risk flags, orders supplied gaps exactly by unearned points then R/G/C/D/H/I/M, and returns at most three next actions. It performs no scoring or hypothetical gain arithmetic. Total milestone deltas must come from Rowan's full reconciled hypothetical re-score, not this prose adapter. No recommendation updates actual evidence.

## Verification and remaining integration

`tests/agency-engine.test.ts` exercises practice templates, normalization, no-network determinism, malformed output, timeout, saved input, version conflicts, duplicate/concurrent requests, cancellation races, recovery, review/revision/retry, pitch evidence/sample boundaries, solicitation and required security callbacks. `tests/agency-engine-db.test.ts` uses real migrated temporary SQLite plus explicit agreed-schema fixture tables to exercise reconnect, running recovery, scoped relationships, versioned evidence, lifecycle projection, CAS loss and atomic rollback.

These are executable package tests. They do not claim the foundation has Kuba's migration, Remy's bound growth loader, Maximus's live boundary, Parker's route composition or Ellis's full signup-to-export acceptance. The fixture repository is an explicit test/preview export and is never constructed by production code. Integrated migration, endpoint, accessibility and browser checks remain required after the package merge order is complete.

A separate scratch integration rehearsal passed on 2026-11-21 UTC using backend migration commit `78ead207b5e73bf18f0763c88e1a38c3d0a35730` and automation commit `ef67badd1a9184a2dcd6a8856ac971ce8b6f6f48`. It deployed the actual backend migrations into a fresh SQLite database, instantiated Remy's real workflow, and ran this engine through queue, generation, revision and owner approval. Both aggregates and core tasks committed together, and approval unlocked the successor. Growth evidence was explicitly sample/unknown in that rehearsal; it was not the full browser or finance/export journey. Proof was kept outside the repository as required by the worker brief.
