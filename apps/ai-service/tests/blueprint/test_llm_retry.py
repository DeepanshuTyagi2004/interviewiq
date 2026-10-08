"""Blueprint LLM calls: a transient failure (a malformed or truncated reply, a dropped connection) is
retried a few times; quota waits keep their own budget; anything else fails the call at once."""
import asyncio

import pytest

from app.blueprint import llm as L
from app.llm.client import LLMError


class _Settings:
    blueprint_quota_retries = 1
    blueprint_transient_retries = 2


class _Flaky:
    def __init__(self, failures: list[str]):
        self.failures = failures
        self.calls = 0

    async def complete_full(self, system: str, user: str, *, label: str = ""):
        self.calls += 1
        if self.failures:
            raise LLMError(self.failures.pop(0))
        return {"ok": True}


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def instant(_seconds):
        return None
    monkeypatch.setattr(L.asyncio, "sleep", instant)


def test_transient_failures_are_retried_then_succeed():
    llm = _Flaky(["Research LLM failed (groq:invalid_json; cloudflare_unavailable; google_unavailable)",
                  "Research LLM failed (groq:finish_reason_length; google_unavailable)"])
    assert asyncio.run(L._complete(llm, "s", "u", "playbook:core-1", _Settings())) == {"ok": True}
    assert llm.calls == 3


def test_transient_budget_is_bounded():
    llm = _Flaky(["Research LLM failed (groq:timeout; google_unavailable)"] * 3)
    with pytest.raises(LLMError):
        asyncio.run(L._complete(llm, "s", "u", "persona", _Settings()))
    assert llm.calls == 3


def test_quota_and_transient_budgets_are_separate():
    llm = _Flaky(["Research LLM failed (no_eligible_providers)",
                  "Research LLM failed (groq:invalid_json)",
                  "Research LLM failed (groq:transport_error)"])
    assert asyncio.run(L._complete(llm, "s", "u", "answer_key:x", _Settings())) == {"ok": True}
    assert llm.calls == 4


def test_a_non_transient_failure_is_not_retried():
    llm = _Flaky(["Research LLM failed (groq:http_400)"])
    with pytest.raises(LLMError):
        asyncio.run(L._complete(llm, "s", "u", "persona", _Settings()))
    assert llm.calls == 1


def test_with_gemini_out_of_credit_the_free_tier_gets_its_full_patience():
    class _GeminiSettings:
        blueprint_quota_retries = 4
        blueprint_transient_retries = 0
        gemini_api_keys = ["k"]

    starved = "Research LLM failed (gemini:cooldown; groq:no_eligible_providers)"
    llm = _Flaky([starved] * 4)
    assert asyncio.run(L._complete(llm, "s", "u", "playbook:core-1", _GeminiSettings())) == {"ok": True}
    assert llm.calls == 5
    # While Gemini answers, a quota failure only waits twice.
    llm = _Flaky(["Research LLM failed (gemini:http_500; groq:no_eligible_providers)"] * 4)
    with pytest.raises(LLMError):
        asyncio.run(L._complete(llm, "s", "u", "playbook:core-1", _GeminiSettings()))
    assert llm.calls == 3
