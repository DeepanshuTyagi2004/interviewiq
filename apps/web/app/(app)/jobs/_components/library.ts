/**
 * Pure helpers for the company library (`/jobs`). Everything a card or row shows is derived from
 * what the API returns: the companies list and each JD's `dataAvailability`. No sample numbers.
 */
import type { DataAvailability, JdSummary, JobCompany } from "@/features/jobs";

const LEVEL_ORDER = ["fresher", "sde1", "sde2", "sde3"];
const LEVEL_LABEL: Record<string, string> = {
  fresher: "Fresher",
  sde1: "SDE I",
  sde2: "SDE II",
  sde3: "SDE III",
};

/** "sde1" → "SDE I"; unknown levels are shown as given. */
export function levelLabel(level: string): string {
  return LEVEL_LABEL[level] ?? level;
}

function levelRank(level: string): number {
  const i = LEVEL_ORDER.indexOf(level);
  return i === -1 ? LEVEL_ORDER.length : i;
}

const ACRONYMS: Record<string, string> = { ml: "ML", ai: "AI", sre: "SRE", qa: "QA", ios: "iOS", devops: "DevOps" };

/** "data-engineering" → "Data engineering", "ml" → "ML". */
export function specializationLabel(value: string): string {
  const words = value.trim().toLowerCase().split(/[-_\s]+/).filter(Boolean);
  return words
    .map((w, i) => ACRONYMS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const AVAILABILITY_RANK: Record<DataAvailability, number> = { none: 0, limited: 1, available: 2, rich: 3 };

function rankOf(a: DataAvailability | undefined): number {
  return a ? (AVAILABILITY_RANK[a] ?? 0) : 0;
}

/** A role is "live" once its brief has medium or high confidence. */
export function isLiveJd(jd: JdSummary): boolean {
  return jd.dataAvailability === "rich" || jd.dataAvailability === "available";
}

export type Depth = { bars: number; label: string };

/**
 * The design's 5-step "data depth" meter, driven by the brief's real data confidence
 * (`dataAvailability` is high → rich, medium → available, low → limited, no brief → none). The
 * bar positions reuse the design's own scale, where Low = 2, Medium = 3 and High = 5.
 */
const DEPTH: Record<DataAvailability, Depth> = {
  none: { bars: 0, label: "None yet" },
  limited: { bars: 2, label: "Low" },
  available: { bars: 3, label: "Medium" },
  rich: { bars: 5, label: "High" },
};

export const DEPTH_STEPS = 5;

export function depthOf(availability: DataAvailability | undefined): Depth {
  return (availability && DEPTH[availability]) || DEPTH.none;
}

export type CompanyEntry = {
  slug: string;
  name: string;
  /** Best data availability across the company's roles. */
  availability: DataAvailability;
  live: boolean;
  /** Roles, best-researched first. */
  jds: JdSummary[];
  liveJds: JdSummary[];
};

function compareJds(a: JdSummary, b: JdSummary): number {
  return (
    rankOf(b.dataAvailability) - rankOf(a.dataAvailability) ||
    levelRank(a.level) - levelRank(b.level) ||
    a.title.localeCompare(b.title)
  );
}

/**
 * One entry per company, from the companies list plus any company that only appears on a JD (so a
 * role is never hidden because the companies call failed or lags). Live companies first, then the
 * ones with more roles, then by name.
 */
export function buildCompanyEntries(
  companies: JobCompany[] | undefined,
  jds: JdSummary[] | undefined,
): CompanyEntry[] {
  const names = new Map<string, string>();
  for (const c of companies ?? []) if (!names.has(c.slug)) names.set(c.slug, c.name);
  const bySlug = new Map<string, JdSummary[]>();
  for (const jd of jds ?? []) {
    if (!names.has(jd.company)) names.set(jd.company, jd.companyName || jd.company);
    bySlug.set(jd.company, [...(bySlug.get(jd.company) ?? []), jd]);
  }

  return [...names.entries()]
    .map(([slug, name]) => {
      const roles = [...(bySlug.get(slug) ?? [])].sort(compareJds);
      const liveJds = roles.filter(isLiveJd);
      return {
        slug,
        name,
        availability: roles[0]?.dataAvailability ?? "none",
        live: liveJds.length > 0,
        jds: roles,
        liveJds,
      } satisfies CompanyEntry;
    })
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) || b.jds.length - a.jds.length || a.name.localeCompare(b.name),
    );
}

export type StatusFilter = "all" | "live" | "researching";

export type LibraryMatch = { entry: CompanyEntry; jds: JdSummary[] };

/**
 * Apply the search box and the All / Live / Researching filter. A company matches the search by
 * name or slug (then all its roles are listed) or through a role title or specialization (then
 * only those roles are).
 */
export function filterLibrary(
  entries: CompanyEntry[],
  { query, status }: { query: string; status: StatusFilter },
): LibraryMatch[] {
  const q = query.trim().toLowerCase();
  const out: LibraryMatch[] = [];
  for (const entry of entries) {
    if (status === "live" && !entry.live) continue;
    if (status === "researching" && entry.live) continue;
    if (!q || entry.name.toLowerCase().includes(q) || entry.slug.toLowerCase().includes(q)) {
      out.push({ entry, jds: entry.jds });
      continue;
    }
    const jds = entry.jds.filter(
      (jd) =>
        jd.title.toLowerCase().includes(q) ||
        (jd.specialization ?? "").toLowerCase().includes(q) ||
        levelLabel(jd.level).toLowerCase().includes(q),
    );
    if (jds.length > 0) out.push({ entry, jds });
  }
  return out;
}

/** Distinct specializations present in these roles, alphabetical. */
export function specializationsOf(jds: JdSummary[]): string[] {
  return [...new Set(jds.map((jd) => jd.specialization).filter((s): s is string => Boolean(s)))].sort();
}

export type LevelGroup = { level: string; label: string; jds: JdSummary[] };

/** Roles grouped by experience level (Fresher, SDE I, …), best-researched first within a level. */
export function groupByLevel(jds: JdSummary[]): LevelGroup[] {
  const map = new Map<string, JdSummary[]>();
  for (const jd of jds) map.set(jd.level, [...(map.get(jd.level) ?? []), jd]);
  return [...map.entries()]
    .sort(([a], [b]) => levelRank(a) - levelRank(b) || a.localeCompare(b))
    .map(([level, list]) => ({ level, label: levelLabel(level), jds: [...list].sort(compareJds) }));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 roles · 1 live", "1 role", "No roles yet". */
export function rolesLine(entry: CompanyEntry): string {
  if (entry.jds.length === 0) return "No roles yet";
  const roles = plural(entry.jds.length, "role");
  return entry.live ? `${roles} · ${entry.liveJds.length} live` : roles;
}

/** How many of the company's roles have a researched process at all (any brief, any confidence).
 *  Null for a company with no roles: the card already says so. */
export function researchedLine(entry: CompanyEntry): string | null {
  const total = entry.jds.length;
  if (total === 0) return null;
  const researched = entry.jds.filter((jd) => jd.dataAvailability !== "none").length;
  if (total === 1) return researched ? "Interview process researched" : "Not researched yet";
  if (researched === 0) return "Not researched yet";
  return `${researched} of ${total} roles researched`;
}

export type CardCta =
  | { kind: "open"; jd: JdSummary; primary: boolean }
  | { kind: "roles"; count: number; primary: boolean }
  | { kind: "none" };

/**
 * The card's action. One live role: open it (the design's "Open SDE I Backend →"). Several live
 * roles: jump to the company's roles. No live role: the same, but quiet. No roles: no action.
 */
export function cardCta(entry: CompanyEntry): CardCta {
  if (entry.jds.length === 0) return { kind: "none" };
  if (entry.liveJds.length === 1) return { kind: "open", jd: entry.liveJds[0], primary: true };
  if (entry.liveJds.length > 1) return { kind: "roles", count: entry.jds.length, primary: true };
  if (entry.jds.length === 1) return { kind: "open", jd: entry.jds[0], primary: false };
  return { kind: "roles", count: entry.jds.length, primary: false };
}
