export type CreativeBrief = { practice: string; goal: string };

export type CreativeSuggestion = {
  provider: string;
  mode: "demo" | "live";
  summary: string;
  nextSteps: string[];
  requiresReview: true;
};

export interface AIProvider {
  readonly name: string;
  suggest(brief: CreativeBrief): Promise<CreativeSuggestion>;
  generateAgency(
    input: import("./contracts").AgencyInput,
  ): Promise<import("./contracts").AgencyDraft>;
  simulateTask(
    input: import("./contracts").TaskInput,
  ): Promise<import("./contracts").ArtifactContent>;
  draftPitch(
    input: import("./contracts").PitchInput,
  ): Promise<import("./contracts").PitchDraft>;
}
