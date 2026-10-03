/**
 * Pure filter/sort helpers for a company's role list. The filter state lives in the URL
 * (`?q=&level=&spec=&stack=&minPay=&maxYoe=&depth=&sort=`) so a filtered view is shareable and the
 * back button works; these functions turn it into a typed object and back.
 */
import type { JdSummary } from "@/features/jobs";
import { isLiveJd, levelLabel } from "./library";

export type SortKey = "recommended" | "pay-desc" | "yoe-asc" | "title";

export interface RoleFilters {
  q: string;
  levels: string[];
  specs: string[];
  stack: string[];
  /** Keep roles whose top pay is at least this many LPA. */
  minPay: number | null;
  /** Keep roles that ask for at most this many years of experience. */
  maxYoe: number | null;
  /** Only roles with a researched process (medium/high data depth). */
  researchedOnly: boolean;
  sort: SortKey;
}

export const EMPTY_FILTERS: RoleFilters = { q: "", levels: [], specs: [], stack: [], minPay: null, maxYoe: null, researchedOnly: false, sort: "recommended" };

export const PAY_STEPS = [5, 10, 20, 30, 50, 80];
export const YOE_STEPS = [1, 2, 3, 5, 8];
export const SORTS: { value: SortKey; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "pay-desc", label: "Pay: high to low" },
  { value: "yoe-asc", label: "Experience: low to high" },
  { value: "title", label: "Title A–Z" },
];

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const intOrNull = (v: string | null) => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function parseFilters(sp: URLSearchParams): RoleFilters {
  const sort = sp.get("sort");
  return {
    q: sp.get("q") ?? "",
    levels: list(sp.get("level")),
    specs: list(sp.get("spec")),
    stack: list(sp.get("stack")),
    minPay: intOrNull(sp.get("minPay")),
    maxYoe: intOrNull(sp.get("maxYoe")),
    researchedOnly: sp.get("researched") === "1",
    sort: SORTS.some((s) => s.value === sort) ? (sort as SortKey) : "recommended",
  };
}

export function toSearchParams(f: RoleFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.levels.length) sp.set("level", f.levels.join(","));
  if (f.specs.length) sp.set("spec", f.specs.join(","));
  if (f.stack.length) sp.set("stack", f.stack.join(","));
  if (f.minPay !== null) sp.set("minPay", String(f.minPay));
  if (f.maxYoe !== null) sp.set("maxYoe", String(f.maxYoe));
  if (f.researchedOnly) sp.set("researched", "1");
  if (f.sort !== "recommended") sp.set("sort", f.sort);
  return sp;
}

export function activeFilterCount(f: RoleFilters): number {
  return (f.q.trim() ? 1 : 0) + f.levels.length + f.specs.length + f.stack.length + (f.minPay !== null ? 1 : 0) + (f.maxYoe !== null ? 1 : 0) + (f.researchedOnly ? 1 : 0);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function matchesFilters(jd: JdSummary, f: RoleFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [jd.title, jd.specialization ?? "", levelLabel(jd.level), ...(jd.techStack ?? [])].join(" ").toLowerCase();
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  if (f.levels.length && !f.levels.some((l) => same(l, jd.level))) return false;
  if (f.specs.length && !(jd.specialization && f.specs.some((s) => same(s, jd.specialization!)))) return false;
  // A role must use every selected technology.
  if (f.stack.length && !f.stack.every((t) => (jd.techStack ?? []).some((x) => same(x, t)))) return false;
  if (f.minPay !== null && !((jd.ctcMaxLpa ?? jd.ctcMinLpa ?? -1) >= f.minPay)) return false;
  if (f.maxYoe !== null && !((jd.yoeMin ?? Infinity) <= f.maxYoe)) return false;
  if (f.researchedOnly && !isLiveJd(jd)) return false;
  return true;
}

export function sortRoles(jds: JdSummary[], sort: SortKey): JdSummary[] {
  const out = [...jds];
  if (sort === "pay-desc") out.sort((a, b) => (b.ctcMaxLpa ?? -1) - (a.ctcMaxLpa ?? -1) || a.title.localeCompare(b.title));
  else if (sort === "yoe-asc") out.sort((a, b) => (a.yoeMin ?? Infinity) - (b.yoeMin ?? Infinity) || a.title.localeCompare(b.title));
  else if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/** Technologies used by these roles with how many roles use each, most common first. */
export function stackCounts(jds: JdSummary[]): { tech: string; count: number }[] {
  const counts = new Map<string, { tech: string; count: number }>();
  for (const jd of jds) {
    for (const t of new Set((jd.techStack ?? []).map((x) => x.trim()).filter(Boolean))) {
      const k = t.toLowerCase();
      const cur = counts.get(k);
      counts.set(k, cur ? { ...cur, count: cur.count + 1 } : { tech: t, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tech.localeCompare(b.tech));
}

export function levelsOf(jds: JdSummary[]): string[] {
  return [...new Set(jds.map((j) => j.level))];
}

/** "₹35–60 LPA" / "₹4 LPA" / null when no pay data. */
export function payText(jd: Pick<JdSummary, "ctcMinLpa" | "ctcMaxLpa">): string | null {
  const lo = jd.ctcMinLpa ?? null;
  const hi = jd.ctcMaxLpa ?? null;
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (lo === null && hi === null) return null;
  if (lo === null || hi === null || lo === hi) return `₹${n((hi ?? lo)!)} LPA`;
  return `₹${n(lo)}–${n(hi)} LPA`;
}

/** "0–2 yrs" / "5+ yrs" / null. */
export function yoeText(jd: Pick<JdSummary, "yoeMin" | "yoeMax">): string | null {
  const lo = jd.yoeMin ?? null;
  const hi = jd.yoeMax ?? null;
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null && lo !== hi) return `${lo}–${hi} yrs`;
  return `${(lo ?? hi)!} yrs`;
}

