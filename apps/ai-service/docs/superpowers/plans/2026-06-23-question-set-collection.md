# Question Set Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect DSA / System-Design / LLD interview questions from public sources into a thin, richly-tagged MongoDB bank (metadata + URL only), triggerable from the admin console next to the existing ingestion button.

**Architecture:** New `app/questions/` package in `interviewiq-ai-service` mirrors the brief pipeline. DSA is collected deterministically (snehasishroy repo tarball + vendored NeetCode/Kaggle data, merged by LeetCode slug). System-Design and LLD are vendored curated seed lists (title+url+source from the named repos) enriched by one LLM pass each. Everything upserts into a new `interview_questions` collection. A collection run reuses the existing global `RUN_STORE` (scrape and collect are mutually exclusive), so the existing `/admin/scrape/status` feed shows it. The backend `IntelligenceController` proxies a new `/questions/collect` trigger; the frontend adds a "Collect Questions" button next to "Run ingestion".

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, Motor (async Mongo), httpx, stdlib `tarfile`/`csv`/`json`. Backend: Spring Boot 4 / Java 25 (RestClient, Jackson 3 `tools.jackson`). Frontend: Next.js 16 / TanStack Query v5 / TypeScript.

## Global Constraints

- **Copyright rule (never violate):** store question **metadata + a canonical URL only**. Never store the full problem statement / body. (Spec §2.)
- **Round-type values** match `app.models.brief.RoundType`: `dsa`, `system-design`, `lld`. Reuse that enum + `Difficulty`; do not redefine.
- **Pydantic v2 style:** `from __future__ import annotations` at top of every module; optionals as `X | None = None`; list defaults `Field(default_factory=list)`; `@field_validator(..., mode="before")`.
- **New env vars** follow the `Settings` pattern: `Field(default, alias="UPPER_SNAKE")`, list vars use `Annotated[list[str], NoDecode]` + a `mode="before"` splitter. `get_settings()` is `@lru_cache`d — tests must call `get_settings.cache_clear()` if they set env.
- **Bump `COLLECTION_VERSION`** to force re-collection (mirrors `PIPELINE_VERSION`).
- **Tests:** run with `.venv/bin/python -m pytest tests/<file> -v`. If pytest is missing from the venv: `.venv/bin/pip install pytest`. **No live network or LLM calls in tests** — mock at the function boundary; build tar/CSV/JSON fixtures in-memory.
- **httpx pattern:** for one-shot fetches use a per-call `async with httpx.AsyncClient(timeout=...)` (like `app/exa/client.py` / `app/targets.py`), not a shared client.
- **Commits:** one per task, conventional-commit style. Do not push.

---

## File Structure

**interviewiq-ai-service (new unless noted):**
- `app/questions/__init__.py`
- `app/questions/models.py` — `QuestionRecord` Pydantic model
- `app/questions/github.py` — repo-tarball fetch + pure `parse_tarball`
- `app/questions/collectors/__init__.py`
- `app/questions/collectors/dsa.py` — slug derivation, snehasishroy/neetcode/kaggle parsers
- `app/questions/collectors/design.py` — vendored SD/LLD seed loader
- `app/questions/merge.py` — DSA merge-by-slug
- `app/questions/enrich.py` — LLM enrichment for SD/LLD
- `app/questions/data/system_design.json`, `lld.json`, `neetcode_150.json`, `leetcode_kaggle.csv` — vendored seeds
- `app/prompts/enrich_question.py` — enrichment prompt template
- `app/jobs/question_collection.py` — orchestrator + tracked wrapper
- `app/questions_cli.py` — one-shot CLI
- Modify: `app/config.py`, `app/db/mongo.py`, `app/db/repositories.py`, `app/api/admin.py`, `app/api/routes.py`
- Tests: `tests/test_question_models.py`, `tests/test_questions_github.py`, `tests/test_dsa_collector.py`, `tests/test_dsa_merge.py`, `tests/test_design_collector.py`, `tests/test_enrich_question.py`, `tests/test_question_collection_job.py`

**interviewiq-backend (modify):**
- `.../integrations/aiservice/AiServiceClient.java`, `.../controllers/IntelligenceController.java`

**interviewIQ-frontend (modify):**
- `lib/constants/intelligence/index.ts`, `features/intelligence/api.ts`, `features/intelligence/hooks.ts`, `features/intelligence/index.ts`, `app/(app)/intelligence/_components/LiveIngestionPanel.tsx`

---

## Task 1: QuestionRecord model + config

**Files:**
- Create: `app/questions/__init__.py` (empty), `app/questions/models.py`
- Modify: `app/config.py`
- Test: `tests/test_question_models.py`

**Interfaces:**
- Produces: `QuestionRecord` (Pydantic model); `Settings` gains `collection_version`, `github_codeload_base`, `github_timeout_seconds`, `question_enrich_concurrency`, `questions_data_dir`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_question_models.py
from app.questions.models import QuestionRecord
from app.models.brief import RoundType, Difficulty


def test_minimal_dsa_record_defaults():
    q = QuestionRecord(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                       url="https://leetcode.com/problems/two-sum/")
    assert q.round_type == RoundType.DSA
    assert q.sources == [] and q.topic_tags == [] and q.company_tags == []
    assert q.enrichment_status == "raw"
    assert q.is_machine_coding is None  # lld-only field, unset for dsa


def test_string_list_coercion_and_difficulty():
    q = QuestionRecord(slug="x", round_type="system-design", title="t", url="u",
                       topic_tags="hashing", difficulty="MEDIUM", company_tags=["Google", None, "amazon"])
    assert q.topic_tags == ["hashing"]
    assert q.difficulty == Difficulty.MEDIUM
    assert q.company_tags == ["google", "amazon"]  # lowercased, None dropped


def test_evaluation_mode_optional():
    q = QuestionRecord(slug="x", round_type="lld", title="t", url="u",
                       is_machine_coding=True, evaluation_mode="working-code", assess=["extensibility"])
    assert q.is_machine_coding is True
    assert q.evaluation_mode == "working-code"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_question_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.questions'`

- [ ] **Step 3: Write minimal implementation**

```python
# app/questions/models.py
"""The single stored shape for one collected interview question.

Thin by design: metadata + a canonical URL only. The full problem statement is NEVER
stored (copyright + size) — it is fetched/linked live at interview time from `url`.
One flat model with optional per-round fields; Mongo is schemaless so no per-round
subclasses. round_type/difficulty reuse the brief enums (DRY)."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.models.brief import Difficulty, RoundType


def _str_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [v] if v.strip() else []
    if isinstance(v, list):
        return [str(x).strip() for x in v if x is not None and str(x).strip()]
    return v


def _slug_list(v):
    """Like _str_list but lowercases (company/level tags are slugs)."""
    return [s.lower() for s in _str_list(v)]


def _norm_difficulty(v):
    if isinstance(v, str):
        s = v.strip().lower()
        return s if s in {d.value for d in Difficulty} else None
    return v


class QuestionRecord(BaseModel):
    # --- shared core ---
    slug: str                       # canonical id: dsa = leetcode slug; sd/lld = "source/slug"
    round_type: RoundType
    title: str
    url: str                        # canonical source URL (fetched live, never stored as text)
    sources: list[str] = Field(default_factory=list)   # datasets/repos this came from
    difficulty: Difficulty | None = None
    topic_tags: list[str] = Field(default_factory=list)
    company_tags: list[str] = Field(default_factory=list)
    level_tags: list[str] = Field(default_factory=list)
    collection_version: str | None = None
    last_synced: str | None = None
    enrichment_status: str = "raw"  # raw | enriched | enrich_failed

    # --- DSA extras ---
    acceptance_rate: float | None = None
    frequency_score: float | None = None
    is_premium: bool | None = None

    # --- system-design extras ---
    category: str | None = None
    components_tested: list[str] = Field(default_factory=list)
    is_classic: bool | None = None
    solution_url: str | None = None

    # --- LLD extras ---
    domain: str | None = None
    patterns_tested: list[str] = Field(default_factory=list)
    entities_involved: list[str] = Field(default_factory=list)
    is_machine_coding: bool | None = None
    evaluation_mode: str | None = None   # "working-code" | "discussion"
    assess: list[str] = Field(default_factory=list)

    # shared with both SD and LLD
    estimated_duration_mins: int | None = None

    _diff = field_validator("difficulty", mode="before")(_norm_difficulty)
    _t = field_validator("topic_tags", "components_tested", "patterns_tested",
                         "entities_involved", "assess", "sources", mode="before")(_str_list)
    _s = field_validator("company_tags", "level_tags", mode="before")(_slug_list)
```

Then add to `app/config.py` `Settings` (after the MongoDB block, before internal auth):

```python
    # --- Question set collection ---
    # Bump to force re-collection of the question bank (mirrors PIPELINE_VERSION).
    collection_version: str = Field("v1", alias="COLLECTION_VERSION")
    # GitHub repo tarball host — one request pulls a whole repo (no per-file rate limit).
    github_codeload_base: str = Field("https://codeload.github.com", alias="GITHUB_CODELOAD_BASE")
    github_timeout_seconds: float = Field(60.0, alias="GITHUB_TIMEOUT_SECONDS")
    # Concurrent LLM enrich calls for SD/LLD. Same RPM discipline as EXTRACT_CONCURRENCY.
    question_enrich_concurrency: int = Field(2, alias="QUESTION_ENRICH_CONCURRENCY")
    # Where the vendored seed data lives (NeetCode list, Kaggle CSV, SD/LLD seed JSON).
    questions_data_dir: str = Field("app/questions/data", alias="QUESTIONS_DATA_DIR")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_question_models.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/questions/__init__.py app/questions/models.py app/config.py tests/test_question_models.py
git commit -m "feat(questions): add QuestionRecord model + collection config"
```

---

## Task 2: GitHub tarball fetch helper

**Files:**
- Create: `app/questions/github.py`
- Test: `tests/test_questions_github.py`

**Interfaces:**
- Produces: `parse_tarball(data: bytes, *, prefix_strip: bool = True) -> dict[str, bytes]` (pure); `async def fetch_repo_files(owner: str, repo: str, ref: str, settings) -> dict[str, bytes]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_questions_github.py
import io, tarfile
from app.questions.github import parse_tarball


def _make_tar(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, body in files.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return buf.getvalue()


def test_parse_tarball_strips_top_level_dir():
    # codeload tarballs wrap everything in "<repo>-<ref>/"
    data = _make_tar({"repo-master/google/All.csv": b"a,b\n1,2\n",
                      "repo-master/README.md": b"hi"})
    out = parse_tarball(data)
    assert "google/All.csv" in out
    assert out["google/All.csv"] == b"a,b\n1,2\n"
    assert "README.md" in out


def test_parse_tarball_skips_directories():
    data = _make_tar({"repo-master/dir/": b"", "repo-master/dir/f.txt": b"x"})
    out = parse_tarball(data)
    assert "dir/f.txt" in out
    assert all(not k.endswith("/") for k in out)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_questions_github.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# app/questions/github.py
"""Fetch a whole GitHub repo as ONE tarball (codeload), parsed in memory.

Why a tarball: the snehasishroy DSA repo has hundreds of company folders — per-file
GitHub API fetches blow past the 60 req/hr unauthenticated limit. The codeload
tarball is a single unauthenticated request, then we walk it with stdlib tarfile."""
from __future__ import annotations

import io
import logging
import tarfile

import httpx

logger = logging.getLogger(__name__)


class GithubFetchError(RuntimeError):
    """Repo tarball could not be fetched — the source is skipped, the run continues."""


def parse_tarball(data: bytes, *, prefix_strip: bool = True) -> dict[str, bytes]:
    """Extract a .tar.gz into {relative_path: file_bytes}. codeload wraps every entry in a
    single top-level '<repo>-<ref>/' dir; with prefix_strip that prefix is removed. Dirs skipped."""
    out: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            name = member.name
            if prefix_strip and "/" in name:
                name = name.split("/", 1)[1]
            f = tar.extractfile(member)
            if f is not None:
                out[name] = f.read()
    return out


async def fetch_repo_files(owner: str, repo: str, ref: str, settings) -> dict[str, bytes]:
    """Download owner/repo@ref as a tarball and return {path: bytes}. Raises GithubFetchError
    on any transport/HTTP failure so the caller can skip just this source."""
    url = f"{settings.github_codeload_base.rstrip('/')}/{owner}/{repo}/tar.gz/refs/heads/{ref}"
    try:
        async with httpx.AsyncClient(timeout=settings.github_timeout_seconds, follow_redirects=True) as client:
            resp = await client.get(url)
    except (httpx.TimeoutException, httpx.ConnectError) as exc:
        raise GithubFetchError(f"GitHub fetch failed for {owner}/{repo}@{ref}: {exc}") from exc
    if resp.status_code != 200:
        raise GithubFetchError(f"GitHub returned {resp.status_code} for {owner}/{repo}@{ref}")
    logger.info("[questions] fetched %s/%s@%s (%d bytes)", owner, repo, ref, len(resp.content))
    return parse_tarball(resp.content)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_questions_github.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/questions/github.py tests/test_questions_github.py
git commit -m "feat(questions): add GitHub repo-tarball fetch helper"
```

---

## Task 3: Mongo collection + question repository

**Files:**
- Modify: `app/db/mongo.py`, `app/db/repositories.py`
- Test: `tests/test_question_repo.py`

**Interfaces:**
- Consumes: `QuestionRecord` (Task 1).
- Produces: `mongo.INTERVIEW_QUESTIONS`; `repo._question_key(doc) -> dict`; `async repo.upsert_question(doc) -> dict`; `async repo.clear_questions() -> int`; `async repo.query_questions(round_type, company, difficulty, limit) -> list[dict]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_question_repo.py
from app.db import repositories as repo


def test_question_key():
    doc = {"round_type": "dsa", "slug": "two-sum", "title": "Two Sum"}
    assert repo._question_key(doc) == {"round_type": "dsa", "slug": "two-sum"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_question_repo.py -v`
Expected: FAIL — `AttributeError: module 'app.db.repositories' has no attribute '_question_key'`

- [ ] **Step 3: Write minimal implementation**

In `app/db/mongo.py`: add the collection constant next to the others (`INTERVIEW_QUESTIONS = "interview_questions"`), and append to `ensure_indexes`:

```python
    # Question bank: one record per (round_type, slug); query by round + company tag.
    await db[INTERVIEW_QUESTIONS].create_index(
        [("round_type", ASCENDING), ("slug", ASCENDING)],
        name="round_type_slug", unique=True,
    )
    await db[INTERVIEW_QUESTIONS].create_index(
        [("round_type", ASCENDING), ("company_tags", ASCENDING)],
        name="round_type_company_tags",
    )
```

In `app/db/repositories.py`: update the import to include `INTERVIEW_QUESTIONS`, and add:

```python
def _question_key(doc: dict) -> dict:
    return {"round_type": doc["round_type"], "slug": doc["slug"]}


async def upsert_question(doc: dict) -> dict:
    """Replace the question for (round_type, slug) — idempotent re-collection."""
    await get_db()[INTERVIEW_QUESTIONS].replace_one(_question_key(doc), doc, upsert=True)
    return doc


async def clear_questions() -> int:
    res = await get_db()[INTERVIEW_QUESTIONS].delete_many({})
    return res.deleted_count


async def query_questions(round_type: str | None = None, company: str | None = None,
                          difficulty: str | None = None, limit: int = 100) -> list[dict]:
    q: dict = {}
    if round_type:
        q["round_type"] = round_type
    if company:
        q["company_tags"] = company.lower()
    if difficulty:
        q["difficulty"] = difficulty.lower()
    cursor = get_db()[INTERVIEW_QUESTIONS].find(q, {"_id": 0}).limit(limit)
    return [doc async for doc in cursor]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_question_repo.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/db/mongo.py app/db/repositories.py tests/test_question_repo.py
git commit -m "feat(questions): add interview_questions collection + repository"
```

---

## Task 4: DSA collectors (slug, snehasishroy, neetcode, kaggle)

**Files:**
- Create: `app/questions/collectors/__init__.py` (empty), `app/questions/collectors/dsa.py`
- Test: `tests/test_dsa_collector.py`

**Interfaces:**
- Consumes: `QuestionRecord` (Task 1), `parse_tarball` (Task 2).
- Produces: `leetcode_slug(url) -> str | None`; `parse_snehasishroy_csv(text, company) -> list[QuestionRecord]`; `collect_snehasishroy(files: dict[str, bytes]) -> list[QuestionRecord]`; `parse_neetcode(data: list) -> list[QuestionRecord]`; `parse_kaggle(text) -> list[QuestionRecord]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_dsa_collector.py
from app.questions.collectors.dsa import (
    leetcode_slug, parse_snehasishroy_csv, parse_neetcode, parse_kaggle, collect_snehasishroy,
)


def test_leetcode_slug():
    assert leetcode_slug("https://leetcode.com/problems/number-of-islands/") == "number-of-islands"
    assert leetcode_slug("https://leetcode.com/problems/two-sum") == "two-sum"
    assert leetcode_slug("https://example.com/foo") is None


def test_parse_snehasishroy_csv_company_tag_and_metrics():
    csv_text = (
        "Difficulty,Title,Frequency,Acceptance Rate,Link\n"
        "MEDIUM,Number of Islands,0.87,56.2,https://leetcode.com/problems/number-of-islands/\n"
    )
    recs = parse_snehasishroy_csv(csv_text, "google")
    assert len(recs) == 1
    r = recs[0]
    assert r.slug == "number-of-islands"
    assert r.round_type.value == "dsa"
    assert r.company_tags == ["google"]
    assert r.difficulty.value == "medium"
    assert r.frequency_score == 0.87
    assert r.acceptance_rate == 56.2
    assert r.sources == ["snehasishroy"]


def test_collect_snehasishroy_picks_all_window():
    files = {
        "google/1. Thirty Days.csv": "Difficulty,Title,Link\nEASY,A,https://leetcode.com/problems/a/\n",
        "google/5. All.csv": "Difficulty,Title,Link\nEASY,A,https://leetcode.com/problems/a/\nHARD,B,https://leetcode.com/problems/b/\n",
        "README.md": "ignore me",
    }
    files = {k: v.encode() for k, v in files.items()}
    recs = collect_snehasishroy(files)
    slugs = {r.slug for r in recs}
    assert slugs == {"a", "b"}  # used the "All" file, not the 30-day one


def test_parse_neetcode_topic_tags():
    data = [{"title": "Two Sum", "url": "https://leetcode.com/problems/two-sum/",
             "difficulty": "Easy", "pattern": "Arrays & Hashing"}]
    recs = parse_neetcode(data)
    assert recs[0].slug == "two-sum"
    assert recs[0].topic_tags == ["Arrays & Hashing"]
    assert recs[0].sources == ["neetcode-150"]


def test_parse_kaggle_premium_and_acceptance():
    csv_text = (
        "title,url,difficulty,acceptance,is_premium,related_topics\n"
        "Two Sum,https://leetcode.com/problems/two-sum/,Easy,49.1,False,Array;Hash Table\n"
    )
    recs = parse_kaggle(csv_text)
    r = recs[0]
    assert r.slug == "two-sum"
    assert r.is_premium is False
    assert r.acceptance_rate == 49.1
    assert r.topic_tags == ["Array", "Hash Table"]
    assert r.sources == ["kaggle-leetcode"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_dsa_collector.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# app/questions/collectors/dsa.py
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


def collect_snehasishroy(files: dict[str, bytes]) -> list[QuestionRecord]:
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_dsa_collector.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add app/questions/collectors/__init__.py app/questions/collectors/dsa.py tests/test_dsa_collector.py
git commit -m "feat(questions): add DSA collectors (snehasishroy/neetcode/kaggle)"
```

---

## Task 5: DSA merge-by-slug

**Files:**
- Create: `app/questions/merge.py`
- Test: `tests/test_dsa_merge.py`

**Interfaces:**
- Consumes: `QuestionRecord`.
- Produces: `merge_dsa(record_lists: list[list[QuestionRecord]]) -> list[QuestionRecord]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_dsa_merge.py
from app.questions.merge import merge_dsa
from app.questions.models import QuestionRecord
from app.models.brief import RoundType


def _q(**kw):
    base = dict(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                url="https://leetcode.com/problems/two-sum/")
    base.update(kw)
    return QuestionRecord(**base)


def test_merge_unions_sources_companies_topics():
    a = _q(sources=["snehasishroy"], company_tags=["google"], frequency_score=0.8)
    b = _q(sources=["kaggle-leetcode"], topic_tags=["Array"], acceptance_rate=49.1, is_premium=False)
    c = _q(sources=["neetcode-150"], topic_tags=["Arrays & Hashing"], is_classic=True)
    merged = merge_dsa([[a], [b], [c]])
    assert len(merged) == 1
    m = merged[0]
    assert set(m.sources) == {"snehasishroy", "kaggle-leetcode", "neetcode-150"}
    assert m.company_tags == ["google"]
    assert set(m.topic_tags) == {"Array", "Arrays & Hashing"}
    assert m.frequency_score == 0.8 and m.acceptance_rate == 49.1
    assert m.is_premium is False and m.is_classic is True


def test_merge_keeps_distinct_slugs():
    a = _q(slug="two-sum")
    b = _q(slug="number-of-islands", url="https://leetcode.com/problems/number-of-islands/")
    assert len(merge_dsa([[a, b]])) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_dsa_merge.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# app/questions/merge.py
"""Merge DSA records from the 3 sources into one record per leetcode slug.
Union list fields; take the first non-null scalar (sources are ordered by trust:
snehasishroy first for company/frequency, kaggle for acceptance/premium)."""
from __future__ import annotations

from app.questions.models import QuestionRecord

_SCALARS = ("difficulty", "frequency_score", "acceptance_rate", "is_premium", "is_classic", "title")
_LISTS = ("sources", "company_tags", "topic_tags", "level_tags")


def _union(a: list, b: list) -> list:
    seen, out = set(), []
    for x in [*a, *b]:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def merge_dsa(record_lists: list[list[QuestionRecord]]) -> list[QuestionRecord]:
    by_slug: dict[str, QuestionRecord] = {}
    for records in record_lists:
        for r in records:
            cur = by_slug.get(r.slug)
            if cur is None:
                by_slug[r.slug] = r.model_copy(deep=True)
                continue
            for f in _LISTS:
                setattr(cur, f, _union(getattr(cur, f), getattr(r, f)))
            for f in _SCALARS:
                if getattr(cur, f) in (None, "") and getattr(r, f) not in (None, ""):
                    setattr(cur, f, getattr(r, f))
    return list(by_slug.values())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_dsa_merge.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/questions/merge.py tests/test_dsa_merge.py
git commit -m "feat(questions): add DSA merge-by-slug"
```

---

## Task 6: SD/LLD seed collector + vendored seed data

**Files:**
- Create: `app/questions/collectors/design.py`, `app/questions/data/system_design.json`, `app/questions/data/lld.json`, `app/questions/data/neetcode_150.json`, `app/questions/data/leetcode_kaggle.csv`
- Test: `tests/test_design_collector.py`

**Interfaces:**
- Consumes: `QuestionRecord`.
- Produces: `load_seed_questions(data: list[dict], round_type: RoundType) -> list[QuestionRecord]`; `load_data_file(settings, filename) -> str` (reads `questions_data_dir`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_design_collector.py
from app.questions.collectors.design import load_seed_questions
from app.models.brief import RoundType


def test_sd_seed_record():
    data = [{"slug": "design-url-shortener", "title": "Design a URL Shortener",
             "url": "https://github.com/donnemartin/system-design-primer/.../pastebin/README.md",
             "source": "system-design-primer", "category": "web-service"}]
    recs = load_seed_questions(data, RoundType.SYSTEM_DESIGN)
    assert recs[0].slug == "sdp/design-url-shortener"  # source-prefixed (Spec §2)
    assert recs[0].round_type == RoundType.SYSTEM_DESIGN
    assert recs[0].sources == ["system-design-primer"]
    assert recs[0].enrichment_status == "raw"


def test_lld_seed_machine_coding_flag():
    data = [{"slug": "design-bookmyshow", "title": "Design BookMyShow",
             "url": "https://github.com/prasadgujar/.../BookMyShow.md",
             "source": "lld-primer", "is_machine_coding": True}]
    recs = load_seed_questions(data, RoundType.LLD)
    assert recs[0].slug == "lldp/design-bookmyshow"
    assert recs[0].is_machine_coding is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_design_collector.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# app/questions/collectors/design.py
"""System-Design and LLD collectors. These repos are prose, not parseable question banks,
so the seed lists (title+url+source from the named repos) are curated JSON vendored in
app/questions/data/. The LLM enrich pass (Task 7) fills company/level/components/patterns.
# ponytail: re-curate the JSON on COLLECTION_VERSION bump; auto-enumerating donnemartin's
# solution folders is a later enhancement if the curated set goes stale."""
from __future__ import annotations

import os

from app.models.brief import RoundType
from app.questions.models import QuestionRecord

# Short source -> slug prefix, so SD/LLD slugs are globally unique and traceable.
_PREFIX = {"system-design-primer": "sdp", "lld-primer": "lldp", "machine-coding": "mcq",
           "grokking-ood": "ood", "system-design": "ksd", "awesome-system-design": "asd",
           "interviewready": "irsd"}


def load_data_file(settings, filename: str) -> str:
    path = os.path.join(settings.questions_data_dir, filename)
    with open(path, encoding="utf-8") as f:
        return f.read()


def load_seed_questions(data: list[dict], round_type: RoundType) -> list[QuestionRecord]:
    out: list[QuestionRecord] = []
    for item in data:
        source = (item.get("source") or "seed").strip()
        prefix = _PREFIX.get(source, source)
        raw_slug = (item.get("slug") or item.get("title") or "").strip().lower().replace(" ", "-")
        if not raw_slug or not item.get("url"):
            continue
        out.append(QuestionRecord(
            slug=f"{prefix}/{raw_slug}", round_type=round_type,
            title=(item.get("title") or raw_slug).strip(), url=item["url"],
            sources=[source], difficulty=item.get("difficulty"),
            category=item.get("category"), domain=item.get("domain"),
            solution_url=item.get("solution_url") or item.get("url"),
            is_machine_coding=item.get("is_machine_coding"),
        ))
    return out
```

Vendor minimal-but-real seed files (the implementer expands these by walking the repos; a few real entries each is enough to ship + test):

```json
// app/questions/data/system_design.json
[
  {"slug": "design-pastebin", "title": "Design Pastebin / URL Shortener", "source": "system-design-primer",
   "url": "https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md", "category": "web-service"},
  {"slug": "design-twitter", "title": "Design the Twitter timeline and search", "source": "system-design-primer",
   "url": "https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/twitter/README.md", "category": "social"},
  {"slug": "design-web-crawler", "title": "Design a web crawler", "source": "system-design-primer",
   "url": "https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/web_crawler/README.md", "category": "infrastructure"},
  {"slug": "design-rate-limiter", "title": "Design a rate limiter", "source": "awesome-system-design",
   "url": "https://github.com/ashishps1/awesome-system-design-resources", "category": "infrastructure"},
  {"slug": "design-notification-system", "title": "Design a notification system", "source": "system-design",
   "url": "https://github.com/karanpratapsingh/system-design#notification-system", "category": "infrastructure"}
]
```

```json
// app/questions/data/lld.json
[
  {"slug": "design-bookmyshow", "title": "Design BookMyShow", "source": "lld-primer", "is_machine_coding": true,
   "url": "https://github.com/prasadgujar/low-level-design-primer/blob/master/solutions/BookMyShow.md", "domain": "booking"},
  {"slug": "design-parking-lot", "title": "Design a Parking Lot", "source": "lld-primer", "is_machine_coding": true,
   "url": "https://github.com/prasadgujar/low-level-design-primer/blob/master/solutions/ParkingLot.md", "domain": "facility"},
  {"slug": "design-elevator-system", "title": "Design an Elevator System", "source": "machine-coding", "is_machine_coding": true,
   "url": "https://github.com/prasadgujar/machine-coding-questions", "domain": "facility"},
  {"slug": "design-library-management", "title": "Design a Library Management System", "source": "grokking-ood", "is_machine_coding": false,
   "url": "https://github.com/tssovi/grokking-the-object-oriented-design-interview", "domain": "catalog"}
]
```

```json
// app/questions/data/neetcode_150.json
[
  {"title": "Two Sum", "url": "https://leetcode.com/problems/two-sum/", "difficulty": "Easy", "pattern": "Arrays & Hashing"},
  {"title": "Valid Anagram", "url": "https://leetcode.com/problems/valid-anagram/", "difficulty": "Easy", "pattern": "Arrays & Hashing"},
  {"title": "Number of Islands", "url": "https://leetcode.com/problems/number-of-islands/", "difficulty": "Medium", "pattern": "Graphs"}
]
```

```csv
# app/questions/data/leetcode_kaggle.csv  (header + a couple rows; drop the full Kaggle export here)
title,url,difficulty,acceptance,is_premium,related_topics
Two Sum,https://leetcode.com/problems/two-sum/,Easy,49.1,False,Array;Hash Table
Number of Islands,https://leetcode.com/problems/number-of-islands/,Medium,56.2,False,Array;DFS;BFS;Matrix
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_design_collector.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/questions/collectors/design.py app/questions/data tests/test_design_collector.py
git commit -m "feat(questions): add SD/LLD seed collector + vendored seed data"
```

---

## Task 7: Enrichment prompt + enrich module

**Files:**
- Create: `app/prompts/enrich_question.py`, `app/questions/enrich.py`
- Test: `tests/test_enrich_question.py`

**Interfaces:**
- Consumes: `QuestionRecord`; `LLMClient.complete_json(system, user, *, label) -> dict`; `gather_capped(coros, limit)`.
- Produces: `ENRICH_VERSION`; `build_enrich_prompt(record: QuestionRecord) -> str`; `async enrich_one(llm, record) -> QuestionRecord`; `async enrich_all(llm, records, limit) -> list[QuestionRecord]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_enrich_question.py
import asyncio
from app.prompts.enrich_question import build_enrich_prompt, ENRICH_VERSION
from app.questions.enrich import enrich_one
from app.questions.models import QuestionRecord
from app.models.brief import RoundType


def _rec():
    return QuestionRecord(slug="sdp/design-pastebin", round_type=RoundType.SYSTEM_DESIGN,
                          title="Design Pastebin", url="https://x/y", sources=["system-design-primer"])


def test_prompt_includes_title_and_round():
    p = build_enrich_prompt(_rec())
    assert "Design Pastebin" in p
    assert "system-design" in p
    assert ENRICH_VERSION  # non-empty


class _FakeLLM:
    def __init__(self, payload): self.payload = payload
    async def complete_json(self, system, user, *, label="llm"): return self.payload


def test_enrich_one_applies_fields_and_marks_enriched():
    llm = _FakeLLM({"company_tags": ["Amazon", "Flipkart"], "level_tags": ["sde2"],
                    "components_tested": ["caching", "database-design"], "estimated_duration_mins": 45})
    out = asyncio.run(enrich_one(llm, _rec()))
    assert out.enrichment_status == "enriched"
    assert out.company_tags == ["amazon", "flipkart"]
    assert out.components_tested == ["caching", "database-design"]
    assert out.estimated_duration_mins == 45


def test_enrich_one_failure_keeps_raw_record():
    class _BoomLLM:
        async def complete_json(self, *a, **k): raise RuntimeError("boom")
    out = asyncio.run(enrich_one(_BoomLLM(), _rec()))
    assert out.enrichment_status == "enrich_failed"
    assert out.company_tags == []  # unchanged
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_enrich_question.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# app/prompts/enrich_question.py
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
```

```python
# app/questions/enrich.py
"""LLM enrichment for SD/LLD questions. One call per question, bounded concurrency
(reuses gather_capped). A failure marks the record enrich_failed and keeps it raw —
never aborts the run (mirrors the brief pipeline's per-source isolation)."""
from __future__ import annotations

import logging

from app.llm.client import gather_capped
from app.prompts.enrich_question import build_enrich_prompt
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

# Fields the enricher may set, per round flavour. Lists go through QuestionRecord validators.
_FIELDS = ("company_tags", "level_tags", "topic_tags", "components_tested", "patterns_tested",
           "entities_involved", "category", "domain", "evaluation_mode", "assess",
           "estimated_duration_mins")


async def enrich_one(llm, record: QuestionRecord) -> QuestionRecord:
    try:
        data = await llm.complete_json(
            __import__("app.prompts.enrich_question", fromlist=["ENRICH_SYSTEM"]).ENRICH_SYSTEM,
            build_enrich_prompt(record), label=f"enrich:{record.slug}")
    except Exception as exc:  # noqa: BLE001 — one bad enrich must not abort the run
        logger.warning("[questions] enrich failed for %s (%s)", record.slug, exc)
        record.enrichment_status = "enrich_failed"
        return record
    patch = {k: data[k] for k in _FIELDS if k in data and data[k] not in (None, "")}
    merged = record.model_copy(update={**patch, "enrichment_status": "enriched"})
    return QuestionRecord.model_validate(merged.model_dump())  # re-run validators on patched lists


async def enrich_all(llm, records: list[QuestionRecord], limit: int) -> list[QuestionRecord]:
    results = await gather_capped([enrich_one(llm, r) for r in records], limit)
    # gather_capped maps a raised coro to None; fall back to the original raw record.
    return [res if res is not None else rec for res, rec in zip(results, records)]
```

> Note: the `__import__(...)` line keeps `ENRICH_SYSTEM` import local to avoid a circular import between `enrich.py` and the prompt module during validator setup. If no circularity exists at implementation time, replace it with a top-level `from app.prompts.enrich_question import ENRICH_SYSTEM, build_enrich_prompt`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_enrich_question.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add app/prompts/enrich_question.py app/questions/enrich.py tests/test_enrich_question.py
git commit -m "feat(questions): add SD/LLD LLM enrichment"
```

---

## Task 8: Collection orchestrator + tracked wrapper + CLI

**Files:**
- Create: `app/jobs/question_collection.py`, `app/questions_cli.py`
- Test: `tests/test_question_collection_job.py`

**Interfaces:**
- Consumes: all collectors/merge/enrich; `fetch_repo_files` (Task 2); `build_llm_client(settings)`; `RUN_STORE`; `repo.upsert_question`; `load_data_file`/`load_seed_questions`.
- Produces: `async collect_questions(settings) -> dict` (counts); `async execute_tracked_collection(settings, run_id) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_question_collection_job.py
import asyncio
import app.jobs.question_collection as qc


def test_collect_questions_aggregates_and_upserts(monkeypatch):
    from app.questions.models import QuestionRecord
    from app.models.brief import RoundType

    dsa = QuestionRecord(slug="two-sum", round_type=RoundType.DSA, title="Two Sum",
                         url="https://leetcode.com/problems/two-sum/")
    sd = QuestionRecord(slug="sdp/x", round_type=RoundType.SYSTEM_DESIGN, title="X", url="u")

    async def fake_fetch(*a, **k): return {}
    monkeypatch.setattr(qc, "fetch_repo_files", fake_fetch)
    monkeypatch.setattr(qc, "_collect_dsa", lambda files, s: [dsa])
    monkeypatch.setattr(qc, "_collect_design", lambda s: ([sd], []))  # (sd, lld)

    async def fake_enrich_all(llm, recs, limit): return recs
    monkeypatch.setattr(qc, "enrich_all", fake_enrich_all)
    monkeypatch.setattr(qc, "build_llm_client", lambda s: _FakeLLM())

    upserted = []
    async def fake_upsert(doc): upserted.append(doc); return doc
    monkeypatch.setattr(qc.repo, "upsert_question", fake_upsert)

    settings = _settings()
    result = asyncio.run(qc.collect_questions(settings))
    assert result["dsa"] == 1 and result["system-design"] == 1 and result["lld"] == 0
    assert result["total"] == 2
    assert len(upserted) == 2
    assert all(d["collection_version"] == settings.collection_version for d in upserted)


class _FakeLLM:
    async def aclose(self): pass


def _settings():
    from app.config import Settings
    import os
    os.environ.setdefault("EXA_API_KEY", "x"); os.environ.setdefault("LLM_API_KEY", "x")
    os.environ.setdefault("LLM_MODEL_NAME", "m"); os.environ.setdefault("MONGODB_URL", "mongodb://x")
    os.environ.setdefault("INTERNAL_API_KEY", "x")
    return Settings()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_question_collection_job.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# app/jobs/question_collection.py
"""Question-set collection orchestrator. DSA: snehasishroy tarball + vendored
neetcode/kaggle, merged by slug (deterministic). SD/LLD: vendored seed lists + one
LLM enrich pass each. Everything upserts into interview_questions.

Tracked runs reuse the global RUN_STORE (scrape and collect never run at once), so the
existing /admin/scrape/status feed shows progress. Stage result is recorded under the
'question_collection' key."""
from __future__ import annotations

import json
import logging

from app.config import Settings
from app.db import repositories as repo
from app.llm.client import build_llm_client
from app.questions.collectors import dsa as dsa_collector
from app.questions.collectors.design import load_data_file, load_seed_questions
from app.questions.enrich import enrich_all
from app.questions.github import GithubFetchError, fetch_repo_files
from app.questions.merge import merge_dsa
from app.questions.models import QuestionRecord
from app.jobs.run_store import RUN_STORE
from app.models.brief import RoundType
from app.utils.time import utcnow_iso  # if absent, use datetime.now(timezone.utc).isoformat()

logger = logging.getLogger(__name__)

_SNEHASISHROY = ("snehasishroy", "leetcode-companywise-interview-questions", "master")


async def _collect_dsa(files: dict[str, bytes], settings: Settings) -> list[QuestionRecord]:
    snehasishroy = dsa_collector.collect_snehasishroy(files)
    neetcode = dsa_collector.parse_neetcode(json.loads(load_data_file(settings, "neetcode_150.json")))
    kaggle = dsa_collector.parse_kaggle(load_data_file(settings, "leetcode_kaggle.csv"))
    return merge_dsa([snehasishroy, neetcode, kaggle])


def _collect_design(settings: Settings) -> tuple[list[QuestionRecord], list[QuestionRecord]]:
    sd = load_seed_questions(json.loads(load_data_file(settings, "system_design.json")), RoundType.SYSTEM_DESIGN)
    lld = load_seed_questions(json.loads(load_data_file(settings, "lld.json")), RoundType.LLD)
    return sd, lld


async def collect_questions(settings: Settings) -> dict:
    # DSA (deterministic). A GitHub failure degrades to vendored-only rather than aborting.
    try:
        files = await fetch_repo_files(*_SNEHASISHROY, settings)
    except GithubFetchError as exc:
        logger.warning("[questions] snehasishroy unavailable (%s) — DSA from vendored sources only", exc)
        files = {}
    dsa_records = await _collect_dsa(files, settings)

    # SD/LLD: seed + LLM enrich.
    sd_records, lld_records = _collect_design(settings)
    llm = build_llm_client(settings)
    try:
        enriched = await enrich_all(llm, [*sd_records, *lld_records], settings.question_enrich_concurrency)
    finally:
        await llm.aclose()

    all_records = [*dsa_records, *enriched]
    stamp = utcnow_iso()
    counts = {"dsa": 0, "system-design": 0, "lld": 0}
    for r in all_records:
        r.collection_version = settings.collection_version
        r.last_synced = stamp
        await repo.upsert_question(r.model_dump())
        counts[r.round_type.value] = counts.get(r.round_type.value, 0) + 1
    counts["total"] = len(all_records)
    logger.info("[questions] collected %s", counts)
    return counts


async def execute_tracked_collection(settings: Settings, run_id: str) -> dict:
    """RUN_STORE-tracked wrapper, mirroring brief_generation.execute_tracked_run."""
    RUN_STORE.set_stage("question_collection")
    try:
        counts = await collect_questions(settings)
        RUN_STORE.record_stage_result("question_collection", counts)
        RUN_STORE.finish("completed")
        return counts
    except Exception as exc:  # noqa: BLE001
        logger.exception("Question collection failed")
        RUN_STORE.finish("failed", error=str(exc))
        raise
```

> Implementation note: confirm the timestamp helper. If `app/utils/time.py` / `utcnow_iso` does not exist, replace the import with `from datetime import datetime, timezone` and `stamp = datetime.now(timezone.utc).isoformat()`. Confirm `LLMClient` exposes `aclose()` (it does — see `__aexit__`/`aclose` in `app/llm/client.py`).

```python
# app/questions_cli.py
"""Management command: collect the question bank once, then exit.
Usage (inside the service venv/container):  python -m app.questions_cli"""
from __future__ import annotations

import asyncio
import logging

from app.config import get_settings
from app.db import mongo
from app.jobs.question_collection import collect_questions


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    await mongo.connect(settings)
    try:
        print(await collect_questions(settings))
    finally:
        await mongo.close()


if __name__ == "__main__":
    asyncio.run(_main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_question_collection_job.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/jobs/question_collection.py app/questions_cli.py tests/test_question_collection_job.py
git commit -m "feat(questions): add collection orchestrator + CLI"
```

---

## Task 9: Admin trigger endpoint + read endpoint

**Files:**
- Modify: `app/api/admin.py`, `app/api/routes.py`
- Test: `tests/test_questions_endpoints.py`

**Interfaces:**
- Consumes: `RUN_STORE`, `new_run_id`, `execute_tracked_collection`, `repo.query_questions`.
- Produces: `POST /admin/questions/collect` → `{run_id, status, already_running}`; `GET /questions?round_type=&company=&difficulty=&limit=`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_questions_endpoints.py
from fastapi.testclient import TestClient
import app.api.admin as admin_mod
from app.api.deps import require_internal_key
from app.main import app


def _bypass_auth():
    app.dependency_overrides[require_internal_key] = lambda: True


def test_collect_endpoint_starts_run(monkeypatch):
    _bypass_auth()
    started = {}
    monkeypatch.setattr(admin_mod.RUN_STORE, "start", lambda rid, trigger: started.setdefault("rid", rid) or True)
    monkeypatch.setattr(admin_mod, "_background_collection", lambda settings, rid: None)
    # avoid scheduling a real bg task:
    monkeypatch.setattr(admin_mod.asyncio, "create_task", lambda coro: coro.close() or None)
    with TestClient(app) as client:
        r = client.post("/admin/questions/collect")
    assert r.status_code == 200
    assert r.json()["status"] == "running"
    app.dependency_overrides.clear()
```

> If standing up `TestClient(app)` triggers the full lifespan (Mongo connect), instead test the handler function directly: `asyncio.run(admin_mod.trigger_question_collection())` with `RUN_STORE.start` and `asyncio.create_task` monkeypatched. Pick whichever the codebase's existing endpoint tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_questions_endpoints.py -v`
Expected: FAIL — endpoint `/admin/questions/collect` returns 404

- [ ] **Step 3: Write minimal implementation**

In `app/api/admin.py` add imports + endpoints (mirror `trigger_run`):

```python
from app.jobs.question_collection import execute_tracked_collection
```

```python
@router.post("/questions/collect")
async def trigger_question_collection() -> dict:
    """Start a question-bank collection run in the background. Reuses the single run slot —
    if a scrape or collection is already running, returns that run instead of starting a second."""
    run_id = new_run_id()
    if not RUN_STORE.start(run_id, trigger="questions"):
        return {"run_id": RUN_STORE.run_id, "status": RUN_STORE.status, "already_running": True}
    settings = get_settings()
    asyncio.create_task(_background_collection(settings, run_id))
    return {"run_id": run_id, "status": "running", "already_running": False}


async def _background_collection(settings, run_id: str) -> None:
    try:
        await execute_tracked_collection(settings, run_id)
    except Exception:  # noqa: BLE001 — failure already recorded in RUN_STORE
        pass
```

In `app/api/routes.py` add the read endpoint (mirror existing internal-key-gated routes):

```python
from app.db import repositories as repo  # if not already imported


@router.get("/questions")
async def list_questions(round_type: str | None = None, company: str | None = None,
                         difficulty: str | None = None, limit: int = 100) -> dict:
    """Read the collected question bank (thin metadata + url). Filter by round/company/difficulty."""
    items = await repo.query_questions(round_type, company, difficulty, min(limit, 500))
    return {"questions": items, "count": len(items)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_questions_endpoints.py -v`
Expected: PASS

- [ ] **Step 5: Run the full ai-service suite + commit**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass (no regressions)

```bash
git add app/api/admin.py app/api/routes.py tests/test_questions_endpoints.py
git commit -m "feat(questions): add admin collect trigger + read endpoint"
```

---

## Task 10: Backend BFF proxy (AiServiceClient + IntelligenceController)

**Files:**
- Modify: `.../integrations/aiservice/AiServiceClient.java`, `.../controllers/IntelligenceController.java`

**Interfaces:**
- Produces: `JsonNode AiServiceClient.collectQuestions()`; `POST /api/v1/intelligence/questions/collect`.

- [ ] **Step 1: Add the client method** (mirror `triggerScrape()`, let `RestClientException` propagate)

In `AiServiceClient.java`, after `triggerScrape()`:

```java
    /** Trigger a question-bank collection run on the AI service. Throws on transport failure. */
    public JsonNode collectQuestions() {
        String body = restClient.post()
                .uri(baseUrl + "/admin/questions/collect")
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }
```

- [ ] **Step 2: Add the controller endpoint** (mirror `runScrape()`)

In `IntelligenceController.java`, after `scrapeStatus(...)`:

```java
    /** Trigger a question-set collection run. Returns the AI service's {run_id, status, already_running}.
     *  Status is watched via the shared /scrape/status feed (one run slot). */
    @PostMapping("/questions/collect")
    public JsonNode collectQuestions() {
        return aiServiceClient.collectQuestions();
    }
```

No `SecurityConfig`, `RestClientConfig`, or DTO changes — `/api/v1/intelligence/**` is already ADMIN-gated and the convention is `JsonNode` passthrough.

- [ ] **Step 3: Verify it compiles**

Run: `JAVA_HOME=$(/usr/libexec/java_home -v 25) ./mvnw -q compile`
Expected: BUILD SUCCESS (no errors)

> If a JDK-25 `JAVA_HOME` is already exported in the shell profile, plain `./mvnw -q compile` works (see the jdk25-build-java-home memory).

- [ ] **Step 4: Commit**

```bash
git add src/main/java/com/interviewiq/interviewiq_backend/integrations/aiservice/AiServiceClient.java \
        src/main/java/com/interviewiq/interviewiq_backend/controllers/IntelligenceController.java
git commit -m "feat(intelligence): proxy question-collection trigger to AI service"
```

---

## Task 11: Frontend "Collect Questions" button

**Files:**
- Modify: `lib/constants/intelligence/index.ts`, `features/intelligence/api.ts`, `features/intelligence/hooks.ts`, `features/intelligence/index.ts`, `app/(app)/intelligence/_components/LiveIngestionPanel.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `TriggerResponse`, `runMutation` helper, existing `useScrapeStatus` poller (shared status feed).
- Produces: `INTELLIGENCE_ENDPOINTS.collectRun`; `triggerCollect()`; `useTriggerCollect()`.

- [ ] **Step 1: Add the endpoint constant**

In `lib/constants/intelligence/index.ts`, inside `INTELLIGENCE_ENDPOINTS`:

```ts
  collectRun: "/api/v1/intelligence/questions/collect",
```

- [ ] **Step 2: Add the api fn**

In `features/intelligence/api.ts`, after `triggerScrape`:

```ts
/** POST — trigger a question-set collection run (returns immediately; watch via scrape status). */
export function triggerCollect(): Promise<TriggerResponse> {
  return apiFetch<TriggerResponse>(INTELLIGENCE_ENDPOINTS.collectRun, {
    method: "POST",
  });
}
```

- [ ] **Step 3: Add the hook**

In `features/intelligence/hooks.ts`, import `triggerCollect` from `./api`, then after `useTriggerScrape`:

```ts
/** Trigger a question-bank collection run, then refresh the shared run status. */
export function useTriggerCollect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: triggerCollect,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: INTELLIGENCE_QUERY_KEYS.scrapeStatus }),
  });
}
```

- [ ] **Step 4: Re-export from the barrel**

In `features/intelligence/index.ts`, add `triggerCollect` to the `export { ... } from "./api"` list and `useTriggerCollect` to the `export { ... } from "./hooks"` list.

- [ ] **Step 5: Wire the button**

In `app/(app)/intelligence/_components/LiveIngestionPanel.tsx`:
- Add `useTriggerCollect` to the existing `@/features/intelligence` import.
- Inside the component, next to `const trigger = useTriggerScrape();`, add `const collect = useTriggerCollect();`.
- Update `busy` to also disable while collecting: `const busy = running || trigger.isPending || collect.isPending;`
- Immediately AFTER the `Run ingestion` `<Button>` (the last button in the cluster, lines ~122-136), add:

```tsx
          <Button
            variant="secondary"
            onClick={() => runMutation(collect, "Collecting question sets…")}
            disabled={busy}
            title="Collect DSA / System-Design / LLD interview questions from public sources into the bank"
          >
            <ListChecks className="size-4" /> Collect questions
          </Button>
```

- Add `ListChecks` to the `lucide-react` import at the top (`import { ListChecks, Play, RotateCw, Square, Trash2 } from "lucide-react";`).

> `runMutation` is generic over `typeof trigger` (a `UseMutationResult`); `collect` has the same shape, so `runMutation(collect, "…")` works as-is.

- [ ] **Step 6: Verify typecheck**

Run (in the frontend repo): `pnpm typecheck` (or `npx tsc --noEmit` if no such script)
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/constants/intelligence/index.ts features/intelligence/api.ts features/intelligence/hooks.ts \
        features/intelligence/index.ts "app/(app)/intelligence/_components/LiveIngestionPanel.tsx"
git commit -m "feat(intelligence): add Collect Questions button to ingestion console"
```

---

## Self-Review

**Spec coverage:**
- §1 home / round types → Tasks 1, 4, 6 (reuse `RoundType`). ✓
- §2 thin storage + rich flat model + upsert key → Tasks 1, 3. ✓
- §3 ingestion architecture (`app/questions/` layout) → Tasks 2, 4, 5, 6, 7, 8. ✓
- §4 per-source ingestion (DSA deterministic; SD/LLD enumerate) → Tasks 4, 6. ✓
- §5 enrichment (bounded concurrency, enrich_failed isolation) → Task 7. ✓
- §6 trigger: UI button → backend BFF → ai-service admin (reuse RUN_STORE) → Tasks 9, 10, 11. ✓
- §7 thin read endpoint → Task 9. ✓
- §8 testing → every task is TDD. ✓
- §10 flagged calls (vendor Kaggle/NeetCode; no scheduler) → Task 6 vendored data; scheduler untouched (Task 8/9 reuse RUN_STORE only). ✓

**Placeholder scan:** No TBD/TODO. Two implementation notes (timestamp helper; `__import__` circular-import guard) give the exact fallback code, not a placeholder. Vendored seed files contain real starter entries with a note to expand. ✓

**Type consistency:** `collect_questions`/`execute_tracked_collection`, `enrich_one`/`enrich_all`, `merge_dsa`, `parse_*`, `_question_key`/`upsert_question`/`query_questions`, `collectQuestions()`, `triggerCollect`/`useTriggerCollect`, `INTELLIGENCE_ENDPOINTS.collectRun` — names match across producing and consuming tasks. `RoundType`/`Difficulty` reused from `app.models.brief`. ✓

**Known implementation-time confirmations (called out inline, not placeholders):**
- Exact snehasishroy CSV headers — parser uses case-insensitive matching so minor naming differences are tolerated; confirm against one downloaded CSV.
- `utcnow_iso` helper existence (fallback given).
- `LLMClient.aclose()` name (confirmed present).
- `TestClient` lifespan vs direct-handler test (both paths given in Task 9).
