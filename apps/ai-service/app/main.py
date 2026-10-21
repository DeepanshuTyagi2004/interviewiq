"""FastAPI application factory + lifespan.

Startup order, all fail-fast:
  1. load settings (missing required env -> pydantic ValidationError, process exits)
  2. connect MongoDB (unreachable -> RuntimeError, process exits)
  3. build the Exa client (missing key -> error, process exits)
  4. start the overview-only research scheduler (if enabled)
  5. research runner: indexes, crash recovery, weekly cron
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.admin import router as admin_router
from app.api.routes import router
from app.blueprint.api import admin_router as blueprint_admin_router, router as blueprint_router
from app.evaluation.api import admin_router as evaluation_admin_router, router as evaluation_router
from app.linkedin.api import router as linkedin_router
from app.config import get_settings
from app.db import mongo
from app.jobs.pipeline_runs import PipelineRunLogHandler
from app.jobs.run_store import RunLogHandler
from app.jobs.scheduler import create_scheduler
from app.exa.client import build_exa_client
from app.research.api import router as research_router
from app.research.store import MongoResearchStore, ensure_research_indexes
from app.research.trace.log_handler import ResearchLogHandler
from app.research.wiring import build_research_runner

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
    # Same idea for the keyed observability consoles (résumé parse): routes logs to the run bound
    # to the current task's context. No-op unless a run is bound.
    if not any(isinstance(h, PipelineRunLogHandler) for h in root.handlers):
        root.addHandler(PipelineRunLogHandler())
    # Research traces: forward every log record emitted inside a research run into its trace.
    if not any(isinstance(h, ResearchLogHandler) for h in root.handlers):
        root.addHandler(ResearchLogHandler())
    # The debugger wants DEBUG from the pipeline even when the console runs at LOG_LEVEL. The console
    # StreamHandler keeps LOG_LEVEL, so stdout stays as quiet as before.
    logging.getLogger("app.research").setLevel(logging.DEBUG)
    for h in root.handlers:
        if type(h) is logging.StreamHandler:
            h.setLevel(settings.log_level.upper())

    await mongo.connect(settings)
    from app.blueprint.store import recover_interrupted_runs
    try:
        if (interrupted := await recover_interrupted_runs(settings.blueprint_run_retention_days, settings.blueprint_run_timeout_seconds)):
            logger.warning("marked %d interrupted blueprint run(s) failed", interrupted)
    except Exception as exc:  # noqa: BLE001 — recovery is housekeeping; it must never block startup
        logger.warning("blueprint run recovery skipped: %s", exc)
    from app.evaluation.store import recover_interrupted_runs as recover_evaluation_runs
    try:
        if (interrupted := await recover_evaluation_runs(settings.evaluation_run_retention_days, settings.evaluation_run_timeout_seconds)):
            logger.warning("marked %d interrupted evaluation run(s) failed", interrupted)
    except Exception as exc:  # noqa: BLE001 — recovery is housekeeping; it must never block startup
        logger.warning("evaluation run recovery skipped: %s", exc)
    app.state.exa = build_exa_client(settings)

    research = None
    if settings.research_enabled:
        await ensure_research_indexes(mongo.get_db(), ttl_days=settings.research_trace_ttl_days)
        research = build_research_runner(settings, store=MongoResearchStore(mongo.get_db()))
        await research.recover_on_startup()
    app.state.research = research

    scheduler = None
    if settings.scheduler_enabled:
        scheduler = create_scheduler(app.state.exa, settings, research=research)
        scheduler.start()
    app.state.scheduler = scheduler

    logger.info("interviewiq-ai-service started (scheduler=%s)", bool(scheduler))
    try:
        yield
    finally:
        if scheduler:
            scheduler.shutdown(wait=False)
        from app.blueprint.pipeline import close_shared_llm
        await close_shared_llm()
        try:
            from app.llm.decisions import close_shared_decisions_client
            await close_shared_decisions_client()
        except Exception as exc:  # noqa: BLE001 — shutdown must never fail
            logger.warning("decisions client close failed: %s", exc)
        await mongo.close()


app = FastAPI(title="interviewiq-ai-service", version="0.1.0", lifespan=lifespan)
app.include_router(router)
app.include_router(linkedin_router)
app.include_router(admin_router)
app.include_router(research_router)
app.include_router(blueprint_router)
app.include_router(blueprint_admin_router)
app.include_router(evaluation_router)
app.include_router(evaluation_admin_router)
