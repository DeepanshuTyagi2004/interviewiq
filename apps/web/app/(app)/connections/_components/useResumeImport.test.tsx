import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CandidateProfileResponse } from "@/features/onboarding";
import { useResumeImport } from "./useResumeImport";

const mocks = vi.hoisted(() => ({ profile: null as CandidateProfileResponse | null | undefined, mutate: vi.fn() }));
vi.mock("@/features/onboarding", async (original) => ({
  ...(await original<typeof import("@/features/onboarding")>()),
  useCandidateProfile: () => ({ data: mocks.profile }),
  useSaveCandidateProfile: () => ({ mutate: mocks.mutate, isPending: false }),
}));
const draft: CandidateProfileResponse = { fullName: "Updated resume", email: null, phone: null, location: null, headline: null, level: null, targetRole: null, targetJdId: null, education: [], experience: [], projects: [], skills: ["SQL"], achievements: [], detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: "updated.pdf", resumeParsedAt: null, onboardingComplete: false };

describe("resume import", () => {
  beforeEach(() => { mocks.mutate.mockReset(); mocks.profile = { ...draft, level: "staff", targetJdId: "jd-1", targetRole: "Target role" }; });
  it("omits level when the saved profile read is unavailable rather than erasing a saved choice", () => {
    mocks.profile = undefined;
    const { result } = renderHook(useResumeImport);
    result.current.importDraft(draft);
    expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty("level");
  });
  it("preserves unknown saved level metadata for explicit repair", () => {
    mocks.profile = { ...draft, legacyLevel: "Career switcher" };
    const { result } = renderHook(useResumeImport);
    result.current.importDraft(draft);
    expect(mocks.mutate.mock.calls[0][0]).not.toHaveProperty("level");
  });
  it("keeps the user-selected level and target while replacing parsed resume details", () => {
    const { result } = renderHook(useResumeImport);
    result.current.importDraft(draft);
    expect(mocks.mutate.mock.calls[0][0]).toMatchObject({ level: "staff", targetJdId: "jd-1", targetRole: "Target role", fullName: "Updated resume", resumeFilename: "updated.pdf", skills: ["SQL"], complete: false });
  });
});
