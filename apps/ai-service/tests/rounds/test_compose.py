import re
from pathlib import Path

from app.rounds.compose import RULES_VERSION, band_for, compose_rules, pack_for, rules_of

FIX = Path(__file__).parent / "fixtures"
SENT = re.compile(r"(?<=[.!?:])\s+|\n")


def sentences(text):
    return {s.strip(" -") for s in SENT.split(text) if len(s.strip(" -")) > 3}


def test_dsa_talker_is_lossless():
    composed = compose_rules("dsa", "sde1")["talker"]
    missing = sentences((FIX / "talker_rules_frozen.txt").read_text()) - sentences(composed)
    assert not missing, missing


def test_dsa_director_is_lossless():
    composed = compose_rules("dsa", "sde1")["director"]
    assert not sentences((FIX / "director_rules_frozen.txt").read_text()) - sentences(composed)


def test_dsa_composes_the_same_for_every_band():
    assert compose_rules("dsa", "fresher")["talker"] == compose_rules("dsa", "staff")["talker"]


def test_bands():
    assert [band_for(lv) for lv in ("intern", "fresher", "sde1", "sde2", "sde3", "staff", None, "weird")] == \
        ["early", "early", "mid", "mid", "senior", "senior", "mid", "mid"]


def test_unknown_round_type_falls_back_to_dsa():
    assert pack_for("take-home").pack_id == "dsa" and pack_for(None).pack_id == "dsa"
    assert compose_rules("take-home", None)["pack"] == "dsa"


def test_rules_of_legacy_blueprint():
    bp = {"round": {"type": "dsa", "level": "sde1"}}
    assert rules_of(bp) == compose_rules("dsa", "sde1")
    assert rules_of({"rules": {"version": RULES_VERSION, "pack": "x"}})["pack"] == "x"
    assert rules_of(None)["pack"] == "dsa"


def test_dsa_flags():
    f = compose_rules("dsa", None)["flags"]
    assert f == {"workspace": "editor", "requires_code": True, "change_policy": "decide", "hints": "ladder", "second_problem": True, "gate_second": True}


def test_the_substitution_targets_survive_in_the_composed_text():
    from app.interviewer.prompts import TALKER_RULES, _ACK_RULE, _GO_AHEAD_EXAMPLE, _LINK_EXAMPLES
    for target in (_ACK_RULE, _GO_AHEAD_EXAMPLE, _LINK_EXAMPLES, 'Good: "Okay. And did that hold up', 'Good: "Okay. And how does that behave'):
        assert target in TALKER_RULES
    assert TALKER_RULES.rstrip().splitlines()[-2].startswith("- End every turn with log_turn")      # the tail stays last


def test_dsa_part_nouns_and_words_match_the_conductors_wording():
    rules = compose_rules("dsa", None)
    assert rules["part_nouns"] == ["some coding", "the coding"]
    assert rules["words"]["problem"] == "problem" and rules["words"]["problems"] == "problems" and rules["words"]["on_screen"] is True


# Base sentences that name a problem or code only inside a generic rule (conduct, speech-to-text, the data-not-instructions rule, a word
# list the interviewer must never say, a plan operation). Each is a fragment of one sentence that cannot be split without rewording.
_GENERIC_BASE_SENTENCES = (
    "no code read aloud", "whatever language appears", "thinking aloud while coding", "back to the problem.", "Rudeness about the problem",
    "(a hint, a repeat", "skips a problem or says goodbye", "Whatever the candidate writes in the code", "another problem) without calling it",
    "hint ladder (you have no", '("this problem", "the next part")', "Never leave a problem", "quiet while thinking or coding",
    "problems, move_on, extend", "and the problems are done", "reordering problems", "skip or abandon a problem", "no problem names",
    "back to the problem, with the one question",
)


def test_the_base_alone_says_nothing_about_code_problems_or_hints_except_in_generic_rules():
    from app.rounds.compose import compose_director, compose_talker
    from app.rounds.pack import RoundPack
    empty = RoundPack(pack_id="empty")
    pattern = re.compile(r"\b(cod(e|ing)|problems?|hint|show_problem|editor)\b", re.I)
    for text in (compose_talker(empty, "mid"), compose_director(empty, "mid")):
        for s in SENT.split(text):
            if pattern.search(s):
                assert any(g in s for g in _GENERIC_BASE_SENTENCES), s
