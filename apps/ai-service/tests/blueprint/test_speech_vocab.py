"""The speech vocabulary (app/blueprint/speech_vocab.py) and how habits are drawn from it: sizes, tags, the traits each phrase suits, the
Indian-English register, variety across personas, the last interviewers' phrases left out, and re-prep keeping a session's habits.
The matchers that read the vocabulary (verdict or neutral, bare acknowledgement, no duration...) are tested in tests/interviewer/test_speech_vocab.py."""
import asyncio
import itertools
import random
import re
import statistics
from collections import Counter

import pytest

from app.blueprint import pipeline, store
from app.blueprint import realism as R
from app.blueprint import speech_vocab as V
from app.blueprint.models import Blueprint, SpeechHabits
from tests.blueprint.test_realism import CLASSIC, PROJECTS, _Coll, _view
from tests.blueprint.test_realism import AREAS


def _voices():
    """Every voice a persona can have: each coherent trait combination, in both registers."""
    for c in R._combos():
        for register in R.TRAIT_AXES["register"]:
            yield {**dict(zip(R.COMBO_AXES, c)), "register": register}


def _persona(seed: int, avoid=None, shape_id=None):
    traits = R.draw_realism_traits(seed, [], shape_id)
    return traits, R.draw_realism_habits(seed, traits, avoid)


# ------------------------------------------------------------------ the vocabulary itself

def test_the_vocabulary_has_the_declared_sizes():
    assert 80 <= len(V.ACKS) <= 120 and 25 <= len(V.BACKCHANNELS) <= 40 and 30 <= len(V.LEAD_INS) <= 50
    for stage in V.STAGES:
        assert 15 <= len(V.by_kind("filler", stage)) <= 20, stage
    assert V.STAGES == ("stage0", "stage1", "stage2", "stage3")
    assert len(V.NEUTRAL_ACKS) + len(V.VERDICT_ACKS) == len(V.ACKS) and all(p.verdict for p in V.VERDICT_ACKS) and not any(p.verdict for p in V.NEUTRAL_ACKS)


def test_no_phrase_is_twice_in_the_vocabulary_and_every_tag_names_a_real_axis_and_level():
    keys = [(p.text, p.kind, p.stage) for p in V.VOCABULARY]
    assert len(set(keys)) == len(keys)
    spoken = [p.text for p in V.ACKS + V.BACKCHANNELS]
    assert len(set(spoken)) == len(spoken)                       # an acknowledgement is never also a nod: the two lists never hand out the same words
    for p in V.VOCABULARY:
        assert p.text.strip() == p.text and p.text and (p.stage is not None) == (p.kind == "filler"), p
        for axis, levels in p.fits.items():
            assert axis in V.LEVELS and levels and levels <= V.LEVELS[axis], p
    with pytest.raises(ValueError):
        V.neutral("Okay.", warmth="lukewarm")
    with pytest.raises(ValueError):
        V.neutral("Okay.", mood="happy")


def test_every_trait_axis_of_a_tag_is_one_of_the_personas_traits_with_the_same_levels():
    for axis, levels in V.LEVELS.items():
        assert axis in R.TRAIT_AXES and levels == frozenset(R.TRAIT_AXES[axis])


def _kinds(phrases) -> int:
    """How many distinct things the phrases say: a persona gets one phrase of a family, so the families (and the phrases in none) are what is drawn from."""
    return len({p.family or p.text for p in phrases})


def test_every_voice_has_enough_phrases_of_every_kind_to_draw_from():
    """Coherence of the tags with the traits: no coherent combination, in either register, leaves a pool too thin to draw its habits from (counted in
    families, since a persona gets one phrase of each)."""
    for t in _voices():
        assert _kinds(R.candidates("ack", t, verdict=False)) >= 10 and _kinds(R.candidates("ack", t, verdict=True)) >= 3, t
        assert _kinds(R.candidates("backchannel", t)) >= 5, t
        assert _kinds(R.candidates("lead_in", t)) >= 4, t
        for stage in V.STAGES:
            assert _kinds(R.candidates("filler", t, stage)) >= 4, (stage, t)
        assert len([p for p in R.candidates("ack", t, verdict=False) if R._is_ie(p)]) >= (2 if t["register"] == "indian_english" else 0), t


def test_a_phrase_fits_a_voice_only_when_every_axis_it_names_matches():
    love = V.phrase_of("Love that.")
    assert V.fits(love, {"warmth": "very warm", "formality": "casual"}) and not V.fits(love, {"warmth": "reserved", "formality": "casual"})
    ie = V.phrase_of("Okay, fine.")
    assert V.fits(ie, {"register": "indian_english"}) and not V.fits(ie, {"register": "neutral"}) and not V.fits(ie, {})   # no register trait = the neutral one
    assert V.fits(V.phrase_of("Okay."), {})                                                                              # an untagged phrase suits any voice


# ------------------------------------------------------------------ drawing

def test_habits_have_the_declared_sizes_and_only_phrases_that_fit_the_traits():
    for seed in range(200):
        traits, h = _persona(seed)
        assert 5 <= len(h.acks) <= 8 and 3 <= len(h.backchannels) <= 4 and 3 <= len(h.lead_ins) <= 5
        assert list(h.fillers) == list(V.STAGES) and all(2 <= len(x) <= 3 for x in h.fillers.values())
        assert R.habits_problems(h, traits) == [], (seed, traits)
        for kind, texts in (("ack", h.acks), ("backchannel", h.backchannels), ("lead_in", h.lead_ins)):
            assert all(V.fits(V.phrase_of(x, kind), traits) for x in texts), (seed, kind)
        for stage, texts in h.fillers.items():
            assert all(V.fits(V.phrase_of(x, "filler", stage), traits) for x in texts)
        assert sum(V.phrase_of(a, "ack").verdict for a in h.acks) <= 2           # at most two acknowledgements that judge
        assert len(h.acks) - sum(V.phrase_of(a, "ack").verdict for a in h.acks) >= 5      # and 5 or more that do not
        assert len(set(h.acks) | set(h.backchannels) | set(h.lead_ins)) == len(h.acks) + len(h.backchannels) + len(h.lead_ins)


def test_the_same_seed_gives_the_same_habits_and_other_seeds_other_ones():
    assert _persona(11) == _persona(11) and _persona(11)[1] != _persona(12)[1]
    traits = R.draw_realism_traits(4, [])
    assert R.draw_habits(random.Random(9), traits) == R.draw_habits(random.Random(9), traits)


def test_a_brisk_or_terse_persona_only_gets_short_phrases_and_an_unhurried_one_may_get_long_ones():
    long_seen = False
    for seed in range(300):
        traits, h = _persona(seed)
        short = traits["pace"] == "brisk" or traits["verbosity"] == "terse"
        spoken = [(k, x) for k, xs in (("ack", h.acks), ("backchannel", h.backchannels), ("lead_in", h.lead_ins)) for x in xs]
        spoken += [("filler", x) for xs in h.fillers.values() for x in xs]
        for kind, text in spoken:
            if short:
                assert len(text.split()) <= R.SHORT_WORDS[kind], (traits, text)
            elif len(text.split()) > R.SHORT_WORDS[kind]:
                long_seen = True
    assert long_seen
    assert any(p.words > R.SHORT_WORDS["ack"] and V.fits(p, {"pace": "unhurried", "verbosity": "chatty", "warmth": "friendly", "formality": "casual"}) for p in V.NEUTRAL_ACKS)


def test_a_reserved_or_formal_persona_never_gets_the_breezy_phrases_and_a_very_warm_one_can_get_them():
    breezy = {"Love that.", "Awesome.", "Oh nice, okay.", "Okay, cool.", "Brilliant.", "Gotcha.", "Yeah, I get that."}
    seen = set()
    for seed in range(400):
        traits, h = _persona(seed)
        got = breezy & set(h.acks)
        if traits["warmth"] == "reserved" or traits["formality"] == "formal":
            assert not got, (traits, got)
        seen |= got
    assert {"Love that.", "Okay, cool."} & seen


def test_an_indian_english_persona_has_indian_english_phrases_and_a_neutral_one_has_none():
    ie_texts = {p.text for p in V.VOCABULARY if R._is_ie(p)}
    assert len(ie_texts) >= 20
    share = 0
    for seed in range(400):
        traits, h = _persona(seed)
        everything = R.phrases_of(h)
        if traits["register"] == "indian_english":
            share += 1
            neutral_ie = [a for a in h.acks if a in ie_texts and not V.phrase_of(a, "ack").verdict]
            assert 1 <= len(neutral_ie) <= R.IE_ACKS, (seed, traits)       # its quota at most, and only that: the rest of its acknowledgements are the shared ones
            assert len([a for a in h.acks if a in ie_texts]) <= R.IE_ACKS, (seed, h.acks)       # the judging ones count too
        else:
            assert not ie_texts & everything, (seed, traits)
    assert 0.3 <= share / 400 <= 0.5                      # roughly 40% of personas


def test_the_register_is_drawn_with_the_traits_and_changes_neither_the_combination_nor_the_avoid_rule():
    t = R.draw_traits(random.Random(3), [])
    assert t["register"] in ("neutral", "indian_english") and set(t) == set(R.TRAIT_AXES) and R.TRAIT_AXES["register"] == ("neutral", "indian_english")
    base = {a: v for a, v in t.items() if a != "register"}
    other = {**t, "register": "neutral" if t["register"] == "indian_english" else "indian_english"}
    assert R.draw_traits(random.Random(5), [other]) != R.draw_traits(random.Random(5), [])   # avoiding the combination (either register) moves the draw
    for seed in range(100):
        assert {a: v for a, v in R.draw_traits(random.Random(seed), [other]).items() if a != "register"} != base
    # coherence and shapes read only the other axes, so every coherent combination exists in both registers
    for c in R._combos():
        for register in ("neutral", "indian_english"):
            assert R.coherent({**dict(zip(R.COMBO_AXES, c)), "register": register})
    assert R.keep_traits(None, 1) is None


def test_traits_stored_before_the_register_keep_their_other_traits_and_get_one_from_the_seed():
    old = {a: v for a, v in R.draw_realism_traits(3, [], "classic").items() if a != "register"}
    kept = R.keep_traits(old, 77, "classic")
    assert kept is not None and {a: v for a, v in kept.items() if a != "register"} == old and kept == R.keep_traits(old, 77, "classic")
    assert {R.keep_traits(old, s, "classic")["register"] for s in range(50)} == {"neutral", "indian_english"}
    assert R.keep_traits({**old, "pace": "sloppy"}, 77) is None and R.keep_traits({**old, "warmth": "reserved", "formality": "casual"}, 77) is None


# ------------------------------------------------------------------ variety

def test_over_200_seeds_two_personas_share_at_most_one_acknowledgement_in_the_median_and_no_acknowledgement_is_a_tic():
    habits = [_persona(seed)[1] for seed in range(200)]
    shared = [len(set(a.acks) & set(b.acks)) for a, b in itertools.combinations(habits, 2)]
    assert statistics.median(shared) <= 1
    counts = Counter(x for h in habits for x in h.acks)
    top, n = counts.most_common(1)[0]
    assert n / 200 <= 0.20, (top, n / 200)
    for lines in ([h.backchannels for h in habits], [h.lead_ins for h in habits]):
        assert max(Counter(x for xs in lines for x in xs).values()) / 200 <= 0.30


def test_a_new_persona_shares_at_most_two_phrases_with_each_of_the_last_two_interviewers_in_all_but_a_few_in_a_thousand_draws():
    """Not a guarantee: a voice narrow enough that its pools hold fewer phrases than the last two interviewers used cannot always manage it (the draw
    that shares the fewest is returned: three, never more in this sample). Over a candidate's real histories (random voices) it fails in about one
    draw in a thousand."""
    rng = random.Random(3)
    checked = over = 0
    for _ in range(150):
        history: list[tuple[dict, SpeechHabits]] = []
        for _ in range(6):
            traits = R.draw_realism_traits(rng.randrange(10 ** 9), [t for t, _ in history])
            habits = R.draw_realism_habits(rng.randrange(10 ** 9), traits, [h.model_dump() for _, h in history])
            for _, earlier in history:
                shared = len(R.phrases_of(habits) & R.phrases_of(earlier))
                assert shared <= R.MAX_SHARED + 1
                over += shared > R.MAX_SHARED
                checked += 1
            history = ([(traits, habits)] + history)[:2]
    assert checked == 150 * (1 + 4 * 2) and over / checked <= 0.005
    # the phrases of the last two are left out first: a voice with room to spare shares none of them
    roomy = {"pace": "even", "warmth": "friendly", "formality": "neutral", "verbosity": "chatty", "probing": "normal", "hints": "normal",
             "firmness": "normal", "register": "neutral"}
    earlier = R.draw_realism_habits(1, roomy)
    assert not R.phrases_of(R.draw_realism_habits(5, roomy, [earlier.model_dump()])) & R.phrases_of(earlier)


def test_even_when_the_last_two_interviewers_had_the_very_same_voice_every_voice_shares_at_most_two_in_nearly_every_case():
    rng = random.Random(5)
    pairs = over = 0
    for t in _voices():
        a = R.draw_habits(random.Random(rng.random()), t)
        b = R.draw_habits(random.Random(rng.random()), t, [a.model_dump()])
        new = R.draw_habits(random.Random(rng.random()), t, [a.model_dump(), b.model_dump()])
        for earlier in (a, b):
            shared = len(R.phrases_of(new) & R.phrases_of(earlier))
            assert shared <= R.MAX_SHARED + 2, t
            over += shared > R.MAX_SHARED
            pairs += 1
    assert over / pairs <= 0.03, over / pairs                    # about 1.5% measured: the narrowest voices (brisk, reserved, formal, terse)


def test_no_persona_has_more_than_one_doubled_phrase_or_two_phrases_of_one_family():
    doubled_seen = False
    for seed in range(400):
        traits, h = _persona(seed)
        spoken = [("ack", x, None) for x in h.acks] + [("backchannel", x, None) for x in h.backchannels] + [("lead_in", x, None) for x in h.lead_ins]
        phrases = [V.phrase_of(x, kind) for kind, x, _ in spoken]
        assert sum(p.doubled for p in phrases) <= R.MAX_DOUBLED, (seed, h)
        families = [p.family for p in phrases if p.family]
        assert len(families) == len(set(families)), (seed, families)
        for stage, lines in h.fillers.items():
            fam = [V.phrase_of(x, "filler", stage).family for x in lines]
            assert len([f for f in fam if f]) == len({f for f in fam if f}), (seed, stage, fam)
        doubled_seen |= any(p.doubled for p in phrases)
    assert doubled_seen                                           # a doubled phrase is still part of some voices, one at a time
    assert {p.text for p in V.VOCABULARY if p.doubled} >= {"Okay, okay.", "Got it, got it.", "Good, good.", "Understood, understood."}
    for text in ("Yeah, yeah.", "Sure, sure."):
        assert V.phrase_of(text) is None                          # they can sound impatient in a nod
    for text in ("Fine, fine.", "Yes, yes.", "Good, good, okay."):
        assert V.phrase_of(text) is None                          # they can sound dismissive in Indian English, or are one phrase too many


def test_the_families_name_real_phrases_and_near_duplicates_are_never_drawn_together():
    for table in (V.FAMILIES, V.FILLER_FAMILIES):
        for family, texts in table.items():
            assert len(texts) == len(set(texts)) and texts, family
    for family in ("understood", "see", "follow", "got_it", "noted", "good", "nice", "very_good", "exactly"):
        members = V.FAMILIES[family]
        assert sum(1 for p in V.ACKS + V.BACKCHANNELS if p.family == family) == len(members)
    for seed in range(300):
        traits, h = _persona(seed)
        assert len([a for a in h.acks + h.backchannels if V.phrase_of(a).family == "understood"]) <= 1
        assert len([a for a in h.acks + h.backchannels if V.phrase_of(a).family == "follow"]) <= 1


def test_the_backchannels_are_only_short_bare_nods_never_an_invitation_or_a_reassurance():
    """The run says a persona's backchannels by itself while the candidate thinks (a nod pool that never reaches the talker's once-per-round check on
    "take your time"), so none invites ("Go on.") or reassures ("Take your time.", "No rush.", "No hurry.")."""
    for p in V.BACKCHANNELS:
        assert p.words <= 3 and not p.verdict, p.text
        assert not re.search(r"\b(?:go on|go ahead|carry on|continue|listening|time|rush|hurry|please)\b", p.text, re.IGNORECASE), p.text
    for p in V.VOCABULARY:
        assert not re.search(r"take your time|no rush|no hurry|in no hurry", p.text, re.IGNORECASE), p.text
    for seed in range(300):
        _, h = _persona(seed)
        assert all(len(b.split()) <= 3 for b in h.backchannels)


def test_no_phrase_speaks_about_the_interviewer_s_own_thinking():
    for p in V.ACKS + V.BACKCHANNELS:
        assert not re.search(r"\b(?:let me|i'm just|thinking that through|take that in|turn that over)\b", p.text, re.IGNORECASE), p.text


def test_a_formal_or_reserved_persona_never_gets_okay_cool_or_nice():
    seen = False
    for seed in range(600):
        traits, h = _persona(seed)
        if traits["formality"] == "formal" or traits["warmth"] == "reserved":
            assert not {"Okay, cool.", "Nice."} & set(h.acks), (seed, traits)
        else:
            seen |= bool({"Okay, cool.", "Nice."} & set(h.acks))
    assert seen


# ------------------------------------------------------------------ validation, old blueprints, re-prep

def test_validation_rejects_habits_outside_the_vocabulary_or_the_voice_or_the_sizes():
    traits, h = _persona(2)
    assert R.habits_problems(h, traits) == []
    assert R.habits_problems(h.model_copy(update={"acks": [*h.acks[:4], "Splendid, truly."]}), traits)                 # not in the vocabulary
    assert R.habits_problems(h.model_copy(update={"acks": h.acks[:4]}), traits)                                       # too few
    assert R.habits_problems(h.model_copy(update={"lead_ins": []}), traits)                                          # an old block has no lead-ins
    assert R.habits_problems(h.model_copy(update={"fillers": {**h.fillers, "stage0": h.fillers["stage0"][:1]}}), traits)
    assert R.habits_problems(h.model_copy(update={"fillers": {"stage0": h.fillers["stage0"]}}), traits)
    wrong_stage = {**h.fillers, "stage0": [*h.fillers["stage1"][:2]]}
    assert R.habits_problems(h.model_copy(update={"fillers": wrong_stage}), traits)
    reserved = {**traits, "warmth": "reserved", "formality": "formal", "register": "neutral"}
    breezy = h.model_copy(update={"acks": ["Love that.", "Awesome.", "Okay, cool.", "Gotcha.", "Oh nice, okay."]})
    assert R.habits_problems(breezy, reserved)


def test_a_blueprint_stored_before_lead_ins_loads_with_none_and_a_realism_plan_holds_them():
    old = {"acks": ["Okay."] * 5, "backchannels": ["Mm."] * 3, "fillers": {"stage0": ["One moment."]}}
    assert SpeechHabits(**old).lead_ins == []
    plan = R.build_realism(9, R.draw_realism_traits(9, []), "dsa", CLASSIC, AREAS, PROJECTS, 45)
    assert plan.habits.lead_ins and plan.model_dump()["habits"]["lead_ins"] == plan.habits.lead_ins
    assert R.validate_realism(plan, _view()) == []
    broken = plan.model_copy(update={"habits": plan.habits.model_copy(update={"acks": ["Okay."]})})
    assert any("acks" in p for p in R.validate_realism(broken, _view()))


def test_build_realism_uses_the_habits_it_is_given_and_otherwise_draws_them_away_from_the_avoided_ones():
    traits = R.draw_realism_traits(9, [])
    given = R.draw_realism_habits(1234, traits)
    assert R.build_realism(9, traits, "dsa", CLASSIC, AREAS, PROJECTS, 45, habits=given).habits == given
    assert R.build_realism(9, traits, "dsa", CLASSIC, AREAS, PROJECTS, 45).habits == R.draw_realism_habits(9, traits)
    avoided = R.build_realism(9, traits, "dsa", CLASSIC, AREAS, PROJECTS, 45, avoid_habits=[given.model_dump()]).habits
    assert len(R.phrases_of(avoided) & R.phrases_of(given)) <= R.MAX_SHARED


class _Docs(_Coll):
    """Several blueprints, newest first, one per session unless told otherwise."""
    def find(self, q, projection=None):
        from tests.blueprint.test_realism import _Cursor
        return _Cursor(self.docs)


def test_the_store_reads_the_habits_of_a_session_and_of_the_latest_other_rounds():
    traits, h = _persona(5)
    habits = h.model_dump()
    with pytest.MonkeyPatch.context() as mp:
        dropped = {"session_id": "s1", "realism": None, "realism_habits": habits}
        mp.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Docs([dropped])})
        assert asyncio.run(store.habits_for_session("s1")) == habits
        assert asyncio.run(store.recent_habits_for_candidate("c1", "other")) == [habits]
        kept = {"session_id": "s2", "realism": {"seed": 8, "traits": traits, "habits": habits}}
        mp.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Docs([kept])})
        assert asyncio.run(store.habits_for_session("s2")) == habits
        mp.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Docs([{"session_id": "s3"}])})
        assert asyncio.run(store.habits_for_session("s3")) is None and asyncio.run(store.recent_habits_for_candidate("c1", "other")) == []
        two = [{"session_id": "a", "realism_habits": habits}, {"session_id": "b", "realism_habits": habits}, {"session_id": "c", "realism_habits": habits}]
        mp.setattr(store, "get_db", lambda: {store.BLUEPRINTS: _Docs(two)})
        assert len(asyncio.run(store.recent_habits_for_candidate("c1", "other"))) == 2             # the last two only
    assert Blueprint.model_fields["realism_habits"].default is None


def test_a_re_prep_keeps_the_sessions_habits_unless_they_no_longer_fit_and_a_new_session_avoids_the_last_two():
    traits = R.draw_realism_traits(3, [], "classic")
    kept = R.draw_realism_habits(41, traits)
    earlier = R.draw_realism_habits(42, traits)
    recent_calls = []

    async def session_habits(session_id):
        return kept.model_dump()

    async def recent(candidate_id, exclude_session, limit=2):
        recent_calls.append((candidate_id, exclude_session))
        return [earlier.model_dump()]

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(store, "habits_for_session", session_habits)
        mp.setattr(store, "recent_habits_for_candidate", recent)
        assert asyncio.run(pipeline.pick_habits(99, traits, "c1", "s1")) == kept and not recent_calls            # kept: no store read for the others
        # they no longer fit the traits (the persona changed): drawn again, away from the last interviewers
        other = {**traits, "warmth": "reserved", "formality": "formal", "pace": "brisk", "verbosity": "terse"}
        again = asyncio.run(pipeline.pick_habits(99, other, "c1", "s1"))
        assert again != kept and R.habits_problems(again, other) == [] and recent_calls == [("c1", "s1")]
        assert len(R.phrases_of(again) & R.phrases_of(earlier)) <= R.MAX_SHARED

        async def none(session_id):
            return None
        mp.setattr(store, "habits_for_session", none)
        fresh = asyncio.run(pipeline.pick_habits(99, traits, "c1", "s1"))
        assert fresh == R.draw_realism_habits(99, traits, [earlier.model_dump()]) and len(R.phrases_of(fresh) & R.phrases_of(earlier)) <= R.MAX_SHARED

        async def old_block(session_id):
            return {"acks": ["Okay."] * 5, "backchannels": ["Mm."] * 3, "fillers": {"stage0": ["One moment."]}}      # before lead-ins and the vocabulary
        mp.setattr(store, "habits_for_session", old_block)
        assert R.habits_problems(asyncio.run(pipeline.pick_habits(99, traits, "c1", "s1")), traits) == []

        async def boom(*a, **k):
            raise AssertionError("a bench run has no session and reads no store")
        mp.setattr(store, "habits_for_session", boom)
        mp.setattr(store, "recent_habits_for_candidate", boom)
        assert asyncio.run(pipeline.pick_habits(99, traits, "c1", None)) == R.draw_realism_habits(99, traits)


def test_the_persona_prompt_never_names_the_register_to_the_model():
    from app.blueprint import prompts as P

    traits = {**R.draw_realism_traits(1, [], "chat_first"), "register": "indian_english"}
    text = P.persona_prompt({"company": "x"}, ["greeting"], ["Arjun Mehta"], shape_about="a longer, warm chat first", traits=traits)
    assert "Your traits: " in text and "register" not in text and "indian_english" not in text and "warmth " in text
