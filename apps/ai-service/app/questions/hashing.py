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


def compute_source_hash(record: QuestionRecord) -> str:
    """SHA-256 of the record's source-only fields. Returns 'sha256:<hex>'."""
    payload: dict = {}
    for f in _SOURCE_FIELDS:
        v = getattr(record, f, None)
        # Enums -> value string; lists -> sorted for stability.
        if hasattr(v, "value"):
            v = v.value
        if isinstance(v, list):
            v = sorted(str(x) for x in v)
        payload[f] = v
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()
    return f"sha256:{digest}"
