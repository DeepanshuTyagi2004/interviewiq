import type { CookieOptions, NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { decodePending, encodePending } from "../auth/googleOAuth.js";
import { EmailTakenError, InvalidAuthTokenError, InvalidCredentialsError, type IssuedSession, UseGoogleError } from "../auth/passwordAuth.js";
import { InvalidRefreshTokenError } from "../auth/refreshTokens.js";
import type { Config } from "../config.js";
import type { Container } from "../container.js";
import { clientIp, enforceRateLimit, rateLimitErrors } from "../http/rateLimit.js";
import { router, routerErrors, sendError, userId } from "../http/support.js";
import { BadRequestError, safeErrorMessage } from "../lib/errors.js";

const REFRESH_COOKIE = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

/** Expire the refresh cookie (same attributes it was set with). Shared with the account routes. */
export function clearRefreshTokenCookie(res: Response, config: Pick<Config, "cookieSecure" | "cookieSameSite">): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: REFRESH_COOKIE_PATH });
}
const OAUTH_COOKIE = "oauth2_google";
const OAUTH_COOKIE_PATH = "/login/oauth2";

// --- request bodies ------------------------------------------------------------------------------

const email = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .max(254, { error: "Enter a valid email address." })
  .pipe(z.email({ error: "Enter a valid email address." }));

/** New passwords (register, reset): 8–128 characters, not just whitespace. */
const newPassword = z
  .string({ error: "Enter a password." })
  .min(8, { error: "Password must be at least 8 characters." })
  .max(128, { error: "Password must be at most 128 characters." })
  .refine((p) => p.trim() !== "", { error: "Password can't be only spaces." });

/**
 * Login only bounds the length: a password that breaks today's rules just fails as
 * invalid_credentials, so tightening the rules later never locks out existing accounts.
 */
const loginPassword = z
  .string({ error: "Enter your password." })
  .min(1, { error: "Enter your password." })
  .max(128, { error: "Incorrect email or password." });

const token = z.string({ error: "The link is missing its token." }).min(1, { error: "The link is missing its token." }).max(512);

const body = <T extends z.ZodRawShape>(shape: T) => z.object(shape, { error: "The request body must be a JSON object." });

const RegisterBody = body({
  name: z
    .string({ error: "Enter your name." })
    .trim()
    .min(1, { error: "Enter your name." })
    .max(100, { error: "Name must be at most 100 characters." }),
  email,
  password: newPassword,
});
const LoginBody = body({ email, password: loginPassword });
const VerifyEmailBody = body({ token });
const ForgotPasswordBody = body({ email });
const ResetPasswordBody = body({ token, password: newPassword });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequestError(r.error.issues[0]?.message ?? "Invalid request.", "invalid_request");
  return r.data;
}

/**
 * Backend-owned auth: Google login (same URLs as Spring's oauth2Login, so the frontend and the
 * Google console need no changes), email/password accounts, refresh-token rotation, and logout.
 * The refresh token lives in an httpOnly cookie scoped to /api/v1/auth; the short-lived access
 * token is returned in JSON.
 */
export function authRouter(c: Container): Router {
  const r = router();
  const { config, log, rateLimiters: limits } = c;

  const cookieBase = (): CookieOptions => ({ httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite });
  const setRefreshCookie = (res: Response, token: string) =>
    res.cookie(REFRESH_COOKIE, token, { ...cookieBase(), path: REFRESH_COOKIE_PATH, maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000 });
  const clearRefreshCookie = (res: Response) => clearRefreshTokenCookie(res, config);
  const tokenResponse = (res: Response, accessToken: string) => res.json({ accessToken, tokenType: "Bearer", expiresIn: c.jwt.accessTokenSeconds });
  const sendSession = (res: Response, status: number, session: IssuedSession) => {
    setRefreshCookie(res, session.refreshToken);
    tokenResponse(res.status(status), session.accessToken);
  };

  // Leg 1: start Google login.
  r.get("/oauth2/authorization/google", (_req, res) => {
    const { url, pending } = c.googleOAuth.begin();
    // The handshake cookie must survive the top-level redirect back from Google, so it is Lax.
    res.cookie(OAUTH_COOKIE, encodePending(pending), {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      path: OAUTH_COOKIE_PATH,
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(302, url);
  });

  // Leg 2: Google redirects back here.
  r.get("/login/oauth2/code/google", async (req, res) => {
    const pending = decodePending(req.cookies?.[OAUTH_COOKIE]);
    res.clearCookie(OAUTH_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: OAUTH_COOKIE_PATH });
    try {
      const identity = await c.googleOAuth.complete(
        { code: str(req.query.code), state: str(req.query.state), error: str(req.query.error) },
        pending,
      );
      const user = await c.users.upsertFromGoogle(identity);
      setRefreshCookie(res, await c.refreshTokens.createRefreshToken(user.id));
      res.redirect(302, `${config.frontendUrl}/auth/callback`);
    } catch (err) {
      // safeErrorMessage: a failed upsert's Drizzle error would otherwise log the email/name params.
      log.warn(`Google login failed: ${safeErrorMessage(err)}`);
      res.redirect(302, `${config.frontendUrl}/login?error=oauth_failed`);
    }
  });

  r.post("/api/v1/auth/refresh", async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw === undefined) {
      // No cookie at all: a visitor who never signed in. That is a normal answer, not an error, so every
      // public page's silent refresh doesn't log a failed request. A cookie that is present but bad is a 401.
      res.status(204).end();
      return;
    }
    if (typeof raw !== "string" || raw === "") {
      clearRefreshCookie(res);
      res.status(401).end();
      return;
    }
    try {
      const { accessToken, newRefreshToken } = await c.refreshTokens.refresh(raw);
      setRefreshCookie(res, newRefreshToken);
      tokenResponse(res, accessToken);
    } catch (err) {
      if (!(err instanceof InvalidRefreshTokenError)) throw err;
      clearRefreshCookie(res);
      res.status(401).end();
    }
  });

  r.post("/api/v1/auth/logout", async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw === "string" && raw !== "") await c.refreshTokens.revoke(raw);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  // --- email / password -------------------------------------------------------------------------

  r.post("/api/v1/auth/register", async (req, res) => {
    enforceRateLimit(limits.register, clientIp(req));
    const input = parse(RegisterBody, req.body);
    sendSession(res, 201, await c.passwordAuth.register(input));
  });

  r.post("/api/v1/auth/login", async (req, res) => {
    const input = parse(LoginBody, req.body);
    const ip = clientIp(req);
    enforceRateLimit(limits.loginPerIp, ip);
    enforceRateLimit(limits.loginPerIpEmail, `${ip}|${input.email}`);
    sendSession(res, 200, await c.passwordAuth.login(input));
  });

  r.post("/api/v1/auth/verify-email", async (req, res) => {
    const input = parse(VerifyEmailBody, req.body);
    await c.passwordAuth.verifyEmail(input.token);
    res.status(204).end();
  });

  // Authenticated (not in the public paths): the security middleware has already checked the JWT.
  r.post("/api/v1/auth/resend-verification", async (req, res) => {
    const uid = userId(req);
    enforceRateLimit(limits.resendVerification, uid);
    await c.passwordAuth.resendVerification(uid);
    res.status(204).end();
  });

  r.post("/api/v1/auth/forgot-password", async (req, res) => {
    const input = parse(ForgotPasswordBody, req.body);
    enforceRateLimit(limits.forgotPassword, `${clientIp(req)}|${input.email}`);
    c.passwordAuth.forgotPassword(input.email);
    res.status(204).end();
  });

  r.post("/api/v1/auth/reset-password", async (req, res) => {
    const input = parse(ResetPasswordBody, req.body);
    await c.passwordAuth.resetPassword(input.token, input.password);
    res.status(204).end();
  });

  r.use(rateLimitErrors);
  r.use(
    routerErrors((err) => {
      if (err instanceof EmailTakenError) return { status: 409, code: "email_taken", message: "An account with this email already exists. Log in instead." };
      if (err instanceof UseGoogleError) return { status: 409, code: "use_google", message: "This email signs in with Google. Continue with Google instead." };
      if (err instanceof InvalidCredentialsError) return { status: 401, code: "invalid_credentials", message: "Incorrect email or password." };
      if (err instanceof InvalidAuthTokenError) return { status: 400, code: "invalid_token", message: "This link is invalid or has expired. Request a new one." };
      return undefined;
    }),
  );
  // Anything else from the auth routes: log WITHOUT the raw error (Drizzle errors embed the query
  // params — emails, password hashes), then the usual 500 envelope.
  r.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    log.error({ path: req.path }, `auth request failed: ${safeErrorMessage(err)}`);
    sendError(res, 500, "internal_error", "something went wrong");
  });

  return r;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
