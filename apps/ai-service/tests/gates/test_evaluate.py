from app.gates.evaluate import (DEFAULT_THRESHOLDS, Item, SweepRow, positive_of, recommend,
                                report_markdown, sweep)


def _items(ps, pos):
    return [Item(id=str(i), p_yes=p, positive=q, state_excerpt="x", llm_latency_ms=1000,
                 jev_latency_ms=100, jev_cost_usd=0.001, llm_tokens=None)
            for i, (p, q) in enumerate(zip(ps, pos))]


def _row(t, skip, lost=0, agree=1.0, net=10.0, saved=1):
    return SweepRow(threshold=t, skip_rate=skip, lost_positives=lost, agreement=agree,
                    calls_saved=saved, net_latency_ms_per_item=net)


def test_sweep_counts():
    row = sweep(_items([0.01, 0.04, 0.5, 0.9], [False, False, True, True]), [0.05])[0]
    assert row.skip_rate == 0.5 and row.lost_positives == 0
    assert row.agreement == 1.0 and row.calls_saved == 2


def test_lost_positive_counted():
    row = sweep(_items([0.01, 0.04, 0.5, 0.9], [True, False, True, True]), [0.05])[0]
    assert row.lost_positives == 1


def test_unknown_p_never_skipped():
    row = sweep(_items([None, 0.01], [True, False]), [0.05])[0]
    assert row.calls_saved == 1 and row.skip_rate == 0.5
    assert row.lost_positives == 0 and row.agreement == 1.0


def test_recommend_requires_100_positives():
    assert recommend([_row(0.05, 0.3)], positives=50) is None
    assert recommend([_row(0.05, 0.3)], positives=100) is not None


def test_recommend_picks_highest_skip_passing():
    rows = [_row(0.05, 0.3), _row(0.1, 0.4, lost=1)]
    assert recommend(rows, positives=200).threshold == 0.05


def test_recommend_rejects_negative_net_latency():
    assert recommend([_row(0.05, 0.3, net=-5)], positives=200) is None


def test_positive_of_rules():
    # A research window is positive iff it produced a raw claim (a stray grounded label is ignored).
    assert positive_of("research_window", {"llm_label": {"grounded": False, "positive_raw": True}}) is True
    assert positive_of("research_window", {"llm_label": {"positive_raw": True}}) is True
    assert positive_of("research_window", {"llm_label": {"raw_claims": 0, "positive_raw": False}}) is False
    assert positive_of("brief_source", {"llm_label": {"status": "extracted", "describes_process": False}}) is True
    assert positive_of("brief_source", {"llm_label": {"status": "irrelevant", "describes_process": True}}) is False
    assert positive_of("brief_source", {"llm_label": {"describes_process": True}}) is True
    assert positive_of("key_review", {"llm_label": {"patched": True}}) is True
    assert positive_of("key_review", {"llm_label": {"patched": True}, "llm_error": "boom"}) is None
    assert positive_of("key_review", {}) is None


def test_report_names_failing_criterion():
    items = _items([0.01, 0.9], [False, True])
    rows = sweep(items, DEFAULT_THRESHOLDS)
    md = report_markdown("key_review", "typesafe/jev-1.14", items, rows, recommend(rows, positives=1))
    assert "insufficient data" in md


def test_history_parsers():
    import json as _json
    from app.gates.evaluate import model_family
    from app.gates.history import patched_of_reply, review_state_from_prompt
    user = ("Problem:\n" + _json.dumps({"title": "T"}, indent=1) + "\n\nAnswer key:\n"
            + _json.dumps({"approaches": [], "reference_solution": {"code": "x"}}, indent=1)
            + "\n\nFind every factual error: ...")
    state, _ = review_state_from_prompt(user)
    assert state["problem"] == {"title": "T"} and "<verified by sandbox>" in state["answer_key"]
    assert patched_of_reply('{"errors":[{"a":1}],"approaches":[1]}') is True
    assert patched_of_reply('{"errors":[],"approaches":null}') is False
    assert patched_of_reply("nope") is None
    assert model_family("typesafe/jev-1.14-20261014") == model_family("typesafe/jev-1.14")


def _log_doc(p, jev_error=None, model="typesafe/jev-1.14-20261014"):
    return {"stage": "key_review", "mode": "shadow", "created_at": None, "model": model,
            "state": {"problem": {}, "answer_key": "k"}, "state_hash": f"h{p}", "questions": ["has_error"],
            "answers": {}, "p_yes": p, "skipped": False, "jev_error": jev_error, "jev_cost_usd": 0.001,
            "jev_latency_ms": 120, "llm_label": {"patched": False}, "llm_error": None,
            "llm_latency_ms": 900, "context": {}}


def test_logged_p_yes_float_zero_kept_none_reasked():
    from app.gates.evaluate import logged_item, needs_reask
    m = "typesafe/jev-1.14"
    zero, high = _log_doc(0.0), _log_doc(0.7)
    none = _log_doc(None, jev_error="slower_than_llm")
    other = _log_doc(0.5, model="other/model-2")
    asked = [needs_reask(d, source="log", model=m) for d in (zero, high, none, other)]
    assert asked == [False, False, True, True]
    assert logged_item(zero, False, 0).p_yes == 0.0
    assert logged_item(high, False, 1).p_yes == 0.7
    assert needs_reask(zero, source="history", model=m) is True


def test_failed_key_review_is_unlabelled():
    assert positive_of("key_review", {"llm_label": {"review_ran": False, "errors": 0, "patched": False}}) is None
    assert positive_of("key_review", {"llm_label": {"review_ran": True, "patched": False}}) is False
    assert positive_of("key_review", {"llm_label": {"patched": False}}) is False   # old docs without review_ran


def test_bar_counts_only_scored_positives():
    from app.gates.evaluate import count_positives
    ps = [0.9] * 90 + [None] * 60 + [0.0] * 60
    pos = [True] * 150 + [False] * 60
    items = _items(ps, pos)
    assert count_positives(items) == (90, 60)
    rows = sweep(items, DEFAULT_THRESHOLDS)
    assert recommend(rows, positives=150) is not None   # counting the unscored would wrongly pass
    assert recommend(rows, positives=count_positives(items)[0]) is None
    md = report_markdown("key_review", "m", items, rows, None)
    assert "with a Jev score: 90" in md and "not counted toward the bar: 60" in md
    assert "insufficient data: 90 positives" in md


def test_dedupe_keeps_latest_labelled_doc():
    from datetime import datetime
    from app.gates.evaluate import dedupe_latest
    docs = [{"state_hash": "h", "created_at": datetime(2026, 10, 2), "n": 2},
            {"state_hash": "h", "created_at": datetime(2026, 10, 3), "n": 3},
            {"state_hash": "other", "created_at": datetime(2026, 10, 1), "n": 9},
            {"state_hash": "h", "created_at": datetime(2026, 10, 1), "n": 1}]
    kept, dropped = dedupe_latest(docs)
    assert [d["n"] for d in kept] == [3, 9] and dropped == 2


def test_dedupe_hashes_history_states():
    from app.gates.core import state_hash
    from app.gates.evaluate import dedupe_latest, doc_state_hash
    a, b = {"state": {"text": "x", "company": "c"}}, {"state": {"company": "c", "text": "x"}}
    assert doc_state_hash(a) == doc_state_hash(b) == state_hash(a["state"])
    kept, dropped = dedupe_latest([a, b, {"state": {"text": "y"}}])
    assert kept[0] is a and len(kept) == 2 and dropped == 1   # no created_at: the first (newest) wins


def test_excerpt_per_stage():
    from app.gates.evaluate import excerpt_of, item_from_doc
    research = {"company": "C", "fields": "docs", "title": "T", "text": "line one\n\n  line two\t" + "z" * 900}
    assert excerpt_of("research_window", research).startswith("line one line two z")
    assert len(excerpt_of("research_window", research)) == 600
    assert excerpt_of("brief_source", {"target": "x", "title": "t", "text": "a\nb"}) == "a b"
    assert excerpt_of("key_review", {"problem": {"title": "T"}, "answer_key": '{"k":\n 1}'}) == '{"k": 1}'
    doc = {"state": {"problem": {}, "answer_key": "KEY"}, "state_hash": "h1", "context": {"slug": "two-sum"}}
    item = item_from_doc(doc, True, 0, p_yes=0.2, jev_latency_ms=1, jev_cost_usd=0.0, stage="key_review")
    assert item.state_excerpt == "KEY" and item.id == "two-sum" and item.state_hash == "h1"


def test_report_sections_in_order():
    from app.gates.evaluate import review_sections, sweep_to_json
    ps = [0.01, 0.02] + [0.06 + i * 0.01 for i in range(25)] + [0.9, 0.5, 0.3]
    pos = [True, True] + [True] * 25 + [False, False, False]
    items = _items(ps, pos)
    lost, near, disagree = review_sections(items, 0.05)
    assert [i.p_yes for i in lost] == [0.01, 0.02]
    assert len(near) == 20 and near[0].p_yes == 0.06 and all(i.p_yes >= 0.05 for i in near)
    assert [i.p_yes for i in disagree] == [0.9, 0.5, 0.3]
    rows = sweep(items, [0.05])
    md = report_markdown("key_review", "m", items, rows, None)
    a, b, c = md.index("## 1. Lost positives"), md.index("## 2. Near misses"), md.index("## 3. Disagreements")
    assert a < b < c
    assert md.count("positive=True") == 22 and md.count("positive=False") == 3
    data = sweep_to_json("key_review", "m", len(items), 27, rows, None, items=items)
    assert set(data["items"][0]) == {"id", "p_yes", "positive", "state_hash", "excerpt"}
    assert len(data["items"]) == len(items)


def test_disagreements_capped_at_50_lost_uncapped():
    from app.gates.evaluate import review_sections
    items = _items([0.01] * 70 + [0.9] * 80, [True] * 70 + [False] * 80)
    lost, _, disagree = review_sections(items, 0.05)
    assert len(lost) == 70 and len(disagree) == 50


def test_net_latency_uses_skipped_items_llm_latency():
    items = [Item(id=str(i), p_yes=p, positive=p > 0.5, state_excerpt="x", llm_latency_ms=lat,
                  jev_latency_ms=100, jev_cost_usd=0.0, llm_tokens=None)
             for i, (p, lat) in enumerate([(0.01, 200), (0.01, 200), (0.9, 9800), (0.9, 9800)])]
    row = sweep(items, [0.05])[0]
    assert row.net_latency_ms_per_item == (2 * 200 - 4 * 100) / 4   # not the overall mean of 5000
    no_lat = [Item(id="a", p_yes=0.01, positive=False, state_excerpt="", llm_latency_ms=None,
                   jev_latency_ms=100, jev_cost_usd=0.0, llm_tokens=None),
              Item(id="b", p_yes=0.9, positive=True, state_excerpt="", llm_latency_ms=1000,
                   jev_latency_ms=100, jev_cost_usd=0.0, llm_tokens=None)]
    assert sweep(no_lat, [0.05])[0].net_latency_ms_per_item == (1 * 1000 - 2 * 100) / 2   # falls back to the mean


def test_clipped_key_prompt_is_excluded():
    import json as _json
    from app.gates.history import key_clipped, review_state_from_prompt
    full = _json.dumps({"approaches": ["a"], "reference_solution": {"code": "def solve(): ..." * 50}}, indent=1)
    user = "Problem:\n" + _json.dumps({"title": "T"}) + "\n\nAnswer key:\n" + full[:120] + "\n\nFind every factual error: ..."
    assert review_state_from_prompt(user) is None and key_clipped(user) is True
    assert key_clipped("not a review prompt") is False
