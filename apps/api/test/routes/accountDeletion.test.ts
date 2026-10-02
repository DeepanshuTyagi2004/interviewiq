import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Response } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authTokens, githubConnections, interviewSessions, leetcodeConnections, refreshTokens, users } from "../../src/db/pg/schema.js";
import type { SessionStatus } from "../../src/domain/enums.js";
import { TokenCipher } from "../../src/lib/crypto.js";
import { json, status } from "../support/fakeFetch.js";
import { bearer, createTestEnv, createUser, TEST_INTERNAL_KEY, TEST_TOKEN_KEY, type TestEnv } from "../support/harness.js";
import { AI } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());

const PW = "correct-horse-battery";
const ME = "/api/v1/users/me";
const PURGE = `${AI}/users/purge`;
const GH_REVOKE = "https://api.github.com/applications/gh-client-id/grant";
const cipher = new TokenCipher(TEST_TOKEN_KEY);

function setCookies(res: Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
  return ([] as string[]).concat(raw ?? []).join(";");
}

async function passwordUser() {
  const email = `d-${randomUUID().slice(0, 8)}@example.com`;
  const { user, refreshToken } = await env.c.passwordAuth.register({ name: "Del", email, password: PW });
  await env.c.background.drain(); // the verify-email token row is written in the background
  return { user, email, refreshToken, token: await bearer(env, user) };
}

async function seed(userId: string, sessionStatus: SessionStatus = "COMPLETED") {
  const session = (s: SessionStatus) =>
    env.c.repos.sessions.insert({
      candidateId: userId, jobDescriptionId: randomUUID(), company: "meesho", role: "software-engineer", level: "sde1",
      roundType: "dsa", scheduledAt: new Date(), timezone: "Asia/Kolkata", status: s,
    });
  const a = await session(sessionStatus);
  const b = await session("SCHEDULED");
  await env.c.repos.outcomes.save(a.id, { verdict: "lean_hire" });
  await env.c.repos.candidateProfiles.save({
    userId, fullName: "Del", email: null, phone: null, location: null, headline: null, targetRole: null, targetJdId: null,
    education: [], experience: [], projects: [], skills: [], achievements: [],
    detectedLinks: { github: null, leetcode: null, linkedin: null }, resumeFilename: null, resumeParsedAt: null,
  });
  await env.c.repos.fragments.insert({ userId, source: "LEETCODE", data: { solved: { total: 3 } }, contentHash: "h", version: 1, fetchedAt: new Date() });
  await env.c.repos.githubConnections.upsert({ userId, githubLogin: "del", accessTokenEnc: cipher.encrypt("gho_secret"), scope: "read:user" });
  await env.c.repos.leetcodeConnections.upsertSyncing(userId, "del_lc");
  await env.c.preferences.update(userId, { interview: { pace: "faster" } });
  return [a.id, b.id];
}

/** Rows/docs still referencing the user across Postgres and the API's Mongo. */
async function remaining(userId: string, sessionIds: string[]): Promise<number> {
  const pg = await Promise.all([
    env.db.select().from(users).where(eq(users.id, userId)),
    env.db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId)),
    env.db.select().from(authTokens).where(eq(authTokens.userId, userId)),
    env.db.select().from(githubConnections).where(eq(githubConnections.userId, userId)),
    env.db.select().from(leetcodeConnections).where(eq(leetcodeConnections.userId, userId)),
    env.db.select().from(interviewSessions).where(eq(interviewSessions.candidateId, userId)),
  ]);
  const mongo = await Promise.all([
    env.mongo.candidateProfiles.countDocuments({ _id: userId }),
    env.mongo.profileFragments.countDocuments({ userId }),
    env.mongo.sessionOutcomes.countDocuments({ _id: { $in: sessionIds } }),
    env.mongo.userPreferences.countDocuments({ _id: userId }),
  ]);
  return pg.reduce((n, rows) => n + rows.length, 0) + mongo.reduce((n, c) => n + c, 0);
}

function stubUpstreams() {
  env.fetch.on("POST", PURGE, { deleted_plans: 2 });
  env.fetch.on("DELETE", GH_REVOKE, () => status(204));
}

describe("DELETE /users/me", () => {
  it("401 without a token", async () => {
    expect((await env.http.delete(ME).send({ confirmEmail: "x@example.com" })).status).toBe(401);
  });

  it("wipes a password account across every store, purges the AI service and revokes GitHub", async () => {
    const { user, email, refreshToken, token } = await passwordUser();
    const sessionIds = await seed(user.id);
    stubUpstreams();

    const res = await env.http.delete(ME).set("Authorization", token).send({ confirmEmail: `  ${email.toUpperCase()}  `, password: PW });

    expect(res.status).toBe(204);
    expect(setCookies(res)).toMatch(/refresh_token=;/);
    expect(await remaining(user.id, sessionIds)).toBe(0);

    const [purge] = env.fetch.callsTo(PURGE, "POST");
    expect(purge!.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
    expect([...(purge!.json as { session_ids: string[] }).session_ids].sort()).toEqual([...sessionIds].sort());

    const [revoke] = env.fetch.callsTo(GH_REVOKE, "DELETE");
    expect(revoke!.headers.authorization).toBe(`Basic ${Buffer.from("gh-client-id:gh-client-secret").toString("base64")}`);
    expect(revoke!.json).toEqual({ access_token: "gho_secret" });

    expect((await env.http.get(ME).set("Authorization", token)).status).toBe(404);
    expect((await env.http.post("/api/v1/auth/refresh").set("Cookie", `refresh_token=${refreshToken}`)).status).toBe(401);
  });

  it("deletes a Google-only account with the typed email alone", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    stubUpstreams();
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(await remaining(user.id, sessionIds)).toBe(0);
  });

  it("400 confirmation_mismatch for the wrong email, and deletes nothing", async () => {
    const { user, token } = await passwordUser();
    const sessionIds = await seed(user.id);
    const before = await remaining(user.id, sessionIds);
    const res = await env.http.delete(ME).set("Authorization", token).send({ confirmEmail: "someone-else@example.com", password: PW });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("confirmation_mismatch");
    expect(await remaining(user.id, sessionIds)).toBe(before);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it.each([[undefined], ["wrong-password"]])("403 invalid_password for password %j", async (password) => {
    const { user, email, token } = await passwordUser();
    const res = await env.http.delete(ME).set("Authorization", token).send({ confirmEmail: email, password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("invalid_password");
    expect(await remaining(user.id, [])).toBeGreaterThan(0);
  });

  it("409 interview_in_progress while a session is live", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id, "LIVE_IN_PROGRESS");
    const before = await remaining(user.id, sessionIds);
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("interview_in_progress");
    expect(await remaining(user.id, sessionIds)).toBe(before);
  });

  it("502 deletion_unavailable when the AI service fails, and deletes nothing", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    const before = await remaining(user.id, sessionIds);
    env.fetch.on("POST", PURGE, () => status(503));
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("deletion_unavailable");
    expect(await remaining(user.id, sessionIds)).toBe(before);
    expect(env.fetch.callsTo(GH_REVOKE)).toHaveLength(0);
  });

  it("still deletes when revoking the GitHub grant fails", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    env.fetch.on("POST", PURGE, { deleted_plans: 2 });
    env.fetch.on("DELETE", GH_REVOKE, () => json({ message: "boom" }, 500));
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(await remaining(user.id, sessionIds)).toBe(0);
  });

  it("skips the AI service when the user has no sessions", async () => {
    const user = await createUser(env);
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(env.fetch.callsTo(PURGE)).toHaveLength(0);
    expect(await remaining(user.id, [])).toBe(0);
  });

  it("a retry after a partial wipe finishes the job", async () => {
    const user = await createUser(env);
    const sessionIds = await seed(user.id);
    // Simulate a crash after the Mongo step: documents gone, Postgres rows left.
    await env.mongo.candidateProfiles.deleteOne({ _id: user.id });
    await env.mongo.profileFragments.deleteMany({ userId: user.id });
    await env.mongo.sessionOutcomes.deleteMany({ _id: { $in: sessionIds } });
    stubUpstreams();
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({ confirmEmail: user.email });
    expect(res.status).toBe(204);
    expect(await remaining(user.id, sessionIds)).toBe(0);
  });

  it("leaves other users' data untouched", async () => {
    const mine = await createUser(env);
    const theirs = await createUser(env);
    await seed(mine.id);
    const theirSessions = await seed(theirs.id);
    const before = await remaining(theirs.id, theirSessions);
    stubUpstreams();
    expect((await env.http.delete(ME).set("Authorization", await bearer(env, mine)).send({ confirmEmail: mine.email })).status).toBe(204);
    expect(await remaining(theirs.id, theirSessions)).toBe(before);
    const theirRows = await env.db.select().from(interviewSessions).where(inArray(interviewSessions.id, theirSessions));
    expect(theirRows).toHaveLength(2);
  });

  it("400 invalid_request when confirmEmail is missing", async () => {
    const user = await createUser(env);
    const res = await env.http.delete(ME).set("Authorization", await bearer(env, user)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_request");
  });
});
