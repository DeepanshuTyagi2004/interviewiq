"""The realism block of a blueprint: per-session variety drawn by code at prep (spec 2026-10-18, section 1), so two mock rounds
never feel alike. Traits, speech habits, the conversation outline with its promises and the change stance all come from one
per-prep-run seed (stored in the block, so a round can be replayed in a rehearsal), each part from its own stream so adding a
draw to one never moves another. Speech habits are drawn from the speech vocabulary (speech_vocab.py: phrases tagged with the traits they
suit), not written by the model: cheaper, and valid by construction. The persona prompt is told the traits so the written persona is consistent with them. PRODUCT IP draft.

Nothing here changes what is assessed, the problems or their minutes."""
from __future__ import annotations

import random
import re
from functools import lru_cache
from itertools import product
from typing import Any

from app.blueprint import speech_vocab as V
from app.blueprint.models import ChangeStance, Realism, RealismOutlinePart, SpeechHabits
from app.blueprint.vocabulary import family as family_of
from app.rounds.pack import LEVEL_RANKS, MANAGER_TITLES, TITLE_RANKS, Band, RoundPack
from app.interviewer.plan import deep_dive_probes, round_question_areas

# ---------------------------------------------------------------- traits

# axis -> its levels, lowest to highest. `register` is the last axis: how the interviewer's English sounds (the speech vocabulary has
# phrases for each; it is drawn after the others, with `INDIAN_ENGLISH_SHARE`, so it never changes which of the other combinations is drawn).
TRAIT_AXES: dict[str, tuple[str, ...]] = {
    "pace": ("brisk", "even", "unhurried"),
    "warmth": ("reserved", "friendly", "very warm"),
    "formality": ("casual", "neutral", "formal"),
    "verbosity": ("terse", "normal", "chatty"),
    "probing": ("light", "normal", "deep"),
    "hints": ("sparing", "normal", "generous"),
    "firmness": ("soft", "normal", "firm"),
    "register": ("neutral", "indian_english"),
}
COMBO_AXES = tuple(a for a in TRAIT_AXES if a != "register")        # the axes the coherence rules and the "avoid" check read
INDIAN_ENGLISH_SHARE = 0.4                                          # of personas: the first market is India, a courteous Indian-English voice is common there

# Pairs that do not go together in one person (a very warm interviewer is not stiffly formal, a reserved one is not chatty).
INCOHERENT: tuple[tuple[tuple[str, str], tuple[str, str]], ...] = (
    (("warmth", "very warm"), ("formality", "formal")),
    (("warmth", "reserved"), ("formality", "casual")),
    (("warmth", "reserved"), ("verbosity", "chatty")),
    (("pace", "brisk"), ("verbosity", "chatty")),
    (("pace", "unhurried"), ("verbosity", "terse")),
    (("warmth", "very warm"), ("verbosity", "terse")),
)


# Trait levels that clash with how a round shape runs (shapes.py): a long warm chat first is not run by a reserved, brisk interviewer,
# and a round that goes straight to the work is not run by an unhurried one. The persona prompt gets the traits as the only source of
# manner (the shape's description is structure only), so the two can never contradict.
SHAPE_EXCLUDES: dict[str, dict[str, tuple[str, ...]]] = {
    "chat_first": {"warmth": ("reserved",), "pace": ("brisk",)},
    "straight_in": {"pace": ("unhurried",)},
    "brisk": {"pace": ("unhurried",), "verbosity": ("chatty",)},
}


def coherent(traits: dict[str, str]) -> bool:
    return not any(traits.get(a) == va and traits.get(b) == vb for (a, va), (b, vb) in INCOHERENT)


def fits_shape(traits: dict[str, str], shape_id: str | None) -> bool:
    return not any(traits.get(axis) in levels for axis, levels in SHAPE_EXCLUDES.get(shape_id or "", {}).items())


@lru_cache(maxsize=1)
def _combos() -> tuple[tuple[str, ...], ...]:
    axes = list(COMBO_AXES)
    return tuple(c for c in product(*(TRAIT_AXES[a] for a in axes)) if coherent(dict(zip(axes, c))))


def violates_limits(traits: dict[str, str], excludes: dict[str, tuple[str, ...]] = {}, pairs: tuple = (), forced: dict[str, str] = {}) -> bool:
    """Whether the traits break a round pack's limits: an excluded level, an excluded pair or a forced axis at another level."""
    return (any(traits.get(axis) in levels for axis, levels in excludes.items())
            or any(traits.get(a) == va and traits.get(b) == vb for (a, va), (b, vb) in pairs)
            or any(traits.get(axis) != level for axis, level in forced.items()))


def draw_traits(rng: random.Random, avoid: list[dict[str, str]], shape_id: str | None = None,
                excludes: dict[str, tuple[str, ...]] = {}, pairs: tuple = (), forced: dict[str, str] = {}) -> dict[str, str]:
    """A coherent trait combination that fits the round's shape, never one in `avoid` (the candidate's last rounds) unless every
    combination is, and then the register (Indian English for `INDIAN_ENGLISH_SHARE` of the draws; the register plays no part in
    coherence, in the shape or in `avoid`). A round pack's limits narrow the combinations first (`excludes` levels, `pairs` that
    never go together; `forced` axes keep their level, the other axes redrawn from the coherent combinations that agree with them);
    a limit that would leave nothing is ignored, so a draw never fails."""
    axes = list(COMBO_AXES)
    avoided = {tuple(a.get(k) for k in axes) for a in avoid}
    options = [c for c in _combos() if fits_shape(dict(zip(axes, c)), shape_id)]
    forced_axes = {k: v for k, v in forced.items() if k in axes}
    forced_held = True
    for limit in ({"excludes": excludes, "pairs": pairs}, {"forced": forced_axes}):
        if any(limit.values()):
            narrowed = [c for c in options if not violates_limits(dict(zip(axes, c)), **limit)]
            forced_held = forced_held and (bool(narrowed) or "forced" not in limit)
            options = narrowed or options
    options = [c for c in options if c not in avoided] or options
    traits = dict(zip(axes, rng.choice(options)))
    traits["register"] = "indian_english" if rng.random() < INDIAN_ENGLISH_SHARE else "neutral"
    # Forced axes are written only when the coherent combinations could hold them (else the incoherent mix is never produced).
    traits.update({k: v for k, v in forced.items() if k == "register" or (k in TRAIT_AXES and forced_held)})
    return traits


def keep_traits(kept: dict[str, str] | None, seed: int, shape_id: str | None = None,
                excludes: dict[str, tuple[str, ...]] = {}, pairs: tuple = (), forced: dict[str, str] = {}) -> dict[str, str] | None:
    """The traits a re-prep keeps, or None when they are not valid for the shape or the round pack's limits. Traits stored before the
    register existed get one from the seed (the same every time), so a re-prep still keeps the persona's other traits."""
    if not kept:
        return None
    base = {a: v for a, v in kept.items() if a != "register"}
    register = kept.get("register")
    if register is None:
        register = "indian_english" if rng_for(seed, "register").random() < INDIAN_ENGLISH_SHARE else "neutral"
    traits = {**base, "register": register}
    if set(traits) != set(TRAIT_AXES) or not all(v in TRAIT_AXES[a] for a, v in traits.items()) or not coherent(traits) or not fits_shape(traits, shape_id):
        return None
    if violates_limits(traits, excludes, pairs, forced):
        return None
    return traits


# ---------------------------------------------------------------- speech habits

# The vocabulary is app/blueprint/speech_vocab.py (one readable file, phrases tagged with the traits they suit). These are its texts per
# kind, for callers that only need the words.
ACKS: tuple[str, ...] = V.texts("ack")
BACKCHANNELS: tuple[str, ...] = V.texts("backchannel")
LEAD_INS: tuple[str, ...] = V.texts("lead_in")
FILLER_STAGES: dict[str, tuple[str, ...]] = {stage: V.texts("filler", stage) for stage in V.STAGES}

# A brisk or a terse interviewer only gets short phrases (words per phrase, by kind); an unhurried or chatty one may get the long ones.
SHORT_WORDS = {"ack": 4, "backchannel": 3, "filler": 7, "lead_in": 3}
_ACK_COUNT = {"terse": (5, 6), "normal": (6, 7), "chatty": (7, 8)}
_VERDICT_COUNT = {"reserved": (0, 0, 1), "friendly": (0, 1, 1, 2), "very warm": (1, 2)}   # of the acknowledgements, how many judge what was said
_LEAD_IN_COUNT = {"terse": (3, 3), "normal": (3, 4), "chatty": (4, 5)}
PLAIN_ACKS = 3          # at least this many neutral acknowledgements that do not count as an acknowledgement of the answer (the opener repair needs them)
IE_ACKS = 2             # an Indian-English persona has this many Indian-English acknowledgements (when that many fit)
MAX_DOUBLED = 1         # at most one doubled phrase ("Okay, okay.") in a persona's habits
MAX_SHARED = 2          # a new persona shares at most this many phrases with each of the candidate's last two interviewers
ATTEMPTS = 30           # draws tried to get there


def _short(traits: dict[str, str]) -> bool:
    return traits.get("pace") == "brisk" or traits.get("verbosity") == "terse"


def candidates(kind: V.Kind, traits: dict[str, str], stage: str | None = None, verdict: bool | None = None) -> list[V.Phrase]:
    """The phrases of a kind (and stage) the persona may have: those that fit its traits, and only the short ones when it is brisk or terse."""
    cap = SHORT_WORDS[kind] if _short(traits) else None
    return [p for p in V.by_kind(kind, stage) if V.fits(p, traits) and (cap is None or p.words <= cap) and (verdict is None or p.verdict == verdict)]


def _is_ie(p: V.Phrase) -> bool:
    return p.fits.get("register") == frozenset({"indian_english"})


def _plain(text: str) -> bool:
    """A neutral acknowledgement that the talker does not count as acknowledging the answer ("Okay.", not "Got it." or "Understood.")."""
    from app.interviewer.talker import ACKNOWLEDGES     # imported late: the talker imports the interviewer's modules, which import this package
    return not ACKNOWLEDGES(text)


@lru_cache(maxsize=1)
def _weights() -> dict[str, float]:
    """A phrase's weight in a draw is the inverse of the share of voices it suits (the register aside: an Indian-English phrase is not drawn more
    often for it): a phrase that suits every voice ("Okay.") is drawn less often than one that suits a few ("Love that."), so no phrase becomes
    every persona's tic (decided 2026-10-18: "Fair enough" was one)."""
    axes = [a for a in V.LEVELS if a != "register"]
    voices = [dict(zip(axes, levels)) for levels in product(*(sorted(V.LEVELS[a]) for a in axes))]
    suits = lambda p, v: all(v[a] in levels for a, levels in p.fits.items() if a != "register")
    return {p.text: len(voices) / max(1, sum(suits(p, v) for v in voices)) for p in V.VOCABULARY}


class _Taken:
    """What a persona has drawn so far: its phrases, their families (one phrase per family) and whether it has its one doubled phrase."""
    def __init__(self) -> None:
        self.texts: set[str] = set()
        self.families: set[str] = set()
        self.doubled = 0

    def allows(self, p: V.Phrase) -> bool:
        return p.text not in self.texts and not (p.family and p.family in self.families) and not (p.doubled and self.doubled >= MAX_DOUBLED)

    def take(self, p: V.Phrase) -> None:
        self.texts.add(p.text)
        self.doubled += p.doubled
        if p.family:
            self.families.add(p.family)


def _weighted_order(rng: random.Random, pool: list[V.Phrase]) -> list[V.Phrase]:
    """The pool in a random order where each phrase comes earlier in proportion to its weight (a random key to the power 1/weight)."""
    weights = _weights()
    return sorted(pool, key=lambda p: rng.random() ** (1.0 / weights.get(p.text, 1.0)), reverse=True)


def _sample(rng: random.Random, pool: list[V.Phrase], k: int, blocked: set[str], taken: _Taken, reuse: bool = True) -> list[str]:
    """Up to `k` texts of `pool` the persona may still have (`_Taken.allows`): those the last interviewers did not say first, then, only when
    too few are left (and `reuse`), theirs."""
    chosen: list[V.Phrase] = []
    for group in ([p for p in pool if p.text not in blocked], [p for p in pool if p.text in blocked] if reuse else []):
        for p in _weighted_order(rng, group):
            if len(chosen) >= k:
                break
            if taken.allows(p):
                taken.take(p)
                chosen.append(p)
    return [p.text for p in chosen]


def phrases_of(habits: dict[str, Any] | SpeechHabits) -> set[str]:
    """Every phrase of a persona's habits, for comparing two personas."""
    h = habits.model_dump() if isinstance(habits, SpeechHabits) else habits
    out = {str(x) for key in ("acks", "backchannels", "lead_ins") for x in h.get(key) or []}
    for lines in (h.get("fillers") or {}).values():
        out.update(str(x) for x in lines)
    return out


def draw_habits(rng: random.Random, traits: dict[str, str], avoid: list[dict[str, Any]] | None = None) -> SpeechHabits:
    """The persona's speech habits (`_draw_habits`), drawn again, up to `ATTEMPTS` times, until they share at most `MAX_SHARED` phrases with each of
    the habits in `avoid`; then, if no draw did, again at the smallest sizes (5 acknowledgements, 3 backchannels, 2 fillers per stage, 3 lead-ins).
    A voice so narrow that its pools hold fewer phrases than the last interviewers used cannot always manage it (about 1 in 1,000 draws for a
    candidate's real history, a few percent when the last two interviewers had the very same narrow voice; see the tests): the draw that
    shares the fewest is returned then."""
    best: tuple[int, SpeechHabits] | None = None
    for compact in ((False, True) if avoid else (False,)):
        for _ in range(ATTEMPTS if avoid else 1):
            habits = _draw_habits(rng, traits, avoid, compact)
            worst = max((len(phrases_of(habits) & phrases_of(a)) for a in avoid or []), default=0)
            if worst <= MAX_SHARED:
                return habits
            if best is None or worst < best[0]:
                best = (worst, habits)
    return best[1]


def _draw_habits(rng: random.Random, traits: dict[str, str], avoid: list[dict[str, Any]] | None = None, compact: bool = False) -> SpeechHabits:
    """The persona's speech habits, drawn from the vocabulary among the phrases that fit its traits: 5-8 acknowledgements (fewer for a terse
    interviewer, more for a chatty one; at most two that judge, none for most reserved ones), 3-4 backchannels (3 for a reserved one, 4 for a
    very warm one), 2-3 wordings per wait stage and 3-5 lead-ins; at most one phrase of a family and one doubled phrase ("Okay, okay.") in all.
    An Indian-English persona has two Indian-English acknowledgements (only those; the others come from the shared pool). `avoid` is the habits
    of the candidate's last interviewers: their phrases are left out while enough others fit."""
    blocked = set().union(*(phrases_of(a) for a in avoid or [])) if avoid else set()
    taken = _Taken()
    ie = traits.get("register") == "indian_english"
    verbosity, warmth = traits.get("verbosity", "normal"), traits.get("warmth")

    low, high = _ACK_COUNT.get(verbosity, (6, 7))
    total = 5 if compact else rng.randint(low, high)
    n_verdict = min(rng.choice(_VERDICT_COUNT.get(warmth or "friendly", (0, 1, 1, 2))), len(candidates("ack", traits, verdict=True)), total - PLAIN_ACKS - 2)
    neutral_pool = candidates("ack", traits, verdict=False)
    shared_pool = [p for p in neutral_pool if not _is_ie(p)]
    acks: list[str] = []
    if ie:
        acks += _sample(rng, [p for p in neutral_pool if _is_ie(p)], IE_ACKS, blocked, taken, reuse=False)     # a flavour, never at the price of a repeat
    have_plain = sum(1 for a in acks if _plain(a))
    acks += _sample(rng, [p for p in shared_pool if _plain(p.text)], PLAIN_ACKS - have_plain, blocked, taken)
    acks += _sample(rng, shared_pool, total - n_verdict - len(acks), blocked, taken)
    # a judging phrase in the persona's Indian-English register only while the quota of Indian-English acknowledgements is not used up
    ie_used = sum(1 for a in acks if _is_ie(V.phrase_of(a, "ack")))
    pool_verdict = [p for p in candidates("ack", traits, verdict=True) if not _is_ie(p) or ie_used < IE_ACKS]
    acks += _sample(rng, pool_verdict, n_verdict, blocked, taken)
    rng.shuffle(acks)

    n_back = 3 if warmth == "reserved" or compact else 4 if warmth == "very warm" else rng.randint(3, 4)
    backchannels = _sample(rng, [p for p in candidates("backchannel", traits) if not _is_ie(p)], n_back, blocked, taken)
    rng.shuffle(backchannels)

    lead_ins = _sample(rng, candidates("lead_in", traits), 3 if compact else rng.randint(*_LEAD_IN_COUNT.get(verbosity, (3, 4))), blocked, taken)
    fillers = {stage: _sample(rng, candidates("filler", traits, stage), 2 if compact else rng.randint(2, 3), blocked, _Taken()) for stage in V.STAGES}
    return SpeechHabits(acks=acks, backchannels=backchannels, fillers=fillers, lead_ins=lead_ins)


def habits_problems(h: SpeechHabits, traits: dict[str, str]) -> list[str]:
    """What is wrong with the habits for a persona with these traits: empty when they are valid. Sizes, every phrase from the vocabulary
    (of its kind and, for fillers, its stage) and suiting the traits, no repeats, at most one phrase of a family and one doubled phrase."""
    problems: list[str] = []
    seen = _Taken()

    def check(name: str, lines: list[str], kind: V.Kind, low: int, high: int, stage: str | None = None, shared: _Taken | None = None) -> None:
        phrases = [V.phrase_of(x, kind, stage) for x in lines]
        if not low <= len(lines) <= high or len(set(lines)) != len(lines):
            problems.append(f"{name} must be {low}-{high} distinct phrases of the vocabulary")
        elif any(p is None for p in phrases):
            problems.append(f"{name} has a phrase that is not in the speech vocabulary")
        elif any(not V.fits(p, traits) for p in phrases if p is not None):
            problems.append(f"{name} has a phrase that does not suit the persona's traits")
        elif _short(traits) and any(p.words > SHORT_WORDS[kind] for p in phrases if p is not None):
            problems.append(f"{name} has a long phrase for a brisk or terse persona")
        else:
            state = shared if shared is not None else seen
            for p in phrases:
                if p is not None and not state.allows(p):
                    problems.append(f"{name} has {p.text!r}: a second phrase of its family, or a second doubled phrase")
                    break
                if p is not None:
                    state.take(p)

    check("acks", h.acks, "ack", 5, 8)
    check("backchannels", h.backchannels, "backchannel", 3, 4)
    check("lead_ins", h.lead_ins, "lead_in", 3, 5)
    if set(h.fillers) != set(V.STAGES):
        problems.append(f"fillers must cover exactly the stages {list(V.STAGES)}")
    else:
        for stage, lines in h.fillers.items():
            check(f"fillers {stage}", lines, "filler", 2, 3, stage, _Taken())
    return problems


# ---------------------------------------------------------------- outline

PARTS = ("greeting", "small_talk", "framing", "candidate_intro", "core", "deep_dive", "candidate_questions", "wrap_up")
PROMISE_KINDS = ("projects", "fundamentals")
MAX_PROMISED_AREAS, MAX_PROMISED_PROJECTS = 3, 2


_SOURCE = (r"resume|cv|github|git hub|linkedin|leetcode|codeforces|codechef|atcoder|tuf|portfolio|coding profiles?|profile|education|skills|"
           r"summary|projects?|experience|work experience|work history|internships?|achievements|certifications|headline|coding|tech stack")
_SOURCE_PREFIX = re.compile(rf"^\s*(?:my\s+|the\s+|your\s+)?(?:{_SOURCE})\s*(?:[:\-\u2013\u2014/]|\bproject\b:?)\s*", re.IGNORECASE)
_GENERIC = re.compile(rf"^\s*(?:my\s+|the\s+|your\s+)?(?:{_SOURCE})(?:\s+(?:profile|repos?|repositories|account|projects?|experience|section|"
                      r"activity|data|summary|link|url|stack|details|history))*\s*$", re.IGNORECASE)
# A field path of the candidate profile ("projects[0].stack", "experience.summary") and a link ("github.com/u/vibe") are no name.
_FIELDS = r"candidate_profile|profile|projects?|experience|education|skills|coding|headline|summary|level"
_FIELD_PATH = re.compile(rf"^\s*(?:{_FIELDS})(?:\[\d+\]|\.\w+)+\s*$|\[\d+\]", re.IGNORECASE)
_URL = re.compile(r"://|^\s*www\.|\b[\w-]+\.(?:com|io|dev|org|net|app|ai|in)\b/?", re.IGNORECASE)
_PROJECT_INDEX = re.compile(r"^\s*(?:candidate_profile\.|profile\.)?projects?(?:\[(\d+)\]|\.(\d+)\b)", re.IGNORECASE)
MAX_PROJECT_WORDS, MAX_PROJECT_CHARS = 4, 40


def _clean_name(text: str) -> str | None:
    """A free-text value as a project name the interviewer can say, or None: a link or a profile field path is no name, a source or
    a section named instead of a project ("Resume", "GitHub profile", "Work experience") is none, a leading source or "Project:" is
    dropped ("GitHub: Vibe" -> "Vibe"), a trailing parenthetical is dropped, and a value over 4 words or 40 characters takes its head
    before " - ", ":", "(" or ","."""
    if _FIELD_PATH.search(text) or _URL.search(text):
        return None
    name = re.sub(r"\s*\([^)]*\)\s*$", "", _SOURCE_PREFIX.sub("", text)).strip(" .")
    if len(name.split()) > MAX_PROJECT_WORDS or len(name) > MAX_PROJECT_CHARS:
        name = re.split(r"\s+[-\u2013\u2014]\s+|:|\(|,", name, maxsplit=1)[0].strip(" .")
    if not name or _GENERIC.match(name) or len(name.split()) > MAX_PROJECT_WORDS or len(name) > MAX_PROJECT_CHARS:
        return None
    return name


def project_name(grounded_in: str, profile_projects: list[str] | None = None) -> str | None:
    """The project a resume probe is about, as a name to say aloud, or None when it is about no project.

    With the candidate's own project names (`profile_projects`, in profile order) the name comes from them: a field path
    `projects[N]...` resolves to the Nth project's name, and a value that contains a project's name (whole word) gives that name;
    anything else (`experience.summary`, "Work experience", a link) is None, so no project is promised. Without them the
    value is cleaned as free text (`_clean_name`)."""
    text = str(grounded_in or "").strip()
    if profile_projects is None:
        return _clean_name(text)
    if _URL.search(text):
        return None
    names = [_clean_name(str(n or "")) for n in profile_projects]        # aligned with the profile, so an index still resolves
    indexed = _PROJECT_INDEX.match(text)
    if indexed:
        i = int(indexed.group(1) or indexed.group(2))
        return names[i] if i < len(names) else None
    for name in sorted((n for n in names if n), key=len, reverse=True):
        if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", text, re.IGNORECASE):
            return name
    return None


# A hiring-manager or behavioural round's resume questions are about their experience already; its deep dive does not ask about
# their projects as a part of its own (`plan._asks_projects`), so it promises none.
NO_PROJECT_PROMISES = frozenset({"hiring-manager", "behavioural"})


def pools(personal: dict[str, Any], round_type: str = "", profile_projects: list[str] | None = None) -> tuple[list[str], list[str]]:
    """What the deep dive can promise: the fundamentals areas of the round's questions and the projects its resume probes are about
    (names from `project_name`; none for a round type in `NO_PROJECT_PROMISES`, and none when no probe resolves to a real project)."""
    projects: list[str] = []
    if round_type not in NO_PROJECT_PROMISES:
        seen: set[str] = set()
        for probe in deep_dive_probes(personal):
            name = project_name(probe.get("grounded_in"), profile_projects)
            if name and name.lower() not in seen:
                seen.add(name.lower())
                projects.append(name)
    return round_question_areas(personal), projects


def swap_intro(seed: int) -> bool:
    """Whether a classic opening puts the candidate's introduction before the framing. Decided from the seed before the arc is
    planned (`plan_arc(..., swap_intro=...)`), so the arc, the persona's phase guidance and the outline all have the order."""
    return rng_for(seed, "order").random() < 0.5


def draw_outline(rng: random.Random, family: str, shape_order: list[str], areas: list[str], projects: list[str],
                 duration_mins: int) -> list[RealismOutlinePart]:
    """The conversation parts, mirroring the arc exactly: `shape_order` is the arc's phases in the order the round runs them (the
    arc owns the order; see `swap_intro`). The deep dive, when the round has one (`areas` or `projects` is not empty), follows the
    core, as the live plan runs it. It promises 1-3 areas and 1-2 projects, fewer areas in a shorter round. `family` is kept for
    callers; no family reorders parts."""
    promises: list[str] = []
    if projects:
        promises += [f"projects:{p}" for p in rng.sample(projects, rng.randint(1, min(MAX_PROMISED_PROJECTS, len(projects))))]
    if areas:
        cap = MAX_PROMISED_AREAS if duration_mins >= 40 else MAX_PROMISED_AREAS - 1
        promises += [f"fundamentals:{a}" for a in rng.sample(areas, rng.randint(1, min(cap, len(areas))))]
    rng.shuffle(promises)
    parts = [RealismOutlinePart(part=p) for p in shape_order]
    if (areas or projects) and "core" in shape_order:
        parts.insert(shape_order.index("core") + 1, RealismOutlinePart(part="deep_dive", promises=promises))
    return parts


# ---------------------------------------------------------------- change stance

_REFUSALS: dict[str, tuple[int, int]] = {"soft": (1, 1), "normal": (1, 2), "firm": (2, 3)}


def change_stance(traits: dict[str, str], rng: random.Random | None = None) -> ChangeStance:
    """How many refusals to expect before giving in: soft 1, normal 1-2, firm 2-3 (drawn with `rng`; the lowest without one)."""
    firmness = traits.get("firmness", "normal")
    low, high = _REFUSALS.get(firmness, _REFUSALS["normal"])
    return ChangeStance(firmness=firmness, refusals_prior=rng.randint(low, high) if rng else low)


# ---------------------------------------------------------------- the whole block

def rng_for(seed: int, part: str) -> random.Random:
    """One stream per part of the plan, so the same seed always gives the same plan."""
    return random.Random(f"realism:{seed}:{part}")


def draw_realism_traits(seed: int, avoid: list[dict[str, str]], shape_id: str | None = None,
                        excludes: dict[str, tuple[str, ...]] = {}, pairs: tuple = (), forced: dict[str, str] = {}) -> dict[str, str]:
    return draw_traits(rng_for(seed, "traits"), avoid, shape_id, excludes, pairs, forced)


def draw_seniority(seed: int, pack: RoundPack, band: Band, level: str | None = None) -> str:
    """The interviewer's title, drawn in code (the model's own is ignored) from the pack's titles for the band, always ranked above
    the candidate's level. When none of those is, the lowest ladder title above the candidate on the pack's track (manager or
    individual contributor); a candidate above the whole ladder gets the top of the track."""
    rank = LEVEL_RANKS.get(level or "", 2)
    titles = tuple((pack.titles or {}).get(band) or ())
    above = [t for t in titles if TITLE_RANKS[t] > rank]
    if above:
        return rng_for(seed, "seniority").choice(above)
    manager = bool(titles) and all(t in MANAGER_TITLES for t in titles)
    track = sorted((t for t in TITLE_RANKS if (t in MANAGER_TITLES) == manager and t != "Hiring Manager, Engineering"), key=TITLE_RANKS.__getitem__)
    return next((t for t in track if TITLE_RANKS[t] > rank), track[-1])


def focus_choices(pack: RoundPack, band: Band) -> list[str]:
    """The pack's focuses for this band: LLD drops concurrency at the early band."""
    return [f for f in pack.focuses if not (pack.pack_id == "lld" and band == "early" and f == "concurrency")]


def draw_focus(seed: int, pack: RoundPack, band: Band, last: str | None = None) -> str | None:
    """The round's focus, drawn from the pack's focuses, never `last` (the candidate's previous one for this pack) unless it is the only
    choice. LLD drops concurrency at the early band. None when the pack has no focuses."""
    choices = focus_choices(pack, band)
    if not choices:
        return None
    return rng_for(seed, "focus").choice([f for f in choices if f != last] or choices)


def draw_realism_habits(seed: int, traits: dict[str, str], avoid: list[dict[str, Any]] | None = None) -> SpeechHabits:
    return draw_habits(rng_for(seed, "habits"), traits, avoid)


def build_realism(seed: int, traits: dict[str, str], family: str, shape_order: list[str], areas: list[str], projects: list[str],
                  duration_mins: int, habits: SpeechHabits | None = None, avoid_habits: list[dict[str, Any]] | None = None) -> Realism:
    """`habits` are the ones a re-prep keeps (or the pipeline drew); without them they are drawn from the seed, away from `avoid_habits`."""
    return Realism(seed=seed, traits=traits, habits=habits or draw_realism_habits(seed, traits, avoid_habits),
                   outline=draw_outline(rng_for(seed, "outline"), family, shape_order, areas, projects, duration_mins),
                   change=change_stance(traits, rng_for(seed, "change")))


# ---------------------------------------------------------------- validation

MIN_ROUND_MINS, MAX_ROUND_MINS = 30, 45


def _promise(promise: str) -> tuple[str, str]:
    kind, _, name = promise.partition(":")
    return kind, name


def validate_realism(r: Realism, blueprint: dict[str, Any]) -> list[str]:
    """What is wrong with the plan, empty when it is valid: the round's length in range, coherent traits, habits from the vocabularies
    in their sizes, an outline that keeps every part of the round (core included) and promises only areas and projects the round's
    questions hold, and a stance that matches the firmness."""
    problems: list[str] = []
    rnd = blueprint.get("round") or {}
    minutes = rnd.get("duration_mins")
    if not isinstance(minutes, int) or not MIN_ROUND_MINS <= minutes <= MAX_ROUND_MINS:
        problems.append(f"round length {minutes} is outside {MIN_ROUND_MINS}-{MAX_ROUND_MINS} minutes")
    # traits
    if set(r.traits) != set(TRAIT_AXES):
        problems.append(f"traits must be exactly {sorted(TRAIT_AXES)}")
    else:
        for axis, value in r.traits.items():
            if value not in TRAIT_AXES[axis]:
                problems.append(f"trait {axis}={value!r} is not one of {TRAIT_AXES[axis]}")
        if not coherent(r.traits):
            problems.append("the traits are an incoherent combination")
        if not fits_shape(r.traits, blueprint.get("shape_id")):
            problems.append(f"the traits clash with the round's shape {blueprint.get('shape_id')!r}")
    # habits
    problems += habits_problems(r.habits, r.traits)
    # outline
    parts = [p.part for p in r.outline]
    fam = family_of(str(rnd.get("type") or ""))
    if len(set(parts)) != len(parts) or not set(parts) <= set(PARTS):
        problems.append("the outline repeats a part or names an unknown one")
    if "core" not in parts:
        problems.append(f"the outline has no core part (family {fam})")
    arc_phases = [a.get("phase") for a in blueprint.get("arc") or []]
    if arc_phases and [p for p in parts if p != "deep_dive"] != arc_phases:
        problems.append(f"the outline's parts {[p for p in parts if p != 'deep_dive']} differ from the arc's {arc_phases} (order included)")
    if parts and "greeting" in parts and parts[0] != "greeting":
        problems.append("the outline must open with the greeting")
    if parts and "wrap_up" in parts and parts[-1] != "wrap_up":
        problems.append("the outline must end with the wrap-up")
    if "deep_dive" in parts and ("core" not in parts or parts.index("deep_dive") != parts.index("core") + 1):
        problems.append("the deep dive must follow the core directly")
    if "deep_dive" in parts and int(rnd.get("deep_dive_mins") or 0) <= 0:
        problems.append("the outline has a deep dive but the round sets no time aside for one")
    areas, projects = pools(blueprint.get("personalization") or {}, str(rnd.get("type") or ""), blueprint.get("profile_projects"))
    promised_areas: list[str] = []
    promised_projects: list[str] = []
    for part in r.outline:
        if part.promises and part.part != "deep_dive":
            problems.append(f"only the deep dive makes promises, not {part.part}")
        for promise in part.promises:
            kind, name = _promise(promise)
            if kind == "fundamentals":
                promised_areas.append(name)
                if name not in areas:
                    problems.append(f"promised area {name!r} is not in the round's question pool")
            elif kind == "projects":
                promised_projects.append(name)
                if name not in projects:
                    problems.append(f"promised project {name!r} is not one the resume probes cover")
            else:
                problems.append(f"promise {promise!r} must start with one of {PROMISE_KINDS}")
    if len(set(promised_areas)) != len(promised_areas) or len(promised_areas) > MAX_PROMISED_AREAS or (areas and "deep_dive" in parts and not promised_areas):
        problems.append(f"the deep dive must promise 1-{MAX_PROMISED_AREAS} distinct areas when the round has any")
    if len(set(promised_projects)) != len(promised_projects) or len(promised_projects) > MAX_PROMISED_PROJECTS or (projects and "deep_dive" in parts and not promised_projects):
        problems.append(f"the deep dive must promise 1-{MAX_PROMISED_PROJECTS} distinct projects when the round has any")
    # change stance
    if r.change.firmness != r.traits.get("firmness"):
        problems.append("the change stance's firmness differs from the firmness trait")
    low, high = _REFUSALS.get(r.change.firmness, (0, -1))
    if not low <= r.change.refusals_prior <= high:
        problems.append(f"refusals_prior {r.change.refusals_prior} is outside {low}-{high} for {r.change.firmness!r} firmness")
    if not isinstance(r.seed, int) or r.seed < 0:
        problems.append("the seed must be a non-negative integer")
    return problems
