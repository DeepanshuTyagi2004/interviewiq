"""Private assessment boundary: shape, bounds, provenance, grounding, and HTTP auth."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.api.deps as deps
import app.api.routes as routes
from app.profile_scoring.assess import build_profile_assessment_prompt, run_profile_assessment
from app.profile_scoring.models import (
    ProfileScoringAssessmentRequest, ProfileScoringLLMOutput, validate_llm_assessment,
)


def request_data():
    return {
        "userContext": {"declaredLevel": "sde2", "targetRole": "Backend engineer"},
        "projects": [{"title": "Cache service", "excerpts": ["Reduced latency by 30%"]}],
        "experience": [{"title": "Engineer", "excerpts": ["Owned the API rollout"]}],
        "internships": [{"title": "Intern", "excerpts": ["Implemented a test harness"]}],
        "requestedFeatures": ["implementation", {"key": "impact", "description": "Measured outcomes"}],
    }


def llm_data():
    return {"assessments": [
        {"feature": "implementation", "value": 60, "rationale": "Delivered an API rollout.",
         "evidenceExcerpts": ["Owned the API rollout"], "evidenceType": "INFERRED"},
        {"feature": "impact", "value": 70, "rationale": "Reported latency improvement.",
         "evidenceExcerpts": ["Reduced latency by 30%"], "evidenceType": "INFERRED"},
    ]}


class FakeLLM:
    routing_identity = {"provider": "fake-provider", "model": "fake-model"}

    def __init__(self, data):
        self.data = data
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def complete_json(self, system, user, *, label):
        self.calls.append((system, user, label))
        return self.data


def test_valid_assessment_has_only_features_and_server_provenance():
    req = ProfileScoringAssessmentRequest.model_validate(request_data())
    fake = FakeLLM(llm_data())
    out = asyncio.run(run_profile_assessment(fake, req)).model_dump(by_alias=True, mode="json")
    assert out["provider"] == "fake-provider"
    assert out["model"] == "fake-model"
    assert out["generatedAt"].endswith("Z")
    assert out["algorithmVersion"] == "profile-scoring-assessment-v1"
    assert out["promptVersion"] == "profile-scoring-assessment-prompt-v5"
    assert len(out["assessments"]) == 2
    assert all(item["evidenceType"] == "INFERRED" for item in out["assessments"])
    assert set(out) == {"assessments", "provider", "model", "generatedAt", "algorithmVersion", "promptVersion"}
    prompt = build_profile_assessment_prompt(req)
    assert "Owned the API rollout" in prompt
    assert "Implemented a test harness" in prompt


@pytest.mark.parametrize("value", [-1, 101, float("nan"), float("inf"), "60", True])
@pytest.mark.parametrize("field", ["value"])
def test_rejects_invalid_numeric_features(field, value):
    data = llm_data()
    data["assessments"][0][field] = value
    with pytest.raises(ValidationError):
        ProfileScoringLLMOutput.model_validate(data)


@pytest.mark.parametrize("mutate", [
    lambda data: data.update(overallScore=95),
    lambda data: data["assessments"][0].update(profileScore=95),
    lambda data: data["assessments"][0].update(evidenceType="VERIFIED"),
    lambda data: data["assessments"][0].pop("evidenceType"),
    lambda data: data["assessments"][0].update(confidence=45),
])
def test_llm_cannot_return_overall_scores_or_verified_evidence(mutate):
    data = llm_data()
    mutate(data)
    with pytest.raises(ValidationError):
        ProfileScoringLLMOutput.model_validate(data)


@pytest.mark.parametrize("mutate", [
    lambda data: data["assessments"].pop(),
    lambda data: data["assessments"][0].update(feature="ownership"),
    lambda data: data["assessments"][0].update(feature="impact"),
    lambda data: data["assessments"][0].update(evidenceExcerpts=["Invented quote"]),
    lambda data: data["assessments"][0].update(evidenceExcerpts=[]),
])
def test_deterministic_validation_rejects_mismatch_duplicates_and_unbacked_inference(mutate):
    data = llm_data()
    mutate(data)
    output = ProfileScoringLLMOutput.model_validate(data)
    with pytest.raises(ValueError):
        validate_llm_assessment(output, ProfileScoringAssessmentRequest.model_validate(request_data()))


def test_loosely_copied_quotes_are_grounded_to_the_exact_input_text():
    """Models tidy spacing, swap dashes, drop markdown and shorten with "..."; one such quote must
    not fail the whole item. Each quote becomes the verbatim input span, and a feature whose
    quotes match nothing becomes unassessed (0, no excerpts) instead of an error."""
    data = request_data()
    data["projects"][0]["excerpts"] = ["- Cut p99 latency by 30% at sub-200ms latency .", "**Cache** — a `Redis` layer"]
    data["requestedFeatures"] = ["implementation", "impact", "scale"]
    req = ProfileScoringAssessmentRequest.model_validate(data)
    quotes = {
        "implementation": ["Cut p99 latency by 30% at sub-200ms latency.", "Cache - a Redis layer"],
        "impact": ["Cut p99 latency by 30%... sub-200ms latency"],
        "scale": ["Served 10 million users"],
    }
    fake = FakeLLM({"assessments": [
        {"feature": key, "value": 60, "rationale": "r", "evidenceExcerpts": quote, "evidenceType": "INFERRED"}
        for key, quote in quotes.items()]})
    out = asyncio.run(run_profile_assessment(fake, req))
    by_feature = {item.feature: item for item in out.assessments}
    assert by_feature["implementation"].evidence_excerpts == [
        "Cut p99 latency by 30% at sub-200ms latency .", "Cache** — a `Redis` layer"]
    assert by_feature["impact"].evidence_excerpts == ["Cut p99 latency by 30%", "sub-200ms latency"]
    assert (by_feature["scale"].value, by_feature["scale"].evidence_excerpts) == (0, [])
    snippets = [text for item in req.projects for text in [item.title, *item.excerpts]]
    assert all(any(quote in snippet for snippet in snippets) for item in out.assessments for quote in item.evidence_excerpts)


def test_quotes_with_unicode_hyphens_or_changed_spacing_are_grounded():
    """gpt-oss often copies "long-running" as "long\u2011running" (non-breaking hyphen) or adds a
    space ("sub-200ms" -> "sub\u2011200 ms"); the stored quote is still the exact input text."""
    data = request_data()
    # Bullets are packed into one excerpt joined by newlines; a model may quote two of them as one.
    data["projects"][0]["excerpts"] = ["- Orchestrated long-running jobs at sub-200ms latency.\n- Shipped it.\n- Cut cost by 30%.", "STT \u2192 LLM \u2192 TTS pipeline"]
    data["requestedFeatures"] = ["implementation", "impact", "scale"]
    req = ProfileScoringAssessmentRequest.model_validate(data)
    fake = FakeLLM({"assessments": [
        {"feature": "implementation", "value": 60, "rationale": "r", "evidenceExcerpts": ["Orchestrated long\u2011running jobs at sub\u2011200 ms latency."], "evidenceType": "INFERRED"},
        {"feature": "impact", "value": 50, "rationale": "r", "evidenceExcerpts": ["STT -> LLM -> TTS pipeline"], "evidenceType": "INFERRED"},
        {"feature": "scale", "value": 40, "rationale": "r", "evidenceExcerpts": ["- Shipped it.\n- Cut cost by 30%."], "evidenceType": "INFERRED"}]})
    out = {item.feature: item for item in asyncio.run(run_profile_assessment(fake, req)).assessments}
    assert out["implementation"].evidence_excerpts == ["Orchestrated long-running jobs at sub-200ms latency."]
    assert out["impact"].evidence_excerpts == ["STT \u2192 LLM \u2192 TTS pipeline"]
    assert out["scale"].evidence_excerpts == ["- Shipped it.", "- Cut cost by 30%."]
    assert (out["implementation"].value, out["impact"].value, out["scale"].value) == (60, 50, 40)


@pytest.mark.parametrize("mutate", [
    lambda data: data["userContext"].update(email="private@example.test"),
    lambda data: data.update(rawResume="private"),
    lambda data: data["projects"][0].update(url="https://identity.test"),
    lambda data: data.update(requestedFeatures=["overall_score"]),
    lambda data: data.update(requestedFeatures=["impact", "impact"]),
    lambda data: data.update(requestedFeatures=[f"feature{i}" for i in range(25)]),
    lambda data: data["projects"][0].update(excerpts=["x" * 801]),
    lambda data: data.update(projects=[{"title": "x"}] * 21),
    lambda data: data.update(projects=[{"title": "x", "excerpts": ["x" * 800] * 8}] * 10),
])
def test_rejects_sensitive_fields_and_budget_excess(mutate):
    data = request_data()
    mutate(data)
    with pytest.raises(ValidationError):
        ProfileScoringAssessmentRequest.model_validate(data)


@pytest.fixture
def client(monkeypatch):
    settings = SimpleNamespace(internal_api_key="internal-test-secret")
    monkeypatch.setattr(deps, "get_settings", lambda: settings)
    monkeypatch.setattr(routes, "get_settings", lambda: settings)
    fake = FakeLLM(llm_data())
    options = []
    def build(settings, **kwargs):
        options.append(kwargs)
        return fake
    monkeypatch.setattr(routes, "build_profile_scoring_llm_client", build)
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app), fake, options


def test_endpoint_is_internal_key_protected_and_uses_the_profile_scoring_client(client):
    http, fake, options = client
    assert http.post("/profile-scoring/assess", json=request_data()).status_code == 401
    assert not fake.calls
    result = http.post("/profile-scoring/assess", json=request_data(), headers={"X-Internal-Api-Key": "internal-test-secret"})
    assert result.status_code == 200
    assert result.json()["model"] == "fake-model"
    assert options == [{}]  # Groq-first profile-scoring client, built once per request


def test_endpoint_hides_invalid_request_and_provider_output(client, caplog):
    http, fake, _ = client
    headers = {"X-Internal-Api-Key": "internal-test-secret"}
    data = request_data()
    data["userContext"]["password"] = "private-input-secret"
    result = http.post("/profile-scoring/assess", json=data, headers=headers)
    assert result.status_code == 422
    assert "private-input-secret" not in result.text
    assert not fake.calls
    fake.data = {"assessments": [], "api_key": "private-output-secret"}
    result = http.post("/profile-scoring/assess", json=request_data(), headers=headers)
    assert result.status_code == 502
    assert "private-output-secret" not in result.text + caplog.text


def test_endpoint_rejects_oversized_transport_body_without_calling_llm(client):
    http, fake, _ = client
    result = http.post("/profile-scoring/assess", content=b" " * 100_001,
                       headers={"X-Internal-Api-Key": "internal-test-secret"})
    assert result.status_code == 413
    assert not fake.calls
