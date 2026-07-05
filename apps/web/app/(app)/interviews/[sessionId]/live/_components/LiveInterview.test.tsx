import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";

// LiveInterviewInner reads useRouter() unconditionally (for the `error` state's recovery
// button) — stub it since these tests never leave the app-router-less test environment.
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});
// LiveInterview now gates on the server session status (Task 5) before mounting the provider —
// these tests exercise the prejoin view, so report a PREP_READY session as already loaded.
vi.mock("@/features/interview/hooks", () => ({
  useLiveState: () => ({ data: { status: "PREP_READY" }, isLoading: false }),
}));

import LiveInterview from "./LiveInterview";

// PrejoinView's camera preview acquires its stream via a real (mocked) getUserMedia() call, which
// resolves asynchronously. Flushing a macrotask after render lets that settle inside act() so it
// doesn't leak an "update not wrapped in act" warning into whichever test runs next.
async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("LiveInterview / PrejoinView", () => {
  it("shows the prejoin content with dos/don'ts, the AI-interviewer notice, a T&C checkbox, and a camera preview", async () => {
    render(<LiveInterview sessionId="s1" session={new MockLiveSession()} />);

    expect(screen.getByText(/AI interviewer/i)).toBeInTheDocument();
    expect(screen.getAllByText(/full screen/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/quiet, well-lit space/i)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /agree to the rules/i }),
    ).toBeInTheDocument();
    expect(document.querySelector("video")).toBeInTheDocument();

    await flushMicrotasks();
  });

  it("disables Continue until the T&C checkbox is checked", async () => {
    const user = userEvent.setup();
    render(<LiveInterview sessionId="s1" session={new MockLiveSession()} />);

    const continueButton = screen.getByRole("button", { name: /continue/i });
    const checkbox = screen.getByRole("checkbox", {
      name: /agree to the rules/i,
    });

    expect(continueButton).toBeDisabled();

    await user.click(checkbox);

    expect(continueButton).toBeEnabled();

    await flushMicrotasks();
  });
});
