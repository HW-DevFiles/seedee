import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDatabase } from "@/lib/db-client";
const state = vi.hoisted(() => ({
  db: null as unknown as PrismaClient,
  userId: "form-owner",
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/lib/security/request", () => ({
  requireSecurityContext: async () => ({
    userId: state.userId,
    clientIp: null,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { readIntegratedWorkspace } from "@/features/integration/read";
import { connectedScreen } from "@/features/integration/view";
import { actualSchema } from "@/features/workspace/contracts";
import { productAction } from "@/features/product-ui/actions";
const dir = mkdtempSync(join(tmpdir(), "seedee-forms-")),
  url = `file:${join(dir, "test.db")}`;
beforeAll(async () => {
  state.db = createDatabase(url);
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  await state.db.user.create({
    data: {
      id: state.userId,
      name: "Form Creative",
      email: "forms@example.test",
      passwordHash: "unused",
    },
  });
});
afterAll(async () => {
  await state.db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
async function submit(
  screen: string,
  command: string,
  values: Record<string, unknown> = {},
  recordId?: string,
) {
  const view = connectedScreen(
    await readIntegratedWorkspace(),
    screen,
    recordId,
  )!;
  const spec = view.screen.forms!.find((f) => f.id === command)!;
  expect(spec, command).toBeDefined();
  expect(spec.unavailableReason, command).toBeUndefined();
  const data = new FormData();
  data.set("screenKey", screen);
  data.set("command", command);
  data.set("idempotencyKey", crypto.randomUUID());
  if (spec.recordId) data.set("recordId", spec.recordId);
  if (spec.version !== undefined)
    data.set("expectedVersion", String(spec.version));
  if (spec.recordVersions)
    data.set("recordVersions", JSON.stringify(spec.recordVersions));
  if (spec.confirmation) data.set("confirmed", "on");
  for (const f of spec.fields) {
    const value = values[f.name] ?? f.value;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value))
      for (const v of value) data.append(f.name, String(v));
    else if (f.type === "checkbox") {
      if (value) data.set(f.name, "on");
    } else data.set(f.name, String(value));
  }
  const result = await productAction({}, data);
  expect(result, `${command}: ${JSON.stringify(result)}`).toMatchObject({
    status: "success",
  });
  return result;
}
it("binds real forms from fresh signup through agency, task approval, finance, pitch and private export", async () => {
  await submit("onboarding", "onboarding.save", {
    practices: ["designer", "photographer"],
    proposedName: "Form Studio",
    description: "Design and photography",
    targetBuyer: "Independent makers",
    goal: "Build a sustainable studio",
    weeklyCapacityHours: 30,
  });
  await submit("draft", "agency.generate");
  await submit("draft", "agency.draft.edit", {
    name: "Edited Form Studio",
    positioning: "Thoughtful creative delivery",
    buyer: "Independent makers",
  });
  await submit("draft", "agency.accept");
  let read = await readIntegratedWorkspace();
  expect(read.workspace.packages).toHaveLength(3);
  expect(read.workspace.agency?.name).toBe("Edited Form Studio");
  await submit(
    "package",
    "package.update",
    {
      sopVersion: "delivery-v1",
      sopCreatedAt: "2026-10-01",
      acceptanceChecklist: "Owner reviews scope\nOwner approves output",
    },
    read.workspace.packages[0].id,
  );
  await submit("growth", "sop.review", {
    packageId: read.workspace.packages[0].id,
    asOfDate: "2026-10-31",
    sourceReference: "Owner reviewed the saved SOP",
  });
  await submit("growth", "capacity.save", {
    availableHours: 80,
    plannedHours: 60,
    asOfDate: "2026-11-21",
    sourceReference: "Owner capacity plan",
  });
  await submit("growth", "growth.refresh");
  read = await readIntegratedWorkspace();
  expect(read.automation?.metrics.reviewedSops).toBe(1);
  expect(read.automation?.metrics.humanCapacity).toMatchObject({
    availableHours: 80,
    plannedHours: 60,
  });
  await submit("clients", "client.create", {
    name: "Client Example",
    economicGroupId: "group-example",
  });
  read = await readIntegratedWorkspace();
  await submit("projects", "project.create", {
    title: "Delivery example",
    brief: "Internal creative delivery brief",
    clientId: read.workspace.clients[0].id,
  });
  read = await readIntegratedWorkspace();
  const projectId = read.workspace.projects[0].id;
  await submit(
    "project",
    "task.create",
    {
      title: "Draft a plan",
      input: "Prepare a reviewable internal plan",
      assignedRoleKey: "creative_lead",
    },
    projectId,
  );
  read = await readIntegratedWorkspace();
  const taskId = read.workspace.tasks[0].id;
  await submit("task", "run.queue", {}, taskId);
  read = await readIntegratedWorkspace();
  const runId = read.engine.runs[0].id;
  await submit("run", "run.advance", {}, runId);
  await submit("run", "run.approve", {}, runId);
  for (const month of [
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
  ]) {
    await submit("financials", "actual.save", {
      yearMonth: month,
      recognizedRevenueMinor: "1000.00",
      cashReceiptsMinor: "800.00",
      cashMinor: "5000.00",
      asOfDate: "2026-10-31",
    });
  }
  await submit("readiness", "readiness.create", { asOfDate: "2026-10-31" });
  await submit("financials", "scenario.create", {
    name: "Owner downside",
    asOfDate: "2026-10-31",
    serviceTitle: "Design pilot",
    demandUnits: 2,
    hoursPerUnit: 10,
    availableHours: 80,
    hireAdditionalHours: 0,
    overheadGrowth: 0,
    taxRate: 0.2,
    contingencyRate: 0.1,
    unitPriceMinor: 1000,
    unitDirectCostMinor: 200,
    openingCashMinor: 5000,
    openingReceivablesMinor: 400,
    openingPayablesMinor: 0,
    openingDeferredRevenueMinor: 0,
    openingDebtMinor: 0,
    overheadMinor: 1000,
    founderPayMinor: 500,
    hireMonthlyCostMinor: 0,
    capexMinor: 0,
    fixedFinancingCostsMinor: 0,
    founderDeliveryPayFraction: 0.5,
    reserveTargetMinor: 1000,
  });
  read = await readIntegratedWorkspace();
  const readiness = read.workspace.snapshots.find(
      (s) => s.kind === "readiness",
    )!,
    forecast = read.workspace.snapshots.find((s) => s.kind === "forecast")!;
  const facts = (readiness.output as { facts: { id: string }[] }).facts;
  await submit("pitch", "pitch.generate", {
    sourceIds: facts.map((f) => f.id),
  });
  read = await readIntegratedWorkspace();
  const pitch = read.engine.pitches.at(-1)!;
  await submit("pitch", "pitch.update", {
    [pitch.content!.sections[0].key]:
      "An owner-reviewed studio thesis. [Evidence needed]",
  });
  read = await readIntegratedWorkspace();
  await submit("dataRoom", "evidence.save", {
    category: "company",
    title: "Company notes",
    note: "Owner-entered supporting evidence",
    asOfDate: "2026-10-31",
    reviewStatus: "owner_attested",
  });
  read = await readIntegratedWorkspace();
  await submit("dataRoom", "export.create", {
    snapshotIds: [readiness.id],
    forecastId: forecast.id,
    evidenceIds: [read.workspace.evidence[0].id],
    pitchId: read.engine.pitches.at(-1)!.id,
  });
  read = await readIntegratedWorkspace();
  expect(read.workspace.exports).toHaveLength(1);
  const output = await state.db.exportSnapshot.findUniqueOrThrow({
    where: { id: read.workspace.exports[0].id },
  });
  expect(output.markdown).toContain("Educational planning only");
  expect(output.csv).toContain("projected");
  for (const key of [
    "overview",
    "agency",
    "crew",
    "projects",
    "clients",
    "growth",
    "workflows",
    "notifications",
    "readiness",
    "financials",
    "equity",
    "pitch",
    "dataRoom",
    "settings",
  ]) {
    expect(connectedScreen(read, key)?.mode).toBe("connected");
  }
  expect(connectedScreen(read, "task", taskId, "foreign-project")).toBeNull();
}, 30000);

it("rejects a stale month form rather than replacing a newer saved actual", async () => {
  const view = connectedScreen(await readIntegratedWorkspace(), "financials")!;
  const spec = view.screen.forms!.find((f) => f.id === "actual.save")!;
  const month = Object.keys(spec.recordVersions!)[0];
  await submit("financials", "actual.save", {
    yearMonth: month,
    recognizedRevenueMinor: "456.00",
    cashReceiptsMinor: "200.00",
    asOfDate: "2026-10-31",
  });
  const data = new FormData();
  data.set("screenKey", "financials");
  data.set("command", "actual.save");
  data.set("idempotencyKey", crypto.randomUUID());
  data.set("recordVersions", JSON.stringify(spec.recordVersions));
  for (const f of spec.fields)
    if (f.value !== undefined) data.set(f.name, String(f.value));
  data.set("yearMonth", month);
  data.set("recognizedRevenueMinor", "999.00");
  data.set("asOfDate", "2026-10-31");
  expect(await productAction({}, data)).toMatchObject({ status: "conflict" });
  expect(
    actualSchema.parse(
      (await readIntegratedWorkspace()).workspace.actuals.find(
        (x) => x.yearMonth === month,
      )!.data,
    ).recognizedRevenueMinor,
  ).toBe(45600);
});
