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
        isPrivate
        description
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

/**
 * Merged pull requests the user authored in public repositories outside their own namespace
 * (open-source contribution evidence). File paths are read only to tell docs-only changes apart and
 * are not stored.
 */
export const GITHUB_MERGED_PRS_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        title
        mergedAt
        additions
        deletions
        changedFiles
        files(first: 30) { nodes { path } }
        repository { nameWithOwner stargazerCount isPrivate isFork owner { login } }
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
    // Best-effort READMEs for the top public repositories (project context for semantic scoring).
    const readmes = await this.fetchReadmes(accessToken, root).catch(() => null);
    // Best-effort merged external PRs (open-source contribution scoring).
    const mergedPRs = await this.fetchMergedPullRequests(accessToken, asString(path(root, "data", "viewer", "login"), "")).catch(() => null);
    const canonical = toGitHubFragmentJson(root, readmes, mergedPRs);
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

  /** One aliased query for up to six public, non-fork repositories; private repositories are never read. */
  private async fetchReadmes(accessToken: string, root: unknown): Promise<unknown> {
    const repos = topPublicRepos(root);
    if (!repos.length) return null;
    const fields = repos.map((name, i) => `r${i}: repository(name: ${JSON.stringify(name)}) { name description object(expression: "HEAD:README.md") { ... on Blob { text } } }`).join("\n");
    const response = await requestJson(this.fetchImpl, {
      method: "POST",
      url: this.graphqlUrl,
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "interviewiq-backend", "Content-Type": "application/json" },
      body: JSON.stringify({ query: `query {\n  viewer {\n${fields}\n  }\n}` }),
      timeoutMs: 30_000,
    });
    return isObject(response) && !("errors" in response) ? response : null;
  }

  private async fetchMergedPullRequests(accessToken: string, login: string): Promise<unknown> {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) return null;
    const response = await requestJson(this.fetchImpl, {
      method: "POST",
      url: this.graphqlUrl,
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "interviewiq-backend", "Content-Type": "application/json" },
      body: JSON.stringify({ query: GITHUB_MERGED_PRS_QUERY, variables: { q: `author:${login} is:pr is:merged is:public -user:${login} sort:updated-desc` } }),
      timeoutMs: 30_000,
    });
    return isObject(response) && !("errors" in response) ? response : null;
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
/** Top public, non-fork repositories by stars (query order breaks ties), at most six. */
export function topPublicRepos(root: unknown): string[] {
  return items(path(root, "data", "viewer", "repositories", "nodes"))
    .filter((repo) => !asBoolean(path(repo, "isFork"), false) && path(repo, "isPrivate") === false)
    .map((repo, order) => ({ name: asString(path(repo, "name"), ""), stars: asInt(path(repo, "stargazerCount"), 0), order }))
    .filter((repo) => /^[A-Za-z0-9._-]{1,100}$/.test(repo.name))
    .sort((a, b) => b.stars - a.stars || a.order - b.order)
    .slice(0, 6).map((repo) => repo.name);
}

export function toGitHubFragmentJson(root: unknown, readmeRoot: unknown = null, mergedRoot: unknown = null): string {
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
    // Only when READMEs were fetched, so existing canonical fragments stay byte-identical.
    ...(readmes(readmeRoot).length ? { readmes: readmes(readmeRoot) } : {}),
    ...(mergedPullRequests(mergedRoot, login).length ? { mergedPullRequests: mergedPullRequests(mergedRoot, login) } : {}),
  });
}

const DOC_PATH = /(?:^|\/)(?:docs?|documentation)\/|\.(?:md|mdx|markdown|rst|txt|adoc)$/i;
/** Two significant figures, so a popular repository's star drift does not change the fragment hash every week. */
const roughStars = (stars: number) => stars < 100 ? stars : Number(stars.toPrecision(2));

/** Merged PRs to public, non-fork repositories the viewer does not own. */
export function mergedPullRequests(mergedRoot: unknown, login: string): { repo: string; stars: number; additions: number; deletions: number; changedFiles: number; docsOnly: boolean; mergedAt: string; title: string }[] {
  return items(path(mergedRoot, "data", "search", "nodes")).flatMap((pr) => {
    const repo = path(pr, "repository"), owner = asString(path(repo, "owner", "login"), "");
    const name = asString(path(repo, "nameWithOwner"), ""), mergedAt = asString(path(pr, "mergedAt"), "");
    if (!name || !mergedAt || path(repo, "isPrivate") !== false || asBoolean(path(repo, "isFork"), false) || owner.toLowerCase() === login.toLowerCase()) return [];
    const files = items(path(pr, "files", "nodes")).map((file) => asString(path(file, "path"), "")), changedFiles = asInt(path(pr, "changedFiles"), 0);
    return [{ repo: name, stars: roughStars(asInt(path(repo, "stargazerCount"), 0)), additions: asInt(path(pr, "additions"), 0), deletions: asInt(path(pr, "deletions"), 0), changedFiles,
      docsOnly: files.length > 0 && files.length >= changedFiles && files.every((file) => DOC_PATH.test(file)), mergedAt, title: asString(path(pr, "title"), "").slice(0, 120) }];
  }).sort((a, b) => b.mergedAt.localeCompare(a.mergedAt) || a.repo.localeCompare(b.repo));
}

/** Clipped README text (markdown noise stripped) + description per fetched public repository. */
function readmes(readmeRoot: unknown): { repo: string; description: string; text: string }[] {
  const viewer = path(readmeRoot, "data", "viewer");
  if (!isObject(viewer)) return [];
  return Object.keys(viewer).sort().flatMap((alias) => {
    const repo = viewer[alias], name = asString(path(repo, "name"), "");
    const raw = asString(path(repo, "object", "text"), "");
    const text = raw.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/<[^>]+>/g, " ").replace(/[#*_>`|-]{2,}/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
    return name && text.length >= 40 ? [{ repo: name, description: asString(path(repo, "description"), "").slice(0, 300), text }] : [];
  });
}

function parseYear(iso: string): number {
  if (iso.length < 4) return 0;
  const y = Number.parseInt(iso.slice(0, 4), 10);
  return Number.isNaN(y) ? 0 : y;
}
