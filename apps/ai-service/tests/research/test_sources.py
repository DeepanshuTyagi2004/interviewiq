"""Source tiers, India signals and the relevance filter (evidence-hardening spec §5)."""
import pytest

from app.research.normalize.sources import (
    SourceClass,
    canonical_city,
    classify_source,
    has_inr_marker,
    india_signal,
    is_india_platform,
    is_relevant,
)


@pytest.mark.parametrize("url,expected", [
    ("https://juspay.io/careers/DEV-BE01", SourceClass("official", 1)),
    ("https://careers.juspay.io/jobs/1", SourceClass("official", 1)),
    ("https://jobs.lever.co/juspay/123", SourceClass("official_job_posting", 1)),
    ("https://jobs.lever.co/razorpay/123", SourceClass("other", 3)),
    ("https://tracxn.com/d/companies/juspay/x", SourceClass("business_database", 2)),
    ("https://inc42.com/company/juspay/", SourceClass("news", 2)),
    ("https://www.ambitionbox.com/overview/juspay-overview", SourceClass("review_platform", 2)),
    ("https://in.indeed.com/cmp/Juspay-Technologies/reviews", SourceClass("review_platform", 2)),
    ("https://www.linkedin.com/posts/someone_juspay-activity-1", SourceClass("community", 3)),
    ("https://jobdexo.com/job/C2320-J053/sde-backend-juspay", SourceClass("job_repost", 3)),
    ("https://reports.example/juspay", SourceClass("other", 3)),
])
def test_classify_source_by_domain(url, expected):
    assert classify_source(url, company_domain="juspay.io", company_slug="juspay") == expected


def test_without_a_resolved_domain_nothing_is_official():
    assert classify_source("https://juspay.io/careers", company_domain=None, company_slug="juspay").tier == 3


@pytest.mark.parametrize("text,expected", [
    ("Software Development Engineer Backend (20 LPA)", True), ("₹16+ LPA", True), ("INR 2,000,000 annual", True),
    ("Rs. 50,000 per month", True), ("12 lakh per annum", True), ("revenue of 514 crore", True),
    ("3.7 Work Life Balance", False), ("USD 120,000", False),
])
def test_inr_markers(text, expected):
    assert has_inr_marker(text) is expected


def test_india_platforms():
    assert is_india_platform("https://www.ambitionbox.com/x")
    assert is_india_platform("https://in.indeed.com/cmp/x")
    assert is_india_platform("https://www.desiqna.in/x")
    assert not is_india_platform("https://www.teamblind.com/company/JUSPAY/reviews")


def _signal(quote, *, url="https://www.linkedin.com/posts/x", geo="unknown", geo_quote="", tier=3, text=""):
    return india_signal(geo=geo, geo_quote=geo_quote, quote=quote, url=url, tier=tier, text=text or quote)


def test_lpa_in_the_quote_establishes_india():
    assert _signal("My Juspay Interview Experience – (Software Development Engineer Backend – 27 LPA)") == "india"


def test_global_platform_without_an_india_signal_is_unknown():
    assert _signal("3.7 Work Life Balance", url="https://www.teamblind.com/company/JUSPAY/reviews") == "unknown"


def test_foreign_currency_or_city_is_foreign_even_with_an_india_tag():
    assert _signal("Base pay USD 120,000 in Bangalore", geo="IN", geo_quote="Bangalore") == "foreign"
    assert _signal("Engineers in Singapore earn well", geo="IN", geo_quote="Singapore") == "foreign"


def test_llm_india_tag_needs_an_indian_place():
    assert _signal("Great team", geo="IN", geo_quote="Bangalore") == "india"
    assert _signal("Great team", geo="IN", geo_quote="Remote") == "unknown"


def test_official_page_naming_an_indian_city_is_india():
    assert _signal("1-3 years of experience", url="https://juspay.io/careers/DEV-FE02", tier=1,
                   text="Full-Time Mumbai. 1-3 years of experience") == "india"
    assert _signal("1-3 years of experience", url="https://juspay.io/careers/DEV-FE02", tier=1,
                   text="Remote. 1-3 years of experience") == "unknown"


def test_india_platform_establishes_india():
    assert _signal("Work-life balance 3.7", url="https://www.ambitionbox.com/benefits/juspay") == "india"


@pytest.mark.parametrize("text,expected", [
    ("Bangalore, India", "Bengaluru"), ("Bengaluru, Karnataka 560095", "Bengaluru"),
    ("Gurgaon", "Gurugram"), ("Bombay office", "Mumbai"), ("Remote", None), ("New York", None),
])
def test_canonical_city(text, expected):
    assert canonical_city(text) == expected


def _source(title, content):
    return {"url": "https://x.example/a", "title": title, "content": content}


def test_relevance_keeps_a_page_titled_with_the_company():
    assert is_relevant(_source("Juspay Careers | SDE", "Apply now"), ["Juspay"], tier=3)


def test_relevance_drops_unrelated_pages_that_mention_the_company_only_in_passing():
    body = ("LTIMindtree fresher hiring. " * 100) + " Also Juspay, Juspay and Juspay are hiring."
    assert not is_relevant(_source("LTIMindtree Fresher Bulk Hiring", body), ["Juspay"], tier=3)


def test_relevance_keeps_pages_that_open_with_repeated_mentions():
    body = "Juspay interview. Juspay asked graphs. Juspay HR round. " + "x" * 3000
    assert is_relevant(_source("My interview experience", body), ["Juspay"], tier=3)


def test_relevance_always_keeps_official_pages():
    assert is_relevant(_source("Explore career opportunities", "Open roles"), ["Juspay"], tier=1)


def test_relevance_matches_whole_words_and_aliases():
    assert not is_relevant(_source("Juspayments blog", "nothing"), ["Juspay"], tier=3)
    assert is_relevant(_source("Juspay Technologies Pvt Ltd reviews", ""), ["Juspay Technologies"], tier=3)
