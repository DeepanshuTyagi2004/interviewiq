import type { CandidateFormValues } from "./form";
import type { CandidateProfileRequest, CandidateProfileResponse } from "./types";

const trimToNull = (s: string): string | null => {
  const t = s.trim();
  return t === "" ? null : t;
};

/**
 * Highlights text → lines. Keeps leading spaces (they encode nested bullets in the Markdown
 * format — see highlights-format.ts) and drops blank lines.
 */
const toLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");

/** API response (or parsed draft) → editable form values. */
export function responseToForm(r: CandidateProfileResponse): CandidateFormValues {
  return {
    fullName: r.fullName ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    location: r.location ?? "",
    headline: r.headline ?? "",
    targetRole: r.targetRole ?? "",
    targetJdId: r.targetJdId ?? "",
    education: (r.education ?? []).map((e) => ({
      institution: e.institution ?? "",
      degree: e.degree ?? "",
      field: e.field ?? "",
      startYear: e.startYear ?? "",
      endYear: e.endYear ?? "",
      grade: e.grade ?? "",
    })),
    experience: (r.experience ?? []).map((x) => ({
      company: x.company ?? "",
      title: x.title ?? "",
      startDate: x.startDate ?? "",
      endDate: x.endDate ?? "",
      location: x.location ?? "",
      bulletsText: (x.bullets ?? []).join("\n"),
    })),
    projects: (r.projects ?? []).map((p) => ({
      name: p.name ?? "",
      description: p.description ?? "",
      techText: (p.tech ?? []).join(", "),
      bulletsText: (p.bullets ?? []).join("\n"),
      link: p.link ?? "",
    })),
    skillsText: (r.skills ?? []).join(", "),
    achievementsText: (r.achievements ?? []).join("\n"),
    detectedLinks: {
      github: r.detectedLinks?.github ?? "",
      leetcode: r.detectedLinks?.leetcode ?? "",
      linkedin: r.detectedLinks?.linkedin ?? "",
    },
    resumeFilename: r.resumeFilename ?? null,
  };
}

/** Editable form values → PUT payload. Trims blanks to null and drops fully-empty rows. */
export function formToRequest(v: CandidateFormValues, complete: boolean): CandidateProfileRequest {
  const education = v.education
    .map((e) => ({
      institution: trimToNull(e.institution),
      degree: trimToNull(e.degree),
      field: trimToNull(e.field),
      startYear: trimToNull(e.startYear),
      endYear: trimToNull(e.endYear),
      grade: trimToNull(e.grade),
    }))
    .filter((e) => Object.values(e).some((val) => val !== null));

  const experience = v.experience
    .map((x) => ({
      company: trimToNull(x.company),
      title: trimToNull(x.title),
      startDate: trimToNull(x.startDate),
      endDate: trimToNull(x.endDate),
      location: trimToNull(x.location),
      bullets: toLines(x.bulletsText),
    }))
    .filter(
      (x) =>
        x.company || x.title || x.location || x.startDate || x.endDate || x.bullets.length > 0,
    );

  const projects = v.projects
    .map((p) => ({
      name: trimToNull(p.name),
      description: trimToNull(p.description),
      tech: p.techText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      bullets: toLines(p.bulletsText),
      link: trimToNull(p.link),
    }))
    .filter((p) => p.name || p.description || p.link || p.tech.length > 0 || p.bullets.length > 0);

  const skills = v.skillsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const achievements = v.achievementsText
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);

  return {
    fullName: trimToNull(v.fullName),
    email: trimToNull(v.email),
    phone: trimToNull(v.phone),
    location: trimToNull(v.location),
    headline: trimToNull(v.headline),
    targetRole: trimToNull(v.targetRole),
    targetJdId: trimToNull(v.targetJdId),
    education,
    experience,
    projects,
    skills,
    achievements,
    detectedLinks: {
      github: trimToNull(v.detectedLinks.github),
      leetcode: trimToNull(v.detectedLinks.leetcode),
      linkedin: trimToNull(v.detectedLinks.linkedin),
    },
    resumeFilename: v.resumeFilename,
    complete,
  };
}
