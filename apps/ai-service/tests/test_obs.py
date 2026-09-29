"""obs.span: a no-op when Langfuse is disabled — never imports the SDK, never raises."""
import sys

from app import obs


def test_span_noop_when_disabled():
    # Default settings have LANGFUSE_ENABLED unset -> disabled. The span must be a safe no-op.
    with obs.span("unit-test", foo="bar") as sp:
        sp.update(output={"x": 1})
        sp.event("something", k=1)
    # Lazy import contract: the SDK is never imported on the disabled path.
    assert "langfuse" not in sys.modules


def test_span_yields_usable_handle_even_disabled():
    with obs.span("unit-test") as sp:
        assert sp is not None
        # Methods are safe to call and return None.
        assert sp.update(anything=1) is None
        assert sp.event("e") is None
