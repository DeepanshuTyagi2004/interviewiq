import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("@/features/report", async () => {
  const actual = await vi.importActual<typeof import("@/features/report")>("@/features/report/presentation");
  return { ...actual, useCreateDispute: () => ({ mutate: mutateMock, isPending: false }) };
});
vi.mock("@excalidraw/excalidraw", () => ({ Excalidraw: () => <div data-testid="excalidraw" /> }));
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

import { ApiFetchError } from "@/lib/api-client/errors";
import * as jump from "./jumpToTurn";
import { QuestionCard } from "./QuestionCard";
import { TranscriptSection } from "./TranscriptSection";
import { ConductSection } from "./ConductSection";
import { DisputeDialog, DisputeControl } from "./DisputeDialog";
import { BoardAnswer } from "./BoardAnswer";

const question = {
  id: "q1",
  part: "dsa",
  kind: "dsa",
  title: "Course schedule",
  asked: "Can you finish all courses?",
  answerQuotes: [{ turnId: 12, text: "I would use a topological sort" }],
  verdict: "mostly" as const,
  score: 7.5,
  strongAnswer: "Detect a cycle with Kahn's algorithm.",
  gap: "Did not mention the empty prerequisites case.",
  topics: [{ subject: "DSA", topic: "Graphs" }],
  resumeConsistency: "consistent" as const,
  code: {
    language: "python",
    text: "def f(): pass",
    logicWorks: "partly" as const,
    syntaxSlips: ["missing colon"],
    trace: [
      { example: "n=2", predicted: "true", expected: "true", matches: true },
      { example: "n=3", predicted: "true", expected: "false", matches: false },
    ],
  },
};
const report = { status: "ready", disputes: [], transcript: [], questions: [question] } as never;

describe("report sections", () => {
  beforeEach(() => mutateMock.mockReset());

  it("question card shows the quote, a strong answer and a ✗ trace row", () => {
    render(<QuestionCard report={report} question={question} index={0} sessionId="s1" />);
    expect(screen.getByText("I would use a topological sort")).toBeInTheDocument();
    expect(screen.getByText(/A strong answer:/)).toBeInTheDocument();
    expect(screen.getByText("Resume: consistent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Your code/ }));
    expect(screen.getByLabelText("Does not match")).toHaveTextContent("✗");
    expect(screen.getByLabelText("Matches")).toHaveTextContent("✓");
    expect(screen.getByText("missing colon")).toBeInTheDocument();
  });

  it("jumps to the turn from a quote", () => {
    const spy = vi.spyOn(jump, "jumpToTurn").mockImplementation(() => {});
    render(<QuestionCard report={report} question={question} index={0} sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Jump to moment 12" }));
    expect(spy).toHaveBeenCalledWith(12);
  });

  it("transcript renders #turn-12 with a Hint marker and filters by marker", () => {
    const r = {
      transcript: [
        { turnId: 11, speaker: "candidate", text: "Let me think", at: "2026-10-18T10:00:00Z", cutOff: true, markers: [] },
        { turnId: 12, speaker: "interviewer", text: "Consider a queue", at: "2026-10-18T10:01:05Z", cutOff: false, markers: [{ kind: "hint", note: "direction" }] },
      ],
    } as never;
    const { container } = render(<TranscriptSection report={r} />);
    const turn = container.querySelector("#turn-12") as HTMLElement;
    expect(turn).toBeTruthy();
    expect(within(turn).getByText("Hint")).toBeInTheDocument();
    expect(screen.getByText("cut off")).toBeInTheDocument();
    expect(within(turn).getByText("01:05")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hint" }));
    expect(container.querySelector("#turn-11")).toBeNull();
    expect(container.querySelector("#turn-12")).toBeTruthy();
  });

  it("dispute dialog blocks a 501-char reason and submits a valid one", () => {
    render(<DisputeDialog sessionId="s1" targetType="question" targetId="q1" targetLabel="Course schedule" open onOpenChange={() => {}} />);
    const box = screen.getByLabelText("Your reason");
    fireEvent.change(box, { target: { value: "x".repeat(501) } });
    expect(screen.getByRole("button", { name: "Send for re-check" })).toBeDisabled();
    expect(screen.getByText("501/500")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "I did cover it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for re-check" }));
    expect(mutateMock).toHaveBeenCalledWith({ target: { type: "question", id: "q1" }, reason: "I did cover it" }, expect.any(Object));
  });

  it("maps an API error to a plain sentence", () => {
    mutateMock.mockImplementation((...a: unknown[]) => { (a[1] as { onError?: (e: unknown) => void } | undefined)?.onError?.(new ApiFetchError(409, "dispute_window_closed", "x")); });
    render(<DisputeDialog sessionId="s1" targetType="area" targetId="code" targetLabel="Code" open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("Your reason"), { target: { value: "why" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for re-check" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The 14-day window for questioning this report has closed.");
  });

  it("hides the button when disputed and shows the result; hides at 3 disputes", () => {
    const upheld = { disputes: [{ target: { type: "question", id: "q1" }, decision: "upheld", explanation: "Grade stands." }] } as never;
    const { rerender } = render(<DisputeControl report={upheld} sessionId="s1" targetType="question" targetId="q1" targetLabel="Q" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("score unchanged. Grade stands.");
    const three = { disputes: [1, 2, 3].map((n) => ({ target: { type: "question", id: `x${n}` } })) } as never;
    rerender(<DisputeControl report={three} sessionId="s1" targetType="question" targetId="q1" targetLabel="Q" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a running re-check from the server flag and hides every button while it runs (I4)", () => {
    const pending = { disputes: [], recheckPending: true, recheckTarget: { type: "question", id: "q1" } } as never;
    const { rerender } = render(<DisputeControl report={pending} sessionId="s1" targetType="question" targetId="q1" targetLabel="Q" />);
    expect(screen.getByRole("status")).toHaveTextContent("Re-checking…");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<DisputeControl report={pending} sessionId="s1" targetType="area" targetId="approach" targetLabel="A" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // the re-check landed: the decision shows inline
    const done = { disputes: [{ target: { type: "question", id: "q1" }, decision: "revised", oldScore: 6, newScore: 7.5, explanation: "Missed it." }], recheckPending: false, recheckTarget: null } as never;
    rerender(<DisputeControl report={done} sessionId="s1" targetType="question" targetId="q1" targetLabel="Q" />);
    expect(screen.getByRole("status")).toHaveTextContent("Re-checked: score revised. 6.0 → 7.5. Missed it.");
  });

  it("a decision-less dispute entry is not a running re-check (I4)", async () => {
    const { isRecheckPending } = await vi.importActual<typeof import("@/features/report/hooks")>("@/features/report/hooks");
    const stale = { disputes: [{ target: { type: "question", id: "q9" } }], recheckPending: false, recheckTarget: null } as never;
    expect(isRecheckPending(stale)).toBe(false);
    expect(isRecheckPending({ recheckPending: true } as never)).toBe(true);
    render(<DisputeControl report={stale} sessionId="s1" targetType="question" targetId="q1" targetLabel="Q" />);
    expect(screen.getByRole("button", { name: /Question this score/ })).toBeInTheDocument();
  });

  it("conduct empty state", () => {
    render(<ConductSection report={{ conduct: [], integrity: [], transcript: [] } as never} />);
    expect(screen.getByText("Nothing to report")).toBeInTheDocument();
  });

  it("board answer falls back to the text summary without a scene", () => {
    render(<BoardAnswer board={{ summary: "Client, API, DB", notes: ["No cache"], scene: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /Your diagram/ }));
    expect(screen.getByText("Client, API, DB")).toBeInTheDocument();
    expect(screen.getByText("No cache")).toBeInTheDocument();
    expect(screen.queryByTestId("board-viewer")).toBeNull();
  });
});
