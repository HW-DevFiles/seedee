import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { SecurityError } from "./errors";

export const recordIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export function requireIdentity(userId: string | null | undefined): string {
  if (!userId) throw new SecurityError("unauthenticated");
  if (!recordIdSchema.safeParse(userId).success)
    throw new SecurityError("unauthenticated");
  return userId;
}

export async function requireAgencyOwner(
  db: Pick<PrismaClient, "agency">,
  userId: string | null | undefined,
  agencyId: string,
) {
  const ownerId = requireIdentity(userId);
  if (!recordIdSchema.safeParse(agencyId).success)
    throw new SecurityError("forbidden_or_missing");
  const agency = await db.agency.findFirst({
    where: { id: agencyId, ownerId },
    select: { id: true, ownerId: true },
  });
  if (!agency) throw new SecurityError("forbidden_or_missing");
  return agency;
}

// Pass a database-loaded record, never a client-submitted object. Load and check
// every nested reference using the SAME transaction that performs the mutation.
export function assertAgencyReference<T extends { agencyId: string }>(
  record: T | null | undefined,
  agencyId: string,
): T {
  if (!record || record.agencyId !== agencyId)
    throw new SecurityError("forbidden_or_missing");
  return record;
}

export function assertOwnerReference<T extends { userId: string }>(
  record: T | null | undefined,
  userId: string | null | undefined,
): T {
  const ownerId = requireIdentity(userId);
  if (!record || record.userId !== ownerId)
    throw new SecurityError("forbidden_or_missing");
  return record;
}
