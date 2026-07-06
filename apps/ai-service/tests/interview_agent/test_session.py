import asyncio

import app.interview_agent.session as sess
import app.interview_agent.llm_ops as ops
from app.interview_agent.state import SessionState, bands_from_settings
from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.types import (
    Action, Artifact, ArtifactKind, EndedReason, PacingDirective, TurnClass, UtteranceTiming,
)
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


def _install_stubs(monkeypatch, *, classify=TurnClass.ANSWER, competency=0.8, directive=None,
                   opening_intent="ready"):
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return classify, None
    async def fake_classify_opening(llm, settings, *, last_text):
        return opening_intent
    async def fake_grade(llm, settings, *, rubric, question, answer):
        return competency, 0.7
    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        return f"[{action}]"
    async def fake_judge(llm, settings, *, gate, rolling, transcript_summary):
        return directive or PacingDirective.CONTINUE
    async def fake_derive(llm, settings, *, round_type, topic, grounding):
        return {"questionSlug": "derived", "basePrompt": "derived q", "rubric": []}
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    monkeypatch.setattr(ops, "classify_opening_turn", fake_classify_opening)
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


def _opening_pad():
    """Task 1/6: the opening now awaits the candidate four times — GREET, 2x RAPPORT, ORIENT —
    before the first real question. `_install_stubs`'s classify_opening_turn stub defaults to
    'ready', so the Q&A loop after ORIENT is skipped and these four filler turns are exactly what
    the opening consumes — prepend them so a script's REAL answers still land on the main loop /
    plan questions unchanged."""
    return [("hi, doing well thanks", UtteranceTiming(0.0, 1.0, 0.3)),
            ("i'm from Pune", UtteranceTiming(1.0, 2.0, 0.3)),
            ("studied at COEP", UtteranceTiming(2.0, 3.0, 0.3)),
            ("sounds good, ready when you are", UtteranceTiming(3.0, 4.0, 0.3))]


def test_natural_completion_strong_candidate(monkeypatch):
    _install_stubs(monkeypatch, competency=0.8)
    t = ScriptedTransport(_script(6, gap=120.0))
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.ended_reason == EndedReason.NATURAL_COMPLETE   # drained the plan before the floor
    assert t.ended is True
    assert t.said[0] == "hi"                    # persona opening spoken first (falls back to [open] only if absent)
    assert out.live_score_final > 0.5


def test_weak_candidate_ends_early_after_floor(monkeypatch):
    # weak scores + judge confirms wind-down once the floor passes. F7 soft-landing: an easier
    # grounding question is asked, the candidate answers it, THEN the session wraps as EARLY_WEAK.
    _install_stubs(monkeypatch, competency=0.2, directive=PacingDirective.WIND_DOWN)
    # space answers so elapsed crosses the 18-min floor within the script, with room for the
    # candidate to answer the grounding question before the wrap.
    t = ScriptedTransport(_script(10, gap=180.0))
    out = asyncio.run(sess.run_session(t, WEAK_PLAN, get_settings()))
    assert out.ended_reason == EndedReason.EARLY_WEAK
    grounding = next(i for i, a in enumerate(t.said) if a.startswith("[wind_down]"))  # eased-in question
    wrap = next(i for i, a in enumerate(t.said) if a.startswith("[wrap]"))
    assert grounding < wrap                     # grounding question comes BEFORE the wrap (soft-landing)


def test_out_of_scope_pivot_is_refused_and_penalized(monkeypatch):
    _install_stubs(monkeypatch, classify=TurnClass.PIVOT_REQUEST)
    # classify returns PIVOT with topic None; make the utterance clearly cross-round
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.PIVOT_REQUEST, "system design"
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    t = ScriptedTransport(_opening_pad() + [("can we do system design instead", UtteranceTiming(3, 6, 1.0))])
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


# ----------------------------- F1: scoring gated on classification -----------------------------


def test_non_answer_turn_is_not_scored(monkeypatch):
    """F1: a CLARIFY (non-answer) turn must NOT produce a PerAnswerScore or record any grade."""
    _install_stubs(monkeypatch, classify=TurnClass.CLARIFY, competency=0.9)
    t = ScriptedTransport(_opening_pad() + [("wait, what do you mean by optimal here?", UtteranceTiming(3, 6, 1.0))])
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.per_answer_evidence == []                       # non-answer never graded
    assert all(e.type != "idk" for e in out.negative_events)   # clarify is not an idk penalty


def test_in_scope_pivot_derives_and_records_one_negative(monkeypatch):
    """F1/PIVOT_DERIVE: an in-scope pivot runs the derive flow, is NOT graded, and records exactly
    one 'pivot' negative — never a bogus grade on top of the pivot penalty (no double-hit)."""
    _install_stubs(monkeypatch, competency=0.9)

    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.PIVOT_REQUEST, "dynamic programming"   # in-scope for a DSA round
    monkeypatch.setattr(ops, "classify_turn", fake_classify)

    t = ScriptedTransport(_opening_pad() + [("can we try a dynamic programming question?", UtteranceTiming(3, 6, 1.0))])
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.per_answer_evidence == []                          # not graded
    assert sum(1 for e in out.negative_events if e.type == "pivot") == 1   # counted once
    stall = next(i for i, a in enumerate(t.said) if a.startswith("[pivot_derive]"))  # stall/ack line
    # the derived ladder is asked AFTER the stall (not the opening question, which is asked first)
    assert any(a.startswith("[ask_base]") for a in t.said[stall + 1:])
    assert "dynamic programming" in out.derived_topics


# ----------------------------- F7: WIND_DOWN constructive soft-landing -----------------------------


def test_wind_down_action_soft_lands_before_wrapping(monkeypatch):
    """F7: a weak-performance WIND_DOWN directive asks ONE grounding question and defers the wrap to
    the NEXT turn — it must NOT wrap+close in the same turn."""
    _install_stubs(monkeypatch)
    st = SessionState.from_plan(WEAK_PLAN, bands_from_settings(get_settings()))
    t = ScriptedTransport([])
    asyncio.run(sess._apply_action(Action.WIND_DOWN, None, None, None,
                                   get_settings(), t, st, now=1200.0))
    assert st.winding_down is True
    assert st.session_over is False                              # did NOT wrap this turn
    assert any(a.startswith("[wind_down]") for a in t.said)      # grounding question asked
    assert not any(a.startswith("[wrap]") for a in t.said)       # no wrap yet


def test_wind_down_at_ceiling_wraps_immediately(monkeypatch):
    """F7: MUST_WRAP (ceiling) forces an immediate wrap without the extra grounding turn."""
    _install_stubs(monkeypatch)
    st = SessionState.from_plan(WEAK_PLAN, bands_from_settings(get_settings()))
    st.ended_reason = EndedReason.TIME_CEILING                   # set by the MUST_WRAP rail
    t = ScriptedTransport([])
    asyncio.run(sess._apply_action(Action.WIND_DOWN, None, None, None,
                                   get_settings(), t, st, now=3700.0))
    assert st.session_over is True
    assert st.ended_reason == EndedReason.TIME_CEILING
    assert st.winding_down is False
    assert any(a.startswith("[wrap]") for a in t.said)


# ----------------------------- EXTEND / reserve (strong candidate) -----------------------------


def test_strong_candidate_extends_into_reserve(monkeypatch):
    """A strong candidate past base-lookahead with a plan carrying `reserve` → EXTEND pulls a reserve
    item as the new active ladder."""
    _install_stubs(monkeypatch, competency=0.9, directive=PacingDirective.EXTEND)
    # `_opening_pad()` covers the (now 4-turn, Task 6) opening at negligible elapsed time; the real
    # script then starts already past base_s - lookahead (2700-300=2400s) so the very first real
    # answer lands in the extend-eligible window while still strong.
    t = ScriptedTransport(_opening_pad() + _script(6, gap=1300.0, start=2600.0))
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.extensions_granted >= 1
    assert any(a.startswith("[ask_base]") for a in t.said)   # the pulled reserve item is asked


# ----------------------------- MUST_WRAP / ceiling -----------------------------


def test_ceiling_forces_time_ceiling_wrap(monkeypatch):
    """Elapsed past the hard ceiling (max_s = 60min) → immediate wrap with ended_reason TIME_CEILING,
    regardless of score (the MUST_WRAP rail is absolute)."""
    _install_stubs(monkeypatch, competency=0.9)
    t = ScriptedTransport(_opening_pad() +
                          [("a strong, complete answer to the very first question", UtteranceTiming(3700, 3705, 1.0))])
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.ended_reason == EndedReason.TIME_CEILING
    assert t.ended is True


# ----------------------------- F2: coverage counts distinct core ladders -----------------------------


def test_coverage_counts_distinct_core_not_followups(monkeypatch):
    """F2: answering the base + follow-ups of ONE core ladder counts as ONE distinct core answered,
    not three — so the wind-down coverage guard measures plan progress, not turn count."""
    _install_stubs(monkeypatch, competency=0.8)
    st = SessionState.from_plan(PLAN, bands_from_settings(get_settings()))
    assert st.core_count == 2
    # three ANSWERs on the same ladder (base + 2 follow-ups) → still one distinct core index
    for _ in range(3):
        asyncio.run(sess._score_last_answer(None, get_settings(), st, "a good answer here",
                                            UtteranceTiming(0, 5, 1.0)))
    answered, core_total = st.core_coverage()
    assert (answered, core_total) == (1, 2)
    # splicing a reserve/derived ladder must not change the denominator
    st.splice_ladder({"questionSlug": "r", "basePrompt": "bonus", "rubric": []})
    asyncio.run(sess._score_last_answer(None, get_settings(), st, "answer to the spliced bonus",
                                        UtteranceTiming(0, 5, 1.0)))
    answered2, core_total2 = st.core_coverage()
    assert core_total2 == 2                       # denominator unchanged by splicing
    assert answered2 == 1                         # spliced item is NOT counted as core coverage


# ----------------------------- F10: artifact only for code/diagram rounds -----------------------------


def _artifact_stubs(monkeypatch, captured):
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.ANSWER, None
    async def fake_classify_opening(llm, settings, *, last_text):
        return "ready"
    async def fake_grade(llm, settings, *, rubric, question, answer, artifact=None):
        captured.append(artifact)
        return 0.8, 0.7
    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        return f"[{action}]"
    async def fake_judge(llm, settings, *, gate, rolling, transcript_summary):
        return PacingDirective.CONTINUE
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    monkeypatch.setattr(ops, "classify_opening_turn", fake_classify_opening)
    monkeypatch.setattr(ops, "grade_answer", fake_grade)
    monkeypatch.setattr(ops, "generate_line", fake_generate)
    monkeypatch.setattr(ops, "judge_pacing", fake_judge)
    monkeypatch.setattr(sess, "build_llm_client", lambda settings, model=None: None)


def test_artifact_reaches_grading_for_dsa_round(monkeypatch):
    """F10: a DSA (code-surface) round pulls the current artifact and passes it to grade_answer."""
    captured = []
    _artifact_stubs(monkeypatch, captured)
    art = Artifact(kind=ArtifactKind.CODE, content="def f(): return 1", language="python")
    t = ScriptedTransport(_opening_pad() + _script(1, start=3.0), artifact=art)
    asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert art in captured                        # DSA round → artifact graded


def test_artifact_not_passed_for_behavioural_round(monkeypatch):
    """F10: a BEHAVIOURAL round grades speech only — the artifact is never passed to grade_answer."""
    captured = []
    _artifact_stubs(monkeypatch, captured)
    behavioural_plan = dict(PLAN, roundType="behavioural")
    art = Artifact(kind=ArtifactKind.CODE, content="stale editor content", language="python")
    t = ScriptedTransport(_opening_pad() + _script(1, start=3.0), artifact=art)
    asyncio.run(sess.run_session(t, behavioural_plan, get_settings()))
    assert captured and all(a is None for a in captured)   # graded, but artifact was None


# ----------------------------- F5: never raises, always tears down -----------------------------


def test_malformed_plan_aborts_technical_and_tears_down(monkeypatch):
    """F5: a plan that fails SessionState.from_plan (bad round type) must NOT raise — it resolves to
    ABORTED_TECHNICAL and the transport is still torn down."""
    _install_stubs(monkeypatch)
    bad_plan = dict(PLAN, roundType="not-a-real-round")
    t = ScriptedTransport(_script(1))
    out = asyncio.run(sess.run_session(t, bad_plan, get_settings()))
    assert out.ended_reason == EndedReason.ABORTED_TECHNICAL
    assert out.session_id == "s1"                 # minimal outcome still identifies the session
    assert t.ended is True                        # transport torn down despite the failure
