"use client";

import * as React from "react";
import { LogTerminal } from "@/components/observability/LogTerminal";
import type { LogEntry } from "@/features/intelligence";

/** Mono, terminal-style verbose log view for the ingestion run. Auto-scrolls to the newest line. */
export function LogStream({
  logs,
  meta,
  className = "h-96",
}: {
  logs: LogEntry[];
  /** Right side of the terminal header (defaults to the line count). */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <LogTerminal
      logs={logs}
      title="Live logs"
      meta={meta}
      emptyText="No log output yet. Trigger a run to stream verbose logs here."
      className={className}
    />
  );
}
