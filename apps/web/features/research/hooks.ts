"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiFetchError } from "@/lib/api-client/client";
import { CONSOLE_MAX_ROWS, EVENTS_PAGE_LIMIT, RESEARCH_POLLING, RESEARCH_QUERY_KEYS as K } from "@/lib/constants/research";
import {
  controlRun, createCompany, deleteCompany, getRun, getSpan, listAdminCompanies, listRunEvents, listRunSpans,
  listRuns, raiseBudget, seedCompanies, startRun, updateCompany,
} from "./api";
import { appendCapped, initialAfterSeq, olderPageQuery } from "./event-filters";
import { isRunActive } from "./status";
import type { ResearchEvent, RunAction, UpdateCompanyRequest } from "./types";

export function useAdminCompanies() {
  return useQuery({ queryKey: K.companies, queryFn: listAdminCompanies, refetchInterval: RESEARCH_POLLING.listsMs });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: createCompany, onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }) });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateCompanyRequest }) => updateCompany(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }),
  });
}

export function useDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => deleteCompany(id), onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }) });
}

export function useSeedCompanies() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => seedCompanies(), onSuccess: () => qc.invalidateQueries({ queryKey: K.companies }) });
}

export function useResearchRuns() {
  return useQuery({ queryKey: K.runs, queryFn: () => listRuns(20), refetchInterval: RESEARCH_POLLING.listsMs });
}

export function useResearchRun(runId: string | null) {
  return useQuery({
    queryKey: K.run(runId ?? "none"),
    queryFn: () => getRun(runId!),
    enabled: !!runId,
    // A missing run is a definite answer; show "not found" now instead of after the retry backoff.
    retry: (count, err) => !(err instanceof ApiFetchError && err.status === 404) && count < 3,
    refetchInterval: (q) => (q.state.data && isRunActive(q.state.data.run.status) ? RESEARCH_POLLING.liveMs : false),
  });
}

export function useRunSpans(runId: string | null, live: boolean) {
  return useQuery({
    queryKey: K.spans(runId ?? "none"),
    queryFn: () => listRunSpans(runId!),
    enabled: !!runId,
    refetchInterval: live ? RESEARCH_POLLING.spansMs : false,
  });
}

export function useSpanDetail(spanId: string | null) {
  return useQuery({
    queryKey: K.span(spanId ?? "none"),
    queryFn: () => getSpan(spanId!),
    enabled: !!spanId,
    refetchInterval: (q) => (q.state.data?.span.status === "running" ? RESEARCH_POLLING.liveMs : false),
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: K.runs });
      qc.invalidateQueries({ queryKey: K.companies });
    },
  });
}

export function useRunControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, action }: { runId: string; action: RunAction }) => controlRun(runId, action),
    onSuccess: (_run, { runId }) => {
      qc.invalidateQueries({ queryKey: K.run(runId) });
      qc.invalidateQueries({ queryKey: K.runs });
    },
  });
}

export function useRaiseBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, exaCap, llmCap }: { runId: string; exaCap?: number; llmCap?: number }) => raiseBudget(runId, { exaCap, llmCap }),
    onSuccess: (_run, { runId }) => qc.invalidateQueries({ queryKey: K.run(runId) }),
  });
}

/**
 * The console's event buffer. Opens at the run's newest CONSOLE_MAX_ROWS events, then tails by seq
 * while the run is live. "Load older" fetches the page before the oldest row; after that the buffer
 * stops trimming so the older rows stay put.
 */
export function useRunEvents(runId: string | null, opts: { live: boolean; lastSeq: number | undefined }) {
  const [buffer, setBuffer] = React.useState<{ runId: string | null; events: ResearchEvent[] }>({ runId, events: [] });
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  // Paging state belongs to one run; a different runId starts it afresh.
  const paging = React.useRef<{ runId: string | null; cursor: number | null; keepAll: boolean }>({ runId, cursor: null, keepAll: false });

  // A different run starts with an empty console (adjusting state during render, not in an effect).
  if (buffer.runId !== runId) setBuffer({ runId, events: [] });
  const events = buffer.runId === runId ? buffer.events : [];
  const setEvents = React.useCallback(
    (update: (prev: ResearchEvent[]) => ResearchEvent[]) => setBuffer((b) => (b.runId === runId ? { runId, events: update(b.events) } : b)),
    [runId],
  );

  const query = useQuery({
    queryKey: K.events(runId ?? "none"),
    enabled: !!runId && opts.lastSeq !== undefined,
    refetchInterval: opts.live ? RESEARCH_POLLING.liveMs : false,
    // The buffer lives in component state, so the cache must never skip a refill on mount or run switch.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      // No tail position yet (e.g. a manual refetch before the run detail loaded): never scan from seq 0.
      if (opts.lastSeq === undefined) return 0;
      if (paging.current.runId !== runId) paging.current = { runId, cursor: null, keepAll: false };
      const state = paging.current;
      if (state.cursor === null) state.cursor = initialAfterSeq(opts.lastSeq ?? 0, CONSOLE_MAX_ROWS);
      for (;;) {
        const page = await listRunEvents(runId!, { afterSeq: state.cursor, limit: EVENTS_PAGE_LIMIT });
        if (page.events.length > 0) {
          state.cursor = page.events[page.events.length - 1]!.seq;
          const batch = page.events;
          setEvents((prev) => appendCapped(prev, batch, state.keepAll ? Number.POSITIVE_INFINITY : CONSOLE_MAX_ROWS));
        }
        if (page.events.length < EVENTS_PAGE_LIMIT) return page.last_seq;
      }
    },
  });

  const oldest = events[0]?.seq ?? null;
  const loadOlder = React.useCallback(async () => {
    const q = olderPageQuery(oldest, EVENTS_PAGE_LIMIT);
    if (!q || !runId) return;
    setLoadingOlder(true);
    const state = paging.current;
    try {
      const page = await listRunEvents(runId, q);
      state.keepAll = true;
      setEvents((prev) => appendCapped(prev, page.events, Number.POSITIVE_INFINITY));
    } finally {
      setLoadingOlder(false);
    }
  }, [oldest, runId, setEvents]);

  return { events, error: query.error, refetch: query.refetch, loadOlder, canLoadOlder: olderPageQuery(oldest, EVENTS_PAGE_LIMIT) !== null, loadingOlder };
}
