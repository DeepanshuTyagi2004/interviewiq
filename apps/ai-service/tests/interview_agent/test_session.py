import asyncio

import app.interview_agent.session as sess
import app.interview_agent.llm_ops as ops
from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.types import EndedReason, PacingDirective, TurnClass, UtteranceTiming
from app.config import get_settings
from app.llm.client import LLMError


PLAN = {
    "sessionId": "s1", "candidateId": "c1", "roundType": "dsa",
    "persona": {"name": "Ada", "opening": "hi", "closing": "bye"},
    "questionLadders": [
        {"questionSlug": "q1", "basePrompt": "b1", "followUps": ["f1"], "hints": ["h1"],
         "rubric": [{"criterion": "c", "weight": 1.0}]},
        {"questionSlug": "q2", "basePrompt": "b2", "followUps": [], "hints": [], "rubric": []},
    ],
    "reserve": [{"questionSlug": "r1", "basePrompt": "hard bonus", "rubric": []}],
}


# A longer plan so a weak candidate stays in the interview past the 18-min floor, making the
# early-end (wind-down) path reachable. The 2-ladder PLAN above drains to WRAP before the floor.
WEAK_PLAN = {
    "sessionId": "s1", "candidateId": "c1", "roundType": "dsa",
    "persona": {"name": "Ada", "opening": "hi", "closing": "bye"},
    "questionLadders": [
        {"questionSlug": f"wq{i}", "basePrompt": f"wb{i}", "followUps": ["fa", "fb"],
         "hints": ["h"], "rubric": [{"criterion": "c", "weight": 1.0}]}
        for i in range(4)
    ],
    "reserve": [],
}


def _install_stubs(monkeypatch, *, classify=TurnClass.ANSWER, competency=0.8, directive=None):
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return classify, None
    async def fake_grade(llm, settings, *, rubric, question, answer):
        return competency, 0.7
    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        return f"[{action}]"
    async def fake_judge(llm, settings, *, gate, rolling, transcript_summary):
        return directive or PacingDirective.CONTINUE
    async def fake_derive(llm, settings, *, round_type, topic, brief, jd):
        return {"questionSlug": "derived", "basePrompt": "derived q", "rubric": []}
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    monkeypatch.setattr(ops, "grade_answer", fake_grade)
    monkeypatch.setattr(ops, "generate_line", fake_generate)
    monkeypatch.setattr(ops, "judge_pacing", fake_judge)
    monkeypatch.setattr(ops, "derive_ladder", fake_derive)
    # avoid building a real network client
    monkeypatch.setattr(sess, "build_llm_client", lambda settings, model=None: None)


def _script(n, gap=180.0, start=0.0):
    """n candidate answers, each spaced `gap` seconds apart (drives elapsed_s)."""
    out = []
    t = start
    for _ in range(n):
        out.append(("some answer here that is reasonably long and coherent", UtteranceTiming(t, t + 5, 1.0)))
        t += gap
    return out


def test_natural_completion_strong_candidate(monkeypatch):
    _install_stubs(monkeypatch, competency=0.8)
    t = ScriptedTransport(_script(6, gap=120.0))
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert isinstance(out.ended_reason, EndedReason)
    assert t.ended is True
    assert t.said[0] == "hi"                    # persona opening spoken first (falls back to [open] only if absent)
    assert out.live_score_final > 0.5


def test_weak_candidate_ends_early_after_floor(monkeypatch):
    # weak scores + judge confirms wind-down once the floor passes
    _install_stubs(monkeypatch, competency=0.2, directive=PacingDirective.WIND_DOWN)
    # space answers so elapsed crosses the 18-min floor within the script
    t = ScriptedTransport(_script(8, gap=180.0))
    out = asyncio.run(sess.run_session(t, WEAK_PLAN, get_settings()))
    assert out.ended_reason == EndedReason.EARLY_WEAK
    assert any(a.startswith("[wind_down]") for a in t.said)


def test_out_of_scope_pivot_is_refused_and_penalized(monkeypatch):
    _install_stubs(monkeypatch, classify=TurnClass.PIVOT_REQUEST)
    # classify returns PIVOT with topic None; make the utterance clearly cross-round
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.PIVOT_REQUEST, "system design"
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    t = ScriptedTransport([("can we do system design instead", UtteranceTiming(0, 3, 1.0))])
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert any(a.startswith("[refuse_out_of_scope]") for a in t.said)
    assert any(e.type == "out_of_scope" for e in out.negative_events)


def test_silence_aborts_after_retries(monkeypatch):
    _install_stubs(monkeypatch)
    t = ScriptedTransport([])   # no utterances at all → immediate silence
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.ended_reason == EndedReason.ABORTED_TECHNICAL
    assert t.ended is True


def test_generate_line_failure_degrades_gracefully(monkeypatch):
    # generate_line is the most-called LLM op (opening, every ask/hint/redirect/wrap line); a
    # transient failure there must never raise out of run_session — it should degrade to a
    # fallback line and the session must still resolve to a SessionOutcome (spec §10).
    _install_stubs(monkeypatch)

    async def failing_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        raise LLMError("boom")
    monkeypatch.setattr(ops, "generate_line", failing_generate)

    t = ScriptedTransport(_script(6, gap=120.0))
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert t.ended is True
    assert isinstance(out.ended_reason, EndedReason)
