import { z } from "zod";
import type { CandidateProfileResponse, EducationDto, ExperienceDto, ProjectDto } from "./candidateProfile.js";

export const LINKEDIN_SECTION_KEYS = ["headline", "about", "experience", "education", "projects", "skills", "achievements", "certifications", "publications", "patents", "courses", "languages", "volunteering"] as const;
export type LinkedInSectionKey = typeof LINKEDIN_SECTION_KEYS[number];
export type LinkedInImportMethod = "archive" | "pdf" | "text" | "url";
export interface LinkedInImportSection { key: LinkedInSectionKey; label: string; entries: string[]; sourceFile: string | null }
export type LinkedInProvider = "exa" | "firecrawl";
export interface LinkedInImportStatus { connected: boolean; importedAt: string | null; method: LinkedInImportMethod | null; sections: string[]; warnings: string[]; sourceUrl: string | null; provider: LinkedInProvider | null; retrievedAt: string | null }
export interface LinkedInImportDraft {
  id: string; createdAt: string; expiresAt: string; method: LinkedInImportMethod; profileRevision: string | null;
  profile: CandidateProfileResponse; sections: LinkedInImportSection[]; warnings: string[];
  sourceUrl: string | null; provider: LinkedInProvider | null; retrievedAt: string | null;
}
export interface LinkedInConfirmResponse { profile: CandidateProfileResponse | null; import: LinkedInImportStatus }
export interface LinkedInCareerProfile {
  headline: string | null; about: string | null; experience: ExperienceDto[]; education: EducationDto[];
  projects: ProjectDto[]; skills: string[]; achievements: string[];
}
export interface LinkedInProvenance { section: LinkedInSectionKey; path: string; file: string | null; quote: string; sourceUrl?: string; retrievedAt?: string }

const text = z.string().max(4000);
const nullable = text.nullable();
const strings = z.array(text).max(500);
/** ai-service /linkedin/parse result. The API adds the uploaded filename after validation. */
export const extractionSchema = z.object({
  method: z.literal("pdf"), sourceUrl: z.string().max(2048).nullable(), provider: z.null(), retrievedAt: z.null(), partial: z.literal(true),
  profile: z.object({
    headline: nullable, about: nullable,
    experience: z.array(z.object({ company: nullable, title: nullable, startDate: nullable, endDate: nullable, location: nullable, bullets: strings.nullable() })).max(500),
    education: z.array(z.object({ institution: nullable, degree: nullable, field: nullable, startYear: nullable, endYear: nullable, grade: nullable })).max(500),
    projects: z.array(z.object({ name: nullable, description: nullable, tech: strings.nullable(), bullets: strings.nullable(), link: nullable })).max(500),
    skills: strings, achievements: strings,
  }),
  sections: z.array(z.object({ key: z.enum(LINKEDIN_SECTION_KEYS), label: z.string().max(100), entries: z.array(z.string().max(24_000)).min(1).max(500), sourceFile: z.null() })).min(1).max(13),
  warnings: z.array(z.string().max(1000)).max(20),
  provenance: z.array(z.object({ section: z.enum(LINKEDIN_SECTION_KEYS), path: z.string().max(120), file: z.null(), quote: z.string().max(4000) })).max(1500),
});
export type LinkedInExtraction = z.infer<typeof extractionSchema>;

export const confirmSchema = z.object({ sections: z.array(z.enum(LINKEDIN_SECTION_KEYS)).min(1).max(13), mergeProfile: z.boolean().default(false) }).strict();

export const DISCONNECTED_LINKEDIN: LinkedInImportStatus = { connected: false, importedAt: null, method: null, sections: [], warnings: [], sourceUrl: null, provider: null, retrievedAt: null };

/** Validate the original string before URL normalization (which would erase dot-segment attacks). */
export function canonicalLinkedInUrl(value: string): string {
  const raw = value.trim();
  const match = /^https:\/\/(linkedin\.com|www\.linkedin\.com)(\/in\/[A-Za-z0-9][A-Za-z0-9_-]{0,199}\/?)(?:[?#].*)?$/.exec(raw.replace(/^https:\/\/[^/]+/i, (authority) => authority.toLowerCase()));
  if (value.length > 2048 || /[\x00-\x20\x7f\\]/.test(value) || !match) throw new Error("invalid LinkedIn URL");
  return `https://www.linkedin.com${match[2]!.replace(/\/$/, "")}/`;
}

/** Canonical profile URL, or null when absent or unsafe. Never throws. */
export function safeLinkedInUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { return canonicalLinkedInUrl(value); } catch { return null; }
}

/** Confirmed source receipt. New imports are PDFs; legacy Firecrawl/Exa URL snapshots stay readable. */
export function importedStatus(data: Record<string, unknown> | undefined): LinkedInImportStatus {
  const method = data?.importMethod;
  const timestamp = data?.importedAt;
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const keys = sections.flatMap((s) => {
    const key = typeof s === "object" && s !== null && "key" in s ? s.key : null;
    return typeof key === "string" && LINKEDIN_SECTION_KEYS.includes(key as LinkedInSectionKey) ? [key] : [];
  });
  if ((method !== "pdf" && method !== "url") || typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)) || keys.length === 0) {
    return { ...DISCONNECTED_LINKEDIN };
  }
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter((w): w is string => typeof w === "string") : [];
  if (method === "pdf") {
    return { connected: true, importedAt: timestamp, method, sections: keys, sourceUrl: safeLinkedInUrl(data?.sourceUrl), provider: null, retrievedAt: null, warnings };
  }
  if ((data?.provider !== "exa" && data?.provider !== "firecrawl") || typeof data?.sourceUrl !== "string" || typeof data?.retrievedAt !== "string" || !Number.isFinite(Date.parse(data.retrievedAt)) || !safeLinkedInUrl(data.sourceUrl)) {
    return { ...DISCONNECTED_LINKEDIN };
  }
  return { connected: true, importedAt: timestamp, method, sections: keys,
    sourceUrl: data.sourceUrl, provider: data.provider, retrievedAt: data.retrievedAt, warnings };
}
