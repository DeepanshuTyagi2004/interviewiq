"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { FinalRound, SourceFunnelEntry } from "@/features/intelligence";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ponytail: regex JSON highlighter — no syntax-highlight dependency for a dev console.
// Operates on already-escaped text, so JD/raw content inside strings can't inject markup.
function highlightJson(json: string): string {
  return escapeHtml(json).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "text-amber-600 dark:text-amber-400"; // number
      if (/^"/.test(m)) {
        cls = /:$/.test(m)
          ? "text-sky-600 dark:text-sky-400" // key
          : "text-emerald-600 dark:text-emerald-400"; // string
      } else if (/^(true|false)$/.test(m)) {
        cls = "text-purple-600 dark:text-purple-400"; // boolean
      } else if (/^null$/.test(m)) {
        cls = "text-muted-foreground"; // null
      }
      return `<span class="${cls}">${m}</span>`;
    },
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground"
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Shared scroll shell: copy button pinned outside the scroll region; inner area scrolls
 *  independently and, at its end, chains scroll to the surrounding list (default behaviour). */
function ViewerShell({
  copyText,
  className,
  children,
}: {
  copyText: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative">
      <div className="absolute right-2 top-2 z-10 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton text={copyText} />
      </div>
      <div
        className={cn(
          "max-h-[28rem] overflow-auto rounded-lg border border-border bg-muted/30 [scrollbar-width:thin]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Pretty-printed, syntax-highlighted JSON. Long string values wrap so it stays readable. */
export function JsonViewer({ value, className }: { value: unknown; className?: string }) {
  const json = React.useMemo(() => JSON.stringify(value, null, 2), [value]);
  const html = React.useMemo(() => highlightJson(json), [json]);
  return (
    <ViewerShell copyText={json} className={className}>
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-foreground">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </ViewerShell>
  );
}

export const CONFIDENCE_CLASS: Record<string, string> = {
  high: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  medium: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400",
  low: "border-border bg-muted text-muted-foreground",
};

export const STATUS_CLASS: Record<string, string> = {
  success: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  insufficient_data: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  running: "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-400",
  skipped: "border-border bg-muted text-muted-foreground",
};

/** Small rounded status/confidence chip. */
export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

const FUNNEL_STATUS: Record<string, { label: string; cls: string }> = {
  cited: { label: "cited", cls: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  extracted_unused: { label: "not used", cls: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  off_level_excluded: { label: "off-level (excluded)", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  off_geo_excluded: { label: "off-geo (excluded)", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  no_rounds: { label: "no rounds found", cls: "border-border bg-muted text-muted-foreground" },
  no_process: { label: "no process described", cls: "border-border bg-muted text-muted-foreground" },
  extract_failed: { label: "extract failed", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
};
const FUNNEL_ORDER = ["cited", "extracted_unused", "off_level_excluded", "off_geo_excluded", "no_rounds", "no_process", "extract_failed"];

/** How a source's detected seniority relates to the JD level (exact/adjacent = on-level). */
export const MATCH_TIER_META: Record<string, { label: string; cls: string }> = {
  exact: { label: "exact level", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  adjacent: { label: "adjacent level", cls: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  unknown: { label: "level unknown", cls: "border-border bg-muted text-muted-foreground" },
  off: { label: "off-level", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
};

/** How a round is grounded.
 *  evidence_backed > process_guide > inferred_from_similar > template (descending trust). */
export const PROVENANCE_META: Record<string, { label: string; cls: string }> = {
  evidence_backed: { label: "evidence-backed", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  process_guide: { label: "process guide", cls: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  inferred_from_similar: { label: "inferred", cls: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  template: { label: "template", cls: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

/** Trust badges for one round: provenance tier, on-level support ("seen in X of N"),
 *  a rare flag, and the seniority of the sources that attest it. */
export function RoundTrust({ round }: { round: FinalRound }) {
  const prov = round.provenance ?? "inferred_from_similar";
  const meta = PROVENANCE_META[prov] ?? { label: prov, cls: "border-border bg-muted text-muted-foreground" };
  const total = round.source_count_total ?? 0;
  const support = round.support_count ?? 0;
  return (
    <>
      <Pill className={meta.cls}>{meta.label}</Pill>
      {prov === "evidence_backed" && total > 0 ? (
        <Pill className="border-border bg-muted text-muted-foreground">
          seen in {support} of {total}
        </Pill>
      ) : prov === "process_guide" && support > 0 ? (
        <Pill className="border-border bg-muted text-muted-foreground">
          described in {support} source{support === 1 ? "" : "s"}
        </Pill>
      ) : null}
      {round.rare ? (
        <Pill className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" >rare</Pill>
      ) : null}
      {round.source_sublevels && round.source_sublevels.length > 0 ? (
        <Pill className="border-border bg-muted text-muted-foreground">
          {round.source_sublevels.join(", ")}
        </Pill>
      ) : null}
    </>
  );
}

/** The collect→extract→cite funnel: every collected source and why it was/wasn't used. */
export function SourceFunnel({ entries }: { entries: SourceFunnelEntry[] }) {
  const ordered = React.useMemo(
    () => [...entries].sort((a, b) => FUNNEL_ORDER.indexOf(a.status ?? "") - FUNNEL_ORDER.indexOf(b.status ?? "")),
    [entries],
  );
  const cited = entries.filter((e) => e.status === "cited").length;
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {entries.length} collected → {cited} used in the final experience. Each source shows why it
        was or wasn&apos;t used.
      </p>
      <ol className="space-y-1.5">
        {ordered.map((e, n) => {
          const st = FUNNEL_STATUS[e.status ?? ""] ?? {
            label: e.status ?? "—",
            cls: "border-border bg-muted text-muted-foreground",
          };
          const extracted =
            e.status === "cited" || e.status === "extracted_unused" ||
            e.status === "off_level_excluded" || e.status === "off_geo_excluded";
          // match_tier is the truth; fall back to the legacy on/off-level boolean for old docs.
          const tier = e.match_tier ?? (e.level_matched == null ? null : e.level_matched ? "exact" : "off");
          const tierMeta = tier ? MATCH_TIER_META[tier] : null;
          return (
            <li key={e.url ?? n} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="shrink-0 tabular-nums text-muted-foreground">{n + 1}.</span>
              <Pill className={st.cls}>{st.label}</Pill>
              {e.source ? <Pill className="border-border bg-muted text-muted-foreground">{e.source}</Pill> : null}
              {extracted && e.detected_level ? (
                <Pill className="border-border bg-muted text-muted-foreground">{e.detected_level}</Pill>
              ) : null}
              {extracted && tierMeta ? <Pill className={tierMeta.cls}>{tierMeta.label}</Pill> : null}
              {extracted && e.is_first_hand === false ? (
                <Pill className="border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400">guide</Pill>
              ) : extracted && e.is_first_hand === true ? (
                <Pill className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">first-hand</Pill>
              ) : null}
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-primary underline-offset-4 hover:underline"
                >
                  {e.url}
                </a>
              ) : null}
              {e.thought ? (
                <details className="w-full">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    model reasoning
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {e.thought}
                  </pre>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Collapsible model reasoning (the <thought> preamble, stored when LLM_CAPTURE_THOUGHTS is on).
 *  Renders nothing when there's no reasoning, so it's safe to drop in unconditionally. */
export function ThoughtBlock({ text, label = "Model reasoning" }: { text?: string | null; label?: string }) {
  if (!text) return null;
  return (
    <details className="rounded-md border border-border bg-muted/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        {label}
      </summary>
      <pre className="whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {text}
      </pre>
    </details>
  );
}

/** Plain text (prompts, raw responses) — wrapped, monospace, scrollable. */
export function TextViewer({ text, className }: { text: string; className?: string }) {
  return (
    <ViewerShell copyText={text} className={className}>
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-foreground">
        {text}
      </pre>
    </ViewerShell>
  );
}
