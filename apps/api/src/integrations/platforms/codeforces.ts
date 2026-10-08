import type { FetchLike } from "../../lib/http.js";
import { asInt, asString, isObject, items, path } from "../../lib/json.js";
import { activityWindow, getText, PlatformProfileError, USER_AGENT, type PlatformCollector, type PlatformSnapshot } from "./common.js";

/** Codeforces official API: user.info, user.rating, user.status (analyzer spec: docs/sources/platform-analyzers.md). */
export class CodeforcesCollector implements PlatformCollector {
  readonly platform = "CODEFORCES" as const;
  constructor(private readonly baseUrl: string, private readonly fetchImpl: FetchLike) {}

  async validate(handle: string): Promise<void> {
    await this.api("user.info", `handles=${encodeURIComponent(handle)}`);
  }

  async collect(handle: string, now: Date): Promise<PlatformSnapshot> {
    const info = items(await this.api("user.info", `handles=${encodeURIComponent(handle)}`))[0];
    const rating = await this.api("user.rating", `handle=${encodeURIComponent(handle)}`);
    const status = await this.api("user.status", `handle=${encodeURIComponent(handle)}&from=1&count=10000`);
    return { data: toCodeforcesFragment(handle, info, rating, status, now), linkedProfiles: [] };
  }

  /** The API answers 400 {status:"FAILED", comment:"... not found"} for an unknown handle. */
  private async api(method: string, query: string): Promise<unknown> {
    let text: string;
    try {
      text = await getText(this.fetchImpl, `${this.baseUrl}/api/${method}?${query}`, `Codeforces ${method}`, { "User-Agent": USER_AGENT });
    } catch (err) {
      const body = (err as { cause?: { responseBody?: unknown } }).cause?.responseBody;
      if (typeof body === "string" && /not found/i.test(body)) throw new PlatformProfileError("NOT_FOUND", "Codeforces handle not found", { cause: err });
      throw err;
    }
    let root: unknown;
    try { root = JSON.parse(text); } catch (err) { throw new PlatformProfileError("UNREACHABLE", `Codeforces ${method}: response was not JSON`, { cause: err }); }
    if (path(root, "status") !== "OK") {
      if (/not found/i.test(asString(path(root, "comment"), ""))) throw new PlatformProfileError("NOT_FOUND", "Codeforces handle not found");
      throw new PlatformProfileError("UNREACHABLE", `Codeforces ${method} returned ${asString(path(root, "status"), "no status")}`);
    }
    return path(root, "result");
  }
}

/**
 * Minimized fragment: unique accepted problems bucketed by problem rating, per-tag counts over those
 * problems, rated-contest history and an activity window. Submission lists are never stored. Pure.
 */
export function toCodeforcesFragment(handle: string, info: unknown, ratingRows: unknown, submissions: unknown, now: Date): Record<string, unknown> {
  const solved = new Map<string, { rating: number | null; tags: string[] }>();
  const accepted: { at: number }[] = [];
  for (const sub of items(submissions)) {
    if (asString(path(sub, "verdict"), "") !== "OK") continue;
    const at = asInt(path(sub, "creationTimeSeconds"), 0) * 1000;
    if (at > 0) accepted.push({ at });
    const contestId = asInt(path(sub, "problem", "contestId"), 0), index = asString(path(sub, "problem", "index"), "");
    // Gym problems (contest ids >= 100000) are user-made sets without difficulty ratings.
    if (!contestId || contestId >= 100_000 || !index) continue;
    const id = `${contestId}${index}`, rating = asInt(path(sub, "problem", "rating"), 0);
    if (!solved.has(id)) solved.set(id, { rating: rating >= 800 ? rating : null, tags: items(path(sub, "problem", "tags")).filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase()) });
  }
  const buckets = { easy: 0, medium: 0, hard: 0 }, tags = new Map<string, number>();
  for (const problem of solved.values()) {
    if (problem.rating !== null) buckets[problem.rating <= 1200 ? "easy" : problem.rating <= 1800 ? "medium" : "hard"]++;
    for (const tag of new Set(problem.tags)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  const history = items(ratingRows).map((row) => ({ at: asInt(path(row, "ratingUpdateTimeSeconds"), 0), rating: asInt(path(row, "newRating"), 0), rank: asInt(path(row, "rank"), 0) || null }))
    .filter((row) => row.at > 0 && row.rating > 0).sort((a, b) => a.at - b.at).slice(-200);
  const { consistency, recentActivity } = activityWindow(accepted, now);
  return {
    platform: "codeforces", handle,
    info: { rating: isObject(info) ? asInt(info.rating, 0) || null : null, maxRating: isObject(info) ? asInt(info.maxRating, 0) || null : null },
    ratingHistory: history,
    solved: buckets, totalSolved: solved.size,
    byTopic: [...tags].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
    contestsAttended: history.length,
    consistency, recentActivity,
  };
}
