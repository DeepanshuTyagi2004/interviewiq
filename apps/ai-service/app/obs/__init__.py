"""Observability helpers. Currently: an optional Langfuse tracing span.

`span(...)` is a NO-OP unless `LANGFUSE_ENABLED` is true AND both keys are present; it imports the
Langfuse SDK lazily and NEVER raises (a broken/absent tracer must not take down a request). Langfuse
is an OPTIONAL runtime dependency — the service starts and runs without the package installed.
"""
from app.obs.tracing import span

__all__ = ["span"]
