import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InterviewSession } from "@/features/interview";
import { UpNextCard } from "./UpNextCard";

// The viewer may book and join in these tests.
vi.mock("@/lib/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ canInterview: true, interviewBlocked: false }) }));

function session(partial: Partial<InterviewSession>): InterviewSession {
  return {
    id: "a",
    candidateId: "c",
    jobDescriptionId: "j",
    company: "meesho",
    companyName: "Meesho",
    role: "SDE",
    level: "sde1",
    specialization: "backend",
    roundType: "dsa",
    scheduledAt: "2026-10-04T10:00:00",
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
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...partial,
  };
}

const NOW = new Date(2026, 9, 2, 9, 0);

describe("UpNextCard", () => {
  it("is an empty state with a Schedule a round action when nothing is booked", () => {
    const { container } = render(<UpNextCard session={undefined} now={NOW} />);
    const card = screen.getByRole("region", { name: "Up next" });
    expect(within(card).getByText("No round booked yet")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Schedule a round" })).toHaveAttribute("href", "/interviews");
    expect(container.querySelector("dl")).toBeNull();
  });

  it("shows a booked round: chips, title, slot, length, track and the briefing action", () => {
    render(<UpNextCard session={session({})} now={NOW} />);
    expect(screen.getByText("in 2 days")).toBeInTheDocument();
    expect(screen.getByText("DSA")).toBeInTheDocument();
    expect(screen.getByText("Booked")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meesho · SDE I mock process" })).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(screen.getByText("backend")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open briefing" })).toHaveAttribute("href", "/interviews/a");
    expect(screen.queryByRole("link", { name: /enter room/i })).toBeNull();
  });

  it("drops the track without a specialization and names the interviewer from the briefing", () => {
    render(
      <UpNextCard
        now={NOW}
        session={session({
          specialization: "",
          briefing: { interviewerName: "Priya", interviewerStyle: "calm", format: "45-minute coding interview", durationMins: 45 },
        })}
      />,
    );
    expect(screen.queryByText("backend")).toBeNull();
    expect(screen.getByText("Priya")).toBeInTheDocument();
  });

  it("offers Reschedule only for a round that belongs to a track", () => {
    const { unmount } = render(<UpNextCard session={session({})} now={NOW} />);
    expect(screen.queryByRole("link", { name: "Reschedule" })).toBeNull();
    unmount();
    render(<UpNextCard session={session({ loopId: "L1" })} now={NOW} />);
    expect(screen.getByRole("link", { name: "Reschedule" })).toHaveAttribute("href", "/loops/L1");
  });

  it("shows a ready round with the Enter room action next to the briefing", () => {
    render(<UpNextCard session={session({ status: "PREP_READY" })} now={NOW} />);
    expect(screen.getByText("Ready to join")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /enter room/i })).toHaveAttribute("href", "/interviews/a/live");
    expect(screen.getByRole("link", { name: "Open briefing" })).toBeInTheDocument();
  });

  it("labels preparing, live and failed rounds", () => {
    const { unmount: u1 } = render(<UpNextCard session={session({ status: "PREP_QUEUED" })} now={NOW} />);
    expect(screen.getByText("Preparing")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /enter room/i })).toBeNull();
    u1();
    const { unmount: u2 } = render(<UpNextCard session={session({ status: "LIVE_IN_PROGRESS" })} now={NOW} />);
    expect(screen.getByText("Live now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /enter room/i })).toBeInTheDocument();
    u2();
    render(<UpNextCard session={session({ status: "PREP_FAILED" })} now={NOW} />);
    expect(screen.getByText("Prep failed")).toBeInTheDocument();
  });
});
