"""Management command: run Perplexity brief generation once for all combinations,
then exit. Satisfies the "run the job manually" path.

Usage (inside the service venv/container):
    python -m app.cli
"""
from __future__ import annotations

import asyncio
import logging

from app.config import get_settings
from app.db import mongo
from app.jobs.brief_generation import run_brief_generation
from app.perplexity.client import build_perplexity_client


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    await mongo.connect(settings)
    perplexity = build_perplexity_client(settings)
    try:
        result = await run_brief_generation(perplexity, settings)
        print(result)
    finally:
        await mongo.close()


if __name__ == "__main__":
    asyncio.run(_main())
