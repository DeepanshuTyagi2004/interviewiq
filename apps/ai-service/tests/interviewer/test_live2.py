"""Abuse in any wording (user decision, 2026-10-18): a broad screen, then a model check, then the run ends the round with one fixed line."""
import asyncio

import pytest

from app.interviewer.lines import matches
from app.interviewer.llm import LLMUnavailable
from tests.interviewer.fakes import FakeChat, say
from tests.interviewer.test_live1 import ABUSE_END

WARNING = "That kind of language isn't acceptable in an interview. Let's keep it professional."
FLAG_ABUSIVE = (("flag_conduct", {"kind": "abusive", "quote": "shut up"}),)


class Classifier(FakeChat):
    """A scripted conduct classifier: each entry is a verdict dict, an Exception or "hang"."""

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append(messages)
        verdict = self.briefs.pop(0) if self.briefs else {"verdict": "none", "reason": ""}
        if verdict == "hang":
            await asyncio.sleep(3600)
        if isinstance(verdict, Exception):
            raise verdict
        return verdict, {"total_tokens": 5}


def verdict(kind, reason="x"):
    return {"verdict": kind, "reason": reason}


async def round_with(turns, said, classifier=None, timeout=None):
    from tests.interviewer.test_run import make as make_run, speak
    run, deps, _ = make_run(turns, conduct_chat=classifier) if classifier is not None else make_run(turns)
    if timeout is not None:
        run.conduct_timeout_s = timeout
    await run.start(None)
    c = run.conductor
    while c.current().item_id != "core-1":
        c.current().turns = 3
        c.next_item("t")
    calls = len(deps.talker_chat.calls)
    out = await speak(run, said)
    return out, run, deps, calls


def test_a_shut_up_said_to_the_interviewer_ends_the_round_in_one_line_with_no_warning():
    """The 2026-10-18 failure: the talker warned first, then flagged abusive, and the round ended after the warning."""
    out, run, deps, calls = asyncio.run(round_with([say(WARNING, tools=FLAG_ABUSIVE)], "Can you shut up for a second, I'm thinking?"))
    assert len(out) == 1 and matches("abuse_end", out[0]) and run.conductor.ended and len(deps.talker_chat.calls) == calls


@pytest.mark.parametrize("text,ends", [
    ("shut up", True), ("Can you shut up?", True), ("just shut up", True), ("Shut up for a second.", True),
    ("I should shut up and code", False), ("let me shut up and think", False), ("I'll just shut up and write it", False),
])
def test_shut_up_is_abuse_only_when_it_is_said_to_the_interviewer(text, ends):
    from app.interviewer.predicates import directed_abuse
    assert directed_abuse(text) is ends


@pytest.mark.parametrize("text", [
    "fuck, I made a mistake", "this is such bullshit", "you clearly don't know what you're doing", "tu bakwas question hai", "BHENCHOD", "madarchod",
    "you're a bot", "your questions are trash", "I hate you", "get lost", "leave me alone", "this is a joke", "what a moron", "gandu", "saala", "kutte",
    "this is nonsense", "damn it", "you are so pathetic",
])
def test_the_screen_catches_profanity_insults_and_contempt_in_any_wording(text):
    from app.interviewer.predicates import maybe_conduct
    assert maybe_conduct(text), text


@pytest.mark.parametrize("text", [
    "I would use a hash map and iterate once", "Can you repeat the question?", "My name is Deepanshu and I studied at an engineering college",
    "I think the complexity is O(n log n)", "you said the array is sorted, right?", "Thanks, that makes sense",
])
def test_the_screen_leaves_a_normal_sentence_alone(text):
    from app.interviewer.predicates import maybe_conduct
    assert not maybe_conduct(text), text


def test_a_remark_with_no_fixed_phrase_ends_the_round_through_the_model_verdict():
    clf = Classifier(briefs=[verdict("abuse", "contempt for the interviewer")])
    out, run, deps, calls = asyncio.run(round_with([say(WARNING)], "you clearly don't know what you're doing", clf))
    assert len(out) == 1 and matches("abuse_end", out[0]) and run.conductor.ended and len(deps.talker_chat.calls) == calls and len(clf.calls) == 1
    assert run.conductor.conduct[0]["source"] == "model"


def test_a_rude_remark_about_the_question_gets_a_warning_and_the_round_goes_on():
    clf = Classifier(briefs=[verdict("rude", "about the problem")])
    out, run, deps, calls = asyncio.run(round_with([say(WARNING)], "this question is pointless", clf))
    assert not run.conductor.ended and " ".join(out) == WARNING and len(run.conductor.conduct) == 1


def test_swearing_at_themselves_is_screened_but_the_verdict_is_none_so_the_reply_is_normal():
    clf = Classifier(briefs=[verdict("none")])
    out, run, deps, calls = asyncio.run(round_with([say("No problem, take your time.")], "fuck, I made a mistake", clf))
    assert len(clf.calls) == 1 and not run.conductor.ended and not run.conductor.conduct and out == ["No problem, take your time."]


def test_a_normal_sentence_is_never_screened_and_makes_no_classifier_call():
    clf = Classifier()
    out, run, deps, calls = asyncio.run(round_with([say("Okay, go on.")], "I would use a hash map here", clf))
    assert clf.calls == [] and out == ["Okay, go on."]


def test_a_classifier_that_fails_or_times_out_falls_back_to_the_regex_and_the_record_says_so():
    for entry in (LLMUnavailable("down"), "hang"):
        clf = Classifier(briefs=[entry])
        out, run, deps, calls = asyncio.run(round_with([say("Take your time.")], "what the fuck is a monotonic stack", clf, timeout=0.05))
        assert not run.conductor.ended and out == ["Take your time."], entry
        assert run.conduct_check["failed"] is True
    clf = Classifier(briefs=["hang"])
    out, run, *_ = asyncio.run(round_with([say(WARNING)], "you're such an idiot", clf, timeout=0.05))
    assert len(out) == 1 and matches("abuse_end", out[0]) and run.conductor.ended                         # the fast path had already decided


def test_the_conduct_check_latency_is_in_the_turn_record():
    clf = Classifier(briefs=[verdict("none")])
    out, run, deps, calls = asyncio.run(round_with([say("Sure.")], "damn, I forgot the base case", clf))
    spoken = [t for t in deps.store.turns if t.get("speaker") == "interviewer"]
    assert run.conduct_check["ms"] is not None and spoken and spoken[-1]["conduct_check_ms"] == run.conduct_check["ms"]


# ---- A3: the talker never warns and then ends on one remark

def test_the_talker_rule_says_to_say_only_the_fixed_line_for_abuse_aimed_at_it_and_to_warn_for_rudeness_about_the_problem():
    from app.interviewer.prompts import TALKER_RULES
    assert ABUSE_END in TALKER_RULES and "flag_conduct" in TALKER_RULES
    assert "never warn" in TALKER_RULES and "rudeness about the problem" in TALKER_RULES


def test_a_warning_sentence_after_a_flag_of_abusive_is_dropped_in_the_same_turn():
    from app.interviewer.llm import StreamEvent, ToolCall
    from tests.interviewer.test_live1 import collect_after
    from tests.interviewer.test_talker import make
    events = [StreamEvent("tool_call", tool_call=ToolCall("c0", "flag_conduct", {"kind": "abusive", "quote": "shut up"})),
              StreamEvent("text", text=WARNING + " "), StreamEvent("done", usage={}, provider="fake")]
    turn, *_ = make([events])
    assert asyncio.run(collect_after(turn, "shut up")) == []
    assert [b["rule"] for b in turn.last.blocked][:1] == ["warn_after_abuse"]
    assert "keep it professional" not in " ".join(turn.last.spoken)


def test_a_talker_that_says_the_end_line_itself_and_flags_abusive_gives_the_line_once():
    out, run, deps, calls = asyncio.run(round_with([say(ABUSE_END, tools=FLAG_ABUSIVE)], "you people are garbage", Classifier(briefs=[verdict("none")])))
    assert " ".join(out) == ABUSE_END and run.conductor.ended and run.conductor.end_order.consumed
    assert " ".join(out).count("end the interview here") == 1


# ---- B: the outline asks for a yes once, and the first question comes after it (user decision, 2026-10-18; reverses D1 of 2026-10-17)

OUTLINE = ("Here is how this round will run: we'll start with a bit about your background, then a couple of "
           "coding problems, and then time at the end for your questions.")
CHECK = "Does that sound okay?"
INTRO_ASK = "Great — let's start with you. Tell me a bit about yourself."
NEXT = (("next_item", {"reason": "framing done"}),)


async def outline_round(turns):
    """A run on the small talk whose first reply gives the outline; the candidate's replies and the talker's turns follow."""
    from tests.interviewer.test_run import _chat_run, speak
    run, deps, _ = _chat_run(turns)
    await run.start(None)
    c = run.conductor
    c.go_to("small_talk", "t")
    c.current().turns = 3
    return run, deps, c, speak


def test_the_outline_turn_ends_with_the_single_check_and_asks_no_introduction_question():
    async def go():
        run, deps, c, speak = await outline_round([say(OUTLINE, CHECK, "Tell me a bit about yourself.")])
        out = await speak(run, "sure")
        return out, c

    out, c = asyncio.run(go())
    assert out == [OUTLINE, CHECK]                                  # the introduction question after the check was held back
    assert c.current().item_id == "framing" and c.outline_said and c.format_confirm_asked


def test_after_yes_sounds_good_the_next_turn_makes_a_transition_and_asks_for_the_introduction():
    async def go():
        run, deps, c, speak = await outline_round([say(OUTLINE, CHECK), say(INTRO_ASK, tools=NEXT)])
        await speak(run, "sure")
        out = await speak(run, "yes, sounds good")
        return out, c

    out, c = asyncio.run(go())
    assert " ".join(out) == INTRO_ASK and c.current().item_id == "candidate_intro" and c.format_confirm_asked


def test_a_reply_that_already_starts_the_introduction_is_the_answer_and_it_is_not_asked_again():
    said = "okay, so I'm Deepanshu, a 2026 graduate, and I've mostly been building backend services in Node"

    async def go():
        run, deps, c, speak = await outline_round([say(OUTLINE, CHECK),
                                                   say("Nice to meet you, Deepanshu.", "Tell me a bit about yourself.", "What did you own in those services?", tools=NEXT)])
        await speak(run, "sure")
        out = await speak(run, said)
        return out, run, c

    out, run, c = asyncio.run(go())
    assert "Tell me a bit about yourself." not in " ".join(out) and "What did you own in those services?" in out
    assert [b["rule"] for b in run.talker.last.blocked if b["rule"] == "intro_asked_again"]
    assert c.current().item_id == "candidate_intro"


def test_a_second_confirmation_later_is_blocked_and_so_is_one_outside_the_outline_turn():
    async def go():
        run, deps, c, speak = await outline_round([say(OUTLINE, CHECK), say("Okay, let's go on. Does that sound okay?", tools=NEXT)])
        await speak(run, "sure")
        out = await speak(run, "yes")
        return out, run

    out, run = asyncio.run(go())
    assert not any("sound okay" in s for s in out)
    assert "format_confirm" in [b["rule"] for b in run.talker.last.blocked]

    from tests.interviewer.test_talker import make as make_talker
    from tests.interviewer.test_live1 import collect_after
    turn, *_ = make_talker([say("Shall we go ahead?", "What are you working on these days?")])
    assert asyncio.run(collect_after(turn, "hi", framing=True)) == ["What are you working on these days?"]      # no outline in this turn
    assert turn.last.blocked[0]["rule"] == "format_confirm"


def test_shall_we_get_started_is_a_format_check_too():
    from app.interviewer.closing import asks_format_check
    assert asks_format_check("Shall we get started?") and asks_format_check("Does that sound okay?")
    assert not asks_format_check("Let's get started with the first problem.")


def test_the_check_is_allowed_once_as_the_last_sentence_of_the_outline_turn_even_in_one_sentence_with_the_outline():
    from tests.interviewer.test_talker import make as make_talker
    from tests.interviewer.test_live1 import collect_after
    turn, *_ = make_talker([say(OUTLINE, "Shall we get started?")])
    assert asyncio.run(collect_after(turn, "hi", framing=True)) == [OUTLINE, "Shall we get started?"] and turn.last.blocked == []
    turn, *_ = make_talker([say(OUTLINE, CHECK, "Shall we get started?")])
    assert asyncio.run(collect_after(turn, "hi", framing=True)) == [OUTLINE, CHECK]                           # exactly one per round
    assert [b["sentence"] for b in turn.last.blocked] == ["Shall we get started?"]


def test_a_candidate_question_about_the_format_is_answered_before_the_transition():
    async def go():
        answer = "The coding part is most of what we have, then there is time for your questions."
        run, deps, c, speak = await outline_round([say(OUTLINE, CHECK), say(answer, INTRO_ASK, tools=NEXT)])
        await speak(run, "sure")
        out = await speak(run, "how long is the coding part?")
        return out, answer

    out, answer = asyncio.run(go())
    assert out[0] == answer and INTRO_ASK in " ".join(out)         # not held back as the outline given again


def test_the_framing_guidance_ends_with_one_check_and_the_next_turn_guidance_says_what_to_do_with_the_reply():
    from app.interviewer.plan import opening_hint
    from app.interviewer.prompts import item_details
    from tests.interviewer.test_prompts import blueprint
    bp = blueprint()
    bp["arc"].insert(1, {"phase": "framing", "timebox_mins": 1, "scored": False, "guidance": "Tell them how this round will run.", "style": ""})
    item = {"item_id": "framing", "kind": "phase", "phase": "framing", "hint_step": 0, "next_phase": "candidate_intro"}
    first = item_details(bp, item)
    assert "Does that sound okay?" in first and "Shall we get started?" in first and "no introduction question" in first and "do not call next_item" in first
    assert "Does that sound okay?" in opening_hint(bp, "framing", "")
    after = item_details(bp, {**item, "outline_said": True})
    assert "short transition" in after and "answer it first" in after and "do not ask the introduction question again" in after
    assert "never ask whether the format sounds okay again" in after and "call next_item" in after


def test_tracecheck_fails_only_a_second_confirmation_or_one_outside_the_outline_turn():
    from tests.interviewer.test_tracecheck import cand, found, iv, record
    ok = record(iv(1, OUTLINE + " " + CHECK, "small_talk"), cand(2, "sure", "framing"), iv(3, INTRO_ASK, "framing"))
    assert found(ok) == []
    twice = record(iv(1, OUTLINE + " " + CHECK, "small_talk"), cand(2, "sure", "framing"), iv(3, "Okay. Does that sound okay?", "framing"))
    assert found(twice) == [("format_confirmation", 3)]
    outside = record(iv(1, "Shall we go ahead?", "framing"))
    assert found(outside) == [("format_confirmation", 1)]
    asked_question = record(iv(1, OUTLINE + " " + CHECK, "small_talk"), cand(2, "how long is the coding part?", "framing"),
                            iv(3, "The coding part is most of what we have, then there is time for your questions.", "framing"))
    assert found(asked_question) == []                          # answering a format question is not the outline given twice


def test_a_model_abuse_verdict_on_a_remark_not_aimed_at_the_interviewer_only_warns_and_never_ends_the_round():
    """Real-model probes (2026-10-18) judged "Kya bakwas question hai yaar." and "Haha, that's a joke, right? The input can't be empty?" abuse:
    ending is irreversible, so the model may only end a round on a remark that addresses or orders the interviewer."""
    for said in ("Kya bakwas question hai yaar.", "Ugh, this whole round is garbage."):
        clf = Classifier(briefs=[verdict("abuse", "misjudged")])
        out, run, deps, calls = asyncio.run(round_with([say(WARNING)], said, clf))
        assert not run.conductor.ended, said
        assert run.conduct_check["verdict"] == "rude" and "not aimed" in run.conduct_check["reason"]


@pytest.mark.parametrize("text,aimed", [
    ("You clearly don't know what you're doing.", True), ("Tu chutiya hai kya?", True), ("Stop talking and let me think.", True),
    ("Go away.", True), ("Kya bakwas question hai yaar.", False), ("This round is a joke.", False), ("That's a joke, right?", False),
])
def test_aimed_at_them_tells_a_remark_to_the_interviewer_from_one_about_the_round(text, aimed):
    from app.interviewer.predicates import aimed_at_them
    assert aimed_at_them(text) is aimed


def test_the_conduct_check_uses_the_talkers_fast_chat_when_no_conduct_chat_is_given():
    """The director's chat (reasoning on) timed out on 19 of 32 real probes at 1.5 s; the talker's (reasoning off) answers in ~0.8 s."""
    import inspect
    from app.interviewer.run import CONDUCT_CHECK_TIMEOUT_S, InterviewRun
    src = inspect.getsource(InterviewRun._check_conduct)
    assert "self.d.conduct_chat or self.d.talker_chat" in src and CONDUCT_CHECK_TIMEOUT_S == 2.0
