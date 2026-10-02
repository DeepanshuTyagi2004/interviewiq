"""Build a production ResearchRunner: real Exa + LLM clients per run, targets from interviewiq-api,
secrets from settings. The CLI passes its own store / targets / echo."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from app.config import Settings
from app.exa.client import build_exa_client
from app.llm.client import build_llm_client
from app.research.runner import ResearchRunner
from app.research.store import ResearchStore
from app.research.targets import ResearchTarget, fetch_research_targets
from app.research.trace.redact import secrets_from_settings


def build_research_runner(settings: Settings, *, store: ResearchStore,
                          targets: Callable[[], Awaitable[list[ResearchTarget]]] | None = None,
                          echo: Callable[[dict], None] | None = None) -> ResearchRunner:
    @asynccontextmanager
    async def clients():
        exa = build_exa_client(settings)
        llm = build_llm_client(settings)
        try:
            yield exa, llm
        finally:
            await llm.aclose()

    async def fetch() -> list[ResearchTarget]:
        return await fetch_research_targets(settings)

    return ResearchRunner(store=store, settings=settings, targets=targets or fetch, clients=clients,
                          secrets=secrets_from_settings(settings), echo=echo)
