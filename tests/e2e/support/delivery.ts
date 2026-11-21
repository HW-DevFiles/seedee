import { expect, type Page } from "@playwright/test";
import { form, linkId, row, submit } from "./journey";

// Delivery steps shared by the photographer and keyboard/operational
// scenarios. They follow the order the project workspace instructs.
export async function createClientAndProject(
  page: Page,
  options: { client: string; group: string; project: string; budget?: string },
) {
  await page.goto("/app/projects/clients");
  await submit(page, "Add a client", {
    "Client name": options.client,
    Organization: `${options.client} Ltd`,
    "Economic client group": options.group,
  });
  await page.goto("/app/projects");
  await page.reload();
  await submit(page, "Start a project", {
    "Project title": options.project,
    Client: options.client,
    "Service package": await firstPackage(page),
    "Project brief": "Product photography for a spring catalogue.",
    "Due date": "2026-12-15",
    "Budget (USD)": options.budget ?? "1800.00",
  });
  await page.reload();
  const link = page.getByRole("link", { name: `Open ${options.project}` });
  const projectId = await linkId(link);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}$`));
  return projectId;
}

async function firstPackage(page: Page) {
  const labels = await form(page, "Start a project")
    .getByLabel(/^Service package/)
    .locator("option")
    .allInnerTexts();
  return labels[1];
}

export async function openTask(page: Page, projectId: string, title: string) {
  await page.goto(`/app/projects/${projectId}`);
  const link = row(page, "Work queue", title).getByRole("link");
  await link.click();
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
}

export async function taskStatus(page: Page, projectId: string, title: string) {
  await page.goto(`/app/projects/${projectId}`);
  const cells = row(page, "Work queue", title).locator("td");
  return (await cells.nth(2).innerText()).trim();
}

// Queue and generate a simulated run for a work task; optionally request one
// revision first; approve the final version. Returns the run id.
export async function runAndApprove(
  page: Page,
  projectId: string,
  title: string,
  revise = false,
) {
  await openTask(page, projectId, title);
  await submit(page, "Run eligible simulated work");
  await page.reload();
  const runLink = page.getByRole("link", { name: /^Open run · / }).first();
  await runLink.click();
  await submit(page, "Run or resume simulation");
  await page.reload();
  await expect(page.getByText(/^awaiting_review · Version \d+$/)).toBeVisible();
  await expect(page.getByText(/^Demo provider\./)).toBeVisible();
  if (revise) {
    await submit(page, "Ask for a revision", {
      "What should change?": "Add a lighting plan for the hero shots.",
    });
    // Revision supersedes this run; the refreshed old URL links to the
    // queued successor and the superseded version cannot be approved.
    await page.reload();
    await expect(page.getByText(/^cancelled · Version \d+$/)).toBeVisible();
    await expect(
      page.getByText("Superseded by requested revision"),
    ).toBeVisible();
    await expect(
      form(page, "Approve this artifact").getByRole("button"),
    ).toBeDisabled();
    const next = page.getByRole("link", {
      name: /^Open requested revision · queued · v1$/,
    });
    await expect(next).toHaveCount(1);
    await next.click();
    await expect(
      page.getByRole("link", { name: "Open previous version" }),
    ).toBeVisible();
    await submit(page, "Run or resume simulation");
    await page.reload();
    await expect(
      page.getByText(/^awaiting_review · Version \d+$/),
    ).toBeVisible();
    // The successor draft carries the owner's revision note.
    await expect(
      page.getByText("Add a lighting plan for the hero shots.", {
        exact: false,
      }),
    ).toBeVisible();
  }
  await submit(page, "Approve this artifact");
  await page.reload();
  await expect(page.getByText(/^completed · Version \d+$/)).toBeVisible();
  return page.url().split("/").at(-1)!;
}

export async function transitionTask(
  page: Page,
  projectId: string,
  title: string,
  states: string[],
) {
  for (const state of states) {
    await openTask(page, projectId, title);
    await submit(page, "Update task state", {
      "Next state": state,
      "Transition note": `Owner moved ${title} to ${state}`,
    });
  }
}

export async function setProjectStage(
  page: Page,
  projectId: string,
  stage: string,
) {
  await page.goto(`/app/projects/${projectId}`);
  await submit(page, "Change project stage", { "Project stage": stage });
}
