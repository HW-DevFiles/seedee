import "server-only";
import { requireUser } from "@/lib/auth/session";
import { sampleScreen } from "./fixtures";
import type { WorkspaceUI } from "./contracts";
import { readIntegratedWorkspace } from "../integration/read";
import { connectedScreen } from "../integration/view";
export async function readProductScreen(
  key: string,
  preview: boolean,
  recordId?: string,
  projectId?: string,
  query?: Record<string, string | string[] | undefined>,
): Promise<WorkspaceUI | null> {
  await requireUser();
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
  return connectedScreen(
    await readIntegratedWorkspace(),
    key,
    recordId,
    projectId,
    query,
  );
}
