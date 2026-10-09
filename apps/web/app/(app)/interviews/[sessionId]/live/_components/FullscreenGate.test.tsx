import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { LiveInterviewInner } from "./LiveInterview";
import { FullscreenGate } from "./FullscreenGate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/interview/api", () => ({ endLive: vi.fn(), getLive: vi.fn() }));
vi.mock("@/features/interview-live/work/CodeEditor", () => ({ CodeEditor: () => <div /> }));
vi.mock("@/features/interview-live/work/DiagramBoard", () => ({ DiagramBoard: () => <div /> }));

type Doc = { fullscreenElement: Element | null };
function setFullscreen(on: boolean) {
  (document as unknown as Doc).fullscreenElement = on ? document.documentElement : null;
  act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
}

let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (document as unknown as Doc).fullscreenElement = null;
  request = vi.fn(async () => {});
  document.documentElement.requestFullscreen = request as unknown as typeof document.documentElement.requestFullscreen;
});
afterEach(() => { (document as unknown as Doc).fullscreenElement = null; });

describe("FullscreenGate", () => {
  it("holds the page back until the browser is full screen, then shows it", () => {
    render(<FullscreenGate><p>the instructions</p></FullscreenGate>);
    expect(screen.queryByText("the instructions")).toBeNull();
    expect(screen.getByRole("button", { name: /enter full screen/i })).toBeInTheDocument();
    setFullscreen(true);
    expect(screen.getByText("the instructions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enter full screen/i })).toBeNull();
  });

  it("asks the browser for full screen when the candidate clicks, and puts the gate back if they leave it", async () => {
    render(<FullscreenGate><p>the instructions</p></FullscreenGate>);
    await userEvent.click(screen.getByRole("button", { name: /enter full screen/i }));
    expect(request).toHaveBeenCalledTimes(1);
    setFullscreen(true);
    setFullscreen(false);
    expect(screen.queryByText("the instructions")).toBeNull();
    expect(screen.getByRole("button", { name: /enter full screen/i })).toBeInTheDocument();
  });

  it("says so when the browser refuses full screen", async () => {
    request.mockRejectedValueOnce(new Error("denied"));
    render(<FullscreenGate><p>the instructions</p></FullscreenGate>);
    await userEvent.click(screen.getByRole("button", { name: /enter full screen/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/blocked full screen/i));
  });
});

describe("the room before the round starts", () => {
  function mount() {
    render(
      <LiveSessionProvider sessionId="s1" session={new MockLiveSession()}>
        <div className="fixed inset-0"><LiveInterviewInner sessionId="s1" /></div>
      </LiveSessionProvider>,
    );
  }

  it("shows the instruction page only in full screen", () => {
    mount();
    expect(screen.queryByText("Before you start")).toBeNull();
    expect(screen.getByRole("button", { name: /enter full screen/i })).toBeInTheDocument();
    setFullscreen(true);
    expect(screen.getByText("Before you start")).toBeInTheDocument();
  });

  it("goes back behind the gate if the candidate leaves full screen on the instruction page", () => {
    setFullscreen(true);
    mount();
    expect(screen.getByText("Before you start")).toBeInTheDocument();
    setFullscreen(false);
    expect(screen.queryByText("Before you start")).toBeNull();
  });
});
