import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import type { Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UserRepository } from "../../src/repositories/pg.js";
import { ConsoleMailer } from "../../src/auth/mailer.js";
import { authTokens, users } from "../../src/db/pg/schema.js";
import { isPublicPath } from "../../src/http/security.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv({ ADMIN_EMAILS: "founder@example.com", FRONTEND_URL: "http://web.test" });
});
afterAll(() => env.close());

const uniqueEmail = (prefix = "user") => `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
const PASSWORD = "correct-horse-battery";

function setCookies(res: Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  return ([] as string[]).concat(raw ?? []).join(";");
}
const refreshCookie = (res: Response) => /refresh_token=([^;]*)/.exec(setCookies(res))?.[1] ?? "";

function register(body: Record<string, unknown>) {
  return env.http.post("/api/v1/auth/register").send(body);
}
function login(email: string, password: string) {
  return env.http.post("/api/v1/auth/login").send({ email, password });
}
function me(accessToken: string) {
  return env.http.get("/api/v1/users/me").set("Authorization", `Bearer ${accessToken}`);
}
const refresh = (cookie: string) => env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${cookie}`);

/** Emails are handed to the mailer in the background. */
const mailsSettled = () => env.c.background.drain();

async function registered(prefix = "user") {
  const email = uniqueEmail(prefix);
  const res = await register({ name: "Asha Rao", email, password: PASSWORD });
  expect(res.status).toBe(201);
  return { email, res, accessToken: res.body.accessToken as string, cookie: refreshCookie(res) };
}

describe("POST /api/v1/auth/register", () => {
  it("201 with the token body + the httpOnly refresh cookie; /users/me shows an unverified password account", async () => {
    const email = uniqueEmail("new");
    const res = await register({ name: "  Asha Rao  ", email: `  ${email.toUpperCase()} `, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ accessToken: expect.any(String), tokenType: "Bearer", expiresIn: 15 * 60 });
    const cookies = setCookies(res);
    expect(cookies).toMatch(/refresh_token=[^;]+/);
    expect(cookies).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookies).toMatch(/HttpOnly/);
    expect(cookies).toMatch(/SameSite=Lax/);

    const profile = await me(res.body.accessToken);
    expect(profile.status).toBe(200);
    expect(profile.body).toEqual({
      id: expect.any(String),
      email, // trimmed + lowercased
      name: "Asha Rao", // trimmed
      role: "USER",
      onboardingComplete: false,
      emailVerified: false,
      hasPassword: true,
    });

    // the refresh cookie is a real session
    expect((await refresh(refreshCookie(res))).status).toBe(200);

    // the password is stored only as a scrypt hash
    const row = (await env.db.select().from(users).where(eq(users.email, email)))[0]!;
    expect(row.passwordHash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(row.googleSub).toBeNull();
  });

  it("immediately sends a verification link to the frontend's /verify-email", async () => {
    const { email } = await registered("mail");
    await mailsSettled();
    const mails = env.mailer.to(email, "verify");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.name).toBe("Asha Rao");
    expect(mails[0]!.link).toMatch(/^http:\/\/web\.test\/verify-email\?token=[A-Za-z0-9_-]{43}$/);
  });

  it("bootstrap admin emails register as ADMIN", async () => {
    const res = await register({ name: "Founder", email: "Founder@Example.com", password: PASSWORD });
    expect(res.status).toBe(201);
    expect((await me(res.body.accessToken)).body.role).toBe("ADMIN");
  });

  it("409 email_taken for an existing password account (case-insensitive)", async () => {
    const { email } = await registered("dupe");
    for (const variant of [email, email.toUpperCase()]) {
      const res = await register({ name: "Someone Else", email: variant, password: "another-password" });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ code: "email_taken", message: expect.any(String) });
    }
  });

  it("409 use_google when the email belongs to a Google account (even with different case)", async () => {
    const email = uniqueEmail("googler");
    await env.c.users.upsertFromGoogle({ sub: `g-${randomUUID()}`, email: email.replace("googler", "Googler"), name: "G", emailVerified: true });
    const res = await register({ name: "Me", email, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "use_google", message: "This email signs in with Google. Continue with Google instead." });
  });

  it("losing a sign-up race to the unique constraint is still a 409, not a 500", async () => {
    const { email } = await registered("race");
    // Pretend the pre-check ran before the other sign-up committed.
    const spy = vi.spyOn(UserRepository.prototype, "findByEmailInsensitive").mockResolvedValueOnce(null);
    try {
      const res = await register({ name: "Late", email, password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("email_taken");
      expect(spy).toHaveBeenCalledTimes(2); // mocked pre-check + the real re-lookup after the violation
    } finally {
      spy.mockRestore();
    }
  });

  it("400 invalid_request with a human message for bad input", async () => {
    const cases: Array<[Record<string, unknown> | undefined, RegExp]> = [
      [undefined, /JSON object/],
      [{ name: "A", email: "not-an-email", password: PASSWORD }, /valid email/],
      [{ name: "A", password: PASSWORD }, /email/i],
      [{ name: "A", email: uniqueEmail(), password: "short" }, /at least 8/],
      [{ name: "A", email: uniqueEmail(), password: "x".repeat(129) }, /at most 128/],
      [{ name: "A", email: uniqueEmail(), password: "          " }, /only spaces/],
      [{ name: "   ", email: uniqueEmail(), password: PASSWORD }, /name/i],
      [{ name: "n".repeat(101), email: uniqueEmail(), password: PASSWORD }, /100/],
      [{ name: 42, email: uniqueEmail(), password: PASSWORD }, /name/i],
    ];
    for (const [body, message] of cases) {
      const req = env.http.post("/api/v1/auth/register");
      const res = body === undefined ? await req : await req.send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(res.body.message).toMatch(message);
    }
  });

  it("accepts exactly 8 and exactly 128 characters, and a 100-character name", async () => {
    expect((await register({ name: "n".repeat(100), email: uniqueEmail(), password: "12345678" })).status).toBe(201);
    expect((await register({ name: "B", email: uniqueEmail(), password: "p".repeat(128) })).status).toBe(201);
  });
});

describe("POST /api/v1/auth/login", () => {
  it("200 with the token body + refresh cookie; an unverified email may log in", async () => {
    const { email } = await registered("login");
    const res = await login(email, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: expect.any(String), tokenType: "Bearer", expiresIn: 15 * 60 });
    expect(refreshCookie(res)).not.toBe("");
    const profile = await me(res.body.accessToken);
    expect(profile.body).toMatchObject({ email, emailVerified: false, hasPassword: true });
    expect((await refresh(refreshCookie(res))).status).toBe(200);
  });

  it("is case-insensitive on the email", async () => {
    const { email } = await registered("CaseUser");
    expect((await login(email.toUpperCase(), PASSWORD)).status).toBe(200);
    expect((await login(`  ${email}  `, PASSWORD)).status).toBe(200);
  });

  it("401 invalid_credentials — identical for wrong password, unknown email and a Google-only account", async () => {
    const { email } = await registered("wrongpw");
    const google = await createUser(env); // Google-only (no password)
    const expected = { code: "invalid_credentials", message: "Incorrect email or password." };

    const wrong = await login(email, "not-the-password");
    const unknown = await login(uniqueEmail("nobody"), PASSWORD);
    const googleOnly = await login(google.email, PASSWORD);
    for (const res of [wrong, unknown, googleOnly]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(expected);
      expect(setCookies(res)).not.toMatch(/refresh_token=[^;]+/);
    }
  });

  it("400 invalid_request for a malformed body", async () => {
    expect((await env.http.post("/api/v1/auth/login").send({ email: "x" })).body.code).toBe("invalid_request");
    expect((await env.http.post("/api/v1/auth/login").send({ email: uniqueEmail(), password: "" })).body.code).toBe("invalid_request");
  });
});

describe("email verification", () => {
  it("verify-email: 204, marks the email verified; reusing the link is 400 invalid_token", async () => {
    const { email, accessToken } = await registered("verify");
    await mailsSettled();
    const token = env.mailer.lastToken(email, "verify");

    const ok = await env.http.post("/api/v1/auth/verify-email").send({ token });
    expect(ok.status).toBe(204);
    expect((await me(accessToken)).body.emailVerified).toBe(true);

    const again = await env.http.post("/api/v1/auth/verify-email").send({ token });
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ code: "invalid_token", message: expect.any(String) });
  });

  it("an expired link is 400 invalid_token", async () => {
    const { email, accessToken } = await registered("expired");
    await mailsSettled();
    const token = env.mailer.lastToken(email, "verify");
    const user = (await env.db.select().from(users).where(eq(users.email, email)))[0]!;
    await env.db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.userId, user.id));

    const res = await env.http.post("/api/v1/auth/verify-email").send({ token });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");
    expect((await me(accessToken)).body.emailVerified).toBe(false);
  });

  it("verify tokens live 24h and are stored only as hashes", async () => {
    const { email } = await registered("ttl");
    await mailsSettled();
    const token = env.mailer.lastToken(email, "verify");
    const user = (await env.db.select().from(users).where(eq(users.email, email)))[0]!;
    const rows = await env.db.select().from(authTokens).where(eq(authTokens.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.purpose).toBe("verify_email");
    expect(rows[0]!.tokenHash).not.toBe(token);
    const ttlMs = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(Math.abs(ttlMs - 24 * 60 * 60 * 1000)).toBeLessThan(5_000);
  });

  it("garbage, missing and wrong-purpose tokens are rejected", async () => {
    expect((await env.http.post("/api/v1/auth/verify-email").send({ token: "nope" })).body.code).toBe("invalid_token");
    expect((await env.http.post("/api/v1/auth/verify-email").send({})).body.code).toBe("invalid_request");

    const { email } = await registered("purpose");
    await env.http.post("/api/v1/auth/forgot-password").send({ email });
    await mailsSettled();
    const resetToken = env.mailer.lastToken(email, "reset");
    expect((await env.http.post("/api/v1/auth/verify-email").send({ token: resetToken })).body.code).toBe("invalid_token");
  });

  it("resend-verification needs a Bearer token", async () => {
    const res = await env.http.post("/api/v1/auth/resend-verification");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
  });

  it("resend-verification: 204 + a fresh link that supersedes the old one", async () => {
    const { email, accessToken } = await registered("resend");
    await mailsSettled();
    const first = env.mailer.lastToken(email, "verify");

    const res = await env.http.post("/api/v1/auth/resend-verification").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(204);
    await mailsSettled();
    expect(env.mailer.to(email, "verify")).toHaveLength(2);
    const second = env.mailer.lastToken(email, "verify");
    expect(second).not.toBe(first);

    expect((await env.http.post("/api/v1/auth/verify-email").send({ token: first })).body.code).toBe("invalid_token");
    expect((await env.http.post("/api/v1/auth/verify-email").send({ token: second })).status).toBe(204);
  });

  it("resend-verification is a 204 no-op once verified", async () => {
    const user = await env.c.users.upsertFromGoogle({ sub: `g-${randomUUID()}`, email: uniqueEmail("verified"), name: "V", emailVerified: true });
    const res = await env.http.post("/api/v1/auth/resend-verification").set("Authorization", await bearer(env, user));
    expect(res.status).toBe(204);
    await mailsSettled();
    expect(env.mailer.to(user.email)).toHaveLength(0);
  });
});

describe("password reset", () => {
  it("forgot-password is always 204; only a real account gets a /reset-password link", async () => {
    const nobody = uniqueEmail("ghost");
    const res = await env.http.post("/api/v1/auth/forgot-password").send({ email: nobody });
    expect(res.status).toBe(204);

    const { email } = await registered("forgot");
    const res2 = await env.http.post("/api/v1/auth/forgot-password").send({ email: email.toUpperCase() });
    expect(res2.status).toBe(204);
    await mailsSettled();
    expect(env.mailer.to(nobody)).toHaveLength(0);
    const mails = env.mailer.to(email, "reset");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.link).toMatch(/^http:\/\/web\.test\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
  });

  it("forgot-password validates the email (400 invalid_request)", async () => {
    const res = await env.http.post("/api/v1/auth/forgot-password").send({ email: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_request");
  });

  it("reset-password: new password works, old one doesn't, every refresh token is revoked, email becomes verified", async () => {
    const { email, cookie, accessToken } = await registered("reset");
    const otherSession = refreshCookie(await login(email, PASSWORD));
    await env.http.post("/api/v1/auth/forgot-password").send({ email });
    await mailsSettled();
    const token = env.mailer.lastToken(email, "reset");

    const res = await env.http.post("/api/v1/auth/reset-password").send({ token, password: "brand-new-password" });
    expect(res.status).toBe(204);

    expect((await login(email, PASSWORD)).status).toBe(401);
    expect((await login(email, "brand-new-password")).status).toBe(200);
    expect((await refresh(cookie)).status).toBe(401);
    expect((await refresh(otherSession)).status).toBe(401);
    expect((await me(accessToken)).body.emailVerified).toBe(true);

    const reuse = await env.http.post("/api/v1/auth/reset-password").send({ token, password: "yet-another-password" });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe("invalid_token");
  });

  it("reset tokens live 1h; a newer request supersedes the older link", async () => {
    const { email } = await registered("supersede");
    await env.http.post("/api/v1/auth/forgot-password").send({ email });
    await mailsSettled();
    const first = env.mailer.lastToken(email, "reset");
    await env.http.post("/api/v1/auth/forgot-password").send({ email });
    await mailsSettled();
    const second = env.mailer.lastToken(email, "reset");

    const user = (await env.db.select().from(users).where(eq(users.email, email)))[0]!;
    const rows = await env.db.select().from(authTokens).where(eq(authTokens.userId, user.id));
    const live = rows.filter((r) => r.purpose === "reset_password" && r.usedAt === null);
    expect(live).toHaveLength(1);
    expect(Math.abs(live[0]!.expiresAt.getTime() - live[0]!.createdAt.getTime() - 60 * 60 * 1000)).toBeLessThan(5_000);

    expect((await env.http.post("/api/v1/auth/reset-password").send({ token: first, password: "new-password-1" })).body.code).toBe("invalid_token");
    expect((await env.http.post("/api/v1/auth/reset-password").send({ token: second, password: "new-password-2" })).status).toBe(204);
  });

  it("a bad new password is 400 invalid_request and does NOT burn the link", async () => {
    const { email } = await registered("badpw");
    await env.http.post("/api/v1/auth/forgot-password").send({ email });
    await mailsSettled();
    const token = env.mailer.lastToken(email, "reset");

    const bad = await env.http.post("/api/v1/auth/reset-password").send({ token, password: "short" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid_request");
    expect((await env.http.post("/api/v1/auth/reset-password").send({ token, password: "long-enough-now" })).status).toBe(204);
  });

  it("an unknown or expired reset token is 400 invalid_token", async () => {
    expect((await env.http.post("/api/v1/auth/reset-password").send({ token: "garbage", password: "long-enough-now" })).body.code).toBe("invalid_token");

    const { email } = await registered("expreset");
    await env.http.post("/api/v1/auth/forgot-password").send({ email });
    await mailsSettled();
    const token = env.mailer.lastToken(email, "reset");
    const user = (await env.db.select().from(users).where(eq(users.email, email)))[0]!;
    await env.db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(authTokens.userId, user.id));
    const res = await env.http.post("/api/v1/auth/reset-password").send({ token, password: "long-enough-now" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");
  });

  it("a Google-only account can add a password through reset", async () => {
    const google = await createUser(env);
    await env.http.post("/api/v1/auth/forgot-password").send({ email: google.email });
    await mailsSettled();
    const token = env.mailer.lastToken(google.email, "reset");
    expect((await env.http.post("/api/v1/auth/reset-password").send({ token, password: "now-i-have-one" })).status).toBe(204);
    const res = await login(google.email, "now-i-have-one");
    expect(res.status).toBe(200);
    expect((await me(res.body.accessToken)).body).toMatchObject({ hasPassword: true, emailVerified: true });
  });

  it("a mailer failure never fails the request", async () => {
    const { email } = await registered("mailfail");
    env.mailer.failNext = 1;
    expect((await env.http.post("/api/v1/auth/forgot-password").send({ email })).status).toBe(204);
    await mailsSettled();
    expect(env.mailer.to(email, "reset")).toHaveLength(0);
  });
});

describe("security: public paths", () => {
  it("the email/password endpoints are public (exact matches); resend-verification is not", () => {
    for (const p of ["register", "login", "verify-email", "forgot-password", "reset-password", "refresh", "logout"]) {
      expect(isPublicPath(`/api/v1/auth/${p}`), p).toBe(true);
    }
    expect(isPublicPath("/api/v1/auth/resend-verification")).toBe(false);
    expect(isPublicPath("/api/v1/auth/register/extra")).toBe(false);
    expect(isPublicPath("/api/v1/auth/REGISTER")).toBe(false);
    expect(isPublicPath("/api/v1/auth")).toBe(false);
  });

  it("an anonymous POST to a public auth endpoint reaches the router (not 401)", async () => {
    const res = await env.http.post("/api/v1/auth/login").send({});
    expect(res.status).toBe(400);
  });
});

describe("ConsoleMailer (dev)", () => {
  it("logs the link at info level — the one sanctioned place a token reaches the logs", async () => {
    const lines: Array<{ level: number; msg: string }> = [];
    const log = pino({ level: "info" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const mailer = new ConsoleMailer(log);
    await mailer.sendVerificationEmail({ to: "a@example.com", name: "A", link: "http://web.test/verify-email?token=abc" });
    await mailer.sendPasswordResetEmail({ to: "a@example.com", name: "A", link: "http://web.test/reset-password?token=def" });
    expect(lines.map((l) => [l.level, l.msg])).toEqual([
      [30, "[dev-mail] Verify your email for a@example.com: http://web.test/verify-email?token=abc"],
      [30, "[dev-mail] Reset your password for a@example.com: http://web.test/reset-password?token=def"],
    ]);
  });
});

describe("rate limiting (tiny limits)", () => {
  let limited: TestEnv;
  beforeAll(async () => {
    limited = await createTestEnv(
      {},
      {
        authRateLimits: {
          register: { limit: 2, windowMs: 60_000 },
          loginPerIpEmail: { limit: 2, windowMs: 60_000 },
          loginPerIp: { limit: 4, windowMs: 60_000 },
          forgotPassword: { limit: 1, windowMs: 60_000 },
          resendVerification: { limit: 1, windowMs: 60_000 },
        },
      },
    );
  });
  afterAll(() => limited.close());

  const expect429 = (res: Response) => {
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ code: "rate_limited", message: expect.any(String) });
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(res.headers["retry-after"])).toBeLessThanOrEqual(60);
  };

  it("register: per IP; the web origin can read Retry-After (CORS-exposed)", async () => {
    const reg = () =>
      limited.http
        .post("/api/v1/auth/register")
        .set("Origin", "http://localhost:3000")
        .send({ name: "R", email: uniqueEmail("rl"), password: PASSWORD });
    expect((await reg()).status).toBe(201);
    expect((await reg()).status).toBe(201);
    const blocked = await reg();
    expect429(blocked);
    expect(blocked.headers["access-control-expose-headers"]).toBe("Retry-After");
  });

  it("login: per IP + email, then per IP; the limit applies even to the right password", async () => {
    const a = uniqueEmail("rla");
    await limited.c.passwordAuth.register({ name: "A", email: a, password: PASSWORD });
    const go = (email: string, password: string) => limited.http.post("/api/v1/auth/login").send({ email, password });

    expect((await go(a, "wrong-password")).status).toBe(401);
    expect((await go(a.toUpperCase(), "wrong-password")).status).toBe(401); // same normalized key
    expect429(await go(a, PASSWORD));

    // a different email from the same IP still has budget until the per-IP cap (4)
    const b = uniqueEmail("rlb");
    expect((await go(b, "whatever-pass")).status).toBe(401);
    expect429(await go(b, "whatever-pass"));
  });

  it("forgot-password: per IP + email", async () => {
    const email = uniqueEmail("rlf");
    expect((await limited.http.post("/api/v1/auth/forgot-password").send({ email })).status).toBe(204);
    expect429(await limited.http.post("/api/v1/auth/forgot-password").send({ email }));
    expect((await limited.http.post("/api/v1/auth/forgot-password").send({ email: uniqueEmail("rlf2") })).status).toBe(204);
  });

  it("resend-verification: per user", async () => {
    const u1 = await createUser(limited);
    const u2 = await createUser(limited);
    const resend = async (u: typeof u1) => limited.http.post("/api/v1/auth/resend-verification").set("Authorization", await bearer(limited, u));
    expect((await resend(u1)).status).toBe(204);
    expect429(await resend(u1));
    expect((await resend(u2)).status).toBe(204);
  });
});
