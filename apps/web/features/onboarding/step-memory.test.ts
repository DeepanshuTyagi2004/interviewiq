import { afterEach, describe, expect, it } from "vitest";
import { clearStep, readStep, writeStep } from "./step-memory";

describe("onboarding step memory", () => {
  afterEach(() => sessionStorage.clear());

  it("round-trips a valid step and clears it", () => {
    writeStep(2);
    expect(readStep(4)).toBe(2);
    clearStep();
    expect(readStep(4)).toBeNull();
  });

  it("ignores out-of-range or garbage values", () => {
    sessionStorage.setItem("iq-onboarding-step", "9");
    expect(readStep(4)).toBeNull();
    sessionStorage.setItem("iq-onboarding-step", "two");
    expect(readStep(4)).toBeNull();
  });
});
