"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { createWorkspaceService } from "./service";
import { createFinanceService } from "../finance/service";
import { DomainError } from "./contracts";
import { attempt } from "./boundary";
import { requireSecurityContext } from "@/lib/security/request";
import { consumeOperationLimit } from "@/lib/security/rate-limit";

const context = requireSecurityContext;
export async function readWorkspace() {
  return attempt(async () => {
    const c = await context(false);
    return createWorkspaceService(db, c.userId).readWorkspace();
  });
}
export async function workspaceCommand(raw: unknown) {
  return attempt(async () => {
    const c = await context(true),
      command = z
        .object({ type: z.string().max(100), input: z.unknown() })
        .strict()
        .parse(raw);
    if (JSON.stringify(raw).length > 1_000_000)
      throw new DomainError("invalid_input", "This request is too large.");
    const finance =
      command.type.startsWith("finance.") || command.type === "export.create";
    if (command.type === "export.create")
      await consumeOperationLimit(db, { ...c, operation: "export" });
    const result = finance
      ? await createFinanceService(db, c.userId).command(command)
      : await createWorkspaceService(db, c.userId).command(command);
    revalidatePath("/app", "layout");
    return result;
  });
}
