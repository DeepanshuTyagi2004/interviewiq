"""Canonical writes, read compatibility and raw-evidence/prep identity boundaries; all offline."""
import asyncio
import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import admin, routes
from app.api.deps import get_exa, require_internal_key
from app.db import repositories as repo
from app.blueprint.context import build_context
from app.blueprint.models import BlueprintRunRequest, CandidateProfileInput
from app.levels import classify
from app.models.brief import RawExperience as SourceEvidence
from app.models.engineering_levels import (
    ENGINEERING_LEVELS, Level, engineering_level_view, normalize_legacy_level,
)
from app.models.experience import Level as ExperienceLevel
from app.prompts.enrich_question import build_enrich_prompt
from app.questions.enrich import enrich_one
from app.questions.hashing import compute_source_hash
from app.questions.models import QuestionRecord
from app.research.fields import LEVELS, render_field_docs
from app.research.nodes.evidence import LEVEL_SIGNALS
from tests.research.test_grounding_v2 import raw, run


EXPECTED = ("intern", "fresher", "sde1", "sde2", "sde3", "staff", "principal", "distinguished")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routes.router)
    app.include_router(admin.router)
    app.dependency_overrides[require_internal_key] = lambda: None
    app.dependency_overrides[get_exa] = lambda: object()
    # No lifespan: no database, scheduler or provider connection can be started.
    return TestClient(app)


def test_single_source_enum_and_openapi_parity():
    assert ENGINEERING_LEVELS == EXPECTED
    assert ExperienceLevel is Level
    assert LEVELS == set(EXPECTED) == set(LEVEL_SIGNALS)
    contract = Path(__file__).resolve().parents[3] / "packages/contracts/openapi.yaml"
    text = contract.read_text()
    section = re.search(r"^    EngineeringLevel:\n(.*?)(?=^    \w+:|\Z)", text, re.M | re.S)
    assert section is not None, "OpenAPI must declare EngineeringLevel"
    values = re.search(r"enum: \[([^\]]+)\]", section[1])
    assert values is not None, "EngineeringLevel must declare its canonical enum"
    assert tuple(s.strip().strip('\"\'') for s in values[1].split(",")) == EXPECTED


@pytest.mark.parametrize("level", EXPECTED)
def test_submit_all_eight_levels_are_stored_canonically(client, monkeypatch, level):
    save = AsyncMock(return_value=1)
    monkeypatch.setattr(repo, "upsert_experiences", save)
    response = client.post("/admin/experiences", json={
        "company": "Google", "level": level, "raw_content": "My first-hand account",
    })
    assert response.status_code == 200
    exp = save.call_args.args[0][0]
    assert exp.level.value == exp.model_dump(mode="json")["level"] == level


@pytest.mark.parametrize("level", ["principle", "SDE-2", "senior", "6yrs senior", "unknown", "", None])
def test_submit_invalid_new_levels_return_422(client, monkeypatch, level):
    save = AsyncMock(side_effect=AssertionError("invalid input must not persist"))
    monkeypatch.setattr(repo, "upsert_experiences", save)
    assert client.post("/admin/experiences", json={
        "company": "google", "level": level, "raw_content": "account",
    }).status_code == 422
    save.assert_not_called()


@pytest.mark.parametrize("level", EXPECTED)
def test_blueprint_candidate_level_accepts_all_eight(level):
    req = BlueprintRunRequest.model_validate(blueprint_request(candidate_level=level))
    assert req.candidate_profile.level == level


@pytest.mark.parametrize("level", ["principle", "SDE-2", "senior", "6yrs senior", "unknown"])
def test_blueprint_rejects_an_invalid_candidate_level(level):
    with pytest.raises(ValidationError):
        BlueprintRunRequest.model_validate(blueprint_request(candidate_level=level))


@pytest.mark.parametrize("legacy,canonical", [
    ("SDE-I", "sde1"), ("sde_ii", "sde2"), ("SDE III", "sde3"),
    ("new-grad", "fresher"), ("internship", "intern"), ("Principle", "principal"),
    ("Senior", "sde3"), ("Staff", "staff"), ("Distinguished", "distinguished"),
])
def test_explicit_read_normalization_does_not_make_aliases_valid_writes(legacy, canonical):
    assert normalize_legacy_level(legacy) == canonical
    assert engineering_level_view(legacy) == {"level": canonical, "legacyLevel": None}
    with pytest.raises(ValidationError):
        CandidateProfileInput(level=legacy)


@pytest.mark.parametrize("target", ["SDE-II", "Career switcher", "6yrs senior"])
def test_blueprint_keeps_the_booked_target_label_and_never_infers_candidate_level(target):
    req = BlueprintRunRequest.model_validate(blueprint_request(target_level=target))
    ctx = build_context(req)
    assert ctx.level_label == target and req.candidate_profile.level is None
    # Calibration reads a known alias; an unknown label falls back to sde1, never to the candidate's level.
    assert ctx.level == (normalize_legacy_level(target).value if normalize_legacy_level(target) else "sde1")


def test_candidate_level_is_independent_of_the_target_level():
    req = BlueprintRunRequest.model_validate(blueprint_request(candidate_level="intern", target_level="principal"))
    ctx = build_context(req)
    assert req.candidate_profile.level == "intern" and ctx.level == "principal"


def blueprint_request(candidate_level=None, target_level="sde2"):
    return {
        "session": {"session_id": "s1", "candidate_id": "c1", "company": "google", "role": "software-engineer",
                    "level": target_level, "specialization": "backend", "round_type": "dsa"},
        "job_description": {"title": "SWE"},
        "round": {"type": "dsa"},
        "candidate_profile": {"level": candidate_level} if candidate_level is not None else {},
    }


@pytest.mark.parametrize("level", EXPECTED)
def test_research_levels_require_matching_source_seniority(level):
    quote = f"Software Engineer {level} hiring in India"
    result = run(raw("level", level, quote), quote)
    assert result.reason is None
    assert result.claim["value"] == level
    assert level in render_field_docs(["level"])


def test_distinguished_cannot_be_fabricated_from_principal_or_years():
    for quote in ("Principal Software Engineer in India", "Software engineer with 20 years in India"):
        assert run(raw("level", "distinguished", quote), quote).reason == "category_signal_missing"


def test_raw_source_level_evidence_is_verbatim_and_still_uses_evidence_bucketing():
    source = SourceEvidence(url="https://example.test/account", detected_level="6yrs senior")
    assert source.detected_level == source.model_dump()["detected_level"] == "6yrs senior"
    assert classify(source.detected_level) == ("senior", "sde3")


@pytest.mark.parametrize("level", EXPECTED)
def test_question_metadata_all_eight_enum_tags_validate_and_roundtrip(level):
    question = QuestionRecord(slug="x", title="Example", round_type="system-design", url="u", level_tags=[level])
    assert question.level_tags == [Level(level)]
    assert QuestionRecord.model_validate(question.model_dump()).level_tags == [level]
    assert question.model_dump(mode="json")["level_tags"] == [level]
    assert "|".join(EXPECTED) in build_enrich_prompt(question)


@pytest.mark.parametrize("invalid", ["principle", "senior", "SDE-2", "6yrs senior", "unknown"])
def test_new_question_level_metadata_rejects_unknown_or_legacy_tags(invalid):
    with pytest.raises(ValidationError):
        QuestionRecord(slug="x", title="Example", round_type="dsa", url="u", level_tags=[invalid])


def test_bad_enrichment_metadata_keeps_raw_record_without_failing_collection():
    class LLM:
        async def complete_json(self, *args, **kwargs):
            return {"level_tags": ["principle"], "company_tags": ["Invented"]}
    original = QuestionRecord(slug="x", title="Example", round_type="lld", url="u", level_tags=["sde2"])
    result = asyncio.run(enrich_one(LLM(), original))
    assert result.enrichment_status == "enrich_failed"
    assert result.level_tags == ["sde2"] and result.company_tags == []


def test_level_enum_preserves_existing_question_source_hash():
    question = QuestionRecord(slug="x", title="Example", round_type="dsa", url="u", level_tags=["sde2", "sde1"])
    digest = compute_source_hash(question)
    old = question.model_copy(update={"level_tags": ["sde2", "sde1"]})
    assert compute_source_hash(old) == digest


@pytest.mark.parametrize("level", EXPECTED)
def test_refresh_write_boundary_accepts_all_eight_without_providers(client, monkeypatch, level):
    class LLM:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    monkeypatch.setattr(routes, "fetch_combinations", AsyncMock(return_value=[]))
    monkeypatch.setattr(routes, "build_llm_client", lambda settings: LLM())
    generate = AsyncMock()
    monkeypatch.setattr(routes, "generate_one", generate)
    monkeypatch.setattr(repo, "get_brief", AsyncMock(return_value={"generation_status": "success"}))
    assert client.post(f"/briefs/google/software-engineer/{level}/backend/refresh").status_code == 200
    assert generate.call_args.args[2].level == level


@pytest.mark.parametrize("level", ["principle", "senior", "unknown"])
def test_refresh_invalid_new_level_returns_422(client, level):
    assert client.post(f"/briefs/google/software-engineer/{level}/backend/refresh").status_code == 422


def test_read_lookup_keeps_unknown_saved_brief_and_experience_identity(client, monkeypatch):
    brief = AsyncMock(return_value={"level": "Career switcher"})
    experiences = AsyncMock(return_value=(1, [{"level": "Career switcher"}]))
    monkeypatch.setattr(repo, "get_brief", brief)
    monkeypatch.setattr(repo, "paginate_experiences", experiences)
    assert client.get("/briefs/google/software-engineer/Career%20switcher/backend").status_code == 200
    assert client.get("/experiences/google/software-engineer/Career%20switcher").status_code == 200
    brief.assert_awaited_once_with("google", "software-engineer", "Career switcher", "backend")
    experiences.assert_awaited_once_with("google", "software-engineer", "Career switcher", 1, 20)
