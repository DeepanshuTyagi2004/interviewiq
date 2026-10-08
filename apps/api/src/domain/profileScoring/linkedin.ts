import type { ScoringProfile } from "./types.js";
import { industryContributionClaims, semanticClaims, type SemanticClaim } from "./experience.js";
import { cleanText, list, object, sortedUnique, textList } from "./sanitization.js";
import { sanitizeProfile, validTimestamp } from "./adapters.js";
import { linkedInProvider } from "./config.js";

const sectionKeys = ["headline", "about", "experience", "education", "projects", "skills", "achievements", "certifications", "publications", "patents", "courses", "languages", "volunteering"];
const emptyProfile = (): ScoringProfile => ({ headline: null, education: [], experience: [], projects: [], skills: [], achievements: [] });
const claimsForText = (text: string): SemanticClaim[] => {
  const profile = { ...emptyProfile(), projects: [{ name: null, description: text, tech: [], bullets: [], link: null }] };
  return [...semanticClaims(profile), ...industryContributionClaims(profile)];
};
/** Store only sentences supported by the existing authorized semantic registry. No raw section text. */
const semanticText = (value: unknown, identities: string[]): string | null => {
  const text = cleanText(value, identities);
  if (!text) return null;
  return sortedUnique(claimsForText(text).map((x) => x.claim)).join(" ") || null;
};
const semanticList = (value: unknown, identities: string[]): string[] => sortedUnique(list(value)
  .flatMap((x) => { const text = semanticText(x, identities); return text ? [text] : []; }));
const safePath = (value: unknown): string | null => typeof value === "string"
  && /^(?:profile\.)?(?:headline|about|experience|education|projects|skills|achievements|certifications|publications|patents|sections)(?:\[\d{1,5}\]|\.\d{1,5}|\.(?:headline|about|title|description|bullets|entries|name|tech))*$/.test(value) ? value : null;
const safeFile = (value: unknown): string | null => {
  // Only allow well-known archive member receipts, never an uploaded person's filename/path.
  const name = typeof value === "string" ? value.split(/[\\/]/).at(-1) : null;
  return name && /^(?:Profile|Positions|Education|Projects|Skills|Certifications|Publications|Patents|Honors)\.csv$/i.test(name) ? name.toLowerCase() : null;
};

export function sanitizeLinkedIn(raw: Record<string, unknown>, knownIdentities: string[] = [], version = "profile-beta-v3"): Record<string, unknown> {
  const p = object(raw.profile);
  const identities = [...knownIdentities, ...[raw, p].flatMap((x) => [x.fullName, x.name, x.email, x.phone, x.location]),
    ...list(p.experience).flatMap((x) => [object(x).company, object(x).location]),
    ...list(p.education).map((x) => object(x).institution)].filter((x): x is string => typeof x === "string");
  const selected = sortedUnique(list(raw.sections).map((x) => object(x).key).filter((x): x is string => typeof x === "string" && sectionKeys.includes(x)));
  const profile = sanitizeProfile({ ...emptyProfile(),
    experience: selected.includes("experience") ? list(p.experience).map((x) => { const entry = object(x); return {
      title: null, startDate: cleanText(entry.startDate), endDate: cleanText(entry.endDate), bullets: semanticList(entry.bullets, identities),
    }; }) : [],
    projects: selected.includes("projects") ? list(p.projects).map((x) => { const entry = object(x); return {
      name: null, description: semanticText(entry.description, identities), bullets: semanticList(entry.bullets, identities), tech: [], link: null,
    }; }) : [],
    skills: selected.includes("skills") ? textList(p.skills, identities) : [],
  }, identities)!;
  // Identity/title/education, achievement strings and extra section entries are contextual, not new numeric evidence.
  const about = selected.includes("about") ? semanticText(p.about, identities) : null;
  const semantic = linkedInClaims({ profile, about });
  const provenance = sortedUnique(list(raw.provenance).flatMap((value) => {
    const x = object(value), path = safePath(x.path);
    if (typeof x.section !== "string" || !selected.includes(x.section) || !path) return [];
    const quote = cleanText(x.quote, identities);
    if (!quote) return [];
    // Keep the scored sentence, not the rest of a potentially identity-bearing archive row.
    return semantic.filter((claim) => quote.includes(claim.claim)
      && (raw.importMethod !== "url" || claim.path.startsWith(`fragments.linkedin.profile.${x.section}`)))
      .map((claim) => ({ section: x.section as string, path, file: safeFile(x.file), quote: claim.claim }));
  }));
  return { importMethod: ["archive", "pdf", "text", "url"].includes(String(raw.importMethod)) ? raw.importMethod : null,
    // URL and provider response identities never enter the minimized input or its content hash.
    ...(raw.importMethod === "url" ? { provider: linkedInProvider(raw.provider, version),
      retrievedAt: validTimestamp(raw.retrievedAt) ? new Date(raw.retrievedAt).toISOString() : "invalid" } : {}),
    importedAt: validTimestamp(raw.importedAt) ? new Date(raw.importedAt).toISOString() : "invalid", partial: raw.importMethod === "url" || raw.partial === true,
    profile: { ...profile, about }, sections: selected.map((key) => ({ key })), provenance };
}

/** About uses the same sentence-level policy as delivery/project descriptions; it never reads a title. */
export function linkedInClaims(data: Record<string, unknown>): SemanticClaim[] {
  const p = object(data.profile) as unknown as ScoringProfile & { about?: string | null };
  const profile = { ...emptyProfile(), ...p };
  const claims = [...semanticClaims(profile), ...industryContributionClaims(profile)];
  const about = typeof data.about === "string" ? data.about : p.about;
  if (about) claims.push(...claimsForText(about).map((x) => ({ ...x, path: "profile.about" })));
  return claims.map((x) => ({ ...x, path: `fragments.linkedin.${x.path}` }));
}
