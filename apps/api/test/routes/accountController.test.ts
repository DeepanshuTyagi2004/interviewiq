import { randomUUID } from "node:crypto";
import type { Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../../src/domain/preferences.js";
import { bearer, createTestEnv, createUser, type TestEnv } from "../support/harness.js";

/** Settings endpoints under /api/v1/users/me (preferences, name, sessions). */

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

const PREFS = "/api/v1/users/me/preferences";

async function auth() {
  const user = await createUser(env);
  return { user, token: await bearer(env, user) };
}

describe("GET/PATCH /users/me/preferences", () => {
  it("401 without a token", async () => {
    expect((await env.http.get(PREFS)).status).toBe(401);
    expect((await env.http.patch(PREFS).send({})).status).toBe(401);
  });

  it("returns the defaults, with updatedAt null, before anything is saved", async () => {
    const { token } = await auth();
    const res = await env.http.get(PREFS).set("Authorization", token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_PREFERENCES, updatedAt: null });
  });

  it("PATCH changes only the sent leaves and persists them", async () => {
    const { token } = await auth();
    const first = await env.http.patch(PREFS).set("Authorization", token).send({ interview: { pace: "faster" } });
    expect(first.status).toBe(200);
    expect(first.body.interview).toEqual({ ...DEFAULT_PREFERENCES.interview, pace: "faster" });
    expect(typeof first.body.updatedAt).toBe("string");

    const second = await env.http
      .patch(PREFS)
      .set("Authorization", token)
      .send({ interview: { captions: false }, notifications: { email: { productUpdates: true } }, locale: { timezone: "Asia/Kolkata" } });
    expect(second.status).toBe(200);

    const read = await env.http.get(PREFS).set("Authorization", token);
    expect(read.body.interview).toEqual({ ...DEFAULT_PREFERENCES.interview, pace: "faster", captions: false });
    expect(read.body.notifications.email).toEqual({ ...DEFAULT_PREFERENCES.notifications.email, productUpdates: true });
    expect(read.body.notifications.inApp).toEqual(DEFAULT_PREFERENCES.notifications.inApp);
    expect(read.body.locale.timezone).toBe("Asia/Kolkata");
  });

  it("can set the timezone back to automatic (null)", async () => {
    const { token } = await auth();
    await env.http.patch(PREFS).set("Authorization", token).send({ locale: { timezone: "Europe/London" } });
    const res = await env.http.patch(PREFS).set("Authorization", token).send({ locale: { timezone: null } });
    expect(res.status).toBe(200);
    expect(res.body.locale.timezone).toBeNull();
  });

  it("keeps each user's preferences separate", async () => {
    const a = await auth();
    const b = await auth();
    await env.http.patch(PREFS).set("Authorization", a.token).send({ privacy: { shareWithCollege: true } });
    expect((await env.http.get(PREFS).set("Authorization", b.token)).body.privacy.shareWithCollege).toBe(false);
  });

  it.each([
    { interview: { pace: "warp" } },
    { privacy: { leaderboardVisibility: "public" } },
    { locale: { timezone: "Mars/Olympus" } },
    { theme: "dark" },
    { notifications: { sms: { debriefReady: true } } },
  ])("400 invalid_preferences for %j", async (body) => {
    const { token } = await auth();
    const res = await env.http.patch(PREFS).set("Authorization", token).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_preferences");
  });

  it("400 when the PATCH body is missing", async () => {
    const { token } = await auth();
    expect((await env.http.patch(PREFS).set("Authorization", token)).status).toBe(400);
  });

  it("does not shadow the existing /users/me routes", async () => {
    const { token } = await auth();
    expect((await env.http.get("/api/v1/users/me").set("Authorization", token)).status).toBe(200);
    expect((await env.http.get("/api/v1/users/me/candidate-profile").set("Authorization", token)).status).toBe(204);
  });
});

const PW = "correct-horse-battery";
const uniqueEmail = (p: string) => `${p}-${randomUUID().slice(0, 8)}@example.com`;
function setCookies(res: Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  return ([] as string[]).concat(raw ?? []).join(";");
}
const refreshCookie = (res: Response) => /refresh_token=([^;]*)/.exec(setCookies(res))?.[1] ?? "";
const refresh = (cookie: string) => env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${cookie}`);

describe("PATCH /users/me (display name)", () => {
  it("renames, trimmed, and /users/me shows it", async () => {
    const { token } = await auth();
    const res = await env.http.patch("/api/v1/users/me").set("Authorization", token).send({ name: "  Asha R.  " });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Asha R.");
    expect((await env.http.get("/api/v1/users/me").set("Authorization", token)).body.name).toBe("Asha R.");
  });

  it.each([{ name: "" }, { name: "   " }, { name: "x".repeat(81) }, { name: 42 }, {}])("400 invalid_name for %j", async (body) => {
    const { token } = await auth();
    const res = await env.http.patch("/api/v1/users/me").set("Authorization", token).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_name");
  });

  it("a later Google sign-in keeps the renamed display name", async () => {
    const email = uniqueEmail("g");
    const sub = `g-${randomUUID()}`;
    const google = await env.c.users.upsertFromGoogle({ sub, email, name: "Google Name", emailVerified: true });
    await env.http.patch("/api/v1/users/me").set("Authorization", await bearer(env, google)).send({ name: "Chosen Name" });
    const again = await env.c.users.upsertFromGoogle({ sub, email, name: "Google Name", emailVerified: true });
    expect(again.name).toBe("Chosen Name");
  });
});

describe("linking Google to a password account", () => {
  it("a verified account keeps its chosen name", async () => {
    const email = uniqueEmail("lv");
    const { user } = await env.c.passwordAuth.register({ name: "P", email, password: PW });
    await env.c.repos.users.markEmailVerified(user.id, new Date());
    await env.http.patch("/api/v1/users/me").set("Authorization", await bearer(env, user)).send({ name: "Chosen Name" });
    const linked = await env.c.users.upsertFromGoogle({ sub: `g-${randomUUID()}`, email, name: "Google Name", emailVerified: true });
    expect(linked.id).toBe(user.id);
    expect(linked.name).toBe("Chosen Name");
  });

  it("a never-verified account takes Google's name", async () => {
    const email = uniqueEmail("lu");
    const { user } = await env.c.passwordAuth.register({ name: "Squatter", email, password: PW });
    const linked = await env.c.users.upsertFromGoogle({ sub: `g-${randomUUID()}`, email, name: "Google Name", emailVerified: true });
    expect(linked.id).toBe(user.id);
    expect(linked.name).toBe("Google Name");
  });
});

describe("hasGoogle on /users/me", () => {
  it("is true for Google accounts and false for password-only ones", async () => {
    const g = await createUser(env);
    expect((await env.http.get("/api/v1/users/me").set("Authorization", await bearer(env, g))).body.hasGoogle).toBe(true);
    const { user } = await env.c.passwordAuth.register({ name: "P", email: uniqueEmail("p"), password: PW });
    expect((await env.http.get("/api/v1/users/me").set("Authorization", await bearer(env, user))).body.hasGoogle).toBe(false);
  });
});

describe("POST /users/me/sessions/revoke", () => {
  it("revokes every refresh token of the user and clears the cookie", async () => {
    const email = uniqueEmail("s");
    const first = await env.c.passwordAuth.register({ name: "S", email, password: PW });
    const login = await env.http.post("/api/v1/auth/login").send({ email, password: PW });
    const secondCookie = refreshCookie(login);
    expect(secondCookie).not.toBe("");

    const res = await env.http.post("/api/v1/users/me/sessions/revoke").set("Authorization", await bearer(env, first.user));
    expect(res.status).toBe(204);
    expect(setCookies(res)).toMatch(/refresh_token=;/);
    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await refresh(secondCookie)).status).toBe(401);
  });

  it("leaves other users' sessions alone", async () => {
    const mine = await env.c.passwordAuth.register({ name: "A", email: uniqueEmail("a"), password: PW });
    const theirs = await env.c.passwordAuth.register({ name: "B", email: uniqueEmail("b"), password: PW });
    await env.http.post("/api/v1/users/me/sessions/revoke").set("Authorization", await bearer(env, mine.user));
    expect((await refresh(theirs.refreshToken)).status).toBe(200);
  });
});
