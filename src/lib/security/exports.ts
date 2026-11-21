import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { SecurityError, safeError } from "./errors";
import {
  recordIdSchema,
  requireAgencyOwner,
  requireIdentity,
} from "./ownership";
import { consumeOperationLimit } from "./rate-limit";

export type ExportFormat = "markdown" | "csv";
export type PrivateSnapshot = {
  id: string;
  agencyId: string;
  markdown: string;
  csv: string;
};
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

export function privateDownloadResponse(
  body: string,
  format: ExportFormat,
): Response {
  if (format !== "markdown" && format !== "csv")
    throw new SecurityError("invalid_input");
  if (Buffer.byteLength(body, "utf8") > MAX_EXPORT_BYTES)
    throw new SecurityError("invalid_input");
  const csv = format === "csv";
  return new Response(body, {
    headers: {
      "Content-Type": csv
        ? "text/csv; charset=utf-8"
        : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="seedee-preparation.${csv ? "csv" : "md"}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
      Vary: "Cookie",
    },
  });
}

export function privateErrorResponse(error: unknown): Response {
  const result = safeError(error);
  const statuses = {
    unauthenticated: 401,
    forbidden_or_missing: 404,
    invalid_input: 400,
    conflict: 409,
    rate_limited: 429,
    provider_failed: 500,
  } as const;
  return Response.json(
    { ok: false, error: result },
    {
      status: statuses[result.code],
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        Vary: "Cookie",
        ...(result.retryAfterSeconds
          ? { "Retry-After": String(result.retryAfterSeconds) }
          : {}),
      },
    },
  );
}

// GET only reads an immutable snapshot created by an authenticated action.
// The only write here is security quota accounting, never snapshot generation.
// loadSnapshot is a trusted server repository adapter, not a client callback.
export async function downloadPrivateSnapshot(
  db: PrismaClient,
  context: { userId: string; clientIp: string | null },
  snapshotId: string,
  format: ExportFormat,
  loadSnapshot: (id: string) => Promise<PrivateSnapshot | null>,
  now = new Date(),
): Promise<Response> {
  try {
    requireIdentity(context.userId);
    if (!recordIdSchema.safeParse(snapshotId).success)
      throw new SecurityError("forbidden_or_missing");
    if (format !== "markdown" && format !== "csv")
      throw new SecurityError("invalid_input");
    const snapshot = await loadSnapshot(snapshotId);
    if (!snapshot || snapshot.id !== snapshotId)
      throw new SecurityError("forbidden_or_missing");
    await requireAgencyOwner(db, context.userId, snapshot.agencyId);
    await consumeOperationLimit(db, { ...context, operation: "export" }, now);
    return privateDownloadResponse(snapshot[format], format);
  } catch (error) {
    return privateErrorResponse(error);
  }
}
