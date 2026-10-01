import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeetCodeConnectionRow } from "../../src/db/pg/schema.js";
import {
  CONTEST_QUERY,
  LeetCodeCollector,
  PROFILE_QUERY,
  RECENT_QUERY,
  toLeetCodeFragmentJson,
  VALIDATE_QUERY,
} from "../../src/integrations/leetcode/collector.js";
import { LEETCODE_REASONS, LeetCodeProfileError } from "../../src/integrations/leetcode/errors.js";
import { LeetCodeCollectionJob, LeetCodeService, normalizeLeetCodeUsername } from "../../src/integrations/leetcode/service.js";
import { BackgroundTasks } from "../../src/lib/background.js";
import { canonicalize, sha256Hex } from "../../src/lib/canonicalJson.js";
import { InvalidArgumentError } from "../../src/lib/errors.js";
import { silentLogger } from "../../src/lib/logger.js";
import { ProfileFragmentRepository } from "../../src/repositories/mongo.js";
import { LeetCodeConnectionRepository } from "../../src/repositories/pg.js";
import { FakeFetch, json, type RecordedCall, status, text } from "../support/fakeFetch.js";
import { createTestDb, createTestMongo } from "../support/harness.js";

/** Ported from integrations/leetcode/LeetCodeCollectorTest.java (+ collector transport, job and service coverage). */

const load = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
const PROFILE_ROOT = load("leetcode-profile-response.json") as { data: unknown };
const CONTEST_ROOT = load("leetcode-contest-response.json") as { data: unknown };
const RECENT_ROOT = load("leetcode-recent-response.json") as { data: unknown };

// 2024-06-01T00:00:00Z — fixed so the 30-day window assertion is deterministic.
const NOW = new Date("2024-06-01T00:00:00Z");

type Fragment = {
  username: string;
  country: string;
  solved: { easy: number; medium: number; hard: number; total: number };
  byTopic: { topic: string; count: number }[];
  contest: { attended: number; rating: number; globalRanking: number; totalParticipants: number; topPercent: number } | null;
  recentActivity: { last30Days: number; preferredLanguage: string | null };
  streak: null;
  partial: boolean;
};

const fragment = (canonical: string) => JSON.parse(canonical) as Fragment;
const build = (contest: unknown = CONTEST_ROOT.data, partial = false) =>
  toLeetCodeFragmentJson(PROFILE_ROOT.data, contest, RECENT_ROOT.data, NOW, partial);

describe("toLeetCodeFragmentJson (ported from LeetCodeCollectorTest)", () => {
  it("toFragmentJson_mapsProfileAndSolvedSplit", () => {
    const f = fragment(build());
    expect(f.username).toBe("aakash_42");
    expect(f.country).toBe("India");
    expect(f.solved.easy).toBe(78);
    expect(f.solved.medium).toBe(268);
    expect(f.solved.hard).toBe(66);
    expect(f.solved.total).toBe(412);
  });

  it("toFragmentJson_mergesAndSortsTopicsDescending_excludingZeroes", () => {
    const topics = fragment(build()).byTopic;
    // Array(90), String(60), Hash Table(55), Dynamic Programming(40), Greedy(30), Backtracking(10).
    // "Suffix Array" (0 solved) must be excluded.
    expect(topics).toHaveLength(6);
    expect(topics[0]!.topic).toBe("Array");
    expect(topics[0]!.count).toBe(90);
    expect(topics[1]!.topic).toBe("String");
    expect(JSON.stringify(topics)).not.toContain("Suffix Array");
  });

  it("toFragmentJson_mapsContestStatsWithRoundedRating", () => {
    const contest = fragment(build()).contest!;
    expect(contest.attended).toBe(12);
    expect(contest.rating).toBe(1751); // 1750.6 rounded
    expect(contest.globalRanking).toBe(50000);
    expect(contest.topPercent).toBe(6.25);
  });

  it("toFragmentJson_nullContest_whenUserHasNoContestHistory", () => {
    const f = fragment(build(null));
    expect(f.contest).toBeNull();
    // also when the contest node is present but userContestRanking is null
    expect(fragment(build({ userContestRanking: null })).contest).toBeNull();
  });

  it("toFragmentJson_derivesRecentCountAndPreferredLanguage", () => {
    const activity = fragment(build()).recentActivity;
    // 3 of 4 submissions fall inside the 30-day window relative to NOW.
    expect(activity.last30Days).toBe(3);
    // python3 appears twice -> preferred.
    expect(activity.preferredLanguage).toBe("python3");
  });

  it("toFragmentJson_leavesStreakNull_andFlagsPartial", () => {
    const f = fragment(build(CONTEST_ROOT.data, true));
    expect(f.streak).toBeNull();
    expect(f.partial).toBe(true);
    expect("streak" in f).toBe(true); // present as an explicit null, like Jackson
  });

  it("contentHash_isStableForSameInput_andChangesWhenDataChanges", () => {
    const c1 = build();
    const c2 = build();
    expect(sha256Hex(c1)).toBe(sha256Hex(c2));

    expect(c1).toContain('"hard":66');
    const mutated = JSON.parse(c1.replace('"hard":66', '"hard":67')) as unknown;
    expect(sha256Hex(canonicalize(mutated))).not.toBe(sha256Hex(c1));
  });

  it("canonicalize_isKeyOrderIndependent", () => {
    expect(canonicalize(JSON.parse('{"b":1,"a":2}'))).toBe(canonicalize(JSON.parse('{"a":2,"b":1}')));
  });
});

describe("toLeetCodeFragmentJson — edge cases mirrored from the Java implementation", () => {
  it("canonical output for the fixtures (sorted keys at every level)", () => {
    expect(build()).toBe(
      '{"byTopic":[{"count":90,"topic":"Array"},{"count":60,"topic":"String"},{"count":55,"topic":"Hash Table"},' +
        '{"count":40,"topic":"Dynamic Programming"},{"count":30,"topic":"Greedy"},{"count":10,"topic":"Backtracking"}],' +
        '"contest":{"attended":12,"globalRanking":50000,"rating":1751,"topPercent":6.25,"totalParticipants":800000},' +
        '"country":"India","partial":false,"recentActivity":{"last30Days":3,"preferredLanguage":"python3"},' +
        '"solved":{"easy":78,"hard":66,"medium":268,"total":412},"streak":null,"username":"aakash_42"}',
    );
  });

  it("total falls back to easy+medium+hard when the All bucket is missing or zero", () => {
    const profile = {
      matchedUser: {
        username: "x",
        submitStatsGlobal: {
          acSubmissionNum: [
            { difficulty: "Easy", count: 1 },
            { difficulty: "Medium", count: 2 },
            { difficulty: "Hard", count: 3 },
            { difficulty: "Weird", count: 99 },
          ],
        },
      },
    };
    expect(fragment(toLeetCodeFragmentJson(profile, null, null, NOW, false)).solved).toEqual({ easy: 1, medium: 2, hard: 3, total: 6 });
  });

  it("topics tie on count break by topic name ascending", () => {
    const profile = {
      matchedUser: {
        tagProblemCounts: {
          advanced: [{ tagName: "Trie", problemsSolved: 5 }],
          intermediate: [{ tagName: "Graph", problemsSolved: 5 }],
          fundamental: [{ tagName: "Array", problemsSolved: 7 }, { tagName: "", problemsSolved: 50 }],
        },
      },
    };
    expect(fragment(toLeetCodeFragmentJson(profile, null, null, NOW, false)).byTopic).toEqual([
      { topic: "Array", count: 7 },
      { topic: "Graph", count: 5 },
      { topic: "Trie", count: 5 },
    ]);
  });

  it("preferredLanguage ties break by name ascending; null when there are no submissions", () => {
    const recent = {
      recentAcSubmissionList: [
        { timestamp: "1717100000", lang: "java" },
        { timestamp: "1717100000", lang: "cpp" },
        { timestamp: "not-a-number", lang: "" },
      ],
    };
    const a = fragment(toLeetCodeFragmentJson(PROFILE_ROOT.data, null, recent, NOW, false)).recentActivity;
    expect(a.preferredLanguage).toBe("cpp");
    expect(a.last30Days).toBe(2); // the unparseable timestamp counts as epoch 0 -> outside the window

    const none = fragment(toLeetCodeFragmentJson(PROFILE_ROOT.data, null, null, NOW, false)).recentActivity;
    expect(none).toEqual({ last30Days: 0, preferredLanguage: null });
  });

  it("the 30-day window boundary is inclusive (ts >= now - 30d)", () => {
    const cutoff = NOW.getTime() / 1000 - 30 * 24 * 60 * 60;
    const recent = { recentAcSubmissionList: [{ timestamp: String(cutoff), lang: "go" }, { timestamp: String(cutoff - 1), lang: "go" }] };
    expect(fragment(toLeetCodeFragmentJson(PROFILE_ROOT.data, null, recent, NOW, false)).recentActivity.last30Days).toBe(1);
  });
});

// --- collector transport / retry ---------------------------------------------------------------

const LC_URL = "https://leetcode.test/graphql";
type Handler = (attempt: number, call: RecordedCall) => Response | Promise<Response>;

/** GraphQL operation name ("validate", "userProfile", "contest", "recent") of a recorded call. */
function opName(call: RecordedCall): string {
  const q = (call.json as { query?: string } | undefined)?.query ?? "";
  return /query\s+(\w+)/.exec(q)?.[1] ?? "";
}

/** Route LeetCode GraphQL calls by operation; each handler sees its 1-based attempt number. */
function serve(fake: FakeFetch, handlers: Record<string, Handler>): void {
  const counts: Record<string, number> = {};
  fake.on("POST", LC_URL, (call: RecordedCall) => {
    const op = opName(call);
    counts[op] = (counts[op] ?? 0) + 1;
    const h = handlers[op];
    if (!h) throw new TypeError(`fetch failed: unexpected LeetCode operation '${op}'`);
    return h(counts[op], call);
  });
}

const always = (res: () => Response): Handler => () => res();
const connectionFailure: Handler = () => {
  throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
};

/** The LeetCodeProfileError a promise rejects with (fails the test if it resolves or rejects otherwise). */
async function errorOf(p: Promise<unknown>): Promise<LeetCodeProfileError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LeetCodeProfileError);
  return err as LeetCodeProfileError;
}

const reasonOf = async (p: Promise<unknown>): Promise<string> => (await errorOf(p)).reason;

describe("LeetCodeCollector.validateProfile + GraphQL transport", () => {
  let fake: FakeFetch;
  let collector: LeetCodeCollector;
  const fragmentsUnused = null as unknown as ProfileFragmentRepository;

  beforeEach(() => {
    fake = new FakeFetch();
    collector = new LeetCodeCollector(LC_URL, fragmentsUnused, fake.fetch, silentLogger(), 1);
  });

  it("posts {query, variables:{username}} with the LeetCode headers and accepts a public profile", async () => {
    serve(fake, { validate: always(() => json(PROFILE_ROOT)) });
    await expect(collector.validateProfile("aakash_42")).resolves.toBeUndefined();

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(LC_URL);
    expect(call.headers["referer"]).toBe("https://leetcode.com");
    expect(call.headers["user-agent"]).toBe("interviewiq-backend");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.json).toEqual({ query: VALIDATE_QUERY, variables: { username: "aakash_42" } });
  });

  it("matchedUser null -> USERNAME_NOT_FOUND", async () => {
    serve(fake, { validate: always(() => json({ data: { matchedUser: null } })) });
    expect(await reasonOf(collector.validateProfile("ghost"))).toBe("USERNAME_NOT_FOUND");
  });

  it("matchedUser present without submit stats -> PROFILE_PRIVATE", async () => {
    serve(fake, { validate: always(() => json({ data: { matchedUser: { username: "shy", submitStatsGlobal: null } } })) });
    expect(await reasonOf(collector.validateProfile("shy"))).toBe("PROFILE_PRIVATE");
    serve(fake, { validate: always(() => json({ data: { matchedUser: { username: "shy", submitStatsGlobal: { acSubmissionNum: {} } } } })) });
    expect(await reasonOf(collector.validateProfile("shy"))).toBe("PROFILE_PRIVATE");
  });

  it("429 is retried MAX_ATTEMPTS (3) times, then RATE_LIMITED", async () => {
    serve(fake, { validate: always(() => status(429)) });
    expect(await reasonOf(collector.validateProfile("x"))).toBe("RATE_LIMITED");
    expect(fake.calls).toHaveLength(3);
  });

  it("5xx is retried and a later success is returned", async () => {
    serve(fake, { validate: (n) => (n < 3 ? status(503) : json(PROFILE_ROOT)) });
    await expect(collector.validateProfile("aakash_42")).resolves.toBeUndefined();
    expect(fake.calls).toHaveLength(3);
  });

  it("exhausted retries throw the LAST attempt's classification", async () => {
    serve(fake, { validate: (n) => (n < 3 ? status(429) : status(500)) });
    expect(await reasonOf(collector.validateProfile("x"))).toBe("UNREACHABLE");
    expect(fake.calls).toHaveLength(3);
  });

  it("other 4xx are not retried -> UNREACHABLE after one call", async () => {
    serve(fake, { validate: always(() => status(400, "bad")) });
    const err = await errorOf(collector.validateProfile("x"));
    expect(err.reason).toBe("UNREACHABLE");
    expect(err.message).toBe("LeetCode request failed (400)");
    expect(fake.calls).toHaveLength(1);
  });

  it("transport errors are retried -> UNREACHABLE", async () => {
    serve(fake, { validate: connectionFailure });
    expect(await reasonOf(collector.validateProfile("x"))).toBe("UNREACHABLE");
    expect(fake.calls).toHaveLength(3);
  });

  it("a response with no `data` is an unhandled GraphQL error -> UNREACHABLE, not retried", async () => {
    serve(fake, { validate: always(() => json({ data: null, errors: [{ message: "boom" }] })) });
    const err = await errorOf(collector.validateProfile("x"));
    expect(err.reason).toBe("UNREACHABLE");
    expect(err.message).toContain("LeetCode GraphQL returned no data");
    expect(err.message).toContain("boom");
    expect(fake.calls).toHaveLength(1);
  });

  it("a non-JSON 200 body -> UNREACHABLE, not retried (intentional deviation from Java)", async () => {
    serve(fake, { validate: always(() => text("<html>cloudflare</html>")) });
    expect(await reasonOf(collector.validateProfile("x"))).toBe("UNREACHABLE");
    expect(fake.calls).toHaveLength(1);
  });

  it("backoff is exponential: base, 2*base between the three attempts", async () => {
    const slow = new LeetCodeCollector(LC_URL, fragmentsUnused, fake.fetch, silentLogger(), 25);
    serve(fake, { validate: always(() => status(503)) });
    const started = performance.now();
    await slow.validateProfile("x").catch(() => undefined);
    // 25ms + 50ms of sleeps (timers never fire meaningfully early)
    expect(performance.now() - started).toBeGreaterThanOrEqual(70);
    expect(fake.calls).toHaveLength(3);
  });
});

describe("LeetCodeProfileError", () => {
  it("carries the stable UI codes and the controller's HTTP statuses", () => {
    expect(LEETCODE_REASONS).toEqual({
      USERNAME_NOT_FOUND: "leetcode_user_not_found",
      PROFILE_PRIVATE: "leetcode_profile_private",
      RATE_LIMITED: "leetcode_rate_limited",
      UNREACHABLE: "leetcode_unreachable",
    });
    const status = (r: keyof typeof LEETCODE_REASONS) => new LeetCodeProfileError(r, "m").httpStatus;
    expect(status("USERNAME_NOT_FOUND")).toBe(404);
    expect(status("PROFILE_PRIVATE")).toBe(422);
    expect(status("RATE_LIMITED")).toBe(503);
    expect(status("UNREACHABLE")).toBe(503);
    const err = new LeetCodeProfileError("PROFILE_PRIVATE", "LeetCode profile is not public: x");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("leetcode_profile_private");
    expect(err.message).toBe("LeetCode profile is not public: x");
  });
});

describe("normalizeLeetCodeUsername (LeetCodeService.normalizeUsername)", () => {
  it.each([
    [null, ""],
    [undefined, ""],
    ["", ""],
    ["   ", ""],
    ["aakash_42", "aakash_42"],
    ["  aakash_42  ", "aakash_42"],
    ["@aakash_42", "aakash_42"],
    ["https://leetcode.com/u/aakash_42/", "aakash_42"],
    ["https://leetcode.com/aakash_42", "aakash_42"],
    ["http://www.leetcode.com/u/aakash_42/?tab=solutions", "aakash_42"],
    ["leetcode.com/aakash_42", "aakash_42"],
    ["www.leetcode.com/u/aakash_42#top", "aakash_42"],
    ["https://leetcode.com/u/@aakash_42", "aakash_42"],
    ["https://leetcode.cn/u/aakash_42/", "https://leetcode.cn/u/aakash_42/"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeLeetCodeUsername(raw)).toBe(expected);
  });
});

// --- collectAndStore / job / service (real PGlite + in-memory Mongo) ----------------------------

describe("LeetCodeCollector.collectAndStore, LeetCodeCollectionJob, LeetCodeService", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let mongo: Awaited<ReturnType<typeof createTestMongo>>;
  let connections: LeetCodeConnectionRepository;
  let fragments: ProfileFragmentRepository;
  let fake: FakeFetch;
  let collector: LeetCodeCollector;
  let job: LeetCodeCollectionJob;
  let background: BackgroundTasks;
  let service: LeetCodeService;

  beforeAll(async () => {
    pg = await createTestDb();
    mongo = await createTestMongo();
    connections = new LeetCodeConnectionRepository(pg.db);
    fragments = new ProfileFragmentRepository(mongo.mongo);
  });
  afterAll(async () => {
    await background.drain();
    await Promise.all([pg.close(), mongo.close()]);
  });

  beforeEach(() => {
    fake = new FakeFetch();
    collector = new LeetCodeCollector(LC_URL, fragments, fake.fetch, silentLogger(), 1);
    job = new LeetCodeCollectionJob(connections, collector, silentLogger());
    background = new BackgroundTasks(silentLogger());
    service = new LeetCodeService(connections, fragments, collector, job, background);
  });

  const happy = (): Record<string, Handler> => ({
    validate: always(() => json(PROFILE_ROOT)),
    userProfile: always(() => json(PROFILE_ROOT)),
    contest: always(() => json(CONTEST_ROOT)),
    recent: always(() => json(RECENT_ROOT)),
  });

  const newConnection = (username = "aakash_42"): Promise<LeetCodeConnectionRow> => connections.upsertSyncing(randomUUID(), username);

  describe("collectAndStore", () => {
    it("fetches profile, contest and recent; stores fragment v1 (STORED)", async () => {
      serve(fake, happy());
      const conn = await newConnection();
      expect(await collector.collectAndStore(conn)).toBe("STORED");

      expect(fake.calls.map(opName)).toEqual(["userProfile", "contest", "recent"]);
      expect(fake.calls.map((c) => c.json)).toEqual([
        { query: PROFILE_QUERY, variables: { username: "aakash_42" } },
        { query: CONTEST_QUERY, variables: { username: "aakash_42" } },
        { query: RECENT_QUERY, variables: { username: "aakash_42" } },
      ]);

      const stored = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!;
      expect(stored.version).toBe(1);
      const data = stored.data as Fragment;
      expect(data.username).toBe("aakash_42");
      expect(data.partial).toBe(false);
      expect(data.contest!.rating).toBe(1751);
      expect(stored.contentHash).toBe(sha256Hex(canonicalize(stored.data)));
    });

    it("same data again -> UNCHANGED (fetchedAt bumped only); changed data -> STORED v2", async () => {
      serve(fake, happy());
      const conn = await newConnection();
      await collector.collectAndStore(conn);
      const first = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!;

      await new Promise((r) => setTimeout(r, 5));
      expect(await collector.collectAndStore(conn)).toBe("UNCHANGED");
      const second = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!;
      expect(second.version).toBe(1);
      expect(second.contentHash).toBe(first.contentHash);
      expect(second.fetchedAt.getTime()).toBeGreaterThan(first.fetchedAt.getTime());

      const moreSolved = structuredClone(PROFILE_ROOT) as { data: { matchedUser: { submitStatsGlobal: { acSubmissionNum: { difficulty: string; count: number }[] } } } };
      moreSolved.data.matchedUser.submitStatsGlobal.acSubmissionNum[3]!.count = 67;
      serve(fake, { ...happy(), userProfile: always(() => json(moreSolved)) });
      expect(await collector.collectAndStore(conn)).toBe("STORED");
      const third = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!;
      expect(third._id).toBe(first._id);
      expect(third.version).toBe(2);
      expect((third.data as Fragment).solved.hard).toBe(67);
    });

    it("matchedUser null on the profile call -> NULL_USER, optional calls skipped, nothing stored", async () => {
      serve(fake, { ...happy(), userProfile: always(() => json({ data: { matchedUser: null } })) });
      const conn = await newConnection("vanished");
      expect(await collector.collectAndStore(conn)).toBe("NULL_USER");
      expect(fake.calls.map(opName)).toEqual(["userProfile"]);
      expect(await fragments.findByUserIdAndSource(conn.userId, "LEETCODE")).toBeNull();
    });

    it("failing optional queries are tolerated and flag the fragment partial", async () => {
      serve(fake, { ...happy(), contest: always(() => status(429)), recent: always(() => json({ data: null, errors: [{ message: "x" }] })) });
      const conn = await newConnection();
      expect(await collector.collectAndStore(conn)).toBe("STORED");
      const data = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!.data as Fragment;
      expect(data.partial).toBe(true);
      expect(data.contest).toBeNull();
      expect(data.recentActivity).toEqual({ last30Days: 0, preferredLanguage: null });
      expect(data.solved.total).toBe(412);
    });

    it("a user who never entered a contest is not partial", async () => {
      serve(fake, { ...happy(), contest: always(() => json({ data: { userContestRanking: null } })) });
      const conn = await newConnection();
      await collector.collectAndStore(conn);
      const data = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!.data as Fragment;
      expect(data.contest).toBeNull();
      expect(data.partial).toBe(false);
    });

    it("a failing required profile call throws the classified error", async () => {
      serve(fake, { ...happy(), userProfile: always(() => status(500)) });
      const conn = await newConnection();
      expect(await reasonOf(collector.collectAndStore(conn))).toBe("UNREACHABLE");
      expect(await fragments.findByUserIdAndSource(conn.userId, "LEETCODE")).toBeNull();
    });
  });

  describe("LeetCodeCollectionJob.refresh / runForConnectionId", () => {
    it("success -> SYNCED + lastRefreshedAt", async () => {
      serve(fake, happy());
      const conn = await newConnection();
      expect(conn.lastRefreshedAt).toBeNull();
      await job.runForConnectionId(conn.id);
      const after = (await connections.findById(conn.id))!;
      expect(after.status).toBe("SYNCED");
      expect(after.lastRefreshedAt).toBeInstanceOf(Date);
    });

    it("unchanged data still counts as a successful sync", async () => {
      serve(fake, happy());
      const conn = await newConnection();
      await job.refresh(conn);
      const firstRefresh = (await connections.findById(conn.id))!.lastRefreshedAt!;
      await new Promise((r) => setTimeout(r, 5));
      await job.refresh(conn);
      const after = (await connections.findById(conn.id))!;
      expect(after.status).toBe("SYNCED");
      expect(after.lastRefreshedAt!.getTime()).toBeGreaterThan(firstRefresh.getTime());
    });

    it("null user -> DEGRADED, last-known-good fragment kept, lastRefreshedAt untouched", async () => {
      serve(fake, happy());
      const conn = await newConnection();
      await job.refresh(conn);
      const synced = (await connections.findById(conn.id))!;
      const kept = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!;

      serve(fake, { ...happy(), userProfile: always(() => json({ data: { matchedUser: null } })) });
      await job.refresh(conn);
      const after = (await connections.findById(conn.id))!;
      expect(after.status).toBe("DEGRADED");
      expect(after.lastRefreshedAt).toEqual(synced.lastRefreshedAt);
      expect(await fragments.findByUserIdAndSource(conn.userId, "LEETCODE")).toEqual(kept);
    });

    it("any error -> FAILED, fragment untouched, never throws", async () => {
      serve(fake, happy());
      const conn = await newConnection();
      await job.refresh(conn);
      const kept = (await fragments.findByUserIdAndSource(conn.userId, "LEETCODE"))!;

      serve(fake, { ...happy(), userProfile: always(() => status(429)) });
      await expect(job.refresh(conn)).resolves.toBeUndefined();
      expect((await connections.findById(conn.id))!.status).toBe("FAILED");
      expect(await fragments.findByUserIdAndSource(conn.userId, "LEETCODE")).toEqual(kept);

      serve(fake, { ...happy(), userProfile: connectionFailure });
      await expect(job.refresh(conn)).resolves.toBeUndefined();
      expect((await connections.findById(conn.id))!.status).toBe("FAILED");
    });

    it("runForConnectionId on a deleted connection is a no-op", async () => {
      serve(fake, happy());
      await expect(job.runForConnectionId(randomUUID())).resolves.toBeUndefined();
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("LeetCodeService", () => {
    it("connect normalizes, validates synchronously, persists SYNCING, then syncs in the background", async () => {
      serve(fake, happy());
      const userId = randomUUID();
      const conn = await service.connect(userId, "  https://leetcode.com/u/aakash_42/ ");
      expect(conn.userId).toBe(userId);
      expect(conn.username).toBe("aakash_42");
      expect(conn.status).toBe("SYNCING");
      expect(fake.calls[0] && opName(fake.calls[0])).toBe("validate");
      expect((fake.calls[0]!.json as { variables: unknown }).variables).toEqual({ username: "aakash_42" });

      await background.drain();
      expect((await connections.findById(conn.id))!.status).toBe("SYNCED");
      expect((await fragments.findByUserIdAndSource(userId, "LEETCODE"))!.version).toBe(1);
    });

    it("connect with a blank username throws InvalidArgumentError before any upstream call", async () => {
      serve(fake, happy());
      for (const raw of [null, undefined, "", "   ", "@"]) {
        await expect(service.connect(randomUUID(), raw)).rejects.toBeInstanceOf(InvalidArgumentError);
      }
      await expect(service.connect(randomUUID(), " ")).rejects.toThrow("LeetCode username is required");
      expect(fake.calls).toHaveLength(0);
    });

    it("connect surfaces validation failures and persists nothing", async () => {
      serve(fake, { ...happy(), validate: always(() => json({ data: { matchedUser: null } })) });
      const userId = randomUUID();
      const err = await errorOf(service.connect(userId, "ghost"));
      expect(err.code).toBe("leetcode_user_not_found");
      expect(err.httpStatus).toBe(404);
      expect(await connections.findByUserId(userId)).toBeNull();
      expect(background.size).toBe(0);
    });

    it("re-connecting re-points the same connection row back to SYNCING", async () => {
      serve(fake, happy());
      const userId = randomUUID();
      const first = await service.connect(userId, "aakash_42");
      await background.drain();
      const second = await service.connect(userId, "@other_handle");
      expect(second.id).toBe(first.id);
      expect(second.username).toBe("other_handle");
      expect(second.status).toBe("SYNCING");
      await background.drain();
    });

    it("disconnect deletes the connection and only the LEETCODE fragment; idempotent", async () => {
      serve(fake, happy());
      const userId = randomUUID();
      await service.connect(userId, "aakash_42");
      await background.drain();
      await fragments.insert({ userId, source: "GITHUB", data: { login: "x" }, contentHash: "h", version: 1, fetchedAt: new Date() });

      await service.disconnect(userId);
      expect(await connections.findByUserId(userId)).toBeNull();
      expect(await fragments.findByUserIdAndSource(userId, "LEETCODE")).toBeNull();
      expect(await fragments.findByUserIdAndSource(userId, "GITHUB")).not.toBeNull();

      await expect(service.disconnect(userId)).resolves.toBeUndefined();
    });
  });
});
