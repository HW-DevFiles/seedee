import { expect, test, type Page } from "@playwright/test";
import {
  createAgency,
  form,
  linkId,
  newPage,
  row,
  signUp,
  submit,
  submitRejected,
  table,
} from "./support/journey";
import { createClientAndProject, openTask } from "./support/delivery";

// Release scenario 5 (R01, R04, R08, R12, R23): ownership isolation,
// duplicate requests, unsafe content and session failure.
test.describe.configure({ timeout: 300_000 });

const NOT_FOUND = "That page hasn't taken shape.";

type Owned = {
  client: string;
  project: string;
  task: string;
  run: string;
  pkg: string;
  exportId: string;
};

// Account A builds one of every owned record the isolation test probes.
async function buildOwnedRecords(page: Page): Promise<Owned> {
  await signUp(page, "Isolation Owner", "owner-a");
  await createAgency(page, { practices: ["designer"], name: "Owner A Studio" });
  await page.goto("/app/agency");
  const pkg = await linkId(
    table(page, "Service packages").getByRole("link").first(),
  );
  const project = await createClientAndProject(page, {
    client: "Private Client A",
    group: "group-a",
    project: "Private project A",
  });
  await page.goto("/app/projects/clients");
  const client = await linkId(
    page.getByRole("link", { name: "Open Private Client A" }),
  );
  await page.goto(`/app/projects/${project}`);
  await submit(page, "Use a repeatable process", {
    Workflow: "Creative delivery",
  });
  await openTask(page, project, "Brief");
  const task = page.url().split("/").at(-1)!;
  await submit(page, "Run eligible simulated work");
  await page.reload();
  const run = await linkId(page.getByRole("link", { name: /^Open run · / }));
  await page.goto("/app/investor-readiness/data-room");
  await submit(page, "Add an evidence reference", {
    Folder: "company",
    "Evidence title": "Owner A evidence",
    Origin: "user_entered",
    "As-of date": "2026-10-31",
    "Review status": "owner_attested",
  });
  await page.reload();
  await submit(page, "Create a private preparation pack", {
    "Evidence references": ["Owner A evidence"],
  });
  await page.reload();
  const exportId = await linkId(
    table(page, "Saved private exports").getByRole("link").first(),
  );
  return { client, project, task, run, pkg, exportId };
}

test("a second account cannot read or mutate the first account's records", async ({
  page,
  browser,
}) => {
  const a = await buildOwnedRecords(page);
  const b = await newPage(browser);
  try {
    await signUp(b.page, "Isolation Intruder", "owner-b");
    await createAgency(b.page, {
      practices: ["writer"],
      name: "Owner B Studio",
    });
    const bProject = await createClientAndProject(b.page, {
      client: "Client B",
      group: "group-b",
      project: "Project B",
    });

    // Reads: every detail route and nested pair fails closed.
    for (const route of [
      `/app/projects/clients/${a.client}`,
      `/app/projects/${a.project}`,
      `/app/crew/tasks/${a.task}`,
      `/app/projects/${a.project}/tasks/${a.task}`,
      `/app/projects/${bProject}/tasks/${a.task}`,
      `/app/crew/runs/${a.run}`,
      `/app/agency/packages/${a.pkg}`,
    ]) {
      await b.page.goto(route);
      await expect(
        b.page.getByRole("heading", { name: NOT_FOUND }),
        route,
      ).toBeVisible();
      await expect(b.page.getByText("Private Client A")).toHaveCount(0);
    }
    for (const format of ["markdown", "csv"]) {
      const response = await b.page.request.get(
        `/app/exports/${a.exportId}?format=${format}`,
      );
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain("Owner A");
    }

    // Writes: B's own forms re-pointed at A's record ids are refused.
    await b.page.goto("/app/projects/clients");
    const bClient = await linkId(
      b.page.getByRole("link", { name: "Open Client B" }),
    );
    await b.page.goto(`/app/projects/clients/${bClient}`);
    const edit = form(b.page, "Edit client");
    await edit
      .locator('input[name="recordId"]')
      .evaluate(
        (node, id) => ((node as HTMLInputElement).value = id),
        a.client,
      );
    await submitRejected(b.page, "Edit client", { "Client name": "Hijacked" });

    await b.page.goto(`/app/projects/${bProject}`);
    const stage = form(b.page, "Change project stage");
    await stage
      .locator('input[name="recordId"]')
      .evaluate(
        (node, id) => ((node as HTMLInputElement).value = id),
        a.project,
      );
    await submitRejected(b.page, "Change project stage", {
      "Project stage": "active",
    });
    // A cross-account client cannot be attached to B's new project.
    await b.page.goto("/app/projects");
    const clientSelect = form(b.page, "Start a project").getByLabel(/^Client/);
    await clientSelect.evaluate((node, id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = "Foreign client";
      node.appendChild(option);
    }, a.client);
    await submitRejected(b.page, "Start a project", {
      "Project title": "Cross-owner project",
      Client: "Foreign client",
      "Project brief": "Should not save",
    });

    // A's records are unchanged and still private to A.
    await page.goto(`/app/projects/clients/${a.client}`);
    await expect(
      form(page, "Edit client").getByLabel(/^Client name/),
    ).toHaveValue("Private Client A");
    await page.goto(`/app/projects/${a.project}`);
    await expect(
      form(page, "Project details").getByLabel(/^Project title/),
    ).toHaveValue("Private project A");
    await b.page.goto("/app/projects");
    await expect(b.page.getByText("Cross-owner project")).toHaveCount(0);
  } finally {
    await b.context.close();
  }
});

test("duplicate acceptance, run and routine requests create one record", async ({
  page,
}) => {
  await signUp(page, "Duplicate Owner", "dupe");
  await page.goto("/app/onboarding");
  await submit(page, "Creative practice & goals", {
    "Your creative practice": ["filmmaker"],
    "Tell us about your work": "Short documentary edits.",
    "Who do you want to serve?": "Nonprofits",
    "What would you like your company to make possible?": "A steady studio",
    "Weekly human capacity (hours)": 20,
  });
  await page.goto("/app/onboarding/review");
  await submit(page, "Generate a draft");

  // Two tabs accept the same draft; exactly one agency results.
  const second = await page.context().newPage();
  await second.goto("/app/onboarding/review");
  await page.reload();
  for (const tab of [page, second]) {
    const accept = form(tab, "Make this your starting point");
    await accept.locator('input[name="confirmed"]').check();
  }
  await Promise.all(
    [page, second].map((tab) =>
      form(tab, "Make this your starting point")
        .locator('button[type="submit"]')
        .click(),
    ),
  );
  for (const tab of [page, second])
    await expect(
      form(tab, "Make this your starting point").locator(
        '[role="status"], [role="alert"]',
      ),
    ).toBeVisible({ timeout: 20000 });
  await page.goto("/app/agency");
  await expect(table(page, "Service packages").locator("tbody tr")).toHaveCount(
    3,
  );

  // Two tabs queue the same task's run; one run exists.
  const projectId = await createClientAndProject(page, {
    client: "Dupe Client",
    group: "dupe-group",
    project: "Dupe project",
  });
  await submit(page, "Use a repeatable process", {
    Workflow: "Creative delivery",
  });
  await openTask(page, projectId, "Brief");
  await second.goto(page.url());
  await Promise.all(
    [page, second].map((tab) =>
      form(tab, "Run eligible simulated work")
        .locator('button[type="submit"]')
        .click(),
    ),
  );
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole("link", { name: /^Open run · / })).toHaveCount(1);

  // Running due routines twice creates the occurrence's tasks once.
  await page.goto("/app/crew/workflows");
  await submit(page, "Enable a routine", {
    Routine: "Weekly planning",
    "Routine timezone": "America/New_York",
  });
  await page.reload();
  await submit(page, "Run the due work");
  await page.goto("/app/crew");
  const after = await table(page, "Work queue").locator("tbody tr").count();
  await page.goto("/app/crew/workflows");
  await submit(page, "Run the due work");
  await second.goto("/app/crew/workflows");
  await submit(second, "Run the due work");
  await page.goto("/app/crew");
  await expect(table(page, "Work queue").locator("tbody tr")).toHaveCount(
    after,
  );
  // Pausing records the routine as paused.
  await page.goto("/app/crew/workflows");
  await submit(page, "Pause a routine", { Routine: "weekly_planning" });
  await page.reload();
  await expect(
    row(page, "Saved routines", "weekly_planning").locator("td").nth(2),
  ).toHaveText("Paused");
  await second.close();
});

test("unsafe markup and link schemes stay inert or are refused", async ({
  page,
}) => {
  await signUp(page, "Markup Owner", "markup");
  await createAgency(page, { name: "Markup Studio" });
  const payload = '<img src=x onerror="window.__seedeeXss=1">';
  await page.goto("/app/projects/clients");
  await submit(page, "Add a client", {
    "Client name": `Client ${payload}`,
    "Economic client group": "markup-group",
    "Contact notes": `<script>window.__seedeeXss=1</script>`,
  });
  await page.reload();
  await expect(
    page.getByRole("rowheader", { name: `Client ${payload}` }),
  ).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  await page.goto("/app/investor-readiness/data-room");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "http://example.test/plain",
  ])
    await submitRejected(page, "Add an evidence reference", {
      Folder: "market",
      "Evidence title": `Unsafe ${url.slice(0, 10)}`,
      "HTTPS reference": url,
      Origin: "user_entered",
      "As-of date": "2026-10-31",
      "Review status": "unreviewed",
    });
  await page.reload();
  await submit(page, "Add an evidence reference", {
    Folder: "market",
    "Evidence title": `Notes ${payload}`,
    "HTTPS reference": "https://example.test/notes",
    Origin: "user_entered",
    "As-of date": "2026-10-31",
    "Review status": "unreviewed",
  });
  await page.reload();
  await submit(page, "Create a private preparation pack", {
    "Evidence references": [`Notes ${payload}`],
  });
  await page.reload();
  const id = await linkId(
    table(page, "Saved private exports").getByRole("link").first(),
  );
  const markdown = await (
    await page.request.get(`/app/exports/${id}?format=markdown`)
  ).text();
  // Markdown escapes the angle brackets so a renderer cannot emit the tag.
  expect(markdown).toContain(
    'Notes \\<img src=x onerror="window.\\_\\_seedeeXss=1"\\>',
  );
  expect(markdown).not.toMatch(/(^|[^\\])<img/);
  expect(await page.evaluate(() => "__seedeeXss" in window)).toBe(false);
});

test("expired, forged and signed-out sessions fail safely", async ({
  page,
  context,
}) => {
  await signUp(page, "Session Owner", "session");
  await createAgency(page, { name: "Session Studio" });
  await page.goto("/app/investor-readiness/data-room");
  await submit(page, "Create a private preparation pack");
  await page.reload();
  const id = await linkId(
    table(page, "Saved private exports").getByRole("link").first(),
  );
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "seedee_session")!;
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  if (
    process.env.E2E_PRODUCTION === "1" ||
    process.env.E2E_EXTERNAL_SERVER === "1"
  )
    expect(session.secure).toBe(true);

  // A forged token is treated as signed out.
  await context.clearCookies();
  await context.addCookies([{ ...session, value: "forged-session-token" }]);
  await page.goto("/app/projects");
  await expect(page).toHaveURL(/\/sign-in$/);
  const forged = await page.request.get(`/app/exports/${id}?format=markdown`);
  expect([401, 404]).toContain(forged.status());
  expect(await forged.text()).not.toContain("Session Studio");

  // Restoring the real token works; signing out revokes it server-side.
  await context.clearCookies();
  await context.addCookies([session]);
  await page.goto("/app");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.addCookies([session]);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
  const revoked = await page.request.get(`/app/exports/${id}?format=csv`);
  expect([401, 404]).toContain(revoked.status());
});

test("export downloads are rate limited with a visible message", async ({
  page,
}) => {
  await signUp(page, "Limit Owner", "limit");
  await createAgency(page, { name: "Limit Studio" });
  await page.goto("/app/investor-readiness/data-room");
  await submit(page, "Create a private preparation pack");
  await page.reload();
  const id = await linkId(
    table(page, "Saved private exports").getByRole("link").first(),
  );
  const statuses: number[] = [];
  let body = "";
  for (let i = 0; i < 12; i++) {
    const response = await page.request.get(`/app/exports/${id}?format=csv`);
    statuses.push(response.status());
    if (response.status() === 429) {
      body = await response.text();
      expect(response.headers()["retry-after"]).toMatch(/^\d+$/);
      break;
    }
  }
  expect(statuses.at(-1), JSON.stringify(statuses)).toBe(429);
  expect(statuses.filter((s) => s === 200).length).toBeGreaterThan(0);
  expect(body.length).toBeGreaterThan(0);
  // Creating another pack is also refused while limited, with a message.
  await page.reload();
  await submitRejected(page, "Create a private preparation pack");
});
