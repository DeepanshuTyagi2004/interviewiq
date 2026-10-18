"""The fixed lines as pools (decided 2026-10-18): no repeat inside a round, every wording recognised by its matchers, the persona's own habits in
the talker's prefix, the fillers drawn at random, and the opener guard (`repeated_opener`) in the talker and in the trace check."""
import asyncio
import random
import re
from types import SimpleNamespace

from app.interviewer.closing import is_farewell, problem_line_part, puts_up_problem_again, says_duration
from app.interviewer.conductor import Conductor, is_violation_line
from app.interviewer.fillers import RECOVERY_SHORT, STAGES, Fillers
from app.interviewer.guard import NEUTRAL_LINE, LeakGuard
from app.interviewer.lines import (LINES, SAFETY_KEYS, SCREEN_WARNING_KEYS, LinePicker, contains, habits_of, keys_of, matches, ordinal_of,
                                   picker_for, put_up_ordinals, sentence_part)
from app.interviewer.plan import problem_intro, problem_put_up, problem_swap_put_up, wire_ids
from app.interviewer.prompts import TALKER_RULES, how_you_talk, item_details, talker_prefix, talker_rules
from app.interviewer.said import SaidTracker
from app.interviewer.talker import TalkerTurn, opener_repeated, turn_opener
from app.interviewer.tools import ToolExecutor
from app.interviewer.tracecheck import repeated_opener as trace_repeated_opener
from tests.interviewer.fakes import FakeChat, FakeWorkspace, say
from tests.interviewer.fixtures import Clock, blueprint

HABITS = {"acks": ["Right.", "Sure.", "Got it.", "Fair enough.", "Okay."], "backchannels": ["Mm-hmm.", "Yeah.", "Right."],
          "fillers": {f"stage{i}": list(s[:4]) for i, s in enumerate(STAGES)}}
WARNING_AND_ENDING_GROUPS = ("violation", "final_warning", "away_overstay", "proctor_end", "conduct_warning", "abuse_end", "conduct_end")


def _group(key: str) -> str:
    return key.split(":")[0]


# ------------------------------------------------------------------ the pools

def test_every_pool_has_the_right_number_of_wordings_and_no_duplicates():
    for key, pool in LINES.items():
        assert len(set(pool)) == len(pool), key
        if _group(key) in WARNING_AND_ENDING_GROUPS:
            assert 2 <= len(pool) <= 3, key                         # warnings and endings: few, and the same firmness
        else:
            assert 3 <= len(pool) <= 6, key


def test_pick_never_repeats_a_wording_until_the_pool_is_used_up():
    for key, pool in LINES.items():
        picker = LinePicker(random.Random(7))
        first_cycle = [picker.pick(key) for _ in pool]
        assert sorted(first_cycle) == sorted(pool), key               # every wording once, none twice
        more = [picker.pick(key) for _ in range(3 * len(pool))]
        assert more[0] != first_cycle[-1] and set(more) <= set(pool), key               # a new cycle never starts with the one just said
        assert all(a != b for a, b in zip([first_cycle[-1], *more], more)), key         # and no wording is ever said twice in a row


def test_the_picker_state_is_what_a_restored_round_starts_from():
    picker = LinePicker(random.Random(1))
    said = [picker.pick("coding_over") for _ in range(3)]
    restored = LinePicker(random.Random(2), picker.state())
    more = [restored.pick("coding_over") for _ in range(len(LINES["coding_over"]) - 3)]
    assert set(said).isdisjoint(more) and len(set(said + more)) == len(LINES["coding_over"])


def test_the_picker_is_seeded_from_the_realism_seed_or_the_session_id_so_a_rehearsal_replays():
    a = {"session_id": "s-1", "realism": {"seed": 5}}
    b = {"session_id": "s-1", "realism": {"seed": 5}}
    c = {"session_id": "s-2"}
    seq = lambda bp: [picker_for(bp).pick(k) for k in ("coding_over", "give_up", "yield", "neutral")]     # noqa: E731
    assert seq(a) == seq(b) and seq(c) == seq({"session_id": "s-2"})
    assert any(seq({"session_id": f"s-{n}"}) != seq(c) for n in range(10))                  # other sessions draw other wordings


def test_a_wording_of_a_pool_matches_its_key_and_no_key_of_another_meaning():
    shared = {frozenset({"presence", "line_check"})}               # "Yes, I'm here." answers both checks
    for key, pool in LINES.items():
        for variant in pool:
            assert matches(key, variant), (key, variant)
            assert matches(_group(key), variant), (key, variant)
            for other in LINES:
                if _group(other) == _group(key) or frozenset({other, key}) in shared:
                    continue
                assert not matches(other, variant), (key, other, variant)


def test_a_wording_still_matches_with_curly_apostrophes_the_interrupted_suffix_and_odd_punctuation():
    assert matches("presence", "Yes, I’m here. (interrupted)") and matches("unclear", "sorry i didn't quite catch that")
    assert not matches("unclear", "Sorry, I didn't catch your name, could you tell me again?")


def test_the_first_wording_of_every_pool_is_todays_line():
    assert LINES["neutral"][0] == NEUTRAL_LINE
    assert problem_put_up(1) == "Let me put the first problem on your screen." and problem_swap_put_up() == "Sure, no problem. Let me put a different problem on your screen."
    assert problem_intro(2) == "Here's your second question. Give it a read, and let me know if you have any questions."
    assert LINES["give_up"][0] == "Okay, since you'd like a change, let's leave this one there." and LINES["coding_over"][0] == "Okay, that's fine."
    assert LINES["unclear"][0] == "Sorry, I didn't quite catch that." and LINES["presence"][0] == LINES["line_check"][0] == "Yes, I'm here."
    assert LINES["yield"][0] == "Sorry, go ahead." and LINES["go_ahead"][0] == "Sure, go ahead." and LINES["backchannel"][0] == "Mm-hmm."


def test_no_wording_gives_a_length_of_time_or_asks_a_question_that_a_following_sentence_would_double():
    for key, pool in LINES.items():
        for variant in pool:
            assert not says_duration(variant), (key, variant)
            if _group(key) in WARNING_AND_ENDING_GROUPS or key in ("unclear", "coding_over", "give_up", "yield"):
                assert "?" not in variant, (key, variant)


def test_a_warning_never_gets_softer_in_any_wording():
    for key, pool in LINES.items():
        if _group(key) == "final_warning" or key == "away_overstay:final_warning":
            assert all("final warning" in v.lower() and "end the interview" in v for v in pool), key
        if _group(key) == "away_overstay" or _group(key) == "violation":
            assert all(("stay on this screen" in v or "use only this screen" in v or "share your entire screen" in v or "come back" in v) for v in pool), key
        if key in ("conduct_warning",):
            assert all("must not happen again" in v for v in pool)
        if key in ("proctor_end", "abuse_end", "conduct_end"):
            assert all(re.search(r"\b(?:end|ending) the interview here\b", v) and v.endswith("Thank you for your time.") and is_farewell(v) for v in pool), key


def test_is_violation_line_knows_every_screen_warning_wording_and_no_ending():
    for group in SCREEN_WARNING_KEYS:
        for key in keys_of(group):
            assert all(is_violation_line(v) for v in LINES[key]), key
    assert not any(is_violation_line(v) for k in ("proctor_end", "abuse_end", "conduct_warning") for v in LINES[k])


def test_the_problem_line_matchers_know_every_put_up_intro_and_swap_wording():
    for number, o in enumerate(("first", "second", "third", "fourth"), start=1):
        for v in LINES[f"put_up:{o}"]:
            assert problem_line_part(v) == "put_up" and ordinal_of(v) == o and put_up_ordinals(v) == [o] and puts_up_problem_again(v, number), v
            assert not puts_up_problem_again(v, number % 4 + 1), v
        for v in LINES[f"intro:{o}"]:
            first, second = v.split(". ", 1)
            assert problem_line_part(first + ".") == "intro" and problem_line_part(second) == "intro_end" and ordinal_of(first + ".") == o, v
    for v in LINES["swap_put_up"]:
        parts = v.split(". ")
        assert problem_line_part(parts[0] + ".") is None and problem_line_part(parts[-1]) == "put_up", v      # only the put-up sentence is the problem line
        assert sentence_part("swap_put_up", parts[-1]) == 1 and puts_up_problem_again(v, 2) and ordinal_of(parts[-1]) is None


def test_the_orders_say_a_wording_of_the_pool_and_the_order_line_is_the_one_in_its_text():
    bp = blueprint()
    c = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    c.start()
    c.next_item("t")
    c.next_item("t")                                                  # core-1
    c.on_proctor("tab_hidden", 1, 1)
    assert any(o.kind == "mention_violation" and matches("violation:tab_hidden", o.line) for o in c.orders)
    line = c.add_problem_line(1)
    assert matches("intro:first", line.line) and f'"{line.line}"' in line.text


def test_the_conductor_checkpoint_keeps_the_picker_state_and_a_restored_round_does_not_repeat_a_wording():
    bp = blueprint()
    c = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    c.start()
    used = [c.lines.pick("conduct_warning") for _ in range(2)]
    data = c.checkpoint()
    assert data["lines"]["conduct_warning"] == used
    restored = Conductor.restore(bp, 3600, data, None, Clock(), ["Java"])
    assert restored.lines.state() == data["lines"] and restored.lines.pick("conduct_warning") not in used
    data.pop("lines")
    assert Conductor.restore(bp, 3600, data, None, Clock(), ["Java"]).lines.state() == {}        # a checkpoint from before the pools


# ------------------------------------------------------------------ fillers, neutral lines, backchannels

def test_a_filler_is_never_one_of_the_last_two_of_its_stage_and_the_persona_vocabulary_is_used_when_there_is_one():
    f = Fillers(random.Random(3))
    for stage in range(len(STAGES)):
        said = [f.line(stage) for _ in range(40)]
        assert all(s in STAGES[stage] for s in said)
        assert all(said[n] != said[n - 1] and said[n] != said[n - 2] for n in range(2, len(said)))
    own = Fillers(random.Random(3), HABITS)
    assert all(own.line(0) in HABITS["fillers"]["stage0"] for _ in range(20))
    assert all(own.recovery(1) in HABITS["acks"] for _ in range(10)) and all(Fillers(random.Random(1)).recovery(1) in RECOVERY_SHORT for _ in range(5))


def test_a_habit_stage_with_too_few_wordings_falls_back_to_the_defaults():
    thin = {"acks": HABITS["acks"], "fillers": {"stage0": ["One moment."]}}
    assert Fillers(random.Random(1), thin).line(0) in STAGES[0]


def test_the_neutral_and_go_ahead_fallbacks_are_drawn_from_the_round_s_picker_when_it_has_one():
    said = SaidTracker()
    plain = [said.neutral() for _ in range(len(LINES["neutral"]) + 1)]              # no picker: the rotation as before
    assert plain[0] == NEUTRAL_LINE == plain[-1]
    said.lines = LinePicker(random.Random(4))
    drawn = [said.neutral() for _ in range(len(LINES["neutral"]))]
    assert sorted(drawn) == sorted(LINES["neutral"])
    assert matches("go_ahead", said.neutral("Let me trace it on an empty input."))


def test_backchannels_come_from_the_persona_s_habits_and_default_to_the_pool():
    bp = {"session_id": "x", "realism": {"seed": 3, "traits": {}, "habits": HABITS}}
    assert habits_of(bp) is not None and habits_of({}) is None
    mine = picker_for(bp)
    assert {mine.pick("backchannel") for _ in range(3)} == set(HABITS["backchannels"])
    assert {picker_for({"session_id": "x"}).pick("backchannel") for _ in range(1)} <= set(LINES["backchannel"])


# ------------------------------------------------------------------ the talker's prefix

def _realism_blueprint():
    bp = blueprint()
    bp["realism"] = {"seed": 9, "traits": {"pace": "brisk", "warmth": "friendly", "formality": "casual"}, "habits": HABITS}
    return bp


def test_the_prefix_carries_the_persona_s_habits_when_realism_exists_and_todays_text_when_it_does_not():
    ctx = {"round": {"role": "SDE", "company_name": "Acme"}, "first_name": "Asha"}
    with_habits = talker_prefix(_realism_blueprint(), ctx)
    assert "How you talk" in with_habits and "pace brisk, warmth friendly, formality casual" in with_habits
    assert '"Fair enough."' in with_habits and "Your short nods" in with_habits and '"Mm-hmm.", "Yeah.", "Right."' in with_habits
    assert '("Okay.", "Mm, okay.", "Got it.", "Alright.", "Sure.")' not in with_habits            # the one list everyone copied is the persona's own now
    assert "Alright, let's get into the coding now." not in with_habits.split("Fixed rules")[0]   # the links name the intent, not one sentence
    old = talker_prefix(blueprint(), ctx)
    assert "How you talk" not in old and TALKER_RULES in old and talker_rules(blueprint()) == TALKER_RULES and how_you_talk(blueprint()) == ""
    assert "say only the put-up line you are given" in TALKER_RULES and "Let me put the first problem on your screen" not in TALKER_RULES


# ------------------------------------------------------------------ openers

def test_an_opener_is_a_bare_acknowledgement_or_the_one_to_three_words_before_the_first_comma():
    assert turn_opener("Mm, okay.") == "mm okay" and turn_opener("Okay.") == "okay" and turn_opener("Mm-hmm.") == "mm hmm"
    assert turn_opener("Right, so tell me about the cache.") == "right" and turn_opener("Okay, that makes sense. And then?") == "okay"
    assert turn_opener("What was the hardest part of the migration?") is None and turn_opener("Why?") is None
    assert turn_opener("So when the list is empty, what do you return?") is None             # a longer first clause is the sentence, not a lead-in
    assert turn_opener("") is None


def test_an_opener_is_repeated_when_it_was_the_last_turn_s_or_already_used_twice_in_five():
    assert opener_repeated("okay", ["right", "okay"]) and not opener_repeated("okay", ["okay", "right"])
    assert opener_repeated("okay", ["okay", "right", "okay", "got it"]) and not opener_repeated("okay", ["okay", "right", "sure", "got it"])
    assert not opener_repeated("okay", ["okay", "a", "b", "c", "d", "e"]) and not opener_repeated("okay", [])


def _talker(*replies, habit_acks=()):
    bp = blueprint()
    conductor = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    conductor.start()
    conductor.next_item("done")
    conductor.next_item("done")
    run = SimpleNamespace(conductor=conductor, guard=LeakGuard(bp), actions={}, code_seen=None, candidate_said={}, wire=wire_ids(bp),
                          d=SimpleNamespace(blueprint=bp, workspace=FakeWorkspace()))
    turn = TalkerTurn(FakeChat(list(replies), model="primary"), run.guard, ToolExecutor(run), first_token_timeout_s=0.2)
    run.talker = turn
    turn.habit_acks = tuple(habit_acks)
    return turn


def _speak(turn, n):
    async def go():
        return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id=str(n), current_slot="core-1", candidate_said="")]
    return asyncio.run(go())


def test_the_talker_replaces_an_opener_used_in_the_previous_turn_with_one_of_the_persona_s_acknowledgements():
    turn = _talker(say("Mm, okay.", "Tell me more about the renewal rule."), say("Mm, okay.", "How did you spot that one?"), habit_acks=HABITS["acks"])
    first, second = _speak(turn, 1), _speak(turn, 2)
    assert first == ["Mm, okay.", "Tell me more about the renewal rule."]
    assert second[0] in HABITS["acks"] and second[1] == "How did you spot that one?" and turn.last.repaired[0][0] == "Mm, okay."


def test_a_repeated_opener_with_more_after_it_loses_its_lead_in_when_no_acknowledgement_fits():
    turn = _talker(say("Right, so how does the cache refill?"), say("Right, so what happens on a miss?"))
    _speak(turn, 1)
    assert _speak(turn, 2) == ["So what happens on a miss?"]


def test_a_third_use_of_an_opener_in_five_turns_is_repaired_and_a_fresh_one_passes_untouched():
    turn = _talker(say("Okay, tell me about the schema."), say("Right, what did the index cover?"), say("Okay, how did the migration go?"),
                   say("Okay, what broke first?"), say("Sure, what did you change after that?"), habit_acks=())
    spoken = [_speak(turn, n) for n in range(1, 6)]
    assert spoken[0] == ["Okay, tell me about the schema."] and spoken[1] == ["Right, what did the index cover?"]
    assert spoken[2] == ["Okay, how did the migration go?"]                      # twice in the last three turns is allowed ...
    assert spoken[3] == ["What broke first?"]                                    # ... the third is not
    assert spoken[4] == ["Sure, what did you change after that?"]               # a fresh opener passes untouched


def test_a_lone_repeated_acknowledgement_with_no_fresh_wording_left_is_blocked_with_the_rule_named():
    turn = _talker(say("Okay.", "Why did you pick that?"), say("Okay."), habit_acks=("Okay.",))
    _speak(turn, 1)
    _speak(turn, 2)
    assert [b["rule"] for b in turn.last.blocked] == ["repeated_opener"]


def test_the_safety_lines_are_exempt_from_the_opener_guard_and_a_new_turn_id_is_a_new_turn():
    turn = _talker(say("That isn't appropriate in an interview, and it must not happen again."),
                   say("That isn't appropriate in an interview, and it must not happen again."))
    assert _speak(turn, 1) and _speak(turn, 2) and not turn.last.repaired
    again = _talker(say("Okay, tell me more."), say("Okay, tell me more about the cache."))
    assert _speak(again, 1) == ["Okay, tell me more."] and _speak(again, 2) == ["Tell me more about the cache."]


def test_the_openers_of_a_restored_interview_come_from_its_stored_turns():
    turn = _talker(say("Okay, how did the migration go?"))
    turn.seed_openers(["Okay, tell me about the schema.", "Some other turn here."])
    assert _speak(turn, 3) == ["Okay, how did the migration go?"]        # the last stored turn had another opener: allowed
    seeded = _talker(say("Okay, how did the migration go?"))
    seeded.seed_openers(["Right, go on.", "Okay, tell me about the schema."])
    assert _speak(seeded, 3) == ["How did the migration go?"]


def test_an_unclear_reply_is_drawn_from_the_pool_and_every_wording_passes_the_remaining_rules():
    for wording in LINES["unclear"]:
        turn = _talker(say("The audio seems to keep dropping on your side — which project was it?"))
        turn.said.lines = SimpleNamespace(pick=lambda key, w=wording: w, rng=random.Random(1))
        assert _speak(turn, 1) == [wording + " Which project was it?"], wording
    assert all(contains("unclear", v + " Which project was it?") for v in LINES["unclear"]) and not contains("unclear", "Which project was it?")


# ------------------------------------------------------------------ the trace check

def _record(*texts):
    return {"turns": [{"speaker": "interviewer", "seq": n, "text": t} for n, t in enumerate(texts, start=1)]}


def test_the_trace_check_flags_a_turn_that_opens_like_the_one_before_or_for_the_third_time_in_five():
    found = trace_repeated_opener(_record("Mm, okay. Tell me more.", "Mm, okay. And then?", "Right, what next?"))
    assert [f["seq"] for f in found] == [2] and found[0]["check"] == "repeated_opener"
    found = trace_repeated_opener(_record("Okay, one.", "Right, two.", "Okay, three.", "Sure, four.", "Okay, five."))
    assert [f["seq"] for f in found] == [5]
    assert trace_repeated_opener(_record("Okay, one.", "Right, two.", "Sure, three.", "Got it, four.", "Okay, five.")) == []


def test_the_trace_check_exempts_the_warnings_and_the_endings_and_counts_a_turn_with_no_opener():
    warning = LINES["conduct_warning"][0]
    assert trace_repeated_opener(_record(warning, warning)) == []
    assert trace_repeated_opener(_record("Okay, one.", "What was the hardest part of it?", "Okay, three.")) == []
    assert [f["seq"] for f in trace_repeated_opener(_record("Okay, one.", "Okay, two."))] == [2]


# ------------------------------------------------------------------ the other trace checks keep working on every wording

def test_the_trace_checks_that_keyed_on_exact_words_fire_on_every_wording():
    from tests.interviewer.test_tracecheck import cand, found, iv, record

    shown = [{"name": "show_problem", "arguments": {}, "result": {"ok": True}}]
    for a, b in zip(LINES["put_up:second"], LINES["put_up:second"][1:] + LINES["put_up:second"][:1]):          # two different wordings, one problem
        assert ("problem_line_twice", 3) in found(record(iv(1, a), cand(2), iv(3, b))), (a, b)
    for intro in LINES["intro:second"]:
        assert ("problem_line_twice", 3) in found(record(iv(1, intro), cand(2), iv(3, LINES["put_up:second"][2] + " " + intro))), intro
    for swap in LINES["swap_put_up"]:
        assert "problem_line_twice" not in [c for c, _ in found(record(iv(1, swap), cand(2), iv(3, swap)))], swap      # a swap names no position
    for first in LINES["give_up"]:
        gave = lambda seq, line: iv(seq, line, orders=[{"kind": "move_on", "line": line}], tool_calls=shown)         # noqa: E731
        two = record(cand(1), gave(2, first + " " + LINES["put_up:second"][0]), cand(3), gave(4, LINES["swap_put_up"][1]))
        assert ("changes_over_cap", 4) in found(two), first
    for v in (*LINES["violation:tab_hidden"], *LINES["final_warning:tab_hidden"], *LINES["conduct_warning"]):
        assert ("warning_glued", 2) in found(record(iv(1, "Okay."), iv(2, v + " Where would you begin?"))), v
    for v in (*LINES["proctor_end"], *LINES["abuse_end"], *LINES["final_warning:window_blur"], *LINES["away_overstay:final_warning"]):
        assert "warning_glued" not in [c for c, _ in found(record(iv(1, "Okay, go on."), iv(2, v)))], v


def test_the_line_check_reply_check_accepts_every_presence_and_line_check_wording():
    from app.interviewer.tracecheck import _line_check_answered
    from tests.interviewer.test_tracecheck import cand, iv, record

    for v in (*LINES["presence"], *LINES["line_check"]):
        rec = record(cand(1, "Can you hear me?"), iv(2, v + " Where were we?"), items=[{"item_id": "core-1", "kind": "slot", "phase": "core"}])
        assert _line_check_answered(rec, "line_check_answered")["ok"], (v, _line_check_answered(rec, "line_check_answered"))


def test_a_stored_round_with_todays_wordings_is_still_read_the_same_way():
    from tests.interviewer.test_tracecheck import cand, found, iv, record

    line = "Here's your first question. Give it a read, and let me know if you have any questions."
    old = record(iv(1, line), cand(2), iv(3, line))
    assert ("problem_line_twice", 3) in found(old) and ("repeated_opener", 3) not in found(old)


# ------------------------------------------------------------------ review fixes (2026-10-18)

VERDICT_HABITS = {"acks": ["Right.", "Nice.", "Sure.", "Okay.", "Got it.", "Fair enough.", "Makes sense.", "Alright."], "backchannels": ["Mm-hmm.", "Yeah."],
                  "fillers": {}}


def test_a_repaired_opener_never_becomes_a_verdict_or_an_acknowledgement_that_judges_when_the_original_did_not():
    from app.interviewer.talker import ACKNOWLEDGES, DEFAULT_ACKS, opens_with_verdict

    for acks in (VERDICT_HABITS["acks"], ()):                      # the persona's own, and the default list
        for original in ("Got it.", "Okay.", "Mm, okay.", "Right."):
            for n in range(60):
                turn = _talker(habit_acks=acks)
                turn.said.lines = LinePicker(random.Random(n))
                turn._turn_id = "9"
                turn._openers = [("1", turn_opener(original))]
                fixed = turn._fresh_opener(original)
                if fixed is None:
                    continue
                assert ACKNOWLEDGES(fixed) == ACKNOWLEDGES(original) and opens_with_verdict(fixed) == opens_with_verdict(original), (original, fixed)
    assert all(not opens_with_verdict(a) for a in ("Okay.", "Sure.", "Alright.")) and any(opens_with_verdict(a) for a in DEFAULT_ACKS)     # the lists do hold verdicts


def test_the_prompt_never_offers_a_verdict_as_a_neutral_acknowledgement_or_a_good_example():
    bp = blueprint()
    bp["realism"] = {"seed": 4, "traits": {"pace": "even"}, "habits": VERDICT_HABITS}
    rules = talker_rules(bp)
    neutral_list = rules.split("(yours: ", 1)[1].split(")", 1)[0]
    assert '"Right."' not in neutral_list and '"Nice."' not in neutral_list and '"Sure."' in neutral_list
    assert 'Good: "Right.' not in rules and 'Good: "Nice.' not in rules
    mine = how_you_talk(bp)
    assert '"Right.", "Nice." also sound like you' in mine and 'acknowledgements: "Sure.", "Okay."' in mine


def test_no_two_wordings_of_a_pool_share_an_opener_and_the_picker_skips_the_one_the_last_turn_opened_with():
    for key in ("line_check", "presence", "unclear", "yield", "go_ahead", "coding_over", "give_up", "swap_put_up"):
        openers = [o for o in (turn_opener(v) for v in LINES[key]) if o]
        assert len(openers) == len(set(openers)), (key, openers)
    for n in range(30):
        picker = LinePicker(random.Random(n))
        picker.opener_of, picker.avoid = turn_opener, lambda: {"sorry"}
        assert picker.pick("yield") != "Sorry, go ahead." and picker.pick("unclear") != "Sorry, I didn't quite catch that."
    everything = LinePicker(random.Random(1))
    everything.opener_of, everything.avoid = turn_opener, lambda: {turn_opener(v) for v in LINES["presence"] if turn_opener(v)}
    assert matches("presence", everything.pick("presence"))              # nothing else left: it still says something


def test_the_run_keeps_a_fixed_line_from_opening_the_way_the_last_turn_did():
    from tests.interviewer.test_run import make

    async def go():
        run, deps, _ = make([])
        await run.start(None)
        run.history.append({"role": "assistant", "content": "Sorry, go ahead."})
        return run, run._previous_openers(), [run.conductor.lines.pick("yield") for _ in range(8)]

    run, avoid, picks = asyncio.run(go())
    assert avoid == {"sorry"} and "Sorry, go ahead." not in picks[:3] and all(matches("yield", p) for p in picks)


def test_the_trace_check_exempts_only_the_lines_the_run_said_and_the_warnings_and_flags_the_models_own_words():
    def run_said(*texts):
        return {"turns": [{"speaker": "interviewer", "seq": n, "text": t, "fixed": [t]} for n, t in enumerate(texts, start=1)]}

    sorry = [LINES["unclear"][0], LINES["yield"][0], LINES["unclear"][0]]
    assert trace_repeated_opener(run_said(*sorry)) == []                                  # said by the run: the picker keeps them apart
    assert trace_repeated_opener(run_said(LINES["line_check"][0], LINES["line_check"][0], LINES["presence"][0])) == []
    assert trace_repeated_opener(run_said(LINES["coding_over"][0], LINES["coding_over"][0])) == []
    # the same words said by the model (no `fixed` in the record) are its own openers: flagged
    for words in (LINES["go_ahead"][0], LINES["coding_over"][0], LINES["coding_over"][1]):
        assert [f["seq"] for f in trace_repeated_opener(_record(words, words))] == [2], words
    assert [f["seq"] for f in trace_repeated_opener(_record("Okay, one.", "Okay, two.", LINES["go_ahead"][0], "Sure, four."))] == [2, 4]
    warning = LINES["conduct_warning"][0]
    assert trace_repeated_opener(_record(warning, warning)) == []                         # the warnings and endings keep their words, whoever said them
    for n in range(20):                                                                   # and the pools no longer trip it by themselves
        picker = LinePicker(random.Random(n))
        picker.opener_of = turn_opener
        said = []
        for key in ("presence", "unclear", "yield", "go_ahead"):
            for _ in range(3):
                picker.avoid = (lambda last=said[-1:]: {turn_opener(last[0])} if last and turn_opener(last[0]) else set())     # noqa: B023
                said.append(picker.pick(key))
        assert all(turn_opener(a) is None or turn_opener(a) != turn_opener(b) for a, b in zip(said, said[1:])), said


def test_the_run_records_which_wordings_it_picked_and_said_in_the_turn_record():
    from tests.interviewer.test_run import make, speak

    async def go():
        run, deps, _ = make([])
        await run.start(None)
        run.conductor.on_proctor("tab_hidden", 1, run.d.clock())
        out = await speak(run)
        return deps.store.turns[-1], out

    turn, out = asyncio.run(go())
    assert turn["fixed"] and all(w in turn["text"] for w in turn["fixed"]) and out[0] in turn["fixed"]


def test_the_links_between_parts_are_pools_with_todays_wording_first_and_each_session_gets_its_own_with_realism():
    from app.interviewer.lines import BRIDGE_POOLS, bridge_variant
    from app.interviewer.plan import BRIDGES, STYLE_BRIDGES, bridge_for

    assert all(3 <= len(p) <= 4 for p in BRIDGE_POOLS.values())
    assert all(BRIDGES[k] == p[0] for k, p in BRIDGE_POOLS.items() if ":" not in k)
    assert all(STYLE_BRIDGES[tuple(k.split(":"))] == p[0] for k, p in BRIDGE_POOLS.items() if ":" in k)
    old = blueprint()
    assert bridge_for("problem", "", old) == BRIDGES["problem"] == bridge_for("problem") and bridge_for("nothing") is None
    seen = {}
    for seed in range(1, 25):
        bp = {"session_id": "s", "realism": {"seed": seed, "traits": {}, "habits": HABITS}}
        a, b = bridge_for("problem", "", bp), bridge_for("problem", "", bp)
        assert a == b and a in BRIDGE_POOLS["problem"]                             # stable for the session, never consumed
        seen[seed] = a
    assert len(set(seen.values())) >= 3                                            # other sessions get other wordings
    differing = next((x, y) for x in seen for y in seen if seen[x] != seen[y])
    texts = []
    for seed in differing:
        bp = _realism_blueprint()
        bp["realism"]["seed"] = seed
        texts.append(item_details(bp, {"item_id": "framing", "kind": "phase", "phase": "framing", "style": "one_line"}))
    assert texts[0] != texts[1]


def test_every_link_wording_behaves_like_todays_under_the_matchers_that_read_a_turn():
    from app.interviewer.closing import announces_coding_now, announces_problem, gives_outline, is_farewell, leaves_the_part
    from app.interviewer.lines import BRIDGE_POOLS
    from app.interviewer.talker import announces_a_move, move_kinds

    fs = (announces_coding_now, announces_problem, gives_outline, is_farewell, leaves_the_part, announces_a_move, lambda t: sorted(move_kinds(t)))
    for key, pool in BRIDGE_POOLS.items():
        base = [f(pool[0]) for f in fs]
        for v in pool[1:]:
            assert [f(v) for f in fs] == base, (key, v)


def test_orders_and_hints_give_the_session_s_link_not_one_sentence_everyone_copies():
    from app.interviewer.lines import BRIDGE_POOLS
    from tests.interviewer.test_run import make

    seen = set()
    for seed in range(1, 20):
        bp = blueprint()
        bp["realism"] = {"seed": seed, "traits": {}, "habits": HABITS}
        c = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
        c.start()
        c.next_item("t")
        c.next_item("t")
        text = [o for o in c.pending_orders() if o.kind == "open_item"][-1].text
        mine = next(v for v in BRIDGE_POOLS["problem"] if f'"{v}"' in text)
        seen.add(mine)
    assert len(seen) >= 2

    async def hint():
        run, deps, _ = make([])
        run.d.blueprint["realism"] = {"seed": 3, "traits": {}, "habits": HABITS}
        await run.start(None)
        before = run.conductor.lines.state()
        first = run._problem_hint(1)
        run._problem_hint(1)
        return before, run.conductor.lines.state(), first, run.conductor.lines.peek("intro:first")

    before, after, first, peeked = asyncio.run(hint())
    assert before == after and peeked in first                                    # building the hint eats nothing and shows the wording the run would say
    assert bridge_variant_for_run(first)


def bridge_variant_for_run(hint: str) -> bool:
    from app.interviewer.lines import BRIDGE_POOLS
    return any(f'"{v}"' in hint for v in BRIDGE_POOLS["problem"])


def test_with_realism_no_rule_hands_out_sure_go_ahead_as_the_one_example_and_without_it_the_text_is_today_s():
    assert 'answer the offer ("Sure, go ahead.")' in TALKER_RULES and 'answer the offer ("Sure, go ahead.")' in talker_rules(blueprint())
    mine = talker_rules(_realism_blueprint())
    assert 'answer the offer ("Sure, go ahead.")' not in mine and "answer the offer in a few words of your own" in mine


def test_every_put_up_intro_and_swap_wording_behaves_like_todays_under_the_move_matchers():
    from app.interviewer.closing import abandons_problem, announces_leaving, announces_problem, claims_problem_on_screen_now, closes_coding_part, leaves_the_part, moves_to_another_problem
    from app.interviewer.talker import announces_a_move, move_kinds

    fs = (moves_to_another_problem, announces_a_move, announces_leaving, leaves_the_part, announces_problem, claims_problem_on_screen_now, closes_coding_part,
          abandons_problem, lambda t: sorted(move_kinds(t)))
    for key in [k for k in LINES if k.split(":")[0] in ("put_up", "intro", "swap_put_up")]:
        base = [f(LINES[key][0]) for f in fs]
        for v in LINES[key][1:]:
            assert [f(v) for f in fs] == base, (key, v)
            for part in re.split(r"(?<=[.?!])\s+", v)[-1:]:
                assert [f(part) for f in fs] == [f(re.split(r"(?<=[.?!])\s+", LINES[key][0])[-1]) for f in fs] or key.startswith("swap"), (key, part)
    assert all(announces_a_move(v) == announces_a_move(LINES["put_up:second"][0]) for v in LINES["put_up:second"]) and announces_a_move(LINES["put_up:second"][0])


def test_only_the_meaning_carrying_sentence_of_a_wording_matches_on_its_own():
    for stray in ("Sure.", "Of course.", "No problem.", "Okay.", "Alright, let me swap it."):
        assert not matches("swap_put_up", stray), stray
    assert matches("swap_put_up", "Let me put a different problem on your screen.") and not matches("proctor_end", "Thank you for your time.")
    assert not matches("abuse_end", "Thank you for your time.") and not contains("abuse_end", "Thank you for your time.")
    assert all(matches("proctor_end", v) and matches("abuse_end", w) for v, w in zip(LINES["proctor_end"], LINES["abuse_end"]))
    assert not matches("give_up", "I hear you.") and matches("give_up", "Let's leave this one there.")
    assert contains("give_up", LINES["give_up"][2] + " " + LINES["put_up:second"][0])


def test_a_peek_shows_the_next_wording_without_using_it_up():
    picker = LinePicker(random.Random(5))
    picker.pick("intro:first")
    state = picker.state()
    seen = picker.peek("intro:first")
    assert picker.state() == state and picker.peek("intro:first") == seen and picker.pick("intro:first") == seen


def test_the_conduct_check_runs_at_its_own_temperature_not_the_talkers():
    from app.interviewer.run import CONDUCT_CHECK_TEMPERATURE
    from tests.interviewer.test_run import make

    class Chat:
        def __init__(self, temperature=0.7):
            self.temperature, self.used = temperature, []

        def with_temperature(self, temperature):
            other = Chat(temperature)
            other.used = self.used
            return other

        async def json(self, messages, name, schema, max_tokens=0):
            self.used.append(self.temperature)
            return {"verdict": "none", "reason": ""}, {}

    async def go():
        run, deps, _ = make([])
        chat = Chat()
        run.d.conduct_chat = chat
        await run.start(None)
        await run._check_conduct("this is such a pointless problem")
        return chat.used

    assert asyncio.run(go()) == [CONDUCT_CHECK_TEMPERATURE] and CONDUCT_CHECK_TEMPERATURE == 0.0


# ------------------------------------------------------------------ review round 2

def _speak_with(turn, n, **kw):
    async def go():
        return [x async for x in turn.run([{"role": "user", "content": "hi"}], turn_id=str(n), current_slot="core-1", candidate_said="", **kw)]
    return asyncio.run(go())


def test_losing_a_repeated_lead_in_never_leaves_a_verdict_behind():
    from app.interviewer.talker import ACKNOWLEDGES

    turn = _talker(say("Okay, tell me about the cache."), say("Okay, great point there."))
    _speak_with(turn, 1)
    spoken = _speak_with(turn, 2, verdict_budget=True)                      # the turn before opened with a verdict: this one carries none
    assert "Great point there." not in spoken and not any(ACKNOWLEDGES(x) for x in spoken)
    assert [b["rule"] for b in turn.last.blocked] == ["repeated_opener"]
    two = _talker(say("Okay, tell me about the cache."), say("Okay, that is exactly right.", "Nice, and what about a miss?"))
    _speak_with(two, 1)
    spoken = _speak_with(two, 2)
    assert sum(1 for x in spoken if ACKNOWLEDGES(x)) <= 1 and "That is exactly right." not in spoken
    plain = _talker(say("Okay, tell me about the cache."), say("Okay, how does it refill?"))
    _speak_with(plain, 1)
    assert _speak_with(plain, 2) == ["How does it refill?"]                 # a rest that judges nothing is still the repair


def test_every_wording_of_a_pool_agrees_with_the_first_under_the_matchers_that_read_a_turn():
    from app.interviewer.closing import (addresses_the_candidate, announces_coding_now, announces_leaving, announces_problem, asks_for_introduction,
                                         asks_to_trace, claims_problem_on_screen_now, closes_coding_part, gives_outline, leaves_the_part,
                                         moves_to_another_problem, abandons_problem)
    from app.interviewer.lines import BRIDGE_POOLS
    from app.interviewer.talker import ACKNOWLEDGES, announces_a_move, move_kinds, opens_with_verdict

    judges = {"coding_now": announces_coding_now, "problem": announces_problem, "outline": gives_outline, "farewell": is_farewell, "leaves": leaves_the_part,
              "intro": asks_for_introduction, "trace": asks_to_trace, "addresses": addresses_the_candidate, "moves": moves_to_another_problem,
              "leaving": announces_leaving, "claims": claims_problem_on_screen_now, "closes": closes_coding_part, "abandons": abandons_problem,
              "announces_move": announces_a_move, "kinds": lambda t: sorted(move_kinds(t)), "verdict": opens_with_verdict, "ack": ACKNOWLEDGES}
    for key, pool in {**LINES, **BRIDGE_POOLS}.items():
        if _group(key) == "backchannel":
            continue
        # "Yes, I'm here." is today's wording and opens with "Yes", which counts as a verdict opener; the other wordings of the two check replies
        # open differently on purpose (the picker keeps openers apart), so only the verdict classes may differ there.
        skip = {"verdict", "ack"} if key in ("presence", "line_check") else set()
        base = {n: f(pool[0]) for n, f in judges.items() if n not in skip}
        for v in pool[1:]:
            assert {n: f(v) for n, f in judges.items() if n not in skip} == base, (key, v)


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

def test_an_opener_that_has_opened_three_turns_of_the_round_is_repeated_even_with_nothing_recent_and_a_colon_lead_in_is_an_opener():
    """M2: "Fair enough" opened turns 39, 43 and 45 of run_b, "Let me point you to the next step:" repeated; the window alone forgot them."""
    assert not opener_repeated("fair enough", [], 2) and opener_repeated("fair enough", [], 3) and opener_repeated("fair enough", ["a", "b", "c", "d", "e"], 3)
    assert turn_opener("Let me point you to the next step: the day count only ever goes down.") == "let me point you to the next step"
    assert turn_opener("On the API side now: how did you make those idempotent?") == "on the api side now"
    assert turn_opener("Here is one: what is the complexity?") == "here is one"               # three words or fewer: an opener as before
    assert turn_opener("Let me point you to the very next step in the whole of this problem here: go.") is None       # a longer lead-in is the sentence


def test_the_talker_counts_openers_over_the_round_and_stops_the_fourth_use_of_the_same_one():
    turn = _talker(say("Fair enough, how does the cache refill?"), say("Fair enough, what happens on a miss?"), habit_acks=HABITS["acks"])
    assert _speak(turn, 1)[0] == "Fair enough, how does the cache refill?" and turn._opener_uses == {"fair enough": 1}
    turn._openers.clear()                                              # the window has forgotten it (more than five turns ago)
    turn._opener_uses["fair enough"] = 3                                # ...but the round has had it three times
    second = _speak(turn, 2)
    assert second[0] != "Fair enough, what happens on a miss?" and turn.last.repaired and "fair enough" not in second[0].lower()
    assert turn._opener_uses["fair enough"] == 3


def test_no_filler_wording_contains_a_length_of_time():
    """M3: "Hold on, one second." was a spoken length of time by the pattern's own reading."""
    from app.interviewer.closing import _DURATION
    from app.interviewer.fillers import RECOVERY_APOLOGY, RECOVERY_SHORT, STAGES

    for wording in [w for stage in STAGES for w in stage] + list(RECOVERY_SHORT) + list(RECOVERY_APOLOGY):
        assert not _DURATION.search(wording) and not says_duration(wording), wording
