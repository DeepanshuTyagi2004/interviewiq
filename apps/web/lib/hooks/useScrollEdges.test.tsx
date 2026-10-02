import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { useScrollEdges } from "./useScrollEdges";

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const { above, below } = useScrollEdges(ref);
  return <div ref={ref} data-testid="scroller" data-above={String(above)} data-below={String(below)} />;
}

/** jsdom has no layout, so give the box its scroll geometry, then scroll it. */
function scrollTo(el: HTMLElement, geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  for (const [key, value] of Object.entries(geometry)) {
    Object.defineProperty(el, key, { configurable: true, value });
  }
  fireEvent.scroll(el);
}

describe("useScrollEdges", () => {
  it("reports nothing hidden when the content fits", () => {
    render(<Probe />);
    const el = screen.getByTestId("scroller");
    scrollTo(el, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
    expect(el).toHaveAttribute("data-above", "false");
    expect(el).toHaveAttribute("data-below", "false");
  });

  it("tracks which edges hide content as the box scrolls", () => {
    render(<Probe />);
    const el = screen.getByTestId("scroller");

    scrollTo(el, { scrollHeight: 900, clientHeight: 300, scrollTop: 0 });
    expect(el).toHaveAttribute("data-above", "false");
    expect(el).toHaveAttribute("data-below", "true");

    scrollTo(el, { scrollHeight: 900, clientHeight: 300, scrollTop: 300 });
    expect(el).toHaveAttribute("data-above", "true");
    expect(el).toHaveAttribute("data-below", "true");

    scrollTo(el, { scrollHeight: 900, clientHeight: 300, scrollTop: 600 });
    expect(el).toHaveAttribute("data-above", "true");
    expect(el).toHaveAttribute("data-below", "false");
  });

  it("treats sub-pixel leftovers at the end as the end", () => {
    render(<Probe />);
    const el = screen.getByTestId("scroller");
    scrollTo(el, { scrollHeight: 900, clientHeight: 300, scrollTop: 599.5 });
    expect(el).toHaveAttribute("data-below", "false");
  });
});
