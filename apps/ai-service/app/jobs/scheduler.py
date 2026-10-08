"""In-process scheduler (APScheduler, AsyncIOScheduler).

Schedules overview-only company suggestions. Detailed company/role brief generation is
admin-triggered only; interview blueprints and question-bank pipelines are independent.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import Settings
from app.exa.client import ExaClient
from app.research.runner import RunActive

logger = logging.getLogger(__name__)


async def _research_job(research) -> None:
    try:
        await research.start_run(trigger="cron", scope="all")
    except RunActive as exc:
        logger.info("Scheduled research run skipped: run %s is still active", exc.run_id)
    except Exception:  # noqa: BLE001 — a scheduled run must never kill the scheduler
        logger.exception("Scheduled research run failed to start")


def create_scheduler(exa: ExaClient, settings: Settings, research=None) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="UTC")
    if research is not None:
        scheduler.add_job(
            _research_job,
            CronTrigger.from_crontab(settings.research_cron, timezone="Asia/Kolkata"),
            args=[research],
            id="company-research",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info("Scheduler configured: company research on cron %r (Asia/Kolkata)", settings.research_cron)
    return scheduler
