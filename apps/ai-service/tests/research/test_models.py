import pytest

from app.research.models import (
    ACTIVE_RUN_STATUSES,
    NODE_ORDER,
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
        "source_urls": ["https://meesho.com"], "note": None,
    }


def test_unavailable_is_an_empty_low_confidence_field():
    assert unavailable("no data") == {
        "value": None, "confidence": "low", "provenance": "unavailable", "source_urls": [], "note": "no data",
    }


def test_paused_run_still_holds_the_active_slot():
    assert RunStatus.PAUSED in ACTIVE_RUN_STATUSES
    assert RunStatus.COMPLETED not in ACTIVE_RUN_STATUSES
    assert RunStatus.STOPPED not in ACTIVE_RUN_STATUSES


def test_phase_one_node_order():
    assert NODE_ORDER == ("resolve", "write_draft")


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
