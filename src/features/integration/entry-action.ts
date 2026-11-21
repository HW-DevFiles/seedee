"use server";
import { revalidatePath } from "next/cache";
import { requireSecurityContext } from "@/lib/security/request";
import { db } from "@/lib/db";
import { createIntegratedServices } from "./services";
import { safeFailure } from "../workspace/boundary";
export async function processWorkspaceEntry(agencyId: string) {
  try {
    const { userId } = await requireSecurityContext(true),
      services = createIntegratedServices(db);
    const view = await services.automation.readWorkspace(userId, agencyId);
    const result = await services.automation.command(userId, {
      agencyId,
      expectedVersion: view.state.version,
      idempotencyKey: crypto.randomUUID(),
      command: { type: "run_due_routines" },
    });
    if (result.ok && result.workspace.state.version !== view.state.version)
      revalidatePath("/app", "layout");
    return result;
  } catch (error) {
    return safeFailure(error);
  }
}
