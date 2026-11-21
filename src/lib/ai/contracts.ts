import { z } from "zod";

export const ENGINE_VERSION = "agency-engine-v1.0";
export const TEMPLATE_VERSION = "creative-templates-v1.0";
export const PITCH_VERSION = "private-pitch-v1.0";
export const PRACTICES = [
  "musician",
  "visual_artist",
  "designer",
  "filmmaker",
  "writer",
  "photographer",
  "content_creator",
  "other",
] as const;
export const ROLE_KEYS = [
  "creative_lead",
  "research_strategy",
  "producer",
  "delivery_specialist",
  "quality_reviewer",
  "growth_analyst",
  "finance_evidence",
] as const;
export const text = (max = 2000) => z.string().trim().min(1).max(max);
export const idSchema = text(160);
const cents = z.number().int().min(0).max(1_000_000_000);
const strings = z.array(text(1000)).min(1).max(20);
export const agencyInputSchema = z.strictObject({
  practices: z
    .array(z.enum(PRACTICES))
    .min(1)
    .max(8)
    .transform((values) => [...new Set(values)].sort()),
  description: z.string().trim().max(2000).default(""),
  targetBuyer: text(300),
  goal: text(500),
  weeklyCapacityHours: z.number().positive().max(168),
  proposedName: z.string().trim().max(100).default(""),
  currency: z.literal("USD").default("USD"),
});
export const packageSchema = z.strictObject({
  key: idSchema,
  title: text(160),
  deliverables: strings,
  exclusions: strings,
  revisionLimit: z.number().int().min(0).max(20),
  turnaroundDays: z.number().int().min(1).max(365),
  laborHours: z.number().positive().max(2000),
  priceMinor: cents,
  currency: z.literal("USD"),
  pricingBasis: z.strictObject({
    kind: z.literal("illustrative_assumption"),
    laborRateMinor: cents,
    directCostMinor: cents,
    targetMarginBps: z.number().int().min(0).max(9999),
    note: text(1000),
  }),
});
export const roleSchema = z.strictObject({
  key: z.enum(ROLE_KEYS),
  title: text(100),
  responsibility: text(),
  input: strings,
  output: text(500),
  approvalBoundary: text(500),
  simulated: z.literal(true),
  approvalRequired: z.literal(true),
  templateVersion: z.literal(TEMPLATE_VERSION),
});
export const workflowSchema = z.strictObject({
  key: idSchema,
  title: text(160),
  version: z.literal(TEMPLATE_VERSION),
  steps: z
    .array(
      z.strictObject({
        key: idSchema,
        title: text(160),
        roleKey: z.enum(ROLE_KEYS),
        humanGate: z.boolean(),
        predecessor: idSchema.nullable(),
      }),
    )
    .min(2)
    .max(12),
});
export const generationMetaSchema = z.strictObject({
  provider: z.literal("demo"),
  mode: z.literal("demo"),
  providerVersion: z.literal(ENGINE_VERSION),
  templateVersion: z.literal(TEMPLATE_VERSION),
  requiresReview: z.literal(true),
  inputSummary: text(4000),
});
export const agencyDraftSchema = z
  .strictObject({
    name: text(100),
    positioning: text(1500),
    buyer: text(300),
    practices: z.array(z.enum(PRACTICES)).min(1).max(8),
    goal: text(500),
    weeklyCapacityHours: z.number().positive().max(168),
    currency: z.literal("USD"),
    packages: z.array(packageSchema).min(3).max(24),
    roles: z.array(roleSchema).length(7),
    workflows: z.array(workflowSchema).min(2).max(8),
    assumptions: strings,
    meta: generationMetaSchema,
  })
  .refine(
    (value) => new Set(value.roles.map((role) => role.key)).size === 7,
    "Every simulated role must be present exactly once",
  )
  .refine(
    (value) =>
      new Set(value.packages.map((item) => item.key)).size ===
      value.packages.length,
    "Package keys must be unique",
  )
  .refine(
    (value) =>
      new Set(value.workflows.map((item) => item.key)).size ===
      value.workflows.length,
    "Workflow keys must be unique",
  )
  .refine(
    (value) =>
      value.workflows.every(
        (flow) =>
          flow.steps.every(
            (step, index) =>
              step.predecessor ===
              (index === 0 ? null : flow.steps[index - 1].key),
          ) &&
          new Set(flow.steps.map((step) => step.key)).size ===
            flow.steps.length,
      ),
    "Workflow predecessors must form an ordered pipeline",
  );
export const taskInputSchema = z.strictObject({
  roleKey: z.enum(ROLE_KEYS),
  title: text(160),
  brief: text(4000),
  objective: text(1000),
  practices: z.array(z.enum(PRACTICES)).min(1).max(8),
  revisionNote: z.string().trim().max(2000).default(""),
});
export const artifactSchema = z.strictObject({
  kind: z.enum(["text", "checklist", "plan"]),
  title: text(200),
  sections: z
    .array(z.strictObject({ heading: text(160), body: text(8000) }))
    .min(1)
    .max(20),
  checklist: strings,
  meta: generationMetaSchema,
});
export const factSchema = z.strictObject({
  id: idSchema,
  section: z.enum([
    "problem",
    "offer",
    "traction",
    "retention",
    "economics",
    "market",
    "rights",
    "team",
    "milestones",
    "capital",
  ]),
  label: text(160),
  displayValue: text(1000).nullable(),
  origin: z.enum(["sample", "user_entered", "assumption"]),
  sourceRef: idSchema,
  sourceVersion: z.number().int().positive().optional(),
  asOf: z.iso.date(),
  formulaVersion: text(100),
  reviewStatus: z.enum(["unreviewed", "owner_attested", "externally_reviewed"]),
});
export const pitchInputSchema = z
  .strictObject({
    company: text(100),
    positioning: text(1500),
    buyer: text(300),
    facts: z.array(factSchema).max(100),
    riskNotes: z.array(text(1000)).max(30),
    fundingInterest: z.boolean(),
  })
  .refine(
    (value) =>
      new Set(value.facts.map((fact) => fact.id)).size === value.facts.length,
    "Duplicate fact IDs",
  )
  .refine(
    (value) =>
      !(
        value.facts.some((f) => f.origin === "sample") &&
        value.facts.some((f) => f.origin === "user_entered")
      ),
    "Sample and user actuals require separate snapshots",
  )
  .refine(
    (value) =>
      !value.facts.some(
        (fact) =>
          fact.origin === "assumption" &&
          ["traction", "retention"].includes(fact.section),
      ),
    "Assumptions cannot be historical traction or earned retention",
  );
export const pitchDraftSchema = z.strictObject({
  title: text(200),
  templateVersion: z.literal(PITCH_VERSION),
  disclosure: text(2000),
  sections: z
    .array(
      z.strictObject({
        key: idSchema,
        heading: text(200),
        body: text(16000),
        sourceIds: z.array(idSchema).max(100),
      }),
    )
    .length(12),
  unresolvedClaims: z.array(text(1000)).max(100),
  riskNotes: z.array(text(1000)).max(40),
  meta: generationMetaSchema,
});
export type AgencyInput = z.infer<typeof agencyInputSchema>;
export type AgencyDraft = z.infer<typeof agencyDraftSchema>;
export type CrewRole = z.infer<typeof roleSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type ArtifactContent = z.infer<typeof artifactSchema>;
export type PitchInput = z.infer<typeof pitchInputSchema>;
export type PitchDraft = z.infer<typeof pitchDraftSchema>;
export type EvidenceFact = z.infer<typeof factSchema>;
