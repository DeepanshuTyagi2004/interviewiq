import { describe, it, expect } from "vitest";
import type { EducationDto } from "@/features/onboarding";
import { educationLine, yearRange } from "./identity";

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

  it("uses only the first (most recent) entry and skips blanks", () => {
    expect(educationLine([edu({ institution: " RVCE ", endYear: "" }), edu({ degree: "Class XII" })])).toBe("RVCE");
  });

  it("returns null with no usable education", () => {
    expect(educationLine(undefined)).toBeNull();
    expect(educationLine([])).toBeNull();
    expect(educationLine([edu({})])).toBeNull();
  });
});

describe("yearRange", () => {
  it("formats a range, a single year or nothing", () => {
    expect(yearRange("2023", "2027")).toBe("2023–2027");
    expect(yearRange(null, "2027")).toBe("2027");
    expect(yearRange(" ", null)).toBeNull();
  });
});
