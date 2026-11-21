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
        version: "Presentation fixture v1",
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
      "This screen is ready for its domain service. Saving is unavailable in this frontend package until that integration lands. Nothing has been saved.",
  }));
  screen.notices = [
    ...(screen.notices ?? []),
    {
      title: agency
        ? "Service integration pending"
        : "Create your agency first",
      body: agency
        ? "This branch contains the product interface and foundation account data. Operational records and mutations are being connected by their feature owners."
        : "Your account has no agency yet. Start with Creative Practice & Goals, then generate, review and explicitly accept an agency draft. The current frontend package does not fabricate an agency or business evidence.",
    },
  ];
  return { mode: "empty", agencyName: agency?.name ?? null, screen };
}
