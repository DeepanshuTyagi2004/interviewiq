"""The speech vocabulary read by the interviewer's matchers (decided 2026-10-18): every phrase of app/blueprint/speech_vocab.py is recognised by the
talker as it is tagged (a verdict judges, a neutral acknowledgement does not, a bare acknowledgement is the one the empty-reply rules read), gives no
duration, takes no leave, announces no move and trips none of the guard's other rules; the lead-ins are openers; the prompt and the fillers use them."""
import itertools
import random
import re
import time

from app.blueprint import realism as R
from app.blueprint import speech_vocab as V
from app.interviewer.closing import (_DURATION, abandons_problem, addresses_the_candidate, announces_coding_now, announces_leaving, announces_problem,
                                     asks_for_introduction, asks_format_check, asks_to_trace, claims_problem_on_screen_now, closes_coding_part,
                                     ends_with_goodbye, gives_outline, has_leave_taking, is_farewell, leaves_the_part, moves_to_another_problem,
                                     problem_line_part, says_duration)
from app.interviewer.fillers import Fillers
from app.interviewer.prompts import how_you_talk, talker_prefix, talker_rules, _neutral_acks
from app.interviewer.talker import (ACKNOWLEDGES, BARE_ACK, CLAIMS_LINE_DROPPING, EMPTY_ACK, INTERNAL_WORDS, NEUTRAL_ACK, announces_a_move, claims_code,
                                    foreign_script, is_reasoning, move_kinds, narrates, opener_repeated, opens_with_verdict, speaks_about_them, turn_opener)
from tests.interviewer.fixtures import blueprint
from tests.interviewer.test_lines import _speak, _talker

# A matcher that must be silent on every phrase: the other rules of the talker guard and the closing / move / put-up / outline matchers.
GUARD_AND_MOVE_MATCHERS = {
    "duration": says_duration, "leave_taking": has_leave_taking, "farewell": is_farewell, "goodbye": ends_with_goodbye, "outline": gives_outline,
    "format_check": asks_format_check, "closes_coding": closes_coding_part, "announces_problem": announces_problem, "coding_now": announces_coding_now,
    "claims_on_screen": claims_problem_on_screen_now, "leaves_part": leaves_the_part, "asks_intro": asks_for_introduction, "asks_trace": asks_to_trace,
    "moves_problem": moves_to_another_problem, "leaving": announces_leaving, "abandons": abandons_problem, "announces_move": announces_a_move,
    "move_kinds": lambda t: bool(move_kinds(t)), "put_up_line": lambda t: problem_line_part(t) is not None,
    "foreign_script": lambda t: foreign_script(t) is not None, "internal_words": lambda t: bool(INTERNAL_WORDS.search(t)), "narrates": narrates,
    "third_person": speaks_about_them, "line_claim": lambda t: bool(CLAIMS_LINE_DROPPING.search(t)), "reasoning": is_reasoning,
    "code_claim": lambda t: claims_code(t) is not None, "question": lambda t: "?" in t, "duration_regex": lambda t: bool(_DURATION.search(t)),
}


def _hits(text: str, matchers=GUARD_AND_MOVE_MATCHERS) -> list[str]:
    return [name for name, f in matchers.items() if f(text)]


# ------------------------------------------------------------------ acknowledgements and backchannels: tagged as the matchers read them

def test_a_verdict_phrase_is_exactly_one_the_verdict_matchers_read_as_a_verdict_and_a_neutral_one_is_not():
    for p in V.ACKS + V.BACKCHANNELS:
        assert opens_with_verdict(p.text) is p.verdict, (p.text, p.verdict)
        if p.verdict:
            assert ACKNOWLEDGES(p.text) and not NEUTRAL_ACK.match(p.text), p.text
        else:
            assert NEUTRAL_ACK.match(p.text), p.text


def test_every_neutral_acknowledgement_and_nod_is_a_bare_acknowledgement_so_the_empty_reply_rules_read_it():
    for p in V.ACKS + V.BACKCHANNELS:
        if not p.verdict:
            assert BARE_ACK.match(p.text) and EMPTY_ACK.match(p.text) and NEUTRAL_ACK.match(p.text), p.text
    assert len([p for p in V.BACKCHANNELS]) >= 25 and not any(p.verdict for p in V.BACKCHANNELS)
    # no invitation ("Go on.", "Take your time.") is in the vocabulary, so none can be taken for an empty acknowledgement either: a reply of
    # "Okay, go on." to a real answer is still a reply
    for text in ("Go on.", "Okay, go on.", "Take your time.", "Please continue.", "No rush.", "I'm listening.", "Sure, go ahead."):
        assert not BARE_ACK.match(text) and not EMPTY_ACK.match(text), text


def test_a_text_the_old_acknowledgement_words_read_is_still_read_whatever_the_vocabulary_holds():
    """The vocabulary's phrases end on a word boundary and sit beside today's words (`hmm+`, `mm-?hmm?`, ...), so nothing that was a bare
    acknowledgement before the vocabulary stopped being one, and the extra phrases read the rest."""
    for text in ("Hmmm.", "Hmmm, okay.", "Hmmmm", "Mmhmm.", "Okay, okay, I see what you mean.", "Okay, okay, that makes sense.",
                 "Okay, understood, Thank you for that.", "Okay, Yeah, I get that.", "Hmm, hmm, okay.", "Okay, cool, cool.", "Cool, cool.", "Right, right."):
        assert BARE_ACK.match(text) and EMPTY_ACK.match(text), text
    old = ["sure", "okay", "ok", "alright", "all right", "right", "got it", "understood", "i see", "of course", "absolutely", "sounds good", "good", "great", "fine",
           "yes", "yeah", "thanks", "thank you", "mm-hmm", "mmhmm", "fair enough", "makes sense", "hmmm", "cool", "nice"]
    for a, b in itertools.product(old, old):
        text = f"{a.capitalize()}, {b}."
        assert BARE_ACK.match(text) and EMPTY_ACK.match(text), text
    for p in V.ACKS + V.BACKCHANNELS:                                    # a vocabulary phrase and any other acknowledgement, in either order
        if not p.verdict:
            for other in ("okay", "thank you", "I see"):
                assert BARE_ACK.match(f"{p.text.rstrip('.')}, {other}.") and BARE_ACK.match(f"{other.capitalize()}, {p.text[0].lower() + p.text[1:]}"), p.text


def test_a_verdict_phrase_is_not_part_of_the_bare_acknowledgement_pattern_built_from_the_vocabulary():
    """A lone verdict ("Perfect.", "Love that.") is kept as the reply and counted by the verdict budget, not dropped as an empty acknowledgement
    (a live round said only "Perfect." and moved on: the fix is that the opening follows it in the same reply)."""
    for p in V.VERDICT_ACKS:
        assert not re.fullmatch(V.BARE_PATTERN, p.text.rstrip(".!"), re.IGNORECASE), p.text
    assert not EMPTY_ACK.match("Love that.") and not EMPTY_ACK.match("Perfect.") and not BARE_ACK.match("Well said.")


def test_every_acknowledgement_has_an_opener_that_the_repeat_guard_can_count():
    for p in V.ACKS + V.BACKCHANNELS:
        assert turn_opener(p.text) is not None, p.text
    # two acknowledgements of one persona that open the same way count as the same opener when the opener is the head before the comma
    assert opener_repeated(turn_opener("Okay, I see."), [turn_opener("Okay, I see.")])


def test_no_phrase_of_the_vocabulary_gives_a_length_of_time():
    for p in V.VOCABULARY:
        assert not says_duration(p.text) and not _DURATION.search(p.text), p.text
    assert any(p.text == "One moment." for p in V.VOCABULARY) and not any("one second" in p.text.lower() for p in V.VOCABULARY)


def test_no_acknowledgement_or_nod_takes_leave_announces_a_move_or_trips_another_rule_of_the_guard():
    skip = {"question"}
    for p in V.ACKS + V.BACKCHANNELS:
        assert not _hits(p.text, {n: f for n, f in GUARD_AND_MOVE_MATCHERS.items() if n not in skip}), (p.text, _hits(p.text))
        assert "?" not in p.text
    assert all(not addresses_the_candidate(p.text) for p in V.ACKS)


def test_no_filler_or_lead_in_is_mistaken_for_a_question_a_verdict_an_acknowledgement_a_farewell_a_move_or_a_put_up_line():
    for p in V.FILLERS + V.LEAD_INS:
        assert not _hits(p.text), (p.text, _hits(p.text))
        assert not opens_with_verdict(p.text) and not ACKNOWLEDGES(p.text), p.text
        assert not BARE_ACK.match(p.text) and not NEUTRAL_ACK.match(p.text), p.text
    for p in V.LEAD_INS:
        assert not addresses_the_candidate(p.text) and not EMPTY_ACK.match(p.text), p.text                  # a lead-in asks nothing by itself
    # a filler is said by the run, never checked as a reply: "Give me a moment." is not an invitation either, whatever the matcher says of "give me"
    for p in V.FILLERS:
        assert not re.search(r"\b(?:go on|go ahead|continue|carry on)\b", p.text, re.IGNORECASE), p.text


def test_a_lead_in_followed_by_a_question_is_still_no_verdict_and_asks_the_one_question():
    for p in V.LEAD_INS:
        sentence = p.text.rstrip(",—…").rstrip() + " how did you decide that?"
        assert not opens_with_verdict(sentence) and not ACKNOWLEDGES(sentence), sentence
        assert sentence.count("?") == 1 and not announces_a_move(sentence) and not says_duration(sentence), sentence


def test_matching_a_long_run_of_acknowledgements_is_linear_whatever_it_ends_in():
    """`BARE_ACK` / `EMPTY_ACK` walk the words through a trie (a regex `ACK(sep ACK)*` tried every split of "Mm-hmm" = `mm-?hmm?` | "Mm"+"hmm": 1.7 s for
    "Mm-hmm, " x19 on the live event loop)."""
    cases = ["Mm-hmm, " * 19 + "x", "mm-hmm " * 19 + "so", "Mm, okay. " * 14, "Hm, okay, " * 14, "okay " * 200 + "x", "Ah, okay, " * 20 + "x", "Mm, noted. " * 20 + "x",
             "Ah, I see. " * 20 + "x", "Okay, okay, " * 30 + "x", "Mm-hmm, " * 80, "okay, " * 30, "okay, " * 200]
    for text in cases:
        started = time.perf_counter()
        BARE_ACK.match(text), EMPTY_ACK.match(text)
        assert time.perf_counter() - started < 0.005, (text[:20], len(text))
    # a pure run of acknowledgements is held however long it is (no length cap), and anything else at the end is not one
    assert BARE_ACK.match("okay, " * 30) and EMPTY_ACK.match("Mm-hmm, " * 80) and BARE_ACK.match("okay " * 200)
    assert not BARE_ACK.match("Mm-hmm, " * 19 + "x") and not EMPTY_ACK.match("okay " * 200 + "x")


_TODAY = (r"(?:sure|okay|ok|alright|all right|right|got it|understood|i see|of course|absolutely|sounds good|good|great|fine|yes|yeah|thanks|thank you|"
          r"mm-?hmm?|fair enough|makes sense|hmm+|cool|nice)")


def test_the_word_walk_reads_exactly_what_the_regex_it_replaced_read_and_never_less_than_today_s_words():
    """The regexes the walk replaced (an acknowledgement is a vocabulary phrase or one of today's words; a run of them is separated by `[\\s,.!;-]+`; an
    empty reply may end in a bare promise), kept here as the reference, against 12,000 strings built from phrases, separators, tails, case, glued
    words and noise (the full fuzz was 60,000 strings with no difference), and against today's words alone as a floor."""
    from app.interviewer.talker import _BARE_PROMISE

    ack = r"(?:" + V.alternation(V.BARE_TEXTS) + r"\b|" + _TODAY[3:]
    ref_empty = re.compile(rf"^\W*(?:{ack}(?:[\s,.!;-]+{ack})*)?[\s,.!;-]*(?:{_BARE_PROMISE})?\W*$", re.IGNORECASE)
    ref_bare = re.compile(rf"^\W*{ack}(?:[\s,.!;-]+{ack})*\W*$", re.IGNORECASE)
    floor_empty = re.compile(rf"^\W*(?:{_TODAY}(?:[\s,.!;-]+{_TODAY})*)?[\s,.!;-]*(?:{_BARE_PROMISE})?\W*$", re.IGNORECASE)
    floor_bare = re.compile(rf"^\W*{_TODAY}(?:[\s,.!;-]+{_TODAY})*\W*$", re.IGNORECASE)
    rng = random.Random(8)
    units = [t.rstrip(".") for t in V.BARE_TEXTS] + ["okay", "ok", "all right", "of course", "sounds good", "thank you", "Hmm", "hmmm", "Hmmmm", "mmhmm", "mm-hm", "Mm hmm",
             "I\u2019m following", "Okay  cool", "okayish", "okay_", "x", "tell me more", "let me check that", "Let me clarify that", "let me think", "I'll look it up",
             "?", "Right", "good", "Great"]
    seps = [", ", ". ", " ", ", ", "; ", "! ", " - ", "-", "  ", ": ", " \u2014 ", "? ", "'", ",", "...", "\n", ""]
    tails = ["", ".", "?", "!", " x", ", so", " let me check that", ", let me look it up", " and then", "'", " \u2014", ".\n"]
    for _ in range(12000):
        k = rng.randint(0, 5)
        text = rng.choice(["", " ", "'", "...", '"', "\u201c"]) + "".join(rng.choice(units) + (rng.choice(seps) if i < k - 1 else "") for i in range(k)) + rng.choice(tails)
        if rng.random() < 0.3:
            text = text.upper() if rng.random() < 0.5 else text.lower()
        assert bool(BARE_ACK.match(text)) == bool(ref_bare.match(text)) and bool(EMPTY_ACK.match(text)) == bool(ref_empty.match(text)), repr(text)
        assert not (floor_bare.match(text) and not BARE_ACK.match(text)) and not (floor_empty.match(text) and not EMPTY_ACK.match(text)), repr(text)


def test_the_matchers_are_built_from_the_vocabulary_so_a_new_phrase_needs_no_regex():
    assert V.alternation(["Okay, noted.", "Okay, noted."]).count("noted") == 1
    assert re.search(V.phrase_pattern("Okay, let's go."), "okay lets go", re.IGNORECASE) is None            # an apostrophe is kept: "let's" is not "lets"
    assert re.fullmatch(V.phrase_pattern("Okay, let's go."), "Okay; let’s go", re.IGNORECASE)             # punctuation is free, an apostrophe may be curly
    assert BARE_ACK.match("Okay, fine.") and BARE_ACK.match("okay fine") and BARE_ACK.match("Got it, got it, okay.")


# ------------------------------------------------------------------ the repair of a repeated opener never changes a verdict into a neutral line or back

def test_the_opener_repair_only_swaps_in_an_acknowledgement_of_the_same_class_for_every_phrase_of_every_persona():
    checked = 0
    for seed in range(40):
        traits = R.draw_realism_traits(seed, [])
        habits = R.draw_realism_habits(seed, traits)
        for p in V.ACKS:
            turn = _talker(habit_acks=habits.acks)
            turn._openers = [("t0", turn_opener(p.text))]
            fixed = turn._fresh_opener(p.text)
            if fixed is None:
                continue
            checked += 1
            # a neutral line never becomes a judging one; a judging one is swapped for one of its own class or loses its verdict, never gains one
            assert opens_with_verdict(fixed) <= opens_with_verdict(p.text) and ACKNOWLEDGES(fixed) <= ACKNOWLEDGES(p.text), (p.text, fixed)
            if not p.verdict:
                assert opens_with_verdict(fixed) == opens_with_verdict(p.text) and ACKNOWLEDGES(fixed) == ACKNOWLEDGES(p.text), (p.text, fixed)
    assert checked > 500


def test_a_lead_in_that_would_open_three_turns_of_the_round_is_repaired_like_any_opener():
    turn = _talker(*[__import__("tests.interviewer.fakes", fromlist=["say"]).say("One thing I'd like to understand — how did you pick the index?")] * 3)
    spoken = [_speak(turn, n) for n in (1, 2)]
    assert spoken[0] == ["One thing I'd like to understand — how did you pick the index?"]
    assert spoken[1] == ["How did you pick the index?"] and turn.last.repaired            # said just before: the lead-in is dropped, the question stays


def test_a_vocabulary_lead_in_is_an_opener_even_when_it_is_longer_than_three_words_and_a_plain_long_clause_is_not():
    for p in V.LEAD_INS:
        sentence = p.text.rstrip() + " how does the cache refill?"
        assert turn_opener(sentence) is not None, sentence
    assert turn_opener("One thing I'd like to understand — how did you pick the index?") == "one thing id like to understand"
    assert turn_opener("So when the list is empty, what do you return?") is None             # not a lead-in of the vocabulary: its first clause is the sentence
    assert turn_opener("Why did you pick that index?") is None


# ------------------------------------------------------------------ the prompt

def _realism_bp(seed: int = 3):
    traits = R.draw_realism_traits(seed, [])
    habits = R.draw_realism_habits(seed, traits)
    bp = blueprint()
    bp["realism"] = {"seed": seed, "traits": traits, "habits": habits.model_dump()}
    return bp, traits, habits


def test_the_how_you_talk_block_lists_the_lead_ins_and_the_persona_s_phrases_but_never_names_the_register():
    for seed in range(30):
        bp, traits, habits = _realism_bp(seed)
        text = how_you_talk(bp)
        assert all(f'"{x}"' in text for x in habits.lead_ins) and "begin a turn" in text
        assert all(f'"{b}"' in text for b in habits.backchannels)
        assert "register" not in text and "indian_english" not in text
        neutral = _neutral_acks(habits.model_dump())
        assert all(f'"{a}"' in text for a in neutral) and neutral
        assert not any(opens_with_verdict(a) for a in neutral)                          # a verdict is never offered as a neutral acknowledgement
        rules = talker_rules(bp)
        assert all(f'"{a}"' in rules for a in neutral[:6])
        verdicts = [a for a in habits.acks if opens_with_verdict(a)]
        assert not any(f'"{v}"' in rules.split("(yours:")[1].split(")")[0] for v in verdicts)
    ctx = {"round": {"role": "SDE", "company_name": "Acme"}, "first_name": "Asha"}
    assert "begin a turn" in talker_prefix(_realism_bp(1)[0], ctx)
    old = blueprint()
    old["realism"] = {"seed": 1, "traits": {}, "habits": {"acks": ["Okay."], "backchannels": ["Mm-hmm."], "fillers": {}}}     # a block from before lead-ins
    assert "begin a turn" not in how_you_talk(old) and "Your short nods" in how_you_talk(old)


# ------------------------------------------------------------------ the fillers

def test_the_fillers_of_a_persona_with_two_or_three_wordings_per_stage_are_used_and_never_repeat_the_last_two():
    for seed in range(40):
        traits = R.draw_realism_traits(seed, [])
        habits = R.draw_realism_habits(seed, traits).model_dump()
        f = Fillers(random.Random(seed), habits)
        for i, stage in enumerate(V.STAGES):
            own = habits["fillers"][stage]
            said = [f.line(i) for _ in range(30)]
            assert set(said) == set(own) and all(a != b for a, b in zip(said, said[1:])), (stage, own)
            if len(own) == 3:
                assert all(said[n] != said[n - 2] for n in range(2, len(said)))


def test_a_blueprint_without_habits_or_with_a_thin_stage_still_gets_the_default_fillers():
    from app.interviewer.fillers import STAGES

    assert all(Fillers(random.Random(1)).line(i) in STAGES[i] for i in range(4))
    assert Fillers(random.Random(1), {"fillers": {"stage0": ["One moment."]}}).line(0) in STAGES[0]
    assert Fillers(random.Random(1), {"fillers": {"stage0": ["Just a moment.", "Let me think."]}}).line(0) in ("Just a moment.", "Let me think.")


def test_the_short_recovery_after_a_wait_is_a_short_neutral_acknowledgement_of_the_persona_never_a_verdict():
    for seed in range(60):
        traits = R.draw_realism_traits(seed, [])
        habits = R.draw_realism_habits(seed, traits).model_dump()
        f = Fillers(random.Random(seed), habits)
        for _ in range(12):
            said = f.recovery(1)
            if said not in ("Okay.", "Right."):                  # the defaults, when the persona has too few short neutral ones
                assert said in habits["acks"] and not opens_with_verdict(said) and len(said.split()) <= 3, (habits["acks"], said)
    # a persona whose acknowledgements are all long or judging falls back to the defaults
    f = Fillers(random.Random(1), {"acks": ["Love that.", "Perfect.", "Okay, let me think about that for a moment."]})
    assert all(f.recovery(1) in ("Okay.", "Right.") for _ in range(6))
