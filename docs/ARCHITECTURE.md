# Architecture

Seedee starts as a single Next.js App Router application. Server Components render read views, Server Actions handle same-origin form writes, and Prisma persists local data in SQLite. Strict TypeScript, ESLint, Prettier, Vitest, and Playwright establish the foundation for parallel feature work. The default runtime is Node.js; the SQLite adapter is not compatible with an edge runtime.

## Folder conventions

```text
src/app/                 Route layouts, pages, and future machine-facing handlers
src/components/ui/       Shared visual primitives, navigation, and AppShell
src/components/          Cross-feature compositions (auth form, placeholder views)
src/features/<name>/     Feature-owned services, schemas, actions, and UI
src/lib/auth/            Password, account, throttle, cookie, and session boundaries
src/lib/ai/              Typed provider seam and deterministic demo implementation
src/lib/db.ts            Server-only shared Prisma client
src/lib/db-client.ts     Client factory used by app, seed, and isolated tests
src/generated/prisma/    Generated and ignored; regenerate rather than hand-edit
prisma/schema.prisma     Shared persistence model
prisma/migrations/       Committed migration history
tests/                   Behavior tests and browser smoke tests
```

Use `@/` for imports rooted in `src`. A feature should export a small service interface and own its input validation. Avoid importing one feature's internal files into another; coordinate shared contracts before moving types to `src/lib`. Server modules that access credentials, identity, or the database must import `server-only`. Import AppShell and Nav directly; their server/client boundaries are intentionally absent from the UI barrel.

## Routes and rendering

`/` introduces the product. `/sign-up` and `/sign-in` create or authenticate accounts. `/app` is the protected overview; `/app/agency`, `/app/crew`, `/app/projects`, `/app/growth`, `/app/investor-readiness`, and their nested routes (through `/app/[...path]`) render the `src/features/product-ui` screens described in [PRODUCT_UI.md](PRODUCT_UI.md). Feature owners bind services to those screens without changing the shared shell. The authenticated overview shows only the current user's agency. New users have no agency; the seeded account has a clearly fictional sample studio.

Prefer Server Components for reads and small client islands for interaction. `getCurrentUser` uses React request-scoped caching to deduplicate session reads; do not place personalized queries in shared or persistent caches. Each page/service must authorize data access even though the layout also checks authentication. Do not return password hashes, session tokens, or other internal fields in client DTOs.

## Authentication and authorization

Passwords are bcrypt hashes at cost 12. Inputs normalize email and enforce a 12-character minimum and a 72-byte maximum to avoid bcrypt truncation. Unknown-account sign-in performs a comparable password-hash check and returns the same error as a wrong password. Validation and account errors are returned to accessible form alerts, without exposing database details.

Sessions use a 256-bit random opaque token. The browser holds it in an HTTP-only, SameSite=Lax, path `/` cookie; only its SHA-256 hash is stored in `Session`. Cookies are Secure in production, so deployments must terminate HTTPS correctly. Sessions have a fixed seven-day expiry. Every protected read verifies expiry against the database; sign-out deletes the session, and a successful sign-in replaces any session presented by that browser. Deleting a user cascades their sessions and agency. Public login results select only ID, name, and email.

`AuthThrottle` persists hashed quota and failed-login keys in fifteen-minute windows. Hard limits return the generic "too many attempts" response; incorrect credentials always return the same generic credential error. Which hard limits apply depends on whether a client IP is trusted.

With the default `TRUST_PROXY_HOPS=0`, no client IP is trusted and IP-keyed limits are disabled. Sign-in has no hard email-only lock: failed attempts produce a progressive wait before the next password verification (1, 2, 4, 8, 16, then 30 seconds maximum). Each request captures its wait once; further failures cannot indefinitely postpone an owner's admitted request. Success clears the failed-attempt history, and a fixed fifteen-minute window expires it. Unknown accounts use the same delay and credential-error behavior. Registration retains a separate thirty-attempt per-email quota that cannot lock sign-in. Each new email starts its own registration counter, so nothing limits how many distinct accounts one untrusted-IP client can create.

Behind trusted proxies, set `TRUST_PROXY_HOPS` to the number of proxies you operate in front of the app. The client IP is then the `X-Forwarded-For` entry that many positions from the right, which is the address your outermost proxy recorded; entries further left are supplied by the client and are never trusted. The selected entry must be a literal IP address; equivalent IPv6 spellings are normalized and scoped IPv6 identifiers are rejected. Do not set it unless every request passes through that many proxies that append to the header. In this mode two hard limits remain: ten attempts per email and client IP, and fifty attempts per client IP across all emails. Successful sign-ups count toward the per-IP limit, which caps account creation from one trusted address.

In both modes a successful sign-in clears the account's failed-login delay. When a client IP is trusted, the successful attempt is taken back off the per-IP counter and the email-and-IP counter is reset. Operation quotas and registration counters are independent. Bounded delay slows sequential guesses while preserving account availability; it is not a global throughput cap against parallel attackers. Shared trusted-IP limits can still affect people behind the same NAT, so deployment needs additional abuse controls.

These are minimal controls, not a complete internet-facing abuse defense: deployment still needs retention cleanup for expired throttle/session rows, account recovery, email verification, and monitoring. Those flows are not silently simulated in this foundation. Avoid logging raw form fields or secrets. A public deployment must not contain the published demo account. Sign-up refuses the reserved demo address with the same generic error as a duplicate email, so the published account cannot be created through the app.

For UI mutations, use Server Actions with schema validation and `requireUser()` inside the action/service. Next.js validates Server Action origins; preserve those defaults and do not loosen allowed origins. Server Actions are public request boundaries, not private functions merely because they live on the server. Do not trust an `ownerId` or `userId` submitted by the client. Derive identity from the session and scope queries to that user.

The security package adds `requireSecurityContext(true)` for typed authenticated mutation boundaries and `requireMutationOrigin()` for auth actions. These reject missing/null/cross-site origins as well as Origin/Host mismatches; production requires HTTPS. Proxies must preserve the external Host. Feature owners use same-transaction ownership/reference guards and separate generation/export quotas from `src/lib/security`. See [SECURITY.md](SECURITY.md) for exact APIs, limits, safe output rules and the distinction between fixture and integrated endpoint verification.

Use Route Handlers for future exports, webhooks, or external machine APIs. They need their own authentication, authorization, input validation, and error handling. Cookie-authenticated mutations in handlers also need explicit CSRF protection; they do not inherit Server Action protections. No route handlers or payments are required in this scaffold.

## Persistence and migrations

`User` owns zero or one `Agency`; a unique `Agency.ownerId` enforces that rule. `Session` and `AuthThrottle` support the shell's authentication. Feature models are intentionally left to their owners. Prefer portable Prisma scalar fields and explicit relations. The current schema does not use SQLite-specific application columns, native database type annotations, or unsupported enums.

Prisma 7 uses `prisma.config.ts` for the CLI datasource and `@prisma/adapter-better-sqlite3` at runtime. Both interpret the default `file:./prisma/dev.db` relative to the repository root. Use Node 22 LTS. Keep Prisma CLI, client, and adapter versions aligned. An npm override pins `effect` to `^3.22.1` on the 3.x line because Prisma's tooling previously resolved a version affected by GHSA-7589-6fvf-x4pw. Retain the override until the upstream dependency resolves a patched compatible version without it; verify generate, migrations, seed, tests, and `npm audit` after changes. ESLint stays on the 9.x peer range declared by Next's React/import/accessibility plugins.

To add a model:

1. Add ownership relations and indexes for the real query paths to `prisma/schema.prisma`.
2. Run `npm run db:migrate -- --name meaningful_change` against a local development database, then `npm run db:generate`.
3. Review the generated SQL and commit the schema and migration together. Do not rewrite a migration already applied by teammates.
4. Run `npm run db:deploy` on a fresh test database and verify the new behavior. Do not use `db push` as a substitute for committed history.

SQLite is a local development choice, not a multi-instance hosting strategy. A PostgreSQL move requires changing the Prisma datasource, selecting its driver adapter, generating a PostgreSQL migration baseline, and planning the data transfer. SQLite migration SQL cannot be replayed on PostgreSQL unchanged. The portable model reduces that work; it does not make the providers interchangeable at runtime.

The idempotent seed creates a sample account and agency without overwriting an existing user's data. It refuses production mode. Test databases live in temporary directories and do not share the developer's SQLite file.

## Add a feature

1. Create `src/features/<name>` with typed input/output contracts and server-side services.
2. Implement ownership checks at the service boundary. Use the authenticated user, not client-supplied ownership.
3. Add any required models and a reviewed migration. Coordinate shared schema changes with other owners.
4. Bind the corresponding product UI screen to the service through its adapter and form action (see [PRODUCT_UI.md](PRODUCT_UI.md#binding-the-services)); keep route files thin. Add a Server Action for form writes, validating every request.
5. Add behavior tests for the feature's observable outputs and authorization failures. Extend the browser smoke flow only when it covers a meaningful user journey.
6. Update the UI's preview labels only once the behavior actually works. Generated agency drafts require explicit acceptance before persistence; simulations must not imply real client work, traction, or external actions.

The core scaffold provides no readiness score, financial model, autonomous agents, or investment claims. Finance feature owners define those contracts separately, with provenance and as-of dates for sample, assumed, and user-entered evidence.

## AI seam

`AIProvider` exposes `suggest(CreativeBrief): Promise<CreativeSuggestion>`. A suggestion identifies its provider and mode, includes a summary and next steps, and always requires human review. `DemoProvider` trims/validates bounded inputs and returns deterministic template output. It has no network access, API keys, random values, wall-clock dependence, or side effects. Tests check repeatability and network independence.

Application code calls `getAIProvider()` from the server-only factory. `AI_PROVIDER=demo` is the only registered value; an unknown value throws instead of silently making a network call. The current shell does not call the provider on page load. Feature owners can use it when implementing an explicit generation action.

For a future live provider, implement the same interface in a server-only adapter, validate model output, enforce timeouts and cost limits, and explicitly register its environment value. Keep secrets outside source control. Model output cannot authenticate users, perform arithmetic for finance scores, assert evidence, or authorize side effects. Adding live AI or paid services is outside this foundation's scope.

## Design system

Tailwind v4 tokens are in `src/app/globals.css`: off-white `background` (#F8F6EF), hunter green `primary` (#355E3B), deep green `heading` (#1F3D2B), sage (#DCE6D5), ochre accent (#D6A84B), danger (#922E25), and a border token. Use deep/hunter green for text; ochre is an accent, not small text on off-white. Shared components provide Button/ButtonLink, labeled Input, Card, Badge, EmptyState, Brand, Nav, WorkspaceNavigation, and AppShell. The typography scale uses responsive display/title sizes, readable body text, and 14px secondary text.

Body text uses the bundled Manrope fonts in `public/brand/fonts` and display text a local serif stack, so builds make no font service requests; see `public/brand/README.md` for asset provenance and licensing. Interactive controls have keyboard focus indicators; navigation exposes its current page, forms label every field, error messages are alerts, and the layouts wrap on narrow screens. Verify contrast when adding accents and preserve WCAG AA text contrast.

## Validation and scope limits

Vitest exercises actual database-backed auth behavior on a fresh migrated SQLite database, token lifecycle, input limits, the one-agency constraint, and deterministic demo output. Playwright checks protected-route redirection, sign-up, dashboard arrival, cookie flags, navigation, sign-out, and sign-in. CI runs lint, formatting, strict typecheck, unit tests, production build, and the browser smoke test. Before deployment, separately verify HTTPS/proxy behavior, durable database hosting, backups, recovery, rate limiting, and secret management; deployment is not part of this scaffold.
