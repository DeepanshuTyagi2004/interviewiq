"""Starts and supervises an in-process diagnostic interview session. Binds the run-store log
capture AND the diagnostics emitter for the session's asyncio task, drives run_session behind a
DiagnosticTransport, and records the terminal outcome. Does NOT post to the outcome sink."""
from __future__ import annotations

import asyncio
import dataclasses
import logging

from app.config import Settings
from app.interview_agent import diagnostics_emit as emit
from app.interview_agent.diagnostic_transport import DiagnosticTransport
from app.interview_agent.session import run_session
from app.jobs.agent_sessions import AGENT_SESSIONS
from app.jobs.pipeline_runs import bind_run, new_run_id, unbind_run
# (no LLMError import — run_session never raises it to the runner; it returns aborted_technical)

logger = logging.getLogger(__name__)

# Default concurrent-session cap. Read at call time by _max_active, so an endpoint (Task A5) or a
# test can override it via ``diagnostic_runner.MAX_ACTIVE_SESSIONS``. A Settings field
# ``max_active_diagnostic_sessions`` wins over this when present.
MAX_ACTIVE_SESSIONS = 3

# module-level so the endpoints can look up the live transport by run_id
TRANSPORTS: dict[str, DiagnosticTransport] = {}


class TooManyActiveSessions(Exception):
    pass


def _max_active(settings: Settings) -> int:
    return getattr(settings, "max_active_diagnostic_sessions", None) or MAX_ACTIVE_SESSIONS


def terminal_status(ended_reason: str | None) -> str:
    # run_session catches ALL exceptions (session.py ~491) and returns an outcome; a force-end
    # (_END -> DiagnosticSessionAborted) OR a fatal LLM error both come back as "aborted_technical".
    # ended_reason may be an EndedReason (str, Enum) or a plain str — both compare by value here.
    if ended_reason == "abandoned":
        return "abandoned"
    if ended_reason == "aborted_technical":
        return "aborted"
    return "completed"


def start_agent_session(plan: dict, settings: Settings, label: str | None = None):
    if AGENT_SESSIONS.active_count() >= _max_active(settings):
        raise TooManyActiveSessions()
    run_id = new_run_id()
    label = label or f"{plan.get('round', '?')}·{(plan.get('persona') or {}).get('name', '?')}"
    AGENT_SESSIONS.start(run_id, plan, label=label)
    transport = DiagnosticTransport(run_id, AGENT_SESSIONS)
    TRANSPORTS[run_id] = transport
    task = asyncio.create_task(_run(run_id, transport, plan, settings))
    AGENT_SESSIONS.attach_task(run_id, task)
    return run_id, transport


async def _run(run_id, transport, plan, settings) -> None:
    # Bind BOTH log capture and the diagnostics emitter in THIS task so the contextvars are set on
    # the task that runs run_session — otherwise the emitter/log taps silently no-op.
    run_tok = bind_run(run_id)
    emit_tok = emit.bind_emitter(run_id)
    try:
        outcome = await run_session(transport, plan, settings)
        # SessionOutcome is a frozen dataclass (types.py:135) -> asdict recurses nested dataclasses.
        # ended_reason is an EndedReason (str, Enum), so JSON + == "abandoned" both work.
        doc = dataclasses.asdict(outcome)
        ended_reason = doc.get("ended_reason")
        AGENT_SESSIONS.set_result(run_id, doc, ended_reason)
        AGENT_SESSIONS.finish(run_id, terminal_status(ended_reason))
    except asyncio.CancelledError:
        AGENT_SESSIONS.finish(run_id, "aborted")  # store evicted this session and cancelled us
        raise
    except Exception as e:
        # defensive only: run_session catches its OWN errors and always returns an outcome, so this
        # guards asdict/store failures — NOT interview content. A force-end (_END) or fatal LLM
        # error arrives above as ended_reason == "aborted_technical" and is mapped by terminal_status.
        logger.warning("[agent-diag] runner error: %s", e)
        AGENT_SESSIONS.fail(run_id, step=AGENT_SESSIONS.current_step(run_id), error=e)
    finally:
        emit.unbind_emitter(emit_tok)
        unbind_run(run_tok)
        TRANSPORTS.pop(run_id, None)
