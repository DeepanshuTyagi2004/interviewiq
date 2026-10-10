"""What the interviewer says while the model is slow to answer. A human who needs a moment says a few different
things as it stretches on: first a short "give me a second", then "just a little more", then an apology. These are
spoken in stages, each stage with a few wordings (so the same line never repeats back to back), and the real answer
is opened with "There." after a short wait or an apology after a long one. PRODUCT IP draft, like the prompts."""
from __future__ import annotations

# One tuple per stage, in the order they are said as the wait grows.
STAGES: tuple[tuple[str, ...], ...] = (
    ("Give me a second.", "One moment.", "Hmm, let me think about that."),
    ("Just a little more.", "Bear with me, almost there.", "Still with you, one moment."),
    ("Sorry about the wait.", "Apologies, this is taking a little longer than usual."),
    ("Sorry for the delay, thank you for your patience.", "I haven't forgotten you, nearly there."),
)
RECOVERY_SHORT: tuple[str, ...] = ("There.", "Okay.", "Right.")          # after a short wait
RECOVERY_APOLOGY: tuple[str, ...] = ("Sorry for the delay.", "Thanks for waiting.")   # after the third stage or later
APOLOGY_FROM_STAGE = 3   # stages said: 3 or more means the wait was long enough to apologise for


class Fillers:
    """Hands out the wordings, rotating within each stage so consecutive uses differ. Kept for the whole interview."""

    def __init__(self) -> None:
        self._used: dict[str, int] = {}

    def _next(self, key: str, options: tuple[str, ...]) -> str:
        n = self._used.get(key, 0)
        self._used[key] = n + 1
        return options[n % len(options)]

    def line(self, stage: int) -> str:
        """The filler for a stage (0 is the first), the last stage's wordings for any later one."""
        i = min(stage, len(STAGES) - 1)
        return self._next(f"stage{i}", STAGES[i])

    def recovery(self, stages_said: int) -> str:
        """The line that opens the real answer after `stages_said` fillers."""
        if stages_said >= APOLOGY_FROM_STAGE:
            return self._next("apology", RECOVERY_APOLOGY)
        return self._next("short", RECOVERY_SHORT)
