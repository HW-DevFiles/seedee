import "server-only";
import { AutomationError, type AutomationResult } from "./contracts";
import type { createAutomationService } from "./service";

// UI route composition supplies Maximus's session/origin boundary. There is no
// fixture fallback and no command field can select its authenticated identity.
export type AutomationIdentity = { userId: string };
export function createAutomationBoundary(
  service: ReturnType<typeof createAutomationService>,
  authorize: (mutation: boolean) => Promise<AutomationIdentity>,
) {
  return {
    async readWorkspace(agencyId: string) {
      const context = await authorize(false);
      if (!context.userId)
        throw new AutomationError("unauthenticated", "Sign in to continue.");
      return service.readWorkspace(context.userId, agencyId);
    },
    async command(input: unknown): Promise<AutomationResult> {
      const context = await authorize(true);
      if (!context.userId)
        return {
          ok: false,
          code: "unauthenticated",
          message: "Sign in to continue.",
        };
      return service.command(context.userId, input);
    },
  };
}
