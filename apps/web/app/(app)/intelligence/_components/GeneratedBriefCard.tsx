"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { SectionLabel } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import {
  useBrief,
  type BriefDoc,
  type BriefSummary,
  type FinalExperience,
  type FinalRound,
} from "@/features/intelligence";
import {
  CONFIDENCE_CLASS,
  JsonViewer,
  Pill,
  RoundTrust,
  SourceFunnel,
  STATUS_CLASS,
  ThoughtBlock,
} from "./viewers";

/** A persisted brief (already generated). Single-open accordion; the full doc + interview
 *  experience are lazily fetched when expanded, and it fills the area + scrolls as one. */
export function GeneratedBriefCard({
  summary,
  open,
  onToggle,
}: {
  summary: BriefSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const label = `${summary.company}/${summary.role}/${summary.level}/${summary.specialization}`;
  const conf = summary.data_confidence ?? undefined;
  const status = summary.generation_status ?? "—";
  const { data, isLoading, isError } = useBrief(
    { company: summary.company, role: summary.role, level: summary.level, specialization: summary.specialization },
    open,
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span className="truncate font-mono text-sm">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {conf ? <Pill className={CONFIDENCE_CLASS[conf] ?? CONFIDENCE_CLASS.low}>{conf}</Pill> : null}
          <Pill className={STATUS_CLASS[status] ?? STATUS_CLASS.skipped}>{status}</Pill>
        </span>
      </button>

      {open ? (
        <div className="space-y-5 border-t border-border px-4 py-4">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading brief…</p>
          ) : isError || !data ? (
            <p className="text-sm text-muted-foreground">
              No brief stored for this JD, or it failed to generate.
            </p>
          ) : (
            <BriefBody doc={data} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function BriefBody({ doc }: { doc: BriefDoc }) {
  const exp = (doc.final_experience as FinalExperience | undefined) ?? null;
  const rounds = exp?.rounds ?? [];
  const models = (doc.models as { search?: string; extract?: string; aggregate?: string } | undefined) ?? null;
  const generatedAt = typeof doc.generated_at === "string" ? doc.generated_at : null;
  const version = typeof doc.query_version === "string" ? doc.query_version : null;
  const sources = Array.isArray(doc.sources) ? (doc.sources as string[]) : [];
  const funnel = exp?.source_funnel ?? [];
  const ev = exp?.evidence_backed_round_count;
  const pg = exp?.process_guide_round_count;
  const inf = exp?.inferred_round_count;
  // inferred_round_count lumps in process_guide + template; show the inferred-only remainder.
  const inferredOnly = Math.max(0, (inf ?? 0) - (pg ?? 0));
  const matched = exp?.level_matched_round_count;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {models?.extract ? <span>extract/aggregate: <span className="font-mono">{models.extract}</span></span> : null}
        {models?.search ? <span>search: <span className="font-mono">{models.search}</span></span> : null}
        {version ? <span>query: <span className="font-mono">{version}</span></span> : null}
        {generatedAt ? <span>{fmtDate(generatedAt)}</span> : null}
      </div>

      {rounds.length > 0 && (ev !== undefined || matched !== undefined) ? (
        <p className="text-xs text-muted-foreground">
          {ev ?? 0} evidence-backed
          {pg ? <> · {pg} from guides</> : null} · {inferredOnly} inferred
          {matched !== undefined ? <> · {matched}/{rounds.length} on-level</> : null}
          {exp?.template_used ? <> · includes industry-standard templates</> : null}
        </p>
      ) : null}

      <Section label="Final interview experience">
        {rounds.length > 0 ? (
          <div className="space-y-2">
            {rounds.map((r, i) => (
              <RoundRow key={i} round={r} />
            ))}
            {exp?.dominant_topics && exp.dominant_topics.length > 0 ? (
              <Field label="Dominant topics">{exp.dominant_topics.join(", ")}</Field>
            ) : null}
            {exp?.difficulty_calibration ? (
              <Field label="Difficulty">{exp.difficulty_calibration}</Field>
            ) : null}
            {exp?.interviewer_style_notes ? (
              <Field label="Interviewer style">{exp.interviewer_style_notes}</Field>
            ) : null}
            {exp?.red_flags && exp.red_flags.length > 0 ? (
              <Field label="Watch out for">
                <ul className="list-disc space-y-0.5 pl-4">
                  {exp.red_flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </Field>
            ) : null}
            {exp?.company_specific_patterns ? (
              <Field label="Company-specific">{exp.company_specific_patterns}</Field>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No round-by-round experience in this brief.</p>
        )}
      </Section>

      {funnel.length > 0 ? (
        <Section label="Source funnel">
          <SourceFunnel entries={funnel} />
        </Section>
      ) : null}

      {exp?.aggregate_thought ? (
        <Section label="Aggregation reasoning">
          <ThoughtBlock text={exp.aggregate_thought} />
        </Section>
      ) : null}

      {sources.length > 0 ? (
        <Section label={`All collected sources (${sources.length})`}>
          <ol className="space-y-1">
            {sources.map((url, n) => (
              <li key={url} className="flex items-center gap-2 text-xs">
                <span className="shrink-0 tabular-nums text-muted-foreground">{n + 1}.</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-primary underline-offset-4 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section label="Full brief (MongoDB)">
        <JsonViewer value={doc} />
      </Section>
    </>
  );
}

function RoundRow({ round }: { round: FinalRound }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          Round {round.round_number ?? "?"}
          {round.type ? <span className="text-muted-foreground"> · {round.type}</span> : null}
        </span>
        {round.difficulty ? <Pill className={CONFIDENCE_CLASS.low}>{round.difficulty}</Pill> : null}
        <RoundTrust round={round} />
      </div>
      {round.format ? <p className="mt-1.5 text-sm text-muted-foreground">{round.format}</p> : null}
      {round.topics && round.topics.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {round.topics.map((t) => (
            <Pill key={t} className="border-border bg-background text-muted-foreground">
              {t}
            </Pill>
          ))}
        </div>
      ) : null}
      {round.problems && round.problems.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {round.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
      {round.evidence_urls && round.evidence_urls.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {round.evidence_urls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-primary underline-offset-4 hover:underline"
            >
              {hostname(url)}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <span className="font-medium">{label}: </span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
