"""Stage 2, problem selection (no LLM; spec §7). Deterministic and explainable: every candidate a slot
considered is kept with its score breakdown and why it won or lost.

pool (usable content, minus exclusions) -> difficulty window -> score -> per-slot composition rules ->
seeded weighted draw from the top 8 -> step-by-step relaxation when a slot can't be filled.
"""
from __future__ import annotations

import hashlib
import json
import logging
import random
import re
from dataclasses import dataclass, field
from typing import Callable

from app.blueprint import store
from app.blueprint import topics as T
from app.blueprint.context import Context, coding_fit, core_minutes, has_problem_floor, norm_title, rank
from app.models.engineering_levels import ENGINEERING_LEVELS

LEVEL_ORDER = list(ENGINEERING_LEVELS)
from app.blueprint.trace import StageError
from app.blueprint.vocabulary import CULTURE_PREFIX, is_culture_slot

logger = logging.getLogger(__name__)

DEFAULT_WEIGHTS = {
    "named": 40.0, "company_reported": 25.0, "company_inferred": 10.0, "topic": 25.0,
    "difficulty_exact": 10.0, "difficulty_adjacent": 4.0, "level": 5.0, "popularity": 5.0,
}
TOP_K = 8
TRACE_LIMIT = 60

PRINCIPLE_CATEGORY = {"amazon": "amazon-lp", "google": "googleyness"}

# Words that tie text to one company's own culture, beyond its name.
COMPANY_ALIASES = {
    "amazon": ("leadership principle", "leadership principles"), "google": ("googleyness",),
    "bytedance": ("tiktok",), "meta": ("facebook",), "facebook": ("meta",),
}


def company_terms(tag: str) -> set[str]:
    """Lower-case names a company is mentioned by: its tag as words plus its culture words."""
    return {tag.replace("-", " ").lower(), *COMPANY_ALIASES.get(store.company_key(tag), ())}


def _is_company(ctx: Context, tag: str) -> bool:
    key = store.company_key(tag)
    return bool(key) and bool(ctx.company_key) and (key == ctx.company_key or key in ctx.company_key)


def tied_to_company(doc: dict, ctx: Context) -> bool:
    """The question was reported at, or written for, the booked company."""
    return any(_is_company(ctx, t) for t in doc.get("company_tags") or [] if isinstance(t, str))


def foreign_terms(ctx: Context, doc: dict) -> set[str]:
    """Names that must not appear in this interview: the other companies a behavioural question was
    written for, and every other company's culture words (no 'Googleyness' in an Accenture round)."""
    own = set().union(*(company_terms(t) for t in [ctx.company, ctx.company_key] if t))
    terms: set[str] = set()
    if doc.get("round_type") in ("behavioural", "hiring-manager"):
        for tag in doc.get("company_tags") or []:
            if isinstance(tag, str) and not _is_company(ctx, tag):
                terms |= company_terms(tag)
    for company in PRINCIPLE_CATEGORY:
        if company not in ctx.company_key:
            terms |= set(COMPANY_ALIASES.get(company, ()))
    return {t for t in terms if len(t) >= 3 and t not in own}


def mentions(text: str, terms: set[str]) -> set[str]:
    low = (text or "").lower()
    return {t for t in terms if re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", low)}


# The arc's candidate_intro phase opens every round with the introduction, so no slot asks it again.
_INTRO = re.compile(r"tell me (something )?about (your ?self|yourself)|introduce yourself|walk me through your "
                    r"(resume|background)|general icebreaker", re.I)
# Questions that assume a job the candidate doesn't have yet: not for intern and fresher rounds.
_ASSUMES_A_JOB = re.compile(r"current (company|job|role|employer)|last company|previous (boss|manager|company|job|employer)"
                            r"|leave your|your (manager|boss) say", re.I)
_TITLE_STOP = frozenset("""a an the and or of in on at to for with as is are was were be been will would can could do did does
    have has had it this that me my i we us you your yourself tell about what which why how when where time give describe
    make makes want looking most so there design build implement system like ood lld hld""".split())


_DESIGN_TYPES = ("lld", "system-design")


def content_off_title(doc: dict) -> bool:
    """A design problem whose content designs something other than its title names (older bank content turned
    "Design a parking lot" into a bike-sharing dock). Picked by name, it would defeat the brief's named problem."""
    if doc.get("round_type") not in _DESIGN_TYPES:
        return False
    wanted = _title_words(doc.get("title") or "")
    words = set(_title_words(json.dumps(doc.get("content") or {}, ensure_ascii=False)))
    stems = {w[:5] for w in words if len(w) >= 5}
    if not wanted or "".join(sorted(wanted)) in words or any("".join(p) in words for p in _orders(wanted)):
        return False                      # "Split Wise" is a Splitwise clone

    def found(w: str) -> bool:
        return w in words or (len(w) >= 5 and w[:5] in stems)
    return sum(found(w) for w in wanted) * 2 < len(wanted)


def _orders(words: frozenset[str]) -> list[tuple[str, ...]]:
    import itertools
    return list(itertools.permutations(words)) if len(words) <= 3 else []


def _named_here(doc: dict, ctx: Context) -> bool:
    return norm_title(doc.get("title", "")) in ctx.named_problems or doc.get("slug") in ctx.named_problems


def unsuitable(doc: dict, ctx: Context) -> str | None:
    """Why a question doesn't fit this round, or None. A design problem picked because the brief names it must
    design what it is named after (otherwise the candidate never sees the title, so a drifted scenario is harmless)."""
    if _named_here(doc, ctx) and content_off_title(doc):
        return "named in the brief, but its content designs a different system"
    if doc.get("round_type") not in ("behavioural", "hiring-manager"):
        return None
    title = doc.get("title") or ""
    if _INTRO.search(title):
        return "the introduction is its own phase"
    if ctx.level in ("intern", "fresher") and _ASSUMES_A_JOB.search(title):
        return "assumes a job the candidate doesn't have yet"
    return None


def _title_words(title: str) -> frozenset[str]:
    words = (w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", (title or "").lower()))
    return frozenset(w for w in words if w not in _TITLE_STOP)


_DEDUPED = ("behavioural", "hiring-manager", "lld", "system-design")


def near_duplicate(c: "Candidate", picked: list["SlotPlan"]) -> bool:
    """The same question from another source ("Why are you interested in this opportunity?" exists three times in
    the bank, "Design a parking lot" twice): never twice in one round."""
    if c.round_type not in _DEDUPED:
        return False
    mine = _title_words(c.title)
    for p in picked:
        if p.pick and p.pick.round_type in _DEDUPED:
            other = _title_words(p.pick.title)
            if mine and other and len(mine & other) / len(mine | other) > 0.5:
                return True
    return False


def written_for_another_company(doc: dict, ctx: Context) -> bool:
    """A behavioural question whose content names another company or its culture (e.g. 'the Software
    Engineer I role at ByteDance'), or that belongs to another company's principles category."""
    if doc.get("round_type") not in ("behavioural", "hiring-manager"):
        return False
    category = doc.get("category")
    if category in PRINCIPLE_CATEGORY.values():
        return not any(company in ctx.company_key and cat == category for company, cat in PRINCIPLE_CATEGORY.items())
    if tied_to_company(doc, ctx):
        return False
    return bool(mentions(json.dumps(doc.get("content") or {}, ensure_ascii=False), foreign_terms(ctx, doc)))


def weights(raw: str | None) -> dict[str, float]:
    out = dict(DEFAULT_WEIGHTS)
    if raw:
        try:
            out.update({k: float(v) for k, v in json.loads(raw).items() if k in out})
        except (ValueError, TypeError, AttributeError):
            logger.warning("[blueprint] ignoring malformed BLUEPRINT_SELECTION_WEIGHTS")
    return out


@dataclass
class Candidate:
    doc: dict
    slug: str
    title: str
    round_type: str
    difficulty: str | None
    rank: int
    topics: set[str]
    primary: str
    category: str | None
    score: float = 0.0
    breakdown: dict[str, float] = field(default_factory=dict)
    in_window: bool = True
    distance: int = 0                       # difficulty steps outside the window

    def row(self, outcome: str, reason: str = "") -> dict:
        return {"slug": self.slug, "title": self.title, "difficulty": self.difficulty, "category": self.category,
                "primary": self.primary, "score": round(self.score, 2),
                "breakdown": {k: round(v, 2) for k, v in self.breakdown.items()},
                "outcome": outcome, "reason": reason}


@dataclass
class SlotSpec:
    slot_id: str
    kind: str                               # core | reserve
    purpose: str
    accepts: Callable[["Candidate", list["SlotPlan"]], bool]
    bonus: Callable[["Candidate", list["SlotPlan"]], float] = lambda c, picked: 0.0
    relax: tuple[str, ...] | None = None    # relaxation order; None = RELAXATIONS
    pool: Callable[["Candidate"], bool] | None = None   # hard filter, never relaxed (technical vs behavioural docs)
    any_difficulty: bool = False            # behavioural questions have no difficulty to match


@dataclass
class SlotPlan:
    slot_id: str
    kind: str
    order: int
    purpose: str
    pick: Candidate | None = None
    fallbacks: list[Candidate] = field(default_factory=list)
    relaxations: list[str] = field(default_factory=list)
    considered: list[dict] = field(default_factory=list)
    swaps: list[dict] = field(default_factory=list)

    def trace(self) -> dict:
        return {"slot_id": self.slot_id, "kind": self.kind, "purpose": self.purpose,
                "picked": self.pick.slug if self.pick else None, "relaxations": self.relaxations,
                "swaps": self.swaps, "candidates": self.considered}


# ---------------------------------------------------------------- pool + scoring

def _pool_spec(round_type: str) -> list[tuple[list[str], str, list[str] | None]]:
    if round_type in ("dsa", "online-assessment"):
        return [(["dsa", "online-assessment"], "verified", None)]
    if round_type == "hiring-manager":
        return [(["hiring-manager"], "generated", None),
                (["behavioural"], "generated", ["leadership-ownership", "self-introduction", "strengths-weaknesses"])]
    return [([round_type], "generated", None)]


async def load_pool(round_type: str, culture: bool = False) -> list[dict]:
    """The bank docs a round can draw from; a technical round with a behavioural part adds the behavioural pool."""
    seen: set[tuple[str, str]] = set()
    out = []
    specs = _pool_spec(round_type) + ([(["behavioural"], "generated", None)] if culture else [])
    for types, status, categories in specs:
        for doc in await store.bank_pool(types, status, categories):
            key = (doc["round_type"], doc["slug"])
            if key not in seen:
                seen.add(key)
                out.append(doc)
    return out


def problem_topics(doc: dict) -> set[str]:
    values = [*(doc.get("topic_tags") or []), *(doc.get("patterns_tested") or []), *(doc.get("components_tested") or [])]
    for single in ("domain", "category"):
        if doc.get(single):
            values.append(doc[single])
    return T.canon(values)


KIND_OF_FAMILY = {"dsa": "dsa", "system-design": "design", "lld": "design", "behavioural": "behavioural"}
_problem_topics = problem_topics            # private aliases kept for existing callers
_KIND_OF_FAMILY = KIND_OF_FAMILY


def score_candidate(doc: dict, ctx: Context, w: dict[str, float]) -> Candidate:
    kind = _KIND_OF_FAMILY.get(ctx.family, "dsa")
    topics = {t for t in _problem_topics(doc) if T.KIND_OF.get(t) == kind}
    tags = [t for t in doc.get("topic_tags") or [] if isinstance(t, str)]
    primary = sorted(T.canon(tags[:1]) or topics or {"general"})[0]
    difficulty = doc.get("difficulty")
    r = rank(difficulty)
    b: dict[str, float] = {}
    if norm_title(doc.get("title", "")) in ctx.named_problems or doc.get("slug") in ctx.named_problems:
        b["named"] = w["named"]
    evidence = doc.get("company_evidence") or {}
    for tag in doc.get("company_tags") or []:
        if store.company_key(tag) == ctx.company_key and ctx.company_key:
            b["company"] = w["company_reported"] if evidence.get(tag, "reported") == "reported" else w["company_inferred"]
            break
    ov = T.overlap(topics, ctx.target_topics)
    if ov:
        b["topic"] = w["topic"] * ov
    target = rank(ctx.difficulty_target)
    if r == target:
        b["difficulty"] = w["difficulty_exact"]
    elif abs(r - target) == 1:
        b["difficulty"] = w["difficulty_adjacent"]
    if ctx.level in [str(x) for x in doc.get("level_tags") or []]:
        b["level"] = w["level"]
    reports = len(doc.get("company_tags") or [])
    if reports:
        b["popularity"] = min(w["popularity"], reports / 4.0)
    lo, hi = ctx.difficulty_window
    distance = 0 if lo <= r <= hi else (lo - r if r < lo else r - hi)
    # A design problem tagged only for levels above the candidate's (a Snowflake ID generator for a fresher) is as
    # far out of window as the gap, unless the brief names it for this round; the relaxations widen it like difficulty.
    if doc.get("round_type") in ("lld", "system-design") and "named" not in b:
        tagged = [LEVEL_ORDER.index(t) for t in doc.get("level_tags") or [] if t in LEVEL_ORDER]
        if tagged and ctx.level in LEVEL_ORDER:
            distance = max(distance, min(tagged) - LEVEL_ORDER.index(ctx.level))
    return Candidate(doc=doc, slug=doc["slug"], title=doc.get("title", doc["slug"]), round_type=doc["round_type"],
                     difficulty=difficulty, rank=r, topics=topics, primary=primary, category=doc.get("category"),
                     score=sum(b.values()), breakdown=b, in_window=distance == 0, distance=distance)


# ---------------------------------------------------------------- slot specs (spec §7.5)

def _core_primaries(picked: list[SlotPlan]) -> set[str]:
    return {p.pick.primary for p in picked if p.pick and p.kind == "core"}


def _core_ranks(picked: list[SlotPlan]) -> list[int]:
    return [p.pick.rank for p in picked if p.pick and p.kind == "core"]


def _used_categories(picked: list[SlotPlan]) -> list[str]:
    return [p.pick.category or "" for p in picked if p.pick]


_BEHAVIOURAL_TYPES = ("behavioural", "hiring-manager")


def _technical(c: "Candidate") -> bool:
    return c.round_type not in _BEHAVIOURAL_TYPES


def _behavioural(c: "Candidate") -> bool:
    return c.round_type in _BEHAVIOURAL_TYPES


def coding_cores(ctx: Context) -> int:
    """Coding problems a DSA round asks: always two, which is what a real round has. The second is given only when the first went
    well (the live interviewer skips it for a candidate who struggled and ends early). Online assessments are not filtered."""
    if ctx.family != "dsa" or ctx.round_type == "online-assessment":
        return 0
    return 2


def behavioural_cores(ctx: Context) -> int:
    """Questions a behavioural round asks: three in 50 minutes or less (each gets real depth: the judge found four in
    45 minutes shallow next to a real bar-raiser round), four in longer rounds."""
    return 3 if ctx.duration_mins <= 50 else 4


def culture_cores(ctx: Context) -> int:
    """Behavioural questions a technical round with a behavioural part asks: two, or fewer at a short length where two would leave the
    main problem under its 15-minute floor (decided 2026-10-18; never at 45 minutes, where the old split stands)."""
    if not ctx.culture:
        return 0
    fit = coding_fit(core_minutes(ctx.round_type, ctx.family, ctx.duration_mins), 2, ctx.extra_part, 1, ctx.extra_part and ctx.family == "lld") \
        if has_problem_floor(ctx.round_type, ctx.family, ctx.duration_mins) else None
    return fit.culture if fit else 2


def slot_specs(ctx: Context) -> list[SlotSpec]:
    specs = _round_specs(ctx)
    if coding_cores(ctx) == 1:
        specs = [s for s in specs if s.slot_id != "core-2"]
    if ctx.round_type == "behavioural" and behavioural_cores(ctx) == 3:
        specs = [s for s in specs if s.slot_id != "core-1"]     # motivation: the intro phase already covers it
    return _with_culture(ctx, specs) if ctx.culture else specs


def _with_culture(ctx: Context, specs: list[SlotSpec]) -> list[SlotSpec]:
    """A technical round with a behavioural part (Amazon's "a coding problem plus Leadership Principle
    questions"): one technical problem with its reserves, plus two behavioural questions and a spare,
    from the company's principles when it has a category for them."""
    technical = [s for s in specs if s.slot_id != "core-2"]
    for s in technical:
        s.pool = _technical
    principle = next((cat for key, cat in PRINCIPLE_CATEGORY.items() if key in ctx.company_key), None)
    general = ("leadership-ownership", "conflict-teamwork", "failure-learning", "general-behavioural")

    def principle_of(c: Candidate) -> str | None:
        return ((c.doc.get("content") or {}).get("principle") or "").strip().lower() or None

    def accepts(c: Candidate, picked: list[SlotPlan]) -> bool:
        if principle:   # two different principles, as a real loop round covers
            asked = {principle_of(p.pick) for p in picked if p.pick and is_culture_slot(p.slot_id)}
            return c.category == principle and (principle_of(c) is None or principle_of(c) not in asked)
        return c.category in general and (c.category not in _used_categories(picked) or c.category == "general-behavioural")

    purpose = "company principles" if principle else "behavioural"
    culture = [SlotSpec(f"{CULTURE_PREFIX}1", "core", purpose, accepts, pool=_behavioural, any_difficulty=True),
               SlotSpec(f"{CULTURE_PREFIX}2", "core", purpose, accepts, pool=_behavioural, any_difficulty=True),
               SlotSpec(f"{CULTURE_PREFIX}reserve", "reserve", f"spare {purpose} question", accepts, pool=_behavioural,
                        any_difficulty=True)]
    if culture_cores(ctx) == 1:
        culture = [s for s in culture if s.slot_id != f"{CULTURE_PREFIX}2"]    # the spare covers a second one if it ever comes to that
    return technical + culture


def _round_specs(ctx: Context) -> list[SlotSpec]:
    rt = ctx.round_type
    target = rank(ctx.difficulty_target)
    if rt in ("dsa", "online-assessment"):
        return [
            # Core problems never sit above the round's target difficulty (two hards in one SDE-2 round is not an
            # interview); the harder reserve is where a stretch belongs.
            SlotSpec("core-1", "core", "first problem", lambda c, picked: c.rank <= target),
            SlotSpec("core-2", "core", "second problem",
                     lambda c, picked: c.rank <= target and c.primary not in _core_primaries(picked)),
            # When the level allows harder problems than the round's window, a step up is tried before giving
            # up "harder"; an intern's or fresher's harder reserve never leaves their level's range.
            SlotSpec("reserve-harder", "reserve", "harder extension if the candidate is fast",
                     lambda c, picked: c.rank > max(_core_ranks(picked) or [0]) and c.primary not in _core_primaries(picked),
                     relax=("difficulty+1", "diversity", "any_difficulty")
                     if ctx.difficulty_window[1] < ctx.difficulty_range[1] else None),
            SlotSpec("reserve-alternate", "reserve", "same-level alternate if a problem was seen before",
                     lambda c, picked: c.rank in _core_ranks(picked)),
        ]
    if rt in ("system-design", "lld"):
        return [
            SlotSpec("core-1", "core", "main problem", lambda c, picked: True),
            SlotSpec("reserve-alternate", "reserve", "alternate if the problem was seen before",
                     lambda c, picked: c.primary not in _core_primaries(picked)),
        ]
    principle = next((cat for key, cat in PRINCIPLE_CATEGORY.items() if key in ctx.company_key), None)

    def category_slot(pref: tuple[str, ...]):
        def accepts(c: Candidate, picked: list[SlotPlan]) -> bool:
            used = _used_categories(picked)
            if c.category == principle:
                return used.count(principle) < 2
            return c.category in pref and c.category not in used
        return accepts

    def principle_bonus(c: Candidate, picked: list[SlotPlan]) -> float:
        return 15.0 if principle and c.category == principle else 0.0

    def fresh_category(c: Candidate, picked: list[SlotPlan]) -> bool:
        return (c.category or "") not in _used_categories(picked) or c.category == "general-behavioural"

    if rt == "hiring-manager":
        return [
            SlotSpec("core-1", "core", "motivation and career", category_slot(("hr", "self-introduction")), principle_bonus),
            SlotSpec("core-2", "core", "self-awareness", category_slot(("strengths-weaknesses", "hr")), principle_bonus),
            SlotSpec("core-3", "core", "ownership", category_slot(("leadership-ownership", "hr")), principle_bonus),
            SlotSpec("reserve-1", "reserve", "spare question", fresh_category, principle_bonus),
            SlotSpec("reserve-2", "reserve", "spare question", fresh_category, principle_bonus),
        ]
    return [
        SlotSpec("core-1", "core", "motivation", category_slot(("self-introduction", "strengths-weaknesses")), principle_bonus),
        SlotSpec("core-2", "core", "conflict and teamwork", category_slot(("conflict-teamwork",)), principle_bonus),
        SlotSpec("core-3", "core", "failure and learning", category_slot(("failure-learning",)), principle_bonus),
        SlotSpec("core-4", "core", "ownership", category_slot(("leadership-ownership",)), principle_bonus),
        SlotSpec("reserve-1", "reserve", "spare question", fresh_category, principle_bonus),
        SlotSpec("reserve-2", "reserve", "spare question", fresh_category, principle_bonus),
        SlotSpec("reserve-3", "reserve", "spare question", fresh_category, principle_bonus),
    ]


# ---------------------------------------------------------------- draw

def _rng(seed_base: str, slot_id: str) -> random.Random:
    return random.Random(int(hashlib.sha256(f"{seed_base}:{slot_id}".encode()).hexdigest()[:16], 16))


def draw_order(eligible: list[tuple[Candidate, float]], rng: random.Random) -> list[Candidate]:
    """Weighted draw without replacement over the top K (weight ∝ score); the rest follow by score."""
    ranked = sorted(eligible, key=lambda pair: (-pair[1], pair[0].slug))
    top, rest = ranked[:TOP_K], ranked[TOP_K:]
    order: list[Candidate] = []
    while top:
        total = sum(max(s, 1.0) for _, s in top)
        x = rng.uniform(0, total)
        acc = 0.0
        for i, (cand, s) in enumerate(top):
            acc += max(s, 1.0)
            if x <= acc:
                order.append(cand)
                top.pop(i)
                break
        else:
            order.append(top.pop()[0])
    return order + [c for c, _ in rest]


RELAXATIONS = ("diversity", "difficulty+1", "any_difficulty")


def select(ctx: Context, pool: list[dict], w: dict[str, float], seed_base: str) -> tuple[list[SlotPlan], dict]:
    foreign = {d["slug"] for d in pool if written_for_another_company(d, ctx)}
    unfit = {d["slug"] for d in pool if d["slug"] not in foreign and unsuitable(d, ctx)}
    candidates = [score_candidate(d, ctx, w) for d in pool if d["slug"] not in foreign | unfit]
    excluded = [c for c in candidates if c.slug in ctx.exclusions]
    available = [c for c in candidates if c.slug not in ctx.exclusions]
    plans: list[SlotPlan] = []
    used: set[str] = set()
    for order, spec in enumerate(slot_specs(ctx), start=1):
        plan = SlotPlan(spec.slot_id, spec.kind, order, spec.purpose)
        slot_available = [c for c in available if spec.pool is None or spec.pool(c)]
        chosen: list[tuple[Candidate, float]] = []
        for step in (None, *(spec.relax or RELAXATIONS)):
            if step:
                plan.relaxations.append(step)
            relaxed = plan.relaxations
            max_distance = 2 if spec.any_difficulty or "any_difficulty" in relaxed else 1 if "difficulty+1" in relaxed else 0
            chosen = [(c, c.score + spec.bonus(c, plans)) for c in slot_available
                      if c.slug not in used and c.distance <= max_distance and not near_duplicate(c, plans)
                      and ("diversity" in relaxed or spec.accepts(c, plans))]
            if chosen:
                break
        if not chosen:
            plan.considered = [c.row("excluded_seen") for c in excluded[:10]]
            raise StageError("not_enough_problems",
                             f"slot {spec.slot_id} ({spec.purpose}): no usable problem after relaxing "
                             f"{', '.join(RELAXATIONS)}; pool {len(pool)}, excluded {len(excluded)}, already used {len(used)}")
        ordered = draw_order(chosen, _rng(seed_base, spec.slot_id))
        plan.pick, plan.fallbacks = ordered[0], ordered[1:6]
        used.add(plan.pick.slug)
        plan.considered = _considered(plan, slot_available, chosen, used, spec, plans, excluded)
        plans.append(plan)
    _order_dsa_cores(ctx, plans)
    if ctx.culture:
        _culture_first(plans)
    summary = {"pool": len(pool), "excluded_seen": len(excluded), "other_company": len(foreign), "unsuitable": len(unfit), "slots": len(plans),
               "relaxed_slots": [p.slot_id for p in plans if p.relaxations],
               "picked": {p.slot_id: p.pick.slug for p in plans if p.pick}}
    return plans, summary


def _considered(plan: SlotPlan, available: list[Candidate], chosen: list[tuple[Candidate, float]], used: set[str],
                spec: SlotSpec, earlier: list[SlotPlan], excluded: list[Candidate]) -> list[dict]:
    chosen_slugs = {c.slug for c, _ in chosen}
    rows: list[tuple[float, dict]] = []
    for c in available:
        if c.slug == plan.pick.slug:
            rows.append((1e9, c.row("picked", "drawn from the top candidates")))
        elif c.slug in chosen_slugs:
            rows.append((c.score, c.row("not_drawn", "eligible, another candidate was drawn")))
        elif c.slug in used:
            rows.append((c.score, c.row("used_elsewhere", "picked for another slot")))
        elif c.distance > 0 and not any(r in plan.relaxations for r in ("difficulty+1", "any_difficulty")):
            rows.append((c.score, c.row("out_of_difficulty", f"{c.difficulty or 'medium'} is outside the window")))
        elif not spec.accepts(c, earlier):
            rows.append((c.score, c.row("lost_to_diversity", "fails this slot's diversity rule")))
        else:
            rows.append((c.score, c.row("out_of_difficulty", "outside the relaxed window")))
    rows.sort(key=lambda r: -r[0])
    out = [r for _, r in rows[:TRACE_LIMIT]]
    out += [c.row("excluded_seen", "already given to this user") for c in excluded[:10]]
    return out


def _order_dsa_cores(ctx: Context, plans: list[SlotPlan]) -> None:
    """Difficulty never decreases across the core problems: the easier one goes first."""
    if ctx.family != "dsa":
        return
    cores = [p for p in plans if p.kind == "core" and p.pick and not is_culture_slot(p.slot_id)]
    if len(cores) == 2 and cores[0].pick.rank > cores[1].pick.rank:
        a, b = cores
        a.pick, b.pick = b.pick, a.pick
        a.fallbacks, b.fallbacks = b.fallbacks, a.fallbacks
        a.considered, b.considered = b.considered, a.considered


def _culture_first(plans: list[SlotPlan]) -> None:
    """Interview order for a mixed round: the behavioural questions open (as Amazon's loop rounds do),
    then the technical problem; reserves keep their place at the end."""
    group = {(True, "core"): 0, (False, "core"): 1, (False, "reserve"): 2, (True, "reserve"): 3}
    plans.sort(key=lambda p: (group[(is_culture_slot(p.slot_id), p.kind)], p.order))
    for i, p in enumerate(plans, start=1):
        p.order = i


def next_fallback(plan: SlotPlan, taken: set[str]) -> Candidate | None:
    """The next candidate for a slot whose pick couldn't get a passing answer key."""
    while plan.fallbacks:
        cand = plan.fallbacks.pop(0)
        if cand.slug not in taken:
            return cand
    return None
