"""What the interviewer has already said in this interview. A sentence that says the same thing again is held back
(talker.py's `repeat` rule); the same thing put differently is fine. Kept for the whole round, not a window of it."""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Iterable

from app.interviewer.guard import NEUTRAL_LINE

MIN_WORDS = 4      # shorter sentences ("Right.", "Got it.", "Okay, go on.") are ordinary speech: saying them twice is natural
SIMILAR = 0.9      # word-level similarity from which a sentence is the same thing said again ("...your approach?" / "...your approach here?")
_WORD = re.compile(r"[a-z0-9]+")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
# What fills an empty turn when everything the talker said was held back: always a question, rotated so it never repeats back to back.
NEUTRAL_LINES = (NEUTRAL_LINE, "What's your thinking there?", "Where would you take it from here?", "How would you approach that?")
# The line that puts a problem up is the same every time on purpose ("Here's your second question. Give it a read, ..."): never a repeat.
REPEATABLE = re.compile(r"\bgive it a read\b|^here(?:['\u2019]s| is) your (?:first|second|third|fourth) question\b", re.IGNORECASE)


_STOP = frozenset("""about above after again also another because before being between could does doing each else ever from have here into just
    like make many more most much only other over same should some such than that their them then there these they this those through
    under very want what when where which while will with would your yours actually really still tell mean""".split())
LOOP_SHARED = 2          # content words two questions share for the later one to be the earlier one asked again
LOOP_AT = 2              # earlier questions a new one must repeat (so it would be the third ask) before it is held back


def _topic_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{5,}", text.lower()) if w not in _STOP}


def words_of(text: str) -> list[str]:
    return _WORD.findall(text.lower().replace("'", "").replace("’", ""))


@dataclass
class Said:
    turn_id: str
    text: str
    words: list[str]


class SaidTracker:
    def __init__(self) -> None:
        self._said: list[Said] = []
        self._neutral = 0

    def repeat_of(self, text: str) -> str | None:
        """The earlier sentence this one says again, or None."""
        words = words_of(text)
        if len(words) < MIN_WORDS or REPEATABLE.search(text):
            return None
        matcher = SequenceMatcher(None, autojunk=False)
        matcher.set_seq2(words)                      # the new sentence is the cached side: each earlier one is compared against it
        for earlier in self._said:
            if earlier.words == words:
                return earlier.text
            matcher.set_seq1(earlier.words)
            if matcher.real_quick_ratio() >= SIMILAR and matcher.quick_ratio() >= SIMILAR and matcher.ratio() >= SIMILAR:
                return earlier.text
        return None

    def has(self, pattern: "re.Pattern[str]") -> bool:
        """Whether anything already said in this interview matches (a line that is said once in a round: "take your time")."""
        return any(pattern.search(s.text) for s in self._said)

    def question_loop(self, text: str, last: int = 6) -> list[str]:
        """The earlier questions (of the last few) this question asks again in other words: a third ask of the same thing is a loop."""
        if not text.rstrip().endswith("?") or len(words_of(text)) < 5:
            return []
        mine = _topic_words(text)
        asked = [s.text for s in self._said if s.text.rstrip().endswith("?")][-last:]
        return [q for q in asked if len(mine & _topic_words(q)) >= LOOP_SHARED]

    def add(self, text: str, turn_id: str) -> None:
        words = words_of(text)
        if len(words) >= MIN_WORDS and not REPEATABLE.search(text):
            self._said.append(Said(turn_id, text, words))

    def forget(self, turn_id: str) -> None:
        """An interrupted turn: the candidate may not have heard it to the end, so it may be said again."""
        self._said = [s for s in self._said if s.turn_id != turn_id]

    def keep_only(self, turn_id: str, heard: str) -> None:
        """The voice was cut off: of this turn only what was played counts as said (the rest may be said again). A live round
        held back "does that sound good to you?" as a repeat when the candidate had only heard "It's a forty-five minute"."""
        self.forget(turn_id)
        for sentence in _SENTENCE_END.split(heard or ""):
            self.add(sentence, turn_id)

    def seed(self, texts: Iterable[str]) -> None:
        """A resumed interview: what the stored conversation already said."""
        for text in texts:
            for sentence in _SENTENCE_END.split(text):
                self.add(sentence, "restored")

    def neutral(self) -> str:
        line = NEUTRAL_LINES[self._neutral % len(NEUTRAL_LINES)]
        self._neutral += 1
        return line
