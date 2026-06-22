"""In-process scheduler (APScheduler, AsyncIOScheduler).

Runs Exa brief generation every BRIEF_REFRESH_INTERVAL_DAYS. Cadence comes
from config. Runs go through RUN_STORE so the live admin console can watch them.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import Settings
from app.jobs.brief_generation import execute_tracked_run
from app.jobs.run_store import RUN_STORE, new_run_id
from app.exa.client import ExaClient

logger = logging.getLogger(__name__)


async def _brief_job(exa: ExaClient, settings: Settings) -> None:
    run_id = new_run_id()
    if not RUN_STORE.start(run_id, trigger="scheduler"):
        logger.info("Scheduled run skipped: a brief generation run is already in progress")
        return
    try:
        await execute_tracked_run(exa, settings, run_id)
    except Exception:  # noqa: BLE001 — a scheduled run must never kill the scheduler
        logger.exception("Scheduled brief generation failed")


def create_scheduler(exa: ExaClient, settings: Settings) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        _brief_job,
        IntervalTrigger(days=settings.brief_refresh_interval_days),
        args=[exa, settings],
        id="brief-generation",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    logger.info(
        "Scheduler configured: brief generation every %d day(s)", settings.brief_refresh_interval_days
    )
    return scheduler
