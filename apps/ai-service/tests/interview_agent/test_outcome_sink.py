import asyncio

import httpx

from app.config import get_settings
from app.interview_agent import outcome_sink
from app.interview_agent.types import EndedReason, NegativeEvent, PerAnswerScore, SessionOutcome


def _outcome():
    return SessionOutcome(
        session_id="11111111-1111-1111-1111-111111111111",
        ended_reason=EndedReason.NATURAL_COMPLETE,
        live_score_final=0.66,
        per_answer_evidence=[PerAnswerScore(slug="two-sum", competency=0.8, behavioral=0.7, answer_score=0.75, weight=1.0)],
        negative_events=[NegativeEvent(type="idk", magnitude=0.1, reason="blanked", at_s=120.0)],
        arc_completed=True, extensions_granted=0, derived_topics=["graphs"], duration_s=1830.0,
    )


def test_post_outcome_sends_serialized_payload(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 204
        def raise_for_status(self): pass

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            captured["url"] = url; captured["json"] = json; captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    ok = asyncio.run(outcome_sink.post_outcome(get_settings(), _outcome()))

    assert ok is True
    assert captured["url"].endswith("/api/v1/internal/sessions/11111111-1111-1111-1111-111111111111/outcome")
    assert captured["headers"]["X-Internal-Api-Key"] == get_settings().internal_api_key
    body = captured["json"]
    assert body["ended_reason"] == "natural_complete"          # enum coerced to its .value
    assert body["live_score_final"] == 0.66
    assert body["per_answer_evidence"][0]["slug"] == "two-sum"
    assert body["duration_s"] == 1830.0


def test_post_outcome_returns_false_on_error(monkeypatch):
    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): raise httpx.ConnectError("backend down")

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    ok = asyncio.run(outcome_sink.post_outcome(get_settings(), _outcome()))
    assert ok is False   # tolerant: logs + returns False, never raises
