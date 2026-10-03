"""Cloudflare research routing using synthetic settings and MockTransport only."""
import asyncio
import json
import logging
import time

import httpx
import pytest

from app.config import Settings
from app.llm.client import LLMError, _RATE_LIMIT_BACKOFF_SECONDS, build_research_llm_client
from app.llm.cloudflare_client import CloudflareLLMClient


TOKEN = "synthetic-cloudflare-token"
ACCOUNT = "synthetic-cloudflare-account"
MODEL = "@cf/openai/gpt-oss-120b"


def _settings(**updates):
    return Settings.model_construct(
        llm_api_keys=["synthetic-google"], llm_model="google-model",
        groq_api_keys=["synthetic-groq-a", "synthetic-groq-b"],
        groq_model="groq-primary", groq_fallback_models=["groq-secondary"],
        cloudflare_api_token=TOKEN, cloudflare_account_id=ACCOUNT,
        cloudflare_model=MODEL, cloudflare_timeout_seconds=0.5, cloudflare_max_tokens=1234,
    ).model_copy(update=updates)


def _success(**updates):
    return httpx.Response(200, json={
        "choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 2, "completion_tokens": 3}, **updates,
    })


async def _mock(client, handler):
    for stage in [*client._groq_clients, client._cloudflare, client._fallback]:
        if stage is not None:
            timeout = stage._client.timeout
            await stage._client.aclose()
            stage._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=timeout)


async def _no_wait(*args, **kwargs):
    raise AssertionError("research stages must not sleep before fallback")


@pytest.mark.parametrize("cloudflare_ok", [True, False])
def test_all_groq_pairs_then_cloudflare_then_google_and_credentials_stay_isolated(cloudflare_ok):
    async def go():
        client = build_research_llm_client(_settings())
        seen = []
        for stage in client._groq_clients:
            stage._cooldown = _no_wait

        def handler(request):
            body = json.loads(request.content)
            seen.append((request.url.host, body["model"], request.headers["authorization"]))
            if request.url.host == "api.groq.com":
                assert TOKEN not in request.headers["authorization"]
                assert ACCOUNT not in str(request.url)
                return httpx.Response(500)
            if request.url.host == "api.cloudflare.com":
                assert str(request.url) == (
                    f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/v1/chat/completions"
                )
                assert request.headers["authorization"] == f"Bearer {TOKEN}"
                assert request.extensions["timeout"]["read"] == 0.5
                assert body == {
                    "model": MODEL, "messages": [
                        {"role": "system", "content": "system"},
                        {"role": "user", "content": "user"},
                    ], "temperature": 0.2, "response_format": {"type": "json_object"},
                    "max_tokens": 1234,
                }
                return _success(model="cf-actual-version") if cloudflare_ok else httpx.Response(500)
            assert request.url.host == "generativelanguage.googleapis.com"
            assert request.headers["authorization"] == "Bearer synthetic-google"
            assert body["messages"] == [{"role": "user", "content": "system\n\nuser"}]
            assert "response_format" not in body
            assert body["max_tokens"] == 2048
            return _success(model="google-actual-version")

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("system", "user")
        expected = [("api.groq.com", model, f"Bearer synthetic-groq-{key}")
                    for model in ["groq-primary", "groq-secondary"] for key in ["a", "b"]]
        expected.append(("api.cloudflare.com", MODEL, f"Bearer {TOKEN}"))
        if not cloudflare_ok:
            expected.append(("generativelanguage.googleapis.com", "google-model", "Bearer synthetic-google"))
        assert seen == expected
        assert result.attempts == len(expected)
        assert result.provider == ("cloudflare" if cloudflare_ok else "google")
        assert result.model == ("cf-actual-version" if cloudflare_ok else "google-actual-version")
        assert result.usage == {"prompt_tokens": 2, "completion_tokens": 3}
        assert result.data == {"ok": True}
        assert all(stage._client.is_closed for stage in [
            *client._groq_clients, client._cloudflare, client._fallback,
        ])
    asyncio.run(go())


@pytest.mark.parametrize("failure", ["timeout", "429", "401", "403", "500", "malformed", "truncated"])
def test_failures_fall_through_once_and_shared_cooldown_skips_later_calls(failure, caplog):
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=[]))
        seen = []
        secret = f"{TOKEN} https://api.cloudflare.com/{ACCOUNT} echoed-body"

        def handler(request):
            seen.append(request.url.host)
            if request.url.host != "api.cloudflare.com":
                return _success()
            if failure == "timeout":
                raise httpx.ReadTimeout(secret, request=request)
            if failure == "malformed":
                return httpx.Response(200, text=secret)
            if failure == "truncated":
                # Even a salvageable, valid JSON object must not count as success.
                return _success(choices=[{"message": {"content": '{"ok": true}'}, "finish_reason": "length"}])
            return httpx.Response(int(failure), text=secret, headers={"retry-after": "600"})

        await _mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            assert client._cloudflare._cooldown_until[0] > time.monotonic()
            if failure in ("401", "403"):
                client._cloudflare._cooldown_until[0] = 0
            second = await client.complete_full("s", "u")
        assert seen == ["api.cloudflare.com", "generativelanguage.googleapis.com",
                        "generativelanguage.googleapis.com"]
        assert first.provider == second.provider == "google"
        assert first.attempts == 2 and second.attempts == 1
        assert all(value not in caplog.text for value in [TOKEN, ACCOUNT, "https://", "echoed-body"])
    asyncio.run(go())


@pytest.mark.parametrize("body", [None, [], {"choices": []}, {"choices": [None]},
                                  {"choices": [{"message": {"content": []}}]},
                                  {"choices": [{"message": {"content": "[]"}}]},
                                  {"choices": [{"message": {"content": "{}"}}], "usage": "bad"}])
def test_malformed_envelopes_raise_only_sanitized_llm_error(body, caplog):
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=[], llm_api_keys=[]))
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200, content=json.dumps(body))

        await _mock(client, handler)
        async with client:
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
            with pytest.raises(LLMError) as cooled:
                await client.complete_full("s", "u")
        assert error.value.attempts == len(seen) == 1
        assert cooled.value.attempts == 0
        assert all(value not in str(error.value) + caplog.text for value in [TOKEN, ACCOUNT, "https://"])
    asyncio.run(go())


def test_cloudflare_only_public_apis_and_secret_free_model_identity():
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=[], llm_api_keys=[]))
        await _mock(client, lambda request: _success())
        async with client:
            result = await client.complete_full("s", "u")
            assert await client.complete_json("s", "u") == {"ok": True}
            assert await client.complete("s", "u") == ({"ok": True}, "")
        assert result.provider == "cloudflare" and result.model == MODEL and result.attempts == 1
        assert client.routing_identity["cloudflare"] == {"provider": "cloudflare", "model": MODEL}
        assert all(value not in json.dumps(client.routing_identity) for value in [TOKEN, ACCOUNT, "https://"])
        assert client._cloudflare._client.is_closed
    asyncio.run(go())


@pytest.mark.parametrize("hint, expected_cooldown", [
    ("0", 0), ("60", 60), ("1.5", 1.5),
    ("nan", _RATE_LIMIT_BACKOFF_SECONDS), ("NaN", _RATE_LIMIT_BACKOFF_SECONDS),
    ("inf", _RATE_LIMIT_BACKOFF_SECONDS), ("-inf", _RATE_LIMIT_BACKOFF_SECONDS),
    ("-1", _RATE_LIMIT_BACKOFF_SECONDS), ("garbage", _RATE_LIMIT_BACKOFF_SECONDS),
    (None, _RATE_LIMIT_BACKOFF_SECONDS),
])
def test_cloudflare_rate_limit_uses_safe_cooldown_and_never_retries_within_call(hint, expected_cooldown):
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=[], llm_api_keys=[]))
        seen = []

        def handler(request):
            seen.append(request)
            if len(seen) > 1:
                return _success()
            return httpx.Response(429, headers={"retry-after": hint} if hint is not None else {})

        await _mock(client, handler)
        async with client:
            before = time.monotonic()
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
            after = time.monotonic()
            assert len(seen) == error.value.attempts == 1
            assert before + expected_cooldown <= client._cloudflare._cooldown_until[0] <= after + expected_cooldown
            if expected_cooldown > 0:
                with pytest.raises(LLMError) as cooled:
                    await client.complete_full("s", "u")
                assert cooled.value.attempts == 0 and len(seen) == 1
            client._cloudflare._cooldown_until[0] = 0
            recovered = await client.complete_full("s", "u")
            assert recovered.provider == "cloudflare" and recovered.attempts == 1
            assert len(seen) == 2
    asyncio.run(go())


def test_groq_cooling_does_not_sleep_with_cloudflare_as_only_fallback():
    async def go():
        client = build_research_llm_client(_settings(llm_api_keys=[]))
        for stage in client._groq_clients:
            stage._cooldown_until = [time.monotonic() + 5] * len(stage._keys)
            stage._cooldown = _no_wait

        def handler(request):
            assert request.url.host == "api.cloudflare.com"
            return _success()

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
        assert result.provider == "cloudflare" and result.attempts == 1
    asyncio.run(go())


def test_google_error_attempts_accumulate_after_cloudflare_failure(caplog):
    async def go():
        client = build_research_llm_client(_settings())
        seen = []

        def handler(request):
            seen.append(request.url.host)
            return httpx.Response(500, text=f"{TOKEN} {ACCOUNT} secret-body")

        async def google_failure(*args, **kwargs):
            raise LLMError(f"Google failed {TOKEN} {ACCOUNT} secret-body", attempts=3)

        await _mock(client, handler)
        client._fallback.complete_full = google_failure
        async with client:
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
        assert error.value.attempts == 4 + 1 + 3
        assert seen == ["api.groq.com"] * 4 + ["api.cloudflare.com"]
        assert "cloudflare_unavailable" in str(error.value) and "google_unavailable" in str(error.value)
        assert "Google failed" not in str(error.value)
        assert all(value not in str(error.value) + caplog.text for value in [TOKEN, ACCOUNT, "secret-body"])
    asyncio.run(go())


def test_cloudflare_shared_cooldown_applies_to_concurrent_waiters():
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=[]))
        seen = []
        entered = asyncio.Event()
        release = asyncio.Event()

        async def handler(request):
            seen.append(request.url.host)
            if request.url.host == "api.cloudflare.com":
                entered.set()
                await release.wait()
                return httpx.Response(429, headers={"retry-after": "60"})
            return _success()

        await _mock(client, handler)
        async with client:
            first = asyncio.create_task(client.complete_full("s", "u"))
            await entered.wait()
            second = asyncio.create_task(client.complete_full("s", "u"))
            release.set()
            results = await asyncio.gather(first, second)
        assert seen.count("api.cloudflare.com") == 1
        assert [result.attempts for result in results] == [2, 1]
    asyncio.run(go())


def test_close_failure_still_closes_cloudflare_and_google():
    async def go():
        client = build_research_llm_client(_settings(groq_fallback_models=[]))
        await _mock(client, lambda request: _success())

        async def close_primary():
            await client._primary._client.aclose()
            raise RuntimeError("close failed")

        client._primary.aclose = close_primary
        with pytest.raises(RuntimeError, match="close failed"):
            await client.aclose()
        assert client._cloudflare._client.is_closed and client._fallback._client.is_closed
    asyncio.run(go())


def test_httpx_info_logging_does_not_expose_account_url(caplog):
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=[], llm_api_keys=[]))
        await _mock(client, lambda request: httpx.Response(401, text=f"{TOKEN} {ACCOUNT}"))
        async with client:
            with caplog.at_level(logging.INFO):
                with pytest.raises(LLMError) as error:
                    await client.complete_full("s", "u")
        assert all(value not in str(error.value) + caplog.text for value in [TOKEN, ACCOUNT, "https://"])
        assert "category=quarantined" in caplog.text
    asyncio.run(go())


def test_cloudflare_deadline_includes_lock_wait_and_http_read(caplog):
    async def go():
        client = CloudflareLLMClient(_settings(cloudflare_timeout_seconds=0.2))
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        class DelayedBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                entered.set()
                try:
                    yield b'{"choices":'
                    await asyncio.sleep(10)
                finally:
                    cancelled.set()

        def handler(request):
            return httpx.Response(200, stream=DelayedBody())

        await client._client.aclose()
        client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async with client:
            await client._request_lock.acquire()
            started = time.monotonic()
            task = asyncio.create_task(client.complete_full("private-system", "private-user"))
            await asyncio.sleep(0.12)
            client._request_lock.release()
            await entered.wait()
            with pytest.raises(LLMError) as error:
                await asyncio.wait_for(task, timeout=0.5)
            assert error.value.attempts == 1
            # A fresh HTTP timeout after acquiring the lock would take >=0.32s.
            assert time.monotonic() - started < 0.28
            assert cancelled.is_set() and not client._request_lock.locked()
            assert client._cooldown_until[0] > time.monotonic()
            with pytest.raises(LLMError) as cooled:
                await client.complete_full("s", "u")
            assert cooled.value.attempts == 0
        assert "category=timeout" in caplog.text
        assert "private-system" not in caplog.text and "private-user" not in caplog.text
    asyncio.run(go())


@pytest.mark.parametrize("cancel", [False, True])
def test_cloudflare_queue_timeout_and_cancellation_leave_owner_lock_intact(cancel, caplog):
    async def go():
        client = CloudflareLLMClient(_settings(cloudflare_timeout_seconds=0.03))
        seen = []

        def handler(request):
            seen.append(request)
            return _success()

        await client._client.aclose()
        client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async with client:
            await client._request_lock.acquire()
            try:
                task = asyncio.create_task(client.complete_full("s", "u"))
                await asyncio.sleep(0)
                if cancel:
                    task.cancel()
                    with pytest.raises(asyncio.CancelledError) as error:
                        await task
                    assert error.value.attempts == 0
                else:
                    with pytest.raises(LLMError) as error:
                        await asyncio.wait_for(task, timeout=0.5)
                    assert error.value.attempts == 0
                assert client._request_lock.locked()
                assert client._cooldown_until[0] == 0
                assert seen == []
            finally:
                client._request_lock.release()
            result = await client.complete_full("s", "u")
            assert result.attempts == 1 and len(seen) == 1
        assert f"category={'queue_cancelled' if cancel else 'queue_timeout'}" in caplog.text
    asyncio.run(go())


def test_cloudflare_cancelled_http_sets_cooldown_before_waiter_dispatch(caplog):
    async def go():
        client = CloudflareLLMClient(_settings())
        entered = asyncio.Event()
        seen = []
        cancelled = asyncio.Event()

        async def handler(request):
            seen.append(request)
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        await client._client.aclose()
        client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async with client:
            with caplog.at_level(logging.INFO):
                first = asyncio.create_task(client.complete_full("s", "u"))
                await entered.wait()
                waiter = asyncio.create_task(client.complete_full("s", "u"))
                await asyncio.sleep(0)
                first.cancel()
                with pytest.raises(asyncio.CancelledError) as cancelled_error:
                    await first
                assert cancelled_error.value.attempts == 1
                with pytest.raises(LLMError) as error:
                    await waiter
                assert error.value.attempts == 0
                assert cancelled.is_set() and not client._request_lock.locked()
                assert len(seen) == 1 and client._cooldown_until[0] > time.monotonic()
        assert "event=success" not in caplog.text
        assert "category=cancelled attempts=1" in caplog.text
    asyncio.run(go())


@pytest.mark.parametrize("cloudflare_cap, research_cap, expected", [(8192, 2048, 2048), (1024, 2048, 1024)])
def test_cloudflare_output_cap_and_sanitized_success_diagnostics(cloudflare_cap, research_cap, expected, caplog):
    async def go():
        client = CloudflareLLMClient(_settings(
            cloudflare_max_tokens=cloudflare_cap, research_max_output_tokens=research_cap,
        ))
        secret = f"{TOKEN} {ACCOUNT} https://secret.invalid private-prompt"

        def handler(request):
            body = json.loads(request.content)
            assert body["max_tokens"] == expected
            assert body["response_format"] == {"type": "json_object"}
            return _success(model=secret)

        await client._client.aclose()
        client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async with client:
            with caplog.at_level(logging.INFO):
                result = await client.complete_full(secret, secret, label=secret)
        assert result.data == {"ok": True}
        assert f"provider=cloudflare model={MODEL} event=start" in caplog.text
        assert "event=success finish_reason=stop category=success attempts=1" in caplog.text
        assert all(value not in caplog.text for value in [TOKEN, ACCOUNT, "https://", "private-prompt"])
    asyncio.run(go())


@pytest.mark.parametrize("choice, category, finish_reason", [
    ({"message": {"content": "{"}, "finish_reason": "stop"}, "malformed", "stop"),
    ({"message": {}, "finish_reason": "stop"}, "missing_content", "stop"),
    ({"message": {"content": "   "}}, "missing_content", "unknown"),
    ({"message": {"content": "{}"}, "finish_reason": "length"}, "truncation", "length"),
    ({"message": {"content": None}, "finish_reason": f"{TOKEN} {ACCOUNT}"}, "missing_content", "unknown"),
])
def test_cloudflare_response_failure_categories_are_distinct_and_safe(choice, category, finish_reason, caplog):
    async def go():
        client = CloudflareLLMClient(_settings())
        await client._client.aclose()
        client._client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: _success(choices=[choice]),
        ))
        async with client:
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
        assert error.value.attempts == 1
        assert str(error.value) == f"Cloudflare failed: {category}"
        assert f"finish_reason={finish_reason} category={category}" in caplog.text
        assert TOKEN not in caplog.text and ACCOUNT not in caplog.text
    asyncio.run(go())


def test_cloudflare_total_timeout_falls_through_once_to_google(caplog):
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=[], cloudflare_timeout_seconds=0.03))
        seen = []

        async def handler(request):
            seen.append(request.url.host)
            if request.url.host == "api.cloudflare.com":
                await asyncio.sleep(10)
            return _success()

        await _mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            second = await client.complete_full("s", "u")
        assert first.provider == second.provider == "google"
        assert first.attempts == 2 and second.attempts == 1
        assert seen == ["api.cloudflare.com", "generativelanguage.googleapis.com", "generativelanguage.googleapis.com"]
        assert "category=timeout attempts=1" in caplog.text
    asyncio.run(go())


@pytest.mark.parametrize("queued", [False, True])
def test_router_deadline_counts_cloudflare_cancellation_attempts(queued, caplog):
    async def go():
        client = build_research_llm_client(_settings(
            groq_api_keys=[], cloudflare_timeout_seconds=0.5,
            research_llm_deadline_seconds=0.03,
        ))
        seen = []
        cancelled = asyncio.Event()

        async def handler(request):
            seen.append(request.url.host)
            assert request.url.host == "api.cloudflare.com"
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        await _mock(client, handler)
        async with client:
            if queued:
                await client._cloudflare._request_lock.acquire()
            try:
                with caplog.at_level(logging.INFO):
                    with pytest.raises(LLMError, match="overall deadline exceeded") as error:
                        await asyncio.wait_for(client.complete_full("private-s", "private-u"), timeout=0.5)
                assert error.value.attempts == (0 if queued else 1)
                assert seen == ([] if queued else ["api.cloudflare.com"])
                assert client._cloudflare._request_lock.locked() is queued
                assert cancelled.is_set() is not queued
                if queued:
                    assert client._cloudflare._cooldown_until[0] == 0
                else:
                    assert client._cloudflare._cooldown_until[0] > time.monotonic()
            finally:
                if queued:
                    client._cloudflare._request_lock.release()
        assert "event=success" not in caplog.text
        category = "queue_cancelled" if queued else "cancelled"
        assert f"category={category} attempts={error.value.attempts}" in caplog.text
        assert all(value not in caplog.text for value in [TOKEN, ACCOUNT, "https://", "private-s", "private-u"])
    asyncio.run(go())
