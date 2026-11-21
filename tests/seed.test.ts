import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";

const directory = mkdtempSync(join(tmpdir(), "seedee-seed-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function freshDatabase(name: string) {
  const url = `file:${join(directory, `${name}.db`)}`;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, args, {
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" },
      encoding: "utf8",
    });
  expect(
    run("node_modules/prisma/build/index.js", "migrate", "deploy").status,
  ).toBe(0);
  return {
    url,
    seed: () => run("--import", "tsx", "prisma/seed.ts").status,
    seedDomain: () =>
      run("--import", "tsx", "prisma/seed-domain-cli.ts").status,
  };
}
describe("local seed scripts", () => {
  it("runs db:seed then db:seed:domain on a fresh database and repeats safely", async () => {
    const fresh = freshDatabase("sequence");
    expect(fresh.seed()).toBe(0);
    expect(fresh.seedDomain()).toBe(0);
    expect(fresh.seed()).toBe(0);
    expect(fresh.seedDomain()).toBe(0);
    const db = createDatabase(fresh.url);
    try {
      const agency = await db.agency.findFirstOrThrow({
        where: { owner: { email: "demo@seedee.local" } },
      });
      expect(agency.sampleWorkspace).toBe(true);
      expect(await db.agency.count()).toBe(1);
      expect(
        await db.financialActualPeriod.count({
          where: { agencyId: agency.id },
        }),
      ).toBe(6);
      expect(
        await db.activityEvent.count({
          where: { agencyId: agency.id, kind: "sample.initialized" },
        }),
      ).toBe(1);
    } finally {
      await db.$disconnect();
    }
  });
  it("refuses to adopt an existing demo-email account with another identity", async () => {
    const fresh = freshDatabase("adoption");
    const db = createDatabase(fresh.url);
    try {
      const user = await db.user.create({
        data: {
          name: "Earlier sign-up",
          email: "demo@seedee.local",
          passwordHash: "unused-test-hash",
        },
      });
      expect(fresh.seed()).toBe(0);
      expect(fresh.seedDomain()).not.toBe(0);
      const agency = await db.agency.findUniqueOrThrow({
        where: { ownerId: user.id },
      });
      expect(agency.sampleWorkspace).toBe(false);
      expect(await db.servicePackage.count()).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });
});
