export const TEMPLATE_VERSION = "delivery-v1";
export const workflowTemplates = [
  {
    key: "creative_delivery",
    title: "Creative delivery",
    version: TEMPLATE_VERSION,
    steps: [
      { title: "Brief", roleKey: "creative_lead", kind: "work" },
      { title: "Plan", roleKey: "producer", kind: "work" },
      { title: "Draft", roleKey: "delivery_specialist", kind: "work" },
      { title: "Human review", roleKey: null, kind: "human_review" },
      { title: "Delivery recorded", roleKey: null, kind: "delivery_record" },
      { title: "Closeout", roleKey: null, kind: "closeout" },
    ],
  },
  {
    key: "content_delivery",
    title: "Content delivery",
    version: TEMPLATE_VERSION,
    steps: [
      { title: "Brief", roleKey: "creative_lead", kind: "work" },
      { title: "Plan", roleKey: "research_strategy", kind: "work" },
      { title: "Draft", roleKey: "delivery_specialist", kind: "work" },
      { title: "Human review", roleKey: null, kind: "human_review" },
      { title: "Delivery recorded", roleKey: null, kind: "delivery_record" },
      { title: "Closeout", roleKey: null, kind: "closeout" },
    ],
  },
] as const;
export const routineTemplates = [
  {
    key: "weekly_planning",
    title: "Weekly planning",
    cadence: "weekly",
    duePeriods: 1,
    input:
      "Review priorities, capacity and blocked work. Prepare an internal plan for owner review.",
  },
  {
    key: "monthly_evidence",
    title: "Monthly evidence review",
    cadence: "monthly",
    duePeriods: 1,
    input:
      "Review completed work, recognized revenue, receipts and evidence gaps. Unknown facts stay unknown.",
  },
] as const;
export const milestoneDefinitions = [
  {
    key: "first_offer",
    title: "First offer",
    target: "Save one active scoped offer.",
  },
  {
    key: "reviewed_process",
    title: "Reviewed delivery process",
    target: "Record one owner-reviewed delivery SOP.",
  },
  {
    key: "paid_project",
    title: "Paid-project evidence",
    target:
      "Record positive earned revenue and positive receipts for a completed project.",
  },
  {
    key: "repeat_client",
    title: "Repeat client",
    target: "Complete two projects for one economic client group.",
  },
  {
    key: "capacity_review",
    title: "Capacity review",
    target:
      "Record a current human capacity plan, including demand and available hours.",
  },
  {
    key: "investor_evidence",
    title: "Investor evidence gaps",
    target:
      "Complete the recorded investor evidence checklist. This does not certify investability.",
  },
] as const;
