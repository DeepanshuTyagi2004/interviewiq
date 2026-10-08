"""Stage 1, context (no LLM): resolve the round, the level, the difficulty target and the topics the
problems should cover (spec §6 stage 1, §7.2, §7.3)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.blueprint import topics as T
from app.blueprint.models import BlueprintRunRequest
from app.blueprint.store import company_key
from app.blueprint.trace import StageError
from app.blueprint.vocabulary import family
from app.models.engineering_levels import Level, normalize_legacy_level

DEFAULT_DURATION = {"dsa": 45, "online-assessment": 60, "system-design": 60, "lld": 60, "behavioural": 45, "hiring-manager": 45}

# Candidate-safe format wording for the briefing: never the brief's own format text (it can name topics).
FORMAT_LABEL = {
    "dsa": "coding interview with a shared editor",
    "online-assessment": "timed online coding assessment",
    "system-design": "system design discussion with a shared whiteboard",
    "lld": "low-level design and machine-coding interview",
    "behavioural": "behavioural conversation",
    "hiring-manager": "conversation with a hiring manager",
}

DIFFICULTIES = ("easy", "medium", "hard")

# A technical round whose own description includes a behavioural part, e.g. Amazon's "Coding + Leadership
# Principles" loop rounds: the blueprint then asks those questions too (spec §7.5, mixed rounds).
_CULTURE_PART = re.compile(r"leadership principle|\bLPs?\b|behaviou?ral|googleyness|culture fit|core values", re.I)


# The company's own brief saying its principles come up in every interview ("16 Leadership Principles that
# surface in every interview") makes every technical round mixed, as a real loop is.
_EVERY_ROUND = re.compile(
    r"(leadership principles?|\bLPs?\b|behaviou?ral questions?|googleyness)[^.]{0,80}\b(every|each|all)\s+(interview|round)s?"
    r"|\b(every|each|all)\s+(interview|round)s?\b[^.]{0,80}(leadership principles?|\bLPs?\b|behaviou?ral questions?|googleyness)",
    re.I)


# A technical round whose description also covers things no bank problem of its family tests ("DSA and puzzles",
# "Coding and data modelling: SQL joins", "resume, OOP and DBMS basics"): those are asked as round questions in
# their own share of the core time, and a coding round then asks one problem.
_EXTRA_PART = {
    "dsa": re.compile(r"\bsql\b|\bjoins?\b|data ?model+ing|\bdbms\b|databases?|\boops?\b|object[- ]oriented|operating systems?"
                      r"|computer networks?|networking|puzzles?|aptitude|resume|projects?|machine learning|model evaluation"
                      r"|data leakage|validation splits?|evaluation metrics|system design|\bjava\b|\breact\b|programming basics"
                      r"|core subjects|situational", re.I),
    "lld": re.compile(r"\bsql\b|\bdbms\b|databases?|operating systems?|computer networks?|networking|puzzles?|aptitude|resume"
                      r"|projects?|programming basics|core subjects|situational", re.I),
    "system-design": re.compile(r"\bsql\b|\bjava\b|\breact\b|resume|projects?|programming basics", re.I),
}


def has_extra_part(rnd, fam: str) -> bool:
    pattern = _EXTRA_PART.get(fam if fam != "dsa" or rnd.type.value != "online-assessment" else "")
    return bool(pattern and pattern.search(" ".join([rnd.name or "", rnd.format or "", *rnd.topics])))


def has_culture_part(rnd, fam: str, brief=None) -> bool:
    if fam not in ("dsa", "lld", "system-design") or rnd.type.value == "online-assessment":
        return False
    if _CULTURE_PART.search(" ".join([rnd.name or "", rnd.format or "", *rnd.topics])):
        return True
    notes = " ".join(x or "" for x in ((brief.company_specific_patterns, brief.interviewer_style_notes) if brief else ()))
    return bool(_EVERY_ROUND.search(notes))

# Level -> (allowed range, default target) (spec §7.3).
LEVEL_DIFFICULTY: dict[str, tuple[tuple[str, str], str]] = {
    "intern": (("easy", "medium"), "easy"),
    "fresher": (("easy", "medium"), "medium"),
    "sde1": (("easy", "hard"), "medium"),
    "sde2": (("medium", "hard"), "medium"),
    "sde3": (("medium", "hard"), "hard"),
    "staff": (("medium", "hard"), "hard"),
    "principal": (("medium", "hard"), "hard"),
    "distinguished": (("medium", "hard"), "hard"),
}


def rank(difficulty: str | None) -> int:
    return DIFFICULTIES.index(difficulty) if difficulty in DIFFICULTIES else 1   # missing = medium


def norm_title(text: str) -> str:
    text = re.sub(r"^\s*\d+\s*[.)]\s*", "", text or "")          # "211. Design ..." -> "Design ..."
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@dataclass
class Context:
    request: BlueprintRunRequest
    round_type: str
    family: str
    duration_mins: int
    format_label: str
    level: str                                 # canonical target level used for calibration
    level_label: str                           # the booked label as shown
    difficulty_target: str
    difficulty_window: tuple[int, int]         # inclusive rank bounds
    difficulty_range: tuple[int, int]          # the level's allowed range
    target_topics: set[str]
    topic_sources: dict[str, list[str]]
    company: str
    company_key: str
    named_problems: set[str]                   # normalized titles/slugs named in experiences
    exclusions: set[str] = field(default_factory=set)
    culture: bool = False                      # the round also asks behavioural / company-principle questions
    extra_part: bool = False                   # the round also covers non-problem topics, asked as round questions

    def summary(self) -> dict:
        return {
            "round_type": self.round_type, "family": self.family, "duration_mins": self.duration_mins,
            "level": self.level, "level_label": self.level_label, "difficulty_target": self.difficulty_target,
            "difficulty_window": [DIFFICULTIES[self.difficulty_window[0]], DIFFICULTIES[self.difficulty_window[1]]],
            "target_topics": sorted(self.target_topics), "named_problems": sorted(self.named_problems),
            "exclusions": len(self.exclusions), "company": self.company, "behavioural_part": self.culture, "round_questions_part": self.extra_part,
        }


def build_context(req: BlueprintRunRequest, other_active_slugs: set[str] | None = None) -> Context:
    rnd = req.round
    if rnd is None:
        raise StageError("round_not_found", f"no {req.session.round_type.value} round in the brief or practice snapshot")
    round_type = rnd.type.value
    level = normalize_legacy_level(req.session.level) or Level.SDE1
    (lo, hi), default_target = LEVEL_DIFFICULTY[level.value]
    lo_r, hi_r = rank(lo), rank(hi)
    target = rnd.difficulty.value if rnd.difficulty else default_target
    t = min(max(rank(target), lo_r), hi_r)
    window = (max(lo_r, t - 1), min(hi_r, t + 1))

    jd = req.job_description
    jd_text = " ".join(x for x in (jd.title, jd.description, jd.tech_stack) if x)
    sources = {
        "round": sorted(T.canon(rnd.topics)),
        "company": sorted(T.canon(req.company_brief.dominant_topics if req.company_brief else [])),
        "jd": sorted(T.topics_in(jd_text)),
    }
    fam = family(round_type)
    wanted_kind = {"dsa": "dsa", "system-design": "design", "lld": "design", "behavioural": "behavioural"}[fam]
    target_topics = {tid for ids in sources.values() for tid in ids if T.KIND_OF.get(tid) == wanted_kind}

    exclusions = set() if req.options.ignore_exclusions else set(req.exclusions) | set(other_active_slugs or set())
    culture = has_culture_part(rnd, fam, req.company_brief)
    extra = round_type != "hiring-manager" and has_extra_part(rnd, fam)
    parts = (["behavioural questions"] if culture else []) + (["questions on your projects and fundamentals"] if extra else [])
    return Context(
        request=req, round_type=round_type, family=fam,
        duration_mins=rnd.duration_mins or DEFAULT_DURATION.get(round_type, 45),
        format_label=FORMAT_LABEL.get(round_type, "interview") + (", plus " + " and ".join(parts) if parts else ""),
        level=level.value, level_label=req.session.level,
        difficulty_target=DIFFICULTIES[t], difficulty_window=window, difficulty_range=(lo_r, hi_r),
        target_topics=target_topics, topic_sources=sources,
        company=req.session.company, company_key=company_key(req.session.company),
        named_problems={norm_title(p) for p in rnd.problems if p.strip()},
        exclusions=exclusions, culture=culture,
        extra_part=extra,
    )
