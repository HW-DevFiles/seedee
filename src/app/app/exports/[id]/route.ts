import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityContext } from "@/lib/security/request";
import {
  downloadPrivateSnapshot,
  privateErrorResponse,
} from "@/lib/security/exports";
import { SecurityError } from "@/lib/security/errors";
import { createFinanceService } from "@/features/finance/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requireSecurityContext();
    const format = request.nextUrl.searchParams.get("format") ?? "markdown";
    if (format !== "markdown" && format !== "csv")
      throw new SecurityError("invalid_input");
    const { id } = await params;
    return downloadPrivateSnapshot(
      db,
      context,
      id,
      format,
      async (snapshotId) => {
        const row = await db.exportSnapshot.findFirst({
          where: { id: snapshotId, agency: { ownerId: context.userId } },
        });
        if (!row) return null;
        const content = await createFinanceService(db, context.userId).download(
          snapshotId,
        );
        return {
          id: row.id,
          agencyId: row.agencyId,
          markdown: content.markdown,
          csv: content.csv,
        };
      },
    );
  } catch (error) {
    return privateErrorResponse(error);
  }
}
