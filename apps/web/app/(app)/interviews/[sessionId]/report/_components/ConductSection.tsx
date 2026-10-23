"use client";

import { Card, EmptyState } from "@/components/ds";
import { deltaLabel, markerMeta, roundClock, type RoundReport } from "@/features/report";
import { MomentLink } from "./MomentLink";

type Event = NonNullable<RoundReport["conduct"]>[number];

function effectText(effect: unknown): string {
  if (typeof effect === "number") return deltaLabel(effect);
  return typeof effect === "string" ? effect : "";
}

function Rows({ title, events, startAt }: { title: string; events: Event[]; startAt: string | null }) {
  return (
    <div className="border-t border-line">
      <h3 className="m-0 px-5 pt-4 font-mono text-xs font-normal uppercase tracking-[0.08em] text-ink-3">{title}</h3>
      <ul className="m-0 list-none pb-2 pt-1">
        {events.map((e, i) => (
          <li key={`${e.kind}-${i}`} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-baseline gap-3 px-5 py-2 text-[13.5px]">
            <span className="flex items-center gap-1 font-mono text-[12px] text-ink-3">
              {roundClock(e.at, startAt) || "—"}
              {e.turnId != null ? <MomentLink turnId={e.turnId} /> : null}
            </span>
            <span className="min-w-0">{markerMeta(e.kind).label}</span>
            <span className="font-mono text-[12.5px] tabular-nums text-ink-2">{effectText(e.effect)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Conduct and integrity events: when, what happened, and the effect on the score. */
export function ConductSection({ report }: { report: RoundReport }) {
  const conduct = report.conduct ?? [];
  const integrity = report.integrity ?? [];
  const startAt = report.transcript?.[0]?.at ?? null;
  return (
    <Card flush title="Conduct & integrity" headerClassName="pb-4">
      {conduct.length === 0 && integrity.length === 0 ? (
        <EmptyState orb={false} title="Nothing to report" hint="No conduct or integrity events came up in this round." className="border-t border-line py-10" />
      ) : (
        <>
          {conduct.length > 0 ? <Rows title="Conduct" events={conduct} startAt={startAt} /> : null}
          {integrity.length > 0 ? <Rows title="Integrity" events={integrity} startAt={startAt} /> : null}
        </>
      )}
    </Card>
  );
}
