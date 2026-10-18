import { describe, expect, it } from "vitest";
import {
  drawRoundMinutes, MOCK_ROUND_MIN_MINUTES, MOCK_ROUND_MINUTES, ROUND_MINUTE_CHOICES, sessionRoundMinutes,
} from "../../src/domain/liveRound.js";

describe("round length", () => {
  it("is 30, 35, 40 or 45 minutes, with 45 the maximum and 30 the minimum", () => {
    expect([...ROUND_MINUTE_CHOICES]).toEqual([30, 35, 40, 45]);
    expect(MOCK_ROUND_MINUTES).toBe(45);
    expect(MOCK_ROUND_MIN_MINUTES).toBe(30);
  });

  it("draws every length uniformly from the injected random value", () => {
    expect([0, 0.3, 0.6, 0.99].map((r) => drawRoundMinutes(() => r))).toEqual([30, 35, 40, 45]);
    // The bucket edges: a quarter each.
    expect([0.2499, 0.25, 0.4999, 0.5, 0.7499, 0.75].map((r) => drawRoundMinutes(() => r))).toEqual([30, 35, 35, 40, 40, 45]);
  });

  it("never leaves the four lengths, even for a random value outside [0, 1)", () => {
    expect(drawRoundMinutes(() => 1)).toBe(45);
    expect(drawRoundMinutes(() => -0.5)).toBe(30);
    const drawn = new Set(Array.from({ length: 400 }, () => drawRoundMinutes()));
    for (const m of drawn) expect(ROUND_MINUTE_CHOICES).toContain(m);
    expect(drawn.size).toBe(4);
  });

  it("reads a session's own length, and 45 for one booked before the draw (null)", () => {
    expect(sessionRoundMinutes({ roundMinutes: 30 })).toBe(30);
    expect(sessionRoundMinutes({ roundMinutes: 40 })).toBe(40);
    expect(sessionRoundMinutes({ roundMinutes: null })).toBe(45);
  });
});
