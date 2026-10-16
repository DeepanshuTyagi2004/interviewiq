"""Spotting a goodbye in what the interviewer just said. The talker is meant to move to the wrap-up and close, but a
model that says "take care" while still in the candidate's questions must not leave a live room open and talking."""
from __future__ import annotations

import re

_FAREWELL = re.compile(
    r"\b(take care|have a (?:great|good|nice|wonderful|lovely) (?:day|one|evening|week|weekend)|all the best|best of luck|"
    r"good ?bye|that'?s all from my side|that is all from my side|debrief will follow|we'?ll be in touch|"
    r"we will be in touch|speak soon|thanks? (?:you )?for your time|thank you for your time|let'?s close out|i'?ll wrap up here|we'?ll close here|"
    r"i'?ll end it here)\b", re.IGNORECASE)


def is_farewell(text: str) -> bool:
    return bool(_FAREWELL.search(text or ""))


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


def matches_probe(text: str, probes: list[str]) -> bool:
    """The text asks one of the blueprint's resume probes (three or more of its distinctive words in common)."""
    spoken = _words(text)
    return any(len(spoken & _words(p)) >= 3 for p in probes if p)


_ASKS = re.compile(r"\?|\b(?:tell me|walk me through|talk me through|take me through|describe|give me|explain|share|show me)\b", re.IGNORECASE)


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
_OUTLINE_MARKERS = re.compile(r"\bthen\b|\bafter that\b|\bfinally\b|\bat the end\b|\bafterwards\b|\bfirst\b|\bstart with\b|\bbegin with\b", re.IGNORECASE)
_ROUND_WORDS = re.compile(r"\bround\b|\bminutes?\b|\bhow (?:this|the|it) (?:will )?(?:go|run|work)\b|\bhow the next part\b", re.IGNORECASE)
_PROBLEMS_WORDS = re.compile(r"\bcoding\b|\bproblems?\b|\bproblem solving\b|\bquestions\b", re.IGNORECASE)


def gives_outline(text: str) -> bool:
    """The text tells the candidate how the round will run (its parts, in order, and the time for their questions)."""
    t = text or ""
    return len(t.split()) >= 18 and bool(_ROUND_WORDS.search(t)) and bool(_PROBLEMS_WORDS.search(t)) and len(_OUTLINE_MARKERS.findall(t)) >= 2


_CODING_NOW = re.compile(
    r"\blet'?s\b[^.?!]{0,30}\b(?:technical|coding|problem[- ]solving|dsa)\b|"
    r"\b(?:move|moving|switch|switching|turn|turning|jump|jumping|dive|diving|get|getting|go|going)\b[^.?!]{0,20}\b(?:to|into|onto)\b[^.?!]{0,16}\b(?:technical|coding|problem[- ]solving)\b|"
    r"\btime (?:for|to)\b[^.?!]{0,16}\b(?:technical|coding|problem[- ]solving)\b", re.IGNORECASE)


_DESCRIBES_ROUND = re.compile(r"\bwe(?:'ll| will)\b[^.?!]*\b(?:then|after that|followed by)\b", re.IGNORECASE)


def announces_coding_now(text: str) -> bool:
    """The text says the technical or coding part starts now ("let's get started with the technical part"), unlike a sentence that
    describes the round ("we'll start with some background, then the coding part, and finish with your questions")."""
    t = text or ""
    if _DESCRIBES_ROUND.search(t):
        return False          # "We'll start with a chat about you, then get into a coding problem" describes the round, it starts nothing
    return bool(_CODING_NOW.search(t)) and len(_OUTLINE_MARKERS.findall(t)) < 2


_AT_ONCE = re.compile(r"\bscreen\b|\bnow\b|\bpull(?:ing)?\b|\bappear|\bget (?:you )?(?:to|onto)\b|\bonto\b", re.IGNORECASE)


_GIVE_IT_A_READ = re.compile(r"\bgive it a (?:read|look)\b", re.IGNORECASE)
_PROBLEM_LINE = re.compile(r"\bgive it a (?:read|look)\b|\bhere(?:'s| is) your (?:first|second|third|next) (?:question|problem)\b", re.IGNORECASE)


def says_the_problem_line(text: str) -> bool:
    """The text is (or contains) the one short line that puts a problem up ("Here's your first question. Give it a read, ...")."""
    return bool(_PROBLEM_LINE.search(text or ""))


_NO_PROBLEM_YET = re.compile(r"\b(?:no|not|isn'?t|nothing|haven'?t|hasn'?t|without)\b[^.?!]{0,40}\b(?:on|up on|onto) your screen\b|"
                             r"\bno (?:coding )?(?:problem|question)\b[^.?!]{0,20}\b(?:yet|up)\b|\bnot (?:up )?yet\b", re.IGNORECASE)


def announces_problem(text: str) -> bool:
    """The sentence announces or promises the coding problem now ("let's get you onto the problem", "it's on your screen", "here's your
    first question, give it a read") as opposed to describing how the round will run ("one coding problem, then your questions at the end")."""
    t = text or ""
    if _NO_PROBLEM_YET.search(t):
        return False          # "There's no problem on your screen yet" says the opposite: it must never put one up
    if _GIVE_IT_A_READ.search(t):
        return True
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


def leaves_the_part(text: str) -> bool:
    """What was said closes the current part of the interview ("let's move on", "I have another problem", "well done on this one")."""
    return bool(_LEAVES.search(text or ""))


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


def invites_questions_now(text: str) -> bool:
    """The text hands the floor to the candidate's own questions now ("any questions for me?", "let me move us on to your questions"),
    as opposed to saying that time for them comes at the end of the round."""
    t = text or ""
    if _GIVE_IT_A_READ.search(t):
        return False          # "Give it a read, and let me know if you have any questions" is about the problem they were just given
    return bool(_QUESTIONS_NOW.search(t)) and not _LATER.search(t)


_NEXT_REQUEST = re.compile(r"\b(?:(?:next|another|second|fresh|new|different) (?:one|problem|question))\b", re.IGNORECASE)


def asks_for_next_problem(text: str) -> bool:
    """The candidate is asking for the next problem ("ready for the next one", "could I have the second problem")."""
    return bool(_NEXT_REQUEST.search(text or ""))


_STARTS_CODING = re.compile(
    r"\b(?:okay,?\s+|ok,?\s+|alright,?\s+|so,?\s+)?(?:writing|coding|typing)(?:\s+(?:it|this|now|the code|it out|it up))?\s*[.!]?\s*$|"
    r"\blet me (?:write|code|type)\b|\bi(?:'ll| will) (?:write|code|type)\b|\bstart(?:ing)? to (?:write|code|type)\b|"
    r"\bgoing to (?:write|code|type)\b|\b(?:writing|coding|typing) (?:it|this|the code)(?: out| up| now)?\b", re.IGNORECASE)


def starts_coding(text: str) -> bool:
    """The candidate says they are about to write or type the code ("okay, writing it now"): the right reply is a word, never advice."""
    t = (text or "").strip()
    return bool(t) and "?" not in t and len(t.split()) <= 14 and bool(_STARTS_CODING.search(t))


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


def needs_no_reply(candidate_text: str, interviewer_text: str) -> bool:
    """An acknowledgement of something that was not a question: a real interviewer says nothing and lets them carry on."""
    return is_acknowledgement(candidate_text) and not asks_a_question(interviewer_text)


# ------------------------------------------------------------ requests the interviewer must not grant

_CHANGE_VERB = re.compile(r"\b(?:change|switch|swap|replace|skip)\b[^.?!]{0,25}\b(?:problem|question|one|this)\b", re.IGNORECASE)
_OTHER_PROBLEM = re.compile(r"\b(?:another|different|new|other|easier|simpler)\s+(?:coding\s+)?(?:problem|question|one)\b", re.IGNORECASE)
_NOT_A_CHANGE = re.compile(r"\b(?:done|finished|solved|completed|ready|next)\b", re.IGNORECASE)


def asks_to_change_problem(text: str) -> bool:
    """The candidate wants a different problem than the one in front of them ("can you change the problem?", "I asked for another
    problem"). Saying they are done and want the next one is the ordinary flow of the round, not a change."""
    t = text or ""
    return bool((_CHANGE_VERB.search(t) or _OTHER_PROBLEM.search(t)) and not _NOT_A_CHANGE.search(t))


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
    "final_warning": "This is your final warning: please stay on this screen. If you leave it once more, I will have to end the interview.",
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
_NO_HINT = re.compile(r"\b(?:no|without|don'?t|do not|not|never)\b[^.?!]{0,20}\b(?:hints?|clues?|nudge)\b", re.IGNORECASE)


def asks_for_hint(text: str) -> bool:
    """The candidate asks for a hint ("can you give me a hint?", "any clue?"); "I'd like to try it without a hint" is not one."""
    t = text or ""
    return bool(_HINT_ASK.search(t) and not _NO_HINT.search(t))


def asks_for_constraints(text: str) -> bool:
    """The candidate asks what the limits of the problem's input are: they are shown on screen, never read out."""
    return bool(_CONSTRAINTS_ASK.search(text or ""))


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

# "One decision I would", "and we", "uh": a modal, a pronoun or a filler is never where a finished thought stops (a live round answered
# "One decision I would" before the rest came).
_TRAILS_OFF = re.compile(r"(?:\.\.\.|\u2026|\b(?:the|a|an|and|or|to|of|then|which|if|because|but|would|could|should|might|must|i|we|my|our|"
                         r"their|um+|uh+|er+|hmm+)\s*[.!?,]*)\s*$", re.IGNORECASE)
_WALKTHROUGH = re.compile(r"\b(?:dry[- ]?run|trace|run (?:it|through)|(?:walk|talk|go) (?:me |us )?(?:through|over) [^.?!]{0,30}\b(?:code|example|sample|array|input)|walk your code)\b", re.IGNORECASE)
_CONCLUDES = re.compile(r"\b(?:final|total|returns?|output|answer|result|solution|gives?|equals?|we get|comes? (?:out )?to|that'?s (?:it|all)|i'?m done|finished|in total|so (?:the|it|that))\b", re.IGNORECASE)
_ASKS_HELP = re.compile(r"\?|\b(?:help|stuck|confused|not sure|don'?t (?:know|understand)|can you|could you|how do|what (?:is|do|does|should)|done|finished|written|completed|ready|that'?s it)\b", re.IGNORECASE)


def trails_off(text: str) -> bool:
    """The candidate's speech breaks off mid-thought ("...and then the"): the rest is coming, a reply now would be talked over."""
    return bool(_TRAILS_OFF.search((text or "").strip()))


# ------------------------------------------------------------ a pause the candidate asked for

_ASKS_MOMENT = re.compile(
    r"\b(?:(?:give me|need|want|take|just|get)\s+(?:a|one|two|a couple of|a few|some|a bit of|a little)\s+(?:minutes?|mins?|moments?|secs?|seconds?|time)\b|"
    r"\b(?:a|one) (?:minute|moment|sec|second) to (?:settle|think|get|gather|breathe|read|collect)\b|"
    r"\b(?:hold on|hang on|bear with me|one (?:sec|second|moment|minute)|just a (?:sec|second|moment|minute)|settle in)\b)", re.IGNORECASE)
_LINE_CHECK = re.compile(r"^\W*(?:hello|hi|hey|hallo|are you (?:still )?there|you there|still there|can you hear me|do you hear me|"
                         r"am i audible|is (?:this|it) working)\W*$", re.IGNORECASE)
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
