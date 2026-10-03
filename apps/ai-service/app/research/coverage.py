"""Coverage of the tracked draft fields and targeted follow-up planning (evidence-hardening §12).
Pure functions; the nodes run the planned queries."""
from __future__ import annotations

PROFILE_PATHS = ("sector", "business_model", "hq", "headcount_band", "revenue_band", "funding_stage")
OVERVIEW_PATHS = ("overview", *PROFILE_PATHS)
CULTURE_PATHS = ("wlb_rating", "review_summary")
# Reported pay and supported total CTC are separate coverage slots: an unspecified LPA
# observation fills only the former and must not suppress a total-CTC follow-up.
ROLE_PATHS = ("yoe_min", "jd", "required_skills", "ctc_min_lpa", "ctc_observations", "interview")
# Per-node shares of RESEARCH_FOLLOWUP_MAX_QUERIES; roles get whatever is left.
PROFILE_FOLLOWUP_CAP = 1
CULTURE_FOLLOWUP_CAP = 1


def filled(value) -> bool:
    return (isinstance(value, dict) and value.get("provenance") in ("evidence", "derived", "admin_override")
            and value.get("value") not in (None, "", [], {}))


def section_missing(section: dict | None, paths: tuple[str, ...]) -> list[str]:
    return [p for p in paths if not filled((section or {}).get(p))]


def role_missing(row: dict) -> list[str]:
    def has(path: str) -> bool:
        if path == "interview":
            return filled(row.get("interview_process")) or filled(row.get("reported_interview_process"))
        return filled(row.get(path))
    return [p for p in ROLE_PATHS if not has(p)]


def coverage(snapshot: dict, *, scope: str = "full") -> dict:
    # Legacy full drafts retain their original coverage semantics. New suggestions intentionally
    # omit culture/pay/roles, so those sections must not count as gaps.
    if scope == "overview":
        missing = [f"profile.{p}" for p in section_missing(snapshot.get("profile"), OVERVIEW_PATHS)]
        return {"filled": len(OVERVIEW_PATHS) - len(missing), "total": len(OVERVIEW_PATHS), "missing": missing}
    roles = snapshot.get("roles") or []
    missing = [f"profile.{p}" for p in section_missing(snapshot.get("profile"), PROFILE_PATHS)]
    missing += [f"compensation.{p}" for p in section_missing(snapshot.get("compensation"), CULTURE_PATHS)]
    missing += [f"roles[{row['role_key']}].{p}" for row in roles for p in role_missing(row)]
    total = len(PROFILE_PATHS) + len(CULTURE_PATHS) + len(ROLE_PATHS) * len(roles)
    return {"filled": total - len(missing), "total": total, "missing": missing}


def plan_followups(missing: list[str], templates: dict, limit: int) -> list:
    """One query per missing field, de-duplicated (several fields can share a query), in order."""
    out: list = []
    for path in missing:
        query = templates.get(path)
        if len(out) >= limit:
            break
        if query is not None and query not in out:
            out.append(query)
    return out


def followup_budget(state: dict, max_queries: int, node_cap: int | None = None) -> int:
    remaining = max(0, max_queries - int(state.get("followups_used") or 0))
    return remaining if node_cap is None else min(node_cap, remaining)
