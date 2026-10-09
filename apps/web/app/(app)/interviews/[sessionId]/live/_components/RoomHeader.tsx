"use client";

import { useEffect, useRef } from "react";
import { Count, StatusDot } from "@/components/hud";
import { cn } from "@/lib/utils/cn";
import { formatWeighted, type Ledger } from "@/features/interview-live/proctor/ledger";
import { formatElapsed, roomEyebrow, type RoomMeta } from "./roomMeta";

/** Time since the candidate entered. Writes the DOM once a second, so the clock never re-renders the room. */
function ElapsedClock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      if (ref.current) ref.current.textContent = formatElapsed(Date.now() - start);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span
      role="timer"
      aria-label="Time since you joined"
      ref={ref}
      className="rounded-full border border-line-3 px-2.5 py-[3px] font-mono text-[12.5px] tabular-nums"
    >
      00:00
    </span>
  );
}

function Counter({ label, logged, children }: { label: string; logged: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
      <StatusDot state={logged ? "warn" : "idle"} srLabel={logged ? "Logged" : "None"} />
      {label}
      <span aria-hidden className="h-px w-3 bg-line-3" />
      <span className={cn("text-[12.5px] tabular-nums", logged ? "text-foreground" : "text-faint")}>{children}</span>
    </span>
  );
}

/** The live room's header (spec §10): the round, the live dot, the two proctoring counters and the clock. No countdown. */
export function RoomHeader({ meta, ledger }: { meta?: RoomMeta; ledger: Ledger }) {
  return (
    <header className="flex h-12 flex-none items-center gap-4 border-b border-line-2 px-4 text-[13px]">
      <span className="iq-eyebrow min-w-0 truncate">{roomEyebrow(meta)}</span>
      <StatusDot state="live" label="Live" className="text-muted-foreground" />
      <div className="ml-auto flex items-center gap-4">
        <Counter label="Tab changes" logged={ledger.tabChanges > 0}>
          <Count n={ledger.tabChanges} label={`${ledger.tabChanges} tab changes`} />
        </Counter>
        <Counter label="Screen changes" logged={ledger.screenChanges > 0}>
          <span aria-hidden>{formatWeighted(ledger.screenChanges)}</span>
          <span className="sr-only">{`${ledger.screenChanges} screen changes`}</span>
        </Counter>
        <ElapsedClock />
      </div>
    </header>
  );
}
