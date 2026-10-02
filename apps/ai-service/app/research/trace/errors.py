"""Turn an exception into what the debugger shows: type, message, full traceback, and a code_ref
("app/research/nodes/resolve.py:resolve") naming the innermost pipeline frame so Claude Code can
jump straight to the code (spec §10.4)."""
from __future__ import annotations

import traceback

_MAX_MESSAGE = 2000
_MAX_TRACEBACK = 20_000
_MARKER = "/app/research/"


def code_ref(exc: BaseException) -> str | None:
    for frame in reversed(traceback.extract_tb(exc.__traceback__)):
        path = frame.filename.replace("\\", "/")
        i = path.rfind(_MARKER)
        if i != -1:
            return f"{path[i + 1:]}:{frame.name}"
    return None


def error_info(exc: BaseException) -> dict:
    return {
        "type": type(exc).__name__,
        "message": str(exc)[:_MAX_MESSAGE],
        "traceback": "".join(traceback.format_exception(exc))[-_MAX_TRACEBACK:],
        "code_ref": code_ref(exc),
    }
