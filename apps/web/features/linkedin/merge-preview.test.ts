import { describe, expect, it } from "vitest";
import type { CandidateProfileResponse } from "@/features/onboarding/types";
import { previewLinkedInMerge } from "./merge-preview";

const profile: CandidateProfileResponse = {
  level: "sde3", headline: "Current headline", fullName: "Owner", email: null, phone: null, location: null,
  targetRole: "My target", targetJdId: null, education: [], experience: [{ company: "Acme", title: "Engineer", startDate: "2020", endDate: "2022", location: null, bullets: ["Current achievement"] }],
  projects: [], skills: ["SQL"], achievements: [], detectedLinks: { github: null, leetcode: null, linkedin: null },
  resumeFilename: null, resumeParsedAt: null, onboardingComplete: false,
};

describe("LinkedIn profile merge preview", () => {
  it("keeps headline and date conflicts unchanged, deduplicates strings and appends only new rows", () => {
    const incoming = { ...profile, level: null, headline: "New headline", experience: [
      { ...profile.experience[0], company: "acme", title: "engineer", startDate: "2019", bullets: ["Imported claim"] },
      { ...profile.experience[0], company: "New company" },
    ], skills: ["sql", "TypeScript", " TypeScript "] };
    const before = structuredClone(profile);
    const result = previewLinkedInMerge(profile, incoming, [
      { key: "headline", label: "Headline", entries: ["New headline"], sourceFile: null },
      { key: "experience", label: "Experience", entries: ["Engineer"], sourceFile: null },
      { key: "skills", label: "Skills", entries: ["SQL", "TypeScript"], sourceFile: null },
    ]);
    expect(result[0].append).toEqual([]);
    expect(result[0].notes[0]).toContain("will not overwrite");
    expect(result[1].append).toEqual(["Engineer · New company · 2020 · 2022 · Current achievement"]);
    expect(result[1].notes[0]).toContain("Possible date conflict");
    expect(result[1].notes[0]).toContain("Existing row stays unchanged");
    expect(result[2].append).toEqual(["TypeScript"]);
    expect(profile).toEqual(before);
  });

  it("previews blank role-field filling and unique bullet additions while keeping non-empty edits", () => {
    const current = { ...profile, experience: [{ ...profile.experience[0], startDate: null, location: "Keep city" }] };
    const incoming = { ...profile, experience: [{ ...profile.experience[0], location: "Imported city", bullets: [" current achievement ", "New bullet", "New bullet"] }] };
    const result = previewLinkedInMerge(current, incoming, [{ key: "experience", label: "Experience", entries: ["Engineer"], sourceFile: null }]);
    expect(result[0].append).toEqual(["Acme · Engineer — fill blank start date: 2020; append new bullets: New bullet"]);
    expect(current.experience[0].location).toBe("Keep city");
    expect(current.experience[0].startDate).toBeNull();
  });

  it("fills only a blank headline and keeps non-editable sections as source evidence", () => {
    const result = previewLinkedInMerge(null, profile, [
      { key: "headline", label: "Headline", entries: ["Current headline"], sourceFile: null },
      { key: "certifications", label: "Certifications", entries: ["Certificate"], sourceFile: null },
    ]);
    expect(result[0].append).toEqual(["Current headline"]);
    expect(result[1].append).toEqual([]);
    expect(result[1].notes).toEqual(["Source evidence only — there is no matching editable profile field for this section."]);
  });
});
