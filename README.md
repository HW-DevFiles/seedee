# Seedee

A foundation for creatives to build, nurture, and manage their own creative agency. The long-term aim is to help organize a company and the evidence behind its growth; Seedee does not promise funding.

Seedee includes a working local agency demo: accounts, saved onboarding and agency drafts, scoped offers, clients/projects, simulated crew review, workflows/routines, evidence-based growth, deterministic financial planning, editable private pitches, and Markdown/CSV exports. The connected screens use persistent owner-scoped services. `?preview=sample` remains a separate read-only interface tour; `npm run db:seed` creates the editable synthetic workspace with preserved sample labels. There are no live AI calls, payment flows, or external publishing actions.

See [the integration walkthrough and validation](docs/INTEGRATION.md) for review steps and cross-package contracts.

## Run locally

Use Node.js 22.12+ (Node 22 LTS is pinned in `.nvmrc`) and npm.

```sh
cp .env.example .env
npm ci
npm run db:deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000. SQLite data lives in `prisma/dev.db`, ignored by Git. `npm ci` generates the Prisma client. `db:deploy` applies the committed migration to a fresh database; it does not reset existing data.

Demo sign-in:

- Email: `demo@seedee.local`
- Password: `SeedeeDemo!2026`
- Sample agency: **Fieldwork Studio**, a fictional design studio.

These are public, local-demo credentials. The seed is idempotent, does not overwrite existing accounts/agencies, requires `DEMO_ACCOUNT_ENABLED=true`, and refuses production mode. The CLI reserves stable sample IDs and rejects pre-existing accounts at the sample address rather than adopting them. Never seed this account into a publicly accessible deployment. A new sign-up has no agency until the owner explicitly accepts a generated, reviewed draft.

See [local operation and recovery](docs/OPERATIONS.md) for Docker volumes, production startup checks, scoped reset, configuration and clean-environment rehearsals. The [owner-review checklist](docs/RELEASE_CHECKLIST.md) tracks the complete product walkthrough separately from foundation checks.

## Commands

| Command                                                  | Purpose                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                                            | Development server                                                              |
| `DEMO_ACCOUNT_ENABLED=false npm run build` / `npm start` | Build / serve production output (HTTPS required for production session cookies) |
| `npm run lint`                                           | ESLint and Next.js rules                                                        |
| `npm run typecheck`                                      | Generate route types and check strict TypeScript                                |
| `npm test`                                               | Vitest behavior tests, including an isolated SQLite auth database               |
| `npm run test:e2e`                                       | Playwright auth, browser security, and product walkthroughs                     |
| `npm run format:check` / `npm run format`                | Check / apply Prettier                                                          |
| `npm run db:migrate -- --name description`               | Create and apply a local schema migration                                       |
| `npm run db:deploy`                                      | Apply committed migrations                                                      |
| `npm run db:seed`                                        | Add the local sample account and full domain fixture                            |
| `npm run db:generate`                                    | Regenerate the Prisma client after schema edits                                 |

Install the test browser once with `npx playwright install chromium` before running the smoke test. Playwright starts a local server on port 3100 and uses a separate database in the OS temporary directory, never the local development database. Set `E2E_PORT` if that port is occupied. Failure traces use a temporary directory unless `E2E_OUTPUT_DIR` is set. `npm run build -- --webpack` followed by `E2E_PRODUCTION=1 npm run test:e2e` tests the actual production server behind an isolated loopback HTTPS proxy (requires `openssl`). The test fixture rotates its synthetic password to a per-run value before startup; production credential and origin guards remain enabled. CI runs formatting, lint, typecheck, tests, build, the platform rehearsal and runtime checks, and the smoke test with Node 22, plus a separate container launch/restart job.

Additional platform checks: `npm run platform:rehearse`, `npm run platform:runtime-check` (after build), and `npm run db:reset-demo -- --confirm-reset-synthetic-demo`. Docker local startup: `docker compose up --build --wait`; data survives normal stop/restart.

## Configuration

Copy `.env.example` to `.env`. [Local operation: configuration](docs/OPERATIONS.md#configuration) owns the variables, defaults, accepted values and production startup refusals.

The demo provider uses built-in sample logic with no network or keys. It supports validated agency proposals for seven creative practices, internal task artifacts and evidence-linked private pitch drafts. The [agency engine handoff](docs/AGENCY-ENGINE.md) documents persistence, owner review and required cross-package bindings; the assembled bindings live in `src/features/integration`. A future provider must implement the typed interface under `src/lib/ai` and be explicitly enabled by the server-side factory. Adding an environment value alone cannot enable a paid model.

## Build on the foundation

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for feature ownership, authorization boundaries, migrations, design tokens, the AI seam, and deployment limitations. Feature modules belong in `src/features/<name>`; keep route files thin. Do not treat a protected layout as sufficient authorization for a server action or data query.
