import {
  agencyInputSchema,
  pitchInputSchema,
  taskInputSchema,
} from "@/lib/ai/contracts";
export const fixtureLabel =
  "Demo preview · Sample data · Not actual business performance.";
export const agencyFixture = agencyInputSchema.parse({
  practices: ["designer"],
  targetBuyer: "Independent local makers",
  goal: "Build a repeatable brand design offer",
  weeklyCapacityHours: 24,
  proposedName: "Moss Studio",
});
export const taskFixture = taskInputSchema.parse({
  roleKey: "delivery_specialist",
  title: "Brand brief",
  brief: "A fictional maker needs a visual direction for a small launch.",
  objective: "Draft an internal concept and review checklist",
  practices: ["designer"],
});
export const pitchFixture = pitchInputSchema.parse({
  company: "Moss Studio",
  positioning: "A fictional design practice",
  buyer: "Independent local makers",
  facts: [],
  riskNotes: ["No business evidence has been supplied."],
  fundingInterest: false,
});
