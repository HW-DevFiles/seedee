export type {
  AutomationCommand,
  AutomationRequest,
  AutomationResult,
  AutomationState,
  OwnedContext,
  GrowthFacts,
  GrowthMetrics,
  WorkspaceView,
  Task,
} from "./contracts";
export { AutomationError, commandSchema, requestSchema } from "./contracts";
export {
  workflowTemplates,
  routineTemplates,
  milestoneDefinitions,
} from "./templates";
export { queueEligibility, dependenciesSatisfied, emptyState } from "./engine";
export { createAutomationService } from "./service";
export { createPrismaAutomationRepository } from "./prisma-repository";
export type { AutomationBridge } from "./prisma-repository";
export { createPrismaAutomationTransaction } from "./prisma-repository";
export { recordRunEvent } from "./run-bridge";
export { createAutomationBoundary } from "./boundary";
export { createCoreAutomationBridge, isAutomationTask } from "./core-bridge";
export type { AutomationEvidenceLoader } from "./core-bridge";
export { notificationHref } from "./notifications";
export type { RunEvent } from "./run-bridge";
