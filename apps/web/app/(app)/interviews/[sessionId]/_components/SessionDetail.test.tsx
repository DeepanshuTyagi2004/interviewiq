import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { InterviewSession, SessionStatus } from "@/features/interview";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/features/interview", () => ({
  useSession: useSessionMock,
  useRetryPrep: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SessionDetail } from "./SessionDetail";

// The viewer may book and join in these tests.
vi.mock("@/lib/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ canInterview: true, interviewBlocked: false }) }));

const base: InterviewSession = {
  id: "s1",
  candidateId: "c1",
  jobDescriptionId: "jd-1",
  company: "meesho",
  companyName: "Meesho",
  role: "Software Engineer",
  level: "sde1",
  specialization: "Backend",
  roundType: "dsa",
  scheduledAt: "2026-10-05T10:00:00Z",
  timezone: "Asia/Kolkata",
  status: "SCHEDULED",
  prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
  briefing: null,
  liveAvailable: true,
  roundMinutes: 45,
  passMark: null,
  score: null,
  outcome: null,
  verdict: null,
  retakeAfter: null,
  evaluationStatus: null,
  endReason: null,
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-01T09:00:00Z",
};

function renderAt(status: SessionStatus) {
  useSessionMock.mockReturnValue({ data: { ...base, status }, isLoading: false, isError: false });
  render(<SessionDetail sessionId="s1" />);
  return screen.getByRole("region", { name: "Progress" });
}

describe("SessionDetail progress timeline", () => {
  it("lists the four steps on a rail between them, with their text and state for screen readers", () => {
    const progress = renderAt("PREP_QUEUED");
    const steps = within(progress).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(progress.querySelectorAll("[data-rail]")).toHaveLength(3);
    expect(within(steps[1]).getByText("Interviewer prepared")).toBeInTheDocument();
    expect(within(steps[1]).getByText("Preparing now")).toBeInTheDocument();
    expect(within(steps[1]).getByText("Now")).toHaveClass("sr-only");
    expect(within(steps[0]).getByText("Done")).toHaveClass("sr-only");
  });

  it.each([
    ["PREP_QUEUED", 1],
    ["LIVE_IN_PROGRESS", 1],
    ["PREP_READY", 0],
    ["COMPLETED", 0],
    ["SCHEDULED", 0],
    ["PREP_FAILED", 0],
  ] as const)("%s: %i pulsing step dot(s), only for a step that's really running", (status, pulsing) => {
    const progress = renderAt(status);
    expect(progress.querySelectorAll("[data-motion]")).toHaveLength(pulsing);
  });
});

function renderSession(overrides: Partial<InterviewSession>) {
  useSessionMock.mockReturnValue({ data: { ...base, ...overrides }, isLoading: false, isError: false });
  return render(<SessionDetail sessionId="s1" />);
}

describe("SessionDetail blueprint prep", () => {
  it("while preparing: shows friendly live steps, never topics or problems", () => {
    renderSession({
      status: "PREP_QUEUED",
      prep: {
        step: "selection", refreshing: false, preparedAt: null, errorCode: null,
        steps: [{ id: "context", state: "done", elapsedMs: 1200 }, { id: "selection", state: "active", elapsedMs: null }],
      },
    });
    const panel = screen.getByRole("region", { name: "Preparing your interviewer" });
    const rows = within(panel).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Reading the job description")]));
    expect(within(rows[0]!).getByText("Done")).toHaveClass("sr-only");
    expect(within(rows[1]!).getByText("Choosing your questions")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("In progress")).toHaveClass("sr-only");
    expect(within(rows[6]!).getByText("Final checks")).toBeInTheDocument();
  });

  it("when ready: shows the briefing (interviewer, format, duration) and a disabled join until live opens", () => {
    renderSession({
      status: "PREP_READY",
      liveAvailable: false,
      prep: { step: null, steps: [], refreshing: false, preparedAt: "2026-10-01T09:00:00Z", errorCode: null },
      briefing: { interviewerName: "Asha Rao", interviewerStyle: "Senior engineer · calm", format: "45-minute coding interview with a shared editor", durationMins: 45 },
    });
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("45-minute coding interview with a shared editor")).toBeInTheDocument();
    expect(screen.getByText("45 minutes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enter interview room/ })).toBeDisabled();
    expect(screen.getByText(/Live sessions open soon/)).toBeInTheDocument();
  });

  it("shows the drawn round length in the details as soon as it is booked, before the briefing exists", () => {
    renderSession({ status: "PREP_QUEUED", roundMinutes: 35, briefing: null });
    expect(screen.getByText("Length")).toBeInTheDocument();
    expect(screen.getByText("35 min")).toBeInTheDocument();
    expect(screen.queryByText("30-45 min")).toBeNull();
  });

  it("shows the booked session's own drawn length, not a fixed 45", () => {
    renderSession({
      status: "PREP_READY",
      roundMinutes: 30,
      prep: { step: null, steps: [], refreshing: false, preparedAt: "2026-10-01T09:00:00Z", errorCode: null },
      briefing: { interviewerName: "Asha Rao", interviewerStyle: "calm", format: "coding interview with a shared editor", durationMins: 30 },
    });
    expect(screen.getByText("30 minutes")).toBeInTheDocument();
    expect(screen.queryByText("45 minutes")).toBeNull();
  });

  it("shows the pass mark in the briefing, and hides it when the session has none", () => {
    const base = {
      status: "PREP_READY" as const,
      prep: { step: null, steps: [], refreshing: false, preparedAt: "2026-10-01T09:00:00Z", errorCode: null },
      briefing: { interviewerName: "Asha Rao", interviewerStyle: "calm", format: "coding", durationMins: 45 },
    };
    const { unmount } = renderSession({ ...base, passMark: 7 });
    expect(screen.getByText("Pass mark 7.0 / 10")).toBeInTheDocument();
    unmount();
    renderSession({ ...base, passMark: null });
    expect(screen.queryByText(/Pass mark/)).toBeNull();
  });

  it("while refreshing: keeps the briefing with an updating note", () => {
    renderSession({
      status: "PREP_READY",
      prep: { step: "playbooks", steps: [], refreshing: true, preparedAt: "2026-10-01T09:00:00Z", errorCode: null },
      briefing: { interviewerName: "Asha Rao", interviewerStyle: "calm", format: "45-minute coding interview with a shared editor", durationMins: 45 },
    });
    expect(screen.getByText("Updating for your latest profile…")).toBeInTheDocument();
  });

  it("when failed: plain words, a retry and the code in details", () => {
    renderSession({ status: "PREP_FAILED", prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: "not_enough_problems" } });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't prepare this interview.");
    expect(screen.getAllByRole("button", { name: /Retry prep/ }).length).toBeGreaterThan(0);
    expect(screen.getByText("not_enough_problems")).toBeInTheDocument();
  });
});
