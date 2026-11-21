import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const instant = z.iso.datetime({ offset: true });
export const taskStatusSchema = z.enum([
  "blocked",
  "queued",
  "in_progress",
  "awaiting_review",
  "done",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Task = {
  id: string;
  projectId: string | null;
  workflowId: string | null;
  title: string;
  input: string;
  roleKey: string | null;
  kind: "work" | "human_review" | "delivery_record" | "closeout";
  dependencies: string[];
  status: TaskStatus;
  version: number;
  attempt: number;
  dueAt: string | null;
  originalCommittedDueAt: string | null;
  artifactId: string | null;
  runId: string | null;
  history: {
    at: string;
    actor: string;
    from: TaskStatus;
    to: TaskStatus;
    reason: string;
    artifactId: string | null;
  }[];
  dueDateRevisions: {
    at: string;
    previous: string | null;
    next: string | null;
    reason: string;
  }[];
};
export type Workflow = {
  id: string;
  projectId: string;
  templateKey: string;
  templateVersion: string;
  taskIds: string[];
  createdAt: string;
};
export type Routine = {
  id: string;
  templateKey: "weekly_planning" | "monthly_evidence";
  templateVersion: "routines-v1";
  cadence: "weekly" | "monthly";
  timezone: string;
  nextDueAt: string;
  anchorAt: string;
  nextSlotIndex: number;
  enabled: boolean;
  ownerId: string;
};
export type Occurrence = {
  key: string;
  routineId: string;
  slot: string;
  taskId: string;
  skippedCount: number;
  createdAt: string;
};
export type Notification = {
  id: string;
  eventKey: string;
  kind:
    "awaiting_review" | "failed_run" | "overdue_task" | "milestone_completed";
  message: string;
  target: { type: "task" | "milestone"; id: string };
  createdAt: string;
  readAt: string | null;
};
export type Milestone = {
  key: string;
  title: string;
  target: string;
  completedAt: string | null;
  evidenceIds: string[];
  completion: "rule" | "manual_attestation" | null;
  attestation: string | null;
};
export type Recommendation = {
  key: string;
  title: string;
  reason: string;
  evidenceIds: string[];
  dismissedAt: string | null;
  resolvedAt: string | null;
  linkedTaskId: string | null;
};
export type AutomationState = {
  schemaVersion: 1;
  agencyId: string;
  version: number;
  tasks: Task[];
  workflows: Workflow[];
  routines: Routine[];
  occurrences: Occurrence[];
  notifications: Notification[];
  milestones: Milestone[];
  recommendations: Recommendation[];
  deliveries: {
    projectId: string;
    deliveryDate: string;
    note: string;
    recordedAt: string;
    recordedByUserId: string;
  }[];
  receipts: { key: string; fingerprint: string }[];
};
// Authoritative facts are loaded by the repository inside the same owned transaction,
// never accepted from a browser command. A closed project does not imply payment.
export type GrowthFacts = {
  period: { from: string; through: string };
  origin: "sample" | "user-entered";
  offers: { id: string; active: boolean }[];
  projects: {
    id: string;
    completedAt: string | null;
    economicClientGroupId: string | null;
  }[];
  closeouts: {
    id: string;
    projectId: string;
    recognizedRevenueMinor: number | null;
    receiptsMinor: number | null;
    deliveryCostMinor: number | null;
  }[];
  overdueTaskIds: string[];
  reviewedSopIds: string[];
  capacity: {
    evidenceId: string;
    availableHours: number | null;
    plannedHours: number | null;
    asOf: string;
  } | null;
  investorGaps: {
    key: string;
    title: string;
    reason: string;
    evidenceIds: string[];
  }[];
  investorEvidenceComplete: boolean | null;
  investorEvidenceIds: string[];
};
export type OwnedContext = {
  ownerId: string;
  agencyId: string;
  projectIds: string[];
  workflowProjectIds: string[];
  artifacts: {
    id: string;
    taskId: string;
    runId: string;
    status: "draft" | "approved" | "revision_requested";
    reviewedByUserId: string | null;
    reviewedAt: string | null;
    current: boolean;
  }[];
  recordedDeliveryProjectIds: string[];
  closeoutProjectIds: string[];
  growth: GrowthFacts;
};
const versionedTask = {
  taskId: id,
  expectedTaskVersion: z.number().int().nonnegative(),
};
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("record_delivery"),
    projectId: id,
    deliveryDate: instant,
    note: z.string().trim().min(1).max(1000),
  }),
  z.object({
    type: z.literal("instantiate_workflow"),
    projectId: id,
    templateKey: z.enum(["creative_delivery", "content_delivery"]),
    dueAt: instant.nullable(),
  }),
  z.object({
    type: z.literal("transition_task"),
    ...versionedTask,
    to: taskStatusSchema,
    artifactId: id.optional(),
    runId: id.optional(),
    reason: z.string().trim().min(1).max(500),
  }),
  z.object({
    type: z.literal("reschedule_task"),
    ...versionedTask,
    dueAt: instant.nullable(),
    reason: z.string().trim().min(1).max(500),
  }),
  z.object({
    type: z.literal("configure_routine"),
    routineId: id,
    templateKey: z.enum(["weekly_planning", "monthly_evidence"]),
    timezone: z.string().min(1).max(100),
    nextDueAt: instant,
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal("run_due_routines") }),
  z.object({ type: z.literal("refresh_growth") }),
  z.object({
    type: z.literal("mark_notifications_read"),
    notificationIds: z.array(id).max(500).optional(),
  }),
  z.object({ type: z.literal("recommendation_task"), recommendationKey: id }),
  z.object({
    type: z.literal("dismiss_recommendation"),
    recommendationKey: id,
  }),
  z.object({
    type: z.literal("attest_milestone"),
    milestoneKey: id,
    statement: z.string().trim().min(10).max(1000),
    evidenceIds: z.array(id).min(1).max(30),
  }),
]);
export const requestSchema = z.object({
  agencyId: id,
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: id,
  command: commandSchema,
});
export type AutomationCommand = z.infer<typeof commandSchema>;
export type AutomationRequest = z.infer<typeof requestSchema>;
export type AutomationErrorCode =
  | "unauthenticated"
  | "forbidden_or_missing"
  | "invalid_input"
  | "conflict"
  | "provider_failed";
export class AutomationError extends Error {
  constructor(
    public code: AutomationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export type GrowthMetrics = {
  basis: "completed_project_closeouts";
  note: string;
  period: GrowthFacts["period"];
  origin: GrowthFacts["origin"];
  completedProjects: number;
  repeatClients: number;
  recognizedRevenueMinor: number | null;
  collectionsMinor: number | null;
  deliveryMargin: { numeratorMinor: number; denominatorMinor: number } | null;
  closeoutCount: number;
  overdueTasks: number;
  reviewedSops: number;
  humanCapacity: GrowthFacts["capacity"];
};
export type WorkspaceView = {
  state: AutomationState;
  metrics: GrowthMetrics;
  templates: typeof import("./templates").workflowTemplates;
  routineTemplates: typeof import("./templates").routineTemplates;
};
export type AutomationResult =
  | { ok: true; replayed: boolean; workspace: WorkspaceView }
  | {
      ok: false;
      code: AutomationErrorCode;
      message: string;
      current?: WorkspaceView;
    };
