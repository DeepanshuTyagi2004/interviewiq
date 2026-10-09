import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InterviewSession } from "@/features/interview";

// Mock useMySessions so we can control what sessions are returned
const mockMySessions = vi.fn();

vi.mock("@/features/interview", () => ({
  useMySessions: () => mockMySessions(),
  useRetryPrep: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SessionsList } from "./SessionsList";

describe("SessionsList", () => {
  const baseSession: InterviewSession = {
    id: "session-1",
    candidateId: "candidate-1",
    jobDescriptionId: "jd-1",
    company: "google",
    companyName: "Google",
    role: "Software Engineer",
    level: "sde2",
    specialization: "Backend",
    roundType: "dsa",
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    timezone: "UTC",
    status: "SCHEDULED",
    prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
    briefing: null,
    liveAvailable: true,
    endReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("renders a Join link when session status is PREP_READY", () => {
    const prepReadySession: InterviewSession = {
      ...baseSession,
      id: "session-prep-ready",
      status: "PREP_READY",
      prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
      briefing: null,
      liveAvailable: true,
    };

    mockMySessions.mockReturnValue({
      data: { sessions: [prepReadySession] },
      isLoading: false,
      isError: false,
    });

    render(<SessionsList />);

    const joinLink = screen.getByRole("link", { name: /join/i });
    expect(joinLink).toBeInTheDocument();
    expect(joinLink).toHaveAttribute("href", "/interviews/session-prep-ready/live");
  });

  it("does not render a Join button when session status is SCHEDULED", () => {
    mockMySessions.mockReturnValue({
      data: { sessions: [baseSession] },
      isLoading: false,
      isError: false,
    });

    render(<SessionsList />);

    const joinLink = screen.queryByRole("link", { name: /join/i });
    expect(joinLink).not.toBeInTheDocument();
  });

  it("does not render a Join button when session status is PREP_QUEUED", () => {
    const queuedSession: InterviewSession = {
      ...baseSession,
      status: "PREP_QUEUED",
      prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
      briefing: null,
      liveAvailable: true,
    };

    mockMySessions.mockReturnValue({
      data: { sessions: [queuedSession] },
      isLoading: false,
      isError: false,
    });

    render(<SessionsList />);

    const joinLink = screen.queryByRole("link", { name: /join/i });
    expect(joinLink).not.toBeInTheDocument();
  });

  it("renders a Retry button when session status is PREP_FAILED", () => {
    const failedSession: InterviewSession = {
      ...baseSession,
      status: "PREP_FAILED",
      prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
      briefing: null,
      liveAvailable: true,
    };

    mockMySessions.mockReturnValue({
      data: { sessions: [failedSession] },
      isLoading: false,
      isError: false,
    });

    render(<SessionsList />);

    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
  });

  it("shows each group's count padded for the eye and in words for screen readers", () => {
    mockMySessions.mockReturnValue({
      data: { sessions: [baseSession] },
      isLoading: false,
      isError: false,
    });

    render(<SessionsList />);

    // Upcoming has one session, Past none.
    expect(screen.getByText("01")).toHaveAttribute("aria-hidden");
    expect(screen.getByText("1 session")).toHaveClass("sr-only");
    expect(screen.getByText("00")).toHaveAttribute("aria-hidden");
    expect(screen.getByText("0 sessions")).toHaveClass("sr-only");
  });
});
