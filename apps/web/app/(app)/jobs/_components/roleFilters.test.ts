import { describe, expect, it } from "vitest";
import type { JdSummary } from "@/features/jobs";
import { ENGINEERING_LEVELS } from "@/lib/constants/engineering-levels";
import { levelsOf, matchesFilters, parseFilters, sortRoles, yoeText } from "./roleFilters";

const role = (level: JdSummary["level"]): JdSummary => ({ id: `jd-${level}`, company: "example", companyName: "Example", title: "Engineer", role: "backend", level, specialization: null, dataConfidence: null, dataAvailability: "none" });

describe("company role levels", () => {
  it("supports all eight levels in canonical order and filters each independently", () => {
    const roles = [...ENGINEERING_LEVELS].reverse().map(role);
    expect(levelsOf(roles)).toEqual(ENGINEERING_LEVELS);
    for (const level of ENGINEERING_LEVELS) {
      const filters = parseFilters(new URLSearchParams({ level }));
      expect(roles.filter((jd) => matchesFilters(jd, filters)).map((jd) => jd.level)).toEqual([level]);
    }
  });
  it("ignores non-enum URL values and safely handles unknown saved JD levels", () => {
    expect(parseFilters(new URLSearchParams({ level: "Career switcher,sde2" })).levels).toEqual(["sde2"]);
    const unknown = role(null);
    expect(levelsOf([unknown])).toEqual([]);
    expect(matchesFilters(unknown, parseFilters(new URLSearchParams({ level: "intern" })))).toBe(false);
  });
});

describe("sort by match", () => {
  it("orders by match score, unscored roles last, ties by title", () => {
    const roles = (["a", "b", "c", "d"] as const).map((id) => ({ ...role("fresher"), id, title: `Role ${id}` }));
    const scores = new Map<string, number | null>([["a", 40], ["b", null], ["c", 80], ["d", 40]]);
    expect(sortRoles(roles, "match", scores).map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
    expect(parseFilters(new URLSearchParams({ sort: "match" })).sort).toBe("match");
  });
});

describe("practice template experience", () => {
  it("labels the level's typical range and lets it filter by experience, never by pay", () => {
    const template = { ...role("fresher"), practiceTemplate: true, yoeMin: 0, yoeMax: 1 };
    expect(yoeText(template)).toBe("0–1 yrs · typical for level");
    expect(yoeText({ ...template, yoeMin: 15, yoeMax: null })).toBe("15+ yrs · typical for level");
    expect(yoeText({ ...template, practiceTemplate: false })).toBe("0–1 yrs");
    expect(matchesFilters(template, parseFilters(new URLSearchParams({ maxYoe: "1" })))).toBe(true);
    expect(matchesFilters(template, parseFilters(new URLSearchParams({ minPay: "5" })))).toBe(false);
  });
});
