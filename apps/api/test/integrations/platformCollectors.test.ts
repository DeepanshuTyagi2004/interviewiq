import { describe, expect, it } from "vitest";
import { activityWindow, linkedProfilesFrom, normalizePlatformHandle, PlatformProfileError, storeFragment, type PlatformCollector } from "../../src/integrations/platforms/common.js";
import { CodeforcesCollector, toCodeforcesFragment } from "../../src/integrations/platforms/codeforces.js";
import { toAtCoderFragment } from "../../src/integrations/platforms/atcoder.js";
import { parseCodeChefProfile } from "../../src/integrations/platforms/codechef.js";
import { TufCollector, toTufFragment } from "../../src/integrations/platforms/tuf.js";
import { PlatformConnectionService } from "../../src/integrations/platforms/service.js";
import type { PlatformConnectionRow } from "../../src/db/pg/schema.js";
import { FakeFetch, status, text } from "../support/fakeFetch.js";

const now = new Date("2026-10-05T12:00:00Z"), nowSeconds = now.getTime() / 1000, DAY = 86_400;
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (err) { return err; } return null; };

describe("handles and linked profiles", () => {
  it("accepts a bare handle, @handle or pasted profile URL, and rejects anything else", () => {
    expect(normalizePlatformHandle("CODEFORCES", "https://codeforces.com/profile/tourist")).toBe("tourist");
    expect(normalizePlatformHandle("TUF", "takeuforward.org/profile/Kirito1965")).toBe("Kirito1965");
    expect(normalizePlatformHandle("ATCODER", "@tourist")).toBe("tourist");
    expect(normalizePlatformHandle("CODECHEF", "https://www.codechef.com/users/gennady.korotkevich")).toBe("gennady.korotkevich");
    expect(normalizePlatformHandle("ATCODER", "bad handle!")).toBeNull();
    expect(normalizePlatformHandle("CODEFORCES", "")).toBeNull();
  });

  it("reads linked profiles only from real profile URLs", () => {
    expect(linkedProfilesFrom([
      { platform: "LeetCode", profile_link: "https://leetcode.com/u/aakash_42/" },
      { platform: "Codeforces", profile_link: "" }, // TUF shows synced accounts without a public link
      { platform: "GeeksforGeeks", profile_link: "https://www.geeksforgeeks.org/user/x_y/" }, // not a supported platform
      { platform: "CodeChef", profile_link: "aakash" }, // a bare word is not a profile URL
      { platform: "Others", profile_link: "https://example.com/me" },
    ])).toEqual([{ platform: "LEETCODE", handle: "aakash_42" }]);
  });

  it("counts activity relative to the fetch without storing a timestamp", () => {
    const at = (days: number) => now.getTime() - days * DAY * 1000;
    expect(activityWindow([{ at: at(1) }, { at: at(2), count: 3 }, { at: at(40) }, { at: at(400) }, { at: at(-1) }], now))
      .toEqual({ consistency: { activeWeeks: 2, windowWeeks: 52 }, recentActivity: { last30Days: 4 } });
  });
});

describe("Codeforces", () => {
  const submission = (id: string, rating: number | undefined, tags: string[], verdict = "OK", daysAgo = 3) => ({
    verdict, creationTimeSeconds: nowSeconds - daysAgo * DAY, problem: { contestId: Number.parseInt(id, 10), index: id.replace(/\d+/, ""), ...(rating ? { rating } : {}), tags },
  });

  it("minimizes to unique accepted problems by difficulty and tag, rating history and activity", () => {
    const data = toCodeforcesFragment("me", { rating: 1650, maxRating: 1700, firstName: "Private" }, [
      { ratingUpdateTimeSeconds: nowSeconds - 40 * DAY, newRating: 1600, rank: 900 }, { ratingUpdateTimeSeconds: nowSeconds - 10 * DAY, newRating: 1650, rank: 700 },
    ], [
      submission("1A", 800, ["math"]), submission("1A", 800, ["math"], "OK", 5), submission("2B", 1500, ["dp", "greedy"]),
      submission("3C", 2100, ["graphs"]), submission("4D", 1900, ["dp"], "WRONG_ANSWER"), submission("5E", undefined, ["brute force"]),
      submission("100001A", 1200, ["gym"]),
    ], now);
    expect(data).toMatchObject({ platform: "codeforces", handle: "me", info: { rating: 1650, maxRating: 1700 }, solved: { easy: 1, medium: 1, hard: 1 }, totalSolved: 4, contestsAttended: 2 });
    expect(data.byTopic).toEqual(["brute force", "dp", "graphs", "greedy", "math"].map((topic) => ({ topic, count: 1 }))); // the WA and gym problems are not counted
    expect(JSON.stringify(data)).not.toContain("Private");
    expect(data.recentActivity).toEqual({ last30Days: 6 });
  });

  it("maps the API's not-found failure to NOT_FOUND", async () => {
    const fake = new FakeFetch().on("GET", "https://cf.test/api/user.info", () => status(400, JSON.stringify({ status: "FAILED", comment: "handles: User with handle nope not found" })));
    await expect(new CodeforcesCollector("https://cf.test", fake.fetch).validate("nope")).rejects.toMatchObject({ reason: "NOT_FOUND" });
  });
});

describe("AtCoder and CodeChef", () => {
  it("AtCoder keeps rated rows only and an activity window from accepted submissions", () => {
    const data = toAtCoderFragment("me", [
      { IsRated: true, NewRating: 900, Place: 1500, EndTime: "2026-06-01T22:40:00+09:00", Performance: 1000 },
      { IsRated: false, NewRating: 0, Place: 10, EndTime: "2026-07-01T22:40:00+09:00" },
      { IsRated: true, NewRating: 1100, Place: 800, EndTime: "2026-09-01T22:40:00+09:00" },
    ], { count: 240, rank: 9000 }, [{ result: "AC", epoch_second: nowSeconds - 2 * DAY }, { result: "WA", epoch_second: nowSeconds - DAY }], now);
    expect(data).toMatchObject({ rating: 1100, highestRating: 1100, ratedMatches: 2, acceptedCount: 240, recentActivity: { last30Days: 1 } });
    expect(JSON.stringify(data)).not.toContain("Performance");
  });

  it("CodeChef parses the profile page and fails closed on an unknown or changed page", () => {
    const html = `<title>me - CodeChef User Profile with global rank 120 | CodeChef</title>
      <div class="rating-number">
        1876      </div><small>(Highest Rating 1920)</small><span>4&#9733;</span>
      <strong class='global-rank'>12,345</strong> Total Problems Solved: 210 No. of Contests Participated: <b>31</b>
      <script>var all_rating = [{"code":"START1","rating":"1700","rank":"900","end_date":"2026-01-10 22:00:00"},{"code":"START2","rating":"1876","rank":"300","end_date":"2026-08-10 22:00:00"}];</script>`;
    expect(parseCodeChefProfile("me", html)).toEqual({ platform: "codechef", handle: "me", rating: 1876, highestRating: 1920, stars: 4, globalRank: 12_345, fullySolved: 210,
      contestsAttended: 31, ratingHistory: [{ at: "2026-01-10T16:30:00.000Z", rating: 1700, rank: 900 }, { at: "2026-08-10T16:30:00.000Z", rating: 1876, rank: 300 }] });
    expect(thrown(() => parseCodeChefProfile("x", "<title>CodeChef</title>"))).toMatchObject({ reason: "NOT_FOUND" });
    expect(thrown(() => parseCodeChefProfile("x", "<title>x - CodeChef User Profile</title><div>redesigned</div>"))).toMatchObject({ reason: "UNREACHABLE" });
  });
});

describe("takeUforward", () => {
  const flight = (payload: unknown) => `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
  const page = flight(`3a:["$","$L34",null,${JSON.stringify({
    dsaProgress: { platforms: ["TUF"], byPlatform: { TUF: { platform: "TUF", solved: 294, total: 1374,
      categories: [{ label: "Basic", solved: 35, total: 214 }, { label: "Core", solved: 190, total: 844 }, { label: "Pro", solved: 69, total: 312 }],
      topics: [{ label: "Dynamic Programming", solved: 53, total: 154 }, { label: "Tries", solved: 0, total: 18 }] } } },
    initialHeatmap: { stats: { totalContributions: 6 }, heatmapData: [{ date: "2026-10-03", count: 4 }, { date: "2026-08-01", count: 2 }, { date: "2024-01-01", count: 9 }] },
    name: "Private Person", college: "Some College",
  })}]`);

  it("maps Basic/Core/Pro to easy/medium/hard and never stores names or colleges", () => {
    const data = toTufFragment("Kirito1965", page, [{ platform: "LEETCODE", handle: "k" }], now);
    expect(data).toEqual({ platform: "tuf", handle: "Kirito1965", solved: { easy: 35, medium: 190, hard: 69 }, totalSolved: 294,
      byTopic: [{ topic: "dynamic programming", count: 53 }], consistency: { activeWeeks: 2, windowWeeks: 52 }, recentActivity: { last30Days: 4 },
      linkedProfiles: [{ platform: "LEETCODE", handle: "k" }] });
    expect(JSON.stringify(data)).not.toMatch(/Private Person|Some College/);
    expect(() => toTufFragment("x", "<html></html>", [], now)).toThrow(PlatformProfileError);
  });

  it("sends the Origin header the profile API requires and returns linked profiles", async () => {
    const fake = new FakeFetch()
      .on("GET", "https://api.tuf.test/api/v1/shared/profile/get-profile/Kirito1965", { success: true, data: { personal_info: { name: "Private" },
        coding_profiles: [{ platform: "Codeforces", profile_link: "https://codeforces.com/profile/kirito" }] } })
      .on("GET", "https://tuf.test/profile/Kirito1965", () => text(page));
    const snapshot = await new TufCollector("https://tuf.test", "https://api.tuf.test", fake.fetch).collect("Kirito1965", now);
    expect(fake.calls[0]!.headers.origin).toBe("https://tuf.test");
    expect(snapshot.linkedProfiles).toEqual([{ platform: "CODEFORCES", handle: "kirito" }]);
    expect(JSON.stringify(snapshot.data)).not.toContain("Private");
  });
});

describe("PlatformConnectionService", () => {
  function harness(collect: PlatformCollector["collect"]) {
    const rows = new Map<string, PlatformConnectionRow>(), fragments = new Map<string, { _id: string; contentHash: string; version: number; data: unknown; fetchedAt: Date }>();
    const tasks: (() => Promise<unknown>)[] = [], leetcodeConnects: string[] = [];
    let n = 0;
    const row = (userId: string, platform: PlatformConnectionRow["platform"], handle: string, discoveredFrom: string | null): PlatformConnectionRow =>
      ({ id: `c${++n}`, userId, platform, handle, status: "SYNCING", discoveredFrom, connectedAt: now, lastRefreshedAt: null });
    const connections = {
      findById: async (id: string) => [...rows.values()].find((r) => r.id === id) ?? null,
      upsertSyncing: async (userId: string, platform: PlatformConnectionRow["platform"], handle: string) => { const r = row(userId, platform, handle, null); rows.set(`${userId}:${platform}`, r); return r; },
      insertIfAbsent: async (userId: string, platform: PlatformConnectionRow["platform"], handle: string, from: string) => {
        if (rows.has(`${userId}:${platform}`)) return null; const r = row(userId, platform, handle, from); rows.set(`${userId}:${platform}`, r); return r;
      },
      update: async (id: string, patch: Partial<PlatformConnectionRow>) => { for (const r of rows.values()) if (r.id === id) Object.assign(r, patch); },
      findByUserId: async (userId: string) => [...rows.values()].filter((r) => r.userId === userId),
      deleteByUserAndPlatform: async (userId: string, platform: string) => { rows.delete(`${userId}:${platform}`); },
    };
    const fragmentRepo = {
      findByUserIdAndSource: async (userId: string, source: string) => fragments.get(`${userId}:${source}`) ?? null,
      insert: async (doc: { userId: string; source: string; contentHash: string; version: number; data: unknown; fetchedAt: Date }) => { fragments.set(`${doc.userId}:${doc.source}`, { _id: `${doc.userId}:${doc.source}`, ...doc }); },
      update: async (id: string, patch: Record<string, unknown>) => { Object.assign(fragments.get(id)!, patch); },
      deleteByUserIdAndSource: async (userId: string, source: string) => { fragments.delete(`${userId}:${source}`); },
    };
    const collector = (platform: PlatformConnectionRow["platform"]): PlatformCollector => ({ platform, validate: async () => {}, collect });
    const service = new PlatformConnectionService({
      connections: connections as never, fragments: fragmentRepo as never, log: { warn: () => {}, info: () => {} } as never,
      collectors: [collector("TUF"), collector("CODEFORCES"), collector("CODECHEF")],
      background: { run: (_name: string, task: () => Promise<unknown>) => { tasks.push(task); } } as never,
      leetcode: { connections: { findByUserId: async () => null } as never, connect: async (_u: string, handle: string) => { leetcodeConnects.push(handle); } },
      now: () => now,
    });
    const drain = async () => { while (tasks.length) await tasks.shift()!(); };
    return { service, rows, fragments, drain, leetcodeConnects };
  }

  it("collects in the background, stores with hash-skip and connects linked profiles without replacing the user's own", async () => {
    const h = harness(async (handle) => ({ data: { platform: "x", handle, totalSolved: 10 },
      linkedProfiles: handle === "kirito" ? [{ platform: "CODEFORCES", handle: "linked_cf" }, { platform: "CODECHEF", handle: "linked_cc" }, { platform: "LEETCODE", handle: "linked_lc" }] : [] }));
    await h.service.connect("u1", "CODECHEF", "my_cc");
    await h.service.connect("u1", "TUF", "https://takeuforward.org/profile/kirito");
    await h.drain();
    expect(h.rows.get("u1:TUF")).toMatchObject({ handle: "kirito", status: "SYNCED" });
    expect(h.rows.get("u1:CODECHEF")).toMatchObject({ handle: "my_cc", discoveredFrom: null }); // never replaced
    expect(h.rows.get("u1:CODEFORCES")).toMatchObject({ handle: "linked_cf", discoveredFrom: "TUF", status: "SYNCED" });
    expect(h.leetcodeConnects).toEqual(["linked_lc"]);
    const first = h.fragments.get("u1:TUF")!;
    await h.service.refresh(h.rows.get("u1:TUF")!);
    expect(h.fragments.get("u1:TUF")!.version).toBe(first.version); // unchanged content: no new version
  });

  it("removes a connection to a platform that is no longer supported, with its data", async () => {
    const h = harness(async (handle) => ({ data: { platform: "x", handle }, linkedProfiles: [] }));
    const old = { id: "old", userId: "u1", platform: "RETIRED" as never, handle: "me", status: "SYNCED" as const, discoveredFrom: null, connectedAt: now, lastRefreshedAt: null };
    h.rows.set("u1:RETIRED", old);
    h.fragments.set("u1:RETIRED", { _id: "u1:RETIRED", contentHash: "h", version: 1, data: {}, fetchedAt: now });
    await h.service.refresh(old);
    expect(h.rows.has("u1:RETIRED") || h.fragments.has("u1:RETIRED")).toBe(false);
  });

  it("rejects an invalid handle, marks an unknown handle DEGRADED and keeps the last good fragment", async () => {
    let missing = false;
    const h = harness(async (handle) => { if (missing) throw new PlatformProfileError("NOT_FOUND", "gone"); return { data: { platform: "x", handle }, linkedProfiles: [] }; });
    await expect(h.service.connect("u1", "CODEFORCES", "not a handle!")).rejects.toMatchObject({ reason: "INVALID_HANDLE" });
    await h.service.connect("u1", "CODEFORCES", "me");
    await h.drain();
    missing = true;
    await h.service.refresh(h.rows.get("u1:CODEFORCES")!);
    expect(h.rows.get("u1:CODEFORCES")!.status).toBe("DEGRADED");
    expect(h.fragments.get("u1:CODEFORCES")).toBeDefined();
    await h.service.disconnect("u1", "CODEFORCES");
    expect(h.rows.has("u1:CODEFORCES") || h.fragments.has("u1:CODEFORCES")).toBe(false);
  });

  it("stores canonical fragments: key order does not change the hash, new content bumps the version", async () => {
    let stored: { _id: string; contentHash: string; version: number } | null = null;
    const repo = { findByUserIdAndSource: async () => stored, insert: async (doc: { contentHash: string; version: number }) => { stored = { _id: "f", ...doc }; },
      update: async (_id: string, patch: Record<string, unknown>) => { stored = { ...stored!, ...patch } as typeof stored; } };
    expect(await storeFragment(repo as never, "u", "TUF", { b: 1, a: 2 }, now)).toBe("inserted");
    expect(await storeFragment(repo as never, "u", "TUF", { a: 2, b: 1 }, now)).toBe("unchanged");
    expect(await storeFragment(repo as never, "u", "TUF", { a: 3, b: 1 }, now)).toBe("updated");
    expect(stored!.version).toBe(2);
  });
});
