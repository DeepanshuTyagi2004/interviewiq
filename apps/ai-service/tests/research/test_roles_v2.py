"""Roles v2 on Juspay-shaped pages (evidence-hardening spec §8): role sections, title variants,
employment types, pay observations, official vs reported interviews, isolation, follow-ups."""
import asyncio
import json
from collections import Counter

import pytest

from app.llm.client import LLMError
from app.research.memory_store import InMemoryResearchStore
from app.research.nodes.roles import roles
from app.research.targets import ResearchTarget
from tests.research.fakes import FakeExa, FakeLLM, result
from tests.research.helpers import wired_deps

JUSPAY = ResearchTarget(id="c-juspay", name="Juspay", slug="juspay", website="https://juspay.io")
FE, BE = "Software Development Engineer Frontend", "Software Development Engineer Backend"

FE_PAGE = result("https://juspay.io/careers/DEV-FE02", title=f"Juspay Careers | {FE}", content=(
    f"{FE}\nFull-Time Mumbai\nWhat you'll do: build checkout UIs used by millions.\n"
    "● 1-3 years of experience in building complex react-based applications.\n● Strong in React and TypeScript."))
BE01 = result("https://juspay.io/careers/DEV-BE01", title=f"Juspay Careers | {BE}",
              content=f"{BE}\nFull-Time Bangalore\nYou will build payment APIs in Haskell.")
BE02 = result("https://juspay.io/careers/DEV-BE02", title=f"Juspay Careers | {BE}",
              content=f"{BE}\nIntern Bangalore\nSummer internship building payment APIs.")
POST_TITLE = f"My Juspay Interview Experience – {BE} (27 LPA)"
POST = result("https://www.linkedin.com/posts/nesaralam08_juspay", title=POST_TITLE, content=(
    f"# My Juspay Interview Experience – ({BE} – 27 LPA)\nI interviewed at Juspay Bengaluru.\n"
    "Round 1 – Online Coding Challenge 90 minutes with 3 DSA problems on graphs and trees."))
DS_POST = result("https://www.linkedin.com/posts/someone_juspay", title="Juspay is hiring a Data Scientist",
                 content="Juspay is hiring a Data Scientist in Bengaluru. Apply now.")


def c(name, value, quote, *, role=None, geo="IN", geo_quote="", unit=None):
    return {"field": name, "value": value, "quote": quote, "geo": geo, "geo_quote": geo_quote, "role_title": role, "unit": unit}


CLAIMS = {
    FE_PAGE["url"]: [c("title", FE, FE), c("yoe_min", 1, "● 1-3 years of experience in building complex react-based applications.", role=FE),
                     c("yoe_max", 3, "● 1-3 years of experience in building complex react-based applications.", role=FE),
                     c("required_skill", "React", "● Strong in React and TypeScript.", role=FE),
                     c("jd", "What you'll do: build checkout UIs used by millions.", "What you'll do: build checkout UIs used by millions.")],
    BE01["url"]: [c("title", "Software Development Engineer – Backend (DEV-BE01)", BE, role=BE) | {"value": BE},
                  c("employment_type", "Full-Time", "Full-Time Bangalore", role=BE)],
    BE02["url"]: [c("title", BE, BE, role=BE), c("employment_type", "intern", "Intern Bangalore", role=BE)],
    POST["url"]: [c("title", POST_TITLE, POST_TITLE, geo="unknown"),
                  c("ctc_min_lpa", 27, f"My Juspay Interview Experience – ({BE} – 27 LPA)", role=BE, geo="unknown", unit="INR_LPA"),
                  c("ctc_max_lpa", 27, f"My Juspay Interview Experience – ({BE} – 27 LPA)", role=BE, geo="unknown", unit="INR_LPA"),
                  c("interview_process", "Round 1 – Online Coding Challenge 90 minutes with 3 DSA problems on graphs and trees.",
                    "Round 1 – Online Coding Challenge 90 minutes with 3 DSA problems on graphs and trees.", role=BE,
                    geo_quote="Juspay Bengaluru")],
    DS_POST["url"]: [c("title", "Data Scientist", "Juspay is hiring a Data Scientist in Bengaluru.")],
}


def clients(*, detail=None, fail_role=None, extra_claims=None):
    claims = {**CLAIMS, **(extra_claims or {})}

    def search(q):
        if "careers software engineer jobs" in q:
            return [FE_PAGE, BE01, BE02]
        if "software engineer jobs job description" in q:
            return [POST, DS_POST]
        return (detail or (lambda _: []))(q)

    def extract(system, user, label):
        data = json.loads(user)
        if fail_role and data["role_title_filter"] == fail_role:
            return LLMError("provider down")
        return {"claims": claims.get(data["source"]["url"], [])}
    return FakeExa(search), FakeLLM(extract)


async def run_roles(tmp_path, exa, llm, *, followups=0):
    deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=llm, company=JUSPAY)
    deps.settings = deps.settings.model_copy(update={"research_followup_max_queries": followups})
    try:
        return await roles(state, deps)
    finally:
        await tracer.close()


def by_key(out):
    return {r["role_key"]: r for r in out["roles"]}


def test_single_role_page_details_are_kept_without_repeating_the_title(tmp_path):
    async def go():
        out = await run_roles(tmp_path, *clients())
        fe = next(r for r in out["roles"] if r["title"]["value"] == FE)
        assert (fe["yoe_min"]["value"], fe["yoe_max"]["value"]) == (1, 3)
        assert fe["required_skills"]["value"] == ["React"]
        assert fe["jd"]["value"] == "What you'll do: build checkout UIs used by millions."
        assert fe["locations"]["provenance"] == "unavailable"
        assert fe["job_ids"]["value"] == ["DEV-FE02"]
    asyncio.run(go())


def test_full_time_and_intern_postings_stay_separate_roles(tmp_path):
    async def go():
        roles_ = by_key(await run_roles(tmp_path, *clients()))
        ft = roles_["unknown-general-software-development-engineer-backend"]
        intern = roles_["unknown-general-software-development-engineer-backend-intern"]
        assert ft["employment_type"]["value"] == "full_time" and intern["employment_type"]["value"] == "intern"
        assert ft["job_ids"]["value"] == ["DEV-BE01"] and intern["job_ids"]["value"] == ["DEV-BE02"]
    asyncio.run(go())


def test_community_post_title_does_not_create_a_role(tmp_path):
    async def go():
        titles = [r["title"]["value"] for r in (await run_roles(tmp_path, *clients()))["roles"]]
        assert sorted(titles) == sorted([FE, BE, BE])
        assert not any("Interview Experience" in t or t == "Data Scientist" for t in titles)
    asyncio.run(go())


def test_bare_lpa_pay_is_retained_without_inventing_total_ctc(tmp_path):
    async def go():
        ft = by_key(await run_roles(tmp_path, *clients()))["unknown-general-software-development-engineer-backend"]
        (obs,) = ft["ctc_observations"]["value"]
        assert (obs["min_lpa"], obs["max_lpa"], obs["basis"]) == (27, 27, "lpa_unspecified")
        assert ft["ctc_min_lpa"]["value"] is None
        assert ft["ctc_source_count"] == 0
    asyncio.run(go())


def test_official_and_reported_interview_evidence_are_separate(tmp_path):
    async def go():
        ft = by_key(await run_roles(tmp_path, *clients()))["unknown-general-software-development-engineer-backend"]
        assert ft["interview_process"]["provenance"] == "unavailable"
        (entry,) = ft["reported_interview_process"]["value"]
        assert entry["evidence_type"] == "candidate_report" and entry["source_url"] == POST["url"]
    asyncio.run(go())


def test_a_passage_from_another_roles_section_goes_to_review(tmp_path):
    async def go():
        listing = result("https://juspay.io/careers", title="Explore career opportunities", content=(
            f"{BE}\nBangalore. 2+ years building payment APIs.\n{FE}\nMumbai. Build checkout UIs."))
        wrong = c("yoe_min", 2, "Bangalore. 2+ years building payment APIs.", role=FE)

        def detail(q):
            return [listing] if FE in q else []
        out = await run_roles(tmp_path, *clients(detail=detail, extra_claims={listing["url"]: [wrong]}))
        fe = next(r for r in out["roles"] if r["title"]["value"] == FE)
        assert fe["yoe_min"]["value"] == 1                                   # from its own page
        assert [(u["field"], u["reason"]) for u in fe["unverified"]] == [("yoe_min", "role_not_in_context")]
    asyncio.run(go())


def test_a_failed_role_detail_search_only_affects_that_role(tmp_path):
    async def go():
        page = result("https://jobs.example/juspay-fe", title=f"Juspay {FE} salary", content=f"Juspay {FE} pay")

        def detail(q):
            return [page] if FE in q else []
        out = await run_roles(tmp_path, *clients(detail=detail, fail_role=FE))
        fe = next(r for r in out["roles"] if r["title"]["value"] == FE)
        assert fe["yoe_min"]["value"] == 1                                   # discovery evidence is kept
        assert fe["ctc_min_lpa"]["value"] is None
        assert any(FE in n and "could not be extracted" in n for n in out["notes"])
        ft = by_key(out)["unknown-general-software-development-engineer-backend"]
        assert "failed" not in (ft["ctc_min_lpa"]["note"] or "")
    asyncio.run(go())


def candidate_page(*, code="DEV-BE01", title=BE, employment="Full-Time", suffix=""):
    passage = "Round 1 was a Haskell coding exercise; round 2 covered payment API design."
    page = result("https://www.linkedin.com/posts/juspay-candidate", title=f"Juspay {title} interview {code}",
                  content=f"Juspay {title} ({code})\n{employment}\n{passage}\n{suffix}")
    return page, c("interview_process", passage, passage, role=title, geo="unknown")


def test_exact_job_code_corroborates_candidate_geography_with_both_sources(tmp_path):
    async def go():
        page, claim = candidate_page()
        out = await run_roles(tmp_path, *clients(detail=lambda q: [page] if BE in q else [],
                                               extra_claims={page["url"]: [claim]}))
        ft = by_key(out)["unknown-general-software-development-engineer-backend"]
        report = ft["reported_interview_process"]
        assert any(e["source_url"] == page["url"] for e in report["value"])
        assert {page["url"], BE01["url"]} <= set(report["source_urls"])
        assert report["provenance"] == "derived"
        assert "DEV-BE01" in report["note"] and "corroborated" in report["note"]
    asyncio.run(go())


@pytest.mark.parametrize("options", [
    {"code": ""}, {"code": "DEV-BE010"}, {"code": "DEVBE01"}, {"code": "DEV-OTHER01"},
    {"employment": "Intern"}, {"employment": "Contract"}, {"suffix": "This job was based in London."},
    {"title": "SDE Functional Programming Intern"}, {"suffix": "I also applied for DEV-BE02."},
])
def test_job_code_corroboration_rejects_unsupported_matches(tmp_path, options):
    async def go():
        page, claim = candidate_page(**options)
        out = await run_roles(tmp_path, *clients(detail=lambda q: [page] if BE in q else [],
                                               extra_claims={page["url"]: [claim]}))
        for row in out["roles"]:
            assert page["url"] not in row["reported_interview_process"]["source_urls"]
    asyncio.run(go())


def test_unknown_fp_internship_is_retained_in_company_notes_not_full_time_review(tmp_path):
    async def go():
        page, claim = candidate_page(title="SDE Functional Programming Intern", employment="Intern")
        out = await run_roles(tmp_path, *clients(detail=lambda q: [page] if BE in q else [],
                                               extra_claims={page["url"]: [claim]}))
        assert all(not any(u["url"] == page["url"] for u in row["unverified"]) for row in out["roles"])
        assert any(page["url"] in note and "Functional Programming Intern" in note for note in out["notes"])
    asyncio.run(go())


@pytest.mark.parametrize("always_fails", [False, True])
def test_discovery_source_retry_is_saved_once_and_never_needs_rediscovery(tmp_path, always_fails):
    async def go():
        calls = Counter()

        def extract(system, user, label):
            source = json.loads(user)["source"]["url"]
            calls[source] += 1
            if source == BE01["url"] and (always_fails or calls[source] == 1):
                return LLMError("temporary synthetic failure")
            return {"claims": CLAIMS.get(source, [])}

        # The failed source occurs in discovery only, not in any detail or follow-up query.
        exa, _ = clients()
        out = await run_roles(tmp_path, exa, FakeLLM(extract), followups=6)
        assert calls[BE01["url"]] == 2
        if not always_fails:
            ft = by_key(out)["unknown-general-software-development-engineer-backend"]
            assert ft["employment_type"]["value"] == "full_time"
        assert any("could not be extracted" in n for n in out["notes"])
    asyncio.run(go())


def test_failed_source_rediscovered_by_concurrent_titles_is_not_retried_again(tmp_path):
    async def go():
        calls = Counter()

        def extract(system, user, label):
            source = json.loads(user)["source"]["url"]
            calls[source] += 1
            if source == BE01["url"]:
                return LLMError("persistent synthetic failure")
            return {"claims": CLAIMS.get(source, [])}

        exa, _ = clients(detail=lambda q: [BE01])
        await run_roles(tmp_path, exa, FakeLLM(extract), followups=6)
        assert calls[BE01["url"]] == 2
    asyncio.run(go())


@pytest.mark.parametrize("location", ["Headquarters Bangalore", "Full-Time London", "Global opportunities"])
def test_exact_code_does_not_turn_hq_or_foreign_posting_into_india_job_evidence(tmp_path, location):
    async def go():
        page, claim = candidate_page()
        official = {**BE01, "content": f"{BE}\n{location}\nFull-Time\nBuild payment APIs."}
        exa, llm = clients(detail=lambda q: [page] if BE in q else [], extra_claims={
            page["url"]: [claim], BE01["url"]: [c("title", BE, BE, role=BE),
                                              c("employment_type", "full_time", "Full-Time", role=BE)]})
        original = exa._respond
        exa._respond = lambda q: [official if p["url"] == BE01["url"] else p for p in original(q)]
        out = await run_roles(tmp_path, exa, llm)
        assert all(page["url"] not in r["reported_interview_process"]["source_urls"] for r in out["roles"])
    asyncio.run(go())


def test_detail_failure_is_retried_from_saved_text_without_followup_budget(tmp_path):
    async def go():
        page, claim = candidate_page()
        calls = Counter()
        exa, _ = clients(detail=lambda q: [page] if BE in q else [])

        def extract(system, user, label):
            url = json.loads(user)["source"]["url"]
            calls[url] += 1
            if url == page["url"]:
                if calls[url] == 1:
                    return LLMError("temporary synthetic failure")
                return {"claims": [claim]}
            return {"claims": CLAIMS.get(url, [])}

        out = await run_roles(tmp_path, exa, FakeLLM(extract))
        assert calls[page["url"]] == 2
        assert out["followups_used"] == 0
        ft = by_key(out)["unknown-general-software-development-engineer-backend"]
        assert page["url"] in ft["reported_interview_process"]["source_urls"]
    asyncio.run(go())


@pytest.mark.parametrize("job_context,expected", [
    ("", True),
    ("This role is based in London.", False),
    ("Remote Singapore", False),
])
def test_official_india_metadata_is_not_overridden_by_corporate_marketing(tmp_path, job_context, expected):
    async def go():
        page, claim = candidate_page()
        # Synthetic marketing paragraph, not a job-location statement or a stored source copy.
        overview = "Juspay is a software company with corporate offices in Singapore and $2 million in annual revenue."
        official = {**BE01, "content": f"{BE}\nFull-Time Bangalore\n\n{overview}\n\n{job_context}\nBuild APIs."}
        extra = {page["url"]: [claim], BE01["url"]: [
            c("title", BE, f"{BE}\nFull-Time Bangalore", role=BE),
            c("employment_type", "full_time", "Full-Time Bangalore", role=BE),
            c("location", "Bangalore", "Full-Time Bangalore", role=BE),
        ]}
        exa, llm = clients(detail=lambda q: [page] if BE in q else [], extra_claims=extra)
        original = exa._respond
        exa._respond = lambda q: [official if p["url"] == BE01["url"] else p for p in original(q)]
        out = await run_roles(tmp_path, exa, llm)
        ft = by_key(out)["unknown-general-software-development-engineer-backend"]
        report = ft["reported_interview_process"]
        assert (page["url"] in report["source_urls"]) is expected
        if expected:
            assert BE01["url"] in report["source_urls"]
            assert report["provenance"] == "derived" and "DEV-BE01" in report["note"]
    asyncio.run(go())


def test_role_followups_fill_the_interview_when_enabled(tmp_path):
    async def go():
        gfg = result("https://www.geeksforgeeks.org/juspay-frontend", title=f"Juspay {FE} Interview Experience",
                     content="Juspay Mumbai frontend interview. Round 1 was a JavaScript machine-coding round.")
        claim = c("interview_process", "Round 1 was a JavaScript machine-coding round.",
                  "Round 1 was a JavaScript machine-coding round.", role=FE, geo_quote="Juspay Mumbai")

        def detail(q):
            return [gfg] if q == f"Juspay {FE} interview experience" else []
        exa, llm = clients(detail=detail, extra_claims={gfg["url"]: [claim]})
        out = await run_roles(tmp_path, exa, llm, followups=6)
        fe = next(r for r in out["roles"] if r["title"]["value"] == FE)
        assert fe["reported_interview_process"]["value"][0]["source_url"] == gfg["url"]
        assert out["followups_used"] >= 1 and exa.includes[exa.calls.index(f"Juspay {FE} interview experience")]
    asyncio.run(go())


def test_a_careers_page_heading_is_not_a_role(tmp_path):
    async def go():
        index = result("https://juspay.io/careers", title="Explore career opportunities in payments tech",
                       content="Explore career opportunities in payments tech\nOpen roles in Bangalore.")
        heading = c("title", "Explore career opportunities in payments tech", "Explore career opportunities in payments tech")

        def detail(q):
            return []
        exa, llm = clients(detail=detail, extra_claims={index["url"]: [heading]})
        exa._respond = (lambda base: lambda q: [*base(q), index] if "careers software engineer jobs" in q else base(q))(exa._respond)
        titles = [r["title"]["value"] for r in (await run_roles(tmp_path, exa, llm))["roles"]]
        assert "Explore career opportunities in payments tech" not in titles and FE in titles
    asyncio.run(go())


def test_an_intern_level_on_a_posting_marks_it_as_an_internship(tmp_path):
    async def go():
        # v1-style extraction: no employment_type claims, only the posting's "Intern" level line.
        extra = {BE01["url"]: [c("title", BE, BE, role=BE)],
                 BE02["url"]: [c("title", BE, BE, role=BE), c("level", "intern", "Intern Bangalore", role=BE)]}
        roles_ = by_key(await run_roles(tmp_path, *clients(extra_claims=extra)))
        assert "unknown-general-software-development-engineer-backend" in roles_
        intern = roles_["intern-general-software-development-engineer-backend-intern"]
        assert intern["job_ids"]["value"] == ["DEV-BE02"] and intern["employment_type"]["value"] == "intern"
    asyncio.run(go())
