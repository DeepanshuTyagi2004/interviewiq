"""DSA collectors. Three structured sources merged later by leetcode slug:
  - snehasishroy/leetcode-companywise-interview-questions: company-folder CSVs (company_tags!)
  - NeetCode 150: vendored JSON (topic patterns)
  - Kaggle leetcode dataset: vendored CSV (topics, acceptance, premium)
All deterministic — no LLM. Headers are matched case-insensitively (sources vary slightly)."""
from __future__ import annotations

import csv
import io
import logging
import re

from app.models.brief import RoundType
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"leetcode\.com/problems/([^/?#]+)")


def leetcode_slug(url: str | None) -> str | None:
    if not url:
        return None
    m = _SLUG_RE.search(url)
    return m.group(1) if m else None


def _norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (h or "").lower())


def _pick(row: dict[str, str], *candidates: str) -> str | None:
    """Case/punctuation-insensitive column lookup with fallbacks."""
    norm = {_norm_header(k): v for k, v in row.items()}
    for c in candidates:
        v = norm.get(_norm_header(c))
        if v not in (None, ""):
            return v
    return None


def _to_float(v: str | None) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).replace("%", "").strip())
    except ValueError:
        return None


def parse_snehasishroy_csv(text: str, company: str) -> list[QuestionRecord]:
    out: list[QuestionRecord] = []
    for row in csv.DictReader(io.StringIO(text)):
        link = _pick(row, "Link", "Leetcode Question Link", "url")
        slug = leetcode_slug(link)
        if not slug:
            continue
        out.append(QuestionRecord(
            slug=slug, round_type=RoundType.DSA,
            title=(_pick(row, "Title") or slug).strip(),
            url=link, sources=["snehasishroy"], company_tags=[company],
            difficulty=_pick(row, "Difficulty"),
            frequency_score=_to_float(_pick(row, "Frequency")),
            acceptance_rate=_to_float(_pick(row, "Acceptance Rate", "Acceptance", "Acceptance %")),
        ))
    return out


def _is_all_window(path: str) -> bool:
    return "all" in path.rsplit("/", 1)[-1].lower()


def parse_snehasishroy_tree(files: dict[str, bytes]) -> list[QuestionRecord]:
    """Walk company folders; per company use the 'All'-window CSV (broadest), else any CSV."""
    by_company: dict[str, list[str]] = {}
    for path in files:
        if not path.lower().endswith(".csv") or "/" not in path:
            continue
        company = path.split("/", 1)[0].strip().lower()
        by_company.setdefault(company, []).append(path)
    out: list[QuestionRecord] = []
    for company, paths in by_company.items():
        chosen = next((p for p in paths if _is_all_window(p)), sorted(paths)[-1])
        text = files[chosen].decode("utf-8", errors="replace")
        out.extend(parse_snehasishroy_csv(text, company))
    logger.info("[questions] snehasishroy: %d companies, %d rows", len(by_company), len(out))
    return out


from app.questions.github import GithubFetchError, fetch_repo_files  # noqa: E402
from app.questions.kaggle import fetch_kaggle_csv  # noqa: E402

_SNEHASISHROY = ("snehasishroy", "leetcode-companywise-interview-questions", "master")


async def collect_snehasishroy(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files(*_SNEHASISHROY, settings)
        return parse_snehasishroy_tree(files)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] snehasishroy fetch failed (%s) — skipping", exc)
        return []


async def collect_neetcode(settings) -> list[QuestionRecord]:
    if not settings.neetcode_repo:
        return []
    try:
        owner_repo, _, ref = settings.neetcode_repo.partition("@")
        ref = ref or "main"
        owner, _, repo = owner_repo.partition("/")
        files = await fetch_repo_files(owner, repo, ref, settings)
        # Try to find and parse the neetcode list file
        path = settings.neetcode_path
        if path and path in files:
            import json
            data = json.loads(files[path].decode("utf-8", errors="replace"))
            return parse_neetcode(data)
        return []
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] neetcode fetch failed (%s) — skipping", exc)
        return []


async def collect_kaggle(settings) -> list[QuestionRecord]:
    try:
        text = await fetch_kaggle_csv(settings)
        if text is None:
            return []
        return parse_kaggle(text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] kaggle collect failed (%s) — skipping", exc)
        return []


def parse_neetcode(data: list[dict]) -> list[QuestionRecord]:
    out: list[QuestionRecord] = []
    for item in data:
        slug = leetcode_slug(item.get("url")) or (item.get("slug") or "").strip()
        if not slug:
            continue
        pattern = item.get("pattern") or item.get("topic")
        out.append(QuestionRecord(
            slug=slug, round_type=RoundType.DSA,
            title=(item.get("title") or slug).strip(),
            url=item.get("url") or f"https://leetcode.com/problems/{slug}/",
            sources=["neetcode-150"], difficulty=item.get("difficulty"),
            topic_tags=[pattern] if pattern else [], is_classic=True,
        ))
    return out


def parse_kaggle(text: str) -> list[QuestionRecord]:
    out: list[QuestionRecord] = []
    for row in csv.DictReader(io.StringIO(text)):
        link = _pick(row, "url", "Link")
        slug = leetcode_slug(link)
        if not slug:
            continue
        topics_raw = _pick(row, "related_topics", "topics", "topic_tags") or ""
        premium_raw = (_pick(row, "is_premium", "premium") or "").strip().lower()
        out.append(QuestionRecord(
            slug=slug, round_type=RoundType.DSA,
            title=(_pick(row, "title") or slug).strip(),
            url=link, sources=["kaggle-leetcode"], difficulty=_pick(row, "difficulty"),
            acceptance_rate=_to_float(_pick(row, "acceptance", "Acceptance Rate")),
            is_premium=premium_raw in ("true", "1", "yes") if premium_raw else None,
            topic_tags=[t.strip() for t in re.split(r"[;,]", topics_raw) if t.strip()],
        ))
    return out
