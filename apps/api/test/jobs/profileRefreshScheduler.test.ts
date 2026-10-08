import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubConnectionRow, LeetCodeConnectionRow } from "../../src/db/pg/schema.js";
import { GITHUB_GRAPHQL_QUERY } from "../../src/integrations/github/collector.js";
import { TokenCipher } from "../../src/lib/crypto.js";
import { json, status, type RecordedCall } from "../support/fakeFetch.js";
import { createTestEnv, createUser, TEST_TOKEN_KEY, type TestEnv } from "../support/harness.js";

/**
 * Port of ProfileRefreshSchedulerTest → GitHubRefreshJob.refreshAll, plus the equivalent LeetCode
 * weekly job (LeetCodeRefreshJob.refreshAll). Real connection repositories + fragment store; the
 * GitHub / LeetCode GraphQL endpoints are stubbed. findAll() scans the whole table, so every test
 * gets a fresh database.
 */

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const LEETCODE_GRAPHQL = "https://leetcode.com/graphql";

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.close();
});

// --- GitHub ---------------------------------------------------------------------------------

const cipher = new TokenCipher(TEST_TOKEN_KEY);

async function githubConnection(login: string): Promise<GitHubConnectionRow> {
  const user = await createUser(env);
  return env.c.repos.githubConnections.upsert({ userId: user.id, githubLogin: login, accessTokenEnc: cipher.encrypt(`token-${login}`), scope: "repo" });
}

function viewer(login: string) {
  return {
    data: {
      viewer: {
        login,
        name: login,
        avatarUrl: "",
        createdAt: "2020-01-01T00:00:00Z",
        repositories: {
          totalCount: 1,
          nodes: [{ name: "repo", stargazerCount: 3, isFork: false, primaryLanguage: { name: "TypeScript" }, languages: { edges: [{ size: 100, node: { name: "TypeScript" } }] } }],
        },
        contributionsCollection: { contributionCalendar: { totalContributions: 42, weeks: [] }, pullRequestContributionsByRepository: [] },
      },
    },
  };
}

/** Answers per access token; `failing` logins get a 502. */
function stubGitHub(...failing: string[]): void {
  env.fetch.on("POST", GITHUB_GRAPHQL, (call: RecordedCall) => {
    const login = /^Bearer token-(.+)$/.exec(call.headers.authorization ?? "")?.[1] ?? "";
    return failing.includes(login) ? status(502, "GitHub API timeout") : json(viewer(login));
  });
}

const githubCallsFor = (login: string) => env.fetch.callsTo(GITHUB_GRAPHQL, "POST").filter((c) => c.headers.authorization === `Bearer token-${login}`);
/** The main profile query; READMEs and merged PRs are best-effort follow-up queries in the same refresh. */
const profileQueriesFor = (login: string) => githubCallsFor(login).filter((c) => (c.json as { query?: string } | null)?.query === GITHUB_GRAPHQL_QUERY);
const githubFragment = (userId: string) => env.c.repos.fragments.findByUserIdAndSource(userId, "GITHUB");
const lastRefreshed = async (c: GitHubConnectionRow) => (await env.c.repos.githubConnections.findByUserId(c.userId))!.lastRefreshedAt;

describe("GitHubRefreshJob.refreshAll", () => {
  it("refreshes once per connection", async () => {
    const c1 = await githubConnection("alice");
    const c2 = await githubConnection("bob");
    stubGitHub();
    const refresh = vi.spyOn(env.c.profiles, "refreshGitHub");

    await env.c.jobs.githubRefresh.refreshAll();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ id: c1.id, githubLogin: "alice" }));
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ id: c2.id, githubLogin: "bob" }));
    for (const [c, login] of [[c1, "alice"], [c2, "bob"]] as const) {
      expect(profileQueriesFor(login)).toHaveLength(1);
      expect(await lastRefreshed(c)).toBeInstanceOf(Date);
      expect((await githubFragment(c.userId))!.data.login).toBe(login);
    }
  });

  it("an exception on one connection doesn't stop the rest", async () => {
    const c1 = await githubConnection("alice");
    const c2 = await githubConnection("bob");
    const c3 = await githubConnection("carol");
    stubGitHub("bob"); // the second connection's GitHub call fails
    const refresh = vi.spyOn(env.c.profiles, "refreshGitHub");

    await expect(env.c.jobs.githubRefresh.refreshAll()).resolves.toBeUndefined(); // must not throw

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(await lastRefreshed(c1)).toBeInstanceOf(Date);
    expect(await lastRefreshed(c3)).toBeInstanceOf(Date);
    expect(await githubFragment(c1.userId)).not.toBeNull();
    expect(await githubFragment(c3.userId)).not.toBeNull();
    // the failed one is left untouched
    expect(await lastRefreshed(c2)).toBeNull();
    expect(await githubFragment(c2.userId)).toBeNull();
  });

  it("a refreshGitHub that throws outright doesn't stop the rest either", async () => {
    const c1 = await githubConnection("alice");
    const c2 = await githubConnection("bob");
    const c3 = await githubConnection("carol");
    stubGitHub();
    const real = env.c.profiles.refreshGitHub.bind(env.c.profiles);
    const refresh = vi.spyOn(env.c.profiles, "refreshGitHub").mockImplementation(async (c) => {
      if (c.id === c2.id) throw new Error("GitHub API timeout");
      return real(c);
    });

    await expect(env.c.jobs.githubRefresh.refreshAll()).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(await lastRefreshed(c1)).toBeInstanceOf(Date);
    expect(await lastRefreshed(c3)).toBeInstanceOf(Date);
  });

  it("no connections → refresh is never called", async () => {
    const refresh = vi.spyOn(env.c.profiles, "refreshGitHub");

    await env.c.jobs.githubRefresh.refreshAll();

    expect(refresh).not.toHaveBeenCalled();
    expect(env.fetch.calls).toHaveLength(0);
  });
});

// --- LeetCode -------------------------------------------------------------------------------

async function leetcodeConnection(username: string): Promise<LeetCodeConnectionRow> {
  const user = await createUser(env);
  return env.c.repos.leetcodeConnections.upsertSyncing(user.id, username);
}

/** `failing` users get a non-retryable 400; `vanished` users come back with a null matchedUser. */
function stubLeetCode(opts: { failing?: string[]; vanished?: string[] } = {}): void {
  env.fetch.on("POST", LEETCODE_GRAPHQL, (call: RecordedCall) => {
    const { query, variables } = call.json as { query: string; variables: { username: string } };
    const u = variables.username;
    if (opts.failing?.includes(u)) return status(400, "bad request");
    if (query.includes("userProfile")) {
      if (opts.vanished?.includes(u)) return json({ data: { matchedUser: null } });
      return json({
        data: {
          matchedUser: {
            username: u,
            profile: { realName: u, countryName: null },
            submitStatsGlobal: { acSubmissionNum: [{ difficulty: "All", count: 10 }, { difficulty: "Easy", count: 10 }] },
            tagProblemCounts: { advanced: [], intermediate: [], fundamental: [{ tagName: "Array", problemsSolved: 5 }] },
          },
        },
      });
    }
    if (query.includes("userContestRanking")) return json({ data: { userContestRanking: null } });
    return json({ data: { recentAcSubmissionList: [] } });
  });
}

const leetcodeRow = async (c: LeetCodeConnectionRow) => (await env.c.repos.leetcodeConnections.findById(c.id))!;
const leetcodeFragment = (userId: string) => env.c.repos.fragments.findByUserIdAndSource(userId, "LEETCODE");

describe("LeetCodeRefreshJob.refreshAll", () => {
  it("refreshes every connection; one failing doesn't stop the rest (each records its own status)", async () => {
    const alice = await leetcodeConnection("alice");
    const bob = await leetcodeConnection("bob");
    const carol = await leetcodeConnection("carol");
    const dave = await leetcodeConnection("dave");
    stubLeetCode({ failing: ["bob"], vanished: ["dave"] });

    await expect(env.c.jobs.leetcodeRefresh.refreshAll()).resolves.toBeUndefined();

    for (const c of [alice, carol]) {
      const r = await leetcodeRow(c);
      expect(r.status).toBe("SYNCED");
      expect(r.lastRefreshedAt).toBeInstanceOf(Date);
      expect(await leetcodeFragment(c.userId)).not.toBeNull();
    }
    const failed = await leetcodeRow(bob);
    expect(failed.status).toBe("FAILED");
    expect(failed.lastRefreshedAt).toBeNull();
    expect(await leetcodeFragment(bob.userId)).toBeNull();
    expect((await leetcodeRow(dave)).status).toBe("DEGRADED");
  });

  it("no connections → no LeetCode calls", async () => {
    await env.c.jobs.leetcodeRefresh.refreshAll();
    expect(env.fetch.calls).toHaveLength(0);
  });
});
