# Staged Brief Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single blended Sonar-chat brief call with a staged pipeline — Perplexity Search collects sources, Groq extracts each source independently, Groq aggregates one final round-by-round experience with per-round provenance and a graceful India-context fallback.

**Architecture:** `collect (Perplexity /search) → extract (Groq qwen3.6-27b, one call per source, concurrency-capped) → aggregate (Groq, one call) → store raw_experiences[] + final_experience`. Each final round is tagged `evidence_backed` or `inferred`; confidence is derived from the evidence ratio, not an LLM self-label.

**Tech Stack:** Python 3, FastAPI, Pydantic v2, Motor (Mongo), httpx, Perplexity Search API, Groq (OpenAI-compatible) running `qwen/qwen3.6-27b`.

## Global Constraints

- **No scoring/ranking/grading anywhere.** Provenance (`evidence_backed`/`inferred`) is descriptive, not a grade. (CLAUDE.md hard rule.)
- **Primary audience: Indian candidates.** Collect with `country: "IN"`, India-weighted queries, India-relevant domain whitelist; aggregator infers from the Indian tech-interview context.
- **Inferred rounds never invent company-specific details** (named problems, OA platform, interviewer specifics). Company specifics only on `evidence_backed` rounds.
- **Required env vars have NO default** — fail fast at startup (existing config convention).
- **Aggregator prompt is product IP** — drafted in this plan for human review; do not treat as final wording.
- **`final_experience` always complete, never empty** — even an all-`inferred` result is a full round-by-round.
- Run tests with the repo venv: `source .venv/bin/activate` before any `python`/`pytest` call. `pytest` may be absent — each test file has a `python -m tests.<name>` self-check fallback.

---

### Task 1: Config — Groq + Perplexity search settings

**Files:**
- Modify: `app/config.py`
- Test: `tests/test_config.py` (create)

**Interfaces:**
- Produces: `Settings.groq_api_key`, `Settings.groq_model`, `Settings.perplexity_search_domains: list[str]`, `Settings.perplexity_search_recency: str`, `Settings.perplexity_search_context_size: str`, `Settings.perplexity_search_country: str`, `Settings.collect_max_results: int`, `Settings.extract_max_sources: int`, `Settings.extract_concurrency: int`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_config.py
"""Self-check that new pipeline settings load. Run: python -m tests.test_config"""
import os


def test_settings_load_groq_and_search(monkeypatch=None):
    os.environ.setdefault("PERPLEXITY_API_KEY", "x")
    os.environ.setdefault("PERPLEXITY_MODEL", "sonar")
    os.environ.setdefault("MONGODB_URL", "mongodb://localhost")
    os.environ.setdefault("INTERNAL_API_KEY", "x")
    os.environ.setdefault("GROQ_API_KEY", "g")
    from app.config import Settings
    s = Settings()
    assert s.groq_model == "qwen/qwen3.6-27b"
    assert s.collect_max_results == 20
    assert s.extract_concurrency == 8
    assert "ambitionbox.com" in s.perplexity_search_domains


if __name__ == "__main__":
    test_settings_load_groq_and_search()
    print("ok")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && python -m tests.test_config`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'groq_model'`.

- [ ] **Step 3: Add the settings**

In `app/config.py`, after the Perplexity block (`perplexity_timeout_seconds` line) add:

```python
    # Perplexity Search API (source collection — separate from the sonar chat model).
    perplexity_search_domains: list[str] = Field(
        default_factory=lambda: [
            "ambitionbox.com", "glassdoor.co.in", "geeksforgeeks.org",
            "leetcode.com", "jointaro.com", "reddit.com", "dev.to",
        ],
        alias="PERPLEXITY_SEARCH_DOMAINS",
    )
    perplexity_search_recency: str = Field("year", alias="PERPLEXITY_SEARCH_RECENCY")
    perplexity_search_context_size: str = Field("high", alias="PERPLEXITY_SEARCH_CONTEXT_SIZE")
    perplexity_search_country: str = Field("IN", alias="PERPLEXITY_SEARCH_COUNTRY")
    collect_max_results: int = Field(20, alias="COLLECT_MAX_RESULTS")   # Search API hard cap is 20

    # --- Groq (extract + aggregate) ---
    groq_api_key: str = Field(..., alias="GROQ_API_KEY")
    groq_model: str = Field("qwen/qwen3.6-27b", alias="GROQ_MODEL")
    groq_base_url: str = Field("https://api.groq.com/openai/v1", alias="GROQ_BASE_URL")
    groq_timeout_seconds: float = Field(60.0, alias="GROQ_TIMEOUT_SECONDS")
    extract_max_sources: int = Field(40, alias="EXTRACT_MAX_SOURCES")   # cap sources sent to extractor
    extract_concurrency: int = Field(8, alias="EXTRACT_CONCURRENCY")    # simultaneous Groq extract calls
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source .venv/bin/activate && python -m tests.test_config`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Update `.env.example`**

Add to `.env.example` (create lines if missing):

```
GROQ_API_KEY=
GROQ_MODEL=qwen/qwen3.6-27b
```

- [ ] **Step 6: Commit**

```bash
git add app/config.py tests/test_config.py .env.example
git commit -m "feat(config): add Groq + Perplexity Search settings for staged pipeline"
```

---

### Task 2: Groq client

**Files:**
- Create: `app/groq/__init__.py` (empty)
- Create: `app/groq/client.py`
- Test: `tests/test_groq_helpers.py`

**Interfaces:**
- Produces:
  - `class GroqClient` with `async def complete_json(self, system: str, user: str) -> dict`
  - `def build_groq_client(settings: Settings) -> GroqClient`
  - `def parse_json(content: str) -> dict` (tolerant; raises `ValueError`)
  - `async def gather_capped(coros: list, limit: int) -> list` (bounded concurrency; returns results, exceptions captured as `None`)
  - `class GroqError(RuntimeError)`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_groq_helpers.py
"""Self-checks for Groq client pure helpers. Run: python -m tests.test_groq_helpers"""
import asyncio
from app.groq.client import parse_json, gather_capped


def test_parse_fenced():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_garbage_raises():
    try:
        parse_json("not json")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_gather_capped_respects_limit():
    state = {"now": 0, "max": 0}

    async def task():
        state["now"] += 1
        state["max"] = max(state["max"], state["now"])
        await asyncio.sleep(0.01)
        state["now"] -= 1
        return "ok"

    results = asyncio.run(gather_capped([task() for _ in range(20)], limit=4))
    assert results == ["ok"] * 20
    assert state["max"] <= 4


def test_gather_capped_captures_exceptions_as_none():
    async def boom():
        raise RuntimeError("x")

    assert asyncio.run(gather_capped([boom()], limit=2)) == [None]


if __name__ == "__main__":
    test_parse_fenced()
    test_parse_garbage_raises()
    test_gather_capped_respects_limit()
    test_gather_capped_captures_exceptions_as_none()
    print("ok")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && python -m tests.test_groq_helpers`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.groq'`.

- [ ] **Step 3: Write the client**

```python
# app/groq/__init__.py  -> empty file
```

```python
# app/groq/client.py
"""Groq client (OpenAI-compatible) for the extract + aggregate stages.

Groq serves OpenAI-shaped /chat/completions. We force JSON output and tolerate the
slips models make (```json fences / preamble). Bounded concurrency keeps us under
Groq rate limits while extracting many sources in parallel.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_RATE_LIMIT_BACKOFF_SECONDS = 20
_MAX_ATTEMPTS = 4


class GroqError(RuntimeError):
    """Groq call failed after retries. Caller decides whether to drop the item or fail the combo."""


def parse_json(content: str) -> dict:
    """Extract JSON from model text, tolerating ```json fences / preamble (grab the outermost
    {...}) and trailing commas. Raises ValueError if none found."""
    content = content.strip()
    candidates = [content]
    start, end = content.find("{"), content.rfind("}")
    if start != -1 and end > start:
        candidates.append(content[start : end + 1])
    for cand in candidates:
        for attempt in (cand, re.sub(r",(\s*[}\]])", r"\1", cand)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                pass
    raise ValueError(f"no valid JSON found. First 500 chars: {content[:500]!r}")


async def gather_capped(coros: list, limit: int) -> list:
    """Run coros with at most `limit` in flight. Returns results in order; any coro that
    raises is captured as None (a junk source must not abort the whole stage)."""
    sem = asyncio.Semaphore(limit)

    async def _run(coro):
        async with sem:
            try:
                return await coro
            except Exception as exc:  # noqa: BLE001 — per-item isolation
                logger.warning("[groq] capped task failed (%s: %s)", type(exc).__name__, exc)
                return None

    return await asyncio.gather(*(_run(c) for c in coros))


class GroqClient:
    def __init__(self, *, base_url: str, api_key: str, model: str, timeout_seconds: float):
        if not api_key:
            raise GroqError("GROQ_API_KEY is not set. Refusing to start.")
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._timeout = timeout_seconds
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    async def complete_json(self, system: str, user: str) -> dict:
        """One chat call forcing a JSON object. Retries on 429/5xx. Raises GroqError on failure."""
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        attempt = 0
        while True:
            attempt += 1
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(self._url, json=payload, headers=self._headers)
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                if attempt >= _MAX_ATTEMPTS:
                    raise GroqError(f"Groq transport error after {attempt} attempts: {exc}") from exc
                await asyncio.sleep(_RATE_LIMIT_BACKOFF_SECONDS)
                continue
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"]
                return parse_json(content)
            if resp.status_code in (429, 500, 502, 503) and attempt < _MAX_ATTEMPTS:
                logger.warning("[groq] %d (attempt %d/%d); backing off", resp.status_code, attempt, _MAX_ATTEMPTS)
                await asyncio.sleep(_RATE_LIMIT_BACKOFF_SECONDS)
                continue
            raise GroqError(f"Groq returned {resp.status_code}: {resp.text[:300]}")


def build_groq_client(settings: Settings) -> GroqClient:
    return GroqClient(
        base_url=settings.groq_base_url,
        api_key=settings.groq_api_key,
        model=settings.groq_model,
        timeout_seconds=settings.groq_timeout_seconds,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source .venv/bin/activate && python -m tests.test_groq_helpers`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/groq/__init__.py app/groq/client.py tests/test_groq_helpers.py
git commit -m "feat(groq): add Groq client with tolerant JSON parse + bounded concurrency"
```

---

### Task 3: Perplexity Search API method

**Files:**
- Modify: `app/perplexity/client.py`
- Test: `tests/test_search_parse.py`

**Interfaces:**
- Consumes: existing `PerplexityClient.__init__`, `_post_with_retries`, `PerplexityError`.
- Produces:
  - `PerplexityClient.collect_sources(self, queries, *, domains, recency, country, context_size, max_results) -> list[dict]` (async) returning deduped `[{title, url, content, date}]`.
  - module fn `_parse_search_results(data: dict) -> list[dict]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_search_parse.py
"""Self-check for Perplexity /search response parsing. Run: python -m tests.test_search_parse"""
from app.perplexity.client import _parse_search_results


def test_parses_and_dedupes():
    data = {"results": [
        {"title": "A", "url": "https://x.com/1", "snippet": "rounds...", "date": "2025-01-01"},
        {"title": "A dup", "url": "https://x.com/1", "snippet": "again"},
        {"title": "B", "url": "https://x.com/2", "content": "full text", "date": None},
    ]}
    out = _parse_search_results(data)
    assert [r["url"] for r in out] == ["https://x.com/1", "https://x.com/2"]
    assert out[0]["content"] == "rounds..."   # falls back to snippet
    assert out[1]["content"] == "full text"   # prefers content


if __name__ == "__main__":
    test_parses_and_dedupes()
    print("ok")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && python -m tests.test_search_parse`
Expected: FAIL — `ImportError: cannot import name '_parse_search_results'`.

- [ ] **Step 3: Add the search URL + method + parser**

In `app/perplexity/client.py` `__init__`, after `self._url = ...` add:

```python
        self._search_url = base_url.rstrip("/") + "/search"
```

Modify `_post_with_retries` signature to accept an optional URL — change the line:

```python
    async def _post_with_retries(self, payload: dict, *, label: str) -> dict:
```
to:
```python
    async def _post_with_retries(self, payload: dict, *, label: str, url: str | None = None) -> dict:
```
and inside it change the single `client.post(self._url, ...)` call to:
```python
                    resp = await client.post(url or self._url, json=payload, headers=self._headers)
```

Add the new method to the class (after `search(...)`):

```python
    async def collect_sources(
        self,
        queries: list[str],
        *,
        domains: list[str],
        recency: str,
        country: str,
        context_size: str,
        max_results: int,
    ) -> list[dict]:
        """Perplexity Search API (/search). Returns deduped [{title, url, content, date}].
        `queries` is sent as an array so several variants run in one request."""
        payload = {
            "query": queries,
            "max_results": max_results,
            "search_domain_filter": domains[:20],
            "search_recency_filter": recency,
            "country": country,
            "web_search_options": {"search_context_size": context_size},
        }
        data = await self._post_with_retries(payload, label="search", url=self._search_url)
        return _parse_search_results(data)
```

Add the module-level parser (near `_extract_citations`):

```python
def _parse_search_results(data: dict) -> list[dict]:
    """Normalise /search results to [{title, url, content, date}], deduped by URL, order preserved.
    Prefers full `content` over `snippet`."""
    out: list[dict] = []
    seen: set[str] = set()
    for r in data.get("results") or []:
        if not isinstance(r, dict):
            continue
        url = r.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({
            "title": r.get("title"),
            "url": url,
            "content": (r.get("content") or r.get("snippet") or "").strip(),
            "date": r.get("date") or r.get("last_updated"),
        })
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source .venv/bin/activate && python -m tests.test_search_parse`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/perplexity/client.py tests/test_search_parse.py
git commit -m "feat(perplexity): add Search API collect_sources + result parser"
```

---

### Task 4: New brief models (RawExperience, FinalExperience, provenance)

**Files:**
- Modify: `app/models/brief.py`
- Test: `tests/test_brief_models.py`

**Interfaces:**
- Consumes: existing `RoundDetail`, `RoundType`, `Difficulty`, `DataConfidence`, `_coerce_str`, `_coerce_str_list`.
- Produces: `Provenance`, `Geo`, `RawExperience`, `FinalRound`, `FinalExperience`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_brief_models.py
"""Self-checks for the staged-pipeline models. Run: python -m tests.test_brief_models"""
from app.models.brief import RawExperience, FinalExperience, Provenance, Geo


def test_raw_experience_geo_normalises():
    e = RawExperience.model_validate({"source": "Reddit", "geo": "India", "rounds": []})
    assert e.geo == Geo.INDIA


def test_final_round_defaults_inferred():
    fe = FinalExperience.model_validate({"rounds": [{"round_number": 1, "type": "dsa"}]})
    assert fe.rounds[0].provenance == Provenance.INFERRED
    assert fe.rounds[0].evidence_urls == []


def test_final_round_evidence_backed_with_urls():
    fe = FinalExperience.model_validate({"rounds": [
        {"round_number": 1, "type": "dsa", "provenance": "evidence_backed",
         "evidence_urls": ["https://x.com/1"]}
    ]})
    assert fe.rounds[0].provenance == Provenance.EVIDENCE_BACKED
    assert fe.rounds[0].evidence_urls == ["https://x.com/1"]


if __name__ == "__main__":
    test_raw_experience_geo_normalises()
    test_final_round_defaults_inferred()
    test_final_round_evidence_backed_with_urls()
    print("ok")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && python -m tests.test_brief_models`
Expected: FAIL — `ImportError: cannot import name 'Provenance'`.

- [ ] **Step 3: Add the models**

In `app/models/brief.py`, after the `Difficulty` enum add:

```python
class Provenance(str, Enum):
    EVIDENCE_BACKED = "evidence_backed"
    INFERRED = "inferred"


class Geo(str, Enum):
    INDIA = "india"
    NON_INDIA = "non-india"
    UNKNOWN = "unknown"
```

At the END of the file add (these replace the old `Experience`/`ConsolidatedProcess`/`PerplexityBriefV2` as the live contract; leave the old classes in place for now — Task 7 removes them):

```python
class RawExperience(BaseModel):
    """One source's extracted account (Groq extractor output, one per collected source)."""
    source: str | None = None
    url: str | None = None
    date: str | None = None
    detected_role: str | None = None
    detected_level: str | None = None
    geo: Geo = Geo.UNKNOWN
    rounds: list[RoundDetail] = Field(default_factory=list)
    outcome: str | None = None

    _s = field_validator(
        "source", "url", "date", "detected_role", "detected_level", "outcome", mode="before",
    )(_coerce_str)

    @field_validator("geo", mode="before")
    @classmethod
    def _norm_geo(cls, v):
        if isinstance(v, str):
            s = v.strip().lower().replace(" ", "-")
            if s in ("india", "in", "indian"):
                return "india"
            if s in {g.value for g in Geo}:
                return s
            return "unknown" if not s else ("non-india" if s not in ("india",) else s)
        return v if v is not None else "unknown"


class FinalRound(BaseModel):
    round_number: int | None = None
    type: RoundType | None = None
    format: str | None = None
    topics: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)
    difficulty: Difficulty | None = None
    provenance: Provenance = Provenance.INFERRED
    evidence_urls: list[str] = Field(default_factory=list)

    _t = field_validator("type", mode="before")(_norm_round_type)
    _d = field_validator("difficulty", mode="before")(_norm_difficulty)
    _s = field_validator("format", mode="before")(_coerce_str)
    _l = field_validator("topics", "problems", "evidence_urls", mode="before")(_coerce_str_list)

    @field_validator("provenance", mode="before")
    @classmethod
    def _norm_prov(cls, v):
        if isinstance(v, str):
            s = v.strip().lower().replace("-", "_")
            return s if s in {p.value for p in Provenance} else "inferred"
        return "inferred"


class FinalExperience(BaseModel):
    """The single consolidated round-by-round experience the JD page renders."""
    rounds: list[FinalRound] = Field(default_factory=list)
    dominant_topics: list[str] = Field(default_factory=list)
    difficulty_calibration: str | None = None
    interviewer_style_notes: str | None = None
    red_flags: list[str] = Field(default_factory=list)
    company_specific_patterns: str | None = None
    data_confidence: DataConfidence = DataConfidence.LOW

    _s = field_validator(
        "difficulty_calibration", "interviewer_style_notes", "company_specific_patterns",
        mode="before",
    )(_coerce_str)
    _l = field_validator("dominant_topics", "red_flags", mode="before")(_coerce_str_list)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source .venv/bin/activate && python -m tests.test_brief_models`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/models/brief.py tests/test_brief_models.py
git commit -m "feat(models): add RawExperience + FinalExperience with provenance/geo"
```

---

### Task 5: Extractor prompt

**Files:**
- Create: `app/prompts/extract_source.py`
- Test: `tests/test_extract_prompt.py`

**Interfaces:**
- Produces: `EXTRACT_SYSTEM: str`, `build_extract_prompt(combo_label: str, source: dict) -> str`, `EXTRACT_VERSION = "v1"`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_extract_prompt.py
"""Run: python -m tests.test_extract_prompt"""
from app.prompts.extract_source import build_extract_prompt, EXTRACT_SYSTEM


def test_prompt_contains_source_and_rules():
    src = {"title": "My Razorpay interview", "url": "https://x.com/1",
           "content": "Round 1 DSA...", "date": "2025-02-01"}
    p = build_extract_prompt("razorpay/software-engineer/sde2/backend", src)
    assert "https://x.com/1" in p
    assert "Round 1 DSA" in p
    assert "null" in p.lower()           # instructs to return null when not an interview post
    assert "geo" in p.lower()
    assert "evaluat" not in EXTRACT_SYSTEM.lower()  # descriptive, never evaluative


if __name__ == "__main__":
    test_prompt_contains_source_and_rules()
    print("ok")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && python -m tests.test_extract_prompt`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.prompts.extract_source'`.

- [ ] **Step 3: Write the prompt module**

```python
# app/prompts/extract_source.py
"""Per-source extraction prompt: turn ONE collected source into a structured raw experience.

Descriptive only — report what the post says happened; never score. Return an empty/null
experience when the source is not a genuine first-hand interview account.
"""
from __future__ import annotations

EXTRACT_VERSION = "v1"

EXTRACT_SYSTEM = (
    "You read ONE web page about a job interview and extract a faithful, structured account "
    "of what the candidate reported. You are descriptive, never evaluative — report what the "
    "post says; do not infer beyond it. Respond with VALID JSON ONLY: no preamble, no markdown."
)

_SCHEMA = """
Return a JSON object with this shape (use null where the post doesn't say; do NOT invent):
{
  "is_interview_experience": <true|false>,   // false if it's a prep guide, listicle, job ad, unrelated
  "source": "<platform name, e.g. LeetCode Discuss | Glassdoor | Reddit | jointaro | blog>",
  "url": "<the page url>",
  "date": "<ISO date if stated, else null>",
  "detected_role": "<role the post is about, verbatim-ish, or null>",
  "detected_level": "<seniority the post is about (fresher/intern/sde1/sde2/sde3/...) or null>",
  "geo": "india" | "non-india" | "unknown",
  "outcome": "<selected/rejected/withdrew/unknown>",
  "rounds": [
    { "round_number": <int>, "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
      "duration_mins": <int|null>, "format": "<short description>",
      "topics": ["<string>"], "problems": ["<specific problems/questions>"],
      "difficulty": "easy"|"medium"|"hard"|null, "hints_given": <true|false|null>, "outcome": "<or null>" }
  ]
}
If is_interview_experience is false, set rounds to [] and other fields to null.
Output ONLY the JSON object.
"""


def build_extract_prompt(combo_label: str, source: dict) -> str:
    title = (source.get("title") or "").strip()
    url = (source.get("url") or "").strip()
    date = source.get("date") or "unknown"
    content = (source.get("content") or "").strip()
    return (
        f"We are building an interview brief for: {combo_label} (India). "
        f"Extract the interview experience from this single source.\n\n"
        f"TITLE: {title}\nURL: {url}\nDATE: {date}\n\nPAGE CONTENT:\n\"\"\"\n{content}\n\"\"\"\n"
        f"{_SCHEMA}"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source .venv/bin/activate && python -m tests.test_extract_prompt`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/prompts/extract_source.py tests/test_extract_prompt.py
git commit -m "feat(prompts): add per-source extractor prompt"
```

---

### Task 6: Aggregator prompt (product IP — draft for review)

**Files:**
- Create: `app/prompts/aggregate_experience.py`
- Test: `tests/test_aggregate_prompt.py`

**Interfaces:**
- Produces: `AGGREGATE_SYSTEM: str`, `build_aggregate_prompt(combo_label: str, raw_experiences_json: str) -> str`, `AGGREGATE_VERSION = "v1"`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_aggregate_prompt.py
"""Run: python -m tests.test_aggregate_prompt"""
from app.prompts.aggregate_experience import build_aggregate_prompt, AGGREGATE_SYSTEM


def test_prompt_states_provenance_and_fallback_rules():
    p = build_aggregate_prompt("razorpay/software-engineer/fresher/backend", '[{"rounds":[]}]')
    low = (p + AGGREGATE_SYSTEM).lower()
    assert "evidence_backed" in low and "inferred" in low
    assert "india" in low
    assert "never invent" in low or "do not invent" in low
    assert "razorpay/software-engineer/fresher/backend" in p


if __name__ == "__main__":
    test_prompt_states_provenance_and_fallback_rules()
    print("ok")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && python -m tests.test_aggregate_prompt`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write the prompt module (DRAFT — flag for human review)**

```python
# app/prompts/aggregate_experience.py
"""Aggregator prompt (PRODUCT IP — DRAFT, pending human review).

Merge the per-source raw experiences into ONE realistic round-by-round interview experience
for the given company/role/level, for INDIAN candidates. Tag every round evidence_backed or
inferred. Always return a complete experience; never invent company-specific detail without
evidence. Bump AGGREGATE_VERSION on any wording change.
"""
from __future__ import annotations

AGGREGATE_VERSION = "v1"

AGGREGATE_SYSTEM = (
    "You are an interview-intelligence analyst for Indian candidates. You merge multiple "
    "first-hand interview reports into ONE realistic round-by-round process for a specific "
    "company/role/seniority. You are descriptive, never evaluative — you never score or rank. "
    "Respond with VALID JSON ONLY: no preamble, no markdown."
)

_SCHEMA = """
Return a JSON object with this shape:
{
  "rounds": [
    { "round_number": <int>, "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
      "format": "<what to expect>", "topics": ["<string>"], "problems": ["<specific, only if evidenced>"],
      "difficulty": "easy"|"medium"|"hard"|null,
      "provenance": "evidence_backed" | "inferred",
      "evidence_urls": ["<source urls that support this round; [] when inferred>"] }
  ],
  "dominant_topics": ["<top topics across rounds>"],
  "difficulty_calibration": "<typical difficulty and what to expect>",
  "interviewer_style_notes": "<patterns in interviewer behaviour>",
  "red_flags": ["<common candidate mistakes / process red flags>"],
  "company_specific_patterns": "<company specifics — ONLY if evidenced — else null>",
  "data_confidence": "high"|"medium"|"low"
}

RULES:
- Build the MOST REALISTIC loop for this exact company/role/seniority in the INDIAN tech-interview context.
- Prefer experiences whose detected role/level match and whose geo is India; discount non-India reports.
- Tag each round:
  - "evidence_backed" — supported by >=1 source; list those source urls in evidence_urls.
  - "inferred" — not directly in the sources; filled from typical patterns for SIMILAR company/role/level
    in India. Keep inferred rounds GENERIC.
- NEVER invent company-specific details (named problems, specific OA platform, interviewer names) on an
  inferred round. Company specifics may appear ONLY on evidence_backed rounds.
- ALWAYS return a complete loop (never empty). If almost everything is inferred, set data_confidence "low".
- Output ONLY the JSON object.
"""


def build_aggregate_prompt(combo_label: str, raw_experiences_json: str) -> str:
    return (
        f"Target: {combo_label} (India).\n"
        f"Here are the extracted candidate experiences (JSON array):\n"
        f"\"\"\"\n{raw_experiences_json}\n\"\"\"\n"
        f"Consolidate them into one realistic round-by-round experience.\n{_SCHEMA}"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source .venv/bin/activate && python -m tests.test_aggregate_prompt`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/prompts/aggregate_experience.py tests/test_aggregate_prompt.py
git commit -m "feat(prompts): add aggregator prompt (draft, product IP)"
```

---

### Task 7: Pipeline pure helpers (queries, status, doc)

**Files:**
- Modify: `app/jobs/brief_generation.py` (add helpers; do not yet remove old code)
- Test: `tests/test_pipeline_helpers.py`

**Interfaces:**
- Consumes: `Combination`, `FinalExperience`, `FinalRound`, `Provenance`, `DataConfidence`, `GenerationStatus`.
- Produces:
  - `build_search_queries(combo: Combination) -> list[str]`
  - `derive_status(fe: FinalExperience) -> tuple[GenerationStatus, DataConfidence]`
  - `count_provenance(fe: FinalExperience) -> tuple[int, int]`  (evidence_backed, inferred)
  - `PIPELINE_VERSION = "v7"`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_helpers.py
"""Run: python -m tests.test_pipeline_helpers"""
from app.targets import Combination
from app.models.brief import FinalExperience, DataConfidence, GenerationStatus
from app.jobs.brief_generation import build_search_queries, derive_status, count_provenance


def test_queries_are_india_weighted():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "backend"))
    assert all("India" in q for q in qs)
    assert any("backend" in q for q in qs)
    assert len(qs) >= 3


def test_queries_skip_general_spec():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "general"))
    assert all("general" not in q for q in qs)


def test_status_high_when_mostly_evidence_backed():
    fe = FinalExperience.model_validate({"rounds": [
        {"round_number": i, "type": "dsa", "provenance": "evidence_backed"} for i in range(4)
    ] + [{"round_number": 5, "type": "behavioural", "provenance": "inferred"}]})
    status, conf = derive_status(fe)
    assert status == GenerationStatus.SUCCESS and conf == DataConfidence.HIGH


def test_status_low_when_mostly_inferred():
    fe = FinalExperience.model_validate({"rounds": [
        {"round_number": i, "type": "dsa", "provenance": "inferred"} for i in range(4)
    ] + [{"round_number": 5, "type": "dsa", "provenance": "evidence_backed"}]})
    status, conf = derive_status(fe)
    assert status == GenerationStatus.INSUFFICIENT_DATA and conf == DataConfidence.LOW
    assert count_provenance(fe) == (1, 4)


if __name__ == "__main__":
    test_queries_are_india_weighted()
    test_queries_skip_general_spec()
    test_status_high_when_mostly_evidence_backed()
    test_status_low_when_mostly_inferred()
    print("ok")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source .venv/bin/activate && python -m tests.test_pipeline_helpers`
Expected: FAIL — `ImportError: cannot import name 'build_search_queries'`.

- [ ] **Step 3: Add the helpers**

In `app/jobs/brief_generation.py`, add near the top-level (after the imports/`logger`):

```python
PIPELINE_VERSION = "v7"


def build_search_queries(combo: "Combination") -> list[str]:
    """India-weighted Perplexity Search query variants for one combo."""
    role = combo.role.replace("-", " ")
    spec = (combo.specialization or "").strip().lower()
    spec_part = "" if spec in ("", "general") else f"{spec} "
    base = f"{combo.company} {spec_part}{role} {combo.level}".strip()
    return [
        f"{base} interview experience India",
        f"{combo.company} {role} interview rounds process India",
        f"{base} interview questions asked India",
    ]


def count_provenance(fe: "FinalExperience") -> tuple[int, int]:
    ev = sum(1 for r in fe.rounds if r.provenance == Provenance.EVIDENCE_BACKED)
    return ev, len(fe.rounds) - ev


def derive_status(fe: "FinalExperience") -> tuple["GenerationStatus", "DataConfidence"]:
    """Confidence/status from the evidence-backed ratio — NOT the LLM's self-label."""
    if not fe.rounds:
        return GenerationStatus.INSUFFICIENT_DATA, DataConfidence.LOW
    ev, _ = count_provenance(fe)
    ratio = ev / len(fe.rounds)
    if ratio >= 0.6:
        return GenerationStatus.SUCCESS, DataConfidence.HIGH
    if ratio >= 0.3:
        return GenerationStatus.SUCCESS, DataConfidence.MEDIUM
    return GenerationStatus.INSUFFICIENT_DATA, DataConfidence.LOW
```

Add `Provenance` to the `app.models.brief` import block in this file (it currently imports `DataConfidence, GenerationStatus, PerplexityBriefV2, utcnow`):

```python
from app.models.brief import (
    DataConfidence,
    FinalExperience,
    GenerationStatus,
    Provenance,
    RawExperience,
    utcnow,
)
```
(Leave `PerplexityBriefV2` import too for now — Task 8 removes it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `source .venv/bin/activate && python -m tests.test_pipeline_helpers`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/jobs/brief_generation.py tests/test_pipeline_helpers.py
git commit -m "feat(pipeline): add query builder + evidence-ratio status helpers"
```

---

### Task 8: Wire the staged pipeline + remove the old path

**Files:**
- Modify: `app/jobs/brief_generation.py` (rewrite `generate_one`/`_query_and_validate`, `_success_doc`, `needs_regeneration`, `run_brief_generation`)
- Modify: `app/api/routes.py` (`refresh_brief` builds + passes Groq)
- Delete: `app/prompts/brief_query.py`
- Test: full suite + import check + live smoke

**Interfaces:**
- Consumes: `PerplexityClient.collect_sources`, `GroqClient.complete_json`, `gather_capped`, `build_groq_client`, `build_extract_prompt`/`EXTRACT_SYSTEM`, `build_aggregate_prompt`/`AGGREGATE_SYSTEM`, `build_search_queries`, `derive_status`, `count_provenance`, `RawExperience`, `FinalExperience`, `PIPELINE_VERSION`.
- Produces: rewritten `generate_one(perplexity, groq, combo, settings, *, force=False)`.

- [ ] **Step 1: Replace imports + `_query_and_validate` with the staged flow**

In `app/jobs/brief_generation.py`:

Add imports:
```python
from app.groq.client import GroqClient, build_groq_client, gather_capped
from app.prompts.extract_source import EXTRACT_SYSTEM, build_extract_prompt
from app.prompts.aggregate_experience import AGGREGATE_SYSTEM, build_aggregate_prompt
```
Remove the `from app.prompts.brief_query import BRIEF_QUERY_VERSION` import and every other reference to `BRIEF_QUERY_VERSION` (replace with `PIPELINE_VERSION`). Remove the `PerplexityBriefV2` import and the local `parse_json`/`_try_validate` helpers (no longer used — the staged flow validates `FinalExperience` directly).

Replace `_query_and_validate(...)` with these three stage functions:

```python
async def _collect(perplexity: PerplexityClient, combo: Combination, settings: Settings) -> list[dict]:
    queries = build_search_queries(combo)
    sources = await perplexity.collect_sources(
        queries,
        domains=settings.perplexity_search_domains,
        recency=settings.perplexity_search_recency,
        country=settings.perplexity_search_country,
        context_size=settings.perplexity_search_context_size,
        max_results=settings.collect_max_results,
    )
    return sources[: settings.extract_max_sources]


async def _extract_all(groq: GroqClient, combo: Combination, sources: list[dict],
                       settings: Settings) -> list[RawExperience]:
    label = combo.label()

    async def _one(src: dict) -> RawExperience | None:
        raw = await groq.complete_json(EXTRACT_SYSTEM, build_extract_prompt(label, src))
        if not raw.get("is_interview_experience"):
            return None
        raw.setdefault("url", src.get("url"))
        return RawExperience.model_validate(raw)

    results = await gather_capped([_one(s) for s in sources], settings.extract_concurrency)
    return [r for r in results if isinstance(r, RawExperience) and r.rounds]


async def _aggregate(groq: GroqClient, combo: Combination,
                     raw_experiences: list[RawExperience]) -> FinalExperience:
    import json as _json
    payload = _json.dumps([e.model_dump(mode="json") for e in raw_experiences])
    raw = await groq.complete_json(AGGREGATE_SYSTEM, build_aggregate_prompt(combo.label(), payload))
    return FinalExperience.model_validate(raw)
```

- [ ] **Step 2: Rewrite `generate_one`**

```python
async def generate_one(
    perplexity: PerplexityClient,
    groq: GroqClient,
    combo: Combination,
    settings: Settings,
    *,
    force: bool = False,
) -> dict:
    """Generate (or skip) the brief for one combination via collect -> extract -> aggregate."""
    label = combo.label()
    if not force and not await needs_regeneration(combo, settings):
        logger.info("[brief] %s fresh (v=%s); skipping", label, PIPELINE_VERSION)
        RUN_STORE.record_combo(label, status="skipped")
        return {"combo": label, "status": "skipped"}

    RUN_STORE.record_combo(label, status="running")
    try:
        sources = await _collect(perplexity, combo, settings)
        RUN_STORE.add_combo_request(
            label, prompt=" | ".join(build_search_queries(combo)),
            raw_response=f"{len(sources)} sources collected", citations=[s["url"] for s in sources],
        )
        raw_experiences = await _extract_all(groq, combo, sources, settings)
        final = await _aggregate(groq, combo, raw_experiences)
    except PerplexityConfigError:
        raise
    except (PerplexityError, GroqError, ValueError, ValidationError) as exc:
        logger.warning("[brief] %s FAILED: %s", label, exc)
        failed = _failed_doc(combo, settings, str(exc))
        await repo.upsert_brief(failed)
        RUN_STORE.record_combo(label, status="failed", error=str(exc), stored_doc=_jsonable(failed))
        return {"combo": label, "status": "failed"}

    status, confidence = derive_status(final)
    final.data_confidence = confidence
    doc = _success_doc(combo, final, raw_experiences, sources, settings, status)
    await repo.upsert_brief(doc)
    ev, inf = count_provenance(final)
    logger.info("[brief] %s OK (status=%s, conf=%s, rounds=%d ev=%d inf=%d, raw=%d, sources=%d)",
                label, status.value, confidence.value, len(final.rounds), ev, inf,
                len(raw_experiences), len(sources))
    RUN_STORE.record_combo(label, status=status.value, data_confidence=confidence.value,
                           brief=final.model_dump(mode="json"), stored_doc=_jsonable(doc))
    return {"combo": label, "status": status.value, "data_confidence": confidence.value}
```

You must add `GroqError` to the `app.groq.client` import line: change it to
`from app.groq.client import GroqClient, GroqError, build_groq_client, gather_capped`.

- [ ] **Step 3: Rewrite `_success_doc` for the new shape**

Replace `_success_doc(...)` with:

```python
def _success_doc(combo, final, raw_experiences, sources, settings, status) -> dict:
    ev, inf = count_provenance(final)
    fe = final.model_dump(mode="json")
    fe["evidence_backed_round_count"] = ev
    fe["inferred_round_count"] = inf
    return {
        "company": combo.company,
        "role": combo.role,
        "level": combo.level,
        "specialization": combo.specialization,
        "generated_at": utcnow(),
        "query_version": PIPELINE_VERSION,
        "raw_experiences": [e.model_dump(mode="json") for e in raw_experiences],
        "final_experience": fe,
        "sources": [s["url"] for s in sources],
        "data_confidence": final.data_confidence.value,
        "generation_status": status.value,
        "models": {
            "search": settings.perplexity_model,
            "extract": settings.groq_model,
            "aggregate": settings.groq_model,
        },
    }
```

In `_failed_doc`, change `"query_version": BRIEF_QUERY_VERSION` → `"query_version": PIPELINE_VERSION` and drop the `perplexity_model` line (or keep as `settings.perplexity_model`; either is fine — prefer keeping).

- [ ] **Step 4: Update `needs_regeneration` and `run_brief_generation`**

In `needs_regeneration`, replace the `BRIEF_QUERY_VERSION` check with `PIPELINE_VERSION`, and change the weak-brief rule so a **successful** brief settles (stops the every-run re-burn):

```python
    if existing.get("query_version") != PIPELINE_VERSION:
        return True
    if existing.get("generation_status") in ("failed", "insufficient_data"):
        return True
    # 'success' briefs settle until stale; only failed/insufficient retry on a manual run.
    generated_at = existing.get("generated_at")
    if generated_at is None:
        return True
    return utcnow() - generated_at > timedelta(days=settings.brief_stale_after_days)
```
(Delete the old `if existing.get("data_confidence") in ("low", "medium"): return True` line.)

In `run_brief_generation`, build the Groq client once and pass it:
```python
    groq = build_groq_client(settings)
    processed = 0
    for i, combo in enumerate(combos, start=1):
        ...
        result = await generate_one(perplexity, groq, combo, settings)
```

- [ ] **Step 5: Update `routes.refresh_brief` to build + pass Groq**

In `app/api/routes.py`, add `from app.groq.client import build_groq_client`, and in `refresh_brief` build and pass it:
```python
    try:
        groq = build_groq_client(settings)
        await generate_one(perplexity, groq, combo, settings, force=True)
```

- [ ] **Step 6: Delete the retired Sonar-chat query module and old models**

```bash
git rm app/prompts/brief_query.py
```
Then in `app/models/brief.py` remove the now-unused `Experience`, `ConsolidatedRound`, `ConsolidatedProcess`, `PerplexityBriefV2` classes (keep `RoundDetail`, the enums, `RawExperience`, `FinalRound`, `FinalExperience`, and the coercion helpers). Update the module docstring's first paragraph to describe the staged pipeline.

- [ ] **Step 7: Verify imports, lint, and full test suite**

Run:
```bash
source .venv/bin/activate
python -c "import app.main, app.api.routes, app.cli, app.jobs.brief_generation; print('imports OK')"
python -m pip install pyflakes -q && python -m pyflakes app/jobs/brief_generation.py app/api/routes.py app/models/brief.py app/groq/client.py app/perplexity/client.py
for t in tests/test_*.py; do python -m "tests.$(basename "$t" .py)"; done
```
Expected: `imports OK`, pyflakes exit 0 (no output), every test prints `ok`.

- [ ] **Step 8: Live smoke on one combo**

With `.env` populated (PERPLEXITY_API_KEY, GROQ_API_KEY, MONGODB_URL) and Mongo running:
```bash
source .venv/bin/activate && python -m app.cli
```
Expected: log line `[brief] <combo> OK (status=..., rounds=N ev=.. inf=..)`. Then re-run the DB inspection (`scratchpad/inspect2.py`) and confirm a stored doc has `final_experience.rounds[*].provenance` set and `raw_experiences` populated.

- [ ] **Step 9: Commit**

```bash
git add app/jobs/brief_generation.py app/api/routes.py app/models/brief.py
git commit -m "feat(pipeline): staged collect->extract->aggregate brief generation (v7)"
```

---

## Self-Review

**Spec coverage:**
- Collect (Perplexity Search, query array, filters, India) → Task 1 (settings) + Task 3 (method) + Task 7 (queries) + Task 8 (`_collect`). ✓
- Extract per source, Groq, parallel-capped, drop non-interview/off-target → Task 2 (`gather_capped`) + Task 5 (prompt) + Task 8 (`_extract_all`). ✓
- Aggregate → one final experience, provenance, India fallback, no invention → Task 4 (models) + Task 6 (prompt) + Task 8 (`_aggregate`). ✓
- Store both raw + final + sources + models + counts → Task 8 (`_success_doc`). ✓
- Confidence from evidence ratio; regeneration settles on success → Task 7 (`derive_status`) + Task 8 (`needs_regeneration`). ✓
- Groq dependency + config → Task 1 + Task 2. ✓
- India-first across stages → queries (Task 7), extract `geo` (Tasks 4/5), aggregate rules (Task 6). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `generate_one(perplexity, groq, combo, settings)` signature consistent across run_brief_generation (Task 8 step 4) and routes.refresh (step 5). `derive_status`/`count_provenance`/`build_search_queries` names match between Task 7 (defs) and Task 8 (calls). `collect_sources` kwargs match between Task 3 (def) and Task 8 (`_collect`). ✓

**Note on scoring rule:** no `score`/`rank`/`grade` field introduced anywhere; provenance + counts are descriptive. ✓
