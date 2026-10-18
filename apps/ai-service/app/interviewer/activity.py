"""What the candidate did in the workspace, on the worker's clock (spec §6): batches from the browser go into a short
in-memory ring buffer, and the candidate's speech is stamped word by word from the interim transcripts.
Nothing here is persisted: the digests built from it (digest.py) are."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Callable, Iterable

MAX_AGE_S = 600.0
MAX_EVENTS = 5000
PAST_SLACK_S = 60.0
FUTURE_SLACK_S = 2.0
OFFSET_WINDOW_S = 30.0    # the clock offset is the minimum over this long, so a browser clock that steps recovers
OFFSET_BATCHES = 50
STALE_INTERIM_S = 8.0     # an interim nothing confirmed for this long was retracted by speech-to-text


@dataclass(frozen=True)
class Event:
    at: float                 # the worker's clock, seconds
    kind: str                 # the wire `k`: ptr | caret | edit | shape | focus
    data: dict[str, Any]      # the event's own fields, without `k` and `t`


@dataclass
class Word:
    text: str
    at: float                 # when the word first appeared in a transcript update (about ±300 ms of when it was said)


@dataclass
class Utterance:
    start: float
    end: float
    text: str
    words: list[Word]
    prev_end: float           # when the candidate's previous turn ended (or when the round began)


class ActivityTracker:
    def __init__(self, clock: Callable[[], float]) -> None:
        self.clock = clock
        self.started_at = clock()
        self.events: deque[Event] = deque()
        self.offset: float | None = None          # worker clock minus browser clock, minimised over recent batches
        self._skews: deque[tuple[float, float]] = deque(maxlen=OFFSET_BATCHES)   # (received_at, received − sent)
        self.last_turn_end: float | None = None   # when the candidate's previous turn ended
        self._final: list[Word] = []      # words of the segments already final in the turn being spoken
        self._interim: list[Word] = []    # words of the segment still being recognised
        self._start: float | None = None
        self._end: float | None = None

    # ------------------------------------------------------------ events

    def ingest(self, sent_at_ms: int, events: Iterable[dict[str, Any]], received_at: float | None = None) -> int:
        """Map each event's browser time to the worker clock and keep the ones that make sense. The offset is the
        smallest `received − sent` over the last 30 s: it equals the clock difference plus the shortest network delay,
        so jitter never makes an event look later than it was, and a browser clock that steps (an NTP correction)
        recovers within 30 s instead of staying wrong for the whole round. Returns how many events were kept."""
        now = self.clock() if received_at is None else received_at
        self._skews.append((now, now - sent_at_ms / 1000.0))
        while self._skews and self._skews[0][0] < now - OFFSET_WINDOW_S:
            self._skews.popleft()
        self.offset = min(skew for _, skew in self._skews)
        kept = 0
        for raw in events:
            at = raw["t"] / 1000.0 + self.offset
            if at < now - PAST_SLACK_S or at > now + FUTURE_SLACK_S:
                continue
            data = {k: v for k, v in raw.items() if k not in ("k", "t")}
            self.events.append(Event(at, raw["k"], data))
            kept += 1
        self._trim(now)
        return kept

    def ingest_batch(self, batch: Any, received_at: float | None = None) -> int:
        """`batch` is a parsed `ActivityBatch` (protocol.py)."""
        return self.ingest(batch.sent_at, [e.model_dump(exclude_none=True) for e in batch.events], received_at)

    def window(self, start: float, end: float) -> list[Event]:
        """The events between `start` and `end`, in time order (held pointer samples can arrive out of order)."""
        return sorted((e for e in self.events if start <= e.at <= end), key=lambda e: e.at)

    # ------------------------------------------------------------ speech

    def on_transcript(self, text: str, is_final: bool, created_at: float) -> None:
        """An interim or final transcript update. Each word new since the previous update is stamped with this update's
        time; words that did not change keep their stamp (speech-to-text revises earlier words as it goes)."""
        words = text.split()
        if not words:
            return
        if self._interim and self._end is not None and created_at - self._end > STALE_INTERIM_S:
            self._interim = []              # speech-to-text retracted it and no final ever came: do not let it stretch this turn
            if not self._final:
                self._start = None
        if self._start is None:
            self._start = created_at
        keep = 0
        while keep < len(self._interim) and keep < len(words) and self._interim[keep].text == words[keep]:
            keep += 1
        stamped = self._interim[:keep] + [Word(w, created_at) for w in words[keep:]]
        if is_final:
            self._final += stamped
            self._interim = []
        else:
            self._interim = stamped
        self._end = created_at

    def turn_open(self, now: float, within: float = 10.0) -> bool:
        """Words of a turn not closed yet, the last one recent: the candidate is partway through saying something."""
        return bool(self._final or self._interim) and self._end is not None and now - self._end <= within

    def take_turn(self, text: str | None = None) -> Utterance | None:
        """Close the candidate turn being spoken (one or more final segments) and start the next. None if no words."""
        words = self._final + self._interim
        end = self._end
        self._final, self._interim, self._start, self._end = [], [], None, None
        if not words or end is None:
            return None
        start = words[0].at                 # the first word that survived, not the first update ever seen
        prev_end = self.last_turn_end if self.last_turn_end is not None else self.started_at
        self.last_turn_end = end
        return Utterance(start, end, (text or " ".join(w.text for w in words)).strip(), words, prev_end)

    def _trim(self, now: float) -> None:
        cutoff = now - MAX_AGE_S
        while self.events and self.events[0].at < cutoff:
            self.events.popleft()
        while len(self.events) > MAX_EVENTS:
            self.events.popleft()
