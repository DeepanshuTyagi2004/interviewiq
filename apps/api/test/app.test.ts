import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createTestEnv, createUser, TEST_INTERNAL_KEY, type TestEnv } from "./support/harness.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv({ ADMIN_EMAILS: "boss@example.com" });
});
afterAll(() => env.close());

describe("security rules (ported from SecurityConfig)", () => {
  it("healthcheck is public and returns plain text", async () => {
    const res = await env.http.get("/api/v1/main/healthcheck");
    expect(res.status).toBe(200);
    expect(res.text).toBe("Server Up");
  });

  it("everything else needs a bearer token — including unknown paths (401 before 404)", async () => {
    expect((await env.http.get("/api/v1/users/me")).status).toBe(401);
    expect((await env.http.get("/api/v1/nope")).status).toBe(401);
    const res = await env.http.get("/api/v1/users/me").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_token");
  });

  it("authenticated unknown path is 404 with the ApiError envelope", async () => {
    const user = await createUser(env);
    const res = await env.http.get("/api/v1/nope").set("Authorization", await bearer(env, user));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "not_found", message: "no such endpoint" });
  });

  it("admin surfaces require the ADMIN role claim", async () => {
    const user = await createUser(env);
    const admin = await createUser(env, { role: "ADMIN" });
    expect((await env.http.get("/api/v1/admin/users").set("Authorization", await bearer(env, user))).status).toBe(403);
    expect((await env.http.get("/api/v1/intelligence/briefs").set("Authorization", await bearer(env, user))).status).toBe(403);
    const ok = await env.http.get("/api/v1/admin/users").set("Authorization", await bearer(env, admin));
    expect(ok.status).toBe(200);
    expect(ok.body.some((u: { id: string; role: string }) => u.id === admin.id && u.role === "ADMIN")).toBe(true);
  });

  it("internal endpoints skip JWT but require the internal key", async () => {
    expect((await env.http.get("/api/v1/internal/scrape-targets")).status).toBe(401);
    const bad = await env.http.get("/api/v1/internal/scrape-targets").set("X-Internal-Api-Key", "wrong");
    expect(bad.body.code).toBe("invalid_internal_key");
    const ok = await env.http.get("/api/v1/internal/scrape-targets").set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([]);
  });

  it("CORS allows the frontend origin with credentials", async () => {
    const res = await env.http.options("/api/v1/users/me").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("users", () => {
  it("GET /users/me returns the current user", async () => {
    const user = await createUser(env, { name: "Asha" });
    const res = await env.http.get("/api/v1/users/me").set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      email: user.email,
      name: "Asha",
      role: "USER",
      onboardingComplete: false,
      emailVerified: false,
      hasPassword: false,
      hasGoogle: true,
    });
  });

  it("bootstrap admin emails are promoted on Google login, never demoted", async () => {
    const u = await env.c.users.upsertFromGoogle({ sub: "g-boss", email: "Boss@Example.com", name: "Boss", emailVerified: true });
    expect(u.role).toBe("ADMIN");
    await env.c.users.updateRole(u.id, "USER"); // explicit admin action
    const again = await env.c.users.upsertFromGoogle({ sub: "g-other", email: "someone@example.com", name: "X", emailVerified: true });
    expect(again.role).toBe("USER");
  });

  it("PATCH /admin/users/:id/role validates the role and the id", async () => {
    const admin = await createUser(env, { role: "ADMIN" });
    const target = await createUser(env);
    const auth = await bearer(env, admin);
    expect((await env.http.patch(`/api/v1/admin/users/${target.id}/role`).set("Authorization", auth).send({ role: "king" })).body.code).toBe("invalid_role");
    expect((await env.http.patch(`/api/v1/admin/users/not-a-uuid/role`).set("Authorization", auth).send({ role: "ADMIN" })).status).toBe(400);
    const missing = await env.http.patch(`/api/v1/admin/users/00000000-0000-4000-8000-000000000000/role`).set("Authorization", auth).send({ role: "ADMIN" });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("user_not_found");
    const ok = await env.http.patch(`/api/v1/admin/users/${target.id}/role`).set("Authorization", auth).send({ role: " admin " });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("ADMIN");
  });
});

describe("auth: refresh-token rotation + logout", () => {
  const cookieValue = (setCookie: string[] | undefined) => /refresh_token=([^;]*)/.exec((setCookie ?? []).join(";"))?.[1] ?? "";

  it("no cookie → 401 and the cookie is cleared", async () => {
    const res = await env.http.post("/api/v1/auth/refresh");
    expect(res.status).toBe(401);
    expect(String(res.headers["set-cookie"])).toContain("refresh_token=;");
  });

  it("rotates: the old token works once, the new one works next", async () => {
    const user = await createUser(env);
    const raw = await env.c.refreshTokens.createRefreshToken(user.id);

    const first = await env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${raw}`);
    expect(first.status).toBe(200);
    expect(first.body.tokenType).toBe("Bearer");
    expect(first.body.expiresIn).toBe(15 * 60);
    const setCookie = first.headers["set-cookie"] as unknown as string[];
    expect(setCookie.join(";")).toMatch(/Path=\/api\/v1\/auth/);
    expect(setCookie.join(";")).toMatch(/HttpOnly/);
    expect(setCookie.join(";")).toMatch(/SameSite=Lax/);
    const rotated = cookieValue(setCookie);
    expect(rotated).not.toBe(raw);

    // access token is accepted by the API
    const me = await env.http.get("/api/v1/users/me").set("Authorization", `Bearer ${first.body.accessToken}`);
    expect(me.body.id).toBe(user.id);

    // replaying the consumed token fails
    expect((await env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${raw}`)).status).toBe(401);
    // the rotated one works
    expect((await env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${rotated}`)).status).toBe(200);
  });

  it("logout revokes the token and clears the cookie", async () => {
    const user = await createUser(env);
    const raw = await env.c.refreshTokens.createRefreshToken(user.id);
    const out = await env.http.post("/api/v1/auth/logout").set("Cookie", `refresh_token=${raw}`);
    expect(out.status).toBe(204);
    expect((await env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${raw}`)).status).toBe(401);
  });
});
