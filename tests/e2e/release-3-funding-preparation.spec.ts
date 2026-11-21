import { expect, test, type Page } from "@playwright/test";
import {
  BOUNDARY,
  createAgency,
  form,
  metric,
  row,
  signUp,
  submit,
  submitRejected,
  table,
} from "./support/journey";
import { assertExports, downloadLatestExport } from "./support/exports";

// Release scenario 3 (R17–R21, R25, C11): multidisciplinary funding
// preparation from manual evidence to a private Markdown/CSV export.
test.describe.configure({ timeout: 300_000 });

const months = [
  ["2026-05", "17000.00", "16000.00"],
  ["2026-06", "18000.00", "17500.00"],
  ["2026-07", "19000.00", ""],
  ["2026-08", "19000.00", "18800.00"],
  ["2026-09", "20000.00", "19500.00"],
  ["2026-10", "21000.00", "20400.00"],
] as const;

async function score(page: Page) {
  await page.goto("/app/investor-readiness");
  return metric(page, "Preparation score");
}

test("multidisciplinary creative prepares evidence, scenarios, pitch and export", async ({
  page,
}) => {
  await signUp(page, "Ari Multidisciplinary", "funding");
  const agency = await createAgency(page, {
    practices: ["musician", "writer", "content creator"],
    name: "Ari Sound and Story",
    buyer: "Independent podcast networks",
  });

  // Before evidence, readiness is uncalculated rather than zero.
  await page.goto("/app/investor-readiness");
  expect(await metric(page, "Preparation score")).toBe("Unknown");
  await expect(page.getByLabel("Educational planning boundary")).toHaveText(
    BOUNDARY,
  );

  // Six closed months of manual evidence; July receipts stay unknown.
  await page.goto("/app/investor-readiness/financials");
  for (const [month, revenue, receipts] of months) {
    await submit(page, "Record a closed month", {
      "Closed UTC month": month,
      "Earned service revenue (USD)": revenue,
      "Customer cash receipts (USD)": receipts,
      "Closing unrestricted cash (USD)": "24000.00",
      "Source reference": "Owner bookkeeping export",
      "As-of date": "2026-10-31",
    });
    await page.reload();
  }
  await expect(
    table(page, "Historical actuals").locator("tbody tr"),
  ).toHaveCount(6);
  await expect(
    row(page, "Historical actuals", "2026-07").locator("td").nth(1),
  ).toHaveText("Unknown");
  await expect(
    row(page, "Historical actuals", "2026-10").locator("td").first(),
  ).toHaveText("$21,000.00");
  // An invalid month value is rejected by the server.
  await submitRejected(page, "Record a closed month", {
    "Closed UTC month": "2026-13",
    "Earned service revenue (USD)": "1.00",
    "As-of date": "2026-10-31",
  });

  // Readiness: components, unknowns earn zero, coverage is not verification.
  await page.goto("/app/investor-readiness");
  await submit(page, "Create a preparation snapshot", {
    "As-of closed month end": "2026-10-31",
  });
  await page.reload();
  const readiness = await metric(page, "Preparation score");
  expect(readiness).toMatch(/^\d+(\.\d)? \/ 100$/);
  expect(parseFloat(readiness)).toBeGreaterThan(0);
  expect(parseFloat(readiness)).toBeLessThan(73.4);
  const coverage = await metric(page, "Evidence coverage");
  expect(coverage).toMatch(/%$/);
  expect(parseFloat(coverage)).toBeLessThan(100);
  expect(await metric(page, "As of")).toBe("2026-10-31");
  // Coverage below 80% makes the stage provisional, prefixed exactly once.
  expect(await metric(page, "Preparation stage")).toMatch(
    /^Provisional · (?!Provisional)\S/,
  );
  await expect(
    row(page, "Score components", "R").locator("td").first(),
  ).toHaveText("20000");
  await expect(
    row(page, "Score components", "M_model").locator("td").first(),
  ).toHaveText("Unknown");
  await expect(
    row(page, "Score components", "M_model").locator("td").nth(1),
  ).toHaveText("0 / 3");
  await expect(page.getByText("Risk and evidence limits")).toBeVisible();

  // Scenarios are hypothetical and never move readiness actuals.
  await page.goto("/app/investor-readiness/financials");
  await submit(page, "Model a scenario", {
    "Scenario name": "Owner base",
    "Model horizon": "24",
    "Demand volume multiplier": 1,
    "Monthly demand growth (fraction)": 0.01,
    "Same-month collection fraction": 0.8,
    "Founder pay allocated to delivery": 0.5,
    "Modeled reserve (USD)": "5000.00",
    "Contingency fraction": 0.1,
    "Fixed planning costs (USD)": "500.00",
    "Opening closed month end": "2026-10-31",
    "Service name for a new model": "Podcast series package",
    "Monthly demand units": 4,
    "Human hours per unit": 20,
    "Monthly human hours available": 120,
    "Hours added by planned hire": 0,
    "Monthly overhead inflation fraction": 0,
    "Tax buffer fraction": 0.2,
    "Unit price (USD)": "5000.00",
    "Unit direct cost (USD)": "1500.00",
    "Opening cash (USD)": "24000.00",
    "Opening receivables (USD)": "600.00",
    "Opening payables (USD)": "0.00",
    "Opening deferred revenue (USD)": "0.00",
    "Opening debt (USD)": "0.00",
    "Monthly overhead including founder pay (USD)": "9000.00",
    "Founder compensation included in overhead (USD)": "4000.00",
    "Monthly cost of planned hire (USD)": "0.00",
    "Month-one capital expenditure (USD)": "0.00",
  });
  await page.reload();
  const baseCard = page
    .getByRole("region", { name: "Workspace records" })
    .getByRole("heading", { name: "Owner base", exact: true })
    .locator("xpath=../..");
  await expect(baseCard).toContainText("No deficit within 24 modeled months");

  await submit(page, "Model a scenario", {
    "Start from saved assumptions": "Owner base",
    "Scenario name": "Owner downside",
    "Model horizon": "24",
    "Demand volume multiplier": 0.5,
    "Monthly demand growth (fraction)": 0,
    "Same-month collection fraction": 0.5,
    "Founder pay allocated to delivery": 0.5,
    "Modeled reserve (USD)": "5000.00",
  });
  await page.reload();
  const downCard = page
    .getByRole("region", { name: "Workspace records" })
    .getByRole("heading", { name: "Owner downside", exact: true })
    .locator("xpath=../..");
  await expect(downCard).toContainText(/First deficit in month \d+/);
  const downside = row(page, "Saved scenarios", "Owner downside");
  await expect(downside.locator("td").nth(2)).toHaveText("assumption");
  expect(await score(page)).toBe(readiness);

  // Pitch drafted from canonical saved facts, regenerated, then edited.
  await page.goto("/app/investor-readiness/pitch");
  const facts = form(page, "Draft from saved evidence").getByRole("checkbox");
  expect(await facts.count()).toBeGreaterThan(0);
  for (const fact of await facts.all()) await fact.check();
  await submit(page, "Draft from saved evidence");
  await page.reload();
  await expect(
    table(page, "Claim references").locator("tbody tr").first(),
  ).toBeVisible();
  await submit(page, "Draft from saved evidence");
  await page.reload();
  const pitchForm = form(page, "Edit the private narrative");
  await pitchForm
    .locator("textarea")
    .first()
    .fill(
      "Ari Sound and Story turns a reviewed podcast process into repeatable work. [Evidence needed]",
    );
  await submit(page, "Edit the private narrative");
  await page.reload();
  await expect(pitchForm.locator("textarea").first()).toHaveValue(
    /repeatable work\. \[Evidence needed\]/,
  );

  // Evidence register: safe https reference; external review needs metadata.
  await page.goto("/app/investor-readiness/data-room");
  await submit(page, "Add an evidence reference", {
    Folder: "customers",
    "Evidence title": "Listener survey summary",
    "Evidence notes": "Owner-collected survey of 40 listeners.",
    "HTTPS reference": "https://example.test/survey",
    Origin: "user_entered",
    "As-of date": "2026-10-31",
    "Review status": "owner_attested",
  });
  await page.reload();
  await submitRejected(page, "Add an evidence reference", {
    Folder: "market",
    "Evidence title": "Unsupported external review",
    Origin: "user_entered",
    "As-of date": "2026-10-31",
    "Review status": "externally_reviewed",
  });
  await page.reload();
  await submit(page, "Review a checklist item", {
    Folder: "customers",
    "Checklist status": "owner_attested",
    "Evidence reference": "Listener survey summary",
  });
  await page.reload();
  await expect(
    row(page, "Preparation checklist", "customers").locator("td").first(),
  ).toHaveText("owner_attested");

  // Export: one forecast for the CSV and the current pitch. The superseded
  // draft is no longer offered (QA-REPORT Q4, fixed).
  const exportForm = form(page, "Create a private preparation pack");
  const pitches = (
    await exportForm
      .getByLabel(/^Pitch version/)
      .locator("option")
      .allInnerTexts()
  ).slice(1);
  expect(pitches, JSON.stringify(pitches)).toHaveLength(1);
  const selection = {
    "Readiness snapshots": ["2026-10-31 · readiness-v1.1"],
    "One forecast for the CSV": "Owner downside",
    "Evidence references": ["Listener survey summary"],
  };
  await submit(page, "Create a private preparation pack", {
    ...selection,
    "Pitch version": pitches[0],
  });
  await page.reload();
  const { markdown, csv } = await downloadLatestExport(page);
  assertExports(markdown, csv, { sample: false, horizon: 24 });
  expect(markdown).toContain(`# ${agency} · Private preparation pack`);
  expect(markdown).toContain(
    "Owner-entered evidence · Self-reported, not independently verified",
  );
  expect(markdown).toContain("Listener survey summary");
  expect(markdown).toContain("repeatable work. \\[Evidence needed\\]");
  expect(markdown).toContain("Owner bookkeeping export");
  expect(markdown).toContain('"origin": "assumption"');
});

// R26 / C10: dilution education reproduces Rowan's worked examples and
// Blair's pool-top-up cases through the browser form.
test("equity education reproduces the frozen dilution fixtures", async ({
  page,
}) => {
  await signUp(page, "Equity Learner", "equity");
  await createAgency(page, { name: "Equity Studio" });
  await page.goto("/app/investor-readiness/equity");
  const base = {
    "Founder shares": 9000000,
    "Existing unallocated pool shares": 1000000,
    "I understand this is a hypothetical educational scenario": true,
  };
  const ownership = async () => {
    const latest = page
      .locator("table")
      .filter({ has: page.locator("caption", { hasText: /^Ownership · / }) })
      .first();
    const rows = await latest.locator("tbody tr").all();
    return Object.fromEntries(
      await Promise.all(
        rows.map(async (r) => [
          (await r.locator("th").innerText()).trim(),
          (await r.locator("td").nth(1).innerText()).trim(),
        ]),
      ),
    );
  };
  const latestCard = () =>
    page
      .getByRole("region", { name: "Workspace records" })
      .getByRole("heading", { name: "Hypothetical ownership" })
      .first()
      .locator("xpath=../..");

  await submit(page, "Explore a supported scenario", {
    ...base,
    "Illustration type": "priced_round",
    "Pre-money valuation (USD)": "4000000.00",
    "New primary cash (USD)": "1000000.00",
  });
  await page.reload();
  expect(await ownership()).toMatchObject({
    founders: "72.0000%",
    pool: "8.0000%",
  });

  const safes = {
    ...base,
    "Illustration type": "cap_only_safe",
    "New primary cash (USD)": "2000000.00",
    "SAFE A funded amount (USD)": "300000.00",
    "SAFE A post-money cap (USD)": "3000000.00",
    "SAFE B funded amount (USD)": "200000.00",
    "SAFE B post-money cap (USD)": "4000000.00",
  };
  await submit(page, "Explore a supported scenario", {
    ...safes,
    "Pre-money valuation (USD)": "8000000.00",
  });
  await page.reload();
  expect(await ownership()).toMatchObject({
    founders: "61.2000%",
    pool: "6.8000%",
    A: "8.0000%",
    B: "4.0000%",
  });

  await submit(page, "Explore a supported scenario", {
    ...safes,
    "Pre-money valuation (USD)": "8000000.00",
    "Target final unallocated pool fraction": 0.15,
  });
  await page.reload();
  expect(await ownership()).toMatchObject({
    founders: "54.3443%",
    pool: "15.0000%",
    A: "7.1038%",
    B: "3.5519%",
  });

  // C10: V=$4.5m supports the no-top-up illustration...
  await submit(page, "Explore a supported scenario", {
    ...safes,
    "Pre-money valuation (USD)": "4500000.00",
  });
  await page.reload();
  await expect(latestCard()).not.toContainText(/unsupported|does not apply/i);
  // ...but a 15% final pool pushes the round price below SAFE B's cap.
  await submit(page, "Explore a supported scenario", {
    ...safes,
    "Pre-money valuation (USD)": "4500000.00",
    "Target final unallocated pool fraction": 0.15,
  });
  await page.reload();
  await expect(latestCard()).toContainText(/does not apply|unsupported/i);
  // A below-cap round returns unsupported rather than a 10%/5% table.
  await submit(page, "Explore a supported scenario", {
    ...safes,
    "Pre-money valuation (USD)": "1000000.00",
  });
  await page.reload();
  await expect(latestCard()).toContainText(/does not apply|unsupported/i);
  await expect(
    page.getByText(
      "Hypothetical planning scenario — not an offer of securities",
    ),
  ).toBeVisible();
});
