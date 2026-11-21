import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each invocation gets a separate database; never seed/reset the developer's database.
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  `file:${join(tmpdir(), `seedee-e2e-${process.pid}.db`)}`;
const port = process.env.E2E_PORT ?? "3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run db:deploy && npm run dev -- --hostname 127.0.0.1 --port ${port}`,
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
