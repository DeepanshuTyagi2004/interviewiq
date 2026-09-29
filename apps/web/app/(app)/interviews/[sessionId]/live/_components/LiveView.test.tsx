import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { LiveView } from "./LiveView";

// WorkArea renders Monaco/Excalidraw wrappers — swap them for inert stand-ins so this test
// doesn't pay their load cost (same approach as WorkArea.test.tsx).
vi.mock("@/features/interview-live/work/CodeEditor", () => ({
  CodeEditor: () => <div data-testid="code-editor" />,
}));
vi.mock("@/features/interview-live/work/DiagramBoard", () => ({
  DiagramBoard: () => <div data-testid="diagram-board" />,
}));

// MockLiveSession.connect() schedules a 300ms setTimeout for a scripted "stop speaking" event.
// Flushing past it inside act() keeps that update from leaking an "not wrapped in act" warning
// into whichever test runs next (same rationale as ChecksView.test.tsx).
async function flushTimers(ms = 350) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function renderLiveView(session: MockLiveSession) {
  return render(
    <LiveSessionProvider sessionId="s1" session={session}>
      <LiveView sessionId="s1" />
    </LiveSessionProvider>,
  );
}

describe("LiveView", () => {
  it("renders the work area, camera tile, avatar, and the four drawer controls", async () => {
    const session = new MockLiveSession();
    // Connect before mounting so useLocalMedia's initial getLocalStream() picks up a real stream.
    await session.connect("s1");

    renderLiveView(session);

    expect(
      screen.getByRole("tab", { name: /code editor/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /excalidraw/i }),
    ).toBeInTheDocument();

    expect(document.querySelector("video")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-bubble")).toHaveTextContent("I");

    // The left-hand transcript panel replaces the old "Interviewer captions" right-rail list.
    expect(screen.getByRole("log", { name: /conversation transcript/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/interviewer captions/i)).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /end interview/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mute microphone/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /turn off camera/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /toggle fullscreen/i }),
    ).toBeInTheDocument();

    await flushTimers();
  });

  it("clicking the mic toggle calls session.setMicEnabled and flips aria-pressed", async () => {
    const session = new MockLiveSession();
    await session.connect("s1");
    const setMicEnabled = vi.spyOn(session, "setMicEnabled");
    const user = userEvent.setup();

    renderLiveView(session);

    const micButton = screen.getByRole("button", { name: /mute microphone/i });
    expect(micButton).toHaveAttribute("aria-pressed", "false");

    await user.click(micButton);

    expect(setMicEnabled).toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("button", { name: /unmute microphone/i }),
    ).toHaveAttribute("aria-pressed", "true");

    await flushTimers();
  });

  it("Q6: clicking End interview exits fullscreen if active", async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    const session = new MockLiveSession();
    await session.connect("s1");
    const user = userEvent.setup();

    renderLiveView(session);
    await flushTimers();

    await document.documentElement.requestFullscreen();
    expect(document.fullscreenElement).not.toBeNull();

    const endButton = screen.getByRole("button", { name: /end interview/i });
    await user.click(endButton);

    expect(document.exitFullscreen).toHaveBeenCalled();
  });

  it("Q6: clicking End interview does not call exitFullscreen when not in fullscreen", async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    const session = new MockLiveSession();
    await session.connect("s1");
    const exitFullscreenSpy = vi.spyOn(document, "exitFullscreen");
    const user = userEvent.setup();

    renderLiveView(session);
    await flushTimers();

    expect(document.fullscreenElement).toBeNull();
    const endButton = screen.getByRole("button", { name: /end interview/i });
    await user.click(endButton);

    expect(exitFullscreenSpy).not.toHaveBeenCalled();
  });
});
