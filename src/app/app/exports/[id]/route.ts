import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { clientIpFromForwardedFor } from "@/lib/auth/client-ip";
import { db } from "@/lib/db";
import { DomainError } from "@/features/workspace/contracts";
import { consumeExportLimit, safeFailure } from "@/features/workspace/boundary";
import { createFinanceService } from "@/features/finance/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
};
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new DomainError("unauthenticated", "Sign in to continue.");
    const format = request.nextUrl.searchParams.get("format") ?? "markdown";
    if (!["markdown", "csv"].includes(format))
      throw new DomainError("invalid_input", "Choose markdown or csv.");
    await consumeExportLimit(db, {
      userId: user.id,
      clientIp: clientIpFromForwardedFor(
        request.headers.get("x-forwarded-for"),
        process.env.TRUST_PROXY_HOPS,
      ),
    });
    const { id } = await params,
      snapshot = await createFinanceService(db, user.id).download(id);
    return new Response(format === "csv" ? snapshot.csv : snapshot.markdown, {
      headers: {
        ...privateHeaders,
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="seedee-preparation.${format === "csv" ? "csv" : "md"}"`,
      },
    });
  } catch (e) {
    const failure = safeFailure(e);
    const code = !failure.ok ? failure.error.code : "provider_failed";
    return Response.json(failure, {
      status:
        code === "unauthenticated"
          ? 401
          : code === "forbidden_or_missing"
            ? 404
            : code === "rate_limited"
              ? 429
              : code === "invalid_input"
                ? 400
                : 500,
      headers: privateHeaders,
    });
  }
}
