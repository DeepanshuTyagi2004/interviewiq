"""Self-checks for Groq client pure helpers. Run: python -m tests.test_groq_helpers"""
import asyncio
from app.groq.client import parse_json, gather_capped, _retry_plan


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


def test_retry_plan_parses_tpd_and_minutes():
    body = ('{"error":{"message":"Rate limit reached for model `qwen/qwen3-32b` ... on tokens per '
            'day (TPD): Limit 500000, Used 498988, Requested 1258. Please try again in 1m46.27s."}}')
    wait, kind = _retry_plan(body, None)
    assert kind == "daily token limit (TPD)"
    assert 106.0 < wait < 107.0   # 1m46.27s


def test_retry_plan_parses_tpm_seconds():
    body = "tokens per minute (TPM): Limit 6000 ... Please try again in 8.54s."
    wait, kind = _retry_plan(body, None)
    assert kind == "per-minute token limit (TPM)"
    assert 8.0 < wait < 9.0


def test_retry_plan_prefers_retry_after_header():
    wait, kind = _retry_plan("requests per minute (RPM) exceeded", "30")
    assert kind == "per-minute request limit (RPM)"
    assert wait == 30.0


if __name__ == "__main__":
    test_parse_fenced()
    test_parse_garbage_raises()
    test_gather_capped_respects_limit()
    test_gather_capped_captures_exceptions_as_none()
    test_retry_plan_parses_tpd_and_minutes()
    test_retry_plan_parses_tpm_seconds()
    test_retry_plan_prefers_retry_after_header()
    print("ok")
