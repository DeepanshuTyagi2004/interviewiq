"""Small text predicates shared by the conductor, the talker and the trace check, so none of them reaches into another's private names."""
from __future__ import annotations

import re

from app.interviewer.guard import _stems

STARTER_PHRASE = "write your solution here"     # the web editor's starter is this one comment line, in the language's comment syntax


def written_code(text: str, base: str = "") -> bool:
    """The editor text adds at least one non-blank line that the text the problem went up with did not have. Comment lines count (a
    candidate sketching pseudocode in comments has started); the starter comment never does."""
    known = {line.strip() for line in base.split("\n")}
    return any(line.strip() and line.strip() not in known and STARTER_PHRASE not in line.lower() for line in text.split("\n"))


# The web board's summary (apps/web .../workspace/board.ts): one line per element, `text "..."` for typed text (it can span lines), the shape's
# name for a drawing ("rectangle", "freedraw"), "arrow A \u2192 B" for connectors.
_BOARD_TEXT = re.compile(r'^text "(.*?)"$', re.MULTILINE | re.DOTALL)


def board_typed_text(summary: str) -> list[str]:
    """The text elements typed on the whiteboard, each on one line."""
    return [re.sub(r"\s+", " ", t).strip() for t in _BOARD_TEXT.findall(summary or "") if t.strip()]


def board_shapes(summary: str) -> list[str]:
    """The drawn elements of the board summary, repeats counted ("freedraw \u00d77"), the typed text left out."""
    counts: dict[str, int] = {}
    for line in _BOARD_TEXT.sub("", summary or "").split("\n"):
        if line.strip():
            counts[line.strip()] = counts.get(line.strip(), 0) + 1
    return [name if n == 1 else f"{name} \u00d7{n}" for name, n in counts.items()]


# A claim that the board's words or letters cannot be read ("the words aren't coming through clearly", "I can't quite make out the words",
# "not clear enough for me to read"): true of handwriting at most, never of text they typed, which is in the live state.
UNREADABLE_BOARD = re.compile(
    r"\b(?:can'?t|cannot|couldn'?t|unable to|not able to)\s+(?:quite |really |clearly )?(?:make out|read|see|tell)\b[^.?!]{0,40}\b(?:words?|letters?|text|writing)\b|"
    r"\b(?:words?|letters?|text|writing)\b[^.?!]{0,50}(?:\bnot|\w+n['\u2019]t)\s+(?:\w+\s+){0,3}(?:clear|clearly|legible|readable|coming through|visible)\b|"
    r"\bnot (?:clear|legible|readable) enough\b[^.?!]{0,30}\b(?:read|make out)\b", re.IGNORECASE)


# Swearing or a strong insult aimed at the interviewer ("fuck you", "you are an idiot", "shut up"). A rude remark about the question ("this
# question is stupid") or a swear word that is not aimed at them ("what the fuck is a monotonic stack") is milder: it gets a warning first.
_ABUSE_WORD = r"(?:idiots?|morons?|bastards?|assholes?|arseholes?|bitch(?:es)?|dumbass|stupid|dumb|retard(?:ed)?|scum|piece of (?:shit|crap))"
DIRECTED_ABUSE = re.compile(
    r"\b(?:fuck|f\*+k|screw|damn)\s+(?:you|off|u)\b|\bgo (?:to hell|fuck yourself|screw yourself)\b|\bshut (?:the fuck )?up\b|"
    rf"\b(?:you|u)(?:'re| are|r)\s+(?:a |an |such a |such an |the )?(?:(?:fucking|freaking|f\*+king|total|complete|absolute) )?(?:{_ABUSE_WORD}|useless)\b", re.IGNORECASE)

# "shut up" about themselves ("I should shut up and code", "let me shut up and think") is not said to the interviewer.
_SELF_SHUT_UP = re.compile(r"(?:\b(?:i|we|me)(?:'ll|'d|'m)?\s+(?:(?:should|shall|will|need to|must|better|gonna|ought to|have to|want to|going to|am going to|can|could|might|probably|just|really)\s+)*"
                           r"|\blet me\s+(?:just\s+)?)$", re.IGNORECASE)
_SHUT_UP = re.compile(r"\bshut (?:the fuck )?up\b", re.IGNORECASE)


def directed_abuse(text: str) -> bool:
    text = text or ""
    for m in DIRECTED_ABUSE.finditer(text):
        if _SHUT_UP.fullmatch(m.group(0)) and _SELF_SHUT_UP.search(text[:m.start()]):
            continue
        return True
    return False


# The broad screen in front of the model check (high recall: a turn it lets through is never judged, one it catches only costs a call):
# swearing in English and Hindi/Hinglish, insult words, "shut up", "you" near a contemptuous word, and telling the interviewer to leave.
_PROFANITY = (r"(?:fuck\w*|f\*+k\w*|fck\w*|shit\w*|bullshit|bitch\w*|bastard\w*|asshole\w*|arsehole\w*|dick\w*|prick|damn\w*|crap\w*|piss\w*|"
              r"ch[uo]+t[iy]+a\w*|bh?[eo]+n\s?ch[o0]+d\w*|b[ae]hen\s?ch[o0]+d\w*|madar\s?ch[o0]+d\w*|m\.?c\b|b\.?c\b|gand[uo]\w*|gaand\w*|"
                r"s+aa?la+\b|s+aa?le+\b|harami\w*|haramzad\w*|kutt[aeoi]\w*|kamin[ae]\w*|bakwa+s\w*|bekaar|ullu\w*|lund\w*|loda\b|randi\w*|saal[ae]\b|"
                r"tatti|jhaat\w*|bewakoof\w*|pagal|nikal\b|chup\s+kar\w*)")
_INSULT = r"(?:idiot\w*|stupid\w*|dumb\w*|moron\w*|useless|pathetic|worthless|loser\w*|clown\w*|joke|nonsense|rubbish|garbage|trash\w*|crap|sucks?|retard\w*|scum|incompetent|pointless|meaningless|lame|bs)"
_CONTEMPT = (rf"(?:{_INSULT}|bots?|robots?|fake|clueless|(?:do(?:es)?n['\u2019]?t|do not|did not|didn['\u2019]?t) (?:even )?know|know (?:nothing|jack)|no idea|"
             r"not (?:even )?(?:qualified|smart|good|real|human)|waste of|wasting my|annoying|rude|ridiculous|disgusting|horrible|terrible|awful|shameless|biased|unfair|cheat\w*|liar\w*|lying)")
MAYBE_CONDUCT = re.compile(
    rf"\b{_PROFANITY}|\b{_INSULT}\b|\bshut\s+(?:the \w+ )?up\b|\bhate (?:you|this|u)\b|\bget lost\b|\bgo away\b|\bleave me alone\b|\bpiss(?:ed)? off\b|"
    r"\bstop (?:talking|speaking|interrupting)\b|\b(?:be|keep) quiet\b|\bdon['\u2019]?t (?:talk|speak|interrupt)\b|\bchup\b|"
    rf"\b(?:you|your|you['\u2019]?re|youre|u|ur|you are)\b[^.?!]{{0,60}}\b{_CONTEMPT}\b", re.IGNORECASE)


# The model may only END a round on a remark aimed at the interviewer: one that addresses them ("you", "your", Hindi "tu/tum/aap/tera/tumhara") or
# orders them about ("shut up", "stop talking", "go away", "get lost"). A model "abuse" verdict without that is treated as rude, so a
# misjudged remark about the question ("kya bakwas question hai yaar") or a clarification ("that's a joke, right?") never ends a round.
AIMED_AT_THEM = re.compile(
    r"\b(?:you|your|yours|you['\u2019]?re|youre|u|ur|ya|tu|tum|tumhar\w*|tera|teri|tere|aap\w*|apk[ao]?)\b|"
    r"\bshut\s+(?:the \w+ )?up\b|\bstop (?:talking|speaking|interrupting)\b|\b(?:be|keep) quiet\b|\bchup\b|\bgo away\b|\bget lost\b|"
    r"\bleave me alone\b|\bpiss off\b|\bscrew off\b|\bfuck off\b", re.IGNORECASE)


def aimed_at_them(text: str) -> bool:
    return bool(AIMED_AT_THEM.search(text or ""))


def maybe_conduct(text: str) -> bool:
    """True when a candidate turn might hold abuse or rudeness: the model decides what it is."""
    return bool(MAYBE_CONDUCT.search(text or ""))


def plain(text: str) -> str:
    """Lowercase letters and digits only: two sentences with the same `plain` are the same sentence, whatever their length."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def restates(a: str, b: str) -> bool:
    """Two sentences built from the same long words: at least three six-letter stems in the shorter one and 60% of them shared."""
    wa, wb = _stems(a), _stems(b)
    return min(len(wa), len(wb)) >= 3 and len(wa & wb) / min(len(wa), len(wb)) >= 0.6


# ---- echo: a sentence that only gives the candidate's answer back to them

_ECHO_WORD = re.compile(r"[a-z]{5,}")
_ECHO_STOP = frozenset("""about above after again also another because before being between could does doing each else ever from have here into just
    like make many more most much only other over same should some such than that their them then there these they this those through
    under very want what when where which while will with would your yours actually really still tell mean think sounds point thing things
    something everything anything going those being""".split())
# Something new in the sentence (a correction, a contrast, a negation) means it is not just an echo.
_NEW_FACT = re.compile(r"\b(?:but|however|except|actually|wait|careful|not quite|though|although|no|not|never|nothing|neither|nor|without|instead)\b|n'?t\b",
                       re.IGNORECASE)
_NUMBER = re.compile(r"\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|thousand|million|twice|double|half)\b")
_REQUEST = re.compile(r"^\W*(?:tell|walk|show|try|give|let'?s|let me|go ahead|can you|could you|what|how|why|when|which|where|who|do you|did you)\b|\?\s*$",
                      re.IGNORECASE)


def echo_stems(text: str) -> set[str]:
    """Content words of five letters or more, cut to five ("pointers" and "pointer" are one), minus function words."""
    return {w[:5] for w in _ECHO_WORD.findall((text or "").lower().replace("'", "")) if w not in _ECHO_STOP}


def echoes(sentence: str, candidate_said: str) -> bool:
    """The sentence is a statement built from three or more of the candidate's own content words, with nothing new in it (no correction,
    contrast, negation or number they did not say). Never when what they said was a question: the sentence is its answer."""
    text, theirs = (sentence or "").strip(), (candidate_said or "").strip()
    if not text or not theirs or "?" in theirs or _REQUEST.search(text) or _NEW_FACT.search(text):
        return False
    if set(_NUMBER.findall(text.lower())) - set(_NUMBER.findall(theirs.lower())):
        return False
    return len(echo_stems(text) & echo_stems(theirs)) >= 3
