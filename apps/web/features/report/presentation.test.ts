import { describe, expect, it } from "vitest";
import { deltaLabel, formatScore, markerMeta, mockOutcomeLine, outcomeMeta, verdictLabel } from "./presentation";

describe("report presentation", () => {
  it("formats scores to one decimal", () => {
    expect(formatScore(6.8)).toBe("6.8");
    expect(formatScore(7)).toBe("7.0");
  });
  it("maps outcomes", () => {
    expect(outcomeMeta("passed")).toEqual({ label: "Passed", tone: "brand" });
    expect(outcomeMeta("below_pass").label).toBe("Below pass mark");
    expect(outcomeMeta("auto_fail")).toEqual({ label: "Automatic fail", tone: "warn" });
    expect(outcomeMeta("unscorable").label).toBe("Not scored");
  });
  it("names verdicts", () => {
    expect(verdictLabel("strong_hire")).toBe("Strong Hire");
    expect(verdictLabel("lean_no_hire")).toBe("Lean No Hire");
    expect(verdictLabel("Strong No Hire")).toBe("Strong No Hire");
    expect(verdictLabel("strong_no_hire")).toBe("Strong No Hire");
  });
  it("labels deltas with the real minus sign", () => {
    expect(deltaLabel(0.1)).toBe("+0.1");
    expect(deltaLabel(-0.25)).toBe("−0.25");
    expect(deltaLabel(-0.125)).toBe("−0.125");
    expect(deltaLabel(0)).toBe("0");
  });
  it("maps markers", () => {
    expect(markerMeta("bug").tone).toBe("bad");
    expect(markerMeta("edge_case").label).toBe("Edge case");
    expect(markerMeta("odd_thing").label).toBe("Odd thing");
  });
  it("builds the mock outcome line", () => {
    const meta = { company: "meesho", level: "sde1", round: "2" };
    expect(mockOutcomeLine(meta, "passed")).toBe("Passed · Meesho SDE1 mock round 2");
    expect(mockOutcomeLine({ company: "Meesho", level: "fresher", round: "Round 3 - DSA" }, "below_pass")).toBe("Below pass mark · Meesho Fresher mock round 3");
    expect(mockOutcomeLine({ company: "Meesho", level: "intern", round: null }, "auto_fail")).toBe("Automatic fail · Meesho Intern mock round");
    expect(mockOutcomeLine({ company: "Google India", level: "sde1", round: "1" }, "unscorable")).toBe("Not scored · Google India SDE1 mock round 1");
  });
  it("never uses banned words", () => {
    const all = [
      ...(["passed", "below_pass", "auto_fail", "unscorable"] as const).flatMap((o) => [outcomeMeta(o).label, mockOutcomeLine({ company: "meesho", level: "sde1", round: "2" }, o)]),
      ...["strong_hire", "hire", "lean_hire", "lean_no_hire", "no_hire", "strong_no_hire"].map(verdictLabel),
    ].join(" ").toLowerCase();
    expect(all).not.toMatch(/cleared|certified|badge/);
  });
});
