/**
 * Competition / hackathon / OSS-program knowledge base and candidate-result scoring.
 *
 * Results are extracted DETERMINISTICALLY from achievement text (knowledge-base aliases plus
 * year/round/rank/participant/percentile patterns): no LLM is needed to read "ICPC Asia Regional
 * 2024, rank 45 of 1200". Outcomes follow a ladder (participation < qualification < finalist <
 * top-ranked < winner) and are scaled by the event's own metadata, never by its name alone.
 * Resume-sourced results stay SELF_REPORTED; only collector-supplied results are DIRECT.
 */
import { cleanText, list, number, object } from "./sanitization.js";
import type { ScoringConfig } from "./types.js";

export type EventKind = "cp_contest" | "hackathon" | "oss_program" | "recognition";
export type ResultStatus = "participation" | "qualification" | "selected" | "finalist" | "completed" | "top_ranked" | "winner";

export interface CompetitionEntity {
  id: string;
  name: string;
  aliases: string[];
  organizer: string;
  kind: EventKind;
  geography: "university" | "regional" | "national" | "international";
  /** Approximate scale; descriptive metadata only. */
  participantCount: number | null;
  selectionStructure: string;
  /** Ordered rounds; reaching a later round implies at least the mapped status. */
  rounds: { name: string; aliases: string[]; status: ResultStatus }[];
  /** 0-100 editorial difficulty and reputation (provisional; reviewable knowledge-base data). */
  difficulty: number;
  reputation: number;
  team: "individual" | "team" | "either";
  historicalMetadata: string | null;
  source: string;
}

export interface CandidateCompetitionResult {
  competitionId: string;
  kind: EventKind;
  year: number | null;
  round: string | null;
  rank: number | null;
  participants: number | null;
  percentile: number | null;
  status: ResultStatus;
  /** A podium/medal/runner-up placement stated in the evidence (not just reaching a stage). */
  podium: boolean;
  teamOrIndividual: "team" | "individual" | null;
  teamSize: number | null;
  evidence: string;
  evidencePath: string;
  verificationStatus: "DIRECT" | "SELF_REPORTED";
}

const round = (name: string, status: ResultStatus, aliases: string[] = []) => ({ name, aliases: [name, ...aliases], status });

/** Extensible: adding a competition is a data change, never a scoring-engine change. */
export const COMPETITION_KNOWLEDGE_BASE: readonly CompetitionEntity[] = Object.freeze([
  { id: "icpc", name: "ICPC", aliases: ["icpc", "acm icpc", "acm-icpc", "international collegiate programming contest"], organizer: "ICPC Foundation", kind: "cp_contest", geography: "international", participantCount: 50000,
    selectionStructure: "University teams: online preliminary -> regional contests -> World Finals",
    rounds: [round("online preliminary", "participation", ["preliminary", "online round", "prelims"]), round("regional", "qualification", ["regionals", "regionalist", "regional finals", "asia regional"]), round("world finals", "top_ranked", ["world finalist", "wf"])],
    difficulty: 95, reputation: 98, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "ioi", name: "International Olympiad in Informatics", aliases: ["ioi", "international olympiad in informatics"], organizer: "IOI", kind: "cp_contest", geography: "international", participantCount: 350,
    selectionStructure: "National olympiad selection; ~4 students per country", rounds: [], difficulty: 98, reputation: 97, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "inoi", name: "Indian National Olympiad in Informatics", aliases: ["inoi", "indian national olympiad in informatics", "zonal computing olympiad", "zco"], organizer: "IARCS", kind: "cp_contest", geography: "national", participantCount: 5000,
    selectionStructure: "ZCO -> INOI -> IOITC -> IOI team", rounds: [round("zco", "participation", ["zonal computing olympiad"]), round("inoi", "qualification"), round("ioitc", "finalist", ["training camp"])],
    difficulty: 80, reputation: 80, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "google_code_jam", name: "Google Code Jam", aliases: ["google code jam", "code jam", "gcj"], organizer: "Google", kind: "cp_contest", geography: "international", participantCount: 30000,
    selectionStructure: "Qualification -> Round 1 -> Round 2 -> Round 3 -> World Finals", rounds: [round("qualification round", "participation", ["qualification"]), round("round 1", "qualification", ["round 1a", "round 1b", "round 1c"]), round("round 2", "qualification"), round("round 3", "finalist"), round("world finals", "top_ranked", ["finals"])],
    difficulty: 92, reputation: 95, team: "individual", historicalMetadata: "Discontinued after 2023; historical results remain valid.", source: "knowledge-base-v1" },
  { id: "google_kick_start", name: "Google Kick Start", aliases: ["kick start", "kickstart", "google kickstart"], organizer: "Google", kind: "cp_contest", geography: "international", participantCount: 20000,
    selectionStructure: "Independent rounds", rounds: [], difficulty: 70, reputation: 75, team: "individual", historicalMetadata: "Discontinued after 2022.", source: "knowledge-base-v1" },
  { id: "google_hash_code", name: "Google Hash Code", aliases: ["hash code", "hashcode"], organizer: "Google", kind: "cp_contest", geography: "international", participantCount: 100000,
    selectionStructure: "Team online qualification -> World Finals", rounds: [round("online qualification", "participation", ["qualification"]), round("world finals", "top_ranked", ["finals"])],
    difficulty: 75, reputation: 80, team: "team", historicalMetadata: "Discontinued after 2022.", source: "knowledge-base-v1" },
  { id: "meta_hacker_cup", name: "Meta Hacker Cup", aliases: ["meta hacker cup", "facebook hacker cup", "hacker cup"], organizer: "Meta", kind: "cp_contest", geography: "international", participantCount: 25000,
    selectionStructure: "Qualification -> Round 1 -> Round 2 -> Round 3 -> Finals", rounds: [round("qualification round", "participation", ["qualification"]), round("round 1", "qualification"), round("round 2", "qualification"), round("round 3", "finalist"), round("finals", "top_ranked", ["final round"])],
    difficulty: 90, reputation: 90, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "topcoder_open", name: "TopCoder Open", aliases: ["topcoder open", "tco"], organizer: "Topcoder", kind: "cp_contest", geography: "international", participantCount: 10000,
    selectionStructure: "Online rounds -> onsite finals", rounds: [round("online round", "participation"), round("finals", "top_ranked", ["onsite finals"])], difficulty: 92, reputation: 85, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "tcs_codevita", name: "TCS CodeVita", aliases: ["codevita", "tcs codevita"], organizer: "TCS", kind: "cp_contest", geography: "international", participantCount: 400000,
    selectionStructure: "Round 1 -> Round 2 -> Grand Finale", rounds: [round("mockvita", "participation"), round("round 1", "participation", ["pre-qualifier", "zonal round"]), round("round 2", "qualification", ["qualifier round"]), round("grand finale", "finalist", ["finale"])],
    difficulty: 65, reputation: 70, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "codechef_snackdown", name: "CodeChef SnackDown", aliases: ["snackdown"], organizer: "CodeChef", kind: "cp_contest", geography: "international", participantCount: 25000,
    selectionStructure: "Online qualifiers -> pre-elimination -> elimination -> finals", rounds: [round("qualifier", "participation", ["online qualifier"]), round("elimination", "qualification", ["pre-elimination"]), round("finals", "top_ranked", ["final"])],
    difficulty: 85, reputation: 78, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "hackwithinfy", name: "HackWithInfy", aliases: ["hackwithinfy", "hack with infy"], organizer: "Infosys", kind: "cp_contest", geography: "national", participantCount: 100000,
    selectionStructure: "Round 1 -> Round 2 -> Grand Finale", rounds: [round("round 1", "participation"), round("round 2", "qualification"), round("grand finale", "finalist", ["finale"])], difficulty: 60, reputation: 60, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "smart_india_hackathon", name: "Smart India Hackathon", aliases: ["smart india hackathon", "sih"], organizer: "Government of India (MoE Innovation Cell)", kind: "hackathon", geography: "national", participantCount: 50000,
    selectionStructure: "Internal institute round -> national Grand Finale", rounds: [round("internal hackathon", "participation", ["internal round", "college round"]), round("grand finale", "finalist", ["finale", "national finale"])],
    difficulty: 60, reputation: 75, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "google_solution_challenge", name: "Google Solution Challenge", aliases: ["solution challenge", "google solution challenge"], organizer: "Google Developer Student Clubs", kind: "hackathon", geography: "international", participantCount: 10000,
    selectionStructure: "Submission -> Top 100 -> Top 10 finalists -> winners", rounds: [round("top 100", "qualification"), round("top 10", "finalist", ["global finalist"])], difficulty: 60, reputation: 70, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "microsoft_imagine_cup", name: "Microsoft Imagine Cup", aliases: ["imagine cup"], organizer: "Microsoft", kind: "hackathon", geography: "international", participantCount: 20000,
    selectionStructure: "Online -> regional/semifinal -> world finals", rounds: [round("semifinal", "qualification", ["semi-final", "regional finals"]), round("world finals", "finalist", ["world championship"])], difficulty: 70, reputation: 80, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "nasa_space_apps", name: "NASA Space Apps Challenge", aliases: ["space apps", "nasa space apps"], organizer: "NASA", kind: "hackathon", geography: "international", participantCount: 50000,
    selectionStructure: "Local events -> global nominees -> global winners", rounds: [round("global nominee", "finalist", ["global finalist"])], difficulty: 55, reputation: 70, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "ethglobal", name: "ETHGlobal", aliases: ["ethglobal", "eth global", "ethindia", "eth india"], organizer: "ETHGlobal", kind: "hackathon", geography: "international", participantCount: 2000,
    selectionStructure: "Event hackathon -> finalists -> prizes", rounds: [round("finalist", "finalist")], difficulty: 65, reputation: 70, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "hackmit", name: "HackMIT", aliases: ["hackmit", "hack mit"], organizer: "MIT", kind: "hackathon", geography: "international", participantCount: 1000, selectionStructure: "Selective application", rounds: [], difficulty: 70, reputation: 75, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "hack_the_north", name: "Hack the North", aliases: ["hack the north"], organizer: "University of Waterloo", kind: "hackathon", geography: "international", participantCount: 1000, selectionStructure: "Selective application", rounds: [], difficulty: 70, reputation: 75, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "mlh_hackathon", name: "Major League Hacking event", aliases: ["mlh", "major league hacking"], organizer: "Major League Hacking", kind: "hackathon", geography: "international", participantCount: null, selectionStructure: "Member-event hackathons", rounds: [], difficulty: 45, reputation: 55, team: "team", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "gsoc", name: "Google Summer of Code", aliases: ["google summer of code", "gsoc"], organizer: "Google", kind: "oss_program", geography: "international", participantCount: 1200,
    selectionStructure: "Proposal review by mentoring organizations; low acceptance rate", rounds: [], difficulty: 85, reputation: 92, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "outreachy", name: "Outreachy", aliases: ["outreachy"], organizer: "Software Freedom Conservancy", kind: "oss_program", geography: "international", participantCount: 150, selectionStructure: "Application + contribution period", rounds: [], difficulty: 85, reputation: 88, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "lfx_mentorship", name: "LFX Mentorship", aliases: ["lfx mentorship", "lfx", "linux foundation mentorship"], organizer: "Linux Foundation", kind: "oss_program", geography: "international", participantCount: 300, selectionStructure: "Project-level application", rounds: [], difficulty: 80, reputation: 85, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "mlh_fellowship", name: "MLH Fellowship", aliases: ["mlh fellowship", "mlh fellow"], organizer: "Major League Hacking", kind: "oss_program", geography: "international", participantCount: 500, selectionStructure: "Application + interview", rounds: [], difficulty: 75, reputation: 78, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "gssoc", name: "GirlScript Summer of Code", aliases: ["girlscript summer of code", "gssoc"], organizer: "GirlScript Foundation", kind: "oss_program", geography: "national", participantCount: 20000, selectionStructure: "Open registration; leaderboard by merged PRs", rounds: [], difficulty: 45, reputation: 55, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
  { id: "hacktoberfest", name: "Hacktoberfest", aliases: ["hacktoberfest"], organizer: "DigitalOcean", kind: "oss_program", geography: "international", participantCount: 100000, selectionStructure: "Open participation", rounds: [], difficulty: 20, reputation: 35, team: "individual", historicalMetadata: null, source: "knowledge-base-v1" },
] satisfies CompetitionEntity[]);

const LADDER: ResultStatus[] = ["participation", "qualification", "selected", "finalist", "completed", "top_ranked", "winner"];
const higher = (a: ResultStatus, b: ResultStatus): ResultStatus => LADDER.indexOf(a) >= LADDER.indexOf(b) ? a : b;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, alias: string) => new RegExp(`(?<![a-z0-9])${escape(alias)}(?![a-z0-9])`, "i").test(text);
const int = (raw: string | undefined) => raw ? Number.parseInt(raw.replace(/,/g, ""), 10) : NaN;

function entityFor(text: string): CompetitionEntity | null {
  let best: { entity: CompetitionEntity; length: number } | null = null;
  for (const entity of COMPETITION_KNOWLEDGE_BASE) for (const alias of entity.aliases) {
    if (has(text, alias) && (!best || alias.length > best.length)) best = { entity, length: alias.length };
  }
  return best?.entity ?? null;
}

/** One achievement line -> a structured result, or null when it is not a competition/program. */
export function extractCompetitionResult(text: string, evidencePath: string, verificationStatus: CandidateCompetitionResult["verificationStatus"] = "SELF_REPORTED"): CandidateCompetitionResult | null {
  const clean = cleanText(text);
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const entity = entityFor(lower);
  const kind: EventKind | null = entity?.kind
    ?? (/\bhack(?:athon|fest)\b|\bhackathon\b/i.test(lower) ? "hackathon"
      : /\b(?:coding|programming|algorithm(?:ic)?)\s+(?:contest|competition|challenge|olympiad)|\bcodathon\b|\bcode\s*sprint\b|\bolympiad in informatics\b/i.test(lower) ? "cp_contest"
        : /\b(?:scholarship|fellowship|dean'?s list|merit award|best (?:project|paper) award)\b/i.test(lower) ? "recognition" : null);
  if (!kind) return null;
  if (/\b(?:aspir\w*|want to|plan(?:ning)? to|will participate|registered for)\b/i.test(lower)) return null;
  const years = [...lower.matchAll(/\b(19[7-9]\d|20\d{2})\b/g)].map((m) => Number(m[1]));
  // Being in a selective program is itself a selection; open-registration programs start at participation.
  const open = entity ? /\bopen (?:registration|participation)\b/i.test(entity.selectionStructure) : false;
  let status: ResultStatus = (kind === "oss_program" || kind === "recognition") && !open ? "selected" : "participation";
  if (/\b(?:winners?|won|first (?:place|prize)|1st (?:place|prize|position)|champions?|gold medal(?:ist)?)\b/.test(lower)) status = higher(status, "winner");
  const podium = /\b(?:runners?[- ]up|(?:2nd|3rd|second|third) (?:place|prize|position)|silver|bronze|medal(?:ist)?)\b/.test(lower);
  if (podium || /\bhonou?rable mention\b/.test(lower)) status = higher(status, "top_ranked");
  if (/\bfinal(?:ist)?s?\b(?!\s+year)|\bgrand finale\b|\bfinale\b/.test(lower)) status = higher(status, "finalist");
  if (/\bqualif(?:ied|ier|ication)\b|\bcleared\b|\badvanced to\b|\bsemi[- ]?final(?:ist)?s?\b/.test(lower)) status = higher(status, "qualification");
  if (kind === "oss_program" && /\b(?:completed|successfully completed|graduated|passed final evaluation)\b/.test(lower)) status = higher(status, "completed");
  let roundName: string | null = null;
  for (const r of entity?.rounds ?? []) if (r.aliases.some((alias) => has(lower, alias))) { roundName = r.name; status = higher(status, r.status); }
  const rankMatch = /\b(?:rank(?:ed)?|air|global rank|position|place)\s*[:#]?\s*(\d[\d,]{0,8})\b/.exec(lower) ?? /(?:^|\s)#(\d[\d,]{0,8})\b/.exec(lower)
    ?? /\b(\d[\d,]{0,8})(?:st|nd|rd|th)\s+(?:place|rank|position)\b/.exec(lower);
  const participantsMatch = /\b(?:out of|of|among|from)\s+(\d[\d,]{1,9})\+?\s*(?:participants|teams|contestants|competitors|students|applicants|people)?\b/.exec(lower)
    ?? /\b(\d[\d,]{2,9})\+?\s*(?:participants|teams|contestants|competitors|applicants)\b/.exec(lower);
  const percentileMatch = /\btop\s*(\d{1,2}(?:\.\d+)?)\s*%/.exec(lower);
  let rank = int(rankMatch?.[1]), participants = int(participantsMatch?.[1]);
  if (!Number.isFinite(rank) || rank < 1) rank = NaN;
  if (!Number.isFinite(participants) || participants < 2 || (Number.isFinite(rank) && rank > participants)) participants = NaN;
  if (Number.isFinite(rank) && rank === 1 && Number.isFinite(participants)) status = higher(status, "winner");
  const teamSize = int(/\bteam of (\d{1,2})\b/.exec(lower)?.[1]);
  return {
    competitionId: entity?.id ?? `generic_${kind}`, kind, year: years.length ? Math.max(...years) : null, round: roundName,
    rank: Number.isFinite(rank) ? rank : null, participants: Number.isFinite(participants) ? participants : null,
    percentile: percentileMatch ? Math.max(0, 100 - Number(percentileMatch[1])) : null, status, podium,
    teamOrIndividual: /\bteam\b/.test(lower) || entity?.team === "team" ? "team" : entity?.team === "individual" ? "individual" : null,
    teamSize: Number.isFinite(teamSize) && teamSize > 0 ? teamSize : null, evidence: clean.slice(0, 300), evidencePath, verificationStatus,
  };
}

/** Collector-supplied structured results (e.g. a future ICPC adapter) are validated, never trusted blindly. */
export function sanitizeCompetitionResult(raw: unknown, evidencePath: string): CandidateCompetitionResult | null {
  const value = object(raw), id = cleanText(value.competitionId)?.toLowerCase();
  const entity = COMPETITION_KNOWLEDGE_BASE.find((item) => item.id === id);
  const status = LADDER.includes(value.status as ResultStatus) ? value.status as ResultStatus : null;
  if (!entity || !status) return null;
  const rank = number(value.rank), participants = number(value.participants), year = number(value.year), percentile = number(value.percentile);
  return { competitionId: entity.id, kind: entity.kind, year: year !== null && Number.isInteger(year) && year >= 1970 && year <= 9999 ? year : null,
    round: cleanText(value.round), rank: rank !== null && Number.isInteger(rank) && rank >= 1 ? rank : null,
    participants: participants !== null && Number.isInteger(participants) && participants >= 2 ? participants : null,
    percentile: percentile !== null && percentile <= 100 ? percentile : null, status, podium: value.podium === true,
    teamOrIndividual: value.teamOrIndividual === "team" || value.teamOrIndividual === "individual" ? value.teamOrIndividual : null,
    teamSize: number(value.teamSize), evidence: cleanText(value.evidence)?.slice(0, 300) ?? entity.name, evidencePath, verificationStatus: "DIRECT" };
}

/** Deterministic 0-100 for one result: ladder or rank percentile, scaled by event metadata. Permanent (no decay). */
export function scoreCompetitionResult(result: CandidateCompetitionResult, config: ScoringConfig, currentYear: number): { score: number; eventFactor: number } | null {
  if (result.year !== null && result.year > currentYear) return null;
  const policy = config.v5Policy!.results, entity = COMPETITION_KNOWLEDGE_BASE.find((item) => item.id === result.competitionId);
  const statusScore = (status: ResultStatus) => policy.statusScores[status] ?? policy.statusScores.participation ?? 20;
  // A selective open-source programme (GSoC, Outreachy, LFX...) from an earlier year is listed as done:
  // selection was the gate, so it scores as completed unless the text says otherwise. This year's is "selected".
  const status: ResultStatus = result.kind === "oss_program" && result.status === "selected" && result.year !== null && result.year < currentYear ? "completed" : result.status;
  let score = statusScore(status);
  const percentile = result.percentile ?? (result.rank !== null && result.participants !== null ? 100 * (result.participants - result.rank) / (result.participants - 1) : null);
  if (percentile !== null) {
    // Within one stage of a multi-stage event, rank only interpolates toward the next stage, so a
    // strong regional rank never outranks reaching the finals.
    const rounds = entity?.rounds ?? [], at = rounds.findIndex((r) => r.name === result.round), next = at >= 0 ? rounds[at + 1] : undefined;
    score = next ? Math.max(score, statusScore(status) + (statusScore(next.status) - statusScore(status)) * 0.9 * percentile / 100)
      : Math.max(score, 25 + 0.7 * percentile);
  }
  // A podium in the event's final stage (or a single-stage event) sits between top-ranked and winner.
  const finalStage = !entity?.rounds.length || entity.rounds.at(-1)!.name === result.round;
  if (result.podium && status === "top_ranked" && finalStage) score = Math.max(score, (statusScore("top_ranked") + statusScore("winner")) / 2);
  const eventFactor = entity ? 0.55 + 0.45 * (0.6 * entity.difficulty + 0.4 * entity.reputation) / 100 : policy.unknownEventFactor;
  return { score: Math.max(0, Math.min(100, score * eventFactor)), eventFactor: Math.round(eventFactor * 1000) / 1000 };
}

export function extractCompetitionResults(lines: { text: string; path: string }[]): CandidateCompetitionResult[] {
  return lines.flatMap((line) => { const result = extractCompetitionResult(line.text, line.path); return result ? [result] : []; });
}

export function collectorResults(raw: unknown, path: string): CandidateCompetitionResult[] {
  return list(raw).flatMap((item, i) => { const result = sanitizeCompetitionResult(item, `${path}[${i}]`); return result ? [result] : []; });
}
