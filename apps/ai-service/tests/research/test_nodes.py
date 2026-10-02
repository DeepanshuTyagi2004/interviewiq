import asyncio

import pytest
from pydantic import ValidationError

from app.research.memory_store import InMemoryResearchStore
from app.research.nodes.resolve import resolve
from app.research.nodes.write_draft import write_draft
from app.research.store import EventFilter
from app.research.targets import ResearchTarget
from tests.research.fakes import FakeExa, FakeLLM, resolve_answer, result
from tests.research.helpers import MEESHO, RAZORPAY, wired_deps


def test_resolve_takes_identity_from_evidence_backed_llm_output(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        out = await resolve(state, deps)
        await tracer.close()
        ident = out["identity"]
        assert ident["name"] == {"value": "Meesho", "confidence": "high", "provenance": "evidence",
                                 "source_urls": ["https://meesho.com"], "note": None}
        assert ident["website"]["value"] == "https://meesho.com" and ident["website"]["provenance"] == "evidence"
        assert out["conflicts"] == []
    asyncio.run(go())


def test_admin_website_wins_and_disagreement_is_noted(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Razorpay", "https://razorpay-mirror.com") | {
            "evidence_urls": ["https://razorpay.com"]})
        exa = FakeExa(lambda q: [result("https://razorpay.com")])
        deps, tracer, state = await wired_deps(store, tmp_path, company=RAZORPAY, llm=llm, exa=exa)
        out = await resolve(state, deps)
        await tracer.close()
        site = out["identity"]["website"]
        assert site["value"] == "https://razorpay.com" and site["provenance"] == "admin_override"
        assert site["note"] == "research found https://razorpay-mirror.com"
    asyncio.run(go())


def test_evidence_not_in_results_downgrades_confidence(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Meesho", "https://meesho.com") | {
            "evidence_urls": ["https://invented.example"]})
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm)
        out = await resolve(state, deps)
        await tracer.close()
        assert out["identity"]["name"]["confidence"] == "low"
        assert out["identity"]["name"]["provenance"] == "derived"
        assert out["identity"]["name"]["source_urls"] == []
    asyncio.run(go())


def test_not_a_company_and_duplicates_become_conflicts(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: resolve_answer("Meesho", "https://meesho.com") | {
            "is_company": False, "reasoning": "a shopping term"})
        twin = ResearchTarget(id="c-twin", name="Meesho India", slug="meesho-india")
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm, others=[twin])
        out = await resolve(state, deps)
        await tracer.close()
        types = [c["type"] for c in out["conflicts"]]
        assert types == ["not_a_company", "possible_duplicate"]
        assert out["conflicts"][1]["company_id"] == "c-twin"
    asyncio.run(go())


def test_resolve_rejects_output_without_a_name(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        llm = FakeLLM(lambda s, u, label: {"is_company": True})
        deps, tracer, state = await wired_deps(store, tmp_path, llm=llm)
        with pytest.raises(ValidationError):
            await resolve(state, deps)
        await tracer.close()
        assert store.extracts == {}  # the invalid response was never cached
    asyncio.run(go())


def test_write_draft_creates_then_skips_unchanged_then_versions_changes(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        deps, tracer, state = await wired_deps(store, tmp_path)
        state = {**state, **(await resolve(state, deps))}
        first = await write_draft(state, deps)
        again = await write_draft(state, deps)
        changed = {**state, "identity": {**state["identity"], "aliases": {**state["identity"]["aliases"], "value": ["Fashnear"]}}}
        third = await write_draft(changed, deps)
        await tracer.close()
        assert first["draft"]["status"] == "created" and first["draft"]["version"] == 1
        assert again["draft"] == {"status": "unchanged", "draft_id": first["draft"]["draft_id"], "version": 1}
        assert third["draft"]["status"] == "created" and third["draft"]["version"] == 2
        v1, v2 = sorted(store.drafts, key=lambda d: d["version"])
        assert v1["status"] == "superseded" and v2["status"] == "pending_review"
        assert {c["path"] for c in v1["diff"]} == {"identity.aliases", "identity.name", "identity.website"}
        assert v2["snapshot"] == {"identity": changed["identity"]}
        created = await store.list_events("run1", EventFilter(type_prefix="draft.created"))
        assert len(created) == 2
    asyncio.run(go())
