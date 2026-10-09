"""The Python mirror of the workspace protocol accepts every shared example and rejects the rest."""
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.interviewer.protocol import AGENT_TYPES, WEB_TYPES, agent_message, parse_web

EXAMPLES = json.loads((Path(__file__).resolve().parents[4] / "packages/contracts/live-workspace.examples.json").read_text())


def test_examples_cover_exactly_the_protocol():
    assert set(EXAMPLES) == AGENT_TYPES | WEB_TYPES


@pytest.mark.parametrize("message_type", sorted(EXAMPLES))
def test_every_example_validates_in_its_direction(message_type):
    example = EXAMPLES[message_type]
    if message_type in WEB_TYPES:
        parsed = parse_web(json.dumps(example))
        assert parsed is not None and parsed.type == message_type
    else:
        body = {k: v for k, v in example.items() if k not in ("v", "id")}
        out = agent_message(body)
        assert out["type"] == message_type and out["v"] == 1 and out["id"].startswith("a_")


def test_parse_web_drops_agent_messages_bad_json_and_other_versions():
    assert parse_web(json.dumps(EXAMPLES["panel.show_problem"])) is None
    assert parse_web("{nope") is None
    assert parse_web(json.dumps({**EXAMPLES["workspace.hello"], "v": 2})) is None


def test_agent_message_rejects_invalid_bodies():
    with pytest.raises(ValidationError):
        agent_message({"type": "code.insert", "at": "top", "text": "x" * 2001, "purpose": "stub"})
    with pytest.raises(ValidationError):
        agent_message({"type": "panel.show_problem", "item_id": "s", "label": "Problem 1", "kind": "problem",
                       "statement": "x", "examples": [{"input": "a", "output": "b"}] * 3})


def test_activity_batches_reject_oversized_malformed_and_unknown_events():
    ok = EXAMPLES["activity.batch"]
    parsed = parse_web(json.dumps(ok))
    assert parsed is not None and parsed.type == "activity.batch" and parsed.sent_at == 1760000001000
    assert parsed.events[1].from_line == 3 and parsed.events[1].removed == 0
    out = {"k": "ptr", "t": 1, "s": "out"}
    bad = [
        [],
        [out] * 61,
        [{"k": "ptr", "t": 1, "s": "code", "line": 0, "col": 1, "text": ""}],
        [{"k": "edit", "t": 1, "from_line": 1, "to_line": 1, "ins": "x" * 201, "removed": 0}],
        [{"k": "shape", "t": 1, "op": "teleport", "id": "a", "kind": "rectangle"}],
        [{"k": "teleport", "t": 1}],
    ]
    for events in bad:
        assert parse_web(json.dumps({**ok, "events": events})) is None
    assert parse_web(json.dumps({**ok, "events": [out]})) is not None


def test_pydantic_requires_a_plain_lowercase_shape_kind():
    ok = EXAMPLES["activity.batch"]
    shape = {"k": "shape", "t": 1, "op": "add", "id": "a", "kind": "rectangle"}
    assert parse_web(json.dumps({**ok, "events": [shape]})) is not None
    for kind in ("Rectangle", "rect\nangle", "a b", "rect1", ""):
        assert parse_web(json.dumps({**ok, "events": [{**shape, "kind": kind}]})) is None
