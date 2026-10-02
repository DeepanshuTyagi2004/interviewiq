"""write_draft (spec §3.2 node 8): persist the end-result snapshot as a pending_review draft with a
diff against the last APPROVED snapshot. If nothing changed since the latest draft, write nothing
and report "unchanged"; the runner then marks the company `skipped` (no no-op review items)."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.research.drafts import snapshot_diff
from app.research.models import PIPELINE_VERSION
from app.research.trace.tracer import new_id, utcnow

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps

logger = logging.getLogger(__name__)


async def write_draft(state: "CompanyState", deps: "NodeDeps") -> dict:
    company = state["company"]
    snapshot = {"identity": state["identity"]}
    conflicts = state.get("conflicts") or []

    latest = await deps.store.latest_draft(company["id"])
    if latest and latest["snapshot"] == snapshot and (latest.get("conflicts") or []) == conflicts:
        logger.info("write_draft %s: unchanged since draft v%d", company["name"], latest["version"])
        return {"draft": {"status": "unchanged", "draft_id": latest["draft_id"], "version": latest["version"]}}

    published = await deps.store.latest_draft(company["id"], status="approved")
    version = (latest["version"] if latest else 0) + 1
    diff = snapshot_diff(published["snapshot"] if published else None, snapshot)
    superseded = await deps.store.supersede_pending_drafts(company["id"])
    draft = {
        "draft_id": new_id(), "company_id": company["id"], "version": version, "run_id": deps.run_id,
        "status": "pending_review", "created_at": utcnow(), "snapshot": snapshot, "conflicts": conflicts,
        "diff": diff, "excluded_role_keys": [], "pipeline_version": PIPELINE_VERSION,
    }
    await deps.store.insert_draft(draft)
    deps.tracer.emit(
        "draft.created", f"{company['name']}: draft v{version} · {len(diff)} change(s) · {len(conflicts)} conflict(s)",
        level="info", data={"draft_id": draft["draft_id"], "version": version, "superseded": superseded},
    )
    return {"draft": {"status": "created", "draft_id": draft["draft_id"], "version": version}}
