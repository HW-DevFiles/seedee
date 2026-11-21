# Seedee

A foundation for creatives to build, nurture, and manage their own creative agency. The long-term aim is to help organize a company and the evidence behind its growth; Seedee does not promise funding.

This branch includes a landing page, email/password accounts, protected workspace navigation, a sample agency, and a deterministic AI provider seam. Agency creation, crew, projects, growth, and investor preparation are **labeled placeholders**, ready for the feature teams to implement. There are no live AI calls, payment flows, or external publishing actions.

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
| `npm run test:e2e`                                       | Playwright sign-up → dashboard → sign-out → sign-in smoke test                  |
| `npm run format:check` / `npm run format`                | Check / apply Prettier                                                          |
| `npm run db:migrate -- --name description`               | Create and apply a local schema migration                                       |
| `npm run db:deploy`                                      | Apply committed migrations                                                      |
| `npm run db:seed`                                        | Add the local demo account and agency                                           |
| `npm run db:generate`                                    | Regenerate the Prisma client after schema edits                                 |

Install the test browser once with `npx playwright install chromium` before running the smoke test. Playwright starts a local server on port 3100 and uses a separate database in the OS temporary directory, never the local development database. Set `E2E_PORT` if that port is occupied. Failure traces are in ignored `test-results/`. CI runs formatting, lint, typecheck, tests, build, and the smoke test with Node 22.

Additional platform checks: `npm run platform:rehearse`, `npm run platform:runtime-check` (after build), and `npm run db:reset-demo -- --confirm-reset-synthetic-demo`. Docker local startup: `docker compose up --build --wait`; data survives normal stop/restart.

## Configuration

| Variable               | Default                   | Meaning                                                                                                                                                |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`         | `file:./prisma/dev.db`    | SQLite file, relative to the repository root                                                                                                           |
| `DEMO_ACCOUNT_ENABLED` | `false` (example: `true`) | Local sample opt-in; production rejects enabled configuration and the public login stored in its database                                              |
| `AI_PROVIDER`          | `demo`                    | Only `demo` is enabled; unknown values throw                                                                                                           |
| `TRUST_PROXY_HOPS`     | `0`                       | Trusted reverse proxies in front of the app; `0` trusts no client IP (see [sign-in throttling](docs/ARCHITECTURE.md#authentication-and-authorization)) |

The demo provider uses built-in sample logic with no network or keys. A future provider must implement the typed interface under `src/lib/ai` and be explicitly enabled by the server-side factory. Adding an environment value alone cannot enable a paid model.

## Build on the foundation

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for feature ownership, authorization boundaries, migrations, design tokens, the AI seam, and deployment limitations. Feature modules belong in `src/features/<name>`; keep route files thin. Do not treat a protected layout as sufficient authorization for a server action or data query.
