import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Shared mutable state for the mocks. vi.hoisted so it exists before the hoisted vi.mock factories run.
const h = vi.hoisted(() => ({ state: "live" as string, mounts: 0 }));

// Bypass the real provider; drive `state` directly through the mocked hook.
vi.mock("@/features/interview-live/session/LiveSessionProvider", () => ({
  LiveSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/interview-live/session/useLiveSession", () => ({
  useLiveSession: () => ({
    state: h.state,
    session: { sendProctorEvent: () => {} },
    send: () => {},
    ctx: { violations: 0, pausedReason: null, endedReason: null },
    speaking: { candidate: false, interviewer: false },
    transcript: [],
  }),
}));
// LiveView counts its mounts so we can prove it is NOT remounted across live<->paused.
vi.mock("./LiveView", async () => {
  const { useEffect } = await import("react");
  return {
    LiveView: () => {
      useEffect(() => {
        h.mounts += 1;
      }, []);
      return <div data-testid="live-view" />;
    },
  };
});
vi.mock("@/features/interview-live/proctor/ViolationOverlay", () => ({
  ViolationOverlay: () => <div data-testid="overlay" />,
}));
// LiveInterviewInner reads useRouter() unconditionally (for the `error` state's recovery
// button) — stub it since this test never leaves the app-router-less test environment.
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});
// LiveInterview now gates on the server session status (Task 5) before mounting the provider —
// report a PREP_READY session as already loaded so this live<->paused remount test still reaches
// the (mocked) provider/machine below.
vi.mock("@/features/interview/hooks", () => ({
  useLiveState: () => ({ data: { status: "PREP_READY" }, isLoading: false }),
  useSession: () => ({ data: { liveAvailable: true }, isLoading: false }),
}));

import LiveInterview from "./LiveInterview";

describe("LiveInterview live<->paused (no remount)", () => {
  beforeEach(() => {
    h.state = "live";
    h.mounts = 0;
  });

  it("keeps LiveView mounted across pause/resume, toggling inert + overlay without remounting", () => {
    const { rerender } = render(<LiveInterview sessionId="s1" />);
    // live: mounted once, no overlay, not inert
    expect(h.mounts).toBe(1);
    expect(document.querySelector("[data-testid='overlay']")).toBeNull();
    const wrapperLive = document.querySelector("[data-testid='live-view']")!.parentElement!;
    expect(wrapperLive.hasAttribute("inert")).toBe(false);

    // -> paused: SAME LiveView instance (mounts still 1), overlay shown, work area inert
    h.state = "paused";
    rerender(<LiveInterview sessionId="s1" />);
    expect(h.mounts).toBe(1);
    expect(document.querySelector("[data-testid='overlay']")).toBeInTheDocument();
    const wrapperPaused = document.querySelector("[data-testid='live-view']")!.parentElement!;
    expect(wrapperPaused.hasAttribute("inert")).toBe(true);

    // -> live again: still the same instance (mounts still 1), overlay gone, not inert
    h.state = "live";
    rerender(<LiveInterview sessionId="s1" />);
    expect(h.mounts).toBe(1);
    expect(document.querySelector("[data-testid='overlay']")).toBeNull();
    const wrapperBack = document.querySelector("[data-testid='live-view']")!.parentElement!;
    expect(wrapperBack.hasAttribute("inert")).toBe(false);
  });
});
