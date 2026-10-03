"""Persona `gender` field: normalization on InterviewerPersona/PersonaAndArc, the persona prompt
asking the model for it, and the PREP_PLAN_VERSION bump that invalidates cached plans so they
regenerate carrying the new field."""
from app.config import get_settings
from app.interview_prep.prompts import persona
from app.interview_prep.schema import InterviewerPersona, PersonaAndArc


def _persona(**kwargs):
    return InterviewerPersona(name="Sam", seniority="Senior SWE", disposition="warm", **kwargs)


def test_gender_normalizes_common_male_synonyms():
    assert _persona(gender="Male").gender == "male"
    assert _persona(gender="M").gender == "male"
    assert _persona(gender="man").gender == "male"


def test_gender_normalizes_common_female_synonyms():
    assert _persona(gender="F").gender == "female"
    assert _persona(gender="woman").gender == "female"
    assert _persona(gender="she").gender == "female"


def test_gender_normalizes_neutral_synonyms():
    assert _persona(gender="nonbinary").gender == "neutral"
    assert _persona(gender="neutral").gender == "neutral"
    assert _persona(gender="they").gender == "neutral"


def test_gender_junk_value_becomes_none():
    assert _persona(gender="xyz").gender is None


def test_gender_missing_defaults_to_none():
    assert _persona().gender is None


def test_gender_none_stays_none():
    assert _persona(gender=None).gender is None


def test_gender_accepts_camel_case_input():
    p = InterviewerPersona.model_validate({"name": "Sam", "seniority": "Senior SWE",
                                            "disposition": "warm", "gender": "Female"})
    assert p.gender == "female"


def test_persona_and_arc_roundtrips_gender():
    parsed = PersonaAndArc.model_validate({
        "persona": {"name": "Priya", "seniority": "Staff Engineer", "disposition": "rigorous",
                    "gender": "female"},
        "round_arc": [],
    })
    assert parsed.persona.gender == "female"
    doc = parsed.model_dump(by_alias=True, mode="json")
    assert doc["persona"]["gender"] == "female"


def test_persona_prompt_asks_for_gender():
    assert "gender" in persona.PERSONA_SYSTEM or "gender" in persona._SCHEMA


def test_persona_prompt_version_bumped():
    assert persona.PERSONA_PROMPT_VERSION == "v5-published-brief-draft"


def test_prep_plan_version_bumped():
    assert get_settings().prep_plan_version == "v4"
