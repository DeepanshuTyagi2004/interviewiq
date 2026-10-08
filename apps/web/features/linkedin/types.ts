import type { components } from "@/lib/api-client/generated/schema";

// Runtime selection keys and generated wire contracts share the same canonical values.
export const LINKEDIN_SECTION_KEYS = [
  "headline", "about", "experience", "education", "projects", "skills", "achievements",
  "certifications", "publications", "patents", "courses", "languages", "volunteering",
] as const satisfies readonly components["schemas"]["LinkedInSectionKey"][];
export type LinkedInSectionKey = components["schemas"]["LinkedInSectionKey"];
export type LinkedInMethod = "pdf" | "url";
/** Mirrors the API's upload limit; the server enforces it again. */
export const LINKEDIN_PDF_MAX_BYTES = 5 * 1024 * 1024;
export type LinkedInImportSection = components["schemas"]["LinkedInImportSection"];
export type LinkedInImportStatus = components["schemas"]["LinkedInImportStatus"];
export type LinkedInImportDraft = components["schemas"]["LinkedInImportDraft"];
export type LinkedInImportConfirmation = components["schemas"]["LinkedInImportConfirmation"];

export function isSupportedSection(key: string): key is LinkedInSectionKey {
  return LINKEDIN_SECTION_KEYS.some((allowed) => allowed === key);
}
