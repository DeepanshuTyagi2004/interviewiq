"""System-Design live collectors. Four repos, each independently fail-safe.
# ponytail: README parsing is brittle by nature; each repo is independently fail-safe so
# an upstream restructure drops that source to 0, never breaks the run."""
from __future__ import annotations

import logging
import re

from app.models.brief import RoundType
from app.questions.github import fetch_repo_files
from app.questions.parse_md import extract_md_problems
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

# Short source -> slug prefix (mirrors design.py _PREFIX)
_PREFIX = {
    "system-design-primer": "sdp",
    "system-design": "ksd",
    "awesome-system-design": "asd",
    "interviewready": "irsd",
}

_SLUG_RE = re.compile(r'[^a-z0-9]+')


def _slug(title: str) -> str:
    return _SLUG_RE.sub('-', title.lower()).strip('-')


def _humanize(name: str) -> str:
    return name.replace('_', ' ').replace('-', ' ').title()


def _make_record(title: str, url: str, source: str, solution_url: str | None = None) -> QuestionRecord:
    prefix = _PREFIX.get(source, source)
    slug = f"{prefix}/{_slug(title)}"
    return QuestionRecord(
        slug=slug, round_type=RoundType.SYSTEM_DESIGN,
        title=title, url=url, sources=[source],
        solution_url=solution_url or url,
    )


# --- donnemartin/system-design-primer ---

def enumerate_donnemartin(files: dict[str, bytes]) -> list[dict]:
    """Find solutions/system_design/<name>/README.md (exclude template). Returns list of {title, url}."""
    seen: set[str] = set()
    out: list[dict] = []
    for path in files:
        # path looks like: solutions/system_design/<name>/README.md
        parts = path.split('/')
        if len(parts) < 4:
            continue
        if parts[0] != 'solutions' or parts[1] != 'system_design':
            continue
        if parts[-1].lower() != 'readme.md':
            continue
        name = parts[2]
        if not name or name.lower() == 'template' or name in seen:
            continue
        seen.add(name)
        title = _humanize(name)
        url = f"https://github.com/donnemartin/system-design-primer/tree/master/solutions/system_design/{name}"
        out.append({"title": title, "url": url})
    return out


async def _collect_donnemartin(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files("donnemartin", "system-design-primer", "master", settings)
        items = enumerate_donnemartin(files)
        return [_make_record(i["title"], i["url"], "system-design-primer", i["url"]) for i in items]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] donnemartin fetch failed (%s) — skipping", exc)
        return []


# --- karanpratapsingh/system-design ---

def _parse_karan_readme(text: str) -> list[dict]:
    """Chapter V of karanpratapsingh/system-design has real design problems as anchor links."""
    m = re.search(r'Chapter V\b(.*?)(?:\n- \*\*|\Z)', text, re.DOTALL)
    if not m:
        return []
    section = m.group(1)
    base = "https://github.com/karanpratapsingh/system-design/blob/main/README.md"
    out = []
    for link_m in re.finditer(r'\[([^\]]+)\]\((#[^)]+)\)', section):
        title = link_m.group(1).strip()
        anchor = link_m.group(2).strip()
        out.append({"title": title, "url": base + anchor})
    return out


async def _collect_karanpratapsingh(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files("karanpratapsingh", "system-design", "main", settings)
        readme = files.get("README.md", b"").decode("utf-8", errors="replace")
        items = _parse_karan_readme(readme)
        return [_make_record(i["title"], i["url"], "system-design") for i in items]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] karanpratapsingh fetch failed (%s) — skipping", exc)
        return []


# --- ashishps1/awesome-system-design-resources ---

def _parse_ashish_readme(text: str) -> list[dict]:
    """Extract problems from 'System Design Interview Problems' section."""
    m = re.search(r'## (?:💻 )?System Design Interview Problems\b(.*?)(?:\n## |\Z)', text, re.DOTALL)
    if not m:
        return []
    section = m.group(1)
    return extract_md_problems(section)


async def _collect_ashishps1(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files("ashishps1", "awesome-system-design-resources", "main", settings)
        readme = files.get("README.md", b"").decode("utf-8", errors="replace")
        items = _parse_ashish_readme(readme)
        return [_make_record(i["title"], i["url"], "awesome-system-design") for i in items]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] ashishps1 fetch failed (%s) — skipping", exc)
        return []


# --- InterviewReady/system-design-resources ---

def _parse_interviewready_readme(text: str) -> list[dict]:
    """Each ## Heading in the README is a design topic/problem."""
    base = "https://github.com/InterviewReady/system-design-resources/blob/main/README.md"
    out = []
    for m in re.finditer(r'^## (.+)$', text, re.MULTILINE):
        title = m.group(1).strip()
        if not title or title.lower() in ('table of contents',):
            continue
        anchor = '#' + re.sub(r'[^a-z0-9-]', '', title.lower().replace(' ', '-').replace('/', '').replace('(', '').replace(')', ''))
        out.append({"title": title, "url": base + anchor})
    return out


async def _collect_interviewready(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files("InterviewReady", "system-design-resources", "main", settings)
        readme = files.get("README.md", b"").decode("utf-8", errors="replace")
        items = _parse_interviewready_readme(readme)
        return [_make_record(i["title"], i["url"], "interviewready") for i in items]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] interviewready fetch failed (%s) — skipping", exc)
        return []


# --- main collector ---

async def collect_system_design(settings) -> list[QuestionRecord]:
    """Fetch all 4 SD repos (each fail-safe). Merge and de-dupe by slug."""
    results: list[QuestionRecord] = []
    seen_slugs: set[str] = set()
    for sub in [
        await _collect_donnemartin(settings),
        await _collect_karanpratapsingh(settings),
        await _collect_ashishps1(settings),
        await _collect_interviewready(settings),
    ]:
        for r in sub:
            if r.slug not in seen_slugs:
                seen_slugs.add(r.slug)
                results.append(r)
    logger.info("[questions] system-design: %d records from 4 repos", len(results))
    return results
