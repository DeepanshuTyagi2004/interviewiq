import { describe, expect, it } from "vitest";
import { LiveAvailability } from "../../src/services/liveAvailability.js";

describe("LiveAvailability", () => {
  it("is the global flag only: off blocks everyone, on opens it to everyone", () => {
    expect(new LiveAvailability(false).isAvailableFor("anyone")).toBe(false);
    expect(new LiveAvailability(true).isAvailableFor("anyone")).toBe(true);
  });
});
