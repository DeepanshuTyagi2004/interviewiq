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

describe("LiveView", () => {
  it("lays out the transcript, the problem panel, the work area, the tools and the bottom bar", async () => {
    await mount();
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
    fireEvent.mouseLeave(screen.getByRole("region", { name: "Workspace" }));
    await waitFor(() => expect(session.sentOf("activity.batch")[0]?.events).toEqual([expect.objectContaining({ k: "ptr", s: "out" })]), { timeout: 2000 });
  });

  it("shows a problem the interviewer puts on screen", async () => {
    const { session } = await mount();
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
