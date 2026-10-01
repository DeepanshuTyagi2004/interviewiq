"use client";

import type { RunLogEntry } from "@/features/observability";
import { LogTerminal } from "./LogTerminal";

/** Mono, terminal-style log view for a pipeline run. Auto-scrolls to the newest line. */
export function RunLogStream({
  logs,
  title = "Logs",
  className = "h-80",
}: {
  logs: RunLogEntry[];
  title?: string;
  /** Height of the terminal (the body scrolls inside it). */
  className?: string;
}) {
  return <LogTerminal logs={logs} title={title} className={className} />;
}
