"""A digest of what the candidate did around one utterance (spec §6.4–6.5): typing bursts, where the pointer rested,
selections, board changes, and what "this" and "here" were pointing at when they were said. Rendered as a short block
for the talker and as a structured doc for storage. Digests only: the raw events are never persisted.

Everything the candidate typed, drew or said is data, never instructions: it is cleaned and capped before it is quoted
(control characters, newlines, backticks and the curly quotes this module uses are neutralised)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.interviewer.activity import ActivityTracker, Event, Utterance

LEAD_S = 2.0
BURST_GAP_S = 2.0
DWELL_MIN_S = 0.8
BOARD_GROUP_GAP_S = 3.0
REF_WINDOW_S = 1.5
REST_WEAK_S = 6.0          # a pointer that had been on its target this long before the word is "resting", not pointing
NOW_WINDOW_S = 3.0
MAX_REFS = 5
MAX_LINES = 14
MAX_CHARS = 1200
MAX_DOC_SPANS = 40
TYPED_CAP = 120
HEADER = "## Activity (what they did while speaking, and since)"
IDLE_HEADER = "## Activity (since they last spoke)"

_SHAPE_NAME = {"rectangle": "box", "ellipse": "circle", "diamond": "diamond", "arrow": "arrow", "line": "line", "text": "text", "freedraw": "sketch"}
_PANE = {"code": "the code editor", "board": "the whiteboard", "panel": "the problem"}
_OPS = {"add": "added", "move": "moved", "edit": "changed", "delete": "deleted"}
_PRIORITY = {"ref": 0, "typing": 1, "board": 2, "select": 3, "dwell": 4, "focus": 5}
_DEICTIC = {"this", "these", "those", "here"}
_THAT_NOUNS = {"one", "loop", "line", "part", "box", "thing", "function", "variable", "block", "arrow", "condition", "statement"}
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def clean(text: str, cap: int) -> str:
    """Candidate text made safe to quote: control characters removed, newlines shown as ↵, backticks softened,
    whitespace collapsed, capped with an ellipsis."""
    one = _CONTROL.sub("", str(text).replace("\n", "↵")).replace("`", "'").replace("“", '"').replace("”", '"')
    one = re.sub(r"\s+", " ", one).strip()
    return one if len(one) <= cap else one[: cap - 1].rstrip() + "…"


@dataclass
class Span:
    kind: str                 # typing | dwell | select | board | focus
    start: float
    end: float
    text: str
    lo: int = 0               # the lines a typing or select span covers
    hi: int = 0
    count: int = 0            # edits in a typing span, shape changes in a board span


def _lines(lo: int, hi: int) -> str:
    return f"line {lo}" if lo == hi else f"lines {lo}–{hi}"


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _target(e: Event) -> str | None:
    """What a pointer event rests on, as a phrase; None for a pointer that left the workspace."""
    d = e.data
    surface = d.get("s")
    if surface == "code":
        return f"line {d['line']} `{clean(d.get('text', ''), 80)}`"
    if surface == "board":
        return f"“{clean(d['over'], 60)}” on the whiteboard" if d.get("over") else "an empty part of the whiteboard"
    if surface == "panel":
        return f"“{clean(d.get('quote', ''), 120)}” in the problem"
    return None


def _burst(group: list[Event]) -> Span:
    lo = min(e.data["from_line"] for e in group)
    hi = max(e.data["to_line"] for e in group)
    typed = clean("".join(e.data.get("ins", "") for e in group), TYPED_CAP)
    edits = _plural(len(group), "edit")
    text = f"typed {_lines(lo, hi)} ({edits}): `{typed}`" if typed else f"deleted text on {_lines(lo, hi)} ({edits})"
    return Span("typing", group[0].at, group[-1].at, text, lo=lo, hi=hi, count=len(group))


def _typing(events: list[Event]) -> list[Span]:
    out: list[Span] = []
    group: list[Event] = []
    for e in (e for e in events if e.kind == "edit"):
        if group and e.at - group[-1].at > BURST_GAP_S:
            out.append(_burst(group))
            group = []
        group.append(e)
    if group:
        out.append(_burst(group))
    return out


def _dwell(events: list[Event], end: float) -> list[Span]:
    pointers = [e for e in events if e.kind == "ptr"]
    out: list[Span] = []
    for i, e in enumerate(pointers):
        target = _target(e)
        if target is None:
            continue
        stop = pointers[i + 1].at if i + 1 < len(pointers) else end
        if stop - e.at >= DWELL_MIN_S:
            out.append(Span("dwell", e.at, stop, f"pointer on {target} ({stop - e.at:.1f} s)"))
    return out


def _select(events: list[Event]) -> list[Span]:
    out: list[Span] = []
    for e in events:
        if e.kind == "caret" and e.data.get("sel"):
            lo, hi = e.data["sel"]
            text = e.data.get("text")
            out.append(Span("select", e.at, e.at, f"selected {_lines(lo, hi)}" + (f": `{clean(text, 60)}`" if text else ""), lo=lo, hi=hi))
    return out


def _board_span(group: list[Event]) -> Span:
    items: list[str] = []
    for e in group:
        d = e.data
        raw_kind = str(d.get("kind", "shape"))
        kind = _SHAPE_NAME.get(raw_kind, clean(raw_kind, 30))
        label = f" “{clean(d['label'], 40)}”" if d.get("label") else ""
        item = f"{_OPS.get(d.get('op'), 'changed')} {kind}{label}"
        if not items or items[-1] != item:
            items.append(item)
    more = len(items) - 5
    text = "board: " + "; ".join(items[:5]) + (f" (+{more} more)" if more > 0 else "")
    return Span("board", group[0].at, group[-1].at, text, count=len(group))


def _board(events: list[Event]) -> list[Span]:
    out: list[Span] = []
    group: list[Event] = []
    for e in (e for e in events if e.kind == "shape"):
        if group and e.at - group[-1].at > BOARD_GROUP_GAP_S:
            out.append(_board_span(group))
            group = []
        group.append(e)
    if group:
        out.append(_board_span(group))
    return out


def _focus(events: list[Event]) -> list[Span]:
    return [Span("focus", e.at, e.at, f"switched to {_PANE.get(e.data.get('s'), 'another pane')}") for e in events if e.kind == "focus"]


def build_spans(events: list[Event], end: float) -> list[Span]:
    """The things the candidate did in `events` (time-ordered), by kind, in time order. `end` closes the last pointer dwell."""
    spans = _typing(events) + _dwell(events, end) + _select(events) + _board(events) + _focus(events)
    return sorted(spans, key=lambda s: s.start)


@dataclass
class Ref:
    phrase: str               # the deictic word and the one after it: "this loop"
    at: float
    target: str
    rested_s: float = 0.0     # how long the pointer had been on the target when the word was said


def _target_at(events: list[Event], at: float) -> tuple[str, float] | None:
    """What the pointer was on (within REF_WINDOW_S of `at`), else where the caret or selection was, and for how long the
    pointer had been there (a pointer that arrived before the window counts as long resting)."""
    pointers = [e for e in events if e.kind == "ptr"]
    best: tuple[float, str, float] | None = None
    for i, e in enumerate(pointers):
        target = _target(e)
        if target is None:
            continue
        stop = pointers[i + 1].at if i + 1 < len(pointers) else float("inf")
        gap = 0.0 if e.at <= at <= stop else min(abs(at - e.at), abs(at - stop))
        if gap <= REF_WINDOW_S and (best is None or gap < best[0]):
            rested = float("inf") if e.data.get("carried") else max(0.0, at - e.at)
            best = (gap, target, rested)
    if best:
        return best[1], best[2]
    carets = [e for e in events if e.kind == "caret" and abs(e.at - at) <= REF_WINDOW_S]
    if not carets:
        return None
    c = min(carets, key=lambda e: abs(e.at - at))
    if c.data.get("sel"):
        lo, hi = c.data["sel"]
        return f"the selection on {_lines(lo, hi)}", 0.0
    return f"the caret on line {c.data['line']}", 0.0


def _refs(utt: Utterance, events: list[Event]) -> list[Ref]:
    refs: list[Ref] = []
    words = utt.words
    for i, w in enumerate(words):
        token = re.sub(r"\W", "", w.text).lower()
        nxt = words[i + 1].text if i + 1 < len(words) else ""
        nxt_token = re.sub(r"\W", "", nxt).lower()
        deictic = token in _DEICTIC or (token == "that" and nxt_token in _THAT_NOUNS) or (token == "line" and nxt_token.isdigit())
        if not deictic:
            continue
        found = _target_at(events, w.at)
        if found is None:
            continue
        refs.append(Ref(clean(f"{w.text} {nxt}".strip(), 30), w.at, found[0], found[1]))
        if len(refs) >= MAX_REFS:
            break
    return refs


def _since(spans: list[Span], seconds: float) -> str | None:
    if seconds < 1.0:
        return None
    typing = [s for s in spans if s.kind == "typing"]
    board = [s for s in spans if s.kind == "board"]
    parts: list[str] = []
    if typing:
        parts.append(f"typed {_lines(min(s.lo for s in typing), max(s.hi for s in typing))} ({_plural(sum(s.count for s in typing), 'edit')})")
    if board:
        parts.append(f"changed the whiteboard ({_plural(sum(s.count for s in board), 'change')})")
    return f"Since they last spoke ({int(seconds)} s): {'; '.join(parts) if parts else 'no typing or drawing'}."


def _right_now(tracker: ActivityTracker, now: float) -> str | None:
    parts: list[str] = []
    carets = [e for e in tracker.events if e.kind == "caret" and e.at <= now]
    if carets:
        c = max(carets, key=lambda e: e.at)
        parts.append(f"caret at line {c.data['line']}, col {c.data['col']}")
    pointers = [e for e in tracker.events if e.kind == "ptr" and e.at <= now]
    if pointers:
        p = max(pointers, key=lambda e: e.at)
        target = _target(p)
        if target is not None and now - p.at <= NOW_WINDOW_S:
            parts.append(f"pointer on {target}")
    return f"Right now: {'; '.join(parts)}." if parts else None


def _when(span: Span, t0: float) -> str:
    a = span.start - t0
    if span.end - span.start < 0.05:
        return f"{a:+.1f}s"
    return f"{a:+.1f}–{span.end - t0:.1f}s"


def _render(utt: Utterance, spans: list[Span], refs: list[Ref], since: str | None, right_now: str | None) -> str:
    t0 = utt.start
    items: list[tuple[int, float, str]] = [(_PRIORITY["ref"], r.at, f"- says “{r.phrase}” at {r.at - t0:+.1f}s → {r.target}"
                                                     + (" (the pointer had rested there)" if r.rested_s > REST_WEAK_S else "")) for r in refs]
    items += [(_PRIORITY[s.kind], s.start, f"- {_when(s, t0)} {s.text}") for s in spans]
    kept = sorted(items, key=lambda i: (0 if i[0] == _PRIORITY["ref"] else 1, i[1]))
    head = [HEADER, f"While speaking ({max(1, round(utt.end - utt.start))} s):"]
    tail = [x for x in (since, right_now) if x]
    dropped = 0

    def assemble() -> list[str]:
        body = [line for _, _, line in kept] or ["- nothing typed, drawn or pointed at"]
        return head + body + ([f"- (+{dropped} more)"] if dropped else []) + tail

    lines = assemble()
    while kept and (len(lines) > MAX_LINES or sum(len(line) + 1 for line in lines) > MAX_CHARS):
        victim = max(range(len(kept)), key=lambda k: (kept[k][0], -kept[k][1]))   # the least important, the oldest among equals
        kept.pop(victim)
        dropped += 1
        lines = assemble()
    return "\n".join(lines)


@dataclass
class Digest:
    start: float              # the utterance start: relative times in the doc are to this
    end: float
    spans: list[Span]
    refs: list[Ref]
    since: str | None
    now: str | None
    text: str

    def doc(self) -> dict[str, Any]:
        """The structured record kept with the turn (and given to the director). No raw events."""
        return {
            "started_at": round(self.start, 3),
            "duration_s": round(self.end - self.start, 1),
            "spans": [{"kind": s.kind, "at": round(s.start - self.start, 1), "dur": round(s.end - s.start, 1), "text": s.text}
                      for s in self.spans[:MAX_DOC_SPANS]],
            "refs": [{"phrase": r.phrase, "at": round(r.at - self.start, 1), "target": r.target,
                      "resting": r.rested_s > REST_WEAK_S} for r in self.refs],
            "since": self.since, "now": self.now, "text": self.text,
        }


def _carried(tracker: ActivityTracker, at: float) -> list[Event]:
    """The pointer and caret as they were when a window opened at `at`. The browser reports a pointer only when it moves to
    a new target, so one resting since before the window has no event inside it: without this the digest would say nothing
    is pointed at while the pointer sits on line 9. A pointer that had left the workspace is not carried, and neither is
    an old selection (it would read as a new one)."""
    out: list[Event] = []
    pointers = [e for e in tracker.events if e.kind == "ptr" and e.at < at]
    if pointers:
        last = max(pointers, key=lambda e: e.at)
        if last.data.get("s") != "out":
            out.append(Event(at, "ptr", {**last.data, "carried": True}))
    carets = [e for e in tracker.events if e.kind == "caret" and e.at < at]
    if carets:
        last = max(carets, key=lambda e: e.at)
        out.append(Event(at, "caret", {k: v for k, v in last.data.items() if k not in ("sel", "text")}))
    return out


def digest_for_utterance(tracker: ActivityTracker, utt: Utterance, now: float) -> Digest:
    """What they did while speaking (from LEAD_S before the first word), what they did since their previous turn, where
    the caret and pointer are now, and what "this" and "here" were on when said."""
    lead_start = utt.start - LEAD_S
    during = sorted(tracker.window(lead_start, utt.end) + _carried(tracker, lead_start), key=lambda e: e.at)
    spans = build_spans(during, utt.end)
    ref_from = utt.start - REF_WINDOW_S
    refs = _refs(utt, sorted(tracker.window(ref_from, utt.end + REF_WINDOW_S) + _carried(tracker, ref_from), key=lambda e: e.at))
    before = build_spans(tracker.window(utt.prev_end, lead_start), lead_start)
    since = _since(before, lead_start - utt.prev_end)
    right_now = _right_now(tracker, now)
    if not spans and not refs and not any(s.kind in ("typing", "board") for s in before):
        # Nothing to report: no block at all. "Nothing happened" every turn would only invite remarks about it.
        return Digest(utt.start, utt.end, spans, refs, since, right_now, "")
    return Digest(utt.start, utt.end, spans, refs, since, right_now, _render(utt, spans, refs, since, right_now))


def digest_idle(tracker: ActivityTracker, now: float) -> Digest:
    """No candidate speech to anchor to (a silence nudge, an ordered turn): since they last spoke, and right now."""
    since_from = tracker.last_turn_end if tracker.last_turn_end is not None else tracker.started_at
    spans = build_spans(tracker.window(since_from, now), now)
    meaningful = any(s.kind in ("typing", "board") for s in spans)     # "no typing or drawing" is not worth a block on its own
    since = _since(spans, now - since_from) if meaningful else None
    right_now = _right_now(tracker, now)
    # Where the caret is, with nothing typed or drawn, is not worth a block: it only invites remarks about the cursor.
    text = "\n".join([IDLE_HEADER, *[x for x in (since, right_now) if x]]) if meaningful else ""
    return Digest(now, now, spans, [], since, right_now, text)
