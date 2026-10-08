import type { FetchLike } from "../../lib/http.js";
import { asInt, asString, items, path } from "../../lib/json.js";
import { activityWindow, getJson, type PlatformCollector, type PlatformSnapshot } from "./common.js";

const DAY_SECONDS = 86_400;

/**
 * AtCoder: official rated-contest history JSON plus AtCoder Problems (kenkoooo) for the accepted
 * count and one page of last-year submissions for activity (analyzer spec: docs/sources/platform-analyzers.md).
 */
export class AtCoderCollector implements PlatformCollector {
  readonly platform = "ATCODER" as const;
  constructor(private readonly atcoderUrl: string, private readonly problemsUrl: string, private readonly fetchImpl: FetchLike) {}

  async validate(handle: string): Promise<void> {
    await getJson(this.fetchImpl, `${this.atcoderUrl}/users/${encodeURIComponent(handle)}/history/json`, "AtCoder history");
  }

  async collect(handle: string, now: Date): Promise<PlatformSnapshot> {
    const user = encodeURIComponent(handle);
    const history = await getJson(this.fetchImpl, `${this.atcoderUrl}/users/${user}/history/json`, "AtCoder history");
    // AtCoder Problems is a community service: best-effort, never fails the collection.
    const rank = await getJson(this.fetchImpl, `${this.problemsUrl}/atcoder-api/v3/user/ac_rank?user=${user}`, "AtCoder Problems ac_rank").catch(() => null);
    const since = Math.floor(now.getTime() / 1000) - 365 * DAY_SECONDS;
    const submissions = await getJson(this.fetchImpl, `${this.problemsUrl}/atcoder-api/v3/user/submissions?user=${user}&from_second=${since}`, "AtCoder Problems submissions").catch(() => null);
    return { data: toAtCoderFragment(handle, history, rank, submissions, now), linkedProfiles: [] };
  }
}

/** Pure: rated history rows (only the fields scoring reads), accepted count and an activity window. */
export function toAtCoderFragment(handle: string, history: unknown, rank: unknown, submissions: unknown, now: Date): Record<string, unknown> {
  const rows = items(history).filter((row) => path(row, "IsRated") === true)
    .map((row) => ({ IsRated: true, NewRating: asInt(path(row, "NewRating"), 0), Place: asInt(path(row, "Place"), 0) || null, EndTime: asString(path(row, "EndTime"), "") }))
    .filter((row) => row.NewRating > 0 && row.EndTime).slice(-200);
  const ratings = rows.map((row) => row.NewRating);
  const accepted = submissions === null ? null : items(submissions).filter((sub) => path(sub, "result") === "AC").map((sub) => ({ at: asInt(path(sub, "epoch_second"), 0) * 1000 })).filter((x) => x.at > 0);
  const acceptedCount = asInt(path(rank, "count"), -1);
  return {
    platform: "atcoder", handle,
    rating: ratings.at(-1) ?? null, highestRating: ratings.length ? Math.max(...ratings) : null,
    history: rows, ratedMatches: rows.length,
    ...(acceptedCount >= 0 ? { acceptedCount } : {}),
    ...(accepted ? activityWindow(accepted, now) : {}),
  };
}
