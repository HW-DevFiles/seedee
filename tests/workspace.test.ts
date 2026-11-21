import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { createDatabase } from "@/lib/db-client";
import {
  createWorkspaceService,
  syncTaskApproval,
} from "@/features/workspace/service";
import { createFinanceService } from "@/features/finance/service";
import {
  sampleAgencyDraft,
  sampleOnboarding,
} from "@/features/workspace/fixtures";
import { actualSchema, DomainError } from "@/features/workspace/contracts";
import { sampleForecast } from "@/features/finance/forecast";
import { initializeSyntheticWorkspace } from "../prisma/seed-domain";
import { readinessSchema } from "@/features/finance/contracts";
import { emptyReadiness } from "@/features/finance/readiness";
import {
  assertMutationOrigin,
  consumeExportLimit,
  safeFailure,
} from "@/features/workspace/boundary";
const directory = mkdtempSync(join(tmpdir(), "seedee-workspace-")),
  url = `file:${join(directory, "test.db")}`,
  db = createDatabase(url),
  clock = () => new Date("2026-11-21T00:00:00Z"),
  stamp = clock().toISOString();
const owner = "owner",
  other = "other",
  workspace = createWorkspaceService(db, owner, clock),
  second = createWorkspaceService(db, other, clock),
  finance = createFinanceService(db, owner, clock);
const meta = (origin: "sample" | "user_entered" = "user_entered") => ({
  origin,
  asOf: "2026-10-31T00:00:00Z",
  sourceReference: "Owner-entered evidence",
  reviewStatus: "owner_attested" as const,
  reviewer: null,
  reviewedAt: null,
  reviewReference: null,
});
const record = (v: unknown) =>
  z.object({ id: z.string(), version: z.number() }).parse(v);
let agencyId: string, clientId: string, projectId: string;
function actual(period: string, revenue: number | null = 0) {
  return actualSchema.parse({
    yearMonth: period,
    currency: "USD",
    sourceMode: "manual",
    recognizedRevenueMinor: revenue,
    cashReceiptsMinor: null,
    deliveryCostsMinor: null,
    overheadMinor: null,
    founderPayMinor: null,
    cashTaxPaymentsMinor: null,
    cashInterestPaymentsMinor: null,
    cashMinor: null,
    receivablesMinor: null,
    capexMinor: null,
    principalPaymentsMinor: null,
    financingMinor: null,
    ownerContributionsMinor: null,
    ownerDistributionsMinor: null,
    provenance: meta(),
  });
}
beforeAll(async () => {
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  for (const id of [owner, other])
    await db.user.create({
      data: {
        id,
        name: id,
        email: `${id}@example.test`,
        passwordHash: "unused-test-hash",
      },
    });
});
afterAll(async () => {
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
describe("persistent owner workspace", () => {
  it("starts without an agency or fabricated business facts and saves/resumes onboarding", async () => {
    expect((await workspace.readWorkspace()).agency).toBeNull();
    await workspace.command({
      type: "onboarding.save",
      input: { expectedVersion: null, data: sampleOnboarding },
    });
    expect((await workspace.readWorkspace()).onboarding?.data).toMatchObject({
      weeklyCapacityHours: 30,
      revenueStage: "unknown",
    });
    await expect(
      workspace.command({
        type: "onboarding.save",
        input: { expectedVersion: null, data: sampleOnboarding },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      workspace.command({
        type: "onboarding.save",
        input: {
          expectedVersion: 1,
          data: { ...sampleOnboarding, weeklyCapacityHours: 169 },
        },
      }),
    ).rejects.toThrow();
  });
  it("keeps drafts inactive, validates the canonical schema and atomically accepts once", async () => {
    const draft = record(
      await workspace.command({
        type: "draft.save",
        input: {
          content: sampleAgencyDraft(),
          onboardingVersion: 1,
          providerVersion: "agency-engine-v1.0",
          templateVersion: "creative-templates-v1.0",
          inputHash: "fixture-input",
        },
      }),
    );
    expect((await workspace.readWorkspace()).agency).toBeNull();
    const input = {
      draftId: draft.id,
      expectedVersion: 1,
      idempotencyKey: "accept-once",
    };
    const first = z
      .object({ id: z.string() })
      .parse(await workspace.command({ type: "agency.accept", input }));
    const repeated = z
      .object({ id: z.string() })
      .parse(await workspace.command({ type: "agency.accept", input }));
    agencyId = first.id;
    expect(repeated.id).toBe(first.id);
    expect(await db.agency.count({ where: { ownerId: owner } })).toBe(1);
    const saved = await workspace.readWorkspace();
    expect(saved.packages).toHaveLength(3);
    expect(saved.agency?.rolesAndWorkflows).toMatchObject({
      roles: expect.any(Array),
      workflows: expect.any(Array),
    });
    expect(saved.actuals).toEqual([]);
    expect(saved.agency?.sampleWorkspace).toBe(false);
    await expect(
      workspace.command({
        type: "draft.edit",
        input: {
          id: draft.id,
          expectedVersion: 2,
          content: sampleAgencyDraft(),
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("consumes a current saved engine draft and rolls back invalid acceptance", async () => {
    await second.command({
      type: "onboarding.save",
      input: { data: sampleOnboarding, expectedVersion: null },
    });
    const broken = sampleAgencyDraft();
    broken.roles[6] = broken.roles[0];
    await expect(
      second.command({
        type: "draft.save",
        input: {
          content: broken,
          onboardingVersion: 1,
          providerVersion: "agency-engine-v1.0",
          templateVersion: "creative-templates-v1.0",
          inputHash: "broken",
        },
      }),
    ).rejects.toThrow();
    expect(
      await db.agency.findUnique({ where: { ownerId: other } }),
    ).toBeNull();
    await db.agencyEngineState.create({
      data: {
        id: other,
        payload: JSON.stringify({
          drafts: [
            {
              id: "engine-draft",
              version: 1,
              status: "generated",
              content: sampleAgencyDraft(),
              inputHash: "engine-input",
            },
          ],
          runs: [],
          artifacts: [],
          pitches: [],
        }),
      },
    });
    await second.command({
      type: "agency.accept",
      input: {
        draftId: "engine-draft",
        expectedVersion: 1,
        idempotencyKey: "accept-engine",
      },
    });
    expect(
      (await db.agencyEngineState.findUniqueOrThrow({ where: { id: other } }))
        .agencyId,
    ).toBe((await second.readWorkspace()).agency?.id);
  });
  it("validates pricing including explicit free work and version conflicts", async () => {
    const p = (await workspace.readWorkspace()).packages[0];
    const data = {
      title: "Free sample",
      deliverables: ["Sample"],
      exclusions: [],
      revisionLimit: 0,
      turnaroundDays: 1,
      laborHours: 0,
      priceMinor: 0,
      currency: "USD",
      pricingBasis: {
        kind: "illustrative_assumption",
        laborRateMinor: 0,
        directCostMinor: 0,
        targetMarginBps: 0,
        note: "Explicit free sample",
      },
    };
    await expect(
      workspace.command({ type: "package.create", input: data }),
    ).rejects.toThrow();
    const free = record(
      await workspace.command({
        type: "package.create",
        input: { ...data, freeSample: true, draft: true },
      }),
    );
    await workspace.command({
      type: "package.delete",
      input: { id: free.id, expectedVersion: 1 },
    });
    await expect(
      workspace.command({
        type: "package.archive",
        input: { id: p.id, expectedVersion: 99, archived: true },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("creates clients/projects and rejects forged nested references", async () => {
    const c = record(
      await workspace.command({
        type: "client.create",
        input: {
          name: "Synthetic client",
          economicGroupId: "same-buying-control",
          note: "Test only",
          contactEmail: "client@example.test",
        },
      }),
    );
    clientId = c.id;
    const foreign = record(
      await second.command({
        type: "client.create",
        input: { name: "Other agency", economicGroupId: "other-group" },
      }),
    );
    await expect(
      workspace.command({
        type: "project.create",
        input: { title: "Forged", clientId: foreign.id },
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    const p = record(
      await workspace.command({
        type: "project.create",
        input: {
          title: "Internal test delivery",
          clientId,
          packageId: (await workspace.readWorkspace()).packages[0].id,
        },
      }),
    );
    projectId = p.id;
    expect((await workspace.readWorkspace()).projects[0].budgetMinor).toBe(
      100000,
    );
    expect((await workspace.readWorkspace()).clients[0].projects[0].id).toBe(
      projectId,
    );
    await expect(
      second.command({
        type: "project.update",
        input: {
          id: projectId,
          expectedVersion: 1,
          data: { title: "Steal", clientId: null, packageId: null },
        },
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
  });
  it("preserves archived client history and prevents new work", async () => {
    await workspace.command({
      type: "client.archive",
      input: { id: clientId, expectedVersion: 1, archived: true },
    });
    await expect(
      workspace.command({
        type: "project.create",
        input: { title: "New accidental work", clientId },
      }),
    ).rejects.toThrow("active client");
    expect((await workspace.readWorkspace()).clients[0].projects).toHaveLength(
      1,
    );
    await workspace.command({
      type: "client.archive",
      input: { id: clientId, expectedVersion: 2, archived: false },
    });
  });
  it("rejects self/circular/cross-agency dependencies, gates work and unlocks once", async () => {
    const a = record(
        await workspace.command({
          type: "task.create",
          input: {
            title: "Brief",
            projectId,
            dueAt: "2026-10-01T00:00:00Z",
            reviewNeeded: true,
          },
        }),
      ),
      b = record(
        await workspace.command({
          type: "task.create",
          input: { title: "Draft", projectId, predecessorIds: [a.id] },
        }),
      );
    await expect(
      workspace.command({
        type: "task.transition",
        input: { id: b.id, expectedVersion: 1, status: "in_progress" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      workspace.command({
        type: "task.update",
        input: {
          id: a.id,
          expectedVersion: 1,
          data: { title: "cycle", projectId, predecessorIds: [b.id] },
        },
      }),
    ).rejects.toThrow("cycles");
    await expect(
      workspace.command({
        type: "task.update",
        input: {
          id: a.id,
          expectedVersion: 1,
          data: { title: "self", projectId, predecessorIds: [a.id] },
        },
      }),
    ).rejects.toThrow("cycles");
    await expect(
      workspace.command({
        type: "task.create",
        input: { title: "foreign", predecessorIds: ["missing-other-task"] },
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    await workspace.command({
      type: "task.transition",
      input: { id: a.id, expectedVersion: 1, status: "in_progress" },
    });
    await workspace.command({
      type: "task.transition",
      input: { id: a.id, expectedVersion: 2, status: "awaiting_review" },
    });
    expect((await workspace.readWorkspace()).home.awaitingReview).toBe(1);
    await workspace.command({
      type: "task.transition",
      input: { id: a.id, expectedVersion: 3, status: "done" },
    });
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: b.id } })).status,
    ).toBe("queued");
    expect((await workspace.readWorkspace()).home.awaitingReview).toBe(0);
    await expect(
      workspace.command({
        type: "task.transition",
        input: { id: a.id, expectedVersion: 3, status: "done" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await workspace.command({
      type: "task.transition",
      input: {
        id: b.id,
        expectedVersion: 2,
        status: "cancelled",
        note: "Explicitly cancelled test work",
      },
    });
  });
  it("records due-date history without rewriting the original commitment", async () => {
    const task = record(
      await workspace.command({
        type: "task.create",
        input: { title: "Deadline history", dueAt: "2026-10-02T00:00:00Z" },
      }),
    );
    await workspace.command({
      type: "task.update",
      input: {
        id: task.id,
        expectedVersion: 1,
        data: { title: "Deadline history", dueAt: "2026-12-01T00:00:00Z" },
      },
    });
    const saved = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.originalCommittedDueAt?.toISOString()).toBe(
      "2026-10-02T00:00:00.000Z",
    );
    expect(saved.dueDateHistory).toHaveLength(1);
  });
  it("rejects direct edits to workflow-owned task state", async () => {
    const task = record(
      await workspace.command({
        type: "task.create",
        input: { title: "Workflow task" },
      }),
    );
    await db.automationState.create({
      data: {
        agencyId,
        stateJson: JSON.stringify({ tasks: [{ id: task.id }] }),
      },
    });
    await expect(
      workspace.command({
        type: "task.transition",
        input: { id: task.id, expectedVersion: 1, status: "in_progress" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("completes projects without inventing revenue and corrects closeout by stable reference", async () => {
    await workspace.command({
      type: "project.transition",
      input: { id: projectId, expectedVersion: 1, status: "active" },
    });
    await workspace.command({
      type: "project.transition",
      input: { id: projectId, expectedVersion: 2, status: "review" },
    });
    await workspace.command({
      type: "project.transition",
      input: { id: projectId, expectedVersion: 3, status: "completed" },
    });
    expect((await workspace.readWorkspace()).actuals).toEqual([]);
    const data = {
      deliveryDate: "2026-10-15T00:00:00Z",
      recognizedRevenueMinor: 100000,
      receiptsMinor: 50000,
      deliveryCostMinor: 20000,
      founderLaborHours: 5,
      founderCostTreatment: "Recorded separately, not paid twice",
      repeatabilityNotes: "Internal evidence",
      recurrenceType: "one_off",
      provenance: meta(),
    };
    await workspace.command({
      type: "closeout.save",
      input: { projectId, expectedVersion: null, data },
    });
    await workspace.command({
      type: "closeout.save",
      input: {
        projectId,
        expectedVersion: 1,
        data: { ...data, recognizedRevenueMinor: 120000, receiptsMinor: 60000 },
      },
    });
    expect(await db.projectCloseout.count({ where: { agencyId } })).toBe(1);
    expect(
      await db.evidenceItem.count({
        where: { agencyId, metricKey: "project_closeout" },
      }),
    ).toBe(1);
    const period = await db.financialActualPeriod.findUniqueOrThrow({
      where: { agencyId_yearMonth: { agencyId, yearMonth: "2026-10" } },
    });
    expect(actualSchema.parse(period.data)).toMatchObject({
      recognizedRevenueMinor: 120000,
      cashReceiptsMinor: 60000,
      overheadMinor: null,
    });
    await expect(
      workspace.command({
        type: "actual.save",
        input: {
          expectedVersion: period.version,
          data: actual("2026-10", 900000),
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("preserves history while archiving a project", async () => {
    await workspace.command({
      type: "project.archive",
      input: { id: projectId, expectedVersion: 4, archived: true },
    });
    expect(
      (
        await db.project.findUniqueOrThrow({
          where: { id: projectId },
          include: { closeout: true },
        })
      ).closeout,
    ).not.toBeNull();
    expect((await workspace.readWorkspace()).home.completedProjects).toBe(1);
  });
  it("persists unknown actuals and prevents changing their origin", async () => {
    const saved = record(
      await workspace.command({
        type: "actual.save",
        input: { expectedVersion: null, data: actual("2026-09", null) },
      }),
    );
    expect(
      (await workspace.readWorkspace()).actuals.find((a) => a.id === saved.id)
        ?.data,
    ).toMatchObject({ recognizedRevenueMinor: null, cashReceiptsMinor: null });
    await expect(
      workspace.command({
        type: "actual.save",
        input: {
          expectedVersion: 1,
          data: { ...actual("2026-09", 0), provenance: meta("sample") },
        },
      }),
    ).rejects.toThrow("Origin");
    await expect(
      workspace.command({
        type: "actual.save",
        input: { expectedVersion: null, data: actual("2026-12", 0) },
      }),
    ).rejects.toThrow("closed");
  });
  it("validates evidence references and review metadata", async () => {
    await expect(
      workspace.command({
        type: "evidence.save",
        input: {
          id: null,
          expectedVersion: null,
          data: {
            category: "market",
            metricKey: "source",
            value: { note: "bad link" },
            provenance: meta(),
            sourceUrl: "javascript:alert(1)",
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      workspace.command({
        type: "evidence.save",
        input: {
          id: null,
          expectedVersion: null,
          data: {
            category: "market",
            metricKey: "source",
            value: null,
            provenance: { ...meta(), reviewStatus: "externally_reviewed" },
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      workspace.command({
        type: "checklist.save",
        input: {
          id: null,
          expectedVersion: null,
          data: {
            category: "market",
            title: "Other evidence",
            state: "owner_attested",
            note: "",
            sourceUrl: null,
            evidenceIds: ["foreign-evidence"],
            period: "2026-10",
            reviewedAt: stamp,
            ownerLabel: "Owner",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
  });
  it("saves immutable readiness/projection snapshots and leaves actuals unchanged", async () => {
    const before = await db.financialActualPeriod.findMany({
      where: { agencyId },
    });
    const empty = emptyReadiness("2026-10-31T00:00:00Z");
    const readiness = z
      .object({ id: z.string(), output: z.object({ score: z.string() }) })
      .parse(
        await finance.command({
          type: "finance.readiness",
          input: { input: empty },
        }),
      );
    expect(readiness.output.score).toBe("0.0");
    const input = { ...sampleForecast("downside"), provenance: meta() };
    const scenario = z.object({ id: z.string() }).parse(
      await finance.command({
        type: "finance.forecast",
        input: { name: "Downside", input },
      }),
    );
    const changed = z.object({ id: z.string() }).parse(
      await finance.command({
        type: "finance.forecast",
        input: {
          name: "Edited downside",
          input: { ...input, volumeMultiplier: "0.7" },
        },
      }),
    );
    expect(scenario.id).not.toBe(changed.id);
    expect(
      (
        await db.financeSnapshot.findUniqueOrThrow({
          where: { id: readiness.id },
        })
      ).output,
    ).toMatchObject({ score: "0.0" });
    expect(
      await db.financialActualPeriod.findMany({ where: { agencyId } }),
    ).toEqual(before);
  });
  it("creates immutable private exports with source/version/unknown labels, idempotent receipts and owner checks", async () => {
    const snapshot = await db.financeSnapshot.findFirstOrThrow({
      where: { agencyId, kind: "forecast" },
    });
    const input = {
      idempotencyKey: "export-one",
      snapshotIds: [snapshot.id],
      evidenceIds: [],
      pitchId: null,
      actualOrigin: "user_entered",
      confirmReviewed: true,
    };
    const created = z
      .object({ id: z.string(), markdown: z.string(), csv: z.string() })
      .parse(await finance.command({ type: "export.create", input }));
    expect(created.markdown).toContain("Educational planning only.");
    expect(created.markdown).toContain("Evidence needed");
    expect(created.markdown).toContain("agency-finance-v1.1");
    expect(created.csv).toContain(
      "origin,asOf,sourceReference,reviewStatus,formulaVersion",
    );
    expect(created.csv).toContain("assumption");
    const repeat = z
      .object({ id: z.string() })
      .parse(await finance.command({ type: "export.create", input }));
    expect(repeat.id).toBe(created.id);
    await expect(
      finance.command({
        type: "export.create",
        input: { ...input, snapshotIds: [] },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      createFinanceService(db, other, clock).download(created.id),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    const text = (await finance.download(created.id)).markdown;
    await workspace.command({
      type: "agency.update",
      input: {
        id: agencyId,
        expectedVersion: 1,
        name: "Changed later",
        positioning: "New statement",
        buyer: "New buyer",
        goal: "New goal",
      },
    });
    expect((await finance.download(created.id)).markdown).toBe(text);
  });
  it("records owner review in the manifest and rejects unreviewed bridged pitches", async () => {
    const snapshot = await db.financeSnapshot.findFirstOrThrow({
      where: { agencyId, kind: "forecast" },
    });
    const pitch = {
      id: "bridged-pitch",
      version: 2,
      content: "Bridged pitch",
      origin: "assumption" as const,
      sourceIds: [snapshot.id],
      templateVersion: "pitch-template-test",
    };
    const input = {
      snapshotIds: [snapshot.id],
      evidenceIds: [],
      pitchId: pitch.id,
      actualOrigin: "user_entered",
      confirmReviewed: true,
    };
    await expect(
      createFinanceService(db, owner, clock, {
        loadPitch: async () => ({ ...pitch, reviewed: false }),
      }).command({
        type: "export.create",
        input: { ...input, idempotencyKey: "unreviewed-pitch" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const created = z.object({ id: z.string() }).parse(
      await createFinanceService(db, owner, clock, {
        loadPitch: async () => ({ ...pitch, reviewed: true }),
      }).command({
        type: "export.create",
        input: { ...input, idempotencyKey: "reviewed-pitch" },
      }),
    );
    expect((await finance.download(created.id)).manifest).toMatchObject({
      confirmReviewed: true,
      pitchId: pitch.id,
      pitchVersion: 2,
    });
    await expect(
      finance.command({
        type: "export.create",
        input: {
          ...input,
          pitchId: null,
          idempotencyKey: "unconfirmed",
          confirmReviewed: false,
        },
      }),
    ).rejects.toThrow();
  });
  it("rejects combined sample/real exports and forged snapshot references", async () => {
    const sample = z.object({ id: z.string() }).parse(
      await finance.command({
        type: "finance.forecast",
        input: { name: "Sample only", input: sampleForecast() },
      }),
    );
    await expect(
      finance.command({
        type: "export.create",
        input: {
          idempotencyKey: "mixed",
          snapshotIds: [sample.id],
          evidenceIds: [],
          actualOrigin: "user_entered",
          confirmReviewed: true,
        },
      }),
    ).rejects.toThrow("separately");
    await expect(
      finance.command({
        type: "export.create",
        input: {
          idempotencyKey: "forged",
          snapshotIds: ["other-owned-snapshot"],
          evidenceIds: [],
          actualOrigin: "user_entered",
          confirmReviewed: true,
        },
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    const separate = await finance.command({
      type: "export.create",
      input: {
        idempotencyKey: "sample-separate",
        snapshotIds: [sample.id],
        evidenceIds: [],
        actualOrigin: "sample",
        confirmReviewed: true,
      },
    });
    expect(separate).toMatchObject({
      markdown: expect.stringContaining("Demo preview · Sample data"),
    });
  });
  it("rechecks missing identity and keeps second-account reads isolated", async () => {
    await expect(
      createWorkspaceService(db, "missing", clock).readWorkspace(),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    const w = await second.readWorkspace();
    expect(w.projects).toEqual([]);
    expect(w.actuals).toEqual([]);
    expect(w.exports).toEqual([]);
    expect(w.clients.some((c) => c.id === clientId)).toBe(false);
  });
  it("initializes only the reserved synthetic workspace, scores its complete ledger and preserves edits on repeat", async () => {
    await expect(
      initializeSyntheticWorkspace(db, clock()),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
    await db.user.create({
      data: {
        id: "seedee-demo-user-v1",
        email: "demo@seedee.local",
        name: "Synthetic local owner",
        passwordHash: "unused-test-hash",
      },
    });
    await db.agency.create({
      data: {
        id: "seedee-demo-agency-v1",
        ownerId: "seedee-demo-user-v1",
        name: "Fieldwork Studio",
      },
    });
    expect(await initializeSyntheticWorkspace(db, clock())).toMatchObject({
      initialized: true,
    });
    const synthetic = createWorkspaceService(db, "seedee-demo-user-v1", clock),
      saved = await synthetic.readWorkspace();
    expect(saved.agency?.sampleWorkspace).toBe(true);
    expect(saved.actuals).toHaveLength(6);
    expect(
      saved.snapshots.find((s) => s.kind === "readiness")?.output,
    ).toMatchObject({ score: "73.4", coveragePercent: "100" });
    const score = saved.snapshots.find((s) => s.kind === "readiness")!,
      input = readinessSchema.parse(score.input);
    const current = await createFinanceService(
      db,
      "seedee-demo-user-v1",
      clock,
    ).command({ type: "finance.readiness", input: { input } });
    expect(current).toMatchObject({
      output: expect.objectContaining({ score: "73.4" }),
    });
    await db.agency.update({
      where: { id: "seedee-demo-agency-v1" },
      data: { name: "Edited sample profile" },
    });
    expect(await initializeSyntheticWorkspace(db, clock())).toMatchObject({
      initialized: false,
    });
    expect((await synthetic.readWorkspace()).agency?.name).toBe(
      "Edited sample profile",
    );
    await synthetic.command({
      type: "workspace.reset",
      input: { confirmation: "RESET MY SAMPLE WORKSPACE" },
    });
    expect((await synthetic.readWorkspace()).agency).toBeNull();
    expect((await workspace.readWorkspace()).agency?.id).toBe(agencyId);
  });
  it("explicitly changes monthly source mode without ever adding manual and project totals", async () => {
    const period = await db.financialActualPeriod.findUniqueOrThrow({
      where: { agencyId_yearMonth: { agencyId, yearMonth: "2026-10" } },
    });
    await workspace.command({
      type: "actual.source",
      input: {
        yearMonth: "2026-10",
        expectedVersion: period.version,
        sourceMode: "manual",
        confirmReplace: true,
      },
    });
    const manual = await db.financialActualPeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    await workspace.command({
      type: "actual.save",
      input: {
        expectedVersion: manual.version,
        data: actual("2026-10", 500000),
      },
    });
    const updated = await db.financialActualPeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    await workspace.command({
      type: "actual.source",
      input: {
        yearMonth: "2026-10",
        expectedVersion: updated.version,
        sourceMode: "derived",
        confirmReplace: true,
      },
    });
    expect(
      actualSchema.parse(
        (
          await db.financialActualPeriod.findUniqueOrThrow({
            where: { id: period.id },
          })
        ).data,
      ).recognizedRevenueMinor,
    ).toBe(120000);
  });
  it("deletes an unreferenced draft offer after saving actuals but keeps snapshot-referenced offers", async () => {
    const offer = {
      title: "Draft offer",
      deliverables: ["Draft"],
      exclusions: [],
      revisionLimit: 0,
      turnaroundDays: 1,
      laborHours: 0,
      priceMinor: 0,
      currency: "USD",
      freeSample: true,
      draft: true,
      pricingBasis: {
        kind: "illustrative_assumption",
        laborRateMinor: 0,
        directCostMinor: 0,
        targetMarginBps: 0,
        note: "Explicit free sample",
      },
    };
    expect(
      await db.financeSnapshot.count({
        where: { agencyId, kind: "actual_revision" },
      }),
    ).toBeGreaterThan(0);
    const unreferenced = record(
      await workspace.command({ type: "package.create", input: offer }),
    );
    await workspace.command({
      type: "package.delete",
      input: { id: unreferenced.id, expectedVersion: 1 },
    });
    expect(
      await db.servicePackage.findUnique({ where: { id: unreferenced.id } }),
    ).toBeNull();
    const referenced = record(
      await workspace.command({ type: "package.create", input: offer }),
    );
    await finance.command({
      type: "finance.readiness",
      input: {
        input: {
          ...emptyReadiness("2026-10-31T00:00:00Z"),
          packages: [
            {
              id: referenced.id,
              fixedScope: "Draft scope",
              priceCostBasis: "Draft basis",
              sopVersion: "sop-1",
              sopCreatedAt: "2026-10-01T00:00:00Z",
              checklist: ["Check"],
            },
          ],
        },
      },
    });
    await expect(
      workspace.command({
        type: "package.delete",
        input: { id: referenced.id, expectedVersion: 1 },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("retains data across disconnect/reconnect and blocks resetting real workspaces", async () => {
    const connection = createDatabase(url);
    try {
      expect(
        (
          await createWorkspaceService(connection, owner, clock).readWorkspace()
        ).projects.some((p) => p.id === projectId),
      ).toBe(true);
    } finally {
      await connection.$disconnect();
    }
    await expect(
      workspace.command({
        type: "workspace.reset",
        input: { confirmation: "RESET MY SAMPLE WORKSPACE" },
      }),
    ).rejects.toMatchObject({ code: "forbidden_or_missing" });
  });
});
describe("acceptance rollback and saved approval", () => {
  it("rolls back the whole acceptance after agency creation if an offer is invalid", async () => {
    const user = await db.user.create({
        data: {
          name: "Rollback",
          email: "rollback@example.test",
          passwordHash: "unused",
        },
      }),
      service = createWorkspaceService(db, user.id, clock);
    await service.command({
      type: "onboarding.save",
      input: { expectedVersion: null, data: sampleOnboarding },
    });
    const content = sampleAgencyDraft();
    content.packages[1].priceMinor = 0;
    const draft = record(
      await service.command({
        type: "draft.save",
        input: {
          content,
          onboardingVersion: 1,
          providerVersion: content.meta.providerVersion,
          templateVersion: content.meta.templateVersion,
          inputHash: "rollback-input",
        },
      }),
    );
    await expect(
      service.command({
        type: "agency.accept",
        input: {
          draftId: draft.id,
          expectedVersion: 1,
          idempotencyKey: "rollback-key",
        },
      }),
    ).rejects.toThrow();
    expect(
      await db.agency.findUnique({ where: { ownerId: user.id } }),
    ).toBeNull();
    expect(
      (await db.agencyDraft.findUniqueOrThrow({ where: { id: draft.id } }))
        .status,
    ).toBe("generated");
  });
  it("requires current saved owner approval in the standalone task bridge", async () => {
    const task = record(
      await workspace.command({
        type: "task.create",
        input: { title: "Saved review proof", assignedRoleKey: "producer" },
      }),
    );
    await workspace.command({
      type: "task.transition",
      input: { id: task.id, expectedVersion: 1, status: "in_progress" },
    });
    await workspace.command({
      type: "task.transition",
      input: { id: task.id, expectedVersion: 2, status: "awaiting_review" },
    });
    const reference = {
      artifactId: "approved-core-artifact",
      taskId: task.id,
      runId: "review-run",
      status: "approved",
      reviewedByUserId: owner,
      reviewedAt: stamp,
      current: true,
    };
    await expect(
      db.$transaction((tx) => syncTaskApproval(tx, owner, agencyId, reference)),
    ).rejects.toMatchObject({ code: "conflict" });
    await db.agencyEngineState.create({
      data: {
        id: owner,
        agencyId,
        payload: JSON.stringify({
          artifacts: [
            {
              id: reference.artifactId,
              agencyId,
              taskId: task.id,
              runId: reference.runId,
              previousRevisionId: null,
              status: "approved",
              reviewedByUserId: owner,
              reviewedAt: stamp,
            },
          ],
        }),
      },
    });
    await db.$transaction((tx) =>
      syncTaskApproval(tx, owner, agencyId, reference),
    );
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status,
    ).toBe("done");
    const row = await db.agencyEngineState.findUniqueOrThrow({
        where: { id: owner },
      }),
      state = JSON.parse(row.payload);
    state.artifacts.push({
      ...state.artifacts[0],
      id: "newer-revision",
      previousRevisionId: reference.artifactId,
      status: "draft",
    });
    await db.agencyEngineState.update({
      where: { id: owner },
      data: { payload: JSON.stringify(state) },
    });
    await expect(
      db.$transaction((tx) => syncTaskApproval(tx, owner, agencyId, reference)),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
describe("workspace cascade integrity", () => {
  it("deletes a whole owner tree without orphaning references", async () => {
    const user = await db.user.create({
      data: {
        name: "Disposable",
        email: "cascade@example.test",
        passwordHash: "unused",
      },
    });
    const agency = await db.agency.create({
      data: { ownerId: user.id, name: "Disposable" },
    });
    const client = await db.client.create({
      data: {
        agencyId: agency.id,
        name: "Synthetic client",
        economicGroupId: "group",
      },
    });
    const project = await db.project.create({
      data: {
        agencyId: agency.id,
        title: "Synthetic project",
        clientId: client.id,
      },
    });
    const predecessor = await db.task.create({
      data: {
        agencyId: agency.id,
        projectId: project.id,
        title: "Predecessor",
      },
    });
    await db.task.create({
      data: {
        agencyId: agency.id,
        projectId: project.id,
        title: "Dependent",
        predecessors: { create: { predecessorId: predecessor.id } },
      },
    });
    await expect(
      db.client.delete({ where: { id: client.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.task.delete({ where: { id: predecessor.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await db.user.delete({ where: { id: user.id } });
    expect(await db.project.count({ where: { agencyId: agency.id } })).toBe(0);
    expect(await db.task.count({ where: { agencyId: agency.id } })).toBe(0);
  });
});
describe("request boundaries", () => {
  it("rejects missing/null/cross-site/spoofed origins and preserves the local port", () => {
    for (const origin of [
      null,
      "null",
      "https://attacker.test",
      "https://localhost:3000.evil.test",
    ])
      expect(() =>
        assertMutationOrigin(origin, "localhost:3000", null),
      ).toThrow();
    expect(() =>
      assertMutationOrigin(
        "http://localhost:3000",
        "localhost:3000",
        "same-origin",
      ),
    ).not.toThrow();
    expect(() =>
      assertMutationOrigin(
        "http://localhost:3000",
        "localhost:3000",
        "cross-site",
      ),
    ).toThrow();
  });
  it("shares export quota atomically across clients and time windows without logging identity", async () => {
    const context = { userId: owner, clientIp: null };
    for (let n = 0; n < 10; n++) await consumeExportLimit(db, context, clock());
    await expect(
      consumeExportLimit(db, context, clock()),
    ).rejects.toMatchObject({ code: "rate_limited" });
    const connection = createDatabase(url);
    try {
      await expect(
        consumeExportLimit(connection, context, clock()),
      ).rejects.toMatchObject({ code: "rate_limited" });
    } finally {
      await connection.$disconnect();
    }
    await expect(
      consumeExportLimit(db, context, new Date(clock().getTime() + 900000)),
    ).resolves.toBeUndefined();
  });
  it("returns typed safe failures rather than database internals", () => {
    expect(safeFailure(Error("private database details"))).toEqual({
      ok: false,
      error: {
        code: "provider_failed",
        message: "Unable to complete this request. Please retry.",
      },
    });
    expect(safeFailure(new DomainError("conflict", "Reload"))).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });
});
