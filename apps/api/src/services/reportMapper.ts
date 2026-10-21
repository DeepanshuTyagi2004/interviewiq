import type { InterviewSessionRow } from "../db/pg/schema.js";
import { readinessLevel, type ReadinessLevel } from "../domain/evaluation.js";
import { sessionRoundMinutes } from "../domain/liveRound.js";
import { isObject, items, textOrNull } from "../lib/json.js";

/**
 * The AI service's report document (snake_case, spec §11.3) as the contract's `RoundReport` (camelCase). Explicit per
 * field: free-form dictionaries (filler counts, the board scene) pass through untouched. An unscorable document only has
 * outcome / reason / meta / transcript; the scored sections then map to empty values.
 */

type Doc = Record<string, any>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const objs = (v: unknown): Doc[] => items(v).filter(isObject) as Doc[];
/** A count stored either as a number or as the list of what was counted (the AI service sends the list). */
const count = (v: unknown): number | null => (Array.isArray(v) ? v.length : num(v));
/** Transcript turn ids: integers, or "turn:12" / "12" strings; anything else is dropped. */
const turnIds = (v: unknown): number[] =>
  list(v).flatMap((x) => {
    if (typeof x === "number" && Number.isInteger(x)) return [x];
    const m = typeof x === "string" ? /^(?:turn:)?(\d+)$/.exec(x.trim()) : null;
    return m ? [Number(m[1])] : [];
  });

export interface NextRound { nodeId: string; name: string; type: string | null }

export interface ReportExtras {
  nextRound: NextRound | null;
  readiness: ReadinessLevel | null;
}

/** Readiness after the round, only for a loop that counts toward it; the round it unlocked, only after a pass. */
export function reportExtras(
  outcome: string | null,
  nodeId: string | null,
  loop: { countsTowardReadiness: boolean; graph: any; nodeStates: Record<string, string>; progress: { total: number; completed: number } } | null,
): ReportExtras {
  if (!loop) return { nextRound: null, readiness: null };
  const readiness = loop.countsTowardReadiness ? readinessLevel(loop.progress.completed, loop.progress.total) : null;
  let nextRound: NextRound | null = null;
  if (outcome === "passed" && nodeId) {
    const nodes = list(loop.graph?.nodes).filter(isObject) as Doc[];
    const edges = list(loop.graph?.edges).filter(isObject) as Doc[];
    // A successor stays the "next round" once booked, passed or in cooldown; only a locked one is not unlocked.
    const next = edges.filter((e) => e.source === nodeId).map((e) => String(e.target)).find((id) => loop.nodeStates[id] && loop.nodeStates[id] !== "locked");
    const node = nodes.find((n) => n.id === next);
    if (node) nextRound = { nodeId: String(node.id), name: textOrNull(node.name) ?? String(node.id), type: textOrNull(node.type) };
  }
  return { nextRound, readiness };
}

function mapMeta(m: Doc) {
  return {
    company: m.company ?? null, role: m.role ?? null, level: m.level ?? null, round: m.round_type ?? null,
    roundMinutes: num(m.round_minutes), minutesPlayed: num(m.minutes_played), codeStandard: m.code_standard ?? null,
    weightsVersion: m.weights_version ?? null, evalVersion: m.eval_version ?? null,
  };
}

function mapQuestion(q: Doc) {
  const code = isObject(q.code) ? q.code : null;
  const board = isObject(q.board) ? q.board : null;
  return {
    id: q.id, part: q.part, kind: q.kind, title: q.title ?? null, asked: q.asked ?? "",
    answerQuotes: objs(q.answer_quotes).map((x) => ({ turnId: x.turn_id, text: x.text })),
    verdict: q.verdict, score: num(q.score), strongAnswer: q.strong_answer ?? "", gap: q.gap ?? "",
    topics: objs(q.topics).map((t) => ({ subject: t.subject, topic: t.topic })),
    resumeConsistency: q.resume_consistency ?? null, resumeNote: q.resume_note ?? null,
    origin: q.origin === "candidate_led" ? "candidate_led" : "asked", intent: q.intent ?? "",
    ...(code ? { code: {
      language: code.language ?? "", text: code.text ?? "",
      trace: objs(code.trace).map((s) => ({ example: s.example, predicted: s.predicted, expected: s.expected, matches: s.matches === true })),
      logicWorks: code.logic_works ?? "no", syntaxSlips: list(code.syntax_slips),
    } } : {}),
    ...(board ? { board: { summary: board.summary ?? "", notes: list(board.notes), scene: board.scene ?? null } } : {}),
  };
}

const mapEvent = (e: Doc) => ({ kind: e.kind, at: e.at || null, turnId: e.turn_id ?? null, effect: e.effect });

function mapDispute(d: Doc) {
  return {
    target: { type: d.target_type, id: d.target_id }, reason: d.reason, decision: d.decision,
    oldScore: num(d.old_score), newScore: num(d.new_score), explanation: d.explanation ?? "",
    reportVersion: num(d.report_version), createdAt: d.created_at ?? null,
  };
}

function mapTranscript(t: Doc[]) {
  return t.map((x) => ({
    turnId: x.turn_id, speaker: x.speaker, text: x.text, at: x.at ?? null, markers: objs(x.markers).map((m) => ({ kind: m.kind, note: m.note ?? "" })),
    cutOff: x.cut_off === true,
  }));
}

/** The report's `meta` from the session row alone, for the non-ready statuses (no AI call). */
export function sessionMeta(s: InterviewSessionRow) {
  return {
    company: s.company, role: s.role, level: s.level, round: s.roundType, roundMinutes: sessionRoundMinutes(s),
    minutesPlayed: s.durationS != null ? Math.round((s.durationS / 60) * 10) / 10 : null, codeStandard: s.codeStandard ?? null,
    weightsVersion: null, evalVersion: s.evalVersion ?? null,
  };
}

export interface RecheckState {
  pending: boolean;
  target: { type: "question" | "area"; id: string } | null;
}

export function toRoundReport(doc: Doc, session: InterviewSessionRow, extras: ReportExtras, recheck: RecheckState = { pending: false, target: null }) {
  const scored = doc.outcome !== "unscorable";
  const delivery = isObject(doc.delivery) ? doc.delivery : {};
  const stats = isObject(delivery.stats) ? delivery.stats : {};
  const endQ = isObject(doc.end_questions) ? doc.end_questions : null;
  return {
    status: "ready" as const,
    version: num(doc.version) ?? 0,
    meta: mapMeta(isObject(doc.meta) ? doc.meta : {}),
    outcome: doc.outcome ?? session.outcome ?? null,
    unscorableReason: scored ? null : (doc.unscorable_reason ?? null),
    score: scored ? num(doc.score) : null,
    passMark: num(doc.pass_mark) ?? session.passMark,
    verdict: doc.verdict ?? null, cap: doc.cap ?? null,
    baseScore: scored ? num(doc.base_score) : null,
    bonusTotal: scored ? num(doc.bonus_total) : null,
    penaltyTotal: scored ? num(doc.penalty_total) : null,
    practicalScore: num(doc.practical_score), theoryScore: num(doc.theory_score),
    retakeAfter: session.retakeAfter, nextRound: extras.nextRound, readiness: extras.readiness,
    areas: objs(doc.areas).map((a) => ({
      key: a.key, label: a.label, weight: num(a.weight) ?? 0, score: num(a.score) ?? 0, reason: a.reason ?? "",
      evidence: list(a.evidence), previousScore: num(a.previous_score),
    })),
    adjustments: objs(doc.adjustments).map((a) => ({ kind: a.kind, label: a.label ?? "", delta: num(a.delta) ?? 0, turnId: a.turn_id ?? null, at: a.at ?? null, note: a.note ?? "" })),
    questions: objs(doc.questions).map(mapQuestion),
    delivery: {
      observations: objs(delivery.observations).map((o) => ({ text: o.text, examples: turnIds(o.examples) })),
      stats: { medianAnswerLatencyS: num(stats.median_answer_latency_s), slowStarts: count(stats.slow_starts), fillers: isObject(stats.fillers) ? stats.fillers : {}, longSilences: count(stats.long_silences), selfCorrections: num(stats.self_corrections) },
    },
    conduct: objs(doc.conduct).map(mapEvent),
    integrity: objs(doc.integrity).map(mapEvent),
    focus: objs(doc.focus).map((f) => ({ title: f.title, why: f.why, exampleQuote: f.example_quote ?? "", exampleNote: f.example_note ?? "", moments: list(f.moments) })),
    topicGaps: objs(doc.topic_gaps).map((g) => ({
      subject: g.subject,
      topics: objs(g.topics).map((t) => ({ topic: t.topic, why: t.why ?? "", practice: objs(t.practice).map((p) => ({ slug: p.slug, title: p.title, difficulty: p.difficulty ?? null, ...(p.retry === true ? { retry: true } : {}) })) })),
    })),
    strengths: list(doc.strengths), summary: doc.summary ?? "",
    ...(endQ ? { endQuestions: { quality: endQ.quality, bonus: num(endQ.bonus) ?? 0, note: endQ.note ?? "" } } : {}),
    transcript: mapTranscript(objs(doc.transcript)),
    disputes: objs(doc.disputes).map(mapDispute),
    recheckPending: recheck.pending,
    recheckTarget: recheck.pending ? recheck.target : null,
  };
}
