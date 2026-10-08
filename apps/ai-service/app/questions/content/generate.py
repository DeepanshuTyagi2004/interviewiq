"""Content generation over the question index (`docs/question-bank.md`).

For each record whose content hash (index facts + CONTENT_VERSION) is stale: build the round prompt,
call the Groq-first client, validate strictly, and for DSA **prove the problem correct** before it is
usable (`verify_dsa`): an optimal and an independent brute-force solution are executed on every
example and hidden test and must agree, the model's example outputs must equal what they produce, and
hidden-test expectations are *computed* from them rather than trusted. A failed check goes back to
the model with the exact failures (a bounded number of repair rounds); a problem that still fails is
stored as `failed` with no content, never as usable. Design, LLD and behavioural problems have no
executable tests and are stored as `generated`.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from app.config import Settings
from app.db import repositories as repo
from app.jobs.run_store import RUN_STORE
from app.llm.client import gather_capped
from app.questions.content.models import DsaContent, GeneratedEnvelope, validate_content
from app.questions.content.prompts import CONTENT_SYSTEM, CONTENT_VERSION, build_content_prompt, build_repair_prompt
from app.questions.content.sandbox import run_collect, same, same_unordered
from app.questions.content.source_examples import SourceStatement, load_source_statements
from app.questions.hashing import compute_content_hash
from app.questions.models import QuestionRecord

logger = logging.getLogger(__name__)

STATUSES = ("verified", "generated", "failed", "skipped", "cancelled")
DSA_ROUNDS = ("dsa", "online-assessment")


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_content_llm_client(settings: Settings, *, grounded: bool = False):
    """Groq first with a content-sized output budget; falls back like research does. Grounded problems need
    far less output, and the quota ledger reserves prompt + this budget per call, so the small budget is what
    lets several calls fit in each key's per-minute allowance."""
    from app.llm.research_client import ResearchLLMClient

    return ResearchLLMClient(settings, deadline_seconds=settings.question_content_deadline_seconds,
                             groq_stage_seconds=settings.question_content_groq_stage_seconds,
                             max_output_tokens=(settings.question_content_grounded_max_output_tokens if grounded
                                                else settings.question_content_max_output_tokens))


def _union(a: list[str], b: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in [*a, *b]:
        key = x.lower()
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


def apply_inferred(record: QuestionRecord, inferred) -> dict:
    """Index fills from the model: only where the sources left nothing, except topics (added) and
    company tags (added, marked `inferred`; existing ones marked `reported` if unmarked)."""
    patch: dict = {}
    if not record.difficulty and inferred.difficulty:
        patch["difficulty"] = inferred.difficulty
    if not record.level_tags and inferred.level_tags:
        patch["level_tags"] = inferred.level_tags
    if inferred.topic_tags:
        patch["topic_tags"] = _union(record.topic_tags, inferred.topic_tags)
    evidence = dict(record.company_evidence)
    for slug in record.company_tags:
        evidence.setdefault(slug, "reported")
    if inferred.company_tags:
        added = [s.lower() for s in inferred.company_tags if s.lower() not in evidence]
        for slug in added:
            evidence[slug] = "inferred"
        if added:
            patch["company_tags"] = _union(record.company_tags, added)
    patch["company_evidence"] = evidence
    return patch


# ---------------------------------------------------------------- DSA verification

def _short(value, limit: int = 120) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + "…"


def apply_source_examples(raw: dict, source: SourceStatement) -> dict:
    """Make the source's validated examples the problem's examples; the model only contributes the explanations."""
    explained = [e.get("explanation") for e in (raw.get("examples") or []) if isinstance(e, dict)]
    raw = dict(raw)
    raw["examples"] = [{"args": ex.args, "expected": ex.expected,
                        "explanation": (explained[i] if i < len(explained) and explained[i] else "Follow the statement step by step to reach this output.")}
                       for i, ex in enumerate(source.examples)]
    return raw


async def verify_dsa(dsa: DsaContent, settings: Settings, *, ground_truth: bool = False) -> list[str]:
    """Problems found in a DSA problem (empty = usable). With `ground_truth` the examples come from a validated
    source and there is nothing of ours to run. Without one, both solutions are executed on every example and
    hidden test and must agree; on success the hidden tests' expected values are replaced by the verified outputs."""
    eq = same_unordered if dsa.answer_order_irrelevant else same
    ref, brute = dsa.reference_solution, dsa.brute_force_solution
    issues: list[str] = []
    if ground_truth:
        return []  # the source's examples are validated and nothing of ours is executable: answers are built at prep time
    if ref is None or brute is None or len(dsa.judge_tests) < 5 or not dsa.approaches or not dsa.rubric:
        return ["without a validated source you must provide reference_solution, an independent brute_force_solution, at least 5 judge_tests, approaches and a rubric"]
    if ref.entry_point != brute.entry_point:
        return [f"the brute-force solution must define the same function name as the optimal one ({ref.entry_point}, got {brute.entry_point})"]
    inputs = [e.args for e in dsa.examples] + [t.args for t in dsa.judge_tests]
    timeout = settings.question_content_sandbox_timeout_seconds
    ref_run = await asyncio.to_thread(run_collect, ref.code, ref.entry_point, inputs, timeout_seconds=timeout)
    brute_run = await asyncio.to_thread(run_collect, brute.code, brute.entry_point, inputs, timeout_seconds=timeout)
    for name, run in (("optimal", ref_run), ("brute-force", brute_run)):
        if not run.ran or run.error:
            issues.append(f"the {name} solution failed to run: {run.error}")
    if issues:
        return issues
    for i, (a, b) in enumerate(zip(ref_run.outputs, brute_run.outputs)):
        where = f"example {i + 1}" if i < len(dsa.examples) else f"hidden test {i - len(dsa.examples) + 1}"
        if not a.get("ok") or not b.get("ok"):
            issues.append(f"{where} {_short(inputs[i])}: a solution raised ({a.get('error') or b.get('error')})")
        elif not eq(a["result"], b["result"]):
            issues.append(f"{where} {_short(inputs[i])}: optimal returned {_short(a['result'])} but brute-force returned {_short(b['result'])}")
    if issues:
        return issues[:8]
    results = [o["result"] for o in ref_run.outputs]
    for i, e in enumerate(dsa.examples):
        if not eq(e.expected, results[i]):
            who = "the validated reference output is" if ground_truth else "you wrote expected"
            fix = " (this example is ground truth: fix the SOLUTIONS, or set answer_order_irrelevant if any order is accepted)" if ground_truth else ""
            issues.append(f"example {i + 1} {_short(e.args)}: {who} {_short(e.expected)} but your solutions return {_short(results[i])}{fix}")
        if not ground_truth and isinstance(e.expected, (list, dict, str)) and len(e.expected) > 1 and any(same(e.expected, v) for v in e.args.values()):
            issues.append(f"example {i + 1} is trivial: its expected output equals its input; choose an input where the answer differs")
    if not ground_truth and len({json.dumps(e.args, sort_keys=True, default=str) for e in dsa.examples}) < len(dsa.examples):
        issues.append("the two examples use the same input")
    if len({json.dumps(t.args, sort_keys=True, default=str) for t in dsa.judge_tests}) < len(dsa.judge_tests):
        issues.append("hidden tests contain duplicate inputs")
    if len({json.dumps(r, sort_keys=True, default=str) for r in results}) < 2:
        issues.append("every example and test has the same output; add tests whose answers differ")
    if issues:
        return issues[:8]
    for t, r in zip(dsa.judge_tests, results[len(dsa.examples):]):
        t.expected = r
    return []


# ---------------------------------------------------------------- LLM calls

_QUOTA_MARKERS = ("no_eligible_providers", "quota", "rate limit", "429")


def _is_quota(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in _QUOTA_MARKERS)


async def _complete_waiting_for_quota(llm, user_prompt: str, slug: str, settings: Settings, label: str = "content"):
    """Free-tier keys run out of per-minute quota under load. That is a wait, not a failure: back off
    and retry (bounded), so a run spends its time generating instead of marking items failed."""
    attempts = settings.question_content_quota_retries
    for attempt in range(attempts + 1):
        try:
            return await llm.complete_full(CONTENT_SYSTEM, user_prompt, label=f"{label}:{slug}")
        except Exception as exc:  # noqa: BLE001
            if attempt == attempts or not _is_quota(exc) or RUN_STORE.is_cancelled():
                raise
            await asyncio.sleep(min(60.0, 15.0 * (attempt + 1)))


async def _write_with_retry(key: tuple[str, str], patch: dict, attempts: int = 4) -> None:
    """A generated problem is paid for: ride out a short database blip (Atlas failover) rather than lose it."""
    for attempt in range(attempts):
        try:
            await repo.update_question_content(*key, patch)
            return
        except Exception as exc:  # noqa: BLE001
            if attempt == attempts - 1:
                raise
            logger.warning("[questions] write retry %d for %s/%s (%s)", attempt + 1, key[0], key[1], exc)
            await asyncio.sleep(2 ** attempt * 2)


# ---------------------------------------------------------------- one record

async def generate_one(llm, doc: dict, settings: Settings, stamp: str, *, force: bool = False,
                       source: SourceStatement | None = None, grounded_llm=None) -> str:
    """Generate, validate, prove (DSA) and store content for one index record. Returns its status."""
    record = QuestionRecord.model_validate(doc)
    key = (record.round_type.value, record.slug)
    content_hash = compute_content_hash(record, CONTENT_VERSION)
    if not force and doc.get("content_hash") == content_hash and doc.get("content_status") in ("verified", "generated"):
        return "skipped"
    if RUN_STORE.is_cancelled():
        return "cancelled"
    base = {"content_version": CONTENT_VERSION, "content_hash": content_hash, "content_generated_at": stamp}
    is_dsa = record.round_type.value in DSA_ROUNDS
    source = source if is_dsa else None
    if source is not None and grounded_llm is not None:
        llm = grounded_llm
    prompt = build_content_prompt(doc, source)
    issues: list[str] = []
    envelope = content = result = None
    try:
        for attempt in range(settings.question_content_repair_rounds + 1 if is_dsa else 1):
            result = await _complete_waiting_for_quota(llm, prompt, record.slug, settings, label="content" if attempt == 0 else "repair")
            try:
                envelope = GeneratedEnvelope.model_validate(result.data)
                raw = apply_source_examples(envelope.content, source) if source is not None else envelope.content
                content = validate_content(record.round_type.value, raw)
            except Exception as exc:  # noqa: BLE001 — a malformed attempt is repaired like a failed check
                issues = [f"the JSON did not validate: {str(exc)[:400]}"]
                content = None
            else:
                issues = await verify_dsa(content, settings, ground_truth=source is not None) if is_dsa else []
            if not issues:
                break
            logger.info("[questions] %s/%s attempt %d: %d problem(s): %s", key[0], key[1], attempt + 1, len(issues), issues[0][:160])
            if is_dsa:
                prompt = build_repair_prompt(doc, result.data.get("content", result.data) if isinstance(result.data, dict) else {}, issues, source)
    except Exception as exc:  # noqa: BLE001 — one bad generation must not abort the run
        logger.warning("[questions] content failed for %s/%s (%s)", key[0], key[1], exc)
        await _write_with_retry(key, {**base, "content": None, "content_status": "failed", "content_error": str(exc)[:500]})
        return "failed"
    if issues or content is None or envelope is None:
        logger.warning("[questions] content rejected for %s/%s: %s", key[0], key[1], "; ".join(issues)[:300])
        await _write_with_retry(key, {**base, "content": None, "content_status": "failed", "content_error": ("did not verify: " + "; ".join(issues))[:500]})
        return "failed"
    status = "verified" if is_dsa else "generated"
    patch = {**base, **apply_inferred(record, envelope.inferred), "content": content.model_dump(mode="json"),
             "content_status": status, "content_error": None, "content_model": result.model or None}
    await _write_with_retry(key, patch)
    return status


async def generate_content(settings: Settings, *, round_type: str | None = None, limit: int | None = None, force: bool = False) -> dict:
    stamp = _stamp()
    grounded_only = not settings.question_content_allow_ungrounded
    # With the grounding policy the limit applies after filtering, or it would be spent on ungroundable records.
    docs = await repo.questions_needing_content(round_type, CONTENT_VERSION, None if grounded_only else limit, force)
    counts = {s: 0 for s in STATUSES}
    sources = await load_source_statements(settings) if any(d.get("round_type") in DSA_ROUNDS for d in docs) else {}
    if grounded_only:
        kept = [d for d in docs if d.get("round_type") not in DSA_ROUNDS or d.get("slug") in sources]
        counts["skipped"] += len(docs) - len(kept)
        docs = kept[:limit] if limit else kept
    counts["candidates"] = len(docs)
    if not docs:
        return counts
    llm = build_content_llm_client(settings)
    grounded_llm = build_content_llm_client(settings, grounded=True) if sources else None
    try:
        statuses = await gather_capped([generate_one(llm, d, settings, stamp, force=force, source=sources.get(d.get("slug")), grounded_llm=grounded_llm)
                                        for d in docs], settings.question_content_concurrency)
    finally:
        await llm.aclose()
        if grounded_llm is not None:
            await grounded_llm.aclose()
    for st in statuses:
        if st in counts:
            counts[st] += 1
    logger.info("[questions] content generation done: %s", counts)
    return counts
