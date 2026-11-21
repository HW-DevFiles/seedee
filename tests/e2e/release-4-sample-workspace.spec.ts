import { expect, test, type Page } from "@playwright/test";
import { demoFixture } from "../../src/lib/demo-fixture";
import {
  BOUNDARY,
  createAgency,
  form,
  metric,
  newPage,
  row,
  signIn,
  signUp,
  submit,
  submitRejected,
  table,
} from "./support/journey";
import { assertExports, downloadLatestExport } from "./support/exports";

// Release scenario 4 (R17, R18, R20, R21, R24, C3–C6): the seeded fictional
// workspace, checked against Rowan's frozen v1.1 fixtures and Blair's review.
test.describe.configure({ timeout: 300_000 });
test.skip(
  !process.env.E2E_SAMPLE_PASSWORD,
  "The sample account password is set per run by the Playwright fixture.",
);

const signInSample = (page: Page) =>
  signIn(page, demoFixture.email, process.env.E2E_SAMPLE_PASSWORD!);

const showScenario = async (page: Page, name: string) => {
  await row(page, "Saved scenarios", name)
    .getByRole("link", { name: /^Show monthly projection/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\?scenario=/);
  await expect(table(page, `Monthly projection · ${name}`)).toBeVisible();
};

const cells = async (page: Page, caption: string, header: string) =>
  (await row(page, caption, header).locator("td").allInnerTexts()).map((c) =>
    c.trim(),
  );

test("every dependent sample screen carries sample origin", async ({
  page,
}) => {
  await signInSample(page);
  for (const route of [
    "/app",
    "/app/agency",
    "/app/crew",
    "/app/crew/workflows",
    "/app/projects",
    "/app/projects/clients",
    "/app/notifications",
    "/app/growth",
    "/app/investor-readiness",
    "/app/investor-readiness/financials",
    "/app/investor-readiness/equity",
    "/app/investor-readiness/pitch",
    "/app/investor-readiness/data-room",
    "/app/settings",
  ]) {
    await page.goto(route);
    await expect(
      page.getByLabel("Sample workspace disclosure"),
      route,
    ).toContainText(
      "Demo preview · Sample data · Not actual business performance",
    );
  }
});

test("sample readiness reproduces the frozen 73.4 fixture and keeps risks visible", async ({
  page,
}) => {
  await signInSample(page);
  await page.goto("/app/investor-readiness");
  expect(await metric(page, "Preparation score")).toBe("73.4 / 100");
  expect(await metric(page, "Evidence coverage")).toBe("100%");
  expect(await metric(page, "As of")).toBe("2026-10-31");
  // Not provisional when evaluated: six closed months, full coverage, fresh.
  expect(await metric(page, "Preparation stage")).toBe(
    "Strengthen the evidence",
  );
  const points: Record<string, string> = {
    R: "14 / 18",
    G: "9 / 12",
    C: "11 / 15",
    D_package: "6 / 8",
    D_retainer: "3 / 6",
    D_ontime: "5.4 / 6",
    H_owner: "2 / 2",
    H_paid: "2 / 2",
    H_backup: "0 / 2",
    H_capacity: "2 / 2",
    H_founder: "0 / 2",
    I_chain: "5 / 5",
    I_assets: "4 / 4",
    I_brand: "3 / 3",
    I_cases: "0 / 3",
    M_target: "2 / 2",
    M_interviews: "3 / 3",
    M_alternatives: "2 / 2",
    M_model: "0 / 3",
  };
  for (const [key, value] of Object.entries(points))
    expect((await cells(page, "Score components", key))[1], key).toBe(value);
  // Fraction inputs display rounded; R stays a monthly dollar amount.
  for (const [key, input] of [
    ["R", "20000"],
    ["G", "11.1%"],
    ["C", "30.0%"],
    ["D_package", "75.0%"],
    ["D_ontime", "90.0%"],
    ["H_founder", "70.0%"],
  ])
    expect((await cells(page, "Score components", key))[0], key).toBe(input);
  // R14 + G9 + C11 + D14.4 + H6 + I12 + M7 = 73.4, summed from the page.
  const total = Object.values(points)
    .map((p) => Number(p.split(" / ")[0]))
    .reduce((a, b) => a + b, 0);
  expect(total.toFixed(1)).toBe("73.4");
  // A high score never hides risk flags or the largest gaps (D, R, C).
  const risk = page.locator("aside", { hasText: "Risk and evidence limits" });
  await expect(risk).toContainText("cash unknown");
  await expect(risk).toContainText("cap table incomplete");
  await expect(risk).toContainText(
    "Largest unearned components: D (5.6 points), R (4 points), C (4 points).",
  );
  // The sample records founder hours, so no missing-workload notice.
  await expect(risk).not.toContainText("Founder delivery workload");
  await expect(page.getByLabel("Educational planning boundary")).toHaveText(
    BOUNDARY,
  );
});

test("sample scenarios match Rowan's base, downside and upside projections", async ({
  page,
}) => {
  await signInSample(page);
  await page.goto("/app/investor-readiness/financials");
  // Each saved scenario links to its own monthly projection.
  await showScenario(page, "base");
  const base = "Monthly projection · base";
  // [period, revenue, receipts, closing cash] from Rowan's verified table.
  for (const [period, revenue, receipts, cash] of [
    ["2026-11", "21000.00", "21000.00", "33600.00"],
    ["2027-04", "22622.96", "22556.10", "43178.09"],
    ["2027-10", "24736.93", "24663.81", "59117.18"],
    ["2027-11", "25107.98", "25033.77", "59477.58"],
    ["2028-04", "27048.43", "26968.48", "63587.14"],
    ["2028-10", "29575.92", "29488.50", "73944.07"],
  ])
    expect((await cells(page, base, period)).slice(0, 3), period).toEqual([
      revenue,
      receipts,
      cash,
    ]);
  // C3: founder-loaded margin sits beside recorded margin; cash unchanged.
  expect((await cells(page, base, "2026-11"))[3]).toBe("57.14% / 43.81%");

  await showScenario(page, "downside");
  const down = "Monthly projection · downside";
  // Opening AR is collected once; the slower collection is not retroactive.
  expect((await cells(page, down, "2026-11")).slice(0, 3)).toEqual([
    "16800.00",
    "14280.00",
    "29080.00",
  ]);
  expect((await cells(page, down, "2028-03"))[2]).toBe("1737.13");
  expect((await cells(page, down, "2028-04"))[2]).toBe("-2596.48");

  await showScenario(page, "upside");
  // The selected scenario survives a refresh; other tables stay collapsed.
  await page.reload();
  await expect(table(page, "Monthly projection · upside")).toBeVisible();
  await expect(table(page, "Monthly projection · base")).toHaveCount(0);
  const up = "Monthly projection · upside";
  expect((await cells(page, up, "2028-10"))[2]).toBe("128265.76");
  // Capacity caps recognized revenue; unmet demand is never revenue.
  for (const period of ["2027-04", "2027-07", "2027-10"])
    expect((await cells(page, up, period))[0], period).toBe("25500.00");
  for (const period of ["2028-08", "2028-09", "2028-10"])
    expect((await cells(page, up, period))[0], period).toBe("38250.00");

  // C6: planning capital is shown with the continuing ending burn.
  const card = (name: string) =>
    page
      .getByRole("region", { name: "Workspace records" })
      .getByRole("heading", { name, exact: true })
      .locator("xpath=../..");
  await expect(card("downside")).toContainText("First deficit in month 18");
  await expect(card("downside")).toContainText("73020.40");
  await expect(card("downside")).toContainText("-4464.70");
  await expect(card("downside")).toContainText(
    "Yes — need may continue beyond the horizon",
  );
  await expect(card("base")).toContainText(
    "No deficit within 24 modeled months",
  );
  for (const name of ["base", "downside", "upside"])
    await expect(card(name)).toContainText(
      "Capacity hire retains per-unit labor cost, conservatively double-counting labor",
    );
  for (const name of ["base", "downside", "upside"])
    expect((await cells(page, "Saved scenarios", name))[2]).toBe("sample");
});

test("a no-hire downside is a separate reviewable scenario and leaves readiness unchanged", async ({
  page,
}) => {
  await signInSample(page);
  await page.goto("/app/investor-readiness/financials");
  // C5: same downside assumptions with the planned hire removed.
  await submit(page, "Model a scenario", {
    "Start from saved assumptions": "downside",
    "Scenario name": "Downside without hire",
    "Model horizon": "24",
    "Demand volume multiplier": 0.8,
    "Monthly demand growth (fraction)": 0,
    "Same-month collection fraction": 0.6,
    "Founder pay allocated to delivery": 0.7,
    "Planned capacity hire month": "",
    "Modeled reserve (USD)": "30000.00",
    "Contingency fraction": 0.15,
    "Fixed planning costs (USD)": "5000.00",
  });
  await page.reload();
  const caption = "Monthly projection · Downside without hire";
  expect((await cells(page, caption, "2028-10"))[2]).toBe("12851.82");
  await expect(
    page
      .getByRole("region", { name: "Workspace records" })
      .getByRole("heading", { name: "Downside without hire", exact: true })
      .locator("xpath=../..")
      .first(),
  ).toContainText("No deficit within 24 modeled months");
  // The newest scenario is shown by default; the original downside is
  // untouched, and readiness is unchanged.
  await showScenario(page, "downside");
  expect(
    (await cells(page, "Monthly projection · downside", "2028-04"))[2],
  ).toBe("-2596.48");
  await page.goto("/app/investor-readiness");
  expect(await metric(page, "Preparation score")).toBe("73.4 / 100");
});

test("sample exports carry the sample banner and the CSV matches the base fixture", async ({
  page,
}) => {
  await signInSample(page);
  await page.goto("/app/investor-readiness/data-room");
  // Sample evidence can only be labelled sample or assumption.
  const origin = form(page, "Add an evidence reference").getByLabel(/^Origin/);
  expect(await origin.locator("option").allInnerTexts()).toEqual([
    "Choose an option",
    "Sample",
    "Assumption",
  ]);
  // A forged "user_entered" option is refused by the server (R21).
  await origin.evaluate((node) => {
    const option = document.createElement("option");
    option.value = "user_entered";
    option.textContent = "Forged actual";
    node.appendChild(option);
  });
  await submitRejected(page, "Add an evidence reference", {
    Folder: "customers",
    "Evidence title": "Relabelled sample traction",
    Origin: "user_entered",
    "As-of date": "2026-10-31",
    "Review status": "owner_attested",
  });
  await page.reload();
  await submit(page, "Create a private preparation pack", {
    "Readiness snapshots": ["2026-10-31 · readiness-v1.1"],
    "One forecast for the CSV": "base",
    "Evidence references": ["sample-evidence"],
  });
  const { markdown, csv } = await downloadLatestExport(page);
  const rows = assertExports(markdown, csv, { sample: true, horizon: 24 });
  expect(markdown).toContain(
    "**Demo preview · Sample data · Not actual business performance.**",
  );
  expect(markdown).not.toContain("Owner-entered evidence");
  expect(markdown).toContain("No reviewed pitch selected");
  expect(markdown).not.toContain("Relabelled sample traction");
  // CSV parity: t1 and t24 rows of Rowan's base table.
  const pick = (period: string) =>
    rows.find((line) => line.startsWith(`${period},`))!.split(",");
  const [, , revenue1, , , , , receipts1, ar1, , cash1] = pick("2026-11");
  expect([revenue1, receipts1, ar1, cash1]).toEqual([
    "21000.00",
    "21000.00",
    "4200.00",
    "33600.00",
  ]);
  expect(pick("2028-10")[10]).toBe("73944.07");
  // Every CSV row carries the forecast's provenance and formula version.
  expect(rows.every((line) => line.split(",")[11] === '"sample"')).toBe(true);
  expect(rows.every((line) => line.endsWith(',"agency-finance-v1.1"'))).toBe(
    true,
  );
});

test("in-app reset is refused in production and cannot touch another workspace", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.E2E_PRODUCTION !== "1" &&
      process.env.E2E_EXTERNAL_SERVER !== "1",
    "Development reset deletes the shared sample fixture other specs use.",
  );
  const other = await newPage(browser);
  try {
    await signUp(other.page, "Reset Bystander", "bystander");
    await createAgency(other.page, { name: "Bystander Studio" });
    await other.page.goto("/app/settings");
    // A real (nonsample) workspace is never offered sample reset.
    await expect(
      form(other.page, "Reset your synthetic sample workspace"),
    ).toHaveCount(0);
    await signInSample(page);
    await page.goto("/app/settings");
    // The production sample sees why before submitting...
    const reset = form(page, "Reset your synthetic sample workspace");
    await expect(reset).toContainText(
      "Sample reset is available only in a local demo environment.",
    );
    await expect(reset.locator('button[type="submit"]')).toBeDisabled();
    // ...and a forged submission with the controls re-enabled still fails.
    await reset.evaluate((node) =>
      node
        .querySelectorAll("fieldset, input, button")
        .forEach((el) => el.removeAttribute("disabled")),
    );
    await submitRejected(
      page,
      "Reset your synthetic sample workspace",
      {},
      "Sample reset is available only in a local demo environment.",
    );
    await page.goto("/app/investor-readiness");
    expect(await metric(page, "Preparation score")).toBe("73.4 / 100");
    await other.page.goto("/app/agency");
    await expect(
      form(other.page, "Agency profile").getByLabel(/^Agency name/),
    ).toHaveValue("Bystander Studio");
  } finally {
    await other.context.close();
  }
});

test("sample data never appears in a separate real account", async ({
  browser,
}) => {
  const { context, page } = await newPage(browser);
  try {
    await signUp(page, "Real Account", "real");
    for (const route of [
      "/app/investor-readiness",
      "/app/investor-readiness/financials",
      "/app/investor-readiness/data-room",
    ]) {
      await page.goto(route);
      await expect(page.getByLabel("Sample workspace disclosure")).toHaveCount(
        0,
      );
      await expect(page.getByText("73.4", { exact: true })).toHaveCount(0);
      await expect(table(page, "Saved scenarios")).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});
