/**
 * Blueprint prep audit (dev only): bench runs across the JD-fit personas × the catalogue × every
 * round type, through the same code a booking uses (BlueprintPrepService.benchRequest → AI service),
 * then checks every finished blueprint and writes a report.
 *
 *   pnpm exec tsx --env-file=.env scripts/dev/bench-blueprints.ts                 # the full matrix
 *   pnpm exec tsx --env-file=.env scripts/dev/bench-blueprints.ts --concurrency=3 --out=.blueprint-audit
 *   pnpm exec tsx --env-file=.env scripts/dev/bench-blueprints.ts --only=A-,D-     # case id prefixes
 *   pnpm exec tsx --env-file=.env scripts/dev/bench-blueprints.ts --list           # print the cases, run nothing
 *   pnpm exec tsx --env-file=.env scripts/dev/bench-blueprints.ts --minutes=30     # pin the round length (30, 35, 40, 45; default 45)
 *   pnpm exec tsx --env-file=.env scripts/dev/bench-blueprints.ts --minutes=draw   # draw one per case, as a booking does
 * The report shows every run's round length, so audits stay comparable.
 *
 * Cases: (A) every researched JD × a persona at its level, on the round a booking would start with;
 * (B) every persona not covered by A, on a practice template at its level; (C) every round type at
 * three levels; (D) the awkward paths: thin profiles, level mismatches, a user with no profile, a
 * round the brief doesn't have (must fail cleanly), loop + node bookings (official and practice),
 * cache bypass, and repeat-avoidance (a rerun that excludes the first run's problems).
 *
 * Bench runs never attach to a session and never touch anyone's seen list. Requires the personas
 * (seed-fit-personas.ts --apply) and the AI service running.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import type { RoundType } from "../../src/domain/enums.js";
import { drawRoundMinutes, MOCK_ROUND_MINUTES, ROUND_MINUTE_CHOICES } from "../../src/domain/liveRound.js";
import type { BlueprintRunRequest } from "../../src/integrations/aiService/types.js";
import { isObject, items, path, textOrNull } from "../../src/lib/json.js";
import { withContainer } from "./bootstrap.js";
import { FIT_PERSONAS, personaEmail, type FitPersona } from "./fitPersonas.js";

type Options = BlueprintRunRequest["options"];
type Expect = { status: "completed" } | { status: "failed"; code: string } | { status: "rejected"; message: RegExp };

interface Case {
  id: string;
  label: string;
  /** Persona slug, or a raw email for non-persona users. */
  who: string;
  jdId: string | null;
  loop?: { jdId: string };
  roundType: RoundType | null;
  options?: Partial<Options>;
  /** Replays an earlier case's request with its picked problems excluded (repeat-avoidance). */
  excludeFrom?: string;
  expect: Expect;
}

interface Outcome {
  id: string;
  label: string;
  runId: string | null;
  status: string;
  code: string | null;
  durationMs: number | null;
  /** The round length this run prepared for (the request's `duration_mins`). */
  minutes: number | null;
  llmCalls: number;
  cacheHits: number;
  cacheMisses: number;
  persona: string | null;
  shape: string | null;
  difficultyTarget: string | null;
  /** The round pack the blueprint's `rules` were composed from. */
  pack: string | null;
  slots: string[];
  issues: string[];
  notes: string[];
}

// The pack each round type runs on (a round type with its own pack, else its family's; anything else is dsa).
const PACK_OF_ROUND: Record<string, string> = { dsa: "dsa", "online-assessment": "online-assessment", "system-design": "system-design", lld: "lld", behavioural: "behavioural", "hiring-manager": "hiring-manager" };

// A DSA round asks one coding problem when it is 35 minutes or less or targets hard problems (3 slots), else two (4).
const SLOT_COUNTS: Record<string, number[]> = { dsa: [3, 4], "system-design": [2], lld: [2], behavioural: [7], "hiring-manager": [5] };
// A technical round with a behavioural part ("Coding + Leadership Principles") adds three `culture-` slots
// (two questions and a spare); DSA then keeps one coding problem instead of two, and at 30 minutes one question instead of two (5 slots).
const MIXED_SLOT_COUNTS: Record<string, number[]> = { dsa: [5, 6], "system-design": [4, 5], lld: [4, 5] };
const isCulture = (slotId: unknown): boolean => String(slotId).startsWith("culture-");
const LEVELS = ["intern", "fresher", "sde1", "sde2", "sde3", "staff", "principal", "distinguished"];

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The brief's rounds (what a booking starts on is the first one that is not an info step). */
function briefRounds(brief: unknown): { type: string; kind: string | null }[] {
  const fe = isObject(path(brief, "final_experience")) ? path(brief, "final_experience") : path(brief, "consolidated_process");
  return items(path(fe, "rounds")).map((r) => ({ type: textOrNull(path(r, "type")) ?? "", kind: textOrNull(path(r, "kind")) }));
}
const firstRound = (rounds: { type: string; kind: string | null }[]): RoundType => (rounds.find((r) => r.kind !== "info" && r.type)?.type as RoundType | undefined) ?? "dsa";

/** Round-robin personas per level, so every persona of a level gets used before any repeats. */
function personaPicker() {
  const byLevel = new Map<string, FitPersona[]>();
  for (const p of FIT_PERSONAS) byLevel.set(p.level, [...(byLevel.get(p.level) ?? []), p]);
  const cursor = new Map<string, number>();
  return {
    at(level: string): FitPersona {
      const list = byLevel.get(level) ?? [];
      if (list.length === 0) throw new Error(`no persona at level ${level}`);
      const i = cursor.get(level) ?? 0;
      cursor.set(level, i + 1);
      return list[i % list.length]!;
    },
  };
}

async function buildCases(jds: JobDescriptionRow[], briefOf: (jd: JobDescriptionRow) => Promise<unknown>): Promise<Case[]> {
  const cases: Case[] = [];
  const pick = personaPicker();
  const manual = jds.filter((j) => j.source === "manual");
  const templates = jds.filter((j) => j.source === "template");
  const rounds = new Map<string, { type: string; kind: string | null }[]>();
  for (const jd of manual) rounds.set(jd.id, briefRounds(await briefOf(jd)));

  // A: every researched JD, on its first round, with a persona at its level.
  const used = new Set<string>();
  manual.forEach((jd, i) => {
    const persona = pick.at(jd.level);
    used.add(persona.slug);
    cases.push({ id: `A-${String(i + 1).padStart(2, "0")}`, label: `${jd.company}/${jd.level}/${jd.specialization ?? "-"} first round`, who: persona.slug, jdId: jd.id, roundType: firstRound(rounds.get(jd.id)!), expect: { status: "completed" } });
  });

  // B: personas A never reached, on a practice template at their level (their own specialization).
  const companies = [...new Set(templates.map((t) => t.company))].sort();
  let b = 0;
  for (const persona of FIT_PERSONAS.filter((p) => !used.has(p.slug))) {
    const spec = persona.expectedSpecialization ?? "backend";
    const company = companies[b % companies.length]!;
    const jd = templates.find((t) => t.level === persona.level && t.specialization === spec && t.company === company)
      ?? templates.find((t) => t.level === persona.level && t.specialization === spec) ?? templates.find((t) => t.level === persona.level);
    if (!jd) continue;
    cases.push({ id: `B-${String(++b).padStart(2, "0")}`, label: `${persona.slug} on template ${jd.company}/${jd.level}/${jd.specialization ?? "-"}`, who: persona.slug, jdId: jd.id, roundType: firstRound(briefRounds(await briefOf(jd))), expect: { status: "completed" } });
  }

  // C: every round type at three levels, explicitly requested, on a JD whose brief has that round as a
  // live interview (an `info` step such as an online assessment can't be mocked: round_not_found).
  const interviews = (jdId: string) => rounds.get(jdId)!.filter((r) => r.kind !== "info");
  let cN = 0;
  const seen = new Set(cases.map((c) => `${c.jdId}|${c.roundType}`));
  for (const rt of ["dsa", "lld", "system-design", "behavioural", "hiring-manager"] as RoundType[]) {
    for (const level of ["fresher", "sde2", "sde3"]) {
      const jd = manual.find((j) => j.level === level && interviews(j.id).some((r) => r.type === rt) && !seen.has(`${j.id}|${rt}`));
      if (!jd) continue;
      seen.add(`${jd.id}|${rt}`);
      cases.push({ id: `C-${String(++cN).padStart(2, "0")}`, label: `${rt} at ${level} (${jd.company})`, who: pick.at(level).slug, jdId: jd.id, roundType: rt, expect: { status: "completed" } });
    }
  }

  // D: the awkward paths.
  const find = (company: string, level: string, spec?: string) => manual.find((j) => j.company === company && j.level === level && (!spec || j.specialization === spec))!;
  const google = find("google", "fresher"), razorpayStaff = find("razorpay", "staff"), amazonFresher = find("amazon", "fresher");
  const noBehavioural = manual.find((j) => !interviews(j.id).some((r) => r.type === "behavioural"))!;
  const accentureAse = find("accenture", "fresher", "ase");
  const template = templates.find((t) => t.level === "fresher" && t.specialization === "backend")!;
  cases.push(
    { id: "D-01", label: "thin profile (intern, tier 3) on google fresher DSA", who: "rohit-yadav", jdId: google.id, roundType: "dsa", expect: { status: "completed" } },
    { id: "D-02", label: "intern persona on a staff JD (level mismatch up)", who: "aarav-mehta", jdId: razorpayStaff.id, roundType: "dsa", expect: { status: "completed" } },
    { id: "D-03", label: "distinguished persona on a fresher JD (level mismatch down)", who: "lakshmi-narayanan", jdId: accentureAse.id, roundType: null, expect: { status: "completed" } },
    { id: "D-04", label: "user with no profile or fragments", who: "hud-visual-check@interviewiq.test", jdId: amazonFresher.id, roundType: "dsa", expect: { status: "completed" } },
    { id: "D-05", label: `round the brief lacks (${noBehavioural.company}/${noBehavioural.level} behavioural)`, who: "siddharth-menon", jdId: noBehavioural.id, roundType: "behavioural", expect: { status: "failed", code: "round_not_found" } },
    { id: "D-06", label: "unknown JD id", who: "aarav-mehta", jdId: "00000000-0000-4000-8000-000000000000", roundType: "dsa", expect: { status: "rejected", message: /jobDescriptionId/ } },
    { id: "D-07", label: "official loop + node (how a booking runs)", who: "pranav-deshpande", jdId: null, loop: { jdId: amazonFresher.id }, roundType: null, expect: { status: "completed" } },
    { id: "D-08", label: "practice template loop + node (standalone)", who: "ananya-krishnan", jdId: null, loop: { jdId: template.id }, roundType: null, expect: { status: "completed" } },
    { id: "D-09", label: "bypass both caches on A-01", who: cases[0]!.who, jdId: cases[0]!.jdId, roundType: cases[0]!.roundType, options: { bypass_blueprint_cache: true, bypass_answer_key_cache: true }, expect: { status: "completed" } },
    { id: "D-10", label: "repeat-avoidance: A-01 again with its problems excluded", who: cases[0]!.who, jdId: cases[0]!.jdId, roundType: cases[0]!.roundType, excludeFrom: "A-01", expect: { status: "completed" } },
    { id: "D-11", label: "same inputs as A-02 (blueprint cache hit expected)", who: cases[1]!.who, jdId: cases[1]!.jdId, roundType: cases[1]!.roundType, expect: { status: "completed" } },
  );
  return cases;
}

const lower = (s: unknown) => (typeof s === "string" ? s.toLowerCase() : "");

/** Checks on a finished run (spec §6 invariants, §9.2 briefing rule, repeat-avoidance). */
function check(c: Case, run: Record<string, unknown>, requestSent: BlueprintRunRequest, outcome: Outcome): void {
  const bp = run.blueprint;
  if (!isObject(bp)) {
    outcome.issues.push("completed run has no blueprint");
    return;
  }
  const slots = items(bp.slots).filter(isObject);
  const rt = String(path(bp, "round", "type"));
  outcome.slots = slots.map((s) => String(path(s, "problem", "slug")));
  const mixed = slots.some((s) => isCulture(path(s, "slot_id")));
  const want = mixed ? MIXED_SLOT_COUNTS[rt] : SLOT_COUNTS[rt];
  if (want !== undefined && !want.includes(slots.length)) outcome.issues.push(`${slots.length} slots, expected ${want.join(" or ")} for ${rt}`);
  if (new Set(outcome.slots).size !== outcome.slots.length) outcome.issues.push("duplicate problems across slots");
  for (const s of slots) {
    if (!isObject(path(s, "problem", "content")) || Object.keys(path(s, "problem", "content") as object).length === 0) outcome.issues.push(`${path(s, "slot_id")}: no problem content`);
    if (rt === "dsa" && !isCulture(path(s, "slot_id")) && path(s, "answer_key", "key", "reference_solution", "verified_against_examples") !== true) outcome.issues.push(`${path(s, "slot_id")}: DSA key not verified against the examples`);
    if (items(path(s, "branches")).length === 0) outcome.issues.push(`${path(s, "slot_id")}: no branches`);
    if (items(path(s, "hint_ladder")).length < 3) outcome.issues.push(`${path(s, "slot_id")}: hint ladder shorter than 3`);
  }
  // Validation stage: every check passed.
  const validate = items(run.stages).filter(isObject).find((s) => s.id === "validate");
  for (const chk of items(path(validate, "detail", "checks")).filter(isObject)) {
    if (chk.passed !== true) outcome.issues.push(`validate: ${chk.check} failed (${chk.detail})`);
  }
  // Exclusions honoured unless ignored.
  const excluded = new Set(requestSent.exclusions);
  if (!requestSent.options.ignore_exclusions) for (const slug of outcome.slots) if (excluded.has(slug)) outcome.issues.push(`picked an excluded problem: ${slug}`);
  // The briefing never leaks topics, problems or difficulty.
  const briefing = path(bp, "briefing");
  const text = lower(JSON.stringify(briefing));
  if (!text) outcome.issues.push("no briefing");
  else {
    for (const s of slots) if (text.includes(lower(path(s, "problem", "title")))) outcome.issues.push(`briefing names a problem: ${path(s, "problem", "title")}`);
    // A topic the public process already states in its format line ("expect Leadership Principles questions") is not a leak,
    // nor is the briefing's own fixed format label ("system design discussion with a shared whiteboard"): topics are
    // checked against the interviewer's name and style line, the only free text in the briefing.
    // The public text is the round's name and format line, compared without plural endings ("Leadership Principle questions").
    const stem = (t: string) => t.replace(/s\b/g, "");
    const publicFormat = stem(lower(`${requestSent.round?.name ?? ""} ${requestSent.round?.format ?? ""}`));
    const freeText = lower(`${path(briefing, "interviewer_name") ?? ""} ${path(briefing, "interviewer_style") ?? ""}`);
    for (const topic of requestSent.round?.topics ?? []) {
      if (topic.length > 3 && freeText.includes(lower(topic))) (publicFormat.includes(stem(lower(topic))) ? outcome.notes : outcome.issues).push(`briefing names a round topic: ${topic}`);
    }
    if (/\b(easy|medium|hard)\b/.test(text)) outcome.issues.push("briefing mentions difficulty");
    if (!(Number(path(briefing, "duration_mins")) > 0)) outcome.issues.push("briefing has no duration");
  }
  outcome.persona = textOrNull(path(bp, "persona", "name"));
  // An old blueprint without a shape id is the classic shape; a run with no blueprint has no shape and is not tallied as one.
  outcome.shape = isObject(bp) ? (textOrNull(path(bp, "shape_id")) ?? "classic") : null;
  outcome.difficultyTarget = textOrNull(path(bp, "round", "difficulty_target"));
  // The pack follows the round type, else its family, else dsa (mirrors the AI service's `pack_for`).
  outcome.pack = textOrNull(path(bp, "rules", "pack"));
  const wantPack = PACK_OF_ROUND[rt] ?? "dsa";
  if (outcome.pack !== wantPack) outcome.issues.push(`rules.pack is ${outcome.pack ?? "missing"}, expected ${wantPack} for ${rt}`);
  // Personalization should touch the candidate's own material (soft: a note, not an issue).
  const profile = requestSent.candidate_profile;
  const own = [...profile.projects.map((p) => p.name), ...profile.skills.slice(0, 10), ...profile.experience.map((e) => e.company ?? "")].map(lower).filter((s) => s.length > 3);
  const personalization = lower(JSON.stringify(path(bp, "personalization")));
  const touched = own.filter((s) => personalization.includes(s));
  outcome.notes.push(touched.length ? `personalization uses: ${touched.slice(0, 4).join(", ")}` : "personalization uses none of the candidate's own projects/skills/companies");
  const prov = path(bp, "provenance");
  outcome.cacheHits = Number(path(prov, "answer_key_hits") ?? 0);
  outcome.cacheMisses = Number(path(prov, "answer_key_misses") ?? 0);
}

async function main(): Promise<void> {
  const concurrency = Number(arg("concurrency") ?? 2);
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const outDir = resolve(arg("out") ?? ".blueprint-audit");
  const listOnly = process.argv.includes("--list");
  const minutesArg = arg("minutes") ?? String(MOCK_ROUND_MINUTES);
  const pinned = minutesArg === "draw" ? null : Number(minutesArg);
  if (pinned !== null && !(ROUND_MINUTE_CHOICES as readonly number[]).includes(pinned)) {
    throw new Error(`--minutes must be ${ROUND_MINUTE_CHOICES.join(", ")} or draw, got ${minutesArg}`);
  }

  await withContainer(async (c) => {
    const jds = await c.repos.jds.findAllActiveOrdered();
    let cases = await buildCases(jds, (jd) => c.enrichment.briefForJd(jd.id));
    if (only) cases = cases.filter((k) => only.some((prefix) => k.id.startsWith(prefix)));
    console.log(`${cases.length} case(s)`);
    if (listOnly) {
      for (const k of cases) console.log(`  ${k.id}  ${k.label}  [${k.who} · ${k.roundType ?? "loop round"}]`);
      return;
    }

    const userIdOf = async (who: string) => {
      const email = who.includes("@") ? who : personaEmail({ slug: who });
      const user = await c.repos.users.findByEmailInsensitive(email);
      if (!user) throw new Error(`${email} is not seeded; run seed-fit-personas.ts --apply first`);
      return user.id;
    };
    const requests = new Map<string, BlueprintRunRequest>();
    const outcomes: Outcome[] = [];
    const t0 = Date.now();

    const runCase = async (k: Case): Promise<void> => {
      const o: Outcome = { id: k.id, label: k.label, runId: null, status: "?", code: null, durationMs: null, minutes: null, llmCalls: 0, cacheHits: 0, cacheMisses: 0, persona: null, shape: null, difficultyTarget: null, pack: null, slots: [], issues: [], notes: [] };
      outcomes.push(o);
      try {
        const candidateId = await userIdOf(k.who);
        let request: BlueprintRunRequest;
        if (k.excludeFrom) {
          const base = requests.get(k.excludeFrom);
          if (!base) throw new Error(`${k.excludeFrom} has no request yet`);
          const prior = outcomes.find((x) => x.id === k.excludeFrom)?.slots ?? [];
          request = { ...base, exclusions: [...new Set([...base.exclusions, ...prior])], options: { ...base.options, bypass_blueprint_cache: true }, input_hash: "", input_parts: {} };
          o.notes.push(`excluding ${prior.length} problem(s) from ${k.excludeFrom}`);
        } else {
          let loopId: string | null = null, nodeId: string | null = null;
          if (k.loop) {
            const existing = items(path(await c.loops.listLoops(candidateId), "loops")).filter(isObject).find((l) => l.jdId === k.loop!.jdId);
            const loop = existing ?? (await c.loops.confirmLoop(candidateId, { jdId: k.loop.jdId }) as Record<string, unknown>);
            loopId = String(loop.id);
            const node = items(path(loop, "graph", "nodes")).filter(isObject).find((n) => n.kind === "round");
            nodeId = node ? String(node.id) : null;
            o.notes.push(`${existing ? "reused" : "confirmed"} loop ${loopId} (${String(loop.kind)}), node ${nodeId}`);
          }
          request = await c.blueprintPrep.benchRequest({ candidateId, jobDescriptionId: k.jdId, loopId, nodeId, roundType: k.roundType, options: { bypass_blueprint_cache: false, bypass_answer_key_cache: false, ignore_exclusions: false, ...k.options },
            roundMinutes: pinned ?? drawRoundMinutes() });
        }
        requests.set(k.id, request);
        o.minutes = request.round?.duration_mins ?? null;
        const started = await c.aiService.startBlueprintBench(request) as Record<string, unknown>;
        o.runId = String(started.run_id);
        let status = "running";
        const deadline = Date.now() + 12 * 60_000;
        while (status === "running" && Date.now() < deadline) {
          await sleep(3000);
          status = String(path(await c.aiService.getBlueprintRun(o.runId), "status"));
        }
        const run = await c.aiService.getBlueprintRunDetail(o.runId) as Record<string, unknown>;
        o.status = String(run.status);
        o.code = textOrNull(path(run, "error", "code"));
        o.durationMs = typeof run.duration_ms === "number" ? run.duration_ms : null;
        o.llmCalls = items(run.stages).filter(isObject).reduce((n, s) => n + items(s.llm_calls).length, 0);
        if (run.cached === true) o.notes.push("served from the blueprint cache");
        if (k.expect.status === "completed") {
          if (o.status !== "completed") o.issues.push(`expected completed, got ${o.status}${o.code ? ` (${o.code}: ${textOrNull(path(run, "error", "message"))})` : ""}`);
          else check(k, run, request, o);
        } else if (k.expect.status === "failed") {
          if (o.status !== "failed" || o.code !== k.expect.code) o.issues.push(`expected failed:${k.expect.code}, got ${o.status}${o.code ? `:${o.code}` : ""}`);
        } else o.issues.push(`expected the bench to reject the request, but a run started`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (k.expect.status === "rejected" && k.expect.message.test(message)) {
          o.status = "rejected";
          o.notes.push(`rejected as expected: ${message}`);
        } else {
          o.status = "error";
          o.issues.push(`threw: ${message}`);
        }
      }
      const flag = o.issues.length ? "✗" : "✓";
      console.log(`${flag} ${k.id} ${o.status}${o.code ? `:${o.code}` : ""} ${o.durationMs ? `${Math.round(o.durationMs / 1000)}s` : ""} ${o.persona ?? ""} — ${k.label}${o.issues.length ? `\n    ${o.issues.join("\n    ")}` : ""}`);
    };

    // D-09..D-11 depend on A-01/A-02 having finished: run A/B/C with the pool, then the D tail in order.
    const dependent = cases.filter((k) => k.excludeFrom || k.id === "D-09" || k.id === "D-11");
    const pooled = cases.filter((k) => !dependent.includes(k));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, pooled.length) }, async () => {
      while (next < pooled.length) await runCase(pooled[next++]!);
    }));
    for (const k of dependent) await runCase(k);

    // Report.
    outcomes.sort((a, b) => a.id.localeCompare(b.id));
    const failed = outcomes.filter((o) => o.issues.length);
    const personas = new Map<string, number>();
    for (const o of outcomes) if (o.persona) personas.set(o.persona, (personas.get(o.persona) ?? 0) + 1);
    const shapes = new Map<string, number>();
    for (const o of outcomes) if (o.shape) shapes.set(o.shape, (shapes.get(o.shape) ?? 0) + 1);
    const durations = outcomes.map((o) => o.durationMs).filter((d): d is number => d !== null).sort((a, b) => a - b);
    const lines = [
      `# Blueprint prep audit`, ``,
      `Generated ${new Date().toISOString()} · ${outcomes.length} run(s) in ${Math.round((Date.now() - t0) / 1000)}s · concurrency ${concurrency}`, ``,
      `- With issues: **${failed.length}**`,
      `- Durations: median ${durations.length ? Math.round(durations[Math.floor(durations.length / 2)]! / 1000) : 0}s, max ${durations.length ? Math.round(durations[durations.length - 1]! / 1000) : 0}s`,
      `- LLM calls: ${outcomes.reduce((n, o) => n + o.llmCalls, 0)} · answer-key cache hits ${outcomes.reduce((n, o) => n + o.cacheHits, 0)} / misses ${outcomes.reduce((n, o) => n + o.cacheMisses, 0)}`,
      `- Interviewer names used: ${[...personas.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} ×${k}`).join(", ")}`,
      `- Shapes used: ${[...shapes.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => `${n} ×${k}`).join(", ")}`,
      `- Round length: ${pinned === null ? "drawn per case" : `pinned at ${pinned} min`}`, ``,
      `| Case | Status | Time | Round | Pack | Interviewer | Difficulty | Problems | Issues / notes |`, `|---|---|---|---|---|---|---|---|---|`,
      ...outcomes.map((o) => `| ${o.id} ${o.label} | ${o.status}${o.code ? `:${o.code}` : ""} | ${o.durationMs ? `${Math.round(o.durationMs / 1000)}s` : ""} | ${o.minutes ? `${o.minutes} min` : ""} | ${o.pack ?? ""} | ${o.persona ?? ""} | ${o.difficultyTarget ?? ""} | ${o.slots.join(", ")} | ${[...o.issues.map((i) => `**${i}**`), ...o.notes].join("<br>")} |`),
    ];
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, "blueprint-audit.md"), lines.join("\n"));
    writeFileSync(resolve(outDir, "blueprint-audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), outcomes }, null, 2));
    console.log(`\n${failed.length} run(s) with issues; report at ${resolve(outDir, "blueprint-audit.md")}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
