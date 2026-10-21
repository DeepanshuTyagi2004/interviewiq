"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/ds";
import { cn } from "@/lib/utils/cn";
import { markerMeta, roundClock, type RoundReport } from "@/features/report";
import { FOCUS_RING } from "./styles";

/** The full spoken transcript. Each turn is `#turn-<id>` so every ↗ can scroll here; chips filter by marker kind. */
export function TranscriptSection({ report }: { report: RoundReport }) {
  const turns = report.transcript ?? [];
  const [filter, setFilter] = useState<string | null>(null);
  const kinds = useMemo(() => {
    const seen: string[] = [];
    for (const t of turns) for (const m of t.markers ?? []) if (m.kind && !seen.includes(m.kind)) seen.push(m.kind);
    return seen;
  }, [turns]);
  const startAt = turns[0]?.at ?? null;
  const shown = filter ? turns.filter((t) => t.markers?.some((m) => m.kind === filter)) : turns;

  return (
    <Card flush title="Transcript" meta={turns.length ? `${turns.length} turns` : undefined} headerClassName="pb-4">
      {turns.length === 0 ? (
        <EmptyState orb={false} title="No transcript for this round" className="border-t border-line py-10" />
      ) : (
        <>
          {kinds.length > 0 ? (
            <div role="group" aria-label="Filter by marker" className="flex flex-wrap gap-1.5 border-t border-line px-5 py-3.5">
              <FilterChip active={filter === null} onClick={() => setFilter(null)}>All</FilterChip>
              {kinds.map((k) => (
                <FilterChip key={k} active={filter === k} onClick={() => setFilter(filter === k ? null : k)}>
                  {markerMeta(k).label}
                </FilterChip>
              ))}
            </div>
          ) : null}
          <ol className="m-0 max-h-[640px] list-none overflow-y-auto border-t border-line p-0">
            {shown.map((t) => (
              <li key={t.turnId} id={`turn-${t.turnId}`} className="grid scroll-mt-4 gap-x-5 gap-y-1 border-b border-line px-5 py-3 transition-colors last:border-b-0 sm:grid-cols-[88px_minmax(0,1fr)]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] sm:flex-col sm:items-start sm:gap-y-0.5 sm:pt-0.5">
                  <span className={t.speaker === "interviewer" ? "text-ink-3" : "font-medium text-ink"}>{t.speaker === "interviewer" ? "Interviewer" : "You"}</span>
                  <span className="font-mono text-ink-3">{roundClock(t.at, startAt)}</span>
                </div>
                <div className="min-w-0">
                  {(t.cutOff || (t.markers ?? []).length > 0) ? (
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      {t.cutOff ? <span className="rounded-full bg-surface-2 px-2 text-[11px] leading-5 text-ink-2">cut off</span> : null}
                      {(t.markers ?? []).map((m, i) => (
                        <span
                          key={`${m.kind}-${i}`}
                          title={m.note || undefined}
                          className={cn(
                            "rounded-full px-2 text-[11px] leading-5",
                            markerMeta(m.kind ?? "").tone === "good" ? "bg-ink text-background" : "bg-surface-2 text-ink-2",
                          )}
                        >
                          {markerMeta(m.kind ?? "").label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className={cn("m-0 whitespace-pre-wrap text-[13.5px] leading-[1.6]", t.speaker === "interviewer" ? "text-ink-2" : "text-ink")}>{t.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-7 rounded-full px-3 text-[12.5px] transition-colors duration-150 ease-iq",
        FOCUS_RING,
        active ? "bg-ink text-background" : "bg-surface-2 text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
