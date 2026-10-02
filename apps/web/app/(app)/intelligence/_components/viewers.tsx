"use client";

import * as React from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { LookPill } from "@/components/observability/ConsoleCard";
import { GHOST_PILL, OUTLINE_PILL, type PillLook } from "@/components/observability/status";
import { cn } from "@/lib/utils/cn";
import type { FinalRound, SourceFunnelEntry } from "@/features/intelligence";
import { FUNNEL_ORDER, FUNNEL_STATUS, MATCH_TIER_META, PROVENANCE_META, lookFor } from "./pills";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ponytail: regex JSON highlighter — no syntax-highlight dependency for a dev console.
// Operates on already-escaped text, so JD/raw content inside strings can't inject markup.
// Monochrome on purpose: keys and literals in ink, strings muted, null faint.
function highlightJson(json: string): string {
  return escapeHtml(json).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "text-foreground"; // number
      if (/^"/.test(m)) {
        cls = /:$/.test(m)
          ? "text-foreground" // key
          : "text-muted-foreground"; // string
      } else if (/^(true|false)$/.test(m)) {
        cls = "text-foreground"; // boolean
      } else if (/^null$/.test(m)) {
        cls = "text-faint"; // null
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
      className="inline-flex items-center gap-1 rounded-[5px] border border-line-3 bg-card px-2 py-1 text-[11px] text-muted-foreground shadow-hairline transition-colors hover:border-faint-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** Shared scroll shell: copy button pinned outside the scroll region; inner area scrolls
 *  independently and, at its end, chains scroll to the surrounding list (default behaviour). */
function ViewerShell({
  copyText,
  label,
  tone = "default",
  className,
  children,
}: {
  copyText: string;
  label: string;
  tone?: "default" | "error";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative">
      {/* Always visible on touch screens; revealed on hover / focus where there's a pointer. */}
      <div className="absolute right-2 top-2 z-10 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
        <CopyButton text={copyText} />
      </div>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          "max-h-[28rem] overflow-auto rounded-[8px] bg-panel [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          tone === "error" && "bg-destructive/[0.06] ring-1 ring-inset ring-destructive/25",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Pretty-printed, syntax-highlighted JSON. Long string values wrap so it stays readable. */
export function JsonViewer({
  value,
  label = "JSON",
  className,
}: {
  value: unknown;
  label?: string;
  className?: string;
}) {
  const json = React.useMemo(() => JSON.stringify(value, null, 2), [value]);
  const html = React.useMemo(() => highlightJson(json), [json]);
  return (
    <ViewerShell copyText={json} label={label} className={className}>
      <pre className="m-0 whitespace-pre-wrap break-words p-3.5 font-mono text-xs leading-relaxed text-foreground">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </ViewerShell>
  );
}

/** Plain text (prompts, raw responses) — wrapped, monospace, scrollable. */
export function TextViewer({
  text,
  label = "Text",
  tone,
  className,
}: {
  text: string;
  label?: string;
  tone?: "default" | "error";
  className?: string;
}) {
  return (
    <ViewerShell copyText={text} label={label} tone={tone} className={className}>
      <pre className="m-0 whitespace-pre-wrap break-words p-3.5 font-mono text-xs leading-relaxed text-foreground">
        {text}
      </pre>
    </ViewerShell>
  );
}

/** A labelled block inside an expanded brief / combination (mono eyebrow heading). */
export function ViewerSection({
  label,
  level = 3,
  children,
}: {
  label: string;
  /** Heading level for the eyebrow (4 when nested inside another titled block). */
  level?: 3 | 4;
  children: React.ReactNode;
}) {
  const Heading = level === 4 ? "h4" : "h3";
  return (
    <section className="min-w-0 space-y-2">
      <Heading className="iq-eyebrow m-0">{label}</Heading>
      {children}
    </section>
  );
}

/** An external link in the console: ink text with a quiet underline that darkens on hover. */
export function ExtLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "text-foreground underline decoration-line-4 underline-offset-[3px] transition-colors hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** Topic chip, as on the design's roadmap rounds. */
export function TopicChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-panel px-2 py-[3px] text-[11.5px] text-muted-foreground">
      {children}
    </span>
  );
}

/** Numbered list of URLs (citations, collected sources). */
export function UrlList({ urls, truncate = false }: { urls: string[]; truncate?: boolean }) {
  return (
    <ol className="m-0 list-none space-y-1 p-0">
      {urls.map((url, n) => (
        <li key={url} className="flex min-w-0 gap-2.5 text-xs">
          <span className="w-5 shrink-0 text-right font-mono tabular-nums text-faint">{n + 1}</span>
          <ExtLink
            href={url}
            className={cn("min-w-0 font-mono", truncate ? "truncate" : "[overflow-wrap:anywhere]")}
          >
            {url}
          </ExtLink>
        </li>
      ))}
    </ol>
  );
}

/** Trust badges for one round: provenance tier, on-level support ("seen in X of N"),
 *  a rare flag, and the seniority of the sources that attest it. */
export function RoundTrust({ round }: { round: FinalRound }) {
  const prov = round.provenance ?? "inferred_from_similar";
  const meta = lookFor(PROVENANCE_META, prov, { label: prov, look: OUTLINE_PILL });
  const total = round.source_count_total ?? 0;
  const support = round.support_count ?? 0;
  return (
    <>
      <LookPill look={meta.look}>{meta.label}</LookPill>
      {prov === "evidence_backed" && total > 0 ? (
        <LookPill look={GHOST_PILL} className="tabular-nums">
          seen in {support} of {total}
        </LookPill>
      ) : prov === "process_guide" && support > 0 ? (
        <LookPill look={GHOST_PILL} className="tabular-nums">
          described in {support} source{support === 1 ? "" : "s"}
        </LookPill>
      ) : null}
      {round.rare ? <LookPill look={OUTLINE_PILL}>rare</LookPill> : null}
      {round.source_sublevels && round.source_sublevels.length > 0 ? (
        <LookPill look={GHOST_PILL}>{round.source_sublevels.join(", ")}</LookPill>
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
    <div className="min-w-0">
      <p className="m-0 mb-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">{entries.length}</span>
        {" collected → "}
        <span className="font-mono tabular-nums text-foreground">{cited}</span>
        {" used in the final experience. Each source shows why it was or wasn’t used."}
      </p>
      <ol className="m-0 list-none divide-y divide-line rounded-[8px] border border-line-2 p-0">
        {ordered.map((e, n) => {
          const st = lookFor(FUNNEL_STATUS, e.status, { label: e.status ?? "—", look: GHOST_PILL });
          const extracted =
            e.status === "cited" || e.status === "extracted_unused" ||
            e.status === "off_level_excluded" || e.status === "off_geo_excluded";
          // match_tier is the truth; fall back to the legacy on/off-level boolean for old docs.
          const tier = e.match_tier ?? (e.level_matched == null ? null : e.level_matched ? "exact" : "off");
          const tierMeta = tier ? lookFor<{ label: string; look: PillLook } | null>(MATCH_TIER_META, tier, null) : null;
          return (
            <li key={e.url ?? n} className="grid grid-cols-[20px_minmax(0,1fr)] gap-2.5 px-3 py-2.5 text-xs">
              <span className="pt-0.5 text-right font-mono tabular-nums text-faint">{n + 1}</span>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <LookPill look={st.look}>{st.label}</LookPill>
                  {e.source ? <LookPill look={OUTLINE_PILL}>{e.source}</LookPill> : null}
                  {extracted && e.detected_level ? (
                    <LookPill look={GHOST_PILL}>{e.detected_level}</LookPill>
                  ) : null}
                  {extracted && tierMeta ? <LookPill look={tierMeta.look}>{tierMeta.label}</LookPill> : null}
                  {extracted && e.is_first_hand === false ? (
                    <LookPill look={OUTLINE_PILL}>guide</LookPill>
                  ) : extracted && e.is_first_hand === true ? (
                    <LookPill look={{ tone: "soft" }}>first-hand</LookPill>
                  ) : null}
                </div>
                {e.url ? (
                  <ExtLink href={e.url} className="block font-mono [overflow-wrap:anywhere]">
                    {e.url}
                  </ExtLink>
                ) : null}
                {e.thought ? (
                  <details className="group">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        aria-hidden
                        className="size-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                      />
                      model reasoning
                    </summary>
                    <pre className="m-0 mt-1.5 whitespace-pre-wrap break-words rounded-[8px] bg-panel p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {e.thought}
                    </pre>
                  </details>
                ) : null}
              </div>
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
    <details className="group rounded-[8px] bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-[8px] px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <pre className="m-0 whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {text}
      </pre>
    </details>
  );
}
