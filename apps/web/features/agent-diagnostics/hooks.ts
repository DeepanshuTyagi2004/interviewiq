"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import * as api from "./api";
import type { AgentSession, AgentSessionStatus } from "./types";

/** Poll cadence while a session is active (matches features/observability's cadence). */
const POLL_MS = 1000;

/** Terminal statuses stop polling; `awaiting_input` is NOT terminal — the session is
 *  paused waiting on the next candidate turn, not finished. */
export function isSessionTerminal(s: AgentSessionStatus | undefined): boolean {
  return s === "completed" || s === "failed" || s === "abandoned" || s === "aborted";
}

/** Start an instrumented agent-diagnostics session from a plan. */
export function useStartAgentSession() {
  return useMutation({ mutationFn: (plan: unknown) => api.startAgentSession(plan) });
}

/** Submit one turn (candidate text / artifact / silence) to a running session. */
export function useSubmitTurn() {
  return useMutation({
    mutationFn: (v: { runId: string; body: Parameters<typeof api.submitTurn>[1] }) =>
      api.submitTurn(v.runId, v.body),
  });
}

/** End (abort) a running session. */
export function useEndAgentSession() {
  return useMutation({ mutationFn: (runId: string) => api.endAgentSession(runId) });
}

/** Recent agent-diagnostics sessions for the picker/list view. */
export function useAgentSessions() {
  return useQuery({ queryKey: ["agent-diag", "list"], queryFn: () => api.listAgentSessions() });
}

/**
 * Poll one agent session (accumulating logs) until it reaches a terminal state.
 *
 * Mirrors `features/observability`'s `useRunPolling`, but standalone: `AgentSession` has a
 * 6-value status (including the non-terminal `awaiting_input`) and a `_logs` field instead of
 * `logs`, so it can't reuse the `RunSnapshot`-typed poller as-is.
 */
export function useAgentSession(runId: string | null) {
  const acc = useRef<{ runId: string | null; lastSeq: number; logs: AgentSession["_logs"] }>({
    runId: null, lastSeq: 0, logs: [],
  });
  return useQuery({
    queryKey: ["agent-diag", "run", runId],
    enabled: !!runId,
    refetchInterval: (q) => (isSessionTerminal(q.state.data?.status) ? false : POLL_MS),
    queryFn: async () => {
      const id = runId as string;
      if (acc.current.runId !== id) acc.current = { runId: id, lastSeq: 0, logs: [] };
      const snap = await api.getAgentSession(id, acc.current.lastSeq);
      acc.current.lastSeq = snap.last_seq;
      acc.current.logs = [...acc.current.logs, ...snap._logs];
      return { ...snap, _logs: acc.current.logs };
    },
  });
}
