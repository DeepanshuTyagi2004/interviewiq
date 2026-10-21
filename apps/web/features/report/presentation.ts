/**
 * Pure display helpers for the post-interview report. Copy is mock-framed: never "cleared", "certified"
 * or "badge", and the hiring verdict is the mock interviewer's recommendation, never an endorsement.
 */
import { normalizeLegacyLevel } from "@/lib/constants/engineering-levels";
import type { ReportMeta, RoundOutcome } from "./types";

export type OutcomeTone = "brand" | "ink" | "warn" | "soft";

/** "6.8" — one decimal. */
export function formatScore(n: number): string {
  return n.toFixed(1);
}

/** "6.8 / 7.0" (score over pass mark); just "6.8" without a pass mark; null when the round has no score. */
export function scoreChipText(score: number | null | undefined, passMark: number | null | undefined): string | null {
  if (score == null) return null;
  return passMark == null ? formatScore(score) : `${formatScore(score)} / ${formatScore(passMark)}`;
}

const OUTCOME_META: Record<RoundOutcome, { label: string; tone: OutcomeTone }> = {
  passed: { label: "Passed", tone: "brand" },
  below_pass: { label: "Below pass mark", tone: "ink" },
  auto_fail: { label: "Automatic fail", tone: "warn" },
  unscorable: { label: "Not scored", tone: "soft" },
};

export function outcomeMeta(outcome: RoundOutcome): { label: string; tone: OutcomeTone } {
  return OUTCOME_META[outcome] ?? OUTCOME_META.unscorable;
}

const VERDICT_LABEL: Record<string, string> = {
  strong_hire: "Strong Hire",
  hire: "Hire",
  lean_hire: "Lean Hire",
  lean_no_hire: "Lean No Hire",
  no_hire: "No Hire",
  strong_no_hire: "Strong No Hire",
};

/** Spec §8.4 names ("lean_no_hire" or "Lean No Hire" both → "Lean No Hire"); unknown text passes through. */
export function verdictLabel(verdict: string): string {
  const key = verdict.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return VERDICT_LABEL[key] ?? verdict;
}

/** Signed score change with the real minus sign (U+2212): 0.1 → "+0.1", -0.25 → "−0.25". Zero is "0". */
export function deltaLabel(delta: number): string {
  if (delta === 0) return "0";
  const abs = Math.abs(delta);
  const text = String(Number(abs.toFixed(3)));
  return `${delta > 0 ? "+" : "−"}${text}`;
}

const MARKER_META: Record<string, { label: string; tone: "good" | "bad" | "neutral" }> = {
  strong: { label: "Strong moment", tone: "good" },
  weak: { label: "Weak moment", tone: "bad" },
  bug: { label: "Bug", tone: "bad" },
  recovery: { label: "Recovery", tone: "good" },
  edge_case: { label: "Edge case", tone: "good" },
  hint: { label: "Hint", tone: "neutral" },
  filler: { label: "Filler", tone: "neutral" },
};

/** Label + tone for a transcript marker / moment kind; unknown kinds get a humanised label. */
export function markerMeta(kind: string): { label: string; tone: "good" | "bad" | "neutral" } {
  const known = MARKER_META[kind];
  if (known) return known;
  const text = kind.replace(/[_-]+/g, " ").trim();
  return { label: text ? text[0].toUpperCase() + text.slice(1) : "Note", tone: "neutral" };
}

function titleCase(slug: string): string {
  return slug
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** sde1 → "SDE1", fresher → "Fresher", intern → "Intern"; unknown levels pass through. */
export function shortLevel(level: string): string {
  const norm = normalizeLegacyLevel(level);
  if (!norm) return level;
  if (norm.startsWith("sde")) return norm.toUpperCase();
  return titleCase(norm);
}

/** "2" / "round 2" / "Round 2 - DSA" → 2; otherwise null. */
function roundNumber(round: string | null | undefined): number | null {
  const m = round?.match(/^\s*(?:round\s*)?(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * The mock-framed outcome line: `{Outcome} · {Company} {LEVEL} mock round {N}`, e.g.
 * "Passed · Meesho SDE1 mock round 2". Prefixes: Passed / Below pass mark / Automatic fail / Not scored.
 * Missing parts are dropped (no company → "SDE1 mock round 2"; no round number → "mock round").
 */
export function mockOutcomeLine(meta: ReportMeta | null | undefined, outcome: RoundOutcome): string {
  const company = meta?.company ? (/[\s_-]|^[a-z]/.test(meta.company) && meta.company === meta.company.toLowerCase() ? titleCase(meta.company) : meta.company) : null;
  const level = meta?.level ? shortLevel(meta.level) : null;
  const n = roundNumber(meta?.round);
  const subject = [company, level, n ? `mock round ${n}` : "mock round"].filter(Boolean).join(" ");
  return `${outcomeMeta(outcome).label} · ${subject}`;
}

/**
 * A moment's time as "mm:ss" into the round (`at` minus `startAt`, the first transcript turn's time).
 * Without a usable start it falls back to the local clock "HH:MM"; null or unparseable → "".
 */
export function roundClock(at: string | null | undefined, startAt?: string | null): string {
  if (!at) return "";
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const s = startAt ? Date.parse(startAt) : NaN;
  if (!Number.isNaN(s)) {
    const secs = Math.max(0, Math.round((t - s) / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    return `${mm}:${String(secs % 60).padStart(2, "0")}`;
  }
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
