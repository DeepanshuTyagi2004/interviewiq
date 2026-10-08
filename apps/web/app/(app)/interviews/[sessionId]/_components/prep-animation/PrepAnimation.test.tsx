import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PrepAnimation, PREP_ANIMATION_SETS } from "./PrepAnimation";
import { SCENES } from "./scenes";

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
}

describe("PrepAnimation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is decorative and plays the chosen chapter with the cat in it", () => {
    mockReducedMotion(false);
    const { container } = render(<PrepAnimation setIndex={2} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("data-set", PREP_ANIMATION_SETS[2]);
    for (const part of ["cat", "head", "armRig", "pawRig", "handRig", "catShadow", "bandage"]) {
      expect(container.querySelector(`[data-part="${part}"]`), part).not.toBeNull();
    }
  });

  it("picks a random chapter when none is given", () => {
    mockReducedMotion(false);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { container } = render(<PrepAnimation />);
    expect(container.firstElementChild).toHaveAttribute("data-set", PREP_ANIMATION_SETS[PREP_ANIMATION_SETS.length - 1]);
  });

  it("renders every chapter", () => {
    mockReducedMotion(false);
    SCENES.forEach((scene, i) => {
      const { container, unmount } = render(<PrepAnimation setIndex={i} freezeAt={scene.still} />);
      expect(container.firstElementChild).toHaveAttribute("data-set", scene.id);
      expect(container.textContent).toContain(scene.status(scene.still));
      unmount();
    });
  });

  it("animates on frames and stops when unmounted", () => {
    mockReducedMotion(false);
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 7);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { unmount } = render(<PrepAnimation setIndex={0} />);
    expect(request).toHaveBeenCalled();
    unmount();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("shows one still under reduced motion, without animating", () => {
    mockReducedMotion(true);
    const request = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(<PrepAnimation setIndex={1} />);
    expect(container.firstElementChild).toHaveAttribute("data-reduced", "true");
    expect(container.textContent).toContain(SCENES[1]!.status(SCENES[1]!.still));
    expect(request).not.toHaveBeenCalled();
  });
});
