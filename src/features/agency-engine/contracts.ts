import { z } from "zod";
import {
  agencyInputSchema,
  agencyDraftSchema,
  artifactSchema,
  pitchInputSchema,
  pitchDraftSchema,
  taskInputSchema,
  idSchema,
  text,
  type EvidenceFact,
} from "@/lib/ai/contracts";

export const errorCodes = [
  "unauthenticated",
  "forbidden_or_missing",
  "invalid_input",
  "conflict",
  "rate_limited",
  "provider_failed",
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export class EngineError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public current?: unknown,
  ) {
    super(message);
  }
}
export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; current?: unknown };
    };
const stamp = z.iso.datetime();
export const draftRecordSchema = z.strictObject({
  id: idSchema,
  idempotencyKey: idSchema,
  inputHash: text(100),
  input: agencyInputSchema,
  version: z.number().int().positive(),
  previousDraftId: idSchema.nullable(),
  status: z.enum(["generating", "generated", "failed"]),
  content: agencyDraftSchema.nullable(),
  errorCode: z.literal("provider_failed").nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});
export const runStepSchema = z.strictObject({
  key: idSchema,
  kind: z.enum(["validate_input", "generate_draft", "human_review"]),
  status: z.enum(["pending", "completed", "failed", "cancelled"]),
  attempt: z.number().int().positive(),
  completedAt: stamp.nullable(),
  errorCode: z.literal("provider_failed").nullable(),
});
export const runSchema = z.strictObject({
  id: idSchema,
  agencyId: idSchema,
  taskId: idSchema,
  projectId: idSchema.nullable(),
  idempotencyKey: idSchema,
  inputHash: text(100),
  input: taskInputSchema,
  taskVersion: z.number().int().min(0),
  status: z.enum([
    "queued",
    "running",
    "awaiting_review",
    "completed",
    "failed",
    "cancelled",
  ]),
  version: z.number().int().positive(),
  attempt: z.number().int().positive(),
  steps: z.array(runStepSchema).max(300),
  previousRunId: idSchema.nullable(),
  previousArtifactId: idSchema.nullable(),
  artifactId: idSchema.nullable(),
  errorCode: z.literal("provider_failed").nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});
export const artifactRecordSchema = z.strictObject({
  id: idSchema,
  agencyId: idSchema,
  taskId: idSchema,
  runId: idSchema,
  revision: z.number().int().positive(),
  previousRevisionId: idSchema.nullable(),
  status: z.enum(["draft", "approved", "revision_requested", "cancelled"]),
  content: artifactSchema,
  reviewedByUserId: idSchema.nullable(),
  reviewedAt: stamp.nullable(),
  createdAt: stamp,
});
export const pitchRecordSchema = z.strictObject({
  id: idSchema,
  agencyId: idSchema,
  idempotencyKey: idSchema,
  inputHash: text(100),
  version: z.number().int().positive(),
  previousPitchId: idSchema.nullable(),
  input: pitchInputSchema,
  content: pitchDraftSchema.nullable(),
  status: z.enum(["generating", "generated", "failed"]),
  errorCode: z.literal("provider_failed").nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});
export const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  drafts: z.array(draftRecordSchema),
  runs: z.array(runSchema),
  artifacts: z.array(artifactRecordSchema),
  pitches: z.array(pitchRecordSchema),
  receipts: z.array(
    z.strictObject({ key: idSchema, hash: text(100), subjectId: idSchema }),
  ),
});
export const emptyState = (): EngineState => ({
  schemaVersion: 1,
  drafts: [],
  runs: [],
  artifacts: [],
  pitches: [],
  receipts: [],
});
export type EngineState = z.infer<typeof stateSchema>;
export type DraftRecord = z.infer<typeof draftRecordSchema>;
export type CrewRun = z.infer<typeof runSchema>;
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;
export type PitchRecord = z.infer<typeof pitchRecordSchema>;
export type Scope = { userId: string; agencyId?: string };
export type TaskGate = {
  taskId: string;
  projectId: string | null;
  version: number;
  status: string;
  dependenciesDone: boolean;
};
export type ApprovedArtifact = Pick<
  ArtifactRecord,
  | "id"
  | "agencyId"
  | "taskId"
  | "runId"
  | "status"
  | "reviewedByUserId"
  | "reviewedAt"
>;
export interface EngineTransaction {
  state: EngineState;
  /** Loads and authorizes task/project/dependencies inside this transaction. */
  task(taskId: string, projectId: string | null): Promise<TaskGate>;
  /** Same transaction as the approval: updates the core task and automation mirror. */
  approved(artifact: ApprovedArtifact): Promise<void>;
  /** Re-resolves every submitted fact from owned, versioned evidence. Rejects forged values. */
  facts(facts: EvidenceFact[]): Promise<void>;
}
export interface EngineRepository {
  read(scope: Scope): Promise<EngineState>;
  transact<T>(
    scope: Scope,
    work: (tx: EngineTransaction) => Promise<T> | T,
  ): Promise<T>;
}
const fields = z.enum([
  "name",
  "positioning",
  "buyer",
  "packages",
  "roles",
  "workflows",
  "assumptions",
]);
export const generateCommandSchema = z
  .strictObject({
    idempotencyKey: idSchema,
    input: agencyInputSchema,
    previousDraftId: idSchema.optional(),
    regenerateFields: z.array(fields).min(1).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.previousDraftId) === Boolean(value.regenerateFields),
    "Select fields explicitly when regenerating an existing draft",
  );
export const queueCommandSchema = z.strictObject({
  agencyId: idSchema,
  taskId: idSchema,
  projectId: idSchema.nullable(),
  expectedTaskVersion: z.number().int().min(0),
  idempotencyKey: idSchema,
  input: taskInputSchema,
});
export const runCommandSchema = z.strictObject({
  agencyId: idSchema,
  runId: idSchema,
  idempotencyKey: idSchema,
  expectedVersion: z.number().int().positive(),
});
export const revisionCommandSchema = runCommandSchema.extend({
  note: text(2000),
});
