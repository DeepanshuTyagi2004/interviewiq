"""Grounding v2 (evidence-hardening spec §7): reason codes, hard vs soft, and the Juspay cases."""
import pytest

from app.research.nodes.evidence import HARD_REASONS, SOFT_REASONS, ground, parse_claim, verbatim
from app.research.normalize.sources import SourceClass

OTHER = SourceClass("other", 3)
OFFICIAL = SourceClass("official", 1)
REVIEWS = SourceClass("review_platform", 2)
COMMUNITY = SourceClass("community", 3)


def raw(name, value, quote, *, geo="IN", geo_quote="", role=None, unit=None):
    return {"field": name, "value": value, "quote": quote, "geo": geo, "geo_quote": geo_quote,
            "role_title": role, "unit": unit}


def run(r, text, src=OTHER, url="https://x.example/page", title="Page"):
    claim, reason, open_ended = parse_claim(r)
    assert claim is not None, reason
    return ground(claim, {"url": url, "title": title, "content": text, "date": "2026-01-10"}, src, open_ended=open_ended)


def test_reason_sets_are_disjoint_and_soft_ones_are_review_routes():
    assert not HARD_REASONS & SOFT_REASONS
    assert SOFT_REASONS == {"geo_unconfirmed", "role_not_in_context", "role_mismatch"}


# --- verbatim ----------------------------------------------------------------------------------
TEXT = ("Round 1 – Online Assessment. The assessment covered Core Java, DSA and SQL. It tested both "
        "technical knowledge and problem-solving under time pressure. Round 2 – Coding round with two "
        "graph problems and one tree problem.")


def test_fragments_in_order_are_verbatim():
    assert verbatim("Round 1 – Online Assessment. The assessment covered Core Java … Round 2 – Coding round with two "
                    "graph problems", TEXT)


def test_fragments_out_of_order_are_not_verbatim():
    assert not verbatim("Round 2 – Coding round with two graph problems … Round 1 – Online Assessment. The assessment",
                        TEXT)


def test_tiny_fragments_cannot_stitch_a_passage():
    assert not verbatim("Round 1 … two graph problems and one tree problem", TEXT)


def test_trailing_ellipsis_on_a_single_passage_is_fine():
    assert verbatim("It tested both technical knowledge and problem-solving...", TEXT)


def test_typographic_quotes_dashes_and_markdown_do_not_break_verbatim():
    assert verbatim("You'll be working on - the core problems", "**You’ll be working on – the core problems**")


# --- parsing -------------------------------------------------------------------------------------
def test_numbers_sent_as_text_are_parsed():
    claim, reason, _ = parse_claim(raw("ctc_min_lpa", "20", "(20 LPA)", unit="INR_LPA"))
    assert reason is None and claim.value == 20.0


def test_open_ended_minimum_is_allowed_only_for_minimums():
    claim, reason, open_ended = parse_claim(raw("ctc_min_lpa", "16+", "₹16+ LPA", unit="INR_LPA"))
    assert (claim.value, reason, open_ended) == (16.0, None, True)
    assert parse_claim(raw("ctc_max_lpa", "16+", "₹16+ LPA", unit="INR_LPA"))[1] == "schema_invalid"
    assert parse_claim(raw("yoe_min", "a few", "a few years"))[1] == "schema_invalid"


def test_null_geo_fields_fall_back_to_defaults():
    claim, reason, _ = parse_claim({**raw("hq", "Bengaluru", "HQ: Bengaluru"), "geo": None, "geo_quote": None})
    assert reason is None and claim.geo == "unknown" and claim.geo_quote == ""


# --- hard reasons ------------------------------------------------------------------------------
def test_unknown_field_is_not_allowed():
    assert run(raw("salary_vibes", "great", "great"), "great").reason == "field_not_allowed"


def test_quote_not_in_source():
    assert run(raw("hq", "Pune", "HQ: Pune"), "HQ: Bengaluru").reason == "quote_not_verbatim"


def test_text_value_must_be_in_the_source():
    g = run(raw("hq", "Pune, India", "HQ: Bengaluru"), "HQ: Bengaluru")
    assert g.reason == "value_not_supported" and not g.soft


def test_series_d_maps_to_late_stage_and_keeps_the_round():
    g = run(raw("funding_stage", "Series D", "Funding stage:  Series D"), "Funding stage:  Series D")
    assert g.reason is None and g.claim["value"] == "late-stage" and g.claim["derived_from"] == "Series D"


@pytest.mark.parametrize("value,quote,expected", [
    ("Seed", "raised a seed round", "early"), ("Series B", "Series B led by X", "growth"),
    ("Series A", "a Series A round", "early"), ("pre-IPO", "a pre-IPO round", "late-stage"),
])
def test_funding_round_mapping(value, quote, expected):
    assert run(raw("funding_stage", value, quote), quote).claim["value"] == expected


def test_saas_is_a_product_signal():
    assert run(raw("business_model", "product", "Juspay is a payments management SaaS."),
               "Juspay is a payments management SaaS.").reason is None


def test_unsupported_category_value_and_missing_signal():
    assert run(raw("business_model", "service", "Provider of payments infrastructure solutions."),
               "Provider of payments infrastructure solutions.").reason == "category_signal_missing"
    assert run(raw("level", "lead", "Lead engineer"), "Lead engineer").reason == "category_invalid"


def test_employment_type_is_normalized_and_signal_checked():
    text = "Full-Time Bangalore"
    assert run(raw("employment_type", "Full-Time", text, role="SDE"), text).claim["value"] == "full_time"
    assert run(raw("employment_type", "intern", text, role="SDE"), text).reason == "category_signal_missing"


AMBITION = "### Category Ratings 3.8 #### Skill development 3.6 #### Work-life balance 3.3 #### Company culture"


def test_wlb_rating_must_be_the_number_next_to_the_label():
    url = "https://www.ambitionbox.com/overview/juspay-overview"
    assert run(raw("wlb_rating", 3.3, AMBITION), AMBITION, REVIEWS, url=url).reason is None
    assert run(raw("wlb_rating", 3.6, AMBITION), AMBITION, REVIEWS, url=url).reason == "rating_not_adjacent"


def test_wlb_rating_before_its_label_on_a_review_platform():
    url = "https://www.ambitionbox.com/x"
    assert run(raw("wlb_rating", 3.7, "3.7 Work Life Balance"), "3.7 Work Life Balance", REVIEWS, url=url).reason is None


def test_wlb_rating_needs_a_scale_off_review_platforms():
    quote = "India team work-life balance 3.7"
    assert run(raw("wlb_rating", 3.7, quote), quote).reason == "rating_scale_missing"
    quote5 = "India team work-life balance 3.7/5"
    assert run(raw("wlb_rating", 3.7, quote5), quote5).reason is None


def test_review_count_must_belong_to_the_wlb_rating():
    url = "https://www.ambitionbox.com/x"
    assert run(raw("wlb_review_count", 116, "based on 116 Reviews"), "based on 116 Reviews", REVIEWS,
               url=url).reason == "count_not_wlb"


def test_bare_lpa_counts_as_total_ctc_but_is_marked():
    quote = "My Juspay Interview Experience – (Software Development Engineer Backend – 27 LPA)"
    g = run(raw("ctc_min_lpa", 27, quote, geo="unknown", unit="INR_LPA"), quote, COMMUNITY,
            url="https://www.linkedin.com/posts/x")
    assert g.reason is None and g.claim["basis"] == "lpa_unspecified" and g.claim["value"] == 27


def test_explicit_ctc_is_total_basis():
    quote = "India SDE total CTC is INR 20 to 30 LPA."
    assert run(raw("ctc_max_lpa", 30, quote, unit="INR_LPA"), quote).claim["basis"] == "total_ctc"


@pytest.mark.parametrize("quote", ["India SDE base salary 20 LPA", "India SDE intern stipend 20 LPA",
                                   "India SDE in-hand 20 LPA"])
def test_non_total_pay_is_rejected(quote):
    assert run(raw("ctc_min_lpa", 20, quote, unit="INR_LPA"), quote).reason == "ctc_not_total"


def test_monthly_pay_without_ctc_wording_is_rejected():
    quote = "India SDE salary INR 50,000 per month"
    assert run(raw("ctc_min_lpa", 50000, quote, unit="INR_MONTHLY"), quote).reason == "ctc_not_total"


def test_pay_without_a_supported_unit():
    quote = "India SDE annual CTC INR 20 lakh"
    assert run(raw("ctc_min_lpa", 20, quote, unit="INR_ANNUAL"), quote).reason == "ctc_unit_missing"


def test_estimates_are_rejected():
    quote = "India SDE estimated CTC 20 LPA"
    assert run(raw("ctc_min_lpa", 20, quote, unit="INR_LPA"), quote).reason == "ctc_estimate"


def test_foreign_pay_is_dropped_hard():
    quote = "Singapore SDE CTC 20 LPA"
    g = run(raw("ctc_min_lpa", 20, quote, unit="INR_LPA"), quote)
    assert g.reason == "foreign_geo" and not g.soft


def test_number_must_occur_in_the_quote():
    quote = "India SDE CTC INR 20 LPA"
    assert run(raw("ctc_min_lpa", 99, quote, unit="INR_LPA"), quote).reason == "value_not_supported"


def test_years_must_be_years():
    assert run(raw("yoe_min", 1, "India SDE: 1-3 years of experience"), "India SDE: 1-3 years of experience").reason is None
    assert run(raw("yoe_min", 70, "India SDE: 70 years"), "India SDE: 70 years").reason == "out_of_range"


def test_review_quote_length_cap():
    quote = "India " + "x" * 400
    assert run(raw("review_quote", quote, quote), quote).reason == "too_long"


# --- soft reasons and India signals -----------------------------------------------------------
def test_unconfirmed_geography_is_soft_and_keeps_the_claim_for_review():
    quote = "3.7 Work Life Balance"
    g = run(raw("wlb_rating", 3.7, quote, geo="unknown"), quote, REVIEWS, url="https://www.teamblind.com/company/JUSPAY")
    assert g.reason == "geo_unconfirmed" and g.soft and g.claim["value"] == 3.7


def test_official_page_naming_an_indian_city_establishes_india():
    text = "Full-Time Mumbai\n● 1-3 years of experience in building complex react-based applications."
    g = run(raw("yoe_min", 1, "● 1-3 years of experience in building complex react-based applications.", geo="unknown"),
            text, OFFICIAL, url="https://juspay.io/careers/DEV-FE02")
    assert g.reason is None and g.claim["tier"] == 1 and g.claim["source_type"] == "official"


def test_unverifiable_geo_quote_is_ignored():
    quote = "Great team and flexible hours."
    g = run(raw("review_quote", quote, quote, geo="IN", geo_quote="Bangalore office"), quote)
    assert g.reason == "geo_unconfirmed"


def test_profile_facts_are_not_india_only():
    quote = "Juspay is headquartered in San Francisco"
    assert run(raw("hq", "San Francisco", quote, geo="other"), quote).reason is None


# --- items ---------------------------------------------------------------------------------------
def test_skill_items_must_appear_in_the_quote():
    quote = "India: Strong knowledge of Haskell and PureScript"
    assert run(raw("required_skill", "Haskell", quote), quote).reason is None
    assert run(raw("required_skill", "Rust", quote), quote).reason == "value_not_supported"


def test_location_items_normalize_to_indian_cities():
    quote = "Job Location: Bangalore, India"
    assert run(raw("location", "Bangalore", quote), quote).claim["value"] == "Bengaluru"
    remote = "Job Location: Remote, India"
    assert run(raw("location", "Remote", remote), remote).reason == "value_not_supported"


def test_grounded_claim_carries_source_metadata():
    quote = "India SDE CTC INR 20 LPA"
    g = run(raw("ctc_min_lpa", 20, quote, unit="INR_LPA"), quote, url="https://pay.example/a", title="Pay page")
    assert {k: g.claim[k] for k in ("url", "source_name", "date", "tier", "source_type")} == {
        "url": "https://pay.example/a", "source_name": "Pay page", "date": "2026-01-10", "tier": 3, "source_type": "other"}
