import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LiveSessionProvider,
  useLiveSession,
} from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { ChecksView } from "./ChecksView";

// MockLiveSession.connect() schedules a 300ms setTimeout for a scripted "stop speaking" event.
// Flushing past it inside act() keeps that update from leaking an "not wrapped in act" warning
// into whichever test runs next (same rationale as LiveInterview.test.tsx's flushMicrotasks).
async function flushTimers(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Drives the real LiveSessionProvider machine to `checks` (via the normal START_CHECKS event)
 * and renders ChecksView there, exposing the machine's state for assertions. ChecksView itself
 * doesn't care about routing — this mirrors how LiveInterview renders it for state `checks`. */
function Harness({ sessionId }: { sessionId: string }) {
  const { state, send } = useLiveSession();
  return (
    <div>
      <span data-testid="fsm-state">{state}</span>
      {state === "prejoin" && (
        <button onClick={() => send({ type: "START_CHECKS" })}>
          drive-to-checks
        </button>
      )}
      {state === "checks" && <ChecksView sessionId={sessionId} />}
    </div>
  );
}

async function renderAtChecks(session: MockLiveSession) {
  const user = userEvent.setup();
  render(
    <LiveSessionProvider sessionId="s1" session={session}>
      <Harness sessionId="s1" />
    </LiveSessionProvider>,
  );
  await user.click(screen.getByRole("button", { name: /drive-to-checks/i }));
  await flushTimers();
  return user;
}

/** Session subclass that rejects on connect() — used to test error-handling. */
class FailingMockLiveSession extends MockLiveSession {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async connect(_sessionId: string): Promise<void> {
    throw new Error("Connection failed");
  }
}

describe("ChecksView", () => {
  it("runs and shows the three system checks", async () => {
    const session = new MockLiveSession();
    await renderAtChecks(session);

    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(screen.getByText("Camera")).toBeInTheDocument();
    expect(screen.getByText("External display")).toBeInTheDocument();
  });

  it("Enter interview requests fullscreen, connects, and drives the machine to live", async () => {
    const session = new MockLiveSession();
    const connectSpy = vi.spyOn(session, "connect");
    const user = await renderAtChecks(session);

    const enterButton = await screen.findByRole("button", {
      name: /enter interview/i,
    });
    await waitFor(() => expect(enterButton).toBeEnabled());

    await user.click(enterButton);

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    await waitFor(() => expect(connectSpy).toHaveBeenCalledWith("s1"));
    await waitFor(() =>
      expect(screen.getByTestId("fsm-state").textContent).toBe("live"),
    );

    // let MockLiveSession's scripted 300ms "stop speaking" timeout fire inside act()
    await flushTimers(350);
  });

  it("Enter interview sends ERROR when connect() rejects", async () => {
    const session = new FailingMockLiveSession();
    const user = await renderAtChecks(session);

    const enterButton = await screen.findByRole("button", {
      name: /enter interview/i,
    });
    await waitFor(() => expect(enterButton).toBeEnabled());

    await user.click(enterButton);

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("fsm-state").textContent).toBe("error"),
    );
  });
});
