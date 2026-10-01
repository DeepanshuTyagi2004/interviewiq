/**
 * Pure helpers for a JD's roadmap: turning the AI brief's rounds into what a round card shows,
 * and into the booking link. No gating state: rounds are never locked, cleared or scored here.
 */
import type { RoundType } from "@/features/interview";
import type { ConsolidatedRound, InterviewProcess } from "@/features/jobs";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";

function normalize(type: string): string {
  return type.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** Clear synonyms only; anything ambiguous ("technical", "coding", "HR") stays unmapped. */
const ALIASES: Record<string, RoundType> = {
  "problem-solving": "dsa",
  "data-structures-and-algorithms": "dsa",
  hld: "system-design",
  "high-level-design": "system-design",
  "low-level-design": "lld",
  "machine-coding": "lld",
  "object-oriented-design": "lld",
  behavioral: "behavioural",
  managerial: "hiring-manager",
  "hiring-manager-round": "hiring-manager",
};

const ROUND_TYPES = new Set<string>(ROUND_OPTIONS.map((o) => o.value));
const ROUND_LABEL = new Map<string, string>(ROUND_OPTIONS.map((o) => [o.value, o.label]));

/**
 * The brief's round `type` as an interview `RoundType` (`dsa | system-design | lld | behavioural |
 * hiring-manager`), or null when it has no live mock equivalent (e.g. an online assessment).
 */
export function toRoundType(type: string | null | undefined): RoundType | null {
  if (!type) return null;
  const key = normalize(type);
  if (ROUND_TYPES.has(key)) return key as RoundType;
  return ALIASES[key] ?? null;
}

/** Online assessments are automated tests; InterviewIQ doesn't run them as mock rounds. */
export function isOnlineAssessment(type: string | null | undefined): boolean {
  if (!type) return false;
  return ["online-assessment", "oa", "online-test", "coding-test"].includes(normalize(type));
}

/** `/interviews?jd=<id>&round=<RoundType>`, or just `?jd=<id>` when the round has no mapping. */
export function bookHref(jdId: string, type: string | null | undefined): string {
  const qs = new URLSearchParams({ jd: jdId });
  const round = toRoundType(type);
  if (round) qs.set("round", round);
  return `${ROUTES.interviews}?${qs.toString()}`;
}

function sentenceCase(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function roundNumber(round: ConsolidatedRound, index: number): number {
  return round.round_number ?? index + 1;
}

/** "DSA", "System Design", "Online Assessment"; an unknown type is shown humanized. */
export function roundTitle(round: ConsolidatedRound, index: number): string {
  const mapped = toRoundType(round.type);
  if (mapped) return ROUND_LABEL.get(mapped) ?? mapped;
  if (isOnlineAssessment(round.type)) return "Online Assessment";
  if (round.type?.trim()) return sentenceCase(round.type.replace(/[-_]+/g, " "));
  return `Round ${roundNumber(round, index)}`;
}

/** "Live coding on a shared editor · medium" — from the brief's format and difficulty. */
export function roundMeta(round: ConsolidatedRound): string {
  return [round.format?.trim(), round.difficulty?.trim().toLowerCase()].filter(Boolean).join(" · ");
}

/** Topics for a round: the legacy `dominant_topics`, else the staged pipeline's `topics`. */
export function roundTopics(round: ConsolidatedRound): string[] {
  const list = round.dominant_topics?.length ? round.dominant_topics : (round.topics ?? []);
  return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
}

/** How well-attested the round is, when the brief says so. Never a score. */
export function roundEvidence(round: ConsolidatedRound): string | null {
  const n = round.support_count ?? 0;
  const total = round.source_count_total ?? 0;
  if (n > 0 && total > 0) return `Reported in ${n} of ${total} sources`;
  if (round.consistency?.trim()) return sentenceCase(round.consistency);
  return null;
}

export type TopicRow = { topic: string; rounds: number[] };

/**
 * The brief's dominant topics, each with the rounds that list it. There are no frequencies in the
 * brief, so the round cross-reference stands in for the design's percentage bars.
 */
export function topicRows(process: InterviewProcess | null | undefined): TopicRow[] {
  const rounds = process?.rounds ?? [];
  const topics = [...new Set((process?.dominant_topics ?? []).map((t) => t.trim()).filter(Boolean))];
  return topics.map((topic) => {
    const key = topic.toLowerCase();
    const hits = rounds
      .map((r, i) => ({ n: roundNumber(r, i), topics: roundTopics(r).map((t) => t.toLowerCase()) }))
      .filter((r) => r.topics.includes(key))
      .map((r) => r.n);
    return { topic, rounds: [...new Set(hits)].sort((a, b) => a - b) };
  });
}
