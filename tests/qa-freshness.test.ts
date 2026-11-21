import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { createDatabase } from "@/lib/db-client";
import { readEnvironment } from "@/lib/env";
import { seedLocalDemo } from "@/lib/local-demo";
import { demoFixture } from "@/lib/demo-fixture";
import { initializeSyntheticWorkspace } from "../prisma/seed-domain";
import {
  readinessFreshness,
  scoreReadiness,
} from "@/features/finance/readiness";
import { sampleReadiness } from "@/features/finance/fixtures";
import { createFinanceService } from "@/features/finance/service";

// C4 acceptance (Rowan/Blair): one unchanged 2026-10-31 snapshot read at
// Nov 21, Dec 15 23:59Z and Dec 16 00:00Z keeps 73.4, its component points
// and 100 coverage; only the Provisional prefix changes (false/false/true),
// on the read helper and in newly generated export packs alike.
const reads = [
  ["2026-11-21T00:00:00.000Z", false, 21],
  ["2026-12-15T23:59:00.000Z", false, 45],
  ["2026-12-16T00:00:00.000Z", true, 46],
] as const;

describe("read-time readiness freshness", () => {
  const input = sampleReadiness();
  const saved = scoreReadiness(input, "2026-11-21T00:00:00Z");

  it.each(reads)("at %s provisional=%s", (now, provisional, age) => {
    const fresh = readinessFreshness(input, saved, now);
    expect(fresh).toMatchObject({ provisional, ageDays: age, assessedAt: now });
    expect(fresh.stage).toBe(
      `${provisional ? "Provisional · " : ""}Strengthen the evidence`,
    );
    expect(fresh.reasons).toEqual(provisional ? ["older_than_45_days"] : []);
    // The saved calculation itself is never re-scored or mutated.
    expect(saved).toMatchObject({
      score: "73.4",
      coveragePercent: "100",
      stage: "Strengthen the evidence",
      provisional: false,
    });
  });

  it("does not inherit a historical age reason from the stored Boolean", () => {
    const late = scoreReadiness(input, "2026-12-20T00:00:00Z");
    expect(late.provisional).toBe(true);
    expect(late.score).toBe(saved.score);
    // Read back against the Nov 21 completeness facts it is not provisional.
    expect(readinessFreshness(input, late, "2026-11-21T00:00:00Z").stage).toBe(
      "Strengthen the evidence",
    );
  });

  it("counts a known zero month but not a missing or null one", () => {
    const at = "2026-11-21T00:00:00Z";
    const withMonth = (revenueMinor: number | null) => ({
      ...input,
      months: input.months.map((m, i) =>
        i === 0 ? { ...m, revenueMinor } : m,
      ),
    });
    expect(readinessFreshness(withMonth(0), saved, at).reasons).toEqual([]);
    expect(readinessFreshness(withMonth(null), saved, at).reasons).toEqual([
      "fewer_than_six_closed_months",
    ]);
    // A saved month outside the closed set is not a known month.
    const open = {
      ...input,
      months: input.months.map((m, i) =>
        i === 5 ? { ...m, closed: false } : m,
      ),
    };
    expect(readinessFreshness(open, saved, at).reasons).toEqual([
      "fewer_than_six_closed_months",
    ]);
  });

  it("keeps completeness reasons and prefixes the stage only once", () => {
    const partial = { ...input, months: input.months.slice(1) };
    const low = readinessFreshness(
      partial,
      {
        ...saved,
        coveragePercent: "60",
        stage: "Provisional · Document traction",
      },
      "2026-12-16T00:00:00Z",
    );
    expect(low.reasons).toEqual([
      "coverage_below_80",
      "fewer_than_six_closed_months",
      "older_than_45_days",
    ]);
    expect(low.stage).toBe("Provisional · Document traction");
  });

  it("fails closed when the saved input cannot be read", () => {
    expect(
      readinessFreshness({ broken: true }, saved, "2026-11-21T00:00:00Z"),
    ).toMatchObject({ provisional: true, reasons: ["saved_input_unreadable"] });
  });
});

describe("export packs state freshness at generation time", () => {
  const directory = mkdtempSync(join(tmpdir(), "seedee-qa-freshness-"));
  const url = `file:${join(directory, "freshness.db")}`;
  let db: PrismaClient;
  beforeAll(async () => {
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
    );
    db = createDatabase(url);
    await seedLocalDemo(
      db,
      readEnvironment({
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: url,
        AI_PROVIDER: "demo",
        DEMO_ACCOUNT_ENABLED: "true",
      }),
    );
    await initializeSyntheticWorkspace(db, new Date("2026-11-21T00:00:00Z"));
  });
  afterAll(async () => {
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  it("agrees with the page at each read clock and never rewrites a saved pack", async () => {
    const snapshot = await db.financeSnapshot.findFirstOrThrow({
      where: { kind: "readiness" },
    });
    const packs: { id: string; markdown: string }[] = [];
    for (const [now, provisional] of reads) {
      const finance = createFinanceService(
        db,
        demoFixture.userId,
        () => new Date(now),
      );
      await finance.command({
        type: "export.create",
        input: {
          idempotencyKey: `freshness-${now.replace(/\D/g, "")}`,
          snapshotIds: [snapshot.id],
          evidenceIds: [],
          pitchId: null,
          actualOrigin: "sample",
          confirmReviewed: true,
        },
      });
      const pack = await db.exportSnapshot.findFirstOrThrow({
        orderBy: { createdAt: "desc" },
      });
      const stage = `${provisional ? "Provisional · " : ""}Strengthen the evidence`;
      expect(pack.markdown).toContain(`Freshness at export ${now}: ${stage}`);
      expect(pack.markdown).toContain(`source ${snapshot.id}`);
      expect(pack.markdown).toContain('"score": "73.4"');
      packs.push({ id: pack.id, markdown: pack.markdown });
    }
    expect(new Set(packs.map((p) => p.id)).size).toBe(3);
    for (const pack of packs)
      expect(
        (await db.exportSnapshot.findUniqueOrThrow({ where: { id: pack.id } }))
          .markdown,
      ).toBe(pack.markdown);
    // The source snapshot itself is untouched.
    const after = await db.financeSnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
    });
    expect(after.output).toEqual(snapshot.output);
    expect(after.evaluatedAt).toEqual(snapshot.evaluatedAt);
  });
});
