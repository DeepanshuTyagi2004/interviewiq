import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "../../src/db/pg/schema.js";
import { GoogleAccountConflictError, GoogleEmailUnverifiedError, type GoogleIdentity } from "../../src/services/userService.js";
import { json } from "../support/fakeFetch.js";
import { createTestEnv, type TestEnv } from "../support/harness.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv({ FRONTEND_URL: "http://web.test" });
});
afterAll(() => env.close());

const PASSWORD = "correct-horse-battery";
const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
const google = (email: string, overrides: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  sub: `g-${randomUUID()}`,
  email,
  name: "Google Name",
  emailVerified: true,
  ...overrides,
});
const row = async (id: string) => (await env.db.select().from(users).where(eq(users.id, id)))[0]!;
const refresh = (raw: string) => env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${raw}`);
const login = (email: string, password: string) => env.http.post("/api/v1/auth/login").send({ email, password });

describe("Google sign-in claims the email", () => {
  it("links an UNVERIFIED password account: sets googleSub, verifies, drops the password, revokes its sessions", async () => {
    const email = uniqueEmail("prehijack");
    const { user, refreshToken } = await env.c.passwordAuth.register({ name: "Squatter", email, password: PASSWORD });
    expect(user.emailVerifiedAt).toBeNull();

    const identity = google(email);
    const linked = await env.c.users.upsertFromGoogle(identity);

    expect(linked.id).toBe(user.id);
    expect(linked.googleSub).toBe(identity.sub);
    expect(linked.passwordHash).toBeNull();
    expect(linked.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await refresh(refreshToken)).status).toBe(401); // the squatter's session is gone
    expect((await login(email, PASSWORD)).status).toBe(401); // and so is their password

    // the next Google sign-in is the same account
    expect((await env.c.users.upsertFromGoogle(identity)).id).toBe(user.id);
    // and a password sign-up on that email is now redirected to Google
    const again = await env.http.post("/api/v1/auth/register").send({ name: "X", email, password: PASSWORD });
    expect(again.body.code).toBe("use_google");
  });

  it("links a VERIFIED password account and keeps its password and sessions", async () => {
    const email = uniqueEmail("verified");
    const { user, refreshToken } = await env.c.passwordAuth.register({ name: "Owner", email, password: PASSWORD });
    await env.c.background.drain();
    await env.c.passwordAuth.verifyEmail(env.mailer.lastToken(email, "verify"));
    const verifiedAt = (await row(user.id)).emailVerifiedAt;
    expect(verifiedAt).toBeInstanceOf(Date);

    const identity = google(email.toUpperCase()); // case-insensitive match
    const linked = await env.c.users.upsertFromGoogle(identity);
    expect(linked.id).toBe(user.id);
    expect(linked.googleSub).toBe(identity.sub);
    expect(linked.passwordHash).not.toBeNull();
    expect(linked.emailVerifiedAt).toEqual(verifiedAt); // not re-stamped
    expect((await refresh(refreshToken)).status).toBe(200);
    expect((await login(email, PASSWORD)).status).toBe(200);
  });

  it("refuses to link when Google says email_verified=false (account untouched)", async () => {
    const email = uniqueEmail("unverifiedgoogle");
    const { user } = await env.c.passwordAuth.register({ name: "Owner", email, password: PASSWORD });
    await expect(env.c.users.upsertFromGoogle(google(email, { emailVerified: false }))).rejects.toBeInstanceOf(GoogleEmailUnverifiedError);
    const after = await row(user.id);
    expect(after.googleSub).toBeNull();
    expect(after.passwordHash).toBe(user.passwordHash);
  });

  it("fails when the email belongs to a DIFFERENT Google subject (today's behaviour)", async () => {
    const email = uniqueEmail("taken");
    await env.c.users.upsertFromGoogle(google(email));
    await expect(env.c.users.upsertFromGoogle(google(email))).rejects.toBeInstanceOf(GoogleAccountConflictError);
  });

  it("new Google accounts are verified iff Google says so; an existing Google user gets verified on a later verified sign-in", async () => {
    const verified = await env.c.users.upsertFromGoogle(google(uniqueEmail("gnew")));
    expect(verified.emailVerifiedAt).toBeInstanceOf(Date);
    expect(verified.passwordHash).toBeNull();

    const identity = google(uniqueEmail("gunverified"), { emailVerified: false });
    const unverified = await env.c.users.upsertFromGoogle(identity);
    expect(unverified.emailVerifiedAt).toBeNull();
    const later = await env.c.users.upsertFromGoogle({ ...identity, emailVerified: true });
    expect(later.id).toBe(unverified.id);
    expect(later.emailVerifiedAt).toBeInstanceOf(Date);
    // a later unverified claim never un-verifies
    expect((await env.c.users.upsertFromGoogle({ ...identity, emailVerified: false })).emailVerifiedAt).toEqual(later.emailVerifiedAt);
  });
});

describe("Google OAuth callback (HTTP)", () => {
  beforeEach(() => env.fetch.reset());

  /** Run both legs of the Google login with a stubbed token + userinfo response. */
  async function googleLogin(userinfo: Record<string, unknown>) {
    env.fetch.on("POST", "https://oauth2.googleapis.com/token", { access_token: "google-access-token" });
    env.fetch.on("GET", "https://openidconnect.googleapis.com/v1/userinfo", () => json(userinfo));
    const start = await env.http.get("/oauth2/authorization/google");
    const state = new URL(start.headers.location!).searchParams.get("state")!;
    const handshake = /oauth2_google=([^;]*)/.exec(String(start.headers["set-cookie"]))![1]!;
    return env.http.get(`/login/oauth2/code/google?code=abc&state=${state}`).set("Cookie", `oauth2_google=${handshake}`);
  }

  it("reads email_verified from userinfo and links the existing account", async () => {
    const email = uniqueEmail("cb");
    const { user } = await env.c.passwordAuth.register({ name: "Me", email, password: PASSWORD });
    const res = await googleLogin({ sub: "sub-cb-linked", email, name: "Me", email_verified: true });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("http://web.test/auth/callback");
    expect(String(res.headers["set-cookie"])).toMatch(/refresh_token=[^;]+/);
    expect((await row(user.id)).googleSub).toBe("sub-cb-linked");
  });

  it("an existing email with email_verified=false (or missing) fails the login instead of linking", async () => {
    for (const claim of [{ email_verified: false }, {}]) {
      const email = uniqueEmail("cbunverified");
      const { user } = await env.c.passwordAuth.register({ name: "Me", email, password: PASSWORD });
      env.fetch.reset();
      const res = await googleLogin({ sub: `sub-${randomUUID()}`, email, name: "Me", ...claim });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("http://web.test/login?error=oauth_failed");
      expect((await row(user.id)).googleSub).toBeNull();
    }
  });

  it("accepts the string form \"true\" of the claim", async () => {
    const email = uniqueEmail("cbstring");
    const res = await googleLogin({ sub: `sub-${randomUUID()}`, email, name: "S", email_verified: "true" });
    expect(res.headers.location).toBe("http://web.test/auth/callback");
    const created = (await env.db.select().from(users).where(eq(users.email, email)))[0]!;
    expect(created.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
