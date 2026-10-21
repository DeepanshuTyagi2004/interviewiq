"""One talker turn (spec §5.1), independent of LiveKit: stream the reply from OpenRouter, pass each
sentence through the leak guard before it is spoken, then run the turn's tool calls. A `look_at_board`
call adds a second generation that sees the whiteboard. Tools run only if the reply wasn't cut off.

A slow model never leaves the candidate in silence: if the first model has not produced a token after
`hedge_after_s`, the fallback model is raced against it (whichever speaks first wins, the other is cancelled),
and the interviewer says short fillers in stages while the wait grows (see fillers.py)."""
from __future__ import annotations

import asyncio
import base64
import re
import time
from contextlib import aclosing
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Collection, Sequence

from app.blueprint.speech_vocab import BARE_PATTERN, BARE_TEXTS, LEAD_IN_PATTERN, VERDICT_PATTERN
from app.interviewer.closing import (has_leave_taking, leads_into_next_part, refers_to_problem, TOOL_LEAK, WRAPS_UP, announces_coding_now, announces_problem, asks_format_check, claims_problem_on_screen_now,
                                     asks_for_introduction, claims_screen_failed, closes_coding_part, announces_leaving, puts_up_problem_again, starts_introduction, gives_outline, leaves_the_part, opens_topic_while_coding,
                                     problem_line_part, says_duration, invites_clarifying, invites_questions_now, says_planned_later, outline_mismatch, refusal_points)
from app.interviewer.fillers import Fillers
from app.interviewer.guard import LeakGuard
from app.interviewer.lines import LINES, SAFETY_KEYS, contains, matches_any
from app.interviewer.predicates import UNREADABLE_BOARD, content_overlap, content_words, echoes, plain, restates, restates_candidate, restates_first, lone_so_paraphrase
from app.interviewer.llm import LLMUnavailable, StreamEvent, ToolCall
from app.interviewer.said import LOOP_AT, SaidTracker
from app.interviewer.tools import FLOW_TOOLS, TOOLS, ToolExecutor

# A warning ("that isn't acceptable", "let's keep it professional"): after abuse aimed at the interviewer the round ends with the fixed line
# alone, so a warning is never said first (2026-10-18: it warned, flagged abusive, and ended on one remark).
WARNS = re.compile(r"\b(?:isn['\u2019]?t|is not|not|never) (?:acceptable|appropriate)\b|\bkeep (?:it|this|things|the conversation) (?:professional|civil|respectful|polite)\b", re.IGNORECASE)
_END_LINES = tuple(plain(x) for key in ("abuse_end", "conduct_end") for x in LINES[key])      # every wording of the endings said alone (directed abuse, repeated conduct)


def _is_end_line(text: str) -> bool:
    """The sentence is (a sentence of) the ending line, in any of its wordings: it may say thank you for their time while their questions wait."""
    return len(plain(text)) > 10 and any(plain(text) in e for e in _END_LINES)

SENTENCE_END = re.compile(r"(?<=[.!?\u3002\uff01\uff1f])\s+")
_I_MEAN = "i mean,"


# A refusal sentence this close (Jaccard of its content words) to an earlier one makes the same point in other words (live round 781a1f0a, turns 27 and 29).
REFUSAL_OVERLAP = 0.6
REFUSAL_MIN_WORDS = 5


def repeats_a_refusal(text: str, earlier: list[str]) -> str:
    """The earlier sentence this one repeats in other words (five or more content words, overlap of at least REFUSAL_OVERLAP), or ''."""
    if len(content_words(text)) < REFUSAL_MIN_WORDS:
        return ""
    return next((e for e in earlier if content_overlap(text, e) >= REFUSAL_OVERLAP), "")


def split_sentences(buffer: str) -> tuple[list[str], str]:
    """The finished sentences of a streamed reply and the unfinished rest. A boundary after an ellipsis is kept when "I mean," follows
    (or may still be arriving): that is a false start and its correction, one sentence for repair_stumble to mend."""
    done, start = [], 0
    for m in SENTENCE_END.finditer(buffer):
        rest = buffer[m.end():].lower()
        if buffer[:m.start()].endswith(("...", "\u2026")) and (rest.startswith(_I_MEAN) or (len(rest) < len(_I_MEAN) and _I_MEAN.startswith(rest))):
            continue
        done.append(buffer[start:m.start()])
        start = m.end()
    return done, buffer[start:]
# Saying a problem is on their screen when none may be shown (the background questions): a promise the candidate would wait on.
# A sentence the model broke off and "corrected" mid-way ("it returns false, no wait, strats... sorry, ...") is a glitch, not speech.
GARBLED = re.compile(r"\bno,? wait\b|\bwait,? no\b|\w(?:\.\.\.|…)\s*(?:sorry|no|I mean)\b|\bsorry,? (?:I mean|strings|that's not)\b", re.IGNORECASE)
# "You found it yourself": the interviewer chose the test input or asked the leading question that led there, so the credit is never theirs to give.
UNEARNED_CREDIT = re.compile(
    r"\b(?:caught|found|spotted|figured|worked|reasoned|got|came|noticed|saw|fixed|solved)\b[^.?!]{0,50}\b(?:yourself|on your own|without (?:me|any (?:help|hint|nudge)|a hint|a nudge|pointing))\b|"
    r"\bwithout me (?:pointing|saying|telling|helping)\b|\bon your own\b", re.IGNORECASE)
# The interviewer's own machinery ("it's the case from my earlier brief") is never said aloud. Ordinary words stay: a hash table's "slot",
# "a brief summary", "the director of the team", "your plan".
HINT_CUE = re.compile(r"\b(?:keep in mind|bear in mind|think about|consider|remember (?:to|that)|what if|how about|hint|make sure|don't forget|watch out|be careful)\b",
                      re.IGNORECASE)
_INTERNAL_BASE = re.compile(
    r"\b(?:blueprint|playbook|conductor|timebox|answer key|hint ladder)\b|\bthe director (?:says|wants|told|ordered|has)\b|"
    r"\b(?:core|reserve)-(?:\d|harder|alternate)\b|\bproblem-\d\b|\b(?:name|string|arguments|parameter)=\"|</?\s*(?:tool|function|invoke|parameter)|"
    r"\b(?:my|our|the|this|that)\s+(?:earlier |original |prepared |internal )?brief\b(?!\s+(?:version|answer|summary|explanation|description|overview|look|introduction|history|moment|pause|note|reply|response|walk))|"
    # Its own decision about the path, said aloud (a rehearsal: "They jumped straight into their intro, so let me take it. ... let me
    # acknowledge and go with the plan."). The decision travels in the tool calls only.
    r"\b(?:go|stick|stay|keep)\s+with\s+the\s+plan\b|\bnote\s+the\s+plan\b|\bthe\s+plan\s+as\s+done\b|\blet me (?:take it|acknowledge)\b|"
    r"^\s*(?:they|he|she)\s+(?:jumped|went)\s+straight\s+(?:in)?to\b|"
    # The plan's bookkeeping said aloud ("Both areas are covered, so let's move on", live round 781a1f0a, turn 56).
    # Statements about areas or topics only, never a question and never parts or items (final review: "What does your loop return once all the items are
    # done?" is coding talk).
    r"\b(?:both|all|the|these|those)\s+(?:areas?|topics?)\b[^.?!]{0,20}\b(?:covered|done)\b(?![^.?!]*\?)|"
    r"\b(?:areas?|topics?)\s+(?:are|is|were|was)\s+(?:all\s+)?covered\b(?![^.?!]*\?)",
    re.IGNORECASE)
# What a model "thinks aloud" instead of saying to the candidate: its reading of the live state, of its last turn, of the plan.
NARRATION = re.compile(
    r"\blive state\b|\bno (?:new |candidate )?(?:candidate )?speech\b|\bmy (?:last|previous) (?:reply|message|turn)\b|"
    r"\bthe greeting (?:is|has|was|still)\b|\bi (?:haven'?t|have not) (?:greeted|asked|heard)\b[^.?!]{0,60}\bso i(?:'ll| will)\b|"
    r"\bi(?:'ll| will) (?:call|use) (?:the )?next[ _]item\b|\bi(?:'ll| will) (?:go|stick) with the [^.?!]{0,30}\bprobe\b|\bi don'?t have a candidate\b|"
    r"\bi(?:'ll| will) (?:start|open) the (?:greeting|round)\b|\bso i(?:'ll| will) (?:drop|ask (?:one|it cleanly)|say hello|take it)\b|"
    r"\bi(?:'ve| have) got to correct myself\b|\bsince the live\b|\bthey (?:have to be|answered my|jumped|went off)\b|"
    r"^\s*(?:their|his|her) (?:last )?(?:reply|answer|message)\b",
    re.IGNORECASE)
# The tool-call cues ("log turn(condition=...") are the interviewer's machinery too, and never spoken.
INTERNAL_WORDS = re.compile(_INTERNAL_BASE.pattern + "|" + TOOL_LEAK.pattern, re.IGNORECASE)


# Any script other than Latin: a live model switched to Chinese mid-interview (b2 strong_fresher). Greek is left out (O(n) talk says theta).
NON_LATIN = re.compile("[\u0400-\u052F\u0530-\u058F\u0590-\u06FF\u0700-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u1000-\u109F\u10A0-\u10FF\u1100-\u11FF"
                       "\u3040-\u30FF\u3100-\u312F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF66-\uFFDC]")


# The interviewer narrating the conversation about the candidate ("They said they're ready, but they didn't actually answer"), or announcing
# its own retry ("let me ask again, differently", "let me rephrase that question for them"). Plain third-person statements about people in the
# problem or their story ("They need the indices", "She asked you to rewrite it") are ordinary speech and are not matched.
_THEY_META = re.compile(r"\b(?:they|he|she)\b[^.?!]{0,40}\b(?:didn'?t|did not) (?:actually |really )?(?:answer|respond)\b|"
                        r"\bsaid (?:they|he|she)(?:'re| are) ready\b|\b(?:they|he|she)(?:'re| are) ready, but\b", re.IGNORECASE)
_META_RETRY = re.compile(r"\blet me (?:ask|rephrase|try|repeat|re-?ask|re-?word) (?:it |that |this |the question )?(?:again|differently)\b|"
                         r"\b(?:rephrase|re-?ask|repeat|re-?word|explain|clarify|put|ask)\b[^.?!]{0,40}\b(?:for|to) them\b", re.IGNORECASE)


def speaks_about_them(sentence: str) -> bool:
    """The interviewer speaks about the candidate instead of to them: "The candidate...", a meta line about what they did or did not answer,
    or a line announcing that it will ask again."""
    s = sentence.strip()
    return bool(THIRD_PERSON.search(s) or _THEY_META.search(s) or _META_RETRY.search(s))


# The model's private reasoning spoken aloud (b4 strong_fresher: a 940-character trace of the candidate's areas; rh_intro_covers_projects: "I should
# prompt them..."). Third person about the candidate while it plans or checks, inline working, and first-person plans "about them".
_ABOUT_THEM = re.compile(r"\b(?:he|she|they)\s+(?:said|has|have|is|are|wrote|didn'?t|did|got|seem(?:s|ed)?|just|named|asked|mentioned|called|traced|typed)\b", re.IGNORECASE)
# "Their trace works either way" (b7 unplanned_story) is the same note to itself as "his areas are wrong": the candidate in the third person.
_THEIR_WORK = re.compile(r"\b(?:his|her|their) (?:code|answer|trace|areas|approach|solution|loop)\b", re.IGNORECASE)
# An instruction from its own rules said aloud ("they named it, don't confirm").
_RULE_ALOUD = re.compile(r"\bdon'?t (?:confirm|deny)\b|\bget out of the way\b", re.IGNORECASE)    # "confirm or deny" is the problem-name rule's
_PLANNING = re.compile(r"\bi should\b|\bi need to\b|\bi(?:'ll| will) (?:prompt|ask|tell) them\b|\blet me (?:check|carefully|reconsider|re-?read|think|continue)\b|"
                       r"\bwhich is an acknowledg\w+\b|\bnothing to react to\b|\bwait\b|\bhmm\b|\bactually\b", re.IGNORECASE)
_PLAN_FOR_THEM = re.compile(r"\bi should (?:prompt|ask|tell) them\b|\bi(?:'ll| will) ask them\b|\blet me ask them\b", re.IGNORECASE)
# Inline working is three or more name=value pairs, a derived value (area=8, min=1) or min(8,7): two pairs are an example said to them
# ("So for i=0, j=1, what's next?"), and a question to them is never working.
_WORKING = re.compile(r"(?:\b[a-z]\w{0,3}\s*=\s*-?\d+[^a-z=]*){3}|\b(?:min|max|width|area|sum|total|best|res|result|ans|count)\s*=\s*-?\d|"
                      r"\b(?:min|max)\(\s*-?\d", re.IGNORECASE)
REASONING_CUT_CHARS = 600           # a turn longer than this that contains any cue is cut back to the sentences before the first cue


def is_reasoning(sentence: str, chars_before: int = 0) -> bool:
    """The sentence is the interviewer's reasoning, not speech: inline working (name=value pairs, min(8,7)), a plan about "them", a sentence on
    their work in the third person, or one about them ("he said", "they have") with a planning or checking cue. After REASONING_CUT_CHARS
    characters of the turn, any cue ("wait", "hmm", "let me check", "I should") is enough."""
    question = sentence.rstrip().endswith("?")
    if ((_WORKING.search(sentence) or _THEIR_WORK.search(sentence)) and not question) or _PLAN_FOR_THEM.search(sentence) or _RULE_ALOUD.search(sentence):
        return True                     # "His areas … are wrong." opened a monologue; "his approach …; how would you compare yours?" asks them
    if _ABOUT_THEM.search(sentence) and _PLANNING.search(sentence):
        return True
    return chars_before + len(sentence) > REASONING_CUT_CHARS and not question and bool(_PLANNING.search(sentence))


def foreign_script(text: str, known: Collection[str] = ()) -> str | None:
    """The non-Latin script in a sentence, or None. Names the candidate gave (their first name, words of their resume) are set aside first;
    what is left counts when more than a fifth of its letters are non-Latin, or it has a run of four such letters."""
    t = text
    if known:
        t = re.sub(r"\w+", lambda m: "" if m.group(0).lower() in known else m.group(0), t)
    letters = [c for c in t if c.isalpha()]
    foreign = [c for c in letters if NON_LATIN.match(c)]
    if not foreign:
        return None
    if len(foreign) / len(letters) > 0.2 or re.search("(?:" + NON_LATIN.pattern + "){4,}", t):
        return foreign[0]
    return None


# They say they cannot see it, or that it is not showing: then the interviewer may talk about the screen failing.
CANNOT_SEE_IT = re.compile(r"\b(?:can'?t|cannot|can not|don'?t|do not|not able to|unable to|couldn'?t) (?:see|find|get)\b|\bnot (?:showing|loading|there|visible)\b|\b(?:blank|empty)\b|"
                           r"\bnothing (?:is )?(?:on|there|showing)\b", re.IGNORECASE)
# The kinds of move on a sentence can announce. A turn makes each at most once: a second announcement of the same move is dropped, while a
# close followed by a sentence that opens any next part is the normal pair ("That wraps up this part. Let's use the rest for your questions.").
_CLOSE = re.compile(r"\bwraps? up\b|\bwrapped up\b|\bthat'?s the coding (?:part )?(?:done|finished|over)\b|\bleave (?:it|this|the \w+) (?:there|here)\b|"
                    r"\bwell done on this one\b|\bout of time\b|\bwe(?:'re| are) done with\b|\blet'?s (?:leave|park|wrap|stop)\b", re.IGNORECASE)
_OPEN_NEXT = re.compile(r"\bmove (?:on|us on|over)\b|\bmoving on\b|\blet'?s move to\b|\blet'?s (?:talk|chat) (?:a bit |more )?about\b|\bnow,? let'?s\b|"
                        r"\blet'?s (?:use|spend) the rest\b", re.IGNORECASE)
_PROBLEM_MOVE = re.compile(r"\b(?:next|another|second|one more) (?:coding )?(?:problem|question)\b", re.IGNORECASE)


def move_kinds(sentence: str) -> set[str]:
    """Which moves the sentence announces: "close" (that wraps up...), "open_next" (let's move on to..., let's talk about...), "coding_now"
    (the coding or a problem is announced; so is moving on to a problem), "outline" (the schedule). The run's own put-up and intro lines
    announce none. A close followed by a move on is the normal pair, so they are different kinds."""
    if problem_line_part(sentence) is not None:
        return set()
    kinds = set()
    if announces_coding_now(sentence) or announces_problem(sentence):
        kinds.add("coding_now")
    if _CLOSE.search(sentence):
        kinds.add("close")
    if _OPEN_NEXT.search(sentence):
        kinds.add("open_next")
        if _PROBLEM_MOVE.search(sentence):
            kinds.add("coding_now")                 # "let's move on to the next problem" and "let's get into the coding now" are one move
    elif _PROBLEM_MOVE.search(sentence) and not kinds:
        kinds.add("coding_now")
    if gives_outline(sentence):
        kinds.add("outline")
    return kinds


def repeats_a_move(sentence: str, earlier: Sequence[str]) -> bool:
    kinds = move_kinds(sentence)
    return bool(kinds) and any(kinds & move_kinds(x) for x in earlier)


# The answer to "is this problem X?" and to "I think this is an X problem" is "Okay \u2014 walk me through how you'd approach it.": it neither
# confirms nor denies. A live round answered a wrong guess ("overlapping intervals", it was a topological sort) with "It might be \u2014 ...".
PROBLEM_GUESS_ANSWER = "Okay \u2014 walk me through how you'd approach it."
PROBLEM_NAME_DODGE = re.compile(r"\bdoesn'?t matter what (?:it|that|this|the problem)(?:'s| is)? (?:is )?called\b|\bconfirm or deny\b", re.IGNORECASE)


# The candidate guesses what the problem is: a name ("is this the course schedule problem?"), a kind ("this is an intervals problem", "looks
# like a graph question", "is this like a topological sort?").
_GUESSES_PROBLEM = re.compile(
    r"\b(?:this|it)(?:'s| is| looks like| seems like| sounds like| feels like)\b[^.?!]{0,40}\b(?:problem|question)\b|"
    r"\b(?:is|isn'?t) (?:this|it|that) (?:like|a|an|the|similar|just|same)\b|"
    r"\b(?:looks?|seems?|sounds?|feels?|reminds me) (?:like|of)\b[^.?!]{0,40}\b(?:problem|question|leetcode)\b|"
    r"\b(?:problem|question)\b[^.?!]{0,20}\b(?:called|named)\b", re.IGNORECASE)
# A sentence that confirms or denies such a guess: "it might be", "that's right, it's an X problem", "not quite, it's a graph problem".
_AFFIRMS_GUESS = re.compile(
    r"\bit (?:might|could|may) (?:well )?be\b|\bcould well be\b|\bmaybe it is\b|"
    r"\b(?:yes|yeah|right|exactly|correct|indeed),? (?:it'?s|it is|this is|that'?s|that is)\b|"
    r"\bthat'?s (?:right|correct|exactly (?:it|right))\b[^.?!]{0,40}\b(?:problem|kind|type|category)\b|"
    r"\b(?:it'?s|it is|this is|that is) not (?:an? |the )?[\w\- ]{0,30}\b(?:problem|question)\b|"
    r"\b(?:it'?s|it is|this is|that is) (?:indeed |basically |essentially |more or less |kind of |sort of )?(?:an? |the )?[\w\- ]{1,30}\b(?:problem|question)\b|"
    r"\bnot quite\b[^.?!]{0,40}\b(?:problem|graph|search|array|tree|interval|dp|dynamic|sort)|"
    r"\b(?:you'?re|you are) (?:close|right|on the right track|not far)\b[^.?!]{0,30}\b(?:problem|kind|type|category)\b", re.IGNORECASE)


def guesses_problem(said: str) -> bool:
    return bool(_GUESSES_PROBLEM.search(said or ""))


def _closes_a_part(sentence: str) -> bool:
    """A sentence that closes the part just spoken about ("that wraps up the coding part", "let's leave it there")."""
    return closes_coding_part(sentence) or bool(move_kinds(sentence) & {"close", "open_next"})


def asks_after_close(question: str, earlier: Sequence[str], problem_text: str = "", said_text: str = "") -> bool:
    """A question about the problem just closed, in the turn that closes it and before any sentence opening the next part. A question
    about anything else (the next part's first question) is never held back."""
    if not question.rstrip().endswith("?"):
        return False
    closers = [n for n, x in enumerate(earlier) if _closes_a_part(x)]
    if not closers or any(leads_into_next_part(x) for x in earlier[closers[-1]:]):
        return False
    return refers_to_problem(question, problem_text, said_text)


# A decline of the editor that sounds like a rule ("I'm not allowed to write in your editor", "my instructions say..."): a person says
# "I'll leave the typing to you."
STIFF_DECLINE = re.compile(r"\bnot allowed to\b|\bmy instructions\b|\bi(?:'m| am) (?:unable|not able) to (?:write|type|edit|add)\b[^.?!]{0,30}\b(?:editor|code|notes?)\b|"
                           r"\bi can(?:'t|not) (?:write|type|edit|add|put)\b[^.?!]{0,30}\b(?:your|the) (?:editor|code|notes?)\b", re.IGNORECASE)


def narrates(sentence: str) -> bool:
    """The sentence is the interviewer's own reasoning or process spoken aloud (third person about the candidate, the live state, its plan)."""
    return bool(speaks_about_them(sentence) or _INTERNAL_BASE.search(sentence) or NARRATION.search(sentence))


# An aborted start the model corrected mid-sentence ("you're the first-name-half mentioned... I mean, you said"): the false start
# is dropped, from the last clause separator before it, so the sentence is spoken as the correction.
_REPAIR = re.compile(r"(?:\.\.\.|\u2026)\s*I mean,\s*", re.IGNORECASE)
_CLAUSE_END = re.compile(r"[\u2014;]\s*|(?<=[.?!])\s+")


def repair_stumble(text: str) -> str:
    """`X — Y... I mean, Z` becomes `X — Z`: Y is the false start. Text without "... I mean," is returned unchanged."""
    m = _REPAIR.search(text)
    if m is None:
        return text
    start = max((c.end() for c in _CLAUSE_END.finditer(text, 0, m.start())), default=0)
    return text[:start] + text[m.end():]
# A link to a topic as if it were already under discussion ("Let me stay on SQL for one more") when it is not. The question after it is good,
# so the link is rewritten rather than the sentence blocked. X is the noun phrase after on/with/to: up to a "for", a punctuation mark or 4 words.
_X = r"(?P<x>[^\s,:.;?!\u2014\u2013-]+(?:\s+[^\s,:.;?!\u2014\u2013-]+){0,3}?)(?=\s+for\b|\s*[,:.;?!\u2014\u2013]|\s+-\s|\s*$)"
_STAY = r"(?:stay|stick|continue|remain)\s+(?:on|with)\s+"
_FOR_A_BIT = r"\s+for\s+(?:one more|a bit|a moment|another)(?:\s+(?:question|one|thing))?\b"
FALSE_LINKS: tuple[tuple[re.Pattern[str], Callable[[re.Match[str]], str], bool], ...] = (
    # (pattern, replacement, whether X must be absent from the whole round, not only the recent turns)
    (re.compile(rf"\b(?P<lead>let me|i'll|i will|i'd like to|i would like to)\s+(?:just\s+)?{_STAY}{_X}{_FOR_A_BIT}", re.IGNORECASE),
     lambda m: f"{'L' if m.group(0)[0].isupper() else 'l'}et me ask you one on {m.group('x')}", False),
    (re.compile(rf"\b(?P<lead>let's|let us)\s+(?:just\s+)?{_STAY}{_X}{_FOR_A_BIT}", re.IGNORECASE),
     lambda m: f"{'L' if m.group(0)[0].isupper() else 'l'}et's do one on {m.group('x')}", False),
    (re.compile(rf"\b(?:(?:staying|sticking)\s+(?:on|with|to)|still on)\s+{_X}(?:\s+for\s+(?:a|one)\s+(?:moment|bit|second|while))?(?=\s*[,:\u2014\u2013]|\s+-\s)", re.IGNORECASE),
     lambda m: f"{'O' if m.group(0)[0].isupper() else 'o'}n {m.group('x')}", False),
    (re.compile(rf"\bone more\s+(?P<prep>on|about)\s+{_X}", re.IGNORECASE),
     lambda m: f"{'A' if m.group(0)[0].isupper() else 'a'} question {m.group('prep')} {m.group('x')}", False),
    (re.compile(rf"\b(?:coming|going)\s+back\s+to\s+{_X}", re.IGNORECASE),
     lambda m: f"{'O' if m.group(0)[0].isupper() else 'o'}n {m.group('x')}", True),
    (re.compile(rf"(?:^|(?<=[,;\u2014\u2013]\s))back\s+to\s+{_X}", re.IGNORECASE),        # a bare "back to X" only where a sentence or clause starts
     lambda m: f"{'O' if m.group(0)[0].isupper() else 'o'}n {m.group('x')}", True),
)
_LINK_FILLER = frozenset("the and for you your this that with one more mentioned about from what how earlier last again asked said question point topic though then here there work background problem itself round interview conversation chat track start original same page code beginning".split())


def _discussed(topic: str, text: str) -> bool:
    """Any word of the topic (three letters or more, bar the function words) appears in the text, as a word. A topic of function words only
    ("what I asked") points back at the conversation itself: nothing to check, so it counts as discussed."""
    if re.match(r"\s*(?:the\s+)?(?:this|that|these|those|same|it)\b", topic, re.IGNORECASE):
        return True                                 # "that idea", "the same topic": it points at what was just said
    text, words = text.lower(), [w for w in re.findall(r"[a-z0-9]{3,}", topic.lower()) if w not in _LINK_FILLER]
    # Whole words ("SQL" is not "SQLite"; a plural or -ing/-ed/-er still counts), and the first five letters of a longer one ("migration" for "migrations").
    return not words or any(re.search(rf"\b{w[:5]}" if len(w) >= 6 else rf"\b{w}(?:s|es|ing|ed|er)?\b" if len(w) >= 4 else rf"\b{w}s?\b", text) for w in words)


def repair_false_link(text: str, recent: str, ever: str) -> str:
    """A "stay on X" / "staying on X," / "one more on X" / "coming back to X" whose X is not in `recent` (the last turns of the
    conversation, this turn so far included) is rewritten as a plain new topic ("let me ask you one on X", "on X,"). "Coming back
    to X" is only a false link when X was never said anywhere in the round (`ever`). Text with no false link is returned unchanged."""
    for pattern, rewrite, whole_round in FALSE_LINKS:
        def sub(m: re.Match[str], rewrite=rewrite, whole_round=whole_round) -> str:
            x = m.group("x")
            return m.group(0) if _discussed(x, ever if whole_round else recent) else rewrite(m)
        text = pattern.sub(sub, text)
    return text


SCREEN_CLAIM = re.compile(r"\bhere(?:'s| is) your (?:first|second|third|next) (?:question|problem)\b|\b(?:on|up on|onto) (?:your|the) screen\b|\bput (?:it|the problem|that|one) (?:up|on)\b|\bpull (?:it|the problem) up\b|\bhave a read\b|\bread (?:it|through it|the problem)\b|\btake a moment to read\b|"
                          r"\b(?:jump|get|move|dive|go|turn)\s+(?:on\s+)?(?:in)?to\s+(?:the|a|our)\s+(?:(?:coding|first|actual|technical)\s+(?:problem|part|question|exercise)|(?:problems?|exercise))\b|"
                          r"\b(?:start|begin|do|tackle)\s+(?:the|a|our)\s+(?:(?:coding\s+)?(?:problem|exercise)|coding\s+part)\b", re.IGNORECASE)
VALUES_ALOUD = re.compile(r"\d|\b(?:hundred|thousand|million|billion|zero)\b", re.IGNORECASE)
# When the candidate also asked about a property ("can the target be zero?") "zero" is an answer; numbers and magnitudes are still limits.
LIMITS_ALOUD = re.compile(r"\d|\b(?:hundred|thousand|million|billion)\b", re.IGNORECASE)
# A limit read out once the constraints are on their screen (decided 2026-10-18): a magnitude word, a long number or a power, or a bound
# ("up to", "between", "at most") with any number after it. A digit in an example they are working through ("3+22") is not one.
_SPOKEN_NUMBER = (r"(?:\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
                  r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)")
LIMITS_SPOKEN = re.compile(r"\b(?:hundred|thousand|million|billion)\b|\d[\d,]{2,}|\d\s*\^|\b10\s*(?:to the|\*\*)|"
                           r"\b(?:up to|at most|at least|no more than|no fewer than|between|ranges? (?:from|between)|bounded by|limited to)\b[^.?!]{0,30}?"
                           + _SPOKEN_NUMBER, re.IGNORECASE)
# Claims about what is on their screen that the interviewer cannot know (it sees the problem it showed, their code and a digest of the pointer).
SCREEN_GUESS = re.compile(r"\b(?:whatever|what(?:ever)?) you(?:'re| are| have|'ve) (?:seeing|looking at|highlighted|selected)\b|"
                          r"\bwhat(?:ever)? you (?:highlighted|selected)\b", re.IGNORECASE)
# Saying it cannot see what they highlighted is what the rules ask for, not a guess about their screen: a live round had exactly
# that sentence blocked and fell back to "Could you say a bit more about that?".
CANNOT_SEE = re.compile(r"\b(?:can'?t|cannot|can not|don'?t|do not|not able to|unable to) see\b", re.IGNORECASE)
ASKS_RESTATE = re.compile(r"\b(?:restate|re-state|(?:hear|say|tell me|give me) (?:it|the problem|that)? ?back|back in your own words|\bproblem\b[^.?!]{0,30}\bin your (?:own )?words|\bin your (?:own )?words\b[^.?!]{0,30}\bproblem\b|\bhear(?:d)? the problem\b|\bunderstood the problem\b|\bunderstanding of the problem\b|say (?:it|the problem|that) back|repeat (?:the|that) problem|(?:put|say) (?:the problem|it|that) in your own words)\b", re.IGNORECASE)
INSIGHT_PRAISE = re.compile(r"\b(?:that'?s|exactly|precisely) (?:exactly |precisely )?the (?:idea|insight|key)\b|\bthat'?s the (?:right|key) (?:idea|insight)\b", re.IGNORECASE)
VERDICT = re.compile(r"^\W*(?:yes|right|exactly|correct|perfect|great|good|nice|well done)\b|\b(?:that'?s (?:right|correct|exactly|it)|is correct|looks (?:right|correct)|spot on)\b", re.IGNORECASE)
# One acknowledgement per turn: a sentence that evaluates or acknowledges what the candidate said. The persona rehearsals' DeepSeek wrote
# two of them in 20 of 447 turns ("That's a solid split. That's a thoughtful split."), a single generation nothing regenerates.
_EVALUATIVE = (r"(?:right|correct|good|great|nice|solid|clean|sensible|fair|mature|candid|thoughtful|reasonable|accurate|smart|clear|strong|"
               r"honest|useful|neat|well-reasoned)")
_THAT_IS = re.compile(rf"^\W*(?:(?:thanks|thank you)\b[^.?!\u2014]{{0,30}}[\u2014-]\s*)?(?:that'?s|that is|this is)\s+(?:(?:a|an)\s+)?"
                      rf"(?:[\w'-]+,?\s+){{0,2}}?{_EVALUATIVE}\b", re.IGNORECASE)
# Not about their answer: a thanks ("that's kind of you") is counted on its own, "the kind of" and "a good place to pause" are not.
_KIND_OF_YOU = re.compile(r"\bthat'?s kind of you\b", re.IGNORECASE)
_NOT_ABOUT_ANSWER = re.compile(r"^\W*(?:that'?s|that is|this is)\s+(?:the kind of\b|(?:a|an)\s+(?:good|great|nice)\s+(?:place|moment|time|point|spot|question)\s+(?:to|for)\b)",
                               re.IGNORECASE)
_ACK_OPENER = re.compile(r"^\W*(?:nice|good|great|solid|fair|makes sense|got it|understood)\b", re.IGNORECASE)
# The verdict acknowledgements of the speech vocabulary (app/blueprint/speech_vocab.py: "Love that.", "Well said.", "Oh nice, okay."), as the opening of a sentence.
_VOCAB_VERDICT = re.compile(rf"^\W*{VERDICT_PATTERN}\b", re.IGNORECASE)
_TRANSITION = re.compile(r"^\W*(?:(?:alright|all right|okay|ok),?\s+(?:let'?s|let me)\b|now\b|so\b|let me\b|let'?s\b|moving on\b)", re.IGNORECASE)


_ACK_LEAD = re.compile(r"^\W*(?:great|good|nice|right|yes|perfect|exactly|okay|ok|alright|all right|thanks|thank you)\b[\s,.\u2014\u2013-]*", re.IGNORECASE)
ASKS_SOMETHING = re.compile(r"^(?:tell|walk|show|try|give|let'?s|let me|go ahead|can you|could you|what|how|why|when|which)\b|\?\s*$", re.IGNORECASE)


# The interviewer saying it did not hear what they said.
MISSED_IT = re.compile(r"\b(?:didn'?t|did not) (?:quite )?(?:catch|get|hear)\b|\bmissed (?:that|the last)\b", re.I)


def ACKNOWLEDGES(sentence: str) -> bool:
    """The sentence acknowledges or evaluates what the candidate said: the verdict openers, "That's/This is a <word> <evaluative word>", or
    "Nice/Good/Great/Solid/Fair/Makes sense/Got it/Understood". A question and a transition ("Alright, let's...", "Now", "So", "Let me",
    "Moving on") never count."""
    text = sentence.strip()
    if not text or text.endswith("?") or _TRANSITION.search(text) or _NOT_ABOUT_ANSWER.search(text):
        return False
    return bool(VERDICT.search(text) or _THAT_IS.search(text) or _KIND_OF_YOU.search(text) or _ACK_OPENER.search(text) or _VOCAB_VERDICT.search(text))


# The verdict budget: a sentence that opens with an evaluative verdict. "Okay", "Got it", "Makes sense", "Fair", "Sure", "Alright" and "Mm"
# are neutral acknowledgements and never one. The clause up to the first comma or dash is the verdict.
_VERDICT_OPENER = re.compile(rf"^\W*(?:(?:that'?s|that is|this is)\s+(?:(?:a|an)\s+)?(?:[\w'-]+,?\s+){{0,2}}?{_EVALUATIVE}\b|"
                             r"(?:yes|right|exactly|correct|perfect|great|good|nice|solid|well done)\b|" + VERDICT_PATTERN + r"\b)", re.IGNORECASE)
# Praise for their background or answer, anywhere in a sentence ("Ah, got it \u2014 ..., that's a solid mix of product work", live round
# 781a1f0a, turns 9/14/41/43): the interviewer does not grade what the candidate is, whichever word the sentence opens with.
STOCK_PRAISE = re.compile(r"\b(?:that'?s|that is|this is|what)\s+(?:a|an)\s+(?:(?:really|very|pretty)\s+)?(?:solid|great|clean|excellent|strong|nice)\b", re.I)
# A lead-in before the real opening of a sentence ("Ah, got it \u2014 that's exactly right"); it hides a verdict from the ^-anchored detectors.
_LEAD_IN = re.compile(r"^\W*(?:(?:ah|oh|okay|ok|right|alright|sure|yeah|mm|hmm)(?:,?\s*got it)?|got it|i see|understood)\s*[,.\u2014\u2013-]\s+", re.IGNORECASE)


def strip_lead_in(sentence: str) -> str:
    """The sentence without a leading "Ah, got it \u2014" / "Okay," / "I see." when three or more words remain, else unchanged."""
    text = sentence.strip()
    m = _LEAD_IN.match(text)
    rest = text[m.end():].strip() if m else text
    return rest if m and len(rest.split()) >= 3 else sentence


_VERDICT_CLAUSE = re.compile(r"[,;\u2014\u2013]|\s-\s")
NEUTRAL_ACK = re.compile(r"^\W*(?:okay|ok|mm+,?(?:\s+okay)?|hmm+,?(?:\s+okay)?|okay,?\s+cool|got it|alright|all right|sure|fair(?:\s+enough)?|makes sense|understood|i see|"
                         + BARE_PATTERN + r")\W*$", re.IGNORECASE)         # ...and every neutral acknowledgement and backchannel of the speech vocabulary
_CONFIRMS = re.compile(r"^\W*(?:(?:that|this|your (?:trace|code|answer|query|walkthrough))(?:'s| is)?(?:\s+\w+)?\s+(?:is\s+)?(correct|right)\b|(correct|right|exactly)\b)",
                       re.IGNORECASE)


def strip_verdict(sentence: str) -> str | None:
    """What is left of the sentence once its verdict opener is taken off: None when it does not open with a verdict, "" when it only
    evaluates ("That's correct.", "Exactly right \u2014 nice work."), else the rest with a capital: a question or request ("And what about
    duplicates?") or a fact of three words or more ("Yes, the input is always valid." gives "The input is always valid.")."""
    text = sentence.strip()
    if NEUTRAL_ACK.match(text) or _TRANSITION.search(text) or _NOT_ABOUT_ANSWER.search(text) or not _VERDICT_OPENER.search(text):
        return None
    cut = _VERDICT_CLAUSE.search(text)
    rest = text[cut.end():].strip() if cut else ""
    fact = len(rest.split()) >= 3 and re.search(rf"\b{_EVALUATIVE}\b", rest, re.IGNORECASE) is None
    if not rest or not (ASKS_SOMETHING.search(rest) is not None or fact):
        return ""
    return rest[0].upper() + rest[1:]


def opens_with_verdict(sentence: str) -> bool:
    """The sentence opens with an evaluative verdict (not a neutral acknowledgement): what the verdict budget counts."""
    return strip_verdict(sentence) is not None or strip_verdict(strip_lead_in(sentence)) is not None


def confirmation_of(sentence: str) -> str | None:
    """The bare confirmation a sentence opens with ("Right." / "That's correct."), or None."""
    m = _CONFIRMS.search(sentence)
    if m is None:
        return None
    return "That's correct." if (m.group(1) or m.group(2)).lower() == "correct" else "Right."


# Live round c8e70bb8: an approach said outside a recorded hint (turn 62, "a plain nested-loop version that checks each pair"), and a hint that
# graded the candidate's idea (turn 49, "the memo isn't quite enough" when the ladder's next step was that very idea).
APPROACH_SUGGESTION = re.compile(
    r"\b(?:plain|brute[- ]?force|simple|naive|nested[- ]loop|two[- ]loop)\s+(?:version|approach|solution)\b|"
    r"\bchecks?\s+each\s+pair\b|"
    r"\btry\s+(?:sorting|a\s+hash\s?map|binary\s+search|dp|dynamic\s+programming|recursion)\b", re.IGNORECASE)
ANNOUNCES_CODING = re.compile(
    r"\blet(?:'|\u2019)?s\s+(?:now\s+)?(?:get|move|go|dive|jump|turn|switch)\b(?!\s+back)[^.?!]{0,20}\b(?:to|into|onto)\b[^.?!]{0,12}\bcoding\b|"
    r"\btime\s+(?:for|to)\b[^.?!]{0,12}\bcoding\b|\bmove\s+on\s+to\b[^.?!]{0,12}\bcoding\b", re.IGNORECASE)
# The terms an approach sentence can be built from; one the candidate used themselves (any form) makes it their own approach, not a hint.
APPROACH_TERMS = {t: re.compile(rx, re.IGNORECASE) for t, rx in {
    "brute": r"\bbrute", "nested": r"\bnested", "loop": r"\bloops?\b", "pair": r"\bpairs?\b", "hash": r"\bhash", "sort": r"\bsort",
    "binary": r"\bbinary", "dp": r"\bdp\b|\bdynamic", "recursion": r"\brecurs", "pointer": r"\bpointers?\b", "window": r"\bwindow",
    "plain": r"\bplain\b", "simple": r"\bsimple\b", "naive": r"\bnaive\b"}.items()}
PRAISES_THEIRS = re.compile(r"\b(?:that(?:'|\u2019)s|that is|your|it(?:'|\u2019)s|this is|you(?:'ve| have)? (?:got|chose|picked))\b", re.IGNORECASE)
JUDGES_THEIR_IDEA = re.compile(
    r"\b(?:isn(?:'|\u2019)t|is\s+not|aren(?:'|\u2019)t)\s+(?:quite\s+)?enough\b|\bwon(?:'|\u2019)t\s+work\b|\bdoes(?:n(?:'|\u2019)t|\s+not)\s+(?:quite\s+)?work\b|"
    r"\bnot\s+quite\s+right\b|\bdoesn(?:'|\u2019)t\s+(?:quite\s+)?capture\b|\bthat(?:'|\u2019)s\s+wrong\b", re.IGNORECASE)


# Describing code that is not there (p18/smoke/strong_fresher: "I see you've already written the two-pointer solution" over an empty editor).
_CODE_NOUN = r"(?:code|stub|solution|function|implementation)"
_CODE_CLAIM = re.compile(
    rf"\byou(?:'ve| have)\s+(?:already\s+)?(?:written|coded|typed|implemented)\b|"
    rf"\bi see\b[^.?!]{{0,30}}\b(?:on (?:the|your) screen|in (?:the|your) editor)\b[^.?!]{{0,20}}\byou(?:'ve| have)\b|"
    rf"\bi(?:'ve| have)\s+seen\b[^.?!]{{0,30}}\b{_CODE_NOUN}\b|\bi can see\b[^.?!]{{0,30}}\b{_CODE_NOUN}\b|"
    rf"\blooking at (?:the|your) {_CODE_NOUN}\b|"
    r"\byour (?:code|stub|implementation)\s+(?:returns?|handles?|does|looks?|is|has|uses?|loops?|checks?|works?)\b|"
    r"\b(?:trace|run|walk me through|walk through)\b[^.?!]{0,25}\byour\b[^.?!]{0,15}\b(?:code|stub|implementation|function)\b|\bin your code\b",
    re.IGNORECASE)
_HYPOTHETICAL = re.compile(r"\b(?:once|when|whenever|after|before|if|until|as soon as)\b", re.IGNORECASE)


_STILL_TO_COME = re.compile(r"\b(?:once|when|after|if|until|as soon as)\b[^.?!]{0,20}\b(?:done|finished|ready|written|have it|got it)\b", re.IGNORECASE)


def claims_code(sentence: str) -> str | None:
    """The words in which the sentence says they wrote code or describes their code, or None. "Once you've written it, ..." (a
    hypothetical) is not a claim."""
    m = _CODE_CLAIM.search(sentence)
    if m is None or _HYPOTHETICAL.search(sentence[:m.start()]) or _STILL_TO_COME.search(sentence[m.end():]):
        return None
    return m.group(0)


ASKS_CODE_AGAIN = re.compile(r"\bimplement\b|\blet'?s see (?:it|that) as code\b|\bwrite (?:out )?(?:the|your|a) (?:whole |full )?(?:function|solution|code)\b", re.IGNORECASE)
ANNOUNCES_SILENCE = re.compile(r"\bi(?:'ll| will|'m going to) (?:stay|keep|be) (?:quiet|silent)\b|\bi(?:'ll| will) (?:just )?(?:be )?watch(?:ing)?\b|"
                               r"\bi(?:'ll| will) (?:let you|leave you to)\b", re.IGNORECASE)
GO_AHEAD = re.compile(r"\bgo ahead and (?:start |begin )?(?:writ|cod|typ)\w*|\bstart (?:writing|coding)\b|\bwrite it out\b", re.IGNORECASE)
TAKE_YOUR_TIME = re.compile(r"\btake your time\b", re.IGNORECASE)
# Time pressure the round does not have: a live round said "we're nearly out of time" at ten minutes of 45 (the director scripted it).
TIME_PRESSURE = re.compile(r"\b(?:(?:nearly|almost|running|about|close to) out of time|out of time|short (?:on|of) time|(?:running|run|pressed) (?:short|low) "
                           r"(?:on|of) time|tight on time|(?:not|isn'?t) (?:much|a lot of) time(?: left)?|(?:little|limited) time left|time is (?:almost |nearly )?up|"
                           r"coming up on (?:time|the end)|(?:nearly|almost) (?:at|out of) (?:time|the end))\b", re.IGNORECASE)
# A verdict on the whole interview ("the clearest thing you gave today"): the report gives that, never the interviewer.
# A mock round has no team behind it: a live closing said "someone from the team will be in touch about next steps".
NEXT_STEPS_PROMISE = re.compile(r"\b(?:will|'ll) be in touch\b|\bnext steps\b|\b(?:get|getting) back to you\b|"
                                r"\bhear (?:back )?from (?:us|the team|them|someone)\b|\bsomeone (?:from|on) (?:the|our) team\b", re.IGNORECASE)
# The promises that a person follows up: the same alternatives without "next steps", which is true when it is said of the platform.
PEOPLE_FOLLOW_UP = re.compile(r"\b(?:will|'ll) be in touch\b|\b(?:get|getting) back to you\b|"
                              r"\bhear (?:back )?from (?:us|the team|them|someone)\b|\bsomeone (?:from|on) (?:the|our) team\b", re.IGNORECASE)
# "you'll see the next steps there" after the feedback is on the platform is the real next step; a live closing was cut to a bare thanks
# because of it (live round 781a1f0a, turn 58).
PLATFORM_NEXT = re.compile(r"\b(?:on|in) (?:the|your) (?:platform|report|dashboard)\b|\byour (?:report|feedback|debrief)\b", re.I)
# Brush-offs and vague extra transitions: a live round left the coding with "I'll leave you with that. Let's move to another part,
# you can think about that offline." before the prescribed "That wraps up the coding part." and one question.
DISMISSIVE = re.compile(r"\bi'?ll leave you with (?:that|this|it)\b|\b(?:think|work) (?:about|on) (?:it|that|this) (?:offline|later|after\b)",
                        re.IGNORECASE)
VAGUE_MOVE = re.compile(r"\blet'?s (?:move|go|switch|jump) (?:on )?to (?:another|a different|some other) (?:part|topic|thing)\b|"
                        r"\blet'?s move on to something else\b", re.IGNORECASE)
# A claim that the candidate's audio or line is dropping (bf82d318 turns 5-11: Deepgram heard "Vibe" as "by", "five five" and "pause in five" and the
# interviewer said "the audio seems to keep dropping on your side" for 70 seconds). Transcripts were arriving: it was a mishearing, not a dropout.
# Said only when a real connection event happened (they left the room and came back); otherwise the sentence becomes UNCLEAR_REPLY.
_LINK = r"(?:audio|connection|network|signal|mic(?:rophone)?|internet|call)"
_FAULT = (r"(?:cut(?:ting)?\s+(?:off|out)|drop(?:ping|ped|s)?(?:\s+out)?|break(?:ing|s)?\s+up|broke(?:n)?\s+up|chopp(?:y|ing)|patchy|unstable|"
          r"garbled|crackl\w+|lagg?(?:y|ing)|poor|bad|weak|flaky|shaky)")
# "the line" is also a line of their code, so it only counts as the connection with the verbs a dropout has ("the line cut off", "the line keeps dropping").
CLAIMS_LINE_DROPPING = re.compile(
    rf"\b{_LINK}\b[^.?!]{{0,40}}\b{_FAULT}\b|\b{_FAULT}\s+(?:audio|line|connection|network|signal|mic(?:rophone)?|internet)\b|"
    r"\bthe line\b(?:\s+(?:is|was|has|keeps?|kept|just|seems?(?:\s+to)?|got|getting|still))*\s+(?:cut(?:ting)?|drop(?:ping|ped)?|break(?:ing)?|breaks)\b|"
    r"\b(?:cut(?:ting)?|dropp(?:ing|ed)|break(?:ing)?)\s+(?:out|off|up)\b[^.?!]{0,30}\b(?:your (?:side|end)|on your)\b|"
    r"\b(?:didn'?t|did not|doesn'?t|isn'?t)\s+(?:quite\s+)?come\s+through\b", re.IGNORECASE)
UNCLEAR_REPLY = LINES["unclear"][0]      # the first wording of the pool (lines.py); the run says a random one, and every wording counts as said
_DASH_TAIL = re.compile(r"[\u2014\u2013;]\s*|\s-\s")


def repair_line_claim(text: str, line: str = UNCLEAR_REPLY) -> str:
    """The sentence that blames the line becomes `line` (a wording of the "unclear" pool); what follows a dash in it ("...the line cut off \u2014 which
    project was it?") stays."""
    hit = CLAIMS_LINE_DROPPING.search(text)
    tail = _DASH_TAIL.search(text, hit.end()) if hit is not None else None
    rest = text[tail.end():].strip() if tail is not None else ""
    return line + (" " + rest[0].upper() + rest[1:] if rest else "")
ROUND_VERDICT = re.compile(r"\b(?:clearest|best|strongest|weakest)\b[^.?!]{0,50}\b(?:you(?:'ve)? (?:gave|given|said|shown|showed|did|done)|today|"
                           r"in this (?:interview|round))\b|\byou(?:'ve)? (?:did|done|been doing) (?:really |very |pretty )?(?:well|great|good|fine)\b"
                           r"[^.?!]{0,30}\b(?:today|so far|overall|in this (?:interview|round))\b|\b(?:overall|all in all),? you(?:'ve)? (?:did|done)\b",
                           re.IGNORECASE)
# A whole reply that only acknowledges or only promises ("Sure, let me clarify that.", "Got it."): to a real answer it says nothing,
# and the candidate waits for the thing promised (rehearsal rh4). Held until the reply ends; spoken at once when anything follows it.
# (the persona's own acknowledgements are in it too, lines.py / the realism vocabulary: "Fair enough.", "Makes sense.", "Hmm, okay.", "Okay, cool.", "Nice.")
_BARE_PROMISE = (r"(?:let me|i'?ll|i will|allow me to)\s+(?:just\s+)?(?:clarify|pull|bring|look|check|explain|think|see|get|find|show|put|say|rephrase|expand)\b"
                 r"(?:\s+(?:that|this|it|those|them|these))?(?:\s+(?:up|out|over|for you|more|again|a bit|better|properly))*")
# What may follow a run of acknowledgements in an empty reply: a bare promise ("let me check that") after optional separators, then anything that is no word.
_AFTER_ACKS = re.compile(rf"(?:[\s,.!;-]*(?:{_BARE_PROMISE})\W*|\W*)$", re.IGNORECASE)
_PROMISE_ONLY = re.compile(rf"\W*(?:{_BARE_PROMISE})?\W*$", re.IGNORECASE)
_PROMISE_TAIL = re.compile(rf"(?:{_BARE_PROMISE})\W*$", re.IGNORECASE)


class _AckRun:
    """A text made only of acknowledgements ("Okay, cool. Mm-hmm."), found by walking its words through a trie of the acknowledgements, so the time is
    linear in the text. (Today's regex for it, `ACK(sep ACK)*`, tried every way a run could be split once the vocabulary held phrases that are also
    two smaller ones ("Mm-hmm" is a phrase, `mm-?hmm?`, and "Mm" beside "hmm"): "Mm-hmm, " x19 took 1.7 s on the live event loop.)

    The acknowledgements are today's words (below) and every neutral acknowledgement and nod of the speech vocabulary; words inside one are joined by
    the separators of the vocabulary (`speech_vocab`), or by one space for today's two-word ones; acknowledgements by `[\\s,.!;-]+`. With `empty`, the
    text may also end in a bare promise ("Sure, let me clarify that.") or be nothing at all, as `EMPTY_ACK` did. `.match(text)` answers True or False."""

    WORD = re.compile(r"\w+(?:['\u2019]\w+)*")
    INSIDE = re.compile(r"[\s,.;:!\u2014\u2013-]+")           # between the words of a vocabulary phrase (speech_vocab._SEPARATOR)
    BETWEEN = re.compile(r"[\s,.!;-]+")                        # between two acknowledgements
    ELONGATED = re.compile(r"hmm+")                            # today's "hmm+": one word of any length
    TODAY = (("sure",), ("okay",), ("ok",), ("alright",), ("all", "right"), ("right",), ("got", "it"), ("understood",), ("i", "see"), ("of", "course"),
             ("absolutely",), ("sounds", "good"), ("good",), ("great",), ("fine",), ("yes",), ("yeah",), ("thanks",), ("thank", "you"), ("mmhm",), ("mmhmm",),
             ("fair", "enough"), ("makes", "sense"), ("cool",), ("nice",))
    HYPHENATED = (("mm", "hm"), ("mm", "hmm"))                 # today's `mm-?hmm?` with its hyphen

    def __init__(self, empty: bool) -> None:
        self.empty = empty
        self.trie: dict = {}                                            # every acknowledgement; an edge is (word, gap mode), mode 0: a separator of the
        self.today: dict = {}                                           # vocabulary, 1: one space, 2: one hyphen; `today` holds today's words alone
        entries = [(self._words(t), 0, False) for t in BARE_TEXTS] + [(w, 1, True) for w in self.TODAY] + [(w, 2, True) for w in self.HYPHENATED]
        for words, mode, today in entries:
            for root in ((self.trie, self.today) if today else (self.trie,)):
                node = root
                for i, word in enumerate(words):
                    node = node.setdefault((word, mode if i else -1), {})    # the first word has no gap before it
                node[None] = True                                              # a whole acknowledgement ends here

    @classmethod
    def _words(cls, text: str) -> tuple[str, ...]:
        return tuple(m.group(0).lower().replace("\u2019", "'") for m in cls.WORD.finditer(text))

    def _ends(self, words: list[str], gaps: list[str], start: int):
        """The word indexes at which an acknowledgement that begins at `start` can end (exclusive)."""
        if self.ELONGATED.fullmatch(words[start]):
            yield start + 1
        stack = [(self.trie, start)]
        while stack:
            node, i = stack.pop()
            if i > start and None in node:
                yield i
            if i >= len(words):
                continue
            if i == start:
                child = node.get((words[i], -1))
                if child is not None:
                    stack.append((child, i + 1))
                continue
            gap = gaps[i]
            for mode in (0, 1, 2):
                child = node.get((words[i], mode))
                if child is not None and (self.INSIDE.fullmatch(gap) if mode == 0 else gap == (" " if mode == 1 else "-")):
                    stack.append((child, i + 1))

    def _glued(self, spans: list[tuple[int, int, str]], gaps: list[str], start: int) -> list[int]:
        """Where today's words end inside the word they are glued to ("Sure" in "SureLet me clarify that"): the character positions, for the one case
        today's regex read, a promise right after an acknowledgement with no separator (today's words have no word boundary at their end)."""
        found: list[int] = []
        first = spans[start][2]
        if (m := self.ELONGATED.match(first)) is not None and m.end() < len(first):
            found.append(spans[start][0] + m.end())
        stack = [(self.today, start)]
        while stack:
            node, i = stack.pop()
            if i >= len(spans):
                continue
            word = spans[i][2]
            for key, child in node.items():
                if key is None:
                    continue
                w, mode = key
                if (mode == -1) != (i == start) or (i > start and gaps[i] != {1: " ", 2: "-"}.get(mode)):
                    continue
                if word == w:
                    stack.append((child, i + 1))
                elif word.startswith(w) and None in child:
                    found.append(spans[i][0] + len(w))
        return found

    def match(self, text: str | None) -> bool:
        text = text or ""
        spans = [(m.start(), m.end(), m.group(0).lower().replace("\u2019", "'")) for m in self.WORD.finditer(text)]
        if not spans:
            return self.empty                                              # nothing but punctuation: an empty reply, not an acknowledgement
        words = [w for _, _, w in spans]
        gaps = [""] + [text[spans[i - 1][1]:spans[i][0]] for i in range(1, len(spans))]
        n = len(words)
        reach = [False] * (n + 1)
        reach[0] = True
        for t in range(n):
            if not reach[t] or (t and not self.BETWEEN.fullmatch(gaps[t])):
                continue
            for e in self._ends(words, gaps, t):
                reach[e] = True
        if not self.empty:
            return reach[n]
        if _PROMISE_ONLY.match(text) is not None or any(reach[e] and _AFTER_ACKS.match(text, spans[e - 1][1]) for e in range(1, n + 1)):
            return True
        return any(reach[t] and (t == 0 or self.BETWEEN.fullmatch(gaps[t])) and any(_PROMISE_TAIL.match(text, pos) for pos in self._glued(spans, gaps, t))
                   for t in range(n))


EMPTY_ACK = _AckRun(empty=True)       # a whole reply that only acknowledges or only promises (nothing at all counts too)
# Only an acknowledgement ("Okay.", "Alright.", "Got it."): after the turn's question it is dropped (live round bae894ce turn 20: "...What were
# you working through there? Okay.").
BARE_ACK = _AckRun(empty=False)
# The opener of a turn (decided 2026-10-18): its first sentence when that only acknowledges ("Mm, okay."), else the words before its first comma or
# period when there are one to three of them ("Right, so tell me ..." opens with "right"). A question or a longer first clause has no opener.
_OPENER_CLAUSE = re.compile(r"[,.;:\u2014\u2013]")
OPENER_WINDOW = 5         # an opener is not used again when it was the previous turn's, or already twice in this many turns
OPENER_MAX = 2
OPENER_ROUND_MAX = 3      # ...nor when it has already opened this many turns of the round ("Fair enough" five times in one round; decided 2026-10-18)
LEAD_IN_MAX_WORDS = 8     # a lead-in of up to this many words before a colon is an opener too ("Let me point you to the next step: ...")
DEFAULT_ACKS = ("Okay.", "Right.", "Got it.", "Alright.", "I see.", "Sure.", "Makes sense.", "Fair enough.")


# A lead-in of the speech vocabulary ("One thing I'd like to understand —") that opens the sentence and is closed by its own comma, dash or ellipsis:
# an opener even when it is longer than three words, keyed by the lead-in itself.
_LEAD_IN_START = re.compile(rf"^\W*({LEAD_IN_PATTERN})\s*[,;:\u2014\u2013\u2026-]", re.IGNORECASE)


def turn_opener(sentence: str) -> str | None:
    opener = _plain_opener(sentence)
    if opener is None and (m := _LEAD_IN_START.match((sentence or "").strip())) is not None:
        return _opener_key(m.group(1))
    return opener


def _plain_opener(sentence: str) -> str | None:
    text = (sentence or "").strip()
    if not text:
        return None
    if BARE_ACK.match(text) or NEUTRAL_ACK.match(text):
        return _opener_key(text)
    cut = _OPENER_CLAUSE.search(text)
    head = text[:cut.start()] if cut else text.rstrip(" .!?")
    if cut is None and text.rstrip().endswith("?"):
        return None                                     # a question with no lead-in is the question, not an opener
    words = head.split()
    if cut is not None and text[cut.start()] == ":" and 4 <= len(words) <= LEAD_IN_MAX_WORDS and re.search(r"[A-Za-z]", head):
        return _opener_key(head)                        # "Let me point you to the next step: ..." said again and again is an opener, whatever follows the colon
    return _opener_key(head) if 1 <= len(words) <= 3 and re.search(r"[A-Za-z]", head) else None


def _opener_key(text: str) -> str:
    return " ".join(re.sub(r"[^a-z ]", " ", text.lower().replace("'", "").replace("\u2019", "")).split())


def is_safety_line(text: str) -> bool:
    """The warnings and the endings are exempt from the opener guard: they keep their words, said by the run or by the model. (The run's other fixed
    lines never pass through this guard; the trace check exempts them by the turn's `fixed` list.)"""
    return matches_any(text, SAFETY_KEYS) or any(matches_any(x, SAFETY_KEYS) for x in SENTENCE_END.split(text.strip()))


def opener_repeated(opener: str, recent: Sequence[str | None], round_uses: int = 0) -> bool:
    """The opener is the previous turn's, or one of the last five turns' already twice, or has opened `OPENER_ROUND_MAX` turns of the round already
    (`round_uses`, counted by the caller). `recent` is the openers of the turns before, oldest first (None for a turn with no opener)."""
    last = list(recent)[-OPENER_WINDOW:]
    return round_uses >= OPENER_ROUND_MAX or (bool(last) and (last[-1] == opener or last.count(opener) >= OPENER_MAX))
RE_INTRODUCES = re.compile(r"^\W*(?:hi|hello|hey)\b[^.?!]{0,20}\b(?:i'?m|i am|my name is)\b", re.IGNORECASE)
UNHEARD = re.compile(r"\byou (?:mentioned|said|told me|talked about|described|brought up|spoke about)\b([^.?!]{0,140})", re.IGNORECASE)
# Function words and filler that fill a "you mentioned ..." sentence without being what was mentioned.
_CLAIM_FILLER = frozenset("there while about which their these those would could should something thing really earlier already".split())
# Where the claim ends and the interviewer's own question or instruction begins ("... on the Experience Portal — walk me through how ...").
# Only used once the claim has a content word before it, so a claim that starts with "why Kafka ..." is not cut to nothing.
_CLAIM_END = re.compile(r"[\u2014\u2013;:]|\s-\s|,\s*so\b|\s(?:so|walk me|tell me|can you|could you|see if|how do|how did|what|why)\b", re.IGNORECASE)
_UNITS = {w: n for n, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * n for n, w in enumerate("x x twenty thirty forty fifty sixty seventy eighty ninety".split()) if w != "x"}
_BIG_O = re.compile(r"\bo\s*\(\s*([^()]{1,24}?)\s*\)|\bo\s+of\s+(n\s+log\s+n|n\s+squared|n\s*\^\s*2|n\s+cubed|log\s+n|one|n|1)\b", re.IGNORECASE)
_WORD_COMPLEXITY = re.compile(r"\b(constant|linear|logarithmic|quadratic)\s+(?:extra\s+)?(?:space|time|memory|complexity|runtime|lookups?)\b", re.IGNORECASE)
_BARE_COMPLEXITY = ((re.compile(r"\bn\s*log\s*n\b"), "nlogn"), (re.compile(r"\blog\s*n\b|\blogarithmic\b"), "logn"), (re.compile(r"\bn\s+squared\b"), "n2"))
_COMPLEXITY_NAMES = {"constant": "1", "one": "1", "linear": "n", "logarithmic": "logn", "quadratic": "n2"}
_TWICE = re.compile(r"\b2\s*x\b|\btwice\b|\bdoubl(?:e|ed|es|ing)\b")


def _complexities(text: str) -> set[str]:
    """The time/space complexities a text states, in one form each: O(1), "o of one" and "constant space" are all `1`; O(n), "o of n"
    and "linear time" are `n`; O(log n), "log n" and "logarithmic" are `logn`."""
    out: set[str] = set()
    for m in _BIG_O.finditer(text):
        inner = re.sub(r"\s+", "", (m.group(1) or m.group(2)).lower()).replace("squared", "2").replace("cubed", "3").replace("^", "")
        out.add(_COMPLEXITY_NAMES.get(inner, inner))
    out.update(_COMPLEXITY_NAMES[m.group(1).lower()] for m in _WORD_COMPLEXITY.finditer(text))
    rest = _WORD_COMPLEXITY.sub(" ", _BIG_O.sub(" ", text.lower()))
    for pattern, name in _BARE_COMPLEXITY:
        if pattern.search(rest):
            out.add(name)
            rest = pattern.sub(" ", rest)
    return out


def _numbers(text: str, said: bool = False) -> set[str]:
    """The numbers a text states, as digits: "thirty five", "35" and "35%"/"35 percent" are all `35`; "2x", "twice" and "double" are `2x`.
    A lone "one" counts only on the side of what was said ("one of the projects" in a claim is no number)."""
    text = _BIG_O.sub(" ", text.lower())
    out = {"2x"} if _TWICE.search(text) else set()
    text = _TWICE.sub(" ", text)
    out |= set(re.findall(r"\d+", text))
    run: list[str] = []
    for tok in [*re.findall(r"[a-z]+", text), ""]:
        if tok in _UNITS or tok in _TENS or tok == "hundred":
            run.append(tok)
            continue
        if run and (said or run != ["one"]):
            value = 0
            for w in run:
                value = max(value, 1) * 100 if w == "hundred" else value + _UNITS.get(w, _TENS.get(w, 0))
            out.add(str(value))
        run = []
    return out


def _root(word: str) -> str:
    """A word cut to its stem so the forms of one word meet: stacks/stack, entries/entry, cached/caching/cache, handled/handle."""
    if word == "led":
        return "lead"                                   # the one irregular verb a resume claim always uses
    if word.endswith("ies") and len(word) > 4:
        word = word[:-3] + "y"
    elif word.endswith("ing") and len(word) > 5:
        word = word[:-3]
    elif word.endswith("ed") and len(word) > 4:
        word = word[:-2]
    elif word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        word = word[:-1]
    return word.rstrip("e")[:6]


def _content(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{5,}", text.lower()) if w not in _CLAIM_FILLER}


def _claim_part(claim: str) -> str:
    """The claim up to where the interviewer's own question begins, cut at the first break that follows a content word."""
    for m in _CLAIM_END.finditer(claim):
        if _content(claim[:m.start()]):
            return claim[:m.start()]
    return claim


def claim_unheard(claim: str, heard: str, lead: str = "") -> bool:
    """A "you mentioned <claim>" the candidate did not make. `heard` is everything they said. Not made when: a proper name in it was
    never said; a number or a complexity it states (O(1), "constant space") is not one they said; or fewer than half of its content
    words were said (so a claim of one or two words needs one). Words match by stem on both sides ("stacks" is heard in "stack"); a
    paraphrase that shares no stem ("dictionary" for "hash map") is a known limit, and a block never empties the turn. The claim stops
    where the interviewer's own question begins.
    `lead` is what the sentence says before "you mentioned": a name in it ("On the Experience Portal, you mentioned leading three
    engineers") the candidate said counts as one more heard word, but is never something the claim has to match."""
    heard = heard.lower()
    claim = _claim_part(claim)
    if any(w not in heard for w in {w.lower() for w in re.findall(r"\b[A-Z][a-z]{3,}\b", claim)}):
        return True
    if not _numbers(claim) <= _numbers(heard, said=True) or not _complexities(claim) <= _complexities(heard):
        return True
    said = {_root(w) for w in re.findall(r"[a-z]{3,}", heard)}
    stated = _WORD_COMPLEXITY.sub(" ", _BIG_O.sub(" ", claim.lower()))          # the complexities were compared above
    content = {_root(w) for w in _content(stated)}
    support = {_root(w.lower()) for w in re.findall(r"\b[A-Z][a-z]{3,}\b", " ".join(lead.split()[1:]))} & said
    return bool(content) and 2 * (len(content & said) + min(len(support), 1)) < len(content)


_INDEX = re.compile(r"\b([A-Za-z_]\w*)((?:\[[^\[\]]{1,40}\])+)")       # one index or a chain: dp[i][j]
_METHOD = re.compile(r"\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(\)")


_TAGS = re.compile(r"</?[A-Za-z][^<>\n]{0,40}>")
_COUNT_STAR = re.compile(r"\bCOUNT\(\*\)", re.IGNORECASE)
_BIG_O_CALL = re.compile(r"\bO\(([^()]{1,40})\)")
# An expression: operands (numbers, names, parenthesised ones) joined by operators spaced on both sides or on neither ("3-5*2", "a <= b"),
# so an emphasis star ("is *really* it") is never read as an operator.
_TERM = r"\(*(?:\d+(?:\.\d+)?|[A-Za-z_]\w*|\"[^\"\n]{1,30}\")\)*"
_OP = r"(?:<=|>=|==|!=|<>|\*\*|//|[-+*/<>=])"
_EXPRESSION = re.compile(rf"{_TERM}(?:(?:\s+{_OP}\s+|{_OP}){_TERM})+")
_PIECES = re.compile(rf"(\s+{_OP}\s+|{_OP})")
_OPERATOR_WORDS = {"*": "times", "/": "divided by", "+": "plus", "-": "minus", "<=": "less than or equal to", ">=": "greater than or equal to",
                   "<": "less than", ">": "greater than", "==": "equals", "=": "equals", "!=": "not equal to", "<>": "not equal to",
                   "**": "to the power of", "//": "floor divided by"}
_ARITHMETIC = frozenset({"*", "/", "+", "-", "**", "//"})
_QUOTED_CODE = re.compile(r"`[^`\n]+`|\"[^\"\n]+\"")
_GENERIC = re.compile(r"\b([A-Z]\w*)<([^<>]*)>")


def _short_name_or_number(term: str) -> bool:
    return bool(re.search(r"\d", term)) or bool(re.fullmatch(r"\(*[A-Za-z_]{1,2}\)*", term)) or term.startswith("(") or term.endswith(")")


def _say_expression(m: "re.Match[str]", quoted: bool = False) -> str:
    """Operators said as a person would. A minus only inside an expression with another operator ("10-20 minutes", "two-pointer" and
    "state-of-the-art" stay as written), a slash only with another operator or in quoted code (never "24/7", "and/or", "TCP/IP"), a star
    is "times" only beside a number, a short name or a bracket (else "star", as in SELECT * FROM), and an equals sign only in an equation."""
    pieces = _PIECES.split(m.group(0))
    terms, ops = pieces[0::2], pieces[1::2]
    kinds = [o.strip() for o in ops]
    out = terms[0]
    for n, (raw, kind) in enumerate(zip(ops, kinds)):
        left, right = terms[n], terms[n + 1]
        others = any(k != kind for k in kinds)
        if kind == "-":
            speak = others
        elif kind == "=":
            speak = any(k in _ARITHMETIC for k in kinds)
        elif kind == "/":
            speak = others or (quoted and any(re.search(r"\d", t) or re.fullmatch(r"\(*[A-Za-z]\)*", t) for t in (left, right)))
        elif kind == "*":
            word = "times" if _short_name_or_number(left) or _short_name_or_number(right) else "star"
            out += f" {word} " + right
            continue
        else:
            speak = True
        out += (f" {_OPERATOR_WORDS[kind]} " if speak else raw) + right
    return out


def _say_operators(text: str) -> str:
    spans = [(q.start(), q.end()) for q in _QUOTED_CODE.finditer(text)]
    return _EXPRESSION.sub(lambda m: _say_expression(m, any(a <= m.start() and m.end() <= b for a, b in spans)), text)


def _say_symbols(text: str) -> str:
    """The symbols that are not between two operands of an expression: arrows, generics, compound assignments, percent, mod, ++ and
    the stars of *args and **kwargs. Generics come first in speakable. `^`, `&` and `|` are left as written (the voice reads them as it will)."""
    text = re.sub(r"\s*->\s*", " to ", text)
    text = re.sub(r"\s*=>\s*", " arrow ", text)
    text = re.sub(r"(?<=\w)\s*\+=\s*", " plus equals ", text)
    text = re.sub(r"(?<=\w)\s*-=\s*", " minus equals ", text)
    text = re.sub(r"(?<![\w+])([a-z]\w?)\+\+(?![\w+])", r"\1 plus plus", text)
    # "a % b" and "x%2" are mod; "50%", "50% of the time" and "35% faster" are percent ("5 % 3" was "5 percent 3").
    text = re.sub(r"(?<=[\w)\]])\s+%\s+(?=[\w(])", " mod ", text)
    text = re.sub(r"(?<=[A-Za-z_)\]])%(?=[\w(])|(?<=\d)%(?=[\d(])", " mod ", text)
    text = re.sub(r"(\d)\s?%", r"\1 percent", text)
    return re.sub(r"(?<![\w)\]*])(\*{1,2})(?=[A-Za-z_])", lambda m: "star star " if len(m.group(1)) == 2 else "star ", text)


def speakable(text: str) -> str:
    """Code in a sentence as a person would say it: "prices[i - 1]" is "prices at i minus 1", never "pricesi - 1"; "3-5*2" is "3 minus 5
    times 2", "COUNT(*)" is "count star", "O(n*m)" is "O of n times m"."""
    def index(m: "re.Match[str]") -> str:
        # dp[i-1][j] is "dp at i minus 1, j": each index said in turn (a second index left to the bracket strip ran into the first, "1j").
        said = [_say_operators(re.sub(r"\s*-\s*", " minus ", re.sub(r"\s*\+\s*", " plus ", part.strip())))
                for part in re.findall(r"\[([^\[\]]{1,40})\]", m.group(2))]
        return f"{m.group(1)} at {', '.join(said)}"

    def big_o(m: "re.Match[str]") -> str:
        inner = m.group(1)
        return f"O of {_say_operators(inner)}" if inner.strip().isdigit() or re.search(r"[*/+]", inner) else m.group(0)
    while (swapped := _GENERIC.sub(lambda m: f"{m.group(1)} of {m.group(2)}", text)) != text:
        text = swapped                                              # Map<String, List<Integer>>: innermost first, before the tag strip
    text = _COUNT_STAR.sub("count star", EMPHASIS.sub(r"\2", _TAGS.sub("", text)))
    text = _BIG_O_CALL.sub(big_o, _METHOD.sub(r"\1 dot \2", _INDEX.sub(index, text)))
    return _say_operators(_say_symbols(text))


_COMPOUND_Q = re.compile(r",?\s+and\s+(?:then\s+|also\s+)?(?=(?:what|how|where|when|why|which|who|does|do|did|is|are|can|could|would|will|should|tell|walk|explain|describe|show)\b)", re.IGNORECASE)
_IMPERATIVE_ASK = re.compile(r"^(?:(?:now|then|so|okay|alright|and),?\s+)?(?:walk|tell|talk|explain|describe|show|trace|dry)\b", re.IGNORECASE)
_IMPERATIVE_JOIN = re.compile(r",?\s+(?:and|then)\s+(?=(?:tell|walk|explain|describe|show|finish|run|trace|write|give|say|what|how|where)\b)", re.IGNORECASE)


def one_ask(text: str) -> str:
    """A sentence that asks two things ("what is added, and what does the total come to?") keeps its first ask: they answer the last part of a
    double question and skip the rest, so the second is asked on its own turn."""
    t = text.strip()
    if t.endswith("?"):
        m = _COMPOUND_Q.search(t)
        if m and len(t[:m.start()].split()) >= 4:
            return t[:m.start()].rstrip(",") + "?"
    elif _IMPERATIVE_ASK.match(t):
        m = _IMPERATIVE_JOIN.search(t)
        if m and len(t[:m.start()].split()) >= 4:
            return t[:m.start()].rstrip(",") + "."
    return t


def _words_within(short: str, longer: str) -> bool:
    """Every word of `short` (3 or more words) appears in `longer`, in order: it says nothing the earlier sentence did not."""
    a, b = re.findall(r"[a-z0-9']+", short.lower()), re.findall(r"[a-z0-9']+", longer.lower())
    if len(a) < 3 or len(a) >= len(b):
        return False
    it = iter(b)
    return all(w in it for w in a)


def _overlap(a: str, b: str) -> float:
    wa, wb = set(re.findall(r"[a-z]{4,}", a.lower())), set(re.findall(r"[a-z]{4,}", b.lower()))
    return len(wa & wb) / min(len(wa), len(wb)) if min(len(wa), len(wb)) >= 4 else 0.0


def _drop_stray_symbols(text: str) -> str:
    def operand(c: str, before: bool) -> bool:
        return bool(c) and (c.isalnum() or c in "\"'" or c == (")" if before else "("))
    out, last = [], 0
    for m in STRAY_SYMBOL.finditer(text):
        if operand(text[:m.start()].rstrip()[-1:], True) and operand(text[m.end():].lstrip()[:1], False):
            continue
        out.append(text[last:m.start()])
        last = m.end()
    return "".join(out) + text[last:]


def _clean(text: str) -> str:
    text = re.sub(r"(?<=[A-Za-z0-9])_+(?=[A-Za-z0-9])", " ", text)    # DENSE_RANK is spoken "DENSE RANK", not "DENSERANK"
    text = _TAGS.sub("", text)
    text = EMPHASIS.sub(r"\2", text)
    text = re.sub(r"(?m)^\s*(?:#{1,6}\s*|[-\u2022]\s+)", "", text)                          # a heading marker or a list bullet at the start of a line, never a "#" or "-" inside a sentence
    text = _drop_stray_symbols(text)
    return re.sub(r"\s+", " ", MARKUP.sub("", text)).strip()      # stray markdown or bracket characters are never spoken


THIRD_PERSON = re.compile(r"^\s*(?:the )?candidate\b", re.IGNORECASE)    # the interviewer speaks to them, never about them
SILENT = "<silent>"
# Only markup: backticks, strikethrough and stray brackets and braces. Never an operator between operands, a comparison, or the star in "(*)".
MARKUP = re.compile(r"~~|[`{}\[\]_]|^\s*\*+\s")
# Emphasis wrapped around words (**really**, *really*, _really_): the opener follows no word character and the closer precedes none.
EMPHASIS = re.compile(r"(?<![\w*_])(\*{1,3}|_{1,3})(?=\w)(.+?)(?<=\w)\1(?![\w*_])")
# A pipe, caret or angle bracket with an operand on only one side or none is markup (a streamed stray ">" or "<"), not an operator.
STRAY_SYMBOL = re.compile(r"<=|>=|<>|\*{2,}|[<>|^]")
FILLER_AT = (1.15, 2.65, 4.65, 7.3)   # when each filler stage is said, as a multiple of the hedge time
DEADLINE_FACTOR = 10.5


@dataclass(frozen=True)
class Pacing:
    """How long the talker waits for a first token, and what it does meanwhile (seconds)."""
    hedge_after_s: float = 3.0
    filler_after_s: tuple[float, ...] = (3.5, 8.0, 14.0, 22.0)
    deadline_s: float = 32.0
    max_attempts: int = 4
    retry_gap_s: float = 0.3      # before asking the same model again after it failed at once

    @classmethod
    def scaled(cls, hedge_after_s: float) -> "Pacing":
        return cls(hedge_after_s=hedge_after_s, filler_after_s=tuple(round(hedge_after_s * f, 3) for f in FILLER_AT),
                   deadline_s=hedge_after_s * DEADLINE_FACTOR, retry_gap_s=round(hedge_after_s * 0.1, 3))


SPEAK_AFTER_TOOLS = "Now say your spoken reply to the candidate, in words only, one to three sentences. Do not mention these decisions."


def _decision_line(call: ToolCall) -> str:
    """"open_thread (title: Migration failure, why: they led it)": what a tool-only reply decided, for the call that asks for the words."""
    detail = ", ".join(f"{k}: {call.arguments[k]}" for k in ("title", "why", "goal_id") if call.arguments.get(k))
    return f"{call.name} ({detail})" if detail else call.name


def _sum_usage(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Two requests made one turn: token and cost fields add up, anything else keeps the later value."""
    total = {**a, **b}
    for key in set(a) & set(b):
        if isinstance(a[key], (int, float)) and isinstance(b[key], (int, float)) and not isinstance(a[key], bool):
            total[key] = a[key] + b[key]
    return total


MOVE_TOOLS = frozenset({"next_item", "go_to", "close_thread"})
STAY_ON_PROBLEM = "Actually, let's stay with this problem."
STAY_ON_PART = "Actually, let's stay with this for a bit longer."


def announces_a_move(sentence: str) -> bool:
    """The sentence tells the candidate the problem or the coding is being left, or that another problem or part is coming. (Not "let's get
    into the coding now": a refused next_item beside it only means the plan was already there.)"""
    return announces_leaving(sentence) or closes_coding_part(sentence)


class TalkerFailed(Exception):
    """No model produced a reply within the deadline."""


@dataclass
class TurnResult:
    spoken: list[str] = field(default_factory=list)
    blocked: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    decision: dict[str, Any] | None = None
    first_token_ms: int | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider: str | None = None
    interrupted: bool = False
    error: str | None = None
    model: str | None = None       # the model that answered
    hedged: bool = False           # the fallback (or a second request) was raced against a slow first one
    fillers: int = 0               # filler lines spoken while waiting
    attempts: list[dict[str, Any]] = field(default_factory=list)
    repaired: list[tuple[str, str]] = field(default_factory=list)    # (before, after) of every false start mended before it was spoken
    spoke_after_tools: bool = False    # the model answered with tool calls only: the words came from a second call made without tools


@dataclass
class _Opened:
    stream: Any
    first: StreamEvent
    chat: Any


class TalkerTurn:
    def __init__(self, chat, guard: LeakGuard, tools: ToolExecutor, first_token_timeout_s: float,
                 clock: Callable[[], float] = time.perf_counter, *, fallback=None, pacing: Pacing | None = None,
                 on_slow: Callable[[bool], None] | None = None, fillers: Fillers | None = None) -> None:
        self.chat = chat
        self.fallback = fallback
        self.guard = guard
        self.tools = tools
        self.pacing = pacing or Pacing.scaled(first_token_timeout_s)
        self.clock = clock
        self.on_slow = on_slow
        self.fillers = fillers or Fillers()
        self.said = SaidTracker()                   # every sentence spoken this interview: none is said again in the same words
        self.habit_acks: tuple[str, ...] = ()       # the persona's own acknowledgements (set by the run): what a repeated opener is replaced with
        self._openers: list[tuple[str, str | None]] = []     # (turn id, opener) of the interviewer's recent turns, oldest first
        self._opener_turn: str | None = None          # the turn whose first sentence has been spoken
        self._opener_uses: dict[str, int] = {}        # how many turns of the round each opener has opened (the window above only remembers the last few)
        self._turn_id = ""
        self.last = TurnResult()
        self._offered = TOOLS
        self._block_claims = False
        self._block_qa = False
        self._fillers_on = True
        self._quiet = False
        self._block_values = False
        self._limits_revealed = False
        self._values_words_ok = False
        self._block_clarify = False
        self._heard = ""
        self._recent = ""
        self._hint_step = 0
        self._has_code = False
        self._time_talk_ok = True
        self._verdicts = 0
        self._budget = False
        self._echo_of = ""
        self._guessed = False
        self._guessed_turn = ""
        self.board_typed = False                    # set by the run per turn: text is typed on the whiteboard, so its words are never "unreadable"
        self.selection = ""                         # set by the run per turn: the text they highlighted and are asking about, "" otherwise
        self._trace_reported = False
        self._block_close_coding = False
        self._block_leave_taking = False
        self._line_trouble_ok = False
        self._shown_number: int | None = None
        self._problem_ahead = False
        self._known_words: frozenset[str] = frozenset()
        self._reasoning = False
        self._turn_chars = 0
        self._outline_said = False
        # What the spoken outline must name, set by the run per turn while the outline is still to be said: (promised areas, promised projects).
        # None for a blueprint without a realism block (nothing to check).
        self.outline_expect: tuple[list[str], list[str]] | None = None
        # Set by the run per turn: on a turn that refuses a change of problem, the points the round's earlier refusals already made (closing.refusal_points);
        # None on any other turn. A sentence that makes one of them again, or one already made in this turn, is dropped (decided 2026-10-18).
        self.refusal_said: set[str] | None = None
        # The sentences the round's earlier refusals spoke (set beside `refusal_said`): a sentence close to one in its words is a repeat too.
        self.refusal_sentences: list[str] = []
        self._confirm_asked = False
        self._intro_begun = False
        self._held_tail: list[str] = []                 # sentences held until the turn's tools have run (hint and move checks)
        self._held_soft: tuple[str, str] | None = None   # a first sentence (an echo) or a lone verdict, held until something else is said
        self._questions = 0
        self._remarks = 0
        self._before: list[str] = []
        self._check_ack = False
        self._held_ack: str | None = None
        self._speak_after_tools = False
        self._held_failure: TalkerFailed | None = None
        self._abuse_flagged = False                 # this turn flagged abuse aimed at the interviewer: no warning is spoken

    def seed_openers(self, texts: Sequence[str]) -> None:
        """A resumed interview: the openers of the stored interviewer turns."""
        for text in texts:
            first = SENTENCE_END.split((text or "").strip())[0] if (text or "").strip() else ""
            opener = None if is_safety_line(first) else turn_opener(first)
            self._openers.append(("restored", opener))
            if opener is not None:
                self._opener_uses[opener] = self._opener_uses.get(opener, 0) + 1
        del self._openers[:-OPENER_WINDOW]

    def _drop_openers(self, turn_id: str) -> None:
        """Forget the opener of a turn (it was cut off, or is being set again): it no longer counts against the round either."""
        for t, o in self._openers:
            if t == turn_id and o is not None and self._opener_uses.get(o, 0) > 0:
                self._opener_uses[o] -= 1
        self._openers = [x for x in self._openers if x[0] != turn_id]

    def _recent_openers(self) -> list[str | None]:
        return [o for t, o in self._openers if t != self._turn_id]

    def _fresh_opener(self, text: str) -> str | None:
        """What a repeated opener becomes: an acknowledgement of its own (a habit, never one that would also repeat), or the sentence without its
        lead-in ("Okay, so how did you ..." gives "So how did you ..."); None when neither is left."""
        recent = self._recent_openers()
        if turn_opener(text) is not None and (BARE_ACK.match(text.strip()) or NEUTRAL_ACK.match(text.strip())):
            # Only a wording of the same class as the one it replaces: a neutral "Okay." never becomes an acknowledgement that judges or a verdict
            # ("Right.", "Nice."), because the repair runs after the verdict budget and would never be counted.
            pool = [a for a in (self.habit_acks or DEFAULT_ACKS) if not opener_repeated(turn_opener(a) or "", recent, self._opener_uses.get(turn_opener(a) or "", 0))
                    and ACKNOWLEDGES(a) == ACKNOWLEDGES(text) and opens_with_verdict(a) == opens_with_verdict(text)]
            return (self.said.lines.rng.choice(pool) if self.said.lines is not None else pool[0]) if pool else None
        cut = _OPENER_CLAUSE.search(text)
        rest = text[cut.end():].strip() if cut else ""
        if not rest:
            return None
        # Losing the lead-in must not leave a verdict behind ("Okay, great point there." gives "Great point there."): the repair runs after the verdict
        # budget and would never be counted, so a rest that judges when the whole did not is blocked instead.
        if (ACKNOWLEDGES(rest) and not ACKNOWLEDGES(text)) or (opens_with_verdict(rest) and not opens_with_verdict(text)):
            return None
        return rest[0].upper() + rest[1:]

    async def run(self, messages: list[dict[str, Any]], *, turn_id: str, current_slot: str | None,
                  candidate_said: str, tools: list[dict[str, Any]] | None = None, block_screen_claims: bool = False,
                  neutral_on_blocked: bool = True, block_qa_invites: bool = False, highlights_known: bool = False, fillers_allowed: bool = True,
                  quiet_coding: bool = False, block_values: bool = False, values_words_ok: bool = False, limits_revealed: bool = False,
                  block_clarify: bool = False, heard: str = "", hint_step: int = 0, has_code: bool = False,
                  time_talk_ok: bool = True, check_empty_ack: bool = False,
                  speak_after_tools: bool = False, framing: bool = False, recent: str = "",
                  spoken_before: Sequence[str] = (), verdict_budget: bool = False,
                  echo_of: str = "", trace_reported: bool = False, block_close_coding: bool = False, problem_ahead: bool = False,
                  outline_said: bool = False, confirm_asked: bool = False,
                  known_words: Collection[str] = (), shown_problem: int | None = None, block_leave_taking: bool = False, line_trouble_ok: bool = False) -> AsyncIterator[str]:
        self._offered = tools if tools is not None else TOOLS
        self._shown_number = shown_problem          # the number of the problem on their screen: its put-up and intro lines are never said again
        if echo_of or turn_id != self._turn_id:
            self._abuse_flagged = False             # a later pass of the same turn keeps what the first pass saw
        self._problem_ahead = problem_ahead         # a problem slot is still pending: the coding part is not over, only this problem
        self._block_close_coding = block_close_coding   # the plan has not left the problem on screen: the coding part is not over
        self._line_trouble_ok = line_trouble_ok         # a connection event really happened lately: only then may the line be called bad
        self._block_leave_taking = block_leave_taking   # the candidate's questions are opening, nobody has asked one yet: no thanks, no goodbye
        self._known_words = frozenset(w.lower() for w in known_words)    # their name and resume words: never a language switch
        self._reasoning = False                     # a sentence of this turn was reasoning: every later one is dropped too
        self._turn_chars = sum(len(x) for x in spoken_before)
        self._outline_said = outline_said           # the schedule has been given: it is not given again
        self._confirm_asked = confirm_asked         # ...and the check on it was asked: it is asked once per round
        self._turn_id = turn_id
        self._budget = verdict_budget               # the previous turn opened with a verdict: this one carries none
        self._echo_of = echo_of                     # what the candidate just said: a first sentence that only gives it back is dropped
        if echo_of or turn_id != self._guessed_turn:
            # A later pass of the same turn does not get their words again: it keeps what the first pass saw.
            self._guessed, self._guessed_turn = guesses_problem(echo_of), turn_id
            self._intro_begun = starts_introduction(echo_of)     # their reply already began the introduction: it is not asked for again
        self._trace_reported = trace_reported       # they reported a trace or test result: a dropped echo leaves its bare confirmation
        self._held_soft = None
        self._block_claims = block_screen_claims
        self._framing = framing                     # the part is the framing: nobody needs to approve the format it gives
        self._block_qa = block_qa_invites
        self._highlights_known = highlights_known
        self._block_clarify = block_clarify         # a problem is on screen: it already invited their questions, once
        self._hint_step = hint_step                 # hints already given: their words may be used again
        self._has_code = has_code                   # they have written code for the problem on screen: never ask them to write it; with none, never describe it
        self._time_talk_ok = time_talk_ok           # the round really is short of time: only then may it be said
        # A later pass of the same turn (the retry, the must-answer pass) starts from what the turn has already said: its first pass's
        # acknowledgement and question count, and its sentences are what a repeat is measured against (p20: two acknowledgements in one turn).
        self._before = [x for x in spoken_before]
        self._verdicts = sum(1 for x in self._before if ACKNOWLEDGES(x))   # sentences that judge what they said, in this turn: at most one
        self._heard = heard.lower()                 # everything the candidate has said, for "you mentioned..." claims
        self._recent = recent                       # the last two turns of each side: what a "let me stay on X" may link to
        self._questions = sum(1 for x in self._before if x.rstrip().endswith("?"))   # question sentences spoken in this turn: one question per turn
        self._values_words_ok = values_words_ok
        self._block_values = block_values           # they asked for the constraints: they go on the screen, never into speech
        self._limits_revealed = limits_revealed     # ...and once on the screen, their numbers stay out of speech for the rest of the problem
        self._quiet = quiet_coding                  # they are about to type: one short remark at most, never a hint
        self._remarks = len(self._before)
        self._check_ack = check_empty_ack           # they said something that needs a real answer: a bare acknowledgement is not one
        self._held_ack = None
        self._held_tail = []
        self._held_failure = None
        self._speak_after_tools = speak_after_tools  # a reply to the candidate is owed: a model that only calls tools is asked again for the words
        self._fillers_on = fillers_allowed          # off for the greeting: nobody has asked for anything, so "give me a second" means nothing
        result = TurnResult()
        self.last = result
        started = self.clock()
        calls: list[ToolCall] = []
        try:
            async with aclosing(self._generate(messages, result, started, calls, current_slot, candidate_said,
                                               with_tools=True, may_follow_up=True)) as sentences:
                async for sentence in sentences:
                    yield sentence
            image: bytes | None = None
            # Flow tools (next_item, go_to, ...) first: the model often lists show_problem before the next_item that makes it valid, and the
            # candidate should still see the problem (stable sort keeps every other call in the order it was made).
            for call in sorted(calls, key=lambda c: c.name not in FLOW_TOOLS):
                if call.name == "log_turn":
                    result.decision = {k: call.arguments.get(k) for k in ("condition", "action", "reason")}
                    if call.arguments.get("set_aside"):
                        result.decision |= {"set_aside": call.arguments["set_aside"], "set_aside_why": call.arguments.get("set_aside_why")}
                    continue
                if call.name == "show_problem" and self._asks_this_turn() and not self.tools.in_play():
                    # A turn that asks them something never also puts a problem up: they cannot answer both, and the question is left hanging
                    # (decided 2026-10-18; rehearsal run_a seq 9). The problem goes up in the next turn, once the plan has moved onto it.
                    result.tool_calls.append({"name": call.name, "arguments": call.arguments, "result": {
                        "ok": False, "deferred": True, "error": "you asked a question in this turn, so the problem is not put up now: it goes up "
                                                                  "in your next turn, after they answer; do not say it is on their screen"}})
                    continue
                outcome = await self.tools.execute(call, turn_id)
                result.tool_calls.append({"name": call.name, "arguments": call.arguments,
                                          "result": {k: v for k, v in outcome.items() if k != "image"}})
                if call.name == "look_at_board" and outcome.get("image"):
                    image = outcome["image"]
            for sentence in self._flush_tail(result, current_slot, candidate_said):      # even when a follow-up request failed: it is already worded
                yield sentence
            if self._held_failure is not None:
                raise self._held_failure
            refused_move = any(c["name"] in MOVE_TOOLS and c["result"].get("ok") is False for c in result.tool_calls)
            if refused_move and not result.interrupted and any(announces_a_move(x) for x in result.spoken):
                # Speech streams out before the tools run, so a move the plan then refused has already been announced: it is taken back in
                # fixed words at once (decided 2026-10-18; a live round said "let me shift gears" and the plan stayed on the problem).
                line = STAY_ON_PROBLEM if current_slot else STAY_ON_PART
                result.spoken.append(line)
                result.repaired.append(("(the move it announced was refused)", line))
                yield line
            if image is not None:
                follow = [*messages,
                          {"role": "assistant", "content": " ".join(result.spoken) or "Let me take a look."},
                          {"role": "user", "content": [
                              {"type": "text", "text": "(The whiteboard as it looks now. React in one or two spoken sentences.)"},
                              {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode()}}]}]
                async with aclosing(self._generate(follow, result, started, [], current_slot, candidate_said,
                                                   with_tools=False)) as sentences:
                    async for sentence in sentences:
                        yield sentence
            if neutral_on_blocked and not result.spoken and result.blocked:
                line = self.said.neutral(self._echo_of)
                if line is not None:
                    result.spoken.append(line)
                    yield line
        except (asyncio.CancelledError, GeneratorExit):
            result.interrupted = True
            self.said.forget(turn_id)               # they may not have heard it to the end: it can be said again
            self._drop_openers(turn_id)
            if self._opener_turn == turn_id:
                self._opener_turn = None
            raise

    async def _try(self, chat, messages, with_tools: bool, limit_s: float) -> _Opened:
        """One request, up to its first event. Closes the stream if it fails or is cancelled."""
        stream = chat.stream(messages, tools=self._offered if with_tools else None)
        try:
            first = await asyncio.wait_for(stream.__anext__(), timeout=limit_s)
        except BaseException:
            await stream.aclose()
            raise
        return _Opened(stream, first, chat)

    def _note_slow(self, slow: bool) -> None:
        if self.on_slow is not None:
            try:
                self.on_slow(slow)
            except Exception:  # noqa: BLE001 - a status light must never break a turn
                pass

    async def _opening(self, messages, with_tools: bool, result: TurnResult) -> AsyncIterator[str | _Opened]:
        """Yield filler lines while waiting, then the opened stream of whichever model spoke first."""
        pace = self.pacing
        loop = asyncio.get_running_loop()
        began = loop.time()
        chats = [self.chat] + ([self.fallback] if self.fallback is not None else [])
        tasks: dict[asyncio.Task, tuple[Any, float]] = {}
        started = 0
        next_hedge = pace.hedge_after_s
        stage = 0
        last_failure = float("-inf")
        failed_chat: Any = None
        winner: _Opened | None = None
        errors: list[str] = []

        def launch() -> None:
            nonlocal started
            chat = chats[started % len(chats)]
            remaining = max(0.01, pace.deadline_s - (loop.time() - began))
            task = asyncio.ensure_future(self._try(chat, messages, with_tools, remaining))
            tasks[task] = (chat, loop.time())
            started += 1

        launch()
        try:
            while winner is None:
                now = loop.time() - began
                if now >= pace.deadline_s:
                    break
                if stage < len(pace.filler_after_s) and now >= pace.filler_after_s[stage]:
                    if stage == 0:
                        self._note_slow(True)
                    stage += 1
                    if self._fillers_on:
                        line = self.fillers.line(stage - 1)
                        result.fillers = stage
                        result.spoken.append(line)
                        yield line
                    continue
                # After a failure the other model is asked at once; the same model again only after a short pause.
                retry_ready = not tasks and (chats[started % len(chats)] is not failed_chat or loop.time() - last_failure >= pace.retry_gap_s)
                if started < pace.max_attempts and ((now >= next_hedge and len(tasks) < 2) or retry_ready):
                    result.hedged = result.hedged or bool(tasks)
                    launch()
                    next_hedge = now + pace.hedge_after_s
                if not tasks and started >= pace.max_attempts:
                    break
                wakes = [pace.deadline_s]
                if stage < len(pace.filler_after_s):
                    wakes.append(pace.filler_after_s[stage])
                if started < pace.max_attempts:
                    wakes.append(next_hedge if tasks else last_failure - began + pace.retry_gap_s)
                wait = max(0.0, min(wakes) - (loop.time() - began))
                if tasks:
                    done, _ = await asyncio.wait(set(tasks), timeout=wait, return_when=asyncio.FIRST_COMPLETED)
                else:
                    await asyncio.sleep(wait)
                    done = set()
                for task in done:
                    chat, at = tasks.pop(task)
                    elapsed_ms = int((loop.time() - at) * 1000)
                    try:
                        opened = task.result()
                    except (TimeoutError, LLMUnavailable, StopAsyncIteration) as exc:
                        last_failure, failed_chat = loop.time(), chat
                        errors.append(f"{type(exc).__name__}: {exc}")
                        result.attempts.append({"model": getattr(chat, "model", None), "ms": elapsed_ms, "ok": False,
                                                "error": type(exc).__name__})
                        continue
                    result.attempts.append({"model": getattr(chat, "model", None), "ms": elapsed_ms, "ok": True})
                    if winner is None:
                        winner = opened
                    else:
                        await opened.stream.aclose()
        finally:
            for task in tasks:
                task.cancel()
            for outcome in await asyncio.gather(*tasks, return_exceptions=True):
                if isinstance(outcome, _Opened):     # it finished in the same instant: close it
                    await outcome.stream.aclose()
        if winner is None:
            result.error = errors[-1] if errors else "TimeoutError: no model answered in time"
            if result.fillers == 0 and self._fillers_on:
                line = self.fillers.line(0)           # never leave the candidate with nothing at all
                result.fillers = 1
                result.spoken.append(line)
                yield line
            raise TalkerFailed(result.error)
        result.model = getattr(winner.chat, "model", None)
        yield winner

    async def _generate(self, messages, result: TurnResult, started: float, calls: list[ToolCall],
                        current_slot: str | None, candidate_said: str, *, with_tools: bool,
                        may_follow_up: bool = False) -> AsyncIterator[str]:
        opened: _Opened | None = None
        stages_said = result.fillers
        async with aclosing(self._opening(messages, with_tools, result)) as steps:
            async for step in steps:
                if isinstance(step, _Opened):
                    opened = step
                else:
                    yield step                        # a filler line, already recorded in result.spoken
        assert opened is not None
        if result.fillers and stages_said == 0:
            self._note_slow(False)
        stream, first = opened.stream, opened.first
        # Said once, before the first real sentence, when a filler was spoken: a short acknowledgement or an apology.
        recovery = self.fillers.recovery(result.fillers) if result.fillers and stages_said == 0 else None

        async def events():
            try:
                yield first
                async for event in stream:
                    yield event
            finally:
                await stream.aclose()

        buffer = ""
        deferred: list[str] = []
        wrote = False                                   # the model produced text of its own (even only <silent>)
        try:
            async with aclosing(events()) as incoming:
                async for event in incoming:
                    if event.kind == "text":
                        wrote = wrote or bool(event.text.strip())
                        if result.first_token_ms is None:
                            result.first_token_ms = int((self.clock() - started) * 1000)
                        buffer += event.text
                        done, buffer = split_sentences(buffer)
                        for sentence in done:
                            if deferred or self._hint_risk(sentence, current_slot, candidate_said):
                                deferred.append(sentence)       # held with everything after it until the tools are known
                                continue
                            outs = self._screen(sentence, result, current_slot, candidate_said)
                            if outs and recovery:
                                result.spoken.insert(len(result.spoken) - len(outs), recovery)
                                yield recovery
                                recovery = None
                            for out in outs:
                                yield out
                    elif event.kind == "tool_call" and event.tool_call is not None:
                        calls.append(event.tool_call)
                        if event.tool_call.name == "flag_conduct" and event.tool_call.arguments.get("kind") == "abusive":
                            self._abuse_flagged = True
                    elif event.kind == "done":
                        result.usage, result.provider = event.usage, event.provider
        except LLMUnavailable as exc:
            result.error = str(exc)  # a broken stream mid-reply: keep what was already spoken
        holding = False
        if deferred or self._hint_risk(buffer, current_slot, candidate_said):
            deferred.append(buffer)
            if may_follow_up:
                # What the tools then did decides these sentences (a hint given, a move made): run() flushes them once the tools have run.
                self._held_tail, holding, outs = deferred, True, []
            else:
                outs = self._resolve_deferred(deferred, result, current_slot, candidate_said)
        else:
            outs = self._screen(buffer, result, current_slot, candidate_said)
        if not holding:
            self._drop_held_ack(result)
        if outs and recovery:
            result.spoken.insert(len(result.spoken) - len(outs), recovery)
            yield recovery
        for out in outs:
            yield out
        if not holding and (kept := self._release_soft(result, current_slot, candidate_said)) is not None:
            yield kept
        if may_follow_up and self._speak_after_tools and calls and not wrote and not result.error:
            # Tool calls and no words (some models do this on most turns): the tools stay held and run after the speech, as always; the words
            # come from one more request to the same chats (same hedging and failover) with no tools offered, told what was decided.
            decided = "; ".join(_decision_line(call) for call in calls)
            follow = [*messages, {"role": "assistant", "content": f"I decided: {decided}"}, {"role": "system", "content": SPEAK_AFTER_TOOLS}]
            first_usage, spoke_before = dict(result.usage), len(result.spoken)
            result.usage = {}                       # the second call's own figures: a call that yields no "done" must not count the first twice
            try:
                async with aclosing(self._generate(follow, result, started, [], current_slot, candidate_said, with_tools=False)) as sentences:
                    async for sentence in sentences:
                        yield sentence
            except TalkerFailed as exc:
                self._held_failure = exc            # the decided tool calls still run: run() raises this once they have
            result.usage = _sum_usage(first_usage, result.usage)
            result.spoke_after_tools = len(result.spoken) > spoke_before

    def _screen(self, sentence: str, result: TurnResult, current_slot: str | None, candidate_said: str) -> list[str]:
        """_check, with an acknowledgement-only first sentence held back until something follows it (then it is spoken first)."""
        outs: list[str] = []
        if self._held_ack is not None and sentence.strip() and sentence.strip() != SILENT:
            held, self._held_ack = self._held_ack, None
            verdict = self.guard.check_sentence(sentence, current_slot=current_slot, candidate_said=candidate_said)
            if not verdict.ok and verdict.rule == "statement_read_aloud":
                # The sentence after a bare promise ("Let me explain it.") restates the problem and is blocked: the promise is dropped with it, not
                # released alone (live round 781a1f0a, turns 18-23).
                result.blocked.append({"sentence": held, "rule": "empty_ack", "match": "a bare promise whose follow-up was blocked"})
            elif (ack := self._check(held, result, current_slot, candidate_said, release=True)) is not None:
                outs.append(ack)
        if (out := self._check(sentence, result, current_slot, candidate_said)) is not None:
            if self._held_soft is not None and sentence.strip() and sentence.strip() != SILENT:
                # Something real follows the held sentence, so the turn is not empty without it. When every later sentence is blocked
                # the held one stays and is spoken at the end.
                held, rule = self._held_soft
                self._held_soft = None
                if rule == "echo_so":
                    # A lone "So ..." paraphrase is only dropped when it is the whole turn; with more after it, it is said.
                    if (kept := self._check(held, result, current_slot, candidate_said, release=True)) is not None:
                        outs.append(kept)
                else:
                    outs.extend(self._drop_held(held, rule, result, current_slot, candidate_said))
            outs.append(out)
        return outs

    def _drop_held_ack(self, result: TurnResult) -> None:
        if self._held_ack is not None:                  # the reply was only that acknowledgement: ask the model for a real one
            result.blocked.append({"sentence": self._held_ack, "rule": "empty_ack", "match": "only an acknowledgement or a bare promise"})
            self._held_ack = None

    def _release_soft(self, result: TurnResult, current_slot: str | None, candidate_said: str) -> str | None:
        """Nothing was said after the held sentence: an empty turn is worse than a lone verdict; an echo gives way to a short acknowledgement."""
        if self._held_soft is None:
            return None
        (held, rule), self._held_soft = self._held_soft, None
        if rule in ("echo", "echo_so"):
            # Never the echo itself: a short neutral acknowledgement stands in for it (a bare confirmation after a reported trace).
            result.blocked.append({"sentence": held, "rule": "echo", "match": "gives their answer back to them"})
            kept = None
            if self._trace_reported and (confirmation := confirmation_of(held)) is not None:
                kept = self._check(confirmation, result, current_slot, candidate_said, release=True)
            if kept is None and (ack := self._neutral_ack()) is not None:
                kept = self._check(ack, result, current_slot, candidate_said, release=True)
            return kept
        return self._check(held, result, current_slot, candidate_said, release=True)

    def _resolve_deferred(self, deferred: list[str], result: TurnResult, current_slot: str | None, candidate_said: str) -> list[str]:
        """Screen the held sentences now that the turn's tool results are known: an approach is a hint only if give_hint succeeded; a hint turn
        never grades their idea; an announcement of the coding stands only if the turn moved to a problem that was not on screen."""
        ok = lambda c, *names: c["name"] in names and (c.get("result") or {}).get("ok") is True  # noqa: E731
        gave_hint = any(ok(c, "give_hint") for c in result.tool_calls)
        moved = any(ok(c, "next_item") or (ok(c, "show_problem") and not c["result"].get("already")) for c in result.tool_calls)
        outs: list[str] = []
        for sentence in deferred:
            kind = self._hint_risk(sentence, current_slot, candidate_said)
            if kind == "approach" and not gave_hint:
                result.blocked.append({"sentence": sentence, "rule": "unrecorded_hint", "match": APPROACH_SUGGESTION.search(sentence).group(0)})
            elif kind == "judge" and gave_hint:
                result.blocked.append({"sentence": sentence, "rule": "hint_grades", "match": JUDGES_THEIR_IDEA.search(sentence).group(0)})
            elif kind == "coding" and not moved:
                result.blocked.append({"sentence": sentence, "rule": "coding_already_on", "match": ANNOUNCES_CODING.search(sentence).group(0)})
            else:
                outs.extend(self._screen(sentence, result, current_slot, candidate_said))
        return outs

    def _asks_this_turn(self) -> bool:
        """This turn has asked them something (a question sentence spoken, or held until the tools ran): it puts no problem up and opens no coding problem."""
        return self._questions >= 1 or any(x.rstrip().endswith("?") for x in self._held_tail)

    def _flush_tail(self, result: TurnResult, current_slot: str | None, candidate_said: str) -> list[str]:
        """The sentences held for the tools, screened after they ran, then what the end of a stream would have released."""
        deferred, self._held_tail = self._held_tail, []
        if not deferred:
            return []
        outs = self._resolve_deferred(deferred, result, current_slot, candidate_said)
        self._drop_held_ack(result)
        if (kept := self._release_soft(result, current_slot, candidate_said)) is not None:
            outs.append(kept)
        return outs

    def _hint_risk(self, sentence: str, current_slot: str | None, candidate_said: str) -> str | None:
        """"approach" when the sentence suggests how to solve the problem (a hint that only counts with give_hint), "judge" when it grades their idea
        (dropped in a hint turn), else None. Speech streams before the tools are seen, so such sentences wait for the end of the stream."""
        if not current_slot or not sentence.strip():
            return None
        if "?" in sentence:
            return None                                  # a question asks, it never hands over an approach, a grade or a move
        said = " ".join([self._echo_of, candidate_said or ""]).lower()
        if self._shown_number is not None and ANNOUNCES_CODING.search(sentence):
            return "coding"
        if APPROACH_SUGGESTION.search(sentence) and not PRAISES_THEIRS.search(sentence):
            terms = {t for t, rx in APPROACH_TERMS.items() if rx.search(sentence)}
            if not any(APPROACH_TERMS[t].search(said) for t in terms):
                return "approach"
        if JUDGES_THEIR_IDEA.search(sentence):
            return "judge"
        return None

    def _neutral_ack(self) -> str | None:
        lines = self.said.lines
        return lines.pick("backchannel") if lines is not None else "Okay."

    def _drop_held(self, held: str, rule: str, result: TurnResult, current_slot: str | None, candidate_said: str) -> list[str]:
        """A held sentence given up: an echo after a reported trace leaves its bare confirmation ("Right."), the rest is blocked."""
        if rule == "echo" and self._trace_reported and (confirmation := confirmation_of(held)) is not None:
            kept = self._check(confirmation, result, current_slot, candidate_said, release=True)
            if kept is not None:
                result.repaired.append((held, confirmation))
                return [kept]
        result.blocked.append({"sentence": held, "rule": rule, "match": "gives their answer back to them" if rule == "echo" else "a verdict again"})
        return []

    @staticmethod
    def _asks_beside_the_problem(text: str, said: Sequence[str]) -> bool:
        """The sentence is a question after the turn said "let's get into the coding now" (the problem is coming, the question is about
        something else), or it announces the coding or the problem after the turn already asked. A question after "give it a read" is about
        the problem on screen and is not held."""
        if text.rstrip().endswith("?"):
            return any(announces_coding_now(x) for x in said)
        return (announces_coding_now(text) or announces_problem(text)) and any(x.rstrip().endswith("?") for x in said)

    def _check(self, sentence: str, result: TurnResult, current_slot: str | None, candidate_said: str, release: bool = False) -> str | None:
        text = sentence.strip()
        if not text or text == SILENT:
            return None
        original = text
        raw_chars, self._turn_chars = self._turn_chars, self._turn_chars + len(text)
        if self._reasoning or is_reasoning(text, raw_chars):
            self._reasoning = True
            result.blocked.append({"sentence": text, "rule": "reasoning_aloud", "match": "private reasoning, not speech to the candidate"})
            return None
        if (script := foreign_script(text, self._known_words)) is not None:     # before _clean, which would strip the script
            result.blocked.append({"sentence": text, "rule": "language", "match": script})
            return None
        text = _clean(text)
        if not re.search(r"[A-Za-z0-9]", text):
            return None
        if says_duration(text, self.guard.duration_text(current_slot)):
            # Never any length of time, in any phase (decided 2026-10-18; a live round said "about twenty-two minutes on problems"): the sentence
            # is dropped. The one exception is a length that exactly matches one the current problem states.
            result.blocked.append({"sentence": text, "rule": "time_spoken", "match": "gives a length of time"})
            return None
        if (fixed := repair_stumble(text)) != text:
            result.repaired.append((text, fixed))
            text, original = fixed, repair_stumble(original)
        recent = " ".join([self._recent, *result.spoken])
        if (fixed := repair_false_link(text, recent, " ".join([self._heard, self.said.text(), recent]))) != text:
            result.repaired.append((text, fixed))
            text, original = fixed, repair_false_link(original, recent, " ".join([self._heard, self.said.text(), recent]))
        if (hit := MISSED_IT.search(text)) is not None and any(x.strip() and not ACKNOWLEDGES(x) for x in [*self._before, *result.spoken]):
            # "I didn't quite catch that" after a sentence that answered them says they were heard and not heard in one breath (live round
            # 781a1f0a, turn 49: "Ah, got it — keys help React tell items apart... I didn't quite catch that."). As the first sentence it is fine.
            result.blocked.append({"sentence": text, "rule": "unclear_after_content", "match": hit.group(0)})
            return None
        if not self._line_trouble_ok and (hit := CLAIMS_LINE_DROPPING.search(text)) is not None:
            # Transcripts are arriving, so unclear words are a mishearing, never the line (decided 2026-10-18): ask again, once, in the plain way.
            if any(contains("unclear", x) for x in [*self._before, *result.spoken]):
                result.blocked.append({"sentence": text, "rule": "line_claim", "match": hit.group(0)})
                return None
            fixed = repair_line_claim(text, self.said.lines.pick("unclear") if self.said.lines is not None else UNCLEAR_REPLY)
            result.repaired.append((text, fixed))
            text, original = fixed, fixed
        if (self._echo_of and not release and not result.spoken and not self._before and self._held_soft is None
                and (restates_first(text, self._echo_of) or lone_so_paraphrase(text, self._echo_of))):
            self._held_soft = (original, "echo" if restates_first(text, self._echo_of) else "echo_so")
            return None
        if self._echo_of and not release and result.spoken and restates_candidate(text, self._echo_of):
            # A later sentence that gives their answer back in other words (live round 781a1f0a, turns 9/14/41/43/54/56: "Okay, so you owned it
            # end to end." after a thank-you). Only the first sentence of a turn is held softly; here the turn has already said something.
            result.blocked.append({"sentence": text, "rule": "echo", "match": "restates what the candidate said"})
            return None
        if (hit := STOCK_PRAISE.search(text)) is not None:
            result.blocked.append({"sentence": text, "rule": "stock_praise", "match": hit.group(0)})
            return None
        if self._check_ack and not release and not result.spoken and EMPTY_ACK.match(text):
            self._held_ack = original
            return None
        if ASKS_RESTATE.search(text):
            result.blocked.append({"sentence": text, "rule": "asks_restate", "match": ASKS_RESTATE.search(text).group(0)})
            return None
        if ANNOUNCES_SILENCE.search(text):
            result.blocked.append({"sentence": text, "rule": "announces_silence", "match": ANNOUNCES_SILENCE.search(text).group(0)})
            return None
        if GO_AHEAD.search(text) and self.said.has(GO_AHEAD):
            result.blocked.append({"sentence": text, "rule": "repeat_instruction", "match": GO_AHEAD.search(text).group(0)})
            return None
        if TAKE_YOUR_TIME.search(text) and self.said.has(TAKE_YOUR_TIME):
            result.blocked.append({"sentence": text, "rule": "repeat_instruction", "match": "take your time"})
            return None
        if not self._time_talk_ok and TIME_PRESSURE.search(text):
            result.blocked.append({"sentence": text, "rule": "time_claim", "match": TIME_PRESSURE.search(text).group(0)})
            return None
        if ROUND_VERDICT.search(text):
            result.blocked.append({"sentence": text, "rule": "round_verdict", "match": ROUND_VERDICT.search(text).group(0)})
            return None
        if NEXT_STEPS_PROMISE.search(text) and (PEOPLE_FOLLOW_UP.search(text) or not PLATFORM_NEXT.search(text)):
            result.blocked.append({"sentence": text, "rule": "next_steps_promise", "match": NEXT_STEPS_PROMISE.search(text).group(0)})
            return None
        if DISMISSIVE.search(text):
            result.blocked.append({"sentence": text, "rule": "dismissive", "match": DISMISSIVE.search(text).group(0)})
            return None
        if VAGUE_MOVE.search(text):
            result.blocked.append({"sentence": text, "rule": "vague_move", "match": VAGUE_MOVE.search(text).group(0)})
            return None
        if self._fillers_on and RE_INTRODUCES.search(text):
            result.blocked.append({"sentence": text, "rule": "reintroduces", "match": "introduces themselves again"})
            return None
        if self._heard and (m := UNHEARD.search(text)) is not None:
            if claim_unheard(m.group(1), self._heard, text[:m.start()]):
                result.blocked.append({"sentence": text, "rule": "unheard_claim", "match": m.group(0)[:60]})
                return None
        if text.rstrip().endswith("?") and self._questions >= 1:
            result.blocked.append({"sentence": text, "rule": "one_question", "match": "a second question in the same turn"})
            return None
        if self._questions >= 1 and BARE_ACK.match(text):
            result.blocked.append({"sentence": text, "rule": "ack_after_question", "match": "a bare acknowledgement after the turn's question"})
            return None
        if speaks_about_them(text):
            result.blocked.append({"sentence": text, "rule": "internal_words", "match": "speaks about the candidate in the third person"})
            return None
        guess = SCREEN_GUESS.search(text)
        if guess and not CANNOT_SEE.search(text) and not (self._highlights_known and "highlight" in guess.group(0).lower()):
            result.blocked.append({"sentence": text, "rule": "screen_guess", "match": SCREEN_GUESS.search(text).group(0)})
            return None
        if self._block_clarify and invites_clarifying(text):
            result.blocked.append({"sentence": text, "rule": "questions_repeated", "match": "invites their questions again"})
            return None
        values = LIMITS_ALOUD if self._values_words_ok else VALUES_ALOUD
        if self._block_values and values.search(text):
            result.blocked.append({"sentence": text, "rule": "values_aloud", "match": values.search(text).group(0)})
            return None
        # After the turn of the request, until the problem changes, the limits stay off the air (a bare "zero" or an example's digits may be said).
        if self._limits_revealed and (hit := LIMITS_SPOKEN.search(text)) is not None:
            result.blocked.append({"sentence": text, "rule": "values_aloud", "match": hit.group(0)})
            return None
        if INTERNAL_WORDS.search(text):
            result.blocked.append({"sentence": text, "rule": "internal_words", "match": INTERNAL_WORDS.search(text).group(0)})
            return None
        if PROBLEM_NAME_DODGE.search(text):
            result.blocked.append({"sentence": text, "rule": "problem_name_dodge", "match": PROBLEM_NAME_DODGE.search(text).group(0)})
            return None
        if self._guessed and (hit := _AFFIRMS_GUESS.search(text)) is not None:
            # They guessed the problem's name or kind: never confirm it, never deny it (the fixed answer is PROBLEM_GUESS_ANSWER).
            result.blocked.append({"sentence": text, "rule": "problem_guess_affirmed", "match": hit.group(0)})
            return None
        if self.board_typed and (hit := UNREADABLE_BOARD.search(text)) is not None:
            # Seq 32-36 of a live round: the typed words were in its state and it said three times they were unreadable.
            result.blocked.append({"sentence": text, "rule": "board_unreadable", "match": hit.group(0)})
            return None
        if STIFF_DECLINE.search(text):
            result.blocked.append({"sentence": text, "rule": "stiff_decline", "match": STIFF_DECLINE.search(text).group(0)})
            return None
        if self._block_clarify and claims_screen_failed(text, self._echo_of) and not CANNOT_SEE_IT.search(self._echo_of):
            # The problem is on their screen (b1 rh_unplanned_resume_opener said it was not, and put it up again).
            result.blocked.append({"sentence": text, "rule": "screen_failed", "match": "says the problem did not show while it is on screen"})
            return None
        if opens_topic_while_coding(text, quiet=self._quiet):
            result.blocked.append({"sentence": text, "rule": "new_topic_while_coding", "match": "opens another topic while they write code"})
            return None
        if self._outline_said and gives_outline(text) and not (self._framing and "?" in self._echo_of):
            # (not when they asked about the format: the answer is the format)
            result.blocked.append({"sentence": text, "rule": "schedule_again", "match": "gives the schedule again"})
            return None
        prior = [*self._before, *result.spoken]
        if self.outline_expect is not None and gives_outline(text) and (why := outline_mismatch(" ".join([*prior, text]), *self.outline_expect)):
            # The spoken outline must name every promised area and no other (decided 2026-10-18): the conductor holds the deep dive to what was said.
            result.blocked.append({"sentence": text, "rule": "outline_mismatch", "match": why})
            return None
        if self.refusal_said is not None and (again := refusal_points(text) & (self.refusal_said | refusal_points(" ".join(prior)))):
            result.blocked.append({"sentence": text, "rule": "repeated_refusal", "match": f"makes a point about staying with the problem again: {', '.join(sorted(again))}"})
            return None
        if self.refusal_said is not None and (close := repeats_a_refusal(text, [*self.refusal_sentences, *result.spoken])):
            result.blocked.append({"sentence": text, "rule": "repeated_refusal", "match": f"says an earlier refusal again in other words: {close[:60]}"})
            return None
        if problem_line_part(text) is None and any(problem_line_part(x) is not None for x in prior):
            result.blocked.append({"sentence": text, "rule": "after_problem_line", "match": "speaks after the problem line, which ends the turn"})
            return None
        if repeats_a_move(text, prior):
            result.blocked.append({"sentence": text, "rule": "second_transition", "match": "a second move on in one turn"})
            return None
        if asks_after_close(text, prior, self.guard.visible.get(current_slot or "", ""), candidate_said):
            result.blocked.append({"sentence": text, "rule": "question_after_close", "match": "asks about the part it has just closed"})
            return None
        if self._block_close_coding and announces_leaving(text):
            # The plan has not left the problem and no order moves it: only the conductor decides that (decided 2026-10-18; a live round told the
            # candidate "let's leave this one there too... shift gears" and its go_to was then refused).
            result.blocked.append({"sentence": text, "rule": "left_problem", "match": "leaves the problem or the coding part while the plan stays on it"})
            return None
        if self._shown_number is not None and puts_up_problem_again(text, self._shown_number):
            result.blocked.append({"sentence": text, "rule": "problem_already_up", "match": "puts up the problem that is already on their screen"})
            return None
        if self._problem_ahead and closes_coding_part(text):
            # A problem is still ahead (b5 strong_fresher: "That wraps up the coding part. Let's get into the next one."): this one is over.
            fixed = "That wraps up this one."
            result.repaired.append((text, fixed))
            text = original = fixed
        if says_planned_later(text):
            result.blocked.append({"sentence": text, "rule": "planned_later", "match": "says its plan was to ask that later"})
            return None
        if UNEARNED_CREDIT.search(text):
            result.blocked.append({"sentence": text, "rule": "credit_unearned", "match": "credits them with finding it themselves"})
            return None
        if GARBLED.search(text) or text.startswith("sorry"):         # a lowercase "sorry," is the tail of a sentence that broke off
            result.blocked.append({"sentence": text, "rule": "garbled", "match": "breaks off and corrects itself"})
            return None
        # The framing's outline may say a problem will come up, so only the present tense is held back there: nothing is on screen.
        if self._block_claims and (claims_problem_on_screen_now(text) if self._framing
                                   else (SCREEN_CLAIM.search(text) or announces_problem(text) or announces_coding_now(text))):
            hit = SCREEN_CLAIM.search(text)
            result.blocked.append({"sentence": text, "rule": "screen_claim", "match": hit.group(0) if hit else "problem announced"})
            return None
        if not self._block_claims and self._asks_beside_the_problem(text, [*self._before, *result.spoken]):
            # A turn that puts the problem up asks nothing else (p21 seq 9: a project question, then "let me put the first problem on your
            # screen"): the candidate cannot answer both. Whichever comes second is held; the run's own problem line is the invitation.
            result.blocked.append({"sentence": text, "rule": "question_with_problem", "match": "a question beside the problem put-up"})
            return None
        if self._abuse_flagged and WARNS.search(text):
            result.blocked.append({"sentence": text, "rule": "warn_after_abuse", "match": WARNS.search(text).group(0)})
            return None
        confirms = [x for x in prior if asks_format_check(x)]
        if asks_format_check(text) and (self._framing or gives_outline(" ".join([*prior, text]))):
            # Decided 2026-10-18: the turn that gives the outline ends with one check, and it is asked once per round (a live round asked
            # three times when the candidate did not say yes). A second ask, or one in a turn that gives no outline, is held back.
            if self._confirm_asked or confirms or self._outline_said or not gives_outline(" ".join([*prior, text])):
                result.blocked.append({"sentence": text, "rule": "format_confirm", "match": "asks whether the format is okay again or outside the outline"})
                return None
        elif confirms and (text.rstrip().endswith("?") or asks_for_introduction(text)):
            # The check is the last thing the outline turn says: no introduction question after it.
            result.blocked.append({"sentence": text, "rule": "after_format_confirm", "match": "asks something after the format check"})
            return None
        if self._framing and self._outline_said and self._intro_begun and asks_for_introduction(text):
            result.blocked.append({"sentence": text, "rule": "intro_asked_again", "match": "asks for the introduction they have just begun"})
            return None
        if self._block_leave_taking and has_leave_taking(text) and not _is_end_line(text):
            # Thanks-for-your-time or a goodbye while the candidate's questions are only being opened (bf82d318 turn 37: "...thank you for your
            # time today. What questions do you have for me?" ended a 45-minute round at 5 minutes; decided 2026-10-18). The closing comes after.
            result.blocked.append({"sentence": text, "rule": "leave_taking_early", "match": text[:60]})
            return None
        if self._block_qa and invites_questions_now(text):
            result.blocked.append({"sentence": text, "rule": "questions_too_early", "match": "invites their questions"})
            return None
        if self._block_qa and WRAPS_UP.search(text) and not _is_end_line(text):
            # A live round, briefed to "close the round", said "I'll wrap up here" with a problem still ahead.
            result.blocked.append({"sentence": text, "rule": "wraps_up_early", "match": WRAPS_UP.search(text).group(0)})
            return None
        verdict = self.guard.check_sentence(text, current_slot=current_slot, candidate_said=candidate_said, selection=self.selection)
        if not verdict.ok:
            result.blocked.append({"sentence": text, "rule": verdict.rule, "match": verdict.match})
            return None
        if len(again := self.said.question_loop(text)) >= LOOP_AT:
            result.blocked.append({"sentence": text, "rule": "question_loop", "match": again[-1]})
            return None
        v3 = self.guard.check_requirement(text, current_slot=current_slot)
        if not v3.ok:
            result.blocked.append({"sentence": text, "rule": v3.rule, "match": v3.match})
            return None
        v2 = self.guard.check_insight(text, current_slot=current_slot, candidate_said=candidate_said, hint_step=self._hint_step,
                                        last_said=self._echo_of, next_step_allowed=self.refusal_said is None)
        if not v2.ok or INSIGHT_PRAISE.search(text):
            result.blocked.append({"sentence": text, "rule": "insight_completed", "match": v2.match or INSIGHT_PRAISE.search(text).group(0)})
            return None
        if not self._has_code and (claim := claims_code(text)) is not None:
            result.blocked.append({"sentence": text, "rule": "code_claim", "match": claim})
            return None
        if self._has_code and (asked := ASKS_CODE_AGAIN.search(text) or GO_AHEAD.search(text)):
            # "Sure, go ahead and write it." after the code is in the editor asks for what they have already written.
            result.blocked.append({"sentence": text, "rule": "asks_code_again", "match": asked.group(0)})
            return None
        turn_so_far = [*self._before, *result.spoken]
        # A sentence the turn has already said inside a longer one ("…the shorter pointer is safe holds up. That reasoning holds up.") is a repeat.
        contained = lambda prev: _words_within(text, prev)
        # A question that builds on the statement before it ("So a single number per position. How would you use that number...?") is not a repeat.
        builds_on = text.rstrip().endswith("?") and bool(turn_so_far) and "?" not in turn_so_far[-1]
        if (not builds_on and any(_overlap(text, prev) >= 0.6 or plain(text) == plain(prev) or contained(prev) for prev in turn_so_far)) \
                or (not builds_on and turn_so_far and restates(text, turn_so_far[-1])):
            result.blocked.append({"sentence": text, "rule": "repeat_in_turn", "match": "says again what this turn already said"})
            return None
        if BARE_ACK.match(text) and any(BARE_ACK.match(x) for x in turn_so_far):
            # Two bare acknowledgements in one turn ("Okay, cool. Hmm, okay.", run_b seq 15): the second is dropped (decided 2026-10-18).
            result.blocked.append({"sentence": text, "rule": "second_verdict", "match": "a second bare acknowledgement in the same turn"})
            return None
        if self._budget and not release and (rest := strip_verdict(text)) is not None:
            if rest:
                result.repaired.append((text, rest))
                kept = strip_verdict(original)
                text, original = rest, kept or rest
            elif result.spoken or self._before or self._held_soft is not None:
                result.blocked.append({"sentence": text, "rule": "verdict_budget", "match": "a verdict again"})
                return None
            else:
                self._held_soft = (original, "verdict_budget")      # alone it is kept: a turn with nothing in it is worse
                return None
        if ACKNOWLEDGES(text):
            if self._verdicts >= 1:
                # A second acknowledgement that carries a request keeps the request ("Great, tell me about yourself."): only the
                # acknowledgement opener goes. One that only judges is dropped.
                rest = _ACK_LEAD.sub("", text, count=1).strip()
                if rest and rest != text and ASKS_SOMETHING.search(rest) is not None:
                    fixed = rest[0].upper() + rest[1:]
                    result.repaired.append((text, fixed))
                    text, original = fixed, (_ACK_LEAD.sub("", original, count=1).strip() or fixed)
                    original = original[0].upper() + original[1:]
                else:
                    result.blocked.append({"sentence": text, "rule": "second_verdict", "match": "a second verdict in the same turn"})
                    return None
            else:
                self._verdicts += 1
        if self._opener_turn != self._turn_id and not is_safety_line(text):
            # The turn's first sentence: never the opener of the turn before, and not a third use within five turns (decided 2026-10-18). A
            # repeated one becomes an acknowledgement of the persona's own, or loses its lead-in; blocked only when neither is left.
            opener = turn_opener(text)
            if opener is not None and opener_repeated(opener, self._recent_openers(), self._opener_uses.get(opener, 0)):
                fixed = self._fresh_opener(text)
                if fixed is None:
                    result.blocked.append({"sentence": text, "rule": "repeated_opener", "match": opener})
                    return None
                result.repaired.append((text, fixed))
                text, original = fixed, fixed
        if (earlier := self.said.repeat_of(text)) is not None:
            result.blocked.append({"sentence": text, "rule": "repeat", "match": earlier})
            return None
        if self._quiet:
            if HINT_CUE.search(text):
                result.blocked.append({"sentence": text, "rule": "hint_while_typing", "match": HINT_CUE.search(text).group(0)})
                return None
            if self._remarks >= 1:
                result.blocked.append({"sentence": text, "rule": "quiet_limit", "match": "a second remark while they type"})
                return None                      # one short remark is enough while they type: the rest is dropped, not held against it
            self._remarks += 1
        if text.rstrip().endswith("?"):
            self._questions += 1
        spoken = one_ask(_clean(speakable(original)) or text)      # what the voice says: code read as a person says it, one ask per sentence
        if self._opener_turn != self._turn_id:
            self._opener_turn = self._turn_id
            self._drop_openers(self._turn_id)
            spoken_opener = None if is_safety_line(spoken) else turn_opener(spoken)
            self._openers.append((self._turn_id, spoken_opener))
            del self._openers[:-OPENER_WINDOW - 1]
            if spoken_opener is not None:
                self._opener_uses[spoken_opener] = self._opener_uses.get(spoken_opener, 0) + 1
        result.spoken.append(spoken)
        self.said.add(spoken, self._turn_id)
        return spoken
