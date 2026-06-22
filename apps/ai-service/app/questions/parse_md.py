"""Reusable markdown problem-list extractor.
# ponytail: regex over a full md parser — these are link lists, not documents; breaks loudly
# (empty result) on upstream restructure, which the per-source fail-safe absorbs."""
from __future__ import annotations
import re

_LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')

def extract_md_problems(text: str, *, link_filter: str | None = None) -> list[dict]:
    seen_urls: set[str] = set()
    out: list[dict] = []
    for m in _LINK_RE.finditer(text):
        title = m.group(1).strip()
        url = m.group(2).strip()
        if not title or not url or url.startswith('#'):
            continue
        if link_filter and link_filter not in url:
            continue
        if url in seen_urls:
            continue
        seen_urls.add(url)
        out.append({"title": title, "url": url})
    return out
