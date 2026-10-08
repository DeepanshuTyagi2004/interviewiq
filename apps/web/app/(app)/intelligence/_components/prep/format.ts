import type { BlueprintLlmCall, BlueprintRunSummary } from "@/features/blueprints";
import { roundLabel } from "./vocabulary";

/** 412 → "412ms", 6120 → "6.1s", 95000 → "1m 35s". Missing → "—". */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** The first 12 characters of a hash, without a `sha256:` prefix. */
export function shortHash(hash: string | null | undefined, n = 12): string {
  if (!hash) return "—";
  return hash.replace(/^sha256:/, "").slice(0, n);
}

/** "Meesho · SDE I · sde1 · DSA". */
export function runTitle(run: Pick<BlueprintRunSummary, "company" | "role" | "level" | "round_type">): string {
  return [run.company, run.role, run.level, roundLabel(run.round_type)].filter(Boolean).join(" · ");
}

export function candidateText(run: Pick<BlueprintRunSummary, "candidate_label" | "candidate_id">): string {
  return run.candidate_label || run.candidate_id || "unknown candidate";
}

/** 12345 → "12,345". */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export interface CallTotals {
  /** `provider/model` pairs, deduplicated, in first-seen order. */
  models: string[];
  prompt: number;
  completion: number;
  calls: number;
}

/** Models and summed token usage of a stage's LLM calls (sandbox checks are not LLM calls). */
export function callTotals(calls: BlueprintLlmCall[] | undefined): CallTotals {
  const models: string[] = [];
  let prompt = 0;
  let completion = 0;
  let count = 0;
  for (const c of calls ?? []) {
    if (c.sandbox) continue;
    count += 1;
    const name = [c.provider, c.model].filter(Boolean).join("/");
    if (name && !models.includes(name)) models.push(name);
    prompt += c.tokens?.prompt ?? 0;
    completion += c.tokens?.completion ?? 0;
  }
  return { models, prompt, completion, calls: count };
}

/** Any JSON-ish value as one short line (diff cells, summary values). */
export function inline(value: unknown, max = 160): string {
  if (value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

/** Save text as a file in the browser. */
export function downloadText(filename: string, text: string, type = "text/markdown"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
