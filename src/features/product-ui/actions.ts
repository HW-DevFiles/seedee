"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSecurityContext } from "@/lib/security/request";
import { parseFormInput, commandState } from "./form-input";
import type { ActionState } from "./contracts";
import { readIntegratedWorkspace } from "../integration/read";
import { connectedScreen } from "../integration/view";
import { executeProductCommand } from "../integration/commands";
import { safeFailure } from "../workspace/boundary";
import { DomainError } from "../workspace/contracts";
export async function productAction(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  try {
    await requireSecurityContext(true);
    if (data.get("preview") === "sample")
      throw new DomainError(
        "invalid_input",
        "Sample preview is read-only. No record was changed.",
      );
    const loaded = await readIntegratedWorkspace();
    const key = String(data.get("screenKey") ?? ""),
      recordId = String(data.get("recordId") ?? "") || undefined;
    const view = connectedScreen(
      loaded,
      key,
      ["draft", "agency", "onboarding", "pitch"].includes(key)
        ? undefined
        : recordId,
      String(data.get("projectId") ?? "") || undefined,
    );
    const spec = view?.screen.forms?.find((f) => f.id === data.get("command"));
    if (!spec || spec.unavailableReason)
      throw new DomainError(
        "invalid_input",
        spec?.unavailableReason ?? "Reload this page before submitting.",
      );
    const parsed = parseFormInput(spec, data);
    if (!parsed.ok) return parsed.state;
    const versionRaw = data.get("expectedVersion");
    const version = versionRaw === null ? null : Number(versionRaw);
    if (version !== null && (!Number.isSafeInteger(version) || version < 0))
      throw new DomainError("invalid_input", "Invalid record version.");
    const requestKey = String(data.get("idempotencyKey") ?? "");
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(requestKey))
      throw new DomainError(
        "invalid_input",
        "Reload this form before submitting.",
      );
    const recordVersions = spec.recordVersions
      ? z
          .record(z.string(), z.number().int().nonnegative())
          .parse(JSON.parse(String(data.get("recordVersions") ?? "null")))
      : undefined;
    await executeProductCommand(loaded, spec.id, parsed.input, {
      id: recordId,
      version,
      recordVersions,
      key: requestKey,
    });
    revalidatePath("/app", "layout");
    return {
      status: "success",
      message: "Saved. Your workspace now shows the recorded result.",
    };
  } catch (error) {
    return commandState(safeFailure(error), "Saved.");
  }
}
