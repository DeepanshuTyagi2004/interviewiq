import asyncio
import app.jobs.question_collection as qc


def test_collect_questions_aggregates_and_upserts(monkeypatch):
    from app.questions.models import QuestionRecord
    from app.models.brief import RoundType

    dsa = QuestionRecord(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                         url="https://leetcode.com/problems/two-sum/")
    sd = QuestionRecord(slug="sdp/x", round_type=RoundType.SYSTEM_DESIGN, title="X", url="u")

    async def fake_fetch(*a, **k): return {}
    monkeypatch.setattr(qc, "fetch_repo_files", fake_fetch)
    monkeypatch.setattr(qc, "_collect_dsa", lambda files, s: [dsa])
    monkeypatch.setattr(qc, "_collect_design", lambda s: ([sd], []))  # (sd, lld)

    async def fake_enrich_all(llm, recs, limit): return recs
    monkeypatch.setattr(qc, "enrich_all", fake_enrich_all)
    monkeypatch.setattr(qc, "build_llm_client", lambda s: _FakeLLM())

    upserted = []
    async def fake_upsert(doc): upserted.append(doc); return doc
    monkeypatch.setattr(qc.repo, "upsert_question", fake_upsert)

    settings = _settings()
    result = asyncio.run(qc.collect_questions(settings))
    assert result["dsa"] == 1 and result["system-design"] == 1 and result["lld"] == 0
    assert result["total"] == 2
    assert len(upserted) == 2
    assert all(d["collection_version"] == settings.collection_version for d in upserted)


class _FakeLLM:
    async def aclose(self): pass


def _settings():
    from app.config import Settings
    import os
    os.environ.setdefault("EXA_API_KEY", "x"); os.environ.setdefault("LLM_API_KEY", "x")
    os.environ.setdefault("LLM_MODEL_NAME", "m"); os.environ.setdefault("MONGODB_URL", "mongodb://x")
    os.environ.setdefault("INTERNAL_API_KEY", "x")
    return Settings()
