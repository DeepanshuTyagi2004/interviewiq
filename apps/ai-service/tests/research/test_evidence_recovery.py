"""Bounded source/text retries through the real gateway with synthetic providers only."""
import asyncio
import json

import pytest

from app.llm.client import LLMError
from app.prompts.research import company_profile, company_roles
from app.research.budget import BudgetExhausted
from app.research.memory_store import InMemoryResearchStore
from app.research.nodes.evidence import ResearchOutcome, research, unverified_entry, cap_unverified
from app.research.nodes.profile import profile
from app.research.nodes.compensation import compensation
from tests.research.fakes import FakeExa, FakeLLM, result
from tests.research.helpers import wired_deps

URL = "https://example.com/meesho"
ROLE = "Software Engineer"
TEXT = f"Meesho\n{ROLE}\nLocation: Bangalore, India\nBuild reliable payment systems."
BAD = {"field": "jd", "value": "Build good fintech", "quote": "Work on financial systems", "role_title": ROLE}
GOOD = {"field": "jd", "value": "Build reliable payment systems.", "quote": "Build reliable payment systems.",
        "geo": "IN", "geo_quote": "Location: Bangalore, India", "role_title": ROLE}


def test_one_source_retry_uses_stored_text_and_combines_outcomes(tmp_path):
    async def go():
        source = result(URL, title="Meesho profile", content="HQ: Bengaluru")
        llm = FakeLLM(lambda *_: LLMError("provider down"))
        exa = FakeExa(lambda _: [source])
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=llm)
        try:
            first = await research(state, deps, company_profile, kind="profile", queries=(("Meesho", None),))
            assert first.successful_urls == set() and set(first.retryable_sources) == {URL}
            searches = len(exa.calls)
            retried = await research(state, deps, company_profile, kind="profile", queries=(),
                                     retry_sources=first.retryable_sources)
            assert len(exa.calls) == searches and len(llm.calls) == 2
            assert not retried.retryable_sources and not retried.successful_urls
            combined = first + retried
            assert len(combined.failures) == 2 and not combined.retryable_sources
            assert combined.sources[URL]["_source_retry"]
            ignored = await research(state, deps, company_profile, kind="profile", queries=(),
                                     retry_sources=combined.sources)
            assert ignored.extracted == 0 and len(llm.calls) == 2
        finally:
            await tracer.close()
    asyncio.run(go())


def test_recovered_source_is_successful_and_initial_failure_retained(tmp_path):
    async def go():
        calls = 0
        def answer(*_):
            nonlocal calls
            calls += 1
            return LLMError("provider down") if calls == 1 else {"claims": []}
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho profile", content="Meesho profile")]), llm=FakeLLM(answer))
        try:
            first = await research(state, deps, company_profile, kind="profile", queries=(("Meesho", None),))
            second = await research(state, deps, company_profile, kind="profile", queries=(), retry_sources=first.retryable_sources)
            total = first.merge(second)
            assert total.successful_urls == {URL} and not total.retryable_sources
            assert len(total.failures) == 1
        finally:
            await tracer.close()
    asyncio.run(go())


@pytest.mark.parametrize("reply,kept", [({"claims": [GOOD]}, 1), ({"claims": [BAD]}, 0), ({"oops": []}, 0)])
def test_text_repair_is_one_bounded_validated_call_with_existing_source(tmp_path, reply, kept):
    async def go():
        def answer(system, user, label):
            request = json.loads(user)
            if "rejected" in request:
                assert request["source"]["text"] == TEXT
                assert request["rejected"][0]["reason"] == "quote_not_verbatim"
                assert len(user) <= deps.settings.research_chunk_chars
                return reply
            return {"claims": [BAD]}
        llm = FakeLLM(answer)
        exa = FakeExa(lambda _: [result(URL, title="Meesho role", content=TEXT)])
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=llm)
        try:
            out = await research(state, deps, company_roles, kind="roles", queries=(("Meesho role", None),))
            assert len(llm.calls) == 2 and len(exa.calls) == 1
            assert len(out.claims) == kept and out.stats["text_repair_attempted"] == 1
            assert out.stats["dropped:quote_not_verbatim"] >= 1
            if "oops" in reply:
                assert out.failures[0]["kind"] == "repair"
        finally:
            await tracer.close()
    asyncio.run(go())


def test_repair_may_not_return_unrequested_fields_or_roles(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, l: {"claims": [{**GOOD, "role_title": "Other"}, {**GOOD, "field": "title"}]}
                      if "rejected" in json.loads(u) else {"claims": [BAD]})
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho", content=TEXT)]), llm=llm)
        try:
            out = await research(state, deps, company_roles, kind="roles", queries=(("Meesho", None),))
            assert out.claims == [] and len(llm.calls) == 2
        finally:
            await tracer.close()
    asyncio.run(go())


def test_repair_respects_budget(tmp_path):
    async def go():
        llm = FakeLLM(lambda *_: {"claims": [BAD]})
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho", content=TEXT)]), llm=llm, llm_cap=1)
        try:
            with pytest.raises(BudgetExhausted):
                await research(state, deps, company_roles, kind="roles", queries=(("Meesho", None),))
            assert len(llm.calls) == 1
        finally:
            await tracer.close()
    asyncio.run(go())


@pytest.mark.parametrize("error", [LLMError("HTTP 401"), RuntimeError("missing fixture"), asyncio.CancelledError()])
def test_fatal_extract_failures_propagate(tmp_path, error):
    async def go():
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho", content=TEXT)]))
        async def fail(**kwargs):
            raise error
        deps.io.extract_claims = fail
        try:
            with pytest.raises(type(error)):
                await research(state, deps, company_roles, kind="roles", queries=(("Meesho", None),))
        finally:
            await tracer.close()
    asyncio.run(go())


def test_outcome_default_collections_are_independent():
    one, two = ResearchOutcome(), ResearchOutcome()
    one.successful_urls.add(URL)
    one.retryable_sources[URL] = {}
    assert not two.successful_urls and not two.retryable_sources


def test_unverified_keeps_full_internal_claim_but_public_output_hides_it():
    claim = {**GOOD, "quote": "x" * 800, "url": URL, "unit": "INR_LPA", "basis": "total_ctc"}
    entry = unverified_entry(claim, "geo_unconfirmed")
    assert entry["_claim"] == claim and len(entry["_claim"]["quote"]) == 800
    assert len(entry["quote"]) == 500
    entry["_context"] = {"private": True}
    public = cap_unverified([entry], 1)[0]
    assert not any(k.startswith("_") for k in public)
    assert len(public["quote"]) == 500
    assert entry["_claim"] == claim  # Capping must not mutate evidence used by corroboration.


@pytest.mark.parametrize("node", [profile, compensation])
def test_optional_nodes_retry_only_failed_sources_without_searching_again(tmp_path, node):
    async def go():
        counts = {}
        def answer(system, user, label):
            url = json.loads(user)["source"]["url"]
            counts[url] = counts.get(url, 0) + 1
            if url == URL and counts[url] == 1:
                return LLMError("provider down")
            return {"claims": []}
        exa = FakeExa(lambda _: [result(URL, title="Meesho", content=TEXT),
                                 result(URL + "/ok", title="Meesho", content=TEXT)])
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=FakeLLM(answer))
        try:
            output = await node(state, deps)
            assert counts == {URL: 2, URL + "/ok": 1}
            assert len(exa.calls) == (1 if node is profile else 2)
            assert any("could not be extracted" in note for note in output["notes"])
        finally:
            await tracer.close()
    asyncio.run(go())


@pytest.mark.parametrize("node", [profile, compensation])
def test_optional_node_first_source_in_followup_still_reports_total_failure(tmp_path, node):
    async def go():
        searches = 0
        def search(_):
            nonlocal searches
            searches += 1
            return [] if searches <= (1 if node is profile else 2) else [result(URL, title="Meesho", content=TEXT)]
        llm = FakeLLM(lambda *_: LLMError("provider down"))
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=FakeExa(search), llm=llm)
        deps.settings.research_followup_max_queries = 1
        try:
            with pytest.raises(LLMError) as caught:
                await node(state, deps)
            assert len(llm.calls) == 2 and searches == (2 if node is profile else 3)
            assert len(caught.value.research_outcome.failures) == 2
        finally:
            await tracer.close()
    asyncio.run(go())


def test_late_source_claims_ground_with_absolute_offsets_and_keep_role_identity(tmp_path):
    from app.research.nodes.roles import _Roles

    async def go():
        text = "Page introduction.\n" * 680 + TEXT
        assert text.index(TEXT) > 12000
        def answer(system, user, label):
            request = json.loads(user)
            window = request["source"]["text"]
            quote = GOOD["quote"]
            if quote not in window:
                return {"claims": []}
            start = window.index(quote)
            return {"claims": [{**GOOD, "value_span": {"start": start, "end": start + len(quote)},
                                "quote_span": {"start": start, "end": start + len(quote)}},
                               {"field": "title", "value": ROLE, "quote": ROLE, "role_title": ROLE,
                                "geo": "IN", "geo_quote": "Location: Bangalore, India"}]}
        llm = FakeLLM(answer)
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho jobs", content=text)]), llm=llm)
        try:
            out = await research(state, deps, company_roles, kind="roles", queries=(("Meesho", None),))
            assert out.successful_urls == {URL} and not out.failures
            jd = next(c for c in out.claims if c["field"] == "jd")
            assert jd["quote"] == jd["value"] == GOOD["quote"]
            assert len(llm.calls) == 4
            assert _Roles(out.claims, out.sources).assign(jd)[1] is None
        finally:
            await tracer.close()
    asyncio.run(go())


def test_partial_windows_are_not_complete_and_retry_merges_without_duplicate_evidence(tmp_path):
    async def go():
        text = "Headquarters: Bengaluru.\n" + "Company background. " * 300
        counts = {}
        claim = {"field": "hq", "value": "Bengaluru", "quote": "Headquarters: Bengaluru."}
        def answer(system, user, label):
            window = json.loads(user)["source_window"]["index"]
            counts[window] = counts.get(window, 0) + 1
            if window == 1 and counts[window] == 1:
                return LLMError("provider unavailable")
            return {"claims": [claim] if window == 0 else []}
        exa = FakeExa(lambda _: [result(URL, title="Meesho profile", content=text)])
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=FakeLLM(answer))
        try:
            first = await research(state, deps, company_profile, kind="profile", queries=(("Meesho", None),))
            assert not first.successful_urls and first.partial_urls == {URL}
            assert set(first.retryable_sources) == {URL}
            assert first.stats["extract_partial"] == first.stats["extract_chunk_failed"] == 1
            assert first.failures[0]["kind"] == "extract_chunk" and first.failures[0]["target"] == URL
            assert "coverage incomplete" in first.notes("profile")[0]
            second = await research(state, deps, company_profile, kind="profile", queries=(),
                                    retry_sources=first.retryable_sources)
            total = first + second
            assert len(total.claims) == 1 and len(exa.calls) == 1 and counts == {0: 2, 1: 2}
            assert total.successful_urls == {URL} and not total.partial_urls and not total.retryable_sources
            assert len(total.failures) == 1
            assert "coverage incomplete" not in total.notes("profile")[0]
        finally:
            await tracer.close()
    asyncio.run(go())


def test_partial_retry_is_consumed_once_and_not_misreported_as_total_outage(tmp_path):
    async def go():
        def answer(system, user, label):
            return (LLMError("unavailable") if json.loads(user)["source_window"]["index"] else {"claims": []})
        llm = FakeLLM(answer)
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho profile", content="x" * 6000)]), llm=llm)
        try:
            first = await research(state, deps, company_profile, kind="profile", queries=(("Meesho", None),))
            second = await research(state, deps, company_profile, kind="profile", queries=(),
                                    retry_sources=first.retryable_sources)
            total = first + second
            assert not total.successful_urls and total.partial_urls == {URL} and not total.retryable_sources
            assert total.stats["extract_chunk_failed"] == 2 and len(total.failures) == 2
            # A separate failed source must not hide completed (valid-empty) windows.
            total._last_extract_error = LLMError("other source unavailable")
            total.raise_if_all_failed()
            again = await research(state, deps, company_profile, kind="profile", queries=(), retry_sources=total.sources)
            assert again.extracted == 0 and len(llm.calls) == 4
        finally:
            await tracer.close()
    asyncio.run(go())


def test_max_chunk_coverage_is_a_visible_source_failure_without_provider_call(tmp_path):
    async def go():
        llm = FakeLLM(lambda *_: pytest.fail("oversized source must not reach provider"))
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho profile", content="x" * 18000)]), llm=llm)
        try:
            out = await research(state, deps, company_profile, kind="profile", queries=(("Meesho", None),))
            assert out.claims == [] and not out.successful_urls and not out.partial_urls
            assert out.stats["extract_failed"] == 1
            assert "coverage limit" in out.failures[0]["error"] and URL in out.retryable_sources
            assert "could not be extracted" in out.notes("profile")[0]
            with pytest.raises(LLMError, match="coverage limit"):
                out.raise_if_all_failed()
        finally:
            await tracer.close()
    asyncio.run(go())


@pytest.mark.parametrize("long_source", [True, False])
def test_text_repair_skips_oversized_source_or_rejected_payload_with_explicit_note(tmp_path, long_source):
    async def go():
        text = TEXT + " Details." * 600 if long_source else TEXT
        bad = BAD if long_source else {**BAD, "quote": "x" * 2800, "value": "y" * 2800}
        def answer(system, user, label):
            assert "rejected" not in json.loads(user)
            return {"claims": [bad]}
        llm = FakeLLM(answer)
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path,
            exa=FakeExa(lambda _: [result(URL, title="Meesho jobs", content=text)]), llm=llm)
        try:
            out = await research(state, deps, company_roles, kind="roles", queries=(("Meesho", None),))
            assert out.stats["text_repair_skipped"] == 1 and out.stats["text_repair_attempted"] == 0
            assert out.failures[0]["kind"] == "repair_skipped"
            assert out.failures[0]["reason"] == ("source_exceeds_chunk_limit" if long_source else "repair_payload_exceeds_chunk_limit")
            assert "payload exceeds configured chunk limit" in out.notes("roles")[0]
            assert all("text-repair" not in call for call in llm.calls)
        finally:
            await tracer.close()
    asyncio.run(go())
