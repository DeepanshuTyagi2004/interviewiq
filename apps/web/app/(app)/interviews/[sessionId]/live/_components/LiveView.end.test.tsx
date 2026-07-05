import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveSessionProvider, useLiveSession } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { LiveView } from "./LiveView";

// WorkArea renders Monaco/Excalidraw wrappers — swap them for inert stand-ins (same approach as
// LiveView.test.tsx) so this test doesn't pay their load cost.
vi.mock("@/features/interview-live/work/CodeEditor", () => ({
  CodeEditor: () => <div data-testid="code-editor" />,
}));
vi.mock("@/features/interview-live/work/DiagramBoard", () => ({
  DiagramBoard: () => <div data-testid="diagram-board" />,
}));

// Sibling probe that exposes the machine's state/ctx and lets the test drive prejoin -> live
// through the same events ChecksView would normally dispatch (mirrors the `Bridge` component in
// LiveSessionProvider.test.tsx). It shares the same provider context as LiveView, so driving state
// here and clicking End on LiveView act on the same machine instance.
function Driver() {
  const { state, ctx, send } = useLiveSession();
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="endedReason">{ctx.endedReason ?? ""}</span>
      <button onClick={() => send({ type: "START_CHECKS" })}>start-checks</button>
      <button onClick={() => send({ type: "CHECKS_PASSED" })}>checks-passed</button>
      <button onClick={() => send({ type: "CONNECTED" })}>connected</button>
    </div>
  );
}

async function flushTimers(ms = 350) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("LiveView manual end reason", () => {
  it("records ctx.endedReason as 'completed' (not 'aborted_technical') when the candidate clicks End", async () => {
    const session = new MockLiveSession();
    await session.connect("s1");
    const user = userEvent.setup();

    render(
      <LiveSessionProvider sessionId="s1" session={session}>
        <Driver />
        <LiveView sessionId="s1" />
      </LiveSessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "start-checks" }));
    await user.click(screen.getByRole("button", { name: "checks-passed" }));
    await user.click(screen.getByRole("button", { name: "connected" }));
    expect(screen.getByTestId("state").textContent).toBe("live");

    await flushTimers();

    const endButton = screen.getByRole("button", { name: /end interview/i });
    await user.click(endButton);

    // Manual end must land on 'ended' with the real completion reason — not the
    // disconnect-triggered 'aborted_technical' bridge reason racing ahead of it.
    expect(screen.getByTestId("state").textContent).toBe("ended");
    expect(screen.getByTestId("endedReason").textContent).toBe("completed");
  });
});
