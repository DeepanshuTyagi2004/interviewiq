"""complete_full() exposes what the research trace needs (raw content, token usage, which key,
how many attempts) without changing complete()'s (data, thought) contract."""
import asyncio
import json

import httpx

from app.llm.client import LLMClient


def _client(handler) -> LLMClient:
    llm = LLMClient(base_url="https://llm.test/v1", api_keys=["k0-long-key", "k1-long-key"], model="m", timeout_seconds=5)
    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return llm


def test_complete_full_returns_raw_content_usage_and_key_index():
    body = {"choices": [{"message": {"content": "<thought>hmm</thought>{\"a\": 1}"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3}}

    async def go():
        llm = _client(lambda req: httpx.Response(200, json=body))
        r = await llm.complete_full("sys", "user", label="t")
        data, thought = await llm.complete("sys", "user", label="t")
        await llm.aclose()
        return r, data, thought

    r, data, thought = asyncio.run(go())
    assert r.data == {"a": 1} and r.thought == "hmm"
    assert r.content == body["choices"][0]["message"]["content"]
    assert r.usage == {"prompt_tokens": 11, "completion_tokens": 3}
    assert r.key_index == 0 and r.attempts == 1 and r.latency_ms >= 0
    assert (data, thought) == ({"a": 1}, "hmm")


def test_complete_full_counts_attempts_across_key_rotation():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(500, text="boom")
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"ok": True})}}]})

    async def go():
        llm = _client(handler)
        r = await llm.complete_full("s", "u", label="t")
        await llm.aclose()
        return r

    r = asyncio.run(go())
    assert r.data == {"ok": True} and r.attempts == 2 and r.key_index == 1 and r.usage == {}
