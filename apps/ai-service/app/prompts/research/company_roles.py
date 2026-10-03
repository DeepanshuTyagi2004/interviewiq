"""DRAFT v2 — human review required before production use. Role discovery plus per-role detail:
one query per intent (JD/skills, pay, interview experiences) instead of one overloaded query."""
from app.prompts.research.evidence import Query, build_user, system_for
from app.research.fields import fields_for

PROMPT_NAME = "company_roles"
PROMPT_VERSION = "v2-draft"
FIELDS = fields_for("roles")
SYSTEM = system_for(FIELDS)
QUERIES: tuple[Query, ...] = (
    ("{name} careers software engineer jobs", "company_domain"),
    ("{name} India software engineer jobs job description", None),
)
DETAIL_QUERIES: tuple[Query, ...] = (
    ('"{name}" "{title}" job description skills experience', None),
    ('"{name}" "{title}" salary CTC LPA India', None),
    ('"{name}" "{title}" interview experience rounds questions', None),
)
_REQUIREMENTS: Query = ('"{name}" "{title}" job requirements experience', None)
ROLE_FOLLOWUPS: dict[str, Query] = {
    "yoe_min": _REQUIREMENTS,
    "jd": _REQUIREMENTS,
    "required_skills": _REQUIREMENTS,
    "ctc_min_lpa": ('"{name}" "{title}" salary',
                    ("ambitionbox.com", "glassdoor.co.in", "levels.fyi", "6figr.com", "linkedin.com")),
    "interview": ("{name} {title} interview experience",
                  ("geeksforgeeks.org", "leetcode.com", "glassdoor.co.in", "ambitionbox.com", "medium.com", "linkedin.com")),
}

__all__ = ["PROMPT_NAME", "PROMPT_VERSION", "FIELDS", "SYSTEM", "QUERIES", "DETAIL_QUERIES", "ROLE_FOLLOWUPS",
           "build_user"]
