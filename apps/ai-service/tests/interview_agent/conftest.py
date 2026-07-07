"""Shared fixtures for the interview_agent test package.

``minimal_plan`` mirrors the module-level ``PLAN`` in test_session.py (2 ladders + 1 reserve, drains
to a natural end); ``test_settings`` is the real ``Settings`` (``app.config.get_settings()``). Both
let the diagnostic-runner tests drive ``run_session`` in-process — the tests stub every ``llm_ops``
call and ``build_llm_client`` themselves, so no real LLM/network is touched."""
from __future__ import annotations

import copy

import pytest

from app.config import get_settings


_PLAN = {
    "sessionId": "s1", "candidateId": "c1", "roundType": "dsa",
    "persona": {"name": "Ada", "opening": "hi", "closing": "bye"},
    "questionLadders": [
        {"questionSlug": "q1", "basePrompt": "b1", "followUps": ["f1"], "hints": ["h1"],
         "rubric": [{"criterion": "c", "weight": 1.0}]},
        {"questionSlug": "q2", "basePrompt": "b2", "followUps": [], "hints": [], "rubric": []},
    ],
    "reserve": [{"questionSlug": "r1", "basePrompt": "hard bonus", "rubric": []}],
}


@pytest.fixture
def minimal_plan() -> dict:
    # deep copy so a test mutating the plan can never bleed into another
    return copy.deepcopy(_PLAN)


@pytest.fixture
def test_settings():
    return get_settings()
