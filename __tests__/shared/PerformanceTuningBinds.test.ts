import { describe, expect, it } from "vitest";
import {
  parsePlanBindsText,
  validatePlanBindsInput,
} from "../../src/shared/PerformanceTuningBinds";

describe("validatePlanBindsInput", () => {
  it("accepts an array of string/number/boolean/null", () => {
    expect(validatePlanBindsInput([1, "active", true, null, false, 0, ""])).toEqual({
      ok: true,
      binds: [1, "active", true, null, false, 0, ""],
    });
  });

  it("accepts an empty array", () => {
    expect(validatePlanBindsInput([])).toEqual({ ok: true, binds: [] });
  });

  it("rejects a non-array", () => {
    const result = validatePlanBindsInput({ a: 1 });
    expect(result.ok).toBe(false);
  });
  it("rejects undefined", () => {
    expect(validatePlanBindsInput(undefined).ok).toBe(false);
  });

  it("rejects an object element", () => {
    const result = validatePlanBindsInput([1, { nested: true }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("index 1");
    }
  });

  it("rejects a nested-array element", () => {
    const result = validatePlanBindsInput([1, [2, 3]]);
    expect(result.ok).toBe(false);
  });

  it("rejects undefined as an element (distinct from null)", () => {
    const result = validatePlanBindsInput([undefined]);
    expect(result.ok).toBe(false);
  });
});

describe("parsePlanBindsText", () => {
  it("treats empty/whitespace-only text as an empty, valid bind list", () => {
    expect(parsePlanBindsText("")).toEqual({ ok: true, binds: [] });
    expect(parsePlanBindsText("   ")).toEqual({ ok: true, binds: [] });
  });

  it("parses a valid JSON array", () => {
    expect(parsePlanBindsText('[1, "active", null]')).toEqual({
      ok: true,
      binds: [1, "active", null],
    });
  });

  it("rejects invalid JSON", () => {
    const result = parsePlanBindsText("[1, 2");
    expect(result.ok).toBe(false);
  });

  it("rejects valid JSON that isn't an array", () => {
    const result = parsePlanBindsText('{"a": 1}');
    expect(result.ok).toBe(false);
  });

  it("rejects a JSON array containing an object element", () => {
    const result = parsePlanBindsText('[1, {"a": 1}]');
    expect(result.ok).toBe(false);
  });
});
