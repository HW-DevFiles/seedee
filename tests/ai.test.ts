import { describe, expect, it, vi } from "vitest";
import { getAIProvider } from "@/lib/ai";

describe("demo AI provider", () => {
  it("returns deterministic, review-required sample output without network access", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network permitted"));
    try {
      const provider = getAIProvider("demo");
      const brief = {
        practice: "illustration",
        goal: "package a first service",
      };
      const first = await provider.suggest(brief);
      expect(await provider.suggest(brief)).toEqual(first);
      expect(first).toMatchObject({
        mode: "demo",
        provider: "demo",
        requiresReview: true,
      });
      expect(first.summary).toContain(brief.practice);
      expect(first.nextSteps).toHaveLength(3);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it("rejects invalid input and unsupported providers", async () => {
    expect(() => getAIProvider("live")).toThrow("Only demo is enabled");
    await expect(
      getAIProvider("demo").suggest({ practice: " ", goal: "test" }),
    ).rejects.toThrow("Provide a practice");
  });
});
