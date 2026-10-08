import type { CompanyRow, JobDescriptionRow } from "../db/pg/schema.js";
import type { EngineeringLevel } from "../domain/engineeringLevels.js";
import { normalizeLegacyLevel } from "../domain/engineeringLevels.js";
import type { EnrichmentBrief } from "../domain/enrichment.js";
import type { FitRound } from "../domain/jdFit/types.js";
import { isObject, items, path, textOrNull } from "../lib/json.js";

/**
 * Which JDs students see and which brief backs each one. Shared by `GET /jds` and `GET /jd-fit`, so
 * fit is only ever computed for the roles the library shows, against the rounds the JD page shows.
 */

/** A company students must not see: its row exists and is unpublished or archived. */
export const isHiddenCompany = (co: CompanyRow): boolean => co.publishedAt === null || co.status === "archived";

export interface JdListFilters {
  company: string | null;
  level: EngineeringLevel | null;
  specialization: string | null;
}

const eqIgnoreCase = (a: string, b: string | null): boolean => b !== null && a.toLowerCase() === b.toLowerCase();

/** `GET /jds`: active JDs (in repository order) from visible companies, filtered case-insensitively. */
export function visibleJds(companies: CompanyRow[], jds: JobDescriptionRow[], f: JdListFilters): JobDescriptionRow[] {
  const hidden = new Set(companies.filter(isHiddenCompany).map((co) => co.slug));
  return jds
    .filter((j) => !hidden.has(j.company))
    .filter((j) => f.company === null || eqIgnoreCase(f.company, j.company))
    .filter((j) => f.level === null || f.level === normalizeLegacyLevel(j.level))
    .filter((j) => f.specialization === null || eqIgnoreCase(f.specialization, j.specialization));
}

/** `GET /jds/{id}`: inactive seed JDs stay readable (booked sessions), retired manual/template ones and hidden companies don't. */
export function jdDetailVisible(j: JobDescriptionRow | null, company: CompanyRow | null): j is JobDescriptionRow {
  return j !== null && (j.active || (j.source !== "manual" && j.source !== "template")) && !(company !== null && isHiddenCompany(company));
}

export function splitCsv(csv: string | null): string[] {
  if (csv === null || csv.trim() === "") return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export interface JdBriefDeps {
  enrichment: { briefForJd(jdId: string): Promise<EnrichmentBrief | null> };
  aiService: { fetchBrief(company: string, role: string, level: string, specialization: string | null, options?: { timeoutMs?: number }): Promise<unknown | null> };
}

/** The brief behind a JD's process: the admin-published one, else the AI-service brief (never for practice templates). */
export async function resolveJdBrief(deps: JdBriefDeps, j: JobDescriptionRow, options?: { timeoutMs?: number }): Promise<{ manual: EnrichmentBrief | null; brief: unknown | null }> {
  const manual = await deps.enrichment.briefForJd(j.id);
  if (manual) return { manual, brief: manual };
  return { manual: null, brief: j.source === "template" ? null : await deps.aiService.fetchBrief(j.company, j.role, j.level, j.specialization, options) };
}

/** A brief's rounds as the JD page reads them: `final_experience`, else the older `consolidated_process`. */
export function briefRounds(brief: unknown): FitRound[] {
  const current = path(brief, "final_experience");
  const process = isObject(current) ? current : path(brief, "consolidated_process");
  return items(path(process, "rounds")).map((r) => ({
    topics: items(path(r, "topics")).filter((t): t is string => typeof t === "string"),
    difficulty: textOrNull(path(r, "difficulty")),
    type: textOrNull(path(r, "type")),
  }));
}
