# Conversational Interviewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the interview brain conversational — multi-turn interactive opening, acknowledge-and-transition voice, stay-until-satisfied back-and-forth (pacing-capped), persona-matched TTS voice — WITHOUT changing the deterministic scoring/pacing/scope. `interviewiq-ai-service` only. Spec: `docs/superpowers/specs/2026-07-06-conversational-interviewer-design.md`.

**Architecture:** The LangGraph decision layer (`graph.decide`, scoring, pacing rails, scope guard) stays the guardrail; the plan is a guide. Changes are additive: new opening Actions + a multi-turn opening sub-phase in the driver, an enriched converse prompt (acknowledge + transition), a decide tuning toward continued engagement, a `gender` persona field + Aura voice selection.

## Global Constraints

- **Preserve every deterministic guarantee unchanged:** hybrid scoring (only `TurnClass.ANSWER` graded), pacing rails/gates (`PacingGate` LOCKED/CONTINUE/MAY_WIND_DOWN/MAY_EXTEND/MUST_WRAP), scope guard (`TopicScope` + refuse cross-round), negative events, `finalize`/`SessionOutcome`, the LiveKit transport + data-channel contract. Do not change scoring.py, pacing.py, scope.py, outcome.py logic.
- **Existing enums (types.py) — do not remove/reorder; only append.** `TurnClass`: ANSWER, CLARIFY, OFF_TOPIC, CHALLENGE, DISTRESS, IDK_SILENCE, PIVOT_REQUEST. `Action`: OPEN, ASK_BASE, ESCALATE_FOLLOWUP, GIVE_HINT, MOVE_ON, ANSWER_CLARIFY, REDIRECT, DEESCALATE, REASSURE, PIVOT_DERIVE, REFUSE_OUT_OF_SCOPE, HOLD_GROUND, WIND_DOWN, EXTEND_RESERVE, WRAP, CLOSE. `PacingGate`, `PacingDirective`, `TopicScope` as-is.
- **Test conventions:** sync `def test_*` + `asyncio.run(...)` + `monkeypatch.setattr` on `app.interview_agent.llm_ops` ops and `app.interview_agent.session.build_llm_client` (→ `lambda settings, model=None: None`); `ScriptedTransport` drives the driver. Run `.venv/bin/python -m pytest tests/interview_agent -q` (96 tests today; keep green). NO `pytest.mark.asyncio`.
- **Opening turns are rapport, not answers:** during the opening phase, candidate turns are NOT scored, accrue NO negative events, and do NOT advance the ladder or pacing.
- **Prompts are product-voice IP:** draft warm/professional defaults; keep them tunable. Bump the relevant prompt version constants.
- **Frozen files to READ (for precise edits), not rewrite wholesale:** `graph.py` (`decide`, `build_inputs`, `classify_utterance`), `session.py` (`run_session`, `_say`, `_gen`, `_apply_action`, `_score_last_answer`, `_update_pacing`, `_wrap_and_close`), `llm_ops.py` (`classify_turn`, `generate_line`, `grade_answer`, `judge_pacing`, `derive_ladder`), `state.py` (`SessionState`, `from_plan`, `active_ladder`, `active_item`, `mark_asked`). Read them before editing; make surgical additions.

## File map
- `app/interview_agent/types.py` — append `Action.GREET`, `Action.ORIENT`, `Action.ANSWER_OPENING`.
- `app/interview_agent/state.py` — add opening-phase fields to `SessionState`.
- `app/interview_agent/session.py` — multi-turn opening sub-phase in `run_session`; opening turns bypass scoring/pacing.
- `app/interview_agent/llm_ops.py` — `classify_opening_turn` (ready vs has-question) + `infer_gender` (name→gender), both one-shot structured calls.
- `app/interview_agent/prompts/converse.py` — enrich `CONVERSE_SYSTEM` (acknowledge+transition + opening actions); bump version.
- `app/interview_agent/prompts/opening.py` (new, optional) — the opening-classifier prompt; or inline in llm_ops.
- `app/interview_agent/graph.py` — `decide`/`build_inputs` turn-policy tuning (engage-until-satisfied, pacing-capped).
- `app/interview_prep/schema.py` — `InterviewerPersona.gender`.
- `app/interview_prep/prompts/persona.py` — ask for gender.
- `PREP_PLAN_VERSION` bump (locate: grep `PREP_PLAN_VERSION`).
- `app/interview_agent/voice.py` — `GENDER_VOICES` + `select_voice(persona, infer=…)`.
- `app/interview_agent/worker.py` — build TTS with `select_voice(plan persona, infer=name→gender)`.

---

### Task 1: Multi-turn interactive opening

**Files:** `types.py`, `state.py`, `session.py`, `llm_ops.py` (+ opening classifier prompt); Test: `tests/interview_agent/test_opening.py`.

**Design:** Replace the current opening in `run_session` (persona opening `_say` + immediate `ASK_BASE` `_say`, ~session.py:265-270) with a conversational sub-phase, each step awaiting the candidate:
1. `GREET` — short warm greeting + "how are you?" → `await transport.next_utterance()`.
2. `ORIENT` — react to their reply + briefly explain the format + invite questions → `await next_utterance()`.
3. Opening back-and-forth loop (bounded, e.g. `settings`-free constant `MAX_OPENING_EXCHANGES = 3`): classify the candidate's turn via a NEW `classify_opening_turn(state, text, deps) -> "ready" | "question"`:
   - `"question"` → `ANSWER_OPENING` (warm, logistics/expectations only, never rubric) → `await next_utterance()` → loop.
   - `"ready"` (or bound reached, or silence) → break.
4. `ASK_BASE` (first question) → fall through to the EXISTING main loop unchanged.

Opening turns: append to `state.transcript` for context, but do NOT call `_score_last_answer`, do NOT append negative events, do NOT `_update_pacing`. Silence in the opening: after 1 gentle re-prompt, proceed to the next opening step (don't abort the interview — opening silence is not `ABORTED_TECHNICAL`).

- `state.py`: add to `SessionState`: `opening_exchanges: int = 0` (and any flag you need). Keep `from_plan` behavior otherwise unchanged.
- `types.py`: append `GREET = "greet"`, `ORIENT = "orient"`, `ANSWER_OPENING = "answer_opening"` to `Action`.
- `llm_ops.py`: add `async def classify_opening_turn(...)` — a one-shot structured call returning `{"intent": "ready"|"question"}` (tiny Pydantic model). Mirror the existing `classify_turn` structure.
- `session.py`: implement the sub-phase using `_say`/`_gen` for GREET/ORIENT/ANSWER_OPENING/ASK_BASE and `await transport.next_utterance()` between; pass the candidate's last turn into `_gen`'s `extra` (or transcript_tail) so ORIENT/ANSWER_OPENING can react.

- [ ] **Step 1: Write failing tests** (`tests/interview_agent/test_opening.py`): using `ScriptedTransport` + stubbed `llm_ops` (stub `classify_opening_turn` to return "question" once then "ready"; stub `generate_line` to echo `f"[{action}]"`; stub `build_llm_client`), drive `run_session` with a short plan and assert the interviewer's spoken sequence starts `[greet]`, `[orient]`, then (for a "question" turn) `[answer_opening]`, then `[ask_base]` — i.e. it WAITS between and reacts. Assert opening candidate turns produced NO `per_answer` scores and NO `negative_events`. Assert the opening is bounded (a candidate that keeps "question"-ing hits `MAX_OPENING_EXCHANGES` then proceeds to `[ask_base]`).
- [ ] **Step 2: Run → FAIL** — `.venv/bin/python -m pytest tests/interview_agent/test_opening.py -q`.
- [ ] **Step 3: Implement** the enum additions, state fields, `classify_opening_turn`, and the `run_session` opening sub-phase per the design. Read the current `run_session`/`_say`/`_gen` first; keep the main loop after `ASK_BASE` unchanged.
- [ ] **Step 4: Run → PASS**; then run the whole slice `.venv/bin/python -m pytest tests/interview_agent -q` and fix any existing opening-flow tests that asserted the old monologue+immediate-Q1 (update them to the new sequence — do NOT weaken scoring/pacing assertions).
- [ ] **Step 5: Commit** `feat(convo): multi-turn interactive opening (greet -> orient -> Q&A -> first question)`.

---

### Task 2: Acknowledge-and-transition converse prompt

**Files:** `app/interview_agent/prompts/converse.py`; Test: `tests/interview_agent/test_prompts.py` (extend).

**Design:** Enrich `CONVERSE_SYSTEM` so every line (a) briefly ACKNOWLEDGES/reacts to the candidate's most recent turn (available in `RECENT TURNS`/`transcript_tail`), then (b) does the ACTION's job, transitioning naturally — treating `CURRENT ITEM` as the topic to steer toward, not a script to read. Add explicit one-line guidance for the new actions: `GREET` (warm hello + how-are-you, NO format dump), `RAPPORT` (one or two light personal/background questions, warm, grounded in the candidate profile when present), `ORIENT` (react + brief format explanation + invite questions), `ANSWER_OPENING` (answer the candidate's pre-interview question warmly; logistics/expectations only; never reveal rubric/scoring). **ALSO refine `ANSWER_CLARIFY`**: answer questions about the PROBLEM (constraints, I/O, examples, edge cases) helpfully + specifically but NEVER reveal the approach, algorithm, complexity target, or solution ('clarify the problem, never hint the path'). Keep: one spoken thing per line, TTS-friendly, never reveal scoring, wind-down = one easy in-scope question, refusal = plainly name the round + steer back. Bump `CONVERSE_PROMPT_VERSION` (e.g. `"v1-conversational"`). `build_turn_prompt` already passes action/persona/active_item/transcript_tail/extra — keep the signature.

- [ ] **Step 1: Write failing tests** — assert `CONVERSE_SYSTEM` contains the acknowledge/transition instruction (e.g. references reacting to the candidate's last turn) and that `build_turn_prompt` renders the new actions; assert `CONVERSE_PROMPT_VERSION` changed. Keep assertions about existing guidance (rubric-secrecy, one-thing, wind-down, refusal).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the enriched prompt + version bump. Read the current `converse.py` first; preserve `SPOKEN_STYLE`/`PLATFORM_CONTEXT` includes and the `{"line": ...}` return contract.
- [ ] **Step 4: Run → PASS** (prompt tests + full slice green).
- [ ] **Step 5: Commit** `feat(convo): acknowledge-and-transition converse prompt + opening-action voice`.

---

### Task 3: Turn policy — stay-until-satisfied (decide tuning)

**Files:** `app/interview_agent/graph.py` (`decide`, `build_inputs`); Test: `tests/interview_agent/test_graph.py` (extend).

**Design:** Read the current `decide` + `build_inputs` first. Tune the follow-up-vs-move-on decision so an ANSWER turn favors continued engagement (`ESCALATE_FOLLOWUP` / `GIVE_HINT`) when the answer is thin/partial AND the pacing gate allows (CONTINUE / MAY_EXTEND), and only `MOVE_ON` when the answer is adequate OR the pacing gate forces progress (MAY_WIND_DOWN / MUST_WRAP / coverage pressure). **Pacing is the ceiling and its precedence MUST be preserved** — MUST_WRAP still → WRAP, LOCKED still holds, wind-down/extend precedence unchanged. This is a tuning of the ANSWER branch's follow-up/move-on threshold + follow-up depth, NOT a change to the pacing/scope/pivot branches. If the current `decide` already balances this via a per-question follow-up counter / adequacy signal, adjust the threshold + document; do not restructure the router.

- [ ] **Step 1: Write failing tests** (extend `test_graph.py`): with a CONTINUE pacing gate + a thin answer (low competency / below adequacy), `decide` returns an engagement action (`ESCALATE_FOLLOWUP` or `GIVE_HINT`), not `MOVE_ON`; with an adequate answer, `MOVE_ON`; with `MUST_WRAP`, `WRAP` regardless of answer quality (pacing precedence preserved); scope/pivot branches unchanged (a `PIVOT_REQUEST` out-of-scope still → `REFUSE_OUT_OF_SCOPE`).
- [ ] **Step 2: Run → FAIL** (where behavior differs).
- [ ] **Step 3: Implement** the tuning in `decide`/`build_inputs`. Keep every pacing/scope/pivot/clarify/distress branch's precedence intact.
- [ ] **Step 4: Run → PASS** (graph tests + full slice green; the pacing precedence tests must still pass unchanged).
- [ ] **Step 5: Commit** `feat(convo): decide tuning — stay-until-satisfied back-and-forth, pacing-capped`.

---

### Task 4: Persona `gender` in prep + PREP_PLAN_VERSION bump

**Files:** `app/interview_prep/schema.py`, `app/interview_prep/prompts/persona.py`, the `PREP_PLAN_VERSION` constant; Test: `tests/interview_prep/` (persona/schema test) + wherever prep prompts are tested.

**Design:**
- `schema.py` `InterviewerPersona`: add `gender: str | None = None` with a normalizing validator → one of `"male"|"female"|"neutral"` (lowercase, map obvious synonyms; unknown/empty → `None`). Follow the existing `_coerce_str` + `field_validator` pattern.
- `prompts/persona.py`: `PERSONA_SYSTEM` (and/or `build_persona_prompt`) asks the model to set `gender` consistent with the invented `name` (male/female/neutral); bump the persona prompt version if one exists.
- Bump `PREP_PLAN_VERSION` (grep for it — likely a constant in `app/interview_prep/` or `app/config.py`) so cached plans regenerate with the field. Confirm the plan-cache gate keys on it (per project memory, the cache invalidates on `PREP_PLAN_VERSION` bump).

- [ ] **Step 1: Write failing tests** — `PersonaAndArc`/`InterviewerPersona` accepts + normalizes `gender` (e.g. `"Male"`→`"male"`, `"f"`/`"woman"`→`"female"`, junk→`None`); the persona prompt text asks for gender; `PREP_PLAN_VERSION` changed.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the schema field + validator, the prompt ask, the version bump. Read the current `persona.py` + schema + version constant first.
- [ ] **Step 4: Run → PASS** (`.venv/bin/python -m pytest tests/interview_prep -q` + full suite green).
- [ ] **Step 5: Commit** `feat(convo): persona gender field + prompt + PREP_PLAN_VERSION bump`.

---

### Task 5: Persona-matched TTS voice (worker/voice)

**Files:** `app/interview_agent/voice.py`, `app/interview_agent/worker.py`, `app/interview_agent/llm_ops.py` (`infer_gender`); Test: `tests/interview_agent/test_voice.py` (extend), `tests/interview_agent/test_worker.py` (extend).

**Design:**
- `voice.py`: add
  ```python
  GENDER_VOICES = {"male": "aura-2-orion-en", "female": "aura-2-asteria-en", "neutral": "aura-2-asteria-en"}
  DEFAULT_VOICE = "aura-2-asteria-en"
  async def select_voice(persona: dict, *, infer=None) -> str:
      g = (persona.get("gender") or "").strip().lower()
      if g not in GENDER_VOICES and infer is not None:
          g = (await infer(persona.get("name") or "")) or ""
      return GENDER_VOICES.get(g, DEFAULT_VOICE)
  ```
  (Verify the exact Aura-2 male voice id against the Deepgram docs / context7 — `orion` is a male Aura-2 voice; pick a real male + female pair.)
- `llm_ops.py`: `async def infer_gender(name: str, llm) -> str | None` — a one-shot structured call classifying a first name as `"male"|"female"|"neutral"` (empty name → `None`); tiny Pydantic model.
- `worker.py` `run_interview`: currently `tts = deepgram.TTS(model="aura-2-asteria-en", ...)`. Change to select the model from the plan's persona: `voice_model = await voice.select_voice(plan.get("persona", {}), infer=lambda n: llm_ops.infer_gender(n, <the conv model>))` then `tts = deepgram.TTS(model=voice_model, api_key=settings.deepgram_api_key)`. (Build the inference model cheaply, or reuse a small client; if wiring the LLM here is heavy, infer via a `deepgram`-independent one-shot using the existing `build_llm_client`.)

- [ ] **Step 1: Write failing tests** — `select_voice`: `{"gender":"male"}`→male voice; `{"gender":"female"}`→female; missing gender + an `infer` stub returning "female"→female; missing gender + no infer→default. `infer_gender` (with a stubbed structured call) returns the classified value. `test_worker.py`: `run_interview` builds `deepgram.TTS` with the persona-selected model (extend the existing worker test's fake deepgram to record the `model` kwarg; assert it reflects the persona gender, e.g. a male-named/`gender:"male"` persona → the male voice).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `GENDER_VOICES`/`select_voice`, `infer_gender`, and the worker wiring. Read the current `voice.py`/`worker.py` first; keep `publish_agent_audio` otherwise unchanged (it already reads `tts.sample_rate`).
- [ ] **Step 4: Run → PASS** (voice + worker tests + full slice green).
- [ ] **Step 5: Commit** `feat(convo): persona-matched Aura voice selection (gender -> voice, name-inference fallback)`.

---

## Self-Review
- **Spec coverage:** multi-turn opening (T1), acknowledge/transition voice (T2), stay-until-satisfied policy (T3), preserved guarantees (constraints + T3 keeps pacing/scope precedence), persona-matched voice (T4 gender + T5 selection). Bounded mid-interview latitude = the enriched converse prompt (T2) over the existing CLARIFY/OFF_TOPIC/CHALLENGE branches (unchanged) + T3 — no separate task needed.
- **Guarantees preserved:** no task edits scoring.py/pacing.py/scope.py/outcome.py; T3 explicitly preserves pacing/scope precedence; opening turns bypass scoring/pacing (T1).
- **Type consistency:** new Actions (GREET/ORIENT/ANSWER_OPENING) used in T1 driver + T2 prompt; `select_voice(persona, infer)` + `infer_gender(name, llm)` consistent across T5; `gender` field (T4) consumed by T5's `select_voice`.
- **Sequencing:** T1→T2 (prompt supports the new actions T1 introduces) → T3 (policy) → T4 (prep field) → T5 (voice consumes the field). Each independently testable + committed.
- **Known adaptation risks:** (1) the exact `decide` structure (T3) — the implementer must read it and tune the threshold without restructuring; if the router doesn't currently track per-question adequacy/follow-up count, add a minimal counter to `SessionState`/`build_inputs`. (2) The Aura male voice id (T5) — verify against Deepgram docs. (3) `PREP_PLAN_VERSION` location (T4) — grep to find it. (4) opening classifier (`classify_opening_turn`) is a new LLM op — stub it in tests like the other ops.

---

### Task 6: Richer staged rapport opening (extends Task 1)

**Files:** `types.py` (`Action.RAPPORT`), `session.py` (opening sub-phase), `prompts/converse.py` (RAPPORT voice — may already be covered by Task 2); Test: `tests/interview_agent/test_opening.py` (extend).

**Design:** Extend the Task-1 opening sub-phase with a rapport step between GREET and ORIENT: GREET (how-are-you) → wait → **RAPPORT** (1–2 light background questions — where they're from, college — grounded in the plan's candidate profile if available, else generic) → wait (bounded to ~2 rapport turns via a `MAX_RAPPORT_TURNS = 2` const) → ORIENT (format + invite questions) → the existing Task-1 Q&A loop → ASK_BASE. Rapport turns: NOT scored, NO negative events, NOT paced (same treatment as the rest of the opening). Read the Task-1 `_run_opening`/`_await_opening_turn` first and insert the rapport step cleanly. The candidate profile is on the plan (`plan.get('candidateProfile')` / persona `grounded_in`) — pass what's available into `_gen`'s `extra` so RAPPORT can personalize; degrade gracefully if absent.

- [ ] Step 1: failing test — the opening sequence now includes `[rapport]` between `[greet]` and `[orient]`; rapport turns are not scored; bounded by `MAX_RAPPORT_TURNS`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement `Action.RAPPORT` + the rapport step in the opening sub-phase (+ RAPPORT converse guidance if not already added in Task 2).
- [ ] Step 4: run → PASS + full slice green (adapt Task-1 opening tests to the new sequence — do not weaken not-scored assertions).
- [ ] Step 5: commit `feat(convo): staged rapport opening (how-are-you -> background -> format)`.

---

### Task 7: Silence & inactivity handling (code != inactivity; graceful escalating end)

**Files:** `types.py` (`EndedReason.ABANDONED`), `transport.py` (activity tracking), `session.py` (escalation), config/consts; Test: `tests/interview_agent/test_livekit_transport.py` + `tests/interview_agent/test_session.py` (extend).

**Design:**
- **Transport activity tracking (`transport.py`):** track `_last_activity` (a monotonic timestamp) updated whenever an `artifact` message arrives in `handle_incoming` (code/diagram edits) — and on `answer` too. Expose `def seconds_since_activity(self) -> float` (or `recently_active(window)`) for the driver. (Use a module clock indirection so tests can control it — e.g. accept an injectable `now` or monkeypatch.) This makes "writing code" count as activity.
- **`types.py`:** add `EndedReason.ABANDONED = "abandoned"`.
- **Driver escalation (`session.py`):** replace the bare `silence_used > interview_silence_retries -> ABORTED_TECHNICAL` in the MAIN loop with: when `next_utterance()` returns `None`, FIRST check `transport.seconds_since_activity()` — if the candidate has recent artifact/code activity (within `INACTIVITY_WINDOW_S`, e.g. 45s), treat it as "still working": do NOT nudge, just continue waiting (optionally a single soft "take your time"). Otherwise escalate: nudge "are you still there?" (up to `MAX_INACTIVITY_NUDGES`, e.g. 3, warmer than the current terse retry); then a final warning "I may need to stop the interview"; then one more `next_utterance()` bounded by a `GRACE_S` (≈30s) window — if still None AND still inactive, end with `EndedReason.ABANDONED` (via `_wrap_and_close` or a clean end path). Any real utterance OR resumed activity resets the escalation counter. Keep `ABORTED_TECHNICAL` for genuine technical/exception failures.
- Constants (module-level or Settings): `INACTIVITY_WINDOW_S≈45`, `MAX_INACTIVITY_NUDGES≈3`, `GRACE_S≈30`.
- The transport's `next_utterance` silence timeout already exists (`SILENCE_TIMEOUT_S`); the escalation is driver-side using activity to decide nudge-vs-wait. Ensure the escalation still terminates (ABANDONED) so a truly-gone candidate can't hang the session.

- [ ] Step 1: failing tests — (transport) `seconds_since_activity` drops after an `artifact` message (code = activity); (driver) silence with NO recent activity → escalating nudges then `ABANDONED` end; silence WITH recent artifact activity → NOT counted as inactivity (no premature nudge/end, keeps waiting); a real answer/resumed activity resets the counter.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement transport activity tracking + `EndedReason.ABANDONED` + driver escalation. Read the current `next_utterance` + the main-loop silence handling first; keep `ABORTED_TECHNICAL` for exceptions.
- [ ] Step 4: run → PASS + full slice green (the outcome-shape/EndedReason tests may need the new enum value; do not weaken).
- [ ] Step 5: commit `feat(convo): silence/inactivity escalation (code!=idle, nudge -> warn -> 30s grace -> abandoned end)`.

