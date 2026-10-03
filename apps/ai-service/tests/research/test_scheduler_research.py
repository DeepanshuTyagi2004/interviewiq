import asyncio

from apscheduler.triggers.cron import CronTrigger

from app.config import Settings
from app.jobs.scheduler import _research_job, create_scheduler
from app.research.runner import RunActive


class _Runner:
    def __init__(self, exc=None):
        self.calls, self.exc = [], exc

    async def start_run(self, **kw):
        self.calls.append(kw)
        if self.exc:
            raise self.exc
        return {"run_id": "r"}


def test_research_job_is_scheduled_weekly_on_the_configured_cron():
    sched = create_scheduler(exa=object(), settings=Settings(_env_file=None), research=_Runner())
    job = sched.get_job("company-research")
    assert isinstance(job.trigger, CronTrigger)
    assert str(job.trigger.timezone) == "Asia/Kolkata"
    assert sched.get_job("brief-generation") is None


def test_no_research_job_without_a_runner():
    sched = create_scheduler(exa=object(), settings=Settings(_env_file=None))
    assert sched.get_job("company-research") is None
    assert sched.get_jobs() == []


def test_startup_does_not_launch_detailed_brief_generation(monkeypatch):
    import logging
    from unittest.mock import AsyncMock, Mock
    from fastapi import FastAPI
    from app import main

    settings = Settings(_env_file=None).model_copy(update={"scheduler_enabled": True, "research_enabled": False})
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    monkeypatch.setattr(main.mongo, "connect", AsyncMock())
    monkeypatch.setattr(main.mongo, "close", AsyncMock())
    monkeypatch.setattr(main, "build_exa_client", lambda _: object())
    scheduler = Mock()
    monkeypatch.setattr(main, "create_scheduler", lambda *a, **kw: scheduler)
    create_task = Mock(side_effect=AssertionError("startup must not launch background brief generation"))
    monkeypatch.setattr(asyncio, "create_task", create_task)

    async def go():
        root, research_log = logging.getLogger(), logging.getLogger("app.research")
        root_level, research_level = root.level, research_log.level
        handlers = list(root.handlers)
        levels = {h: h.level for h in handlers}
        try:
            async with main.lifespan(FastAPI()):
                scheduler.start.assert_called_once()
            scheduler.shutdown.assert_called_once_with(wait=False)
            create_task.assert_not_called()
        finally:
            root.setLevel(root_level)
            research_log.setLevel(research_level)
            root.handlers[:] = handlers
            for handler, level in levels.items():
                handler.setLevel(level)
    asyncio.run(go())


def test_research_job_starts_an_all_scope_cron_run_and_swallows_run_active():
    runner = _Runner()
    asyncio.run(_research_job(runner))
    assert runner.calls == [{"trigger": "cron", "scope": "all"}]
    asyncio.run(_research_job(_Runner(exc=RunActive("busy"))))   # must not raise
