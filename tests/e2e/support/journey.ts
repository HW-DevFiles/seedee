import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

// Shared browser steps for the release-acceptance scenarios. Every helper
// drives the rendered UI; none of them call services or write the database.
export const SAVED = "Saved. Your workspace now shows the recorded result.";
export const BOUNDARY =
  "Educational planning only. Not financial, investment, accounting, tax or legal advice. No funding or return guarantee. Consult qualified advisers before acting.";
export const PASSWORD = "Release acceptance password!";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const secure =
  process.env.E2E_PRODUCTION === "1" || process.env.E2E_EXTERNAL_SERVER === "1";

export async function newPage(browser: Browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: secure });
  return { context, page: await context.newPage() };
}

export async function signUp(page: Page, name: string, prefix = "qa") {
  const email = `${prefix}-${crypto.randomUUID()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}

export const form = (page: Page, title: string) =>
  page.getByRole("form", { name: title, exact: true });

type Value = string | number | boolean | string[];

// Fill a rendered ActionForm by visible label. Arrays tick multiselect
// options by their visible label; booleans toggle checkboxes; selects accept
// either the option label or value.
export async function fill(target: Locator, values: Record<string, Value>) {
  for (const [label, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      const group = target.getByRole("group", { name: label });
      for (const option of value)
        await group
          .getByRole("checkbox", { name: option, exact: true })
          .check();
      continue;
    }
    const control = labelled(target, label);
    if (typeof value === "boolean") {
      if (value) await control.check();
      else await control.uncheck();
      continue;
    }
    const tag = await control.evaluate((node) => node.tagName.toLowerCase());
    if (tag === "select") await selectOption(control, String(value));
    else await control.fill(String(value));
  }
}

// Required labels render a decorative " *"; match the label with or without it.
export const labelled = (target: Locator, label: string) =>
  target.getByLabel(new RegExp(`^${escape(label)}( \\*)?$`));

async function selectOption(control: Locator, value: string) {
  const options = await control.locator("option").evaluateAll((nodes) =>
    nodes.map((n) => ({
      value: (n as HTMLOptionElement).value,
      label: n.textContent ?? "",
    })),
  );
  const match =
    options.find((o) => o.value === value) ??
    options.find((o) => o.label === value) ??
    options.find((o) => o.label.startsWith(value));
  if (!match)
    throw new Error(`No option ${value} in ${JSON.stringify(options)}`);
  await control.selectOption(match.value);
}

export async function submit(
  page: Page,
  title: string,
  values: Record<string, Value> = {},
  expected: string | RegExp = SAVED,
) {
  const target = form(page, title);
  await expect(target).toBeVisible();
  await fill(target, values);
  const confirm = target.locator('input[name="confirmed"]');
  if (await confirm.count()) await confirm.check();
  await target.locator('button[type="submit"]').click();
  const message = target.locator('[role="status"], [role="alert"]');
  await expect(message.first()).toContainText(expected, { timeout: 20000 });
  return message.first();
}

// Submit and expect a server-rejected result; returns the alert. Native
// constraint validation is switched off so the server's own validation is
// what gets exercised, as it would be for a hand-crafted request.
export async function submitRejected(
  page: Page,
  title: string,
  values: Record<string, Value> = {},
  expected?: string | RegExp,
) {
  const target = form(page, title);
  await target.evaluate(
    (node) => ((node as HTMLFormElement).noValidate = true),
  );
  await fill(target, values);
  const confirm = target.locator('input[name="confirmed"]');
  if (await confirm.count()) await confirm.check();
  await target.locator('button[type="submit"]').click();
  const alert = target.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 20000 });
  if (expected) await expect(alert).toContainText(expected);
  return alert;
}

// A string caption matches exactly; Playwright's hasText alone would also
// match longer captions such as "… · Downside without hire".
export const table = (page: Page, caption: string | RegExp) =>
  page.locator("table").filter({
    has: page.locator("caption", {
      hasText:
        typeof caption === "string"
          ? new RegExp(`^${escape(caption)}$`)
          : caption,
    }),
  });

// A table row identified by its exact row-header (first column) text.
export const row = (page: Page, caption: string | RegExp, header: string) =>
  table(page, caption)
    .locator("tbody tr")
    .filter({
      has: page.getByRole("rowheader", { name: header, exact: true }),
    });

export async function metric(page: Page, label: string) {
  const card = page
    .getByRole("region", { name: "Workspace metrics" })
    .locator("h2", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=..");
  return (
    await card.locator("p").first().innerText({ timeout: 10_000 })
  ).trim();
}

export async function noHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

// Onboarding → generated draft → edited → accepted. Returns the edited name.
export async function createAgency(
  page: Page,
  options: {
    practices?: string[];
    name?: string;
    buyer?: string;
    capacity?: number;
  } = {},
) {
  const name =
    options.name ?? `Fernhill Studio ${crypto.randomUUID().slice(0, 6)}`;
  await page.goto("/app/onboarding");
  await submit(page, "Creative practice & goals", {
    "Your creative practice": options.practices ?? ["designer"],
    "Working agency name": name,
    "Tell us about your work":
      "Independent brand and campaign design for small makers.",
    "Who do you want to serve?": options.buyer ?? "Independent product makers",
    "What would you like your company to make possible?":
      "A repeatable studio that funds more of my own creative work.",
    "Weekly human capacity (hours)": options.capacity ?? 30,
  });
  await page.goto("/app/onboarding/review");
  await submit(page, "Generate a draft");
  await page.reload();
  await submit(page, "Refine your agency draft", {
    "Agency name": name,
    Positioning: "Considered brand systems for independent makers.",
    "Intended buyer": options.buyer ?? "Independent product makers",
  });
  await page.reload();
  await submit(page, "Make this your starting point");
  return name;
}

// The hidden recordId/version fields are rendered from the owned read; the
// browser never chooses them. Returns the id rendered in a detail link.
export async function linkId(link: Locator) {
  const href = await link.getAttribute("href");
  const id = href?.split("?")[0].split("/").at(-1);
  if (!id) throw new Error("Link has no record id.");
  return id;
}
