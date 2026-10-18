"""What the interviewer says while the model is slow to answer. A human who needs a moment says a few different
things as it stretches on: first a short "give me a second", then "just a little more", then an apology. These are
spoken in stages, each stage with a few wordings drawn at random (so the same line never repeats back to back), and the real answer
is opened with a short acknowledgement after a short wait or an apology after a long one. Never a bare "There.": a live round said "Give me a
second. There." and the word meant nothing. PRODUCT IP draft, like the prompts."""
from __future__ import annotations

import random
import re
from typing import Any

# One tuple per stage, in the order they are said as the wait grows. The default voice, for a blueprint without a realism block (an old one);
# a persona with one has its own wordings (app/blueprint/speech_vocab.py).
STAGES: tuple[tuple[str, ...], ...] = (
    ("Give me a second.", "One moment.", "Hmm, let me think about that.", "Let me think for a second.", "Just a moment.",
     "Hold on a moment."),
    ("Just a little more.", "Bear with me, almost there.", "Still with you, one moment.", "Almost there.",
     "Give me just a bit longer.", "Still thinking, bear with me."),
    ("Sorry about the wait.", "Apologies, this is taking a little longer than usual.", "Sorry, this is taking a bit longer.",
     "Thanks for your patience, still on it.", "Apologies for the wait, nearly done."),
    ("Sorry for the delay, thank you for your patience.", "I haven't forgotten you, nearly there.",
     "Sorry, I'm still working on this.", "Really sorry for the wait, almost there.", "Thank you for waiting, nearly there."),
)
RECOVERY_SHORT: tuple[str, ...] = ("Okay.", "Right.")          # after a short wait
RECOVERY_APOLOGY: tuple[str, ...] = ("Sorry for the delay.", "Thanks for waiting.")   # after the third stage or later
RECOVERY_WORDS = 3       # the persona's acknowledgement that opens the real answer after a short wait is at most this many words
# "Thank you." or "Certainly." opening the real answer after the interviewer's own wait would thank the candidate for it or sound like a shop assistant.
_POLITE = re.compile(r"\b(?:thanks?|certainly|very well)\b", re.IGNORECASE)
NO_REPEAT_LAST = 2       # a wording of a stage is not used again until two others have been
APOLOGY_FROM_STAGE = 3   # stages said: 3 or more means the wait was long enough to apologise for


class Fillers:
    """Hands out the wordings at random, never one of the last two of a stage again (decided 2026-10-18; it used to rotate in a fixed order). Kept for
    the whole interview. The persona's own wordings (`habits`, from the blueprint's realism block: 2-3 per stage, drawn from app/blueprint/speech_vocab.py) replace the defaults when it has two or more for a stage."""

    def __init__(self, rng: random.Random | None = None, habits: dict[str, Any] | None = None) -> None:
        self._rng = rng or random.Random()
        self._habits = habits or {}
        self._recent: dict[str, list[str]] = {}

    def _next(self, key: str, options: tuple[str, ...]) -> str:
        recent = self._recent.setdefault(key, [])
        fresh = [o for o in options if o not in recent] or [o for o in options if o != (recent[-1] if recent else None)] or list(options)
        choice = self._rng.choice(fresh)
        recent.append(choice)
        del recent[:-NO_REPEAT_LAST]
        return choice

    def _vocabulary(self, key: str, default: tuple[str, ...]) -> tuple[str, ...]:
        own = (self._habits.get("fillers") or {}).get(key)
        return tuple(own) if own and len(own) >= 2 else default

    def line(self, stage: int) -> str:
        """The filler for a stage (0 is the first), the last stage's wordings for any later one."""
        i = min(stage, len(STAGES) - 1)
        return self._next(f"stage{i}", self._vocabulary(f"stage{i}", STAGES[i]))

    def recovery(self, stages_said: int) -> str:
        """The line that opens the real answer after `stages_said` fillers."""
        if stages_said >= APOLOGY_FROM_STAGE:
            return self._next("apology", RECOVERY_APOLOGY)
        from app.interviewer.talker import opens_with_verdict      # imported late: the talker imports this module
        # Only a short neutral acknowledgement of the persona's own: a verdict ("Love that.") said before the real answer would judge nothing yet,
        # and a long one ("Okay, let me think about that for a moment.") would answer the wait with another one.
        acks = tuple(a for a in (str(x) for x in self._habits.get("acks") or ())
                     if len(a.split()) <= RECOVERY_WORDS and not opens_with_verdict(a) and not _POLITE.search(a))
        return self._next("short", acks if len(acks) >= 3 else RECOVERY_SHORT)
