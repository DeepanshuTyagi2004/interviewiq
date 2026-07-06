"""The live-interview session driver (spec §4). Owns the mutable SessionState, all transport I/O, the
opening turn, per-turn classification, the (answer-gated) evaluation tail (score + pacing),
topic-derivation orchestration (stall + nudge), silence handling, and finalization. The decision
graph (graph.decide) chooses each action; the driver executes it. All LLM I/O goes through llm_ops
(stubbed in tests)."""
from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.interview_agent import llm_ops
from app.interview_agent.graph import GraphDeps, build_inputs, classify_utterance, decide
from app.interview_agent.outcome import finalize
from app.interview_agent.pacing import evaluate_gate
from app.interview_agent.state import SessionState, bands_from_settings
from app.interview_agent.transport import Transport
from app.interview_agent.types import (
    Action, EndedReason, NegativeEvent, PacingDirective, PacingGate, PerAnswerScore, RoundType,
    SessionOutcome, Turn, TurnClass, UtteranceTiming,
)
from app.interview_agent import scoring
from app.llm.client import LLMClient, LLMError, build_llm_client

logger = logging.getLogger(__name__)

# F10: only rounds with a code/diagram surface have a gradable artifact. Speech-only rounds
# (behavioural / hiring-manager) grade the talk-track alone.
_ARTIFACT_ROUNDS = {RoundType.DSA, RoundType.LLD, RoundType.SYSTEM_DESIGN}

# Task 1: the opening back-and-forth (candidate keeps asking questions before starting) is bounded
# so a chatty candidate can't stall the interview indefinitely.
MAX_OPENING_EXCHANGES = 3

# Task 6: the staged rapport step (light background small talk before the format explanation) is
# bounded to a couple of turns so it warms things up without turning into its own mini-interview.
MAX_RAPPORT_TURNS = 2

_OPENING_REPROMPT = "Sorry, I didn't catch that — go ahead whenever you're ready."


def _transcript_tail(state: SessionState, n: int = 4) -> list[dict]:
    return [{"speaker": t.speaker, "text": t.text} for t in state.transcript[-n:]]


def _plan_grounding(state: SessionState) -> str:
    """F4: grounding for live topic derivation, built from fields that ACTUALLY exist on the stored
    plan doc (company / role / level / specialization / round + the active question's focus). The
    old `_brief_text`/`_jd_text` read brief/JD keys that `InterviewPlan.model_dump` never emits (they
    live on the request, not the plan), so derivation was always ungrounded."""
    plan = state.plan
    parts: list[str] = []
    for key, label in (("company", "company"), ("role", "role"), ("level", "level"),
                       ("specialization", "specialization")):
        val = plan.get(key)
        if val:
            parts.append(f"{label}: {val}")
    parts.append(f"round: {state.round_type.value}")
    lad = state.active_ladder() or {}
    focus = lad.get("basePrompt") or lad.get("base_prompt") or lad.get("questionSlug")
    if focus:
        parts.append(f"current focus: {focus}")
    return "; ".join(parts)


async def _say(transport: Transport, state: SessionState, text: str) -> None:
    await transport.say(text)
    state.transcript.append(Turn(speaker="interviewer", text=text))


async def _gen(llm, settings, *, action: Action, state: SessionState, extra: dict) -> str:
    """Generate a spoken line for `action`. Spec §10: never let a transient LLM failure crash the
    interview — degrade to a safe bridging line and keep the conversation moving."""
    persona = state.plan.get("persona") or {}
    try:
        return await llm_ops.generate_line(
            llm, settings, action=action.value, persona=persona,
            active_item=state.active_ladder() or {}, transcript_tail=_transcript_tail(state), extra=extra)
    except LLMError as exc:
        logger.warning("[iv] generate_line failed (%s) — using fallback line", exc)
        return "Let's keep going — could you tell me a bit more about your thinking here?"


async def _wrap_and_close(conv_llm, settings: Settings, transport: Transport, state: SessionState,
                          default_reason: EndedReason) -> None:
    """Warm wrap → persona closing → tear down. `default_reason` is only applied if no reason was
    already set by the rails (e.g. TIME_CEILING from MUST_WRAP is preserved)."""
    await _say(transport, state, await _gen(conv_llm, settings, action=Action.WRAP, state=state, extra={}))
    await _say(transport, state, state.plan.get("persona", {}).get("closing") or
               await _gen(conv_llm, settings, action=Action.CLOSE, state=state, extra={}))
    state.session_over = True
    if state.ended_reason is None:
        state.ended_reason = default_reason


async def _score_last_answer(scorer, settings: Settings, state: SessionState,
                             text: str, timing: UtteranceTiming, artifact=None) -> None:
    """Grade the candidate's ANSWER against the active ladder's rubric + behavioral signals; update
    rolling + coverage. Grading failure is swallowed (spec §10: never block; keep last-known score).
    Called ONLY for ANSWER turns (F1) — non-answers are never graded."""
    lad = state.active_ladder() or {}
    rubric = lad.get("rubric") or []
    try:
        # Forward the artifact kwarg only when present — keeps compatibility with callers/test
        # doubles (e.g. test_session.py's fake_grade) that stub grade_answer's pre-Task-15 signature.
        grade_kwargs = {"artifact": artifact} if artifact is not None else {}
        competency, coherence = await llm_ops.grade_answer(
            scorer, settings, rubric=rubric,
            question=lad.get("basePrompt") or lad.get("base_prompt") or "", answer=text, **grade_kwargs)
    except LLMError as exc:
        logger.warning("[iv] grade failed (%s) — keeping last score", exc)
        return
    sig = scoring.extract_behavioral(text, timing, hint_was_given=state.hint_just_given)
    # F3: blend answer coherence (spec §6 behavioral input) into the behavioral component. Simple
    # equal-weight mean of the transcript/timing signal and the model's coherence; bounded [0,1].
    beh = max(0.0, min(1.0, (scoring.behavioral_score(sig) + coherence) / 2.0))
    ans = scoring.answer_score(competency, beh, settings.interview_w_competency, settings.interview_w_behavioral)
    slug = lad.get("questionSlug") or lad.get("question_slug")
    state.per_answer.append(PerAnswerScore(slug=slug, competency=competency, behavioral=beh,
                                           answer_score=ans, weight=1.0))
    state.attempted_core += 1
    state.note_core_answer()   # F2: distinct-core coverage (dedupes follow-ups, excludes splices)
    state.hint_just_given = False
    state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)


async def _update_pacing(scorer, settings: Settings, state: SessionState) -> None:
    """Run the deterministic gate; only if a gate opens ask the LLM to confirm the directive."""
    answered, core_total = state.core_coverage()   # F2: distinct core answered / original core count
    cov = scoring.coverage(answered, core_total)
    gate = evaluate_gate(state.elapsed_s, state.rolling, cov, state.reserve_available(), state.bands)
    if gate == PacingGate.MUST_WRAP:
        state.pacing_directive = PacingDirective.WIND_DOWN   # forced wrap uses the wind-down path
        state.ended_reason = EndedReason.TIME_CEILING
        return
    if gate in (PacingGate.LOCKED, PacingGate.CONTINUE):
        state.pacing_directive = PacingDirective.CONTINUE
        return
    try:
        directive = await llm_ops.judge_pacing(
            scorer, settings, gate=gate.value, rolling=state.rolling,
            transcript_summary=f"{state.attempted_core} questions attempted; rolling {state.rolling:.2f}")
    except LLMError:
        directive = PacingDirective.CONTINUE
    state.pacing_directive = directive


async def _derive_flow(conv_llm, scorer, settings: Settings, transport: Transport,
                       state: SessionState, topic: str | None, timing_now: float) -> None:
    """Spec §8.2: acknowledge + stall, generate a mini-ladder in the background (nudging if slow),
    splice it as the new active ladder, and record the pivot negative. Derivation runs on the cheaper
    scorer model (F8) grounded in real plan fields (F4)."""
    state.pivot_count += 1
    state.negative_events.append(NegativeEvent(
        type="pivot", magnitude=settings.interview_pivot_penalty,
        reason=f"in-scope pivot to {topic or 'another topic'}", at_s=timing_now))
    state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)

    await _say(transport, state, await _gen(conv_llm, settings, action=Action.PIVOT_DERIVE, state=state,
                                            extra={"topic": topic, "stall": True}))
    task = asyncio.ensure_future(llm_ops.derive_ladder(
        scorer, settings, round_type=state.round_type, topic=topic or "a related topic",
        grounding=_plan_grounding(state)))
    try:
        derived = await asyncio.wait_for(asyncio.shield(task), timeout=settings.interview_nudge_after_s)
    except asyncio.TimeoutError:
        await _say(transport, state, "bear with me a sec — just pulling something together…")
        try:
            derived = await task
        except LLMError:
            derived = None
    except LLMError:
        derived = None

    if not derived:
        # Fallback (spec §8.2 step 5): stay on the current question; pivot negative already recorded.
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.REDIRECT, state=state, extra={}))
        return
    # Splice the derived ladder in as the next item and move onto it (tagged non-core for coverage).
    state.derived_topics.append(topic or "unspecified")
    state.splice_ladder(derived)
    await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))


async def _apply_action(action: Action, requested_topic: str | None, conv_llm, scorer,
                        settings: Settings, transport: Transport, state: SessionState, now: float) -> None:
    if action == Action.EXTEND_RESERVE:
        item = state.take_reserve()
        if item is not None:
            state.extensions_granted += 1
            state.splice_ladder(item)   # F2: reserve item is non-core, never inflates coverage
        state.pacing_directive = PacingDirective.CONTINUE
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))
        return
    if action == Action.WIND_DOWN:
        if state.ended_reason == EndedReason.TIME_CEILING:
            # Hard ceiling (MUST_WRAP rail): wrap immediately, no extra grounding turn (F7).
            await _wrap_and_close(conv_llm, settings, transport, state, EndedReason.TIME_CEILING)
            return
        # Weak wind-down: constructive soft-landing (spec §7/§8) — ask ONE easier in-scope grounding
        # question now (end on a small win); the actual wrap happens on the NEXT turn once the
        # candidate answers it. `winding_down` is the flag the driver loop checks (F7).
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.WIND_DOWN,
                                                state=state, extra={"grounding": True}))
        state.winding_down = True
        return
    if action == Action.REFUSE_OUT_OF_SCOPE:
        state.negative_events.append(NegativeEvent(
            type="out_of_scope", magnitude=settings.interview_out_of_scope_penalty,
            reason=f"requested out-of-round topic: {requested_topic}", at_s=now))
        state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.REFUSE_OUT_OF_SCOPE,
                                                state=state, extra={"topic": requested_topic}))
        return
    if action == Action.HOLD_GROUND:
        # F11: repeated in-scope pivots past the cap — holding ground is itself a small negative
        # (spec §8.1: "the refusal itself is a negative"), so persistent evasion is reflected.
        state.negative_events.append(NegativeEvent(
            type="pivot_refused", magnitude=settings.interview_pivot_penalty,
            reason="repeated pivots past cap — held ground", at_s=now))
        state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.HOLD_GROUND, state=state, extra={}))
        return
    if action == Action.PIVOT_DERIVE:
        await _derive_flow(conv_llm, scorer, settings, transport, state, requested_topic, now)
        return
    if action == Action.ESCALATE_FOLLOWUP:
        state.next_followup()
        await _say(transport, state, await _gen(conv_llm, settings, action=action, state=state, extra={}))
        return
    if action == Action.GIVE_HINT:
        state.next_hint()
        await _say(transport, state, await _gen(conv_llm, settings, action=action, state=state, extra={}))
        return
    if action == Action.MOVE_ON:
        state.advance_to_next_question()
        state.mark_asked((state.active_ladder() or {}).get("questionSlug"))
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))
        return
    if action == Action.WRAP:
        await _wrap_and_close(conv_llm, settings, transport, state, EndedReason.NATURAL_COMPLETE)
        return
    # ANSWER_CLARIFY / REDIRECT / DEESCALATE / REASSURE — respond, stay on the current item.
    await _say(transport, state, await _gen(conv_llm, settings, action=action, state=state, extra={}))


def _aborted_outcome(state: SessionState | None, plan: dict) -> SessionOutcome:
    """Build the ABORTED_TECHNICAL outcome. Uses the live state when we have one; otherwise (state
    construction itself failed) a minimal outcome so the driver never raises for interview content."""
    if state is not None:
        return finalize(state, EndedReason.ABORTED_TECHNICAL)
    sid = ""
    if isinstance(plan, dict):
        sid = plan.get("sessionId") or plan.get("session_id") or ""
    return SessionOutcome(
        session_id=sid, ended_reason=EndedReason.ABORTED_TECHNICAL, live_score_final=0.0,
        per_answer_evidence=[], negative_events=[], arc_completed=False,
        extensions_granted=0, derived_topics=[], duration_s=0.0)


async def _await_opening_turn(transport: Transport, state: SessionState) -> str | None:
    """Wait for the candidate's next turn during the opening. Appended to `state.transcript` for
    context ONLY — never scored, never a negative event, never touches pacing/the ladder (that carve-
    out starts at ASK_BASE). Silence gets exactly one gentle re-prompt; if the candidate is still
    silent after that, this is NOT a technical abort — the caller proceeds to the next opening step."""
    item = await transport.next_utterance()
    if item is None:
        await _say(transport, state, _OPENING_REPROMPT)
        item = await transport.next_utterance()
    if item is None:
        return None
    text, timing = item
    state.elapsed_s = timing.t_end
    state.transcript.append(Turn(speaker="candidate", text=text, t_start=timing.t_start, t_end=timing.t_end))
    return text


async def _run_opening(conv_llm, scorer, settings: Settings, transport: Transport, state: SessionState) -> None:
    """Task 1: a real multi-turn opening — greet, wait; orient, wait; then a bounded back-and-forth
    that answers the candidate's questions (never rubric/logistics-only) until they're ready or the
    bound is hit. Falls through to ASK_BASE (unchanged main loop) once this returns."""
    await _say(transport, state, state.plan.get("persona", {}).get("opening") or
               await _gen(conv_llm, settings, action=Action.GREET, state=state, extra={}))
    last_text = await _await_opening_turn(transport, state)

    # Task 6: staged rapport — one or two light, warm background questions (where they're from,
    # college, etc.) grounded in the candidate profile when the plan carries one, BEFORE the format
    # explanation. Opening-only carve-out applies here too: these turns are transcript-only context,
    # never scored/paced/negative (no _score_last_answer/_update_pacing calls), same as the rest of
    # the opening. Degrades gracefully to `{}` when no candidate profile is present on the plan.
    profile = state.plan.get("candidateProfile") or state.plan.get("candidate_profile") or {}
    rapport_turns = 0
    while rapport_turns < MAX_RAPPORT_TURNS:
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.RAPPORT, state=state,
                                                extra={"candidate_said": last_text, "candidate_profile": profile}))
        last_text = await _await_opening_turn(transport, state)
        rapport_turns += 1
        if last_text is None:
            break

    await _say(transport, state, await _gen(conv_llm, settings, action=Action.ORIENT, state=state,
                                            extra={"candidate_said": last_text}))
    last_text = await _await_opening_turn(transport, state)

    while last_text is not None and state.opening_exchanges < MAX_OPENING_EXCHANGES:
        intent = await llm_ops.classify_opening_turn(scorer, settings, last_text=last_text)
        if intent != "question":
            break
        state.opening_exchanges += 1
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ANSWER_OPENING,
                                                state=state, extra={"candidate_said": last_text}))
        last_text = await _await_opening_turn(transport, state)


async def run_session(transport: Transport, plan: dict, settings: Settings):
    """Drive one live interview to completion; return the SessionOutcome. Never raises for interview
    content — technical failures (including malformed plans) resolve to EndedReason.ABORTED_TECHNICAL
    and the transport is ALWAYS torn down (spec §10)."""
    state: SessionState | None = None
    conv_llm = None
    scorer = None

    try:
        state = SessionState.from_plan(plan, bands_from_settings(settings))
        conv_llm = build_llm_client(settings, model=settings.interview_llm_model or None)
        scorer = build_llm_client(settings, model=settings.interview_scorer_model or None)
        deps = GraphDeps(llm=conv_llm, settings=settings, scorer=scorer)

        # Opening: greet -> rapport (Task 6) -> orient -> bounded Q&A, each step awaiting the
        # candidate (Task 1) — never a monologue. Opening turns are transcript-only context;
        # scoring/pacing start at ASK_BASE.
        await _run_opening(conv_llm, scorer, settings, transport, state)
        state.mark_asked((state.active_ladder() or {}).get("questionSlug"))
        # Ask the first question.
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))

        silence_used = 0
        while not state.session_over:
            item = await transport.next_utterance()
            if item is None:
                silence_used += 1
                if silence_used > settings.interview_silence_retries:
                    state.ended_reason = EndedReason.ABORTED_TECHNICAL
                    break
                await _say(transport, state, "sorry — I didn't catch that, could you say it again?")
                continue
            silence_used = 0
            text, timing = item
            state.elapsed_s = timing.t_end
            state.transcript.append(Turn(speaker="candidate", text=text, t_start=timing.t_start, t_end=timing.t_end))

            # F7: if a soft-landing was started last turn, the candidate has now answered the easier
            # grounding question — wrap warmly (EARLY_WEAK) without re-scoring/re-deciding.
            if state.winding_down:
                await _wrap_and_close(conv_llm, settings, transport, state, EndedReason.EARLY_WEAK)
                break

            # Classify FIRST so scoring is gated on the turn class (F1): a non-answer (CLARIFY /
            # OFF_TOPIC / CHALLENGE / DISTRESS / IDK_SILENCE / PIVOT_REQUEST) is NEVER graded.
            turn_class, requested_topic, topic_scope = await classify_utterance(
                state, Turn("candidate", text), deps)

            if turn_class == TurnClass.ANSWER:
                # F10: only pull/grade an artifact for rounds with a code/diagram surface. NOTE:
                # binding the artifact to the CURRENT question (not stale editor content) is a
                # transport-contract requirement owned by sub-project A — flagged, not solved here.
                artifact = (await transport.current_artifact()
                            if state.round_type in _ARTIFACT_ROUNDS else None)
                await _score_last_answer(scorer, settings, state, text, timing, artifact)
            elif turn_class == TurnClass.IDK_SILENCE:
                # F6: repeated IDK/non-answer → small penalty per occurrence (spec §6). No grade.
                state.negative_events.append(NegativeEvent(
                    type="idk", magnitude=settings.interview_idk_penalty,
                    reason="no substantive answer", at_s=timing.t_end))
                state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)

            await _update_pacing(scorer, settings, state)

            inputs = build_inputs(state, turn_class, requested_topic, topic_scope, settings)
            action = decide(inputs)
            await _apply_action(action, requested_topic, conv_llm, scorer, settings, transport, state, timing.t_end)

        if state.ended_reason is None:
            state.ended_reason = EndedReason.NATURAL_COMPLETE
        return finalize(state, state.ended_reason)
    except LLMError as exc:
        logger.warning("[iv] uncaught LLMError in session driver (%s) — aborting technical", exc)
        return _aborted_outcome(state, plan)
    except Exception:
        # F5: any non-LLMError (a bug, a malformed plan in from_plan, etc.) must NOT escape and skip
        # teardown. Log with traceback at ERROR and resolve to ABORTED_TECHNICAL.
        logger.error("[iv] unexpected error in session driver — aborting technical", exc_info=True)
        return _aborted_outcome(state, plan)
    finally:
        for c in (conv_llm, scorer):
            if isinstance(c, LLMClient):
                await c.aclose()
        await transport.end_session()
