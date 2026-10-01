import type { ErrorRequestHandler, Request } from "express";
import { ApiError } from "../lib/errors.js";
import { sendError } from "./support.js";

/**
 * A small in-memory fixed-window rate limiter (no dependency, no Redis — pre-revenue discipline).
 *
 * Per-process: with N API replicas the effective limit is N× the configured one, which is fine for
 * brute-force/abuse damping. Swap for a shared store if that ever stops being good enough.
 */
export interface RateLimit {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller's window resets (0 when allowed). Sent as `Retry-After`. */
  retryAfterSeconds: number;
}

const MINUTE = 60_000;

/** The auth endpoints' limits. Keys are route + client IP (+ normalized email where relevant). */
export interface AuthRateLimits {
  loginPerIpEmail: RateLimit;
  loginPerIp: RateLimit;
  register: RateLimit;
  forgotPassword: RateLimit;
  resendVerification: RateLimit;
}

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  loginPerIpEmail: { limit: 10, windowMs: 15 * MINUTE },
  loginPerIp: { limit: 50, windowMs: 15 * MINUTE },
  register: { limit: 10, windowMs: 60 * MINUTE },
  forgotPassword: { limit: 5, windowMs: 60 * MINUTE },
  resendVerification: { limit: 5, windowMs: 60 * MINUTE },
};

export class FixedWindowRateLimiter {
  /**
   * key → current window. Map iteration is insertion order and a key is re-inserted whenever it
   * starts a new window, so entries are ordered by `resetAt`: expired ones are always at the front.
   */
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;

  constructor(
    private readonly opts: RateLimit & { maxKeys?: number },
    private readonly now: () => number = Date.now,
  ) {
    this.maxKeys = opts.maxKeys ?? 50_000;
  }

  /** Count one attempt for `key`. */
  hit(key: string): RateLimitResult {
    const t = this.now();
    this.evictExpired(t);
    let w = this.windows.get(key);
    if (w && w.resetAt <= t) {
      // Only reachable if the wall clock stepped backwards and broke the ordering above.
      this.windows.delete(key);
      w = undefined;
    }
    if (!w) {
      w = { count: 0, resetAt: t + this.opts.windowMs };
      this.windows.set(key, w);
      // Hard cap even within one window (e.g. a spray of distinct emails): drop the oldest.
      for (const oldest of this.windows.keys()) {
        if (this.windows.size <= this.maxKeys) break;
        this.windows.delete(oldest);
      }
    }
    w.count++;
    if (w.count <= this.opts.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
  }

  get size(): number {
    return this.windows.size;
  }

  private evictExpired(t: number): void {
    for (const [key, w] of this.windows) {
      if (w.resetAt > t) break; // ordered by resetAt — everything after this is still live
      this.windows.delete(key);
    }
  }
}

export function createAuthRateLimiters(limits: AuthRateLimits, now?: () => number) {
  return {
    loginPerIpEmail: new FixedWindowRateLimiter(limits.loginPerIpEmail, now),
    loginPerIp: new FixedWindowRateLimiter(limits.loginPerIp, now),
    register: new FixedWindowRateLimiter(limits.register, now),
    forgotPassword: new FixedWindowRateLimiter(limits.forgotPassword, now),
    resendVerification: new FixedWindowRateLimiter(limits.resendVerification, now),
  };
}

export type AuthRateLimiters = ReturnType<typeof createAuthRateLimiters>;

export class RateLimitedError extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
    this.name = "RateLimitedError";
  }
}

/** Count an attempt; throws RateLimitedError (→ 429 + Retry-After) when over the limit. */
export function enforceRateLimit(limiter: FixedWindowRateLimiter, key: string): void {
  const r = limiter.hit(key);
  if (!r.allowed) throw new RateLimitedError(r.retryAfterSeconds);
}

/**
 * The client address as Express resolves it — honours whatever `app.set("trust proxy", ...)` the
 * app has configured (this module never changes proxy settings).
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Router error handler: renders RateLimitedError as 429 `rate_limited` with a Retry-After header. */
export const rateLimitErrors: ErrorRequestHandler = (err, _req, res, next) => {
  if (!(err instanceof RateLimitedError)) {
    next(err);
    return;
  }
  res.setHeader("Retry-After", String(err.retryAfterSeconds));
  sendError(res, 429, err.code, err.message);
};
