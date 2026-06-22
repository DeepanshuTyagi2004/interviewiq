"""Enrichment prompt for System-Design / LLD questions. The source repos give title+url
only; this asks the LLM to infer the metadata that isn't in the source (company/level
tags, components/patterns, duration). Mirrors app/prompts/extract_source.py style."""
from __future__ import annotations

from app.questions.models import QuestionRecord

ENRICH_VERSION = "v1"

ENRICH_SYSTEM = (
    "You label a well-known software interview question with metadata for an Indian campus-placement "
    "prep platform. Use widely-known facts about the problem; when unsure, return an empty list or null "
    "rather than inventing. Respond with VALID JSON ONLY — a single object, no markdown, no preamble."
)

_SD_SCHEMA = """
Return a JSON object (use [] / null where unknown; never invent companies):
{
  "company_tags": ["<lowercase company slugs that commonly ask this, e.g. amazon, flipkart>"],
  "level_tags": ["<sde1|sde2|sde3 where this is typically asked>"],
  "topic_tags": ["<concepts, e.g. scalability, caching, sharding>"],
  "components_tested": ["<system components, e.g. load-balancer, database-design, caching, api-design>"],
  "category": "<one of: web-service|social|infrastructure|storage|messaging|search or null>",
  "estimated_duration_mins": <int|null>
}
"""

_LLD_SCHEMA = """
Return a JSON object (use [] / null where unknown; never invent companies):
{
  "company_tags": ["<lowercase company slugs that commonly ask this>"],
  "level_tags": ["<sde1|sde2|sde3>"],
  "topic_tags": ["<concepts, e.g. oops, concurrency, design-patterns>"],
  "patterns_tested": ["<design patterns, e.g. factory, singleton, observer, strategy>"],
  "entities_involved": ["<core domain entities, e.g. User, Booking, Payment>"],
  "domain": "<short domain word, e.g. booking, facility, catalog or null>",
  "evaluation_mode": "<working-code if a timed machine-coding implementation, else discussion>",
  "assess": ["<what to grade, e.g. extensibility, design-patterns, correctness>"],
  "estimated_duration_mins": <int|null>
}
"""


def build_enrich_prompt(record: QuestionRecord) -> str:
    schema = _LLD_SCHEMA if record.round_type.value == "lld" else _SD_SCHEMA
    return (
        f"Round type: {record.round_type.value}\n"
        f"Question: {record.title}\n"
        f"Reference URL: {record.url}\n\n"
        f"Label this question.\n{schema}"
    )
