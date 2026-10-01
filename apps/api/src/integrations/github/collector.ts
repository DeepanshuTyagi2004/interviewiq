import type { GitHubConnectionRow } from "../../db/pg/schema.js";
import { canonicalize, sha256Hex } from "../../lib/canonicalJson.js";
import type { TokenCipher } from "../../lib/crypto.js";
import { type FetchLike, requestJson } from "../../lib/http.js";
import { asBoolean, asInt, asString, isObject, items, path } from "../../lib/json.js";
import type { ProfileFragmentRepository } from "../../repositories/mongo.js";

/**
 * GraphQL response shape we depend on (parsed defensively — extra/missing fields are tolerated):
 *
 * data.viewer {
 *   login, name, avatarUrl, createdAt,
 *   repositories { totalCount, nodes[]{ name, stargazerCount, pushedAt, isFork,
 *       primaryLanguage{name}, languages{ edges[]{ size, node{name} } } } },
 *   contributionsCollection {
 *     contributionCalendar { totalContributions, weeks[]{ contributionDays[]{ contributionCount } } },
 *     pullRequestContributionsByRepository[]{ repository{ owner{login} }, contributions{ totalCount } }
 *   }
 * }
 */
export const GITHUB_GRAPHQL_QUERY = `
query {
  viewer {
    login
    name
    avatarUrl
    createdAt
    repositories(first: 100, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      nodes {
        name
        stargazerCount
        pushedAt
        isFork
        primaryLanguage { name }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name } }
        }
      }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount } }
      }
      pullRequestContributionsByRepository(maxRepositories: 100) {
        repository { owner { login } }
        contributions { totalCount }
      }
    }
  }
}
`;

export class GitHubCollector {
  constructor(
    private readonly graphqlUrl: string,
    private readonly tokenCipher: TokenCipher,
    private readonly fragments: ProfileFragmentRepository,
    private readonly fetchImpl: FetchLike,
  ) {}

  /** Fetch, normalize, and upsert the GitHub fragment — rewriting only when the content hash changed. */
  async collectAndStore(connection: GitHubConnectionRow): Promise<void> {
    const accessToken = this.tokenCipher.decrypt(connection.accessTokenEnc);
    const root = await this.postGraphQl(accessToken);
    const canonical = toGitHubFragmentJson(root);
    const hash = sha256Hex(canonical);
    const now = new Date();

    const existing = await this.fragments.findByUserIdAndSource(connection.userId, "GITHUB");
    if (!existing) {
      await this.fragments.insert({
        userId: connection.userId,
        source: "GITHUB",
        data: JSON.parse(canonical) as Record<string, unknown>,
        contentHash: hash,
        version: 1,
        fetchedAt: now,
      });
    } else if (existing.contentHash === hash) {
      // unchanged: just bump fetchedAt (idempotent — cost discipline)
      await this.fragments.update(existing._id, { fetchedAt: now });
    } else {
      await this.fragments.update(existing._id, {
        data: JSON.parse(canonical) as Record<string, unknown>,
        contentHash: hash,
        version: existing.version + 1,
        fetchedAt: now,
      });
    }
  }

  private async postGraphQl(accessToken: string): Promise<unknown> {
    const root = await requestJson(this.fetchImpl, {
      method: "POST",
      url: this.graphqlUrl,
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "interviewiq-backend", "Content-Type": "application/json" },
      body: JSON.stringify({ query: GITHUB_GRAPHQL_QUERY }),
      timeoutMs: 60_000,
    });
    if (isObject(root) && "errors" in root) {
      throw new Error(`GitHub GraphQL returned errors: ${JSON.stringify(root.errors)}`);
    }
    return root;
  }
}

/**
 * Map the raw GraphQL JSON into the normalized fragment and return it as canonical (key-sorted)
 * JSON, ready for hashing + storage. Pure — exported for tests.
 */
export function toGitHubFragmentJson(root: unknown): string {
  const viewer = path(root, "data", "viewer");

  // contributions: lastYear total + 52x7 weeks grid
  const calendar = path(viewer, "contributionsCollection", "contributionCalendar");
  const weeks = items(path(calendar, "weeks")).map((week) =>
    items(path(week, "contributionDays")).map((day) => asInt(path(day, "contributionCount"), 0)),
  );

  // languages: aggregate bytes across NON-FORK repos; topRepos from the same set
  const bytesByLang = new Map<string, number>();
  const topRepos: { name: string; stars: number; primaryLang: string }[] = [];
  for (const repo of items(path(viewer, "repositories", "nodes"))) {
    if (asBoolean(path(repo, "isFork"), false)) continue; // skip-list: forks
    for (const edge of items(path(repo, "languages", "edges"))) {
      const lang = asString(path(edge, "node", "name"), "");
      const size = asInt(path(edge, "size"), 0);
      if (lang !== "") bytesByLang.set(lang, (bytesByLang.get(lang) ?? 0) + size);
    }
    topRepos.push({
      name: asString(path(repo, "name"), ""),
      stars: asInt(path(repo, "stargazerCount"), 0),
      primaryLang: asString(path(repo, "primaryLanguage", "name"), ""),
    });
  }
  const totalBytes = [...bytesByLang.values()].reduce((a, b) => a + b, 0);
  const languages = [...bytesByLang.entries()]
    .sort((a, b) => b[1] - a[1]) // stable: ties keep first-seen order
    .map(([name, bytes]) => ({ name, pct: totalBytes === 0 ? 0 : Math.round((bytes * 100) / totalBytes), bytes }));

  // topRepos: by stars desc (stable — the query's recent-push order is the tiebreak), top 10
  topRepos.sort((a, b) => b.stars - a.stars);

  // externalPRs: PRs to repos NOT owned by the viewer
  const login = asString(path(viewer, "login"), "");
  let externalPRs = 0;
  for (const prRepo of items(path(viewer, "contributionsCollection", "pullRequestContributionsByRepository"))) {
    if (asString(path(prRepo, "repository", "owner", "login"), "") !== login) {
      externalPRs += asInt(path(prRepo, "contributions", "totalCount"), 0);
    }
  }

  return canonicalize({
    login,
    name: asString(path(viewer, "name"), ""),
    avatarUrl: asString(path(viewer, "avatarUrl"), ""),
    joinedYear: parseYear(asString(path(viewer, "createdAt"), "")),
    publicRepos: asInt(path(viewer, "repositories", "totalCount"), 0),
    contributions: { lastYear: asInt(path(calendar, "totalContributions"), 0), weeks },
    languages,
    topRepos: topRepos.slice(0, 10),
    externalPRs,
  });
}

function parseYear(iso: string): number {
  if (iso.length < 4) return 0;
  const y = Number.parseInt(iso.slice(0, 4), 10);
  return Number.isNaN(y) ? 0 : y;
}
