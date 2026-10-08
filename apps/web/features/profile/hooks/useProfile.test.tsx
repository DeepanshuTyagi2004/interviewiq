import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the low-level fetch wrapper so the hook → api → apiFetch chain is exercised.
const apiFetchMock = vi.fn();
vi.mock("@/lib/api-client/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { useProfile } from "./useProfile";
import type { ProfileResponse } from "../types/profile";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SAMPLE: ProfileResponse = {
  user: { name: "Aisha Verma", headline: null },
  sources: [
    { source: "GITHUB", connected: true, lastRefreshedAt: "2026-06-06T00:00:00Z" },
    { source: "RESUME", connected: false },
    { source: "LEETCODE", connected: false },
    { source: "LINKEDIN", connected: false },
  ],
  notable: [{ text: "1,204 GitHub contributions in the last year", source: "GITHUB" }],
  mostUsedSkills: [{ skill: "TypeScript", evidence: "GitHub 48%", source: "GITHUB" }],
  fragments: {
    github: {
      login: "aishav",
      name: "Aisha Verma",
      avatarUrl: "https://example.com/a.png",
      joinedYear: 2021,
      publicRepos: 38,
      contributions: { lastYear: 1204, weeks: [] },
      languages: [{ name: "TypeScript", pct: 48, bytes: 1234567 }],
      externalPRs: 17,
      topRepos: [{ name: "campus-placement-bot", stars: 42, primaryLang: "TypeScript" }],
    },
  },
  provenance: [
    { source: "GITHUB", fragmentHash: "sha256:abc", fetchedAt: "2026-06-06T00:00:00Z" },
  ],
};

describe("useProfile", () => {
  beforeEach(() => apiFetchMock.mockReset());

  it("calls GET /api/v1/profile/me and returns the parsed profile", async () => {
    apiFetchMock.mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/profile/me");
    expect(result.current.data?.user.name).toBe("Aisha Verma");
  });

  it("reports GitHub connected and other sources as placeholders", async () => {
    apiFetchMock.mockResolvedValue(SAMPLE);
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const byKind = Object.fromEntries(
      result.current.data!.sources.map((s) => [s.source, s.connected]),
    );
    expect(byKind.GITHUB).toBe(true);
    expect(byKind.RESUME).toBe(false);
    expect(byKind.LEETCODE).toBe(false);
  });
});
