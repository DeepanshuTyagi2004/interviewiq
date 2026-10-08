"""A prompt larger than any key's per-minute budget can never be reserved: the Groq stage must skip it at
once (reason `prompt_too_large`) instead of waiting for quota that will never come."""
import asyncio

import httpx
import pytest

from app.config import Settings
from app.llm.client import LLMError
from app.llm.research_client import ResearchLLMClient


def _settings(**updates):
    return Settings.model_construct(
        llm_api_keys=[], llm_model="google-model", groq_api_keys=["synthetic-groq-a", "synthetic-groq-b"],
        groq_model="groq-primary", groq_fallback_models=[], cloudflare_api_token="", cloudflare_account_id="",
        research_groq_tpm=1000, research_groq_rpm=30, research_llm_deadline_seconds=5.0, research_groq_stage_seconds=4.0,
        research_max_output_tokens=800,
    ).model_copy(update=updates)


def test_oversize_prompt_fails_fast_without_calling_groq():
    client = ResearchLLMClient(_settings())
    calls = 0

    def handler(_request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}], "usage": {}})

    async def run():
        for stage in client._groq_clients:
            await stage._client.aclose()
            stage._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        started = asyncio.get_running_loop().time()
        with pytest.raises(LLMError) as err:
            await client.complete_full("system", "x" * 6000, label="too-big")
        assert "prompt_too_large" in str(err.value)
        assert asyncio.get_running_loop().time() - started < 2.0
        await client.aclose()

    asyncio.run(run())
    assert calls == 0
