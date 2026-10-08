import { describe, expect, it } from "vitest";
import { ENGINEERING_LEVELS, engineeringLevelView, normalizeLegacyLevel, parseEngineeringLevel } from "../../src/domain/engineeringLevels.js";

describe("canonical engineering-level boundary", () => {
  it("accepts exactly the eight selected values for writes", () => {
    for (const level of ENGINEERING_LEVELS) expect(parseEngineeringLevel(level)).toBe(level);
    for (const value of ["Senior", "SDE 2", "principle", "Career switcher", "constructor", null]) {
      expect(() => parseEngineeringLevel(value)).toThrow();
    }
  });
  it("reads known aliases without treating inherited object keys as enum values", () => {
    expect(normalizeLegacyLevel("SDE II")).toBe("sde2");
    expect(normalizeLegacyLevel("Principle")).toBe("principal");
    for (const raw of ["constructor", "toString", "__proto__", "valueOf"]) expect(normalizeLegacyLevel(raw)).toBeNull();
    expect(engineeringLevelView("Career switcher")).toEqual({ level: null, legacyLevel: "Career switcher" });
  });
});
