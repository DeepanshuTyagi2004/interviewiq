"""Problem selection (spec §7): context, topics, scoring, composition, seeded draw, relaxation."""
import pytest

from app.blueprint import selection as S
from app.blueprint import topics as T
from app.blueprint.context import build_context
from app.blueprint.trace import StageError
from tests.blueprint.fixtures import behavioural_doc, dsa_doc, request

W = S.DEFAULT_WEIGHTS


def test_topics_normalize_aliases_and_whole_words():
    assert T.canon(["DP", "Depth-first Search"]) == {"dynamic-programming", "graphs"}
    assert T.topics_in("Payments platform on Kafka") == {"payments", "queues"}
    assert "trees" not in T.topics_in("streets and roads")  # whole-word only
    assert T.topics_in("Design a search engine with typeahead") == {"search-engine", "design-ds"}
    assert T.overlap({"arrays"}, {"arrays", "graphs", "dynamic-programming"}) == 1.0
    assert T.overlap(set(), {"arrays"}) == 0.0


def test_context_difficulty_window_and_targets():
    ctx = build_context(request())
    assert ctx.difficulty_target == "medium" and ctx.difficulty_window == (0, 2)
    assert {"arrays", "graphs", "dynamic-programming"} <= ctx.target_topics
    assert "payments" not in ctx.target_topics  # design topics never steer a DSA round
    fresher = build_context(request(session={"level": "fresher"}, round={"type": "dsa", "difficulty": None}))
    assert fresher.difficulty_target == "medium" and fresher.difficulty_window == (0, 1)
    with pytest.raises(StageError) as err:
        build_context(request(round=None))
    assert err.value.code == "round_not_found"


def test_score_breakdown_names_every_signal():
    ctx = build_context(request())
    named = S.score_candidate(dsa_doc("two-sum", tags=("Array", "Hash Table"), title="1. Two Sum"), ctx, W)
    assert named.breakdown["named"] == 40 and named.breakdown["company"] == 25 and named.breakdown["difficulty"] == 10
    # Two Sum's topics {arrays, hashing} share "arrays" with the round: overlap 1 of 2 → half the weight.
    assert named.breakdown["topic"] == 12.5 and named.breakdown["level"] == 5
    inferred = S.score_candidate(dsa_doc("x", companies=("amazon",), evidence={"amazon": "inferred"}), ctx, W)
    assert inferred.breakdown["company"] == 10
    other = S.score_candidate(dsa_doc("y", companies=("google",), difficulty="hard"), ctx, W)
    assert "company" not in other.breakdown and other.breakdown["difficulty"] == 4


def _pool():
    return [dsa_doc("arr-a", tags=("Array",)), dsa_doc("arr-b", tags=("Array",)),
            dsa_doc("graph-a", tags=("Graph",)), dsa_doc("dp-a", tags=("Dynamic Programming",)),
            dsa_doc("hard-graph", tags=("Graph",), difficulty="hard"), dsa_doc("hard-dp", tags=("Dynamic Programming",), difficulty="hard"),
            dsa_doc("easy-arr", tags=("Array",), difficulty="easy")]


def test_dsa_composition_rules():
    ctx = build_context(request())
    plans, summary = S.select(ctx, _pool(), W, "seed")
    picks = {p.slot_id: p.pick for p in plans}
    assert [p.slot_id for p in plans] == ["core-1", "core-2", "reserve-harder", "reserve-alternate"]
    assert picks["core-1"].primary != picks["core-2"].primary
    assert picks["core-1"].rank <= picks["core-2"].rank
    top = max(picks["core-1"].rank, picks["core-2"].rank)
    harder = next(p for p in plans if p.slot_id == "reserve-harder")
    assert picks["reserve-harder"].rank > top or (top == 2 and "diversity" in harder.relaxations)
    assert len({p.slug for p in picks.values()}) == 4
    assert summary["pool"] == 7


def test_draw_is_reproducible_per_seed_and_varies_across_seeds():
    ctx = build_context(request())
    first = [p.pick.slug for p in S.select(ctx, _pool(), W, "session-1")[0]]
    again = [p.pick.slug for p in S.select(ctx, _pool(), W, "session-1")[0]]
    assert first == again
    seen = {tuple(p.pick.slug for p in S.select(ctx, _pool(), W, f"s{i}")[0]) for i in range(20)}
    assert len(seen) > 1


def test_exclusions_and_trace_reasons():
    req = request(exclusions=["arr-a", "graph-a"])
    ctx = build_context(req)
    plans, summary = S.select(ctx, _pool(), W, "seed")
    assert summary["excluded_seen"] == 2
    assert all(p.pick.slug not in {"arr-a", "graph-a"} for p in plans)
    rows = plans[0].considered
    assert any(r["outcome"] == "excluded_seen" for r in rows) and any(r["outcome"] == "picked" for r in rows)


def test_relaxation_then_not_enough_problems():
    ctx = build_context(request())
    same_pattern = [dsa_doc(f"arr-{i}", tags=("Array",)) for i in range(2)] + [dsa_doc("arr-hard", tags=("Array",), difficulty="hard")]
    plans, _ = S.select(ctx, same_pattern + [dsa_doc("arr-3", tags=("Array",))], W, "seed")
    assert "diversity" in next(p for p in plans if p.slot_id == "core-2").relaxations
    with pytest.raises(StageError) as err:
        S.select(ctx, [dsa_doc("only-one")], W, "seed")
    assert err.value.code == "not_enough_problems"


def test_behavioural_categories_are_distinct_and_company_principles_count():
    ctx = build_context(request("behavioural", round={"type": "behavioural", "topics": [], "difficulty": None}))
    pool = [behavioural_doc(f"{cat}-{i}", cat) for cat in ("self-introduction", "conflict-teamwork", "failure-learning",
                                                            "leadership-ownership", "general-behavioural") for i in range(2)]
    pool.append(behavioural_doc("lp-1", "amazon-lp", companies=("amazon",)))
    plans, _ = S.select(ctx, pool, W, "seed")
    cores = [p.pick.category for p in plans if p.kind == "core"]
    non_principle = [c for c in cores if c != "amazon-lp"]
    assert len(non_principle) == len(set(non_principle))
    assert len(plans) == 6                      # 45 minutes: three deeper questions (motivation is the intro's job)
    long = build_context(request("behavioural", round={"type": "behavioural", "topics": [], "difficulty": None, "duration_mins": 60}))
    assert len(S.select(long, pool, W, "seed")[0]) == 7


def test_weights_override_from_settings():
    assert S.weights('{"named": 99}')["named"] == 99
    assert S.weights("not json")["named"] == 40
