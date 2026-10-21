"""Practice suggestions for a report's topic gaps (spec §11.5): bank problems on the weak topic, the same company first, at most the
round's difficulty. Only slug, title and difficulty are returned, never a statement.

Each gap topic is ranked in one of two ways. A topic with grader-chosen `bank_tags` is matched on those exact tags and must clear a
relevance bar (`_rank_by_tags`); a topic without them is matched by its phrase mapped onto the canonical topic vocabulary
(`_rank_by_phrase`, the path for old reports and derived gaps). `_dedupe_round_robin` then gives every topic its best unique pick
before anyone's second."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

from app.blueprint import selection
from app.blueprint import topics as T
from app.evaluation.topics_util import NO_PRACTICE_SUBJECTS, Source, topics_of, words

_RANK = {"easy": 1, "medium": 2, "hard": 3}
_COMMON = 0.08          # a topic or tag on more than this share of the pool is common: it only ever fills in behind a specific one


def _rank(doc: dict) -> int:
    return _RANK.get((doc.get("difficulty") or "").lower(), 2)


def _tags_of(doc: dict) -> list[str]:
    return [t.strip() for k in ("topic_tags", "patterns_tested") for t in doc.get(k) or [] if isinstance(t, str) and t.strip()]


async def load_bank(round_type: str) -> list[dict]:
    """The round's bank pool, loaded once per run. Never raises: an unavailable bank gives an empty pool (grading proceeds without tags)."""
    try:
        return await selection.load_pool(round_type)
    except Exception:  # noqa: BLE001
        return []


def tag_vocabulary(pool: list[dict], cap: int = 300) -> list[str]:
    """The pool's tags (topic_tags and patterns_tested), most frequent first, one spelling per tag (the commonest), for the graders to
    choose `bank_tags` from."""
    counts: dict[str, dict[str, int]] = {}
    for d in pool:
        for tag in set(_tags_of(d)):
            spellings = counts.setdefault(tag.lower(), {})
            spellings[tag] = spellings.get(tag, 0) + 1
    ranked = sorted(counts.values(), key=lambda sp: (-sum(sp.values()), min(sp)))
    return [max(sp, key=lambda k: (sp[k], k)) for sp in ranked[:cap]]


# ---------------------------------------------------------------- the pool, indexed once

@dataclass(frozen=True)
class _Entry:
    doc: dict
    topics: frozenset[str]       # canonical topics of the problem (of the round's kind)
    tags: frozenset[str]         # raw bank tags, lower-case
    tag_words: frozenset[str]
    mine: bool                   # tagged with the candidate's company


class _Index:
    """Read-only view of the candidate problems (the pool minus the excluded ones) with document frequencies for idf weighting."""

    def __init__(self, pool: list[dict], kind: str | None, company_key: str):
        self.kind = kind
        self.entries = []
        for d in pool:
            topics = frozenset(t for t in selection.problem_topics(d) if not kind or T.KIND_OF.get(t) == kind)
            mine = bool(company_key) and any((c or "").strip().lower() == company_key for c in d.get("company_tags") or [])
            self.entries.append(_Entry(d, topics, frozenset(t.lower() for t in _tags_of(d)),
                                       frozenset(words(" ".join(t for t in d.get("topic_tags") or [] if isinstance(t, str)))), mine))
        self.n = max(len(self.entries), 1)
        self.topic_df = self._df(e.topics for e in self.entries)
        self.tag_df = self._df(e.tags for e in self.entries)
        self.word_df = self._df(e.tag_words for e in self.entries)

    @staticmethod
    def _df(sets) -> dict[str, int]:
        out: dict[str, int] = {}
        for s in sets:
            for t in s:
                out[t] = out.get(t, 0) + 1
        return out

    def _idf(self, df: dict[str, int], t: str) -> float:
        return math.log(self.n / max(df.get(t, 0), 1))

    def topic_weight(self, shared) -> tuple[float, float]:
        """(specific weight, common weight) of shared canonical topics, idf-weighted; specific always outranks common."""
        spec = sum(self._idf(self.topic_df, t) for t in shared if self.topic_df.get(t, 0) / self.n <= _COMMON)
        return spec, sum(self._idf(self.topic_df, t) for t in shared if self.topic_df.get(t, 0) / self.n > _COMMON)

    def tag_weight(self, shared) -> tuple[float, float]:
        spec = sum(self._idf(self.tag_df, t) for t in shared if self.tag_df.get(t, 0) / self.n <= _COMMON)
        return spec, sum(self._idf(self.tag_df, t) for t in shared if self.tag_df.get(t, 0) / self.n > _COMMON)

    def word_score(self, ws: set[str], tag_words) -> float:
        return sum(self._idf(self.word_df, w) for w in ws & tag_words)

    def kinded(self, text: str) -> set[str]:
        return {t for t in T.topics_in(text) if not self.kind or T.KIND_OF.get(t) == self.kind}


@dataclass(frozen=True)
class _Ask:
    """What one gap topic is ranked against."""
    name: str
    why: str
    level: int               # difficulty ceiling (1-3)
    source: frozenset[str]   # canonical topics of the source problem (or of the round) for tie-breaks
    mapped: bool             # the gap is tied to one real source problem: only then may one harder problem be offered
    source_tags: frozenset[str]
    fallback: frozenset[str]


# ---------------------------------------------------------------- ranking

def _rank_by_tags(ix: _Index, ask: _Ask, bank_tags: list[str]) -> list[dict] | None:
    """Problems for the grader's own tags, best first. The relevance bar: a problem shares >= 2 distinct tags with the topic's tags plus
    the source problem's, or the topic's first (most specific) tag when at least two problems hold it (a lone tag is enough for a
    single-tag topic). Nothing qualifying gives [] (fewer, never filler); None means none of the tags exist in the bank at all, so
    the caller falls back to the phrase. One harder problem is offered only when a real source is known and nothing at or below the
    level qualifies."""
    wanted = [t.strip().lower() for t in bank_tags if isinstance(t, str) and t.strip()]
    if not any(ix.tag_df.get(t) for t in wanted):
        return None
    relevant = set(wanted) | {t.lower() for t in ask.source_tags}
    top = wanted[0]
    top_ok = len(wanted) == 1 or ix.tag_df.get(top, 0) >= 2
    scored = []
    for e in ix.entries:
        got = [t for t in wanted if t in e.tags]
        if not got or not (len(e.tags & relevant) >= 2 or (top in e.tags and top_ok)):
            continue
        spec, common = ix.tag_weight(got)
        se, ce = ix.topic_weight(e.topics & ask.source)
        scored.append(((-spec, -common, -se, -ce, not e.mine, len(e.topics), ask.level - _rank(e.doc), e.doc["slug"]), e.doc))
    scored.sort(key=lambda x: x[0])
    within = [d for _, d in scored if _rank(d) <= ask.level]
    harder = [] if within or not ask.mapped else [d for _, d in scored if _rank(d) > ask.level][:1]
    return within + harder


def _rank_by_phrase(ix: _Index, ask: _Ask) -> list[dict]:
    """Problems for a phrase with no grader tags: the first stage (phrase topics, then the `why`, then the round's topics) that leaves a
    usable problem wins, then a keyword match of the phrase's words against the tags. Every stage ranks by idf-weighted shared topics."""
    ws = words(ask.name)

    def scored(target: set[str], extra: set[str]) -> list[tuple]:
        out = []
        for e in ix.entries:
            if target and not (e.topics & target):
                continue
            if not target and not (ws & e.tag_words):
                continue
            st, ct = ix.topic_weight(e.topics & target)
            se, ce = ix.topic_weight(e.topics & extra)
            key = (-st, -se, -ix.word_score(ws, e.tag_words), -ct, -ce,
                   not e.mine, len(e.topics), ask.level - _rank(e.doc), e.doc["slug"])
            out.append((key, e.doc, bool(e.topics & extra)))
        return out

    def order(rows: list[tuple]) -> list[dict]:
        rows.sort(key=lambda x: x[0])
        within = [r for r in rows if _rank(r[1]) <= ask.level]
        both = [r for r in within if r[2]]
        # relevance beats the ceiling as a last resort, on a real source only: with nothing at or below the level that matches the
        # phrase and the source problem, one harder problem that does comes first (its difficulty stays visible)
        harder = [] if both or not ask.mapped else [r for r in rows if _rank(r[1]) > ask.level and r[2]][:1]
        return [r[1] for r in both + harder + [r for r in within if not r[2]]]

    source = set(ask.source)
    for target in (ix.kinded(ask.name), ix.kinded(ask.why), set(ask.fallback)):
        if target:
            found = order(scored(target, (source - target) or source))
            if found:
                return found
    return order(scored(set(), source))


def _dedupe_round_robin(ranked: dict[str, list[dict]], per_topic: int) -> dict[str, list[dict]]:
    """Every topic gets its best unique pick first, then its second, and so on; a topic short of unique problems may repeat one."""
    picked: dict[str, list[dict]] = {name: [] for name in ranked}
    used: set[str] = set()
    for _ in range(per_topic):
        for name, docs in ranked.items():
            nxt = next((d for d in docs if d["slug"] not in used and d not in picked[name]), None)
            if nxt is not None and len(picked[name]) < per_topic:
                picked[name].append(nxt)
                used.add(nxt["slug"])
    for name, docs in ranked.items():
        got = picked[name]
        got += [d for d in docs if d not in got][: per_topic - len(got)]
    return picked


# ---------------------------------------------------------------- entry point

def _ask_for(name: str, why: str, src: Source, src_doc: dict | None, kind: str | None, fallback: set[str], max_difficulty: str | None,
             default_difficulty: str | None) -> _Ask:
    doc_topics = {t for t in selection.problem_topics(src_doc) if not kind or T.KIND_OF.get(t) == kind} if src_doc else set()
    topics = set(src.topics) or doc_topics
    tags = set(src.tags) or set(_tags_of(src_doc or {}))
    level = _RANK.get(((max_difficulty or src.difficulty or (src_doc or {}).get("difficulty") or default_difficulty) or "medium").lower(), 2)
    return _Ask(name, why, level, frozenset(topics or fallback), bool(src.mapped and topics), frozenset(tags), frozenset(fallback))


async def suggest(topic_gaps: list, round_type: str, company: str, exclusions: list[str] | set[str], per_topic: int = 3,
                  max_difficulty: str | None = None, fallback_topics: set[str] | None = None,
                  default_difficulty: str | None = None, sources: dict[str, Source] | None = None,
                  pool: list[dict] | None = None) -> dict[str, list[dict]]:
    """`{topic: [{slug, title, difficulty}]}` for every topic named in the gaps (a topic with nothing found maps to []).

    `sources` maps a gap phrase to the problem it came from (see `Source`); `fallback_topics` are the canonical topics of the round's own
    problems; `pool` is the round's bank pool when the caller already loaded it. Behaviour and communication subjects, and topics the
    grader gave an explicit empty `bank_tags`, get no practice."""
    wanted = [t for gap in topic_gaps or [] for t in topics_of(gap)]
    if not wanted:
        return {}
    kind = selection.KIND_OF_FAMILY.get(round_type)
    full = pool if pool is not None else await load_bank(round_type)
    skip = set(exclusions or [])
    by_slug = {d["slug"]: d for d in full if d.get("slug")}
    ix = _Index([d for d in full if d.get("slug") and d["slug"] not in skip], kind, (company or "").strip().lower())
    fallback = {t for t in (fallback_topics or set()) if not kind or T.KIND_OF.get(t) == kind}
    coding_round = kind in ("dsa", "design")

    ranked: dict[str, list[dict]] = {}
    for name, why, subject, btags in wanted:
        if name in ranked:
            continue
        if (coding_round and any(w in subject.lower() for w in NO_PRACTICE_SUBJECTS)) or (btags is not None and not btags):
            ranked[name] = []                                     # behaviour and habits, or a grader that chose no tags: no practice list
            continue
        src = (sources or {}).get(name) or Source()
        ask = _ask_for(name, why, src, by_slug.get(src.slug or ""), kind, fallback, max_difficulty, default_difficulty)
        found = _rank_by_tags(ix, ask, btags) if btags else None
        ranked[name] = found if found is not None else _rank_by_phrase(ix, ask)

    return {name: [{"slug": d["slug"], "title": d.get("title") or d["slug"], "difficulty": d.get("difficulty")} for d in docs]
            for name, docs in _dedupe_round_robin(ranked, per_topic).items()}
