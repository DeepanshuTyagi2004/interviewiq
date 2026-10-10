import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveSessionProvider, useLiveSession } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { stampAgent } from "@/features/interview-live/protocol/messages";
import { LiveView } from "./LiveView";


vi.mock("@/features/interview-live/work/CodeEditor", () => ({ CodeEditor: () => <div data-testid="code-editor" /> }));
vi.mock("@/features/interview-live/work/DiagramBoard", () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }));

type Live = ReturnType<typeof useLiveSession>;

async function mount() {
  const liveRef: { current: Live | null } = { current: null };
  function Probe() {
    liveRef.current = useLiveSession();
    return null;
  }
  const session = new MockLiveSession();
  await session.connect("s1");
  (document as unknown as { fullscreenElement: Element | null }).fullscreenElement = document.documentElement;
  render(
    <LiveSessionProvider sessionId="s1" session={session}>
      <Probe />
      <LiveView sessionId="s1" meta={{ company: "Salescode", level: "SDE I", round: "DSA", interviewer: "Asha" }} />
    </LiveSessionProvider>,
  );
  act(() => {
    liveRef.current!.send({ type: "START_CHECKS" });
    liveRef.current!.send({ type: "CHECKS_PASSED" });
    liveRef.current!.send({ type: "CONNECTED" });
  });
  return { session, liveRef };
}

/** What the interviewer sends to change the room: the layout and whether it is slow. */
async function roomState(session: MockLiveSession, layout: "talk" | "work", slow = false) {
  await act(async () => {
    session.emitMessage(stampAgent({ type: "room.state", layout, slow }));
  });
}

describe("LiveView", () => {
  it("lays out the transcript, the problem panel, the work area, the tools and the bottom bar", async () => {
    const { session } = await mount();
    await roomState(session, "work"); // the work side is only on screen while the interviewer has the room in `work`
    expect(screen.getByRole("log", { name: "Conversation transcript" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Problem" })).toBeInTheDocument();
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mute microphone/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End interview" })).toBeInTheDocument();
    expect(screen.getByText("Asha")).toBeInTheDocument();
  });

  it("reports to the interviewer when the pointer leaves the workspace", async () => {
    const { session } = await mount();
    await roomState(session, "work");
    fireEvent.mouseLeave(screen.getByRole("region", { name: "Workspace" }));
    await waitFor(() => expect(session.sentOf("activity.batch")[0]?.events).toEqual([expect.objectContaining({ k: "ptr", s: "out" })]), { timeout: 2000 });
  });

  it("shows a problem the interviewer puts on screen", async () => {
    const { session } = await mount();
    await roomState(session, "work");
    await act(async () => {
      session.emitMessage(stampAgent({ type: "panel.show_problem", item_id: "slot-1", label: "Problem 1", kind: "problem", statement: "Count the islands in the grid.", examples: [] }));
    });
    expect(screen.getByRole("tab", { name: "Problem 1" })).toBeInTheDocument();
    expect(screen.getByText("Count the islands in the grid.")).toBeInTheDocument();
  });

  it("End asks to confirm, then asks the interviewer to close the round", async () => {
    const { session, liveRef } = await mount();
    await userEvent.click(screen.getByRole("button", { name: "End interview" }));
    await userEvent.click(screen.getAllByRole("button", { name: "End interview" }).at(-1)!);
    expect(session.sentOf("session.end_request")).toHaveLength(1);
    expect(liveRef.current!.state).toBe("ending");
  });
});

describe("LiveView room layout", () => {
  const workPane = () => screen.getByTestId("work-pane");
  const stage = () => screen.getByTestId("room-stage");

  it("starts as a conversation: the interviewer and the transcript show, the work side is shut away", async () => {
    await mount();
    expect(stage()).toHaveAttribute("data-layout", "talk");
    expect(screen.getByRole("log", { name: "Conversation transcript" })).toBeInTheDocument();
    expect(screen.getByText("Asha")).toBeInTheDocument();
    expect(screen.getByTestId("camera-tile")).toBeInTheDocument();
    // Still in the page, but out of reach of the keyboard and of screen readers.
    expect(workPane()).toHaveAttribute("inert");
    expect(workPane()).toHaveAttribute("aria-hidden", "true");
    expect(workPane()).toHaveClass("invisible");
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Problem" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Tools" })).not.toBeInTheDocument();
  });

  it("opens the work side in `work`, with the conversation still on screen", async () => {
    const { session } = await mount();
    await roomState(session, "work");
    expect(stage()).toHaveAttribute("data-layout", "work");
    expect(stage()).toHaveClass("grid-cols-[1fr_4fr]");
    expect(workPane()).not.toHaveAttribute("inert");
    expect(workPane()).not.toHaveAttribute("aria-hidden");
    expect(workPane()).not.toHaveClass("invisible");
    expect(screen.getByRole("region", { name: "Problem" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Conversation transcript" })).toBeInTheDocument();
    expect(screen.getByText("Asha")).toBeInTheDocument();
  });

  it("morphs between the layouts with a column transition that reduced motion turns off", async () => {
    const { session } = await mount();
    expect(stage()).toHaveClass("grid-cols-[1fr_0fr]", "transition-[grid-template-columns]", "motion-reduce:transition-none");
    await roomState(session, "work");
    expect(stage()).toHaveClass("transition-[grid-template-columns]", "motion-reduce:transition-none");
  });

  it("keeps the work side mounted across talk, work and talk, so nothing the candidate did is lost", async () => {
    const { session } = await mount();
    const editor = screen.getByTestId("code-editor");
    const board = screen.getByTestId("diagram-board");
    const pane = workPane();
    await roomState(session, "work");
    await act(async () => {
      session.emitMessage(stampAgent({ type: "panel.show_problem", item_id: "slot-1", label: "Problem 1", kind: "problem", statement: "Count the islands in the grid.", examples: [] }));
    });
    await roomState(session, "talk");
    await roomState(session, "work");
    await roomState(session, "talk");
    // The same DOM nodes all along (a remount would make new ones), and the problem is still there.
    expect(screen.getByTestId("code-editor")).toBe(editor);
    expect(screen.getByTestId("diagram-board")).toBe(board);
    expect(workPane()).toBe(pane);
    expect(screen.getByText("Count the islands in the grid.")).toBeInTheDocument();
    expect(workPane()).toHaveAttribute("inert");
  });

  it("keeps the camera video itself when the layout changes", async () => {
    const { session } = await mount();
    const video = document.querySelector("video");
    await roomState(session, "work");
    expect(document.querySelector("video")).toBe(video);
    await roomState(session, "talk");
    expect(document.querySelector("video")).toBe(video);
  });

  it("shows a calm status line while the interviewer is slow, and removes it when it catches up", async () => {
    const { session } = await mount();
    expect(screen.queryByText(/taking a moment/i)).not.toBeInTheDocument();
    await roomState(session, "talk", true);
    const line = screen.getByText("Your interviewer is taking a moment…");
    expect(line.closest("[role=status]")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await roomState(session, "work", true); // still slow after the layout changes
    expect(screen.getByText("Your interviewer is taking a moment…")).toBeInTheDocument();
    await roomState(session, "work", false);
    expect(screen.queryByText(/taking a moment/i)).not.toBeInTheDocument();
  });
});
