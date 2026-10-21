import asyncio

import pytest

from app.evaluation import graders, prompts
from app.evaluation.graders import GradingError, grade_part, grade_round, recheck
from app.evaluation.inputs import PartInput, VisibleTurn
from app.evaluation.models import DisputeInput, PartGrade, SessionMeta
from app.interviewer.llm import LLMUnavailable

DSA_KEYS = ["understanding", "approach", "code_correctness", "code_quality", "testing", "complexity", "communication"]


class FakeChat:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append(messages)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r, {}


def meta(**o):
    d = dict(company="Meesho", role="SDE", level="sde1", round_type="dsa", round_minutes=45, pass_mark=6.5,
             code_standard="near_runnable", official=True)
    d.update(o)
    return SessionMeta(**d)


def part(**o):
    turns = [VisibleTurn(1, "interviewer", "Reverse a list.", "", False, "p1"),
             VisibleTurn(2, "candidate", "I would use two pointers.", "", False, "p1")]
    d = dict(part_id="p1", family="dsa", title="Reverse", planned_min=20, ran=True, excluded_reason=None, ended_by=None,
             turns=turns, reference={"title": "Reverse"}, code={"language": "python", "text": "def f(x): return x[::-1]"},
             board=None, evidence_notes=[], hint_steps=[], is_bonus=False)
    d.update(o)
    return PartInput(**d)


def reply(score=6.0, turn=2, must=True, logic="yes", bugs=(), verdict="correct"):
    return {
        "part_id": "p1",
        "questions": [{"id": "main", "asked": "reverse", "answer_quotes": [{"turn_id": turn, "text": "two pointers"}],
                       "verdict": verdict, "score": score, "strong_answer": "s", "gap": "g"}],
        "areas": [{"key": k, "score": score, "evidence": [f"turn:{turn}"], "reason": "r"} for k in DSA_KEYS],
        "code": {"trace": [{"example": "e1", "predicted": "[2,1]", "expected": "[2,1]", "matches": True}], "logic_works": logic, "actual_complexity": "O(n)"},
        "events": {"self_found_bugs": [{"turn_id": t, "text": "x"} for t in bugs]},
        "moments": [], "must_have_met": must,
    }


def run(c):
    return asyncio.run(c)


def test_grade_part_valid():
    g = run(grade_part(FakeChat([reply()]), part(), meta(), "A"))
    assert isinstance(g, PartGrade) and g.part_id == "p1" and len(g.areas) == 7


def test_grade_part_rejects_unknown_turn():
    chat = FakeChat([reply(turn=999), reply()])
    g = run(grade_part(chat, part(), meta(), "A"))
    assert len(chat.calls) == 2 and g.areas[0].evidence == ["turn:2"]
    assert "turn 999" in chat.calls[1][-1]["content"]


def test_grade_part_salvaged_after_three_bad_attempts():
    # owner rule: a result is always available. Every attempt cites an unknown turn: the citation is dropped, the grade is kept
    chat = FakeChat([reply(turn=999)] * 3)
    g = run(grade_part(chat, part(), meta(), "A"))
    assert len(chat.calls) == 3 and len(g.areas) == 7
    assert g.questions[0].answer_quotes == [] and g.questions[0].score == 6.0 and g.questions[0].verdict == "correct"
    assert all(a.evidence == [] for a in g.areas)
    assert g.salvage_notes and "turn 999" in g.salvage_notes[0]


def test_salvage_drops_bad_events_keeps_valid_ones_and_family_area_keys():
    bad = reply(turn=2, bugs=(2, 999))
    bad["areas"] = [{"key": k, "score": 6.0, "evidence": ["turn:2", "turn:999", "board"], "reason": "r"} for k in DSA_KEYS[:4]] + [
        {"key": "bogus", "score": 6.0, "evidence": [], "reason": "r"}]
    bad["moments"] = [{"turn_id": 999, "kind": "strong", "note": "n"}]
    bad["code"]["trace"] = []
    g = run(grade_part(FakeChat([bad] * 3), part(), meta(), "A"))
    assert [a.key for a in g.areas] == DSA_KEYS[:4] and g.areas[0].evidence == ["turn:2"]
    assert [q.turn_id for q in g.events.self_found_bugs] == [2] and g.moments == [] and g.code.trace == []


def test_grade_part_nothing_parseable_is_llm_unavailable():
    chat = FakeChat([{"part_id": "p1", "questions": "nope"}] * 3)
    with pytest.raises(GradingError) as e:
        run(grade_part(chat, part(), meta(), "A"))
    assert e.value.code == "llm_unavailable" and len(chat.calls) == 3


def test_grade_part_llm_unavailable():
    with pytest.raises(GradingError) as e:
        run(grade_part(FakeChat([LLMUnavailable("x")]), part(), meta(), "A"))
    assert e.value.code == "llm_unavailable"


def test_wrong_area_keys_are_salvaged_to_the_present_ones():
    bad = reply()
    bad["areas"] = bad["areas"][:3]
    g = run(grade_part(FakeChat([bad] * 3), part(), meta(), "A"))
    assert [a.key for a in g.areas] == DSA_KEYS[:3] and g.salvage_notes


def test_tiebreak_only_on_gap():
    a, b, c = FakeChat([reply(6.0)]), FakeChat([reply(6.5)]), FakeChat([])
    r = run(grade_round(a, b, c, [part()], meta()))
    assert not c.calls and not r.disagreements and "C" not in r.raw["p1"]
    assert r.merged["p1"].areas[0].score == 6.25
    a, b, c = FakeChat([reply(4.0)]), FakeChat([reply(7.0)]), FakeChat([reply(6.0)])
    r = run(grade_round(a, b, c, [part()], meta()))
    assert len(c.calls) == 1 and r.merged["p1"].areas[0].score == 6.0
    assert r.disagreements and set(r.raw["p1"]) == {"A", "B", "C"}


def test_logic_works_majority():
    a, b, c = FakeChat([reply(logic="yes")]), FakeChat([reply(logic="no")]), FakeChat([reply(logic="no")])
    r = run(grade_round(a, b, c, [part()], meta()))
    assert r.merged["p1"].code.logic_works == "no"
    assert any(d["field"] == "logic_works" for d in r.disagreements)


def test_event_lists_need_both_or_c():
    a, b, c = FakeChat([reply(bugs=(2,), must=True)]), FakeChat([reply(bugs=(), must=False)]), FakeChat([reply(bugs=(2,), must=True)])
    r = run(grade_round(a, b, c, [part()], meta()))
    assert r.merged["p1"].must_have_met is True
    assert [q.turn_id for q in r.merged["p1"].events.self_found_bugs] == [2]
    a, b, c = FakeChat([reply(bugs=(2,))]), FakeChat([reply()]), FakeChat([])
    r = run(grade_round(a, b, c, [part()], meta()))
    assert r.merged["p1"].events.self_found_bugs == []


def test_unrun_parts_not_graded():
    c = FakeChat([])
    r = run(grade_round(FakeChat([]), FakeChat([]), c, [part(ran=False)], meta()))
    assert r.merged == {} and not c.calls


def test_recheck_never_lowers():
    out = {"decision": "revised", "score": 5.0, "explanation": "e"}
    d = DisputeInput(target_type="area", target_id="approach", reason="r", report_version=1)
    g = PartGrade.model_validate(reply(6.0))
    assert run(recheck(FakeChat([out]), part(), [g, g], d, meta())) == ("upheld", 6.0, "e")
    out = {"decision": "revised", "score": 7.5, "explanation": "e"}
    assert run(recheck(FakeChat([out]), part(), [g, g], d, meta())) == ("revised", 7.5, "e")


def test_prompt_contents():
    p = part()
    for v, prior in (("A", None), ("B", None), ("C", [PartGrade.model_validate(reply())])):
        msgs = prompts.part_messages(p, meta(), v, prior, pastes=[{"lines": "1-3"}])
        text = msgs[0]["content"] + msgs[1]["content"]
        assert "hand-trace EVERY" in text and "accent, grammar or English fluency" in text
        assert "Pasted code is not credited" in text and "turn:<id>" in text and "SDE-1" in text
        assert "Code correctness" in text
    assert prompts.part_messages(p, meta(), "A")[0]["content"] != prompts.part_messages(p, meta(), "B")[0]["content"]
    assert "Pasted code is not credited" not in prompts.part_messages(p, meta(), "A")[1]["content"]
    assert prompts.__doc__.startswith("DRAFT — owner review before production")


def test_build_eval_chats():
    from app.config import Settings
    s = Settings(_env_file=None, EVALUATION_TIEBREAK_MODEL="", OPENROUTER_API_KEY="test-key")
    a, b, c = graders.build_eval_chats(s)
    assert (a.temperature, b.temperature, c.temperature) == (None, None, None) and c.model == s.evaluation_model


def test_trace_count_enforced_against_examples():
    p = part(reference={"title": "R", "content": {"examples": [{}, {}]}})
    short = run(grade_part(FakeChat([reply()] * 3), p, meta(), "A"))          # salvaged: a shorter trace is accepted
    assert len(short.code.trace) == 1 and short.salvage_notes
    two = reply()
    two["code"]["trace"] = two["code"]["trace"] * 2
    assert run(grade_part(FakeChat([two]), p, meta(), "A")).code


def test_code_board_refs_and_quotes_checked():
    p = part(code=None, family="system-design")
    g = PartGrade.model_validate(reply())
    errs = graders.check_citations(g, {1, 2}, None, True, False, False)
    assert not errs  # evidence is turn refs only
    g.areas[0].evidence = ["code"]
    assert any('"code"' in e for e in graders.check_citations(g, {1, 2}, None, True, False, False))
    g.questions[0].answer_quotes = []
    assert any("no answer quote" in e for e in graders.check_citations(g, {1, 2}))
    g.questions[0].verdict = "not_answered"
    assert not any("no answer quote" in e for e in graders.check_citations(g, {1, 2}))


def test_resume_prompt_and_consistency_tiebreak():
    p = part(family="knowledge", code=None, reference={"resume_probes": [{"q": "x"}]})
    text = prompts.part_messages(p, meta(), "A", profile={"skills": ["Go"]})[1]["content"]
    assert "resume facts" in text and "Go" in text
    ks = ["correctness", "depth", "communication"]

    def r(rc):
        d = reply(code=None) if False else reply()
        d["areas"] = [{"key": k, "score": 6, "evidence": ["turn:2"], "reason": "r"} for k in ks]
        d["code"] = None
        d["questions"][0]["resume_consistency"] = rc
        return d
    a, b, c = FakeChat([r("consistent")]), FakeChat([r("contradicts")]), FakeChat([r("contradicts")])
    res = run(grade_round(a, b, c, [p], meta(), profile={"skills": ["Go"]}))
    assert len(c.calls) == 1 and res.merged["p1"].questions[0].resume_consistency == "contradicts"


def test_question_score_gap_calls_c():
    a, b, c = FakeChat([reply()]), FakeChat([reply()]), FakeChat([reply()])
    ra = reply(); rb = reply(); rb["questions"][0]["score"] = 9.0; ra["questions"][0]["score"] = 5.0
    a, b = FakeChat([ra]), FakeChat([rb])
    res = run(grade_round(a, b, c, [part()], meta()))
    assert len(c.calls) == 1 and res.merged["p1"].questions[0].score == 6.0
    assert any(d["field"] == "question:main:score" for d in res.disagreements)


def test_synthesize_clamps_bonus():
    base = {"summary": "s", "interviewer_note": "n",
            "focus": [{"title": "t", "why": "w", "turn_ids": [2]}],
            "end_questions": {"quality": "thoughtful", "bonus": 0.2, "note": "n"}}
    from app.evaluation.inputs import DeliveryStats
    st = DeliveryStats([], [], {}, [], 0)
    s = run(graders.synthesize(FakeChat([base]), [part()], {}, st, meta()))
    assert s.end_questions.bonus == 0.2
    base["end_questions"] = {"quality": "basic", "bonus": 0.2, "note": "n"}
    assert run(graders.synthesize(FakeChat([base]), [part()], {}, st, meta())).end_questions.bonus == 0.0
    bad = {**base, "focus": [{"title": "t", "why": "w", "turn_ids": [99]}]}
    assert run(graders.synthesize(FakeChat([bad] * 3), [part()], {}, st, meta())).focus == []     # salvaged: the item without a real turn is dropped


# ---- final-review fixes (Module 04)

def _with_questions(base: dict, *ids: str) -> dict:
    q = base["questions"][0]
    return {**base, "questions": [{**q, "id": i} for i in ids]}


def test_merge_keeps_a_question_list_and_records_mismatches():
    # I6: B graded a question A did not ("q1") and missed A's follow-up ("f1"): no duplicate cards, both recorded, no tiebreak call
    a = FakeChat([_with_questions(reply(6.0), "main", "f1")])
    b = FakeChat([_with_questions(reply(6.5), "main", "q1")])
    c = FakeChat([])
    r = run(grade_round(a, b, c, [part()], meta()))
    assert [q.id for q in r.merged["p1"].questions] == ["main", "f1"]
    assert next(q for q in r.merged["p1"].questions if q.id == "f1").score == 6.0
    fields = {d["field"]: d for d in r.disagreements}
    assert fields["question:f1:only_a"]["merged"] == 6.0 and fields["question:q1:only_b"]["merged"] is None
    assert not c.calls


def test_prompt_pins_question_ids_must_have_rule_and_injection_guard():
    # I6 / I7 / M8
    from app.evaluation.inputs import DeliveryStats
    from app.evaluation.weights import MUST_HAVE, MUST_HAVE_RULE
    for v, prior in (("A", None), ("B", None), ("C", [PartGrade.model_validate(reply())])):
        text = prompts.part_messages(part(), meta(), v, prior)[0]["content"]
        assert '"main"' in text and "f1, f2" in text and "q1, q2" in text
        assert MUST_HAVE_RULE["dsa"] in text and MUST_HAVE["dsa"] not in text
        assert prompts.INJECTION_GUARD in text
    assert "logic_works yes or syntax_only" in MUST_HAVE_RULE["dsa"] and "pseudo_ok" in MUST_HAVE_RULE["dsa"]
    bonus = prompts.part_messages(part(is_bonus=True), meta(), "A")[0]["content"]
    assert "no must-have: set must_have_met true" in bonus
    stats = DeliveryStats([], [], {}, [], 0)
    assert prompts.INJECTION_GUARD in prompts.synthesis_messages([part()], {}, stats, meta())[0]["content"]
    d = DisputeInput(target_type="question", target_id="main", reason="r", report_version=1)
    assert prompts.INJECTION_GUARD in prompts.dispute_messages(part(), [PartGrade.model_validate(reply())], d, meta())[0]["content"]


def test_swapped_part_prompt_treats_it_as_not_known():
    note = "Treat it as a problem the candidate does not know: give credit only for what they actually showed"
    assert note in prompts.part_messages(part(swapped=True), meta(), "A")[1]["content"]
    assert note not in prompts.part_messages(part(), meta(), "A")[1]["content"]


def test_synthesize_takes_turn_ids_from_text_and_drops_unknown_ones():
    # Live round c8e70bb8: the model wrote "(turns 63, 64)" in the advice and left turn_ids empty; grading failed for good.
    from app.evaluation.inputs import DeliveryStats
    st = DeliveryStats([], [], {}, [], 0)
    out = {"summary": "s", "interviewer_note": "n",
           "focus": [{"title": "Stay with the problem (turns 2, 99)", "why": "w", "turn_ids": []},
                     {"title": "t", "why": "see turn 2", "turn_ids": [2, 99]}],
           "delivery": [{"text": "o", "examples": [2, 99]}],
           "end_questions": {"quality": "none", "bonus": 0, "note": "n"}}
    s = run(graders.synthesize(FakeChat([out]), [part()], {}, st, meta()))
    assert [f.turn_ids for f in s.focus] == [[2], [2]]
    assert s.delivery[0].examples == [2]


def test_tiebreak_failure_merges_a_and_b_without_c():
    a, b = FakeChat([reply(3.0)]), FakeChat([reply(8.0)])
    c = FakeChat([LLMUnavailable("down")])
    r = run(grade_round(a, b, c, [part()], meta()))
    assert "C" not in r.raw["p1"] and r.merged["p1"].areas[0].score == 5.5
    assert any(d["field"] == "tiebreak:failed" for d in r.disagreements)


def test_one_grader_failing_leaves_the_other_alone():
    a, b = FakeChat([LLMUnavailable("down")]), FakeChat([reply(7.0)])
    r = run(grade_round(a, b, FakeChat([]), [part()], meta()))
    assert r.merged["p1"].areas[0].score == 7.0 and any(d["field"] == "grader:A_failed" for d in r.disagreements)
    with pytest.raises(GradingError):
        run(grade_round(FakeChat([LLMUnavailable("x")]), FakeChat([LLMUnavailable("x")]), FakeChat([]), [part()], meta()))


def test_synthesis_unparseable_falls_back_to_a_deterministic_one():
    from app.evaluation.inputs import DeliveryStats
    st = DeliveryStats([], [], {}, [], 0)
    g = run(grade_part(FakeChat([reply(turn=2, score=4.0, verdict="partly")]), part(), meta(), "A"))
    s, fell = run(graders.synthesize_or_fallback(FakeChat([{"summary": 1}] * 3), [part()], {"p1": g}, st, meta()))
    assert fell and s.end_questions.quality == "none" and s.interviewer_note == "" and s.delivery == []
    assert 1 <= len(s.focus) <= 3 and all(f.turn_ids == [2] for f in s.focus)
    assert s.topic_gaps == [] and s.strengths == []          # the reply had no topics and nothing scored 7.5+
    s2, fell2 = run(graders.synthesize_or_fallback(FakeChat([LLMUnavailable("down")]), [part()], {"p1": g}, st, meta()))
    assert fell2 and "pass mark" in s2.summary


def test_salvage_with_no_usable_area_fills_the_mean_question_score_or_is_transient():
    bad = reply(turn=2, score=4.0)
    bad["areas"] = [{"key": "bogus", "score": 9.0, "evidence": [], "reason": "r"}]
    g = run(grade_part(FakeChat([bad] * 3), part(), meta(), "A"))
    assert [a.key for a in g.areas] == DSA_KEYS and all(a.score == 4.0 for a in g.areas)
    assert any("mean question score" in n for n in g.salvage_notes)
    none = reply(turn=2)
    none["areas"], none["questions"] = [], []
    g2 = run(grade_part(FakeChat([none] * 3), part(family="behavioural"), meta(round_type="behavioural"), "A"))
    assert g2.questions[0].id == "q1" and (g2.questions[0].verdict, g2.questions[0].score) == ("not_answered", 1.0)
    nocode = reply(turn=999)
    nocode["code"] = None
    g = run(grade_part(FakeChat([nocode] * 3), part(), meta(), "A"))
    assert g.code is None and any("code grade missing" in n for n in g.salvage_notes)


def test_salvage_notes_are_not_sent_to_the_model():
    seen = []

    class Spy(FakeChat):
        async def json(self, messages, schema_name, schema, max_tokens=3000):
            seen.append(schema)
            return await super().json(messages, schema_name, schema, max_tokens)

    run(grade_part(Spy([reply()]), part(), meta(), "A"))
    assert "salvage_notes" not in seen[0]["properties"]
    g = run(grade_part(FakeChat([reply(turn=999)] * 3), part(), meta(), "A"))
    assert g.salvage_notes
    msgs = prompts.part_messages(part(), meta(), "C", prior=[g])
    assert "salvage_notes" not in msgs[1]["content"] and "turn 999" not in msgs[1]["content"]


def test_fallback_summary_uses_the_human_verdict_label():
    g = run(grade_part(FakeChat([reply()]), part(), meta(), "A"))
    s = graders.fallback_synthesis([part()], {"p1": g}, meta(), 5.0, "lean_no_hire")
    assert "Lean No Hire" in s.summary and "lean_no_hire" not in s.summary


def _empty_questions():
    r = reply()
    r["questions"] = []
    return r


def _lis_part(**o):
    ref = {"title": "Longest Increasing Subsequence", "content": {"statement": "Return the length of the longest strictly increasing subsequence."},
           "answer_key": {"approaches": [{"name": "DP", "idea": "O(n^2) table over prefixes", "time_complexity": "O(n^2)", "space_complexity": "O(n)"},
                                         {"name": "Patience sorting", "idea": "keep tails and binary search", "time_complexity": "O(n log n)", "space_complexity": "O(n)"}],
                          "complexity_target": "O(n log n) time", "key_insights": ["tails array stays sorted", "binary search the insert position"]}}
    d = dict(reference=ref, code=None, topics=["Dynamic Programming", "Binary Search"], title="Longest Increasing Subsequence")
    d.update(o)
    return part(**d)


def test_empty_questions_are_rejected_and_repaired():
    chat = FakeChat([_empty_questions(), reply()])
    g = run(grade_part(chat, part(), meta(), "A"))
    assert len(chat.calls) == 2 and [q.id for q in g.questions] == ["main"] and not g.salvage_notes
    assert "questions is empty" in chat.calls[1][-1]["content"]


def test_problem_part_without_main_is_rejected():
    other = reply()
    other["questions"][0]["id"] = "f1"
    chat = FakeChat([other, reply()])
    g = run(grade_part(chat, part(), meta(), "A"))
    assert len(chat.calls) == 2 and g.questions[0].id == "main" and 'id "main"' in chat.calls[1][-1]["content"]


def test_prompt_tells_the_grader_to_always_grade_main():
    text = prompts.part_messages(part(), meta(), "A", None, [], None)[0]["content"]
    assert "always grade the main problem as question id main" in text


def test_all_attempts_empty_salvage_builds_the_main_card_from_the_part():
    chat = FakeChat([_empty_questions()] * 3)
    g = run(grade_part(chat, _lis_part(), meta(), "A"))
    assert len(chat.calls) == 3
    q = next(x for x in g.questions if x.id == "main")
    assert (q.verdict, q.score) == ("partly", 6.0)         # mean of approach and code_correctness (6.0 each) -> the partly band
    assert "Longest Increasing Subsequence" in q.asked and "strictly increasing" in q.asked
    assert q.strong_answer.startswith("A strong answer: Patience sorting — Keep tails and binary search.")
    assert "Complexity: O(n log n) time, O(n) space." in q.strong_answer
    assert "A good first step at this level: DP — O(n^2) table over prefixes (O(n^2) time, O(n) space)." in q.strong_answer
    assert "Tails array stays sorted. Binary search the insert position." in q.strong_answer
    assert ";" not in q.strong_answer and ".." not in q.strong_answer
    assert [t.topic for t in q.topics] == ["Dynamic Programming", "Binary Search"] and q.topics[0].subject == "DSA"
    assert [qq.turn_id for qq in q.answer_quotes] == [] and q.gap       # "I would use two pointers." is under 6 words
    assert any("no main question graded" in n for n in g.salvage_notes)


def test_salvage_main_card_is_not_answered_when_nothing_was_written():
    quiet = [VisibleTurn(1, "interviewer", "Solve LIS.", "", False, "p1"), VisibleTurn(2, "candidate", "no idea", "", False, "p1")]
    bad = _empty_questions()
    bad["areas"] = []
    g = run(grade_part(FakeChat([bad] * 3), _lis_part(turns=quiet), meta(), "A"))
    q = g.questions[0]
    assert q.id == "main" and (q.verdict, q.score) == ("not_answered", 1.0) and q.gap.startswith("You didn't reach a working approach: no code was written.")


def test_salvage_main_card_bands_follow_the_area_mean():
    for score, verdict in ((9.5, "correct"), (7.5, "mostly"), (5.5, "partly"), (3.0, "wrong")):
        bad = reply(score=score)
        bad["questions"] = []
        g = run(grade_part(FakeChat([bad] * 3), _lis_part(), meta(), "A"))
        q = g.questions[0]
        assert (q.id, q.verdict, q.score) == ("main", verdict, score)


def test_salvage_main_card_with_code_but_no_areas_is_not_answered():
    bad = _empty_questions()
    bad["areas"] = []
    g = run(grade_part(FakeChat([bad] * 3), _lis_part(code={"language": "python", "text": "def lis(a):\n    return 1"}), meta(), "A"))
    assert (g.questions[0].verdict, g.questions[0].score) == ("not_answered", 1.0)


def test_salvage_quote_is_cut_verbatim_at_200_chars():
    long = "word " * 80
    turns = [VisibleTurn(1, "interviewer", "Q", "", False, "p1"), VisibleTurn(2, "candidate", long.strip(), "", False, "p1")]
    g = run(grade_part(FakeChat([_empty_questions()] * 3), _lis_part(turns=turns), meta(), "A"))
    text = g.questions[0].answer_quotes[0].text
    assert text == long.strip()[:200] + "…"


def test_non_problem_part_without_questions_gets_a_generic_card():
    ref = {"round_questions": [{"prompt": "Tell me about a conflict.", "strong_answer": "Use a specific STAR example."}]}
    bad = _empty_questions()
    g = run(grade_part(FakeChat([bad] * 3), part(family="behavioural", title="Behavioural", reference=ref, topics=["Conflict"]),
                       meta(round_type="behavioural"), "A"))
    q = g.questions[0]
    assert q.id == "q1" and "Tell me about a conflict." in q.asked and q.strong_answer == "Use a specific STAR example."
    assert [t.topic for t in q.topics] == ["Conflict"] and [x.turn_id for x in q.answer_quotes] == []     # the 5-word fixture turn is too short to quote


def _vt(seq, sp, text):
    return VisibleTurn(seq, sp, text, "", False, "p1")


def test_salvage_quotes_skip_meta_requests_and_short_turns_and_keep_the_longest_in_time_order():
    turns = [_vt(1, "interviewer", "Solve LIS."), _vt(2, "candidate", "Hello, good morning!"),
             _vt(3, "candidate", "Can you repeat the constraints of the problem for me please"),
             _vt(4, "candidate", "hmm"),
             _vt(5, "candidate", "I would try a table over prefixes where each cell holds the best length ending there"),
             _vt(6, "candidate", "Could you give me another problem instead of this one please"),
             _vt(7, "candidate", "then the answer is the max of the table and it takes quadratic time overall which is fine"),
             _vt(8, "candidate", "okay so just a short bit of extra detail here")]
    g = run(grade_part(FakeChat([_empty_questions()] * 3), _lis_part(turns=turns), meta(), "A"))
    assert [q.turn_id for q in g.questions[0].answer_quotes] == [5, 7]


def test_salvage_quotes_empty_when_nothing_qualifies():
    turns = [_vt(1, "interviewer", "Solve LIS."), _vt(2, "candidate", "hello"), _vt(3, "candidate", "can you explain the question again please")]
    g = run(grade_part(FakeChat([_empty_questions()] * 3), _lis_part(turns=turns), meta(), "A"))
    assert g.questions[0].answer_quotes == []


def test_salvage_gap_uses_area_labels_and_clean_sentences():
    bad = _empty_questions()
    bad["areas"] = [{"key": "code_correctness", "score": 1.0, "evidence": [], "reason": "No code was written; only a verbal direction was given.."},
                    {"key": "approach", "score": 2.0, "evidence": [], "reason": "Idea was vague"}]
    turns = [_vt(1, "interviewer", "Solve LIS."), _vt(2, "candidate", "no idea")]
    g = run(grade_part(FakeChat([bad] * 3), _lis_part(turns=turns), meta(), "A"))
    gap = g.questions[0].gap
    assert gap == ("You didn't reach a working approach: no code was written. "
                   "Weakest: Code correctness — no code was written, only a verbal direction was given. Also weak: Approach & optimisation — idea was vague.")
    assert "code_correctness" not in gap and ".." not in gap and ";" not in gap


def test_strong_answer_prose_for_design_key_and_without_simpler_approach():
    s = graders._strong_from_key({"answer_key": {"expected_design": "Use a sharded cache.. with write-through; evict by LRU",
                                                 "complexity_target": "O(1) lookups", "must_cover": ["sharding", "eviction"]}})
    assert s == "Use a sharded cache. With write-through, evict by LRU. Target complexity: O(1) lookups. Sharding. Eviction."
    only = graders._strong_from_key({"answer_key": {"approaches": [{"name": "Brute force", "idea": "Try all pairs", "time_complexity": "O(n^2)", "space_complexity": "O(1)"},
                                                                   {"name": "Hash map", "idea": "Store seen values", "time_complexity": "O(n)", "space_complexity": "O(n)"}]}})
    assert only == "A strong answer: Hash map — Store seen values. Complexity: O(n) time, O(n) space."


def _settings(**o):
    from types import SimpleNamespace
    d = dict(openrouter_api_key="k", openrouter_base_url="http://x", interviewer_director_reasoning="medium", evaluation_timeout_s=5.0,
             evaluation_model="anthropic/claude-haiku-5.5", evaluation_model_b="openai/gpt-6-luna",
             evaluation_tiebreak_model="anthropic/claude-sonnet-5.5")
    d.update(o)
    return SimpleNamespace(**d)


def test_build_eval_chats_uses_one_model_per_grader_and_no_price_cap():
    a, b, c = graders.build_eval_chats(_settings())
    assert (a.model, b.model, c.model) == ("anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "anthropic/claude-sonnet-5.5")
    assert (a.temperature, b.temperature, c.temperature) == (None, None, None)
    assert "max_price" not in a.routing and a.routing["require_parameters"] is True


def test_build_eval_chats_b_and_tiebreak_fall_back_to_the_main_model():
    a, b, c = graders.build_eval_chats(_settings(evaluation_model_b=None, evaluation_tiebreak_model=None))
    assert a.model == b.model == c.model == "anthropic/claude-haiku-5.5"
