import asyncio

from app.blueprint import selection
from app.evaluation import practice
from app.evaluation.topics_util import Source

LIS = "Longest increasing subsequence: quadratic DP state and recurrence, including how the final answer is aggregated"
BS = "Binary search on minimal subsequence tails for O(n log n) LIS"
SW = "Subsequence versus subarray, and why sliding window does not apply to subsequences"
MEMO = "Memoisation design: choosing state that captures all information needed for future choices"


def doc(slug, tags, difficulty="medium", companies=()):
    return {"slug": slug, "title": slug.title(), "difficulty": difficulty, "topic_tags": tags, "company_tags": list(companies)}


LIS_DOC = doc("lis", ["Dynamic Programming", "Binary Search", "Longest Increasing Subsequence"])
POOL = [
    LIS_DOC,
    doc("climb", ["1-D Dynamic Programming", "Memoization"], "easy"),
    doc("coin", ["Dynamic Programming"], "medium", ["SalesCode"]),
    doc("hard-dp", ["Dynamic Programming"], "hard"),
    doc("bs1", ["Binary Search"], "easy"),
    doc("bs2", ["Binary Search", "Array"]),
    doc("win", ["Sliding Window", "Array"]),
    doc("win2", ["Sliding Window", "String"], "easy"),
    doc("graph", ["Graph"]),
]


def run(gaps, monkeypatch, **kw):
    async def pool(round_type, culture=False):
        return POOL
    monkeypatch.setattr(selection, "load_pool", pool)
    args = dict(round_type="dsa", company="salescode", exclusions=[], max_difficulty="medium")
    args.update(kw)
    return asyncio.run(practice.suggest([{"subject": "DSA", "topics": [{"topic": g} for g in gaps]}], **args))


def slugs(out, topic):
    return [p["slug"] for p in out[topic]]


def test_long_phrases_find_problems_in_the_right_tag_family(monkeypatch):
    out = run([LIS, BS, SW, MEMO], monkeypatch, fallback_topics={"dynamic-programming"})
    assert set(slugs(out, LIS)) <= {"lis", "climb", "coin"} and slugs(out, LIS)
    assert slugs(out, BS) and set(slugs(out, BS)) <= {"lis", "bs1", "bs2"}
    assert slugs(out, SW)[0] in {"win", "win2"} and {"win", "win2"} & set(slugs(out, SW))
    assert slugs(out, MEMO)                                # no canonical topic in the phrase: the round's own topics


def test_seen_excluded_company_first_and_difficulty_ceiling(monkeypatch):
    out = run([LIS], monkeypatch, exclusions=["climb"])
    got = slugs(out, LIS)
    assert "climb" not in got and "hard-dp" not in got
    assert got[0] == "coin" or got[0] == "lis"            # same-company coin leads among equal overlap, lis shares 1 canonical topic too
    one = run(["Dynamic Programming"], monkeypatch)
    assert slugs(one, "Dynamic Programming")[0] == "coin"


def test_same_slug_not_repeated_across_topics_when_alternatives_exist(monkeypatch):
    out = run(["Binary search basics", "Binary search on the answer"], monkeypatch, per_topic=1)
    a, b = slugs(out, "Binary search basics"), slugs(out, "Binary search on the answer")
    assert a and b and a != b


def test_unrecognised_phrase_uses_fallback_then_keywords(monkeypatch):
    out = run(["Choosing good invariants"], monkeypatch, fallback_topics={"graphs"})
    assert slugs(out, "Choosing good invariants") == ["graph"]
    none = run(["Choosing good invariants"], monkeypatch)
    assert none["Choosing good invariants"] == []


def test_ties_prefer_problems_close_to_the_gaps_source_problem(monkeypatch):
    POOL.extend([doc("russian", ["Binary Search", "Dynamic Programming"]), doc("divide", ["Binary Search", "Math"], "easy")])
    try:
        out = run([BS], monkeypatch, sources={BS: Source(topics={"dynamic-programming", "binary-search"}, mapped=True)}, per_topic=3)
        got = slugs(out, BS)
        assert set(got[:2]) == {"lis", "russian"}                      # both topics beat binary search alone
        assert "divide" not in got[:2] and "bs1" not in got[:2]
    finally:
        del POOL[-2:]


def test_one_harder_relevant_problem_beats_the_ceiling_when_nothing_easier_shares_the_source(monkeypatch):
    POOL.extend([doc("hard-both", ["Binary Search", "Dynamic Programming"], "hard")])
    pool_backup = list(POOL)
    try:
        POOL[:] = [d for d in POOL if d["slug"] not in ("lis",)]
        out = run([BS], monkeypatch, sources={BS: Source(topics={"dynamic-programming", "binary-search"}, mapped=True)}, per_topic=3)
        got = out[BS]
        assert got[0]["slug"] == "hard-both" and got[0]["difficulty"] == "hard"
        assert [p["slug"] for p in got[1:]] and all(p["difficulty"] != "hard" for p in got[1:])
        easy = run([BS], monkeypatch, per_topic=3)
        assert all(p["difficulty"] != "hard" for p in easy[BS])         # no source: the ceiling holds
    finally:
        POOL[:] = pool_backup[:-1]


def test_each_topic_keeps_its_best_pick_before_second_picks(monkeypatch):
    out = run([LIS, BS], monkeypatch, per_topic=2, sources={LIS: Source(topics={"dynamic-programming"}, mapped=True), BS: Source(topics={"binary-search"}, mapped=True)})
    assert slugs(out, BS)[0] in {"lis", "bs1", "bs2"} and slugs(out, LIS)[0] != slugs(out, BS)[0]
    assert len(slugs(out, BS)) == 2 and len(slugs(out, LIS)) == 2


def test_a_stage_with_nothing_usable_falls_through_to_the_next(monkeypatch):
    POOL.append(doc("only-hard-trie", ["Trie"], "hard"))
    try:
        # "Trie prefix lookup" matches only a hard problem (above the ceiling, no source): fall back to the round's topics
        out = run(["Trie prefix lookup"], monkeypatch, fallback_topics={"two-pointers"})
        assert out["Trie prefix lookup"] and all(p["difficulty"] != "hard" for p in out["Trie prefix lookup"])
        assert {p["slug"] for p in out["Trie prefix lookup"]} <= {"win", "win2"}
    finally:
        POOL.pop()


def test_harder_exception_needs_a_per_phrase_source_not_the_round_fallback(monkeypatch):
    POOL.append(doc("hard-both", ["Binary Search", "Dynamic Programming"], "hard"))
    try:
        saved = list(POOL)
        POOL[:] = [d for d in saved if d["slug"] != "lis"]
        got = run([BS], monkeypatch, fallback_topics={"dynamic-programming", "binary-search"})[BS]
        assert all(p["difficulty"] != "hard" for p in got)           # round-wide fallback alone never lifts the ceiling
        got = run([BS], monkeypatch, sources={BS: Source(topics={"dynamic-programming", "binary-search"}, mapped=True)})[BS]
        assert got[0]["slug"] == "hard-both"
    finally:
        POOL[:] = [d for d in saved if d["slug"] != "hard-both"]
        POOL.insert(0, LIS_DOC)


def test_unknown_round_difficulty_uses_the_source_then_default_then_medium_and_prefers_same_level_then_easier(monkeypatch):
    POOL.extend([doc("dp-hard", ["Dynamic Programming"], "hard"), doc("dp-easy", ["Dynamic Programming"], "easy")])
    try:
        got = slugs(run(["Dynamic Programming"], monkeypatch, max_difficulty=None, per_topic=5), "Dynamic Programming")
        assert "dp-hard" not in got and "hard-dp" not in got                      # unknown is medium, not hard
        assert got.index("coin") < got.index("dp-easy")                           # same level before one easier
        easy = slugs(run(["Dynamic Programming"], monkeypatch, max_difficulty=None, per_topic=5,
                         sources={"Dynamic Programming": Source(difficulty="easy")}), "Dynamic Programming")
        assert set(easy) == {"climb", "dp-easy"}                                  # the source's level is the ceiling
        hard = slugs(run(["Dynamic Programming"], monkeypatch, max_difficulty=None, per_topic=5, default_difficulty="hard"), "Dynamic Programming")
        assert "dp-hard" in hard or "hard-dp" in hard
    finally:
        del POOL[-2:]


def test_specific_topics_outrank_common_ones(monkeypatch):
    commons = [doc(f"arr{i}", ["Array", "Dynamic Programming"]) for i in range(12)]
    POOL.extend(commons + [doc("sw-only", ["Sliding Window"])])
    try:
        got = slugs(run(["Array handling and sliding window"], monkeypatch, per_topic=3), "Array handling and sliding window")
        assert got[0] in {"sw-only", "win", "win2"}                                # two-pointers (specific) beats arrays (common)
        assert not any(g.startswith("arr") for g in got[:1])
        # focused problems win ties
        a = slugs(run(["Binary search"], monkeypatch, per_topic=5), "Binary search")
        assert a.index("bs1") < a.index("lis")
    finally:
        del POOL[-13:]
