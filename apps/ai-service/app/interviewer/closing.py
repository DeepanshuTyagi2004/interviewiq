"""Spotting a goodbye in what the interviewer just said. The talker is meant to move to the wrap-up and close, but a
model that says "take care" while still in the candidate's questions must not leave a live room open and talking."""
from __future__ import annotations

import re
from typing import Collection

from app.interviewer.lines import matches, put_up_ordinals, sentence_part
from app.interviewer.plan import _AREAS, mentions

_FAREWELL = re.compile(
    r"\b(take care|have a (?:great|good|nice|wonderful|lovely) (?:day|one|evening|week|weekend)|all the best|best of luck|"
    r"good ?bye|that'?s all from my side|that is all from my side|debrief will follow|we'?ll be in touch|"
    r"we will be in touch|speak soon|thanks? (?:you )?for your time|thank you for your time|let'?s close out|i'?ll wrap up here|we'?ll close here|"
    r"i'?ll end it here)\b", re.IGNORECASE)


def is_farewell(text: str) -> bool:
    """The turn takes its leave: a farewell phrase with nothing after it that asks the candidate something or invites their questions. "Thank you
    for your time today. What questions do you have for me?" opens the candidate's questions and is not a goodbye (bf82d318 turn 37 ended a
    45-minute round at 5 minutes on it; decided 2026-10-18). The last farewell phrase decides: "Any questions? Take care." still is one."""
    text = text or ""
    last = None
    for last in _FAREWELL.finditer(text):
        pass
    if last is None:
        return False
    tail = text[last.end():]
    return "?" not in tail and not _ASKS_QUESTIONS.search(tail)


def has_leave_taking(text: str) -> bool:
    """A farewell phrase anywhere in the text ("thank you for your time", "take care"), wherever it stands: the talker guard's test for a
    sentence that must not be said before the closing. `is_farewell` is the stricter test of whether the turn ENDS the round."""
    return bool(_FAREWELL.search(text or ""))


_LEAVE_TAKING = re.compile(
    r"\b(?:bye|good ?bye|take care(?!\s+of\b)|have a (?:great|good|nice|wonderful|lovely) (?:day|one|evening|week|weekend)|see you|"
    r"thank(?:s| you) for (?:your|the) time|thanks for the (?:interview|round|session)|all the best)\b"
    # Only a short addressee tail may follow ("today, Divya", "soon", "and all the best"): "I see you've used a hash map" and "thank
    # you for the time complexity analysis" carry on past the phrase and are not goodbyes.
    r"(?:[\s,\u2014\u2013-]+(?:today|tonight|then|now|soon|later|too|again|everyone|for now|next time|around|and good luck|"
    r"and all the best|(?-i:[A-Z][a-z]+))){0,2}\W*$", re.IGNORECASE)


def ends_with_goodbye(text: str) -> bool:
    """The LAST sentence of the text is a leave-taking ("Thanks, bye!", "You too, take care.", "Thanks for your time today."). A farewell
    phrase inside a longer sentence or earlier in the text ("I'll take care of the null case", "Best of luck with the second one") is not."""
    sentences = [x for x in re.split(r"(?<=[.?!])\s+", (text or "").strip()) if x]
    return bool(sentences) and bool(_LEAVE_TAKING.search(sentences[-1].rstrip(".!?\" ")))


_ASKS_QUESTIONS = re.compile(
    r"\b(?:any|other|more|some|what)\s+(?:other\s+|further\s+)?questions?\s+(?:for me|do you have|you have|on your mind)\b|"
    r"\b(?:what|anything)\b[^.?!]{0,40}\byou(?:'d| would)? like to (?:ask|know)\b|\bdo you have (?:any )?questions\b|"
    r"\bthe floor is yours\b|\byour questions now\b", re.IGNORECASE)
_STOP = frozenset("""about through that this with your have what would could which their there where when from into walk me you made
    decisions decision project projects can tell more also then them they were been being does did how why who""".split())


def asks_for_questions(text: str) -> bool:
    """The interviewer is inviting the candidate's own questions: said in the last sentence of the turn, so "then we'll get to your
    questions. In Java, why...?" (an announcement followed by another question) is not an invitation."""
    sentences = [x for x in re.split(r"(?<=[.?!])\s+", (text or "").strip()) if x]
    return bool(sentences and _ASKS_QUESTIONS.search(sentences[-1]))


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{5,}", (text or "").lower()) if w not in _STOP}


def asks_planned(text: str, prompt: str) -> bool:
    """The text asks the planned question `prompt`, perhaps reworded: at least two of its distinctive words in common (all of them when
    it has fewer than two), three when it has six or more."""
    want = _words(prompt)
    return bool(want) and len(_words(text) & want) >= min(len(want), 3, max(2, (len(want) + 1) // 2))


def asks_planned_stems(text: str, prompt: str) -> bool:
    """`asks_planned` by word stems (the first five letters of each distinctive word): "idempotent" asks about "idempotency", "policies" about "policy"
    (decided 2026-10-18; a deep dive re-asked an area because a pool question was only paraphrased with another word form)."""
    want = {w[:5] for w in _words(prompt)}
    return bool(want) and len({w[:5] for w in _words(text)} & want) >= min(len(want), 3, max(2, (len(want) + 1) // 2))


def matches_probe(text: str, probes: list[str]) -> bool:
    """The text asks one of the blueprint's resume probes (three or more of its distinctive words in common)."""
    spoken = _words(text)
    return any(len(spoken & _words(p)) >= 3 for p in probes if p)


# An invitation to carry on ("go ahead, finish your thought") hands them the turn as much as a question does: after it, a
# follow-up of the interviewer's own talks over the candidate.
_ASKS = re.compile(r"\?|\b(?:tell me|walk me through|talk me through|take me through|describe|give me|explain|share|show me|"
                   r"go ahead|carry on|keep going|(?:please )?continue|finish your (?:thought|point|sentence|answer)|you were saying)\b",
                   re.IGNORECASE)


def addresses_the_candidate(text: str) -> bool:
    """The text asks the candidate something or tells them to do something (a question mark, or "tell me", "walk me through")."""
    return bool(_ASKS.search(text or ""))


_PROBLEM_WORD = re.compile(r"\b(?:problems?|coding|exercise)\b", re.IGNORECASE)
_NOW_CUE = re.compile(
    r"\bnow\b|\bscreen\b|\bonto\b|\binto\b|\bget (?:you )?to\b|\bappear|\bpull(?:ing)?\b|\bput(?:ting)?\b|\bshow(?:ing)?\b|\bmove (?:on )?to\b|"
    r"\bjump|\bdive|\bkick off\b|\btackle\b|\b(?:is|are|was|'s)\s+up\b|\bup (?:on|for)\b|\b(?:bring|bringing)\b[^.?!]{0,14}\bup\b|\bready\b|"
    r"\bhere (?:it|we) (?:is|go)\b", re.IGNORECASE)


_OUTLINE = re.compile(r"\bround\b|\bminutes?\b|\bthen\b|\bafter that\b|\bfinally\b|\bat the end\b|\bafterwards\b|\blater\b|\bup front\b|\bfirst\b",
                      re.IGNORECASE)
_OUTLINE_MARKERS = re.compile(r"\bthen\b|\bafter that\b|\bfinally\b|\bat the end\b|\bafterwards\b|\bfirst\b|\bstart(?:ing|s)? with\b|\bbegin(?:ning|s)? with\b|"
                              r"\bfinish(?:ing)? (?:with|off with|up with)\b|\bend(?:ing)? with\b", re.IGNORECASE)    # p20: "starting with ..., then ..., and we'll finish with ..."
_ROUND_WORDS = re.compile(r"\bround\b|\bminutes?\b|\bhow (?:this|the|it) (?:will )?(?:go|run|work)\b|\bhow the next part\b", re.IGNORECASE)
_PROBLEMS_WORDS = re.compile(r"\bcoding\b|\bproblems?\b|\bproblem solving\b|\bquestions\b", re.IGNORECASE)


def gives_outline(text: str) -> bool:
    """The text tells the candidate how the round will run (its parts, in order, and the time for their questions)."""
    t = text or ""
    return len(t.split()) >= 18 and bool(_ROUND_WORDS.search(t)) and bool(_PROBLEMS_WORDS.search(t)) and len(_OUTLINE_MARKERS.findall(t)) >= 2


def outline_areas(text: str) -> set[str]:
    """The fundamentals areas a text names, by the same patterns that tag a round question's area ("SQL" is databases, "JVM" is Java)."""
    return {label for label, pattern in _AREAS if pattern.search(text or "")}


# A language named as the one to code in ("a coding problem you can solve in Java or Python") is no fundamentals area.
_LANGS = r"(?:java|python|javascript|typescript|c\+\+|go)"
_LANGUAGE_USE = re.compile(
    r"\b(?:code|coding|write|writing|solve|solving|implement\w*|program\w*)\b(?:(?!\b(?:then|fundamentals?|questions?|after|finally)\b)[^.?!;:,]){0,30}?"
    rf"\b(?:in|using|with)\s+{_LANGS}\b(?:\s*(?:,|/|or|and)\s*{_LANGS}\b)*", re.IGNORECASE)


_KNOWN_AREAS = frozenset(label for label, _ in _AREAS)     # these are named by their patterns only ("JavaScript" is not "Java")


def _stem(word: str) -> str:
    return word.lower().rstrip("s")[:4]


def _label_named(label: str, text: str) -> bool:
    """A promise label is named when its words are in the text, in any form ("API design" is named by "designing APIs")."""
    want = {_stem(w) for w in re.findall(r"[A-Za-z]{3,}", label)}
    have = {_stem(w) for w in re.findall(r"[A-Za-z]{3,}", text or "")}
    return bool(want) and want <= have


def outline_mismatch(text: str, areas: Collection[str], projects: Collection[str] = ()) -> str | None:
    """Why a spoken outline does not match the round's promises, or None when it does: every promised area is named (in any wording the area
    patterns know, by its own label or by the label's words) and no other area is; promised projects only need to be mentioned (the word
    "project", or a promised project's name). A project's own name never counts as an area ("your React Dashboard project" names no React
    area), and neither does a language named to code in."""
    scrubbed = text or ""
    for name in sorted((p for p in projects if p), key=len, reverse=True):
        scrubbed = re.sub(rf"(?<!\w){re.escape(name)}(?!\w)", " ", scrubbed, flags=re.IGNORECASE)
    scrubbed = _LANGUAGE_USE.sub(" ", scrubbed)
    named = outline_areas(scrubbed)
    missing = [a for a in areas if a not in named and not mentions(a, scrubbed)
               and (a in _KNOWN_AREAS or not _label_named(a, scrubbed))]
    extra = sorted(named - set(areas))
    if missing:
        return f"does not name {', '.join(missing)}"
    if extra:
        return f"names {', '.join(extra)}, which the round does not cover"
    if projects and not re.search(r"\bprojects?\b", text or "", re.IGNORECASE) and not any(mentions(p, text) for p in projects):
        return "does not say it will ask about their projects"
    return None


_CODING_NOW = re.compile(
    r"\blet'?s\b[^.?!]{0,30}\b(?:technical|coding|problem[- ]solving|dsa)\b|"
    r"\b(?:move|moving|switch|switching|turn|turning|jump|jumping|dive|diving|get|getting|go|going)\b[^.?!]{0,20}\b(?:to|into|onto)\b[^.?!]{0,16}\b(?:technical|coding|problem[- ]solving)\b|"
    r"\btime (?:for|to)\b[^.?!]{0,16}\b(?:technical|coding|problem[- ]solving)\b", re.IGNORECASE)


_OUTLINE_STRUCTURE = re.compile(r"\bround\b|\binterview\b|\bhow (?:this|the|it) (?:will )?(?:go|run|work)\b|\bhow the next part\b", re.IGNORECASE)
_DESCRIBES_ROUND = re.compile(r"\bwe(?:'ll| will)\b[^.?!]*\b(?:then|after that|followed by)\b", re.IGNORECASE)


def announces_coding_now(text: str) -> bool:
    """The text says the technical or coding part starts now ("let's get started with the technical part"), unlike a sentence that
    describes the round ("we'll start with some background, then the coding part, and finish with your questions")."""
    t = text or ""
    if _DESCRIBES_ROUND.search(t):
        return False          # "We'll start with a chat about you, then get into a coding problem" describes the round, it starts nothing
    # Only a real outline (round or interview words and parts in order) is a description: "starting with brute force, then optimize it"
    # after "let's get into the coding now" is a start, not an outline.
    return bool(_CODING_NOW.search(t)) and not (len(_OUTLINE_MARKERS.findall(t)) >= 2 and _OUTLINE_STRUCTURE.search(t))


_PRESENT_CLAIM = re.compile(
    r"\b(?:the|that|this) (?:problem|question) on (?:your|the) screen\b|"
    r"\bhere(?:'s| is) your (?:first|second|third|next) (?:question|problem)\b|"
    r"\bgive it a (?:read|look)\b|"
    r"\b(?:your|an?) (?:approach|solution|plan) (?:to|for) the (?:problem|question)\b(?!\s+of\b)", re.IGNORECASE)
_FUTURE_WORD = r"(?:will|won'?t|going to|gonna|later|shortly|soon|eventually|once|after that|when we)\b|'ll\b"
_FUTURE_BEFORE = re.compile(rf"(?:{_FUTURE_WORD})(?:[^,;.?!\u2014]*)$", re.IGNORECASE)      # a future word governing the claim: same clause, before it
_FUTURE_AFTER = re.compile(rf"^\s*(?:\w+\s+){{0,2}}(?:{_FUTURE_WORD})", re.IGNORECASE)    # "...on your screen will come up", right after it


def claims_problem_on_screen_now(text: str) -> bool:
    """A sentence that says, in the present tense, that a problem is on their screen or about to be worked on ("the problem on your
    screen", "here's your first question", "give it a read", "let's get into the coding now", "your approach to the problem"). The framing's
    outline may say a problem will come up ("I'll put a problem on your screen later"): a future word cancels only the claim it governs
    (in its clause, before the claim or just after it), and "now" keeps the claim. The caller knows no problem is up; this only reads the words."""
    for sentence in re.split(r"(?<=[.?!])\s+", text or ""):
        claims = [m for m in _PRESENT_CLAIM.finditer(sentence)]
        if announces_coding_now(sentence):
            claims.append(_CODING_NOW.search(sentence))
        for m in claims:
            governed = _FUTURE_BEFORE.search(sentence[:m.start()]) or _FUTURE_AFTER.search(sentence[m.end():])
            if governed and not re.search(r"\bnow\b", sentence, re.IGNORECASE):
                continue
            return True
    return False


_AT_ONCE = re.compile(r"\bscreen\b|\bnow\b|\bpull(?:ing)?\b|\bappear|\bget (?:you )?(?:to|onto)\b|\bonto\b", re.IGNORECASE)


_GIVE_IT_A_READ = re.compile(r"\bgive it a (?:read|look)\b", re.IGNORECASE)
_PROBLEM_LINE = re.compile(r"\bgive it a (?:read|look)\b|\bhere(?:'s| is) your (?:first|second|third|next) (?:question|problem)\b", re.IGNORECASE)


def says_the_problem_line(text: str) -> bool:
    """The text is (or contains) the one short line that puts a problem up ("Here's your first question. Give it a read, ...")."""
    return bool(_PROBLEM_LINE.search(text or ""))


_NO_PROBLEM_YET = re.compile(r"\b(?:no|not|isn'?t|nothing|haven'?t|hasn'?t|without)\b[^.?!]{0,40}\b(?:on|up on|onto) your screen\b|"
                             r"\bno (?:coding )?(?:problem|question)\b[^.?!]{0,20}\b(?:yet|up)\b|\bnot (?:up )?yet\b", re.IGNORECASE)


_DEFERS = re.compile(
    r"\b(?:shortly|soon|in a (?:bit|moment|minute|little while)|in a few (?:minutes|moments))\b|\bbut first\b|\bfirst though\b|\bbefore that\b|"
    r"\bbefore we (?:get|go|move|jump|dive|start)\b|\bafter that\b|\blater\b|\bonce (?:we|you|i)\b", re.IGNORECASE)


def announces_problem(text: str) -> bool:
    """The sentence announces or promises the coding problem now ("let's get you onto the problem", "it's on your screen", "here's your
    first question, give it a read") as opposed to describing how the round will run ("one coding problem, then your questions at the end")."""
    t = text or ""
    if _NO_PROBLEM_YET.search(t):
        return False          # "There's no problem on your screen yet" says the opposite: it must never put one up
    if _GIVE_IT_A_READ.search(t):
        return True
    if _DEFERS.search(t):
        return False          # "We'll get to the coding shortly, but first tell me about yourself" puts the coding off, it does not start it
    if not (_PROBLEM_WORD.search(t) and _NOW_CUE.search(t)):
        return False
    if t.rstrip().endswith("?") and not re.search(r"\bscreen\b|\bput(?:ting)?\b|\bpull(?:ing)?\b", t, re.IGNORECASE):
        return False          # "What problem did you run into with the shell?" asks about their work, it does not give them a problem
    return bool(_AT_ONCE.search(t)) or not _OUTLINE.search(t)


_LEAVES = re.compile(
    r"\bmove (?:on|us on)\b|\bmoving on\b|\b(?:putting|put|pulling|pull|bringing|bring)\b[^.?!]{0,16}\bup\b|\blet'?s do one more\b|\bsecond (?:problem|one|question)\b|\bwe(?:'ll| will) do (?:one|another)\b|\banother (?:problem|one|question)\b|\bone more (?:problem|question|one)\b|\btry one more\b|\bnext (?:problem|question|one|part)\b|\bswitch (?:gears|to)\b|"
    r"\bwe(?:'ll| will) leave it there\b|\bleave it there\b|\blet'?s (?:leave|park|wrap|stop)\b|\bwell done on this one\b|\bthat'?s (?:all|enough) (?:on|for) this\b|"
    r"\bout of time\b|\bwe(?:'re| are) (?:done|good) (?:on|with) this\b|"
    r"\bwraps? up\b|\bwrapped up\b|\bwe(?:'re| are) done with (?:that|this|the)\b|\bdone with (?:that|this|the) (?:coding|problem|one|part)\b|"
    r"\blet'?s (?:use|spend) the rest\b|\blet'?s (?:go|dive|get) (?:deeper|into|to)\b|\blet'?s (?:talk|chat) (?:a bit |more )?(?:about|on) your\b|"
    r"\blet'?s (?:turn|shift) to\b|\bmove (?:over )?to your (?:projects?|background)\b", re.IGNORECASE)


_CLOSES_CODING = re.compile(
    r"\bthat(?:'s| is)? (?:wraps?|wrapped) up (?:the )?coding\b|\bwraps? up (?:the )?coding (?:part|round|section)\b|"
    r"\bthat(?:['’]s| is) (?:the )?coding (?:part )?(?:done|finished|over|complete)\b|\b(?:the )?coding (?:part )?(?:is|was) (?:now )?(?:done|over|finished)\b|"
    r"\bthat(?:['’]s| is) it for the coding\b|"
    r"\blet(?:'s| us) leave the coding (?:there|here)\b|"
    # The lead-in to the deep dive says the same thing: the coding is over and the projects come next.
    r"\bnow,? (?:a couple of|a few|some) (?:quick )?questions about your (?:projects|background|experience)\b|\b(?:we(?:['’]re| are)|i(?:['’]m| am)) (?:done|finished|through) with the coding\b", re.IGNORECASE)


_CONDITION_WORD = re.compile(r"\b(?:when|once|if|after|until|as soon as|unless)\b", re.IGNORECASE)


def closes_coding_part(text: str) -> bool:
    """The sentence declares the coding part over ("That wraps up the coding part.", "That's the coding done."). A conditional ("the coding
    is done when your tests pass") says nothing is over yet."""
    t = text or ""
    return bool(_CLOSES_CODING.search(t)) and not _CONDITION_WORD.search(t)


_LEAD_IN = re.compile(
    r"\bnow,? (?:a couple of|a few|some) (?:quick )?questions\b|\blet'?s (?:talk|chat) (?:a bit |more )?about your\b|\blet'?s (?:use|spend) the rest\b|"
    r"\bmove (?:over )?to your\b|\b(?:turn|shift) to your\b|\btime for your questions\b|\bquestions (?:about|on) your (?:projects|background|experience)\b",
    re.IGNORECASE)


def leads_into_next_part(text: str) -> bool:
    """The sentence opens the next part after the coding ("Now a couple of questions about your projects.")."""
    return bool(_LEAD_IN.search(text or ""))


_REFERS_TO_PROBLEM = re.compile(r"\b(?:your|that|this|the) (?:code|solution|loop|function|input|implementation|problem|algorithm|data structure)\b", re.IGNORECASE)
_REFERS_STOP = frozenset("""about above after again also another because before being between could does doing each else ever from have here into just
    like make many more most much only other over same should some such than that their them then there these they this those through
    under very want what when where which while will with would your yours actually really still tell mean""".split())


def refers_to_problem(question: str, problem_text: str = "", said_text: str = "") -> bool:
    """A question that is about the problem the candidate just worked on: it says "your code", "this problem", "that solution", "the input",
    or shares at least two distinctive words with the problem's text and what they said while coding."""
    if _REFERS_TO_PROBLEM.search(question or ""):
        return True
    mine = {w for w in re.findall(r"[a-z]{5,}", (question or "").lower()) if w not in _REFERS_STOP}
    theirs = {w for w in re.findall(r"[a-z]{5,}", f"{problem_text} {said_text}".lower()) if w not in _REFERS_STOP}
    return len(mine & theirs) >= 2


# ---- the screen "failed", a new topic while they code, the problem's fixed lines, the round length (polish, 2026-10-17)

_SHOW_FAILED = re.compile(
    # Only the screen: the problem (or "it") did not show / load / come up / appear on (or onto) your or the screen, or the screen is blank.
    # "didn't make it clear" and "isn't showing the constraint" are ordinary talk about the problem.
    r"\b(?:problem|question|it)\b[^.?!]{0,20}\b(?:didn'?t|did not|hasn'?t|has not|failed to|isn'?t|is not|wasn'?t|was not)\s+(?:seem to\s+|properly\s+|yet\s+)*"
    r"(?:show(?:ing)?(?: up)?|load(?:ed|ing)?|come up|came up|make it|made it|appear(?:ed|ing)?)\b[^.?!]{0,15}\b(?:on|onto|in) (?:your|the) screen\b|"
    r"\b(?:made it|show(?:ed)? up|came up) (?:on|onto) your screen properly\b|"
    r"\byour screen (?:is|went|looks|has gone) blank\b", re.IGNORECASE)
_PUT_UP_AGAIN = re.compile(r"\blet me (?:put|pull|bring|show|send) (?:it|the problem) up again\b", re.IGNORECASE)
# They asked for it again, or for a part of it, or said they cannot see it: putting it up again is an answer, not a claim that it failed.
_ASKED_AGAIN = re.compile(r"\bagain\b|\bconstraints?\b|\bformat\b|\bexamples?\b|\brepeat\b|\bsay (?:that|it)\b|\bcan'?t see\b|\bcannot see\b|\bnot (?:showing|loading)\b|"
                          r"\bdon'?t see\b|\bnothing\b|\bblank\b", re.IGNORECASE)
_CONDITIONAL = re.compile(r"^\W*(?:if|when|in case|whenever)\b", re.IGNORECASE)


def claims_screen_failed(text: str, candidate: str = "") -> bool:
    """The sentence explicitly says the problem or the screen failed to show ("the problem didn't load", "made it onto your screen
    properly", "your screen went blank"), or puts the problem up again when they did not ask for it again. Said while it is on screen it
    is false (b1 rh_unplanned_resume_opener). Ordinary talk about what an example shows is not this."""
    t = text or ""
    if _CONDITIONAL.search(t):
        return False
    if _SHOW_FAILED.search(t):
        return True
    return bool(_PUT_UP_AGAIN.search(t) and not _ASKED_AGAIN.search(candidate or ""))


_WHILE_YOU = re.compile(
    r"\bwhile you (?:do|write|code|type|work|are (?:writing|coding|typing)|'re (?:writing|coding|typing))\b[^.?!]*"
    r"\b(?:let me|i'?ll|i will|can i|could i|tell me|talk about|ask (?:you|something|another|about)|a (?:different |another )?question|something else|another)\b",
    re.IGNORECASE)
_NEW_TOPIC = re.compile(
    r"\b(?:meanwhile|in the meantime)\b,?[^.?!]*\b(?:ask|question|tell me|talk|about)\b|\blet me ask (?:you )?(?:something|another|a different|one more)\b|"
    r"\bsomething (?:else|unrelated)\b|\bswitch(?:ing)? (?:topics|gears)\b|\bon another note\b|\ba different (?:question|topic)\b", re.IGNORECASE)


def opens_topic_while_coding(text: str, quiet: bool = True) -> bool:
    """The sentence opens another topic or question while they write code ("while you do, let me ask something else"). "While you ..." is
    caught always; the looser phrases only when `quiet` (they have just said they are starting to code)."""
    t = text or ""
    return bool(_WHILE_YOU.search(t) or (quiet and _NEW_TOPIC.search(t)))


_PUT_UP = re.compile(r"^\W*let me put (?:the \w+|a different) problem on your screen\W*$", re.IGNORECASE)
_INTRO_FIRST = re.compile(r"^\W*here(?:'s| is) your \w+ question\W*$", re.IGNORECASE)
_INTRO_END = re.compile(r"^\W*give it a read\b", re.IGNORECASE)


def problem_line_part(sentence: str) -> str | None:
    """Which part of the run's fixed problem lines a sentence is: "put_up" (the put-up line), "intro" (the first sentence of the intro line)
    or "intro_end" (its second); None for anything else."""
    s = sentence or ""
    # The run's lines are pools of wordings (lines.py, 2026-10-18): a wording of the pool counts, as does the looser pattern (a model's own wording).
    # A swap's line is an acknowledgement then the put-up sentence: only the put-up sentence is the line.
    if _PUT_UP.search(s) or matches("put_up", s) or sentence_part("swap_put_up", s) == 1:
        return "put_up"
    if _INTRO_FIRST.search(s) or sentence_part("intro", s) == 0:
        return "intro"
    return "intro_end" if _INTRO_END.search(s) or sentence_part("intro", s) == 1 else None


# Any length of time of the round, a part or what is left of it is never spoken (decided 2026-10-18; a live round said "We'll spend about twenty-two
# minutes on problems"). A unit always needs a number before it ("five minute part", "forty-five-minute", "thirty seconds", "a couple of minutes"), so
# "a min heap", "the min of the window", "I spent hours debugging" and "a minute" ("take your minute") and "time" stay ordinary words.
_ONES = "one|two|three|four|five|six|seven|eight|nine"
_NUMBER_WORD = (rf"(?:(?:zero|{_ONES}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|"
                rf"seventy|eighty|ninety|hundred)(?:[- ](?:{_ONES}))?|a couple of|a couple|couple of|a few|few|several)")
_DURATION = re.compile(
    rf"\b\d+(?:\s*-\s*\d+)?(?:\s+(?:more|extra|full))?\s*-?\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)\b|"
    rf"\b{_NUMBER_WORD}(?:\s+(?:more|extra|full|good|whole))?[ -](?:minutes?|hours?|seconds?)\b|"
    r"\b(?:half an hour|an hour)\b", re.IGNORECASE)


_UNITS_N = {w: n for n, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen "
                                        "eighteen nineteen".split())}
_TENS_N = {w: 10 * n for n, w in enumerate("_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()) if w != "_"}


_UNIT_WORDS = {"min": "minute", "minute": "minute", "hr": "hour", "hour": "hour", "sec": "second", "second": "second"}


def _unit(word: str) -> str:
    """A unit of time (plural or abbreviated) as its singular full word; any other word as it is."""
    return _UNIT_WORDS.get(word[:-1] if word.endswith("s") else word, word)


def _duration_key(phrase: str) -> str:
    """A length of time spelled one way in a form that spelling cannot change: number words and digits ("ten" = "10", "forty-five" = "45"), units
    singular and unabbreviated ("mins", "minutes" = minute; "hrs" = hour; "secs" = second), and "an hour"/"one hour"/"1 hour" the same."""
    tokens = re.findall(r"[a-z0-9]+", (phrase or "").lower())
    tokens = ["one" if t == "an" and i + 1 < len(tokens) and re.match(r"hours?$", tokens[i + 1]) else t for i, t in enumerate(tokens)]
    out: list[str] = []
    i = 0
    while i < len(tokens):
        w = tokens[i]
        if w in _TENS_N:
            n = _TENS_N[w]
            if i + 1 < len(tokens) and 1 <= _UNITS_N.get(tokens[i + 1], 0) <= 9:
                n += _UNITS_N[tokens[i + 1]]
                i += 1
            out.append(str(n))
        else:
            out.append(str(_UNITS_N[w]) if w in _UNITS_N else _unit(w))
        i += 1
    return " ".join(out)


_DURATION_PHRASE = re.compile(rf"(?:\b(?:about|around|roughly|approximately|for|within|up to|at most|no more than|just|only)\s+)*(?:{_DURATION.pattern})", re.IGNORECASE)


def strip_durations(text: str) -> str:
    """The text with every length of time put as "a short while" ("Spend about 5 minutes on the project" gives "Spend a short while on the project"):
    the persona's phase guidance reaches the interviewer as written, and it never says a length (decided 2026-10-18)."""
    return _DURATION_PHRASE.sub("a short while", text or "")


def says_duration(text: str, allowed: str = "") -> bool:
    """The sentence gives a length of time ("about twenty-two minutes", "half an hour", "ten minutes left", "the next 15 minutes"), which the interviewer
    never says (decided 2026-10-18; owner-approved: every length is blocked, whatever the sentence around it). The one exception is a length that exactly
    matches a length stated in `allowed`, the current problem's text (statement, examples, constraints, follow-ups, probes, clarifications): the same
    number and unit as a whole length ("10 minutes" is "ten minutes"; "5 minutes" is not "15 minutes"). The candidate's words never exempt one."""
    stated = {_duration_key(m.group(0)) for m in _DURATION.finditer(allowed or "")}
    return any(_duration_key(m.group(0)) not in stated for m in _DURATION.finditer(text or ""))


# Leaving the problem or the coding part, or putting another problem up, said in ways `closes_coding_part` does not cover (a live round, 2026-10-18:
# "Looks like we're not getting much coding going today. Let me shift gears, and we'll talk about your projects and some fundamentals instead.").
_ABANDONS = re.compile(
    r"\blet(?:'s| us) (?:leave|drop|park|skip)\b[^.?!]{0,25}\b(?:this|it|that|here|there)\b|\bleave (?:this|that) (?:one|problem|question)\b|"
    r"\b(?:shift|shifting|switch|switching) gears\b|\bnot getting (?:much|any) coding\b|"
    r"\bmov(?:e|ing) on to (?:your (?:projects?|background|experience)|the (?:next|fundamentals|projects?)|some (?:fundamentals|questions)|something else|another)\b|"
    r"\b(?:we(?:'ll| will)|let(?:'s| us)) (?:talk|chat|switch|move|turn) (?:about|to|over to) (?:your (?:projects?|background|experience)|(?:some |the )?fundamentals)\b|"
    r"\b(?:your projects?|(?:some |the )?fundamentals) instead\b", re.IGNORECASE)


def abandons_problem(text: str) -> bool:
    """The sentence says the problem or the coding part is being left ("let's leave this one there", "shift gears", "that wraps up the coding")."""
    t = text or ""
    return closes_coding_part(t) or bool(_ABANDONS.search(t))


def announces_leaving(text: str) -> bool:
    """The sentence says the problem or the coding part is being left, or that another problem is coming: only the conductor decides that (the
    plan has to follow it), so a turn that is not ordered to move says none of it."""
    return abandons_problem(text) or moves_to_another_problem(text or "")


_ORDINALS = ("first", "second", "third", "fourth")
_PUTS_UP_AGAIN = re.compile(
    r"\blet me put (?:the (first|second|third|fourth)|a different) (?:problem|one|question) on your screen\b|"
    r"\bhere(?:'s| is) your (first|second|third|fourth) (?:question|problem)\b|"
    r"\b(?:problem|question|one) (?:should be|is) (?:up|on your screen) now\b|\bgive it a (?:read|look)\b", re.IGNORECASE)


def puts_up_problem_again(text: str, number: int) -> bool:
    """The sentence puts up, or says it has put up, problem `number` (the one on their screen already): its put-up line, its intro line,
    "give it a read", "it should be up now". The line for the next problem names another ordinal and is not this."""
    mine = _ORDINALS[min(max(number, 1), len(_ORDINALS)) - 1]
    if any(said == mine for said in put_up_ordinals(text)):             # any wording of the put-up line (lines.py)
        return True
    if any(sentence_part("swap_put_up", x) == 1 for x in re.split(r"(?<=[.?!])\s+", text or "")):     # a swap's "a different problem" names no position
        return True
    for m in _PUTS_UP_AGAIN.finditer(text or ""):
        said = (m.group(1) or m.group(2) or "").lower()
        if not said or said == mine:
            return True
    return False


def leaves_the_part(text: str) -> bool:
    """What was said closes the current part of the interview ("let's move on", "I have another problem", "well done on this one")."""
    return bool(_LEAVES.search(text or ""))


_INTRO_ASK = re.compile(
    r"\bintroduce yourself\b|\b(?:a|your|short|quick|brief) (?:self-?)?introduction\b|\btell me about yourself\b|\btell me (?:a bit|a little) (?:more )?about (?:you|yourself|your background|that role)\b|"
    r"\bstart with you\b|\bwalk-?through of (?:yourself|your background)\b|"
    r"\b(?:tell|walk|give|share|hear)\b[^.?!]{0,30}\byour background\b", re.IGNORECASE)     # not "a chat about your background": that describes the round


def asks_for_introduction(text: str) -> bool:
    """The text asks the candidate to introduce themselves ("tell me about yourself", "give me a short introduction")."""
    return bool(_INTRO_ASK.search(text or ""))


_INTRO_BEGUN = re.compile(
    r"\b(?:i['\u2019]?m|i am|my name(?:['\u2019]s| is)|this is|i have|i['\u2019]?ve|i (?:study|studied|work|worked|graduated|graduate|build|built|am a|did|do))\b", re.IGNORECASE)


def starts_introduction(text: str) -> bool:
    """The candidate's reply already begins their introduction ("okay, so I'm Deepanshu, a 2026 graduate, and I've mostly built backend
    services"): a statement about themselves of some length, not a bare yes and not a question."""
    t = (text or "").strip()
    return len(t.split()) >= 8 and "?" not in t and bool(_INTRO_BEGUN.search(t))


_ANOTHER_PROBLEM = re.compile(r"\b(?:fresh|new|another|different|next|second|one more)\s+(?:coding\s+)?problem\b", re.IGNORECASE)


_FORWARD = re.compile(r"\blet'?s\b|\blet me\b|\bhere'?s your\b|\bput\b|\blet us\b|\bi'?ll\b|\bi will\b|\bwe'?ll\b|\bi have\b|\bi'?ve got\b|\bi want to\b|\bmov(?:e|ing)\b|"
                      r"\bhow about\b|\btime for\b|\bgoing to\b|\btry\b|\bgive you\b", re.IGNORECASE)


def moves_to_another_problem(text: str) -> bool:
    """What was said promises a different coding problem ("let's try a fresh problem", "I have another problem for you"). Describing
    the problem they are on ("this second problem is on your screen") or a "next question" (a follow-up on the same problem) is not."""
    t = text or ""
    return bool(_ANOTHER_PROBLEM.search(t) and _FORWARD.search(t))


_QUESTIONS_NOW = re.compile(
    r"\byour questions\b|\bquestions for me\b|\bany (?:other |more |further )?questions\b|\bwhat would you like to (?:ask|know)\b|"
    r"\bwhat do you want to (?:ask|know)\b|\bthe floor is yours\b|\byour chance (?:to )?ask\b", re.IGNORECASE)
_LATER = re.compile(r"\bbefore (?:we|I)\b|\bat the end\b|\bto close\b|\bto finish\b|\bafter that\b|\bthen\b|\bround\b|\blater\b|\bwill be time\b|\bleave time\b|\bsome time\b|"
                    r"\bminutes\b", re.IGNORECASE)


_CLOSING_ASK = re.compile(r"\bbefore we (?:close|wrap(?: up)?|end|stop|finish)\b[^.!?]*\?", re.IGNORECASE)
# Announcing the end of the round ("I'll wrap up here"): only right when the plan is at its end or an ending was ordered.
WRAPS_UP = re.compile(r"\b(?:wrap (?:it |this |things )?up|wrap up here|stop (?:the interview |the round )?here|end (?:the interview|the round|it) here|"
                      r"(?:that'?s|that is) all (?:for|from me for) today|we'?ll (?:close|stop|end) (?:here|there|now))\b", re.IGNORECASE)


def invites_questions_now(text: str) -> bool:
    """The text hands the floor to the candidate's own questions now ("any questions for me?", "let me move us on to your questions"),
    as opposed to saying that time for them comes at the end of the round."""
    t = text or ""
    if _GIVE_IT_A_READ.search(t):
        return False          # "Give it a read, and let me know if you have any questions" is about the problem they were just given
    if _QUESTIONS_NOW.search(t) and _CLOSING_ASK.search(t):
        return True           # "any questions for me before we close?" asks now; only an outline's "before we finish" is later
    return bool(_QUESTIONS_NOW.search(t)) and not _LATER.search(t)


_NEXT_REQUEST = re.compile(r"\b(?:(?:next|another|second|fresh|new|different) (?:one|problem|question))\b", re.IGNORECASE)


def asks_for_next_problem(text: str) -> bool:
    """The candidate is asking for the next problem ("ready for the next one", "could I have the second problem")."""
    return bool(_NEXT_REQUEST.search(text or ""))


_STARTS_CODING = re.compile(
    r"\b(?:okay,?\s+|ok,?\s+|alright,?\s+|so,?\s+)?(?:writing|coding|typing)(?:\s+(?:it|this|now|the code|it out|it up))?\s*[.!]?\s*$|"
    r"\blet me (?:write|code|type)\b|\bi(?:'ll| will) (?:write|code|type)\b|\bstart(?:ing)? to (?:write|code|type)\b|"
    r"\bgoing to (?:write|code|type)\b|\b(?:writing|coding|typing) (?:it|this|the code)(?: out| up| now)?\b|"
    # "Sure, writing the two-pointer version now." (p22): only a statement that begins with the writing, never "Coding is hard right now".
    r"^\W*(?:(?:okay|ok|sure|alright|so|yes|yeah)\b\W*)*(?:i(?:'m| am) )?(?:writing|coding|typing)\b(?!\s+(?:is|are|was|were)\b)[^.?!]{0,40}\bnow\W*$",
    re.IGNORECASE)


_NEXT_STEP = re.compile(
    r"\b(?:let me|let'?s|i'?ll|i will|i'?m going to|going to|i can|i could|i want to|i should|i'?ll just)\s+(?:quickly\s+|just\s+|first\s+|also\s+|now\s+)?"
    r"(?:trace|test|run|check|write|add|fix|try|dry[- ]run|code|update|walk through|go through)\b", re.IGNORECASE)


def announces_next_step(text: str) -> bool:
    """The candidate says what they will do next (trace, test, run, check, write, add, fix, try): the right answer is "Sure, go ahead.",
    never a request for more (b1 struggler heard "Could you say a bit more about that?" after "Let me trace it on minus one...")."""
    return bool(_NEXT_STEP.search(text or ""))


def starts_coding(text: str) -> bool:
    """The candidate says they are about to write or type the code ("okay, writing it now"): the right reply is a word, never advice."""
    t = (text or "").strip()
    return bool(t) and "?" not in t and len(t.split()) <= 14 and bool(_STARTS_CODING.search(t))

_NOT_A_PURE_START = re.compile(r"\b(?:help|hint|stuck|don'?t|confus\w*|can i|should i|may i|is it okay|wait|but)\b", re.IGNORECASE)


def says_starting_to_code(text: str) -> bool:
    """Only that they are starting to write the code ("okay, writing it now"): no question, no help request, no caveat, ten words at most.
    The silence of skip_reply rests on this, never on starts_coding alone."""
    t = (text or "").strip()
    return (starts_coding(t) and len(t.split()) <= 10 and not _NOT_A_PURE_START.search(t)
            and not (asks_for_hint(t) or asks_for_help(t) or makes_a_request(t) or asks_yes_no(t)))


# ------------------------------------------------------------ what the candidate said needs no answer

_ACK_ATOM = (r"(?:okay|ok|k|alright|all right|sure|yeah|yes|yep|yup|right|cool|fine|great|nice|good|perfect|hmm+|mm+|mhm|uh[- ]?huh|"
             r"got it|i see|i get it|understood|noted|makes sense|that makes sense|sounds good|sounds fine|will do|thanks|thank you|"
             r"thank you so much|thanks a lot|cheers|no problem|no worries|one sec(?:ond)?|just a (?:sec|second|moment|minute)|"
             r"give me a (?:sec|second|moment|minute)|hold on|let me (?:read|think|see|check|look)(?: (?:it|this|that|through it|about it|first))?)")
_ACK = re.compile(rf"^(?:{_ACK_ATOM}\b[\s,.;:!-]*)+$", re.IGNORECASE)


def is_acknowledgement(text: str) -> bool:
    """The candidate only acknowledged ("okay", "got it", "thanks", "let me read it"): there is nothing in it to answer."""
    t = (text or "").strip()
    return bool(t) and "?" not in t and len(t.split()) <= 8 and bool(_ACK.match(t))


def asks_a_question(text: str) -> bool:
    """The last sentence of what the interviewer said is a question, so a bare "yeah" after it is an answer, not a nod."""
    sentences = [x for x in re.split(r"(?<=[.?!])\s+", (text or "").strip()) if x]
    return bool(sentences and sentences[-1].rstrip("\"')\u201d ").endswith("?"))


# The last sentence promises something still to come ("Let me give you a starting point"): an "okay" after it waits for the thing
# promised. A live round promised a starting point, never gave it, and took "Okay." as a nod: the candidate sat in silence.
_PROMISES = re.compile(r"\b(?:let me|i'?ll|i will)\s+(?:give|show|share|tell|explain|offer|walk)\b[^.?!]*[.!]?\s*$", re.IGNORECASE)


def needs_no_reply(candidate_text: str, interviewer_text: str) -> bool:
    """An acknowledgement of something that was not a question or a promise: a real interviewer says nothing and lets them carry on."""
    return is_acknowledgement(candidate_text) and not asks_a_question(interviewer_text) and not _PROMISES.search(interviewer_text or "")


# ------------------------------------------------------------ requests the interviewer must not grant

_CHANGE_VERB = re.compile(r"\b(?:change|switch|swap|replace|skip)\b[^.?!]{0,25}\b(?:problem|question|one|this)\b|"
                          # "change it" on a problem is the problem ("Can we change it?", a live round missed four), unless it is their
                          # code being changed into something ("change it to a set", "change it so...")
                          r"\b(?:change|switch|swap|replace|skip)\s+it\b(?!\s+(?:to|into|so|with|from|by|for|around|up)\b)", re.IGNORECASE)
# "change it to" with nothing after it is "change it too": speech-to-text writes "too" as "to" (a live round, 2026-10-18). Not when they are the one
# changing something in their code ("let me change it to", "I will change it to").
_CHANGE_TOO = re.compile(r"\b(?:change|switch|swap|replace|skip)\s+(?:it|this(?:\s+one)?)\s+(?:to|too)[\s.,?!\u2026]*$", re.IGNORECASE)
_MY_OWN_CHANGE = re.compile(r"\b(?:let me|let'?s|i(?:'ll|'d| will| would| can| could| should| shall| am going to|'m going to| want to| need to)|then i|so i|maybe i|"
                            r"i'm trying to|trying to)\s+(?:just\s+)?(?:change|switch|swap|replace)\b", re.IGNORECASE)
_OTHER_PROBLEM = re.compile(r"\b(?:another|different|new|other|easier|simpler)\s+(?:coding\s+)?(?:problem|question|one)\b", re.IGNORECASE)
# Saying they are finished and want the next one: only these, and only in the sentence that asks (decided 2026-10-18; run_a seq 22 said "the parcel does carry
# into the next day now ... Could I please get a different problem?" and "next" anywhere hid the ask).
_NOT_A_CHANGE = re.compile(r"\b(?:i|we)(?:'m|'ve|'re| am| are| have)?\s+(?:just\s+)?(?:done|finished|solved|completed)\b|\bnext (?:problem|question)\b|\bready for the next\b|"
                           r"\bdone with (?:this|that|it)\b", re.IGNORECASE)
# Not a request: describing the problem that just went up, or a problem of their own ("I have a different problem: my code fails").
_NOT_A_REQUEST = re.compile(r"\bnew problem\W+(?:so|i need|i'?d|i would|i want|i think|ok|okay|let me)\b|\b(?:this|the|a) new problem\b|"
                            r"\bi have (?:a|another)\b|\bmy (?:own )?(?:different )?problem\b|\bi'?d like to understand\b", re.IGNORECASE)
# An asking form, in a turn of any length: "can I get / could I have / can we try / give me / let's try / skip to / I want ... another problem".
_ASKS_FOR_OTHER = re.compile(
    r"\b(?:can|could|may) (?:i|we|you)\b[^.?!]{0,25}\b(?:get|have|try|do|switch to|see|give me|change to)\b[^.?!]{0,25}\b(?:another|different|new|other|easier|simpler)\s+(?:coding\s+)?(?:problem|question|one)\b|"
    r"\bgive me\b[^.?!]{0,20}\b(?:another|different|new|other|easier|simpler)\s+(?:coding\s+)?(?:problem|question|one)\b|"
    r"\blet'?s try\b[^.?!]{0,20}\b(?:another|different|new|other|easier|simpler)\s+(?:coding\s+)?(?:problem|question|one)\b|"
    r"\bskip to\b[^.?!]{0,20}\b(?:another|different|new|other|easier|simpler)\s+(?:coding\s+)?(?:problem|question|one)\b|"
    r"\bi (?:want|need|would like|asked for)\b[^.?!]{0,20}\b(?:another|different|new|other|easier|simpler)\s+(?:coding\s+)?(?:problem|question|one)\b", re.IGNORECASE)
# "Another question, can the array be empty?" / "Another question: are the numbers sorted?" / "Can I ask a different question about the input?"
# asks something about this problem: not a request for another one.
_CLARIFYING = re.compile(r"\b(?:another|different|other)\s+question\b(?:\s*[,:]\s*\S|[^.?!]{0,20}\babout\b)|"
                         r"\b(?:can|could|may) (?:i|we) ask\b[^.?!]{0,15}\b(?:another|different|other|a)\s+question\b", re.IGNORECASE)
TERSE_WORDS = 10         # a turn this short whose request is "(a) different problem" (with a "please" or a reason) is a request


def asks_to_change_problem(text: str) -> bool:
    """The candidate wants a different problem than the one in front of them ("can you change the problem?", "Another problem?", "I asked
    for another problem"). Saying they are done and want the next one is the ordinary flow of the round, not a change, and neither is
    describing the new problem that just went up ("Okay, new problem. So I need all triplets...")."""
    t = text or ""
    for sentence in re.split(r"(?<=[.?!])\s+", t.strip()):
        if _NOT_A_CHANGE.search(sentence) or _CLARIFYING.search(sentence):
            continue                 # "I'm done, can I get the next one?" asks for nothing else; the sentence that asks is the one that is read
        if _CHANGE_VERB.search(sentence) or _ASKS_FOR_OTHER.search(sentence):
            return True
        if _CHANGE_TOO.search(sentence) and not _MY_OWN_CHANGE.search(sentence):
            return True
    return bool(_OTHER_PROBLEM.search(t) and len(t.split()) <= TERSE_WORDS and not _NOT_A_REQUEST.search(t) and not _NOT_A_CHANGE.search(t)
                and not _CLARIFYING.search(t))


_EDIT_FOR_ME = re.compile(
    r"\b(?:can|could|would|will|may)\s+you\b[^.?!]{0,30}\b(?:add|write|put|type|leave|insert|drop|paste|include|edit)\b[^.?!]{0,50}"
    r"\b(?:comments?|notes?|constraints?|stubs?|boilerplate|signature|template|test cases?|editor)\b|"
    r"(?:^|[.!?]\s+)(?:please\s+)?(?:add|write|put|leave|type)\s+(?:a |an |the |some )?(?:comments?|notes?)\b[^.?!]{0,30}\b(?:in|on|to|into|at)\b[^.?!]{0,20}\b(?:editor|code|file|top)\b",
    re.IGNORECASE)


def asks_interviewer_to_edit(text: str) -> bool:
    """The candidate asks the interviewer to write something into their editor ("can you add a comment in the editor?"). Not part of an
    interview. Asking for the solution itself is a different request (the ask_solution policy)."""
    return bool(_EDIT_FOR_ME.search(text or ""))


# ------------------------------------------------------------ warnings that must be said

_SCREEN_WORD = r"\b(?:tab|tabs|window|screen|stay|leave|left|leaving|switch\w*|away)\b"
# A mention of the tab switch names it (tab, window, switching, leaving, staying), not merely "screen": "what do you make of what's
# on your screen" is about the problem, and a live round counted it as the warning said.
_SCREEN_MENTION = r"\b(?:tab|tabs|window|windows|stay|leave|left|leaving|switch\w*|away|back on)\b"
_WARNING_SAID = {
    "mention_violation": re.compile(_SCREEN_MENTION, re.IGNORECASE),
    "final_warning": re.compile(rf"(?=.*{_SCREEN_WORD})(?=.*\b(?:final|last|once more|one more|again|end the interview)\b)", re.IGNORECASE | re.DOTALL),
    "conduct_warning": re.compile(r"\b(?:appropriate|acceptable|not okay|must not happen|won'?t tolerate)\b", re.IGNORECASE),
}
WARNING_LINES = {
    "mention_violation": "One quick thing: please stay on this screen for the rest of the interview.",
    "final_warning": "This is your final warning: please stay on this screen. If you leave it again, I'll have to end the interview.",
    "conduct_warning": "That isn't appropriate in an interview, and it must not happen again.",
}


def unsaid_warnings(order_kinds: list[str], spoken: str) -> list[str]:
    """The fixed lines for the warning orders this turn's speech did not carry out. A candidate is never ended for something
    they were not told about: the model may skip an order, the warning is still said."""
    return [WARNING_LINES[k] for k in dict.fromkeys(order_kinds) if k in _WARNING_SAID and not _WARNING_SAID[k].search(spoken or "")]


_CONSTRAINTS_ASK = re.compile(
    r"\b(?:constraints?|limits?|upper bounds?|bounds?|range of (?:the )?(?:values?|numbers?|inputs?|elements?)|"
    r"(?:how (?:big|large|many|long)|size of)\b[^.?!]{0,40}\b(?:input|array|list|elements?|numbers?|values?|string))\b", re.IGNORECASE)
_FORMAT_ASK = re.compile(
    r"\b(?:input (?:and|or) output format|input format|output format|function signature|return type|"
    r"what (?:is|are) the (?:input|output)s?\b|what (?:does|do) (?:it|the function) (?:take|return))", re.IGNORECASE)


_HINT_ASK = re.compile(r"\b(?:hints?|clues?|nudge)\b", re.IGNORECASE)
_NO_HINT = re.compile(r"\b(?:no|without|don'?t|do not|not|never|even with)\b[^.?!]{0,20}\b(?:hints?|clues?|nudge)\b", re.IGNORECASE)


def asks_for_hint(text: str) -> bool:
    """The candidate asks for a hint ("can you give me a hint?", "any clue?"); "I'd like to try it without a hint" is not one."""
    t = text or ""
    return bool(_HINT_ASK.search(t) and not _NO_HINT.search(t))


def asks_for_constraints(text: str) -> bool:
    """The candidate asks what the limits of the problem's input are: they are shown on screen, never read out."""
    return bool(_CONSTRAINTS_ASK.search(text or ""))


_PROPERTY = re.compile(r"\b(?:positive|negative|non-?negative|non-?positive|empty|sorted|unsorted|ascending|descending|duplicates?|unique|distinct|"
                       r"integers?|zero|null|repeated|repeats?|whole numbers?)\b", re.IGNORECASE)
_PROPERTY_VERB = re.compile(r"\b(?:is|are|can|could|do|does|will|may|might|would|guaranteed|always)\b", re.IGNORECASE)


def asks_about_a_property(text: str) -> bool:
    """The candidate asks a yes/no question about a property of the input (positive? can it be empty? sorted? duplicates? zero?): answered in
    words, even when the constraints go on the screen. A question for the limits themselves is not."""
    return any(s.rstrip().endswith("?") and _PROPERTY.search(s) and _PROPERTY_VERB.search(s) for s in re.split(r"(?<=[.?!])\s+", (text or "").strip()))


def asks_for_format(text: str) -> bool:
    return bool(_FORMAT_ASK.search(text or ""))


_CLARIFY_INVITE = re.compile(
    r"\banything (?:else )?(?:you(?:'d| would)? (?:like|want) to (?:clarify|ask)|to (?:clarify|ask))\b|"
    r"\bany (?:other |more |further |remaining )?(?:questions?|clarifications?)\b|"
    r"\b(?:questions?|clarifications?) before (?:we|you) (?:begin|start|go on|code|write)\b|\bdo you have (?:any )?questions\b", re.IGNORECASE)


def invites_clarifying(text: str) -> bool:
    """Asks the candidate whether they have questions about the problem. The line that puts a problem up already does, once."""
    t = text or ""
    return bool(_CLARIFY_INVITE.search(t)) and not _GIVE_IT_A_READ.search(t)


# ------------------------------------------------------------ not answering a candidate who is still going

# "One decision I would", "and we": a modal, a pronoun or an article is never where a finished thought stops (a live round answered
# "One decision I would" before the rest came).
# "then" trails off only as a connector ("and then", "so then"): "let's talk about Vibe then." is a finished sentence, and a
# live round said nothing after it.
# An ellipsis or a filler alone is not a sentence breaking off: the speech-to-text writes "..." at any pause, and a live round left a
# candidate in silence after a full introduction ending "So...". A filler is looked past: "in a, um" still breaks off at "a".
_TRAILS_OFF = re.compile(r"(?:\b(?:and|so|but|or),?\s+then|\b(?:the|a|an|and|or|to|of|which|if|because|but|would|could|should|"
                         r"might|must|i|we|my|our|their))[\s.!?,\u2026]*$", re.IGNORECASE)
_FILLERS_AT_END = re.compile(r"(?:[\s.!?,\u2026-]*\b(?:um+|uh+|er+|hmm+|mm+)\b)+[\s.!?,\u2026-]*$", re.IGNORECASE)
_WALKTHROUGH = re.compile(r"\b(?:dry[- ]?run|trace|run (?:it|through)|(?:walk|talk|go) (?:me |us )?(?:through|over) [^.?!]{0,30}\b(?:code|example|sample|array|input)|walk your code)\b", re.IGNORECASE)
_CONCLUDES = re.compile(r"\b(?:final|total|returns?|output|answer|result|solution|gives?|equals?|we get|comes? (?:out )?to|that'?s (?:it|all)|i'?m done|finished|in total|so (?:the|it|that))\b", re.IGNORECASE)
_ASKS_HELP = re.compile(r"\?|\b(?:help|stuck|confused|not sure|don'?t (?:know|understand)|can you|could you|how do|what (?:is|do|does|should)|done|finished|written|completed|ready|that'?s it)\b", re.IGNORECASE)


def trails_off(text: str) -> bool:
    """The candidate's speech breaks off mid-thought ("...and then the"): the rest is coming, a reply now would be talked over."""
    return bool(_TRAILS_OFF.search(_FILLERS_AT_END.sub("", (text or "").strip())))


# ------------------------------------------------------------ a pause the candidate asked for

_ASKS_MOMENT = re.compile(
    r"\b(?:(?:give me|need|want|take|just|get)\s+(?:a|one|two|a couple of|a few|some|a bit of|a little)\s+(?:minutes?|mins?|moments?|secs?|seconds?|time)\b|"
    r"\b(?:a|one) (?:minute|moment|sec|second) to (?:settle|think|get|gather|breathe|read|collect)\b|"
    r"\b(?:hold on|hang on|bear with me|one (?:sec|second|moment|minute)|just a (?:sec|second|moment|minute)|settle in)\b)", re.IGNORECASE)
# One or more of these and nothing else ("Hi. Are you there?", "Hello? Hello?").
_LINE_CHECK = re.compile(r"^(?:\W*(?:hello|hi|hey|hallo|are you (?:still )?there|you there|still there|can you hear me|do you hear me|"
                         r"am i audible|is (?:this|it) working)\W*)+$", re.IGNORECASE)
_GRANTS_PAUSE = re.compile(r"\b(?:take (?:your|a|the|all the) (?:time|minute|moment)|i'?ll wait|no rush|no hurry|whenever you'?re ready|"
                           r"take as long as|in your own time)\b", re.IGNORECASE)


def asks_for_a_moment(text: str) -> bool:
    """The candidate asked for a pause ("I want a minute to settle in", "hold on"): the interviewer acknowledges it and waits."""
    return bool(_ASKS_MOMENT.search(text or ""))


def is_line_check(text: str) -> bool:
    """Only a check that the line is alive ("Hello?", "are you there?"): not the end of a pause they asked for."""
    return bool(_LINE_CHECK.match((text or "").strip()))


def grants_a_pause(interviewer_text: str) -> bool:
    """The interviewer told them to take their time: a reply that asks nothing on purpose, and a pause the plan must respect."""
    return bool(_GRANTS_PAUSE.search(interviewer_text or ""))


def asked_for_walkthrough(interviewer_text: str) -> bool:
    return bool(_WALKTHROUGH.search(interviewer_text or ""))


def narrating_a_walkthrough(candidate_text: str, interviewer_text: str) -> bool:
    """They were asked to talk through an example and this is one more step of it, not its conclusion: a person nods and lets them go on."""
    t = candidate_text or ""
    return (asked_for_walkthrough(interviewer_text) and len(t.split()) >= 5 and "?" not in t and not _CONCLUDES.search(t))


def asks_for_help(text: str) -> bool:
    return bool(_ASKS_HELP.search(text or ""))


_ASK_VERBS = re.compile(r"\b(?:walk me|tell me|talk me|take me|explain|describe|show me|run it|trace)\b", re.IGNORECASE)


def awaiting_answer(interviewer_text: str) -> bool:
    """What the interviewer last said asks the candidate something, as a question or as "walk me through...": their next words answer it."""
    sentences = [x for x in re.split(r"(?<=[.?!])\s+", (interviewer_text or "").strip()) if x]
    return bool(sentences and (asks_a_question(interviewer_text) or _ASK_VERBS.search(sentences[-1])))


# The interviewer defers something the candidate raised ("let's pick that up in a bit"): a promise the plan must keep, or the
# topic is never heard again. "in a bit" counts only beside that/this/it/thread/story, so "back in a bit with the next question" is not one.
# What a promise to come back to something is made of. It needs a topic of the candidate's (that/this/it, or their story, idea, project
# or thread) and a deferral that points past the current part ("later", "in a bit", "after the coding", "in the project discussion").
# "Let's get back to this problem", "let's come back to this question in a moment" and "let's go back to the array" are sequencing
# inside the part: a plan word right after the pronoun makes it a determiner, and "in a moment" or "once you've coded it" defer nothing.
_PLAN = r"(?:problems?|questions?|code|approach|constraints?|edge cases?|examples?|parts?|rounds?|format|coding|screen|complexity|solution|inputs?|outputs?|tests?)"
_PRON = r"(?:that|this|it)"
_NOT_PLAN = rf"(?!\s+(?:of\s+)?(?:the\s+|your\s+|my\s+)?{_PLAN}\b)"
_NP = r"(?:that|this|the|your)\s+(?:[\w-]+\s+){0,2}(?:story|stories|idea|project|projects|thread)"
_DEFER = re.compile(r"\b(?:later(?: on)?|in a bit|after the (?:coding|problem|round|code|part)|when we get to|at the end|towards the end|"
                    r"in the (?:project|projects|deep|deeper|discussion)|properly|in (?:more )?(?:depth|detail))\b", re.IGNORECASE)
_RETURNS = re.compile(
    rf"\b(?:pick {_PRON} (?:up|back up)\b|(?:come|go|get|circle) back to {_NP}\b|"
    rf"(?:keep|hold|save|leave|park)\s+(?:{_NP}|that thread)\b[^.?!]{{0,30}}?\b(?:for later|till later|until later|aside)\b|park {_PRON}{_NOT_PLAN}\b|"
    r"keep (?:that|this|it) in mind,? (?:i'?ll|we'?ll) (?:ask|come back|return|revisit|pick|get back)|"
    rf"worth a (?:proper )?(?:conversation|chat)\b(?!\s+about (?:the |your |these )?{_PLAN}\b)|"
    rf"(?:dig|go|get) into {_PRON}{_NOT_PLAN} (?:later|in a bit|soon)|"
    rf"i(?:'d| would) (?:genuinely |really )?like to (?:come to|dig into) {_PRON}{_NOT_PLAN}\b|we may touch on {_PRON}\b|"
    rf"(?:hear|know|talk) (?:more )?about (?:{_NP}|{_PRON}{_NOT_PLAN})\b[^.?!]{{0,20}}\b(?:a (?:bit|little)|later|soon)\b|"
    rf"(?:that|this(?! plan)|thread|story){_NOT_PLAN}\b[^.?!]{{0,30}}\b(?:later on|in a bit|for later))",
    re.IGNORECASE)
# Going back to a bare pronoun, with a deferral: "let's get back to that after the coding" (not "let's get back to it").
# ("we'll come back to it", "I'd like to get to that" too): these need the deferral marker like every other path.
_BACK_PRON = re.compile(rf"\b(?:(?:come|go|get|circle) back to|get to) {_PRON}{_NOT_PLAN}\b", re.IGNORECASE)
# Going back to a noun phrase of their own words ("we'll come back to the migration later"): a promise only with a deferral, and only
# when they said it recently and it is not the problem's, the part's or a plan word.
_BACK_TO = re.compile(r"\b(?:come|go|get|circle) back to (?:the |your |that |this )?((?:[\w-]+\s+){0,2}[\w-]+)|\b(?:return|dig into|touch on|pick up) (?:the |your )((?:[\w-]+\s+){0,2}[\w-]+)",
                      re.IGNORECASE)
# Sequencing that is about the very next step, whatever the object: "after you've had a go", "now". "after the coding" is not here:
# beside a pronoun it defers their topic ("let's get back to that after the coding"), beside a noun phrase it is sequencing.
_SEQUENCING_NOW = re.compile(r"\b(?:once|when|after|before|until) you\b|\bbefore we\b|\bnow\b", re.IGNORECASE)
# What they said last is about the coding itself: a bare "that's for later" to it defers the plan's own coding part, which comes anyway,
# not a topic of theirs (a rehearsal filed "the time and space cost of this first version" under the projects discussion).
_CODING_TALK = re.compile(r"\bbrute[- ]force\b|\btime and space\b|\bcomplexity\b|\bedge cases?\b|\balgorithm\b|\bdry[- ]run\b|\btwo pointers?\b|\bhash ?map\b|\bfirst version\b", re.IGNORECASE)
_SEQUENCING = re.compile(r"\b(?:once|when|after|before|until) you\b|\b(?:once|after|before|until) the (?:coding|problem|round)\b", re.IGNORECASE)
_PLAN_WORDS = frozenset("problem problems question questions code coding approach constraint constraints example examples round format screen "
                        "complexity solution input inputs output outputs test tests interview minutes time part parts".split())


def promises_to_return(text: str, recent: str = "", exclude: str = "") -> bool:
    """The words defer a topic the candidate raised ("let's keep that thread for later"): the plan should hold a place for it. A
    promise names that topic (that/this/it, or their story, idea, project or thread) and defers it past the current part; sequencing
    inside the part is not one. With `recent` (what they said in their last turns) a noun phrase of their own words counts too, unless
    it is in `exclude` (the problem's statement, the part's probes and opening) or is a plan word."""
    t = text or ""
    coding = bool(_CODING_TALK.search((recent or "")[-250:]))
    for m in _RETURNS.finditer(t):
        if coding and re.match(r"(?:that|this)\b(?!\s+(?:story|thread|idea|project))", m.group(0), re.IGNORECASE):
            continue            # a bare "that's for later" to coding talk defers the plan's own coding part, not a topic of theirs
        return True
    heard = {w for w in re.findall(r"[a-z]{5,}", (recent or "").lower())} - {w for w in re.findall(r"[a-z]{5,}", (exclude or "").lower())}
    for sentence in re.split(r"(?<=[.?!])\s+", t):
        if not _DEFER.search(sentence):
            continue
        if _BACK_PRON.search(sentence) and not _SEQUENCING_NOW.search(sentence) and not _CODING_TALK.search((recent or "")[-250:]):
            return True
        if _SEQUENCING.search(sentence):
            continue
        for m in _BACK_TO.finditer(sentence):
            words = {w for w in re.findall(r"[a-z]{5,}", (m.group(1) or m.group(2) or "").lower())} - _PLAN_WORDS
            if words & heard:
                return True
    return False


_TOPIC = re.compile(r"\b((?:that|this|your|the)\s+(?:[\w-]+\s+){0,3}?[\w-]+)\s+(?:sounds|is|looks|seems|deserves|would be|was)\b", re.IGNORECASE)


def promised_topic(text: str) -> str | None:
    """What the promise is about when its sentence names it ("that side project sounds worth a chat later" gives "that side project"),
    else None ("let's keep that thread for later" names nothing)."""
    for sentence in re.split(r"(?<=[.?!])\s+", (text or "").strip()):
        if promises_to_return(sentence) and (m := _TOPIC.search(sentence)) is not None:
            first, _, rest = m.group(1).partition(" ")
            return f"{first.lower()} {rest}"[:60]
    return None


_PLEASE = re.compile(r"\b(?:please|(?:can|could|would|will) (?:you|we|i)|(?:tell|show|give|repeat|clarify|explain) me|i(?:'d| would) like|i need)\b", re.IGNORECASE)


def makes_a_request(text: str) -> bool:
    """The candidate asked for something (the constraints, a hint, a repeat, a moment, a change): a short line legitimately answers it."""
    t = text or ""
    return bool(_PLEASE.search(t) or asks_for_help(t) and "?" in t or asks_for_constraints(t) or asks_for_format(t) or asks_for_hint(t)
                or asks_to_change_problem(t) or asks_for_a_moment(t) or asks_for_next_problem(t) or asks_interviewer_to_edit(t))


# The interviewer returns to something it already asked or was saying ("I still need the actual idea first", "let me pull you back").
# "But first" alone is not one: a first ask uses it too.
_PULLBACK = re.compile(
    r"\bi(?:'d| would)? still (?:want|need|like)\b|\bstill (?:like|want|need) (?:to|your|that|a|the|an)\b|"
    r"\bcoming back to\b|\bpull(?:ing)? you back\b|\bonce more\b|\bone more time\b|\bask (?:it|this|that) (?:again |once more )?(?:plainly|differently|simply)\b|"
    r"\b(?:put|ask) (?:my|the) question (?:differently|plainly|simply)\b|\blet me be (?:plain|direct)\b|\blet me get (?:your|that) \w+ straight\b|\bas i was saying\b|\bwhat i asked\b|"
    r"\bhaven'?t answered my question\b|\bmy question (?:stands|is still open)\b|\bi'?ll ask (?:once more|again)\b", re.IGNORECASE)


def pulls_back(text: str) -> bool:
    """The interviewer explicitly returns to a question it already asked, or to what it was saying."""
    return bool(_PULLBACK.search(text or ""))


# Asking whether the round's format is okay: nobody needs to approve it, and a candidate who answers with a side topic is asked again and again.
_FORMAT_CONFIRM = re.compile(
    r"\bdoes (?:that|this|the (?:format|way|structure|plan|outline)[^.?!]{0,40}|it) (?:sound|work|seem|look)s?\b[^.?!]{0,20}\b(?:good|okay|ok|fine|alright|all right|right|for you|to you)\b|"
    r"\b(?:sounds?|work(?:s|ing)?) (?:good|okay|ok|fine|alright|all right) (?:to|for) you\b|\bsounds? (?:good|okay|ok|fine|alright)\b[^.?!]{0,15}\?|"
    r"\bshall we (?:go ahead|go with|proceed|begin|start)\b|\bconfirm (?:the|that) format\b|\bconfirm for me\b|\bneed a yes\b|\byour go-?ahead on the format\b|"
    r"\bjust confirm (?:the|that|for me)\b|\bquick yes or no\b", re.IGNORECASE)


def asks_format_confirmation(text: str) -> bool:
    """The text asks whether the round format is okay with the candidate ("does that sound good?", "shall we go ahead?")."""
    return bool(_FORMAT_CONFIRM.search(text or ""))


_START_CHECK = re.compile(r"\bshall we get (?:started|going)\b", re.IGNORECASE)


def asks_format_check(text: str) -> bool:
    """The check that ends the outline ("Does that sound okay?", "Shall we get started?"): the format confirmation, and the start check."""
    return asks_format_confirmation(text) or bool(_START_CHECK.search(text or ""))


# A tool call written out as speech: the model's log_turn arguments read aloud.
TOOL_LEAK = re.compile(r"\blog[ _]?turn(?:\b|arg ?key|condition)|\barg ?key\b|\bcondition=|\bset[ _]aside(?: why)?=|\baction=|\bwhy=", re.IGNORECASE)


def leaks_tool_call(text: str) -> bool:
    return bool(TOOL_LEAK.search(text or ""))


_PLANNED_LATER = re.compile(r"\bi(?:'d| had| would have)? (?:actually )?planned to ask (?:you )?that (?:later|after)\b|\bwas going to ask (?:you )?that later\b", re.IGNORECASE)


def says_planned_later(text: str) -> bool:
    """"I'd actually planned to ask you that later": the interviewer's plan said aloud, as an excuse for not answering."""
    return bool(_PLANNED_LATER.search(text or ""))


_YES_NO = re.compile(r"^\W*(?:is|are|am|do|does|did|can|could|should|would|will|shall|have|has|was|were|may|might)\b", re.IGNORECASE)


def asks_yes_no(text: str) -> bool:
    """The candidate's last sentence is a yes/no question ("is it okay if I use Python?"): "Sure." is a complete answer to it."""
    sentences = [x for x in re.split(r"(?<=[.?!])\s+", (text or "").strip()) if x]
    return bool(sentences and sentences[-1].rstrip().endswith("?") and _YES_NO.match(sentences[-1]))


# The candidate asks the interviewer to judge ("is that right?", "does that work?", "correct?"): a verdict is the answer, so the verdict budget
# (talker.py) does not apply to the reply.
_ASKS_IF_RIGHT = re.compile(r"\b(?:is (?:that|this|it) (?:right|correct|okay|ok|fine|good)|(?:am i|i'?m) (?:right|correct|on the right track)|"
                            r"does (?:that|this|it) (?:work|make sense|sound (?:right|good))|did i (?:get it|do it) right|correct|right)\s*\?\s*$|"
                            r"\b(?:is (?:that|this|it) (?:right|correct)|does (?:that|this|it) (?:work|make sense))\b[^.?!]*\?", re.IGNORECASE)


def asks_if_right(text: str) -> bool:
    """The candidate's turn asks whether what they said or wrote is right."""
    return bool(_ASKS_IF_RIGHT.search((text or "").strip()))


# They state an assumption instead of asking ("I assume the input is valid"): the interviewer's "yes, it is" is the answer, not praise.
_ASSUMES = re.compile(r"\b(?:i(?:'ll| will|'m| am)? assum(?:e|ing)|assuming|can i assume|let'?s assume|we can assume)\b", re.IGNORECASE)
# The interviewer asked them to run or trace an input: what they say next reports the result, and confirming it is the one verdict a round allows.
_ASKS_TO_TRACE = re.compile(r"\b(?:trace|dry[- ]?run|run (?:it|this|that|the (?:code|input))|run [^.?!]{0,30}\b(?:through|on)\b|walk me through (?:that|the|this) "
                            r"(?:input|example|case)|try (?:the|this|that|it)\b[^.?!]{0,20}\binput|test (?:it|this|that) (?:on|with))\b", re.IGNORECASE)


def states_assumption(text: str) -> bool:
    return bool(_ASSUMES.search(text or ""))


def asks_to_trace(text: str) -> bool:
    """The interviewer's line asks them to trace or run an input."""
    return bool(_ASKS_TO_TRACE.search(text or ""))


# ------------------------------------------------------------ the points a refusal makes

# What a refusal to change the problem says, as families (decided 2026-10-18): a second refusal that makes the same point sounds like a recording,
# so the run remembers the families already said and the talker guard drops a sentence that says one again.
_REFUSAL_POINTS: dict[str, re.Pattern[str]] = {
    "partial_fine": re.compile(
        r"\b(?:partial|incomplete|half[- ]?(?:done|finished)|rough|brute[- ]force)\s+(?:solution|answer|attempt|version)s?\b[^.?!]{0,30}\b(?:fine|okay|ok|good|enough|welcome|perfectly)\b|"
        r"\b(?:fine|okay|ok|good|enough)\b[^.?!]{0,25}\b(?:partial|incomplete|rough|half[- ]?(?:done|finished))\b|"
        r"\b(?:doesn'?t|does not|needn'?t|need not|don'?t have to|do not have to) (?:have to |need to )?(?:be|get) (?:complete|perfect|finished|optimal|fully)\b|"
        r"\bnot (?:looking|expecting) for (?:a )?(?:perfect|complete|full|finished)\b", re.IGNORECASE),
    "see_how_far": re.compile(r"\bsee how far (?:you|we) (?:get|can (?:get|go|take it)|go)\b|\bhow far you (?:get|can (?:get|go|take (?:it|this)))\b", re.IGNORECASE),
    "give_it_a_try": re.compile(r"\b(?:give|have|take) (?:it|this|that) (?:a|one more|another) (?:good |proper |real |fair |decent )?(?:try|shot|go|attempt|crack|stab)\b|"
                                r"\btry (?:it|this|that) (?:out )?(?:a bit|once more|again|for a bit)\b", re.IGNORECASE),
    "start_small": re.compile(r"\bstart (?:small|simple|with (?:something )?(?:small|simple|basic|the simplest|what you know|the basics|a brute)|from (?:the basics|what you know))\b|"
                              r"\b(?:a |the )?(?:simple|basic|first|brute[- ]force) (?:version|approach|attempt) (?:first|is (?:fine|okay|good))\b|"
                              r"\bbuild (?:it )?up from (?:there|something simple)\b", re.IGNORECASE),
}


def refusal_points(text: str) -> set[str]:
    """The points a refusal to change the problem makes in these words, as family names: `partial_fine`, `see_how_far`, `give_it_a_try`,
    `start_small`. Holding firm ("stay with this one") is the refusal itself, not a point, so it is never counted. The talker guard blocks a sentence whose point was already made in an earlier refusal of the round."""
    return {name for name, pattern in _REFUSAL_POINTS.items() if pattern.search(text or "")}
