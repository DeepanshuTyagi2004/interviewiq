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
    assert sched.get_job("brief-generation") is not None


def test_no_research_job_without_a_runner():
    sched = create_scheduler(exa=object(), settings=Settings(_env_file=None))
    assert sched.get_job("company-research") is None


def test_research_job_starts_an_all_scope_cron_run_and_swallows_run_active():
    runner = _Runner()
    asyncio.run(_research_job(runner))
    assert runner.calls == [{"trigger": "cron", "scope": "all"}]
    asyncio.run(_research_job(_Runner(exc=RunActive("busy"))))   # must not raise
