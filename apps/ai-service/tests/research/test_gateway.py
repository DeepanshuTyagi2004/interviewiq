import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.research.budget import Budget, BudgetExhausted
from app.research.fixtures import FixtureMissing, FixtureStore
from app.research.gateway import ResearchIO, _routing_identity
from app.research.memory_store import InMemoryResearchStore
from app.research.models import Mode
from app.research.store import EventFilter
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE
from app.research.trace.tracer import Tracer, utcnow
from tests.research.fakes import Exploding, FakeExa, FakeLLM, result


def _settings(**kw) -> Settings:
    return Settings(
        _env_file=None, EXA_API_KEY="test-exa", MONGODB_URL="mongodb://localhost/test",
        INTERNAL_API_KEY="test-internal", LLM_API_KEY="test-google", LLM_MODEL_NAME="test-model",
        LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai",
        GROQ_API_KEY=[], GROQ_MODEL_NAME="openai/gpt-oss-120b", GROQ_FALLBACK_MODELS=[],
        GROQ_BASE_URL="https://api.groq.com/openai/v1",
        CLOUDFLARE_API_TOKEN="", CLOUDFLARE_ACCOUNT_ID="",
    ).model_copy(update={"research_results_per_query": 2, **kw})


async def _io(tmp_path, *, mode=Mode.LIVE, exa=None, llm=None, exa_cap=10, llm_cap=10, store=None, settings=None):
    store = store or InMemoryResearchStore()
    if await store.get_run("run1") is None:
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow(),
                                "budget": {"exa_used": 0, "llm_used": 0, "tokens_in": 0, "tokens_out": 0}})
        await store.insert_items([{"run_id": "run1", "company_id": "c1", "position": 0, "nodes": {}}])
    tracer = Tracer(store, "run1", secrets={}, flush_interval=0.01)
    budget = Budget(store, "run1", exa_cap=exa_cap, llm_cap=llm_cap)
    io = ResearchIO(mode=mode, exa=exa, llm=llm, fixtures=FixtureStore(tmp_path / "fx"), tracer=tracer,
                    budget=budget, store=store, settings=settings or _settings())
    return io, store, tracer


def _bind():
    return CURRENT_COMPANY.set("c1"), CURRENT_NODE.set("resolve")


def test_live_search_truncates_charges_budget_counts_per_node_and_remembers_sources(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com"), result("https://b.com"), result("https://c.com")])
        io, store, tracer = await _io(tmp_path, exa=exa)
        c, n = _bind()
        try:
            results = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        finally:
            CURRENT_NODE.reset(n)
            CURRENT_COMPANY.reset(c)
        await tracer.close()
        assert [r["url"] for r in results] == ["https://a.com", "https://b.com"]
        assert exa.calls == ["Meesho company"]
        run = await store.get_run("run1")
        assert run["budget"]["exa_used"] == 1
        (item,) = await store.list_items("run1")
        assert item["nodes"]["resolve"]["exa_calls"] == 1
        assert store.sources["https://a.com"]["kinds"] == ["resolve"]
        assert store.sources["https://a.com"]["content_hash"].startswith("sha256:")
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert span["kind"] == "exa" and full["output"]["count"] == 2
    asyncio.run(go())


def test_record_then_replay_serves_identical_results_without_calling_exa(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com")])
        io, _, t1 = await _io(tmp_path, mode=Mode.RECORD, exa=exa)
        recorded = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        await t1.close()
        io2, store2, t2 = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        replayed = await io2.search("Meesho company", company_slug="meesho", kind="resolve")
        await t2.close()
        assert replayed == recorded
        assert (await store2.get_run("run1"))["budget"]["exa_used"] == 0
        assert list((tmp_path / "fx" / "meesho").glob("exa-*.json"))
    asyncio.run(go())


def test_replay_miss_fails_loudly_with_how_to_fix(tmp_path):
    async def go():
        io, _, t = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        with pytest.raises(FixtureMissing, match="RESEARCH_MODE=record"):
            await io.search("never recorded", company_slug="meesho", kind="resolve")
        await t.close()
    asyncio.run(go())


def test_extract_cache_reuses_identical_calls_and_emits_cache_hit(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 42})
        io, store, tracer = await _io(tmp_path, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="sys", user="user", company_slug="meesho", label="t")
        first = await io.extract_json(**kwargs)
        second = await io.extract_json(**kwargs)
        await tracer.close()
        assert first == second == {"answer": 42}
        assert llm.calls == ["t"]
        run = await store.get_run("run1")
        assert run["budget"]["llm_used"] == 1
        assert (run["budget"]["tokens_in"], run["budget"]["tokens_out"]) == (100, 20)
        events = await store.list_events("run1", EventFilter(type_prefix="cache.hit"))
        assert len(events) == 1
        llm_spans = [s for s in await store.list_spans("run1") if s["kind"] == "llm"]
        assert [s["attrs"]["cache"] for s in llm_spans] == ["miss", "hit"]
        assert llm_spans[0]["attrs"]["tokens_in"] == 100
    asyncio.run(go())


def test_record_mode_bypasses_the_extract_cache(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 1})
        io, _, tracer = await _io(tmp_path, mode=Mode.RECORD, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="meesho", label="t")
        await io.extract_json(**kwargs)
        await io.extract_json(**kwargs)
        await tracer.close()
        assert llm.calls == ["t", "t"]
    asyncio.run(go())


def test_exhausted_budget_raises_before_any_call(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"a": 1})
        io, _, tracer = await _io(tmp_path, llm=llm, llm_cap=0)
        with pytest.raises(BudgetExhausted) as caught:
            await io.extract_json(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        await tracer.close()
        assert caught.value.kind == "llm" and llm.calls == []
    asyncio.run(go())


def _needs_answer(data: dict) -> None:
    if "answer" not in data:
        raise ValueError("missing answer")


def test_response_failing_validate_is_not_cached(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"bad": 1})
        io, store, tracer = await _io(tmp_path, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t",
                      validate=_needs_answer)
        for _ in range(2):
            with pytest.raises(ValueError, match="missing answer"):
                await io.extract_json(**kwargs)
        await tracer.close()
        assert llm.calls == ["t", "t"]
        llm_spans = [s for s in await store.list_spans("run1") if s["kind"] == "llm"]
        assert [s["status"] for s in llm_spans] == ["error", "error"]
    asyncio.run(go())


def test_cached_value_failing_validate_is_asked_again(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 2})
        io, store, tracer = await _io(tmp_path, llm=llm)
        base = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        await io.extract_json(**base)  # caches {"answer": 2}
        key = next(iter(store.extracts))
        store.extracts[key]["output"] = {"stale": True}
        out = await io.extract_json(**base, validate=_needs_answer)
        again = await io.extract_json(**base, validate=_needs_answer)
        await tracer.close()
        assert out == again == {"answer": 2}
        assert llm.calls == ["t", "t"]
    asyncio.run(go())


class ProviderLLM(FakeLLM):
    def __init__(self, provider, model):
        super().__init__(lambda s, u, label: {"answer": 42})
        self.provider, self.model = provider, model

    async def complete_full(self, *args, **kwargs):
        r = await super().complete_full(*args, **kwargs)
        return SimpleNamespace(data=r.data, thought=r.thought, content=r.content, usage=r.usage,
                               latency_ms=r.latency_ms, key_index=r.key_index, attempts=r.attempts,
                               provider=self.provider, model=self.model)


@pytest.mark.parametrize("provider,model", [
    ("groq", "openai/gpt-oss-120b"), ("groq", "openai/gpt-oss-20b"), ("google", "fallback-model"),
    ("cloudflare", "@cf/openai/gpt-oss-120b"),
])
def test_provider_provenance_survives_record_replay_and_cache(tmp_path, provider, model):
    async def go():
        settings = _settings(groq_api_keys=["dummy-groq-key"], llm_model="fallback-model",
                             groq_fallback_models=["openai/gpt-oss-20b"],
                             cloudflare_api_token="dummy-cloudflare-token", cloudflare_account_id="Account123")
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        io, store, t = await _io(tmp_path, settings=settings, mode=Mode.RECORD, llm=ProviderLLM(provider, model))
        await io.extract_json(**kwargs)
        await t.close()
        (span,) = await store.list_spans("run1")
        assert (span["attrs"]["provider"], span["attrs"]["model"]) == (provider, model)
        # Fresh replay store must read the fixture before a second call can hit the cache.
        replay, replay_store, rt = await _io(tmp_path, settings=settings, mode=Mode.REPLAY, llm=Exploding())
        assert await replay.extract_json(**kwargs) == await replay.extract_json(**kwargs) == {"answer": 42}
        await rt.close()
        spans = await replay_store.list_spans("run1")
        assert [s["attrs"]["cache"] for s in spans] == ["miss", "hit"]
        for s in spans:
            assert (s["attrs"]["provider"], s["attrs"]["model"]) == (provider, model)
            full = await replay_store.get_span(s["span_id"])
            assert (full["output"]["provider"], full["output"]["model"]) == (provider, model)
        assert (await replay_store.get_run("run1"))["budget"]["llm_used"] == 0
    asyncio.run(go())


def test_cache_separates_routes_but_not_keys_or_url_credentials(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        base = _settings(groq_api_keys=["dummy-groq-key"])
        variants = [
            base, base.model_copy(update={"groq_api_keys": ["rotated-groq-key"]}),
            base.model_copy(update={"groq_base_url": "https://user:password@api.groq.com/openai/v1?key=secret#token"}),
            base.model_copy(update={"groq_model": "other-primary"}),
            base.model_copy(update={"llm_model": "other-fallback"}),
            base.model_copy(update={"groq_base_url": "https://other.example.test/v1"}),
            base.model_copy(update={"groq_api_keys": []}),
            base.model_copy(update={"groq_api_keys": [], "llm_model": "other-google"}),
            base.model_copy(update={"groq_fallback_models": ["openai/gpt-oss-20b"]}),
            base.model_copy(update={"groq_fallback_models": ["openai/gpt-oss-20b", "other-groq"]}),
            base.model_copy(update={"groq_fallback_models": ["other-groq", "openai/gpt-oss-20b"]}),
            base.model_copy(update={"groq_api_keys": [], "groq_fallback_models": ["openai/gpt-oss-20b"]}),
        ]
        llm = ProviderLLM("google", "fallback-model")
        for settings in variants:
            io, _, t = await _io(tmp_path, settings=settings, store=store, llm=llm)
            await io.extract_json(**kwargs)
            await t.close()
        assert len(llm.calls) == 9
        assert len(store.extracts) == 9
        for span in await store.list_spans("run1"):
            full = await store.get_span(span["span_id"])
            assert "password" not in str(full["input"])
            assert "secret" not in str(full["input"])
            assert "dummy-groq-key" not in str(full["input"])
    asyncio.run(go())


def test_legacy_google_fixture_request_still_replays(tmp_path):
    async def go():
        settings = _settings(groq_api_keys=[])
        request = {"model": settings.llm_model, "prompt_name": "p", "prompt_version": "v1", "system": "s", "user": "u"}
        FixtureStore(tmp_path / "fx").write("m", "llm", request, {"data": {"answer": 42}})
        io, store, t = await _io(tmp_path, settings=settings, mode=Mode.REPLAY, llm=Exploding())
        assert await io.extract_json(prompt_name="p", prompt_version="v1", system="s", user="u",
                                     company_slug="m", label="t") == {"answer": 42}
        await t.close()
        (span,) = await store.list_spans("run1")
        assert span["attrs"]["model"] == settings.llm_model
        assert span["attrs"]["provider"] == "google"
    asyncio.run(go())


@pytest.mark.parametrize("changed_route", [
    {"llm_model": "changed-fallback"},
    {"groq_fallback_models": []},
    {"groq_fallback_models": ["openai/gpt-oss-20b"]},
    {"groq_fallback_models": ["other-groq", "openai/gpt-oss-20b"]},
])
def test_groq_fixture_is_not_reused_for_a_different_fallback_model(tmp_path, changed_route):
    async def go():
        settings = _settings(groq_api_keys=["dummy-groq-key"],
                             groq_fallback_models=["openai/gpt-oss-20b", "other-groq"])
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        io, _, t = await _io(tmp_path, settings=settings, mode=Mode.RECORD,
                             llm=ProviderLLM("google", settings.llm_model))
        await io.extract_json(**kwargs)
        await t.close()
        changed = settings.model_copy(update=changed_route)
        replay, _, rt = await _io(tmp_path, settings=changed, mode=Mode.REPLAY, llm=Exploding())
        with pytest.raises(FixtureMissing):
            await replay.extract_json(**kwargs)
        await rt.close()
    asyncio.run(go())


def test_empty_groq_fallback_list_preserves_legacy_routing_identity():
    settings = _settings(groq_api_keys=["dummy-groq-key"])
    assert _routing_identity(settings) == {
        "primary": {"provider": "groq", "model": "openai/gpt-oss-120b",
                    "base_url": "https://api.groq.com/openai/v1"},
        "fallback": {"provider": "google", "model": "test-model",
                     "base_url": "https://generativelanguage.googleapis.com/v1beta/openai"},
    }


def test_cloudflare_route_orders_providers_and_excludes_credentials():
    settings = _settings(groq_api_keys=["dummy-groq-key"], groq_fallback_models=["openai/gpt-oss-20b"],
                         cloudflare_api_token="dummy-cloudflare-token", cloudflare_account_id="Account123")
    routing = _routing_identity(settings)
    assert [(entry["provider"], entry["model"]) for entry in routing["chain"]] == [
        ("groq", "openai/gpt-oss-120b"), ("groq", "openai/gpt-oss-20b"),
        ("cloudflare", settings.cloudflare_model), ("google", "test-model"),
    ]
    assert "Account123" not in str(routing) and "dummy-cloudflare-token" not in str(routing)
    assert _routing_identity(settings.model_copy(update={
        "cloudflare_api_token": "rotated-dummy-token", "cloudflare_account_id": "Account456",
    })) == routing
    assert _routing_identity(settings.model_copy(update={"groq_api_keys": []}))["primary"]["provider"] == "cloudflare"


def test_disabled_cloudflare_model_does_not_change_identity():
    settings = _settings(groq_api_keys=["dummy-groq-key"])
    assert _routing_identity(settings) == _routing_identity(settings.model_copy(update={"cloudflare_model": "other"}))


@pytest.mark.parametrize("changed_route", [
    {"cloudflare_model": "@cf/other/model"},
    {"cloudflare_api_token": "", "cloudflare_account_id": ""},
    {"groq_api_keys": ["dummy-groq-key"]},
])
def test_cloudflare_fixture_separates_model_enablement_and_order(tmp_path, changed_route):
    async def go():
        settings = _settings(cloudflare_api_token="dummy-cloudflare-token", cloudflare_account_id="Account123")
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        io, _, t = await _io(tmp_path, settings=settings, mode=Mode.RECORD,
                             llm=ProviderLLM("cloudflare", settings.cloudflare_model))
        await io.extract_json(**kwargs)
        await t.close()
        replay, _, rt = await _io(tmp_path, settings=settings.model_copy(update=changed_route),
                                  mode=Mode.REPLAY, llm=Exploding())
        with pytest.raises(FixtureMissing):
            await replay.extract_json(**kwargs)
        await rt.close()
    asyncio.run(go())


def test_cache_without_provenance_does_not_claim_the_current_primary(tmp_path):
    async def go():
        settings = _settings(groq_api_keys=["dummy-groq-key"])
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        io, store, t = await _io(tmp_path, settings=settings, llm=ProviderLLM("google", "fallback"))
        await io.extract_json(**kwargs)
        entry = next(iter(store.extracts.values()))
        del entry["provider"]
        del entry["model"]
        await io.extract_json(**kwargs)
        await t.close()
        hit = (await store.list_spans("run1"))[-1]
        assert hit["attrs"]["cache"] == "hit"
        assert hit["attrs"]["provider"] == hit["attrs"]["model"] == "unknown"
    asyncio.run(go())


def test_include_domains_reach_exa_and_join_the_request_only_when_given(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://www.ambitionbox.com/x")])
        io, store, tracer = await _io(tmp_path, exa=exa)
        await io.search("Juspay reviews", company_slug="juspay", kind="compensation", include_domains=["ambitionbox.com"])
        await io.search("Juspay reviews", company_slug="juspay", kind="compensation")
        await tracer.close()
        assert exa.includes == [["ambitionbox.com"], []]
        inputs = [(await store.get_span(s["span_id"]))["input"] for s in await store.list_spans("run1") if s["kind"] == "exa"]
        assert inputs[0]["include_domains"] == ["ambitionbox.com"] and "include_domains" not in inputs[1]
    asyncio.run(go())


def test_sources_are_stored_with_their_tier_when_the_company_domain_is_known(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://juspay.io/careers"), result("https://www.linkedin.com/posts/x")])
        io, store, tracer = await _io(tmp_path, exa=exa)
        await io.search("Juspay careers", company_slug="juspay", kind="roles", company_domain="juspay.io")
        await tracer.close()
        assert (await store.get_source("https://juspay.io/careers"))["tier"] == 1
        assert (await store.get_source("https://www.linkedin.com/posts/x"))["source_type"] == "community"
    asyncio.run(go())


def test_llm_calls_are_bounded_run_wide(tmp_path):
    async def go():
        state = {"now": 0, "max": 0}

        async def track(label):
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
            await asyncio.sleep(0.02)
            state["now"] -= 1
        llm = FakeLLM(lambda s, u, label: {"claims": []}, on_call=track)
        io, _, tracer = await _io(tmp_path, llm=llm, settings=_settings(research_llm_concurrency=2))
        await asyncio.gather(*(io.extract_json(prompt_name="p", prompt_version="v", system="s", user=f"u{i}",
                                               company_slug="m", label=f"t{i}") for i in range(6)))
        await tracer.close()
        assert len(llm.calls) == 6 and state["max"] == 2
    asyncio.run(go())


CLAIMS_KW = dict(prompt_name="company_profile", prompt_version="v2-draft", system="s", user="u", company_slug="m", label="t")


def test_extract_claims_repairs_an_invalid_envelope_once(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"claims": [{"field": "hq"}]} if label.endswith("#repair") else {"profile": {}})
        io, store, tracer = await _io(tmp_path, llm=llm)
        claims = await io.extract_claims(**CLAIMS_KW)
        await tracer.close()
        assert claims == [{"field": "hq"}]
        assert llm.calls == ["t", "t#repair"]
        assert [e["output"] for e in store.extracts.values()] == [{"claims": [{"field": "hq"}]}]
    asyncio.run(go())


def test_extract_claims_fails_with_a_validation_error_after_a_failed_repair(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"claims": "none"})
        io, store, tracer = await _io(tmp_path, llm=llm)
        with pytest.raises(ValidationError):
            await io.extract_claims(**CLAIMS_KW)
        await tracer.close()
        assert llm.calls == ["t", "t#repair"] and store.extracts == {}
    asyncio.run(go())


def test_extract_claims_returns_raw_claims_for_per_claim_validation(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"claims": [{"field": "hq", "value": 3}, "junk"]})
        io, _, tracer = await _io(tmp_path, llm=llm)
        assert await io.extract_claims(**CLAIMS_KW) == [{"field": "hq", "value": 3}, "junk"]
        await tracer.close()
    asyncio.run(go())
