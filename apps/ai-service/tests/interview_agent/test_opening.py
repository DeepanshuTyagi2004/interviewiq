"""Task 1/6: the opening is a real multi-turn exchange (greet -> rapport (x2) -> orient -> bounded
Q&A -> first question), never a monologue. These tests drive run_session end-to-end with
ScriptedTransport and stubbed llm_ops, asserting the spoken sequence WAITS for the candidate between
each opening step and that opening turns (including rapport) never touch scoring/pacing/the ladder
(F1-style carve-out, but for the opening)."""
import asyncio

import app.interview_agent.session as sess
import app.interview_agent.llm_ops as ops
from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.types import Action, PacingDirective, TurnClass, UtteranceTiming
from app.config import get_settings


PLAN = {
    "sessionId": "s1", "candidateId": "c1", "roundType": "dsa",
    "persona": {"name": "Ada", "closing": "bye"},   # no scripted "opening" — exercises GREET generation
    "questionLadders": [
        {"questionSlug": "q1", "basePrompt": "b1", "followUps": [], "hints": [],
         "rubric": [{"criterion": "c", "weight": 1.0}]},
        {"questionSlug": "q2", "basePrompt": "b2", "followUps": [], "hints": [], "rubric": []},
    ],
    "reserve": [],
}


def _install_stubs(monkeypatch, *, opening_intents=None, classify=TurnClass.ANSWER, competency=0.8):
    """`opening_intents`: successive return values for classify_opening_turn (the last value repeats
    once the list is exhausted)."""
    intents = list(opening_intents or ["ready"])
    calls = {"n": 0}

    async def fake_classify_opening(llm, settings, *, last_text):
        i = min(calls["n"], len(intents) - 1)
        calls["n"] += 1
        return intents[i]

    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return classify, None

    async def fake_grade(llm, settings, *, rubric, question, answer, artifact=None):
        return competency, 0.7

    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        return f"[{action}]"

    async def fake_judge(llm, settings, *, gate, rolling, transcript_summary):
        return PacingDirective.CONTINUE

    async def fake_derive(llm, settings, *, round_type, topic, grounding):
        return {"questionSlug": "derived", "basePrompt": "derived q", "rubric": []}

    monkeypatch.setattr(ops, "classify_opening_turn", fake_classify_opening)
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    monkeypatch.setattr(ops, "grade_answer", fake_grade)
    monkeypatch.setattr(ops, "generate_line", fake_generate)
    monkeypatch.setattr(ops, "judge_pacing", fake_judge)
    monkeypatch.setattr(ops, "derive_ladder", fake_derive)
    monkeypatch.setattr(sess, "build_llm_client", lambda settings, model=None: None)


def _turn(t=0.0):
    return ("okay", UtteranceTiming(t, t + 1.0, 0.5))


def test_opening_waits_and_reacts_before_first_question(monkeypatch):
    """GREET, wait; RAPPORT x2, wait each; ORIENT, wait; a 'question' turn -> ANSWER_OPENING, wait;
    THEN ask the first question. Proves the opening awaits + reacts at every step (including the
    Task-6 rapport stage) instead of firing greet+Q1 back-to-back."""
    _install_stubs(monkeypatch, opening_intents=["question", "ready"])
    script = [_turn(0), _turn(10), _turn(20), _turn(30), _turn(40)]
    t = ScriptedTransport(script)
    asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert t.said[:6] == ["[greet]", "[rapport]", "[rapport]", "[orient]", "[answer_opening]", "[ask_base]"]


def test_opening_ready_skips_qna_loop(monkeypatch):
    """A candidate who signals readiness right after ORIENT skips the Q&A loop entirely (the rapport
    stage still runs unconditionally — it's not gated on the 'ready'/'question' classifier)."""
    _install_stubs(monkeypatch, opening_intents=["ready"])
    script = [_turn(0), _turn(10), _turn(20), _turn(30)]
    t = ScriptedTransport(script)
    asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert t.said[:5] == ["[greet]", "[rapport]", "[rapport]", "[orient]", "[ask_base]"]


def test_rapport_emitted_max_rapport_turns_times_for_responsive_candidate(monkeypatch):
    """Task 6: a responsive candidate always gets exactly MAX_RAPPORT_TURNS rapport turns, bounded
    just like the rest of the opening — this is unconditional (not gated on candidate intent)."""
    _install_stubs(monkeypatch, opening_intents=["ready"])
    script = [_turn(0), _turn(10), _turn(20), _turn(30)]
    t = ScriptedTransport(script)
    asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert t.said.count("[rapport]") == sess.MAX_RAPPORT_TURNS


def test_rapport_grounds_in_candidate_profile_when_present(monkeypatch):
    """Task 6: when the plan carries a candidateProfile, it's forwarded into the RAPPORT `_gen`
    call's `extra` so the generated line can personalize; absent a profile it degrades to `{}`
    (never crashes, never omits the extra key)."""
    captured_extras = []

    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        if action == Action.RAPPORT.value:
            captured_extras.append(extra)
        return f"[{action}]"

    _install_stubs(monkeypatch, opening_intents=["ready"])
    monkeypatch.setattr(ops, "generate_line", fake_generate)
    plan_with_profile = dict(PLAN, candidateProfile={"college": "COEP", "city": "Pune"})
    script = [_turn(0), _turn(10), _turn(20), _turn(30)]
    t = ScriptedTransport(script)
    asyncio.run(sess.run_session(t, plan_with_profile, get_settings()))
    assert len(captured_extras) == sess.MAX_RAPPORT_TURNS
    assert all(e["candidate_profile"] == {"college": "COEP", "city": "Pune"} for e in captured_extras)


def test_opening_turns_are_never_scored_or_penalized(monkeypatch):
    _install_stubs(monkeypatch, opening_intents=["question", "question", "ready"])
    # GREET + 2x RAPPORT + ORIENT consume 4 turns unconditionally; the Q&A loop then awaits a 5th
    # turn for its first classify ("question"), and the script (only 4 turns) runs dry there — one
    # gentle re-prompt, still nothing, so the opening falls through with no 5th turn ever answered.
    # Either way, none of these candidate turns pass through the scored main loop.
    script = [_turn(0), _turn(10), _turn(20), _turn(30)]
    t = ScriptedTransport(script)
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.per_answer_evidence == []
    assert out.negative_events == []


def test_opening_is_bounded_by_max_exchanges(monkeypatch):
    """A candidate who keeps asking questions forever does not stall the opening forever."""
    _install_stubs(monkeypatch, opening_intents=["question"])   # always "question"
    script = [_turn(i * 10) for i in range(8)]
    t = ScriptedTransport(script)
    asyncio.run(sess.run_session(t, PLAN, get_settings()))
    said_before_ask_base = t.said[:t.said.index("[ask_base]")]
    assert said_before_ask_base.count("[answer_opening]") == sess.MAX_OPENING_EXCHANGES


def test_opening_silence_gets_one_reprompt_then_proceeds(monkeypatch):
    """Silence during the opening is NOT a technical abort — one gentle re-prompt, then the driver
    proceeds to the next opening step (and eventually asks the first question)."""
    _install_stubs(monkeypatch)
    t = ScriptedTransport([])   # candidate never says anything
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert "[ask_base]" in t.said
    assert out.per_answer_evidence == []
