import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const useLiveState = vi.fn();
vi.mock("@/features/interview/hooks", () => ({ useLiveState: (id: string) => useLiveState(id) }));
// keep the provider real but with an injected inert session
import type { LiveSession } from "@/features/interview-live/session/types";
const inert: Partial<LiveSession> = {
  connectionState: "idle", getLocalStream: () => null, setMicEnabled() {}, setCameraEnabled() {},
  sendArtifact() {}, sendProctorEvent() {}, onControl: () => () => {}, onConnectionChange: () => () => {},
  connect: async () => {}, disconnect: async () => {},
};

import LiveInterview from "./LiveInterview";

describe("live route gating", () => {
  // vitest.config.ts doesn't set clearMocks — reset the shared `push`/`useLiveState` mocks
  // ourselves so call history from one test doesn't leak into the next.
  beforeEach(() => {
    push.mockClear();
    useLiveState.mockReset();
  });

  it("routes to the report for a COMPLETED session", () => {
    useLiveState.mockReturnValue({ data: { status: "COMPLETED" }, isLoading: false });
    render(<LiveInterview sessionId="s1" session={inert as LiveSession} />);
    expect(push).toHaveBeenCalledWith("/interviews/s1/report");
  });

  it("shows prejoin for a PREP_READY session", () => {
    useLiveState.mockReturnValue({ data: { status: "PREP_READY" }, isLoading: false });
    render(<LiveInterview sessionId="s1" session={inert as LiveSession} />);
    expect(screen.queryByText(/report/i)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a fetch-error affordance (not an infinite spinner) when getLive errors, and never mounts the provider", () => {
    useLiveState.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<LiveInterview sessionId="s1" session={inert as LiveSession} />);

    const backButton = screen.getByRole("button", { name: /back to interviews/i });
    expect(backButton).toBeInTheDocument();

    // If LiveSessionProvider had mounted, its machine starts at `prejoin`, which renders this
    // T&C checkbox copy — its absence is proof the provider (and its connection-change wiring)
    // never mounted for an unenterable, errored gate.
    expect(screen.queryByText(/agree to the rules/i)).toBeNull();
  });
});
