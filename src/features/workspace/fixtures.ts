import type { z } from "zod";
import { agencyContentSchema, onboardingSchema } from "./contracts";
export const sampleOnboarding = onboardingSchema.parse({
  practices: ["designer"],
  description: "Synthetic practice",
  targetBuyer: "Small independent studios",
  goal: "Build a repeatable business",
  weeklyCapacityHours: 30,
  proposedName: "Sample Fieldwork",
});
export function sampleAgencyDraft(): z.infer<typeof agencyContentSchema> {
  const roles = [
    "creative_lead",
    "research_strategy",
    "producer",
    "delivery_specialist",
    "quality_reviewer",
    "growth_analyst",
    "finance_evidence",
  ].map((key) => ({
    key,
    title: key.replaceAll("_", " "),
    responsibility: "Simulated planning or review",
    input: ["Owner brief"],
    output: "Internal draft",
    approvalBoundary: "Owner approves all output",
    simulated: true as const,
    approvalRequired: true as const,
    templateVersion: "creative-templates-v1.0",
  }));
  return agencyContentSchema.parse({
    name: "Sample Fieldwork",
    positioning: "A synthetic independent design studio",
    buyer: "Small studios",
    practices: ["designer"],
    goal: "Repeatable creative delivery",
    weeklyCapacityHours: 30,
    currency: "USD",
    packages: [1, 2, 3].map((n) => ({
      key: `sample-${n}`,
      title: `Illustrative package ${n}`,
      deliverables: ["Internal draft", "Owner review"],
      exclusions: ["External delivery"],
      revisionLimit: 2,
      turnaroundDays: 14,
      laborHours: 10,
      priceMinor: 100000 * n,
      currency: "USD",
      pricingBasis: {
        kind: "illustrative_assumption",
        laborRateMinor: 5000,
        directCostMinor: 10000,
        targetMarginBps: 4000,
        note: "Sample cost assumptions, not a market-validated price",
      },
    })),
    roles,
    workflows: ["delivery", "evidence"].map((key) => ({
      key,
      title: `Sample ${key}`,
      version: "creative-templates-v1.0",
      steps: [
        {
          key: "brief",
          title: "Record brief",
          roleKey: "producer",
          humanGate: true,
          predecessor: null,
        },
        {
          key: "review",
          title: "Owner review",
          roleKey: "quality_reviewer",
          humanGate: true,
          predecessor: "brief",
        },
      ],
    })),
    assumptions: [
      "Explicit synthetic fixture; no claimed business performance",
    ],
    meta: {
      provider: "demo",
      mode: "demo",
      providerVersion: "agency-engine-v1.0",
      templateVersion: "creative-templates-v1.0",
      inputSummary: "Synthetic designer brief",
      requiresReview: true,
    },
  });
}

// Explicit read adapter for a fresh-account UI. It cannot report a persisted write.
export function emptyWorkspaceFixture(): import("./service").WorkspaceRead {
  return {
    agency: null,
    onboarding: null,
    drafts: [],
    packages: [],
    clients: [],
    projects: [],
    tasks: [],
    actuals: [],
    evidence: [],
    snapshots: [],
    checklist: [],
    exports: [],
    home: {
      activeProjects: 0,
      awaitingReview: 0,
      completedProjects: 0,
      taskCount: 0,
      nextActions: [
        { label: "Describe your creative practice", href: "/app/onboarding" },
      ],
    },
  };
}
