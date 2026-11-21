import "server-only";
import { DemoProvider } from "./demo-provider";
import type { AIProvider } from "./types";

export function getAIProvider(
  name = process.env.AI_PROVIDER ?? "demo",
): AIProvider {
  if (name === "demo") return new DemoProvider();
  throw new Error(`Unsupported AI_PROVIDER: ${name}. Only demo is enabled.`);
}

export type { AIProvider, CreativeBrief, CreativeSuggestion } from "./types";
