import pytest

from app.research.models import (
    ACTIVE_RUN_STATUSES,
    NODE_ORDER,
    PIPELINE_VERSION,
    InvalidTransition,
    RunStatus,
    check_transition,
    field,
    unavailable,
)


def test_field_shape():
    f = field("Meesho", confidence="high", provenance="evidence", source_urls=("https://meesho.com",))
    assert f == {
        "value": "Meesho", "confidence": "high", "provenance": "evidence",
        "source_urls": ["https://meesho.com"], "note": None, "alternatives": [], "as_of": None,
    }


def test_field_carries_conflicting_values_and_evidence_date():
    alt = {"value": "Mumbai", "source_urls": ["https://b.example"], "as_of": "2025-01-02"}
    f = field("Bengaluru", confidence="low", provenance="evidence", alternatives=[alt], as_of="2026-03-01")
    assert f["alternatives"] == [alt] and f["as_of"] == "2026-03-01"


def test_unavailable_is_an_empty_low_confidence_field():
    assert unavailable("no data") == {
        "value": None, "confidence": "low", "provenance": "unavailable", "source_urls": [], "note": "no data",
        "alternatives": [], "as_of": None,
    }


def test_paused_run_still_holds_the_active_slot():
    assert RunStatus.PAUSED in ACTIVE_RUN_STATUSES
    assert RunStatus.COMPLETED not in ACTIVE_RUN_STATUSES
    assert RunStatus.STOPPED not in ACTIVE_RUN_STATUSES


def test_phase_one_node_order():
    assert NODE_ORDER == ("resolve", "profile", "write_draft")


def test_evidence_hardening_uses_a_new_pipeline_version():
    assert PIPELINE_VERSION == "research-v5-overview"


@pytest.mark.parametrize("status,action", [
    ("running", "pause"), ("queued", "pause"), ("paused", "resume"),
    ("pausing", "stop"), ("paused", "stop"), ("running", "stop"),
])
def test_allowed_transitions(status, action):
    check_transition(status, action)


@pytest.mark.parametrize("status,action", [
    ("paused", "pause"), ("running", "resume"), ("pausing", "resume"),
    ("completed", "stop"), ("stopped", "resume"), ("failed", "pause"),
])
def test_rejected_transitions(status, action):
    with pytest.raises(InvalidTransition):
        check_transition(status, action)
