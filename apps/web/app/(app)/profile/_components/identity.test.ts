import { describe, it, expect } from "vitest";
import type { EducationDto } from "@/features/onboarding";
import { displayLink, educationLine, externalHref, primaryEducation, yearRange } from "./identity";

const edu = (over: Partial<EducationDto>): EducationDto => ({
  institution: null,
  degree: null,
  field: null,
  startYear: null,
  endYear: null,
  grade: null,
  ...over,
});

describe("educationLine", () => {
  it("joins degree + field, institution and graduation year", () => {
    expect(educationLine([edu({ degree: "B.Tech", field: "CSE", institution: "RVCE", endYear: "2027" })])).toBe(
      "B.Tech CSE · RVCE · 2027",
    );
  });

  it("uses one entry and skips blanks", () => {
    expect(educationLine([edu({ institution: " RVCE ", endYear: "" }), edu({ degree: "Class XII" })])).toBe("RVCE");
  });

  it("headlines the entry that ends latest, whatever order the resume lists them in", () => {
    const school = edu({ degree: "Class XII", institution: "DPS", endYear: "2021" });
    const degree = edu({ degree: "B.E.", field: "CSE", institution: "RVCE", endYear: "2025" });
    expect(educationLine([school, degree])).toBe("B.E. CSE · RVCE · 2025");
    expect(educationLine([degree, school])).toBe("B.E. CSE · RVCE · 2025");
  });

  it("returns null with no usable education", () => {
    expect(educationLine(undefined)).toBeNull();
    expect(educationLine([])).toBeNull();
    expect(educationLine([edu({})])).toBeNull();
  });
});

describe("primaryEducation", () => {
  it("reads years out of free text and never lets an undated entry win", () => {
    const undated = edu({ degree: "Diploma" });
    const expected = edu({ degree: "B.Tech", endYear: "Expected 2027" });
    const started = edu({ degree: "M.Tech", startYear: "2028" });
    expect(primaryEducation([undated, expected])).toBe(expected);
    expect(primaryEducation([expected, undated])).toBe(expected);
    expect(primaryEducation([expected, started])).toBe(started);
    expect(primaryEducation([undated])).toBe(undated);
    expect(primaryEducation([])).toBeNull();
  });
});

describe("externalHref / displayLink", () => {
  it("keeps http(s) links and adds https to bare domains", () => {
    expect(externalHref("https://github.com/asha/ledger")).toBe("https://github.com/asha/ledger");
    expect(externalHref(" github.com/asha/ledger ")).toBe("https://github.com/asha/ledger");
    expect(displayLink("https://ledger.app/")).toBe("ledger.app");
  });

  it("refuses anything that isn't a web link", () => {
    expect(externalHref("javascript:alert(1)")).toBeNull();
    expect(externalHref("mailto:a@b.co")).toBeNull();
    expect(externalHref("my side project")).toBeNull();
    expect(externalHref("https://user:pass@example.com")).toBeNull();
    expect(externalHref(null)).toBeNull();
  });
});

describe("yearRange", () => {
  it("formats a range, a single year or nothing", () => {
    expect(yearRange("2023", "2027")).toBe("2023–2027");
    expect(yearRange(null, "2027")).toBe("2027");
    expect(yearRange(" ", null)).toBeNull();
  });
});
