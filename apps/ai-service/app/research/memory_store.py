"""In-memory ResearchStore for tests and `python -m app.research.cli --memory`. Mirrors
MongoResearchStore exactly: dotted-path $set/$inc, sort orders, projections, deep copies in and
out (so callers can never mutate stored state by accident)."""
from __future__ import annotations

import copy
from collections.abc import Iterable

from app.research.models import ACTIVE_RUN_STATUSES
from app.research.store import SPAN_LIST_EXCLUDE, DuplicateKey, EventFilter, event_matches


def _copy(doc: dict | None) -> dict | None:
    return copy.deepcopy(doc) if doc is not None else None


def _parent(doc: dict, path: str) -> tuple[dict, str]:
    *parents, last = path.split(".")
    cur = doc
    for part in parents:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    return cur, last


def _apply(doc: dict, fields: dict | None, inc: dict | None) -> None:
    for path, value in (fields or {}).items():
        parent, key = _parent(doc, path)
        parent[key] = copy.deepcopy(value)
    for path, delta in (inc or {}).items():
        parent, key = _parent(doc, path)
        parent[key] = (parent.get(key) or 0) + delta


class InMemoryResearchStore:
    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.items: dict[tuple[str, str], dict] = {}
        self.spans: dict[str, dict] = {}
        self.events: list[dict] = []
        self.payloads: dict[str, dict] = {}
        self.sources: dict[str, dict] = {}
        self.extracts: dict[str, dict] = {}
        self.company_states: dict[str, dict] = {}
        self.drafts: list[dict] = []

    # --- runs ---
    async def insert_run(self, run: dict) -> None:
        if run["run_id"] in self.runs:
            raise DuplicateKey(f"duplicate run_id {run['run_id']}")
        self.runs[run["run_id"]] = copy.deepcopy(run)

    async def get_run(self, run_id: str) -> dict | None:
        return _copy(self.runs.get(run_id))

    async def update_run(self, run_id: str, *, fields: dict | None = None, inc: dict | None = None) -> dict | None:
        doc = self.runs.get(run_id)
        if doc is None:
            return None
        _apply(doc, fields, inc)
        return copy.deepcopy(doc)

    async def find_active_run(self) -> dict | None:
        active = [r for r in self.runs.values() if r["status"] in ACTIVE_RUN_STATUSES]
        return _copy(max(active, key=lambda r: r["created_at"])) if active else None

    async def find_runs_by_status(self, statuses: Iterable[str]) -> list[dict]:
        wanted = frozenset(statuses)
        rows = sorted((r for r in self.runs.values() if r["status"] in wanted), key=lambda r: r["created_at"])
        return copy.deepcopy(rows)

    async def list_runs(self, limit: int) -> list[dict]:
        rows = sorted(self.runs.values(), key=lambda r: r["created_at"], reverse=True)[:limit]
        return [{k: copy.deepcopy(v) for k, v in r.items() if k != "targets"} for r in rows]

    # --- items ---
    async def insert_items(self, items: list[dict]) -> None:
        # Check for duplicates within batch
        seen = set()
        for item in items:
            key = (item["run_id"], item["company_id"])
            if key in seen:
                raise DuplicateKey(f"duplicate item (run_id, company_id) within batch: {key}")
            if key in self.items:
                raise DuplicateKey(f"duplicate item (run_id, company_id): {key}")
            seen.add(key)
        # Now insert all (no duplicates found)
        for item in items:
            self.items[(item["run_id"], item["company_id"])] = copy.deepcopy(item)

    async def list_items(self, run_id: str) -> list[dict]:
        rows = sorted((i for (rid, _), i in self.items.items() if rid == run_id), key=lambda i: i["position"])
        return copy.deepcopy(rows)

    async def update_item(self, run_id: str, company_id: str, *, fields: dict | None = None, inc: dict | None = None) -> None:
        doc = self.items.get((run_id, company_id))
        if doc is not None:
            _apply(doc, fields, inc)

    # --- spans ---
    async def put_span(self, span: dict) -> None:
        self.spans[span["span_id"]] = copy.deepcopy(span)

    async def get_span(self, span_id: str) -> dict | None:
        return _copy(self.spans.get(span_id))

    async def list_spans(self, run_id: str, company_id: str | None = None) -> list[dict]:
        rows = [s for s in self.spans.values()
                if s["run_id"] == run_id and (company_id is None or s.get("company_id") == company_id)]
        rows.sort(key=lambda s: s["started_at"])
        return [{k: copy.deepcopy(v) for k, v in s.items() if k not in SPAN_LIST_EXCLUDE} for s in rows]

    # --- events ---
    async def insert_events(self, events: list[dict]) -> None:
        # Check for duplicates within batch
        seen = set()
        existing_keys = {(e["run_id"], e["seq"]) for e in self.events}
        for event in events:
            key = (event["run_id"], event["seq"])
            if key in seen:
                raise DuplicateKey(f"duplicate event (run_id, seq) within batch: {key}")
            if key in existing_keys:
                raise DuplicateKey(f"duplicate event (run_id, seq): {key}")
            seen.add(key)
        # Now insert all (no duplicates found)
        self.events.extend(copy.deepcopy(e) for e in events)

    async def list_events(self, run_id: str, flt: EventFilter) -> list[dict]:
        rows = sorted((e for e in self.events if e["run_id"] == run_id and event_matches(e, flt)), key=lambda e: e["seq"])
        rows = rows[-flt.limit:] if flt.before_seq is not None else rows[: flt.limit]
        return copy.deepcopy(rows)

    async def max_event_seq(self, run_id: str) -> int:
        run_events = [e for e in self.events if e["run_id"] == run_id]
        return max((e["seq"] for e in run_events), default=0)

    # --- payloads / sources / extracts ---
    async def put_payload(self, payload: dict) -> None:
        if payload["payload_id"] in self.payloads:
            raise DuplicateKey(f"duplicate payload_id {payload['payload_id']}")
        self.payloads[payload["payload_id"]] = copy.deepcopy(payload)

    async def get_payload(self, payload_id: str) -> dict | None:
        return _copy(self.payloads.get(payload_id))

    async def upsert_source(self, source: dict) -> None:
        doc = copy.deepcopy(source)
        kinds = doc.pop("kinds", [])
        current = self.sources.setdefault(doc["url"], {"kinds": []})
        current.update(doc)
        current["kinds"] = current["kinds"] + [k for k in kinds if k not in current["kinds"]]

    async def get_source(self, url: str) -> dict | None:
        return _copy(self.sources.get(url))

    async def get_extract(self, key: str) -> dict | None:
        return _copy(self.extracts.get(key))

    async def put_extract(self, extract: dict) -> None:
        self.extracts[extract["key"]] = copy.deepcopy(extract)

    # --- company research state / drafts ---
    async def upsert_company_state(self, company_id: str, *, fields: dict) -> None:
        current = self.company_states.setdefault(company_id, {"company_id": company_id})
        _apply(current, fields, None)

    async def list_company_states(self, company_ids: list[str] | None = None) -> list[dict]:
        rows = [s for cid, s in self.company_states.items() if company_ids is None or cid in company_ids]
        return copy.deepcopy(rows)

    async def latest_draft(self, company_id: str, *, status: str | None = None) -> dict | None:
        rows = [d for d in self.drafts if d["company_id"] == company_id and (status is None or d["status"] == status)]
        return _copy(max(rows, key=lambda d: d["version"])) if rows else None

    async def insert_draft(self, draft: dict) -> None:
        # Check for duplicate draft_id
        if any(d["draft_id"] == draft["draft_id"] for d in self.drafts):
            raise DuplicateKey(f"duplicate draft_id {draft['draft_id']}")
        # Check for duplicate (company_id, version)
        if any(d["company_id"] == draft["company_id"] and d["version"] == draft["version"] for d in self.drafts):
            raise DuplicateKey(f"duplicate draft (company_id, version): ({draft['company_id']}, {draft['version']})")
        self.drafts.append(copy.deepcopy(draft))

    async def supersede_pending_drafts(self, company_id: str) -> int:
        n = 0
        for d in self.drafts:
            if d["company_id"] == company_id and d["status"] == "pending_review":
                d["status"] = "superseded"
                n += 1
        return n

    async def get_draft(self, draft_id: str) -> dict | None:
        return _copy(next((d for d in self.drafts if d["draft_id"] == draft_id), None))

    async def decide_draft(self, draft_id: str, *, status: str, fields: dict) -> bool:
        for d in self.drafts:
            if d["draft_id"] == draft_id and d["status"] == "pending_review":
                d.update(copy.deepcopy(fields))
                d["status"] = status
                return True
        return False
