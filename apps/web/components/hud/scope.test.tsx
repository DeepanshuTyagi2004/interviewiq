import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HUD_CLASS, HudScope, HudZoomOff } from "./scope";

const html = () => document.documentElement;

afterEach(() => {
  html().classList.remove(HUD_CLASS);
  html().removeAttribute("data-hud-zoom");
});

describe("HudScope", () => {
  it("adds iq-hud to <html> while mounted and removes it on unmount", () => {
    const { unmount } = render(<HudScope />);
    expect(html().classList.contains(HUD_CLASS)).toBe(true);
    unmount();
    expect(html().classList.contains(HUD_CLASS)).toBe(false);
  });

  it("keeps the class until the last of two scopes unmounts", () => {
    const a = render(<HudScope />);
    const b = render(<HudScope />);
    a.unmount();
    expect(html().classList.contains(HUD_CLASS)).toBe(true);
    b.unmount();
    expect(html().classList.contains(HUD_CLASS)).toBe(false);
  });
});

describe("HudZoomOff", () => {
  it("is a no-op: the zoom it used to turn off is gone", () => {
    const { container, unmount } = render(<HudZoomOff />);
    expect(container).toBeEmptyDOMElement();
    expect(html().hasAttribute("data-hud-zoom")).toBe(false);
    unmount();
  });
});
