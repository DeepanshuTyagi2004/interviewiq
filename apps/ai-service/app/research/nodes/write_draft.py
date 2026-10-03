"""write_draft (spec §3.2 node 8): persist the end-result snapshot as a pending_review draft with a
diff against the last APPROVED snapshot. If nothing changed since the latest draft, write nothing
and report "unchanged"; the runner then marks the company `skipped` (no no-op review items)."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.research.coverage import coverage
from app.research.drafts import snapshot_diff
from app.research.fields import fields_for
from app.research.models import PIPELINE_VERSION
from app.research.trace.tracer import new_id, utcnow

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps

logger = logging.getLogger(__name__)


async def write_draft(state: "CompanyState", deps: "NodeDeps") -> dict:
    company = state["company"]
    snapshot = {"identity": state["identity"]}
    if "profile" in state:
        snapshot["profile"] = {k: v for k, v in state["profile"].items()
                               if k in (*fields_for("profile"), "unverified")}
    conflicts = state.get("conflicts") or []
    notes = state.get("notes") or []

    covered = coverage(snapshot, scope="overview")
    summary = {"filled": covered["filled"], "total": covered["total"]}

    latest = await deps.store.latest_draft(company["id"])
    if (latest and latest.get("pipeline_version") == PIPELINE_VERSION
            and latest["snapshot"] == snapshot and (latest.get("conflicts") or []) == conflicts
            and (latest.get("notes") or []) == notes):
        logger.info("write_draft %s: unchanged since draft v%d", company["name"], latest["version"])
        return {"draft": {"status": "unchanged", "draft_id": latest["draft_id"], "version": latest["version"],
                          "coverage": summary}}

    published = await deps.store.latest_draft(company["id"], status="approved")
    version = (latest["version"] if latest else 0) + 1
    # Omitted human-owned sections are not deletion suggestions against a historical full draft.
    baseline = {k: v for k, v in published["snapshot"].items() if k in ("identity", "profile")} if published else None
    diff = snapshot_diff(baseline, snapshot)
    superseded = await deps.store.supersede_pending_drafts(company["id"])
    draft = {
        "draft_id": new_id(), "company_id": company["id"], "version": version, "run_id": deps.run_id,
        "status": "pending_review", "created_at": utcnow(), "snapshot": snapshot, "conflicts": conflicts,
        "diff": diff, "excluded_role_keys": [], "pipeline_version": PIPELINE_VERSION,
        "notes": notes, "coverage": covered, "scope": "overview",
    }
    await deps.store.insert_draft(draft)
    deps.tracer.emit(
        "draft.created", f"{company['name']}: draft v{version} · {len(diff)} change(s) · {len(conflicts)} conflict(s)"
                         f" · coverage {summary['filled']}/{summary['total']}",
        level="info", data={"draft_id": draft["draft_id"], "version": version, "superseded": superseded},
    )
    return {"draft": {"status": "created", "draft_id": draft["draft_id"], "version": version, "coverage": summary}}
