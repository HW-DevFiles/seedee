import { z } from "zod";

export const errorCodes = ["unauthenticated", "forbidden_or_missing", "invalid_input", "conflict", "rate_limited", "provider_failed"] as const;
export type ErrorCode = typeof errorCodes[number];
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; fields?: Record<string, string[]>; current?: unknown } };
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public current?: unknown) { super(message); }
}
export const id = z.string().trim().min(1).max(200);
export const text = z.string().trim().min(1).max(5000);
export const note = z.string().trim().max(10000).default("");
// SQLite Int is signed 32-bit. Bound cents before persistence, never truncate.
export const cents = z.number().int().min(0).max(2_000_000_000);
export const signedCents = z.number().int().min(-2_000_000_000).max(2_000_000_000);
export const hours = z.number().finite().min(0).max(100000);
export const version = z.number().int().min(1);
export const dateTime = z.iso.datetime({ offset: true });
export const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const practice = z.enum(["musician", "visual_artist", "designer", "filmmaker", "writer", "photographer", "content_creator", "other"]);
export const safeHttps = z.string().max(2000).refine(value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } }, "Use a valid HTTPS reference without credentials.");
export const provenanceSchema = z.object({
  origin: z.enum(["sample", "user_entered", "assumption"]), asOf: dateTime,
  sourceReference: text, reviewStatus: z.enum(["unreviewed", "owner_attested", "externally_reviewed"]),
  reviewer: z.string().trim().max(200).nullable().default(null), reviewedAt: dateTime.nullable().default(null),
  reviewReference: z.string().trim().max(2000).nullable().default(null),
}).strict().superRefine((p, ctx) => {
  if (p.reviewStatus === "externally_reviewed" && (!p.reviewer || !p.reviewedAt || !p.reviewReference)) ctx.addIssue({ code: "custom", message: "External review requires reviewer, date and reference." });
});
export type Provenance = z.infer<typeof provenanceSchema>;
export const onboardingSchema = z.object({
  practices: z.array(practice).min(1).max(8).refine(x => new Set(x).size === x.length),
  description: note, targetBuyer: text, goal: text, weeklyCapacityHours: z.number().finite().gt(0).max(168),
  biography: note, existingOffers: note, skills: note, revenueStage: z.enum(["unknown", "pre_revenue", "earning", "established"]).default("unknown"),
  fundingInterest: z.enum(["undecided", "customer_funded", "exploring_seed"]).default("undecided"),
  proposedName: z.string().trim().max(120).default(""), currency: z.literal("USD").default("USD"),
  timezone: z.string().max(100).default("UTC").refine(v => { try { new Intl.DateTimeFormat("en", {timeZone:v}); return true; } catch { return false; } }),
}).strict();
export const pricingBasisSchema = z.object({ kind: z.literal("illustrative_assumption"), laborRateMinor: cents, directCostMinor: cents, targetMarginBps: z.number().int().min(0).max(9999), note: text }).strict();
export const packageSchema = z.object({
  title: z.string().trim().min(1).max(200), deliverables: z.array(text).min(1).max(50), exclusions: z.array(text).max(50),
  revisionLimit: z.number().int().min(0).max(100), turnaroundDays: z.number().int().min(1).max(730), laborHours: hours,
  priceMinor: cents, currency: z.literal("USD").default("USD"), freeSample: z.boolean().default(false), pricingBasis: pricingBasisSchema,
  sopVersion: z.string().trim().min(1).max(100).nullable().default(null), sopCreatedAt: dateTime.nullable().default(null),
  acceptanceChecklist: z.array(text).max(50).default([]), draft: z.boolean().default(false),
}).strict().superRefine((p, ctx) => { if (!p.priceMinor && !p.freeSample) ctx.addIssue({code:"custom",path:["priceMinor"],message:"Explicitly mark zero-price work free/sample."}); });
export const clientSchema = z.object({name:z.string().trim().min(1).max(200),organization:z.string().trim().max(300).default(""),contactEmail:z.email().max(254).nullable().default(null),note, economicGroupId:id}).strict();
export const projectSchema = z.object({title:z.string().trim().min(1).max(200),brief:note,clientId:id.nullable().default(null),packageId:id.nullable().default(null),dueAt:dateTime.nullable().default(null),budgetMinor:cents.nullable().default(null)}).strict();
export const taskSchema = z.object({title:z.string().trim().min(1).max(200),input:note,projectId:id.nullable().default(null),assignedRoleKey:id.nullable().default(null),dueAt:dateTime.nullable().default(null),priority:z.enum(["low","normal","high","urgent"]).default("normal"),reviewNeeded:z.boolean().default(true),predecessorIds:z.array(id).max(100).default([])}).strict();
export const closeoutSchema = z.object({deliveryDate:dateTime,recognizedRevenueMinor:cents.nullable(),receiptsMinor:cents.nullable(),deliveryCostMinor:cents.nullable(),founderLaborHours:hours.nullable(),founderCostTreatment:text,repeatabilityNotes:note,recurrenceType:z.enum(["one_off","repeat_purchase","contracted_retainer"]),provenance:provenanceSchema}).strict();
export const actualSchema = z.object({
  yearMonth,currency:z.literal("USD"),sourceMode:z.enum(["manual","derived"]),
  recognizedRevenueMinor:signedCents.nullable(),cashReceiptsMinor:cents.nullable(),deliveryCostsMinor:cents.nullable(),overheadMinor:cents.nullable(),
  founderPayMinor:cents.nullable(),cashTaxPaymentsMinor:cents.nullable(),cashInterestPaymentsMinor:cents.nullable(),cashMinor:signedCents.nullable(),receivablesMinor:cents.nullable(),
  capexMinor:cents.nullable(),principalPaymentsMinor:cents.nullable(),financingMinor:cents.nullable(),ownerContributionsMinor:cents.nullable(),ownerDistributionsMinor:cents.nullable(),
  provenance:provenanceSchema,
}).strict();
export const evidenceSchema = z.object({category:id,metricKey:id,value:z.json(),provenance:provenanceSchema,sourceUrl:safeHttps.nullable().default(null),sourceRecordId:id.nullable().default(null)}).strict();
export const checklistCategories = ["company","ownership","financials","customers","product_operations","ip_brand","market","risk_security","fundraising_preparation"] as const;
export const checklistSchema = z.object({category:z.enum(checklistCategories),title:text,state:z.enum(["missing","draft","owner_attested","externally_reviewed","not_applicable_with_reason"]),note,sourceUrl:safeHttps.nullable().default(null),evidenceIds:z.array(id).max(100),period:yearMonth.nullable().default(null),reviewedAt:dateTime.nullable().default(null),ownerLabel:text}).strict().superRefine((v,c) => {
  if(v.state === "not_applicable_with_reason" && !v.note) c.addIssue({code:"custom",path:["note"],message:"A reason is required."});
  if(["owner_attested","externally_reviewed"].includes(v.state) && (!v.evidenceIds.length || !v.reviewedAt)) c.addIssue({code:"custom",message:"Reviewed items need evidence and review date."});
});
export type OnboardingInput = z.input<typeof onboardingSchema>;


const edit = z.object({ id, expectedVersion: version });
const archive = edit.extend({ archived: z.boolean() }).strict();
export const agencyContentSchema = z.object({
  name:z.string().trim().min(1).max(120),positioning:text,buyer:text,practices:z.array(practice).min(1).max(8),goal:text,weeklyCapacityHours:z.number().finite().gt(0).max(168),currency:z.literal("USD"),
  packages:z.array(packageSchema.safeExtend({key:id})).min(3).max(50),
  roles:z.array(z.object({key:id,title:text,responsibility:text,input:z.array(text).max(50),output:text,approvalBoundary:text,simulated:z.literal(true),approvalRequired:z.literal(true),templateVersion:id}).strict()).min(7).max(50),
  workflows:z.array(z.object({key:id,title:text,version:id,steps:z.array(z.object({key:id,title:text,roleKey:id,humanGate:z.boolean(),predecessor:id.nullable()}).strict()).min(1).max(50)}).strict()).min(2).max(20),
  assumptions:z.array(text).max(100),meta:z.object({provider:z.literal("demo").optional(),mode:z.literal("demo").optional(),providerVersion:id.optional(),templateVersion:id.optional(),schemaVersion:id.optional(),inputSummary:text,requiresReview:z.literal(true)}).passthrough(),
}).strict();
export const commandSchemas = {
  "onboarding.save": z.object({data:onboardingSchema,expectedVersion:version.nullable()}),
  "draft.save": z.object({content:agencyContentSchema,onboardingVersion:version,providerVersion:id,templateVersion:id,inputHash:id}),
  "draft.edit":edit.extend({content:agencyContentSchema}),
  "agency.accept":z.object({draftId:id,expectedVersion:version,idempotencyKey:id}),
  "agency.update":edit.extend({name:z.string().trim().min(1).max(120),positioning:text,buyer:text,goal:text}),
  "package.create":packageSchema,
  "package.update":edit.extend({data:packageSchema}),
  "package.archive":archive,
  "package.delete":edit,
  "client.create":clientSchema,
  "client.update":edit.extend({data:clientSchema}),
  "client.archive":archive,
  "project.create":projectSchema,
  "project.update":edit.extend({data:projectSchema}),
  "project.archive":archive,
  "project.transition":edit.extend({status:z.enum(["planned","active","review","completed"])}),
  "task.create":taskSchema,
  "task.update":edit.extend({data:taskSchema}),
  "task.transition":edit.extend({status:z.enum(["in_progress","awaiting_review","done","failed","cancelled","queued"]),note}),
  "closeout.save":z.object({projectId:id,expectedVersion:version.nullable(),data:closeoutSchema}),
  "actual.save":z.object({expectedVersion:version.nullable(),data:actualSchema}),
  "evidence.save":z.object({id:id.nullable(),expectedVersion:version.nullable(),data:evidenceSchema}),
  "checklist.save":z.object({id:id.nullable(),expectedVersion:version.nullable(),data:checklistSchema}),
  "workspace.reset":z.object({confirmation:z.literal("RESET MY SAMPLE WORKSPACE")}),
} as const;
export type WorkspaceCommand = { [K in keyof typeof commandSchemas]: {type:K; input:z.input<typeof commandSchemas[K]>} }[keyof typeof commandSchemas];
