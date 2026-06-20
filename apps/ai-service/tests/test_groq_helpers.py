"""Self-checks for Groq client pure helpers. Run: python -m tests.test_groq_helpers"""
import asyncio
from app.groq.client import parse_json, gather_capped


def test_parse_fenced():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_garbage_raises():
    try:
        parse_json("not json")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_gather_capped_respects_limit():
    state = {"now": 0, "max": 0}

    async def task():
        state["now"] += 1
        state["max"] = max(state["max"], state["now"])
        await asyncio.sleep(0.01)
        state["now"] -= 1
        return "ok"

    results = asyncio.run(gather_capped([task() for _ in range(20)], limit=4))
    assert results == ["ok"] * 20
    assert state["max"] <= 4


def test_gather_capped_captures_exceptions_as_none():
    async def boom():
        raise RuntimeError("x")

    assert asyncio.run(gather_capped([boom()], limit=2)) == [None]


if __name__ == "__main__":
    test_parse_fenced()
    test_parse_garbage_raises()
    test_gather_capped_respects_limit()
    test_gather_capped_captures_exceptions_as_none()
    print("ok")
