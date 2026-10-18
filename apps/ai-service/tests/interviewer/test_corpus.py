"""The hand-labelled corpus of interviewer lines (tests/interviewer/fixtures/interviewer_lines.jsonl, from the 2026-10-17 text
rehearsals). One test per label: every labelled line is detected and every other line is not. A line a classifier cannot
satisfy without breaking others is listed in KNOWN_MISSES with the reason; the labels themselves are never edited."""
import json
import re
from pathlib import Path

import pytest

from app.interviewer.closing import asks_format_confirmation, leaks_tool_call, promises_to_return, pulls_back, says_planned_later
from app.interviewer.talker import narrates, repair_stumble

FIXTURE = Path(__file__).parent / "fixtures" / "interviewer_lines.jsonl"


def _load() -> list[dict]:
    return [json.loads(x) for x in FIXTURE.read_text().splitlines() if x.strip() and not x.startswith("#")]


CORPUS = _load()
SENTENCES = re.compile(r"(?<=[.?!])\s+")

# label -> {start of the line's text: why the classifier cannot satisfy it}
KNOWN_MISSES: dict[str, dict[str, str]] = {
    "promise": {
        "A greedy matching approach is a useful direction": "ambiguous: 'we can examine the trade-offs in the project discussion' names no topic of theirs",
        "Alright, we'll come back to your background later then.": "sequencing, not a promise about their topic (their background is the planned introduction)",
        "Nice, that's real usage": "'I'll come back to that' with no deferral marker: a bare come-back-to-it is not a cue (brief 2026-10-17)",
        "That's a nice bit of context, we can come back to it.": "'we can come back to it' with no deferral marker: a bare come-back-to-it is not a cue (brief 2026-10-17)",
        "That CLI expense tracker sounds like a fun side project": "ambiguous: 'I'd like to hear more about it. But first...' is a sequencing form the review ruled out",
        "That's a nice habit — a CLI expense tracker": "ambiguous: a bare 'so we can circle back' is no longer a cue (review ruling)",
    },
    "pullback": {
        "Edge cases are worth thinking about, yes": "only 'but first I want to hear...': a first ask uses 'but first' too, so it is not a cue",
    },
}


def _narrates_turn(text: str) -> bool:
    return any(narrates(s) for s in SENTENCES.split(text.strip()) if s)


def _repairs(text: str) -> bool:
    return repair_stumble(text) != text


DETECTORS = {
    "promise": promises_to_return,
    "pullback": pulls_back,
    "format_confirm": asks_format_confirmation,
    "narration": _narrates_turn,
    "tool_leak": leaks_tool_call,
    "stumble": _repairs,
    "planned_later": says_planned_later,
}


def test_the_corpus_is_the_one_the_controller_labelled():
    assert len(CORPUS) == 480
    assert {x for row in CORPUS for x in row["labels"]} == set(DETECTORS)


@pytest.mark.parametrize("label", sorted(DETECTORS))
def test_every_line_of_the_corpus_is_detected_exactly_when_it_carries_the_label(label):
    detect, misses = DETECTORS[label], KNOWN_MISSES.get(label, {})
    wrong = {}
    for row in CORPUS:
        if detect(row["text"]) != (label in row["labels"]):
            wrong[next((k for k in misses if row["text"].startswith(k)), row["text"][:90])] = row["text"]
    unexplained = [k for k in wrong if k not in misses]
    assert not unexplained, f"{label}: {len(unexplained)} lines misclassified, e.g. {unexplained[:5]}"
    assert set(misses) == set(wrong), f"{label}: known_misses that now pass: {sorted(set(misses) - set(wrong))}"
