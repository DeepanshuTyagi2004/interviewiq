import type { ResearchEvent, ResearchLevel } from "./types";

export const LEVEL_ORDER: readonly ResearchLevel[] = ["trace", "debug", "info", "warn", "error"];
export const LEVEL_RANK: Record<ResearchLevel, number> = { trace: 0, debug: 10, info: 20, warn: 30, error: 40 };

export interface EventFilters {
  minLevel: ResearchLevel;
  companyId: string | null;
  node: string | null;
  /** Event type prefix, e.g. "span." or "item.". */
  type: string;
  /** Case-insensitive substring of the message. */
  q: string;
}

export const DEFAULT_FILTERS: EventFilters = { minLevel: "trace", companyId: null, node: null, type: "", q: "" };

export function filterEvents(events: ResearchEvent[], f: EventFilters): ResearchEvent[] {
  const q = f.q.trim().toLowerCase();
  const type = f.type.trim();
  const min = LEVEL_RANK[f.minLevel];
  return events.filter(
    (e) =>
      LEVEL_RANK[e.level] >= min &&
      (!f.companyId || e.company_id === f.companyId) &&
      (!f.node || e.node === f.node) &&
      (!type || e.type.startsWith(type)) &&
      (!q || e.message.toLowerCase().includes(q)),
  );
}

/** Merge a page into the console buffer: dedupe by seq, ascending, keep only the newest `max`. */
export function appendCapped(prev: ResearchEvent[], next: ResearchEvent[], max: number): ResearchEvent[] {
  if (next.length === 0) return prev;
  const bySeq = new Map(prev.map((e) => [e.seq, e]));
  for (const e of next) bySeq.set(e.seq, e);
  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/** Where the live tail starts for a run opened late: only its newest `max` events. */
export function initialAfterSeq(lastSeq: number, max: number): number {
  return Math.max(0, lastSeq - max);
}

/** The page just before the oldest loaded event, or null once event #1 is loaded. */
export function olderPageQuery(oldestLoadedSeq: number | null, limit: number): { beforeSeq: number; limit: number } | null {
  if (oldestLoadedSeq === null || oldestLoadedSeq <= 1) return null;
  return { beforeSeq: oldestLoadedSeq, limit };
}
