import { ENGINE_VERSION, TEMPLATE_VERSION } from "./contracts";
export function generationMeta(inputSummary: string) {
  return {
    provider: "demo" as const,
    mode: "demo" as const,
    providerVersion: ENGINE_VERSION,
    templateVersion: TEMPLATE_VERSION,
    requiresReview: true as const,
    inputSummary,
  };
}
