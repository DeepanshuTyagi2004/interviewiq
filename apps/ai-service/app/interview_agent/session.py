"""The live-interview session driver (spec §4). Owns the mutable SessionState, all transport I/O, the
opening turn, the post-turn evaluation tail (score + pacing), topic-derivation orchestration (stall +
nudge), silence handling, and finalization. The decision graph (graph.run_decision) chooses each
action; the driver executes it. All LLM I/O goes through llm_ops (stubbed in tests)."""
from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.interview_agent import llm_ops
from app.interview_agent.graph import GraphDeps, run_decision
from app.interview_agent.outcome import finalize
from app.interview_agent.pacing import evaluate_gate
from app.interview_agent.state import SessionState, bands_from_settings
from app.interview_agent.transport import Transport
from app.interview_agent.types import (
    Action, EndedReason, NegativeEvent, PacingDirective, PacingGate, PerAnswerScore, Turn, UtteranceTiming,
)
from app.interview_agent import scoring
from app.llm.client import LLMClient, LLMError, build_llm_client

logger = logging.getLogger(__name__)


def _transcript_tail(state: SessionState, n: int = 4) -> list[dict]:
    return [{"speaker": t.speaker, "text": t.text} for t in state.transcript[-n:]]


def _brief_text(plan: dict) -> str:
    return str(plan.get("brief") or plan.get("briefSummary") or "")


def _jd_text(plan: dict) -> str:
    jd = plan.get("jobDescription") or plan.get("job_description") or {}
    if isinstance(jd, dict):
        return str(jd.get("description") or "")
    return str(jd or "")


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


async def _score_last_answer(scorer, settings: Settings, state: SessionState,
                             text: str, timing: UtteranceTiming) -> None:
    """Grade the candidate's answer against the active ladder's rubric + behavioral signals; update
    rolling. Grading failure is swallowed (spec §10: never block; keep last-known score)."""
    lad = state.active_ladder() or {}
    rubric = lad.get("rubric") or []
    try:
        competency, _coh = await llm_ops.grade_answer(
            scorer, settings, rubric=rubric,
            question=lad.get("basePrompt") or lad.get("base_prompt") or "", answer=text)
    except LLMError as exc:
        logger.warning("[iv] grade failed (%s) — keeping last score", exc)
        return
    sig = scoring.extract_behavioral(text, timing, hint_was_given=state.hint_just_given)
    beh = scoring.behavioral_score(sig)
    ans = scoring.answer_score(competency, beh, settings.interview_w_competency, settings.interview_w_behavioral)
    slug = lad.get("questionSlug") or lad.get("question_slug")
    state.per_answer.append(PerAnswerScore(slug=slug, competency=competency, behavioral=beh,
                                           answer_score=ans, weight=1.0))
    state.attempted_core += 1
    state.hint_just_given = False
    state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)


async def _update_pacing(scorer, settings: Settings, state: SessionState) -> None:
    """Run the deterministic gate; only if a gate opens ask the LLM to confirm the directive."""
    total_core = len(state.ladders)
    cov = scoring.coverage(state.attempted_core, total_core)
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
    splice it as the new active ladder, and record the pivot negative."""
    state.pivot_count += 1
    state.negative_events.append(NegativeEvent(
        type="pivot", magnitude=settings.interview_pivot_penalty,
        reason=f"in-scope pivot to {topic or 'another topic'}", at_s=timing_now))
    state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)

    await _say(transport, state, await _gen(conv_llm, settings, action=Action.PIVOT_DERIVE, state=state,
                                            extra={"topic": topic, "stall": True}))
    task = asyncio.ensure_future(llm_ops.derive_ladder(
        conv_llm, settings, round_type=state.round_type, topic=topic or "a related topic",
        brief=_brief_text(state.plan), jd=_jd_text(state.plan)))
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
    # Splice the derived ladder in as the next core item and move onto it.
    state.derived_topics.append(topic or "unspecified")
    state.ladders.insert(state.ladder_idx + 1, derived)
    state.advance_to_next_question()
    await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))


async def _apply_action(action: Action, requested_topic: str | None, conv_llm, scorer,
                        settings: Settings, transport: Transport, state: SessionState, now: float) -> None:
    if action == Action.EXTEND_RESERVE:
        item = state.take_reserve()
        if item is not None:
            state.extensions_granted += 1
            state.ladders.insert(state.ladder_idx + 1, item)
            state.advance_to_next_question()
        state.pacing_directive = PacingDirective.CONTINUE
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))
        return
    if action == Action.WIND_DOWN:
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.WIND_DOWN, state=state, extra={}))
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.WRAP, state=state, extra={}))
        await _say(transport, state, state.plan.get("persona", {}).get("closing") or
                   await _gen(conv_llm, settings, action=Action.CLOSE, state=state, extra={}))
        state.session_over = True
        if state.ended_reason is None:
            state.ended_reason = EndedReason.EARLY_WEAK
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
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.WRAP, state=state, extra={}))
        await _say(transport, state, state.plan.get("persona", {}).get("closing") or
                   await _gen(conv_llm, settings, action=Action.CLOSE, state=state, extra={}))
        state.session_over = True
        if state.ended_reason is None:
            state.ended_reason = EndedReason.NATURAL_COMPLETE
        return
    # ANSWER_CLARIFY / REDIRECT / DEESCALATE / REASSURE — respond, stay on the current item.
    await _say(transport, state, await _gen(conv_llm, settings, action=action, state=state, extra={}))


async def run_session(transport: Transport, plan: dict, settings: Settings):
    """Drive one live interview to completion; return the SessionOutcome. Never raises for interview
    content — technical failures resolve to EndedReason.ABORTED_TECHNICAL (spec §10)."""
    state = SessionState.from_plan(plan, bands_from_settings(settings))
    conv_llm = None
    scorer = None

    try:
        conv_llm = build_llm_client(settings, model=settings.interview_llm_model or None)
        scorer = build_llm_client(settings, model=settings.interview_scorer_model or None)
        deps = GraphDeps(llm=conv_llm, settings=settings)

        # Opening.
        await _say(transport, state, state.plan.get("persona", {}).get("opening") or
                   await _gen(conv_llm, settings, action=Action.OPEN, state=state, extra={}))
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

            # Eval tail (spec §4): score the answer just given, then refresh the pacing directive.
            await _score_last_answer(scorer, settings, state, text, timing)
            await _update_pacing(scorer, settings, state)

            decision = await run_decision(state, Turn("candidate", text), deps)
            await _apply_action(Action(decision["action"]), decision.get("requested_topic"),
                                conv_llm, scorer, settings, transport, state, timing.t_end)

        if state.ended_reason is None:
            state.ended_reason = EndedReason.NATURAL_COMPLETE
        return finalize(state, state.ended_reason)
    except LLMError as exc:
        logger.warning("[iv] uncaught LLMError in session driver (%s) — aborting technical", exc)
        return finalize(state, EndedReason.ABORTED_TECHNICAL)
    finally:
        for c in (conv_llm, scorer):
            if isinstance(c, LLMClient):
                await c.aclose()
        await transport.end_session()
