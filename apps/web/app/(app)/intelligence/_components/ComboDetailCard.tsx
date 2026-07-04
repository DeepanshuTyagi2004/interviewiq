"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { SectionLabel } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import type { ComboDetail, FinalExperience } from "@/features/intelligence";
import { CONFIDENCE_CLASS, JsonViewer, Pill, SourceFunnel, STATUS_CLASS, TextViewer, ThoughtBlock } from "./viewers";

/** One JD's full verbose trace: the prompt(s) sent to Perplexity, raw response(s),
 *  citations, and the exact document stored in MongoDB. Single-open accordion — when
 *  expanded it fills the Combinations area and scrolls as one. */
export function ComboDetailCard({
  detail,
  open,
  onToggle,
}: {
  detail: ComboDetail;
  open: boolean;
  onToggle: () => void;
}) {
  const status = detail.status ?? "pending";
  const requests = detail.requests ?? [];

  // The collect→extract→cite funnel: every collected source and why it was/wasn't used.
  const finalExp = (detail.stored_doc as Record<string, unknown> | undefined)?.final_experience as
    | FinalExperience
    | undefined;
  const funnel = finalExp?.source_funnel ?? [];
  const roundCount = finalExp?.rounds?.length ?? 0;
  const levelMatched = finalExp?.level_matched_round_count;

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
          <span className="truncate font-mono text-sm">{detail.combo}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {detail.data_confidence ? (
            <Pill className={CONFIDENCE_CLASS[detail.data_confidence] ?? CONFIDENCE_CLASS.low}>
              {detail.data_confidence}
            </Pill>
          ) : null}
          <Pill className={STATUS_CLASS[status] ?? STATUS_CLASS.skipped}>{status}</Pill>
        </span>
      </button>

      {open ? (
        <div className="space-y-5 border-t border-border px-4 py-4">
          {detail.error ? (
          <Section label="Error">
            <TextViewer text={detail.error} className="border-destructive/30 bg-destructive/5" />
          </Section>
        ) : null}

        {detail.jd_summary ? (
          <Section label="JD context sent to Perplexity">
            <TextViewer text={detail.jd_summary} />
          </Section>
        ) : null}

        {requests.map((req, i) => {
          const multi = requests.length > 1;
          const heading = multi
            ? i === 0
              ? "Perplexity request"
              : "Perplexity request (retry / follow-up)"
            : "Perplexity request";
          return (
            <div key={i} className="space-y-3 rounded-lg border border-border/60 p-3">
              <SectionLabel>{heading}</SectionLabel>
              {req.prompt ? (
                <Section label="Prompt sent">
                  <TextViewer text={req.prompt} />
                </Section>
              ) : null}
              {req.raw_response ? (
                <Section label="Raw response">
                  <TextViewer text={req.raw_response} />
                </Section>
              ) : null}
              {req.citations && req.citations.length > 0 ? (
                <Section label={`Citations (${req.citations.length})`}>
                  <ol className="space-y-1">
                    {req.citations.map((url, n) => (
                      <li key={url} className="flex gap-2 text-xs">
                        <span className="shrink-0 tabular-nums text-muted-foreground">{n + 1}.</span>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all font-mono text-primary underline-offset-4 hover:underline"
                        >
                          {url}
                        </a>
                      </li>
                    ))}
                  </ol>
                </Section>
              ) : null}
            </div>
          );
        })}

          {funnel.length > 0 ? (
            <Section
              label={
                typeof levelMatched === "number" && roundCount > 0
                  ? `Source funnel (${levelMatched}/${roundCount} rounds on-level)`
                  : "Source funnel"
              }
            >
              <SourceFunnel entries={funnel} />
            </Section>
          ) : null}

          {finalExp?.aggregate_thought ? (
            <Section label="Aggregation reasoning">
              <ThoughtBlock text={finalExp.aggregate_thought} />
            </Section>
          ) : null}

          {detail.stored_doc ? (
            <Section label="Stored in MongoDB (interview_briefs)">
              <JsonViewer value={detail.stored_doc} />
            </Section>
          ) : null}

          {requests.length === 0 && !detail.error ? (
            <p className="text-xs text-muted-foreground">Waiting for Perplexity…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}
