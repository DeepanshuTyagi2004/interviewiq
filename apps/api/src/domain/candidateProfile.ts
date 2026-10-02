import { isObject, items } from "../lib/json.js";

/**
 * The editable, user-owned candidate details (onboarding + profile page) and their normalizers.
 *
 * Every nested entry is normalized to a fixed shape with explicit nulls — the same shape the
 * Spring DTO records produced — so what we store, return, and forward to the AI service is
 * stable regardless of what extra or missing keys a client sends.
 */

/** Years are verbatim strings from the resume ("2021", "2021-2025", or null). */
export interface EducationDto {
  institution: string | null;
  degree: string | null;
  field: string | null;
  startYear: string | null;
  endYear: string | null;
  grade: string | null;
}

export interface ExperienceDto {
  company: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  bullets: string[] | null;
}

/** A resume project (personal/academic/side) — distinct from work experience. */
export interface ProjectDto {
  name: string | null;
  description: string | null;
  tech: string[] | null;
  bullets: string[] | null;
  link: string | null;
}

/** Profile URLs detected in the resume — prefill the connectors step. */
export interface ResumeLinksDto {
  github: string | null;
  leetcode: string | null;
  linkedin: string | null;
}

export interface CandidateProfileResponse {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  targetRole: string | null;
  /** The JD picked on onboarding's Target step (its label is `targetRole`). */
  targetJdId: string | null;
  education: EducationDto[];
  experience: ExperienceDto[];
  projects: ProjectDto[];
  skills: string[];
  achievements: string[];
  detectedLinks: ResumeLinksDto;
  resumeFilename: string | null;
  resumeParsedAt: Date | null;
  onboardingComplete: boolean;
}

/** Scalar → string, null/absent → null (Jackson's scalar coercion for String fields). */
export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** A JSON array of strings; null/absent → null. */
export function strList(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  return items(v).map((x) => str(x) ?? "");
}

export function education(v: unknown): EducationDto {
  const o = isObject(v) ? v : {};
  return {
    institution: str(o.institution),
    degree: str(o.degree),
    field: str(o.field),
    startYear: str(o.startYear),
    endYear: str(o.endYear),
    grade: str(o.grade),
  };
}

export function experience(v: unknown): ExperienceDto {
  const o = isObject(v) ? v : {};
  return {
    company: str(o.company),
    title: str(o.title),
    startDate: str(o.startDate),
    endDate: str(o.endDate),
    location: str(o.location),
    bullets: strList(o.bullets),
  };
}

export function project(v: unknown): ProjectDto {
  const o = isObject(v) ? v : {};
  return {
    name: str(o.name),
    description: str(o.description),
    tech: strList(o.tech),
    bullets: strList(o.bullets),
    link: str(o.link),
  };
}

export function links(v: unknown): ResumeLinksDto {
  const o = isObject(v) ? v : {};
  return { github: str(o.github), leetcode: str(o.leetcode), linkedin: str(o.linkedin) };
}

export const EMPTY_LINKS: ResumeLinksDto = Object.freeze({ github: null, leetcode: null, linkedin: null });

/** Normalize a JSON array with `fn`; null/absent → null (so callers can apply their fallback). */
export function listOf<T>(v: unknown, fn: (x: unknown) => T): T[] | null {
  if (v === null || v === undefined) return null;
  return items(v).map(fn);
}

/**
 * The AI service's `/resumes/parse` result (snake_case on the wire). Unknown keys are ignored so a
 * prompt/schema tweak on the AI side can't break the parse.
 */
export function draftFromParsedResume(parsed: unknown, filename: string | null): CandidateProfileResponse {
  const p = isObject(parsed) ? parsed : {};
  const l = isObject(p.links) ? p.links : null;
  return {
    fullName: str(p.full_name),
    email: str(p.email),
    phone: str(p.phone),
    location: str(p.location),
    headline: str(p.headline),
    targetRole: null,
    targetJdId: null,
    education: items(p.education).map((e) => {
      const o = isObject(e) ? e : {};
      return {
        institution: str(o.institution),
        degree: str(o.degree),
        field: str(o.field),
        startYear: str(o.start_year),
        endYear: str(o.end_year),
        grade: str(o.grade),
      };
    }),
    experience: items(p.experience).map((x) => {
      const o = isObject(x) ? x : {};
      return {
        company: str(o.company),
        title: str(o.title),
        startDate: str(o.start_date),
        endDate: str(o.end_date),
        location: str(o.location),
        bullets: strList(o.bullets) ?? [],
      };
    }),
    projects: items(p.projects).map((x) => {
      const o = isObject(x) ? x : {};
      return {
        name: str(o.name),
        description: str(o.description),
        tech: strList(o.tech) ?? [],
        bullets: strList(o.bullets) ?? [],
        link: str(o.link),
      };
    }),
    skills: strList(p.skills) ?? [],
    achievements: strList(p.achievements) ?? [],
    detectedLinks: l ? { github: str(l.github), leetcode: str(l.leetcode), linkedin: str(l.linkedin) } : { ...EMPTY_LINKS },
    resumeFilename: filename,
    resumeParsedAt: null,
    onboardingComplete: false,
  };
}
