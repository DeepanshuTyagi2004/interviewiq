"""Management command: collect the question bank once, then exit.
Usage (inside the service venv/container):  python -m app.questions_cli [--force]"""
from __future__ import annotations

import asyncio
import logging
import sys

from app.config import get_settings
from app.db import mongo
from app.jobs.question_collection import collect_questions


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    force = "--force" in sys.argv
    await mongo.connect(settings)
    try:
        print(await collect_questions(settings, force=force))
    finally:
        await mongo.close()


if __name__ == "__main__":
    asyncio.run(_main())
