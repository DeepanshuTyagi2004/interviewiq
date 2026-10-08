import { cleanText, list, number, object, sortedUnique } from "./sanitization.js";
import { validTimestamp } from "./adapters.js";
import type { PlatformPolicy, ScoringConfig } from "./types.js";

/**
 * Provider-independent, minimized raw observations. Every platform adapter maps its native metrics
 * into this one schema, so adding a platform never changes the scoring engine. Ratings stay in the
 * platform's own units here; they are only made comparable through that platform's own policy
 * curve (`PlatformPolicy.ratingCurve`) at scoring time. A LeetCode 1800 is never compared to a
 * Codeforces 1800.
 */
export interface CompetitionProfile {
  schemaVersion: "competition-v1";
  platform: string;
  difficulty: Record<string, number | null>;
  totalSolved: number | null;
  topics: { topic: string; count: number }[];
  /** Topics the platform itself tiers as advanced (LeetCode), or matched advanced tags. */
  advancedTopics: { topic: string; count: number }[];
  contest: {
    attended: number | null; rating: number | null; maxRating: number | null; rank: number | null; population: number | null;
    /** 0-100, higher is better (100 - "top x%"). Population-relative, so the most comparable signal. */
    percentile: number | null; bestRank: number | null; averageRank: number | null;
    /** Share (0-1) of contests the user entered within the last year, when the platform exposes it. */
    participationRate: number | null; lastContestAt: string | null;
  };
  /** Rated contests only, oldest first, capped. */
  ratingHistory: { at: string; rating: number; rank: number | null }[];
  consistency: { activeWeeks: number | null; windowWeeks: number | null; windowAsOf: string | null };
  recency: { activityCount: number | null; sampleMaximum: number | null; windowAsOf: string | null };
  trajectory: { recentRating: number | null; previousRating: number | null; recentAt: string | null; previousAt: string | null };
  /** Platform-native level (CodeChef stars) used only when no solve breakdown exists. */
  platformLevel: { value: number; maximum: number } | null;
  partial: boolean;
  adapter: string;
}
export interface CompetitionMeasure {
  signal: string; rawValue: unknown; normalizedValue: number; path: string; recencyFactor: number; completeness: number;
}
export interface CompetitionAdapter { platform: string; adapt(raw: Record<string, unknown>, observedAt: string): Record<string, unknown> }

export const count = (raw: unknown, maximum = 10_000_000): number | null => {
  const value = number(raw); return value !== null && Number.isInteger(value) && value >= 0 && value <= maximum ? value : null;
};
const rating = (raw: unknown): number | null => { const value = number(raw); return value !== null && value < 10_000 ? value : null; };
const date = (raw: unknown): string | null => validTimestamp(raw) ? new Date(raw).toISOString() : null;
/** Epoch seconds/milliseconds or ISO string -> ISO string. */
const when = (raw: unknown): string | null => {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return new Date(raw < 1e12 ? raw * 1000 : raw).toISOString();
  if (typeof raw === "string" && /^\d{9,13}$/.test(raw.trim())) return when(Number(raw.trim()));
  return date(raw);
};
const ratio = (value: number, cap: number) => 100 * Math.max(0, Math.min(value / cap, 1));
const clamp = (value: number) => Math.max(0, Math.min(value, 100));
const DAY = 86_400_000;

/** Native rating history rows -> sorted, de-duplicated {at, rating, rank}. */
function history(rows: unknown[], pick: (row: Record<string, unknown>) => { at: unknown; rating: unknown; rank?: unknown; attended?: unknown }): { at: string; rating: number; rank: number | null }[] {
  const out = new Map<string, { at: string; rating: number; rank: number | null }>();
  for (const raw of rows) {
    const row = pick(object(raw));
    if (row.attended === false) continue;
    const at = when(row.at), value = rating(row.rating);
    if (at && value !== null && value > 0) out.set(at, { at, rating: value, rank: count(row.rank) });
  }
  return [...out.values()].sort((a, b) => a.at < b.at ? -1 : 1).slice(-200);
}

/** Weeks with any activity in the trailing 52 weeks of a day-keyed calendar {epochSeconds: count}. */
export function calendarConsistency(calendar: Record<string, unknown>, asOf: string): { activeWeeks: number; windowWeeks: number; last30Days: number } {
  const now = Date.parse(asOf), weeks = new Set<number>();
  let last30Days = 0;
  for (const [key, amount] of Object.entries(calendar)) {
    const at = Number(key) * 1000, value = count(amount);
    if (!Number.isFinite(at) || value === null || value === 0 || at > now) continue;
    const age = (now - at) / DAY;
    if (age <= 364) weeks.add(Math.floor(age / 7));
    if (age <= 30) last30Days += value;
  }
  return { activeWeeks: weeks.size, windowWeeks: 52, last30Days };
}

export const leetCodeCompetitionAdapter: CompetitionAdapter = {
  platform: "leetcode",
  adapt(raw, observedAt) {
    const availability = object(raw.scoringAvailability), missing = list(availability.missingSolveBuckets), solved = object(raw.solved);
    const contest = object(raw.contest), activity = object(raw.recentActivity), calendar = object(raw.calendar);
    const partial = raw.partial === true || missing.length > 0 || availability.recentActivity === false;
    const contestRows = list(raw.contestHistory);
    const lastYear = contestRows.filter((row) => { const at = when(object(row).startTime); return at !== null && Date.parse(observedAt) - Date.parse(at) <= 365 * DAY; });
    const topPercent = number(contest.topPercent);
    return {
      platform: "leetcode", difficulty: Object.fromEntries(["easy", "medium", "hard"].map((key) => [key, missing.includes(key) ? null : solved[key]])),
      totalSolved: solved.total, topics: raw.byTopic, advancedTopics: raw.advancedTopics,
      contest: {
        attended: contest.attended, rating: contest.rating, rank: contest.globalRanking ?? contest.rank, population: contest.totalParticipants ?? contest.population,
        percentile: topPercent !== null && topPercent > 0 && topPercent <= 100 ? 100 - topPercent : null,
        participationRate: lastYear.length ? lastYear.filter((row) => object(row).attended === true).length / lastYear.length : null,
      },
      ratingHistory: history(contestRows, (row) => ({ at: row.startTime, rating: row.rating, rank: row.ranking, attended: row.attended })),
      consistency: Object.keys(calendar).length ? { activeWeeks: calendar.activeWeeks, windowWeeks: calendar.windowWeeks, windowAsOf: calendar.windowAsOf ?? observedAt } : raw.consistency,
      // The submission calendar counts every recent submission; the 20-item AC sample is the fallback.
      recency: partial ? null : count(calendar.last30Days) !== null
        ? { activityCount: calendar.last30Days, sampleMaximum: null, windowAsOf: calendar.windowAsOf ?? observedAt }
        : { activityCount: activity.last30Days, sampleMaximum: 20, windowAsOf: activity.windowAsOf ?? observedAt },
      trajectory: raw.trajectory, partial, adapter: "leetcode-v1",
    };
  },
};

/** Accepts the native Codeforces API shapes (user.info, user.rating, user.status) or a minimized list. */
export const codeforcesCompetitionAdapter: CompetitionAdapter = {
  platform: "codeforces",
  adapt(raw, observedAt) {
    const rows = new Map<string, Record<string, unknown>>();
    const submissions = [...list(raw.problems), ...list(raw.submissions).map((item) => {
      const sub = object(item), problem = object(sub.problem);
      return { problemId: `${String(problem.contestId ?? "")}${String(problem.index ?? "")}`, rating: problem.rating, tags: problem.tags, verdict: sub.verdict, at: sub.creationTimeSeconds };
    })];
    const activeWeeks = new Set<number>(); let last30Days = 0;
    const now = Date.parse(observedAt);
    for (const item of submissions) {
      const row = object(item), id = cleanText(row.problemId), value = number(row.rating);
      const at = when(row.at), accepted = row.verdict === undefined || row.verdict === "OK";
      if (at && accepted) {
        const age = (now - Date.parse(at)) / DAY;
        if (age >= 0 && age <= 364) activeWeeks.add(Math.floor(age / 7));
        if (age >= 0 && age <= 30) last30Days++;
      }
      if (id && value !== null && value >= 800 && value <= 4000 && accepted) {
        const prior = rows.get(id);
        // Canonicalized caller arrays do not get to choose a duplicate's rating.
        if (!prior || value > Number(prior.rating)) rows.set(id, row);
      }
    }
    const hasProblems = submissions.length > 0, buckets = { easy: 0, medium: 0, hard: 0 };
    const tags = new Map<string, number>();
    for (const row of rows.values()) {
      const value = Number(row.rating); buckets[value <= 1200 ? "easy" : value <= 1800 ? "medium" : "hard"]++;
      for (const tag of sortedUnique(list(row.tags).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()))) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    const info = object(raw.info), contest = object(raw.contest), recent = object(raw.recentActivity);
    const ratingRows = history(list(raw.ratingHistory ?? raw.rating), (row) => ({ at: row.ratingUpdateTimeSeconds ?? row.at, rating: row.newRating ?? row.rating, rank: row.rank }));
    const hasActivityDates = submissions.some((item) => object(item).at !== undefined);
    return {
      platform: "codeforces", difficulty: hasProblems ? buckets : raw.solved, totalSolved: hasProblems ? rows.size : raw.totalSolved,
      topics: hasProblems ? [...tags].map(([topic, value]) => ({ topic, count: value })) : raw.byTopic,
      contest: { attended: contest.attended ?? raw.contestsAttended ?? (ratingRows.length || undefined), rating: contest.rating ?? info.rating ?? raw.rating,
        maxRating: contest.maxRating ?? info.maxRating, rank: contest.rank ?? raw.rank, population: contest.population ?? raw.totalParticipants, percentile: contest.percentile },
      ratingHistory: ratingRows,
      consistency: hasActivityDates ? { activeWeeks: activeWeeks.size, windowWeeks: 52, windowAsOf: observedAt } : raw.consistency,
      recency: raw.partial === true ? null : hasActivityDates ? { activityCount: last30Days, sampleMaximum: null, windowAsOf: observedAt }
        : { activityCount: recent.last30Days, sampleMaximum: recent.sampleMaximum, windowAsOf: recent.windowAsOf ?? observedAt },
      trajectory: raw.trajectory, partial: raw.partial === true, adapter: "codeforces-v1",
    };
  },
};

/** CodeChef: rating/highest rating, stars, global rank, contest history, fully solved count. */
export const codeChefCompetitionAdapter: CompetitionAdapter = {
  platform: "codechef",
  adapt(raw) {
    const stars = count(typeof raw.stars === "string" ? Number.parseInt(raw.stars, 10) : raw.stars, 7);
    const solved = object(raw.solved), recent = object(raw.recentActivity);
    return {
      platform: "codechef", difficulty: solved, totalSolved: raw.fullySolved ?? raw.totalSolved ?? solved.total, topics: raw.byTopic,
      contest: { attended: raw.contestsAttended ?? object(raw.contest).attended, rating: raw.rating ?? raw.currentRating, maxRating: raw.highestRating ?? raw.maxRating,
        rank: raw.globalRank, population: raw.totalParticipants, percentile: raw.percentile },
      ratingHistory: history(list(raw.ratingHistory ?? raw.contests), (row) => ({ at: row.endDate ?? row.at ?? row.date, rating: row.rating, rank: row.rank })),
      consistency: raw.consistency,
      recency: Object.keys(recent).length ? { activityCount: recent.last30Days, sampleMaximum: null, windowAsOf: recent.windowAsOf } : null,
      platformLevel: stars !== null && stars > 0 ? { value: stars, maximum: 7 } : null,
      partial: raw.partial === true, adapter: "codechef-v1",
    };
  },
};

/** AtCoder: history rows (IsRated/NewRating/Place/EndTime) and accepted problems with difficulty estimates. */
export const atCoderCompetitionAdapter: CompetitionAdapter = {
  platform: "atcoder",
  adapt(raw) {
    const buckets = { easy: 0, medium: 0, hard: 0 }; let hasProblems = false;
    for (const item of list(raw.acceptedProblems)) {
      const value = number(object(item).difficulty);
      if (value === null) continue;
      hasProblems = true; buckets[value <= 800 ? "easy" : value <= 1600 ? "medium" : "hard"]++;
    }
    const rows = list(raw.history).filter((row) => object(row).IsRated !== false);
    const ratingRows = history(rows, (row) => ({ at: row.EndTime ?? row.at, rating: row.NewRating ?? row.rating, rank: row.Place ?? row.rank }));
    // AtCoder publishes no per-problem difficulty for a user, so the rating colour (grey < 400, brown,
    // green, cyan, blue, yellow, orange, red at 2800+) stands in for difficulty, as CodeChef stars do.
    const ratingValue = number(raw.rating) ?? number(ratingRows.at(-1)?.rating);
    const platformLevel = ratingValue !== null && ratingValue >= 0 ? { value: Math.min(8, Math.floor(ratingValue / 400)), maximum: 8 } : null;
    return {
      platform: "atcoder", platformLevel, difficulty: hasProblems ? buckets : object(raw.solved), totalSolved: raw.acceptedCount ?? (hasProblems ? list(raw.acceptedProblems).length : null), topics: raw.byTopic,
      contest: { attended: raw.ratedMatches ?? (ratingRows.length || undefined), rating: raw.rating ?? ratingRows.at(-1)?.rating, maxRating: raw.highestRating, rank: raw.rank, population: raw.totalParticipants, percentile: raw.percentile },
      ratingHistory: ratingRows, consistency: raw.consistency,
      recency: Object.keys(object(raw.recentActivity)).length ? { activityCount: object(raw.recentActivity).last30Days, sampleMaximum: null } : null,
      partial: raw.partial === true, adapter: "atcoder-v1",
    };
  },
};

export const hackerEarthCompetitionAdapter: CompetitionAdapter = {
  platform: "hackerearth",
  adapt(raw) {
    return {
      platform: "hackerearth", difficulty: object(raw.solved), totalSolved: object(raw.solved).total ?? raw.totalSolved, topics: raw.byTopic,
      contest: { attended: raw.contestsAttended, rating: raw.rating, maxRating: raw.maxRating, rank: raw.rank, population: raw.totalParticipants, percentile: raw.percentile },
      ratingHistory: history(list(raw.ratingHistory), (row) => ({ at: row.at ?? row.date, rating: row.rating, rank: row.rank })),
      consistency: raw.consistency, recency: null, partial: raw.partial === true, adapter: "hackerearth-v1",
    };
  },
};

/** takeUforward: no contests or rating; Basic/Core/Pro sheet solves are its difficulty bands. */
export const tufCompetitionAdapter: CompetitionAdapter = {
  platform: "tuf",
  adapt(raw) {
    const solved = object(raw.solved), recent = object(raw.recentActivity);
    return {
      platform: "tuf", difficulty: { easy: solved.easy ?? solved.basic, medium: solved.medium ?? solved.core, hard: solved.hard ?? solved.pro },
      totalSolved: raw.totalSolved, topics: raw.byTopic, contest: {}, ratingHistory: [], consistency: raw.consistency,
      recency: Object.keys(recent).length ? { activityCount: recent.last30Days, sampleMaximum: null } : null,
      partial: raw.partial === true, adapter: "tuf-v1",
    };
  },
};

const adapters = new Map<string, CompetitionAdapter>([leetCodeCompetitionAdapter, codeforcesCompetitionAdapter, codeChefCompetitionAdapter,
  atCoderCompetitionAdapter, hackerEarthCompetitionAdapter, tufCompetitionAdapter].map((adapter) => [adapter.platform, adapter]));
export function supportedCompetitionPlatforms(): string[] { return [...adapters.keys()].sort(); }
/** New platforms plug in here (plus an optional policy normalizer); the engine is unchanged. */
export function registerCompetitionAdapter(adapter: CompetitionAdapter): void { adapters.set(adapter.platform.trim().toLowerCase(), adapter); }

/** Unknown platforms may use the generic schema; they score through the `generic` normalizer. */
export function normalizeCompetition(platform: string, raw: unknown, observedAt: string): CompetitionProfile {
  const normalizedPlatform = platform.trim().toLowerCase();
  const input = object(raw);
  const value = input.schemaVersion === "competition-v1" || !adapters.has(normalizedPlatform) ? input : adapters.get(normalizedPlatform)!.adapt(input, observedAt);
  const difficulty = object(value.difficulty), contest = object(value.contest), consistency = object(value.consistency), recency = object(value.recency), trajectory = object(value.trajectory);
  const topicRows = (rows: unknown) => {
    const topics = new Map<string, number>();
    for (const item of list(rows)) {
      const row = object(item), topic = cleanText(row.topic)?.toLowerCase(), amount = count(row.count);
      if (topic && amount !== null) topics.set(topic, Math.max(topics.get(topic) ?? 0, amount));
    }
    return [...topics].sort(([a], [b]) => a < b ? -1 : 1).map(([topic, amount]) => ({ topic, count: amount }));
  };
  const ratingHistory = list(value.ratingHistory).map(object).flatMap((row) => {
    const at = date(row.at), r = rating(row.rating); return at && r !== null && r > 0 ? [{ at, rating: r, rank: count(row.rank) }] : [];
  }).sort((a, b) => a.at < b.at ? -1 : 1).slice(-200);
  const ranks = ratingHistory.map((row) => row.rank).filter((x): x is number => x !== null && x > 0);
  const percentile = number(contest.percentile), participation = number(contest.participationRate);
  const level = object(value.platformLevel), levelValue = number(level.value), levelMax = number(level.maximum);
  const explicitTrajectory = { recentRating: rating(trajectory.recentRating), previousRating: rating(trajectory.previousRating), recentAt: date(trajectory.recentAt), previousAt: date(trajectory.previousAt) };
  return {
    schemaVersion: "competition-v1", platform: normalizedPlatform,
    difficulty: Object.fromEntries(Object.entries(difficulty).filter(([key]) => /^[a-z0-9_-]{1,40}$/.test(key) && key !== "total").sort(([a], [b]) => a < b ? -1 : 1).map(([key, amount]) => [key, count(amount)])),
    totalSolved: count(value.totalSolved),
    topics: topicRows(value.topics), advancedTopics: topicRows(value.advancedTopics),
    contest: {
      attended: count(contest.attended), rating: rating(contest.rating),
      maxRating: rating(contest.maxRating) ?? (ratingHistory.length ? Math.max(...ratingHistory.map((row) => row.rating)) : null),
      rank: count(contest.rank), population: count(contest.population),
      percentile: percentile !== null && percentile <= 100 ? percentile : null,
      bestRank: count(contest.bestRank) ?? (ranks.length ? Math.min(...ranks) : null),
      averageRank: number(contest.averageRank) ?? (ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null),
      participationRate: participation !== null && participation <= 1 ? participation : null,
      lastContestAt: date(contest.lastContestAt) ?? ratingHistory.at(-1)?.at ?? null,
    },
    ratingHistory,
    // Collectors store activity windows relative to the fetch (no timestamp, so the hash stays stable): the observation date is the window's date.
    consistency: { activeWeeks: count(consistency.activeWeeks, 520), windowWeeks: count(consistency.windowWeeks, 520), windowAsOf: date(consistency.windowAsOf) ?? (count(consistency.activeWeeks, 520) !== null ? date(observedAt) : null) },
    recency: { activityCount: count(recency.activityCount), sampleMaximum: count(recency.sampleMaximum), windowAsOf: date(recency.windowAsOf) ?? (count(recency.activityCount) !== null ? date(observedAt) : null) },
    trajectory: explicitTrajectory.recentRating !== null && explicitTrajectory.previousRating !== null ? explicitTrajectory : trajectoryFromHistory(ratingHistory),
    platformLevel: levelValue !== null && levelMax !== null && levelMax > 0 && levelValue <= levelMax ? { value: levelValue, maximum: levelMax } : null,
    partial: value.partial === true,
    adapter: input.schemaVersion === "competition-v1" && /^[a-z0-9_-]{1,40}-v\d+$/.test(String(input.adapter)) ? String(input.adapter) : adapters.has(normalizedPlatform) ? `${normalizedPlatform}-v1` : "generic-v1",
  };
}

/** Latest rating vs the rating roughly six months earlier (or the first rated contest). */
function trajectoryFromHistory(rows: { at: string; rating: number }[]): CompetitionProfile["trajectory"] {
  const none = { recentRating: null, previousRating: null, recentAt: null, previousAt: null };
  if (rows.length < 2) return none;
  const recent = rows.at(-1)!, target = Date.parse(recent.at) - 182 * DAY;
  const previous = [...rows].reverse().find((row) => Date.parse(row.at) <= target) ?? rows[0]!;
  return previous === recent ? none : { recentRating: recent.rating, previousRating: previous.rating, recentAt: recent.at, previousAt: previous.at };
}

export const normalizeCompetitiveProgramming = normalizeCompetition;
export const normalizePlatformCompetition = normalizeCompetition;

/** Platform rating -> 0-100 through that platform's own tier anchors (linear floor/ceiling fallback). */
export function platformRatingScore(platform: PlatformPolicy, value: number): number {
  const curve = platform.ratingCurve;
  if (!curve?.length) return ratio(value - platform.ratingFloor, platform.ratingCeiling - platform.ratingFloor);
  if (value <= curve[0]![0]) return curve[0]![1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, v1] = curve[i]!, [r0, v0] = curve[i - 1]!;
    if (value <= r1) return v0 + (v1 - v0) * (value - r0) / (r1 - r0);
  }
  return curve.at(-1)![1];
}

/** Signals that describe problem solving (DSA); every other signal is contest intelligence. */
export const PROBLEM_SOLVING_SIGNALS: readonly string[] = ["difficulty", "breadth", "advanced_topics", "solving_consistency", "solving_recency"];

/**
 * Bounded per-platform measures. Problem-solving signals and contest signals are emitted
 * separately; the engine composes them through configured, level-specific weights.
 */
export function scoreCompetitionSignals(value: CompetitionProfile, asOf: string, observedAt: string, config: ScoringConfig): CompetitionMeasure[] {
  const policy = config.v5Policy!.competition, platform = policy.platforms[value.platform] ?? policy.platforms.generic;
  if (!platform) return [];
  const n = config.normalizers, now = Date.parse(asOf), observed = Date.parse(observedAt), measures: CompetitionMeasure[] = [];
  const add = (signal: string, rawValue: unknown, normalizedValue: number, recencyFactor = 1, completeness = 1) =>
    measures.push({ signal, rawValue, normalizedValue: clamp(normalizedValue), path: `competition.${signal}`, recencyFactor: Math.max(0, Math.min(1, recencyFactor)), completeness });

  // --- problem solving: difficulty-weighted and saturating per band, so volume cannot dominate ---
  const difficultyParts = Object.entries(platform.difficultyWeights).flatMap(([key, weight]) => {
    const amount = value.difficulty[key]; return amount === null || amount === undefined ? [] : [{ value: ratio(amount, platform.difficultyCaps[key]!), weight }];
  });
  const difficultyWeight = difficultyParts.reduce((sum, x) => sum + x.weight, 0);
  const totalWeight = Object.values(platform.difficultyWeights).reduce((a, b) => a + b, 0);
  if (difficultyWeight) add("difficulty", value.difficulty, difficultyParts.reduce((sum, x) => sum + x.value * x.weight, 0) / difficultyWeight, 1, difficultyWeight / totalWeight);
  else if (value.platformLevel) add("difficulty", value.platformLevel, 100 * value.platformLevel.value / value.platformLevel.maximum, 1, 0.5);
  // Breadth needs a minimum body of solved work: a near-empty account is weak evidence, not
  // evidence of narrow breadth, so it is left unknown rather than scored as zero.
  const solvedBase = Math.max(value.totalSolved ?? 0, value.topics.reduce((sum, x) => sum + x.count, 0),
    Object.values(value.difficulty).reduce<number>((sum, x) => sum + (x ?? 0), 0));
  const enoughForBreadth = solvedBase >= 2 * n.topicMinimum!;
  if (value.topics.length && enoughForBreadth) add("breadth", value.topics, ratio(value.topics.filter((x) => x.count >= n.topicMinimum!).length, n.cpBreadthCap!));
  const advancedTags = new Set((platform.advancedTags ?? []).map((tag) => tag.toLowerCase()));
  const advanced = value.advancedTopics.length ? value.advancedTopics : value.topics.filter((x) => advancedTags.has(x.topic));
  if (value.advancedTopics.length || (advancedTags.size && value.topics.length && enoughForBreadth)) add("advanced_topics", advanced, ratio(advanced.filter((x) => x.count >= 3).length, platform.advancedTopicCap ?? 8));
  const consistent = value.consistency, consistencyAge = consistent.windowAsOf ? (now - Date.parse(consistent.windowAsOf)) / DAY : null;
  if (consistent.activeWeeks !== null && consistent.windowWeeks !== null && consistent.windowWeeks >= 4 && consistent.activeWeeks <= consistent.windowWeeks
    && consistencyAge !== null && consistencyAge >= 0 && consistencyAge <= 90 && Date.parse(consistent.windowAsOf!) <= observed) {
    add("solving_consistency", consistent, ratio(consistent.activeWeeks, consistent.windowWeeks), Math.pow(0.5, consistencyAge / n.cpRecencyHalfLifeDays!), Math.min(consistent.windowWeeks / n.cpConsistencyCap!, 1));
  }
  const activityAge = value.recency.windowAsOf ? (now - Date.parse(value.recency.windowAsOf)) / DAY : null;
  if (value.recency.activityCount !== null && activityAge !== null && activityAge >= 0 && activityAge <= 90 && Date.parse(value.recency.windowAsOf!) <= observed
    && (value.recency.sampleMaximum === null || value.recency.activityCount <= value.recency.sampleMaximum)) {
    const factor = Math.pow(0.5, activityAge / n.activityHalfLifeDays!);
    add("solving_recency", value.recency, ratio(value.recency.activityCount, platform.activityCap) * factor, factor);
  }

  // --- contests: platform-relative (tier curve + population percentile), never a raw rating ---
  const c = value.contest;
  const lastContest = c.lastContestAt && Date.parse(c.lastContestAt) <= now ? Date.parse(c.lastContestAt) : observed;
  const contestRecency = Math.pow(0.5, Math.max(0, now - lastContest) / (DAY * n.cpRecencyHalfLifeDays!));
  if ((c.attended ?? 0) > 0 || value.ratingHistory.length) {
    const parts: { value: number; weight: number }[] = [];
    const rankPercentile = c.rank !== null && c.population !== null && c.population >= 2 && c.rank >= 1 && c.rank <= c.population ? 100 * (c.population - c.rank) / (c.population - 1) : null;
    const percentile = c.percentile ?? rankPercentile;
    if (percentile !== null) parts.push({ value: percentile, weight: 50 });
    if (c.rating !== null && c.rating > 0) parts.push({ value: platformRatingScore(platform, c.rating), weight: 30 });
    if (c.maxRating !== null && c.maxRating > 0) parts.push({ value: platformRatingScore(platform, c.maxRating), weight: 20 });
    const weight = parts.reduce((sum, x) => sum + x.weight, 0);
    if (weight) add("contest", { rating: c.rating, maxRating: c.maxRating, percentile, attended: c.attended, bestRank: c.bestRank, averageRank: c.averageRank },
      parts.reduce((sum, x) => sum + x.value * x.weight, 0) / weight, contestRecency, weight / 100);
  }
  const t = value.trajectory;
  if (t.recentRating !== null && t.previousRating !== null && t.recentAt && t.previousAt && Date.parse(t.previousAt) < Date.parse(t.recentAt)
    && Date.parse(t.recentAt) <= observed && now - Date.parse(t.recentAt) <= n.cpTrajectoryWindowDays! * DAY) {
    // Change is measured in platform-normalized points, so +200 means different things per platform.
    const delta = platformRatingScore(platform, t.recentRating) - platformRatingScore(platform, t.previousRating);
    add("contest_trajectory", t, 50 + 2.5 * delta, Math.pow(0.5, (now - Date.parse(t.recentAt)) / (DAY * n.cpRecencyHalfLifeDays!)));
  }
  const lastYear = value.ratingHistory.filter((row) => now - Date.parse(row.at) <= 365 * DAY && Date.parse(row.at) <= now);
  if (c.participationRate !== null) add("contest_consistency", { participationRate: c.participationRate }, 100 * c.participationRate, contestRecency);
  else if (value.ratingHistory.length) add("contest_consistency", { contestsLastYear: lastYear.length }, ratio(lastYear.length, platform.contestParticipationCap ?? 12), contestRecency);
  if (c.lastContestAt && Date.parse(c.lastContestAt) <= now) add("contest_recency", { lastContestAt: c.lastContestAt }, 100 * Math.pow(0.5, (now - Date.parse(c.lastContestAt)) / (DAY * n.contestRecencyHalfLifeDays!)));
  const recentDeltas = value.ratingHistory.slice(-11).map((row, i, rows) => i ? row.rating - rows[i - 1]!.rating : null).filter((x): x is number => x !== null);
  if (recentDeltas.length >= 3) {
    const mean = recentDeltas.reduce((a, b) => a + b, 0) / recentDeltas.length;
    const stdev = Math.sqrt(recentDeltas.reduce((sum, x) => sum + (x - mean) ** 2, 0) / recentDeltas.length);
    add("rating_stability", { ratingChangeStdev: Math.round(stdev * 10) / 10, contests: recentDeltas.length + 1 }, 100 * (1 - Math.min(1, stdev / (platform.volatilityScale ?? 200))), contestRecency);
  }
  return measures;
}
