import { z } from "zod";
import { type AutomationState, taskStatusSchema } from "./contracts";
const text = z.string();
const instant = z.iso.datetime({ offset: true });
const nullableInstant = instant.nullable();
const counter = z.number().int().nonnegative();
export const automationStateSchema: z.ZodType<AutomationState> = z.object({
  schemaVersion: z.literal(1),
  agencyId: text.min(1),
  version: counter,
  tasks: z.array(
    z.object({
      id: text,
      projectId: text.nullable(),
      workflowId: text.nullable(),
      title: text,
      input: text,
      roleKey: text.nullable(),
      kind: z.enum(["work", "human_review", "delivery_record", "closeout"]),
      dependencies: z.array(text),
      status: taskStatusSchema,
      version: counter,
      attempt: z.number().int().positive(),
      dueAt: nullableInstant,
      originalCommittedDueAt: nullableInstant,
      artifactId: text.nullable(),
      runId: text.nullable(),
      history: z.array(
        z.object({
          at: instant,
          actor: text,
          from: taskStatusSchema,
          to: taskStatusSchema,
          reason: text,
          artifactId: text.nullable(),
        }),
      ),
      dueDateRevisions: z.array(
        z.object({
          at: instant,
          previous: nullableInstant,
          next: nullableInstant,
          reason: text,
        }),
      ),
    }),
  ),
  workflows: z.array(
    z.object({
      id: text,
      projectId: text,
      templateKey: text,
      templateVersion: text,
      taskIds: z.array(text),
      createdAt: instant,
    }),
  ),
  routines: z.array(
    z.object({
      id: text,
      templateKey: z.enum(["weekly_planning", "monthly_evidence"]),
      templateVersion: z.literal("routines-v1"),
      cadence: z.enum(["weekly", "monthly"]),
      timezone: text,
      nextDueAt: instant,
      anchorAt: instant,
      nextSlotIndex: counter,
      enabled: z.boolean(),
      ownerId: text,
    }),
  ),
  occurrences: z.array(
    z.object({
      key: text,
      routineId: text,
      slot: instant,
      taskId: text,
      skippedCount: counter,
      createdAt: instant,
    }),
  ),
  notifications: z.array(
    z.object({
      id: text,
      eventKey: text,
      kind: z.enum([
        "awaiting_review",
        "failed_run",
        "overdue_task",
        "milestone_completed",
      ]),
      message: text,
      target: z.object({ type: z.enum(["task", "milestone"]), id: text }),
      createdAt: instant,
      readAt: nullableInstant,
    }),
  ),
  milestones: z.array(
    z.object({
      key: text,
      title: text,
      target: text,
      completedAt: nullableInstant,
      evidenceIds: z.array(text),
      completion: z.enum(["rule", "manual_attestation"]).nullable(),
      attestation: text.nullable(),
    }),
  ),
  recommendations: z.array(
    z.object({
      key: text,
      title: text,
      reason: text,
      evidenceIds: z.array(text),
      dismissedAt: nullableInstant,
      resolvedAt: nullableInstant,
      linkedTaskId: text.nullable(),
    }),
  ),
  deliveries: z.array(
    z.object({
      projectId: text,
      deliveryDate: instant,
      note: text,
      recordedAt: instant,
      recordedByUserId: text,
    }),
  ),
  receipts: z.array(z.object({ key: text, fingerprint: text })),
});
