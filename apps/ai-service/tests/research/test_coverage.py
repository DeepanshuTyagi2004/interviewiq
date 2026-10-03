"""Coverage, follow-up searches and the profile/compensation nodes (evidence-hardening §12)."""
import asyncio
import json

from app.exa.client import ExaError
from app.research.coverage import coverage, filled, plan_followups, role_missing
from app.research.memory_store import InMemoryResearchStore
from app.research.models import field, unavailable
from app.research.nodes.compensation import compensation
from app.research.nodes.profile import profile
from app.research.normalize.merge import ctc_observations, ctc_range, observations_field
from tests.research.fakes import FakeExa, FakeLLM, result
from tests.research.helpers import MEESHO, make_runner, wired_deps

E = field("x", confidence="low", provenance="evidence")
U = unavailable("none")


def test_coverage_counts_profile_culture_and_six_paths_per_role():
    snapshot = {
        "profile": {"sector": E, "business_model": U, "hq": E, "headcount_band": U, "revenue_band": U, "funding_stage": E},
        "compensation": {"wlb_rating": U, "review_summary": E},
        "roles": [{"role_key": "sde", "yoe_min": E, "jd": E, "required_skills": U, "ctc_min_lpa": U,
                   "interview_process": U, "reported_interview_process": E}],
    }
    out = coverage(snapshot)
    assert (out["filled"], out["total"]) == (7, 14)
    assert out["missing"] == ["profile.business_model", "profile.headcount_band", "profile.revenue_band",
                              "compensation.wlb_rating", "roles[sde].required_skills", "roles[sde].ctc_min_lpa",
                              "roles[sde].ctc_observations"]


def test_reported_pay_coverage_does_not_fill_verified_total_ctc_or_invent_unknown_fields():
    claims = [{"field": "ctc_min_lpa", "value": 27, "url": "https://pay.example/x", "tier": 3,
               "date": None, "quote": "27 LPA", "unit": "INR_LPA", "basis": "lpa_unspecified"}]
    low, high, count = ctc_range(claims)
    row = {"role_key": "unknown-sde", "level": U, "yoe_min": E, "yoe_max": U, "ctc_min_lpa": low,
           "ctc_max_lpa": high, "ctc_source_count": count, "ctc_observations": observations_field(ctc_observations(claims))}
    out = coverage({"roles": [row]})
    assert "roles[unknown-sde].ctc_min_lpa" in out["missing"]
    assert "roles[unknown-sde].ctc_observations" not in out["missing"]
    assert out["filled"] == 2 and out["total"] == 14
    assert row["level"]["value"] is row["yoe_max"]["value"] is None
    assert plan_followups(role_missing(row), {"ctc_min_lpa": "total CTC"}, 1) == ["total CTC"]


def test_empty_or_inferred_fields_do_not_count_as_supported_coverage():
    for value in (None, "", [], {}):
        assert not filled(field(value, confidence="low", provenance="evidence"))
    for provenance in ("template", "inferred_from_similar", "unavailable"):
        assert not filled(field(27, confidence="low", provenance=provenance))
    assert filled(field(0, confidence="medium", provenance="evidence"))


def test_interview_is_covered_by_either_official_or_reported_evidence():
    assert "interview" in role_missing({"interview_process": U, "reported_interview_process": U})
    assert "interview" not in role_missing({"interview_process": E, "reported_interview_process": U})


def test_missing_sections_count_as_missing():
    assert coverage({"identity": {}})["filled"] == 0 and coverage({"identity": {}})["total"] == 8


def test_followup_plan_deduplicates_shared_queries_and_respects_the_cap():
    shared = ("{name} company profile", None)
    templates = {"sector": shared, "hq": shared, "headcount_band": ("{name} number of employees", None),
                 "revenue_band": ("{name} revenue", None)}
    assert plan_followups(["sector", "hq", "headcount_band", "revenue_band"], templates, 2) == [
        shared, ("{name} number of employees", None)]
    assert plan_followups(["sector"], templates, 0) == []


MAIN = "Meesho is an e-commerce product company. Headquarters: Bengaluru. Funding stage: Series D."
HEADCOUNT = "Meesho has 1,000 employees across India."


def _claim(name, value, quote):
    return {"field": name, "value": value, "quote": quote, "geo": "IN", "geo_quote": "", "role_title": None, "unit": None}


def _profile_clients(overview_fails=False):
    def search(q):
        followup = "overview products services" in q
        if followup and overview_fails:
            raise ExaError("Exa returned 500")
        if followup:
            return [result("https://overview.example/meesho", title="Meesho overview", content=MAIN)]
        return [result("https://about.example/meesho", title="Meesho profile", content=MAIN)]

    def extract(system, user, label):
        url = json.loads(user)["source"]["url"]
        if url == "https://overview.example/meesho":
            return {"claims": [_claim("overview", MAIN, MAIN)]}
        return {"claims": [_claim("sector", "e-commerce", MAIN), _claim("hq", "Bengaluru", MAIN),
                           _claim("funding_round", "Series D", "Funding stage: Series D.")]}
    return FakeExa(search), FakeLLM(extract)


def test_funding_round_is_kept_and_maps_to_a_derived_stage(tmp_path):
    async def go():
        exa, llm = _profile_clients()
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=llm)
        out = await profile(state, deps)
        await tracer.close()
        assert out["profile"]["funding_round"]["value"] == "Series D"
        stage = out["profile"]["funding_stage"]
        assert stage["value"] == "late-stage" and stage["provenance"] == "derived"
        assert out["profile"]["unverified"] == [] and out["followups_used"] == 0
    asyncio.run(go())


def test_profile_followup_fills_only_overview_within_one_query_cap(tmp_path):
    async def go():
        exa, llm = _profile_clients()
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=llm)
        deps.settings = deps.settings.model_copy(update={"research_followup_max_queries": 6})
        out = await profile(state, deps)
        await tracer.close()
        assert out["profile"]["overview"]["value"] == MAIN
        assert out["profile"]["headcount_band"]["provenance"] == "unavailable"
        assert out["followups_used"] == 1
        assert exa.calls == ["Meesho company overview products business model", "Meesho company overview products services"]
    asyncio.run(go())


def test_a_failed_followup_keeps_the_main_result_and_is_noted(tmp_path):
    async def go():
        exa, llm = _profile_clients(overview_fails=True)
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=llm)
        deps.settings = deps.settings.model_copy(update={"research_followup_max_queries": 1})
        out = await profile(state, deps)
        await tracer.close()
        assert out["profile"]["sector"]["value"] == "e-commerce"
        assert any("follow-up" in n for n in out["notes"])
    asyncio.run(go())


def test_followup_budget_is_shared_across_the_company(tmp_path):
    async def go():
        exa, llm = _profile_clients()
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=exa, llm=llm)
        deps.settings = deps.settings.model_copy(update={"research_followup_max_queries": 6})
        out = await profile({**state, "followups_used": 6}, deps)
        await tracer.close()
        assert out["followups_used"] == 6 and out["profile"]["headcount_band"]["provenance"] == "unavailable"
    asyncio.run(go())


CULTURE = "Meesho reviews. Work-life balance 3.7. Flexible hours and helpful colleagues in Bengaluru."


def test_compensation_uses_review_platform_scale_and_keeps_unverified(tmp_path):
    async def go():
        blind = result("https://www.teamblind.com/company/meesho", title="Meesho Reviews", content="Meesho: 3.9 Work Life Balance")

        def search(q):
            return [result("https://www.ambitionbox.com/reviews/meesho", title="Meesho Reviews", content=CULTURE), blind]

        def extract(system, user, label):
            url = json.loads(user)["source"]["url"]
            if "teamblind" in url:
                return {"claims": [{**_claim("wlb_rating", 3.9, "3.9 Work Life Balance"), "geo": "unknown"}]}
            return {"claims": [_claim("wlb_rating", 3.7, "Work-life balance 3.7"),
                               _claim("review_quote", "Flexible hours and helpful colleagues", CULTURE)]}
        deps, tracer, state = await wired_deps(InMemoryResearchStore(), tmp_path, exa=FakeExa(search), llm=FakeLLM(extract))
        out = await compensation(state, deps)
        await tracer.close()
        section = out["compensation"]
        assert section["wlb_rating"]["value"] == 3.7 and section["wlb_rating"]["alternatives"] == []
        assert section["review_quotes"]["value"][0]["sourceUrl"] == "https://www.ambitionbox.com/reviews/meesho"
        assert [u["reason"] for u in section["unverified"]] == ["geo_unconfirmed"]
    asyncio.run(go())


def test_draft_item_and_company_state_carry_coverage(tmp_path):
    async def go():
        store = InMemoryResearchStore()
        runner, _ = make_runner(store, tmp_path, targets=[MEESHO])
        run = await runner.start_run(trigger="admin", scope="all")
        await runner.wait_idle()
        (item,) = await store.list_items(run["run_id"])
        draft = await store.get_draft(item["draft_id"])
        assert (draft["coverage"]["filled"], draft["coverage"]["total"]) == (0, 7)
        assert all(p.startswith("profile.") for p in draft["coverage"]["missing"])
        assert item["coverage"] == {"filled": 0, "total": 7}
        (state,) = await store.list_company_states()
        assert state["latest_draft_coverage"] == {"filled": 0, "total": 7}
    asyncio.run(go())
