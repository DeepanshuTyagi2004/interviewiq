import { describe, expect, it } from "vitest";
import { toLeetCodeFragmentJson } from "../../src/integrations/leetcode/collector.js";
import { mergedPullRequests, toGitHubFragmentJson, topPublicRepos } from "../../src/integrations/github/collector.js";

const now = new Date("2026-10-04T00:00:00Z"), t = now.getTime() / 1000, DAY = 86_400;
const profile = { matchedUser: { username: "u", submitStatsGlobal: { acSubmissionNum: [{ difficulty: "Easy", count: 3 }] }, tagProblemCounts: { advanced: [{ tagName: "Trie", problemsSolved: 4 }] } } };

describe("LeetCode scoring enrichments", () => {
  it("adds advanced topics, contest history and calendar counts only when available", () => {
    const history = {
      userContestRankingHistory: [
        { attended: false, rating: 1500, ranking: 0, contest: { startTime: t - 3 * DAY } },
        { attended: true, rating: 1601.4, ranking: 900, contest: { startTime: t - 10 * DAY } },
      ],
      matchedUser: { userCalendar: { submissionCalendar: JSON.stringify({ [String(t - 2 * DAY)]: 3, [String(t - 40 * DAY)]: 1, [String(t + DAY)]: 9 }) } },
    };
    const data = JSON.parse(toLeetCodeFragmentJson(profile, null, null, now, false, history));
    expect(data.advancedTopics).toEqual([{ topic: "Trie", count: 4 }]);
    expect(data.contestHistory.map((row: { startTime: number }) => row.startTime)).toEqual([t - 10 * DAY, t - 3 * DAY]); // oldest first
    expect(data.contestHistory[0]).toMatchObject({ attended: true, rating: 1601, ranking: 900 });
    expect(data.calendar).toEqual({ activeWeeks: 2, windowWeeks: 52, last30Days: 3 }); // future day ignored; no timestamp
    const without = JSON.parse(toLeetCodeFragmentJson(profile, null, null, now, false));
    expect(without.contestHistory).toBeUndefined();
    expect(without.calendar).toBeUndefined();
  });

  it("keeps the fragment hash stable for an unchanged calendar on a later collection", () => {
    const history = { userContestRankingHistory: [], matchedUser: { userCalendar: { submissionCalendar: JSON.stringify({ [String(t - 2 * DAY)]: 1 }) } } };
    const a = toLeetCodeFragmentJson(profile, null, null, now, false, history);
    const b = toLeetCodeFragmentJson(profile, null, null, new Date(now.getTime() + 60_000), false, history);
    expect(b).toBe(a);
  });
});

describe("GitHub README enrichment", () => {
  const root = { data: { viewer: { login: "me", repositories: { totalCount: 3, nodes: [
    { name: "public-app", stargazerCount: 5, isFork: false, isPrivate: false, languages: { edges: [] } },
    { name: "secret-app", stargazerCount: 50, isFork: false, isPrivate: true, languages: { edges: [] } },
    { name: "forked", stargazerCount: 99, isFork: true, isPrivate: false, languages: { edges: [] } },
    { name: "unknown-visibility", stargazerCount: 1, isFork: false, languages: { edges: [] } },
  ] } } } };

  it("only ever selects public, non-fork repositories for README reads", () => {
    expect(topPublicRepos(root)).toEqual(["public-app"]);
  });

  it("emits READMEs only when fetched, so existing fragments stay byte-identical", () => {
    expect(toGitHubFragmentJson(root, null)).toBe(toGitHubFragmentJson(root));
    expect(JSON.parse(toGitHubFragmentJson(root)).readmes).toBeUndefined();
    const readmeRoot = { data: { viewer: { r0: { name: "public-app", description: "A thing", object: { text: "# Public app\n\n```sh\nnpm i\n```\nA realtime service with Redis pub/sub that handles reconnects and backpressure." } } } } };
    const readmes = JSON.parse(toGitHubFragmentJson(root, readmeRoot)).readmes;
    expect(readmes).toEqual([{ repo: "public-app", description: "A thing", text: expect.stringContaining("realtime service with Redis") }]);
    expect(readmes[0].text).not.toContain("npm i"); // code blocks are stripped
  });
});

describe("GitHub merged pull requests (open source)", () => {
  const node = (repo: string, owner: string, extra: Record<string, unknown> = {}) => ({
    title: "Add streaming parser", mergedAt: "2026-07-01T00:00:00Z", additions: 120, deletions: 10, changedFiles: 4, files: { nodes: [{ path: "src/parser.ts" }] },
    repository: { nameWithOwner: repo, stargazerCount: 15_321, isPrivate: false, isFork: false, owner: { login: owner } }, ...extra,
  });
  const merged = { data: { search: { nodes: [
    node("org/big", "org"),
    node("me/mine", "Me"), // the user's own repository (case-insensitive) is not open-source contribution
    node("corp/secret", "corp", { repository: { nameWithOwner: "corp/secret", stargazerCount: 0, isPrivate: true, isFork: false, owner: { login: "corp" } } }),
    node("org/docs", "org", { title: "Fix typo", additions: 1, deletions: 1, changedFiles: 1, files: { nodes: [{ path: "docs/intro.md" }] } }),
  ] } } };

  it("keeps public PRs to other owners, marks docs-only changes and rounds stars for hash stability", () => {
    const prs = mergedPullRequests(merged, "me");
    expect(prs.map((pr) => pr.repo)).toEqual(["org/big", "org/docs"]);
    expect(prs[0]).toMatchObject({ stars: 15_000, docsOnly: false, additions: 120 });
    expect(prs[1]).toMatchObject({ docsOnly: true });
  });

  it("adds mergedPullRequests only when there are some, so existing fragments stay byte-identical", () => {
    const root = { data: { viewer: { login: "me" } } };
    expect(toGitHubFragmentJson(root, null, { data: { search: { nodes: [] } } })).toBe(toGitHubFragmentJson(root));
    expect(JSON.parse(toGitHubFragmentJson(root, null, merged)).mergedPullRequests).toHaveLength(2);
  });
});
