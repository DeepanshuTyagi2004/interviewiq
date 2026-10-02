from app.config import Settings
from app.research.trace.redact import redact, secrets_from_settings

SECRETS = {"EXA_API_KEY": "exa-secret-123"}


def test_redacts_secret_values_wherever_they_appear():
    out = redact({"msg": "401 for key exa-secret-123!", "nested": [{"k": "exa-secret-123"}]}, SECRETS)
    assert out == {"msg": "401 for key «redacted:EXA_API_KEY»!", "nested": [{"k": "«redacted:EXA_API_KEY»"}]}


def test_redacts_auth_headers_by_name_case_insensitively():
    out = redact({"Authorization": "Bearer abc", "X-Internal-Api-Key": "k", "x-api-key": "e", "Accept": "json"}, {})
    assert out == {
        "Authorization": "«redacted:header»", "X-Internal-Api-Key": "«redacted:header»",
        "x-api-key": "«redacted:header»", "Accept": "json",
    }


def test_leaves_non_string_scalars_alone():
    assert redact({"n": 42, "b": True, "none": None, "f": 1.5}, SECRETS) == {"n": 42, "b": True, "none": None, "f": 1.5}


def test_tuples_become_lists_and_input_is_not_mutated():
    original = {"t": ("exa-secret-123", 1)}
    assert redact(original, SECRETS) == {"t": ["«redacted:EXA_API_KEY»", 1]}
    assert original == {"t": ("exa-secret-123", 1)}


def test_secrets_from_settings_names_each_llm_key_and_skips_short_values(monkeypatch):
    monkeypatch.setenv("EXA_API_KEY", "exa-long-key")
    monkeypatch.setenv("LLM_API_KEY", "key-one-long,key-two-long")
    monkeypatch.setenv("INTERNAL_API_KEY", "x")  # too short to redact safely: matching "x" would shred text
    names = secrets_from_settings(Settings(_env_file=None))
    assert names == {"EXA_API_KEY": "exa-long-key", "LLM_API_KEY#0": "key-one-long", "LLM_API_KEY#1": "key-two-long"}
