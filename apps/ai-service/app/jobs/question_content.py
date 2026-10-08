"""RUN_STORE-tracked content generation, mirroring question_collection.execute_tracked_collection.
When the index is empty the collection runs first, so one click builds the bank from nothing."""
from __future__ import annotations

import logging

from app.config import Settings
from app.db import repositories as repo
from app.jobs.question_collection import collect_questions
from app.jobs.run_store import RUN_STORE
from app.questions.content.generate import generate_content

logger = logging.getLogger(__name__)


async def execute_tracked_generation(settings: Settings, run_id: str, *, round_type: str | None = None,
                                     limit: int | None = None, force: bool = False) -> dict:
    try:
        if await repo.count_questions_matching() == 0:
            RUN_STORE.set_stage("question_collection")
            RUN_STORE.record_stage_result("question_collection", await collect_questions(settings))
        RUN_STORE.set_stage("question_content")
        counts = await generate_content(settings, round_type=round_type, limit=limit, force=force)
        RUN_STORE.record_stage_result("question_content", counts)
        RUN_STORE.finish("completed")
        return counts
    except Exception as exc:  # noqa: BLE001
        logger.exception("Question content generation failed")
        RUN_STORE.finish("failed", error=str(exc))
        raise
