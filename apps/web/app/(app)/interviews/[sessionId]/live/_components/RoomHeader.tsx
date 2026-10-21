"use client";

import { useEffect, useRef } from "react";
import { Chip, Count, StatusDot } from "@/components/ds";
import type { Ledger } from "@/features/interview-live/proctor/ledger";
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
      className="inline-flex h-[26px] items-center rounded-full bg-surface-2 px-2.5 font-mono text-[12.5px] tabular-nums text-foreground"
    >
      00:00
    </span>
  );
}

/** One proctoring counter as a small chip: hollow dot and soft fill while nothing is logged, filled dot and an
 * outline once something is. */
function Counter({ label, logged, children }: { label: string; logged: boolean; children: React.ReactNode }) {
  return (
    <Chip tone={logged ? "outline" : "default"} dot={logged ? "filled" : "hollow"} className="text-[12px]">
      <span className="sr-only">{logged ? "Logged: " : "None: "}</span>
      {label}
      <span className={logged ? "tabular-nums text-foreground" : "tabular-nums text-ink-3"}>{children}</span>
    </Chip>
  );
}

/** The live room's header (spec §5.5): the round, the live dot, the proctoring counters and the clock. No countdown.
 * Camera flags come from the on-device camera check; they are the candidate's record and change no result. The
 * counter is left out when the check isn't running (its files aren't on this device). */
export function RoomHeader({ meta, ledger, cameraFlags }: { meta?: RoomMeta; ledger: Ledger; cameraFlags?: number }) {
  const switches = ledger.tabChanges + ledger.screenChanges;
  return (
    <header className="flex h-12 flex-none items-center gap-3 border-b border-line px-4 text-[13px] sm:gap-4">
      <span className="min-w-0 truncate text-[13px] font-medium text-ink-2" title={roomEyebrow(meta)}>{roomEyebrow(meta)}</span>
      <StatusDot state="live" label="Live" className="hidden sm:inline-flex" />
      <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
        {/* One chip for both ledger counters (owner 2026-10-21): tab changes plus screen changes. The ledger itself is unchanged. */}
        <Counter label="Screen switches" logged={switches > 0}>
          <span aria-hidden>{Number.isInteger(switches) ? String(switches) : switches.toFixed(1)}</span>
          <span className="sr-only">{`${switches} screen switches`}</span>
        </Counter>
        {cameraFlags !== undefined ? (
          <Counter label="Camera flags" logged={cameraFlags > 0}>
            <Count n={cameraFlags} label={`${cameraFlags} camera flags`} />
          </Counter>
        ) : null}
        <ElapsedClock />
      </div>
    </header>
  );
}
