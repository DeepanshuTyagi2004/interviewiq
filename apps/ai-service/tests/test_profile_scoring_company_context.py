"""Company-context boundary and the level-aware assessment prompt."""
import asyncio

import pytest
from pydantic import ValidationError

from app.profile_scoring.assess import COMPANY_CONTEXT_SYSTEM, COMPANY_WEB_SYSTEM, PROFILE_ASSESSMENT_SYSTEM, run_company_context
from app.profile_scoring.models import (
    COMPANY_CONTEXT_PROMPT_VERSION, CompanyContextLLMOutput, CompanyContextRequest, PROFILE_ASSESSMENT_PROMPT_VERSION,
)


class FakeLLM:
    routing_identity = {"provider": "fake-provider", "model": "fake-model"}

    def __init__(self, data):
        self.data = data
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def complete_json(self, system, user, *, label):
        self.calls.append((system, user, label))
        return self.data


def known():
    return {"known": True, "industry": "fintech", "companySize": "1001-5000", "engineeringSize": "201-500", "productType": "product",
            "technicalDomains": ["payments"], "knownTechnologies": ["Go"], "internshipProgram": None, "internshipSelectivity": None,
            "geographicScope": "national", "companyStage": "late-stage"}


def test_assessment_prompt_names_the_exact_output_keys():
    # Models otherwise mirror the input's "key"/"excerpts" names and every first answer fails validation.
    for key in ('"feature"', '"value"', '"rationale"', '"evidence_excerpts"', '"evidence_type"'):
        assert key in PROFILE_ASSESSMENT_SYSTEM


def test_assessment_prompt_is_level_relative_and_versioned():
    assert PROFILE_ASSESSMENT_PROMPT_VERSION == "profile-scoring-assessment-prompt-v5"
    assert "RELATIVE TO THE CANDIDATE'S declared_level" in PROFILE_ASSESSMENT_SYSTEM
    assert "never return an overall score" in PROFILE_ASSESSMENT_SYSTEM.lower()


def test_company_context_returns_facts_without_any_score_and_only_sends_the_name():
    fake = FakeLLM(known())
    out = asyncio.run(run_company_context(fake, CompanyContextRequest(company_name="Acme Payments"))).model_dump(by_alias=True, mode="json")
    assert out["known"] is True and out["productType"] == "product"
    assert out["promptVersion"] == COMPANY_CONTEXT_PROMPT_VERSION and out["provider"] == "fake-provider"
    assert not {"score", "rating", "rank", "prestige", "tier"} & set(out)
    system, user, _ = fake.calls[0]
    assert system == COMPANY_CONTEXT_SYSTEM and '"Acme Payments"' in user
    assert "prestige" in COMPANY_CONTEXT_SYSTEM and "never return a score" in COMPANY_CONTEXT_SYSTEM.lower()


def test_unknown_company_cannot_carry_guessed_facts():
    with pytest.raises(ValidationError):
        CompanyContextLLMOutput.model_validate({**known(), "known": False})
    empty = CompanyContextLLMOutput.model_validate({"known": False})
    assert empty.industry is None and empty.technical_domains == []


def test_null_lists_mean_empty_for_an_unknown_company():
    out = CompanyContextLLMOutput.model_validate({"known": False, "technical_domains": None, "known_technologies": None})
    assert out.technical_domains == [] and out.known_technologies == []


def test_a_stated_headcount_decides_its_band():
    out = CompanyContextLLMOutput.model_validate({**known(), "companySize": "1001-5000", "companyHeadcount": "282", "engineeringHeadcount": "170+",
                                                  "sizeEvidence": "LinkedIn: employs 282 people"})
    assert (out.company_headcount, out.company_size, out.engineering_headcount, out.engineering_size) == (282, "201-500", 170, "51-200")


def test_size_mentions_find_headcounts_anywhere_in_a_page():
    from app.profile_scoring.assess import size_mentions
    page = "Intro. " + "x" * 5000 + ". The IT department has 171 employees. We are a team of 170+ professionals. Founded in 2014."
    assert size_mentions(page) == ["The IT department has 171 employees.", "We are a team of 170+ professionals."]
    assert size_mentions("SalesCode AI employs 282 people (+10.6% YoY). Its workforce spans 10 countries.") == ["SalesCode AI employs 282 people (+10.6% YoY)."]


def test_near_miss_values_are_mapped_to_allowed_values():
    out = CompanyContextLLMOutput.model_validate({**known(), "companySize": "201-500", "engineeringSize": "about 2,000", "productType": "Payment gateway platform (SaaS)",
        "geographicScope": "India and global", "companyStage": "Late-stage startup", "internshipProgram": True, "knownTechnologies": [f"t{i}" for i in range(14)]})
    assert (out.company_size, out.engineering_size, out.product_type, out.geographic_scope, out.company_stage) == ("201-500", "1001-5000", "product", "multinational", "late-stage")
    assert out.internship_program and len(out.known_technologies) == 10
    assert CompanyContextLLMOutput.model_validate({**known(), "companySize": "huge"}).company_size is None


@pytest.mark.parametrize("patch", [{"confidence": 70}, {"overallScore": 90}, {"internshipSelectivity": -1}])
def test_company_context_output_is_strictly_bounded(patch):
    with pytest.raises(ValidationError):
        CompanyContextLLMOutput.model_validate({**known(), **patch})


def test_company_context_request_accepts_only_a_short_name():
    with pytest.raises(ValidationError):
        CompanyContextRequest.model_validate({"companyName": "x" * 121})
    with pytest.raises(ValidationError):
        CompanyContextRequest.model_validate({"companyName": "Acme", "resume": "private"})


class SequenceLLM(FakeLLM):
    """Returns one canned answer per call, in order (model knowledge first, then web extraction)."""

    def __init__(self, *answers):
        super().__init__(None)
        self.answers = list(answers)

    async def complete_json(self, system, user, *, label):
        self.calls.append((system, user, label))
        return self.answers.pop(0)


class FakeExa:
    def __init__(self, results=None, error=None):
        self.results, self.error, self.queries = results or [], error, []

    async def collect_sources(self, queries, **kwargs):
        self.queries.append((queries, kwargs))
        if self.error:
            raise self.error
        return self.results


UNKNOWN = {"known": False}
RESULTS = [{"title": "Salescode.ai - AI for CPG sales", "url": "https://salescode.ai/", "content": "Salescode.ai builds AI sales products for CPG brands; 300+ employees.", "date": None}]


def test_unknown_company_falls_back_to_cited_web_search():
    web = {**known(), "industry": "Sales AI", "evidence_urls": ["https://salescode.ai/", "https://invented.example/"]}
    llm, exa = SequenceLLM(UNKNOWN, web), FakeExa(RESULTS)
    out = asyncio.run(run_company_context(llm, CompanyContextRequest(company_name="Salescode.ai"), exa=exa)).model_dump(by_alias=True, mode="json")
    assert out["known"] is True and out["basis"] == "web_search" and out["industry"] == "Sales AI"
    assert out["evidenceUrls"] == ["https://salescode.ai/"]  # a URL that was not a search result is dropped
    assert exa.queries[0][1]["retry"] is False
    system, user, _ = llm.calls[1]
    assert system == COMPANY_WEB_SYSTEM and "https://salescode.ai/" in user and "Salescode.ai" in user


def test_web_answer_without_a_real_cited_result_stays_unknown():
    web = {**known(), "evidence_urls": ["https://invented.example/"]}
    out = asyncio.run(run_company_context(SequenceLLM(UNKNOWN, web), CompanyContextRequest(company_name="Acme"), exa=FakeExa(RESULTS)))
    assert out.known is False and out.basis == "none" and out.evidence_urls == []


def test_web_search_failure_or_no_results_keeps_the_company_unknown():
    from app.exa.client import ExaError
    for exa in (FakeExa(error=ExaError("down")), FakeExa([])):
        llm = SequenceLLM(UNKNOWN)
        out = asyncio.run(run_company_context(llm, CompanyContextRequest(company_name="Acme"), exa=exa))
        assert out.known is False and out.basis == "none" and len(llm.calls) == 1


def test_known_company_never_searches_the_web():
    exa = FakeExa(RESULTS)
    out = asyncio.run(run_company_context(SequenceLLM(known()), CompanyContextRequest(company_name="Acme Payments"), exa=exa))
    assert out.basis == "model_knowledge" and not exa.queries
