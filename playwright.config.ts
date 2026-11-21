import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Each invocation gets a separate database; never seed/reset the developer's database.
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  `file:${join(tmpdir(), `seedee-e2e-${process.pid}.db`)}`;
const port = process.env.E2E_PORT ?? "3100";
// Workers inherit the same isolated fixture location and per-run password.
process.env.E2E_DATABASE_URL = databaseUrl;
process.env.E2E_SAMPLE_PASSWORD ??= randomUUID();
// Production mode avoids hot-reload reference churn during the UI walkthrough.
// Build once before selecting this mode; CI's existing default remains unchanged.
const productionServer = process.env.E2E_PRODUCTION === "1";
const localBaseURL = `${productionServer ? "https" : "http"}://127.0.0.1:${port}`;
process.env.E2E_BASE_URL ??= localBaseURL;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir:
    process.env.E2E_OUTPUT_DIR ??
    join(tmpdir(), `seedee-ui-e2e-results-${process.pid}`),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL,
    ignoreHTTPSErrors:
      productionServer || process.env.E2E_EXTERNAL_SERVER === "1",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer:
    process.env.E2E_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          command: `npm run db:deploy && node --import tsx scripts/prepare-browser-fixture.ts && ${productionServer ? "node --import tsx scripts/serve-browser-production.ts" : `npm run dev -- --hostname 127.0.0.1 --port ${port}`}`,
          url: localBaseURL,
          ignoreHTTPSErrors: productionServer,
          reuseExistingServer: false,
          timeout: 120000,
          env: {
            DATABASE_URL: databaseUrl,
            E2E_PORT: port,
            E2E_DATABASE_URL: databaseUrl,
            E2E_SAMPLE_PASSWORD: process.env.E2E_SAMPLE_PASSWORD,
            DEMO_ACCOUNT_ENABLED: "false",
            AI_PROVIDER: "demo",
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
});
