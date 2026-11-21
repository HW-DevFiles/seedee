import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
import { sampleReadiness } from "@/features/finance/fixtures";
import { previewMilestone } from "@/features/finance/milestone";
import { emptyReadiness, scoreReadiness } from "@/features/finance/readiness";
import { createFinanceService } from "@/features/finance/service";
import { createWorkspaceService } from "@/features/workspace/service";
import { applyTeamEvidence } from "@/features/finance/team";
import { connectedScreen } from "@/features/integration/view";
import { createIntegratedServices } from "@/features/integration/services";
import { type IntegratedRead } from "@/features/integration/read";
import { json } from "@/features/workspace/json";
const now = "2026-11-21T12:00:00.000Z";
const dir = mkdtempSync(join(tmpdir(), "seedee-milestone-team-"));
const url = `file:${join(dir, "test.db")}`;
const db = createDatabase(url);
const clock = vi.fn(() => new Date(now));
const finance = createFinanceService(db, "owner", clock);
const sample = createFinanceService(db, "sample", clock);
const provenance = {
  ...sampleReadiness().provenance,
  origin: "user_entered" as const,
};
beforeAll(async () => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  for (const id of ["owner", "sample", "other"]) {
    await db.user.create({
      data: {
        id,
        name: id,
        email: `${id}@example.test`,
        passwordHash: "unused",
      },
    });
    await db.agency.create({
      data: {
        id: `${id}-agency`,
        ownerId: id,
        name: id,
        sampleWorkspace: id === "sample",
      },
    });
  }
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
it("reconciles the fixed-dollar milestone to 73.4 / 79.4 / +6.0 with unchanged fixed lines and baseline", () => {
  const baseline = sampleReadiness();
  const bytes = JSON.stringify(baseline);
  const p = previewMilestone(
    { ...baseline, actualVersions: [], evidenceVersions: [] },
    [2400000, 2500000, 2600000],
    now,
  );
  expect(p.baseline.score).toBe("73.4");
  expect(p.hypothetical.score).toBe("79.4");
  expect(p.totalDelta).toBe("6.0");
  expect(p.label).toBe("If achieved and evidenced; hypothetical only");
  expect(p.baseline.evaluatedAt).toBe(p.hypothetical.evaluatedAt);
  expect(JSON.stringify(baseline)).toBe(bytes);
  expect(
    p.proposal.recognition!.filter((l) => l.packageId || l.contractId),
  ).toEqual(baseline.recognition!.filter((l) => l.packageId || l.contractId));
  expect(p.hypothetical.riskFlags).not.toContain(
    "recognition_reconciliation_required",
  );
});
it("rejects incomplete, unreconciled, unknown and below-fixed allocations without a sample fallback", () => {
  expect(() =>
    previewMilestone(emptyReadiness("2026-10-31T00:00:00Z"), [1, 2, 3], now),
  ).toThrow("Evidence needed");
  const v = sampleReadiness();
  v.months[0].revenueMinor = null;
  expect(() => previewMilestone(v, [2400000, 2500000, 2600000], now)).toThrow(
    "Evidence needed",
  );
  v.months[0].revenueMinor = 1700001;
  expect(() => previewMilestone(v, [2400000, 2500000, 2600000], now)).toThrow(
    "Evidence needed",
  );
  expect(() => previewMilestone(sampleReadiness(), [1, 2, 3], now)).toThrow(
    "fixed package/retainer",
  );
});
it("loads only an owned versioned baseline and persists only a separate proposal with one clock", async () => {
  const v = sampleReadiness();
  const row = await db.financeSnapshot.create({
    data: {
      agencyId: "sample-agency",
      kind: "readiness",
      formulaVersion: "readiness-v1.1",
      asOf: new Date(v.asOf),
      evaluatedAt: new Date(now),
      input: json({ ...v, actualVersions: [], evidenceVersions: [] }),
      output: json(scoreReadiness(v, now)),
      provenance: json(v.provenance),
    },
  });
  const before = await db.financeSnapshot.findUniqueOrThrow({
    where: { id: row.id },
  });
  clock.mockClear();
  const command = {
    type: "finance.milestone",
    input: {
      baselineId: row.id,
      milestone: "revenue_fixed_dollars",
      revenueMinor: [2400000, 2500000, 2600000],
    },
  };
  const result = await sample.command(command);
  expect(clock).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    kind: "readiness_proposal",
    output: {
      baseline: { score: "73.4" },
      hypothetical: { score: "79.4" },
      totalDelta: "6.0",
      sourceSnapshotId: row.id,
      sourceVersion: "readiness-v1.1",
      evaluatedAt: now,
    },
  });
  expect(
    await db.financeSnapshot.findUnique({ where: { id: row.id } }),
  ).toEqual(before);
  expect(await db.financialActualPeriod.count()).toBe(0);
  await expect(finance.command(command)).rejects.toMatchObject({
    code: "forbidden_or_missing",
  });
  await expect(
    createFinanceService(db, "missing").command(command),
  ).rejects.toMatchObject({ code: "unauthenticated" });
  const core = createWorkspaceService(db, "sample");
  const services = createIntegratedServices(db);
  const data = {
    workspace: await core.readWorkspace(),
    engine: await services.engine.readWorkspace("sample", "sample-agency"),
    automation: await services.automation.readWorkspace(
      "sample",
      "sample-agency",
    ),
    readAt: now,
    userName: "Sample",
    context: { userId: "sample" },
  } as IntegratedRead;
  const card = connectedScreen(data, "growth")!.screen.cards![0];
  expect(card.details).toEqual(
    expect.arrayContaining([
      { label: "Baseline score", value: "73.4" },
      { label: "Hypothetical score", value: "79.4" },
      { label: "Full total delta", value: "+6.0" },
    ]),
  );
});
it.each([
  null,
  [],
  [
    {
      humanId: "founder",
      date: "2026-10-01T00:00:00Z",
      hours: 0,
      sourceId: "zero",
    },
  ],
])(
  "keeps missing/zero delivery hours unknown without asserting unpaid labor (%j)",
  (logs) => {
    const v = sampleReadiness();
    v.deliveryHours = logs;
    v.humans![0].compensationMinor = null;
    const r = scoreReadiness(v, now);
    expect(r.components.find((c) => c.key === "H_founder")).toMatchObject({
      rawValue: null,
      availability: false,
      points: "0",
    });
    expect(r.riskFlags).not.toContain("founder_unpaid_labor");
  },
);
it.each([0, null])(
  "flags only known positive founder hours with zero/unknown pay (%j)",
  (pay) => {
    const v = sampleReadiness();
    v.humans![0].compensationMinor = pay;
    expect(scoreReadiness(v, now).riskFlags).toContain("founder_unpaid_labor");
  },
);
it("validates and persists typed team evidence with retry identity, revisions and scoped references", async () => {
  const human = {
    entryId: "founder",
    provenance,
    record: {
      kind: "human",
      data: {
        id: "founder",
        role: "Delivery",
        simulated: false,
        isFounder: true,
        compensationMinor: null,
        agreementStart: "2026-05-01T00:00:00Z",
        agreementEnd: null,
      },
    },
  };
  const saved = await finance.command({ type: "finance.team", input: human });
  expect(await finance.command({ type: "finance.team", input: human })).toEqual(
    saved,
  );
  expect(
    await db.evidenceItem.count({ where: { agencyId: "owner-agency" } }),
  ).toBe(1);
  const changed = {
    ...human,
    record: {
      ...human.record,
      data: { ...human.record.data, compensationMinor: 200000 },
    },
  };
  await expect(
    finance.command({ type: "finance.team", input: changed }),
  ).rejects.toMatchObject({ code: "conflict" });
  await finance.command({
    type: "finance.team",
    input: { ...changed, expectedVersion: 1 },
  });
  await expect(
    finance.command({
      type: "finance.team",
      input: {
        ...changed,
        record: {
          ...changed.record,
          data: { ...changed.record.data, role: "Changed" },
        },
        expectedVersion: 1,
      },
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  const log = {
    entryId: "log-1",
    provenance,
    record: {
      kind: "hours",
      data: { humanId: "founder", date: "2026-10-01T00:00:00Z", hours: 12 },
    },
  };
  await finance.command({ type: "finance.team", input: log });
  await expect(
    createFinanceService(db, "other").command({
      type: "finance.team",
      input: log,
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  await expect(
    finance.command({
      type: "finance.team",
      input: {
        ...log,
        record: {
          kind: "hours",
          data: { ...log.record.data, date: "2027-01-01T00:00:00Z" },
        },
      },
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  const rows = await db.evidenceItem.findMany({
    where: { agencyId: "owner-agency" },
  });
  const mapped = applyTeamEvidence(emptyReadiness(provenance.asOf), rows);
  expect(mapped.humans).toHaveLength(1);
  expect(mapped.humans![0].compensationMinor).toBe(200000);
  expect(mapped.deliveryHours![0]).toMatchObject({
    humanId: "founder",
    hours: 12,
  });
  expect(
    scoreReadiness(mapped, now).components.find((c) => c.key === "H_founder"),
  ).toMatchObject({ rawValue: "1", availability: true });
  const row = rows[0];
  await expect(
    createWorkspaceService(db, "owner").command({
      type: "evidence.save",
      input: {
        id: row.id,
        expectedVersion: row.version,
        data: {
          category: "product_operations",
          metricKey: "renamed",
          value: {},
          provenance,
        },
      },
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
});

it("renders one missing-founder notice for an owner's new snapshot and no sample fallback", async () => {
  const input = emptyReadiness(provenance.asOf);
  await createFinanceService(db, "other", clock).command({
    type: "finance.readiness",
    input: { input },
  });
  const services = createIntegratedServices(db);
  const data = {
    workspace: await createWorkspaceService(db, "other").readWorkspace(),
    engine: await services.engine.readWorkspace("other", "other-agency"),
    automation: await services.automation.readWorkspace(
      "other",
      "other-agency",
    ),
    readAt: now,
    userName: "Other",
    context: { userId: "other" },
  } as IntegratedRead;
  const view = connectedScreen(data, "readiness")!.screen;
  expect(
    view.notices!.filter((n) =>
      n.body.includes(
        "Founder delivery workload and replacement cost not entered; founder dependence is unknown.",
      ),
    ),
  ).toHaveLength(1);
  expect(view.tables![0].rows.find((r) => r.id === "H_founder")!.cells).toEqual(
    ["H_founder", "Unknown", "0 / 2", "missing_or_invalid_evidence"],
  );
});
it("requires an explicit founder log before showing a zero founder share", () => {
  const v = sampleReadiness();
  v.deliveryHours = v.deliveryHours!.filter((l) => l.humanId !== "founder");
  const r = scoreReadiness(v, now);
  expect(r.components.find((c) => c.key === "H_founder")).toMatchObject({
    rawValue: null,
    availability: false,
    points: "0",
  });
  expect(r.riskFlags).not.toContain("founder_unpaid_labor");
});

it("keeps the in-window team record when a later correction postdates the snapshot", () => {
  const record = (compensationMinor: number, asOf: string, at: string) => ({
    id: `row-${compensationMinor}`,
    version: 1,
    metricKey: "readiness_team",
    provenance: { ...provenance, asOf },
    createdAt: new Date(at),
    value: {
      content: {
        entryId: "founder",
        provenance: { ...provenance, asOf },
        record: {
          kind: "human",
          data: {
            id: "founder",
            role: "Delivery",
            simulated: false,
            isFounder: true,
            compensationMinor,
            agreementStart: "2026-05-01T00:00:00Z",
            agreementEnd: null,
          },
        },
      },
    },
  });
  const later = new Date(Date.parse(provenance.asOf) + 86400000).toISOString();
  const mapped = applyTeamEvidence(emptyReadiness(provenance.asOf), [
    record(100000, provenance.asOf, "2026-10-01T00:00:00Z"),
    record(200000, later, "2026-11-01T00:00:00Z"),
    {
      id: "unrelated",
      version: 1,
      metricKey: "other",
      provenance: "malformed",
      createdAt: new Date("2026-11-02T00:00:00Z"),
      value: {},
    },
  ]);
  expect(mapped.humans).toHaveLength(1);
  expect(mapped.humans![0]).toMatchObject({
    compensationMinor: 100000,
    sourceIds: ["row-100000"],
  });
});
