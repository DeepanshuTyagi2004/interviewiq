import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CandidateProfileResponse } from "../types";

const draftProfile: CandidateProfileResponse = {
  level: "sde2",
  fullName: "Asha Rao",
  email: "asha@example.com",
  phone: null,
  location: null,
  headline: null,
  targetRole: null,
  targetJdId: null,
  education: [],
  experience: [],
  projects: [],
  skills: ["Go"],
  achievements: [],
  detectedLinks: { github: null, leetcode: null, linkedin: null },
  resumeFilename: "asha.pdf",
  resumeParsedAt: null,
  onboardingComplete: false,
};

const m = vi.hoisted(() => ({
  existing: { data: null as CandidateProfileResponse | null, isLoading: false },
  mutateAsync: vi.fn(),
  mutate: vi.fn(),
  replace: vi.fn(),
  search: "",
  parsed: null as CandidateProfileResponse | null,
  gridProps: [] as Record<string, unknown>[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: m.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(m.search),
}));
vi.mock("../hooks", () => ({
  useCandidateProfile: () => m.existing,
  useSaveCandidateProfile: () => ({ mutateAsync: m.mutateAsync, mutate: m.mutate, isPending: false }),
}));
vi.mock("@/features/profile", () => ({ useProfile: () => ({ data: { sources: [] } }) }));
vi.mock("@/app/(app)/connections/_components/ConnectionsGrid", () => ({
  ConnectionsGrid: (props: Record<string, unknown>) => {
    m.gridProps.push(props);
    return <p>Sources list</p>;
  },
}));
vi.mock("./ResumeUpload", () => ({
  ResumeUpload: ({ onParsed }: { onParsed: (d: CandidateProfileResponse) => void }) => (
    <button type="button" onClick={() => onParsed(m.parsed ?? draftProfile)}>
      Fake parse
    </button>
  ),
}));
import { OnboardingWizard } from "./OnboardingWizard";

function renderWizard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OnboardingWizard />
    </QueryClientProvider>,
  );
}

const continueButton = () => screen.getByRole("button", { name: /^continue/i });

describe("OnboardingWizard", () => {
  it("requires a current engineering level before leaving Profile", async () => {
    const user = userEvent.setup();
    m.existing = { data: { ...draftProfile, level: null }, isLoading: false };
    renderWizard();
    await user.click(continueButton());
    expect(screen.getByText("Choose your engineering level")).toBeInTheDocument();
    expect(m.mutateAsync).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox", { name: "Engineering level" }));
    expect(screen.getAllByRole("option")).toHaveLength(9);
    await user.click(screen.getByRole("option", { name: "Distinguished" }));
    await user.click(continueButton());
    await waitFor(() => expect(m.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ level: "distinguished", complete: false })));
  });

  it("redirects completion to Profile when the saved draft level is unknown", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("iq-onboarding-step", "2");
    m.existing = { data: { ...draftProfile, level: null, legacyLevel: "Career switcher" }, isLoading: false };
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Check your profile" })).toBeInTheDocument();
    expect(m.mutate).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    m.existing = { data: null, isLoading: false };
    m.mutateAsync.mockResolvedValue(draftProfile);
    m.search = "";
    m.parsed = null;
    m.gridProps = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("saves a draft as soon as the resume is parsed, and shows what was found", async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Fake parse" }));

    await waitFor(() => expect(m.mutateAsync).toHaveBeenCalledTimes(1));
    expect(m.mutateAsync.mock.calls[0][0]).toMatchObject({ fullName: "Asha Rao", complete: false, level: null });
    expect(screen.getAllByText("FOUND").length).toBeGreaterThan(0);
    expect(continueButton()).toHaveTextContent("Continue");
  });

  it("saves the profile before leaving it, remembers the step, and hides the resume row on Sources", async () => {
    const user = userEvent.setup();
    m.existing = { data: draftProfile, isLoading: false };
    renderWizard();

    // A saved draft resumes on Profile.
    expect(screen.getByRole("heading", { name: "Check your profile" })).toBeInTheDocument();
    await user.click(continueButton());

    await waitFor(() => expect(screen.getByRole("heading", { name: "Connect your work" })).toBeInTheDocument());
    expect(m.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ complete: false, email: "asha@example.com" }));
    expect(sessionStorage.getItem("iq-onboarding-step")).toBe("2");
    expect(m.gridProps.at(-1)).toMatchObject({ exclude: ["RESUME"] });
  });

  it("comes back to Sources after the GitHub round trip and shows a failed connect", () => {
    sessionStorage.setItem("iq-onboarding-step", "2");
    m.existing = { data: draftProfile, isLoading: false };
    m.search = "error=github_oauth_failed";
    renderWizard();

    expect(screen.getByRole("heading", { name: "Connect your work" })).toBeInTheDocument();
    expect(m.gridProps.at(-1)).toMatchObject({ errorSource: "GITHUB" });
  });

  it("passes the current résumé LinkedIn URL to Sources even when saving the draft fails", async () => {
    const user = userEvent.setup();
    const linkedin = "https://www.linkedin.com/in/resume-owner/";
    sessionStorage.setItem("iq-onboarding-step", "0");
    m.existing = { data: draftProfile, isLoading: false };
    m.parsed = { ...draftProfile, detectedLinks: { ...draftProfile.detectedLinks, linkedin } };
    m.mutateAsync.mockRejectedValue(new Error("Draft unavailable"));
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Fake parse" }));
    await user.click(continueButton());
    await user.click(continueButton());
    await screen.findByRole("heading", { name: "Connect your work" });
    expect(m.gridProps.at(-1)).toMatchObject({ resumeLinkedInUrl: linkedin });
    expect(m.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ detectedLinks: expect.objectContaining({ linkedin }) }));
  });

  it("finishing on Sources completes the profile and lands on the dashboard", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("iq-onboarding-step", "2");
    m.existing = { data: draftProfile, isLoading: false };
    m.mutate.mockImplementation((_req, opts: { onSuccess: () => void }) => opts.onSuccess());
    renderWizard();

    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(m.mutate).toHaveBeenCalled());
    expect(m.mutate.mock.calls[0][0]).toMatchObject({ complete: true, level: "sde2" });
    expect(m.replace).toHaveBeenCalledWith("/dashboard");
    expect(sessionStorage.getItem("iq-onboarding-step")).toBeNull();
  });
});
