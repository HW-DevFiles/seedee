import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "@/lib/db-client";
import { readEnvironment } from "@/lib/env";
import { seedLocalDemo, resetLocalDemo } from "@/lib/local-demo";
import { assertRuntimeSafety } from "@/lib/runtime-safety";
import { demoFixture as fixture } from "@/lib/demo-fixture";

const directory = mkdtempSync(join(tmpdir(), "seedee-platform-"));
const url = `file:${join(directory, "test.db")}`;
const db = createDatabase(url);
const local = readEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: url,
  DEMO_ACCOUNT_ENABLED: "true",
});
const production = readEnvironment({
  NODE_ENV: "production",
  DATABASE_URL: url,
});

beforeAll(() => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

describe("environment safety", () => {
  it("requires exact supported config without echoing unsafe values", () => {
    expect(readEnvironment({})).toMatchObject({
      AI_PROVIDER: "demo",
      DEMO_ACCOUNT_ENABLED: false,
      TRUST_PROXY_HOPS: 0,
    });
    for (const input of [
      { AI_PROVIDER: "paid-secret-value" },
      { DATABASE_URL: "postgres://secret" },
      { DATABASE_URL: "file::memory:" },
      { TRUST_PROXY_HOPS: "1e1" },
      { TRUST_PROXY_HOPS: "-1" },
      { TRUST_PROXY_HOPS: "33" },
      { DEMO_ACCOUNT_ENABLED: "1" },
    ]) {
      expect(() => readEnvironment(input)).toThrow("Invalid configuration");
      try {
        readEnvironment(input);
      } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    }
    expect(() =>
      readEnvironment({ NODE_ENV: "production", DEMO_ACCOUNT_ENABLED: "true" }),
    ).toThrow("Public demo credentials");
  });
});

describe("local sample lifecycle", () => {
  it("refuses production and non-opted-in seeding/reset", async () => {
    await expect(seedLocalDemo(db, production)).rejects.toThrow(
      "nonproduction",
    );
    await expect(seedLocalDemo(db, readEnvironment({}))).rejects.toThrow(
      "nonproduction",
    );
    await expect(resetLocalDemo(db, production, true)).rejects.toThrow(
      "nonproduction",
    );
    expect(await db.user.count()).toBe(0);
    await assertRuntimeSafety(db, production);
  });
  it("seeds twice without replacing credentials, IDs, sessions or edited content", async () => {
    await seedLocalDemo(db, local);
    const first = await db.user.findUniqueOrThrow({
      where: { id: fixture.userId },
    });
    await db.agency.update({
      where: { ownerId: first.id },
      data: { description: "Owner edit" },
    });
    await db.session.create({
      data: {
        userId: first.id,
        tokenHash: "reserved-session-hash",
        expiresAt: new Date("2030-01-01"),
      },
    });
    await seedLocalDemo(db, local);
    expect(await db.user.count()).toBe(1);
    expect(await db.agency.count()).toBe(1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: first.id } }))
        .passwordHash,
    ).toBe(first.passwordHash);
    expect(
      (await db.agency.findUniqueOrThrow({ where: { ownerId: first.id } }))
        .description,
    ).toBe("Owner edit");
    expect(await db.session.count()).toBe(1);
    await expect(assertRuntimeSafety(db, production)).rejects.toThrow(
      "public demo login",
    );
    await expect(resetLocalDemo(db, local, true)).rejects.toThrow(
      "profile changed",
    );
    await db.agency.update({
      where: { ownerId: first.id },
      data: { description: fixture.agencyDescription },
    });
  });
  it("requires confirmation, deletes only reserved sample, and can be repeated", async () => {
    const other = await db.user.create({
      data: {
        email: "other@example.test",
        name: "Other owner",
        passwordHash: "not-a-real-password",
      },
    });
    await db.agency.create({
      data: { ownerId: other.id, name: "Other agency" },
    });
    await expect(resetLocalDemo(db, local, false)).rejects.toThrow(
      "confirm-reset",
    );
    expect(await resetLocalDemo(db, local, true)).toEqual({ deleted: true });
    expect(await resetLocalDemo(db, local, true)).toEqual({ deleted: false });
    expect(await db.session.count()).toBe(0);
    expect(await db.user.count()).toBe(1);
    expect(
      (await db.agency.findUniqueOrThrow({ where: { ownerId: other.id } }))
        .name,
    ).toBe("Other agency");
    await assertRuntimeSafety(db, production);
  });
  it("never adopts an existing account at the public demo address", async () => {
    const user = await db.user.create({
      data: {
        email: fixture.email,
        name: "Existing owner",
        passwordHash: "existing-hash",
      },
    });
    await expect(seedLocalDemo(db, local)).rejects.toThrow("already in use");
    expect(
      await db.user.findUnique({ where: { id: fixture.userId } }),
    ).toBeNull();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
        .passwordHash,
    ).toBe("existing-hash");
    expect(await resetLocalDemo(db, local, true)).toEqual({ deleted: false });
    expect(await db.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });
});
