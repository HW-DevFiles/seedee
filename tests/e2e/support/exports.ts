import { expect, type Page } from "@playwright/test";
import { BOUNDARY, table } from "./journey";

// Solicitation phrases the pitch/export templates must never contain (C11).
// The exact educational disclaimer and negative label remain allowed.
const solicitation = [
  /invest in us/i,
  /join our round/i,
  /reserve your (spot|allocation)/i,
  /subscribe (now|today)/i,
  /guaranteed returns?/i,
];

// Download the newest saved export in both formats through the browser's own
// authenticated session, asserting private attachment headers.
export async function downloadLatestExport(page: Page) {
  await page.goto("/app/investor-readiness/data-room");
  const link = table(page, "Saved private exports")
    .getByRole("link", { name: /^Download Markdown/ })
    .first();
  const href = (await link.getAttribute("href"))!;
  const id = href.split("?")[0].split("/").at(-1)!;
  const markdown = await page.request.get(`/app/exports/${id}?format=markdown`);
  const csv = await page.request.get(`/app/exports/${id}?format=csv`);
  for (const [response, type, name] of [
    [markdown, "text/markdown", "seedee-preparation.md"],
    [csv, "text/csv", "seedee-preparation.csv"],
  ] as const) {
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(type);
    expect(response.headers()["content-disposition"]).toBe(
      `attachment; filename="${name}"`,
    );
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  return { id, markdown: await markdown.text(), csv: await csv.text() };
}

export function assertExports(
  markdown: string,
  csv: string,
  options: { sample: boolean; horizon: number },
) {
  expect(markdown).toContain(BOUNDARY);
  expect(markdown).toContain(
    "Hypothetical planning scenario — not an offer of securities.",
  );
  for (const version of [
    "readiness-v1.1",
    "agency-finance-v1.1",
    "dilution-education-v1.0",
  ])
    expect(markdown).toContain(version);
  expect(markdown).toContain("## Unknowns and risk notes");
  expect(markdown.includes("Demo preview · Sample data")).toBe(options.sample);
  for (const phrase of solicitation) expect(markdown).not.toMatch(phrase);
  const lines = csv.split("\r\n");
  expect(lines[0]).toContain(
    "period,classification,revenue,direct,overhead,operatingSurplus,tax,receipts,arClose,netCashFlow,cashClose",
  );
  const data = lines.filter((line) => /^\d{4}-\d{2},/.test(line));
  expect(data).toHaveLength(options.horizon);
  expect(data.every((line) => line.split(",")[1] === "projected")).toBe(true);
  return data;
}
