"use client";

import * as React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils/cn";
import type { RunLogEntry } from "@/features/observability";

/** Mono, terminal-style log view for a pipeline run. Auto-scrolls to the newest line. */
export function RunLogStream({ logs }: { logs: RunLogEntry[] }) {
  const endRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

  return (
    <ScrollArea className="h-80 rounded-xl border border-border bg-card">
      <div className="p-4 font-mono text-xs leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-muted-foreground">No log output yet.</p>
        ) : (
          logs.map((entry) => (
            <div key={entry.seq} className="flex gap-3 whitespace-pre-wrap">
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(entry.ts)}</span>
              <span className={cn("shrink-0 font-semibold", levelClass(entry.level))}>
                {entry.level.padEnd(7)}
              </span>
              <span className="text-foreground">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}

function levelClass(level: string): string {
  switch (level.toUpperCase()) {
    case "ERROR":
    case "CRITICAL":
      return "text-destructive";
    case "WARNING":
      return "text-amber-500 dark:text-amber-400";
    default:
      return "text-muted-foreground";
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
