import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, createUser, createTestEnv, type TestEnv } from "../support/harness.js";

/**
 * Port of ProfileControllerTest (GET /api/v1/profile/me — the consolidated Profile Builder view).
 * Real ProfileService + assembler over seeded connections (Postgres) and fragments (Mongo).
 */

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

const ME = "/api/v1/profile/me";
const GH_REFRESHED = new Date("2026-06-01T00:00:00Z");
const LC_REFRESHED = new Date("2026-06-02T00:00:00Z");

async function seedConnectedUser() {
  const user = await createUser(env, { name: "Aisha Verma" });
  const gh = await env.c.repos.githubConnections.upsert({ userId: user.id, githubLogin: "aishav", accessTokenEnc: "enc", scope: "read:user" });
  await env.c.repos.githubConnections.touchRefreshed(gh.id, GH_REFRESHED);
  const lc = await env.c.repos.leetcodeConnections.upsertSyncing(user.id, "aisha_lc");
  await env.c.repos.leetcodeConnections.update(lc.id, { status: "SYNCED", lastRefreshedAt: LC_REFRESHED });
  await env.c.repos.fragments.insert({
    userId: user.id,
    source: "GITHUB",
    data: {
      login: "aishav",
      publicRepos: 38,
      externalPRs: 0,
      contributions: { lastYear: 1204 },
      languages: [
        { name: "TypeScript", pct: 48 },
        { name: "Python", pct: 30 },
        { name: "Shell", pct: 2 },
      ],
    },
    contentHash: "abc",
    version: 1,
    fetchedAt: GH_REFRESHED,
  });
  return user;
}

describe("GET /profile/me", () => {
  it("me_returnsConsolidatedProfileShape", async () => {
    const user = await seedConnectedUser();
    const res = await env.http.get(ME).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    const b = res.body;

    expect(Object.keys(b).sort()).toEqual(["fragments", "mostUsedSkills", "notable", "provenance", "sources", "user"]);
    expect(b.user.name).toBe("Aisha Verma");
    expect(b.user.headline ?? null).toBeNull();

    // Null SourceStatus fields are omitted (Java @JsonInclude(NON_NULL)).
    expect(b.sources).toEqual([
      { source: "GITHUB", connected: true, lastRefreshedAt: GH_REFRESHED.toISOString() },
      { source: "RESUME", connected: false },
      { source: "LEETCODE", connected: true, lastRefreshedAt: LC_REFRESHED.toISOString(), status: "SYNCED" },
      { source: "CODEFORCES", connected: false },
      { source: "CODECHEF", connected: false },
      { source: "ATCODER", connected: false },
      { source: "TUF", connected: false },
      { source: "LINKEDIN", connected: false },
    ]);

    expect(b.notable[0]).toEqual({ text: "1,204 GitHub contributions in the last year", source: "GITHUB" });
    expect(b.mostUsedSkills[0]).toEqual({ skill: "TypeScript", evidence: "GitHub 48%", source: "GITHUB" });
    // trace languages (< 5%) are not skills
    expect(b.mostUsedSkills.map((s: { skill: string }) => s.skill)).not.toContain("Shell");
    expect(b.fragments.github.publicRepos).toBe(38);
    expect(b.fragments.github.login).toBe("aishav");
    expect(b.provenance).toEqual([{ source: "GITHUB", fragmentHash: "sha256:abc", fetchedAt: GH_REFRESHED.toISOString() }]);

    // hard rule: no scoring anywhere
    expect(b.score).toBeUndefined();
    expect(b.rank).toBeUndefined();
  });

  it("a user with no connections: every source disconnected, empty bands and fragments", async () => {
    const user = await createUser(env, { name: "Fresh User" });
    const res = await env.http.get(ME).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Fresh User");
    expect(res.body.sources).toEqual([
      { source: "GITHUB", connected: false },
      { source: "RESUME", connected: false },
      { source: "LEETCODE", connected: false },
      { source: "CODEFORCES", connected: false },
      { source: "CODECHEF", connected: false },
      { source: "ATCODER", connected: false },
      { source: "TUF", connected: false },
      { source: "LINKEDIN", connected: false },
    ]);
    expect(res.body.notable).toEqual([]);
    expect(res.body.mostUsedSkills).toEqual([]);
    expect(res.body.fragments).toEqual({});
    expect(res.body.provenance).toEqual([]);
  });

  it("a SYNCING LeetCode connection reports its status before the first refresh", async () => {
    const user = await createUser(env);
    await env.c.repos.leetcodeConnections.upsertSyncing(user.id, "someone");
    const res = await env.http.get(ME).set("Authorization", await bearer(env, user));
    expect(res.body.sources[2]).toEqual({ source: "LEETCODE", connected: true, status: "SYNCING" });
  });

  it("a token for a user that no longer exists is 404 user_not_found", async () => {
    const ghost = await createUser(env);
    const token = await bearer(env, { ...ghost, id: randomUUID() });
    const res = await env.http.get(ME).set("Authorization", token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("user_not_found");
  });

  it("me_withoutJwt_isUnauthorized", async () => {
    expect((await env.http.get(ME)).status).toBe(401);
  });
});
