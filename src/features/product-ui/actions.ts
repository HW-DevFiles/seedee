"use server";

import { requireUser } from "@/lib/auth/session";
import type { ActionState } from "./contracts";

export async function productAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  await requireUser();
  if (data.get("preview") === "sample")
    return {
      status: "error",
      message: "Sample preview is read-only. No workspace record was changed.",
    };
  // Domain services reauthorize records and validate commands at their own entry points.
  // Never return success or save to browser storage as a substitute for their persistence.
  return {
    status: "error",
    message:
      "This action is unavailable until its domain service is connected. Nothing has been saved. Your entered values remain here so you can try again.",
  };
}
