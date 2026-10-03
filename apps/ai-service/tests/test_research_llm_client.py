"""Research routing contract, using synthetic credentials and HTTP MockTransport only."""
import asyncio
import json
import time

import httpx
import pytest

from app.config import Settings
from app.llm.client import LLMError, LLMResult, build_llm_client, build_research_llm_client


def _settings(**updates):
    # model_construct never reads .env or process credentials. Settings parsing has its own tests.
    return Settings.model_construct(
        llm_api_keys=["synthetic-google"], llm_model="gemma-google",
        groq_api_keys=["synthetic-groq-a", "synthetic-groq-b"],
    ).model_copy(update={"groq_fallback_models": [], **updates})


def _success(model=None):
    body = {"choices": [{"message": {"content": '{"ok": true}'}}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2}}
    if model:
        body["model"] = model
    return httpx.Response(200, json=body)


async def _mock(client, handler):
    for provider in (*client._groq_clients, client._fallback):
        if provider is not None:
            timeout = provider._client.timeout
            await provider._client.aclose()
            provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=timeout)


async def _no_wait(*args, **kwargs):
    raise AssertionError("must not sleep before Google fallback")


def test_key_failures_rotate_then_one_format_repair_before_google_with_actual_metadata(caplog):
    async def go():
        keys = [f"synthetic-groq-{i}" for i in range(7)]
        client = build_research_llm_client(_settings(groq_api_keys=keys))
        client._primary._cooldown = _no_wait
        seen = []

        def handler(request):
            key = request.headers["authorization"].removeprefix("Bearer ")
            seen.append(key)
            body = json.loads(request.content)
            if key == "synthetic-google":
                assert body["model"] == "gemma-google"
                return _success("google-actual-version")
            assert body["model"] == "openai/gpt-oss-120b"
            failure = keys.index(key)
            if failure == 0:
                return httpx.Response(429, text=key, headers={"retry-after": "60"})
            if failure == 1:
                return httpx.Response(500, text=key)
            if failure == 2:
                raise httpx.ConnectError(key, request=request)
            if failure == 3:
                raise httpx.ReadTimeout(key, request=request)
            if failure in (4, 5):
                return httpx.Response(401 if failure == 4 else 403, text=key)
            return httpx.Response(200, json={"choices": [{"message": {"content": key}}]})

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("system", "user")
        assert seen == keys + [keys[-1], "synthetic-google"]
        assert result.provider == "google"
        assert result.model == "google-actual-version"
        assert result.attempts == 9 and result.data == {"ok": True}
        assert not any(key in caplog.text for key in keys)
    asyncio.run(go())


def test_primary_success_round_robins_and_all_public_apis_work_without_google():
    async def go():
        client = build_research_llm_client(_settings())
        seen = []

        def handler(request):
            assert request.url.host == "api.groq.com"
            seen.append(request.headers["authorization"])
            assert request.extensions["timeout"]["read"] == 30
            return _success("groq-actual-version")

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("system", "user")
            assert result.provider == "groq" and result.model == "groq-actual-version"
            assert result.attempts == 1
            assert await client.complete_json("system", "user") == {"ok": True}
            assert await client.complete("system", "user") == ({"ok": True}, "")
        assert seen == ["Bearer synthetic-groq-a", "Bearer synthetic-groq-b", "Bearer synthetic-groq-a"]
        assert client._primary._client.is_closed and client._fallback._client.is_closed
    asyncio.run(go())


def test_shared_cooldowns_skip_keys_and_all_cooled_keys_fall_back_without_sleep():
    async def go():
        client = build_research_llm_client(_settings())
        seen = []
        client._primary._cooldown = _no_wait
        client._primary._cooldown_until[0] = time.monotonic() + 600

        def handler(request):
            seen.append(request.headers["authorization"])
            return _success()

        await _mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            client._primary._cooldown_until[1] = time.monotonic() + 600
            second = await client.complete_full("s", "u")
        assert seen == ["Bearer synthetic-groq-b", "Bearer synthetic-google"]
        assert first.provider == "groq" and first.attempts == 1
        assert second.provider == "google" and second.model == "gemma-google" and second.attempts == 1
    asyncio.run(go())


def test_groq_only_waits_once_for_initial_cooldown_then_succeeds():
    async def go():
        client = build_research_llm_client(_settings(llm_api_keys=[], groq_api_keys=["synthetic-only"]))
        client._primary._cooldown_until[0] = time.monotonic() + 5
        waits = []

        async def cooldown(seconds, reason, label):
            waits.append(seconds)
            client._primary._cooldown_until[0] = 0

        client._primary._cooldown = cooldown
        await _mock(client, lambda request: _success())
        async with client:
            result = await client.complete_full("s", "u")
        assert len(waits) == 1 and 0 < waits[0] <= 5
        assert result.attempts == 1 and result.provider == "groq"
    asyncio.run(go())


@pytest.mark.parametrize("cooldown", [5, 600])
def test_groq_only_cooldown_wait_is_bounded_even_if_clock_does_not_advance(cooldown):
    async def go():
        client = build_research_llm_client(_settings(llm_api_keys=[], groq_api_keys=["synthetic-only"]))
        client._primary._cooldown_until[0] = time.monotonic() + cooldown
        waits = []

        async def frozen_wait(*args):
            waits.append(args)

        def never_request(request):
            raise AssertionError("cooled key must not be used")

        client._primary._cooldown = frozen_wait
        await _mock(client, never_request)
        async with client:
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
        assert error.value.attempts == 0
        assert len(waits) == (1 if cooldown == 5 else 0)
    asyncio.run(go())


def test_timeout_rotates_then_falls_back_and_honors_configured_request_timeout():
    async def go():
        client = build_research_llm_client(_settings(groq_timeout_seconds=0.25))
        seen = []

        def handler(request):
            seen.append(request.url.host)
            if request.url.host == "api.groq.com":
                assert request.extensions["timeout"]["read"] == 0.25
                raise httpx.ReadTimeout("synthetic secret echoed", request=request)
            return _success()

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
        assert seen == ["api.groq.com", "api.groq.com", "generativelanguage.googleapis.com"]
        assert result.provider == "google" and result.attempts == 3
    asyncio.run(go())


def test_rate_limit_cooldown_is_shared_by_later_calls():
    async def go():
        client = build_research_llm_client(_settings())
        client._primary._cooldown = _no_wait
        seen = []

        def handler(request):
            key = request.headers["authorization"]
            seen.append(key)
            if key == "Bearer synthetic-groq-a":
                return httpx.Response(429, headers={"retry-after": "60"})
            return _success()

        await _mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            second = await client.complete_full("s", "u")
        assert seen == ["Bearer synthetic-groq-a", "Bearer synthetic-groq-b", "Bearer synthetic-groq-b"]
        assert first.attempts == 2 and second.attempts == 1
    asyncio.run(go())


@pytest.mark.parametrize("fallback_models", [[], ["openai/gpt-oss-20b"]])
def test_success_accumulates_google_retry_attempts_after_primary_attempts(fallback_models):
    async def go():
        client = build_research_llm_client(_settings(
            llm_api_keys=["synthetic-google-a", "synthetic-google-b"],
            groq_fallback_models=fallback_models,
        ))
        for provider in (*client._groq_clients, client._fallback):
            provider._cooldown = _no_wait
        seen = []

        def handler(request):
            key = request.headers["authorization"]
            seen.append(key)
            return _success() if key == "Bearer synthetic-google-b" else httpx.Response(500)

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
        assert seen == ["Bearer synthetic-groq-a", "Bearer synthetic-groq-b"] * (1 + len(fallback_models)) + [
            "Bearer synthetic-google-a", "Bearer synthetic-google-b",
        ]
        assert result.attempts == len(seen) and result.provider == "google" and result.model == "gemma-google"
        assert result.key_index == 1
    asyncio.run(go())


@pytest.mark.parametrize("body", [None, [], {"choices": []},
                                  {"choices": [{"message": {"content": None}}]},
                                  {"choices": [{"message": {"content": "[]"}}]}])
def test_malformed_primary_envelopes_get_one_repair_instead_of_escaping(body):
    async def go():
        client = build_research_llm_client(_settings())
        seen = []

        def handler(request):
            seen.append(request.headers["authorization"])
            if len(seen) == 1:
                return httpx.Response(200, content=json.dumps(body))
            return _success()

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
        assert result.attempts == 2 and result.provider == "groq"
        assert seen == ["Bearer synthetic-groq-a", "Bearer synthetic-groq-a"]
    asyncio.run(go())


@pytest.mark.parametrize("status", [401, 403])
def test_invalid_primary_key_stays_quarantined_across_calls(status, caplog):
    async def go():
        client = build_research_llm_client(_settings(groq_api_keys=["synthetic-bad"]))
        seen = []

        def handler(request):
            seen.append(request.url.host)
            if request.url.host == "api.groq.com":
                return httpx.Response(status, text="synthetic-bad")
            return _success()

        await _mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            client._primary._cooldown_until[0] = 0  # quarantine outlasts a normal cooldown
            second = await client.complete_full("s", "u")
        assert seen.count("api.groq.com") == 1
        assert first.attempts == 2 and second.attempts == 1
        assert "synthetic-bad" not in caplog.text
    asyncio.run(go())


@pytest.mark.parametrize("fallback_models", [[], ["openai/gpt-oss-20b"]])
def test_all_providers_fail_with_bounded_attempts_and_no_raw_error_text(caplog, fallback_models):
    async def go():
        client = build_research_llm_client(_settings(groq_fallback_models=fallback_models))
        seen = []
        for provider in client._groq_clients:
            provider._cooldown = _no_wait

        async def advance_google_cooldown(*args):
            client._fallback._cooldown_until = [0] * len(client._fallback._keys)

        client._fallback._cooldown = advance_google_cooldown

        def handler(request):
            seen.append(request.url.host)
            return httpx.Response(500, text="synthetic-echoed-secret")

        await _mock(client, handler)
        async with client:
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
        groq_attempts = 2 * (1 + len(fallback_models))
        assert seen[:groq_attempts] == ["api.groq.com"] * groq_attempts
        assert seen.count("api.groq.com") == groq_attempts
        assert seen.count("generativelanguage.googleapis.com") == 1
        assert error.value.attempts == len(seen)
        assert "synthetic-echoed-secret" not in str(error.value) + caplog.text
        assert "500" in str(error.value)
    asyncio.run(go())


def test_groq_only_failures_never_retry_same_key_including_duplicates():
    async def go():
        client = build_research_llm_client(_settings(
            llm_api_keys=[], groq_api_keys=["synthetic-a", "synthetic-a", "synthetic-b"],
        ))
        seen = []
        client._primary._cooldown = _no_wait

        def handler(request):
            seen.append(request.headers["authorization"])
            return httpx.Response(429, headers={"retry-after": "0"})

        await _mock(client, handler)
        async with client:
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
        assert seen == ["Bearer synthetic-a", "Bearer synthetic-b"]
        assert error.value.attempts == 2
    asyncio.run(go())


def test_google_only_and_legacy_factory_and_additive_result_contract():
    async def go():
        settings = _settings(groq_api_keys=[])
        client = build_research_llm_client(settings)
        await _mock(client, lambda request: _success())
        async with client:
            result = await client.complete_full("s", "u")
        assert result.provider == "google" and result.model == "gemma-google" and result.attempts == 1
        assert client.routing_identity == {
            "policy": "groq-first-v1", "primary": None,
            "fallback": {"provider": "google", "model": "gemma-google"},
        }
        async with build_llm_client(_settings(), model="resume-model") as legacy:
            assert legacy.routing_identity == {"provider": "google", "model": "resume-model"}
            assert "synthetic" not in json.dumps(legacy.routing_identity)
        old = LLMResult({}, "", "{}", {}, 0, 0, 1)
        assert old.model == old.provider == ""
    asyncio.run(go())


def test_no_configured_provider_fails_without_creating_a_client():
    with pytest.raises(LLMError, match="No research LLM keys configured"):
        build_research_llm_client(_settings(llm_api_keys=[], groq_api_keys=[]))


def test_ordered_models_each_try_three_keys_before_google_without_waiting():
    async def go():
        keys = [f"synthetic-groq-{i}" for i in range(3)]
        models = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
        client = build_research_llm_client(_settings(
            groq_api_keys=keys, groq_fallback_models=models[1:],
        ))
        for provider in client._groq_clients:
            provider._cooldown = _no_wait
        seen = []

        def handler(request):
            model = json.loads(request.content)["model"]
            key = request.headers["authorization"].removeprefix("Bearer ")
            seen.append((model, key))
            if key == "synthetic-google":
                return _success("google-actual-version")
            return httpx.Response(429, headers={"retry-after": "600"})

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
            # All six pairs retain their cooldowns on subsequent calls, without sleeping.
            second = await client.complete_full("s", "u")
        assert seen == [(model, key) for model in models for key in keys] + [
            ("gemma-google", "synthetic-google"), ("gemma-google", "synthetic-google"),
        ]
        assert result.provider == "google" and result.model == "google-actual-version"
        assert result.attempts == 7 and second.attempts == 1
        assert all(provider._client.is_closed for provider in client._groq_clients)
    asyncio.run(go())


@pytest.mark.parametrize("actual_model", [None, "groq-20b-actual-version"])
def test_primary_model_failure_then_secondary_success_preserves_metadata(actual_model):
    async def go():
        client = build_research_llm_client(_settings(groq_fallback_models=["openai/gpt-oss-20b"]))
        seen = []

        def handler(request):
            model = json.loads(request.content)["model"]
            key = request.headers["authorization"]
            seen.append((model, key))
            if model == "openai/gpt-oss-120b":
                return httpx.Response(500)
            assert model == "openai/gpt-oss-20b"
            return _success(actual_model)

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
        assert seen == [
            ("openai/gpt-oss-120b", "Bearer synthetic-groq-a"),
            ("openai/gpt-oss-120b", "Bearer synthetic-groq-b"),
            ("openai/gpt-oss-20b", "Bearer synthetic-groq-a"),
        ]
        assert result.provider == "groq" and result.model == (actual_model or "openai/gpt-oss-20b")
        assert result.attempts == 3 and result.key_index == 0
        assert result.data == {"ok": True} and result.usage["prompt_tokens"] == 4
    asyncio.run(go())


@pytest.mark.parametrize("status", [401, 403])
def test_key_quarantine_is_shared_across_models_and_calls(status):
    async def go():
        client = build_research_llm_client(_settings(groq_fallback_models=["openai/gpt-oss-20b"]))
        seen = []

        def handler(request):
            model = json.loads(request.content)["model"]
            key = request.headers["authorization"]
            seen.append((model, key))
            if key == "Bearer synthetic-groq-a":
                return httpx.Response(status)
            return httpx.Response(500) if model == "openai/gpt-oss-120b" else _success()

        await _mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            for provider in client._groq_clients:
                provider._cooldown_until = [0] * len(provider._keys)
            second = await client.complete_full("s", "u")
        assert seen == [
            ("openai/gpt-oss-120b", "Bearer synthetic-groq-a"),
            ("openai/gpt-oss-120b", "Bearer synthetic-groq-b"),
            ("openai/gpt-oss-20b", "Bearer synthetic-groq-b"),
            ("openai/gpt-oss-120b", "Bearer synthetic-groq-b"),
            ("openai/gpt-oss-20b", "Bearer synthetic-groq-b"),
        ]
        assert first.attempts == 3 and second.attempts == 2
        assert first.provider == second.provider == "groq"
    asyncio.run(go())


@pytest.mark.parametrize("status", [429, 500])
def test_cooldowns_are_per_model_key_pair_and_persist_between_calls(status):
    async def go():
        client = build_research_llm_client(_settings(groq_fallback_models=["openai/gpt-oss-20b"]))
        for provider in client._groq_clients:
            provider._cooldown = _no_wait
        seen = []

        def handler(request):
            model = json.loads(request.content)["model"]
            key = request.headers["authorization"]
            seen.append((model, key))
            if model == "openai/gpt-oss-120b" or key == "Bearer synthetic-groq-a":
                return httpx.Response(status, headers={"retry-after": "600"})
            assert model == "openai/gpt-oss-20b"
            return _success()

        await _mock(client, handler)
        async with client:
            first = await client.complete_full("s", "u")
            second = await client.complete_full("s", "u")
        assert seen == [
            ("openai/gpt-oss-120b", "Bearer synthetic-groq-a"),
            ("openai/gpt-oss-120b", "Bearer synthetic-groq-b"),
            ("openai/gpt-oss-20b", "Bearer synthetic-groq-a"),
            ("openai/gpt-oss-20b", "Bearer synthetic-groq-b"),
            ("openai/gpt-oss-20b", "Bearer synthetic-groq-b"),
        ]
        assert first.attempts == 4 and second.attempts == 1
        assert first.model == second.model == "openai/gpt-oss-20b"
    asyncio.run(go())


def test_duplicate_models_and_keys_are_removed_and_identity_is_ordered_and_secret_free():
    async def go():
        client = build_research_llm_client(_settings(
            groq_api_keys=["synthetic-a", "synthetic-a", " synthetic-b "],
            groq_fallback_models=["openai/gpt-oss-120b", " openai/gpt-oss-20b ",
                                  "", "openai/gpt-oss-20b", "openai/gpt-oss-120b"],
        ))
        seen = []

        def handler(request):
            model = json.loads(request.content)["model"]
            key = request.headers["authorization"]
            seen.append((model, key))
            return _success() if model == "gemma-google" else httpx.Response(429, headers={
                "retry-after": "0",
            })

        await _mock(client, handler)
        async with client:
            result = await client.complete_full("s", "u")
        assert seen == [(model, f"Bearer {key}")
                        for model in ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
                        for key in ["synthetic-a", "synthetic-b"]] + [
                            ("gemma-google", "Bearer synthetic-google"),
                        ]
        assert result.attempts == 5
        identity = client.routing_identity
        assert identity["primary"] == {
            "provider": "groq", "model": "openai/gpt-oss-120b",
            "models": ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
        }
        assert "synthetic" not in json.dumps(identity) and "https://" not in json.dumps(identity)
    asyncio.run(go())


def test_multiple_models_without_google_exhaust_each_pair_once_and_bound_attempts():
    async def go():
        client = build_research_llm_client(_settings(
            llm_api_keys=[], groq_api_keys=[f"synthetic-{i}" for i in range(3)],
            groq_fallback_models=["openai/gpt-oss-20b"],
        ))
        for provider in client._groq_clients:
            provider._cooldown = _no_wait
        seen = []

        def handler(request):
            seen.append((json.loads(request.content)["model"], request.headers["authorization"]))
            return httpx.Response(429, headers={"retry-after": "0"})

        await _mock(client, handler)
        async with client:
            with pytest.raises(LLMError) as error:
                await client.complete_full("s", "u")
        assert len(seen) == len(set(seen)) == error.value.attempts == 6
    asyncio.run(go())
