"""Pipeline: cache-gate skip (identical inputs -> stored plan, no LLM), regeneration on change,
assembly shape, and the no-data 422 path. The LLM (generate_plan_parts) is mocked throughout."""
import asyncio

import pytest

import app.interview_prep.pipeline as pipeline
from app.config import get_settings
from app.db import repositories as repo
from app.interview_prep.pipeline import PrepDataError, generate_interview_plan
from app.interview_prep.schema import (
    CandidateProbe,
    GenerateInterviewPlanRequest,
    InterviewerPersona,
    InterviewPlan,
    PersonaAndArc,
    PlanProvenance,
    QuestionLadder,
)
from app.models.brief import utcnow


def _req(profile=None):
    return GenerateInterviewPlanRequest.model_validate({
        "session": {"sessionId": "s1", "candidateId": "c1", "company": "google",
                    "role": "software-engineer", "level": "sde1", "specialization": "backend",
                    "roundType": "dsa"},
        "jobDescription": {"id": "jd1", "title": "SWE", "description": "Build", "techStack": "Java"},
        "candidateProfile": profile or {"fullName": "Asha", "skills": ["Python"]},
    })


async def _brief_ok(*a, **k):
    return {"generation_status": "success", "generated_at": "2026-07-01T00:00:00+00:00",
            "final_experience": {"rounds": [{"type": "dsa", "difficulty": "medium"}],
                                 "red_flags": ["rambling"], "difficulty_calibration": "medium",
                                 "dominant_topics": ["arrays"]}}


async def _questions_ok(round_type, company, difficulty, limit):
    return [{"slug": "two-sum", "title": "Two Sum", "url": "http://lc/two-sum",
             "difficulty": "medium", "topic_tags": ["array"]}]


def _fake_parts():
    persona = PersonaAndArc(
        persona=InterviewerPersona(name="Sam", seniority="Senior SWE", disposition="warm"),
        round_arc=[])
    ladders = [QuestionLadder(base_prompt="Solve two-sum")]
    probes = [CandidateProbe(prompt="Walk me through a project", what_it_tests="ownership")]
    reserve = [QuestionLadder(base_prompt="Solve a harder variant of two-sum")]
    return persona, ladders, probes, reserve


def _wire_store(monkeypatch):
    """In-memory plan store + brief/questions, and a call-counting fake for generate_plan_parts."""
    monkeypatch.setattr(repo, "get_brief", _brief_ok)
    monkeypatch.setattr(repo, "query_questions", _questions_ok)
    store: dict[str, dict] = {}

    async def _get_plan(session_id):
        return store.get(session_id)

    async def _upsert_plan(doc):
        store[doc["sessionId"]] = doc
        return doc

    monkeypatch.setattr(repo, "get_plan", _get_plan)
    monkeypatch.setattr(repo, "upsert_plan", _upsert_plan)

    calls = {"n": 0}

    async def _fake_generate(ctx, settings):
        calls["n"] += 1
        return _fake_parts()

    monkeypatch.setattr(pipeline, "generate_plan_parts", _fake_generate)
    return store, calls


def test_first_run_generates_and_assembles(monkeypatch):
    _store, calls = _wire_store(monkeypatch)
    doc = asyncio.run(generate_interview_plan(_req(), get_settings()))
    assert calls["n"] == 1
    # Linkage + provenance + content shape (camelCase wire form).
    assert doc["sessionId"] == "s1" and doc["candidateId"] == "c1"
    assert doc["roundType"] == "dsa"
    assert doc["provenance"]["inputHash"].startswith("sha256:")
    assert doc["provenance"]["planVersion"] == get_settings().prep_plan_version
    assert doc["provenance"]["model"] == (get_settings().prep_llm_model or get_settings().llm_model)
    assert doc["persona"]["name"] == "Sam"
    assert len(doc["questionLadders"]) == 1
    assert len(doc["candidateProbes"]) == 1
    assert doc["redFlagWatchlist"] == ["rambling"]
    assert doc["reserve"][0]["basePrompt"] == "Solve a harder variant of two-sum"


def test_identical_rerun_is_cache_hit_no_llm(monkeypatch):
    _store, calls = _wire_store(monkeypatch)
    settings = get_settings()
    doc1 = asyncio.run(generate_interview_plan(_req(), settings))
    doc2 = asyncio.run(generate_interview_plan(_req(), settings))
    assert calls["n"] == 1          # second run skipped the LLM entirely
    assert doc2 == doc1             # returned the stored plan unchanged


def test_changed_profile_regenerates(monkeypatch):
    _store, calls = _wire_store(monkeypatch)
    settings = get_settings()
    asyncio.run(generate_interview_plan(_req(), settings))
    # Different profile -> different profile hash -> different input hash -> fresh generation.
    asyncio.run(generate_interview_plan(_req(profile={"fullName": "Ben", "skills": ["Go"]}), settings))
    assert calls["n"] == 2


def test_assembled_plan_persists_candidate_profile(monkeypatch):
    """Fix: rapport grounding (session.py reads plan.get('candidateProfile')) needs real data, not
    the `{}` it always got before `_assemble_plan` carried the request's profile through."""
    _wire_store(monkeypatch)
    profile = {"fullName": "Asha", "education": [{"institution": "COEP"}]}
    doc = asyncio.run(generate_interview_plan(_req(profile=profile), get_settings()))
    assert doc["candidateProfile"]["fullName"] == "Asha"
    assert doc["candidateProfile"]["education"][0]["institution"] == "COEP"


def test_interview_plan_candidate_profile_defaults_to_none():
    """Backward-compat: plans (e.g. old cached docs) with no candidateProfile still validate."""
    plan = InterviewPlan(
        session_id="s1", candidate_id="c1", company="google", role="software-engineer",
        level="sde1", specialization="backend", round_type="dsa",
        provenance=PlanProvenance(plan_version="v4", input_hash="sha256:x", model="m",
                                   generated_at=utcnow()),
        persona=InterviewerPersona(name="Sam", seniority="Senior SWE", disposition="warm"),
    )
    assert plan.candidate_profile is None


def test_no_brief_no_questions_raises_prepdata(monkeypatch):
    async def _no_brief(*a, **k):
        return None

    async def _no_q(*a, **k):
        return []

    monkeypatch.setattr(repo, "get_brief", _no_brief)
    monkeypatch.setattr(repo, "query_questions", _no_q)
    with pytest.raises(PrepDataError):
        asyncio.run(generate_interview_plan(_req(), get_settings()))
