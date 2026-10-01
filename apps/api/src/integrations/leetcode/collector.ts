import type { LeetCodeConnectionRow } from "../../db/pg/schema.js";
import { sleep } from "../../lib/background.js";
import { canonicalize, sha256Hex } from "../../lib/canonicalJson.js";
import { type FetchLike, requestText, UpstreamHttpError, UpstreamTransportError } from "../../lib/http.js";
import { asDouble, asInt, asString, isObject, items, path } from "../../lib/json.js";
import type { Logger } from "../../lib/logger.js";
import type { ProfileFragmentRepository } from "../../repositories/mongo.js";
import { LeetCodeProfileError } from "./errors.js";

/** Lightweight validation query used by connect — just enough to tell exists/public apart. */
export const VALIDATE_QUERY = `
query validate($username: String!) {
  matchedUser(username: $username) {
    username
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}
`;

/** Call 1 — profile, solve stats by difficulty, tag-wise solved counts. */
export const PROFILE_QUERY = `
query userProfile($username: String!) {
  matchedUser(username: $username) {
    username
    profile { realName countryName }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    tagProblemCounts {
      advanced { tagName problemsSolved }
      intermediate { tagName problemsSolved }
      fundamental { tagName problemsSolved }
    }
  }
}
`;

/** Call 2 — contest stats (null when the user has never entered a contest). */
export const CONTEST_QUERY = `
query contest($username: String!) {
  userContestRanking(username: $username) {
    attendedContestsCount
    rating
    globalRanking
    totalParticipants
    topPercentage
  }
}
`;

/** Call 3 — recent accepted submissions (drives last-30-day count + preferred language). */
export const RECENT_QUERY = `
query recent($username: String!) {
  recentAcSubmissionList(username: $username, limit: 20) {
    id title titleSlug timestamp lang
  }
}
`;

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
const RECENT_WINDOW_SECONDS = 30 * 24 * 60 * 60;

/** Outcome of a collection run, so the caller can map it to the right connection status. */
export type CollectResult = "STORED" | "UNCHANGED" | "NULL_USER";

/**
 * Fetches a user's public LeetCode data via the public GraphQL endpoint (no OAuth, no token),
 * normalizes it into the canonical fragment shape, and upserts it only when the content hash
 * changes (mirrors the GitHub collector).
 */
export class LeetCodeCollector {
  constructor(
    private readonly graphqlUrl: string,
    private readonly fragments: ProfileFragmentRepository,
    private readonly fetchImpl: FetchLike,
    private readonly log: Logger,
    private readonly backoffBaseMs = BACKOFF_BASE_MS,
  ) {}

  /**
   * Confirms the username exists and its stats are public. Throws USERNAME_NOT_FOUND or
   * PROFILE_PRIVATE otherwise. One lightweight call.
   */
  async validateProfile(username: string): Promise<void> {
    const data = await this.postGraphQl(VALIDATE_QUERY, username);
    const matchedUser = path(data, "matchedUser");
    if (matchedUser === undefined || matchedUser === null) {
      throw new LeetCodeProfileError("USERNAME_NOT_FOUND", `LeetCode user not found: ${username}`);
    }
    // Best-effort privacy check: LeetCode's public GraphQL has no clean "private" flag. A present
    // matchedUser with no submit stats is treated as private. HUMAN REVIEW: confirm this heuristic
    // against a genuinely-private account before relying on it in production.
    if (!Array.isArray(path(matchedUser, "submitStatsGlobal", "acSubmissionNum"))) {
      throw new LeetCodeProfileError("PROFILE_PRIVATE", `LeetCode profile is not public: ${username}`);
    }
  }

  /**
   * Fetch all three queries, normalize, hash, and upsert when the hash changed. The optional
   * queries (contest, recent) are tolerated on failure and flag the fragment `partial`.
   */
  async collectAndStore(connection: LeetCodeConnectionRow): Promise<CollectResult> {
    const username = connection.username;

    // Call 1 is required. A null matchedUser here means the profile vanished post-connect.
    const profileData = await this.postGraphQl(PROFILE_QUERY, username);
    const matchedUser = path(profileData, "matchedUser");
    if (matchedUser === undefined || matchedUser === null) return "NULL_USER";

    let partial = false;
    let contestData: unknown = null;
    try {
      contestData = await this.postGraphQl(CONTEST_QUERY, username);
    } catch (err) {
      if (!(err instanceof LeetCodeProfileError)) throw err;
      partial = true;
      this.log.warn(`LeetCode contest query failed for ${username} (${err.code}); storing partial fragment`);
    }

    let recentData: unknown = null;
    try {
      recentData = await this.postGraphQl(RECENT_QUERY, username);
    } catch (err) {
      if (!(err instanceof LeetCodeProfileError)) throw err;
      partial = true;
      this.log.warn(`LeetCode recent-submissions query failed for ${username} (${err.code}); storing partial fragment`);
    }

    const canonical = toLeetCodeFragmentJson(profileData, contestData, recentData, new Date(), partial);
    const hash = sha256Hex(canonical);
    const now = new Date();

    const existing = await this.fragments.findByUserIdAndSource(connection.userId, "LEETCODE");
    if (!existing) {
      await this.fragments.insert({
        userId: connection.userId,
        source: "LEETCODE",
        data: JSON.parse(canonical) as Record<string, unknown>,
        contentHash: hash,
        version: 1,
        fetchedAt: now,
      });
      return "STORED";
    }
    if (existing.contentHash === hash) {
      await this.fragments.update(existing._id, { fetchedAt: now });
      return "UNCHANGED";
    }
    await this.fragments.update(existing._id, {
      data: JSON.parse(canonical) as Record<string, unknown>,
      contentHash: hash,
      version: existing.version + 1,
      fetchedAt: now,
    });
    return "STORED";
  }

  /**
   * POST a GraphQL query and return its `data` node. Retries 429 / 5xx / transport errors with
   * exponential backoff; other 4xx and "no data at all" are not retried. A `data` with a null
   * business field (e.g. matchedUser null) is returned as-is — the caller decides what null means.
   */
  private async postGraphQl(query: string, username: string): Promise<unknown> {
    const body = JSON.stringify({ query, variables: { username } });
    let last: LeetCodeProfileError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const text = await requestText(this.fetchImpl, {
          method: "POST",
          url: this.graphqlUrl,
          headers: { Referer: "https://leetcode.com", "User-Agent": "interviewiq-backend", "Content-Type": "application/json" },
          body,
          timeoutMs: 30_000,
        });
        let root: unknown;
        try {
          root = JSON.parse(text);
        } catch (err) {
          throw new LeetCodeProfileError("UNREACHABLE", "LeetCode GraphQL returned a non-JSON body", { cause: err });
        }
        const data = path(root, "data");
        if (data === undefined || data === null) {
          // No data at all => an unhandled GraphQL error, not an expected business null.
          const errors = isObject(root) ? JSON.stringify(root.errors ?? null) : "null";
          throw new LeetCodeProfileError("UNREACHABLE", `LeetCode GraphQL returned no data: ${errors}`);
        }
        return data;
      } catch (err) {
        if (err instanceof LeetCodeProfileError) throw err; // already classified
        if (err instanceof UpstreamHttpError) {
          if (err.status === 429) {
            last = new LeetCodeProfileError("RATE_LIMITED", "LeetCode rate-limited (429)", { cause: err });
          } else if (err.status >= 500) {
            last = new LeetCodeProfileError("UNREACHABLE", `LeetCode server error (${err.status})`, { cause: err });
          } else {
            // Other 4xx are not retryable.
            throw new LeetCodeProfileError("UNREACHABLE", `LeetCode request failed (${err.status})`, { cause: err });
          }
        } else if (err instanceof UpstreamTransportError) {
          last = new LeetCodeProfileError("UNREACHABLE", `LeetCode unreachable: ${err.message}`, { cause: err });
        } else {
          throw err;
        }
      }
      if (attempt < MAX_ATTEMPTS) await sleep(this.backoffBaseMs * 2 ** (attempt - 1));
    }
    throw last ?? new LeetCodeProfileError("UNREACHABLE", "LeetCode request failed");
  }
}

/**
 * Map the three raw GraphQL `data` nodes into the normalized fragment and return canonical
 * (key-sorted) JSON. `now` is injected so the 30-day window is deterministic. Pure — exported for tests.
 */
export function toLeetCodeFragmentJson(
  profileData: unknown,
  contestData: unknown,
  recentData: unknown,
  now: Date,
  partial: boolean,
): string {
  const matchedUser = path(profileData, "matchedUser");

  // solved split by difficulty (acSubmissionNum entries: All / Easy / Medium / Hard)
  let easy = 0;
  let medium = 0;
  let hard = 0;
  let total = 0;
  for (const entry of items(path(matchedUser, "submitStatsGlobal", "acSubmissionNum"))) {
    const count = asInt(path(entry, "count"), 0);
    switch (asString(path(entry, "difficulty"), "")) {
      case "Easy":
        easy = count;
        break;
      case "Medium":
        medium = count;
        break;
      case "Hard":
        hard = count;
        break;
      case "All":
        total = count;
        break;
      default: // ignore unknown buckets
    }
  }

  // tag-wise solved counts merged across all three tiers, count desc then topic asc — no cap
  const byTopic: { topic: string; count: number }[] = [];
  const tags = path(matchedUser, "tagProblemCounts");
  for (const tier of ["advanced", "intermediate", "fundamental"]) {
    for (const tag of items(path(tags, tier))) {
      const count = asInt(path(tag, "problemsSolved"), 0);
      const topic = asString(path(tag, "tagName"), "");
      if (count > 0 && topic !== "") byTopic.push({ topic, count });
    }
  }
  byTopic.sort((a, b) => b.count - a.count || compareStrings(a.topic, b.topic));

  // contest stats — null when the user has never entered a contest
  const c = path(contestData, "userContestRanking");
  const contest = isObject(c)
    ? {
        attended: asInt(c.attendedContestsCount, 0),
        rating: Math.round(asDouble(c.rating, 0)),
        globalRanking: asInt(c.globalRanking, 0),
        totalParticipants: asInt(c.totalParticipants, 0),
        topPercent: Math.round(asDouble(c.topPercentage, 0) * 100) / 100,
      }
    : null;

  // recent activity — last-30-day accepted count + preferred (most-frequent) language
  const cutoff = Math.floor(now.getTime() / 1000) - RECENT_WINDOW_SECONDS;
  let last30Days = 0;
  const langCounts = new Map<string, number>();
  for (const sub of items(path(recentData, "recentAcSubmissionList"))) {
    if (parseEpochSeconds(asString(path(sub, "timestamp"), "")) >= cutoff) last30Days++;
    const lang = asString(path(sub, "lang"), "");
    if (lang !== "") langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  const preferredLanguage =
    [...langCounts.entries()].sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]))[0]?.[0] ?? null;

  return canonicalize({
    username: asString(path(matchedUser, "username"), ""),
    country: asString(path(matchedUser, "profile", "countryName"), ""),
    solved: { easy, medium, hard, total: total > 0 ? total : easy + medium + hard },
    byTopic,
    contest,
    recentActivity: { last30Days, preferredLanguage },
    // streak: LeetCode does not expose it on public profiles
    streak: null,
    partial,
  });
}

function parseEpochSeconds(value: string): number {
  const t = value.trim();
  return /^[-+]?\d+$/.test(t) ? Number.parseInt(t, 10) : 0;
}

/** Java String.compareTo order (UTF-16 code units). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
