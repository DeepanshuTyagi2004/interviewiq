import { describe, expect, it } from "vitest";
import { codeStandardFor, passMark, readinessLevel, retakeAfter } from "../../src/domain/evaluation.js";

describe("passMark", () => {
  it("adds tier and difficulty, rounding half up", () => {
    expect(passMark({ level: "sde1", tier: 2, difficulty: "medium" })).toBe(6.8);
    expect(passMark({ level: "sde2", tier: 1, difficulty: "hard" })).toBe(7.8);
    expect(passMark({ level: "fresher", tier: null, difficulty: null })).toBe(6.0);
    expect(passMark({ level: "distinguished", tier: 1, difficulty: "hard" })).toBe(8.3);
  });
  it("treats an unknown level as sde1", () => {
    expect(passMark({ level: "wizard", tier: null, difficulty: null })).toBe(6.5);
    expect(passMark({ level: null, tier: null, difficulty: null })).toBe(6.5);
  });
});

describe("codeStandardFor", () => {
  it("derives from tier and business model, override wins", () => {
    expect(codeStandardFor(1, "product", null)).toBe("runnable");
    expect(codeStandardFor(2, "hybrid", null)).toBe("runnable");
    expect(codeStandardFor(4, "product", null)).toBe("pseudo_ok");
    expect(codeStandardFor(3, "service", null)).toBe("pseudo_ok");
    expect(codeStandardFor(3, "product", null)).toBe("near_runnable");
    expect(codeStandardFor(null, null, null)).toBe("near_runnable");
    expect(codeStandardFor(1, "product", "pseudo_ok")).toBe("pseudo_ok");
  });
});

describe("retakeAfter", () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const days = (d: Date | null) => d && Math.round((d.getTime() - at.getTime()) / 86400000);
  it("maps outcomes to cooldowns", () => {
    expect(days(retakeAfter("below_pass", 6.1, 6.5, at))).toBe(7);
    expect(days(retakeAfter("below_pass", 5.5, 6.5, at))).toBe(14);
    expect(days(retakeAfter("auto_fail", null, 6.5, at))).toBe(14);
    expect(retakeAfter("unscorable", null, 6.5, at)).toBeNull();
    expect(retakeAfter("passed", 8, 6.5, at)).toBeNull();
  });
});

describe("readinessLevel", () => {
  it("maps rounds passed", () => {
    expect(readinessLevel(0, 4)).toBe("getting_started");
    expect(readinessLevel(1, 4)).toBe("progressing");
    expect(readinessLevel(3, 4)).toBe("nearly_ready");
    expect(readinessLevel(4, 4)).toBe("interview_ready");
    expect(readinessLevel(1, 1)).toBe("interview_ready");
  });
});
