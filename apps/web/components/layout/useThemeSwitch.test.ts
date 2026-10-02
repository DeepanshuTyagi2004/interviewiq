import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const setTheme = vi.fn();
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme }) }));

import { useThemeSwitch } from "./useThemeSwitch";

const root = document.documentElement;

afterEach(() => {
  setTheme.mockReset();
  root.className = "";
  // @ts-expect-error — test cleanup of the stub below
  delete document.startViewTransition;
});

describe("useThemeSwitch", () => {
  it("falls back to an instant swap with a colour fade when View Transitions are unavailable", () => {
    const { result } = renderHook(() => useThemeSwitch());
    act(() => result.current.switchTo("dark"));
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("theme-anim")).toBe(true);
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("reveals the new theme as a circle growing from the given origin", async () => {
    const animate = vi.fn();
    root.animate = animate as unknown as typeof root.animate;
    let finish!: () => void;
    document.startViewTransition = vi.fn((update?: () => void) => {
      update?.();
      return {
        ready: Promise.resolve(),
        finished: new Promise<void>((r) => (finish = r)),
        updateCallbackDone: Promise.resolve(),
        skipTransition: vi.fn(),
      } as unknown as ViewTransition;
    }) as unknown as typeof document.startViewTransition;

    const { result } = renderHook(() => useThemeSwitch());
    await act(async () => result.current.switchTo("dark", { x: 100, y: 20 }));

    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("theme-reveal")).toBe(true);
    expect(setTheme).toHaveBeenCalledWith("dark");
    const [keyframes, options] = animate.mock.calls[0];
    expect(keyframes.clipPath[0]).toBe("circle(0px at 100px 20px)");
    expect(options.pseudoElement).toBe("::view-transition-new(root)");

    await act(async () => finish());
    expect(root.classList.contains("theme-reveal")).toBe(false);
  });
});
