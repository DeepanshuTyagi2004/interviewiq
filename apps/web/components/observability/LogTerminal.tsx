"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** The fields every log line carries (pipeline runs and the ingestion run share this shape). */
export interface LogLine {
  seq: number;
  ts: string;
  level: string;
  message: string;
}

/**
 * Mono, terminal-style log view on the always-dark `bg-inv` surface (fixed light text colours
 * inside, like the dashboard's up-next card). Follows the newest line while you're at the bottom;
 * scroll up to read and it stops following until you return. Only the log box scrolls — never the
 * page around it.
 */
export function LogTerminal({
  logs,
  title = "Logs",
  meta,
  emptyText = "No log output yet.",
  className,
}: {
  logs: LogLine[];
  title?: string;
  /** Right side of the header; defaults to the line count. */
  meta?: React.ReactNode;
  emptyText?: string;
  /** Set the height here (e.g. `h-96`); the body scrolls inside it. */
  className?: string;
}) {
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  // Whether the reader is at (or near) the bottom — only then do new lines pull the view down.
  const followRef = React.useRef(true);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-[14px] bg-inv text-[#dcdbd6] dark:ring-1 dark:ring-inset dark:ring-line-2",
        className,
      )}
    >
      <div className="flex flex-none items-center justify-between gap-3 border-b border-white/10 px-4 py-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#9d9c97] sm:px-5">
        <h2 className="m-0 font-normal">{title}</h2>
        <span className="tabular-nums">{meta ?? `${logs.length} ${logs.length === 1 ? "line" : "lines"}`}</span>
      </div>
      <div
        ref={bodyRef}
        role="region"
        aria-label={`${title} output`}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
        }}
        className="min-h-0 flex-1 overflow-auto px-4 py-3.5 font-mono text-xs leading-relaxed [scrollbar-color:#3a3a37_transparent] [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40 sm:px-5"
      >
        {logs.length === 0 ? (
          <p className="m-0 text-[#8d8c87]">{emptyText}</p>
        ) : (
          logs.map((entry) => (
            <div key={entry.seq} className="flex gap-3 whitespace-pre-wrap">
              <span className="shrink-0 tabular-nums text-[#8d8c87]">{formatTime(entry.ts)}</span>
              <span className={cn("min-w-[7ch] shrink-0", levelClass(entry.level))}>{entry.level}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** How close to the bottom (px) still counts as "following" the log. */
const FOLLOW_THRESHOLD_PX = 24;

/** Level colours for the dark surface: warnings in brand, errors in a light red, the rest quiet. */
export function levelClass(level: string): string {
  switch (level.toUpperCase()) {
    case "ERROR":
    case "CRITICAL":
      return "text-[#ff7b72]";
    case "WARNING":
      return "text-brand";
    default:
      return "text-[#9d9c97]";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "--:--:--";
  }
}
