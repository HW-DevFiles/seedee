# Local operation and recovery

This package runs the local owner-review demo without accounts at external services, model keys or payments. Dependency installation, the first container build and Playwright browser installation require network access. After installation, the built-in provider and SQLite fixtures work without a network connection. This is a single-instance local setup; it is not a hosted release.

## Clean checkout

Use Node 22.12+ on the Node 22 LTS line (`.nvmrc`) and the committed npm lockfile. Native SQLite dependencies may need Python 3, make and a C++ compiler if a prebuilt binary is unavailable. Docker supplies these build tools.

```sh
cp .env.example .env
npm ci
npm run db:deploy
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. The sample login is `demo@seedee.local` / `SeedeeDemo!2026`. These public credentials are only for a local fictional sample. `db:seed` requires `DEMO_ACCOUNT_ENABLED=true` and refuses production mode. A fresh user starts without an agency or financial traction. Seeding preserves existing content, passwords and sessions; running it twice creates no duplicate account or agency. It never changes a separately registered user at the sample address into the fixture. An old foundation database with a different sample ID is preserved and rejected; use a new local database path for the new reserved fixture rather than overwriting it.

SQLite defaults to `prisma/dev.db`. For a separate rehearsal, set `DATABASE_URL=file:/absolute/path/to/review.db` and run `db:deploy` first. Relative file paths resolve from the repository root. Keep database files and downloaded private packs outside Git. Do not share the same SQLite file across hosts or multiple app replicas.

## Configuration

`src/lib/env.ts` is the shared schema. Next validates it at configuration load and at Node runtime registration. Errors list variable names, never their values.

| Variable               | Default                | Accepted values                                                                                                                                                 |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`          | `development`, `test`, `production` (Next sets its mode)                                                                                                        |
| `DATABASE_URL`         | `file:./prisma/dev.db` | Persistent SQLite `file:` path, without URL query/fragment or whitespace; no in-memory DB                                                                       |
| `AI_PROVIDER`          | `demo`                 | `demo` only; unknown providers fail startup                                                                                                                     |
| `DEMO_ACCOUNT_ENABLED` | `false`                | Exact `true` or `false`; `.env.example` opts in for local use                                                                                                   |
| `TRUST_PROXY_HOPS`     | `0`                    | Integer 0–32; trusted reverse proxies in front of the app, `0` trusts no client IP (see [sign-in throttling](ARCHITECTURE.md#authentication-and-authorization)) |

No payment, email, live model or remote storage key is needed. Live providers remain an implementation seam, not an environment switch that secretly calls a service. Routines use the service's injected request clock; there is no environment override that silently changes historical financial evidence.

Production mode refuses `DEMO_ACCOUNT_ENABLED=true`. Before serving requests it also checks the stored public login password, even when the flag is false. A development database cannot be made production-safe simply by toggling a flag. Migrations must exist before startup; a missing/unreadable database fails closed. Production configuration checks do not substitute for HTTPS, backups, recovery, abuse controls or the integrated release gates.

For a local production-build rehearsal, build without enabling the public login and start against a separately migrated database with no sample account:

```sh
DEMO_ACCOUNT_ENABLED=false npm run build
DATABASE_URL=file:./prisma/production-review.db npm run db:deploy
DATABASE_URL=file:./prisma/production-review.db DEMO_ACCOUNT_ENABLED=false npm start
```

Production session cookies require HTTPS for authenticated use; use the development server for the local HTTP owner walkthrough. The production rehearsal command below checks startup and signed-out routes, without weakening cookies.

## Container development

Install Docker Engine/Desktop with Compose v2. No `.env` file or host Node installation is needed:

```sh
docker compose up --build --wait
docker compose logs --follow web
```

The service binds only `127.0.0.1:3000`; set `SEEDEE_PORT` to choose another host port. The development target deliberately runs Next development mode for local HTTP session cookies. Each start applies committed migrations and idempotently seeds the fictional local account. The app runs as the unprivileged `node` user. The named `seedee-data` volume mounts `/app/data`; the SQLite DB and journals remain there across `docker compose restart web`, rebuilds, and `docker compose down` followed by `up`. The source is baked into the image: rebuild to pick up edits.

`docker compose down --volumes` **deletes that Compose project's persisted workspace**. It is used only for disposable CI projects; do not use it as a routine stop command. Use a distinct `COMPOSE_PROJECT_NAME` for isolated rehearsals. Do not change another worker's containers or volumes.

The production target can be checked with `docker build --target production -t seedee-review .`. It defaults to production mode with the sample disabled, retains migration tooling, and never seeds on startup. Mount a writable volume at `/app/data`, provide HTTPS via a trusted proxy, and supply the exact proxy-hop setting only when all access passes through that chain. Running this image is not approval for a public deployment. Secrets, `.env` files, generated client artifacts, local DBs and Git metadata are excluded from the build context.

## Reset and recovery

```sh
npm run db:reset-demo -- --confirm-reset-synthetic-demo
npm run db:seed
```

This explicit local CLI deletes only reserved `seedee-demo-user-v1` and its cascade-owned sample records/sessions. It requires opt-in, nonproduction mode, exact confirmation and an unchanged sample identity/password/profile. Repeat reset is safe when the sample is absent. It cannot target an arbitrary account or wipe the database. Changed sample identity/profile causes refusal; preserve that data and use a fresh database for a new rehearsal. The in-app reset belongs to Kuba's separate owner-authorized `sampleWorkspace` transaction; this CLI does not expose an unauthenticated reset route.

Stop the app before copying a SQLite backup and preserve its journal files consistently. Restore to a different local path first, apply forward migrations, and check the same owner/record counts before switching. Never rewrite an applied migration or use `db push` for release. For an application rollback, stop the app and restore a matching database backup plus the matching source revision; old code is not guaranteed to understand a newer schema. No automatic destructive rollback command is provided.

## Repeatable checks

```sh
npm run platform:rehearse
npm run lint
npm run format:check
npm run typecheck
npm test
DEMO_ACCOUNT_ENABLED=false npm run build
npm run platform:runtime-check
```

`platform:rehearse` uses a fresh OS-temporary database and separate CLI processes: migrate, seed twice, reconnect, reset twice, and prove an unrelated owner survives. It never resets the development database. `platform:runtime-check` needs the built application and checks actual Next startup/restart with a saved agency marker, a stored public sample password, enabled demo flag and unsupported provider. The container CI job runs `scripts/container-rehearsal.sh` under a unique Compose project: launch, write a marker, restart, and verify both the marker and sample IDs. It then builds the production image. These are operational checks, not proof of complete product behavior; use [the release checklist](RELEASE_CHECKLIST.md) for that. That checklist also records which checks were actually possible in Vera's local worker.
