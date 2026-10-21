"""Who the candidate's words are for (decided 2026-10-19; spec "Addressed to the interviewer"): the run stays quiet when they read the problem aloud
or think aloud, answers when they talk to it, and asks once when it cannot tell."""
import asyncio
import time

from app.interviewer.lines import LINES
from app.interviewer.run import TRAIL_GRACE_S, UNPLAYED_AFTER_S
from tests.interviewer.fakes import say
from tests.interviewer.test_run import _round_with_two_problems, web

READ_ALOUD = ["Given an array of integers nums and an integer target.",
              "An array of integers nums and an integer target, given.",
              "Given integers nums and an array and an integer target."]


class Model:
    """The model that places an utterance: a scripted answer, optionally slow."""

    def __init__(self, answer=None, delay=0.0):
        self.answer, self.delay, self.calls = answer, delay, []

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append(schema_name)
        if self.delay:
            await asyncio.sleep(self.delay)
        return self.answer, {}


async def _round(talk, mode="on", answer=None, delay=0.0):
    run, deps, clock = await _round_with_two_problems(talk)
    run.d.addressed_mode = mode
    run.conductor.consume(run.conductor.pending_orders())       # nothing waits to be said: the replies here are about the words alone
    run.d.conduct_chat = Model(answer, delay)
    run._problem_shown_at = clock()
    return run, deps, clock


async def _ask(run, text):
    """What the adapter does: record the turn, skip it or reply to it. Returns (skipped, pieces)."""
    run.on_user_text(text)
    if run.skip_reply(text):
        return True, []
    pieces = [p async for p in run.reply(text)]
    if pieces:
        run.on_conversation_item("assistant", " ".join(pieces), False)
    for _ in range(5):
        await asyncio.sleep(0)
    return False, pieces


def test_reading_aloud_three_times_gets_no_reply():
    async def go():
        run, deps, _ = await _round([])
        skipped = [(await _ask(run, t))[0] for t in READ_ALOUD]
        return run, skipped

    run, skipped = asyncio.run(go())
    assert skipped == [True, True, True]
    assert run.speaker.replies == 0
    assert len(run.speaker.backchannels) == 1 and run.speaker.backchannels[0] in LINES["addressed:reading"]


def test_unclear_gets_one_checkin_then_nudge_once():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "unclear", "confidence": 0.9})
        skipped, pieces = await _ask(run, "What could zero decode to?")
        replies = run.speaker.replies
        clock.advance(10)
        await run.tick()
        first = list(run.speaker.backchannels)
        clock.advance(30)
        await run.tick()
        return run, skipped, pieces, first, replies

    run, skipped, pieces, first, replies = asyncio.run(go())
    assert not skipped and len(pieces) == 1 and pieces[0] in LINES["addressed:checkin"]
    assert len(first) == 1 and first[0] in LINES["addressed:nudge"]
    assert run.speaker.backchannels == first and run.speaker.replies == replies      # silence is not a question


def test_checkin_answer_thinking_silences_the_problem():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "unclear", "confidence": 0.9})
        await _ask(run, "What could zero decode to?")
        thinking = await _ask(run, "just thinking")
        before = list(run.speaker.backchannels)
        again = await _ask(run, "the digits at the end matter here")      # no ask cue, does not trail off, not the problem's words: still thinking
        clock.advance(TRAIL_GRACE_S + 30)
        await run.tick()
        return run, thinking, again, before

    run, thinking, again, before = asyncio.run(go())
    assert thinking == (True, [])                               # skipped, no sound
    assert again[1] == [] and len(run.addressed.checkin_used) == 1      # no second check-in on this problem
    assert run.speaker.replies == 0 and not run.d.talker_chat.calls     # the talker never ran: "just thinking" really silenced the problem
    assert run.speaker.backchannels == before


def test_checkin_answer_for_me_gets_a_reply():
    async def go():
        run, deps, clock = await _round([say("Go ahead, ask it.")], answer={"addressed": "unclear", "confidence": 0.9})
        await _ask(run, "What could zero decode to?")
        skipped, pieces = await _ask(run, "yes")
        return run, deps, skipped, pieces

    run, deps, skipped, pieces = asyncio.run(go())
    assert not skipped and pieces and deps.talker_chat.calls         # the talker answers; the original question is in the history


def test_model_timeout_question_gets_a_reply_not_silence_or_a_checkin():
    async def go():
        run, deps, clock = await _round([say("Zero decodes to nothing on its own.")], answer={"addressed": "to_interviewer", "confidence": 1}, delay=3.0)
        started = time.monotonic()
        skipped, pieces = await _ask(run, "what could zero decode to?")
        return skipped, pieces, time.monotonic() - started

    skipped, pieces, took = asyncio.run(go())
    assert not skipped and pieces == ["Zero decodes to nothing on its own."]      # a failed check on a question: a normal reply
    assert took < 2.0                                                  # the model's own timeout bounds the wait


def test_reading_does_not_fire_the_constraints_reveal():
    async def go(mode):
        run, deps, _ = await _round([], mode=mode)
        run.on_user_text("Given an array of integers nums and an integer target, give constraints with exactly one answer")
        return run

    run = asyncio.run(go("on"))
    assert not any(o.kind == "reveal_request" for o in run.conductor.pending_orders())
    run = asyncio.run(go("shadow"))                                    # shadow behaves as today
    assert any(o.kind == "reveal_request" for o in run.conductor.pending_orders())


def test_off_mode_changes_nothing():
    async def go():
        run, deps, _ = await _round([], mode="off", answer={"addressed": "unclear", "confidence": 0.9})
        skipped = [(await _ask(run, t))[0] for t in READ_ALOUD]
        return run, skipped

    run, skipped = asyncio.run(go())
    assert run.d.conduct_chat.calls == []                              # no model call
    assert skipped == [True, True, False]                              # today's cap of two skips in a row
    assert run.speaker.backchannels and all(b not in LINES["addressed:reading"] for b in run.speaker.backchannels)


def test_shadow_records_but_replies():
    async def go():
        run, deps, _ = await _round([say("Take your time.")], mode="shadow", answer={"addressed": "thinking_aloud", "confidence": 0.9})
        skipped, pieces = await _ask(run, "And what could zero decode to?")
        for _ in range(5):
            await asyncio.sleep(0)
        return deps, skipped, pieces

    deps, skipped, pieces = asyncio.run(go())
    assert not skipped and pieces == ["Take your time."]                # the talker still replies
    turn = next(t for t in deps.store.turns if t["speaker"] == "candidate" and t["text"].startswith("And what"))
    assert turn["addressed"]["result"] == "thinking_aloud" and turn["addressed"]["mode"] == "shadow" and turn["addressed"]["source"] == "model"


def test_an_owed_question_is_answered_even_when_the_words_lean_to_thinking():
    async def go():
        run, deps, _ = await _round([say("Yes, that works.")], answer={"addressed": "thinking_aloud", "confidence": 0.9})
        run._owed_question = True
        skipped, pieces = await _ask(run, "And what could zero decode to?")
        return skipped, pieces

    skipped, pieces = asyncio.run(go())
    assert not skipped and pieces == ["Yes, that works."]


def test_ask_button_arms_for_15_seconds():
    async def go():
        run, deps, clock = await _round([say("Sure, go on.")])
        thinking = "hmm, let me think about the edge cases"
        await run.on_web_message(web({"type": "ask.interviewer", "at": 1}))
        armed = (await _ask(run, thinking))[0]                         # the button makes it for the interviewer
        await run.on_web_message(web({"type": "ask.interviewer", "at": 2}))
        clock.advance(16)                                              # nothing said for 15 s: the arm has expired
        expired = (await _ask(run, thinking))[0]
        return armed, expired

    armed, expired = asyncio.run(go())
    assert armed is False and expired is True


def test_real_asks_are_answered_in_mode_on():
    async def go(text, typing=False):
        run, deps, clock = await _round([say("Here is a nudge.")], answer={"addressed": "thinking_aloud", "confidence": 0.95})
        if typing:
            run._code_at = clock()
        skipped, pieces = await _ask(run, text)
        return skipped, pieces, run

    for text in ("I think I need a hint", "wait can I get a hint"):
        skipped, pieces, run = asyncio.run(go(text))
        assert not skipped and pieces, text
    for text in ("give me a hint", "I am stuck"):
        skipped, pieces, run = asyncio.run(go(text, typing=True))
        assert not skipped and pieces, text


def test_a_model_that_calls_an_ask_thinking_aloud_gets_a_checkin_not_silence():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "thinking_aloud", "confidence": 0.95})
        return await _ask(run, "okay so can I use extra space")

    skipped, pieces = asyncio.run(go())
    assert not skipped and len(pieces) == 1 and pieces[0] in LINES["addressed:checkin"]


def test_a_later_unclear_after_a_checkin_is_answered_unless_they_said_they_are_thinking():
    async def go():
        run, deps, clock = await _round([say("Zero is not allowed."), say("Sure.")], answer={"addressed": "unclear", "confidence": 0.9})
        await _ask(run, "What could zero decode to?")                       # the check-in
        await _ask(run, "yes")                                              # for me: answered
        skipped, pieces = await _ask(run, "And what about leading zeros?")  # unclear again, the check-in is spent: a normal reply, not silence
        return skipped, pieces

    skipped, pieces = asyncio.run(go())
    assert not skipped and pieces and pieces[0] not in LINES["addressed:checkin"]


def test_no_comma_a_question_is_for_me():
    async def go():
        run, deps, clock = await _round([say("Zero stays zero."), say("Fine.")], answer={"addressed": "unclear", "confidence": 0.9})
        await _ask(run, "What could zero decode to?")
        return await _ask(run, "no, can you give me a hint")

    skipped, pieces = asyncio.run(go())
    assert not skipped and pieces                                           # not read as "just thinking"


def test_ask_button_wins_while_typing_and_after_a_long_question():
    async def go():
        run, deps, clock = await _round([say("Go on."), say("Sure.")])
        run._code_at = clock()                                              # typing right now
        await run.on_web_message(web({"type": "ask.interviewer", "at": 1}))
        first = await _ask(run, "hmm let me think about the edge cases")    # armed: never skipped for typing
        await run.on_web_message(web({"type": "ask.interviewer", "at": 2}))
        run.on_user_state("speaking")                                       # begins within the window...
        clock.advance(20)                                                   # ...and runs past it
        second = await _ask(run, "hmm let me think about the edge cases")
        return first, second

    first, second = asyncio.run(go())
    assert first[0] is False and first[1] and second[0] is False and second[1]


def test_quick_question_arms_the_next_words_like_the_button():
    async def go():
        run, deps, clock = await _round([say("Sure, go ahead."), say("Zero stays zero.")])
        await _ask(run, "quick question")
        return await _ask(run, "hmm let me think about the edge cases")

    skipped, pieces = asyncio.run(go())
    assert not skipped and pieces


def test_an_unplayed_checkin_is_not_spent_and_never_nudged():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "unclear", "confidence": 0.9})
        run.on_user_text("What could zero decode to?")
        pieces = [p async for p in run.reply("What could zero decode to?")]       # said, but the voice never confirms it
        assert pieces and run.addressed.checkin_used and run.addressed.checkin_at is None      # not "played" yet: nothing to answer or nudge
        clock.advance(UNPLAYED_AFTER_S + 1)
        await run.tick()
        clock.advance(30)
        await run.tick()
        return run

    run = asyncio.run(go())
    assert not run.addressed.checkin_used and run.addressed.checkin_at is None      # dropped as unplayed: asked again later, not spent
    assert not any(b in LINES["addressed:nudge"] for b in run.speaker.backchannels)


def test_a_late_answer_is_dropped_when_the_model_says_thinking():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "thinking_aloud", "confidence": 0.95})
        skipped, _ = await _ask(run, "the digits at the end of the")          # trails off, no rule places it
        assert skipped and run._trailed is not None
        clock.advance(TRAIL_GRACE_S + 30)
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run._trailed is None and run.answer_late is None and run.unanswered is None and run.speaker.replies == 0


def test_a_rule_result_is_stored_with_the_turn():
    async def go():
        run, deps, _ = await _round([])
        await _ask(run, "hmm let me think about the edge cases")
        return deps

    deps = asyncio.run(go())
    turn = next(t for t in deps.store.turns if t["speaker"] == "candidate" and t["text"].startswith("hmm let me think"))
    assert turn["addressed"]["result"] == "thinking_aloud" and turn["addressed"]["source"] == "rules"


# ---- follow-up wave (2026-10-20)

INVITE = "Here's your first question. Give it a read, and let me know if you'd like to ask anything."


def test_an_ask_typed_while_coding_is_never_skipped_as_narration():
    async def go(label):
        out = []
        for text in ("is the input sorted", "can I assume the input is sorted", "one doubt, can n be zero", "actually can I switch to java"):
            run, deps, clock = await _round([say("Yes, it is.")], answer={"addressed": label, "confidence": 0.9})
            run._code_at = clock()                                        # typing right now
            out.append(await _ask(run, text))
        return out

    for label in ("to_interviewer", "unclear", "thinking_aloud"):
        for skipped, pieces in asyncio.run(go(label)):
            assert not skipped and pieces, label                           # a reply or the check-in, never silence


def test_after_just_thinking_an_ask_is_answered_not_silenced():
    async def go(label, text):
        run, deps, _ = await _round([say("Yes, sorted.")], answer={"addressed": label, "confidence": 0.9})
        run.addressed.thinking_items.add(run.conductor.current().item_id)
        run.addressed.checkin_used.add(run.conductor.current().item_id)
        return await _ask(run, text)

    for label in ("thinking_aloud", "unclear"):
        for text in ("is the input sorted", "can I assume the input is sorted", "one doubt, can n be zero"):
            skipped, pieces = asyncio.run(go(label, text))
            assert not skipped and pieces and not any(x in LINES["addressed:checkin"] for x in pieces), (label, text)     # answered, not checked in on


def test_after_just_thinking_a_model_unclear_without_an_ask_stays_silent():
    async def go(think):
        run, deps, clock = await _round([], answer={"addressed": "unclear", "confidence": 0.9})
        if think:
            run.addressed.thinking_items.add(run.conductor.current().item_id)
        text = "the digits at the end matter here"
        out = await _ask(run, text)
        clock.advance(TRAIL_GRACE_S + 30)
        await run.tick()
        return out, run

    (skipped, pieces), run = asyncio.run(go(True))
    assert pieces == [] and run.speaker.replies == 0 and not run.d.talker_chat.calls and not run.speaker.backchannels


def test_the_same_words_without_just_thinking_are_checked_in_on():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "unclear", "confidence": 0.9})
        return await _ask(run, "the digits at the end matter here")

    skipped, pieces = asyncio.run(go())
    assert not skipped and len(pieces) == 1 and pieces[0] in LINES["addressed:checkin"]     # so the state above is what silences it


def test_an_invite_makes_the_item_direct_only_and_sends_the_state():
    async def go():
        run, deps, _ = await _round([])
        item = run.conductor.current().item_id
        assert item not in run.addressed.direct_only_items
        run.on_conversation_item("assistant", INVITE, False)
        await run.tick()
        return run, deps, item

    run, deps, item = asyncio.run(go())
    assert item in run.addressed.direct_only_items
    assert [m["direct_only"] for m in deps.workspace.of("addressed.state")] == [True]


def test_direct_only_answers_a_specific_ask_and_silences_the_rest():
    async def go():
        run, deps, clock = await _round([say("Yes, it is sorted.")], answer={"addressed": "unclear", "confidence": 0.9})
        run.on_conversation_item("assistant", INVITE, False)
        murmurs = [await _ask(run, t) for t in ("hmm let me think about the edge cases", "the digits at the end of the", "okay so the first digit")]
        asked = await _ask(run, "is the input sorted")
        return run, murmurs, asked, clock

    run, murmurs, asked, clock = asyncio.run(go())
    assert all(sk is True or pc == [] for sk, pc in murmurs)                # murmur: no reply
    assert not any(b in LINES["addressed:checkin"] for b in run.speaker.backchannels) and run._trailed is None
    assert not asked[0] and asked[1] and not any(x in LINES["addressed:checkin"] for x in asked[1])      # a question is answered, without a check-in


def test_direct_only_never_checks_in_nudges_or_answers_late():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "unclear", "confidence": 0.9})
        run.on_conversation_item("assistant", INVITE, False)
        await _ask(run, "the digits at the end of the")
        clock.advance(TRAIL_GRACE_S + 30)
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run.speaker.replies == 0 and not run.speaker.backchannels
    assert not run.addressed.checkin_used and run.answer_late is None and run._trailed is None


def test_direct_only_reading_gets_no_nod_and_the_new_item_starts_clear():
    async def go():
        run, deps, _ = await _round([])
        run.on_conversation_item("assistant", INVITE, False)
        await _ask(run, READ_ALOUD[0])
        return run

    run = asyncio.run(go())
    assert not run.speaker.backchannels and run.speaker.replies == 0


def test_shadow_records_direct_only_and_off_does_nothing():
    async def go(mode):
        run, deps, _ = await _round([say("Take your time.")], mode=mode, answer={"addressed": "thinking_aloud", "confidence": 0.9})
        run.on_conversation_item("assistant", INVITE, False)
        await _ask(run, "And what could zero decode to?")
        await run.tick()
        return run, deps

    run, deps = asyncio.run(go("shadow"))
    turn = next(t for t in deps.store.turns if t["speaker"] == "candidate" and t["text"].startswith("And what"))
    assert turn["addressed"]["direct_only"] is True and not deps.workspace.of("addressed.state")
    run, deps = asyncio.run(go("off"))
    assert not run.addressed.direct_only_items and not deps.workspace.of("addressed.state")


def test_an_inviting_nudge_turns_direct_only_on_and_keeps_the_checkin_pending():
    async def go():
        run, deps, clock = await _round([], answer={"addressed": "unclear", "confidence": 0.9})
        real = run.conductor.lines.pick
        run.conductor.lines.pick = lambda key: "Let me know if you'd like me to weigh in." if key == "addressed:nudge" else real(key)
        await _ask(run, "What could zero decode to?")
        run._checkin_played()
        clock.advance(15)
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id in run.addressed.direct_only_items and run.addressed.nudged
    assert run.addressed.checkin_at is not None                              # the nudge is not an answer to the check-in


def test_trailing_cue_fragments_are_held_then_answered_late():
    async def go(text):
        run, deps, clock = await _round([say("Yes, you can.")], answer={"addressed": "to_interviewer", "confidence": 0.9})
        run.on_user_text(text)
        skipped = run.skip_reply(text)
        held = run._trailed is not None
        clock.advance(TRAIL_GRACE_S + 30)
        await run.tick()
        return skipped, held, run

    for text in ("so can I assume that the", "what if we take the"):
        skipped, held, run = asyncio.run(go(text))
        assert skipped and held, text
        assert run.answer_late == text or run.speaker.replies >= 1, text        # answered late, not dropped


def test_bare_okay_on_a_direct_only_item_gets_no_reply():
    async def go():
        run, deps, _ = await _round([say("Sure.")], answer={"addressed": "unclear", "confidence": 0.9})
        run.on_conversation_item("assistant", INVITE, False)
        out = []
        for t in ("okay", "sure", "okay got it"):
            out.append(await _ask(run, t))
        return run, out

    run, out = asyncio.run(go())
    assert all(sk or pc == [] for sk, pc in out) and not run.d.talker_chat.calls


def test_direct_only_answers_requests_and_a_low_confidence_model_ask():
    async def go(text, answer):
        run, deps, _ = await _round([say("Sure, here it is.")], answer=answer)
        run.on_conversation_item("assistant", INVITE, False)
        return await _ask(run, text)

    for text in ("explain example two", "repeat that please", "one more time please", "I want to use python for this",
                 "I would prefer to code in java", "the second example, I do not get it"):
        skipped, pieces = asyncio.run(go(text, {"addressed": "unclear", "confidence": 0.9}))
        assert not skipped and pieces, text
    skipped, pieces = asyncio.run(go("the second example", {"addressed": "to_interviewer", "confidence": 0.3}))     # low confidence, raw label counts
    assert not skipped and pieces
    skipped, pieces = asyncio.run(go("now the loop over the string", {"addressed": "unclear", "confidence": 0.9}))
    assert pieces == []


def test_the_next_item_starts_not_direct_only_and_the_state_is_sent():
    async def go():
        run, deps, _ = await _round([])
        run.on_conversation_item("assistant", INVITE, False)
        await run.tick()
        first = run.conductor.current().item_id
        run.conductor.current().turns = 5
        run.conductor.next_item("t")
        assert run.conductor.current().item_id != first
        await run.tick()
        return run, deps, first

    run, deps, first = asyncio.run(go())
    assert first in run.addressed.direct_only_items and run.conductor.current().item_id not in run.addressed.direct_only_items
    assert [m["direct_only"] for m in deps.workspace.of("addressed.state")] == [True, False]


def test_direct_only_answers_requests_typed_over_too():
    async def go(text):
        run, deps, clock = await _round([say("Sure, here it is.")], answer={"addressed": "to_interviewer", "confidence": 0.95})
        run.on_conversation_item("assistant", INVITE, False)
        run._code_at = clock()                                         # typing right now
        return await _ask(run, text)

    for text in ("explain example two", "repeat that please", "one more time please", "I want to use python for this",
                 "I would prefer to code in java", "the second example, I do not get it", "I didn't get that"):
        skipped, pieces = asyncio.run(go(text))
        assert not skipped and pieces, text


# ---------------------------------------------------------------- live round b6280b69 (2026-10-21): silence after "I have typed the solution"


def test_a_completion_statement_right_after_typing_is_never_skipped_as_narration():
    async def go():
        run, deps, clock = await _round([say("Good. Walk me through it.")], mode="shadow")
        run._code_at = clock()                                   # they have just typed
        clock.advance(2)
        return await _ask(run, "Okay, so I have typed the solution.")

    skipped, pieces = asyncio.run(go())
    assert not skipped and pieces


def test_narration_while_typing_is_skipped_stored_with_a_reason_and_answered_once_when_the_typing_stops():
    async def go():
        run, deps, clock = await _round([say("Sure, go on.")], mode="shadow")
        run._code_at = clock()
        clock.advance(1)
        text = "So here I am using a hash map to store the seen values"
        run.on_user_text(text)
        skipped = run.skip_reply(text)
        await asyncio.sleep(0)
        reason = [t.get("skip_reason") for t in deps.store.turns if t["speaker"] == "candidate" and t["text"] == text]
        armed = run._trailed
        clock.advance(5)
        await run.tick()
        early = run.speaker.replies
        clock.advance(12)                                        # CODE_QUIET_S after the last keystroke
        await run.tick()
        first = run.speaker.replies
        await run.tick()
        return skipped, reason, armed is not None, early, first, run.speaker.replies

    skipped, reason, armed, early, first, after = asyncio.run(go())
    assert skipped and reason == ["typing"] and armed and early == 0 and first == 1 and after == 1


def test_a_keystroke_re_arms_the_late_answer_and_a_new_utterance_cancels_it():
    async def go():
        run, deps, clock = await _round([say("Sure.")], mode="shadow")
        run._code_at = clock()
        run.on_user_text("So I am looping over the array here")
        run.skip_reply("So I am looping over the array here")
        clock.advance(10)
        await run.on_web_message(web({"type": "code.snapshot", "version": 1, "text": "x = 1", "language": "python"}))
        armed = run._trailed
        run.on_user_text("and then I return the index")
        return run, armed

    from tests.interviewer.test_run import web
    run, armed = asyncio.run(go())
    assert armed is not None and armed[1] == run._code_at and run._trailed is None
