import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { REPORT_POLLING, REPORT_QUERY_KEYS } from "@/lib/constants/report";

const { getReportMock } = vi.hoisted(() => ({ getReportMock: vi.fn() }));
vi.mock("./api", () => ({ getReport: getReportMock, createDispute: vi.fn() }));

import { useReport } from "./hooks";

async function intervalFor(data: unknown) {
  getReportMock.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useReport("s1"), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  const query = client.getQueryCache().find({ queryKey: REPORT_QUERY_KEYS.report("s1") })!;
  const opt = query.observers[0]!.options.refetchInterval as (q: typeof query) => number | false;
  return opt(query);
}

describe("useReport polling", () => {
  it("polls every 30 s while grading is failed, so the report appears when it lands", async () => {
    expect(await intervalFor({ status: "failed" })).toBe(REPORT_POLLING.failedIntervalMs);
    expect(REPORT_POLLING.failedIntervalMs).toBe(30_000);
  });
  it("polls every 5 s while evaluating and stops once ready", async () => {
    expect(await intervalFor({ status: "evaluating" })).toBe(REPORT_POLLING.intervalMs);
    expect(await intervalFor({ status: "ready", recheckPending: false })).toBe(false);
  });
});
