"""FIELD_SPECS is the single source for prompt field docs and validation (evidence-hardening §7.1)."""
from app.prompts.research import company_compensation, company_profile, company_roles
from app.prompts.research.evidence import system_for
from app.research.fields import FIELD_SPECS, NUMERIC, TIME_SENSITIVE, fields_for, render_field_docs


def test_sections_carry_the_new_fields():
    assert "funding_round" in fields_for("profile")
    assert set(fields_for("culture")) == {"wlb_rating", "wlb_review_count", "review_summary", "review_quote"}
    assert {"employment_type", "required_skill", "preferred_skill", "tech_stack", "location"} <= set(fields_for("roles"))


def test_india_only_follows_the_section():
    assert not any(FIELD_SPECS[f].india_only for f in fields_for("profile"))
    assert all(FIELD_SPECS[f].india_only for f in (*fields_for("culture"), *fields_for("roles")))


def test_numeric_and_time_sensitive_sets():
    assert NUMERIC == {"wlb_rating", "wlb_review_count", "yoe_min", "yoe_max", "ctc_min_lpa", "ctc_max_lpa"}
    assert {"ctc_min_lpa", "wlb_rating", "funding_stage", "interview_process"} <= TIME_SENSITIVE
    assert "title" not in TIME_SENSITIVE


def test_rendered_docs_list_every_field_with_its_allowed_values():
    docs = render_field_docs(("funding_stage", "employment_type"))
    assert "funding_stage" in docs and "late-stage" in docs
    assert "employment_type" in docs and "full_time" in docs


def test_system_prompt_keeps_the_untrusted_data_rule_and_documents_only_its_fields():
    system = system_for(company_profile.FIELDS)
    assert "UNTRUSTED DATA" in system and " … " in system
    assert "funding_round" in system and "required_skill" not in system


def test_prompt_modules_are_versioned_drafts_with_targeted_query_lists():
    for module in (company_profile, company_compensation, company_roles):
        assert module.PROMPT_VERSION == ("v3-overview-draft" if module is company_profile else "v2-draft")
        assert len(module.QUERIES) >= 2
        assert all(isinstance(q, str) and "{name}" in q for q, _ in module.QUERIES)
    assert any(include == "company_domain" for _, include in company_roles.QUERIES)
    assert len(company_roles.DETAIL_QUERIES) == 3
    assert all("{title}" in q for q, _ in company_roles.DETAIL_QUERIES)
    assert set(company_roles.ROLE_FOLLOWUPS) == {"yoe_min", "jd", "required_skills", "ctc_min_lpa", "interview"}
