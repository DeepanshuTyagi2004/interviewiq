"""System-Design live collectors. Six repos, each independently fail-safe.
# ponytail: README parsing is brittle by nature; each repo is independently fail-safe so
# an upstream restructure drops that source to 0, never breaks the run."""
from __future__ import annotations

import logging
import re

from app.models.brief import RoundType
from app.questions.github import fetch_repo_files
from app.questions.parse_md import extract_md_problems
from app.questions.quality import is_design_problem
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

_VIDEO_HOSTS = ('youtube.com', 'youtu.be')

# Short source -> slug prefix (mirrors design.py _PREFIX)
_PREFIX = {
    "system-design-primer": "sdp",
    "system-design": "ksd",
    "awesome-system-design": "asd",
    "interviewready": "irsd",
    "checkcheckzz": "ccz",
    "grokking-sd": "gksd",
}

_SLUG_RE = re.compile(r'[^a-z0-9]+')


def _slug(title: str) -> str:
    return _SLUG_RE.sub('-', title.lower()).strip('-')


def _best_url(links: list[dict]) -> str | None:
    """Given a list of {title, url} items, return the first non-video url.
    Falls back to the first video url if no non-video link is available."""
    non_video = [i["url"] for i in links if not any(h in i["url"] for h in _VIDEO_HOSTS)]
    if non_video:
        return non_video[0]
    video = [i["url"] for i in links if links]
    return video[0] if video else None


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
    """Extract problems from 'System Design Interview Problems' section.

    Processes each line independently so that if a line has both a video link
    and a non-video link, the non-video link is preferred.
    """
    m = re.search(r'## (?:💻 )?System Design Interview Problems\b(.*?)(?:\n## |\Z)', text, re.DOTALL)
    if not m:
        return []
    section = m.group(1)
    out = []
    seen_titles: set[str] = set()
    for line in section.splitlines():
        links = extract_md_problems(line)
        if not links:
            continue
        # First link title is the problem name; pick best url across all links on this line
        title = links[0]["title"]
        if title in seen_titles:
            continue
        seen_titles.add(title)
        url = _best_url(links)
        if url and not any(h in url for h in _VIDEO_HOSTS):
            out.append({"title": title, "url": url})
    return out


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
    """Each ## Heading in the README is a design topic/problem.

    Produces README anchor urls (fetchable GitHub content). Example:
      https://github.com/InterviewReady/system-design-resources/blob/main/README.md#video-processing
    """
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


# --- checkcheckzz/system-design-interview ---

def _parse_checkcheckzz_readme(text: str) -> list[dict]:
    """Bold '**Design a CDN network**' lines in the 'Hot Questions and Reference' section."""
    m = re.search(r"name='qs'>Hot Questions(.*?)(?:\n### |\Z)", text, re.DOTALL)
    if not m:
        return []
    url = "https://github.com/checkcheckzz/system-design-interview#qs"
    out, seen = [], set()
    for t in re.findall(r"^\*\*(Design[^*]+)\*\*", m.group(1), re.MULTILINE):
        title = t.strip()
        if title.lower() not in seen:
            seen.add(title.lower())
            out.append({"title": title, "url": url})
    return out


async def _collect_checkcheckzz(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files("checkcheckzz", "system-design-interview", "master", settings)
        readme = files.get("README.md", b"").decode("utf-8", errors="replace")
        return [_make_record(i["title"], i["url"], "checkcheckzz") for i in _parse_checkcheckzz_readme(readme)]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] checkcheckzz fetch failed (%s) — skipping", exc)
        return []


# --- Jeevan-kumar-Raj/Grokking-System-Design ---

def _parse_grokking_summary(text: str) -> list[dict]:
    """The 'Designs' list in SUMMARY.md: '- [Short URL Service](designs/short-url.md)'."""
    m = re.search(r"^\* Designs\s*$(.*?)(?:^\* |\Z)", text, re.DOTALL | re.MULTILINE)
    if not m:
        return []
    base = "https://github.com/Jeevan-kumar-Raj/Grokking-System-Design/blob/master/"
    return [{"title": f"Design {t.strip()}", "url": base + u.strip()}
            for t, u in re.findall(r"\[([^\]]+)\]\((designs/[^)]+)\)", m.group(1))]


async def _collect_grokking_sd(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files("Jeevan-kumar-Raj", "Grokking-System-Design", "master", settings)
        summary = files.get("SUMMARY.md", b"").decode("utf-8", errors="replace")
        return [_make_record(i["title"], i["url"], "grokking-sd") for i in _parse_grokking_summary(summary)]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] grokking-sd fetch failed (%s) — skipping", exc)
        return []


# --- main collector ---

async def collect_system_design(settings) -> list[QuestionRecord]:
    """Fetch all 6 SD repos (each fail-safe). Merge and de-dupe by slug."""
    results: list[QuestionRecord] = []
    seen_slugs: set[str] = set()
    for sub in [
        await _collect_donnemartin(settings),
        await _collect_karanpratapsingh(settings),
        await _collect_ashishps1(settings),
        await _collect_interviewready(settings),
        await _collect_checkcheckzz(settings),
        await _collect_grokking_sd(settings),
    ]:
        for r in sub:
            if not is_design_problem(r.title):
                continue          # a concept ("Caching") or a reading list, not a system to design
            if r.slug not in seen_slugs:
                seen_slugs.add(r.slug)
                results.append(r)
    logger.info("[questions] system-design: %d records from 6 repos", len(results))
    return results
