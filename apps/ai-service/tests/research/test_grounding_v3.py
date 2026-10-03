"""Synthetic role-local grounding and exact text recovery regressions; no external I/O."""
import pytest

from app.research.nodes.evidence import exact_passage, ground_page_claims
from app.research.fields import FIELD_SPECS
from app.research.normalize.sources import SourceClass
from app.research.normalize.sources import local_location_quote, role_section
from tests.research.test_grounding_v2 import raw, run, OFFICIAL

ROLE = "Software Development Engineer Backend"
OTHER_ROLE = "Software Development Engineer Frontend"
LOCATION = "Bangalore, India"
SKILL = "Strong knowledge of Haskell and PureScript"


def page_claims(text, claims, official=False):
    return [g for _, g in ground_page_claims(claims, {"url": "https://www.linkedin.com/jobs/123",
                                                    "title": "Juspay " + ROLE, "content": text},
                                           SourceClass("official" if official else "community", 1 if official else 3),
                                           fields=tuple(FIELD_SPECS))]


def location(role=ROLE):
    return raw("location", "Bangalore", LOCATION, geo="unknown", role=role)


def skill(role=ROLE, geo_quote=""):
    return raw("required_skill", "Haskell", SKILL, geo="unknown", role=role, geo_quote=geo_quote)


def test_linkedin_location_claim_promotes_same_role_claims_independent_of_order():
    text = f"{ROLE}\n{LOCATION}\n{SKILL}"
    results = page_claims(text, [skill(), location()])
    assert all(g.reason is None for g in results)
    assert results[0].claim["geo_quote"] == LOCATION


@pytest.mark.parametrize("official", [False, True])
def test_location_does_not_bleed_across_roles_or_corporate_footer(official):
    for text in (f"{ROLE}\n{LOCATION}\n{OTHER_ROLE}\n{SKILL}",
                 f"{OTHER_ROLE}\n{SKILL}\nFooter\n{LOCATION}"):
        results = page_claims(text, [location(), skill(OTHER_ROLE, LOCATION)], official)
        assert results[1].reason == "geo_unconfirmed"


def test_same_role_title_in_two_countries_does_not_merge_scopes():
    text = f"{ROLE}\n{LOCATION}\n{ROLE}\nLocation: Singapore\n{SKILL}"
    result = page_claims(text, [location(), skill()])[1]
    assert result.reason == "geo_unconfirmed"


def test_direct_foreign_geo_quote_blocks_india_propagation():
    text = f"{ROLE}\n{LOCATION}\n{SKILL}\nSingapore"
    result = page_claims(text, [location(), skill(geo_quote="Singapore")])[1]
    assert result.reason == "foreign_geo"


def test_mixed_country_section_without_headings_cannot_propagate():
    text = f"{ROLE}\n{LOCATION}\n{SKILL}\nOther opening based in London"
    assert page_claims(text, [location(), skill()])[1].reason == "geo_unconfirmed"


def test_official_corporate_address_cannot_ground_role():
    text = f"{ROLE}\n{SKILL}\nHeadquarters: Bangalore, India"
    assert run(skill(), text, OFFICIAL).reason == "geo_unconfirmed"


def test_corporate_location_line_cannot_become_role_location_context():
    text = f"{ROLE}\n{SKILL}\nOur headquarters are based in Bangalore, India"
    assert page_claims(text, [location(), skill()])[1].reason == "geo_unconfirmed"


def test_exact_value_recovers_bad_quote_and_exact_quote_recovers_paraphrase():
    passage = "You’ll build reliable payment systems – using Haskell."
    text = f"{ROLE}\nLocation: Bangalore, India\n{passage}"
    for value, quote in [(passage, "Build payments with Haskell"), ("Build payment systems", passage)]:
        result = page_claims(text, [raw("jd", value, quote, role=ROLE)], official=True)[0]
        assert result.reason is None
        assert result.claim["value"] == result.claim["quote"] == passage


def test_recovered_quote_uses_original_source_typography():
    source = "You’ll build **reliable** systems – in India."
    recovered = exact_passage("You'll build reliable systems - in India.", source)
    assert recovered == source


def test_span_references_copy_exact_source_and_reject_bad_offsets():
    text = f"{ROLE}\nLocation: Bangalore, India\nBuild reliable payments."
    start = text.index("Build")
    claim = {**raw("jd", "paraphrase", "paraphrase", role=ROLE),
             "quote_span": {"start": start, "end": len(text)}, "value_span": {"start": start, "end": len(text)}}
    good = run(claim, text, OFFICIAL)
    assert good.reason is None and good.claim["value"] == "Build reliable payments."
    claim["quote_span"]["end"] += 1
    assert run(claim, text, OFFICIAL).reason == "quote_not_verbatim"


def test_unrecoverable_or_oversized_text_stays_rejected():
    text = "We build payments in India."
    assert page_claims(text, [raw("jd", "invented", "made up", role=ROLE)])[0].reason == "quote_not_verbatim"
    passage = "India " + "x" * 310
    assert page_claims(passage, [raw("review_quote", "summary", passage)])[0].reason == "too_long"


@pytest.mark.parametrize("title,metadata", [
    ("Software Development Engineer Frontend", "Full-Time\n\nMumbai"),
    ("Software Development Engineer Backend", "Intern Bangalore"),
    ("SDE - Functional Programming", "Full Time\n\nBangalore"),
])
def test_site_navigation_before_real_job_heading_is_not_footer(title, metadata):
    passage = "Build reliable payment systems."
    text = (f"Juspay Careers | {title}\n\nProducts\n##### About us\nCompany information\n"
            f"##### Contact us\nNavigation links\n# {title}\n\n{metadata}\n\n{passage}\n"
            "##### Contact us\nCorporate office: London")
    claims = [raw("title", title, title, geo="unknown", role=title),
              raw("jd", passage, passage, geo="unknown", role=title)]
    results = page_claims(text, claims, official=True)
    assert all(g.reason is None for g in results)
    section = role_section(text, passage, title)
    assert section.startswith("# " + title) and "London" not in section
    assert local_location_quote(text, passage, title) == metadata


@pytest.mark.parametrize("metadata", ["Location:\n\nBangalore, India", "Intern\nBangalore", "Full-Time\nMumbai"])
def test_split_metadata_preserves_exact_source_characters(metadata):
    text = f"# {ROLE}\n{metadata}\n{SKILL}"
    assert local_location_quote(text, SKILL, ROLE) == metadata
    assert page_claims(text, [skill()], official=True)[0].reason is None


def test_split_metadata_never_crosses_roles_or_footer():
    for middle in (f"# {OTHER_ROLE}\nBangalore", "##### Contact us\nBangalore",
                   "Our team works with India customers\nBangalore"):
        text = f"# {ROLE}\nFull-Time\n{middle}\n{SKILL}"
        assert not local_location_quote(text, SKILL, ROLE)
        assert page_claims(text, [skill()], official=True)[0].reason == "geo_unconfirmed"


def test_navigation_handling_preserves_foreign_role_and_direct_foreign_guards():
    text = (f"##### About us\n##### Contact us\n# {ROLE}\nFull-Time\nBangalore\n"
            f"# {OTHER_ROLE}\nFull-Time\nSingapore\n{SKILL}")
    assert page_claims(text, [skill(OTHER_ROLE)], official=True)[0].reason == "geo_unconfirmed"
    foreign = raw("required_skill", "Haskell", SKILL, geo="unknown", role=OTHER_ROLE, geo_quote="Singapore")
    assert page_claims(text, [foreign], official=True)[0].reason == "foreign_geo"


def test_corporate_footprint_and_payment_volume_do_not_override_explicit_role_metadata():
    company = ("The company processes a total payment volume (TPV) of $1 trillion. "
               "Headquartered in Bangalore, India, its global network operates across Dublin and Singapore.")
    text = f"##### Contact us\n# {ROLE}\nIntern Bangalore\n{company}\n{SKILL}"
    assert page_claims(text, [skill()], official=True)[0].reason is None
    # Even corporate context is not permitted as direct foreign supporting evidence for a role.
    direct = raw("jd", company, company, role=ROLE)
    assert page_claims(text, [direct], official=True)[0].reason == "foreign_geo"


@pytest.mark.parametrize("foreign", [
    "The job is based in Singapore, where the company operates across multiple offices.",
    "Remote position in London; company revenue is $1 billion.",
    "Compensation is $100,000; payment volume is $1 trillion.",
    "Other opening based in London",
])
def test_corporate_wording_cannot_hide_foreign_role_evidence(foreign):
    text = f"# {ROLE}\nIntern Bangalore\n{foreign}\n{SKILL}"
    assert page_claims(text, [skill()], official=True)[0].reason == "geo_unconfirmed"
