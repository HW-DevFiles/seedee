import type { AIProvider, CreativeBrief, CreativeSuggestion } from "./types";

export class DemoProvider implements AIProvider {
  readonly name = "demo";

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
