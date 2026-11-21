import { expect, test } from "@playwright/test";

test("stored account markup stays inert when rendered on the dashboard", async ({
  page,
}) => {
  const name = "<img src=security-test onerror=window.seedeeInjected=true>";
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page
    .getByLabel("Email address")
    .fill(`markup-${crypto.randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Markup browser test password!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: `Welcome, ${name}.` }),
  ).toBeVisible();
  expect(await page.locator('img[src="security-test"]').count()).toBe(0);
  expect(await page.evaluate(() => "seedeeInjected" in window)).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: `Welcome, ${name}.` }),
  ).toBeVisible();
  expect(await page.evaluate(() => "seedeeInjected" in window)).toBe(false);
});

test("every foundation workspace path redirects a signed-out browser", async ({
  page,
}) => {
  for (const route of [
    "/app",
    "/app/agency",
    "/app/crew",
    "/app/projects",
    "/app/growth",
    "/app/investor-readiness",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  }
});

test("two browser sessions see only their own account and sign-out revokes access", async ({
  page,
  browser,
}) => {
  const secondContext = await browser.newContext({
    ignoreHTTPSErrors:
      process.env.E2E_PRODUCTION === "1" ||
      process.env.E2E_EXTERNAL_SERVER === "1",
  });
  const secondPage = await secondContext.newPage();
  try {
    for (const [current, name] of [
      [page, "First Private Creative"],
      [secondPage, "Second Private Creative"],
    ] as const) {
      await current.goto(
        (process.env.E2E_BASE_URL ??
          "http://127.0.0.1:" + (process.env.E2E_PORT ?? "3100")) + "/sign-up",
      );
      await current.getByLabel("Your name").fill(name);
      await current
        .getByLabel("Email address")
        .fill(`security-${crypto.randomUUID()}@example.test`);
      await current
        .getByLabel("Password", { exact: true })
        .fill("Security browser test password!");
      await current.getByRole("button", { name: "Create account" }).click();
      await expect(current).toHaveURL(/\/app$/);
      await expect(
        current.getByRole("heading", { name: `Welcome, ${name}.` }),
      ).toBeVisible();
    }
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Welcome, First Private Creative." }),
    ).toBeVisible();
    await expect(
      page.getByText("Second Private Creative", { exact: false }),
    ).toHaveCount(0);
    await expect(
      secondPage.getByText("First Private Creative", { exact: false }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in$/);
    await secondPage.reload();
    await expect(
      secondPage.getByRole("heading", {
        name: "Welcome, Second Private Creative.",
      }),
    ).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
