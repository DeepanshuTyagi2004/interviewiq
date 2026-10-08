"""Gemini stage: native generateContent with JSON mode, thought parts skipped, keys in a header (never the
URL or logs), rate-limited keys cooled, rejected keys quarantined, and the free-tier chain as fallback.
Synthetic credentials and HTTP MockTransport only."""
import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.llm.client import LLMError
from app.llm.gemini_client import GeminiClient, decode
from app.llm.research_client import ResearchLLMClient
from app.research.gateway import _routing_identity

KEYS = ["synthetic-gem-a", "synthetic-gem-b"]


def _settings(**updates):
    return Settings.model_construct(
        llm_api_keys=[], llm_model="google-model", groq_api_keys=[], groq_fallback_models=[],
        cloudflare_api_token="", cloudflare_account_id="", gemini_api_keys=list(KEYS),
    ).model_copy(update=updates)


def _reply(text='{"ok": true}', finish="STOP", thought=None):
    parts = ([{"text": thought, "thought": True}] if thought else []) + [{"text": text}]
    return httpx.Response(200, json={
        "candidates": [{"content": {"parts": parts, "role": "model"}, "finishReason": finish}],
        "usageMetadata": {"promptTokenCount": 7, "candidatesTokenCount": 3, "thoughtsTokenCount": 11, "totalTokenCount": 21},
        "modelVersion": "gemini-3.8-flash"})


async def _mock(client, handler):
    await client._client.aclose()
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_request_shape_and_decoded_result():
    seen = []

    def handler(request):
        seen.append(request)
        return _reply(thought='{"draft": 1}')

    async def go():
        client = GeminiClient(_settings(), max_output_tokens=2048)
        await _mock(client, handler)
        result = await client.complete_full("be precise", "say ok", label="t")
        await client.aclose()
        return result

    result = asyncio.run(go())
    request = seen[0]
    assert str(request.url) == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
    assert request.headers["x-goog-api-key"] == KEYS[0] and "key=" not in str(request.url)
    body = json.loads(request.content)
    assert body["systemInstruction"]["parts"][0]["text"] == "be precise"
    assert body["contents"][0]["parts"][0]["text"] == "say ok"
    config = body["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["maxOutputTokens"] == 8192          # the caller's 2048 is a Groq-ledger cap; Gemini gets its own
    assert config["thinkingConfig"] == {"thinkingLevel": "low"}
    assert result.data == {"ok": True}                 # the thought part is skipped
    assert result.provider == "gemini" and result.model == "gemini-3.8-flash"
    assert result.usage["prompt_tokens"] == 7 and result.usage["completion_tokens"] == 3


@pytest.mark.parametrize("body,reason", [
    ({"candidates": [{"content": {"parts": [{"text": '{"a": 1'}]}, "finishReason": "MAX_TOKENS"}]}, "finish_reason_length"),
    ({"candidates": [{"content": {"parts": [{"text": "no json here"}]}, "finishReason": "STOP"}]}, "invalid_json"),
    ({"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}}, "blocked_prompt"),
    ({"candidates": [{"content": {"parts": []}, "finishReason": "STOP"}]}, "missing_content"),
    ("not an object", "malformed_envelope"),
])
def test_unusable_replies_map_to_fixed_categories(body, reason):
    assert decode(body)[3] == reason


def test_rate_limited_key_cools_and_the_next_key_answers():
    calls = []

    def handler(request):
        key = request.headers["x-goog-api-key"]
        calls.append(key)
        if key == KEYS[0]:
            return httpx.Response(429, headers={"retry-after": "30"}, json={"error": {"code": 429}})
        return _reply()

    async def go():
        client = GeminiClient(_settings(), max_output_tokens=1024)
        await _mock(client, handler)
        first = await client.complete_full("s", "u")
        second = await client.complete_full("s", "u")   # key a is still cooling: skipped, not called
        await client.aclose()
        return first, second

    first, second = asyncio.run(go())
    assert calls == [KEYS[0], KEYS[1], KEYS[1]]
    assert first.attempts == 2 and first.key_index == 1 and second.attempts == 1


def test_truncated_reply_gets_one_repair_on_the_same_key():
    replies = [_reply('{"a": 1', finish="MAX_TOKENS"), _reply()]
    prompts = []

    def handler(request):
        prompts.append((request.headers["x-goog-api-key"], json.loads(request.content)["contents"][0]["parts"][0]["text"]))
        return replies.pop(0)

    async def go():
        client = GeminiClient(_settings(), max_output_tokens=1024)
        await _mock(client, handler)
        result = await client.complete_full("s", "u")
        await client.aclose()
        return result

    result = asyncio.run(go())
    assert result.data == {"ok": True} and result.attempts == 2
    assert prompts[0][0] == prompts[1][0]
    assert "Return only one complete, concise JSON object" in prompts[1][1]


def test_rejected_keys_are_quarantined_and_never_logged(caplog):
    def handler(request):
        return httpx.Response(403, json={"error": {"message": "API key not valid"}})

    async def go():
        client = GeminiClient(_settings(), max_output_tokens=1024)
        await _mock(client, handler)
        with pytest.raises(LLMError) as first:
            await client.complete_full("s", "u")
        with pytest.raises(LLMError) as second:
            await client.complete_full("s", "u")
        await client.aclose()
        return first.value, second.value

    first, second = asyncio.run(go())
    assert first.attempts == 2 and first.reason == "http_403"
    assert second.attempts == 0                      # both keys quarantined: nothing is sent again
    assert not any(k in caplog.text or k in str(first) for k in KEYS)


def test_router_tries_gemini_first_then_falls_back():
    def router_settings():
        return _settings(gemini_api_keys=["synthetic-gem-a"], llm_api_keys=["synthetic-google"],
                         research_llm_deadline_seconds=30.0, research_groq_stage_seconds=5.0,
                         research_google_timeout_seconds=5.0, research_max_output_tokens=1024)

    async def run(gemini_status):
        calls = []

        def handler(request):
            if "generateContent" in str(request.url):
                calls.append("gemini")
                return _reply() if gemini_status == 200 else httpx.Response(gemini_status, json={})
            calls.append("google")
            return httpx.Response(200, json={"choices": [{"message": {"content": '{"via": "google"}'}, "finish_reason": "stop"}],
                                             "usage": {}})

        client = ResearchLLMClient(router_settings())
        for stage in (client._gemini, client._fallback):
            await _mock(stage, handler)
        result = await client.complete_full("s", "u")
        await client.aclose()
        return calls, result

    calls, result = asyncio.run(run(200))
    assert calls == ["gemini"] and result.provider == "gemini"
    calls, result = asyncio.run(run(503))
    assert calls == ["gemini", "google"] and result.provider == "google" and result.data == {"via": "google"}
    assert result.attempts == 2


def test_routing_identity_leads_with_gemini_only_when_configured():
    plain = _settings(gemini_api_keys=[], llm_api_keys=["g"], llm_base_url="https://generativelanguage.googleapis.com/v1beta/openai")
    assert "gemini" not in json.dumps(_routing_identity(plain))
    with_gemini = plain.model_copy(update={"gemini_api_keys": ["synthetic-gem-a"]})
    identity = _routing_identity(with_gemini)
    assert identity["primary"] == {"provider": "gemini", "model": "gemini-3.8-flash",
                                   "base_url": "https://generativelanguage.googleapis.com/v1beta"}
    assert identity["fallback_route"] == _routing_identity(plain)
    assert "synthetic-gem-a" not in json.dumps(identity)
    client = ResearchLLMClient(with_gemini)
    assert client.routing_identity["policy"].startswith("gemini-")
    asyncio.run(client.aclose())


def test_settings_split_and_default_gemini_values(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    base = dict(_env_file=None, EXA_API_KEY="x", MONGODB_URL="mongodb://localhost/test", INTERNAL_API_KEY="x",
                LLM_API_KEY="g", LLM_MODEL_NAME="m")
    settings = Settings(**base, GEMINI_API_KEY=" a, b ,a,, ")
    assert settings.gemini_api_keys == ["a", "b"]
    assert settings.gemini_model == "gemini-3.8-flash" and settings.gemini_thinking_level == "low"
    assert "gemini_api_keys" not in repr(settings)          # keys never appear in a settings repr
    assert Settings(**base).gemini_api_keys == []


def test_out_of_credit_key_is_set_aside_so_calls_go_straight_to_the_fallback():
    calls = []

    def handler(request):
        if "generateContent" in str(request.url):
            calls.append("gemini")
            return httpx.Response(402, json={"error": {"code": 402, "status": "RESOURCE_EXHAUSTED"}})
        calls.append("google")
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}], "usage": {}})

    async def go():
        client = ResearchLLMClient(_settings(gemini_api_keys=["synthetic-gem-a"], llm_api_keys=["synthetic-google"],
                                             research_llm_deadline_seconds=30.0, research_groq_stage_seconds=5.0,
                                             research_google_timeout_seconds=5.0, research_max_output_tokens=1024))
        for stage in (client._gemini, client._fallback):
            await _mock(stage, handler)
        await client.complete_full("s", "u")
        await client.complete_full("s", "u")           # the key is cooling: Gemini is not called again
        await client.aclose()

    asyncio.run(go())
    assert calls == ["gemini", "google", "google"]


def test_groq_gets_low_reasoning_effort_for_gpt_oss_and_a_measured_token_estimate():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}],
                                         "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

    async def go(model):
        settings = _settings(gemini_api_keys=[], groq_api_keys=["synthetic-groq"], groq_model=model,
                             research_groq_tpm=8000, research_groq_rpm=30, research_llm_deadline_seconds=10.0,
                             research_groq_stage_seconds=5.0, research_max_output_tokens=3500)
        client = ResearchLLMClient(settings)
        for stage in client._groq_clients:
            await _mock(stage, handler)
        # ~15k bytes: refused at 3 bytes/token (5,000 + 3,500 > 8,000), accepted at the measured 3.6.
        await client.complete_full("s", "x" * 15000)
        await client.aclose()

    asyncio.run(go("openai/gpt-oss-120b"))
    asyncio.run(go("qwen/qwen3-32b"))
    assert seen[0]["reasoning_effort"] == "low" and "reasoning_effort" not in seen[1]
