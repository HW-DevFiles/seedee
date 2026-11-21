# Seedee

A foundation for creatives to build, nurture, and manage their own creative agency. The long-term aim is to help organize a company and the evidence behind its growth; Seedee does not promise funding.

This branch includes a landing page, email/password accounts, protected workspace navigation, a sample agency, a deterministic AI provider seam, and the product screens for onboarding, agency, crew, projects, growth, and investor readiness. Those screens browse fictional sample records with `?preview=sample`, but their save and generate actions are **visibly unavailable** until the domain services are connected (see [docs/PRODUCT_UI.md](docs/PRODUCT_UI.md)). There are no live AI calls, payment flows, or external publishing actions.

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

These are public, local-demo credentials. The seed is idempotent, does not overwrite existing accounts/agencies, requires `DEMO_ACCOUNT_ENABLED=true`, and refuses production mode. The CLI reserves stable sample IDs and rejects pre-existing accounts at the sample address rather than adopting them. Never seed this account into a publicly accessible deployment. A new sign-up has no agency until the future agency builder accepts a user-reviewed draft.

See [local operation and recovery](docs/OPERATIONS.md) for Docker volumes, production startup checks, scoped reset, configuration and clean-environment rehearsals. The [owner-review checklist](docs/RELEASE_CHECKLIST.md) tracks the complete product walkthrough separately from foundation checks.

## Commands

| Command                                                  | Purpose                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                                            | Development server                                                              |
| `DEMO_ACCOUNT_ENABLED=false npm run build` / `npm start` | Build / serve production output (HTTPS required for production session cookies) |
| `npm run lint`                                           | ESLint and Next.js rules                                                        |
| `npm run typecheck`                                      | Generate route types and check strict TypeScript                                |
| `npm test`                                               | Vitest behavior tests, including an isolated SQLite auth database               |
| `npm run test:e2e`                                       | Playwright auth, browser security, and product walkthroughs                  |
| `npm run format:check` / `npm run format`                | Check / apply Prettier                                                          |
| `npm run db:migrate -- --name description`               | Create and apply a local schema migration                                       |
| `npm run db:deploy`                                      | Apply committed migrations                                                      |
| `npm run db:seed`                                        | Add the local demo account and agency                                           |
| `npm run db:generate`                                    | Regenerate the Prisma client after schema edits                                 |

Install the test browser once with `npx playwright install chromium` before running the smoke test. Playwright starts a local server on port 3100 and uses a separate database in the OS temporary directory, never the local development database. Set `E2E_PORT` if that port is occupied. Failure traces use a temporary directory unless `E2E_OUTPUT_DIR` is set. `E2E_PRODUCTION=1` serves an existing production build. CI runs formatting, lint, typecheck, tests, build, the platform rehearsal and runtime checks, and the smoke test with Node 22, plus a separate container launch/restart job.

Additional platform checks: `npm run platform:rehearse`, `npm run platform:runtime-check` (after build), and `npm run db:reset-demo -- --confirm-reset-synthetic-demo`. Docker local startup: `docker compose up --build --wait`; data survives normal stop/restart.

## Configuration

Copy `.env.example` to `.env`. [Local operation: configuration](docs/OPERATIONS.md#configuration) owns the variables, defaults, accepted values and production startup refusals.

The demo provider uses built-in sample logic with no network or keys. A future provider must implement the typed interface under `src/lib/ai` and be explicitly enabled by the server-side factory. Adding an environment value alone cannot enable a paid model.

## Build on the foundation

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for feature ownership, authorization boundaries, migrations, design tokens, the AI seam, and deployment limitations. Feature modules belong in `src/features/<name>`; keep route files thin. Do not treat a protected layout as sufficient authorization for a server action or data query.
