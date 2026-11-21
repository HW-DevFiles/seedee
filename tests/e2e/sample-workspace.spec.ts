import { expect, test } from "@playwright/test";
import { demoFixture } from "../../src/lib/demo-fixture";

test("seeded sample sign-in loads saved workspace and finance with sample labels", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_EXTERNAL_SERVER === "1",
    "External review servers manage their own fixture credentials.",
  );
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(demoFixture.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.E2E_SAMPLE_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByLabel("Sample workspace disclosure")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: `Welcome, ${demoFixture.name}.`,
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/app/agency");
  await expect(
    page.getByRole("textbox", { name: "Agency name", exact: true }),
  ).toHaveValue(demoFixture.agencyName);
  await page.goto("/app/investor-readiness");
  await expect(page.getByText("73.4 / 100", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Score components" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("sample-readiness-desktop.png"),
  });
  await page.goto("/app/investor-readiness/financials");
  await expect(
    page.getByRole("heading", { name: "Saved scenarios", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Historical actuals", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/app/investor-readiness/data-room");
  await expect(page.getByLabel("Sample workspace disclosure")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("sample-data-room-mobile.png"),
  });
  await page.reload();
  await expect(page.getByLabel("Sample workspace disclosure")).toBeVisible();
});
