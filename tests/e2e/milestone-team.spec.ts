import { expect, test, type Page, type Locator } from "@playwright/test";
import { createDatabase } from "../../src/lib/db-client";
import { hashPassword } from "../../src/lib/auth/password";
import { demoFixture } from "../../src/lib/demo-fixture";

const notice =
  "Founder delivery workload and replacement cost not entered; founder dependence is unknown.";
const form = (page: Page, title: string) =>
  page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
async function save(target: Locator, title: string) {
  await target.getByRole("button", { name: title, exact: true }).click();
  await expect(
    target.getByRole("button", { name: title, exact: true }),
  ).toBeEnabled();
  await expect(target.getByRole("status")).toContainText("Saved.");
}
async function evidence(target: Locator, key: string) {
  await target.getByLabel("Evidence record key", { exact: false }).fill(key);
  await target
    .getByLabel("Evidence as-of date", { exact: false })
    .fill("2026-10-31");
  await target
    .getByLabel("Agreement, log or source reference", { exact: false })
    .fill("Owner-attested internal record");
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}
test("owned milestone card shows the full fixed-dollar delta, survives refresh and leaves actuals/readiness unchanged", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_EXTERNAL_SERVER === "1",
    "Requires the isolated test database.",
  );
  const db = createDatabase(process.env.E2E_DATABASE_URL!);
  try {
    await login(page, demoFixture.email, process.env.E2E_SAMPLE_PASSWORD!);
    const agency = await db.agency.findUniqueOrThrow({
      where: { ownerId: demoFixture.userId },
    });
    const baseline = await db.financeSnapshot.findFirstOrThrow({
      where: { agencyId: agency.id, kind: "readiness" },
      orderBy: { createdAt: "desc" },
    });
    const actuals = await db.financialActualPeriod.findMany({
      where: { agencyId: agency.id },
      orderBy: { id: "asc" },
    });
    const baselineBytes = JSON.stringify(baseline),
      actualBytes = JSON.stringify(actuals);
    await page.goto("/app/growth");
    const preview = form(page, "Preview milestone impact");
    await preview
      .getByLabel("Saved readiness baseline", { exact: false })
      .selectOption(baseline.id);
    for (const [i, value] of ["24000", "25000", "26000"].entries())
      await preview
        .getByLabel(`Target earned revenue: recent month ${i + 1} (USD)`, {
          exact: false,
        })
        .fill(value);
    await save(preview, "Preview milestone impact");
    const card = page
      .locator("section[aria-label='Workspace records'] > *")
      .filter({
        has: page.getByRole("heading", {
          name: "Grow three-month earned revenue",
          exact: true,
        }),
      });
    await expect(
      card.getByText("If achieved and evidenced; hypothetical only", {
        exact: true,
      }),
    ).toBeVisible();
    for (const [label, value] of [
      ["Baseline score", "73.4"],
      ["Hypothetical score", "79.4"],
      ["Full total delta", "+6.0"],
    ])
      await expect(
        card
          .locator("dl > div")
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator("dd"),
      ).toHaveText(value);
    await expect(card).toContainText(baseline.id);
    await expect(card).toContainText("readiness-v1.1");
    await expect(card).toContainText("Package and retainer dollars stay fixed");
    await page.reload();
    await expect(card.getByText("+6.0", { exact: true })).toBeVisible();
    expect(
      JSON.stringify(
        await db.financeSnapshot.findUnique({ where: { id: baseline.id } }),
      ),
    ).toBe(baselineBytes);
    expect(
      JSON.stringify(
        await db.financialActualPeriod.findMany({
          where: { agencyId: agency.id },
          orderBy: { id: "asc" },
        }),
      ),
    ).toBe(actualBytes);
    expect(
      await db.financeSnapshot.count({
        where: { agencyId: agency.id, kind: "readiness_proposal" },
      }),
    ).toBe(1);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("milestone-mobile.png"),
      fullPage: true,
    });
    await page.goto("/app/investor-readiness");
    await expect(page.getByText("73.4", { exact: true })).toBeVisible();
    await expect(page.getByText(notice, { exact: false })).toHaveCount(0);
  } finally {
    await db.$disconnect();
  }
});

test("fresh owner enters human agreements, backup, delivery logs and named capacity before a new readiness snapshot", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_EXTERNAL_SERVER === "1",
    "Requires the isolated test database.",
  );
  const db = createDatabase(process.env.E2E_DATABASE_URL!);
  const ownerId = `team-${crypto.randomUUID()}`,
    email = `${ownerId}@example.test`,
    password = "An isolated team evidence password!";
  try {
    await db.user.create({
      data: {
        id: ownerId,
        name: "Team evidence owner",
        email,
        passwordHash: await hashPassword(password),
      },
    });
    const agency = await db.agency.create({
      data: { ownerId, name: "Owner entered studio" },
    });
    const service = await db.servicePackage.create({
      data: {
        agencyId: agency.id,
        title: "Design delivery",
        deliverables: ["Design"],
        exclusions: [],
        revisionLimit: 1,
        turnaroundDays: 5,
        laborHours: 10,
        priceMinor: 100000,
        pricingBasis: {},
        acceptanceChecklist: [],
      },
    });
    await login(page, email, password);
    await page.goto("/app/investor-readiness");
    const calculation = form(page, "Create a preparation snapshot");
    await calculation
      .getByLabel("As-of closed month end", { exact: false })
      .fill("2026-10-31");
    await save(calculation, "Calculate readiness snapshot");
    const founderRow = page.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: "H_founder", exact: true }),
    });
    await expect(founderRow).toContainText("Unknown");
    await expect(founderRow).toContainText("0 / 2");
    await expect(page.getByText(notice, { exact: false })).toHaveCount(1);
    const baseline = await db.financeSnapshot.findFirstOrThrow({
      where: { agencyId: agency.id, kind: "readiness" },
    });
    const original = JSON.stringify(baseline);
    await page.goto("/app/growth");
    const preview = form(page, "Preview milestone impact");
    for (const [i, value] of ["24000", "25000", "26000"].entries())
      await preview
        .getByLabel(`Target earned revenue: recent month ${i + 1} (USD)`, {
          exact: false,
        })
        .fill(value);
    await preview
      .getByRole("button", { name: "Preview milestone impact", exact: true })
      .click();
    await expect(preview.getByRole("alert")).toContainText("Evidence needed");
    await expect(page.getByText("+6.0", { exact: true })).toHaveCount(0);
    await page.goto("/app/investor-readiness");
    for (const [key, isFounder] of [
      ["founder", true],
      ["collaborator", false],
    ] as const) {
      const human = form(page, "Record human and compensation agreement");
      await evidence(human, key);
      await human
        .getByLabel("Human role", { exact: false })
        .fill("Delivery and review");
      await human
        .getByLabel("This human is a founder", { exact: false })
        .setChecked(isFounder);
      await human
        .getByLabel("Agreed compensation (USD per month)", { exact: false })
        .fill("2000");
      await human
        .getByLabel("Agreement start", { exact: false })
        .fill("2026-05-01");
      await save(human, "Record human and compensation agreement");
    }
    await page.reload();
    const backup = form(page, "Record accepted nonfounder backup");
    await evidence(backup, "design-backup");
    await backup
      .getByLabel("Material service key", { exact: false })
      .fill(service.id);
    await backup
      .getByLabel("Backup human", { exact: false })
      .selectOption("collaborator");
    await backup
      .getByLabel("Backup acceptance date", { exact: false })
      .fill("2026-10-15");
    await save(backup, "Record accepted nonfounder backup");
    for (const [key, hours] of [
      ["founder", "40"],
      ["collaborator", "60"],
    ]) {
      const log = form(page, "Log human delivery hours");
      await evidence(log, `oct-${key}`);
      await log
        .getByLabel("Delivery human", { exact: false })
        .selectOption(key);
      await log
        .getByLabel("Delivery work date", { exact: false })
        .fill("2026-10-20");
      await log.getByLabel("Delivery hours", { exact: false }).fill(hours);
      await save(log, "Log human delivery hours");
    }
    const pool = form(page, "Record named paid capacity pool");
    await evidence(pool, "design-pool");
    await pool.getByLabel("Capacity month", { exact: false }).fill("2026-11");
    await pool
      .getByLabel("founder · Delivery and review", { exact: true })
      .check();
    await pool
      .getByLabel("collaborator · Delivery and review", { exact: true })
      .check();
    await pool
      .getByLabel("Covered material service keys", { exact: false })
      .fill(service.id);
    await pool.getByLabel("Pool available hours", { exact: false }).fill("100");
    await pool.getByLabel("Pool planned hours", { exact: false }).fill("80");
    await pool
      .getByLabel("Pool attestation date", { exact: false })
      .fill("2026-10-25");
    await save(pool, "Record named paid capacity pool");
    const owner = form(page, "Record accountable human owner");
    await evidence(owner, "owner");
    await owner
      .getByLabel("Accountability and responsibilities", { exact: false })
      .fill("Founder owns delivery, reviews and agency decisions.");
    await save(owner, "Record accountable human owner");
    await calculation
      .getByLabel("As-of closed month end", { exact: false })
      .fill("2026-10-31");
    await save(calculation, "Calculate readiness snapshot");
    await expect(founderRow).toContainText("0.4");
    await expect(founderRow).toContainText("2 / 2");
    await expect(page.getByText(notice, { exact: false })).toHaveCount(0);
    for (const key of ["H_owner", "H_paid", "H_backup", "H_capacity"])
      await expect(
        page.getByRole("row").filter({
          has: page.getByRole("rowheader", { name: key, exact: true }),
        }),
      ).toContainText("2 / 2");
    await page.reload();
    await expect(founderRow).toContainText("0.4");
    expect(
      JSON.stringify(
        await db.financeSnapshot.findUnique({ where: { id: baseline.id } }),
      ),
    ).toBe(original);
    const latest = await db.financeSnapshot.findFirstOrThrow({
      where: { agencyId: agency.id, kind: "readiness" },
      orderBy: { createdAt: "desc" },
    });
    expect(
      (latest.input as { evidenceVersions: unknown[] }).evidenceVersions.length,
    ).toBeGreaterThanOrEqual(7);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("team-evidence-mobile.png"),
      fullPage: true,
    });
  } finally {
    await db.$disconnect();
  }
});
