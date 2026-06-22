"""System-Design and LLD collectors. These repos are prose, not parseable question banks,
so the seed lists (title+url+source from the named repos) are curated JSON vendored in
app/questions/data/. The LLM enrich pass (Task 7) fills company/level/components/patterns.
# ponytail: re-curate the JSON on COLLECTION_VERSION bump; auto-enumerating donnemartin's
# solution folders is a later enhancement if the curated set goes stale."""
from __future__ import annotations

import os

from app.models.brief import RoundType
from app.questions.models import QuestionRecord

# Short source -> slug prefix, so SD/LLD slugs are globally unique and traceable.
_PREFIX = {"system-design-primer": "sdp", "lld-primer": "lldp", "machine-coding": "mcq",
           "grokking-ood": "ood", "system-design": "ksd", "awesome-system-design": "asd",
           "interviewready": "irsd"}


def load_data_file(settings, filename: str) -> str:
    path = os.path.join(settings.questions_data_dir, filename)
    with open(path, encoding="utf-8") as f:
        return f.read()


def load_seed_questions(data: list[dict], round_type: RoundType) -> list[QuestionRecord]:
    out: list[QuestionRecord] = []
    for item in data:
        source = (item.get("source") or "seed").strip()
        prefix = _PREFIX.get(source, source)
        raw_slug = (item.get("slug") or item.get("title") or "").strip().lower().replace(" ", "-")
        if not raw_slug or not item.get("url"):
            continue
        out.append(QuestionRecord(
            slug=f"{prefix}/{raw_slug}", round_type=round_type,
            title=(item.get("title") or raw_slug).strip(), url=item["url"],
            sources=[source], difficulty=item.get("difficulty"),
            category=item.get("category"), domain=item.get("domain"),
            solution_url=item.get("solution_url") or item.get("url"),
            is_machine_coding=item.get("is_machine_coding"),
        ))
    return out
