"""Backend publications drive prep; all repositories and generation are offline fakes."""
import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.db import repositories as repo
from app.interview_prep.context import build_context
from app.interview_prep.pipeline import generate_interview_plan
from app.interview_prep.prompts.persona import PERSONA_SYSTEM, build_persona_prompt
from app.interview_prep.schema import GenerateInterviewPlanRequest, RoundBeat
from tests.test_interview_prep_pipeline import _req, _wire_store, _fake_parts

ROUND_TYPES = ["dsa", "system-design", "lld", "behavioural", "hiring-manager"]


def _brief():
    return {
        "company": "google", "role": "software-engineer", "level": "sde1", "specialization": "backend",
        "generated_at": "2026-10-03T10:00:00Z", "published_revision": 2,
        "generation_status": "completed", "provenance": "admin_verified",
        "company_overview": {"overview": "Published company context", "culture": "Published culture",
                             "benefits": "Published benefits", "sourceUrls": ["https://example.com"], "verified": True},
        "final_experience": {"rounds": [
            {"type": t, "name": f"Round {i}", "round_number": i + 1, "duration_minutes": 35 + i,
             "difficulty": "hard", "topics": [f"topic-{t}"], "problems": [f"problem-{t}"],
             "format": f"Published guidance for {t}", "provenance": "admin_verified"}
            for i, t in enumerate(ROUND_TYPES)
        ]},
    }


def _published(brief=None, round_type="dsa"):
    payload = _req().model_dump(by_alias=True, mode="json")
    payload["session"]["roundType"] = round_type
    payload["companyBrief"] = _brief() if brief is None else brief
    return GenerateInterviewPlanRequest.model_validate(payload)


@pytest.mark.parametrize("round_type", ROUND_TYPES)
def test_publication_bypasses_mongo_and_grounds_only_matching_round(monkeypatch, round_type):
    get_brief = AsyncMock(side_effect=AssertionError("must not read legacy Mongo brief"))
    monkeypatch.setattr(repo, "get_brief", get_brief)
    questions = AsyncMock(return_value=[])
    monkeypatch.setattr(repo, "query_questions", questions)
    ctx = asyncio.run(build_context(_published(round_type=round_type), Settings(_env_file=None)))
    get_brief.assert_not_called()
    assert ctx.difficulty == "hard"
    assert ctx.grounding["round"]["topics"] == [f"topic-{round_type}"]
    assert ctx.grounding["round"]["problems"] == [f"problem-{round_type}"]
    assert ctx.grounding["round"]["formats"] == [f"Published guidance for {round_type}"]
    assert ctx.grounding["round"]["durationMinutes"] == 35 + ROUND_TYPES.index(round_type)
    assert ctx.grounding["companyOverview"]["overview"] == "Published company context"
    assert questions.call_args_list[0].args[:3] == (round_type, "google", "hard")
    prompt = build_persona_prompt(ctx.grounding)
    assert f"Published guidance for {round_type}" in prompt and '"durationMinutes":' in prompt
    assert "round.durationMinutes" in PERSONA_SYSTEM and "round.formats" in PERSONA_SYSTEM


@pytest.mark.parametrize("key,value", [("published_revision", 3), ("duration_minutes", 55),
                                      ("format", "Revised admin guidance"), ("problems", ["Revised question"])])
def test_revision_and_content_invalidate_cache_even_with_same_timestamp(monkeypatch, key, value):
    _store, calls = _wire_store(monkeypatch)
    import app.interview_prep.pipeline as pipeline

    async def generate(ctx, settings):
        calls["n"] += 1
        persona, *rest = _fake_parts()
        persona.round_arc = [RoundBeat(title="Intro", timebox_mins=5), RoundBeat(title="Core", timebox_mins=20),
                             RoundBeat(title="Candidate questions", timebox_mins=5)]
        return persona, *rest

    monkeypatch.setattr(pipeline, "generate_plan_parts", generate)
    monkeypatch.setattr(repo, "get_brief", AsyncMock(side_effect=AssertionError("legacy lookup")))
    settings = Settings(_env_file=None)
    first = asyncio.run(generate_interview_plan(_published(), settings))
    cached = asyncio.run(generate_interview_plan(_published(), settings))
    assert calls["n"] == 1 and first == cached
    assert sum(b["timeboxMins"] for b in first["roundArc"]) == 35
    changed = deepcopy(_brief())
    if key == "published_revision":
        changed[key] = value
    else:
        changed["final_experience"]["rounds"][0][key] = value
    fresh = asyncio.run(generate_interview_plan(_published(changed), settings))
    assert calls["n"] == 2
    assert first["provenance"]["inputHash"] != fresh["provenance"]["inputHash"]
    assert sum(b["timeboxMins"] for b in fresh["roundArc"]) == (55 if key == "duration_minutes" else 35)
    assert first["candidateProfile"] == fresh["candidateProfile"]


@pytest.mark.parametrize("key", ["company", "role", "level", "specialization"])
def test_publication_identity_must_match_request(key):
    brief = _brief()
    brief[key] = "wrong"
    with pytest.raises(ValidationError, match=f"companyBrief.{key} must match"):
        _published(brief)


def test_publication_cannot_override_candidate_profile(monkeypatch):
    brief = _brief()
    brief["candidateProfile"] = {"fullName": "Injected", "skills": ["Injected"]}
    brief["company_overview"]["candidateProfile"] = brief["candidateProfile"]
    monkeypatch.setattr(repo, "query_questions", AsyncMock(return_value=[]))
    req = _published(brief)
    ctx = asyncio.run(build_context(req, Settings(_env_file=None)))
    assert ctx.profile["fullName"] == "Asha" and ctx.profile["skills"] == ["Python"]
    assert "Injected" not in str(ctx.grounding)


@pytest.mark.parametrize("key,value", [("type", "system_design"), ("duration_minutes", 0),
                                      ("duration_minutes", True), ("duration_minutes", 241)])
def test_invalid_published_round_rejected(key, value):
    brief = _brief()
    brief["final_experience"]["rounds"][0][key] = value
    with pytest.raises(ValidationError):
        _published(brief)


def test_explicit_empty_brief_does_not_fall_back_or_claim_grounding(monkeypatch):
    monkeypatch.setattr(repo, "get_brief", AsyncMock(side_effect=AssertionError("legacy lookup")))
    monkeypatch.setattr(repo, "query_questions", AsyncMock(return_value=[]))
    ctx = asyncio.run(build_context(_published({}), Settings(_env_file=None)))
    assert not ctx.has_brief_content


def test_missing_brief_preserves_legacy_mongo_lookup(monkeypatch):
    legacy = AsyncMock(return_value=_brief())
    monkeypatch.setattr(repo, "get_brief", legacy)
    monkeypatch.setattr(repo, "query_questions", AsyncMock(return_value=[]))
    ctx = asyncio.run(build_context(_req(), Settings(_env_file=None)))
    legacy.assert_awaited_once_with("google", "software-engineer", "sde1", "backend")
    assert ctx.has_brief_content


def test_published_brief_endpoints_keep_internal_auth_and_identity_validation(monkeypatch):
    import httpx
    from fastapi import FastAPI
    from app.api import deps, routes

    settings = Settings(_env_file=None).model_copy(update={"internal_api_key": "test-only-internal-key"})
    monkeypatch.setattr(deps, "get_settings", lambda: settings)
    generate = AsyncMock(return_value={"sessionId": "s1"})
    monkeypatch.setattr(routes, "generate_interview_plan", generate)
    app = FastAPI()
    app.include_router(routes.router)

    async def go():
        payload = _published().model_dump(by_alias=True, mode="json")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for path in ("/interview-plans", "/interview-plans/start"):
                assert (await client.post(path, json=payload)).status_code == 401
                invalid = deepcopy(payload)
                invalid["companyBrief"]["company"] = "other-company"
                response = await client.post(path, json=invalid, headers={"X-Internal-Api-Key": "test-only-internal-key"})
                assert response.status_code == 422
            response = await client.post("/interview-plans", json=payload,
                                         headers={"X-Internal-Api-Key": "test-only-internal-key"})
            assert response.status_code == 200
        assert generate.await_count == 1
        assert generate.call_args.args[0].company_brief.published_revision == 2
    asyncio.run(go())
