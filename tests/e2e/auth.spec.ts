import { expect, test } from "@playwright/test";

test("sign up, reach the dashboard, sign out and sign back in", async ({
  page,
  context,
}) => {
  const email = `creative-${crypto.randomUUID()}@example.test`;
  await page.goto("/app/projects");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Smoke Creative");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("A smoke test password!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: "Welcome, Smoke Creative." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your agency starts with you" }),
  ).toBeVisible();
  const session = (await context.cookies()).find(
    (cookie) => cookie.name === "seedee_session",
  );
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("A smoke test password!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Smoke Creative." }),
  ).toBeVisible();
});
