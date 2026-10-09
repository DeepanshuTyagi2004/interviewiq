import json
from pathlib import Path

import pytest

from app.interviewer.activity import MAX_EVENTS, ActivityTracker
from app.interviewer.protocol import parse_web
from tests.interviewer.fixtures import Clock

EXAMPLES = json.loads((Path(__file__).resolve().parents[4] / "packages/contracts/live-workspace.examples.json").read_text())


def tracker(now: float = 1000.0) -> ActivityTracker:
    return ActivityTracker(lambda: now)


def edit(t_s: float, line: int = 1, ins: str = "x") -> dict:
    return {"k": "edit", "t": int(t_s * 1000), "from_line": line, "to_line": line, "ins": ins, "removed": 0}


def test_ingest_maps_browser_times_onto_the_workers_clock():
    t = tracker(1000.0)
    # the browser's clock runs 500 s ahead: the batch is sent at browser 1500.0 and received at worker 1000.0
    assert t.ingest(1_500_000, [edit(1498.0), edit(1499.5)], received_at=1000.0) == 2
    assert [e.at for e in t.window(0, 2000)] == [998.0, 999.5]


def test_the_smallest_offset_wins_so_network_jitter_never_moves_events_later():
    t = tracker()
    t.ingest(1_000_000, [edit(999.0)], received_at=1000.2)      # a slow batch: offset 0.2
    t.ingest(1_001_000, [edit(1000.5)], received_at=1001.05)    # a fast one: offset 0.05
    assert t.offset == pytest.approx(0.05)
    t.ingest(1_002_000, [edit(1002.0)], received_at=1002.5)     # slow again: the offset does not grow back
    assert t.offset == pytest.approx(0.05)
    assert t.window(1002, 1003)[0].at == pytest.approx(1002.05)


def test_events_from_the_far_past_or_future_are_dropped():
    t = tracker(1000.0)
    kept = t.ingest(1_000_000, [edit(900.0), edit(1000.0), edit(1010.0)], received_at=1000.0)  # 100 s ago, now, 10 s ahead
    assert kept == 1 and [e.at for e in t.events] == [1000.0]


def test_window_returns_events_in_time_order_even_when_they_arrived_out_of_order():
    t = tracker(1000.0)
    t.ingest(1_000_000, [edit(999.0, ins="late"), edit(998.0, ins="early"), edit(990.0, ins="outside")], received_at=1000.0)
    assert [e.data["ins"] for e in t.window(997, 1000)] == ["early", "late"]


def test_an_event_keeps_its_fields_without_the_wire_envelope():
    t = tracker(1000.0)
    t.ingest(1_000_000, [{"k": "ptr", "t": 999_000, "s": "code", "line": 4, "col": 2, "text": "x = 1"}], received_at=1000.0)
    event = t.events[0]
    assert event.kind == "ptr" and event.data == {"s": "code", "line": 4, "col": 2, "text": "x = 1"}


def test_the_ring_buffer_keeps_five_thousand_events_and_ten_minutes():
    clock = Clock(1000.0)
    t = ActivityTracker(clock)
    for _ in range(MAX_EVENTS + 100):
        t.ingest(int(clock() * 1000), [edit(clock())], received_at=clock())
    assert len(t.events) == MAX_EVENTS
    clock.advance(700)
    t.ingest(int(clock() * 1000), [edit(clock())], received_at=clock())
    assert len(t.events) == 1


def test_ingest_batch_takes_a_parsed_activity_message():
    t = tracker(1760000001.0)
    batch = parse_web(json.dumps(EXAMPLES["activity.batch"]))
    assert t.ingest_batch(batch, received_at=1760000001.0) == len(EXAMPLES["activity.batch"]["events"])
    kinds = [e.kind for e in t.window(0, 2_000_000_000)]
    assert kinds[:3] == ["focus", "edit", "caret"] and "shape" in kinds
    edit_event = next(e for e in t.events if e.kind == "edit")
    assert edit_event.data["from_line"] == 3 and edit_event.data["ins"] == "for i in range(n):"


def test_words_are_stamped_when_each_interim_update_first_showed_them():
    t = tracker()
    t.on_transcript("I add", False, 10.0)
    t.on_transcript("I add the loop", False, 10.6)
    t.on_transcript("I add the loop here", True, 11.2)
    utt = t.take_turn()
    assert [(w.text, w.at) for w in utt.words] == [("I", 10.0), ("add", 10.0), ("the", 10.6), ("loop", 10.6), ("here", 11.2)]
    assert (utt.start, utt.end, utt.text) == (10.0, 11.2, "I add the loop here")


def test_a_revised_interim_restamps_only_the_words_that_changed():
    t = tracker()
    t.on_transcript("I will use a hash", False, 5.0)
    t.on_transcript("I will use a hashmap", False, 5.5)
    t.on_transcript("I will use a hashmap here", True, 6.0)
    words = t.take_turn().words
    assert [(w.text, w.at) for w in words] == [("I", 5.0), ("will", 5.0), ("use", 5.0), ("a", 5.0), ("hashmap", 5.5), ("here", 6.0)]


def test_several_final_segments_make_one_turn():
    t = tracker()
    t.on_transcript("first part", True, 1.0)
    t.on_transcript("second", False, 2.0)
    t.on_transcript("second part", True, 2.4)
    utt = t.take_turn("first part second part")
    assert utt.text == "first part second part"
    assert (utt.start, utt.end) == (1.0, 2.4)
    assert [w.at for w in utt.words] == [1.0, 1.0, 2.0, 2.4]


def test_prev_end_is_when_the_previous_turn_ended_or_the_round_began():
    t = ActivityTracker(lambda: 100.0)
    t.on_transcript("hello", True, 105.0)
    first = t.take_turn()
    t.on_transcript("again", True, 120.0)
    second = t.take_turn()
    assert first.prev_end == 100.0 and second.prev_end == 105.0 and t.last_turn_end == 120.0


def test_a_turn_with_no_transcript_gives_nothing_and_leaves_the_tracker_clean():
    t = tracker()
    assert t.take_turn("typed text") is None
    t.on_transcript("   ", True, 3.0)          # whitespace is not speech
    assert t.take_turn() is None
    t.on_transcript("now real", True, 4.0)
    assert t.take_turn().text == "now real"


def test_taking_a_turn_starts_the_next_one_fresh():
    t = tracker()
    t.on_transcript("one two", True, 1.0)
    t.take_turn()
    t.on_transcript("three", False, 9.0)
    utt = t.take_turn()
    assert [w.text for w in utt.words] == ["three"] and utt.start == 9.0


def test_a_retracted_interim_does_not_stretch_the_next_turn():
    t = tracker()
    t.on_transcript("the", False, 1010.0)                     # speech-to-text heard something and retracted it: no final came
    t.on_transcript("the loop is linear", True, 1200.0)       # three minutes later, real speech that starts with the same word
    utt = t.take_turn()
    assert (utt.start, utt.end) == (1200.0, 1200.0)
    assert [w.at for w in utt.words] == [1200.0] * 4


def test_the_turn_starts_at_its_first_surviving_word_not_at_the_first_update_ever_seen():
    t = tracker()
    t.on_transcript("uh", False, 5.0)
    t.on_transcript("so the loop", False, 5.4)                # the interim was rewritten: 'uh' did not survive
    t.on_transcript("so the loop works", True, 6.0)
    utt = t.take_turn()
    assert utt.start == 5.4 and [w.text for w in utt.words] == ["so", "the", "loop", "works"]


def test_a_browser_clock_that_steps_back_recovers_once_the_old_offset_ages_out():
    t = tracker()
    t.ingest(1_000_000, [edit(1000.0)], received_at=1000.0)                 # a normal batch: offset 0
    assert t.ingest(910_000, [edit(910.0)], received_at=1010.0) == 0         # the browser clock stepped back 100 s: dropped for now
    assert t.ingest(940_000, [edit(940.0)], received_at=1040.0) == 1         # the old offset is 40 s old: the window has moved on
    assert t.offset == pytest.approx(100.0)
