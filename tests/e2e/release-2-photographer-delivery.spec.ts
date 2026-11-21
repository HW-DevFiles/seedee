import { expect, test } from "@playwright/test";
import {
  createAgency,
  form,
  metric,
  row,
  SAVED,
  signUp,
  submit,
  submitRejected,
  table,
} from "./support/journey";
import {
  createClientAndProject,
  openTask,
  runAndApprove,
  setProjectStage,
  taskStatus,
  transitionTask,
} from "./support/delivery";

// Release scenario 2 (R08–R16): photographer delivery through closeout.
test.describe.configure({ timeout: 300_000 });

test("photographer runs a reviewed workflow to closeout with separate money facts", async ({
  page,
}) => {
  await signUp(page, "Jules Photographer", "photographer");
  await createAgency(page, {
    practices: ["photographer"],
    name: "Jules Light Studio",
    buyer: "Independent homeware brands",
  });
  const projectId = await createClientAndProject(page, {
    client: "Linden Homeware",
    group: "linden-group",
    project: "Spring catalogue shoot",
  });

  await submit(page, "Use a repeatable process", {
    Workflow: "Creative delivery",
  });
  await page.reload();
  const steps = page.getByRole("region", { name: "Workflow progress" });
  for (const title of [
    "Brief",
    "Plan",
    "Draft",
    "Human review",
    "Delivery recorded",
    "Closeout",
  ])
    await expect(steps.getByRole("heading", { name: title })).toBeVisible();

  // A pending dependency cannot be run or bypassed.
  await openTask(page, projectId, "Plan");
  await expect(
    form(page, "Run eligible simulated work").getByText(
      /Complete this task's prerequisites/,
    ),
  ).toBeVisible();
  await openTask(page, projectId, "Human review");
  await submitRejected(page, "Update task state", { "Next state": "done" });
  // Project completion is refused while delivery work is outstanding.
  await setProjectStage(page, projectId, "active");
  await setProjectStage(page, projectId, "review");
  await page.goto(`/app/projects/${projectId}`);
  await submitRejected(page, "Change project stage", {
    "Project stage": "completed",
  });

  // Brief needs one revision before approval; Plan and Draft follow.
  const briefRun = await runAndApprove(page, projectId, "Brief", true);
  await page.goto(`/app/crew/runs/${briefRun}`);
  await expect(
    table(page, "Persisted run steps").locator("tbody tr").first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Workspace records" })
      .locator("h2")
      .first(),
  ).toBeVisible();
  expect(await taskStatus(page, projectId, "Brief")).toBe("done");
  await runAndApprove(page, projectId, "Plan");
  await runAndApprove(page, projectId, "Draft");
  expect(await taskStatus(page, projectId, "Draft")).toBe("done");

  // Human gate: owner reviews the approved draft.
  await transitionTask(page, projectId, "Human review", [
    "in_progress",
    "awaiting_review",
    "done",
  ]);
  // Delivery cannot be marked recorded before it is recorded.
  await openTask(page, projectId, "Delivery recorded");
  await submit(page, "Update task state", { "Next state": "in_progress" });
  await page.reload();
  await submit(page, "Update task state", { "Next state": "awaiting_review" });
  await page.reload();
  await submitRejected(page, "Update task state", { "Next state": "done" });
  await page.goto(`/app/projects/${projectId}`);
  await submit(page, "Record internal delivery", {
    "Delivery date": "2026-11-20",
    "Delivery note": "Final selects handed over internally; nothing sent.",
  });
  await openTask(page, projectId, "Delivery recorded");
  await submit(page, "Update task state", { "Next state": "done" });

  // Completion creates no money; closeout records each fact separately.
  await setProjectStage(page, projectId, "completed");
  await page.goto("/app/growth");
  await submit(page, "Refresh evidence-based growth");
  await page.reload();
  expect(await metric(page, "Earned revenue")).toBe("Unknown");
  expect(await metric(page, "Collections")).toBe("Unknown");

  await openTask(page, projectId, "Closeout");
  await submit(page, "Update task state", { "Next state": "in_progress" });
  await page.reload();
  await submit(page, "Update task state", { "Next state": "awaiting_review" });
  await page.reload();
  await submitRejected(page, "Update task state", { "Next state": "done" });

  await page.goto(`/app/projects/${projectId}`);
  await submit(page, "Record project closeout", {
    "Delivery date": "2026-11-20",
    "Recognized revenue (USD)": "1800.00",
    "Collected cash (USD)": "900.00",
    "Delivery cost (USD)": "250.00",
    "Founder labor (hours)": 14,
    "Founder cost treatment": "included_in_overhead",
    "Revenue recurrence": "one_off",
    "Repeatability notes": "Shot list template reused.",
  });
  await openTask(page, projectId, "Closeout");
  await submit(page, "Update task state", { "Next state": "done" });

  // Correcting the closeout updates the same evidence, never duplicates it.
  await page.goto(`/app/projects/${projectId}`);
  await expect(
    form(page, "Record project closeout").getByLabel(/^Collected cash/),
  ).toHaveValue("900.00");
  await submit(page, "Record project closeout", {
    "Collected cash (USD)": "1200.00",
  });

  await page.goto("/app/growth");
  for (let i = 0; i < 2; i++) {
    await submit(page, "Refresh evidence-based growth");
    await page.reload();
    expect(await metric(page, "Completed projects")).toBe("1");
    expect(await metric(page, "Earned revenue")).toBe("$1,800.00");
    expect(await metric(page, "Collections")).toBe("$1,200.00");
  }
  await expect(
    row(page, "Milestones", "Paid-project evidence").locator("td").last(),
  ).not.toHaveText("Open");

  await page.goto("/app");
  expect(await metric(page, "Completed projects")).toBe("1");
  expect(await metric(page, "Awaiting review")).toBe("0");
  await page.goto(`/app/projects/${projectId}`);
  await expect(
    table(page, "Work queue").locator("tbody tr td:nth-child(4)"),
  ).toHaveText(Array(6).fill("done"));
  await page.goto("/app/notifications");
  await expect(table(page, "Notifications")).toBeVisible();
});

test("a cancelled run stops and keeps its history", async ({ page }) => {
  await signUp(page, "Cancel Photographer", "cancel");
  await createAgency(page, { practices: ["photographer"] });
  const projectId = await createClientAndProject(page, {
    client: "Cancel Client",
    group: "cancel-group",
    project: "Cancelled shoot",
  });
  await submit(page, "Use a repeatable process", {
    Workflow: "Creative delivery",
  });
  await openTask(page, projectId, "Brief");
  await submit(page, "Run eligible simulated work");
  await page.reload();
  await page
    .getByRole("link", { name: /^Open run · / })
    .first()
    .click();
  await submit(page, "Stop this run");
  await page.reload();
  await expect(page.getByText(/^cancelled · Version \d+$/)).toBeVisible();
  // An ordinary cancellation has no fabricated revision link.
  await expect(page.getByText("Superseded by requested revision")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: /^Open requested revision/ }),
  ).toHaveCount(0);
  for (const title of [
    "Run or resume simulation",
    "Approve this artifact",
    "Ask for a revision",
  ])
    await expect(form(page, title).getByRole("button")).toBeDisabled();
});

// R09, R10, R13, R16: archive, dependency, notification and recommendation
// rules exercised on saved records.
test("archived clients, dependency cycles, notifications and recommendations", async ({
  page,
}) => {
  await signUp(page, "Rules Photographer", "rules");
  await createAgency(page, {
    practices: ["photographer"],
    name: "Rules Studio",
  });
  const projectId = await createClientAndProject(page, {
    client: "Archive Client",
    group: "archive-group",
    project: "Archived client shoot",
  });

  // R10: dependencies stay inside the project and cannot form a cycle.
  await submit(page, "Add a task", {
    "Task title": "Scout location",
    "Task brief": "Visit and photograph the venue.",
  });
  await page.reload();
  await submit(page, "Add a task", {
    "Task title": "Book lighting",
    "Task brief": "Reserve the lighting kit.",
    "Must happen first": ["Scout location"],
  });
  await page.goto(`/app/projects/${projectId}`);
  await row(page, "Work queue", "Scout location").getByRole("link").click();
  const details = form(page, "Task details");
  await expect(
    details.getByRole("checkbox", { name: "Scout location", exact: true }),
  ).toHaveCount(0);
  await submitRejected(page, "Task details", {
    "Must happen first": ["Book lighting"],
  });

  // R13: a review-ready draft notifies once; marking read is persisted.
  await page.goto(`/app/projects/${projectId}`);
  await submit(page, "Use a repeatable process", {
    Workflow: "Creative delivery",
  });
  await openTask(page, projectId, "Brief");
  await submit(page, "Run eligible simulated work");
  await page.reload();
  await page
    .getByRole("link", { name: /^Open run · / })
    .first()
    .click();
  await submit(page, "Run or resume simulation");
  await page.goto("/app/notifications");
  const notices = table(page, "Notifications").locator("tbody tr");
  const review = notices.filter({ hasText: "awaiting your review" });
  await expect(review).toHaveCount(1);
  await expect(review.locator("td").nth(1)).toHaveText("Unread");
  // Milestone completion (first offer) is also an internal notice.
  await expect(
    notices.filter({ hasText: "growth milestone has recorded completion" }),
  ).toHaveCount(1);
  await submit(page, "Clear the unread queue");
  await page.reload();
  await expect(notices.locator("td:nth-of-type(2)")).toHaveText(
    Array(await notices.count()).fill("Read"),
  );
  await page.goto("/app/growth");
  await submit(page, "Refresh evidence-based growth");
  await page.goto("/app/notifications");
  await expect(review).toHaveCount(1);

  // R16: a recommendation converts to one task, another is dismissed.
  await page.goto("/app/growth");
  const recommendations = table(page, "Recommendations").locator("tbody tr");
  const before = await recommendations.count();
  expect(before).toBeGreaterThanOrEqual(2);
  const options = (
    await form(page, "Make a recommendation actionable")
      .getByLabel(/^Recommendation/)
      .locator("option")
      .allInnerTexts()
  ).slice(1);
  await submit(page, "Make a recommendation actionable", {
    Recommendation: options[0],
  });
  await page.reload();
  await submit(page, "Dismiss a recommendation", {
    Recommendation: options[1],
  });
  await page.reload();
  await expect(
    table(page, "Recommendations").getByRole("rowheader", {
      name: options[1],
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/app/crew");
  await expect(
    table(page, "Work queue").getByRole("rowheader", {
      name: options[0],
      exact: true,
    }),
  ).toHaveCount(1);

  // R09: an archived client keeps its history but cannot take new work.
  await page.goto("/app/projects/clients");
  await page.getByRole("link", { name: "Open Archive Client" }).click();
  // On success the same form re-renders as its Restore counterpart.
  const archive = form(page, "Archive client");
  await archive.locator('input[name="confirmed"]').check();
  await archive.locator('button[type="submit"]').click();
  await expect(form(page, "Restore client").getByRole("status")).toHaveText(
    SAVED,
  );
  await page.reload();
  await expect(
    table(page, "Projects").getByRole("rowheader", {
      name: "Archived client shoot",
    }),
  ).toBeVisible();
  await expect(form(page, "Restore client")).toBeVisible();
  await page.goto("/app/projects");
  await expect(
    form(page, "Start a project")
      .getByLabel(/^Client/)
      .locator("option", { hasText: "Archive Client" }),
  ).toHaveCount(0);
});
