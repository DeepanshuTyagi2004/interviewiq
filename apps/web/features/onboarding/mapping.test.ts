import { describe, expect, it } from "vitest";
import { responseToForm, formToRequest } from "./mapping";
import type { CandidateProfileResponse } from "./types";

const sample: CandidateProfileResponse = {
  fullName: "Asha Rao",
  email: "asha@example.com",
  phone: null,
  location: "Delhi",
  headline: null,
  targetRole: "SDE",
  education: [
    { institution: "IIT", degree: "B.Tech", field: "CS", startYear: "2021", endYear: "2025", grade: "8.9" },
  ],
  experience: [
    { company: "Acme", title: "Intern", startDate: "2024", endDate: "2024", location: "Remote", bullets: ["Built X", "Shipped Y"] },
  ],
  projects: [
    { name: "Relay", description: "Mac automation", tech: ["Node.js", "WebSocket"], bullets: ["Built agent", "72% fewer tokens"], link: "https://github.com/asha/relay" },
  ],
  skills: ["Python", "SQL"],
  achievements: ["SIH 2024 finalist", "GSoC 2023"],
  detectedLinks: { github: "https://github.com/asha", leetcode: null, linkedin: null },
  resumeFilename: "resume.pdf",
  resumeParsedAt: null,
  onboardingComplete: false,
};

describe("responseToForm", () => {
  it("maps nulls to empty strings and joins bullets/skills for editing", () => {
    const form = responseToForm(sample);
    expect(form.fullName).toBe("Asha Rao");
    expect(form.phone).toBe("");
    expect(form.experience[0].bulletsText).toBe("Built X\nShipped Y");
    expect(form.skillsText).toBe("Python, SQL");
    expect(form.projects[0].techText).toBe("Node.js, WebSocket");
    expect(form.projects[0].bulletsText).toBe("Built agent\n72% fewer tokens");
    expect(form.achievementsText).toBe("SIH 2024 finalist\nGSoC 2023");
    expect(form.detectedLinks.leetcode).toBe("");
    expect(form.resumeFilename).toBe("resume.pdf");
  });
});

describe("formToRequest", () => {
  it("round-trips, trimming blanks to null and splitting bullets/skills", () => {
    const req = formToRequest(responseToForm(sample), true);
    expect(req.complete).toBe(true);
    expect(req.phone).toBeNull();
    expect(req.experience[0].bullets).toEqual(["Built X", "Shipped Y"]);
    expect(req.skills).toEqual(["Python", "SQL"]);
    expect(req.projects[0].tech).toEqual(["Node.js", "WebSocket"]);
    expect(req.projects[0].bullets).toEqual(["Built agent", "72% fewer tokens"]);
    expect(req.achievements).toEqual(["SIH 2024 finalist", "GSoC 2023"]);
    expect(req.detectedLinks.github).toBe("https://github.com/asha");
    expect(req.detectedLinks.leetcode).toBeNull();
  });

  it("drops fully-empty education/experience rows", () => {
    const form = responseToForm(sample);
    form.education.push({ institution: "", degree: "", field: "", startYear: "", endYear: "", grade: "" });
    form.experience.push({ company: "  ", title: "", startDate: "", endDate: "", location: "", bulletsText: "" });
    const req = formToRequest(form, false);
    expect(req.education).toHaveLength(1);
    expect(req.experience).toHaveLength(1);
    expect(req.complete).toBe(false);
  });

  it("keeps an experience row that has only dates", () => {
    const form = responseToForm(sample);
    form.experience = [
      { company: "", title: "", startDate: "Jun 2024", endDate: "Present", location: "", bulletsText: "" },
    ];
    const req = formToRequest(form, false);
    expect(req.experience).toHaveLength(1);
    expect(req.experience[0].startDate).toBe("Jun 2024");
    expect(req.experience[0].endDate).toBe("Present");
  });

  it("keeps an experience row that has only highlights", () => {
    const form = responseToForm(sample);
    form.experience = [
      { company: "", title: "", startDate: "", endDate: "", location: "", bulletsText: "Did a thing\n\n  " },
    ];
    const req = formToRequest(form, false);
    expect(req.experience).toHaveLength(1);
    expect(req.experience[0].bullets).toEqual(["Did a thing"]);
  });
});
