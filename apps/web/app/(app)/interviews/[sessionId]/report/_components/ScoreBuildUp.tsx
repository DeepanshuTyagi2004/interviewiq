"use client";

import { useState } from "react";
import { Card, Meter } from "@/components/ds";
import { cn } from "@/lib/utils/cn";
import { deltaLabel, formatScore, roundClock, type ReportArea, type RoundReport } from "@/features/report";
import { jumpToTurn } from "./jumpToTurn";
import { DisputeControl } from "./DisputeDialog";
import { PILL_BUTTON } from "./styles";

function AreaRow({ area, report, sessionId }: { area: ReportArea; report: RoundReport; sessionId?: string }) {
  const [open, setOpen] = useState(false);
  const prev = area.previousScore;
  const arrow = prev == null ? null : area.score > prev ? "↑" : area.score < prev ? "↓" : "→";
  return (
    <li className="border-t border-line">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 sm:grid-cols-[minmax(0,1.4fr)_44px_minmax(90px,1fr)_auto_auto]">
        <span className="min-w-0 text-[14.5px]">{area.label}</span>
        <span className="font-mono text-[12px] text-ink-3">{area.weight}%</span>
        <Meter value={area.score / 10} className="col-span-2 sm:col-span-1" label={`${area.label} ${formatScore(area.score)} out of 10`} />
        <span className="font-mono text-[13px] tabular-nums">
          {formatScore(area.score)}
          {prev != null ? (
            <span className="ml-2 text-ink-3">
              {formatScore(prev)} → {formatScore(area.score)} {arrow}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`${PILL_BUTTON} h-6 justify-self-end px-2.5 text-[12px]`}
        >
          why<span className="sr-only"> for {area.label}</span>
        </button>
      </div>
      {open ? (
        <div className="px-5 pb-3">
          <p className="m-0 max-w-[68ch] text-[13.5px] leading-[1.6] text-ink-2">{area.reason}</p>
          {area.evidence.length > 0 ? (
            <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
              {area.evidence.map((ev, i) => {
                const turn = /^turn:(\d+)$/.exec(ev);
                return (
                  <li key={`${ev}-${i}`}>
                    {turn ? (
                      <button
                        type="button"
                        onClick={() => jumpToTurn(Number(turn[1]))}
                        className={`${PILL_BUTTON} h-5 px-2 font-mono text-xs`}
                      >
                        Moment ↗
                      </button>
                    ) : (
                      <span className="text-[12px] text-ink-3">{ev === "code" ? "Your code" : ev === "board" ? "Your diagram" : ev}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      {sessionId ? (
        <div className="px-5 pb-3">
          <DisputeControl report={report} sessionId={sessionId} targetType="area" targetId={area.key} targetLabel={area.label} />
        </div>
      ) : null}
    </li>
  );
}

/** Most the positive adjustments add together (the bonus cap, spec §8.1). */
export const BONUS_CAP = 0.5;

/**
 * The arithmetic in one line, so the score can be reproduced: "Base 6.9 · Bonuses +0.5 (capped at +0.5) · Penalties −0.35 ·
 * Cap — · Score 7.1". A report without the stored parts (an older version) falls back to the sum of the adjustments.
 */
export function buildUpLine(report: RoundReport): string | null {
  const score = report.score ?? null;
  if (score === null) return null;
  const cap = `Cap ${report.cap ? "applied" : "—"}`;
  const adjustments = report.adjustments ?? [];
  if (report.baseScore == null) {
    const adjTotal = adjustments.reduce((sum, a) => sum + a.delta, 0);
    return `Adjustments ${deltaLabel(Number(adjTotal.toFixed(3)))} · ${cap} · Score ${formatScore(score)}`;
  }
  const bonus = report.bonusTotal ?? 0;
  const penalty = report.penaltyTotal ?? 0;
  const rawBonus = adjustments.reduce((sum, a) => sum + (a.delta > 0 ? a.delta : 0), 0);
  const capped = rawBonus > BONUS_CAP + 1e-9 ? ` (capped at +${BONUS_CAP})` : "";
  return `Base ${formatScore(report.baseScore)} · Bonuses ${deltaLabel(Number(bonus.toFixed(3)))}${capped} · Penalties ${deltaLabel(Number(penalty.toFixed(3)))} · ${cap} · Score ${formatScore(score)}`;
}

/** "How your score was built": areas, the Base · Bonuses · Penalties · Cap · Score line, then each adjustment. */
export function ScoreBuildUp({ report, sessionId }: { report: RoundReport; sessionId?: string }) {
  const areas = report.areas ?? [];
  const adjustments = report.adjustments ?? [];
  const line = buildUpLine(report);
  const startAt = report.transcript?.[0]?.at ?? null;
  return (
    <Card flush title="How your score was built" headerClassName="pb-4">
      <ul className="m-0 list-none p-0">
        {areas.map((a) => (
          <AreaRow key={a.key} area={a} report={report} sessionId={sessionId} />
        ))}
      </ul>
      {report.cap ? (
        <div role="note" className="flex gap-3 border-t border-line bg-surface px-5 py-3.5 text-[13.5px]">
          <span className="font-mono text-xs uppercase tracking-[0.06em] text-ink-3">Cap</span>
          <span className="min-w-0">{report.cap}</span>
        </div>
      ) : null}
      {line !== null ? (
        <p className="m-0 border-t border-line px-5 py-3.5 font-mono text-[12.5px] tabular-nums text-ink-2">{line}</p>
      ) : null}
      {adjustments.length > 0 ? (
        <ul className="m-0 list-none border-t border-line py-2">
          {adjustments.map((adj, i) => (
            <li key={`${adj.kind}-${i}`} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-baseline gap-3 px-5 py-2 text-[13.5px]">
              <span className={cn("font-mono tabular-nums", adj.delta > 0 ? "text-ink" : "text-ink-2")}>{deltaLabel(adj.delta)}</span>
              <span className="min-w-0">
                {adj.label}
                {adj.note ? <span className="text-ink-3"> · {adj.note}</span> : null}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[12px] text-ink-3">
                {roundClock(adj.at, startAt)}
                {adj.turnId != null ? (
                  <button
                    type="button"
                    aria-label={`Jump to moment ${adj.turnId}`}
                    onClick={() => jumpToTurn(adj.turnId as number)}
                    className="rounded-full hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    ↗
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
