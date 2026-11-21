import { expect, test } from "@playwright/test";
import {
  createAgency,
  form,
  metric,
  newPage,
  signIn,
  signOut,
  signUp,
  submit,
  submitRejected,
  table,
} from "./support/journey";

// Release scenario 1 (R01–R07, R22): fresh designer account.
test.describe.configure({ timeout: 240_000 });

test("fresh designer saves, resumes, generates, edits and accepts one agency", async ({
  page,
}) => {
  const email = await signUp(page, "Maya Designer", "designer");
  for (const label of ["Active projects", "Awaiting review", "Tasks"])
    expect(await metric(page, label)).toBe("0");
  await expect(
    page.getByRole("heading", { name: "Your agency starts with you" }),
  ).toBeVisible();

  // Generation and acceptance are unavailable until the prior step is saved.
  await page.goto("/app/onboarding/review");
  await expect(
    form(page, "Generate a draft").getByText(
      "Save your creative practice and goals first.",
    ),
  ).toBeVisible();
  await expect(
    form(page, "Make this your starting point").getByRole("button"),
  ).toBeDisabled();

  // Required-field and range validation stays beside the field.
  await page.goto("/app/onboarding");
  await submitRejected(page, "Creative practice & goals", {
    "Your creative practice": ["designer"],
    "Tell us about your work": "Brand design",
    "Who do you want to serve?": "Makers",
    "What would you like your company to make possible?": "A studio",
    "Weekly human capacity (hours)": 500,
  });
  await submitRejected(page, "Creative practice & goals", {
    "Weekly human capacity (hours)": 20,
    "Who do you want to serve?": "",
  });

  // Save, then resume after sign-out without losing the saved draft.
  await page.reload();
  await submit(page, "Creative practice & goals", {
    "Your creative practice": ["designer"],
    "Working agency name": "Maya Brand Studio",
    "Tell us about your work": "Brand identity and packaging design.",
    "Who do you want to serve?": "Independent food makers",
    "What would you like your company to make possible?":
      "A studio that pays for more personal illustration work.",
    "Weekly human capacity (hours)": 25,
  });
  await signOut(page);
  await signIn(page, email);
  await page.goto("/app/onboarding");
  const saved = form(page, "Creative practice & goals");
  await expect(saved.getByLabel("Who do you want to serve?")).toHaveValue(
    "Independent food makers",
  );
  await expect(saved.getByLabel("Weekly human capacity (hours)")).toHaveValue(
    "25",
  );
  await expect(
    saved.getByRole("checkbox", { name: "designer", exact: true }),
  ).toBeChecked();

  // A saved draft is not an agency.
  await page.goto("/app/agency");
  await expect(
    form(page, "Agency profile").getByText("Accept your agency draft first."),
  ).toBeVisible();

  await page.goto("/app/onboarding/review");
  await submit(page, "Generate a draft");
  await page.reload();
  const cards = page.getByRole("region", { name: "Workspace records" });
  await expect(cards.getByText("Illustrative price")).toHaveCount(3);
  // Regenerating an unchanged input reproduces the same deterministic draft.
  const first = await cards.innerText();
  await submit(page, "Generate a draft");
  await page.reload();
  expect(await cards.innerText()).toBe(first);

  await submit(page, "Refine your agency draft", {
    "Agency name": "Maya Brand Studio",
    Positioning: "Packaging and identity systems for independent food makers.",
    "Intended buyer": "Independent food makers",
  });
  await page.reload();
  await expect(cards.getByText("Maya Brand Studio")).toBeVisible();
  await submit(page, "Make this your starting point");
  await page.reload();
  await expect(
    form(page, "Make this your starting point").getByText(
      "Your agency is already active.",
    ),
  ).toBeVisible();

  // Exactly three editable packages and seven simulated roles.
  await page.goto("/app/agency");
  await expect(
    form(page, "Agency profile").getByLabel("Agency name"),
  ).toHaveValue("Maya Brand Studio");
  await expect(table(page, "Service packages").locator("tbody tr")).toHaveCount(
    3,
  );
  await page.goto("/app/crew");
  await expect(
    page.getByRole("region", { name: "Workspace records" }).locator("h2"),
  ).toHaveCount(7);
  for (const role of [
    "Creative Lead",
    "Research",
    "Producer",
    "Delivery",
    "Quality",
    "Growth",
    "Finance",
  ])
    await expect(
      page
        .getByRole("region", { name: "Workspace records" })
        .locator("h2", { hasText: role }),
    ).toHaveCount(1);

  // Edit one package and see it persist.
  await page.goto("/app/agency");
  await table(page, "Service packages").getByRole("link").first().click();
  await submit(page, "Edit service package", {
    "Included revision rounds": 3,
    "Turnaround (days)": 12,
  });
  await page.reload();
  await expect(
    form(page, "Edit service package").getByLabel("Turnaround (days)"),
  ).toHaveValue("12");

  // Acceptance created no traction: revenue and repeat clients stay unknown.
  await signOut(page);
  await signIn(page, email);
  await expect(
    page.getByRole("heading", { name: "Welcome, Maya Designer." }),
  ).toBeVisible();
  expect(await metric(page, "Completed projects")).toBe("0");
  await page.goto("/app/growth");
  expect(await metric(page, "Earned revenue")).toBe("Unknown");
  expect(await metric(page, "Collections")).toBe("Unknown");
  await page.goto("/app/investor-readiness");
  await expect(page.getByText("Unknown").first()).toBeVisible();
  await expect(table(page, "Score components")).toHaveCount(0);
});

test("all seven practices produce discipline-specific accepted drafts", async ({
  browser,
}) => {
  const titles = new Map<string, string>();
  for (const practice of [
    "musician",
    "visual artist",
    "filmmaker",
    "writer",
    "photographer",
    "content creator",
  ]) {
    const { context, page } = await newPage(browser);
    try {
      await signUp(page, `Practice ${practice}`, "practice");
      await createAgency(page, { practices: [practice] });
      await page.goto("/app/agency");
      const packages = table(page, "Service packages").locator("tbody th");
      await expect(packages).toHaveCount(3);
      titles.set(practice, (await packages.allInnerTexts()).join("|"));
    } finally {
      await context.close();
    }
  }
  // Each practice yields its own package set, not one shared template.
  expect(new Set(titles.values()).size).toBe(titles.size);
});
