import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the low-level fetch wrapper so the hook → api → apiFetch chain is exercised.
const apiFetchMock = vi.fn();
vi.mock("@/lib/api-client/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { useSession } from "./hooks";
import type { InterviewSession } from "./types";
import { INTERVIEW_POLLING } from "@/lib/constants/interview";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SAMPLE_SESSION: InterviewSession = {
  id: "abc",
  candidateId: "cand123",
  jobDescriptionId: "jd123",
  company: "google",
  companyName: "Google",
  role: "Software Engineer",
  level: "sde2",
  specialization: "Backend",
  roundType: "dsa",
  scheduledAt: "2026-07-10T10:00:00Z",
  timezone: "UTC",
  status: "SCHEDULED",
  prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
  briefing: null,
  liveAvailable: true,
  endReason: null,
  createdAt: "2026-06-10T10:00:00Z",
  updatedAt: "2026-06-10T10:00:00Z",
};

describe("useSession", () => {
  beforeEach(() => apiFetchMock.mockReset());

  it("calls GET /api/v1/interviews/sessions/{id} and returns the session", async () => {
    apiFetchMock.mockResolvedValue(SAMPLE_SESSION);
    const { result } = renderHook(() => useSession("abc"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/interviews/sessions/abc");
    expect(result.current.data?.id).toBe("abc");
  });

  it("does not fetch if id is empty", async () => {
    const { result } = renderHook(() => useSession(""), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("pending"));
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  describe("conditional polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("stops polling once status is terminal (PREP_READY)", async () => {
      apiFetchMock.mockResolvedValue({ ...SAMPLE_SESSION, status: "PREP_READY" });
      const { result } = renderHook(() => useSession("s1"), { wrapper });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.isSuccess).toBe(true);
      expect(apiFetchMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERVIEW_POLLING.sessionsIntervalMs * 2);
      });

      expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });

    it("keeps polling while status is non-terminal (SCHEDULED)", async () => {
      apiFetchMock.mockResolvedValue({ ...SAMPLE_SESSION, status: "SCHEDULED" });
      const { result } = renderHook(() => useSession("s1"), { wrapper });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.isSuccess).toBe(true);
      expect(apiFetchMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERVIEW_POLLING.sessionsIntervalMs + 500);
      });

      expect(apiFetchMock.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
