"""Research budgets and concurrent routing, synthetic transport/clock only."""
import asyncio
import json
import logging

import httpx
import pytest

from app.config import Settings
from app.llm.client import LLMError, build_research_llm_client
from app.llm.research_quota import QuotaLedger, duration_seconds, retry_seconds


def settings(**updates):
    return Settings.model_construct(
        groq_api_keys=["fake-groq"], groq_fallback_models=[],
        llm_api_keys=["fake-google"], llm_model="google-test",
        cloudflare_account_id="", cloudflare_api_token="",
    ).model_copy(update=updates)


def success(**headers):
    return httpx.Response(200, headers=headers, json={
        "choices": [{"finish_reason": "stop", "message": {"content": '{"ok":true}'}}],
        "usage": {"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
    })


async def mock(client, handler):
    for stage in [*client._groq_clients, client._cloudflare, client._fallback]:
        if stage is not None:
            timeout = stage._client.timeout
            await stage._client.aclose()
            stage._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=timeout)


@pytest.mark.parametrize("value,expected", [
    ("1m2.5s", 62.5), ("500ms", .5), ("2h1m", 7260), ("12", 12),
    ("nan", None), ("inf", None), ("-1", None), ("1mgarbage", None), (None, None),
])
def test_provider_duration_headers(value, expected):
    assert duration_seconds(value) == expected


def test_rate_limit_uses_longest_retry_and_exhausted_reset_hint():
    headers = {"retry-after": "2", "x-ratelimit-remaining-tokens": "0",
               "x-ratelimit-reset-tokens": "1m2.5s"}
    assert retry_seconds(headers) == 62.5
    assert retry_seconds({"retry-after": "500ms"}) == .5
    assert retry_seconds({}, "Please try again in 1m3s") == 63


def test_retry_after_http_date(monkeypatch):
    monkeypatch.setattr("app.llm.research_quota.time.time", lambda: 0)
    assert retry_seconds({"retry-after": "Thu, 01 Jan 1970 00:01:00 GMT"}) == 60


def test_atomic_reservations_reconcile_usage_and_request_budget(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("app.llm.research_quota.time.monotonic", lambda: clock[0])
    quota = QuotaLedger(tpm=100, rpm=2)
    first = quota.reserve(80)
    assert first is not None and quota.reserve(30) is None
    quota.reconcile(first, {"prompt_tokens": 5, "completion_tokens": 5})
    second = quota.reserve(80)
    assert second is not None
    quota.reconcile(second, {"total_tokens": 1})
    assert quota.reserve(1) is None  # RPM counts requests even after token refunds.
    clock[0] += 61
    assert quota.reserve(100) is not None


def test_header_capacity_never_replenished_by_late_concurrent_response(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("app.llm.research_quota.time.monotonic", lambda: clock[0])
    quota = QuotaLedger(10000, 30)
    first, second = quota.reserve(100), quota.reserve(100)
    quota.reconcile(first, {"total_tokens": 10}, {
        "x-ratelimit-remaining-tokens": "300", "x-ratelimit-reset-tokens": "10s"})
    # 300 server tokens minus the other in-flight 100 leaves 200 to reserve.
    third = quota.reserve(200)
    assert third is not None and quota.reserve(1) is None
    quota.reconcile(second, {"total_tokens": 10}, {
        "x-ratelimit-remaining-tokens": "9000", "x-ratelimit-reset-tokens": "1s"})
    assert quota.reserve(1) is None  # Stale, larger remaining cannot refund third.
    quota.reconcile(third, {"total_tokens": 10})
    assert quota.reserve(1) is None  # Nor can usage reconciliation refill the ceiling.
    clock[0] += 9
    assert quota.reserve(1) is None  # A late response cannot shorten the reset window.
    clock[0] += 2
    assert quota.reserve(1) is not None


def test_actual_usage_above_estimate_debits_known_remaining():
    quota = QuotaLedger(10000, 30)
    initial = quota.reserve(100)
    quota.reconcile(initial, {"total_tokens": 10}, {"x-ratelimit-remaining-tokens": "500"})
    reservation = quota.reserve(100)
    quota.reconcile(reservation, {"total_tokens": 400})
    assert quota.reserve(101) is None
    assert quota.reserve(100) is not None


def test_unknown_cancelled_usage_remains_reserved_and_inflight_does_not_expire(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("app.llm.research_quota.time.monotonic", lambda: clock[0])
    quota = QuotaLedger(100, 30)
    reservation = quota.reserve(100)
    clock[0] += 61
    assert quota.reserve(1) is None  # An in-flight request is still charged.
    quota.reconcile(reservation)
    assert quota.reserve(1) is None
    clock[0] += 61
    assert quota.reserve(100) is not None


@pytest.mark.parametrize("usage", [{"total_tokens": -1}, {"total_tokens": True},
                                   {"prompt_tokens": 10}, {"total_tokens": "NaN"}])
def test_invalid_or_partial_usage_never_refunds_reserved_capacity(usage):
    quota = QuotaLedger(100, 30)
    reservation = quota.reserve(100)
    quota.reconcile(reservation, usage)
    assert quota.reserve(1) is None


def test_concurrent_calls_cannot_spend_same_local_budget_then_usage_refunds():
    async def go():
        client = build_research_llm_client(settings(research_groq_tpm=2200))
        entered, release = asyncio.Event(), asyncio.Event()
        seen = []

        async def handler(request):
            seen.append(request.url.host)
            if request.url.host == "api.groq.com":
                entered.set()
                await release.wait()
            return success()

        await mock(client, handler)
        async with client:
            first = asyncio.create_task(client.complete_full("system", "user"))
            await entered.wait()
            second = await client.complete_full("system", "user")
            assert second.provider == "google" and second.attempts == 1
            release.set()
            initial = await first
            third = await client.complete_full("system", "user")
            assert initial.provider == third.provider == "groq"
            assert initial.usage == {"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11}
        assert seen == ["api.groq.com", "generativelanguage.googleapis.com", "api.groq.com"]
    asyncio.run(go())


def test_groq_stage_wall_deadline_cancels_hung_transport_then_google():
    async def go():
        client = build_research_llm_client(settings(research_groq_stage_seconds=.01))
        cancelled = asyncio.Event()
        seen = []

        async def handler(request):
            seen.append(request.url.host)
            if request.url.host == "api.groq.com":
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
            return success()

        await mock(client, handler)
        async with client:
            result = await asyncio.wait_for(client.complete_full("s", "u"), .5)
        assert cancelled.is_set() and result.provider == "google" and result.attempts == 2
        assert seen == ["api.groq.com", "generativelanguage.googleapis.com"]
    asyncio.run(go())


def test_overall_deadline_cancels_google_and_preserves_attempt_count():
    async def go():
        client = build_research_llm_client(settings(groq_api_keys=[], research_llm_deadline_seconds=.01))

        async def handler(request):
            await asyncio.Event().wait()

        await mock(client, handler)
        async with client:
            with pytest.raises(LLMError, match="overall deadline") as error:
                await asyncio.wait_for(client.complete_full("s", "u"), .5)
            assert error.value.attempts == 1
            assert not client._fallback._locks[0].locked()
    asyncio.run(go())


def test_overall_deadline_includes_cloudflare_queue_wait():
    async def go():
        client = build_research_llm_client(settings(
            groq_api_keys=[], cloudflare_account_id="fake-account", cloudflare_api_token="fake-cf",
            research_llm_deadline_seconds=.01,
        ))

        def never_request(request):
            raise AssertionError("queue deadline must expire before any provider dispatch")

        await mock(client, never_request)
        async with client:
            await client._cloudflare._request_lock.acquire()
            try:
                with pytest.raises(LLMError, match="overall deadline") as error:
                    await asyncio.wait_for(client.complete_full("s", "u"), .5)
                assert error.value.attempts == 0
            finally:
                client._cloudflare._request_lock.release()
    asyncio.run(go())


def test_groq_stage_timeout_preserves_cloudflare_before_google_order():
    async def go():
        client = build_research_llm_client(settings(
            cloudflare_account_id="fake-account", cloudflare_api_token="fake-cf",
            research_groq_stage_seconds=.01,
        ))
        seen = []

        async def handler(request):
            seen.append(request.url.host)
            if request.url.host == "api.groq.com":
                await asyncio.Event().wait()
            return success()

        await mock(client, handler)
        async with client:
            result = await asyncio.wait_for(client.complete_full("s", "u"), .5)
        assert result.provider == "cloudflare" and result.attempts == 2
        assert seen == ["api.groq.com", "api.cloudflare.com"]
    asyncio.run(go())


def test_external_cancellation_propagates_and_keeps_unknown_quota_charge():
    async def go():
        client = build_research_llm_client(settings(research_groq_tpm=2200))
        entered = asyncio.Event()

        async def handler(request):
            entered.set()
            await asyncio.Event().wait()

        await mock(client, handler)
        async with client:
            task = asyncio.create_task(client.complete_full("s", "u"))
            await entered.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            quota = client._quotas[client._primary._model][0]
            assert quota.reserve(2200) is None
            assert all(not charge.active for charge in quota._charges)
    asyncio.run(go())


@pytest.mark.parametrize("status", [500, 503, 401, 403])
def test_google_shared_circuit_rechecks_concurrent_waiters(status):
    async def go():
        client = build_research_llm_client(settings(groq_api_keys=[]))
        entered, release = asyncio.Event(), asyncio.Event()
        seen = []

        async def handler(request):
            seen.append(request)
            entered.set()
            await release.wait()
            return httpx.Response(status, text="secret-provider-body")

        await mock(client, handler)
        async with client:
            first = asyncio.create_task(client.complete_full("s", "u"))
            await entered.wait()
            second = asyncio.create_task(client.complete_full("s", "u"))
            await asyncio.sleep(0)
            release.set()
            results = await asyncio.gather(first, second, return_exceptions=True)
            assert all(isinstance(result, LLMError) for result in results)
            assert sorted(result.attempts for result in results) == [0, 1]
            assert len(seen) == 1
            if status in (401, 403):
                client._fallback._cooldown_until[0] = 0
                with pytest.raises(LLMError) as error:
                    await client.complete_full("s", "u")
                assert error.value.attempts == 0 and len(seen) == 1
    asyncio.run(go())


def test_google_per_key_wall_timeout_once_and_cooldown_shared():
    async def go():
        client = build_research_llm_client(settings(
            groq_api_keys=[], llm_api_keys=["fake-a", "fake-b", "fake-a"],
            research_google_timeout_seconds=.01,
        ))
        seen = []

        async def handler(request):
            seen.append(request.headers["authorization"])
            assert request.extensions["timeout"]["read"] == .01
            await asyncio.Event().wait()

        await mock(client, handler)
        async with client:
            with pytest.raises(LLMError) as error:
                await asyncio.wait_for(client.complete_full("s", "u"), .5)
            assert error.value.attempts == 2
            with pytest.raises(LLMError) as later:
                await client.complete_full("s", "u")
            assert later.value.attempts == 0
        assert seen == ["Bearer fake-a", "Bearer fake-b"]
    asyncio.run(go())


@pytest.mark.parametrize("bad_choice,reason", [
    ({"finish_reason": "length", "message": {"content": '{"ok":true}'}}, "finish_reason_length"),
    ({"finish_reason": "stop", "message": {}}, "missing_content"),
    ({"finish_reason": "secret-finish-reason", "message": {"content": "secret-body"}}, "invalid_json"),
])
def test_one_format_repair_per_model_not_per_key_and_sanitized_logs(bad_choice, reason, caplog):
    caplog.set_level(logging.INFO, logger="app.llm.research_google")

    async def go():
        client = build_research_llm_client(settings(
            groq_api_keys=[f"fake-groq-{i}" for i in range(6)],
            groq_fallback_models=["groq-secondary"],
        ))
        seen = []

        def handler(request):
            payload = json.loads(request.content)
            seen.append(payload["model"])
            if request.url.host == "api.groq.com":
                assert payload["response_format"] == {"type": "json_object"}
                assert payload["max_completion_tokens"] == 2048
                assert "JSON" in payload["messages"][0]["content"]
                if len(seen) % 2 == 0:
                    assert "concise, complete JSON" in payload["messages"][0]["content"]
                return httpx.Response(200, json={"choices": [bad_choice]})
            return success()

        await mock(client, handler)
        async with client:
            result = await client.complete_full("secret-prompt", "secret-user", label="secret-label")
        assert seen == [client._primary._model] * 2 + ["groq-secondary"] * 2 + ["google-test"]
        assert result.provider == "google" and result.attempts == 5
        assert reason in caplog.text
        assert all(secret not in caplog.text for secret in [
            "secret-prompt", "secret-user", "secret-label", "secret-body", "secret-finish-reason", "fake-groq",
        ])
        for state in ["start", "success", "failure", "skipped"]:
            assert f"state={state}" in caplog.text
    asyncio.run(go())


def test_exhausted_remaining_header_skips_key_without_sleep_on_next_call():
    async def go():
        client = build_research_llm_client(settings())
        seen = []

        def handler(request):
            seen.append(request.url.host)
            return success(**{"x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "1m2s"})

        await mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            second = await client.complete_full("s", "u")
        assert first.provider == "groq" and second.provider == "google"
        assert seen == ["api.groq.com", "generativelanguage.googleapis.com"]
    asyncio.run(go())


def test_config_cannot_raise_google_or_groq_stage_hard_caps():
    async def go():
        async with build_research_llm_client(settings(
            research_groq_stage_seconds=120, research_google_timeout_seconds=120,
        )) as client:
            assert client._groq_stage_seconds == 25
            assert client._fallback._request_timeout == 12
    asyncio.run(go())


@pytest.mark.parametrize("status,body,expected", [
    (400, {"error": {"code": "json_validate_failed", "failed_generation": "secret-body"}}, 2),
    (400, {"error": {"code": "unsupported_parameter", "message": "secret-body"}}, 1),
    (404, {"error": "secret-body"}, 1),
])
def test_json_validation_errors_repair_once_and_payload_errors_skip_model(status, body, expected):
    async def go():
        client = build_research_llm_client(settings(groq_api_keys=[f"fake-{i}" for i in range(6)]))
        seen = []

        def handler(request):
            seen.append(request.url.host)
            return httpx.Response(status, json=body) if request.url.host == "api.groq.com" else success()

        await mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
        assert result.attempts == expected + 1
        assert seen == ["api.groq.com"] * expected + ["generativelanguage.googleapis.com"]
    asyncio.run(go())
