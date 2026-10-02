"""Forward Python log records into the bound research run as `log` events (spec §10.2), so every
logger.debug/info/warning inside the pipeline (including app.llm.client's 429 cooldown lines) shows
in the debugger console under the right company, node and span. A no-op unless a run is bound."""
from __future__ import annotations

import logging
import traceback

from app.research.trace.context import CURRENT_TRACER

_IGNORED_PREFIX = "app.research.trace"   # the tracer's own logs must not feed back into it


def _level(levelno: int) -> str:
    if levelno >= logging.ERROR:
        return "error"
    if levelno >= logging.WARNING:
        return "warn"
    if levelno >= logging.INFO:
        return "info"
    return "debug"


class ResearchLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        tracer = CURRENT_TRACER.get()
        if tracer is None or record.name.startswith(_IGNORED_PREFIX):
            return
        try:
            data: dict = {"logger": record.name, "where": f"{record.pathname}:{record.lineno}"}
            if record.exc_info:
                data["exc"] = "".join(traceback.format_exception(*record.exc_info))
            tracer.emit("log", record.getMessage(), level=_level(record.levelno), data=data)
        except Exception:  # noqa: BLE001 — logging must never break the caller
            pass
