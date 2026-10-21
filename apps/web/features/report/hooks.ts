"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTERVIEW_QUERY_KEYS } from "@/lib/constants/interview";
import { REPORT_POLLING, REPORT_QUERY_KEYS } from "@/lib/constants/report";
import { createDispute, getReport } from "./api";
import type { CreateReportDisputeRequest, RoundReport } from "./types";

/** A dispute re-check is running on the server (its decision lands in `disputes` with the next report version). */
export function isRecheckPending(report: Pick<RoundReport, "recheckPending"> | undefined): boolean {
  return report?.recheckPending === true;
}

/** The report for a session. Polls every 5 s while it is evaluating or a dispute re-check is running, every 30 s while grading is
 * failed (the server keeps retrying, so the report appears here when it lands). */
export function useReport(id: string) {
  return useQuery<RoundReport>({
    queryKey: REPORT_QUERY_KEYS.report(id),
    queryFn: () => getReport(id),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "failed") return REPORT_POLLING.failedIntervalMs;
      return data?.status === "evaluating" || isRecheckPending(data) ? REPORT_POLLING.intervalMs : false;
    },
  });
}

/** Question a score. A re-check never lowers it; the report, session and loops refresh afterwards. */
export function useCreateDispute(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReportDisputeRequest) => createDispute(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REPORT_QUERY_KEYS.report(id) });
      void queryClient.invalidateQueries({ queryKey: INTERVIEW_QUERY_KEYS.session(id) });
      void queryClient.invalidateQueries({ queryKey: ["loops"] });
    },
  });
}
