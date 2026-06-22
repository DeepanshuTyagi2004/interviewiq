"""Run: python -m tests.test_pipeline_helpers"""
from app.targets import Combination
from app.models.brief import FinalExperience, RawExperience, DataConfidence, GenerationStatus, Provenance, utcnow
from app.jobs.brief_generation import (
    build_search_queries, derive_status, count_provenance, count_onlevel_rounds,
    partition_by_level, annotate_rounds, drop_denied, dedup_clusters,
)


def _fe(rounds):
    return FinalExperience.model_validate({"rounds": rounds})


def _raw(url, level):
    return RawExperience.model_validate(
        {"url": url, "detected_level": level, "rounds": [{"round_number": 1, "type": "dsa"}]})


def _guide(url, level, problems=None):
    """A non-first-hand process source (guide/official page/aggregated post)."""
    return RawExperience.model_validate(
        {"url": url, "detected_level": level, "is_first_hand": False,
         "rounds": [{"round_number": 1, "type": "dsa", "problems": problems or []}]})


def _raw_p(url, level, problems, geo="unknown", date=None):
    """A raw experience with explicit problems (for dedup), geo and date (for recency)."""
    return RawExperience.model_validate({
        "url": url, "detected_level": level, "geo": geo, "date": date,
        "rounds": [{"round_number": 1, "type": "dsa", "problems": problems}]})


def test_queries_are_india_weighted_and_carry_level():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "backend"))
    assert all("India" in q for q in qs)
    assert all("backend" in q and "sde2" in q for q in qs)   # the query carries spec+level
    assert len(qs) == 1                                       # single query (variants pruned)


def test_queries_skip_general_spec():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "general"))
    assert all("general" not in q for q in qs)


def test_partition_splits_on_unconfirmed_off():
    raw = [_raw("u_exact", "fresher"), _raw("u_adj", "intern"),
           _raw("u_unknown", None), _raw("u_off", "sde2")]
    on, unconf, off = partition_by_level(raw, "fresher")
    assert {e.url for e in on} == {"u_exact", "u_adj"}
    assert {e.url for e in unconf} == {"u_unknown"}
    assert {e.url for e in off} == {"u_off"}        # mid under a fresher JD -> excluded


def test_annotate_sets_provenance_support_and_template_flag():
    raw = [_raw("u1", "fresher"), _raw("u2", "sde1"), _raw("u3", None)]
    fe = _fe([
        {"round_number": 1, "type": "dsa", "provenance": "evidence_backed", "evidence_urls": ["u1", "u2"]},
        {"round_number": 2, "type": "lld", "provenance": "evidence_backed", "evidence_urls": ["u3"]},  # only unconfirmed
        {"round_number": 3, "type": "system-design", "provenance": "template", "evidence_urls": []},
    ])
    annotate_rounds(fe, raw, "fresher")
    r1, r2, r3 = fe.rounds
    assert r1.provenance == Provenance.EVIDENCE_BACKED and r1.support_count == 2
    assert sorted(r1.source_sublevels) == ["fresher", "sde1"]
    assert r2.provenance == Provenance.INFERRED_FROM_SIMILAR and r2.support_count == 0  # null is not evidence
    assert r2.evidence_urls == ["u3"]                          # unconfirmed url kept, not stripped
    assert r3.provenance == Provenance.TEMPLATE
    assert fe.template_used is True
    assert all(r.source_count_total == 2 for r in fe.rounds)   # 2 on-level sources (u1, u2)


def test_annotate_strips_offlevel_urls_and_demotes():
    raw = [_raw("u_off", "sde2")]
    fe = _fe([{"round_number": 1, "type": "dsa", "provenance": "evidence_backed", "evidence_urls": ["u_off"]}])
    annotate_rounds(fe, raw, "fresher")
    assert fe.rounds[0].evidence_urls == []                    # off-level url removed
    assert fe.rounds[0].provenance == Provenance.INFERRED_FROM_SIMILAR


def test_high_only_with_exact_level_evidence():
    raw = [_raw("u1", "fresher")]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u1"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    status, conf = derive_status(fe, raw, "fresher")
    assert status == GenerationStatus.SUCCESS and conf == DataConfidence.HIGH
    assert count_onlevel_rounds(fe, raw, "fresher") == 4


def test_null_only_evidence_now_insufficient():
    # Was HIGH under the old null=match rule; now null is not level-proof -> insufficient_data.
    raw = [_raw("u3", None)]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u3"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    status, conf = derive_status(fe, raw, "fresher")
    assert status == GenerationStatus.INSUFFICIENT_DATA and conf == DataConfidence.LOW


def test_offlevel_only_evidence_insufficient():
    raw = [_raw("u2", "sde2")]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u2"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    status, conf = derive_status(fe, raw, "fresher")
    assert status == GenerationStatus.INSUFFICIENT_DATA and conf == DataConfidence.LOW
    assert count_provenance(fe) == (0, 4)        # all demoted off evidence_backed


def test_adjacent_only_is_medium():
    # intern (adjacent) backing every round -> on-level but not exact -> MEDIUM, not HIGH.
    raw = [_raw("ui", "intern")]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["ui"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    status, conf = derive_status(fe, raw, "fresher")
    assert status == GenerationStatus.SUCCESS and conf == DataConfidence.MEDIUM


def test_empty_rounds_is_insufficient():
    status, conf = derive_status(_fe([]), [], "fresher")
    assert status == GenerationStatus.INSUFFICIENT_DATA and conf == DataConfidence.LOW


# --- process sources (guides/official/posts feed STRUCTURE, never specifics) ---

def test_onlevel_guide_is_process_guide_structure_only():
    # An on-level guide describes the round but isn't first-hand -> process_guide, problems stripped.
    raw = [_guide("g1", "fresher")]
    fe = _fe([{"round_number": 1, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["g1"], "problems": ["two sum"]}])
    annotate_rounds(fe, raw, "fresher")
    r = fe.rounds[0]
    assert r.provenance == Provenance.PROCESS_GUIDE
    assert r.support_count == 1
    assert r.evidence_urls == ["g1"]      # url kept as the process attestation
    assert r.problems == []               # FIREWALL: named problems are first-hand only


def test_first_hand_wins_over_guide_and_keeps_specifics():
    raw = [_raw("fh", "fresher"), _guide("g1", "fresher")]
    fe = _fe([{"round_number": 1, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["fh", "g1"], "problems": ["two sum"]}])
    annotate_rounds(fe, raw, "fresher")
    r = fe.rounds[0]
    assert r.provenance == Provenance.EVIDENCE_BACKED
    assert r.support_count == 1           # only the first-hand source counts toward evidence
    assert r.problems == ["two sum"]      # first-hand backing -> specifics survive


def test_unknown_level_guide_is_inferred_not_process():
    # A guide that never states a single level can't claim on-level -> inferred, not process_guide.
    raw = [_guide("g_unknown", None)]
    fe = _fe([{"round_number": 1, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["g_unknown"]}])
    annotate_rounds(fe, raw, "fresher")
    assert fe.rounds[0].provenance == Provenance.INFERRED_FROM_SIMILAR


def test_process_guide_coverage_yields_medium():
    # No first-hand grounding, but on-level guides attest the whole loop -> MEDIUM (process known).
    raw = [_guide("g1", "fresher")]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["g1"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    status, conf = derive_status(fe, raw, "fresher")
    assert all(r.provenance == Provenance.PROCESS_GUIDE for r in fe.rounds)
    assert status == GenerationStatus.SUCCESS and conf == DataConfidence.MEDIUM


# --- deny-list (collect stage) ---

def test_drop_denied_filters_known_farms():
    srcs = [
        {"url": "https://www.prepfully.com/interview-questions/razorpay"},
        {"url": "https://blog.huntingcube.ai/top-50"},          # subdomain of a denied apex
        {"url": "https://interview.sughara.in/x"},
        {"url": "https://www.geeksforgeeks.org/razorpay-experience"},   # kept
        {"url": "https://leetcode.com/discuss/1"},                       # kept
    ]
    kept = drop_denied(srcs, ["prepfully.com", "huntingcube.ai", "sughara.in"])
    assert [s["url"] for s in kept] == [
        "https://www.geeksforgeeks.org/razorpay-experience", "https://leetcode.com/discuss/1"]
    assert drop_denied(srcs, []) == srcs   # empty deny-list = no filtering


# --- query shaping (#3) ---

def test_entry_level_query_adds_campus_terms():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "fresher", "backend"))
    assert all("India" in q for q in qs)
    assert any("campus" in q for q in qs)        # fresher posts cluster under campus phrasing
    assert all("questions asked" not in q for q in qs)   # the question-bank-bait variant is gone


def test_senior_query_has_no_campus_terms():
    qs = build_search_queries(Combination("razorpay", "software-engineer", "sde2", "backend"))
    assert all("campus" not in q for q in qs)


# --- geo gate (#2) ---

def test_partition_excludes_off_geo():
    raw = [_raw_p("u_in", "fresher", ["x"], geo="india"),
           _raw_p("u_unk", "fresher", ["x"], geo="unknown"),
           _raw_p("u_foreign", "fresher", ["x"], geo="non-india")]
    on, _unconf, off = partition_by_level(raw, "fresher")
    assert {e.url for e in on} == {"u_in", "u_unk"}   # india + unknown-geo stay
    assert "u_foreign" in {e.url for e in off}         # non-india dropped before the LLM


def test_annotate_strips_off_geo_urls():
    raw = [_raw_p("u_foreign", "fresher", ["x"], geo="non-india")]
    fe = _fe([{"round_number": 1, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u_foreign"]}])
    annotate_rounds(fe, raw, "fresher")
    assert fe.rounds[0].evidence_urls == []                  # off-geo stripped though level matches
    assert fe.rounds[0].provenance == Provenance.INFERRED_FROM_SIMILAR


# --- independence / dedup (#4) ---

def test_dedup_clusters_collapses_echoes():
    raw = [_raw_p("u1", "fresher", ["two sum", "lru cache"]),
           _raw_p("u2", "fresher", ["two sum", "lru cache"]),   # same problem set = echo of u1
           _raw_p("u3", "fresher", ["dijkstra", "trie"])]
    groups = dedup_clusters(raw)
    assert groups["u1"] == groups["u2"]      # echoes share a group
    assert groups["u3"] != groups["u1"]      # distinct content = distinct group


def test_support_count_counts_independent_sources_only():
    raw = [_raw_p("u1", "fresher", ["two sum", "lru cache"]),
           _raw_p("u2", "fresher", ["two sum", "lru cache"]),   # echo
           _raw_p("u3", "fresher", ["dijkstra", "trie"])]
    fe = _fe([{"round_number": 1, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u1", "u2", "u3"]}])
    annotate_rounds(fe, raw, "fresher")
    assert fe.rounds[0].support_count == 2          # u1+u2 corroborate ONCE, +u3 = 2 (not 3)
    assert fe.rounds[0].source_count_total == 2     # "of N" is also independent


# --- recency (#5) ---

def test_stale_exact_evidence_demotes_high_to_medium():
    old = str(utcnow().year - 10)
    raw = [_raw_p("u_old", "fresher", ["a"], date=old)]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u_old"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    status, conf = derive_status(fe, raw, "fresher")
    assert status == GenerationStatus.SUCCESS and conf == DataConfidence.MEDIUM   # would be HIGH if fresh


def test_recent_exact_evidence_stays_high():
    recent = str(utcnow().year)
    raw = [_raw_p("u_new", "fresher", ["a"], date=recent)]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u_new"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    status, conf = derive_status(fe, raw, "fresher")
    assert conf == DataConfidence.HIGH


def test_no_dates_does_not_demote():
    # Search already bounds recency to ~1 year; absence of a stated date must NOT punish a brief.
    raw = [_raw_p("u_nodate", "fresher", ["a"], date=None)]
    fe = _fe([{"round_number": i, "type": "dsa", "provenance": "evidence_backed",
               "evidence_urls": ["u_nodate"]} for i in range(1, 5)])
    annotate_rounds(fe, raw, "fresher")
    _status, conf = derive_status(fe, raw, "fresher")
    assert conf == DataConfidence.HIGH


if __name__ == "__main__":
    test_queries_are_india_weighted_and_carry_level()
    test_queries_skip_general_spec()
    test_partition_splits_on_unconfirmed_off()
    test_annotate_sets_provenance_support_and_template_flag()
    test_annotate_strips_offlevel_urls_and_demotes()
    test_high_only_with_exact_level_evidence()
    test_null_only_evidence_now_insufficient()
    test_offlevel_only_evidence_insufficient()
    test_adjacent_only_is_medium()
    test_empty_rounds_is_insufficient()
    test_onlevel_guide_is_process_guide_structure_only()
    test_first_hand_wins_over_guide_and_keeps_specifics()
    test_unknown_level_guide_is_inferred_not_process()
    test_process_guide_coverage_yields_medium()
    test_drop_denied_filters_known_farms()
    test_entry_level_query_adds_campus_terms()
    test_senior_query_has_no_campus_terms()
    test_partition_excludes_off_geo()
    test_annotate_strips_off_geo_urls()
    test_dedup_clusters_collapses_echoes()
    test_support_count_counts_independent_sources_only()
    test_stale_exact_evidence_demotes_high_to_medium()
    test_recent_exact_evidence_stays_high()
    test_no_dates_does_not_demote()
    print("ok")
