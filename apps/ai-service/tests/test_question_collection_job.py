"""Tests for the GRANULAR incremental/resume orchestrator (Phase D8).

Each test monkeypatches collectors, stored_states, upsert_question, build_llm_client,
enrich_one, and RUN_STORE.is_cancelled.  No network, no Mongo.
"""
import asyncio
import pytest
import app.jobs.question_collection as qc
from app.questions.models import QuestionRecord
from app.models.brief import RoundType
from app.questions.hashing import compute_source_hash


def _settings():
    from app.config import Settings
    import os
    os.environ.setdefault("EXA_API_KEY", "x")
    os.environ.setdefault("LLM_API_KEY", "x")
    os.environ.setdefault("LLM_MODEL_NAME", "m")
    os.environ.setdefault("MONGODB_URL", "mongodb://x")
    os.environ.setdefault("INTERNAL_API_KEY", "x")
    return Settings()


def _dsa(slug="two-sum"):
    return QuestionRecord(slug=slug, round_type=RoundType.DSA, title=slug.title(),
                          url=f"https://leetcode.com/problems/{slug}/")


def _sd(slug="design-url-shortener"):
    return QuestionRecord(slug=f"sdp/{slug}", round_type=RoundType.SYSTEM_DESIGN,
                          title=slug.title(), url="https://github.com/example")


class _FakeLLM:
    async def aclose(self): pass


def _setup(monkeypatch, *, dsa_records=None, sd_records=None, lld_records=None,
           stored=None, cancelled=False, enrich_status="enriched"):
    dsa_records = dsa_records or []
    sd_records = sd_records or []
    lld_records = lld_records or []
    stored = stored or {}

    async def fake_snehasishroy(s): return dsa_records
    async def fake_neetcode(s): return []
    async def fake_kaggle_collect(s): return []
    monkeypatch.setattr(qc.dsa_collector, "collect_snehasishroy", fake_snehasishroy)
    monkeypatch.setattr(qc.dsa_collector, "collect_neetcode", fake_neetcode)
    monkeypatch.setattr(qc.dsa_collector, "collect_kaggle", fake_kaggle_collect)

    async def fake_collect_sd(s): return sd_records
    async def fake_collect_lld(s): return lld_records
    monkeypatch.setattr(qc, "collect_system_design", fake_collect_sd)
    monkeypatch.setattr(qc, "collect_lld", fake_collect_lld)

    async def fake_stored(version): return stored
    monkeypatch.setattr(qc.repo, "stored_states", fake_stored)

    upserted = []
    async def fake_upsert(doc): upserted.append(doc); return doc
    monkeypatch.setattr(qc.repo, "upsert_question", fake_upsert)

    monkeypatch.setattr(qc, "build_llm_client", lambda s: _FakeLLM())

    async def fake_enrich_one(llm, rec):
        rec = rec.model_copy(update={"enrichment_status": enrich_status})
        return rec
    monkeypatch.setattr(qc, "enrich_one", fake_enrich_one)

    monkeypatch.setattr(qc.RUN_STORE, "is_cancelled", lambda: cancelled)

    return upserted


def test_dsa_unchanged_skip(monkeypatch):
    """(a) DSA record with matching source_hash is counted unchanged and NOT upserted."""
    rec = _dsa("two-sum")
    rec.source_hash = compute_source_hash(rec)
    stored = {("dsa", "two-sum"): {"source_hash": rec.source_hash, "enrichment_status": "raw"}}
    upserted = _setup(monkeypatch, dsa_records=[rec], stored=stored)
    result = asyncio.run(qc.collect_questions(_settings()))
    assert result["unchanged"] == 1
    assert not any(d["slug"] == "two-sum" for d in upserted)


def test_dsa_new_is_upserted(monkeypatch):
    """(b) DSA record absent from stored IS upserted."""
    rec = _dsa("two-sum")
    upserted = _setup(monkeypatch, dsa_records=[rec], stored={})
    result = asyncio.run(qc.collect_questions(_settings()))
    assert result["unchanged"] == 0
    assert any(d["slug"] == "two-sum" for d in upserted)


def test_sd_resume_skip(monkeypatch):
    """(c) SD seed already enriched with matching hash → skipped, enrich_one NOT called."""
    seed = _sd()
    seed.source_hash = compute_source_hash(seed)
    stored = {("system-design", seed.slug): {"source_hash": seed.source_hash, "enrichment_status": "enriched"}}

    enrich_called = []

    async def fake_snehasishroy(s): return []
    async def fake_neetcode(s): return []
    async def fake_kaggle_c(s): return []
    monkeypatch.setattr(qc.dsa_collector, "collect_snehasishroy", fake_snehasishroy)
    monkeypatch.setattr(qc.dsa_collector, "collect_neetcode", fake_neetcode)
    monkeypatch.setattr(qc.dsa_collector, "collect_kaggle", fake_kaggle_c)

    async def fake_collect_sd(s): return [seed]
    async def fake_collect_lld(s): return []
    monkeypatch.setattr(qc, "collect_system_design", fake_collect_sd)
    monkeypatch.setattr(qc, "collect_lld", fake_collect_lld)

    async def fake_stored(version): return stored
    monkeypatch.setattr(qc.repo, "stored_states", fake_stored)

    upserted = []
    async def fake_upsert(doc): upserted.append(doc); return doc
    monkeypatch.setattr(qc.repo, "upsert_question", fake_upsert)

    monkeypatch.setattr(qc, "build_llm_client", lambda s: _FakeLLM())

    async def fake_enrich_one(llm, rec):
        enrich_called.append(rec.slug)
        return rec.model_copy(update={"enrichment_status": "enriched"})
    monkeypatch.setattr(qc, "enrich_one", fake_enrich_one)
    monkeypatch.setattr(qc.RUN_STORE, "is_cancelled", lambda: False)

    result = asyncio.run(qc.collect_questions(_settings()))
    assert result["skipped"] == 1
    assert seed.slug not in enrich_called


def test_sd_retry_non_terminal(monkeypatch):
    """(d) SD seed with enrich_failed IS re-enriched."""
    seed = _sd()
    seed.source_hash = compute_source_hash(seed)
    stored = {("system-design", seed.slug): {"source_hash": seed.source_hash, "enrichment_status": "enrich_failed"}}
    upserted = _setup(monkeypatch, sd_records=[seed], stored=stored)
    result = asyncio.run(qc.collect_questions(_settings()))
    assert result["enriched"] == 1
    assert any(d["slug"] == seed.slug for d in upserted)


def test_sd_source_change_reenrich(monkeypatch):
    """(e) SD seed with changed source_hash (even if enriched) IS re-enriched."""
    seed = _sd()
    seed.source_hash = compute_source_hash(seed)
    # Stored has a DIFFERENT hash
    stored = {("system-design", seed.slug): {"source_hash": "sha256:differenthash", "enrichment_status": "enriched"}}
    upserted = _setup(monkeypatch, sd_records=[seed], stored=stored)
    result = asyncio.run(qc.collect_questions(_settings()))
    assert result["enriched"] == 1
    assert any(d["slug"] == seed.slug for d in upserted)


def test_force_reenriches_even_enriched(monkeypatch):
    """(f) force=True re-processes even matching-hash enriched seeds."""
    seed = _sd()
    seed.source_hash = compute_source_hash(seed)
    stored = {("system-design", seed.slug): {"source_hash": seed.source_hash, "enrichment_status": "enriched"}}
    upserted = _setup(monkeypatch, sd_records=[seed], stored=stored)
    result = asyncio.run(qc.collect_questions(_settings(), force=True))
    assert result["skipped"] == 0
    assert result["enriched"] == 1
    assert any(d["slug"] == seed.slug for d in upserted)


def test_cancel_skips_enrich(monkeypatch):
    """(g) With is_cancelled() True, seed returns 'cancelled' and enrich_one NOT called."""
    seed = _sd()

    async def fake_snehasishroy(s): return []
    async def fake_neetcode(s): return []
    async def fake_kaggle_c(s): return []
    monkeypatch.setattr(qc.dsa_collector, "collect_snehasishroy", fake_snehasishroy)
    monkeypatch.setattr(qc.dsa_collector, "collect_neetcode", fake_neetcode)
    monkeypatch.setattr(qc.dsa_collector, "collect_kaggle", fake_kaggle_c)

    async def fake_collect_sd(s): return [seed]
    async def fake_collect_lld(s): return []
    monkeypatch.setattr(qc, "collect_system_design", fake_collect_sd)
    monkeypatch.setattr(qc, "collect_lld", fake_collect_lld)

    async def fake_stored(version): return {}
    monkeypatch.setattr(qc.repo, "stored_states", fake_stored)

    upserted = []
    async def fake_upsert(doc): upserted.append(doc); return doc
    monkeypatch.setattr(qc.repo, "upsert_question", fake_upsert)

    monkeypatch.setattr(qc, "build_llm_client", lambda s: _FakeLLM())

    enrich_called = []
    async def fake_enrich_one(llm, rec):
        enrich_called.append(rec.slug)
        return rec.model_copy(update={"enrichment_status": "enriched"})
    monkeypatch.setattr(qc, "enrich_one", fake_enrich_one)

    monkeypatch.setattr(qc.RUN_STORE, "is_cancelled", lambda: True)

    result = asyncio.run(qc.collect_questions(_settings()))
    assert result["cancelled"] == 1
    assert not enrich_called
