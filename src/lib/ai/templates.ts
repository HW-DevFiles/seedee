import { TEMPLATE_VERSION, type AgencyInput, type CrewRole } from "./contracts";

export const practiceTemplates = {
  musician: {
    label: "Music",
    offer: "Sonic identity",
    deliverables: [
      "Creative listening brief",
      "Original composition sketch",
      "Mix and licensing review checklist",
    ],
    checks: [
      "Confirm composition and recording rights",
      "Check export format and listening notes",
    ],
  },
  visual_artist: {
    label: "Art",
    offer: "Illustration commission",
    deliverables: [
      "Visual concept board",
      "Original illustration study",
      "Artwork handoff and usage checklist",
    ],
    checks: [
      "Confirm usage scope and reproduction rights",
      "Review dimensions, color and reproduction format",
    ],
  },
  designer: {
    label: "Design",
    offer: "Brand design",
    deliverables: [
      "Audience and design brief",
      "Visual direction study",
      "Design handoff and accessibility checklist",
    ],
    checks: [
      "Review brand asset permissions",
      "Check contrast, layout and editable handoff",
    ],
  },
  filmmaker: {
    label: "Film",
    offer: "Short film production",
    deliverables: [
      "Treatment and storyboard",
      "Production and edit plan",
      "Screening and release checklist",
    ],
    checks: [
      "Confirm contributor, music and location permissions",
      "Review shot coverage, edit continuity and captions",
    ],
  },
  writer: {
    label: "Writing",
    offer: "Editorial story",
    deliverables: [
      "Audience and editorial outline",
      "Sample copy draft",
      "Fact-check and editorial handoff checklist",
    ],
    checks: [
      "Trace factual claims to sources",
      "Review voice, attribution and publication rights",
    ],
  },
  photographer: {
    label: "Photography",
    offer: "Product photography",
    deliverables: [
      "Creative brief and shot list",
      "Session and selection plan",
      "Retouching and delivery checklist",
    ],
    checks: [
      "Confirm subject consent and image usage",
      "Review lighting, selections and delivery resolution",
    ],
  },
  content_creator: {
    label: "Content",
    offer: "Content series",
    deliverables: [
      "Audience hypothesis and content calendar",
      "Episode script outline",
      "Sponsorship and publishing review checklist",
    ],
    checks: [
      "Separate observed audience metrics from assumptions",
      "Review sponsorship disclosure and asset permissions",
    ],
  },
  other: {
    label: "Creative",
    offer: "Creative pilot",
    deliverables: [
      "Practice-specific discovery brief",
      "Small pilot plan",
      "Scope and handoff checklist",
    ],
    checks: [
      "Define practice-specific quality criteria with the owner",
      "Confirm usage rights and delivery scope",
    ],
  },
} as const;

export function buildRoles(practices: AgencyInput["practices"]): CrewRole[] {
  const discipline = practices
    .map((key) => practiceTemplates[key].label.toLowerCase())
    .join(" / ");
  const rows = [
    [
      "creative_lead",
      "Creative Lead",
      "Frame the creative direction and maintain the owner's intent.",
      ["Owner goal", "Buyer brief"],
      "Creative direction plan",
    ],
    [
      "research_strategy",
      "Research / Strategy",
      "Identify research questions and separate assumptions from supported evidence.",
      ["Buyer hypothesis", "Dated source notes"],
      "Research checklist with evidence gaps",
    ],
    [
      "producer",
      "Producer / Project Manager",
      "Organize scope, dependencies and internal delivery checkpoints.",
      ["Approved scope", "Human capacity plan"],
      "Project plan and review gates",
    ],
    [
      "delivery_specialist",
      "Delivery Specialist",
      `Draft internal ${discipline} plans; this simulation produces text, not finished creative assets.`,
      ["Approved brief", "Discipline constraints"],
      "Practice-specific internal draft",
    ],
    [
      "quality_reviewer",
      "Quality Reviewer",
      "Check the draft against acceptance, rights and quality criteria.",
      ["Draft artifact", "Acceptance checklist"],
      "Quality checklist; owner retains approval",
    ],
    [
      "growth_analyst",
      "Growth / Business Analyst",
      "Explain saved delivery evidence and propose measurable next actions.",
      ["Saved operational evidence", "Missing metric list"],
      "Evidence-gap plan without changing actuals",
    ],
    [
      "finance_evidence",
      "Finance / Evidence Analyst",
      "Organize supplied computed facts and disclose unknown financial and ownership evidence.",
      ["Versioned finance results", "Evidence references"],
      "Private evidence outline; no financial calculations or funding endorsement",
    ],
  ] as const;
  return rows.map(([key, title, responsibility, input, output]) => ({
    key,
    title,
    responsibility,
    input: [...input],
    output,
    approvalBoundary:
      "Simulated role. The agency owner must review and approve; no external action or client acceptance is implied.",
    simulated: true,
    approvalRequired: true,
    templateVersion: TEMPLATE_VERSION,
  }));
}

export function buildWorkflows() {
  return [
    {
      key: "delivery",
      title: "Reviewed creative delivery",
      version: TEMPLATE_VERSION,
      steps: [
        {
          key: "brief",
          title: "Brief",
          roleKey: "creative_lead" as const,
          humanGate: true,
          predecessor: null,
        },
        {
          key: "plan",
          title: "Plan",
          roleKey: "producer" as const,
          humanGate: false,
          predecessor: "brief",
        },
        {
          key: "draft",
          title: "Draft",
          roleKey: "delivery_specialist" as const,
          humanGate: false,
          predecessor: "plan",
        },
        {
          key: "review",
          title: "Human review",
          roleKey: "quality_reviewer" as const,
          humanGate: true,
          predecessor: "draft",
        },
        {
          key: "delivery",
          title: "Delivery recorded internally",
          roleKey: "producer" as const,
          humanGate: true,
          predecessor: "review",
        },
        {
          key: "closeout",
          title: "Closeout evidence",
          roleKey: "finance_evidence" as const,
          humanGate: true,
          predecessor: "delivery",
        },
      ],
    },
    {
      key: "evidence_review",
      title: "Monthly evidence review",
      version: TEMPLATE_VERSION,
      steps: [
        {
          key: "collect",
          title: "Collect saved evidence",
          roleKey: "finance_evidence" as const,
          humanGate: false,
          predecessor: null,
        },
        {
          key: "gaps",
          title: "Review missing evidence",
          roleKey: "growth_analyst" as const,
          humanGate: false,
          predecessor: "collect",
        },
        {
          key: "attest",
          title: "Owner reviews and records next actions",
          roleKey: "creative_lead" as const,
          humanGate: true,
          predecessor: "gaps",
        },
      ],
    },
  ];
}
