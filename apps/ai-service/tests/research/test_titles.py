"""Role identity and role-section resolution (evidence-hardening spec §8.1–8.2)."""
import pytest

from app.research.normalize.titles import (
    employment_from_title,
    infer_role,
    job_ids,
    norm_text,
    role_in_context,
    title_key,
)


@pytest.mark.parametrize("a,b", [
    ("SDE- UI Frameworks", "SDE - UI Frameworks"),
    ("Software Development Engineer – Backend (DEV-BE01)", "Software Development Engineer Backend"),
    ("Software Development Engineer, Backend", "Software Development Engineer Backend"),
    ("SDE II", "SDE 2"),
    ("Software Engineer-III", "software engineer 3"),
])
def test_title_variants_share_a_key(a, b):
    assert title_key(a) == title_key(b)


@pytest.mark.parametrize("a,b", [
    ("SDE", "Software Development Engineer"),     # abbreviations are never expanded
    ("SDE Intern", "SDE"),
    ("SDE 1", "SDE 2"),
])
def test_distinct_titles_stay_distinct(a, b):
    assert title_key(a) != title_key(b)


def test_norm_text_keeps_words_apart_across_unicode_dashes():
    assert norm_text("Engineer–Backend") == "engineer backend"


def test_job_ids_come_from_url_codes_and_bracketed_title_codes():
    urls = ["https://juspay.io/careers/DEV-BE01", "https://juspay.io/careers/sde-ui-frameworks",
            "https://www.linkedin.com/posts/aishwarya6386_juspay-devbe01-activity-75083928"]
    assert job_ids(urls, ["Software Development Engineer – Backend (DEV-BE01)", "SDE (dev-fe02)"]) == ["DEV-BE01", "DEV-FE02"]


@pytest.mark.parametrize("title,expected", [
    ("SDE Intern", "intern"), ("Software Engineering Internship", "intern"), ("Contract Backend Engineer", "contract"),
    ("SDE - UI Frameworks", None),
])
def test_employment_from_title(title, expected):
    assert employment_from_title(title) == expected


KNOWN = {title_key("SDE - UI Frameworks"), title_key("SDE - Functional Programming"),
         title_key("Software Development Engineer Backend"), title_key("Software Development Engineer Frontend")}


def test_title_inside_the_quote_is_in_context():
    assert role_in_context(title_key("SDE - UI Frameworks"), quote="SDE- UI Frameworks builds the Hyper SDK",
                           geo_quote="", page_title="", text="", known_keys=KNOWN)


def test_single_role_page_title_puts_the_whole_page_in_context():
    text = "Juspay Careers. What will you be doing? Building advanced UI Frameworks to be the best payments SDK."
    kw = dict(quote="Building advanced UI Frameworks to be the best payments SDK", geo_quote="Bangalore",
              page_title="Juspay Careers | SDE - UI Frameworks", text=text, known_keys=KNOWN)
    assert role_in_context(title_key("SDE - UI Frameworks"), **kw)
    assert not role_in_context(title_key("Software Development Engineer Backend"), **kw)
    assert infer_role(quote=kw["quote"], page_title=kw["page_title"], text=text, known_keys=KNOWN) == title_key("SDE - UI Frameworks")


MULTI = """Open roles at Juspay
Software Development Engineer Backend
You will build payment APIs in Haskell. 2+ years of experience.
Software Development Engineer Frontend
You will build React apps for checkout. 1-3 years of experience."""


def test_nearest_preceding_title_wins_on_multi_role_page():
    kw = dict(geo_quote="", page_title="Explore career opportunities", text=MULTI, known_keys=KNOWN)
    quote = "You will build React apps for checkout. 1-3 years of experience."
    assert role_in_context(title_key("Software Development Engineer Frontend"), quote=quote, **kw)
    assert not role_in_context(title_key("Software Development Engineer Backend"), quote=quote, **kw)
    assert infer_role(quote=quote, page_title=kw["page_title"], text=MULTI, known_keys=KNOWN) == \
        title_key("Software Development Engineer Frontend")


def test_page_title_naming_two_roles_falls_back_to_the_section():
    kw = dict(geo_quote="", page_title="Software Development Engineer Backend and Software Development Engineer Frontend",
              text=MULTI, known_keys=KNOWN)
    quote = "You will build payment APIs in Haskell."
    assert role_in_context(title_key("Software Development Engineer Backend"), quote=quote, **kw)
    assert not role_in_context(title_key("Software Development Engineer Frontend"), quote=quote, **kw)


def test_passage_before_any_known_title_has_no_role():
    text = "Juspay is hiring engineers who love payments. SDE - UI Frameworks: build the Hyper SDK."
    assert infer_role(quote="Juspay is hiring engineers who love payments", page_title="Careers", text=text,
                      known_keys=KNOWN) is None


def test_a_longer_title_containing_a_shorter_one_is_preferred():
    known = {title_key("SDE"), title_key("SDE Frontend")}
    text = "SDE Frontend\nBuild checkout UIs with React."
    assert infer_role(quote="Build checkout UIs with React.", page_title="", text=text, known_keys=known) == "sde frontend"
    assert role_in_context("sde frontend", quote="x", geo_quote="", page_title="Juspay | SDE Frontend", text="x",
                           known_keys=known)


def test_clear_section_heading_outranks_single_role_seo_page_title():
    quote = "You will build React apps for checkout."
    kw = dict(quote=quote, page_title="Juspay Software Development Engineer Backend", text=MULTI, known_keys=KNOWN)
    assert infer_role(**kw) == title_key("Software Development Engineer Frontend")
    assert not role_in_context(title_key("Software Development Engineer Backend"), geo_quote="Bangalore", **kw)


def test_unlabelled_claim_can_resolve_title_in_its_own_quote():
    quote = "SDE - UI Frameworks builds the Hyper SDK"
    assert infer_role(quote=quote, page_title="Careers", text=quote, known_keys=KNOWN) == title_key("SDE - UI Frameworks")


def test_separate_geo_passage_cannot_supply_wrong_role_context():
    assert not role_in_context(title_key("Software Development Engineer Frontend"),
                               quote="You will build payment APIs in Haskell.",
                               geo_quote="Software Development Engineer Frontend Mumbai", page_title="Careers",
                               text=MULTI, known_keys=KNOWN)


def test_unknown_internship_heading_stops_inheritance_from_known_full_time_section():
    text = "Software Development Engineer Backend\nBuild payments.\nSDE Functional Programming Intern\nUse Haskell."
    assert infer_role(quote="Use Haskell.", page_title="Software Development Engineer Backend", text=text,
                      known_keys=KNOWN) == "sde functional programming intern"
