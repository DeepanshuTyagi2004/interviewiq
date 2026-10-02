"""Shared scaffolding for research tests: settings, fake clients, wired NodeDeps, and a runner over
the in-memory store. Not a test module (no test_ prefix), so pytest does not collect it."""
from __future__ import annotations

import re
from contextlib import asynccontextmanager

from app.config import Settings
from app.research.budget import Budget
from app.research.fixtures import FixtureStore
from app.research.gateway import ResearchIO
from app.research.graph import NodeDeps
from app.research.models import Mode
from app.research.runner import ResearchRunner
from app.research.targets import ResearchTarget
from app.research.trace.tracer import Tracer, utcnow
from tests.research.fakes import FakeExa, FakeLLM, resolve_answer, result

SECRET = "exa-secret-123"
MEESHO = ResearchTarget(id="c-meesho", name="Meesho", slug="meesho")
RAZORPAY = ResearchTarget(id="c-razorpay", name="Razorpay", slug="razorpay", website="https://razorpay.com")


def research_settings(**overrides) -> Settings:
    return Settings(_env_file=None).model_copy(update={"research_concurrency": 1, **overrides})


def company_exa(**kw) -> FakeExa:
    """Answers "<Name> company official website India" with https://<name>.com."""
    def respond(query: str) -> list[dict]:
        name = query.split()[0]
        return [result(f"https://{name.lower()}.com", title=f"{name} — official site")]
    return FakeExa(respond, **kw)


def company_llm(**kw) -> FakeLLM:
    def respond(system: str, user: str, label: str):
        name = re.search(r"Company name as entered: (.+)", user).group(1).strip()
        return resolve_answer(name, f"https://{name.lower()}.com")
    return FakeLLM(respond, **kw)


async def wired_deps(store, tmp_path, *, exa=None, llm=None, mode=Mode.LIVE, run_id="run1",
                     company=MEESHO, others=(), exa_cap=100, llm_cap=100):
    settings = research_settings()
    await store.insert_run({"run_id": run_id, "status": "running", "control": "none", "created_at": utcnow(),
                            "last_seq": 0, "counters": {},
                            "budget": {"exa_used": 0, "exa_cap": exa_cap, "llm_used": 0, "llm_cap": llm_cap,
                                       "tokens_in": 0, "tokens_out": 0}})
    await store.insert_items([{"run_id": run_id, "company_id": company.id, "company_name": company.name,
                               "company_slug": company.slug, "position": 0, "status": "running", "nodes": {}}])
    tracer = Tracer(store, run_id, secrets={"EXA_API_KEY": SECRET}, flush_interval=0.01)
    await tracer.start()
    budget = Budget(store, run_id, exa_cap=exa_cap, llm_cap=llm_cap)
    io = ResearchIO(mode=mode, exa=exa or company_exa(), llm=llm or company_llm(),
                    fixtures=FixtureStore(tmp_path / "fixtures"), tracer=tracer, budget=budget,
                    store=store, settings=settings)
    deps = NodeDeps(io=io, store=store, tracer=tracer, settings=settings, run_id=run_id)
    state = {"company": company.as_dict(), "others": [o.as_dict() for o in others]}
    return deps, tracer, state


def make_runner(store, tmp_path, *, targets=None, exa=None, llm=None, **overrides):
    """A runner over `store` with fake clients. Returns (runner, live_targets); mutate
    live_targets to simulate an admin archiving a company mid-run."""
    settings = research_settings(research_fixtures_dir=str(tmp_path / "fixtures"), **overrides)
    live_targets = list(targets if targets is not None else [MEESHO, RAZORPAY])
    exa = exa or company_exa()
    llm = llm or company_llm()

    @asynccontextmanager
    async def clients():
        yield exa, llm

    async def fetch():
        return list(live_targets)

    runner = ResearchRunner(store=store, settings=settings, targets=fetch, clients=clients,
                            secrets={"EXA_API_KEY": SECRET}, retry_initial_interval=0.01)
    return runner, live_targets
