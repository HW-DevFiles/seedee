import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createDatabase } from "../src/lib/db-client";
import { demoFixture } from "../src/lib/demo-fixture";
import { compare } from "bcryptjs";

// Run real CLI processes against a new isolated DB. Never reset the developer DB.
const directory = mkdtempSync(join(tmpdir(), "seedee-rehearsal-"));
const url = `file:${join(directory, "rehearsal.db")}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: url,
  AI_PROVIDER: "demo",
  DEMO_ACCOUNT_ENABLED: "true",
  TRUST_PROXY_HOPS: "0",
};
function run(args: string[]) {
  execFileSync(process.execPath, args, { env, stdio: "pipe" });
}

async function main() {
  run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  run(["--import", "tsx", "prisma/seed.ts"]);
  const db = createDatabase(url);
  let originalId: string;
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { email: demoFixture.email },
    });
    originalId = user.id;
    assert(await compare(demoFixture.password, user.passwordHash));
    await db.user.create({
      data: {
        email: "rehearsal@example.test",
        name: "Restart marker",
        passwordHash: user.passwordHash,
      },
    });
  } finally {
    await db.$disconnect();
  }
  run(["--import", "tsx", "prisma/seed.ts"]);
  const reopened = createDatabase(url);
  try {
    assert.equal(
      (
        await reopened.user.findUniqueOrThrow({
          where: { email: demoFixture.email },
        })
      ).id,
      originalId,
    );
    assert.equal(await reopened.user.count(), 2);
    assert.equal(await reopened.agency.count(), 1);
    assert.equal(
      (
        await reopened.user.findUniqueOrThrow({
          where: { email: "rehearsal@example.test" },
        })
      ).name,
      "Restart marker",
    );
  } finally {
    await reopened.$disconnect();
  }
  run([
    "--import",
    "tsx",
    "scripts/reset-demo.ts",
    "--confirm-reset-synthetic-demo",
  ]);
  run([
    "--import",
    "tsx",
    "scripts/reset-demo.ts",
    "--confirm-reset-synthetic-demo",
  ]);
  const afterReset = createDatabase(url);
  try {
    assert.equal(await afterReset.user.count(), 1);
    assert.equal(await afterReset.agency.count(), 0);
    assert(
      await afterReset.user.findUnique({
        where: { email: "rehearsal@example.test" },
      }),
    );
  } finally {
    await afterReset.$disconnect();
  }
  console.log(
    "PASS: fresh migrations, seed twice, reconnect persistence, scoped reset twice, unrelated owner preserved. Full product walkthrough remains a separate release gate.",
  );
}
try {
  await main();
} finally {
  rmSync(directory, { recursive: true, force: true });
}
