"""Management command: collect the question bank, or generate problem content, then exit.
Usage (inside the service venv/container):
  python -m app.questions_cli [--force]                                               # collect the index
  python -m app.questions_cli --generate [--round-type dsa] [--limit 25] [--force]    # content (docs/question-bank.md)"""
from __future__ import annotations

import asyncio
import logging
import sys

from app.config import get_settings
from app.db import mongo
from app.jobs.question_collection import collect_questions
from app.questions.content.generate import generate_content


def _arg(name: str) -> str | None:
    args = sys.argv[1:]
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    force = "--force" in sys.argv
    await mongo.connect(settings)
    try:
        if "--generate" in sys.argv:
            limit = _arg("--limit")
            print(await generate_content(settings, round_type=_arg("--round-type"), limit=int(limit) if limit else None, force=force))
        else:
            print(await collect_questions(settings, force=force))
    finally:
        await mongo.close()


if __name__ == "__main__":
    asyncio.run(_main())
