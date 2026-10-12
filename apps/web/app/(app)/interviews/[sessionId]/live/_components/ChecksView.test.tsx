import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LiveSessionProvider,
  useLiveSession,
} from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { stopScreenShare } from "@/features/interview-live/proctor/screenShare";
import { resetClipboard, wasCleared } from "@/features/interview-live/proctor/localClipboard";
import { ChecksView } from "./ChecksView";

async function flushTimers(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Drives the real LiveSessionProvider machine to `checks` and renders ChecksView there, exposing
 * the machine's state for assertions (mirrors how LiveInterview renders it). */
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

function mockEntireScreen(surface = "monitor") {
  const track = { kind: "video", stop: vi.fn(), getSettings: () => ({ displaySurface: surface }), addEventListener: vi.fn() };
  Object.assign(navigator.mediaDevices, {
    getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })),
  });
}

afterEach(() => {
  stopScreenShare();
  Reflect.deleteProperty(navigator.mediaDevices, "getDisplayMedia");
});

describe("ChecksView", () => {
  it("runs and shows the five system checks", async () => {
    await renderAtChecks(new MockLiveSession());
    for (const label of ["Microphone", "Camera", "Entire screen", "Window size", "External display"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows each check as a readout row: steady OK dots once they pass, the share waiting, nothing pulsing", async () => {
    await renderAtChecks(new MockLiveSession());
    const list = screen.getByRole("list", { name: /system checks/i });
    await waitFor(() => expect(within(list).getAllByText("OK")).toHaveLength(4));
    expect(within(list).getByText("Warning")).toBeInTheDocument();
    expect(list.querySelector("[data-motion]")).toBeNull();
  });

  it("marks denied devices Action needed and keeps the how-to-fix message", async () => {
    const gum = vi.mocked(navigator.mediaDevices.getUserMedia);
    gum.mockRejectedValueOnce(new Error("denied")).mockRejectedValueOnce(new Error("denied"));
    await renderAtChecks(new MockLiveSession());
    const list = screen.getByRole("list", { name: /system checks/i });
    await waitFor(() => expect(within(list).getAllByText("Action needed")).toHaveLength(2));
    expect(screen.getByRole("status")).toHaveTextContent(/allow microphone and camera access/i);
    expect(screen.getByRole("button", { name: /enter interview/i })).toBeDisabled();
  });

  it("keeps Enter disabled until the entire screen is shared, and rejects a window share", async () => {
    const user = await renderAtChecks(new MockLiveSession());
    const enter = screen.getByRole("button", { name: /enter interview/i });
    expect(enter).toBeDisabled();
    mockEntireScreen("window");
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    expect(screen.getByText(/not a window or tab/i)).toBeInTheDocument();
    mockEntireScreen();
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(enter).toBeEnabled());
  });

  it("Enter interview requests fullscreen, connects, and drives the machine to live", async () => {
    const session = new MockLiveSession();
    const connectSpy = vi.spyOn(session, "connect");
    const user = await renderAtChecks(session);
    mockEntireScreen();
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));

    const enterButton = await screen.findByRole("button", { name: /enter interview/i });
    await waitFor(() => expect(enterButton).toBeEnabled());
    await user.click(enterButton);

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    await waitFor(() => expect(connectSpy).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
  });

  it("Enter interview sends ERROR when connect() rejects", async () => {
    const user = await renderAtChecks(new FailingMockLiveSession());
    mockEntireScreen();
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));

    const enterButton = await screen.findByRole("button", { name: /enter interview/i });
    await waitFor(() => expect(enterButton).toBeEnabled());
    await user.click(enterButton);

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("error"));
  });

  it("Enter interview clears the clipboard once, with the click, while the clipboard rules are active", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const writeText = vi.fn(async () => {});
    try {
      const user = await renderAtChecks(new MockLiveSession());
      // After render: userEvent.setup() installs its own clipboard stub, which would replace an earlier mock.
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      mockEntireScreen();
      await user.click(screen.getByRole("button", { name: "Share entire screen" }));
      const enterButton = await screen.findByRole("button", { name: /enter interview/i });
      await waitFor(() => expect(enterButton).toBeEnabled());
      await user.click(enterButton);
      await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("IQ-ROOM-CLIPBOARD");
      expect(wasCleared()).toBe(true);
    } finally {
      resetClipboard();
      Reflect.deleteProperty(navigator, "clipboard");
      vi.unstubAllEnvs();
    }
  });

  it("Enter interview still goes live when the clipboard cannot be cleared", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const writeText = vi.fn(async () => { throw new Error("denied"); });
    try {
      const user = await renderAtChecks(new MockLiveSession());
      // After render: userEvent.setup() installs its own clipboard stub, which would replace an earlier mock.
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      mockEntireScreen();
      await user.click(screen.getByRole("button", { name: "Share entire screen" }));
      const enterButton = await screen.findByRole("button", { name: /enter interview/i });
      await waitFor(() => expect(enterButton).toBeEnabled());
      await user.click(enterButton);
      await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(wasCleared()).toBe(false);
    } finally {
      resetClipboard();
      Reflect.deleteProperty(navigator, "clipboard");
      vi.unstubAllEnvs();
    }
  });

  it("tells the candidate the clipboard is cleared on entering", async () => {
    await renderAtChecks(new MockLiveSession());
    expect(screen.getByText(/clears your clipboard/i)).toBeInTheDocument();
  });
});
