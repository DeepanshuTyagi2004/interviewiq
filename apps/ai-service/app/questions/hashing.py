"""Content hashing for QuestionRecord source fields.

Only source-derived fields are hashed (title, url, difficulty, topic_tags, company_tags,
level_tags, sources, solution_url, is_machine_coding, is_classic, is_premium,
acceptance_rate, frequency_score). Enrichment fields (patterns_tested, components_tested,
entities_involved, assess, category, domain, evaluation_mode, estimated_duration_mins,
enrichment_status) are intentionally excluded — an enrich-only change must not trigger
re-collection.

Tag lists are sorted before hashing so insertion-order differences don't produce different
hashes (same logical content = same hash).
"""
from __future__ import annotations

import hashlib
import json

from app.questions.models import QuestionRecord

# Source-only fields — the ones a collector can change independently of the enrich pass.
_SOURCE_FIELDS = (
    "slug", "round_type", "title", "url", "difficulty",
    "sources", "topic_tags", "company_tags", "level_tags",
    "solution_url", "is_machine_coding", "is_classic", "is_premium",
    "acceptance_rate", "frequency_score",
)


# Index facts the content prompt sees; a change here (or a prompt version bump) regenerates content.
_CONTENT_FIELDS = ("slug", "round_type", "title", "difficulty", "topic_tags", "company_tags", "level_tags",
                   "category", "patterns_tested", "components_tested", "entities_involved", "domain", "evaluation_mode", "is_machine_coding")


def compute_content_hash(record: QuestionRecord, content_version: str) -> str:
    """SHA-256 of the index facts the prompt uses plus the prompt version. 'sha256:<hex>'."""
    payload: dict = {"content_version": content_version}
    for f in _CONTENT_FIELDS:
        v = getattr(record, f, None)
        if hasattr(v, "value"):
            v = v.value
        if isinstance(v, list):
            v = sorted(x.value if hasattr(x, "value") else str(x) for x in v)
        payload[f] = v
    return "sha256:" + hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def compute_source_hash(record: QuestionRecord) -> str:
    """SHA-256 of the record's source-only fields. Returns 'sha256:<hex>'."""
    payload: dict = {}
    for f in _SOURCE_FIELDS:
        v = getattr(record, f, None)
        # Enums -> value string; lists -> sorted for stability.
        if hasattr(v, "value"):
            v = v.value
        if isinstance(v, list):
            v = sorted(x.value if hasattr(x, "value") else str(x) for x in v)
        payload[f] = v
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()
    return f"sha256:{digest}"
