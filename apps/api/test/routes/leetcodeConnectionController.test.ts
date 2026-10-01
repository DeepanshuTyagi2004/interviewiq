import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RecordedCall } from "../support/fakeFetch.js";
import { json, status, text } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";

/**
 * LeetCode connection routes (/api/v1/connections/leetcode) — no Java controller test existed.
 * Asserts LeetCodeConnectionController's contract: 202 {username, status: "SYNCING"} after a
 * synchronous validation, and the stable error mapping (404 / 422 / 503 / 400). Only LeetCode's
 * public GraphQL endpoint is stubbed.
 */

const LEETCODE_GRAPHQL = "https://leetcode.com/graphql";
const CONNECT = "/api/v1/connections/leetcode";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());
beforeEach(() => env.fetch.reset());
afterEach(() => env.c.background.drain());

type Gql = { query: string; variables: { username: string } };
const gql = (call: RecordedCall) => call.json as Gql;
const isQuery = (call: RecordedCall, name: string) => gql(call).query.includes(`query ${name}`);

const AC_STATS = {
  acSubmissionNum: [
    { difficulty: "All", count: 120 },
    { difficulty: "Easy", count: 60 },
    { difficulty: "Medium", count: 50 },
    { difficulty: "Hard", count: 10 },
  ],
};

/** A healthy public profile: validate + the three collection queries. */
function publicProfile(call: RecordedCall): Response {
  const username = gql(call).variables.username;
  if (isQuery(call, "validate")) return json({ data: { matchedUser: { username, submitStatsGlobal: AC_STATS } } });
  if (isQuery(call, "userProfile")) {
    return json({
      data: {
        matchedUser: {
          username,
          profile: { realName: "Aakash", countryName: "India" },
          submitStatsGlobal: AC_STATS,
          tagProblemCounts: {
            advanced: [{ tagName: "Dynamic Programming", problemsSolved: 8 }],
            intermediate: [{ tagName: "Hash Table", problemsSolved: 12 }],
            fundamental: [{ tagName: "Array", problemsSolved: 40 }],
          },
        },
      },
    });
  }
  if (isQuery(call, "contest")) return json({ data: { userContestRanking: null } });
  if (isQuery(call, "recent")) return json({ data: { recentAcSubmissionList: [] } });
  return status(500);
}

async function authed() {
  const user = await createUser(env);
  return { user, authz: await bearer(env, user) };
}

describe("POST /connections/leetcode", () => {
  it("202 {username, status: SYNCING}; validates against https://leetcode.com/graphql, then collects in the background", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, publicProfile);
    const { user, authz } = await authed();

    const res = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "https://leetcode.com/u/aakash_42/" });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ username: "aakash_42", status: "SYNCING" });

    const [validate] = env.fetch.calls;
    expect(validate?.url).toBe(LEETCODE_GRAPHQL);
    expect(validate?.method).toBe("POST");
    expect(isQuery(validate!, "validate")).toBe(true);
    expect(gql(validate!).variables).toEqual({ username: "aakash_42" });
    expect(validate?.headers["referer"]).toBe("https://leetcode.com");
    expect(validate?.headers["content-type"]).toBe("application/json");

    await env.c.background.drain();
    const conn = await env.c.repos.leetcodeConnections.findByUserId(user.id);
    expect(conn?.username).toBe("aakash_42");
    expect(conn?.status).toBe("SYNCED");

    const profile = await env.http.get("/api/v1/profile/me").set("Authorization", authz);
    expect(profile.body.sources[2]).toMatchObject({ source: "LEETCODE", connected: true, status: "SYNCED" });
    expect(typeof profile.body.sources[2].lastRefreshedAt).toBe("string");
    expect(profile.body.fragments.leetcode.solved).toEqual({ easy: 60, medium: 50, hard: 10, total: 120 });
    expect(env.fetch.calls.every((c) => c.url === LEETCODE_GRAPHQL)).toBe(true);
  });

  it("normalizes '@handle' and surrounding whitespace", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, publicProfile);
    const { authz } = await authed();
    const res = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "  @neo  " });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ username: "neo", status: "SYNCING" });
  });

  it("reconnecting re-points the connection at the new username, back in SYNCING", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, publicProfile);
    const { user, authz } = await authed();
    await env.http.post(CONNECT).set("Authorization", authz).send({ username: "first" }).expect(202);
    await env.c.background.drain();
    const again = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "second" });
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ username: "second", status: "SYNCING" });
    await env.c.background.drain();
    expect((await env.c.repos.leetcodeConnections.findByUserId(user.id))?.username).toBe("second");
  });

  it("404 leetcode_user_not_found when matchedUser is null (nothing persisted)", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, { data: { matchedUser: null } });
    const { user, authz } = await authed();
    const res = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "ghost" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "leetcode_user_not_found", message: "LeetCode user not found: ghost" });
    expect(await env.c.repos.leetcodeConnections.findByUserId(user.id)).toBeNull();
  });

  it("422 leetcode_profile_private when the stats are not visible", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, { data: { matchedUser: { username: "shy", submitStatsGlobal: null } } });
    const { user, authz } = await authed();
    const res = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "shy" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: "leetcode_profile_private", message: "LeetCode profile is not public: shy" });
    expect(await env.c.repos.leetcodeConnections.findByUserId(user.id)).toBeNull();
  });

  it("503 leetcode_rate_limited after retrying LeetCode's 429s", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, () => status(429));
    const { user, authz } = await authed();
    const res = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "busy" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("leetcode_rate_limited");
    expect(env.fetch.callsTo(LEETCODE_GRAPHQL)).toHaveLength(3);
    expect(await env.c.repos.leetcodeConnections.findByUserId(user.id)).toBeNull();
  });

  it("503 leetcode_unreachable when LeetCode cannot be reached (retried)", async () => {
    // no route → transport failure on every attempt
    const { authz } = await authed();
    const res = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "anyone" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("leetcode_unreachable");
    expect(env.fetch.callsTo(LEETCODE_GRAPHQL)).toHaveLength(3);
  });

  it("503 leetcode_unreachable on a non-retryable 4xx or a GraphQL error without data", async () => {
    const { authz } = await authed();
    env.fetch.once("POST", LEETCODE_GRAPHQL, () => text("forbidden", 403));
    const a = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "x" });
    expect(a.status).toBe(503);
    expect(a.body.code).toBe("leetcode_unreachable");
    expect(env.fetch.callsTo(LEETCODE_GRAPHQL)).toHaveLength(1);

    env.fetch.once("POST", LEETCODE_GRAPHQL, { errors: [{ message: "boom" }] });
    const b = await env.http.post(CONNECT).set("Authorization", authz).send({ username: "x" });
    expect(b.status).toBe(503);
    expect(b.body.code).toBe("leetcode_unreachable");
  });

  it.each([
    ["a blank username", { username: "   " }],
    ["a missing username", {}],
    ["a bare '@'", { username: "@" }],
  ])("400 leetcode_bad_request for %s (LeetCode not called)", async (_label, body) => {
    const { authz } = await authed();
    const res = await env.http.post(CONNECT).set("Authorization", authz).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "leetcode_bad_request", message: "LeetCode username is required" });
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("a background collection failure leaves the connection FAILED (surfaced via the profile)", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, (call: RecordedCall) => (isQuery(call, "validate") ? publicProfile(call) : text("bad", 400)));
    const { authz } = await authed();
    await env.http.post(CONNECT).set("Authorization", authz).send({ username: "flaky" }).expect(202);
    await env.c.background.drain();
    const profile = await env.http.get("/api/v1/profile/me").set("Authorization", authz);
    expect(profile.body.sources[2]).toEqual({ source: "LEETCODE", connected: true, status: "FAILED" });
  });

  it("requires a JWT", async () => {
    expect((await env.http.post(CONNECT).send({ username: "x" })).status).toBe(401);
    expect(env.fetch.calls).toHaveLength(0);
  });
});

describe("DELETE /connections/leetcode", () => {
  it("204: removes the connection and the LeetCode fragment; idempotent", async () => {
    env.fetch.on("POST", LEETCODE_GRAPHQL, publicProfile);
    const { user, authz } = await authed();
    await env.http.post(CONNECT).set("Authorization", authz).send({ username: "bye" }).expect(202);
    await env.c.background.drain();
    expect(await env.c.repos.fragments.findByUserIdAndSource(user.id, "LEETCODE")).not.toBeNull();

    const res = await env.http.delete(CONNECT).set("Authorization", authz);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(await env.c.repos.leetcodeConnections.findByUserId(user.id)).toBeNull();
    expect(await env.c.repos.fragments.findByUserIdAndSource(user.id, "LEETCODE")).toBeNull();

    expect((await env.http.delete(CONNECT).set("Authorization", authz)).status).toBe(204);
  });

  it("requires a JWT", async () => {
    expect((await env.http.delete(CONNECT)).status).toBe(401);
  });
});
