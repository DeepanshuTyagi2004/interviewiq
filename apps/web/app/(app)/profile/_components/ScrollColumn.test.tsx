import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScrollColumn } from "./ScrollColumn";

describe("ScrollColumn", () => {
  it("scrolls on its own on desktop and dissolves into the single column below it", () => {
    render(<ScrollColumn>cards</ScrollColumn>);
    const col = screen.getByText("cards");
    expect(col).toHaveClass("contents", "lg:flex", "lg:min-h-0", "lg:overflow-y-auto", "iq-scroll-fade");
  });

  it("flags the edge that hides content, so the fade cue shows only there", () => {
    render(<ScrollColumn>cards</ScrollColumn>);
    const col = screen.getByText("cards");
    expect(col).not.toHaveAttribute("data-more-above");
    expect(col).not.toHaveAttribute("data-more-below");

    for (const [key, value] of Object.entries({ scrollHeight: 900, clientHeight: 300, scrollTop: 0 })) {
      Object.defineProperty(col, key, { configurable: true, value });
    }
    fireEvent.scroll(col);
    expect(col).not.toHaveAttribute("data-more-above");
    expect(col).toHaveAttribute("data-more-below");
  });
});
