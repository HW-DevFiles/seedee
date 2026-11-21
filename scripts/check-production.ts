import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase } from "../src/lib/db-client";

// Tests the built Next server, including instrumentation, rather than just helpers.
const directory = mkdtempSync(join(tmpdir(), "seedee-production-"));
const databaseUrl = `file:${join(directory, "runtime.db")}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: databaseUrl,
  DEMO_ACCOUNT_ENABLED: "false",
  AI_PROVIDER: "demo",
  TRUST_PROXY_HOPS: "0",
  NEXT_TELEMETRY_DISABLED: "1",
};

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function probe(
  overrides: Record<string, string>,
  expectedError?: string,
) {
  const port = await availablePort();
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: { ...env, ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let exited = false;
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  child.once("error", (error) => {
    output += error.message;
    exited = true;
  });
  child.once("exit", () => {
    exited = true;
  });
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (exited) {
        assert(expectedError, `Clean production startup exited: ${output}`);
        assert(
          output.includes(expectedError),
          `Expected startup rejection ${expectedError}: ${output}`,
        );
        assert(
          !output.includes("Ready in"),
          "Unsafe server must never become ready",
        );
        return;
      }
      if (!expectedError && output.includes("Ready in")) {
        const response = await fetch(`http://127.0.0.1:${port}/sign-in`, {
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 200);
        const protectedResponse = await fetch(`http://127.0.0.1:${port}/app`, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        assert([303, 307].includes(protectedResponse.status));
        assert(protectedResponse.headers.get("location")?.includes("/sign-in"));
        return;
      }
      await delay(100);
    }
    throw new Error(`Production startup probe timed out: ${output}`);
  } finally {
    if (!exited) {
      child.kill("SIGTERM");
      for (let attempt = 0; attempt < 50 && !exited; attempt++)
        await delay(100);
      if (!exited) child.kill("SIGKILL");
    }
  }
}

try {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env, stdio: "pipe" },
  );
  await probe({});
  const markerId = "runtime-restart-marker";
  const markerDatabase = createDatabase(databaseUrl);
  try {
    await markerDatabase.user.create({
      data: {
        id: markerId,
        email: "runtime-restart@example.test",
        name: "Restart marker",
        passwordHash: "not-a-login",
      },
    });
    await markerDatabase.agency.create({
      data: { ownerId: markerId, name: "Persisted review agency" },
    });
  } finally {
    await markerDatabase.$disconnect();
  }
  await probe({});
  const reopened = createDatabase(databaseUrl);
  try {
    assert.equal(
      (
        await reopened.agency.findUniqueOrThrow({
          where: { ownerId: markerId },
        })
      ).name,
      "Persisted review agency",
    );
  } finally {
    await reopened.$disconnect();
  }
  await probe({ AI_PROVIDER: "unsupported" }, "AI_PROVIDER");
  await probe({ DEMO_ACCOUNT_ENABLED: "true" }, "Public demo credentials");
  execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    env: { ...env, NODE_ENV: "development", DEMO_ACCOUNT_ENABLED: "true" },
    stdio: "pipe",
  });
  await probe({}, "public demo login");
  console.log(
    "PASS: production server starts/restarts with saved data and serves signed-out routes; unsupported provider, demo flag and stored public credentials all reject startup before ready.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
