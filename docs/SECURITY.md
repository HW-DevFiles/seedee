# Security and reliability contract

This package covers R01/R23 and the security boundaries supporting R08, R20,
R21 and R24. It builds on the foundation, without introducing a schema migration,
live AI, payments, public sharing, file uploads, URL fetching or external logging.
Domain feature owners must apply the controls at their entry points. Fixture
verification is not a claim that unmerged endpoints are protected or implemented.

## Threats and trust boundaries

| Threat                                      | Control                                                                                                     | Remaining responsibility                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Anonymous or second-owner object access     | Session-derived identity; owner-filtered agency query; nested-reference checks inside the write transaction | Each domain service authorizes reads, writes and every child reference; navigation is not authorization             |
| Browser-submitted owner/approval/provenance | Strict command schemas; identity from the database session; review/evidence loaded server-side              | Never trust caller-supplied owner, reviewed status, task eligibility or computed financial facts                    |
| Forged or cross-site mutations              | Next Server Action protection plus strict Origin/Host/Fetch-Metadata checks; HTTP-only SameSite cookie      | Preserve external Host through proxies; enforce HTTPS in production                                                 |
| Session theft or leakage                    | Hashed opaque tokens; fixed expiry and revocation; allowlisted safe errors/log events                       | Do not log forms, cookies, authorization headers, URL queries, raw exceptions or exported content                   |
| Resource exhaustion                         | Database-backed account and explicitly trusted-IP quotas; bounded schemas and export sizes                  | Single local SQLite deployment only; deployment edge controls and retention remain operational requirements         |
| Stored HTML/Markdown/CSV injection          | React text rendering; escaped Markdown fields; formula-neutralized CSV text; attachment downloads           | No raw HTML rendering; serializers run when constructing the immutable snapshot                                     |
| Malicious reference URLs / SSRF             | HTTPS-only references without embedded credentials; no server fetching                                      | Link validation is not an endorsement of the destination; open externally with rel="noopener noreferrer"            |
| Concurrent/replayed writes                  | Same-transaction ownership/reference checks; CAS versions and idempotency per domain contract               | Reject stale versions; preserve historical snapshots; retries cannot bypass human approval                          |
| Sample facts becoming real claims           | Origin/version/source metadata stays with evidence and snapshots                                            | Domain validation rejects mixed sample/actual snapshots; security helpers do not invent provenance or finance rules |

## Modules and integration

`src/lib/security/request.ts` exposes `requireSecurityContext(mutation = false)`.
It returns `{ userId, clientIp }` from the current session and explicitly configured
proxy trust. A missing/revoked/expired session fails. Mutations pass `true`, which
also invokes `requireMutationOrigin()`. Read handlers use `false`; they do not
execute workflow routines or generate snapshots while rendering a GET.

`ownership.ts` accepts the Prisma client or its transaction's agency delegate:

```ts
const context = await requireSecurityContext(true);
const input = commandSchema.parse(rawInput);
await db.$transaction(async (tx) => {
  await requireAgencyOwner(tx, context.userId, input.agencyId);
  const client = await tx.client.findUnique({ where: { id: input.clientId } });
  assertAgencyReference(client, input.agencyId);
  // Check every project, package, task, dependency, role, artifact and evidence
  // reference here, then perform validated writes and optimistic version checks.
});
```

The snippet describes the domain integration once Kuba's client model lands.
`assertAgencyReference` accepts only repository-loaded records, not submitted
objects. It does not itself authenticate the caller. `assertOwnerReference` covers
drafts belonging to a user before that user has an agency. Unknown and foreign
records return the same `forbidden_or_missing` response. Do not expose the foreign
record as a conflict's `current` value. `recordIdSchema` bounds opaque IDs to 128
ASCII letters, digits, hyphens or underscores.

Every command must use server-side strict schemas with finite bounded numbers,
bounded text/arrays, valid dates, safe integer cents and explicit nullable unknowns.
Reject unknown fields that could override identity, ownership, status or provenance.
Only parsed/allowlisted fields may reach database data objects. Validate generated
provider output too. Keep plain text in storage and escape at the output sink;
escaping is not a substitute for validation or authorization. Preserve the default
Next Server Action request body limit. No user-controlled server-side URL fetch is
needed in v1.

### Mutation origins and cookies

`origin.ts` provides `assertMutationOrigin(headers, canonicalOrigin)` for any future
cookie-authenticated mutation handler. Its canonical origin must be trusted server
configuration, not a request payload, Host-derived URL or forwarded header. It
compares full scheme, hostname and port. Missing/null/malformed origins and
cross-site/same-site sibling fetch metadata are rejected.

Server Actions use `assertActionOrigin(headers, production)`: require an HTTP(S)
Origin with the same Host and port, require HTTPS in production, and reject missing
origins. Do not loosen `allowedOrigins`. A proxy must preserve the external Host;
X-Forwarded-Host cannot authorize a mutation. Local development at an explicit
localhost/127.0.0.1 port is supported. Privacy clients that omit Origin cannot
submit mutations under this strict policy; there is no permissive fallback.

Auth sign-up, sign-in and sign-out now invoke the stricter check before any account
or session side effect. Cookies retain HTTP-only, SameSite=Lax, path `/`, seven-day
expiry and Secure in production. Session rotation/revocation and comparable unknown
account password work remain in the foundation.

### Login delay and account availability

Firstmate's follow-up security decision replaces the hard thirty-attempt email-only
sign-in ceiling. A stranger could otherwise keep an owner locked out by repeatedly
exhausting that counter before the owner's password was checked. Failed sign-ins
now persist a capped failure count; subsequent requests wait 1, 2, 4, 8, 16, then at
most 30 seconds before user/password lookup and verification. The delay is sampled
once, not repeatedly extended by concurrent failures. A correct password still
succeeds after that bounded wait unless the request itself exceeds a trusted-IP
quota. Success clears the failure history. The fixed fifteen-minute window expires
old failures. Unknown accounts receive the same policy and generic incorrect-email/
password response. Waits are asynchronous and do not block the event loop.

Registration uses a separate thirty-attempt per-email quota. It cannot poison the
sign-in counter. Trusted email+IP and per-IP limits remain, successful sign-ups
still consume those buckets, and successful sign-in preserves the existing IP
reset semantics. Legacy email-only counter rows are no longer consulted; no schema
migration is needed. Their eventual removal belongs to auth retention cleanup.

This deliberately trades a hard account lock for bounded per-request friction.
Sequential guessing slows, but many concurrent requests or rotating clients are
not globally serialized by the account delay. Shared-IP users can still hit the
explicit trusted-IP limits. Internet deployment needs connection/concurrency and
edge abuse controls; this package does not claim distributed protection. The
server-only `AuthTiming` seam allows deterministic clock/wait tests and is never
accepted from a form, URL or credential payload.

### Generation and export quotas

`consumeOperationLimit(db, { userId, clientIp, operation }, now?)` uses separate
`security:v1:` namespaced hashed `AuthThrottle` keys. Call it after validating and
authorizing the requested scope, before provider work or snapshot creation/download.
Do not let a caller select another user's quota or supply its own IP.

| Operation                              | Account ceiling / 15 minutes | Trusted-IP ceiling / 15 minutes |
| -------------------------------------- | ---------------------------: | ------------------------------: |
| Generation (agency, crew work, pitch)  |                           20 |                             100 |
| Export (snapshot creation or download) |                           10 |                              50 |

Count expensive new work, including failed provider attempts. Read-only views,
cancel/review/edit actions and persisted idempotent replays should not rerun a
provider. Domain owners retain their idempotency decisions. Snapshot creation and
download share the export budget; a normal create-and-download costs two requests.
Quotas use atomic transactions, cap counters instead of overflowing them, expire at
the exact window boundary, and survive application restart. A rejected request may
still consume another bucket with available capacity. Auth success/reset never
clears operation counters. Expired operation rows are pruned opportunistically;
auth/session retention is a separate operational responsibility.

At `TRUST_PROXY_HOPS=0`, no request IP header is trusted, and only account limits
apply. With explicit trusted hops, the selected right-relative entry must be a
literal IP; IPv6 is canonicalized. Scoped IPv6 identifiers are rejected. Direct
origin access must be blocked when enabling proxy trust. These are local SQLite
controls, not a distributed or comprehensive internet abuse defense. Creating many
accounts with IP trust disabled remains outside these account quotas.

Over-limit errors have code `rate_limited` and `retryAfterSeconds`. Display the
safe message and wait in forms. HTTP downloads return 429 and `Retry-After`; do not
catch that result and continue generating work.

### Private exports and user content

`content.ts` exports `externalUrlSchema`/`safeExternalUrl`, `markdownText`, `csvCell`
and `serializeCsv`. User-entered Markdown fields are escaped, including HTML and
Markdown link syntax. Trusted template headings and vetted links are assembled
separately. CSV text cells beginning with formula characters (including after
whitespace/control characters) receive a leading apostrophe as well as CSV quoting.
Typed finite numbers stay numeric; null stays an empty cell and zero stays zero.
Precision-sensitive finance strings must retain their domain's exact formatting;
negative text values deliberately remain spreadsheet text. Do not use binary
money formatting or recalculate Rowan's formulas in serialization.

An authenticated action creates the immutable snapshot, enforcing provenance,
versions and mixed-sample rejection. A GET handler calls:

```ts
try {
  const context = await requireSecurityContext();
  return await downloadPrivateSnapshot(
    db,
    context,
    snapshotId,
    format,
    loadSnapshot,
  );
} catch (error) {
  return privateErrorResponse(error);
}
```

The trusted `loadSnapshot(id)` repository returns
`{ id, agencyId, markdown, csv } | null`. Both bodies are already safely serialized
snapshot outputs. The helper rechecks ownership, validates the ID/format, consumes
the export quota and returns the chosen body without creating/updating a snapshot.
Quota accounting is the only write on this download path. The loader must not have
side effects. Recheck ownership on every download, even if the snapshot ID came
from an earlier authorized screen.

Responses use fixed filenames, attachment disposition, private/no-store cache
control, Cookie variance, nosniff and a restrictive sandbox CSP; content is limited
to 2 MiB UTF-8. Error responses are also private/no-store. No storage path or
filename is derived from user text. `privateDownloadResponse` only constructs a
response; using it directly does not perform authorization or sanitize its body.

### Errors and logs

`SecurityError` and `safeError` use the agreed codes: unauthenticated,
forbidden_or_missing, invalid_input, conflict, rate_limited and provider_failed.
The last is the generic unexpected-operation failure; no internal message, stack,
database details or submitted validation text is exposed. `securityLogEvent`
produces only an allowlisted operation and safe code, deliberately omitting identity,
raw exceptions and arbitrary metadata. Callers must not attach request bodies or
tokens afterward. Expected authorization failures need no verbose exception log.

## Verification and endpoint inventory

| Surface                                                                  | Executable coverage in this branch                                                                                 | Integration status                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| signUp / signIn / signOut                                                | Existing database auth lifecycle and limits; strict-origin action tests; browser round trip                        | Applied to actual actions                                              |
| `/app` and five foundation feature routes                                | Signed-out redirect matrix; two-browser identity isolation                                                         | Actual foundation routes; domain pages still placeholders in base      |
| Agency ownership / pre-agency drafts                                     | Real SQLite owner queries; expired/revoked identity; transactional rollback                                        | Shared guards ready                                                    |
| Client/project/task/run/artifact/evidence/notification/export references | Second-user read/write and forged nested-reference matrix using contract fixtures                                  | Feature owners must apply; not endpoint coverage                       |
| Generation/export throttles                                              | Account/IP ceilings, concurrent requests, restart, expiry, auth-reset separation                                   | Real SQLite limiter; feature entry-point wiring pending                |
| Export download                                                          | Real ownership DB + immutable snapshot fixture; denial/429/private attachment                                      | Kuba loader/GET route integration pending                              |
| Content, links, cookies and safe errors                                  | Executed serializers, unsafe URLs, formula injection, React text rendering, production cookie policy and redaction | Owners must use helpers in final templates/views                       |
| Engine/automation entry points                                           | Contract handoff to Nolan and Remy                                                                                 | Their repository/approval bridges and integrated tests remain required |

Run `npm test`, `npm run typecheck`, `npm run lint`, formatting, production build and
`npm run test:e2e`. Database tests migrate fresh temporary SQLite files. Browser
tests use an isolated temporary database. Ellis must extend the matrix after the
domain branches merge: direct signed-out/second-owner URLs and commands for every
client, project, task, run, artifact, evidence and export; forged cross-agency
dependencies; stale sessions; generation/export exhaustion; rendered injection
payloads; and the complete fresh-account-to-export journey. Vera separately owns
clean-environment startup, production demo rejection and reset safety. No full-app
release claim follows from the foundation/fixture results alone.

Framework basis: [Next.js Server Action security](https://nextjs.org/docs/app/guides/data-security)
and the [Server Actions origin configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions).
Custom route handlers need their own mutation-origin check; they do not inherit
the Server Action boundary.

## Package verification record

Verified locally on 2026-11-21 against security head
`4f90c36fe1c6ab846afed6aea16bbd371b2ddf6f`, which builds on foundation base
`4f3176fd7d2523c4160666631896c223d6303ba7`. These results are local fixture and
foundation-route evidence, not integrated domain endpoint evidence:

- `npm test`: 80 passing tests across five files, including 63 shared security
  tests and 15 account/session tests. The latter include the progressive-delay
  correction, continued stranger attempts during an owner's bounded wait, and
  retained trusted-IP/registration accounting.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `NEXT_TELEMETRY_DISABLED=1 npm run build`: production Turbopack build passed.
- `npm run test:e2e` with task-specific port 3196, temporary database and temporary
  Playwright output directory: four passing Chromium tests. These cover the auth
  round trip, stored HTML payload remaining inert after reload, signed-out access
  to every foundation workspace route, and two independent browser identities.

The build/browser commands required expanded execution permissions for local
processes and sockets. No services were published. The domain endpoint integration
rows above remain pending their owners' branches and the assembled application
check; this package has not run the shipping pipeline yet.
