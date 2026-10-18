"""Loaders of gate-eval data: the gate log, or past LLM calls recovered from run traces (best effort)."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from app.gates.core import state_hash
from app.gates.keys import MAX_KEY_CHARS
from app.gates.log import MongoGateLog
from app.gates.research import window_state

_REVIEW_FIELDS = ("approaches", "complexity_target", "key_insights", "common_wrong_paths", "edge_cases")

# Loaders return (docs, exclusions): exclusions counts, per reason, the records that could not become eval items.
Loaded = tuple[list[dict], dict[str, int]]


async def from_log(stage: str, *, limit: int) -> Loaded:
    return await MongoGateLog().find(stage, limit=limit), {}


def _parse_json(text: Any) -> Any:
    if not isinstance(text, str):
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _split_review_prompt(user: Any) -> tuple[dict, str] | None:
    """(problem facts, raw answer-key text) from a P.dsa_key_review prompt, or None when it does not parse."""
    if not isinstance(user, str) or not user.startswith("Problem:\n") or "\n\nAnswer key:\n" not in user:
        return None
    head, _, rest = user[len("Problem:\n"):].partition("\n\nAnswer key:\n")
    key_text = rest.split("\n\nFind every factual error", 1)[0]
    facts = _parse_json(head)
    return (facts, key_text) if isinstance(facts, dict) else None


def key_clipped(user: Any) -> bool:
    """The review prompt parses but its answer-key JSON does not: the prompt clipped the key mid-way."""
    parts = _split_review_prompt(user)
    return parts is not None and not isinstance(_parse_json(parts[1]), dict)


def review_state_from_prompt(user: str) -> tuple[dict, str] | None:
    """(state, key_hash) from a P.dsa_key_review prompt, or None when it does not parse. A key the prompt clipped
    is None too: its raw text still holds the solution code, which production's key_state replaces."""
    parts = _split_review_prompt(user)
    if parts is None:
        return None
    facts, key_text = parts
    key = _parse_json(key_text)
    if not isinstance(key, dict):
        return None
    solution = key.get("reference_solution")
    if isinstance(solution, dict) and "code" in solution:
        solution["code"] = "<verified by sandbox>"
    answer_key = json.dumps(key, ensure_ascii=False, default=str)[:MAX_KEY_CHARS]
    return {"problem": facts, "answer_key": answer_key}, hashlib.sha256(key_text.encode()).hexdigest()


def patched_of_reply(raw: Any) -> bool | None:
    data = _parse_json(raw)
    if not isinstance(data, dict):
        return None
    errors = data.get("errors")
    return bool(errors) and any(data.get(f) is not None for f in _REVIEW_FIELDS)


async def key_review_history(*, limit: int) -> Loaded:
    from app.blueprint.store import RUNS
    from app.db.mongo import get_db
    cursor = (get_db()[RUNS]
              .find({"stages.id": "answer_keys"}, {"_id": 0, "run_id": 1, "stages.id": 1, "stages.llm_calls": 1})
              .sort("created_at", -1).limit(max(limit, 1)))
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    reasons: dict[str, int] = {}

    def skip(why: str) -> None:
        reasons[why] = reasons.get(why, 0) + 1

    async for run in cursor:
        for stage in run.get("stages") or []:
            if stage.get("id") != "answer_keys":
                continue
            for rec in stage.get("llm_calls") or []:
                label = rec.get("label") or ""
                if not label.endswith(":review") or not rec.get("valid"):
                    continue
                built = review_state_from_prompt(rec.get("user"))
                patched = patched_of_reply(rec.get("raw"))
                if built is None:
                    skip("answer key clipped in the review prompt" if key_clipped(rec.get("user"))
                         else "review prompt did not parse")
                    continue
                if patched is None:
                    skip("review reply did not parse")
                    continue
                state, key_hash = built
                slug = label.split(":")[1] if label.count(":") >= 2 else label
                if (slug, key_hash) in seen:
                    continue
                seen.add((slug, key_hash))
                out.append({"state": state, "state_hash": state_hash(state),
                            "llm_label": {"patched": patched, "review_ran": True},
                            "llm_latency_ms": rec.get("latency_ms"),
                            "llm_tokens": (rec.get("tokens") or {}).get("prompt"),
                            "context": {"slug": slug, "run_id": run.get("run_id")}})
                if len(out) >= limit:
                    return out, reasons
    return out, reasons


def _claims_count(output: Any) -> int | None:
    data = output.get("data") if isinstance(output, dict) else None
    if isinstance(data, dict):
        data = data.get("claims")
    return len(data) if isinstance(data, list) else None


async def research_history(*, limit: int) -> Loaded:
    from app.db.mongo import get_db
    from app.research.store import PAYLOADS, SPANS
    db = get_db()
    cursor = db[SPANS].find({"kind": "llm"}, {"_id": 0}).sort("started_at", -1).limit(max(limit, 1) * 3)
    out: list[dict] = []
    reasons: dict[str, int] = {}

    def skip(why: str) -> None:
        reasons[why] = reasons.get(why, 0) + 1

    async for span in cursor:
        async def body(key: str):
            if span.get(key) is not None:
                return span[key]
            ref = span.get(f"{key}_ref")
            if not ref:
                return None
            payload = await db[PAYLOADS].find_one({"payload_id": ref}, {"_id": 0})
            return payload.get("body") if payload else None
        inp = await body("input")
        if inp is None:
            skip("input expired or not stored")
            continue
        state = window_state(inp.get("user")) if isinstance(inp, dict) else None
        if state is None:
            skip("not a source-window request")
            continue
        output = await body("output")
        count = _claims_count(output)
        if count is None:
            skip("output missing or not a claims list")
            continue
        out.append({"state": state, "state_hash": state_hash(state), "created_at": span.get("started_at"),
                    "llm_label": {"positive_raw": count > 0},
                    "llm_latency_ms": (span.get("attrs") or {}).get("latency_ms"),
                    "llm_tokens": (span.get("attrs") or {}).get("tokens_in"),
                    "context": {"span_id": span.get("span_id"), "run_id": span.get("run_id")}})
        if len(out) >= limit:
            break
    return out, reasons
