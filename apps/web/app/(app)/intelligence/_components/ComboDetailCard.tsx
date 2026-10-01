"use client";

import * as React from "react";
import { LookPill } from "@/components/observability/ConsoleCard";
import { OUTLINE_PILL } from "@/components/observability/status";
import type { ComboDetail, FinalExperience } from "@/features/intelligence";
import { ExpandableRow } from "./ExpandableRow";
import { BRIEF_STATUS_PILL, CONFIDENCE_PILL, lookFor } from "./pills";
import { JsonViewer, SourceFunnel, TextViewer, ThoughtBlock, UrlList, ViewerSection } from "./viewers";

/** One JD's full verbose trace: the prompt(s) sent to Perplexity, raw response(s),
 *  citations, and the exact document stored in MongoDB. Single-open accordion row — when
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
    <ExpandableRow
      label={detail.combo}
      open={open}
      onToggle={onToggle}
      pills={
        <>
          {detail.data_confidence ? (
            <LookPill look={lookFor(CONFIDENCE_PILL, detail.data_confidence, OUTLINE_PILL)}>
              {detail.data_confidence}
            </LookPill>
          ) : null}
          <LookPill look={lookFor(BRIEF_STATUS_PILL, status, OUTLINE_PILL)}>{status}</LookPill>
        </>
      }
    >
      {detail.error ? (
        <ViewerSection label="Error">
          <TextViewer text={detail.error} label="Error" tone="error" />
        </ViewerSection>
      ) : null}

      {detail.jd_summary ? (
        <ViewerSection label="JD context sent to Perplexity">
          <TextViewer text={detail.jd_summary} label="JD context" />
        </ViewerSection>
      ) : null}

      {requests.map((req, i) => {
        const multi = requests.length > 1;
        const heading = multi
          ? i === 0
            ? "Perplexity request"
            : "Perplexity request (retry / follow-up)"
          : "Perplexity request";
        return (
          <section key={i} className="min-w-0 space-y-4 rounded-[10px] border border-line-2 p-3.5 sm:p-4">
            <h3 className="m-0 flex items-center gap-2 text-sm font-normal">
              {heading}
              {multi ? (
                <span className="font-mono text-[11.5px] tabular-nums text-faint">
                  {i + 1}/{requests.length}
                </span>
              ) : null}
            </h3>
            {req.prompt ? (
              <ViewerSection label="Prompt sent" level={4}>
                <TextViewer text={req.prompt} label="Prompt sent" />
              </ViewerSection>
            ) : null}
            {req.raw_response ? (
              <ViewerSection label="Raw response" level={4}>
                <TextViewer text={req.raw_response} label="Raw response" />
              </ViewerSection>
            ) : null}
            {req.citations && req.citations.length > 0 ? (
              <ViewerSection label={`Citations (${req.citations.length})`} level={4}>
                <UrlList urls={req.citations} />
              </ViewerSection>
            ) : null}
          </section>
        );
      })}

      {funnel.length > 0 ? (
        <ViewerSection
          label={
            typeof levelMatched === "number" && roundCount > 0
              ? `Source funnel (${levelMatched}/${roundCount} rounds on-level)`
              : "Source funnel"
          }
        >
          <SourceFunnel entries={funnel} />
        </ViewerSection>
      ) : null}

      {finalExp?.aggregate_thought ? (
        <ViewerSection label="Aggregation reasoning">
          <ThoughtBlock text={finalExp.aggregate_thought} />
        </ViewerSection>
      ) : null}

      {detail.stored_doc ? (
        <ViewerSection label="Stored in MongoDB (interview_briefs)">
          <JsonViewer value={detail.stored_doc} label="Stored document JSON" />
        </ViewerSection>
      ) : null}

      {requests.length === 0 && !detail.error ? (
        <p className="m-0 text-xs text-muted-foreground">Waiting for Perplexity…</p>
      ) : null}
    </ExpandableRow>
  );
}
