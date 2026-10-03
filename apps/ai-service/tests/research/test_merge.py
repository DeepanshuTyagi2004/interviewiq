"""Weighted merge, conflicts, recency, lists and pay observations (evidence-hardening spec §8.3, §9)."""
from datetime import UTC, datetime

from app.research.normalize.merge import (
    choose,
    choose_list,
    ctc_observations,
    ctc_range,
    extractive_text,
    item_key,
    observations_field,
    reported_passages,
)

NOW = datetime(2026, 10, 3, tzinfo=UTC)


def c(name, value, url, *, tier=3, date=None, source_type="other", **kw):
    return {"field": name, "value": value, "url": url, "tier": tier, "date": date, "source_type": source_type,
            "quote": kw.pop("quote", str(value)), "source_name": kw.pop("source_name", url), "unit": kw.pop("unit", None),
            **kw}


def test_one_official_source_outweighs_two_community_domains_and_the_loser_is_kept():
    out = choose([c("sector", "saas", "https://a.example/1"), c("sector", "saas", "https://b.example/1", date="2026-01-01"),
                  c("sector", "fintech", "https://juspay.io/about", tier=1)], "sector", now=NOW)
    assert out["value"] == "fintech" and out["confidence"] == "low"
    assert out["alternatives"] == [{"value": "saas", "source_urls": ["https://a.example/1", "https://b.example/1"],
                                    "as_of": "2026-01-01"}]
    assert "disagree" in out["note"]


def test_one_vote_per_domain():
    out = choose([c("hq", "Pune", "https://a.example/1"), c("hq", "Pune", "https://a.example/2"),
                  c("hq", "Mumbai", "https://news.example/x", tier=2)], "hq", now=NOW)
    assert out["value"] == "Mumbai"


def test_tie_is_low_confidence_and_order_independent():
    claims = [c("revenue_band", "₹514 Cr", "https://a.example/x"), c("revenue_band", "₹500 Cr", "https://b.example/x")]
    first, second = choose(claims, "revenue_band", now=NOW), choose(list(reversed(claims)), "revenue_band", now=NOW)
    assert first == second and first["confidence"] == "low" and len(first["alternatives"]) == 1


def test_stale_evidence_counts_half():
    out = choose([c("funding_round", "Series C", "https://news.example/a", tier=2, date="2020-05-01"),
                  c("funding_round", "Series D", "https://a.example/b", date="2026-02-01"),
                  c("funding_round", "Series D", "https://b.example/b", date="2026-03-01")], "funding_round", now=NOW)
    assert out["value"] == "Series D" and out["as_of"] == "2026-03-01"


def test_high_confidence_needs_three_agreeing_domains_with_recent_evidence():
    dated = [c("sector", "fintech", f"https://{d}.example/x", date="2026-01-01") for d in "abc"]
    assert choose(dated, "sector", now=NOW)["confidence"] == "high"
    undated = [c("sector", "fintech", f"https://{d}.example/x") for d in "abc"]
    assert choose(undated, "sector", now=NOW)["confidence"] == "medium"
    assert choose(dated[:1], "sector", now=NOW)["confidence"] == "low"
    official = [c("sector", "fintech", "https://juspay.io/x", tier=1)]
    assert choose(official, "sector", now=NOW)["confidence"] == "medium"


def test_outdated_time_sensitive_evidence_is_low_with_a_note():
    claims = [c("headcount_band", "1,000", f"https://{d}.example/x", date="2021-06-01") for d in "abc"]
    out = choose(claims, "headcount_band", now=NOW)
    assert out["confidence"] == "low" and "Newest evidence from 2021" in out["note"]
    assert choose([c("hq", "Pune", f"https://{d}.example/x", date="2021-06-01") for d in "abc"], "hq",
                  now=NOW)["confidence"] != "low"     # HQ is not time-sensitive


def test_hq_city_spellings_agree():
    out = choose([c("hq", "Bangalore, India", "https://a.example/x", tier=2),
                  c("hq", "Bengaluru, Karnataka", "https://b.example/x", tier=2)], "hq", now=NOW)
    assert out["alternatives"] == [] and out["confidence"] == "medium"


def test_mapped_stage_is_derived_with_its_round():
    out = choose([c("funding_stage", "late-stage", "https://inc42.com/x", tier=2, derived_from="Series D")],
                 "funding_stage", now=NOW)
    assert out["provenance"] == "derived" and 'mapped from "Series D"' in out["note"]


def test_no_claims_is_unavailable():
    assert choose([], "sector", now=NOW)["provenance"] == "unavailable"


def test_item_keys_merge_spellings():
    assert item_key("ReactJS") == item_key("react.js") == item_key("React") == "react"
    assert item_key("Golang") == "go" and item_key("K8s") == "kubernetes" and item_key("Postgres") == "postgresql"


def test_list_is_ordered_by_support_capped_and_deduplicated():
    claims = [c("required_skill", "Haskell", "https://juspay.io/x", tier=1),
              c("required_skill", "ReactJS", "https://a.example/x"), c("required_skill", "React", "https://b.example/x")]
    claims += [c("required_skill", f"Skill{i}", "https://c.example/x") for i in range(20)]
    out = choose_list(claims, "required_skill", now=NOW)
    assert out["value"][:2] == ["Haskell", "ReactJS"] and len(out["value"]) == 15
    assert out["confidence"] == "medium" and out["alternatives"] == []


def test_list_confidence_is_low_for_a_single_community_domain():
    assert choose_list([c("tech_stack", "Haskell", "https://a.example/x")], "tech_stack", now=NOW)["confidence"] == "low"


def _pay(name, value, url, quote, *, basis="total_ctc", **kw):
    return c(name, value, url, quote=quote, unit="INR_LPA", basis=basis, **kw)


def test_pay_observations_from_pairs_single_figures_and_open_ended_minimums():
    claims = [_pay("ctc_min_lpa", 20, "https://a.example/x", "20 to 30 LPA CTC"),
              _pay("ctc_max_lpa", 30, "https://a.example/x", "20 to 30 LPA CTC"),
              _pay("ctc_min_lpa", 27, "https://b.example/x", "27 LPA", basis="lpa_unspecified"),
              _pay("ctc_max_lpa", 27, "https://b.example/x", "27 LPA", basis="lpa_unspecified"),
              _pay("ctc_min_lpa", 16, "https://c.example/x", "₹16+ LPA", basis="lpa_unspecified", open_ended=True)]
    obs = ctc_observations(claims)
    assert [(o["min_lpa"], o["max_lpa"], o["basis"]) for o in obs] == [
        (20, 30, "total_ctc"), (27, 27, "lpa_unspecified"), (16, None, "lpa_unspecified")]
    assert obs[0]["source_url"] == "https://a.example/x"


def test_reversed_ranges_are_not_observations():
    claims = [_pay("ctc_min_lpa", 30, "https://a.example/x", "30 to 20"), _pay("ctc_max_lpa", 20, "https://a.example/x", "30 to 20")]
    assert ctc_observations(claims) == []
    low, high, count = ctc_range(claims)
    assert low["value"] is high["value"] is None and count == 0


def test_range_is_the_median_after_dropping_outliers():
    claims = []
    for i, (lo, hi) in enumerate([(11, 14), (12, 15), (12, 16), (13, 17), (45, 60)]):
        url = f"https://s{i}.example/x"
        claims += [_pay("ctc_min_lpa", lo, url, f"{lo}-{hi} LPA CTC"), _pay("ctc_max_lpa", hi, url, f"{lo}-{hi} LPA CTC")]
    low, high, count = ctc_range(claims)
    assert (low["value"], high["value"], count) == (12, 15.5, 4)
    assert low["note"].startswith("Median of source-reported total CTC")
    assert low["provenance"] == high["provenance"] == "derived"
    assert "https://s4.example/x" not in low["source_urls"]
    assert len(ctc_observations(claims)) == 5  # raw observations retain even the outlier


def test_mixed_pay_uses_only_explicit_total_ctc_in_values_counts_and_sources():
    claims = []
    for d in "abc":
        url = f"https://{d}.example/x"
        basis = "lpa_unspecified" if d == "a" else "total_ctc"
        lo, hi = (200, 240) if d == "a" else (20, 24)
        claims += [_pay("ctc_min_lpa", lo, url, f"{lo}-{hi} LPA", basis=basis, date="2026-01-01"),
                   _pay("ctc_max_lpa", hi, url, f"{lo}-{hi} LPA", basis=basis, date="2026-01-01")]
    low, high, count = ctc_range(claims, now=NOW)
    assert (low["value"], high["value"], count) == (20, 24, 2)
    assert low["confidence"] == high["confidence"] == "medium"
    assert low["source_urls"] == high["source_urls"] == ["https://b.example/x", "https://c.example/x"]
    assert len(ctc_observations(claims)) == 3


def test_unspecified_only_pay_is_preserved_but_total_ctc_is_unavailable():
    claims = [_pay("ctc_min_lpa", 27, "https://a.example/x", "27 LPA", basis="lpa_unspecified"),
              _pay("ctc_min_lpa", 16, "https://b.example/x", "16+ LPA", basis="lpa_unspecified", open_ended=True)]
    low, high, count = ctc_range(claims, now=NOW)
    assert low["provenance"] == high["provenance"] == "unavailable"
    assert low["value"] is high["value"] is None and count == 0
    obs = observations_field(ctc_observations(claims), now=NOW)
    assert obs["provenance"] == "evidence" and len(obs["value"]) == 2
    assert all(o["basis"] == "lpa_unspecified" for o in obs["value"])


def test_mixed_basis_pair_does_not_promote_either_bound_to_total_ctc():
    claims = [_pay("ctc_min_lpa", 20, "https://a.example/x", "20-30 LPA", basis="total_ctc"),
              _pay("ctc_max_lpa", 30, "https://a.example/x", "20-30 LPA", basis="lpa_unspecified")]
    assert ctc_observations(claims)[0]["basis"] == "lpa_unspecified"
    assert ctc_range(claims, now=NOW)[2] == 0


def test_open_ended_total_ctc_has_no_invented_upper_bound():
    claims = [_pay("ctc_min_lpa", 160, "https://a.example/x", "160+ LPA CTC", open_ended=True)]
    low, high, count = ctc_range(claims, now=NOW)
    assert (low["value"], high["value"], count) == (160, None, 1)
    assert high["provenance"] == "unavailable" and "no upper bound" in high["note"]


def test_upper_bound_sources_exclude_open_ended_and_unspecified_observations():
    claims = [_pay("ctc_min_lpa", 16, "https://a.example/x", "16+ LPA CTC", open_ended=True),
              _pay("ctc_min_lpa", 20, "https://b.example/x", "20-30 LPA CTC"),
              _pay("ctc_max_lpa", 30, "https://b.example/x", "20-30 LPA CTC"),
              _pay("ctc_max_lpa", 300, "https://c.example/x", "300 LPA", basis="lpa_unspecified")]
    low, high, count = ctc_range(claims, now=NOW)
    assert (low["value"], high["value"], count) == (18, 30, 2)
    assert low["source_urls"] == ["https://a.example/x", "https://b.example/x"]
    assert high["source_urls"] == ["https://b.example/x"]


def test_conflicting_ranges_retain_observations_and_warn_on_derived_medians():
    claims = []
    for d, lo, hi in [("a", 10, 15), ("b", 30, 35), ("c", 50, 55)]:
        url, quote = f"https://{d}.example/x", f"{lo}-{hi} LPA CTC"
        claims += [_pay("ctc_min_lpa", lo, url, quote, date="2026-01-01"),
                   _pay("ctc_max_lpa", hi, url, quote, date="2026-01-01")]
    low, high, count = ctc_range(claims, now=NOW)
    assert (low["value"], high["value"], count) == (30, 35, 3)
    assert low["confidence"] == high["confidence"] == "low"
    assert "do not overlap" in low["note"]
    assert len(ctc_observations(claims)) == 3


def test_conflicting_open_ended_and_bounded_observations_cannot_make_reversed_range():
    claims = [_pay("ctc_min_lpa", 100, "https://a.example/x", "100+ LPA CTC", open_ended=True),
              _pay("ctc_min_lpa", 10, "https://b.example/x", "10-20 LPA CTC"),
              _pay("ctc_max_lpa", 20, "https://b.example/x", "10-20 LPA CTC")]
    low, high, count = ctc_range(claims, now=NOW)
    assert low["value"] is high["value"] is None and count == 0
    assert "conflicting" in low["note"] and len(ctc_observations(claims)) == 2


def test_stale_total_ctc_is_retained_with_existing_age_warning():
    claims = [_pay("ctc_min_lpa", 20, f"https://{d}.example/x", "20 LPA CTC", date="2021-01-01") for d in "abc"]
    low, high, count = ctc_range(claims, now=NOW)
    assert (low["value"], high["value"], count) == (20, 20, 3)
    assert low["confidence"] == high["confidence"] == "low"
    assert "Newest evidence from 2021" in low["note"]


def test_duplicate_claims_do_not_inflate_ctc_source_count():
    claim = _pay("ctc_min_lpa", 20, "https://a.example/x", "20 LPA CTC")
    assert ctc_range([claim, claim], now=NOW)[2] == 1


def test_observations_field():
    claims = [_pay("ctc_min_lpa", 27, "https://b.example/x", "27 LPA", basis="lpa_unspecified")]
    out = observations_field(ctc_observations(claims), now=NOW)
    assert out["value"][0]["min_lpa"] == 27 and out["source_urls"] == ["https://b.example/x"]
    assert observations_field([], now=NOW)["provenance"] == "unavailable"


def test_reported_interviews_exclude_official_sources_and_tag_the_evidence_type():
    claims = [c("interview_process", "Official: 3 rounds", "https://juspay.io/x", tier=1),
              c("interview_process", "Round 1 – OA", "https://www.linkedin.com/posts/a", source_type="community",
                date="2026-02-01"),
              c("interview_process", "Round 1: Coding test", "https://jobdexo.com/x", source_type="job_repost",
                date="2026-05-01"),
              c("interview_process", "Undated report", "https://medium.com/x", source_type="community")]
    out = reported_passages(claims, now=NOW)
    assert [(e["text"], e["evidence_type"]) for e in out["value"]] == [
        ("Round 1: Coding test", "secondhand"), ("Round 1 – OA", "candidate_report"), ("Undated report", "candidate_report")]
    assert "not official" in out["note"]


def test_official_extractive_text_uses_only_the_requested_tiers():
    claims = [c("interview_process", "Reported rounds", "https://a.example/x"),
              c("interview_process", "Official rounds", "https://juspay.io/x", tier=1)]
    assert extractive_text(claims, "interview_process", tiers={1}, now=NOW)["value"] == "Official rounds"
    assert extractive_text(claims[:1], "interview_process", tiers={1}, now=NOW)["provenance"] == "unavailable"
    assert extractive_text(claims, "interview_process", now=NOW)["value"] == "Official rounds\n\nReported rounds"
