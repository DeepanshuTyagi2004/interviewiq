import { describe, expect, it } from "vitest";
import { orbVariant, clampFilled } from "./index";

describe("orbVariant", () => {
  it("is stable and in range", () => {
    expect(orbVariant("")).toBe(0);
    expect(orbVariant("meesho")).toBe(orbVariant("meesho"));
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(orbVariant)).size).toBeGreaterThan(1);
    for (const s of ["x", "amazon-sde1", "🙂"]) expect([0, 1, 2, 3]).toContain(orbVariant(s));
  });
});

describe("clampFilled", () => {
  it("clamps and rounds", () => {
    expect(clampFilled(NaN, 4)).toBe(0);
    expect(clampFilled(9, 4)).toBe(4);
    expect(clampFilled(2.6, 4)).toBe(3);
  });
});
