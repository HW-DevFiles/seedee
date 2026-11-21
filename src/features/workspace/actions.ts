"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromForwardedFor } from "@/lib/auth/client-ip";
import { db } from "@/lib/db";
import { createWorkspaceService } from "./service";
import { createFinanceService } from "../finance/service";
import { DomainError } from "./contracts";
import { assertMutationOrigin, consumeExportLimit, attempt } from "./boundary";

async function context(mutation: boolean) {
  const user = await getCurrentUser();
  if (!user) throw new DomainError("unauthenticated", "Sign in to continue.");
  const h = await headers();
  if (mutation)
    assertMutationOrigin(
      h.get("origin"),
      h.get("host"),
      h.get("sec-fetch-site"),
    );
  return {
    userId: user.id,
    clientIp: clientIpFromForwardedFor(
      h.get("x-forwarded-for"),
      process.env.TRUST_PROXY_HOPS,
    ),
  };
}
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
    if (command.type === "export.create") await consumeExportLimit(db, c);
    const result = finance
      ? await createFinanceService(db, c.userId).command(command)
      : await createWorkspaceService(db, c.userId).command(command);
    revalidatePath("/app", "layout");
    return result;
  });
}
