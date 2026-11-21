import { describe, expect, it } from "vitest";
import {
  dollarsToMinor,
  displayMinor,
  parseFormInput,
  commandState,
} from "../src/features/product-ui/form-input";
import { resolveScreen, screens } from "../src/features/product-ui/catalog";
import { sampleScreen } from "../src/features/product-ui/fixtures";

describe("UI boundaries", () => {
  it("preserves unknown versus zero and uses exact cents at the input boundary", () => {
    expect(dollarsToMinor("")).toBeNull();
    expect(dollarsToMinor("0")).toBe(0);
    expect(dollarsToMinor("125.01")).toBe(12501);
    expect(dollarsToMinor("1.10")).toBe(110);
    expect(dollarsToMinor("-0.01", true)).toBe(-1);
    for (const value of [
      "1.005",
      "-1",
      "NaN",
      "Infinity",
      "1e2",
      "1,200.00",
      "90071992547410.00",
    ])
      expect(() => dollarsToMinor(value)).toThrow();
    expect(displayMinor(null)).toBe("Unknown");
    expect(displayMinor(0)).toBe("$0.00");
    expect(displayMinor(-259648)).toBe("−$2,596.48");
  });
  it("validates required practices and bounded inputs while discarding submitted ownership", () => {
    const spec = screens.onboarding.forms![0];
    const data = new FormData();
    expect(parseFormInput(spec, data).ok).toBe(false);
    for (const [key, value] of Object.entries({
      practices: "designer",
      description: "Brand design",
      targetBuyer: "Independent makers",
      goal: "Repeatable work",
      weeklyCapacityHours: "20",
      timezone: "America/New_York",
      currency: "USD",
      fundingInterest: "customer_funded",
      ownerId: "foreign-owner",
    }))
      data.set(key, value);
    const result = parseFormInput(spec, data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.weeklyCapacityHours).toBe(20);
      expect(result.input.practices).toEqual(["designer"]);
      expect(result.input).not.toHaveProperty("ownerId");
    }
    data.set("weeklyCapacityHours", "169");
    const invalid = parseFormInput(spec, data);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.state.fieldErrors).toHaveProperty("weeklyCapacityHours");
  });
  it("retains conflicts and rate limits as unsuccessful outcomes", () => {
    expect(
      commandState(
        { ok: false, error: { code: "conflict", message: "Record changed" } },
        "Saved",
      ),
    ).toEqual({
      status: "conflict",
      message: "Record changed",
      fieldErrors: undefined,
    });
    expect(
      commandState(
        { ok: false, error: { code: "rate_limited", message: "Try later" } },
        "Saved",
      ).status,
    ).toBe("error");
    expect(commandState({ ok: true }, "Saved version 2")).toEqual({
      status: "success",
      message: "Saved version 2",
    });
  });
  it("keeps fixture mutations unavailable and never turns a preview into a calculated finance result", () => {
    for (const key of Object.keys(screens)) {
      const fixture = sampleScreen(key);
      for (const form of fixture.forms ?? [])
        expect(form.unavailableReason).toMatch(/sample is read-only/);
    }
    expect(sampleScreen("readiness").metrics?.[0].value).toBeNull();
    expect(sampleScreen("financials").tables?.[1].rows).toHaveLength(0);
  });
  it("resolves nested task paths and refuses unsupported routes", () => {
    expect(resolveScreen(["projects", "p1", "tasks", "t1"])).toEqual({
      key: "task",
      recordId: "t1",
      projectId: "p1",
    });
    expect(resolveScreen(["crew", "tasks", "t1"])).toEqual({
      key: "task",
      recordId: "t1",
    });
    expect(resolveScreen(["projects", "p1", "unexpected"])).toBeNull();
    expect(resolveScreen(["exports", "e1"])).toBeNull();
  });
});
