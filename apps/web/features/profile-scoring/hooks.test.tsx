import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSaveCandidateProfile } from "@/features/onboarding/hooks";
import type { CandidateProfileRequest } from "@/features/onboarding/types";
import { ONBOARDING_ENDPOINTS } from "@/lib/constants/onboarding";
import { useProfileScore } from "./hooks";
import { PROFILE_SCORE_FIXTURE, scoringWrapper } from "./test-fixtures";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiFetch: (...args: unknown[]) => fetchMock(...args) }));

describe("candidate scoring freshness", () => {
  it("refreshes the separate score after a saved resume/profile edit without a scoring POST", async () => {
    const candidate: CandidateProfileRequest = {
      fullName: "Asha", email: null, phone: null, location: null, headline: null, targetRole: null, targetJdId: null,
      education: [], experience: [], projects: [], skills: ["TypeScript"], achievements: [],
      detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null, complete: false,
    };
    let saved = false;
    fetchMock.mockImplementation((path: string, options?: { method: string }) => {
      if (path === ONBOARDING_ENDPOINTS.candidateProfile && options?.method === "PUT") {
        saved = true;
        return Promise.resolve({ ...candidate, resumeParsedAt: null, onboardingComplete: false });
      }
      return Promise.resolve({ ...PROFILE_SCORE_FIXTURE, current: { ...PROFILE_SCORE_FIXTURE.current, score: saved ? 86 : 73 } });
    });
    const { result } = renderHook(() => ({ score: useProfileScore(), save: useSaveCandidateProfile() }), { wrapper: scoringWrapper().wrapper });
    await waitFor(() => expect(result.current.score.data?.current?.score).toBe(73));
    await act(async () => { await result.current.save.mutateAsync(candidate); });
    await waitFor(() => expect(result.current.score.data?.current?.score).toBe(86));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  });
});
