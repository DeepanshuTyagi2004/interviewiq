"""DRAFT v2 — human review required before production use. Company culture evidence; role-specific
total CTC is researched by the roles prompt."""
from app.prompts.research.evidence import Query, build_user, system_for
from app.research.fields import fields_for

PROMPT_NAME = "company_compensation"
PROMPT_VERSION = "v2-draft"
FIELDS = fields_for("culture")
SYSTEM = system_for(FIELDS)
REVIEW_SITES = ("ambitionbox.com", "glassdoor.co.in", "in.indeed.com")
QUERIES: tuple[Query, ...] = (
    ("{name} India employee reviews work life balance rating", None),
    ("{name} reviews work life balance", REVIEW_SITES),
)
_WLB: Query = ("{name} work life balance rating", ("ambitionbox.com", "glassdoor.co.in"))
FOLLOWUPS: dict[str, Query] = {"wlb_rating": _WLB, "review_summary": _WLB}

__all__ = ["PROMPT_NAME", "PROMPT_VERSION", "FIELDS", "SYSTEM", "QUERIES", "FOLLOWUPS", "build_user"]
