import { describe, expect, it } from "vitest";
import { ENGINEERING_LEVEL_OPTIONS, ENGINEERING_LEVELS, isEngineeringLevel, levelLabel, normalizeLegacyLevel } from "./engineering-levels";

describe("engineering levels", () => {
  it("has exactly eight canonical values and labels in seniority order", () => {
    expect(ENGINEERING_LEVELS).toEqual(["intern", "fresher", "sde1", "sde2", "sde3", "staff", "principal", "distinguished"]);
    expect(ENGINEERING_LEVEL_OPTIONS.map((option) => option.value)).toEqual(ENGINEERING_LEVELS);
    expect(ENGINEERING_LEVEL_OPTIONS.map((option) => option.label)).toEqual(["Intern", "Fresher", "SDE I", "SDE II", "SDE III", "Staff", "Principal", "Distinguished"]);
  });

  it("only reads documented legacy aliases and never infers arbitrary descriptions", () => {
    for (const [legacy, canonical] of [["SDE I", "sde1"], ["SDE-2", "sde2"], ["Senior", "sde3"], ["principle", "principal"], ["new grad", "fresher"]]) {
      expect(normalizeLegacyLevel(legacy)).toBe(canonical);
      expect(isEngineeringLevel(legacy)).toBe(false);
    }
    for (const unknown of ["Career switcher", "L4", "Staff +", "Senior / Staff", "10 years", "constructor", "__proto__", null]) expect(normalizeLegacyLevel(unknown)).toBeNull();
    expect(levelLabel("sde2")).toBe("SDE II");
    expect(levelLabel(null)).toBe("Unknown");
    expect(levelLabel("L4")).toBe("L4");
  });
});
