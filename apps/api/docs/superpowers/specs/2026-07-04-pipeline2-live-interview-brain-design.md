# Pipeline 2 — Live Interview Brain (LangGraph) Design

**Date:** 2026-07-04
**Status:** Design — pending user review
**Scope:** Sub-projects **B (agent brain)** + **C (real-time scoring & adaptive pacing)** of Pipeline 2.
**Out of scope (assumed interfaces / separate specs):** A (session lifecycle & LiveKit transport), D (voice stack: STT/LLM/TTS choice), E (post-interview scorecard & round gating).

---

## 1. Purpose

Pipeline 1 produces a static `InterviewPlan` (persona, timed round arc, question ladders, candidate probes, rubric). Pipeline 2 **executes that plan as a live, voice-driven mock interview** and adapts in real time. This spec covers the "brain": the LangGraph orchestration that drives the conversation, keeps a running score, steers off-script candidate behavior, and dynamically paces the session (end early on weak performance, extend on strong).

Audience reminder: Tier 2/3 Indian engineering students. The experience must never feel humiliating; a struggling candidate should still get a warm, constructive session.

## 2. Guiding decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Graph architecture | **Approach 1** — single LangGraph state machine, dual-track (conversation critical-path + evaluation off critical-path) |
| Live score model | **Hybrid** — rubric competency grade ⊕ behavioral signals |
| Behavioral signals (v1) | **Transcript + timing only** (no audio/prosodic processing) |
| Pacing control | **Hybrid gate + judgment** — deterministic rails/bands open a gate; LLM confirms & phrases the steer |
| Early-end UX | **Constructive soft-landing** — ease to an approachable question, warm wrap; verdict revealed only later in scorecard |
| Extension material | **Prep-time extension reserve** — Pipeline 1 pre-generates bonus hard items into the plan |
| Two models | conversation model (fast) + evaluator/generation model (cheap), separately configured |

## 3. Runtime placement & assumed interfaces

Runs in **`interviewiq-ai-service/app/interview_agent/`** (today an empty stub). A LiveKit Agents worker process hosts each session; LangGraph runs inside that worker.

**Assumed transport/voice interface (owned by A + D; we design against it):**
- **In:** `on_utterance(text: str, timing: UtteranceTiming)` — a completed candidate turn from STT, with timestamps.
- **Out:** `say(text: str)` → TTS; `end_session()` → tear down the room.

`UtteranceTiming = { t_start, t_end, time_to_first_word_s }` — enough for v1 behavioral signals. No raw-audio access assumed.

## 4. Graph topology (Approach 1)

Two tracks woven into one turn cycle. **The conversation track never blocks on the evaluation track** — scoring runs concurrently and its result is consumed on the *next* turn. Pacing is minute-scale, so a one-turn lag is imperceptible.

```
        candidate finishes speaking → on_utterance
                 │
   ┌─────────────┴─── CONVERSATION TRACK (critical path, fast model) ───┐
   │  ingest_utterance                                                  │
   │  → classify_turn   → {ANSWER│CLARIFY│OFF_TOPIC│CHALLENGE│          │
   │                       DISTRESS│IDK_SILENCE│PIVOT_REQUEST}          │
   │  → decide_action   (reads latest pacing_directive + scope check)   │
   │  → generate_turn   (persona/ladder/probe/style prompts)           │
   │  → speak ──► TTS                                                    │
   └─────────────┬──────────────────────────────────────────────────────┘
                 │ fires in parallel (off critical path, cheap model)
   ┌─────────────┴─── EVALUATION TRACK ─────────────────────────────────┐
   │  score_answer  (rubric grade + behavioral signals + neg. events)   │
   │  → update rolling score + coverage in state                        │
   │  → pacing_check (DETERMINISTIC rails + bands)                      │
   │      └─ if a gate opens → pacing_judgment (LLM) → sets directive:   │
   │         CONTINUE │ WIND_DOWN │ EXTEND                               │
   └─────────────────────────────────────────────────────────────────────┘
                 │  (loop until terminal)
            finalize ──► SessionOutcome + evidence → E; flip backend state
```

Latency-critical path = `classify_turn` → `decide_action` → `generate_turn` → `speak`, all on the fast conversation model. `classify_turn` and `decide_action` MAY be merged into a single structured call to save a hop (implementation choice; behavior identical).

**Deterministic rails are code, not prompt instructions.** The floor, base, ceiling, and score bands live in a pure `pacing.py` function. The LLM only ever *confirms and phrases* a decision the rails already permit — it can never end at minute 8 or run past 60.

## 5. Session state

One shared LangGraph state object, single source of truth:

```
InterviewSessionState:
  # static (loaded once)
  session_id: str
  plan: InterviewPlan            # persona, round_arc, ladders[], probes[], reserve[]
  round_type: RoundType          # dsa | system-design | lld | behavioural | hiring-manager

  # conversation
  transcript: list[Turn]         # {speaker, text, t_start, t_end}
  arc_phase: str                 # intro│warm-up│core│curveball│candidate-qs│wrap
  active_item: {kind, ref, rung} # active ladder+follow_up rung OR probe
  asked_slugs: set[str]          # no repeats (incl. reserve + derived topics)

  # evaluation
  score:
    per_answer: list[{slug, competency_0_1, behavioral_0_1, answer_score, weight}]
    negative_events: list[{type, magnitude, reason, at_s}]
    rolling: float               # 0..1 normalized
    coverage: float              # fraction of plan core meaningfully attempted
  behavioral_latest: {ttf_word_s, filler_density, self_corrections, recovered_after_hint}

  # pacing
  clock: {started_at, elapsed_s, min_s, base_s, max_s}
  pacing_directive: enum         # CONTINUE (default) | WIND_DOWN | EXTEND
  extensions_granted: int

  # pivot / derivation
  pivot_count: int               # in-scope pivots honored so far
  derived_topics: list[str]

  # terminal
  outcome: SessionOutcome | None
```

## 6. Scoring engine (C — part 1)

Hybrid, per completed answer. Pure/deterministic given the model's grades, so it's unit-testable.

**Per-answer competency** — grade the answer against the **active ladder's rubric** (the same weighted criteria + strong/weak descriptors Pipeline 1 already generates in `ladder.py`). Evaluator model returns each criterion in `[0,1]`; `competency = Σ(criterion · weight)`, weights sum ~1.0 within that question. Reusing the plan rubric guarantees the live score and the final scorecard share a spine.

**Per-answer behavioral** — from transcript + timing only:
- `time_to_first_word_s` → hesitation (fast/decisive vs long stall)
- `filler_density` (um/uh per token) → inverse
- `self_corrections` / restarts → mild inverse
- answer coherence & length (evaluator model, cheap) → direct
- `recovered_after_hint` → bonus when a hint unblocked them
Normalized and combined into `behavioral ∈ [0,1]`.

**Answer score:** `answer_score = w_c · competency + w_b · behavioral` (default `w_c=0.75, w_b=0.25`, configurable).

**Rolling score:** evidence-weighted mean of `per_answer` (weighted by question weight/difficulty), then **penalized** by negative events:
- in-scope pivot honored → penalty `−p_pivot` (moderate)
- out-of-scope pivot → penalty `−p_out` (large; `p_out > p_pivot`)
- repeated IDK/non-answer → small penalty per occurrence
All penalties recorded in `negative_events` with reason + timestamp for the scorecard.

**Coverage** — fraction of the plan's core ladders meaningfully attempted. Used as a guard so `WIND_DOWN` needs *both* enough time (floor) *and* enough evidence (coverage), never firing just because few questions have been asked.

**Evaluator failure** → skip that answer's scoring, keep last-known rolling, never block the conversation (see §10).

## 7. Pacing controller (C — part 2)

Configurable rails (defaults): `min_s = 18·60`, `base_s = 45·60`, `max_s = 60·60`. Score bands: `low_band = 0.40`, `high_band = 0.70` (all configurable).

`pacing_check` (pure function) emits a gate:

- **LOCKED** — `elapsed < min_s`. No wind-down possible. (Enforces the 15-20 min floor.)
- **MAY_WIND_DOWN** — `elapsed ≥ min_s` AND `rolling < low_band` AND `coverage ≥ min_coverage`. → run `pacing_judgment`.
- **MAY_EXTEND** — `elapsed ≥ base_s − buffer` AND `rolling > high_band` AND `reserve` available AND `elapsed < max_s`. → run `pacing_judgment`.
- **MUST_WRAP** — `elapsed ≥ max_s`. Force directive to end regardless of model. (Enforces the 60 min ceiling.)
- else **CONTINUE**.

`pacing_judgment` (LLM, only when a gate is open) gets the transcript summary + running score + gate + reason, and returns a confirmed directive:
- Confirms `WIND_DOWN` only if the candidate is genuinely unsalvageable (not a slow starter who's recovering). Sets `pacing_directive = WIND_DOWN`.
- Confirms `EXTEND` if performance is genuinely strong. Sets `pacing_directive = EXTEND`, increments `extensions_granted`. Repeated extends allowed until `max_s`.

`decide_action` consumes the directive:
- **WIND_DOWN** → constructive soft-landing: one easier in-scope grounding question (end on a small win) → warm wrap → candidate-questions → close. No signal of underperformance.
- **EXTEND** → pull the next unused `reserve` item (a hard bonus ladder/probe), ask it. If reserve exhausted, fall back to the hardest unused `follow_up`.
- **CONTINUE** → normal plan navigation.

## 8. Conversational steering & topic pivots (B)

`classify_turn` tags each candidate turn; `decide_action` routes:

| Class | Action |
|---|---|
| `ANSWER` | grade (eval track); navigate ladder — escalate follow-up, give a hint, or move on |
| `CLARIFY` | answer the clarifying question briefly, then return to the active item |
| `OFF_TOPIC` | acknowledge lightly, redirect to the active item — stay in character |
| `CHALLENGE` (candidate pushes back on the interviewer) | de-escalate, hold the frame, continue |
| `DISTRESS` (nervous, stuck, apologetic) | reassure, offer a hint or an easier entry — no penalty for nerves alone |
| `IDK_SILENCE` | offer a hint; if still nothing, move on (small penalty per repeat) |
| `PIVOT_REQUEST` | run the **scope check** (§8.1) |

### 8.1 Topic-pivot handling

**Scope check** against the round's domain map (`scope.py`):

| Round | In-scope (pivot allowed → **negative**) | Out-of-scope (refuse → **big negative**) |
|---|---|---|
| DSA | any DSA topic + CS fundamentals (OS, DBMS, networks, OOP) | system design, LLD, behavioral |
| System Design | HLD, scalability, caching, DB/sharding, consistency, messaging, API design, estimation | DSA puzzles, behavioral |
| LLD | OOD, class modeling, design patterns, SOLID, concurrency-in-design | DSA, distributed/HLD, behavioral |
| Behavioural | situational/STAR, teamwork, conflict, ownership, failure/learning | any technical coding/design |
| Hiring Manager | motivation, role/company fit, project deep-dives, high-level tech judgment, career goals | deep DSA/LLD coding |

- **Out-of-scope** → `refuse_out_of_scope`: state plainly "this is a DSA round; I can only go into DSA / CS-fundamentals here," steer back to the active item. Record `negative_event(out_of_scope, large)`.
- **In-scope** → `derive_topic_ladder` (§8.2). Record `negative_event(pivot, moderate)`.
  - If the candidate **names** an in-scope topic, use it. If they just say "something else," the agent **picks** an in-scope topic itself, grounded in JD/brief/profile.
  - **Repeated pivots escalate:** after `pivot_count ≥ 2`, the agent holds ground ("we've moved around a bit — let's stay with this one") rather than honoring further pivots; the refusal itself is a negative.

### 8.2 Live question derivation (with wait/nudge UX)

When honoring an in-scope pivot, generation may take 10-20s. The **conversation track emits stall/nudge lines while a background task generates** — the same decoupling as the eval track:

1. `decide_action` → `pivot_generate`: immediately speak an acknowledgment + ask the candidate to hold ("sure — give me a moment to pull something together on X…").
2. Fire `derive_topic_ladder` as a background task (generation model): produce a **small mini-ladder** (1-2 questions) for the requested in-scope topic, grounded in round + brief + JD, **with a lightweight rubric** so answers can still be scored.
3. If generation exceeds `nudge_after_s` (~8s), speak a nudge filler ("bear with me a sec…"). At most 1-2 nudges.
4. On completion, set the derived ladder as `active_item`, ask its questions (cap **1-2**), then return to plan navigation.
5. On generation failure/timeout → apologize, fall back to an existing in-scope plan question (or a generic in-scope question); the pivot negative still stands.

## 9. Contracts & boundaries

**Output to E (post-interview) — what `finalize` emits:**
```
SessionOutcome:
  session_id
  ended_reason: NATURAL_COMPLETE | EARLY_WEAK | TIME_CEILING | ABORTED_TECHNICAL
  live_score_final: float          # provisional / for-pacing
  per_answer_evidence: [...]        # competency + behavioral per question
  negative_events: [...]
  transcript_ref
  arc_completed: bool
  extensions_granted: int
  derived_topics: [...]
  duration_s
```
`live_score_final` is **provisional** — E recomputes the authoritative verdict from full evidence (E's own spec decides its authority and round-gating). We only define what we emit.

**Backend session states (extends the existing enum):**
`PREP_READY → LIVE_IN_PROGRESS → COMPLETED (→ SCORED by E)`, plus `ABORTED_TECHNICAL`. A session-start hook (owned by A) launches the LiveKit worker and loads the plan; this spec defines the states + the outcome hand-off, not the launch mechanics.

**Pipeline-1 touchpoint (`InterviewPlan` schema change):** add `reserve: [hard ladder/probe items]` generated during the persona/ladder stage. Requires bumping `PREP_PLAN_VERSION` so existing cached plans regenerate. This is a contained change to the **InterviewPlan** contract — *not* the Profile Builder / ProfileSummary schema. Rubric data stays interviewer-only, never exposed to the candidate or any profile contract.

**Config (new env, following the `PREP_LLM_MODEL` per-pipeline pattern):**
`INTERVIEW_LLM_MODEL`, `INTERVIEW_SCORER_MODEL`, `interview.min-duration-min` (18), `interview.base-duration-min` (45), `interview.max-duration-min` (60), `interview.low-band` (0.40), `interview.high-band` (0.70), `w_c/w_b`, penalty magnitudes, `pivot-cap` (2), `nudge-after-s` (8).

## 10. Error handling & failure modes

- **Conversation model failure/timeout** → retry once (fast); else speak a safe scripted bridging line ("could you walk me through your thinking a bit more?") so the session never dead-airs. Persistent failure → graceful abort → `finalize(ABORTED_TECHNICAL)`, backend flips to failure state, candidate sees an apology + reschedule.
- **Evaluator model failure** → skip that answer's score, keep last-known rolling, `pacing_directive` defaults `CONTINUE`. If the scorer is down persistently, pacing runs on **time rails only** (no early-end without a score — safe: session simply runs to base/ceiling).
- **STT dropout / empty/garbled utterance** → classify `IDK_SILENCE`/unclear → "sorry, I didn't catch that — could you repeat?" with bounded retries.
- **`derive_topic_ladder` failure** → §8.2 step 5 fallback.
- **Session disconnect/crash** → rely on LiveKit reconnect; state is periodically persisted (transcript + score + clock) to a live-session store so a reconnect resumes. If unrecoverable → `finalize` with partial outcome.
- **Rail invariants** are code, so a hallucinating/misbehaving model can never violate the floor, ceiling, or scope refusal.

## 11. Module structure (`app/interview_agent/`)

```
worker.py        LiveKit Agents entrypoint; bridges voice loop ↔ graph
graph.py         LangGraph assembly (nodes + edges)
state.py         InterviewSessionState
scoring.py       pure: rubric aggregation + behavioral signal extraction
pacing.py        pure: rails/bands gate function (deterministic)
scope.py         round → in-scope topic map + scope check
outcome.py       SessionOutcome assembly (finalize)
nodes/           ingest, classify, decide, generate, score, pacing_judgment, derive, finalize
prompts/         live-interview prompt modules (versioned scaffolds; import SPOKEN_STYLE +
                 PLATFORM_CONTEXT from interview_prep/prompts/style.py). Real text = product IP,
                 human-drafted (scaffold only for now).
```

Boundaries: `scoring.py`, `pacing.py`, `scope.py` are pure and independently testable. Nodes are thin adapters over them + LLM calls. `worker.py` is the only file that knows about LiveKit.

## 12. Testing strategy

The graph is fully testable **without live voice** — drive it with scripted `on_utterance` event streams:
- **Candidate personas** as fixtures: strong (→ extend to ceiling), weak (→ early-end after floor), off-topic, pivot-in-scope, pivot-out-of-scope, distressed, silent.
- **Unit tests (pure functions):** `pacing.py` rails/bands (table-driven), `scoring.py` aggregation (deterministic given grades), `scope.py` round×topic matrix, classification→action routing.
- **Deterministic LLM in tests:** stub the evaluator/conversation models with canned outputs (mirror Pipeline 1's `monkeypatch` + `asyncio.run` pattern — no HTTP/TestClient layer). No LLM flakiness in CI.
- **Integration:** full scripted sessions asserting `ended_reason`, `pacing_directive` transitions, negative-event recording, and `SessionOutcome` shape — never audio.
- **Not pinned:** prompt text/version constants (per existing convention) → prompt iteration stays cheap. Bump `*_PROMPT_VERSION` on any change for provenance.
- **No LiveKit/voice in the suite** — the transport/voice interface is mocked.

## 13. Stop-and-ask / flags (per CLAUDE.md)

- **New runtime deps** — LiveKit (Agents SDK) + LangGraph are not in the confirmed tech stack. User has chosen them for Pipeline 2 (recorded); documented here as a deliberate stack addition.
- **Voice stack (D) still open** — Deepgram+GPT-4o-mini+ElevenLabs vs OpenAI Realtime. Out of this spec; the brain designs against the assumed interface (§3).
- **Real prompt text = product IP** — persona/steering/pacing/derivation prompts are scaffolded with version constants; human drafts the real text before production.
- **InterviewPlan schema change** (`reserve`) — contained, flagged; requires `PREP_PLAN_VERSION` bump.
- **No scoring leakage** — the live/final rubric never reaches any Profile Builder / ProfileSummary contract.

## 14. Explicitly out of scope (v1)

- Prosodic/audio behavioral analysis (transcript+timing only).
- The authoritative final scorecard and round-gating logic (E).
- LiveKit room/token/egress mechanics and the STT/LLM/TTS choice (A + D).
- Video, screen-share, anti-cheating/integrity signals.
- Continuous background analysis during silence (event-driven per-answer is sufficient for turn-based voice; Approach 2 deferred).
