"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { isTerminal, type RunSnapshot } from "./types";

/** Poll cadence while a run is active (parse ≈ 5–10s; prep longer). */
const POLL_MS = 1000;

/**
 * Poll one pipeline run and accumulate its log stream.
 *
 * The server returns the full step list on every poll but only *new* log lines (seq > after),
 * so this hook threads `after=last_seq` and stitches the deltas into a growing list. Polling stops
 * once the run reaches a terminal state. Pass a `null` runId to stay idle (before a run starts).
 */
export function useRunPolling(
  queryKeyPrefix: string,
  runId: string | null,
  fetchRun: (runId: string, after: number) => Promise<RunSnapshot>,
) {
  // Per-runId accumulator: reset whenever the polled run changes.
  const acc = React.useRef<{ runId: string | null; lastSeq: number; logs: RunSnapshot["logs"] }>({
    runId: null,
    lastSeq: 0,
    logs: [],
  });

  return useQuery<RunSnapshot>({
    queryKey: [queryKeyPrefix, "run", runId],
    enabled: !!runId,
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : POLL_MS),
    queryFn: async () => {
      if (acc.current.runId !== runId) {
        acc.current = { runId, lastSeq: 0, logs: [] };
      }
      const snap = await fetchRun(runId as string, acc.current.lastSeq);
      acc.current.lastSeq = snap.last_seq;
      acc.current.logs = [...acc.current.logs, ...snap.logs];
      return { ...snap, logs: acc.current.logs };
    },
  });
}
