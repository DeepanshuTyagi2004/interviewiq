"""Company identity resolution: DRAFT v1, for human review before production use.

Input: the admin-entered name / website / aliases plus the top Exa results.
Output: the company's canonical identity, with evidence URLs drawn ONLY from those results."""
from __future__ import annotations

import json

PROMPT_NAME = "resolve_company"
PROMPT_VERSION = "v1"
_SNIPPET_CHARS = 1500

SYSTEM = """You identify companies for an Indian interview-preparation platform.
You get the name an admin typed, optional hints, and web search results.
Answer ONLY with one JSON object, no prose:
{
  "is_company": true or false,
  "canonical_name": "the name the company uses for itself, e.g. Meesho",
  "website": "the official homepage URL, or null",
  "aliases": ["other names people use: legal entity, former names, Indian subsidiary"],
  "confidence": "high" or "medium" or "low",
  "evidence_urls": ["URLs from the results that support this"],
  "reasoning": "one or two sentences"
}
Rules:
- Use ONLY the search results. Never invent a website or alias they do not support.
- website is the company's own homepage: never a job board, news site, Wikipedia or LinkedIn.
- At most 6 aliases, and do not repeat canonical_name.
- Copy evidence_urls exactly from the results.
- If the results describe something that is not a company (a person, a product category, nothing relevant), set is_company to false.
- confidence: high = the official site is in the results; medium = consistent third-party evidence only; low = thin or conflicting evidence."""


def build_user(*, name: str, website_hint: str | None, aliases_hint: list[str], results: list[dict]) -> str:
    lines = [
        f"Company name as entered: {name}",
        f"Website hint from admin: {website_hint or 'none'}",
        f"Known aliases: {', '.join(aliases_hint) if aliases_hint else 'none'}",
        "",
        "Search results:",
    ]
    for i, r in enumerate(results, 1):
        lines.append(json.dumps({"n": i, "url": r.get("url"), "title": r.get("title"), "date": r.get("date"),
                                 "text": (r.get("content") or "")[:_SNIPPET_CHARS]}, ensure_ascii=False))
    if not results:
        lines.append("(no results)")
    return "\n".join(lines)
