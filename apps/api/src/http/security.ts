import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { JwtService } from "../auth/jwt.js";
import { secureEquals } from "../lib/crypto.js";
import { sendError } from "./support.js";

/**
 * Path-based access rules — a direct port of the Spring SecurityConfig, evaluated in order:
 *
 *   public   /api/v1/main/healthcheck, /oauth2/**, /login/oauth2/**, /api/v1/auth/refresh,
 *            /api/v1/auth/logout, /api/v1/connections/github/callback,
 *            /api/v1/auth/{register,login,verify-email,forgot-password,reset-password} (exact),
 *            /api/v1/internal/** (guarded by the shared internal API key instead)
 *            (/api/v1/auth/resend-verification is NOT public — it needs the Bearer token)
 *   ADMIN    /api/v1/intelligence/**, /api/v1/admin/**
 *   else     any valid Bearer access token
 *
 * Like Spring, unknown paths require authentication too (401 before 404).
 */
const PUBLIC_EXACT = new Set([
  "/api/v1/main/healthcheck",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/verify-email",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/reset-password",
  "/api/v1/connections/github/callback",
]);
const PUBLIC_PREFIXES = ["/oauth2", "/login/oauth2", "/api/v1/internal"];
const ADMIN_PREFIXES = ["/api/v1/intelligence", "/api/v1/admin"];

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

export function isPublicPath(p: string): boolean {
  return PUBLIC_EXACT.has(p) || PUBLIC_PREFIXES.some((b) => under(p, b));
}

/** Case-insensitive on purpose (defense in depth — routing is case-sensitive too). */
export function isAdminPath(p: string): boolean {
  const lower = p.toLowerCase();
  return ADMIN_PREFIXES.some((b) => under(lower, b));
}

export function security(jwt: JwtService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS" || isPublicPath(req.path)) {
      next();
      return;
    }
    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendError(res, 401, "unauthorized", "authentication required");
      return;
    }
    try {
      req.auth = await jwt.verify(match[1]!.trim());
    } catch {
      res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
      sendError(res, 401, "invalid_token", "the access token is invalid or expired");
      return;
    }
    if (isAdminPath(req.path) && req.auth.role !== "ADMIN") {
      sendError(res, 403, "forbidden", "admin role required");
      return;
    }
    next();
  };
}

/**
 * Service-to-service guard for /api/v1/internal/** (AI service ↔ API). Constant-time comparison so
 * the check doesn't leak the key via timing.
 */
export function requireInternalKey(internalApiKey: string): RequestHandler {
  return (req, res, next) => {
    const provided = req.get("x-internal-api-key");
    if (!provided || !secureEquals(provided, internalApiKey)) {
      sendError(res, 401, "invalid_internal_key", "missing or invalid internal api key");
      return;
    }
    next();
  };
}
