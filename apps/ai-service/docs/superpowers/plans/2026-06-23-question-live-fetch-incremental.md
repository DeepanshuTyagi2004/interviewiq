# Question Bank — Live Fetch + Incremental/Resume Plan (Phase D)

> **For agentic workers:** Execute task-by-task with TDD. This SUPERSEDES the vendored-seed approach of Task 6 in `2026-06-23-question-set-collection.md`: all sources are now fetched live, and collection is incremental/fail-safe/resumable.

**Goal:** Build the `interview_questions` bank by fetching live from every source (snehasishroy + NeetCode + Kaggle for DSA; donnemartin/karanpratapsingh/ashishps1/InterviewReady for System-Design; prasadgujar-primer/machine-coding-questions/grokking-OOD for LLD), with each source independently fail-safe, per-item persistence, and resume (skip already-done) instead of reset.

**Architecture:** Mongo is the durable resume ledger — no separate checkpoint. Each top-level collector `async collect_X(settings) -> list[QuestionRecord]` fetches its own source and NEVER raises (returns `[]` + logs on failure). The orchestrator runs every collector, upserts each record the moment it's produced, and before each LLM enrich skips any record already stored at the current `COLLECTION_VERSION` with `enrichment_status="enriched"`. A cooperative cancel flag halts cleanly. Bumping `COLLECTION_VERSION` or passing `force=true` does a full re-collect.

**Tech Stack:** Python 3.11, httpx (existing), stdlib `tarfile`/`zipfile`/`csv`/`json`/`re`. Kaggle via its REST download endpoint + HTTP basic auth (NO new pip dependency — httpx + stdlib zipfile). LLM enrichment via existing `LLMClient`.

## Global Constraints
- **Copyright rule:** metadata + canonical URL only; never store the problem statement.
- **Every collector is fail-safe:** any fetch/parse error → log a warning, return `[]` (or the records gathered so far), NEVER raise. One dead source must not abort the run.
- **No live network in tests.** Capture trimmed real fixtures into `tests/fixtures/questions/` and test pure parsers against them; mock `fetch_repo_files`/httpx/Kaggle at the boundary.
- Reuse `app.models.brief.RoundType`/`Difficulty`. Pydantic v2 style.
- Round/source slug rule: DSA slug = leetcode slug; SD/LLD slug = `"<source-prefix>/<slug>"` (unique, traceable).
- Tests: `.venv/bin/python -m pytest`. One commit per task.

---

## Task D1: Config — Kaggle creds + source coordinates

**Files:** Modify `app/config.py`, `.env.example`. Test: `tests/test_config.py` (extend).

Add to `Settings` (after the question-collection block):

```python
    # --- Question bank: live sources ---
    # Kaggle dataset download (official API) — basic-auth with username:key against the REST endpoint.
    # Optional: if unset, the Kaggle DSA source is skipped (fail-safe), the rest of the bank still builds.
    kaggle_username: str = Field("", alias="KAGGLE_USERNAME")
    kaggle_key: str = Field("", alias="KAGGLE_KEY")
    # owner/dataset slug of the LeetCode problems dataset on Kaggle. Override per the dataset you use.
    kaggle_leetcode_dataset: str = Field("gzipchrist/leetcode-problem-dataset", alias="KAGGLE_LEETCODE_DATASET")
    # NeetCode 150 has no official API — fetch a structured (JSON/markdown) mirror from GitHub.
    # owner/repo@ref + path to the file inside it (confirmed reachable at implementation time).
    neetcode_repo: str = Field("", alias="NEETCODE_REPO")          # e.g. "owner/repo@main" ("" => skip)
    neetcode_path: str = Field("", alias="NEETCODE_PATH")          # path within the repo to the list file
```

- [ ] Test: extend `tests/test_config.py` to assert the new fields parse with defaults (and `kaggle_username`/`neetcode_repo` default to `""`). Run `.venv/bin/python -m pytest tests/test_config.py -v`.
- [ ] Implement. Update `.env.example` with the four new vars (commented, no secrets).
- [ ] Commit: `feat(questions): add Kaggle + live-source config`

---

## Task D2: Markdown problem-list parser (shared helper)

**Files:** Create `app/questions/parse_md.py`. Test: `tests/test_parse_md.py`.

The prose-README repos list problems as markdown links / headings. One reusable extractor.

**Interface:** `extract_md_problems(text: str, *, link_filter: str | None = None) -> list[dict]` → list of `{"title": str, "url": str}`.

- [ ] **Test first** (capture the real shapes — bullet links and heading links):

```python
from app.questions.parse_md import extract_md_problems

def test_extracts_bullet_links():
    md = "## Problems\n- [Design TinyURL](problems/tinyurl.md)\n- [Design WhatsApp](https://x/wa)\n\ntext"
    out = extract_md_problems(md)
    assert {"title": "Design TinyURL", "url": "problems/tinyurl.md"} in out
    assert {"title": "Design WhatsApp", "url": "https://x/wa"} in out

def test_link_filter_excludes_nonmatching():
    md = "- [Real](solutions/a.md)\n- [Nav](#section)\n- [Ext](https://twitter.com/x)"
    out = extract_md_problems(md, link_filter="solutions/")
    assert out == [{"title": "Real", "url": "solutions/a.md"}]
```

- [ ] **Implement** with a markdown-link regex `\[([^\]]+)\]\(([^)]+)\)`, dropping anchor-only (`#...`) links, trimming, de-duping by url; when `link_filter` given keep only urls containing it. `# ponytail: regex over a full md parser — these are link lists, not documents; breaks loudly (empty result) on upstream restructure, which the per-source fail-safe absorbs.`
- [ ] Commit: `feat(questions): add markdown problem-list parser`

---

## Task D3: Kaggle dataset fetcher

**Files:** Create `app/questions/kaggle.py`. Test: `tests/test_kaggle_fetch.py`.

**Interface:** `async fetch_kaggle_csv(settings) -> str | None` — returns the first CSV's text from the dataset zip, or `None` (missing creds / any failure). Pure helper `extract_first_csv(zip_bytes: bytes) -> str | None` for testing.

- [ ] **Test first** (in-memory zip; no network):

```python
import io, zipfile
from app.questions.kaggle import extract_first_csv

def test_extract_first_csv_from_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("leetcode.csv", "title,url\nTwo Sum,https://leetcode.com/problems/two-sum/\n")
    out = extract_first_csv(buf.getvalue())
    assert "Two Sum" in out

def test_extract_first_csv_none_when_no_csv():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "x")
    assert extract_first_csv(buf.getvalue()) is None
```

- [ ] **Implement:**

```python
"""Kaggle dataset fetch via the official REST download endpoint + HTTP basic auth
(username:key). No `kaggle` pip dependency — httpx + stdlib zipfile. Fail-safe: any
problem (no creds, 401, network, no CSV) returns None and the Kaggle source is skipped."""
from __future__ import annotations

import io
import logging
import zipfile

import httpx

logger = logging.getLogger(__name__)


def extract_first_csv(zip_bytes: bytes) -> str | None:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            if name.lower().endswith(".csv"):
                return z.read(name).decode("utf-8", errors="replace")
    return None


async def fetch_kaggle_csv(settings) -> str | None:
    if not settings.kaggle_username or not settings.kaggle_key:
        logger.warning("[questions] Kaggle creds not set — skipping Kaggle DSA source")
        return None
    url = f"https://www.kaggle.com/api/v1/datasets/download/{settings.kaggle_leetcode_dataset}"
    try:
        async with httpx.AsyncClient(timeout=settings.github_timeout_seconds, follow_redirects=True) as client:
            resp = await client.get(url, auth=(settings.kaggle_username, settings.kaggle_key))
        if resp.status_code != 200:
            logger.warning("[questions] Kaggle returned %s for %s — skipping", resp.status_code, settings.kaggle_leetcode_dataset)
            return None
        return extract_first_csv(resp.content)
    except Exception as exc:  # noqa: BLE001 — Kaggle is one optional source
        logger.warning("[questions] Kaggle fetch failed (%s) — skipping", exc)
        return None
```

- [ ] Commit: `feat(questions): add Kaggle dataset fetcher (fail-safe)`

---

## Task D4: DSA live collectors

**Files:** Modify `app/questions/collectors/dsa.py`. Test: `tests/test_dsa_collector.py` (extend).

Keep the existing pure parsers (`parse_snehasishroy_csv`, `parse_neetcode`, `parse_kaggle`, `leetcode_slug`). Add three self-fetching, fail-safe collectors:

**Interfaces (all return `list[QuestionRecord]`, never raise):**
- `async collect_snehasishroy(settings)` — fetch the repo tarball, walk company folders, parse. (Rename the existing pure `collect_snehasishroy(files)` → `parse_snehasishroy_tree(files)` and have the new async one call it after `fetch_repo_files`.)
- `async collect_neetcode(settings)` — if `neetcode_repo` set, fetch that repo file (tarball or raw) and parse via `parse_neetcode`; else `[]`.
- `async collect_kaggle(settings)` — `fetch_kaggle_csv(settings)`; if text, `parse_kaggle(text)`; else `[]`.

- [ ] **Test:** keep existing pure-parser tests; rename the tree test to `parse_snehasishroy_tree`. Add a test that `collect_kaggle` returns `[]` when `fetch_kaggle_csv` is monkeypatched to return `None`, and parses records when it returns CSV text. Add a test that `collect_snehasishroy` returns `[]` when `fetch_repo_files` is monkeypatched to raise `GithubFetchError`.
- [ ] **Implement.** Each `collect_*` wraps its fetch in try/except → `[]` on failure.
- [ ] **Confirm a real NeetCode source at implementation time:** find a GitHub repo exposing the NeetCode-150 as structured data (JSON or a markdown table/list). Set `NEETCODE_REPO`/`NEETCODE_PATH` defaults to it in config (D1) and capture a trimmed fixture for `parse_neetcode`. If none is reliably found, leave the defaults `""` (NeetCode simply contributes nothing — fail-safe) and note it.
- [ ] Commit: `feat(questions): live DSA collectors (snehasishroy/neetcode/kaggle)`

---

## Task D5: System-Design live collectors

**Files:** Create `app/questions/collectors/system_design.py`, `tests/fixtures/questions/` (captured samples), `tests/test_sd_collector.py`. Remove SD usage of the vendored seed.

**Interface:** `async collect_system_design(settings) -> list[QuestionRecord]` — fetches the 4 SD repos, returns merged records; never raises. Internally, one fail-safe helper per repo, each wrapped so one repo failing yields `[]` for that repo only.

Pure, fixture-tested helpers:
- `enumerate_donnemartin(files: dict[str, bytes]) -> list[dict]` — find `solutions/system_design/<name>/README.md` (exclude `template`), title = humanized `<name>`, url = the GitHub blob URL.
- `parse_sd_readme(text, source, base_url) -> list[dict]` — uses `extract_md_problems` (Task D2) to pull problem links from karanpratapsingh / ashishps1 / InterviewReady READMEs; resolve relative urls against `base_url`.
- A small mapper `dict -> QuestionRecord` (round_type=system-design, source-prefixed slug, `solution_url`).

- [ ] **Inspect each repo live** (fetch its tarball) to learn the real layout, then **capture a trimmed fixture** (a few entries) into `tests/fixtures/questions/sd_<source>.{md,json}` and write parser tests against the fixtures.
- [ ] **Test first** against the fixtures: assert `enumerate_donnemartin` finds the known problems and skips `template`; assert `parse_sd_readme` extracts ≥1 `{title,url}` from each captured README fixture and resolves urls absolute.
- [ ] **Implement.** `collect_system_design` runs each repo helper under try/except, concatenates, de-dupes by slug. `# ponytail: README parsing is brittle by nature; each repo is independently fail-safe so an upstream restructure drops that source to 0, never breaks the run.`
- [ ] Commit: `feat(questions): live System-Design collectors (4 repos, fail-safe)`

---

## Task D6: LLD live collectors

**Files:** Create `app/questions/collectors/lld.py`, fixtures, `tests/test_lld_collector.py`. Remove LLD usage of the vendored seed.

**Interface:** `async collect_lld(settings) -> list[QuestionRecord]` — fetches the 3 LLD repos; never raises. `is_machine_coding=True` for everything from `machine-coding-questions`.

Pure helpers:
- `enumerate_prasadgujar(files) -> list[dict]` — `solutions/*.md` (exclude README), title = humanized filename, url = blob.
- `parse_lld_readme(text, source, base_url)` — `extract_md_problems` for `machine-coding-questions` README.
- `enumerate_grokking(files) -> list[dict]` — locate the per-problem files in tssovi/grokking-OOD (inspect structure to confirm path pattern).

- [ ] **Inspect + capture fixtures**, **test first** against them (prasadgujar finds ≥1 `.md` problem; machine-coding entries carry `is_machine_coding=True`; grokking enumeration finds problems).
- [ ] **Implement** with per-repo fail-safe wrapping.
- [ ] Commit: `feat(questions): live LLD collectors (3 repos, fail-safe)`

---

## Task D7: Granular per-item state — `source_hash` + stored-state query

Incremental/resume is **granular at the record level**: every record carries a `source_hash` (a hash of its source-derived identity fields). A re-run loads the stored state of every record at the current `COLLECTION_VERSION` and processes ONLY items that are new, source-changed, or not-yet-enriched. No phase-level or source-level skipping — the unit of skip is one question. This mirrors the brief pipeline's hash-based idempotency.

**Files:** Modify `app/questions/models.py` (add field), create `app/questions/hashing.py`, modify `app/db/repositories.py`. Tests: `tests/test_question_models.py` (extend), `tests/test_question_hashing.py`, `tests/test_question_repo.py` (extend pure-key test).

**D7a — model field.** Add to `QuestionRecord` (backward-compatible):
```python
    source_hash: str | None = None   # hash of source-derived fields; drives granular incremental skip
```

**D7b — hash helper** `app/questions/hashing.py`:
```python
"""Stable hash of a question's SOURCE-derived fields, for granular incremental skip.
Excludes LLM-enriched fields (components_tested, patterns_tested, entities_involved,
evaluation_mode, assess, estimated_duration_mins) and volatile fields (collection_version,
last_synced, enrichment_status, source_hash) — so a record re-enriches ONLY when its
upstream source actually changes, not when enrichment output differs."""
from __future__ import annotations

import hashlib
import json

from app.questions.models import QuestionRecord

_SOURCE_FIELDS = ("slug", "round_type", "title", "url", "sources", "difficulty",
                  "topic_tags", "company_tags", "level_tags", "is_machine_coding",
                  "frequency_score", "acceptance_rate", "is_premium", "category",
                  "domain", "solution_url")


def compute_source_hash(rec: QuestionRecord) -> str:
    d = rec.model_dump(mode="json")
    payload = {}
    for k in _SOURCE_FIELDS:
        v = d.get(k)
        payload[k] = sorted(v) if isinstance(v, list) else v   # list order must not matter
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(blob.encode()).hexdigest()
```

- [ ] Test (`tests/test_question_hashing.py`): same source fields → same hash regardless of tag order; changing `title`/`difficulty`/a `company_tag` changes the hash; changing an enriched-only field (`patterns_tested`) does NOT change the hash.

**D7c — stored-state query** in `app/db/repositories.py`:
```python
async def stored_states(collection_version: str) -> dict[tuple[str, str], dict]:
    """{(round_type, slug): {"source_hash", "enrichment_status"}} for records at this version.
    Loaded once per run; drives the granular skip decision per item."""
    cur = get_db()[INTERVIEW_QUESTIONS].find(
        {"collection_version": collection_version},
        {"_id": 0, "round_type": 1, "slug": 1, "source_hash": 1, "enrichment_status": 1})
    return {(d["round_type"], d["slug"]):
            {"source_hash": d.get("source_hash"), "enrichment_status": d.get("enrichment_status")}
            async for d in cur}
```

- [ ] Add `stored_states` to `__all__` if present. Test the pure model/hash behavior; the DB query is covered via the job test's monkeypatch. Commit: `feat(questions): granular source_hash + stored-state query`

---

## Task D8: Incremental / fail-safe / resume orchestrator

**Files:** Rewrite `app/jobs/question_collection.py`. Modify `app/api/admin.py` (force param), `app/questions_cli.py` (force arg). Test: rewrite `tests/test_question_collection_job.py`.

**Behavior (granular — the unit of skip is ONE question):**
- Load `stored = stored_states(version)` ONCE at the start (`{(rt,slug): {source_hash, enrichment_status}}`).
- Every collected record gets `source_hash = compute_source_hash(rec)`.
- **DSA item:** if not `force` and `stored[key].source_hash == rec.source_hash` → `unchanged`, skip the upsert. Else upsert (new or source-changed). No phase-level skip — the tarball is still fetched so changes are detected; only unchanged items skip the write.
- **SD/LLD item:** if not `force` and stored hash matches AND `stored[key].enrichment_status == "enriched"` → `skipped` (already enriched, source unchanged), no LLM call. Else enrich (per-item isolated) + upsert immediately. This is the resume: a crash mid-enrich leaves done items `enriched`; the re-run skips exactly those and continues. A prior `enrich_failed` or `raw` item is retried (its state isn't `enriched`). A source change (hash differs) re-enriches just that item.
- Per item: check `RUN_STORE.is_cancelled()` before the LLM call → `"cancelled"`, no call. Bounded concurrency via `gather_capped`. `source_hash` is preserved across `enrich_one` (re-applied after).
- Counts: `dsa`/`system-design`/`lld` (totals considered), plus `unchanged`/`skipped`/`enriched`/`enrich_failed`/`cancelled`.

**Implementation (complete):**

```python
"""Question-bank collection: live fetch from all sources, GRANULAR incremental + resumable.

Mongo is the durable resume ledger. Each source collector is fail-safe (returns [] on
failure). Every record carries a source_hash; a re-run loads the stored state of all
current-version records once and processes ONLY items that are new, source-changed, or
not-yet-enriched — the unit of skip is one question. Records upsert per-item, so a
crash/cancel keeps finished work. Bump COLLECTION_VERSION or pass force=True to redo all."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import Settings
from app.db import repositories as repo
from app.llm.client import build_llm_client, gather_capped
from app.questions.collectors import dsa as dsa_collector
from app.questions.collectors.lld import collect_lld
from app.questions.collectors.system_design import collect_system_design
from app.questions.enrich import enrich_one
from app.questions.hashing import compute_source_hash
from app.questions.merge import merge_dsa
from app.questions.models import QuestionRecord
from app.jobs.run_store import RUN_STORE

logger = logging.getLogger(__name__)


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _store(rec: QuestionRecord, settings: Settings, stamp: str) -> None:
    rec.collection_version = settings.collection_version
    rec.last_synced = stamp
    await repo.upsert_question(rec.model_dump(mode="json"))


async def collect_questions(settings: Settings, force: bool = False) -> dict:
    stamp = _stamp()
    counts = {"dsa": 0, "system-design": 0, "lld": 0, "unchanged": 0,
              "enriched": 0, "enrich_failed": 0, "skipped": 0, "cancelled": 0}
    stored = await repo.stored_states(settings.collection_version)

    # DSA — granular: fetch all sources (fail-safe), merge, write only new/changed items.
    dsa = merge_dsa([
        await dsa_collector.collect_snehasishroy(settings),
        await dsa_collector.collect_neetcode(settings),
        await dsa_collector.collect_kaggle(settings),
    ])
    for r in dsa:
        r.source_hash = compute_source_hash(r)
        counts["dsa"] += 1
        st = stored.get((r.round_type.value, r.slug))
        if not force and st and st["source_hash"] == r.source_hash:
            counts["unchanged"] += 1
            continue
        await _store(r, settings, stamp)

    # SD/LLD — granular per-item enrich + resume.
    seeds = [*await collect_system_design(settings), *await collect_lld(settings)]
    for s in seeds:
        s.source_hash = compute_source_hash(s)
        counts[s.round_type.value] += 1

    llm = build_llm_client(settings)
    try:
        statuses = await gather_capped(
            [_process_seed(llm, s, settings, stamp, stored, force) for s in seeds],
            settings.question_enrich_concurrency)
    finally:
        await llm.aclose()
    for st in statuses:
        if st in counts:
            counts[st] += 1

    counts["total"] = counts["dsa"] + len(seeds)
    logger.info("[questions] collection done: %s", counts)
    return counts


async def _process_seed(llm, seed: QuestionRecord, settings: Settings, stamp: str,
                        stored: dict, force: bool) -> str:
    st = stored.get((seed.round_type.value, seed.slug))
    if not force and st and st["source_hash"] == seed.source_hash and st["enrichment_status"] == "enriched":
        return "skipped"
    if RUN_STORE.is_cancelled():
        return "cancelled"
    rec = await enrich_one(llm, seed)          # never raises; sets enriched|enrich_failed
    rec.source_hash = seed.source_hash         # preserve across enrichment
    await _store(rec, settings, stamp)
    return rec.enrichment_status               # "enriched" | "enrich_failed"


async def execute_tracked_collection(settings: Settings, run_id: str, force: bool = False) -> dict:
    RUN_STORE.set_stage("question_collection")
    try:
        counts = await collect_questions(settings, force=force)
        RUN_STORE.record_stage_result("question_collection", counts)
        RUN_STORE.finish("completed")
        return counts
    except Exception as exc:  # noqa: BLE001
        logger.exception("Question collection failed")
        RUN_STORE.finish("failed", error=str(exc))
        raise
```

`admin.py`: `trigger_question_collection(force: bool = False)` (FastAPI query param) → pass `force` into `_background_collection` → `execute_tracked_collection(settings, run_id, force=force)`.
`questions_cli.py`: read `force` from `"--force" in sys.argv`, pass it to `collect_questions`.

- [ ] **Rewrite the job test** for the GRANULAR behavior. Monkeypatch the collectors, `repo.stored_states`, `repo.upsert_question` (capture upserts), `build_llm_client`, `enrich_one`, `RUN_STORE.is_cancelled`. Cover:
  - (a) **DSA unchanged skip:** a DSA record whose `(rt,slug)` is in `stored` with a matching `source_hash` is counted `unchanged` and NOT upserted.
  - (b) **DSA changed/new:** a DSA record absent from `stored` (or with a different `source_hash`) IS upserted.
  - (c) **SD/LLD resume skip:** a seed in `stored` with matching hash AND `enrichment_status=="enriched"` returns `"skipped"` and `enrich_one` is NOT called.
  - (d) **SD/LLD retry:** a seed in `stored` with `enrichment_status=="enrich_failed"` (or `"raw"`) IS enriched + upserted (resume retries non-terminal items).
  - (e) **source change re-enrich:** a seed in `stored` as `enriched` but with a DIFFERENT `source_hash` IS re-enriched.
  - (f) **force:** `force=True` re-processes even a matching-hash enriched seed.
  - (g) **cancel:** with `is_cancelled()` true, a seed returns `"cancelled"` and `enrich_one` is NOT called.
  - Use `compute_source_hash` to build matching/mismatching `stored` entries in the test.
- [ ] Run full suite `.venv/bin/python -m pytest -q` (no regressions).
- [ ] Commit: `feat(questions): incremental, fail-safe, resumable collection`

---

## Task D9: Retire vendored seeds

**Files:** Delete `app/questions/collectors/design.py` and `app/questions/data/{system_design.json,lld.json,neetcode_150.json,leetcode_kaggle.csv}` (now superseded by live fetch). Move the source→prefix slug map into a shared `app/questions/collectors/_slug.py` (used by SD/LLD collectors). Delete `tests/test_design_collector.py` or repoint it at the live collectors.

- [ ] Confirm nothing imports the deleted modules (`grep -rn "collectors.design\|load_seed_questions\|questions/data" app tests`).
- [ ] Run full suite. Commit: `refactor(questions): retire vendored seeds for live fetch`

---

## Self-Review
- Live fetch from every source: D3 (Kaggle), D4 (DSA incl. NeetCode), D5 (SD ×4), D6 (LLD ×3). ✓
- Each source fail-safe (returns [] on failure, never aborts): every `collect_*` wraps fetch in try/except. ✓
- **Granular** incremental/resume: D7 `source_hash` + `stored_states`; D8 per-ITEM skip (DSA unchanged-hash skip, SD/LLD skip-if-enriched-and-unchanged, retry non-terminal, re-enrich on source change) + per-item upsert. Unit of skip = one question, not a phase/source. ✓
- Fail-safe enrich: `enrich_one` already isolates per item; cancel checked per item. ✓
- Reset only on demand: `COLLECTION_VERSION` bump or `force=true`. ✓
- No new pip dep (Kaggle via httpx+zipfile). ✓
- Tests use captured fixtures, no live network. ✓

**Implementation-time confirmations (not placeholders):** real NeetCode GitHub source + Kaggle dataset slug must be confirmed live (D4/D1) — if a source can't be confirmed, its config stays `""`/default and it contributes nothing (fail-safe), noted in the report. Real repo structures for SD/LLD parsers are discovered by fetching live + capturing fixtures (D5/D6). Kaggle live path can't be end-to-end verified without the user's KAGGLE creds — unit-tested against a mock zip; flag for live verification.
