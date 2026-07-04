import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the low-level fetch wrapper so the hook → api → apiFetch chain is exercised.
const apiFetchMock = vi.fn();
vi.mock("@/lib/api-client/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { useSession } from "./hooks";
import type { InterviewSession } from "./types";

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
  level: "L4",
  specialization: "Backend",
  roundType: "dsa",
  scheduledAt: "2026-07-10T10:00:00Z",
  timezone: "UTC",
  status: "SCHEDULED",
  planReady: false,
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
});
