"""FastAPI application factory + lifespan.

Startup order, all fail-fast:
  1. load settings (missing required env -> pydantic ValidationError, process exits)
  2. connect MongoDB (unreachable -> RuntimeError, process exits)
  3. build the Exa client (missing key -> error, process exits)
  4. start the scheduler (if enabled) + generate briefs on startup if any are missing
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.admin import router as admin_router
from app.api.routes import router
from app.config import Settings, get_settings
from app.db import mongo
from app.jobs.brief_generation import any_combination_missing_brief, execute_tracked_run
from app.interview_agent.diagnostics_emit import AgentDiagLogHandler
from app.jobs.pipeline_runs import PipelineRunLogHandler
from app.jobs.run_store import RUN_STORE, RunLogHandler, new_run_id
from app.jobs.scheduler import create_scheduler
from app.exa.client import ExaClient, build_exa_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # Apply configured verbosity and attach the run-log capture handler so the
    # live admin console sees the same verbose logs the server emits.
    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    if not any(isinstance(h, RunLogHandler) for h in root.handlers):
        root.addHandler(RunLogHandler())
    # Same idea for the keyed observability consoles (résumé parse, interview-prep): routes logs
    # to the run bound to the current task's context. No-op unless a run is bound.
    if not any(isinstance(h, PipelineRunLogHandler) for h in root.handlers):
        root.addHandler(PipelineRunLogHandler())
    # And the agent-diagnostics console: routes logs to the bound diagnostic session (keyed by the
    # emitter contextvar). No-op unless an agent-diag session is bound.
    if not any(isinstance(h, AgentDiagLogHandler) for h in root.handlers):
        root.addHandler(AgentDiagLogHandler())

    await mongo.connect(settings)
    app.state.exa = build_exa_client(settings)

    scheduler = None
    if settings.scheduler_enabled:
        scheduler = create_scheduler(app.state.exa, settings)
        scheduler.start()
        # Populate briefs on a fresh deploy rather than waiting for the schedule.
        # Gated with the scheduler so SCHEDULER_ENABLED=false => fully manual (UI-only).
        asyncio.create_task(_startup_generate_if_needed(app.state.exa, settings))
    app.state.scheduler = scheduler

    logger.info("interviewiq-ai-service started (scheduler=%s)", bool(scheduler))
    try:
        yield
    finally:
        if scheduler:
            scheduler.shutdown(wait=False)
        await mongo.close()


async def _startup_generate_if_needed(exa: ExaClient, settings: Settings) -> None:
    try:
        if not await any_combination_missing_brief(settings):
            return
        run_id = new_run_id()
        if RUN_STORE.start(run_id, trigger="startup"):
            logger.info("Startup: combinations without briefs detected — generating now")
            await execute_tracked_run(exa, settings, run_id)
    except Exception:  # noqa: BLE001 — startup generation must never crash the service
        logger.exception("Startup brief generation failed")


app = FastAPI(title="interviewiq-ai-service", version="0.1.0", lifespan=lifespan)
app.include_router(router)
app.include_router(admin_router)
