import re

import pytest

from app.blueprint.policies import global_signals
from app.rounds.compose import PACKS, band_for, compose_rules, pack_for

SENT = re.compile(r"(?<=[.!?:])\s+|\n")
FLAGS = {"system-design": {"workspace": "board", "requires_code": False, "change_policy": "never", "hints": "nudge", "second_problem": False, "gate_second": False},
         "lld": {"workspace": "editor+board", "requires_code": False, "change_policy": "never", "hints": "nudge", "second_problem": False, "gate_second": False},
         "behavioural": {"workspace": "none", "requires_code": False, "change_policy": "on_no_example", "hints": "narrow",
                         "second_problem": False, "gate_second": False},
         "hiring-manager": {"workspace": "none", "requires_code": False, "change_policy": "on_no_example", "hints": "narrow",
                            "second_problem": False, "gate_second": False},
         "online-assessment": {"workspace": "editor", "requires_code": True, "change_policy": "decline", "hints": "none",
                               "second_problem": True, "gate_second": False}}
NOUNS = {"system-design": ["a design problem", "the design part"], "lld": ["a design problem", "the design part"],
         "behavioural": ["some questions about your experience", "the questions"],
         "hiring-manager": ["some questions about your experience", "the questions"], "online-assessment": ["some coding", "the coding"]}
CASES = [(rt, lv) for rt in FLAGS for lv in ("intern", "sde2", "staff")]
LINE_KEYS = ("bridge:first", "problem", "candidate_intro", "put_up:first", "intro:first", "swap_put_up")


def own_text(pack):
    parts = [*pack.director, *pack.item_talker, *pack.item_director, *(l for lines in pack.talker.values() for l in lines),
             *(v for vs in pack.lines.values() for v in vs)]
    return [s.strip() for text in parts for s in SENT.split(text) if s.strip()]


@pytest.mark.parametrize("rt,lvl", CASES)
def test_compose_pack_flags_and_overlay(rt, lvl):
    rules = compose_rules(rt, lvl)
    assert rules["pack"] == rt and rules["flags"] == FLAGS[rt]
    if PACKS[rt].overlays:
        assert PACKS[rt].overlays[band_for(lvl)] in rules["talker"]
    assert rules["part_nouns"] == NOUNS[rt]


@pytest.mark.parametrize("rt,lvl", CASES)
def test_pack_text_never_says_banned_words(rt, lvl):
    pack = PACKS[rt]
    for pattern in pack.banned_spoken:
        for sentence in own_text(pack):
            assert not re.search(pattern, sentence, re.I), (pattern, sentence)


@pytest.mark.parametrize("rt,lvl", CASES)
def test_titles_not_empty(rt, lvl):
    assert all(t.strip() for t in PACKS[rt].titles[band_for(lvl)])


@pytest.mark.parametrize("rt", ("behavioural", "hiring-manager"))
def test_conversation_lines_pools(rt):
    lines = PACKS[rt].lines
    for key in ("bridge:first", "problem", "candidate_intro"):
        assert len(lines[key]) >= 3, key
        assert not any(re.search(r"\b(cod(e|ing)|problem)\b", v, re.I) for v in lines[key]), key
    assert not {"put_up:first", "intro:first", "swap_put_up"} & set(lines)
    assert "coding" not in PACKS[rt].link_examples and "problem" not in PACKS[rt].link_examples


def test_item_rules_only_for_culture_slot_packs():
    for rt in ("dsa", "lld", "system-design"):
        assert "Never ask a hypothetical" in compose_rules(rt, "sde1")["item_rules"]["behavioural"]["talker"]
        assert compose_rules(rt, "sde1")["item_rules"]["behavioural"]["director"]
    for rt in ("behavioural", "hiring-manager", "online-assessment"):
        assert compose_rules(rt, "sde1")["item_rules"] == {}
    assert "Never ask a hypothetical" in compose_rules("behavioural", "sde1")["talker"]


def test_online_assessment_is_a_quiet_proctor():
    pack = PACKS["online-assessment"]
    own = " ".join(l for lines in pack.talker.values() for l in lines)
    assert not re.search(r"complexity|follow[- ]?up|trac(e|ing)|deep dive|walk me through", own, re.I)
    assert "<silent> is the default reply" in compose_rules("online-assessment", "fresher")["talker"]
    assert pack.trait_forced == {"verbosity": "terse", "hints": "sparing", "probing": "light"}


def test_hiring_manager_is_its_own_pack():
    assert pack_for("hiring-manager").pack_id == "hiring-manager"
    assert pack_for("behavioural").pack_id == "behavioural"
    assert pack_for("online-assessment").pack_id == "online-assessment"
    overrides = PACKS["hiring-manager"].policy_overrides
    assert overrides["ask_about_compensation"][0] == "decline" and overrides["change_language"] is None
    assert "ask_about_compensation" not in PACKS["behavioural"].policy_overrides
    assert PACKS["hiring-manager"].titles["early"] == ("Engineering Manager", "Hiring Manager, Engineering")


def test_signals_of_conversation_and_assessment_rounds():
    assert global_signals("hiring-manager") == global_signals("behavioural")
    assert [s["signal"] for s in global_signals("behavioural")][:4] == ["structure", "ownership", "impact", "self_awareness"]
    assert global_signals("online-assessment") == global_signals("dsa")


@pytest.mark.parametrize("rt", ("system-design", "lld"))
def test_lines_pools(rt):
    lines = PACKS[rt].lines
    for key in LINE_KEYS:
        assert len(lines[key]) >= 3, key
        assert not any(re.search(r"\bcod(e|ing)\b", v, re.I) for v in lines[key]), key
    for key in ("put_up:first", "intro:first"):
        assert all("{" not in v or "{o}" in v for v in lines[key])


def test_signals_unchanged():
    assert [s["signal"] for s in global_signals("system-design")] == ["requirements", "design", "trade_offs", "scale_and_failure",
                                                                      "communication", "receptiveness", "composure"]
    assert [s["signal"] for s in global_signals("lld")] == ["modelling", "design_quality", "extensibility", "code", "communication",
                                                            "receptiveness", "composure"]


def test_design_talker_has_no_dsa_rules():
    talker = compose_rules("system-design", "sde1")["talker"]
    for dsa_line in ("Tell them to go ahead and write the code once at most.", "at most one hint step for every two attempts",
                     "When you give a coding problem, call show_problem"):
        assert dsa_line not in talker


def test_gate_second_is_true_only_for_dsa_and_the_stored_block_carries_it():
    assert compose_rules("dsa", "sde1")["flags"]["gate_second"] is True
    for rt in FLAGS:
        assert compose_rules(rt, "sde1")["flags"]["gate_second"] is False


def test_a_legacy_non_dsa_blueprint_reads_its_canonical_level_not_the_display_label():
    from app.rounds.compose import rules_of
    bp = {"round": {"type": "behavioural", "level": "SDE II", "level_canonical": "intern"}}
    assert rules_of(bp)["band"] == "early"
    assert rules_of({"round": {"type": "behavioural", "level": "SDE II"}})["band"] == "mid"
