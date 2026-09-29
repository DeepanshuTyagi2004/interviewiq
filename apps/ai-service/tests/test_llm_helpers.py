"""Self-checks for LLM client pure helpers. Run: python -m tests.test_llm_helpers"""
import asyncio
from app.llm.client import parse_json, gather_capped, _retry_plan, extract_thought


def test_extract_thought():
    assert extract_thought('<thought>reasoning here</thought>{"ok": true}') == "reasoning here"
    assert extract_thought('{"ok": true}') == ""   # no preamble -> empty


def test_parse_fenced():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_strips_gemma_thought_preamble():
    # Gemma 4 can't disable thinking: a <thought> block (which itself contains brace-y JSON
    # examples) precedes the real fenced answer. The thought must be stripped or the brace scan
    # grabs a `{` from inside it and fails — the old qwen3 silent-source-drop bug.
    content = ('<thought>plan: emit `{"ok": false}` ... actually `{"ok": true}`</thought>'
               '```json\n{"ok": true}\n```')
    assert parse_json(content) == {"ok": True}


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


def test_complete_rotates_on_any_error_and_raises_last():
    from app.llm.client import LLMClient, LLMError

    class FakeResp:
        status_code, text, headers = 500, "server boom", {}
        def json(self): return {}

    c = LLMClient(base_url="http://x", api_keys=["a", "b"], model="m", timeout_seconds=1.0)
    used = []
    async def fake_post(url, json, headers):
        used.append(headers["Authorization"])
        return FakeResp()
    async def no_sleep(*a, **k): pass
    c._client.post, c._cooldown = fake_post, no_sleep   # no network, no real waiting

    try:
        asyncio.run(c.complete("sys", "usr"))
        raise AssertionError("expected LLMError")
    except LLMError as e:
        assert "500" in str(e) and "server boom" in str(e)   # last error surfaced, not swallowed
    assert {"Bearer a", "Bearer b"} <= set(used)              # rotated across BOTH keys, not just one
    asyncio.run(c.aclose())


def test_key_round_robin_and_cooldown():
    import time
    from app.llm.client import LLMClient
    c = LLMClient(base_url="http://x", api_keys=["a", "b"], model="m", timeout_seconds=1.0)
    # fresh keys → round-robin, no wait
    assert c._acquire_key() == (0, 0.0)
    assert c._acquire_key() == (1, 0.0)
    assert c._acquire_key() == (0, 0.0)
    # cool the key rotation would pick next (index 1) → skip it, hand back the free one (0)
    c._cooldown_until[1] = time.monotonic() + 999
    assert c._acquire_key() == (0, 0.0)
    # ALL cooling → return soonest-free key with a positive wait the caller must sleep
    c._cooldown_until[0] = time.monotonic() + 5
    idx, wait = c._acquire_key()
    assert idx == 0 and 0 < wait <= 5
    asyncio.run(c.aclose())


if __name__ == "__main__":
    test_extract_thought()
    test_parse_fenced()
    test_parse_strips_gemma_thought_preamble()
    test_parse_garbage_raises()
    test_gather_capped_respects_limit()
    test_gather_capped_captures_exceptions_as_none()
    test_retry_plan_parses_tpd_and_minutes()
    test_retry_plan_parses_tpm_seconds()
    test_retry_plan_prefers_retry_after_header()
    test_complete_rotates_on_any_error_and_raises_last()
    test_key_round_robin_and_cooldown()
    print("ok")
