"""Self-check for the JSON-extraction fallback — the one non-trivial parser in the
hot path (LLM output). Run: python -m tests.test_json_parse  (or pytest)."""
from app.llm.client import parse_json


def test_plain_json():
    assert parse_json('{"rounds": []}') == {"rounds": []}


def test_fenced_json():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_preamble_then_json():
    assert parse_json('Sure! Here it is: {"a": 1, "b": [2,3]} hope that helps') == {"a": 1, "b": [2, 3]}


def test_garbage_raises():
    try:
        parse_json("no json here at all")
    except ValueError:
        return
    raise AssertionError("expected ValueError on non-JSON content")


if __name__ == "__main__":
    test_plain_json()
    test_fenced_json()
    test_preamble_then_json()
    test_garbage_raises()
    print("ok")
