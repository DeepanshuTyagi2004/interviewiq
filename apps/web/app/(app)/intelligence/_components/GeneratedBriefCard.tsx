"use client";

import * as React from "react";
import { padCount } from "@/components/hud";
import { LookPill } from "@/components/observability/ConsoleCard";
import { OUTLINE_PILL } from "@/components/observability/status";
import {
  useBrief,
  type BriefDoc,
  type BriefSummary,
  type FinalExperience,
  type FinalRound,
} from "@/features/intelligence";
import { ExpandableRow } from "./ExpandableRow";
import { BRIEF_STATUS_PILL, CONFIDENCE_PILL, lookFor } from "./pills";
import {
  ExtLink,
  JsonViewer,
  RoundTrust,
  SourceFunnel,
  ThoughtBlock,
  TopicChip,
  UrlList,
  ViewerSection,
} from "./viewers";

/** A persisted brief (already generated). Single-open accordion row; the full doc + interview
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
    <ExpandableRow
      label={label}
      open={open}
      onToggle={onToggle}
      pills={
        <>
          {conf ? <LookPill look={lookFor(CONFIDENCE_PILL, conf, OUTLINE_PILL)}>{conf}</LookPill> : null}
          <LookPill look={lookFor(BRIEF_STATUS_PILL, status, OUTLINE_PILL)}>{status}</LookPill>
        </>
      }
    >
      {isLoading ? (
        <p className="m-0 text-xs text-muted-foreground">Loading brief…</p>
      ) : isError || !data ? (
        <p className="m-0 text-sm text-muted-foreground">
          No brief stored for this JD, or it failed to generate.
        </p>
      ) : (
        <BriefBody doc={data} />
      )}
    </ExpandableRow>
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
  const hasFields = Boolean(
    (exp?.dominant_topics && exp.dominant_topics.length > 0) ||
      exp?.difficulty_calibration ||
      exp?.interviewer_style_notes ||
      (exp?.red_flags && exp.red_flags.length > 0) ||
      exp?.company_specific_patterns,
  );

  return (
    <>
      <div className="space-y-2">
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11.5px]">
          {models?.extract ? <Meta term="extract/aggregate" value={models.extract} /> : null}
          {models?.search ? <Meta term="search" value={models.search} /> : null}
          {version ? <Meta term="query" value={version} /> : null}
          {generatedAt ? <Meta term="generated" value={fmtDate(generatedAt)} /> : null}
        </dl>

        {rounds.length > 0 && (ev !== undefined || matched !== undefined) ? (
          <p className="m-0 text-xs text-muted-foreground">
            <Num>{ev ?? 0}</Num>
            {" evidence-backed"}
            {pg ? (
              <>
                {" · "}
                <Num>{pg}</Num>
                {" from guides"}
              </>
            ) : null}
            {" · "}
            <Num>{inferredOnly}</Num>
            {" inferred"}
            {matched !== undefined ? (
              <>
                {" · "}
                <Num>
                  {matched}/{rounds.length}
                </Num>
                {" on-level"}
              </>
            ) : null}
            {exp?.template_used ? " · includes industry-standard templates" : null}
          </p>
        ) : null}
      </div>

      <ViewerSection label="Final interview experience">
        {rounds.length > 0 ? (
          <div className="space-y-2">
            <ol className="m-0 list-none space-y-2 p-0">
              {rounds.map((r, i) => (
                <RoundRow key={i} round={r} />
              ))}
            </ol>
            {hasFields ? (
              <dl className="m-0 divide-y divide-line rounded-[14px] border border-line-2">
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
                    <ul className="m-0 list-disc space-y-0.5 pl-4">
                      {exp.red_flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </Field>
                ) : null}
                {exp?.company_specific_patterns ? (
                  <Field label="Company-specific">{exp.company_specific_patterns}</Field>
                ) : null}
              </dl>
            ) : null}
          </div>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">No round-by-round experience in this brief.</p>
        )}
      </ViewerSection>

      {funnel.length > 0 ? (
        <ViewerSection label="Source funnel">
          <SourceFunnel entries={funnel} />
        </ViewerSection>
      ) : null}

      {exp?.aggregate_thought ? (
        <ViewerSection label="Aggregation reasoning">
          <ThoughtBlock text={exp.aggregate_thought} />
        </ViewerSection>
      ) : null}

      {sources.length > 0 ? (
        <ViewerSection label={`All collected sources (${sources.length})`}>
          <UrlList urls={sources} truncate />
        </ViewerSection>
      ) : null}

      <ViewerSection label="Full brief (MongoDB)">
        <JsonViewer value={doc} label="Full brief JSON" />
      </ViewerSection>
    </>
  );
}

function RoundRow({ round }: { round: FinalRound }) {
  const n = round.round_number;
  return (
    <li className="grid grid-cols-[36px_minmax(0,1fr)] gap-3.5 rounded-[14px] border border-line-2 p-3.5 sm:p-4">
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-line-3 font-mono text-[13px] tabular-nums"
      >
        {padCount(n ?? NaN)}
      </span>
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h4 className="m-0 text-[15px] font-normal tracking-[-0.01em]">
            <span className="sr-only">Round {n ?? "?"}: </span>
            {round.type ?? `Round ${n ?? "?"}`}
          </h4>
          <span className="flex flex-wrap items-center gap-1.5">
            {round.difficulty ? <LookPill look={OUTLINE_PILL}>{round.difficulty}</LookPill> : null}
            <RoundTrust round={round} />
          </span>
        </div>
        {round.format ? <p className="m-0 text-[12.5px] leading-[1.5] text-faint">{round.format}</p> : null}
        {round.topics && round.topics.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {round.topics.map((t) => (
              <TopicChip key={t}>{t}</TopicChip>
            ))}
          </div>
        ) : null}
        {round.problems && round.problems.length > 0 ? (
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {round.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : null}
        {round.evidence_urls && round.evidence_urls.length > 0 ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {round.evidence_urls.map((url) => (
              <ExtLink key={url} href={url} className="truncate font-mono text-[11.5px]">
                {hostname(url)}
              </ExtLink>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="text-faint">{term}</dt>
      <dd className="m-0 text-foreground [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular-nums text-foreground">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-3.5 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4 sm:px-4">
      <dt className="iq-eyebrow pt-0.5">{label}</dt>
      <dd className="m-0 text-[13px] leading-[1.5]">{children}</dd>
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
