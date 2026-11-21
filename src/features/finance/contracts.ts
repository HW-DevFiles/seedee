import { z } from "zod";
import { cents, signedCents, dateTime, id, text, provenanceSchema, safeHttps, yearMonth, hours } from "../workspace/contracts";
import { nonnegativeDecimal as dec, positiveDecimal as pos, fraction } from "./decimal";
export const FINANCE_VERSION = "agency-finance-v1.1";
export const READINESS_VERSION = "readiness-v1.1";
export const EQUITY_VERSION = "dilution-education-v1.0";
export const DISCLAIMER = "Educational planning only. Not financial, investment, accounting, tax or legal advice. No funding or return guarantee. Consult qualified advisers before acting.";
export const HYPOTHETICAL = "Hypothetical planning scenario — not an offer of securities.";
export const SAMPLE_BANNER = "Demo preview · Sample data · Not actual business performance.";
export const attributed = z.object({id,period:yearMonth,amountMinor:signedCents,clientGroupId:id,serviceId:id,deliveryId:id,deliveryDate:dateTime,packageId:id.nullable(),sopVersion:id.nullable(),contractId:id.nullable(),provenance:provenanceSchema,creditReference:id.nullable().default(null)}).strict();
const check = z.object({value:z.boolean().nullable(),sourceIds:z.array(id).max(100),note:z.string().max(5000)}).strict();
export const readinessSchema = z.object({
  asOf:dateTime,currency:z.literal("USD"),
  months:z.array(z.object({period:yearMonth,revenueMinor:signedCents.nullable(),closed:z.boolean(),provenance:provenanceSchema})).max(6),
  recognition:z.array(attributed).max(10000).nullable(),
  packages:z.array(z.object({id,fixedScope:text,priceCostBasis:text,sopVersion:id,sopCreatedAt:dateTime,checklist:z.array(text).min(1)})).max(500),
  contracts:z.array(z.object({id,cadence:text,terms:text,serviceStart:dateTime,serviceEnd:dateTime})).max(500),
  deliveries:z.array(z.object({id,clientGroupId:id,serviceId:id,packageId:id.nullable(),sopVersion:id.nullable(),originalDueAt:dateTime,completedAt:dateTime.nullable(),cancelledAt:dateTime.nullable(),cancellationReason:z.string().max(2000).nullable()})).max(10000).nullable(),
  humans:z.array(z.object({id,isFounder:z.boolean(),simulated:z.boolean(),compensationMinor:cents,agreementStart:dateTime,agreementEnd:dateTime.nullable(),role:text,sourceIds:z.array(id).min(1)})).max(200).nullable(),
  accountableOwner:check, backups:z.array(z.object({serviceId:id,humanId:id,acceptedAt:dateTime,sourceId:id})).max(500).nullable(),
  capacity:z.array(z.object({id,period:yearMonth,availableHours:hours.nullable(),plannedHours:hours.nullable(),attestedAt:dateTime,sourceId:id})).max(500).nullable(),
  deliveryHours:z.array(z.object({humanId:id,date:dateTime,hours,sourceId:id})).max(10000).nullable(),
  ip:z.object({chainOfTitle:check,assetRegister:check,brandPermissions:check,caseStudies:check}),
  market:z.object({
    segment:z.string().max(500).nullable(),buyer:z.string().max(500).nullable(),geography:z.string().max(500).nullable(),problem:z.string().max(2000).nullable(),
    interviews:z.array(z.object({organization:id,date:dateTime,problem:text,budget:text,alternatives:text,sourceId:id})).max(500).nullable(),
    alternatives:z.array(z.object({id,priceMinor:cents,sourceUrl:safeHttps,checkedAt:dateTime})).max(500).nullable(),
    model:z.object({buyers:dec,annualSpend:dec,reachableProspects:dec,winRate:fraction,downsideWinRate:fraction,annualRevenuePerClient:dec,capacityCeiling:dec,geography:text,scope:text,period:yearMonth,sourceIds:z.array(id).min(1),assumptionLabels:z.array(text).min(1)}).nullable(),
    modelAssessed:z.boolean(),
  }),
  riskFlags:z.array(id).max(100).default([]), provenance:provenanceSchema,
}).strict();
export type ReadinessInput = z.infer<typeof readinessSchema>;
export const forecastSchema = z.object({
  asOf:dateTime,currency:z.literal("USD"),horizon:z.union([z.literal(12),z.literal(24)]),
  services:z.array(z.object({id,title:text,demandUnits:dec,unitPrice:dec,unitDirectCost:dec,hoursPerPool:z.record(id,dec)})).min(1).max(100),
  pools:z.array(z.object({id,availableHours:pos,hireAdditionalHours:dec})).min(1).max(100),
  volumeMultiplier:dec,growth:z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/).max(40),collectionFraction:fraction,
  openingCash:dec,openingReceivables:dec,openingPayables:dec,openingDeferredRevenue:dec,openingDebt:dec,
  overhead:dec,overheadGrowth:dec,founderCompensation:dec,founderDeliveryPayFraction:fraction.nullable(),founderDeliveryHours:dec.nullable(),
  founderReplacementHourlyRate:dec.nullable(),founderReplacementHours:dec.nullable(),retainedFounderNonDeliveryPay:dec.nullable(),
  fixedFounderPremium:dec,hireMonth:z.number().int().min(1).max(24).nullable(),hireMonthlyCost:dec,capexMonth1:dec,
  taxRate:fraction.nullable(),reserve:dec,contingency:fraction,financingCosts:dec,
  financing:z.array(dec).max(24).default([]),taxSchedule:z.array(dec).max(24).nullable().default(null),
  provenance:provenanceSchema,
}).strict();
export type ForecastInput = z.infer<typeof forecastSchema>;
export const equitySchema = z.object({
  preMoney:pos,newCash:pos,totalPreShares:pos,
  holders:z.array(z.object({id,shares:dec,unallocatedPool:z.boolean()})).min(1).max(100),
  safes:z.array(z.object({id,amount:pos,cap:pos,funded:z.boolean(),terms:z.literal("post_money_cap_only")})).max(100),
  finalPoolTarget:fraction.nullable(),hypothetical:z.literal(true),unsupportedTerms:z.array(text).max(50).default([]),
}).strict();
export type EquityInput = z.infer<typeof equitySchema>;
