import { describe, expect, it } from "vitest";
import type { JdSummary, JobCompany } from "@/features/jobs";
import { researchedCompanies } from "./CompaniesCarousel";

const co = (slug: string, name = slug) => ({ id: slug, name, slug }) as JobCompany;
const jd = (company: string, over: Partial<JdSummary> = {}) =>
  ({ id: `${company}-${Math.random()}`, company, practiceTemplate: false, dataAvailability: "rich", ...over }) as JdSummary;

describe("researchedCompanies", () => {
  it("keeps API order and counts live roles per company", () => {
    const out = researchedCompanies(
      [co("zeta"), co("alpha"), co("mid")],
      [jd("alpha"), jd("zeta"), jd("zeta", { dataAvailability: "available" }), jd("zeta", { dataAvailability: "limited" })],
    );
    expect(out).toEqual([
      { slug: "zeta", name: "zeta", roles: 2 },
      { slug: "alpha", name: "alpha", roles: 1 },
    ]);
  });

  it("is empty without live roles or while data is missing", () => {
    expect(researchedCompanies([co("a")], [jd("a", { dataAvailability: "none" }), jd("a", { practiceTemplate: true })])).toEqual([]);
    expect(researchedCompanies(undefined, undefined)).toEqual([]);
  });
});
