"""DSA collectors. Four structured sources merged later by leetcode slug:
  - snehasishroy/leetcode-companywise-interview-questions: company-folder CSVs (company_tags!)
  - liquidslr/interview-company-wise-problems: the same shape for ~470 companies, with topics
    (adds Indian companies the first lacks: Wipro, Meesho, CRED)
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


def parse_snehasishroy_csv(text: str, company: str, source: str = "snehasishroy",
                           with_acceptance: bool = True) -> list[QuestionRecord]:
    out: list[QuestionRecord] = []
    for row in csv.DictReader(io.StringIO(text)):
        link = _pick(row, "Link", "Leetcode Question Link", "url")
        slug = leetcode_slug(link)
        if not slug:
            continue
        out.append(QuestionRecord(
            slug=slug, round_type=RoundType.DSA,
            title=(_pick(row, "Title") or slug).strip(),
            url=link, sources=[source], company_tags=[company],
            difficulty=_pick(row, "Difficulty"),
            frequency_score=_to_float(_pick(row, "Frequency")),
            acceptance_rate=_to_float(_pick(row, "Acceptance Rate", "Acceptance", "Acceptance %")) if with_acceptance else None,
            topic_tags=[t.strip() for t in re.split(r"[;,]", _pick(row, "Topics") or "") if t.strip()],
        ))
    return out


def _is_all_window(path: str) -> bool:
    return "all" in path.rsplit("/", 1)[-1].lower()


def company_tag(folder: str) -> str:
    """'Walmart Labs' -> 'walmart-labs', the shape snehasishroy's folders already have."""
    return re.sub(r"[^a-z0-9]+", "-", folder.strip().lower()).strip("-")


def parse_snehasishroy_tree(files: dict[str, bytes], source: str = "snehasishroy",
                            with_acceptance: bool = True) -> list[QuestionRecord]:
    """Walk company folders; per company use the 'All'-window CSV (broadest), else any CSV."""
    by_company: dict[str, list[str]] = {}
    for path in files:
        if not path.lower().endswith(".csv") or "/" not in path:
            continue
        company = company_tag(path.split("/", 1)[0])
        if company:
            by_company.setdefault(company, []).append(path)
    out: list[QuestionRecord] = []
    for company, paths in by_company.items():
        chosen = next((p for p in paths if _is_all_window(p)), sorted(paths)[-1])
        text = files[chosen].decode("utf-8", errors="replace")
        out.extend(parse_snehasishroy_csv(text, company, source, with_acceptance))
    logger.info("[questions] %s: %d companies, %d rows", source, len(by_company), len(out))
    return out


from app.questions.github import GithubFetchError, fetch_repo_files  # noqa: E402
from app.questions.kaggle import fetch_kaggle_csv  # noqa: E402

_SNEHASISHROY = ("snehasishroy", "leetcode-companywise-interview-questions", "master")
_LIQUIDSLR = ("liquidslr", "interview-company-wise-problems", "main")


async def collect_snehasishroy(settings) -> list[QuestionRecord]:
    try:
        files = await fetch_repo_files(*_SNEHASISHROY, settings)
        return parse_snehasishroy_tree(files)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] snehasishroy fetch failed (%s) — skipping", exc)
        return []


async def collect_liquidslr(settings) -> list[QuestionRecord]:
    """Its acceptance column is not a percentage (Container With Most Water reads 0.006), so it is not kept."""
    try:
        files = await fetch_repo_files(*_LIQUIDSLR, settings)
        return parse_snehasishroy_tree(files, "liquidslr", with_acceptance=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] liquidslr fetch failed (%s) — skipping", exc)
        return []


async def collect_neetcode(settings) -> list[QuestionRecord]:
    if not settings.neetcode_repo:
        return []
    try:
        owner, _, repo = settings.neetcode_repo.partition("/")
        files = await fetch_repo_files(owner, repo, settings.neetcode_ref, settings)
        return parse_neetcode_md_tree(files)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] neetcode fetch failed (%s) — skipping", exc)
        return []


_NEETCODE_CAT_RE = re.compile(r'^\d+\.\s*')   # strips "01. " or "01." prefix
_SLUG_CLEAN_RE   = re.compile(r'[^a-z0-9-]+')
_H1_LINK_RE      = re.compile(r'^\[(.+)\]\((.+)\)$')  # [text](url) from stripped H1

_DIFFICULTIES = {'easy', 'medium', 'hard'}


def _neetcode_slugify(title: str) -> str:
    """Lowercase, spaces->'-', drop chars other than [a-z0-9-]."""
    return _SLUG_CLEAN_RE.sub('', title.lower().replace(' ', '-')).strip('-')


def parse_neetcode_md_tree(files: dict[str, bytes]) -> list[QuestionRecord]:
    """Walk the NeetCode-150 tree (category folders, per-problem .md files).

    Tree structure: '<NN>. Category Name/<NN>.<NN>.ProblemTitle.md'
    Skip: README.md anywhere, anything under .github/.
    Build one DSA QuestionRecord per problem .md.
    """
    out: list[QuestionRecord] = []
    for path, content in files.items():
        # Skip .github/ subtree and any README.md
        if '.github/' in path or path.startswith('.github'):
            continue
        if '/' not in path:
            continue  # top-level file; skip
        folder, filename = path.split('/', 1)
        if filename.rsplit('/', 1)[-1].lower() == 'readme.md':
            continue
        if not filename.lower().endswith('.md'):
            continue
        # Strip numeric prefix from folder name to get category
        category = _NEETCODE_CAT_RE.sub('', folder).strip()
        if not category:
            continue
        # Parse the markdown
        text = content.decode('utf-8', errors='replace')
        lines = [l for l in text.splitlines() if l.strip()]
        if not lines:
            continue
        # Title from H1 line
        h1 = next((l for l in lines if l.startswith('# ')), None)
        if not h1:
            continue
        raw_title = h1[2:].strip()  # strip '# '
        # H1 may be a markdown link: [226. Invert Binary Tree](https://leetcode.com/problems/...)
        lm = _H1_LINK_RE.match(raw_title)
        if lm:
            link_text = lm.group(1).strip()
            link_url  = lm.group(2).strip()
            # title: strip leading "<number>. " from link text
            title = re.sub(r'^\d+\.\s+', '', link_text).strip()
            lc_slug = leetcode_slug(link_url)
            if lc_slug:
                slug = lc_slug
                url  = f"https://leetcode.com/problems/{slug}/"
            else:
                slug = _neetcode_slugify(title)
                url  = f"https://leetcode.com/problems/{slug}/"
        else:
            # Plain H1: strip leading "<number>. " from title (e.g. "1. Two Sum" -> "Two Sum")
            title = re.sub(r'^\d+\.\s+', '', raw_title).strip()
            slug = _neetcode_slugify(title)
            url  = f"https://leetcode.com/problems/{slug}/"
        if not title or not slug:
            continue
        # Difficulty: first non-empty line after H1 that is Easy/Medium/Hard
        h1_idx = lines.index(h1)
        difficulty = None
        for line in lines[h1_idx + 1:]:
            stripped = line.strip()
            if stripped.lower() in _DIFFICULTIES:
                difficulty = stripped.capitalize()
                break
            break  # only check the first subsequent non-empty line
        out.append(QuestionRecord(
            slug=slug, round_type=RoundType.DSA,
            title=title, url=url,
            sources=["neetcode-150"],
            difficulty=difficulty,
            topic_tags=[category],
            is_classic=True,
        ))
    logger.info("[questions] neetcode-150: %d records", len(out))
    return out


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
