import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InterviewSession } from "@/features/interview";

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}));

vi.mock("@/features/interview", () => ({
  useSession: useSessionMock,
}));

import { ReportPlaceholder } from "./ReportPlaceholder";

describe("ReportPlaceholder", () => {
  const mockSession: InterviewSession = {
    id: "session-1",
    candidateId: "candidate-1",
    jobDescriptionId: "jd-1",
    company: "google",
    companyName: "Razorpay",
    role: "Software Engineer",
    level: "sde1",
    specialization: "Backend",
    roundType: "dsa",
    scheduledAt: "2024-07-05T10:00:00Z",
    timezone: "Asia/Kolkata",
    status: "PREP_READY",
    prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
    briefing: null,
    liveAvailable: true,
    roundMinutes: 45,
    endReason: null,
    createdAt: "2024-07-05T09:00:00Z",
    updatedAt: "2024-07-05T09:30:00Z",
  };

  it("renders the company name when available", () => {
    useSessionMock.mockReturnValue({
      data: mockSession,
      isLoading: false,
      error: null,
    });

    render(<ReportPlaceholder sessionId="session-1" />);

    expect(screen.getByText(/razorpay/i)).toBeInTheDocument();
  });

  it("renders the company slug when companyName is not available", () => {
    const sessionWithoutName = { ...mockSession, companyName: null };
    useSessionMock.mockReturnValue({
      data: sessionWithoutName,
      isLoading: false,
      error: null,
    });

    render(<ReportPlaceholder sessionId="session-2" />);

    expect(screen.getByText(/google/i)).toBeInTheDocument();
  });

  it("renders the round type", () => {
    useSessionMock.mockReturnValue({
      data: mockSession,
      isLoading: false,
      error: null,
    });

    render(<ReportPlaceholder sessionId="session-1" />);

    expect(screen.getByText(/dsa/i)).toBeInTheDocument();
  });

  // Copy changed deliberately: the old "being prepared" promise implied a report was on its way,
  // but no scoring/report backend exists yet — the page now says so and shows an empty score.
  it("renders the honest no-score placeholder instead of a score", () => {
    useSessionMock.mockReturnValue({
      data: mockSession,
      isLoading: false,
      error: null,
    });

    render(<ReportPlaceholder sessionId="session-1" />);

    expect(screen.getByText(/scoring isn't live yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no score yet/i)).toBeInTheDocument();
  });

  it("renders loading skeleton when loading", () => {
    useSessionMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<ReportPlaceholder sessionId="session-1" />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders error message when data fetch fails", () => {
    useSessionMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed to load session"),
    });

    render(<ReportPlaceholder sessionId="session-1" />);

    expect(screen.getByText(/failed to load your interview session/i)).toBeInTheDocument();
  });
});
