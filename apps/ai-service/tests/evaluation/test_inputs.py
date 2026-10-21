import json
from pathlib import Path

import pytest

from app.evaluation.inputs import (NOT_GIVEN, DeliveryStats, PartInput, adjustment_inputs, build_parts, delivery_stats,
                                   visible_transcript)
from app.evaluation.models import Events, Quote
from app.evaluation.score import adjustments, part_shares

FIX = Path(__file__).parent.parent / "fixtures" / "evaluation"


def load(name: str) -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


def parts_of(name: str):
    d = load(name)
    visible = visible_transcript(d["turns"])
    return d, visible, build_parts(d["blueprint"], d["run"], visible, d["evidence"])


def by_id(parts, pid) -> PartInput:
    return next(p for p in parts if p.part_id == pid)


# ---------------------------------------------------------------- transcript

def test_visible_transcript_hides_unspoken_blocked_and_uses_heard():
    d = load("dsa_round")
    v = {t.turn_id: t for t in visible_transcript(d["turns"])}
    assert 6 not in v                                   # spoken: False
    assert "Honestly" not in v[5].text and v[5].text.startswith("That works.")   # guard-blocked sentence removed
    assert v[8].text == "Great, that is the idea." and v[8].cut_off     # heard part of an interrupted turn
    assert v[4].speaker == "candidate" and not v[4].cut_off
    assert all("SECRET" not in t.text for t in v.values())          # orders are never text
    assert v[1].item_id == "greeting" and v[1].at.startswith("2023-11-14")


def test_visible_transcript_drops_empty_after_blocking():
    turns = [{"seq": 1, "speaker": "interviewer", "text": "Bad sentence.", "at": 1.0, "blocked": [{"rule": "r", "sentence": "Bad sentence."}]},
             {"seq": 2, "speaker": "candidate", "text": "   ", "at": 2.0}]
    assert visible_transcript(turns) == []


# ---------------------------------------------------------------- parts

def test_dsa_round_parts():
    d, visible, parts = parts_of("dsa_round")
    assert [p.part_id for p in parts] == ["core-1", "core-2", "candidate_questions"]
    main, second, ask = parts
    assert main.ran and main.family == "dsa" and main.planned_min == 20 and not main.is_bonus
    assert main.code and main.code["language"] == "python" and "def pair_sum" in main.code["text"]
    assert main.hint_steps == [1, 2]
    assert [t.turn_id for t in main.turns] == [3, 4, 5, 7, 8, 9]
    assert main.reference["answer_key"]["complexity_target"] == "O(n) time" and main.reference["expectations"]["must_show"]
    assert main.evidence_notes[0]["signal"] == "approach"
    assert not second.ran and second.excluded_reason == NOT_GIVEN and second.is_bonus and second.turns == []
    assert ask.family == "end_questions" and ask.ran and [t.turn_id for t in ask.turns] == [10, 11]


def test_no_code_round_has_empty_code_not_none():
    d, _, parts = parts_of("mixed_round")
    assert by_id(parts, "core-1").code == {"language": "", "text": ""}


def test_mixed_round_families_and_planned_minutes():
    d, _, parts = parts_of("mixed_round")
    assert [(p.part_id, p.family, p.planned_min) for p in parts] == [
        ("core-1", "dsa", 25.0), ("culture-1", "behavioural", 8.0), ("deep_dive", "knowledge", 12.0),
        ("candidate_questions", "end_questions", 4.0)]
    assert by_id(parts, "culture-1").family == "behavioural" and by_id(parts, "culture-1").code is None
    dd = by_id(parts, "deep_dive")
    assert dd.ran and dd.reference["round_questions"] and dd.reference["resume_probes"]
    assert not by_id(parts, "candidate_questions").ran       # nobody spoke in it
    shares = part_shares({p.part_id: p.planned_min for p in parts if p.ran and p.family != "end_questions"})
    assert shares["core-1"] > shares["culture-1"]


def test_pending_core_is_not_reached_but_pending_bonus_is_excluded_and_thread_turns_go_to_parent():
    d = load("dsa_round")
    items = d["run"]["checkpoint"]["items"]
    next(i for i in items if i["item_id"] == "core-2").update(status="pending")
    items.append({"item_id": "thread-1", "kind": "thread", "phase": "thread", "status": "done", "parent": "core-1", "max_seconds": 60})
    turns = d["turns"] + [{"seq": 11, "speaker": "interviewer", "text": "Quick aside?", "at": 0.5, "item_id": "thread-1"},
                          {"seq": 12, "speaker": "candidate", "text": "A side thought.", "at": 1.0, "item_id": "thread-1"}]
    parts = build_parts(d["blueprint"], d["run"], visible_transcript(turns), d["evidence"])
    assert not by_id(parts, "core-2").ran and by_id(parts, "core-2").excluded_reason == NOT_GIVEN
    assert 12 in [t.turn_id for t in by_id(parts, "core-1").turns]
    d["blueprint"]["slots"][1]["bonus"] = False
    next(i for i in items if i["item_id"] == "core-2").update(bonus=False)
    parts = build_parts(d["blueprint"], d["run"], visible_transcript(turns), d["evidence"])
    assert by_id(parts, "core-2").ran and by_id(parts, "core-2").turns == []


# ---------------------------------------------------------------- delivery

def _t(seq, sp, text, at, item="core-1", **kw):
    return {"seq": seq, "speaker": sp, "text": text, "at": at, "item_id": item, **kw}


def test_delivery_counts_um_and_one_slow_start():
    turns = [
        _t(1, "interviewer", "one two three four five six seven eight nine ten", 100.0),            # ends about 104
        _t(2, "candidate", "um so um the idea is um to sort first", 115.0),                          # 9 words: 3.6 s; wait 1 s -> starts about 110.4
        _t(3, "interviewer", "ok go on and tell me more about that please now", 116.0, endpointing_ms=1000),
        _t(4, "candidate", "then scan with two pointers from both ends", 128.0),                    # prompt start
        _t(5, "interviewer", "good", 129.0, endpointing_ms=500),
    ]
    vis = visible_transcript(turns)
    s = delivery_stats(turns, vis)
    assert isinstance(s, DeliveryStats)
    assert s.filler_counts["um"] == 3
    assert s.slow_starts == [2]
    assert len(s.answer_latencies_s) == 2 and s.answer_latencies_s[0] >= 6.0 > s.answer_latencies_s[1]


def test_delivery_fillers_self_corrections_and_silences():
    turns = [
        _t(1, "interviewer", "Here is the problem", 0.0),
        _t(2, "candidate", "I like hash maps. Basically it is, like, a lookup, you know, actually no wait, sorry, I mean a set", 20.0),
        _t(3, "candidate", "done", 150.0),
        _t(4, "interviewer", "okay", 151.0),
    ]
    s = delivery_stats(turns, visible_transcript(turns), coding_items={"core-1"})
    assert s.filler_counts == {"like": 1, "basically": 1, "actually": 1, "you know": 1}
    assert s.self_corrections >= 2
    assert [x["seconds"] for x in s.long_silences] == [130.0]
    assert delivery_stats(turns, visible_transcript(turns)).long_silences == []


# ---------------------------------------------------------------- adjustments

def test_adjustment_inputs_from_checkpoint():
    d, _, parts = parts_of("dsa_round")
    ev = {"core-1": Events(self_found_bugs=[Quote(turn_id=7, text="oh my index is off")], pointed_out_bugs=[Quote(turn_id=8, text="x")], beyond_level=True),
          "core-2": Events(self_found_bugs=[Quote(turn_id=1, text="ignored: part did not run")]),
          "end_questions_bonus": 0.1}
    x = adjustment_inputs(d["run"], parts, ev)
    assert x.hint_steps_by_problem == {"core-1": [1, 2]}
    assert (x.self_found_bugs, x.pointed_out_bugs, x.beyond_level, x.bonus_solved, x.end_questions_bonus) == (1, 1, True, False, 0.1)
    assert x.change_requests == 1 and not x.change_granted
    assert x.conduct_warnings == [{"kind": "warning", "turn_id": 6, "at": 2.0}, {"kind": "final_warning", "turn_id": 8, "at": 3.0}]
    assert [p["kind"] for p in x.proctor] == ["tab_hidden", "window_blur", "away_overstay"]
    assert len(x.pastes) == 1 and x.away_overstays == [{"at": 1700000300000}]
    assert x.abuse == []
    abusive = dict(d["run"], checkpoint=dict(d["run"]["checkpoint"], conduct=[{"kind": "abusive", "at": 5.0, "turn_id": 9}]))
    assert adjustment_inputs(abusive, parts, ev).abuse == [{"turn_id": 9, "at": 5.0}]
    kinds = [a.kind for a in adjustments(x)]          # score.py accepts the shapes
    assert {"hint", "conduct_warning", "conduct_final_warning", "paste", "away_overstay", "proctor"} <= set(kinds)


def test_adjustment_inputs_ignore_excluded_part_hints():
    d, _, parts = parts_of("dsa_round")
    by_id(parts, "core-2").hint_steps = [1]
    assert "core-2" not in adjustment_inputs(d["run"], parts, {}).hint_steps_by_problem


def test_only_first_candidate_turn_after_a_question_is_timed():
    turns = [_t(1, "interviewer", "one two three four five six", 0.0),
             _t(2, "candidate", "first part of my answer here", 5.0),
             _t(3, "candidate", "and a second part much later on", 200.0),
             _t(4, "interviewer", "thanks", 201.0)]
    assert len(delivery_stats(turns, visible_transcript(turns)).answer_latencies_s) == 1


def test_no_latency_measured_inside_a_coding_part():
    turns = [_t(1, "interviewer", "one two three four five six", 0.0),
             _t(2, "candidate", "first part of my answer here", 60.0)]
    assert delivery_stats(turns, visible_transcript(turns), coding_items={"core-1"}).answer_latencies_s == []


def test_thread_speech_breaks_a_silence():
    turns = [_t(1, "interviewer", "Here is the problem", 0.0),
             _t(2, "candidate", "a question about it", 80.0, item="thread-1"),
             _t(3, "candidate", "done", 150.0),
             _t(4, "interviewer", "okay", 151.0)]
    vis = visible_transcript(turns)
    assert [x["seconds"] for x in delivery_stats(turns, vis, {"core-1"}).long_silences] == [150.0]     # thread speech unseen
    assert delivery_stats(turns, vis, {"core-1"}, parents={"thread-1": "core-1"}).long_silences == []  # 80 s and 70 s gaps


def test_slot_skipped_at_the_round_end_ran_only_when_a_person_ended_it():
    d = load("dsa_round")
    d["blueprint"]["slots"][1]["bonus"] = False
    c2 = next(i for i in d["run"]["checkpoint"]["items"] if i["item_id"] == "core-2")
    c2.update(bonus=False, status="skipped", ended_by="candidate_ended")
    vis = visible_transcript(d["turns"])
    d["run"]["end_reason"] = "candidate_ended"
    p = by_id(build_parts(d["blueprint"], d["run"], vis, []), "core-2")
    assert p.ran and p.turns == [] and p.excluded_reason is None
    for reason in ("completed", "ceiling"):
        d["run"]["end_reason"] = reason
        c2["ended_by"] = reason
        p = by_id(build_parts(d["blueprint"], d["run"], vis, []), "core-2")
        assert not p.ran and p.excluded_reason == NOT_GIVEN
    d["run"]["end_reason"] = "candidate_ended"
    c2["ended_by"] = "interviewer: first problem went badly"
    assert not by_id(build_parts(d["blueprint"], d["run"], vis, []), "core-2").ran


def test_swapped_problem_is_graded_even_when_nothing_was_said_on_it():
    d = load("dsa_round")
    items = d["run"]["checkpoint"]["items"]
    next(i for i in items if i["item_id"] == "core-2").update(status="swapped", ended_by="asked_for_another")
    d["blueprint"]["slots"][1]["problem"]["content"]["patterns"] = ["Graphs"]
    turns = [t for t in d["turns"] if t.get("item_id") != "core-2"]
    parts = build_parts(d["blueprint"], d["run"], visible_transcript(turns), d["evidence"])
    p = by_id(parts, "core-2")
    assert p.swapped and p.ran and p.excluded_reason is None and p.turns == []
    assert p.slug == d["blueprint"]["slots"][1]["problem"]["slug"] and "Graphs" in p.topics
    assert not by_id(parts, "core-1").swapped


def test_candidate_turn_belongs_to_the_item_last_played_to_them_not_the_conductors_item():
    d = load("dsa_round")
    items = d["run"]["checkpoint"]["items"]
    next(i for i in items if i["item_id"] == "core-2").update(status="active")
    turns = [_t(1, "interviewer", "Tell me about your project.", 1.0, "core-1"),
             _t(2, "candidate", "I built a queue service for orders.", 5.0, "core-1"),
             _t(3, "interviewer", "Now here is the next problem.", 9.0, "core-2", spoken=False),     # the conductor moved on; never played
             _t(4, "candidate", "and it ran on three nodes with retries.", 12.0, "core-2"),
             _t(5, "interviewer", "Thanks. Here is the problem.", 15.0, "core-2"),
             _t(6, "candidate", "I would use a hash map for this one.", 20.0, "core-2")]
    parts = build_parts(d["blueprint"], d["run"], visible_transcript(turns), d["evidence"])
    assert [t.turn_id for t in by_id(parts, "core-1").turns] == [1, 2, 4]
    assert [t.turn_id for t in by_id(parts, "core-2").turns] == [5, 6]
