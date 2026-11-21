import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each invocation gets a separate database; never seed/reset the developer's database.
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  `file:${join(tmpdir(), `seedee-e2e-${process.pid}.db`)}`;
const port = process.env.E2E_PORT ?? "3100";
// Production mode avoids hot-reload reference churn during the UI walkthrough.
// Build once before selecting this mode; CI's existing default remains unchanged.
const productionServer = process.env.E2E_PRODUCTION === "1";

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
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`,
    ignoreHTTPSErrors: process.env.E2E_EXTERNAL_SERVER === "1",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer:
    process.env.E2E_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          command: `npm run db:deploy && npm run ${productionServer ? "start" : "dev"} -- --hostname 127.0.0.1 --port ${port}`,
          url: `http://127.0.0.1:${port}`,
          reuseExistingServer: false,
          timeout: 120000,
          env: {
            DATABASE_URL: databaseUrl,
            AI_PROVIDER: "demo",
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
});
