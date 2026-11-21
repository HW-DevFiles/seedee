import { expect, test, type Page } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgency,
  form,
  labelled,
  noHorizontalScroll,
  PASSWORD,
  signIn,
  signUp,
  submit,
  table,
} from "./support/journey";
import { contrastFailures, tabTo, typeInto } from "./support/a11y";

// Release scenario 6 (R22, R24, R25): keyboard loop, responsive layouts,
// colour contrast, offline core demo and restart persistence.
test.describe.configure({ timeout: 300_000 });

const coreRoutes = [
  "/app",
  "/app/onboarding",
  "/app/onboarding/review",
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
];

async function keyboardSubmit(page: Page, title: string) {
  const target = form(page, title);
  const confirm = target.locator('input[name="confirmed"]');
  if (await confirm.count()) {
    await tabTo(page, confirm);
    await page.keyboard.press("Space");
  }
  await tabTo(page, target.locator('button[type="submit"]'));
  await page.keyboard.press("Enter");
  await expect(target.getByRole("status")).toBeVisible({ timeout: 20000 });
}

test("the core loop is operable with the keyboard alone", async ({ page }) => {
  await page.goto("/sign-up");
  await typeInto(page, page.getByLabel("Your name"), "Keyboard Creative");
  await typeInto(
    page,
    page.getByLabel("Email address"),
    `keyboard-${crypto.randomUUID()}@example.test`,
  );
  await typeInto(page, page.getByLabel("Password", { exact: true }), PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app$/);

  // Skip link, then onboarding entirely by Tab/Space/typing.
  await page.goto("/app/onboarding");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const onboarding = form(page, "Creative practice & goals");
  await tabTo(page, onboarding.getByRole("checkbox", { name: "designer" }));
  await page.keyboard.press("Space");
  for (const [label, value] of [
    ["Tell us about your work", "Editorial illustration."],
    ["Who do you want to serve?", "Independent magazines"],
    ["What would you like your company to make possible?", "A calmer studio"],
    ["Weekly human capacity (hours)", "18"],
  ])
    await typeInto(page, labelled(onboarding, label), value);
  await keyboardSubmit(page, "Creative practice & goals");

  await page.goto("/app/onboarding/review");
  await keyboardSubmit(page, "Generate a draft");
  await page.reload();
  await keyboardSubmit(page, "Make this your starting point");

  // Add a client and a project with the keyboard.
  await page.goto("/app/projects/clients");
  const client = form(page, "Add a client");
  await typeInto(page, labelled(client, "Client name"), "Keyboard Client");
  await typeInto(page, labelled(client, "Economic client group"), "kb-group");
  await keyboardSubmit(page, "Add a client");
  await page.goto("/app/projects");
  const project = form(page, "Start a project");
  await typeInto(page, labelled(project, "Project title"), "Keyboard project");
  await typeInto(
    page,
    labelled(project, "Project brief"),
    "Cover illustration",
  );
  await keyboardSubmit(page, "Start a project");
  await page.reload();
  // Open the project from the table and reach its workflow form by keyboard.
  await tabTo(page, page.getByRole("link", { name: "Open Keyboard project" }));
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Keyboard project" }),
  ).toBeVisible();
  const workflow = form(page, "Use a repeatable process").getByLabel(
    /^Workflow/,
  );
  await tabTo(page, workflow);
  // Select typeahead (ArrowDown opens the native popup on macOS).
  await page.keyboard.type("Creative");
  await expect(workflow).toHaveValue("creative_delivery");
  await keyboardSubmit(page, "Use a repeatable process");
  await page.reload();
  await expect(table(page, "Work queue").locator("tbody tr")).toHaveCount(6);
});

test("core routes fit 360px and desktop, keep AA contrast and the colorway", async ({
  page,
}) => {
  await signUp(page, "Layout Creative", "layout");
  await createAgency(page, { name: "Layout Studio" });
  const failures: Record<string, unknown> = {};
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of coreRoutes) {
      await page.goto(route);
      await expect(page.locator("main h1"), route).toBeVisible();
      await noHorizontalScroll(page);
      const found = await contrastFailures(page);
      if (found.length) failures[`${width} ${route}`] = found;
    }
  }
  expect(failures).toEqual({});
  // Colorway tokens: off-white background, hunter-green text, deep headings.
  const colors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    heading: getComputedStyle(document.querySelector("main h1")!).color,
  }));
  expect(colors).toEqual({
    body: "rgb(248, 246, 239)",
    text: "rgb(53, 94, 59)",
    heading: "rgb(31, 61, 43)",
  });
  // Primary actions keep a 44px target; mobile navigation is operable.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/app/projects");
  const button = form(page, "Start a project").locator('button[type="submit"]');
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const menu = page.getByRole("button", { name: "Workspace menu" });
  await tabTo(page, menu);
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await tabTo(
    page,
    page
      .getByRole("navigation", { name: "Workspace", exact: true })
      .getByRole("link", { name: "Growth", exact: true }),
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/growth$/);
});

test("reduced motion disables transitions", async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  try {
    await page.goto("/sign-in");
    const duration = await page
      .getByRole("button", { name: "Sign in", exact: true })
      .evaluate((node) => getComputedStyle(node).transitionDuration);
    expect(duration.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  } finally {
    await context.close();
  }
});

test("the core demo makes no off-origin network request", async ({ page }) => {
  const origin = new URL(process.env.E2E_BASE_URL!).host;
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["data:", "blob:"].includes(url.protocol) && url.host !== origin)
      foreign.push(request.url());
  });
  await signUp(page, "Offline Creative", "offline");
  await createAgency(page, { practices: ["writer"], name: "Offline Studio" });
  await page.goto("/app/investor-readiness/pitch");
  await submit(page, "Draft from saved evidence");
  for (const route of coreRoutes) await page.goto(route);
  expect(foreign).toEqual([]);
});

test("saved data survives an application restart on the same database", async ({
  browser,
}) => {
  test.skip(
    !existsSync(".next/BUILD_ID"),
    "Requires a production build (npm run build).",
  );
  const directory = mkdtempSync(join(tmpdir(), "seedee-restart-"));
  const databaseUrl = `file:${join(directory, "restart.db")}`;
  const port = Number(process.env.E2E_RESTART_PORT ?? "3400");
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    E2E_PORT: String(port),
    AI_PROVIDER: "demo",
    DEMO_ACCOUNT_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env, stdio: "pipe" },
  );
  const base = `https://127.0.0.1:${port}`;
  const start = async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/serve-browser-production.ts"],
      { env, stdio: "ignore" },
    );
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      baseURL: base,
    });
    for (let i = 0; i < 60; i++) {
      const ok = await context.request
        .get("/", { timeout: 2000 })
        .then((r) => r.ok())
        .catch(() => false);
      if (ok) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { child, context, page: await context.newPage() };
  };
  const stop = async (child: ChildProcess) => {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  };
  let server = await start();
  try {
    const email = await signUp(server.page, "Restart Creative", "restart");
    await createAgency(server.page, { name: "Restart Studio" });
    await server.page.goto("/app/projects/clients");
    await submit(server.page, "Add a client", {
      "Client name": "Persisted Client",
      "Economic client group": "persist-group",
    });
    await server.context.close();
    await stop(server.child);

    server = await start();
    // A restarted server reads the same saved records.
    await signIn(server.page, email);
    await server.page.goto("/app/agency");
    await expect(
      form(server.page, "Agency profile").getByLabel(/^Agency name/),
    ).toHaveValue("Restart Studio");
    await server.page.goto("/app/projects/clients");
    await expect(
      server.page.getByRole("rowheader", { name: "Persisted Client" }),
    ).toBeVisible();
  } finally {
    await server.context.close().catch(() => undefined);
    await stop(server.child);
    rmSync(directory, { recursive: true, force: true });
  }
});
