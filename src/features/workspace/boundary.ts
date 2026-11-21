import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashToken } from "@/lib/auth/tokens";
import { DomainError, type Result } from "./contracts";
export type BoundaryContext = { userId: string; clientIp: string | null };
export function assertMutationOrigin(
  origin: string | null,
  host: string | null,
  site: string | null,
) {
  if (!origin || origin === "null" || !host || site === "cross-site")
    throw new DomainError(
      "forbidden_or_missing",
      "This request origin is not allowed.",
    );
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new DomainError(
      "forbidden_or_missing",
      "This request origin is not allowed.",
    );
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.host !== host ||
    parsed.origin !== origin
  )
    throw new DomainError(
      "forbidden_or_missing",
      "This request origin is not allowed.",
    );
}
// This standalone package uses the existing persistent throttle until the shared
// security package is merged. Keys match its account/IP export namespaces only
// through the final integration adapter; auth success never clears these rows.
export async function consumeExportLimit(
  db: PrismaClient,
  context: BoundaryContext,
  now = new Date(),
) {
  const keys = [
    { key: hashToken(`workspace:export:user:${context.userId}`), limit: 10 },
    ...(context.clientIp
      ? [
          {
            key: hashToken(`workspace:export:ip:${context.clientIp}`),
            limit: 50,
          },
        ]
      : []),
  ];
  const attempts = await db.$transaction(async (tx) => {
    const result = [];
    for (const { key, limit } of keys) {
      await tx.authThrottle.deleteMany({
        where: { key, expiresAt: { lte: now } },
      });
      const row = await tx.authThrottle.upsert({
        where: { key },
        create: { key, expiresAt: new Date(now.getTime() + 900000) },
        update: { attempts: { increment: 1 } },
      });
      result.push({ attempts: row.attempts, limit });
    }
    return result;
  });
  if (attempts.some((x) => x.attempts > x.limit))
    throw new DomainError(
      "rate_limited",
      "Too many export requests. Try again in 15 minutes.",
    );
}
export function safeFailure(error: unknown): Result<never> {
  if (error instanceof DomainError)
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.current ? { current: error.current } : {}),
      },
    };
  if (error instanceof z.ZodError)
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: "Check the highlighted fields.",
        fields: z.flattenError(error).fieldErrors as Record<string, string[]>,
      },
    };
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["P2002", "P2025", "P2034", "SQLITE_BUSY"].includes(String(error.code))
  )
    return {
      ok: false,
      error: {
        code: "conflict",
        message: "This record changed. Reload and retry.",
      },
    };
  return {
    ok: false,
    error: {
      code: "provider_failed",
      message: "Unable to complete this request. Please retry.",
    },
  };
}
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export function toWire<T>(data: T): Wire<T> {
  return JSON.parse(JSON.stringify(data)) as Wire<T>;
}
export async function attempt<T>(
  fn: () => Promise<T>,
): Promise<Result<Wire<T>>> {
  try {
    return { ok: true, data: toWire(await fn()) };
  } catch (e) {
    return safeFailure(e);
  }
}
