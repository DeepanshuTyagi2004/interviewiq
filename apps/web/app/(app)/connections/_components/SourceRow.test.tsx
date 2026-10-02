import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceRow } from "./SourceRow";

describe("SourceRow status dot", () => {
  it("renders no dot without a state (onboarding and other callers stay as they were)", () => {
    const { container } = render(<SourceRow code="GH" name="GitHub" />);
    expect(container.querySelector("[aria-hidden][class*='rounded-full']")).toBeNull();
    expect(screen.queryByText("Not connected")).toBeNull();
  });

  it("renders a HUD-only dot before the name, with screen-reader text for the state", () => {
    render(<SourceRow code="LC" name="LeetCode" state="live" />);
    const label = screen.getByText("Syncing");
    expect(label).toHaveClass("sr-only");

    const dot = label.parentElement!;
    // Hidden outside the signed-in HUD scope, so onboarding renders exactly as before.
    expect(dot).toHaveClass("hidden", "hud:inline-flex");
    expect(dot).not.toHaveClass("inline-flex");
    expect(dot.nextElementSibling).toHaveTextContent("LeetCode");
  });

  it.each([
    ["active", "Connected"],
    ["error", "Sync error"],
    ["idle", "Not connected"],
  ] as const)("labels %s as %s", (state, text) => {
    render(<SourceRow code="GH" name="GitHub" state={state} />);
    expect(screen.getByText(text)).toHaveClass("sr-only");
  });

  it("lets the row override the dot's screen-reader text", () => {
    render(<SourceRow code="GH" name="GitHub" state="error" stateLabel="Connection failed" />);
    expect(screen.getByText("Connection failed")).toHaveClass("sr-only");
    expect(screen.queryByText("Sync error")).toBeNull();
  });

  it("gives the dot no screen-reader text when stateLabel is null (a visible pill already says it)", () => {
    const { container } = render(
      <SourceRow code="LC" name="LeetCode" state="live" stateLabel={null} pill={<span>Syncing</span>} />,
    );
    // The dot still renders (and pulses) ...
    expect(container.querySelector("[data-motion]")).not.toBeNull();
    // ... but the only "Syncing" is the visible pill.
    expect(screen.getAllByText("Syncing")).toHaveLength(1);
    expect(container.querySelector(".sr-only")).toBeNull();
  });
});
