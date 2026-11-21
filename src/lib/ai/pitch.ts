import {
  PITCH_VERSION,
  pitchDraftSchema,
  type PitchInput,
  type PitchDraft,
  type EvidenceFact,
} from "./contracts";
import { generationMeta } from "./provenance";

export const PRIVATE_PITCH_DISCLOSURE =
  "Private preparation draft. Educational planning only. Not financial, investment, accounting, tax or legal advice. No funding or return guarantee. Consult qualified advisers before acting. This score organizes preparation and does not predict funding. This is not an offer of securities or a funding recommendation. User-entered evidence is self-reported; populated evidence is not independent verification. Customer-funded growth is a valid outcome.";
export const SAMPLE_DISCLOSURE =
  "Demo preview · Sample data · Not actual business performance.";
export const SOLICITATION_PATTERNS = [
  /invest in us/i,
  /join our round/i,
  /reserve your spot/i,
  /allocation available/i,
  /subscribe to (?:our|the) (?:round|offering|shares)/i,
  /guaranteed (?:funding|returns?)/i,
];
export function containsSolicitation(value: string) {
  return SOLICITATION_PATTERNS.some((pattern) => pattern.test(value));
}

export function buildPitch(input: PitchInput): PitchDraft {
  const unresolvedClaims: string[] = [];
  const rows: {
    key: string;
    heading: string;
    intro: string;
    factSection?: EvidenceFact["section"];
  }[] = [
    {
      key: "thesis",
      heading: "Agency thesis",
      intro: `Owner-supplied company: ${input.company}. Owner-supplied positioning: ${input.positioning}. Intended buyer: ${input.buyer}.`,
    },
    {
      key: "problem",
      heading: "Buyer problem",
      intro: "Review dated buyer interviews and current alternatives.",
      factSection: "problem",
    },
    {
      key: "offer",
      heading: "Offer and pricing assumptions",
      intro:
        "Review scoped packages, exclusions and editable pricing assumptions.",
      factSection: "offer",
    },
    {
      key: "delivery",
      heading: "Delivery system",
      intro:
        "Simulated crew drafts internal plans and checklists only. A real human owner approves output. Generated drafts do not establish delivery, paid human capacity or client acceptance.",
    },
    {
      key: "traction",
      heading: "Traction and collections",
      intro:
        "Recognized revenue and customer receipts remain separate. Forecast sales are not actual traction.",
      factSection: "traction",
    },
    {
      key: "retention",
      heading: "Retention and concentration",
      intro:
        "Retainers require earned work under recorded contracts. Keep largest-client exposure visible.",
      factSection: "retention",
    },
    {
      key: "economics",
      heading: "Unit economics and founder labor",
      intro:
        "Use supplied computed results, including founder-loaded margin and cash risks. The demo provider performs no finance arithmetic.",
      factSection: "economics",
    },
    {
      key: "market",
      heading: "Market assumptions",
      intro:
        "Use dated, scoped bottom-up evidence. Broad creator-economy totals do not establish the agency's addressable market.",
      factSection: "market",
    },
    {
      key: "rights",
      heading: "Rights and defensibility",
      intro:
        "Record contributor permissions, reusable rights and case-study evidence. A draft is not legal clearance.",
      factSection: "rights",
    },
    {
      key: "team",
      heading: "Accountable human team",
      intro:
        "Keep actual people, accepted backups and capacity evidence separate from simulated AI role cards.",
      factSection: "team",
    },
    {
      key: "milestones",
      heading: "Growth milestones and scenarios",
      intro:
        "Proposed milestones change no factual evidence until achieved and evidenced. Downside cash and capacity risks remain visible.",
      factSection: "milestones",
    },
    {
      key: "capital",
      heading: input.fundingInterest
        ? "Hypothetical planning scenario — not an offer of securities"
        : "Customer-funded growth",
      intro: input.fundingInterest
        ? "Capital use and ownership scenarios are optional, private and hypothetical; no transaction or investor recommendation is created."
        : "A sustainable creative business is a valid goal without a venture round.",
      factSection: input.fundingInterest ? "capital" : undefined,
    },
  ];
  const sections = rows.map((row) => {
    const facts = input.facts.filter(
      (fact) => fact.section === row.factSection,
    );
    const lines = facts.map((fact) => {
      if (fact.displayValue === null)
        unresolvedClaims.push(`${row.heading}: ${fact.label}`);
      return `${fact.label}: ${fact.displayValue ?? "[Evidence needed]"} [${fact.id}; source=${fact.sourceRef}; ${fact.origin}; as of ${fact.asOf}; ${fact.formulaVersion}; ${fact.reviewStatus} — review metadata supplied by owner, not verified by this generator]`;
    });
    if (row.factSection && facts.length === 0) {
      unresolvedClaims.push(row.heading);
      lines.push("[Evidence needed]");
    }
    return {
      key: row.key,
      heading: row.heading,
      body: [row.intro, ...lines].join("\n\n"),
      sourceIds: facts.map((f) => f.id),
    };
  });
  const sample = input.facts.some((fact) => fact.origin === "sample");
  return pitchDraftSchema.parse({
    title: `${input.company} — private preparation draft`,
    templateVersion: PITCH_VERSION,
    disclosure: [
      sample
        ? SAMPLE_DISCLOSURE
        : "Demo-generated narrative · Review required.",
      PRIVATE_PITCH_DISCLOSURE,
    ].join(" "),
    sections,
    unresolvedClaims,
    riskNotes: [
      ...input.riskNotes,
      "Missing evidence, rights, founder dependence, concentration and cash risks must remain visible regardless of preparation score.",
    ],
    meta: generationMeta(
      `Company: ${input.company}; buyer: ${input.buyer}; referenced facts: ${input.facts.length}; funding preparation: ${input.fundingInterest ? "optional" : "not selected"}`,
    ),
  });
}
