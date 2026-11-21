import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { screens } from "./catalog";
import { sampleScreen } from "./fixtures";
import type { WorkspaceUI } from "./contracts";

/** Replace this boundary with domain read mapping when the shared service package lands.
 * Fixtures are opt-in, read-only and never fallback data for a failed domain read. */
export async function readProductScreen(
  key: string,
  preview: boolean,
  recordId?: string,
): Promise<WorkspaceUI | null> {
  const user = await requireUser();
  if (preview) {
    if (recordId && !recordId.startsWith("sample-")) return null;
    return {
      mode: "sample_preview",
      agencyName: "Moss Studio",
      screen: sampleScreen(key),
      source: {
        origin: "sample",
        asOf: "2026-10-31",
        review: "Not independently verified",
        version: "Sample workspace v1",
      },
    };
  }
  if (recordId) return null;
  const agency = await db.agency.findUnique({
    where: { ownerId: user.id },
    select: { name: true, description: true },
  });
  const screen = structuredClone(screens[key]);
  if (key === "overview") screen.title = `Welcome, ${user.name}.`;
  if (agency && key === "agency")
    screen.description = agency.description || "Your saved agency profile.";
  screen.forms = screen.forms?.map((form) => ({
    ...form,
    unavailableReason:
      "Saving is unavailable in this preview. Nothing has been saved.",
  }));
  screen.notices = [
    ...(screen.notices ?? []),
    {
      title: agency
        ? "Saved actions are not available yet"
        : "Create your agency first",
      body: agency
        ? "This preview shows the workspace interface. Project records and saved actions are not available yet."
        : "Your account has no agency yet. Start with Creative Practice & Goals, then generate, review and explicitly accept an agency draft. This preview does not create an agency or business evidence for you.",
    },
  ];
  return { mode: "empty", agencyName: agency?.name ?? null, screen };
}
