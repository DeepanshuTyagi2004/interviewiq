"""Behavioural / HR live collectors.

Two scraped repos + vendored static JSON, each independently fail-safe (returns [] on
failure) — mirrors the SD/LLD collectors. Unlike DSA/SD/LLD, a behavioural question IS
its own content (one line, no copyright), so `title` holds the full question text and
`url` points at the source page for provenance — there is nothing to fetch live.

Sources:
  - yangshun/tech-interview-handbook  → general + per-company behavioural (scraped md)
  - rohan-paul/Awesome-JavaScript-Interviews → Indian-company HR / soft questions (scraped md)
  - vendored JSON (<data_dir>/behavioural/*.json) → Amazon Leadership Principles, Google Googleyness,
    Atlassian values, Microsoft culture, our own competency set and a hiring-manager set
"""
from __future__ import annotations

import glob
import json
import logging
import os
import re

from app.models.brief import RoundType
from app.questions.github import fetch_repo_files
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

_PREFIX = {
    "tech-interview-handbook": "tih",
    "rohan-soft": "rhn",
    "amazon-leadership-principles": "alp",
    "google-googleyness": "ggl",
    "atlassian-values": "atl",
    "microsoft-culture": "msc",
    "interviewiq-behavioural": "iqb",
    "interviewiq-hiring-manager": "iqhm",
}

_TIH_FILE = "apps/website/contents/behavioral-interview-questions.md"
_TIH_PAGE = "https://www.techinterviewhandbook.org/behavioral-interview-questions/"
_ROHAN_FILE = "Collections-of-Questions-NOT-drafted-Ans/Soft-Behavioral-questions.md"

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_LIST_ITEM_RE = re.compile(r"^\s*(?:[-*]|\d+\.)\s+(.+)$")
_HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.+)$")

# Keyword → category. First match wins; conflict words before the generic team/help bucket.
# ponytail: keyword heuristic — cheap and source-agnostic. Upgrade to an LLM classify pass
# only if mis-bucketing ("led a team" landing in conflict-teamwork) actually matters downstream.
_CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("conflict-teamwork", ("conflict", "disagree", "argument")),
    ("failure-learning", ("fail", "mistake", "wrong", "setback", "criticism", "criticized",
                          "negative feedback", "obstacle", "difficult bug", "persevere")),
    ("leadership-ownership", ("lead", "ownership", "initiative", "approval", "risk", "influence",
                              "convince", "persuade", "decision", "push", "above and beyond",
                              "went out of", "took charge", "drove", "invent")),
    ("strengths-weaknesses", ("strength", "weakness", "describe you", "words would", "best work",
                              "good at", "aspects of your work")),
    ("self-introduction", ("yourself", "why do you", "why are you", "looking for", "career", "goal",
                           "passionate", "good fit", "fit for", "excites you", "frustrate", "leave your")),
    ("conflict-teamwork", ("teammate", "team member", "co-worker", "coworker", "collaborat",
                           "peer", "struggling", "mentor", "help")),
)


def _slug(text: str) -> str:
    return _SLUG_RE.sub("-", text.lower()).strip("-")[:90]


def _anchor(heading: str) -> str:
    return "#" + _SLUG_RE.sub("-", heading.lower()).strip("-")


def _categorize(title: str) -> str:
    low = title.lower()
    for category, keywords in _CATEGORY_RULES:
        if any(k in low for k in keywords):
            return category
    return "general-behavioural"


def _clean(text: str) -> str:
    """Strip markdown link syntax and surrounding emphasis from a question line."""
    text = _MD_LINK_RE.sub(r"\1", text)
    return text.strip().strip("*_").strip()


def _is_question_line(text: str) -> bool:
    """A real behavioural question: multi-word prose, not a 'Source:' note or a bare URL."""
    if len(text) < 15 or " " not in text:
        return False
    low = text.lower()
    if low.startswith("source") or text.startswith("http") or text.startswith("("):
        return False
    return any(c.isalpha() for c in text)


# --- yangshun/tech-interview-handbook ---

def parse_tih_behavioural(text: str) -> list[dict]:
    """Walk the markdown: numbered list under the 'most commonly asked' heading is general;
    each '## <Company> Software Engineer behavioral interview questions' section is company-tagged.
    Returns [{title, company_tags, anchor}]."""
    out: list[dict] = []
    seen: set[str] = set()
    heading = ""
    company: list[str] = []
    anchor = ""
    for raw in text.splitlines():
        hm = _HEADING_RE.match(raw)
        if hm:
            heading = hm.group(1).strip()
            anchor = _anchor(heading)
            cm = re.match(r"(.+?)\s+Software Engineer behavioral interview questions", heading, re.I)
            company = [cm.group(1).strip().lower()] if cm else []
            continue
        if not heading:  # still in frontmatter / intro before any heading
            continue
        im = _LIST_ITEM_RE.match(raw)
        if not im:
            continue
        title = _clean(im.group(1))
        if not _is_question_line(title) or title.lower() in seen:
            continue
        seen.add(title.lower())
        out.append({"title": title, "company_tags": company, "anchor": anchor})
    return out


async def _collect_tih(settings) -> list[QuestionRecord]:
    try:
        owner, _, repo = settings.tih_repo.partition("/")
        files = await fetch_repo_files(owner, repo, settings.tih_ref, settings)
        text = files.get(_TIH_FILE, b"").decode("utf-8", errors="replace")
        if not text:
            logger.warning("[questions] tih: %s not found in repo — skipping", _TIH_FILE)
            return []
        items = parse_tih_behavioural(text)
        recs = [_make_record(i["title"], _TIH_PAGE + i["anchor"], "tech-interview-handbook",
                             company_tags=i["company_tags"]) for i in items]
        logger.info("[questions] tih: %d records", len(recs))
        return recs
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] tih fetch failed (%s) — skipping", exc)
        return []


# --- rohan-paul/Awesome-JavaScript-Interviews ---

def parse_rohan_behavioural(text: str) -> list[dict]:
    """Bullet (- / *) lines under headings; heading mentioning Amazon tags the company.
    Numbered reference links ('1.https://...') have no space after the dot, so the list
    regex skips them. Returns [{title, company_tags}]."""
    out: list[dict] = []
    seen: set[str] = set()
    company: list[str] = []
    for raw in text.splitlines():
        hm = _HEADING_RE.match(raw)
        if hm:
            company = ["amazon"] if "amazon" in hm.group(1).lower() else []
            continue
        im = _LIST_ITEM_RE.match(raw)
        if not im:
            continue
        title = _clean(im.group(1))
        if not _is_question_line(title) or title.lower() in seen:
            continue
        seen.add(title.lower())
        out.append({"title": title, "company_tags": company})
    return out


async def _collect_rohan(settings) -> list[QuestionRecord]:
    try:
        owner, _, repo = settings.rohan_behavioural_repo.partition("/")
        files = await fetch_repo_files(owner, repo, settings.rohan_behavioural_ref, settings)
        text = files.get(_ROHAN_FILE, b"").decode("utf-8", errors="replace")
        if not text:
            logger.warning("[questions] rohan: %s not found — skipping", _ROHAN_FILE)
            return []
        url = (f"https://github.com/{settings.rohan_behavioural_repo}/blob/"
               f"{settings.rohan_behavioural_ref}/{_ROHAN_FILE}")
        items = parse_rohan_behavioural(text)
        recs = [_make_record(i["title"], url, "rohan-soft", company_tags=i["company_tags"])
                for i in items]
        logger.info("[questions] rohan: %d records", len(recs))
        return recs
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] rohan fetch failed (%s) — skipping", exc)
        return []


# --- vendored static JSON (Amazon LP, Googleyness, Atlassian values, Microsoft culture) ---

def _collect_vendored(settings) -> list[QuestionRecord]:
    """A file may set `round_type` (default behavioural) and each question its own `category`."""
    data_dir = os.path.join(settings.questions_data_dir, "behavioural")
    recs: list[QuestionRecord] = []
    for path in sorted(glob.glob(os.path.join(data_dir, "*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
            source = doc["source"]
            url = doc.get("url") or ""
            company_tags = doc.get("company_tags", [])
            category = doc.get("category")
            round_type = RoundType(doc.get("round_type", RoundType.BEHAVIOURAL.value))
            for q in doc["questions"]:
                principle = q.get("principle")
                recs.append(_make_record(
                    q["title"], url, source,
                    company_tags=company_tags, category=q.get("category") or category,
                    topic_tags=[principle] if principle else None, round_type=round_type))
        except Exception as exc:  # noqa: BLE001 — one bad seed file must not abort the run
            logger.warning("[questions] vendored behavioural %s failed (%s) — skipping", path, exc)
    logger.info("[questions] vendored behavioural: %d records", len(recs))
    return recs


# --- record + merge ---

def _make_record(title: str, url: str, source: str, *, company_tags=None,
                 category: str | None = None, topic_tags=None,
                 round_type: RoundType = RoundType.BEHAVIOURAL) -> QuestionRecord:
    prefix = _PREFIX.get(source, source)
    return QuestionRecord(
        slug=f"{prefix}/{_slug(title)}",
        round_type=round_type,
        title=title,
        url=url,
        sources=[source],
        company_tags=company_tags or [],
        category=category or _categorize(title),
        topic_tags=topic_tags or [],
    )


async def collect_behavioural(settings) -> list[QuestionRecord]:
    """Fetch both scraped repos (fail-safe) + vendored JSON. Merge and de-dupe by slug."""
    results: list[QuestionRecord] = []
    seen: set[str] = set()
    for sub in [
        await _collect_tih(settings),
        await _collect_rohan(settings),
        _collect_vendored(settings),
    ]:
        for r in sub:
            if r.slug not in seen:
                seen.add(r.slug)
                results.append(r)
    logger.info("[questions] behavioural: %d records from 2 repos + vendored", len(results))
    return results
