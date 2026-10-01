import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_RATE_LIMITS, FixedWindowRateLimiter } from "../../src/http/rateLimit.js";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("FixedWindowRateLimiter", () => {
  it("allows `limit` hits per window per key, then reports how long to wait", () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000 }, c.now);
    expect(rl.hit("a").allowed).toBe(true);
    expect(rl.hit("a").allowed).toBe(true);
    const blocked = rl.hit("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    // other keys are independent
    expect(rl.hit("b").allowed).toBe(true);

    c.advance(45_500);
    expect(rl.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 15 });
    c.advance(14_500);
    expect(rl.hit("a").allowed).toBe(true); // new window
  });

  it("evicts expired windows so the map cannot grow without bound", () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter({ limit: 5, windowMs: 1_000 }, c.now);
    for (let i = 0; i < 500; i++) rl.hit(`ip-${i}`);
    expect(rl.size).toBe(500);
    c.advance(1_001);
    rl.hit("fresh");
    expect(rl.size).toBe(1);
  });

  it("caps the number of tracked keys even inside one window (oldest dropped first)", () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 }, c.now);
    for (let i = 0; i < 25; i++) rl.hit(`k-${i}`);
    expect(rl.size).toBeLessThanOrEqual(10);
    expect(rl.hit("k-24").allowed).toBe(false); // the newest key is still tracked
  });

  it("ships the product-owner defaults", () => {
    expect(DEFAULT_AUTH_RATE_LIMITS).toEqual({
      loginPerIpEmail: { limit: 10, windowMs: 15 * 60_000 },
      loginPerIp: { limit: 50, windowMs: 15 * 60_000 },
      register: { limit: 10, windowMs: 60 * 60_000 },
      forgotPassword: { limit: 5, windowMs: 60 * 60_000 },
      resendVerification: { limit: 5, windowMs: 60 * 60_000 },
    });
  });
});
