import { describe, it, expect } from "vitest";
import { joinDetail, sourceDate } from "./format";

describe("sourceDate", () => {
  const now = new Date(2026, 8, 30);

  it("drops the year for dates in the current year", () => {
    expect(sourceDate(new Date(2026, 8, 12).toISOString(), now)).toBe("12 Sep");
  });

  it("keeps the year for other years", () => {
    expect(sourceDate(new Date(2025, 0, 3).toISOString(), now)).toBe("3 Jan 2025");
  });

  it("returns null for missing or invalid input", () => {
    expect(sourceDate(undefined, now)).toBeNull();
    expect(sourceDate(null, now)).toBeNull();
    expect(sourceDate("not a date", now)).toBeNull();
  });
});

describe("joinDetail", () => {
  it("joins only the truthy parts with a middle dot", () => {
    expect(joinDetail(["@asha", null, "18 public repos", false, ""])).toBe("@asha · 18 public repos");
  });

  it("returns an empty string when nothing is left", () => {
    expect(joinDetail([null, undefined])).toBe("");
  });
});
