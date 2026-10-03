"""research() v2: multi-query search, relevance filter, per-source/per-query isolation and
unverified routing (evidence-hardening spec §5.3, §7.3, §10)."""
import asyncio

import pytest

from app.exa.client import ExaConfigError, ExaError
from app.llm.client import LLMError
from app.prompts.research import company_compensation, company_profile
from app.research.memory_store import InMemoryResearchStore
from app.research.nodes.evidence import company_names, render_queries, research
from app.research.store import EventFilter
from tests.research.fakes import FakeExa, FakeLLM, result
from tests.research.helpers import wired_deps

PROFILE = "Meesho is an e-commerce product company. Headquarters: Bengaluru."
CLAIM = {"field": "hq", "value": "Bengaluru", "quote": "Headquarters: Bengaluru.", "geo": "IN", "geo_quote": "",
         "role_title": None, "unit": None}


def page(n, content=PROFILE):
    return result(f"https://s{n}.example/meesho", title=f"Meesho profile {n}", content=content)


def answer(fail_urls=(), error=LLMError("provider down")):
    def respond(system, user, label):
        import json
        url = json.loads(user.split("\n\nYour previous")[0])["source"]["url"]
        return error if url in fail_urls else {"claims": [CLAIM]}
    return respond


async def _run(tmp_path, exa, llm, prompt=company_profile, kind="profile"):
    store = InMemoryResearchStore()
    deps, tracer, state = await wired_deps(store, tmp_path, exa=exa, llm=llm)
    state["identity"] = {"website": {"value": "https://meesho.com"}}
    try:
        return await research(state, deps, prompt, kind=kind, queries=prompt.QUERIES), store
    finally:
        await tracer.close()


def test_queries_render_with_company_domain_only_when_known():
    rendered = render_queries(company_profile.QUERIES, name="Juspay", domain=None)
    assert all(include == [] for _, include in rendered) and len(rendered) == 1
    rendered = render_queries(company_profile.QUERIES, name="Juspay", domain="juspay.io")
    assert rendered[-1] == ("Juspay about us", ["juspay.io"])


def test_company_names_include_identity_and_aliases():
    state = {"company": {"name": "Juspay", "aliases": ["Juspay Technologies"]},
             "identity": {"name": {"value": "JUSPAY"}, "aliases": {"value": ["Juspay Tech"]}}}
    assert company_names(state) == ["Juspay", "JUSPAY", "Juspay Tech", "Juspay Technologies"]


def test_one_failing_source_is_skipped_and_noted(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [page(1), page(2), page(3)])
        out, _ = await _run(tmp_path, exa, FakeLLM(answer({"https://s2.example/meesho"})))
        assert [c["url"] for c in out.claims] == ["https://s1.example/meesho", "https://s3.example/meesho"]
        assert out.notes("profile") == ["profile: 1 of 3 sources could not be extracted (LLMError)"]
    asyncio.run(go())


def test_all_sources_failing_retains_failures_and_stored_retry_sources(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [page(1), page(2)])
        urls = {"https://s1.example/meesho", "https://s2.example/meesho"}
        out, _ = await _run(tmp_path, exa, FakeLLM(answer(urls)))
        assert set(out.retryable_sources) == urls
        assert out.successful_urls == set()
        assert len(out.failures) == 2
    asyncio.run(go())


def test_one_failing_query_is_skipped(tmp_path):
    async def go():
        def search(q):
            if "about us" in q:
                raise ExaError("Exa returned 500")
            return [page(1)]
        out, _ = await _run(tmp_path, FakeExa(search), FakeLLM(answer()))
        assert len(out.claims) == 1
        assert out.notes("profile") == ["profile: 1 search(es) failed (ExaError)"]
    asyncio.run(go())


def test_all_queries_failing_raises(tmp_path):
    async def go():
        with pytest.raises(ExaError):
            await _run(tmp_path, FakeExa(fail=ExaError("Exa returned 500")), FakeLLM(answer()))
    asyncio.run(go())


def test_bad_exa_key_propagates_immediately(tmp_path):
    async def go():
        def search(q):
            if "about us" in q:
                raise ExaConfigError("bad key")
            return [page(1)]
        with pytest.raises(ExaConfigError):
            await _run(tmp_path, FakeExa(search), FakeLLM(answer()))
    asyncio.run(go())


def test_irrelevant_sources_cost_no_llm_call(tmp_path):
    async def go():
        unrelated = result("https://desiqna.in/ltimindtree", title="LTIMindtree Fresher Hiring", content="LTIMindtree " * 50)
        llm = FakeLLM(answer())
        out, _ = await _run(tmp_path, FakeExa(lambda q: [unrelated, page(1)]), llm)
        assert len(llm.calls) == 1 and out.stats["irrelevant_source"] == 1
    asyncio.run(go())


def test_unconfirmed_geography_goes_to_review_not_to_the_draft(tmp_path):
    async def go():
        text = "Meesho reviews: 3.7 Work Life Balance"
        src = result("https://www.teamblind.com/company/meesho", title="Meesho Reviews", content=text)
        claim = {"field": "wlb_rating", "value": 3.7, "quote": "3.7 Work Life Balance", "geo": "unknown",
                 "geo_quote": "", "role_title": None, "unit": None}
        out, _ = await _run(tmp_path, FakeExa(lambda q: [src]), FakeLLM(lambda *_: {"claims": [claim]}),
                            prompt=company_compensation, kind="compensation")
        assert out.claims == []
        (entry,) = out.unverified
        assert entry["_claim"]["geo"] == "unknown"
        assert {k: v for k, v in entry.items() if not k.startswith("_")} == {"field": "wlb_rating", "value": 3.7, "quote": "3.7 Work Life Balance",
                         "url": "https://www.teamblind.com/company/meesho", "source_name": "Meesho Reviews",
                         "date": None, "tier": 2, "reason": "geo_unconfirmed", "role_title": None}
    asyncio.run(go())


def test_claims_outside_the_prompts_fields_are_dropped_and_counted(tmp_path):
    async def go():
        stray = {**CLAIM, "field": "ctc_min_lpa", "value": 20}
        out, store = await _run(tmp_path, FakeExa(lambda q: [page(1)]), FakeLLM(lambda *_: {"claims": [CLAIM, stray, "junk"]}))
        assert len(out.claims) == 1
        assert out.stats["dropped:field_not_allowed"] == 1 and out.stats["dropped:schema_invalid"] == 1
        summaries = [e for e in await store.list_events("run1", EventFilter(type_prefix="log")) if "kept 1" in e["message"]]
        assert summaries and summaries[0]["data"]["stats"]["kept"] == 1
    asyncio.run(go())


def test_one_bad_claim_does_not_void_the_source(tmp_path):
    async def go():
        bad = {**CLAIM, "quote": ""}   # fails the claim schema
        out, _ = await _run(tmp_path, FakeExa(lambda q: [page(1)]), FakeLLM(lambda *_: {"claims": [bad, CLAIM]}))
        assert len(out.claims) == 1
    asyncio.run(go())
