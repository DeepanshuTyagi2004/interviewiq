# Conversational Interviewer — Design

**Date:** 2026-07-06
**Status:** Approved (user auto-approved spec + plan + build)
**Scope:** `interviewiq-ai-service` only — the interview brain (`app/interview_agent/`), the worker/voice (`worker.py`, `voice.py`), and the prep persona (`app/interview_prep/`). Frontend + backend untouched.

## Goal

Make the live interview feel like a real conversation, not a recited script. Today the brain (a) delivers the opening greeting AND the first question back-to-back with no pause (`run_session` says both before it ever listens), and (b) marches the plan ladder mechanically — it doesn't acknowledge what the candidate actually said and moves on after a single answer. The interviewer voice is also hard-coded to one Deepgram Aura voice regardless of the persona's name/gender.

We keep the deterministic guarantees that make it a *fair* interview — scoring, pacing rails, scope guard, topic coverage, `SessionOutcome` — and add conversational behavior *on top*: the **plan is a guide (topics + rubric to reach), the decision graph is the guardrail (structure, scoring, pacing, scope)**.

## Design principle

> The LangGraph **decision** layer stays deterministic (which topic, whether an answer is scored, the pacing rails, scope refusal, when to end). What changes is the **voice + turn flow**: the interviewer reacts to what the candidate said, holds genuine back-and-forth on a point until it's resolved, opens with real small talk, and speaks in a voice matching the persona. Conversation on top; guardrails underneath. No guarantee is weakened.

## Components

### 1. Multi-turn interactive opening
Replaces the single opening-monologue-then-immediate-Q1. The opening becomes a short **conversational sub-phase** in `run_session`, each step waiting for the candidate:
- **GREET** — a short warm greeting + "how are you doing?" (NOT the format dump). → `await next_utterance()`.
- Candidate responds → **ORIENT** — react to their reply, then briefly explain the format (round, rough time, "think out loud, we'll work through a couple of problems together") + "anything you'd like to ask before we start?" → `await next_utterance()`.
- Candidate responds → if they ask something, **ANSWER_OPENING** (warm, logistics/expectations only — never reveal rubric/scoring) then re-check readiness or transition; if they're ready ("no, let's go"), transition. Support **back-and-forth here too** (they may ask more than one thing).
- Then **ASK_BASE** (first problem) → hand off to the main ladder loop.

Opening turns are **rapport, not answers**: they are NOT scored, do NOT accrue negative events, and do NOT count toward pacing/coverage. The opening phase has its own small bound (e.g. a max number of opening exchanges) so a chatty candidate can't stall forever before the interview starts.

### 2. Acknowledge-and-transition voice (every line)
Enrich `CONVERSE_SYSTEM` (+ `build_turn_prompt`) so every interviewer line first **acknowledges/reacts to the candidate's last turn**, then does the chosen Action's job, transitioning naturally — using the current plan item as the *topic to steer toward*, not a script to read. The recent transcript is already passed in (`transcript_tail`); the prompt just isn't told to use it. Add explicit guidance for the new opening Actions. (This is the product-voice IP — drafted here, tunable.)

### 3. Turn policy: understand → respond → stay-until-satisfied → advance
Every candidate reply is understood and gets a graceful, contextual response (acknowledge, answer a raised question, probe, follow up, encourage). The interviewer **stays on the current point through natural back-and-forth** (multiple turns per question are expected) and only advances to the next topic when the point is **adequately resolved** — not after one canned answer.

The one ceiling: **pacing.** Back-and-forth continues as long as the answer needs *until* the pacing gate says advance (preserving total-time + coverage). Concretely this tunes the `decide` router / `build_inputs` toward continued engagement (favor `ASK_FOLLOWUP`/probe when the answer is thin/partial and time remains; `MOVE_ON` when adequate or when pacing forces it). Scoring still grades only substantive answers; scope guard still refuses cross-round pivots.

### 4. Bounded mid-interview latitude
Tangents / curiosity / meta questions get a brief, warm engagement, then a natural steer back to the current problem — reusing the existing `CLARIFY`/`OFF_TOPIC`/`CHALLENGE`/`DISTRESS` handling, made warmer via the enriched converse prompt. The scope guard still refuses cross-round/out-of-scope pivots (with a plain, non-harsh redirect); pacing still owns the clock. Latitude is in tone/turns, not in structure.

### 5. Persona-matched TTS voice
- The `InterviewPlan` **persona gains a `gender` field** (`"male"` / `"female"` / `"neutral"`), emitted at prep-generation time (Pipeline 1) consistent with the invented name.
- The **worker maps `persona.gender` → a curated Deepgram Aura voice** (one male, one female, a neutral default) instead of the hard-coded `aura-2-asteria-en`.
- **Fallback for existing/cached plans** without the field: the worker infers gender from `persona.name` via a one-shot LLM classification at session start (using the already-loaded fast model), then maps to a voice. `PREP_PLAN_VERSION` is bumped so newly-generated plans carry `gender` directly (no inference needed going forward).
- The voice mapping is a small module-level dict (`GENDER_VOICES`) so it's easy to retune. Frontend unaffected (voice is server-side TTS).

### 6. Preserved guarantees (unchanged)
Hybrid scoring (competency⊕behavioral, only real answers), pacing rails (min-floor / base / max-ceiling + score bands), scope guard (round boundaries), negative events, `SessionOutcome`/`finalize`, the LiveKit transport + data-channel contract, and the frontend. The opening + acknowledgment + back-and-forth sit *around* these — none of their inputs/outputs change semantics.

## Where it changes (file map)

- `app/interview_agent/types.py` — add `Action.GREET`, `Action.ORIENT`, `Action.ANSWER_OPENING`; (if needed) an opening `TurnClass` or reuse existing; no change to scoring/pacing types.
- `app/interview_agent/state.py` — an opening-phase marker + opening-exchange counter on `SessionState`; `from_plan` unchanged otherwise.
- `app/interview_agent/session.py` — `run_session`: replace the opening monologue+immediate-Q1 with the multi-turn opening sub-phase; opening turns bypass `_score_last_answer`/pacing/negative-events; thread the candidate's last turn into line generation for acknowledgment.
- `app/interview_agent/graph.py` — `decide`/`build_inputs`: opening-phase routing to the opening Actions; tune follow-up-vs-move-on toward the stay-until-satisfied policy, pacing-capped.
- `app/interview_agent/prompts/converse.py` — enrich `CONVERSE_SYSTEM` (acknowledge + transition + opening-action guidance); bump `CONVERSE_PROMPT_VERSION`.
- `app/interview_agent/llm_ops.py` / `prompts/classify.py` — opening-phase classification (opening turns route to opening handling, not scored); an optional name→gender one-shot classifier for the voice fallback.
- `app/interview_agent/voice.py` — `select_voice(persona, *, infer=<llm callable>)` → Aura model; `GENDER_VOICES` map; worker uses it.
- `app/interview_agent/worker.py` — build the TTS with the persona-selected voice (pass the plan's persona to voice selection; wire the name-inference fallback via the loaded model).
- `app/interview_prep/` (prep persona generation prompt + schema) — persona emits `gender`; bump `PREP_PLAN_VERSION`.

## Testing

- Keep the **96 existing brain/slice tests green**; adapt the ones asserting the old opening flow (opening monologue + immediate Q1) to the new multi-turn opening.
- New tests:
  - Opening sub-phase drives correctly: GREET → wait → ORIENT → wait → (candidate question → ANSWER_OPENING → …) → ready → ASK_BASE; opening turns are **not scored** and accrue **no negative events**; the opening-exchange bound is enforced.
  - Turn policy: `decide` favors follow-up/probe when the answer is thin and time remains; `MOVE_ON` when adequate or when the pacing gate forces it (pacing-cap wins).
  - Converse prompt: `CONVERSE_SYSTEM`/`build_turn_prompt` carry the acknowledge+transition guidance and handle the new Actions.
  - Voice: `select_voice` maps male/female/neutral → the right Aura model; the name-inference fallback resolves a persona with no `gender`; the worker builds `deepgram.TTS` with the selected voice.
  - Prep: the persona-generation prompt asks for `gender` and the assembled persona includes it; `PREP_PLAN_VERSION` bumped.
- The real spoken conversational feel is validated by the **manual smoke** (live Deepgram + LiveKit); CI covers structure/routing/prompt-shape/voice-selection with fakes + `ScriptedTransport`.
- All prompt text is **product-voice IP** — drafted to a sensible, warm, professional default; tunable without structural change.

## Out of scope
Frontend/UI changes; barge-in/interruption (candidate talking over the AI); multi-language; changing the scoring/pacing/scope algorithms themselves. Post-interview analysis (sub-project E) remains separate.

## Definition of done
A candidate joins, is greeted with light small talk, replies, hears a brief format explanation, can ask questions (answered warmly, back-and-forth), then is taken into the problems — where the interviewer reacts to each reply, holds genuine multi-turn back-and-forth per point and only advances when satisfied (pacing-capped), speaks in a voice matching the persona's gender, and still gets fairly scored/paced/scope-guarded with a persisted `SessionOutcome`. All CI green; manual smoke confirms the conversational feel.

---

## Addendum — additional requirements (added mid-build 2026-07-06)

### A1. Richer, staged rapport opening (extends §1)
The opening warms up in stages, each awaiting the candidate: **GREET** ("hi, I'm <name> — how are you doing?") → wait → **RAPPORT** — one or two light background questions (where they're from, which college, grounded in the candidate profile in the plan when present) ~1–2 min → wait → **ORIENT** (explain the format) → invite questions → **ASK_BASE**. Rapport turns are rapport-only (not scored/paced), same as the rest of the opening.

### A2. Silence & inactivity handling (new)
The interviewer must never sit dead on silence, and must not mistake *thinking/coding* for absence.
- **Writing code is NOT inactivity.** Artifact edits (code/diagram) stream over the data channel; while the candidate is actively editing, the inactivity timer is suppressed/reset. The transport tracks a "last activity" timestamp (updated on artifact messages) and exposes recent-activity to the driver.
- On genuine inactivity (no speech AND no recent artifact activity): a gentle nudge ("are you still there?"), escalating over ~2–3 nudges; then a final warning ("I may need to stop the interview"); then a ~30s grace; if still nothing, **end gracefully** with a new `EndedReason.ABANDONED` (distinct from `ABORTED_TECHNICAL`). Counts/windows/grace are config'd (module constants ok). This supersedes the current bare `interview_silence_retries → ABORTED_TECHNICAL`.

### A3. Answer problem-clarification questions WITHOUT solving (refines §4)
When the candidate asks about the problem itself (constraints, input/output, examples, edge cases), the interviewer answers helpfully and specifically — but NEVER reveals the approach, algorithm, complexity target, or solution. Enforced in the `ANSWER_CLARIFY` converse guidance ("clarify the problem, never hint the path").

