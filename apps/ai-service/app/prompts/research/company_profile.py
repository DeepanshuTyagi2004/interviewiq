"""DRAFT v3 — overview-only research; human review required before production use."""
from app.prompts.research.evidence import Query, build_user, system_for
from app.research.fields import fields_for

PROMPT_NAME = "company_profile"
PROMPT_VERSION = "v3-overview-draft"
FIELDS = fields_for("profile")
SYSTEM = (system_for(FIELDS) + "\nFocus on the company's overview. Extract other profile facts only when present in "
          "the same evidence. Do not extract culture, salary, role/JD or interview details. Never invent missing facts.")
QUERIES: tuple[Query, ...] = (
    ("{name} company overview products business model", None),
    ("{name} about us", "company_domain"),
)
FOLLOWUPS: dict[str, Query] = {
    "overview": ("{name} company overview products services", None),
}

__all__ = ["PROMPT_NAME", "PROMPT_VERSION", "FIELDS", "SYSTEM", "QUERIES", "FOLLOWUPS", "build_user"]
