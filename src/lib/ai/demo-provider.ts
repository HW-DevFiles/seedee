import type { AIProvider, CreativeBrief, CreativeSuggestion } from "./types";
import {
  agencyInputSchema,
  agencyDraftSchema,
  taskInputSchema,
  artifactSchema,
  pitchInputSchema,
  type AgencyInput,
  type TaskInput,
  type PitchInput,
} from "./contracts";
import { buildRoles, buildWorkflows, practiceTemplates } from "./templates";
import { generationMeta } from "./provenance";
import { buildPitch, containsSolicitation } from "./pitch";

export class DemoProvider implements AIProvider {
  readonly name = "demo";

  async generateAgency(raw: AgencyInput) {
    const input = agencyInputSchema.parse(raw);
    const primary = input.practices[0];
    const template = practiceTemplates[primary];
    const disciplines = input.practices.map((key) => practiceTemplates[key]);
    return agencyDraftSchema.parse({
      name: input.proposedName || `${template.label} Studio`,
      positioning: `A proposed ${disciplines.map((item) => item.label.toLowerCase()).join(" / ")} practice for ${input.targetBuyer}. Creative goal: ${input.goal}.`,
      buyer: input.targetBuyer,
      practices: input.practices,
      goal: input.goal,
      weeklyCapacityHours: input.weeklyCapacityHours,
      currency: input.currency,
      packages: [4, 12, 24].map((hours, index) => ({
        key: `${primary}-${["discovery", "pilot", "series"][index]}`,
        title: `${template.offer}: ${["Discovery", "Pilot", "Series"][index]}`,
        deliverables: disciplines
          .flatMap((item) => [...item.deliverables])
          .slice(0, 20),
        exclusions: [
          "External publishing, client communication and final creative asset production",
          "Legal clearance, paid tools and third-party purchases",
        ],
        revisionLimit: index + 1,
        turnaroundDays: [3, 7, 14][index],
        laborHours: hours,
        priceMinor: [25000, 75000, 150000][index],
        currency: "USD",
        pricingBasis: {
          kind: "illustrative_assumption",
          laborRateMinor: 5000,
          directCostMinor: [20000, 60000, 120000][index],
          targetMarginBps: 2000,
          note: "Synthetic USD planning example: entered labor at $50/hour and 20% direct-cost margin; excludes overhead and is not market validation. Review scope, capacity and price before use.",
        },
      })),
      roles: buildRoles(input.practices),
      workflows: buildWorkflows(),
      assumptions: [
        "Demo-generated editable proposal; no agency is active until the owner accepts.",
        "No clients, revenue, human employees, rights clearance or incorporation status are inferred.",
        "Prices and turnaround are illustrative assumptions; review against your actual capacity.",
        "All crew roles are simulated and require human approval.",
      ],
      meta: generationMeta(
        `Practices: ${input.practices.join(", ")}; buyer: ${input.targetBuyer}; goal: ${input.goal}; weekly capacity: ${input.weeklyCapacityHours} hours.`,
      ),
    });
  }

  async simulateTask(raw: TaskInput) {
    const input = taskInputSchema.parse(raw);
    const role = buildRoles(input.practices).find(
      (role) => role.key === input.roleKey,
    )!;
    const checks = input.practices.flatMap((key) => [
      ...practiceTemplates[key].checks,
    ]);
    return artifactSchema.parse({
      kind:
        input.roleKey === "quality_reviewer"
          ? "checklist"
          : input.roleKey === "delivery_specialist"
            ? "text"
            : "plan",
      title: `${role.title}: ${input.title}`,
      sections: [
        {
          heading: "Owner-supplied input",
          body: `Brief: ${input.brief}\nObjective: ${input.objective}`,
        },
        {
          heading: "Simulated internal draft",
          body: `${role.responsibility}\nProposed next step: ${role.output}.\nConfirm the scope and gather missing evidence before treating any statement as fact.`,
        },
        {
          heading: "Revision request",
          body: input.revisionNote || "Initial draft; no revision requested.",
        },
        { heading: "Human approval boundary", body: role.approvalBoundary },
      ],
      checklist: [
        ...checks,
        "Check every factual claim against saved evidence; unknowns remain unknown.",
        "Owner reviews this internal draft before it can complete a reviewable task.",
      ].slice(0, 20),
      meta: generationMeta(
        `Role: ${role.title}; task: ${input.title}; objective: ${input.objective}`,
      ),
    });
  }

  async draftPitch(raw: PitchInput) {
    const input = pitchInputSchema.parse(raw);
    if (containsSolicitation(JSON.stringify(input)))
      throw new Error(
        "Remove call-to-invest language from the private preparation draft.",
      );
    return buildPitch(input);
  }

  async suggest(brief: CreativeBrief): Promise<CreativeSuggestion> {
    const practice = brief.practice.trim();
    const goal = brief.goal.trim();
    if (!practice || !goal || practice.length > 200 || goal.length > 500) {
      throw new Error(
        "Provide a practice (1–200 characters) and goal (1–500 characters).",
      );
    }
    return {
      provider: this.name,
      mode: "demo",
      summary: `Sample plan for ${practice}: work toward ${goal}.`,
      nextSteps: [
        `Draft one clear ${practice} service offer.`,
        "Describe a small pilot project and review its scope yourself.",
        "Record what you learn before setting your next milestone.",
      ],
      requiresReview: true,
    };
  }
}
