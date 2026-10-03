"""One table of extraction field rules (evidence-hardening spec §7.1).

FIELD_SPECS drives BOTH the field documentation rendered into the extraction prompt AND the
grounding rules, so the prompt and the validator cannot drift apart. Pure: no I/O."""
from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from typing import Literal

Kind = Literal["text", "number", "category", "item"]
Section = Literal["profile", "culture", "roles"]

LEVELS = frozenset({"intern", "fresher", "sde1", "sde2", "sde3", "staff", "principal"})


@dataclass(frozen=True)
class FieldSpec:
    name: str
    section: Section
    kind: Kind
    doc: str
    india_only: bool = False
    allowed: frozenset[str] = dc_field(default_factory=frozenset)
    max_len: int | None = None
    time_sensitive: bool = False


def _spec(name: str, section: Section, kind: Kind, doc: str, **kw) -> FieldSpec:
    # Culture and role facts must be India-specific; company profile facts are global.
    return FieldSpec(name, section, kind, doc, india_only=section != "profile", **kw)


_SPECS = (
    _spec("overview", "profile", "text", "a concise source passage describing what the company does and its products "
          "or services; exclude employee culture, compensation, jobs and interview advice.", max_len=1500),
    _spec("sector", "profile", "category", "the company's sector.",
          allowed=frozenset({"fintech", "e-commerce", "saas", "it-services", "consumer-internet", "enterprise-software",
                             "semiconductors", "telecom", "edtech", "healthtech", "gaming", "logistics", "other"})),
    _spec("business_model", "profile", "category", "product, service or hybrid company.",
          allowed=frozenset({"product", "service", "hybrid"})),
    _spec("hq", "profile", "text", "the company's actual headquarters, as printed.", max_len=255),
    _spec("headcount_band", "profile", "text", "reported employee count or band with its units, as printed; never estimate.",
          max_len=32, time_sensitive=True),
    _spec("revenue_band", "profile", "text", "reported revenue figure or band with currency and period, as printed.",
          max_len=32, time_sensitive=True),
    _spec("funding_stage", "profile", "category", "only when the source states it in these words (public, bootstrapped, …); "
          "for a named round use funding_round instead.",
          allowed=frozenset({"public", "late-stage", "growth", "early", "bootstrapped", "subsidiary"}), time_sensitive=True),
    _spec("funding_round", "profile", "text", "the latest funding round exactly as printed, e.g. \"Series D\".",
          max_len=32, time_sensitive=True),
    _spec("wlb_rating", "culture", "number", "work-life-balance rating on a five-point scale (not the overall rating); "
          "the number printed next to the work-life-balance label.", time_sensitive=True),
    _spec("wlb_review_count", "culture", "number", "only a review count explicitly tied to that work-life-balance rating.",
          time_sensitive=True),
    _spec("review_summary", "culture", "text", "an employee-review passage summarising culture or work-life balance."),
    _spec("review_quote", "culture", "text", "one short exact employee review quote.", max_len=300),
    _spec("title", "roles", "text", "the company's own role title exactly as printed; role_title must equal it."),
    _spec("employment_type", "roles", "category", "only when stated: full_time, intern or contract.",
          allowed=frozenset({"full_time", "intern", "contract"})),
    _spec("level", "roles", "category", "only when the source explicitly states the seniority; never derive it from "
          "years of experience.", allowed=LEVELS),
    _spec("specialization", "roles", "text", "the explicitly stated specialization, e.g. Backend, Frontend, ML."),
    _spec("yoe_min", "roles", "number", "minimum years of experience required for the role."),
    _spec("yoe_max", "roles", "number", "maximum years of experience for the role."),
    _spec("required_skill", "roles", "item", "ONE required skill per claim (language, tool, concept).", max_len=64),
    _spec("preferred_skill", "roles", "item", "ONE nice-to-have / preferred skill per claim.", max_len=64),
    _spec("tech_stack", "roles", "item", "ONE technology the team uses per claim (language, framework, database, cloud).",
          max_len=64),
    _spec("location", "roles", "item", "ONE Indian city where the role is based, per claim.", max_len=64),
    _spec("ctc_min_lpa", "roles", "number", "lower end of the total annual CTC, the ORIGINAL number in the quote "
          "(not converted); unit INR_LPA, INR_ANNUAL or INR_MONTHLY.", time_sensitive=True),
    _spec("ctc_max_lpa", "roles", "number", "upper end of the total annual CTC, same rules as ctc_min_lpa; for a "
          "single figure use the same number for both.", time_sensitive=True),
    _spec("jd", "roles", "text", "a passage of the job description: responsibilities or requirements."),
    _spec("interview_process", "roles", "text", "a passage reporting this role's actual interview rounds, topics or "
          "questions; never a generic template.", time_sensitive=True),
)

FIELD_SPECS: dict[str, FieldSpec] = {s.name: s for s in _SPECS}
NUMERIC: frozenset[str] = frozenset(s.name for s in _SPECS if s.kind == "number")
TIME_SENSITIVE: frozenset[str] = frozenset(s.name for s in _SPECS if s.time_sensitive)


def fields_for(section: Section) -> tuple[str, ...]:
    return tuple(s.name for s in _SPECS if s.section == section)


def render_field_docs(names: tuple[str, ...] | list[str]) -> str:
    lines = []
    for name in names:
        s = FIELD_SPECS[name]
        allowed = f"; one of {', '.join(sorted(s.allowed))}" if s.allowed else ""
        limit = f"; at most {s.max_len} characters" if s.max_len else ""
        lines.append(f"- {name} ({s.kind}{allowed}{limit}): {s.doc}")
    return "\n".join(lines)
