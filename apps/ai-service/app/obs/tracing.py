"""Langfuse tracing span — optional, lazy, and fail-safe.

Contract:
  * NO-OP unless `settings.langfuse_enabled` AND both keys are set. When off, `span()` yields a
    no-op handle and NEVER imports Langfuse.
  * Lazy import — the `langfuse` package is imported only inside the enabled branch, so the service
    starts and runs with the package absent.
  * NEVER raises. Any error building the tracer or recording to it degrades to a no-op (logged
    once), so tracing can never break a request.

Usage (sync `with`, safe inside async code — nothing awaits):
    with obs.span("interview_prep.pipeline", session_id=sid) as sp:
        ...
        sp.update(output={"cached": True})
"""
from __future__ import annotations

import logging
from contextlib import contextmanager

from app.config import get_settings

logger = logging.getLogger(__name__)

_warned = False
_client = None  # cached Langfuse client (built lazily, once)


def _warn_once(msg: str) -> None:
    global _warned
    if not _warned:
        logger.warning("[obs] Langfuse tracing disabled: %s", msg)
        _warned = True


class _Span:
    """Handle yielded by span(). All methods are safe no-ops when `_handle` is None."""

    def __init__(self, handle=None):
        self._handle = handle

    def update(self, **kwargs) -> None:
        if self._handle is None:
            return
        try:
            self._handle.update(**kwargs)
        except Exception as exc:  # noqa: BLE001 — tracing must never break the caller
            logger.debug("[obs] span.update failed: %s", exc)

    def event(self, name: str, **kwargs) -> None:
        if self._handle is None:
            return
        try:
            self._handle.event(name=name, **kwargs)
        except Exception as exc:  # noqa: BLE001
            logger.debug("[obs] span.event failed: %s", exc)


def _get_client(settings):
    global _client
    if _client is not None:
        return _client
    from langfuse import Langfuse  # lazy: only imported when enabled
    _client = Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
    )
    return _client


@contextmanager
def span(name: str, **metadata):
    settings = get_settings()
    if not (settings.langfuse_enabled and settings.langfuse_public_key and settings.langfuse_secret_key):
        # Disabled (or misconfigured) — pure no-op, no import.
        yield _Span(None)
        return

    handle = None
    try:
        client = _get_client(settings)
        # `start_span` is the current SDK entry point; guarded so an API mismatch degrades to no-op.
        handle = client.start_span(name=name, metadata=metadata or None)
    except Exception as exc:  # noqa: BLE001 — absent package / API drift / bad keys -> no-op
        _warn_once(f"{type(exc).__name__}: {exc}")
        yield _Span(None)
        return

    sp = _Span(handle)
    try:
        yield sp
    finally:
        try:
            handle.end()
        except Exception as exc:  # noqa: BLE001
            logger.debug("[obs] span.end failed: %s", exc)
