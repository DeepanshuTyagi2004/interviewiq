# Coding-platform analyzers

Analyzer specs for the handle-based coding-platform sources: Codeforces, AtCoder, CodeChef and
takeUforward (TUF). Each entry lists the endpoint, what we extract, what we skip, the
fragment shape stored in `profile_fragments` and the refresh cadence. LeetCode and GitHub have
their own collectors and are not repeated here.

Shared rules:

- **Handle only, no login.** The user types a handle or pastes a profile URL. We read public data
  only and never ask for platform credentials.
- **The data is taken as correct.** A handle is not ownership-verified (same as LeetCode). The user
  disconnects a wrong handle.
- **Minimized fragments.** We store aggregates, never raw submission lists, source code, names,
  colleges, avatars or locations. The descriptive profile and the scoring engine both read the same
  fragment.
- **Hash-skip.** The canonical JSON is hashed and the fragment is only rewritten (and synthesis only
  triggered) when the hash changes. Activity windows are counts relative to the fetch, with no
  timestamp in the payload.
- **Refresh.** Weekly, in the shared `platform-refresh` job. A failed refresh keeps the last good
  fragment and marks the connection `FAILED`; a missing handle marks it `DEGRADED`.
- **Outbound HTTP** goes through `lib/http.ts` with timeouts, a polite `User-Agent` and at most a
  handful of requests per user per refresh.

## Codeforces (official API)

- **Endpoints:** `GET https://codeforces.com/api/user.info?handles=H`, `user.rating?handle=H`,
  `user.status?handle=H&from=1&count=10000`.
- **Extract:**
  - Current and max rating.
  - Rated-contest history: date, rating and rank.
  - Unique accepted problems, bucketed by problem rating (≤1200 easy, ≤1800 medium, harder hard),
    with per-tag solve counts.
  - Active weeks in the last 52 and accepted submissions in the last 30 days.
- **Skip:** contribution and friend counts, rank title strings, organization, city, names, photos,
  unrated problems in the difficulty buckets (they still count toward `totalSolved`), gym and virtual
  submissions.
- **Fragment:**
  ```
  { platform: "codeforces", handle,
    info: { rating, maxRating },
    ratingHistory: [{ at, rating, rank }],
    solved: { easy, medium, hard },
    totalSolved,
    byTopic: [{ topic, count }],
    consistency: { activeWeeks, windowWeeks },
    recentActivity: { last30Days } }
  ```
- **Failure:** a `FAILED` API status with "not found" means an unknown handle (rejected on connect).

## AtCoder (official history JSON + AtCoder Problems)

- **Endpoints:**
  - `GET https://atcoder.jp/users/H/history/json`: rated contests with `NewRating`, `Place` and `EndTime`.
  - `GET https://kenkoooo.com/atcoder/atcoder-api/v3/user/ac_rank?user=H`: accepted count.
  - `.../v3/user/submissions?user=H&from_second=<now-365d>`: one page of up to 500 submissions,
    used only for activity.
- **Extract:** rating, highest rating, rated-contest history, accepted problem count, active weeks
  and last-30-day accepted submissions.
- **Skip:** performance values, unrated contests, the multi-megabyte problem-difficulty model (so
  AtCoder contributes contest and activity signals, not difficulty buckets).
- **Fragment:**
  ```
  { platform: "atcoder", handle,
    rating, highestRating, acceptedCount,
    history: [{ IsRated, NewRating, Place, EndTime }],
    consistency: { activeWeeks, windowWeeks },
    recentActivity: { last30Days } }
  ```
- **Failure:** a 404 on the history URL means an unknown handle. An empty history means the user
  has no rated contests: the fragment is still stored, it just carries no contest signals.

## CodeChef (public profile page)

- **Endpoint:** `GET https://www.codechef.com/users/H` (HTML). CodeChef has no public API, so this
  scrapes the profile page.
- **Extract:**
  - The current rating (the first `rating-number`), the highest rating and the star count.
  - The global rank.
  - "Total Problems Solved" and "No. of Contests Participated".
  - The `all_rating` contest history: end date, rating and rank.
- **Skip:** name, institution, country, badges, the daily submission heatmap (format not stable).
- **Fragment:**
  ```
  { platform: "codechef", handle,
    rating, highestRating, stars, globalRank,
    fullySolved, contestsAttended,
    ratingHistory: [{ at, rating, rank }] }
  ```
- **Failure:** a redirect away from `/users/H`, or a page without a rating block, means an unknown
  handle. The markup can change; the parser fails closed (`FAILED`) and keeps the old fragment.

## takeUforward (TUF profile page + public profile API)

- **Endpoints:**
  - `GET https://takeuforward.org/profile/H` (HTML): the Next.js flight payload carries
    `dsaProgress.byPlatform.TUF` and `initialHeatmap`.
  - `GET https://backend-go.takeuforward.org/api/v1/shared/profile/get-profile/H` (needs an `Origin`
    header): `data.coding_profiles` lists the platforms the user linked on TUF.
- **Extract:**
  - Solved counts per sheet tier (Basic, Core and Pro map to easy, medium and hard).
  - Total solved and per-topic solve counts.
  - From the heatmap dates: active weeks in the last 52 and contributions in the last 30 days.
  - Linked LeetCode, Codeforces, CodeChef and AtCoder handles, parsed from their
    profile links.
- **Linked profiles:** a discovered handle is connected automatically when the user has no
  connection for that platform yet (`discoveredFrom: "tuf"`), so its own collector runs. A platform
  the user connected themselves is never replaced. Empty links (which TUF shows for "synced" accounts
  without a public link) are ignored.
- **Skip:** name, college, profile image, social links, skills/languages free text, the per-topic
  `total` denominators (they describe TUF's catalogue, not the user).
- **Fragment:**
  ```
  { platform: "tuf", handle,
    solved: { easy, medium, hard },
    totalSolved,
    byTopic: [{ topic, count }],
    consistency: { activeWeeks, windowWeeks },
    recentActivity: { last30Days },
    linkedProfiles: [{ platform, handle }] }
  ```
- **Note:** the TUF heatmap aggregates TUF with the user's synced platforms. In scoring, each signal
  takes the best platform rather than a sum, so this never double-counts.

## HackerEarth: not collected

HackerEarth profiles are rendered client-side and the old public endpoints are gone, so there is no
public source to read. The scoring adapter stays in place for a future data source. ICPC and other
contest results come from resume achievements, through the competition knowledge base.
