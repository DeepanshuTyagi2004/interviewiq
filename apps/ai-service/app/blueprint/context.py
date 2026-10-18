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

# A mock round is 30, 35, 40 or 45 minutes, drawn at booking; the API sends the session's own length as `duration_mins` (decided
# 2026-10-18). 45 is the maximum and what a request that names no length (or an old session) gets.
MOCK_ROUND_MINUTES = 45
DEFAULT_DURATION = {t: MOCK_ROUND_MINUTES for t in ("dsa", "online-assessment", "system-design", "lld", "behavioural", "hiring-manager")}

# A technical round's main problem (coding, design, machine coding) gets at least this long (decided 2026-10-18, when rounds became
# 30-45 minutes): at 30 minutes the core is about 19, so equal shares (or a behavioural part) would leave a problem 2-9 minutes. What
# does not fit is dropped: a coding round's second problem is a bonus, a behavioural part keeps fewer questions, the extra part gets
# what is left. Where the old equal split already gives the problem this long, it is unchanged, and at 45 minutes (every round kind) the old split is kept
# whole (`has_problem_floor`; decided 2026-10-18): the floor is for the shorter lengths.
MIN_FIRST_PROBLEM_MINS = 15
MIN_CULTURE_MINS = 4
MIN_EXTRA_MINS = 4          # the extra part (projects, fundamentals, puzzles) is not worth asking in less


def base_phases(round_type: str, fam: str, duration: int) -> dict[str, int]:
    """The conversation phases around the core and their minutes. Short rounds give up small talk, the candidate's questions
    and then the introduction before the core shrinks below 10 minutes."""
    if round_type == "online-assessment":
        fixed = {"greeting": 1, "framing": 1, "wrap_up": 1}
    else:
        intro = 3 if fam == "behavioural" else 2
        fixed = {"greeting": 1, "small_talk": 2, "framing": 1, "candidate_intro": intro, "candidate_questions": 4, "wrap_up": 1}
    for phase in ("small_talk", "candidate_questions", "candidate_intro"):
        if duration - sum(fixed.values()) >= 10:
            break
        fixed.pop(phase, None)
    return fixed


def core_minutes(round_type: str, fam: str, duration: int) -> int:
    return max(1, duration - sum(base_phases(round_type, fam, duration).values()))


def has_problem_floor(round_type: str, fam: str, duration: int) -> bool:
    """A round built around a main technical problem (coding, system design, LLD), which MIN_FIRST_PROBLEM_MINS protects. Online
    assessments, hiring-manager and behavioural rounds have none, and neither has a 45-minute round of any kind: the floor is for the shorter
    lengths (decided 2026-10-18, final review: at 45 every round keeps the pre-change split, an extra-part coding round its 11-minute problems,
    its 12-minute deep dive and a second problem that is not a bonus)."""
    return duration < MOCK_ROUND_MINUTES and fam in ("dsa", "lld", "system-design") and round_type not in ("online-assessment", "hiring-manager", "behavioural")


def main_problems(fam: str, culture: bool) -> int:
    """Technical problems a floor round plans in its core: two for a coding round (one with a behavioural part), one for a design round."""
    return (1 if culture else 2) if fam == "dsa" else 1


def normal_culture_minutes(core_mins: int) -> int:
    return 8 if core_mins >= 40 else 6


@dataclass(frozen=True)
class CodingFit:
    """How a floor round's core is split when the equal split would leave its main problem under the floor."""
    culture: int          # behavioural questions kept (0 when the round has none)
    culture_each: int     # minutes per behavioural question
    extra: bool           # the extra part (projects, fundamentals, puzzles) is kept
    extra_mins: int       # minutes it gets: the rest of the core after the first problem and the questions
    first: int            # minutes of the first (main) problem: the floor, or all that is left when there is one problem and no extra part


def coding_fit(core_mins: int, culture_asked: int, extra: bool, core_slots: int, fundamentals_led: bool = False) -> CodingFit | None:
    """The split of a floor round's core that keeps the main problem at MIN_FIRST_PROBLEM_MINS, or None when the equal split already
    does (a plain 40-minute-or-longer round, any 45-minute round with one part) or nothing can be done (a core under the floor). The
    extra part is reserved MIN_EXTRA_MINS before the behavioural questions shrink (down to MIN_CULTURE_MINS each, fewer questions if need
    be); a part that cannot get its minimum is dropped from the plan: the extra part first, as it is the looser of the two (decided
    2026-10-18). A fundamentals-led design round ("core subjects, DBMS, OOP": TCS, Infosys) has no floor: its design problem is a warm-up and
    the fundamentals are the main part, so it keeps its old split at every length."""
    if fundamentals_led:
        return None
    normal = normal_culture_minutes(core_mins)
    shares = core_slots + (1 if extra else 0)
    if not (culture_asked or extra or core_slots >= 2) or max(1, (core_mins - culture_asked * normal) // max(1, shares)) >= MIN_FIRST_PROBLEM_MINS:
        return None
    budget = core_mins - MIN_FIRST_PROBLEM_MINS
    if budget < 0:
        return None
    keep_extra = extra
    if culture_asked and keep_extra and budget < MIN_CULTURE_MINS + MIN_EXTRA_MINS:
        keep_extra = False
    capacity = budget - (MIN_EXTRA_MINS if keep_extra else 0)
    if culture_asked:
        kept = min(culture_asked, capacity // MIN_CULTURE_MINS)
        if kept < 1:
            return None
        each = min(normal, capacity // kept)
    else:
        kept, each = 0, 0
    extra_mins = budget - kept * each if keep_extra else 0
    # One problem and no extra part: it takes everything the questions leave (the core is always filled).
    first = core_mins - kept * each if core_slots == 1 and not keep_extra else MIN_FIRST_PROBLEM_MINS
    return CodingFit(kept, each, keep_extra, extra_mins, first)


def culture_minutes(core_mins: int, culture_slots: int = 0, extra: bool = False, floor: bool = True, fundamentals_led: bool = False) -> int:
    """Minutes per behavioural question inside a technical round (a mixed round's behavioural part). In a round whose main problem
    would fall under the floor, the questions shrink to make room for it and for the extra part."""
    if culture_slots and floor:
        fit = coding_fit(core_mins, culture_slots, extra, 1, fundamentals_led)
        if fit:
            return fit.culture_each
    return normal_culture_minutes(core_mins)


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
    duration = rnd.duration_mins or DEFAULT_DURATION.get(round_type, 45)
    if extra and has_problem_floor(round_type, fam, duration):
        # A part that cannot get its minimum minutes next to the main problem is not in the plan, so not in the briefing either.
        fit = coding_fit(core_minutes(round_type, fam, duration), 2 if culture else 0, extra, main_problems(fam, culture), fam == "lld")
        if fit and not fit.extra:
            extra = False
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
