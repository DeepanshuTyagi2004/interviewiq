"""Stage 1 context: input-hash stability + determinism, and build_context derivation (mocked repo)."""
import asyncio

from app.config import get_settings
from app.db import repositories as repo
from app.interview_prep.context import build_context, compute_input_hash, compute_profile_hash
from app.interview_prep.schema import GenerateInterviewPlanRequest


def _hash(**over):
    base = dict(brief_generated_at="t", profile_hash="p", jd_id="j", round_type="dsa",
                question_slugs=["a", "b"])
    base.update(over)
    return compute_input_hash(**base)


def test_input_hash_slug_order_independent():
    assert _hash(question_slugs=["a", "b"]) == _hash(question_slugs=["b", "a"])


def test_input_hash_prefixed():
    assert _hash().startswith("sha256:")


def test_input_hash_changes_on_any_input():
    base = _hash()
    assert base != _hash(question_slugs=["a", "b", "c"])
    assert base != _hash(brief_generated_at="t2")
    assert base != _hash(profile_hash="p2")
    assert base != _hash(jd_id="j2")
    assert base != _hash(round_type="system-design")


def test_profile_hash_key_order_independent():
    assert compute_profile_hash({"a": 1, "b": 2}) == compute_profile_hash({"b": 2, "a": 1})
    assert compute_profile_hash({"a": 1}) != compute_profile_hash({"a": 2})


def _req():
    return GenerateInterviewPlanRequest.model_validate({
        "session": {"sessionId": "s1", "candidateId": "c1", "company": "google",
                    "role": "software-engineer", "level": "sde1", "specialization": "backend",
                    "roundType": "dsa"},
        "jobDescription": {"id": "jd1", "title": "SWE", "description": "Build", "techStack": "Java"},
        "candidateProfile": {"fullName": "Asha", "skills": ["Python"]},
    })


def test_build_context_derives_difficulty_slugs_redflags(monkeypatch):
    async def _brief(*a, **k):
        return {"generation_status": "success", "generated_at": "2026-07-01T00:00:00+00:00",
                "final_experience": {
                    "rounds": [
                        {"type": "dsa", "difficulty": "medium", "topics": ["arrays", "dp"],
                         "problems": ["Two Sum"], "format": "live-coding"},
                        {"type": "dsa", "difficulty": "medium", "topics": ["dp", "graphs"]},
                        {"type": "system-design", "difficulty": "hard", "topics": ["scaling"],
                         "problems": ["Design URL shortener"]}],
                    "red_flags": ["rambling"], "difficulty_calibration": "medium",
                    "dominant_topics": ["arrays"]}}

    async def _questions(round_type, company, difficulty, limit):
        # Assert the derived difficulty is threaded into the strictest query.
        assert round_type == "dsa"
        return [{"slug": "two-sum", "title": "Two Sum", "url": "http://lc/two-sum",
                 "difficulty": "medium", "topic_tags": ["array"]}]

    monkeypatch.setattr(repo, "get_brief", _brief)
    monkeypatch.setattr(repo, "query_questions", _questions)

    ctx = asyncio.run(build_context(_req(), get_settings()))
    assert ctx.difficulty == "medium"          # most-common dsa difficulty from the brief
    assert ctx.question_slugs == ["two-sum"]
    assert ctx.has_brief_content is True
    assert ctx.red_flags == ["rambling"]
    assert ctx.input_hash.startswith("sha256:")
    assert ctx.grounding["roundType"] == "dsa"
    # Round-scoped: only the dsa rounds' topics/problems (deduped), NOT the system-design round's.
    assert ctx.grounding["round"]["topics"] == ["arrays", "dp", "graphs"]
    assert ctx.grounding["round"]["problems"] == ["Two Sum"]
    assert "scaling" not in ctx.grounding["round"]["topics"]
    assert ctx.grounding["round"]["difficulty"] == "medium"
    # Whole-process signals stay under overallProcess (background only).
    assert ctx.grounding["overallProcess"]["dominantTopics"] == ["arrays"]


def test_build_context_no_brief_relaxes(monkeypatch):
    async def _no_brief(*a, **k):
        return None

    async def _questions(round_type, company, difficulty, limit):
        return []

    monkeypatch.setattr(repo, "get_brief", _no_brief)
    monkeypatch.setattr(repo, "query_questions", _questions)
    ctx = asyncio.run(build_context(_req(), get_settings()))
    assert ctx.has_brief_content is False
    assert ctx.difficulty is None
    assert ctx.questions == []
    assert ctx.brief_generated_at is None
