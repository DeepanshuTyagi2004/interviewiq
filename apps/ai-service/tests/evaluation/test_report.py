import json

from app.evaluation import inputs
from app.evaluation.models import PartGrade, Synthesis
from app.evaluation.pipeline import hint_turn_ids
from app.evaluation.report import build_report, decode_scene, question_ids, unscorable_report
from app.evaluation.score import ScoreResult
from tests.evaluation.fakes import SYNTHESIS, load, meta, part_reply


def test_report_hides_internal_turns():
    d = load()
    d["turns"][2]["tool_calls"] = [{"name": "give_hint", "result": {"ok": True}}]      # turn 3 gave a hint
    visible = inputs.visible_transcript(d["turns"])
    parts = inputs.build_parts(d["blueprint"], d["run"], visible, d["evidence"])
    merged = {"core-1": PartGrade.model_validate(part_reply())}
    result = ScoreResult(7.0, 0.0, 0.0, None, 7.0, "passed", "Hire", 7.0, 7.0)
    stats = inputs.delivery_stats(d["turns"], visible)
    hints = hint_turn_ids(d["turns"], visible)
    assert hints == [3]
    rep = build_report(meta(), parts, merged, Synthesis.model_validate(SYNTHESIS), result, [], stats, visible, {}, d["run"], None,
                       shares={"core-1": 1.0}, hint_turns=hints)
    ids = [t["turn_id"] for t in rep["transcript"]]
    assert 6 not in ids and ids == [v.turn_id for v in visible]
    blob = json.dumps(rep)
    assert "SECRET" not in blob and "orders" not in blob and "tool_calls" not in blob and "give_hint" not in blob
    marks = {t["turn_id"]: [m["kind"] for m in t["markers"]] for t in rep["transcript"]}
    assert "hint" in marks[3] and "warning" in marks[4] and "warning" in marks[8] and "strong" in marks[7]
    assert 6 not in marks                                 # the warning on a never-played turn has no row to sit on
    assert [t for t, k in marks.items() if "hint" in k] == [3]


def test_unscorable_report_is_minimal():
    d = load()
    visible = inputs.visible_transcript(d["turns"])
    rep = unscorable_report(meta(), visible, "A technical problem.")
    assert set(rep) >= {"outcome", "unscorable_reason", "meta", "transcript"} and "score" not in rep


def test_question_ids_are_unique_and_scene_decodes():
    import base64, gzip
    g = PartGrade.model_validate(part_reply())
    h = PartGrade.model_validate({**part_reply(), "part_id": "core-2"})
    ids = question_ids({"core-1": g, "core-2": h})
    assert set(ids) == {"core-1:main", "core-2:main"} and ids["core-2:main"] == ("core-2", "main")
    assert set(question_ids({"core-1": g})) == {"main"}
    blob = base64.b64encode(gzip.compress(json.dumps({"elements": [1]}).encode())).decode()
    assert decode_scene(blob) == {"elements": [1]} and decode_scene("not base64!") is None and decode_scene(None) is None


def test_auto_fail_reason_follows_the_actual_end_cause():
    # M10: an earlier conduct warning never labels an integrity end; the ledger that reached its ending decides
    from app.evaluation.report import _integrity, auto_fail_reason, end_cause
    warned = [{"kind": "rude", "quote": "x", "turn_id": "4", "at": 100.0}]
    switches = [{"kind": "tab_hidden", "weight": 1.0, "seen_at": t} for t in (200.0, 300.0, 400.0)]
    run = {"end_reason": "ended_by_interviewer", "checkpoint": {"conduct": warned, "proctor": switches, "full_violations": 3}}
    assert end_cause(run) == "integrity" and "screen switching" in auto_fail_reason(run)
    rep_integrity = [e for e in _integrity(run, [], auto_fail_reason(run), []) if e["effect"] == "automatic fail"]
    assert rep_integrity and rep_integrity[0]["kind"] == "tab_hidden"
    second = warned + [{"kind": "rude", "quote": "y", "turn_id": "9", "at": 150.0}]
    run = {"end_reason": "ended_by_interviewer", "checkpoint": {"conduct": second, "proctor": switches[:2], "full_violations": 2}}
    assert end_cause(run) == "conduct" and "conduct" in auto_fail_reason(run)
    away = {"end_reason": "ended_by_interviewer", "checkpoint": {"conduct": warned, "proctor": [{"kind": "away_cap", "weight": 0.0, "seen_at": 90.0}]}}
    assert end_cause(away) == "integrity"
    assert auto_fail_reason({"end_reason": "completed", "checkpoint": {"conduct": second}}) is None


def test_abandoned_problem_is_revisited_in_focus_gaps_and_practice():
    d = load()
    items = d["run"]["checkpoint"]["items"]
    next(i for i in items if i["item_id"] == "core-2").update(status="swapped", ended_by="asked_for_another")
    d["blueprint"]["slots"][1]["problem"]["content"]["patterns"] = ["Graphs", "Hash maps"]
    visible = inputs.visible_transcript(d["turns"])
    parts = inputs.build_parts(d["blueprint"], d["run"], visible, d["evidence"])
    swapped = next(p for p in parts if p.part_id == "core-2")
    assert swapped.swapped
    merged = {"core-1": PartGrade.model_validate(part_reply())}
    result = ScoreResult(7.0, 0.0, 0.0, None, 7.0, "passed", "Hire", 7.0, 7.0)
    practice = {"Hash maps": [{"slug": "other", "title": "Other", "difficulty": "easy"}]}
    rep = build_report(meta(), parts, merged, Synthesis.model_validate(SYNTHESIS), result, [], inputs.delivery_stats(d["turns"], visible),
                       visible, practice, d["run"], None, shares={"core-1": 1.0})
    first = rep["focus"][0]
    assert first["title"] == f"Revisit {swapped.title}" and first["why"].startswith("You asked to switch away from this problem.")
    assert rep["focus"][1]["title"] == "Test before you finish"
    dsa = [g for g in rep["topic_gaps"] if g["subject"] == "DSA"]
    assert len(dsa) == 1
    topics = [t["topic"] for t in dsa[0]["topics"]]
    assert topics == ["Hash maps", "Graphs"]                              # merged into the subject, no duplicate "Hash maps"
    graphs = next(t for t in dsa[0]["topics"] if t["topic"] == "Graphs")
    assert graphs["practice"][0] == {"slug": swapped.slug, "title": swapped.title, "difficulty": swapped.reference["difficulty"], "retry": True}
    assert dsa[0]["topics"][0]["practice"] == [{"slug": "other", "title": "Other", "difficulty": "easy"}]   # others unchanged


def test_abandoned_topics_get_bank_practice_with_the_problem_first(monkeypatch):
    import asyncio as aio
    from app.blueprint import selection
    from app.evaluation import practice
    from app.evaluation.report import abandoned_gaps

    d = load()
    next(i for i in d["run"]["checkpoint"]["items"] if i["item_id"] == "core-2").update(status="swapped", ended_by="asked_for_another")
    d["blueprint"]["slots"][1]["problem"]["content"]["patterns"] = ["Graphs"]
    visible = inputs.visible_transcript(d["turns"])
    parts = inputs.build_parts(d["blueprint"], d["run"], visible, d["evidence"])
    swapped = next(p for p in parts if p.part_id == "core-2")

    async def fake(round_type, culture=False):
        return [{"slug": swapped.slug, "title": "Abandoned", "difficulty": "medium", "topic_tags": ["Graph"]},
                {"slug": "seen", "title": "S", "difficulty": "easy", "topic_tags": ["Graph"]},
                {"slug": "g1", "title": "G1", "difficulty": "medium", "topic_tags": ["Graph"]}]

    monkeypatch.setattr(selection, "load_pool", fake)
    syn = Synthesis.model_validate(SYNTHESIS)
    prac = aio.run(practice.suggest([*syn.topic_gaps, *abandoned_gaps(parts)], "dsa", "Meesho", [swapped.slug, "seen"], max_difficulty="medium"))
    assert [p["slug"] for p in prac["Graphs"]] == ["g1"]                 # seen (including the abandoned problem) excluded here
    merged = {"core-1": PartGrade.model_validate(part_reply())}
    result = ScoreResult(7.0, 0.0, 0.0, None, 7.0, "passed", "Hire", 7.0, 7.0)
    rep = build_report(meta(), parts, merged, syn, result, [], inputs.delivery_stats(d["turns"], visible), visible, prac, d["run"], None,
                       shares={"core-1": 1.0})
    graphs = next(t for g in rep["topic_gaps"] for t in g["topics"] if t["topic"] == "Graphs")
    assert [(p["slug"], p.get("retry")) for p in graphs["practice"]] == [(swapped.slug, True), ("g1", None)]


def test_weak_questions_become_topic_gaps_when_synthesis_has_none():
    from app.evaluation.report import weak_question_gaps
    d = load()
    visible = inputs.visible_transcript(d["turns"])
    parts = inputs.build_parts(d["blueprint"], d["run"], visible, d["evidence"])
    reply = part_reply()
    reply["questions"][0].update(verdict="not_answered", topics=[{"subject": "DSA", "topic": "Dynamic Programming"}], gap="Nothing reached.")
    merged = {"core-1": PartGrade.model_validate(reply)}
    gaps = weak_question_gaps(parts, merged)
    assert [(g.subject, [t.topic for t in g.topics]) for g in gaps] == [("DSA", ["Dynamic Programming"])]
    assert gaps[0].topics[0].why == "Nothing reached."
    reply["questions"][0]["verdict"] = "correct"
    assert weak_question_gaps(parts, {"core-1": PartGrade.model_validate(reply)}) == []
