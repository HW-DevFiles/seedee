import "server-only";
import { db } from "@/lib/db";
import { requireSecurityContext } from "@/lib/security/request";
import { createWorkspaceService } from "../workspace/service";
import { createIntegratedServices } from "./services";
// `now` is the request's read time; views derive date-validity labels from it.
export async function readIntegratedWorkspace(now = new Date()) {
  const context = await requireSecurityContext();
  const user = await db.user.findUniqueOrThrow({
    where: { id: context.userId },
    select: { name: true },
  });
  const services = createIntegratedServices(db);
  const workspace = await createWorkspaceService(
    db,
    context.userId,
  ).readWorkspace();
  const engine = await services.engine.readWorkspace(
    context.userId,
    workspace.agency?.id,
  );
  const automation = workspace.agency
    ? await services.automation.readWorkspace(
        context.userId,
        workspace.agency.id,
      )
    : null;
  return {
    context,
    userName: user.name,
    workspace,
    engine,
    automation,
    readAt: now.toISOString(),
  };
}
export type IntegratedRead = Awaited<
  ReturnType<typeof readIntegratedWorkspace>
>;
