import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashToken } from "@/lib/auth/tokens";
import { requireIdentity } from "./ownership";
import { SecurityError } from "./errors";

export const OPERATION_WINDOW_MS = 15 * 60 * 1000;
export const OPERATION_LIMITS = {
  generation: { account: 20, ip: 100 },
  export: { account: 10, ip: 50 },
} as const;
export type LimitedOperation = keyof typeof OPERATION_LIMITS;

export async function consumeOperationLimit(
  db: PrismaClient,
  input: {
    userId: string;
    clientIp: string | null;
    operation: LimitedOperation;
  },
  now = new Date(),
) {
  requireIdentity(input.userId);
  if (input.operation !== "generation" && input.operation !== "export")
    throw new SecurityError("invalid_input");
  const limits = OPERATION_LIMITS[input.operation];
  if (!limits || !Number.isFinite(now.getTime()))
    throw new SecurityError("invalid_input");
  const key = (kind: string, value: string) =>
    `security:v1:${input.operation}:${kind}:${hashToken(value)}`;
  const buckets: { key: string; limit: number }[] = [
    { key: key("account", input.userId), limit: limits.account },
  ];
  if (input.clientIp)
    buckets.push({ key: key("ip", input.clientIp), limit: limits.ip });
  const wait = await db.$transaction(async (tx) => {
    let retryAfterSeconds = 0;
    // Cleanup only our expired rows; auth counters and reset semantics are separate.
    await tx.authThrottle.deleteMany({
      where: { key: { startsWith: "security:v1:" }, expiresAt: { lte: now } },
    });
    for (const bucket of buckets) {
      const row = await tx.authThrottle.findUnique({
        where: { key: bucket.key },
      });
      if (row && row.attempts >= bucket.limit) {
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.max(
            1,
            Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000),
          ),
        );
      } else {
        await tx.authThrottle.upsert({
          where: { key: bucket.key },
          create: {
            key: bucket.key,
            attempts: 1,
            expiresAt: new Date(now.getTime() + OPERATION_WINDOW_MS),
          },
          update: { attempts: { increment: 1 } },
        });
      }
    }
    return retryAfterSeconds;
  });
  // Throw after commit so rejected requests still consume other available buckets.
  if (wait) throw new SecurityError("rate_limited", wait);
}
