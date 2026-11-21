"use server";

import { requireUser } from "@/lib/auth/session";
import { screens } from "./catalog";
import { parseFormInput } from "./form-input";
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
  const command = data.get("command");
  const spec = Object.values(screens)
    .flatMap((screen) => screen.forms ?? [])
    .find((form) => form.id === command);
  if (!spec)
    return {
      status: "error",
      message: "This action is not recognized. Reload the page and try again.",
    };
  const parsed = parseFormInput(spec, data);
  if (!parsed.ok) return parsed.state;
  // Domain services reauthorize records and validate commands at their own entry points.
  // Never return success or save to browser storage as a substitute for their persistence.
  return {
    status: "error",
    message:
      "Saving is unavailable in this preview. Nothing has been saved. Your entered values remain here.",
  };
}
