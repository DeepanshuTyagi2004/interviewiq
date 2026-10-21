import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { useReportMock, useSessionMock } = vi.hoisted(() => ({ useReportMock: vi.fn(), useSessionMock: vi.fn() }));

vi.mock("@/features/interview", () => ({ useSession: useSessionMock }));
vi.mock("@/features/report", async () => {
  const actual = await vi.importActual<typeof import("@/features/report")>("@/features/report/presentation");
  return { ...actual, useReport: useReportMock };
});

import * as jump from "./jumpToTurn";
import { ReportView } from "./ReportView";

// The viewer may book and join in these tests.
vi.mock("@/lib/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ canInterview: true, interviewBlocked: false }) }));

const session = { id: "s1", loopId: "loop-1", jobDescriptionId: "jd-1", roundType: "dsa", company: "meesho", companyName: "Meesho" };

const ready = {
  status: "ready",
  meta: { company: "meesho", level: "sde1", round: "Round 2 - DSA" },
  outcome: "below_pass",
  score: 6.8,
  passMark: 7.0,
  verdict: "lean_no_hire",
  cap: "Core problem was not solved",
  retakeAfter: "2999-10-25T00:00:00Z",
  practicalScore: 7.1,
  theoryScore: 6.2,
  summary: "A decent attempt.",
  strengths: ["Clear communication"],
  areas: [
    { key: "approach", label: "Approach & optimisation", weight: 25, score: 7, reason: "Good approach.", evidence: ["turn:12", "code"], previousScore: 5.5 },
    { key: "code", label: "Code correctness", weight: 25, score: 6, reason: "Mostly right.", evidence: [] },
  ],
  adjustments: [
    { kind: "hint", label: "Hint: gave direction", delta: -0.25, turnId: 4, at: "2026-10-18T10:12:41Z", note: "" },
    { kind: "bug", label: "Found and fixed own bug", delta: 0.1, turnId: 9, at: "2026-10-18T10:21:30Z", note: "" },
  ],
  transcript: [{ turnId: 1, speaker: "interviewer", text: "Hi", at: "2026-10-18T10:00:00Z", cutOff: false, markers: [] }],
  questions: [],
  focus: [],
};

describe("ReportView", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({ data: session });
  });

  it("shows the four steps while evaluating", () => {
    useReportMock.mockReturnValue({ data: { status: "evaluating" }, isLoading: false, error: null });
    render(<ReportView sessionId="s1" />);
    for (const step of ["Reading your answers", "Grading", "Checking with a second grader", "Writing your report"]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("shows the reason and Retake now when unscorable", () => {
    useReportMock.mockReturnValue({
      data: { status: "ready", outcome: "unscorable", unscorableReason: "The round ended because of a technical problem." },
      isLoading: false,
      error: null,
    });
    render(<ReportView sessionId="s1" />);
    expect(screen.getByText("The round ended because of a technical problem.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retake now" })).toBeInTheDocument();
  });

  it("says the report is taking longer and offers a free retake when grading failed", () => {
    useReportMock.mockReturnValue({ data: { status: "failed" }, isLoading: false, error: null });
    render(<ReportView sessionId="s1" />);
    expect(screen.getByText("Your report is taking longer than usual")).toBeInTheDocument();
    expect(screen.getByText(/it will appear here automatically/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't grade/)).toBeNull();
    expect(screen.getByRole("link", { name: "Retake now" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "All interviews" }).length).toBeGreaterThan(0);
  });

  it("explains a legacy round", () => {
    useReportMock.mockReturnValue({ data: { status: "legacy" }, isLoading: false, error: null });
    render(<ReportView sessionId="s1" />);
    expect(screen.getByText(/taken before scoring was introduced/)).toBeInTheDocument();
  });

  it("renders the ready report with cap and adjustments", () => {
    useReportMock.mockReturnValue({ data: ready, isLoading: false, error: null });
    render(<ReportView sessionId="s1" />);
    expect(screen.getByText("6.8")).toBeInTheDocument();
    expect(screen.getByText("Pass mark 7.0")).toBeInTheDocument();
    expect(screen.getByText("Below pass mark")).toBeInTheDocument();
    expect(screen.getByText("Lean No Hire")).toBeInTheDocument();
    expect(screen.getByText("Core problem was not solved")).toBeInTheDocument();
    expect(screen.getByText("−0.25")).toBeInTheDocument();
    expect(screen.getByText("+0.1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retake from/ })).toBeDisabled();
    expect(screen.getByText("12:41")).toBeInTheDocument();
    expect(screen.getByText("21:30")).toBeInTheDocument();
    expect(screen.queryByText(/^Base /)).toBeNull();
  });

  it("reproduces the score: Base · Bonuses (capped) · Penalties · Cap · Score (I5)", () => {
    const report = {
      ...ready, score: 7.1, cap: null, baseScore: 6.9, bonusTotal: 0.5, penaltyTotal: -0.35,
      adjustments: [
        { kind: "beyond_level", label: "Better solution", delta: 0.2, turnId: null, at: null, note: "" },
        { kind: "bonus_solved", label: "Bonus", delta: 0.3, turnId: null, at: null, note: "" },
        { kind: "end_questions", label: "Questions", delta: 0.2, turnId: null, at: null, note: "" },
        { kind: "hint", label: "Hint: gave direction", delta: -0.25, turnId: null, at: null, note: "Pair Sum" },
        { kind: "hint", label: "Hint: small nudge", delta: -0.1, turnId: null, at: null, note: "Pair Sum" },
      ],
    };
    useReportMock.mockReturnValue({ data: report, isLoading: false, error: null });
    render(<ReportView sessionId="s1" />);
    expect(screen.getByText("Base 6.9 · Bonuses +0.5 (capped at +0.5) · Penalties −0.35 · Cap — · Score 7.1")).toBeInTheDocument();
  });

  it("labels the level and round type in the header, never the raw values (M5)", () => {
    useReportMock.mockReturnValue({ data: { ...ready, meta: { company: "meesho", level: "fresher", round: "dsa" } }, isLoading: false, error: null });
    render(<ReportView sessionId="s1" />);
    const eyebrow = screen.getByText(/^Debrief · /);
    expect(eyebrow.textContent).toContain("Fresher");
    expect(eyebrow.textContent).not.toContain("FRESHER");
    expect(eyebrow.textContent).not.toMatch(/· dsa$/);
  });

  it("evidence links jump to the turn", () => {
    const spy = vi.spyOn(jump, "jumpToTurn").mockImplementation(() => {});
    useReportMock.mockReturnValue({ data: ready, isLoading: false, error: null });
    render(<ReportView sessionId="s1" />);
    fireEvent.click(screen.getAllByRole("button", { name: /why/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Moment/ }));
    expect(spy).toHaveBeenCalledWith(12);
    expect(screen.getByText("Your code")).toBeInTheDocument();
  });

  it("links to the next round when passed", () => {
    useReportMock.mockReturnValue({
      data: { ...ready, outcome: "passed", cap: null, nextRound: { nodeId: "n3", name: "System design" } },
      isLoading: false,
      error: null,
    });
    render(<ReportView sessionId="s1" />);
    expect(screen.getByRole("link", { name: "Book round 3" })).toHaveAttribute("href", "/loops/loop-1");
  });
});
