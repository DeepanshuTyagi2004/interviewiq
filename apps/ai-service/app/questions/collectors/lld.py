"""LLD live collectors. Three repos, each independently fail-safe.
# ponytail: README/solutions.md parsing is brittle; each repo is fail-safe."""
from __future__ import annotations

import logging
import re

from app.models.brief import RoundType
from app.questions.github import fetch_repo_files
from app.questions.parse_md import extract_md_problems
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

_PREFIX = {"lld-primer": "lldp", "machine-coding": "mcq", "grokking-ood": "ood"}
_SLUG_RE = re.compile(r'[^a-z0-9]+')
_VIDEO_HOSTS = ('youtube.com', 'youtu.be')


def _slug(title: str) -> str:
    return _SLUG_RE.sub('-', title.lower()).strip('-')


def _humanize(name: str) -> str:
    return name.replace('-', ' ').replace('_', ' ').title()


def _make_record(title: str, url: str, source: str, is_machine_coding: bool | None = None) -> QuestionRecord:
    prefix = _PREFIX.get(source, source)
    slug = f"{prefix}/{_slug(title)}"
    return QuestionRecord(
        slug=slug, round_type=RoundType.LLD,
        title=title, url=url, sources=[source],
        solution_url=url,
        is_machine_coding=is_machine_coding,
    )


# --- prasadgujar/low-level-design-primer ---

def _first_non_video_link(text: str) -> str | None:
    """Return the first non-video link found in `text`, or None if only videos."""
    for item in extract_md_problems(text):
        url = item["url"]
        if not any(h in url for h in _VIDEO_HOSTS):
            return url
    return None


def enumerate_prasadgujar(files: dict[str, bytes]) -> list[dict]:
    """Parse solutions.md table: | Question | Solutions | Videos |.

    Returns {title, url} where url is the first per-problem non-video Solution link,
    or the index file url as fallback if no per-problem link is available.
    """
    text = files.get("solutions.md", b"").decode("utf-8", errors="replace")
    if not text:
        return []
    out = []
    fallback_url = "https://github.com/prasadgujar/low-level-design-primer/blob/master/solutions.md"
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|") or "Question" in line or "---" in line:
            continue
        cols = [c.strip() for c in line.split("|")]
        cols = [c for c in cols if c]  # drop empty from split
        if not cols:
            continue
        title = cols[0].strip()
        # Clean markdown from title (remove link syntax if present)
        title = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', title).strip()
        title = re.sub(r'^\|?\s*', '', title).strip()
        if not title or len(title) < 3:
            continue
        # Parse Solutions column (index 1) for per-problem link
        solutions_col = cols[1] if len(cols) > 1 else ""
        url = _first_non_video_link(solutions_col) or fallback_url
        out.append({"title": title, "url": url})
    return out


async def _collect_lld_primer(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files("prasadgujar", "low-level-design-primer", "master", settings)
        items = enumerate_prasadgujar(files)
        return [_make_record(i["title"], i["url"], "lld-primer") for i in items]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] lld-primer fetch failed (%s) — skipping", exc)
        return []


# --- lavakumarThatisetti/Machine-Coding-Round ---

_MC_HEADING_RE  = re.compile(r'^### (.+)', re.MULTILINE)
_MC_TREE_URL_RE = re.compile(r'https://github\.com/lavakumarThatisetti/Machine-Coding-Round/tree/[^\s)]+')
_MC_BLOB_URL_RE = re.compile(r'https://github\.com/[^\s)]*blob[^\s)]*/ProblemStatement\.md')


def parse_machine_coding_readme(text: str) -> list[dict]:
    """Split README.md by '### ' headings; extract title + code link per section."""
    sections = _MC_HEADING_RE.split(text)
    # sections = [text_before_first_heading, title1, body1, title2, body2, ...]
    out = []
    # Walk pairs (title, body)
    i = 1
    while i + 1 <= len(sections) - 1:
        title = sections[i].strip()
        body  = sections[i + 1]
        # Prefer "tree/" code link
        url_m = _MC_TREE_URL_RE.search(body)
        if not url_m:
            # Fall back to blob ProblemStatement.md link
            url_m = _MC_BLOB_URL_RE.search(body)
        if url_m:
            out.append({"title": title, "url": url_m.group(0).rstrip(')')})
        i += 2
    return out


async def _collect_machine_coding(settings) -> list[QuestionRecord]:
    if not getattr(settings, 'machine_coding_repo', ''):
        return []
    try:
        owner, _, repo = settings.machine_coding_repo.partition("/")
        files = await fetch_repo_files(owner, repo, settings.machine_coding_ref, settings)
        readme = files.get("README.md", b"").decode("utf-8", errors="replace")
        if not readme:
            return []
        items = parse_machine_coding_readme(readme)
        results = []
        for item in items:
            slug = f"mcq/{_slug(item['title'])}"
            results.append(QuestionRecord(
                slug=slug, round_type=RoundType.LLD,
                title=item["title"], url=item["url"],
                sources=["machine-coding"],
                is_machine_coding=True,
            ))
        logger.info("[questions] machine-coding: %d records", len(results))
        return results
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] machine-coding fetch failed (%s) — skipping", exc)
        return []


# --- tssovi/grokking-the-object-oriented-design-interview ---

def enumerate_grokking(files: dict[str, bytes]) -> list[dict]:
    """Find docs/case-studies/*.md (exclude index.md). Title from humanized filename."""
    out = []
    seen: set[str] = set()
    for path in files:
        parts = path.split('/')
        if len(parts) < 3:
            continue
        if parts[0] != 'docs' or parts[1] != 'case-studies':
            continue
        filename = parts[-1]
        if not filename.endswith('.md') or filename == 'index.md':
            continue
        name = filename[:-3]  # strip .md
        if name in seen:
            continue
        seen.add(name)
        title = _humanize(name)
        url = f"https://github.com/tssovi/grokking-the-object-oriented-design-interview/blob/master/docs/case-studies/{filename}"
        out.append({"title": title, "url": url})
    return out


async def _collect_grokking(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files(
            "tssovi", "grokking-the-object-oriented-design-interview", "master", settings)
        items = enumerate_grokking(files)
        return [_make_record(i["title"], i["url"], "grokking-ood") for i in items]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] grokking-ood fetch failed (%s) — skipping", exc)
        return []


# --- main collector ---

async def collect_lld(settings) -> list[QuestionRecord]:
    """Fetch all 3 LLD repos (each fail-safe). Returns merged records."""
    results: list[QuestionRecord] = []
    seen_slugs: set[str] = set()
    for sub in [
        await _collect_lld_primer(settings),
        await _collect_machine_coding(settings),
        await _collect_grokking(settings),
    ]:
        for r in sub:
            if r.slug not in seen_slugs:
                seen_slugs.add(r.slug)
                results.append(r)
    logger.info("[questions] lld: %d records from 3 repos", len(results))
    return results
