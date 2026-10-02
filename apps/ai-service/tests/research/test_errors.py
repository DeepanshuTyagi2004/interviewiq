import pytest

from app.research.models import InvalidTransition, check_transition
from app.research.trace.errors import code_ref, error_info


def test_error_info_points_code_ref_at_the_innermost_research_frame():
    with pytest.raises(InvalidTransition) as caught:
        check_transition("completed", "stop")
    info = error_info(caught.value)
    assert info["type"] == "InvalidTransition"
    assert "cannot stop a run that is completed" in info["message"]
    assert info["code_ref"] == "app/research/models.py:check_transition"
    assert "Traceback" in info["traceback"]


def test_code_ref_is_none_outside_the_research_package():
    try:
        raise ValueError("boom")
    except ValueError as exc:
        assert code_ref(exc) is None
