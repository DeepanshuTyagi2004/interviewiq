import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Bypass the real provider/session and drive `state` directly, same approach as
// LiveInterview.remount.test.tsx — this test only cares about the `error` render.
const h = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/features/interview-live/session/LiveSessionProvider", () => ({
  LiveSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/interview-live/session/useLiveSession", () => ({
  useLiveSession: () => ({
    state: "error",
    session: { sendProctorEvent: () => {} },
    send: () => {},
    ctx: { violations: 0, pausedReason: null, endedReason: null },
    speaking: { candidate: false, interviewer: false },
    transcript: [],
  }),
}));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, useRouter: () => ({ push: h.push }) };
});
// LiveInterview now gates on the server session status (Task 5) before mounting the provider —
// report a PREP_READY session as already loaded so these `error`-state tests still reach the
// (mocked) provider/machine below.
vi.mock("@/features/interview/hooks", () => ({
  useLiveState: () => ({ data: { status: "PREP_READY" }, isLoading: false }),
  useSession: () => ({ data: { liveAvailable: true }, isLoading: false }),
}));

import LiveInterview from "./LiveInterview";

describe("LiveInterview error state (Q5)", () => {
  beforeEach(() => {
    // Isolate document.fullscreenElement + the requestFullscreen/exitFullscreen/push call
    // history (vitest.setup.ts installs these as vi.fn()s shared across the whole file) so each
    // test starts from a known, non-fullscreen state.
    vi.clearAllMocks();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value: null,
    });
  });

  it("shows a message and a recovery button instead of a dead-end text", () => {
    render(<LiveInterview sessionId="s1" />);

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to interviews/i })).toBeInTheDocument();
  });

  it("clicking the recovery button exits fullscreen (if active) and navigates to /interviews", async () => {
    const user = userEvent.setup();
    await document.documentElement.requestFullscreen();
    expect(document.fullscreenElement).not.toBeNull();

    render(<LiveInterview sessionId="s1" />);
    await user.click(screen.getByRole("button", { name: /back to interviews/i }));

    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(h.push).toHaveBeenCalledWith("/interviews");
  });

  it("does not call exitFullscreen when not in fullscreen", async () => {
    const user = userEvent.setup();
    expect(document.fullscreenElement).toBeNull();

    render(<LiveInterview sessionId="s1" />);
    await user.click(screen.getByRole("button", { name: /back to interviews/i }));

    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(h.push).toHaveBeenCalledWith("/interviews");
  });
});
