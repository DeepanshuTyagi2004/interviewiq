import Link from "next/link";
import { Button } from "@/components/ui/button";
import { padCount } from "@/components/hud";
import { cn } from "@/lib/utils/cn";
import type { ConsolidatedRound } from "@/features/jobs";
import {
  bookHref,
  isOnlineAssessment,
  roundEvidence,
  roundMeta,
  roundNumber,
  roundTitle,
  roundTopics,
  toRoundType,
} from "./rounds";

/**
 * The timeline rail, drawn by the rounds list (`<ol>`) as a `::before` so the list keeps only `<li>`
 * children. It sits on the number tiles' centre line: card border (1px) + card padding + half the
 * 40px tile. It paints over the cards' fill and under the tiles (`relative bg-card`).
 */
export const ROUND_RAIL =
  "relative before:pointer-events-none before:absolute before:inset-y-px before:left-[calc(1rem+20px)] before:w-px before:bg-line-3 sm:before:left-[calc(1.25rem+20px)]";

/** The first tile hides the rail above it and the last one the rail below it (clipped by the card). */
const RAIL_ENDS =
  "group-first/round:before:absolute group-first/round:before:bottom-[calc(100%+1px)] group-first/round:before:left-1/2 group-first/round:before:h-screen group-first/round:before:w-[5px] group-first/round:before:-translate-x-1/2 group-first/round:before:bg-card group-last/round:after:absolute group-last/round:after:top-[calc(100%+1px)] group-last/round:after:left-1/2 group-last/round:after:h-screen group-last/round:after:w-[5px] group-last/round:after:-translate-x-1/2 group-last/round:after:bg-card";

export interface RoundCardProps {
  round: ConsolidatedRound;
  index: number;
  jdId: string;
  /** Position among interview rounds only (info rounds are not numbered). */
  number?: number;
}

/**
 * One round of the suggested process, as a node on the rounds timeline: `R01` tile, title,
 * format/difficulty, topic chips and a booking link. Deliberately no locked, cleared or scored
 * state: gating isn't built.
 */
export function RoundCard({ round, index, jdId, number }: RoundCardProps) {
  const info = round.kind === "info";
  const n = number ?? roundNumber(round, index);
  const title = roundTitle(round, index);
  const meta = roundMeta(round);
  const topics = roundTopics(round);
  const mapped = toRoundType(round.type) !== null;
  const note = info ? "Not an interview round, for information only" : isOnlineAssessment(round.type) ? "Automated test · not run as a mock" : roundEvidence(round);
  const cta = mapped ? "Book this round" : "Book a round";
  const sources = [...new Set(round.source_urls?.map((url) => url.trim()).filter(Boolean) ?? [])];
  const questions = [...new Set(round.problems?.map((question) => question.trim()).filter(Boolean) ?? [])];

  return (
    <li className={cn("hud-card group/round relative grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-4 gap-y-3.5 overflow-hidden rounded-[14px] border border-line-2 bg-card p-4 sm:grid-cols-[48px_minmax(0,1fr)_auto] sm:items-center sm:gap-x-[18px] sm:p-5", info && "border-dashed opacity-70")}>
      <span aria-hidden className="hud-ticks" />
      <span
        aria-hidden
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-lg border border-line-4 bg-card font-mono text-[13px] tabular-nums",
          RAIL_ENDS,
        )}
      >
        {info ? "i" : `R${padCount(n)}`}
      </span>

      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="m-0 text-base font-normal tracking-[-0.01em]">
          <span className="sr-only">{info ? "Info step" : `Round ${n}`}: </span>
          {title}
        </h3>
        {meta ? <p className="m-0 text-[12.5px] leading-[1.45] text-faint">{meta}</p> : null}
        {topics.length > 0 ? (
          <ul aria-label={`${title} topics`} className="m-0 mt-0.5 flex list-none flex-wrap gap-[5px] p-0">
            {topics.map((t) => (
              <li key={t} className="rounded-full bg-panel px-2.5 py-[3px] font-mono text-[11px] text-muted-foreground">
                {t}
              </li>
            ))}
          </ul>
        ) : null}
        {questions.length ? <details className="mt-2 text-[13px]"><summary className="cursor-pointer text-muted-foreground">Practice questions</summary><ul className="mb-0 mt-2 space-y-2 pl-4">{questions.map((question) => <li key={question} className="whitespace-pre-wrap leading-relaxed">{question}</li>)}</ul></details> : null}
        {sources.length ? <details className="mt-2 text-[13px]"><summary className="cursor-pointer text-muted-foreground">Round sources</summary><ul className="mb-0 mt-2 space-y-2 pl-4">{sources.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all text-xs underline underline-offset-4">{url}</a></li>)}</ul></details> : null}
      </div>

      <div className="col-start-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:col-start-3 sm:flex-col sm:items-end sm:justify-center">
        {note ? <span className="text-[12.5px] text-muted-foreground">{note}</span> : null}
        {info ? null : (
          <Button asChild variant="strong" className="h-9 px-3.5 text-[13px]">
            <Link href={bookHref(jdId, round.type)} aria-label={`${cta}: ${title}`}>
              {cta}
            </Link>
          </Button>
        )}
      </div>
    </li>
  );
}
