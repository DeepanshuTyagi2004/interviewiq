import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { PrejoinView } from "./PrejoinView";

describe("PrejoinView rules", () => {
  it("states the return time, paste and typing rules before the candidate agrees", () => {
    render(
      <LiveSessionProvider sessionId="s1" session={new MockLiveSession()}>
        <PrejoinView />
      </LiveSessionProvider>,
    );
    expect(screen.getByText(/come back within 15 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/after 60 seconds the interview ends/)).toBeInTheDocument();
    expect(screen.getByText(/pasting outside text ends the interview/)).toBeInTheDocument();
    expect(screen.getByText(/automated typing ends the interview/)).toBeInTheDocument();
    expect(screen.getByLabelText(/pasting text from outside the room or typing by script ends the interview/i)).toBeInTheDocument();
  });
});
