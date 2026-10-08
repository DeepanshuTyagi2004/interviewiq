import { describe, expect, it } from "vitest";
import { draftFromParsedResume, experience, project, safeUrl } from "../../src/domain/candidateProfile.js";

describe("candidate profile URL normalization", () => {
  it("normalizes safe URLs and rejects executable, local, and credential-bearing URLs", () => {
    expect(safeUrl("example.com/portfolio")).toBe("https://example.com/portfolio");
    expect(safeUrl("https://EXAMPLE.com/me")).toBe("https://example.com/me");
    for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/resume.pdf", "https://user:pass@example.com"]) {
      expect(safeUrl(value)).toBeNull();
    }
  });

  it("accepts experience url as a backward-compatible alias and keeps project links safe", () => {
    expect(experience({ company: "Acme", url: "https://acme.example/work" }).link).toBe("https://acme.example/work");
    expect(experience({ company: "Acme", link: "javascript:alert(1)" }).link).toBeNull();
    expect(project({ name: "Demo", link: "data:text/html,nope" }).link).toBeNull();
  });

  it("maps an explicitly extracted portfolio URL without manufacturing one", () => {
    const parsed = draftFromParsedResume({ full_name: "Asha", portfolio_website: "https://asha.example", experience: [{ url: "https://acme.example" }] }, "resume.pdf");
    expect(parsed.portfolioWebsite).toBe("https://asha.example/");
    expect(parsed.detectedLinks.portfolioWebsite).toBe("https://asha.example/");
    expect(parsed.experience[0]?.link).toBe("https://acme.example/");
    expect(draftFromParsedResume({ full_name: "Asha", portfolio_website: "javascript:alert(1)" }, null).portfolioWebsite).toBeNull();
  });
});
