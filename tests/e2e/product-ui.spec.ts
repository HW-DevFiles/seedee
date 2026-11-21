import { expect, test } from "@playwright/test";

async function createAccount(page: import("@playwright/test").Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("UI Review Creative");
  await page
    .getByLabel("Email address")
    .fill(`ui-${crypto.randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("A product UI review password!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app$/);
}

test("fresh workspace keeps unknown evidence and explains unavailable service actions", async ({
  page,
}) => {
  await page.goto("/app/investor-readiness/data-room");
  await expect(page).toHaveURL(/\/sign-in$/);
  await createAccount(page);
  await expect(
    page.getByRole("heading", { name: "Your agency starts with you" }),
  ).toBeVisible();
  await expect(page.getByLabel("Sample preview disclosure")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Describe your practice", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Start with your craft." }),
  ).toBeVisible();
  for (const practice of [
    "musician",
    "visual artist",
    "designer",
    "filmmaker",
    "writer",
    "photographer",
    "content creator",
    "other",
  ])
    await expect(page.getByLabel(practice, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save practice & goals" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Saving is unavailable in this preview/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Start with your craft." }),
  ).toBeVisible();
});

test("sample browsing preserves its disclosure and cannot become a real workspace record", async ({
  page,
}) => {
  await createAccount(page);
  await page.getByRole("link", { name: "Explore sample workspace" }).click();
  await expect(page.getByLabel("Sample preview disclosure")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace", exact: true })
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/projects\?preview=sample$/);
  await page
    .getByLabel("Search projects", { exact: true })
    .fill("absent client");
  await expect(
    page.getByText("No records match this search.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Search projects", { exact: true }).fill("Fern");
  await page.getByRole("link", { name: "Open Fern launch website" }).click();
  await expect(page).toHaveURL(
    /\/app\/projects\/sample-project\?preview=sample$/,
  );
  await page.getByRole("link", { name: "Open Review launch plan" }).click();
  await page.getByRole("link", { name: "Open artifact review" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the launch website plan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve artifact", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("sample-artifact · revision 1 · unapproved"),
  ).toBeVisible();
  await page
    .getByLabel("Sample preview disclosure")
    .getByRole("link", { name: "Return to my workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your agency starts with you" }),
  ).toBeVisible();
  await page.goto("/app/projects/sample-project");
  await expect(
    page.getByRole("heading", { name: "That page hasn't taken shape." }),
  ).toBeVisible();
});

test("360px layouts keep page width bounded and keyboard skip navigation usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await createAccount(page);
  for (const route of [
    "/app/onboarding",
    "/app/crew?preview=sample",
    "/app/projects?preview=sample",
    "/app/investor-readiness/financials?preview=sample",
    "/app/investor-readiness/data-room?preview=sample",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/app/crew?preview=sample");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await page.getByRole("button", { name: "Workspace menu" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("link", { name: "Crew", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
