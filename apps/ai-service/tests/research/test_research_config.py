import pytest
from pydantic import ValidationError

from app.config import Settings


def test_research_defaults():
    s = Settings(_env_file=None)
    assert s.research_enabled is True
    assert s.research_cron == "0 2 * * mon"
    assert s.research_mode == "live"
    assert s.research_fixtures_dir == ".research-fixtures"
    assert (s.research_concurrency, s.research_results_per_query, s.research_max_roles) == (2, 5, 8)
    assert (s.research_max_exa_calls, s.research_max_llm_calls) == (400, 2000)
    assert (s.research_stale_after_days, s.research_max_attempts, s.research_trace_ttl_days) == (7, 2, 14)


def test_research_mode_must_be_known(monkeypatch):
    monkeypatch.setenv("RESEARCH_MODE", "dry-run")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize("name,value", [
    ("RESEARCH_LLM_DEADLINE_SECONDS", "0"),
    ("RESEARCH_OPERATION_TIMEOUT_SECONDS", "nan"),
    ("RESEARCH_GROQ_STAGE_SECONDS", "-1"),
    ("RESEARCH_GOOGLE_TIMEOUT_SECONDS", "inf"),
    ("RESEARCH_MAX_OUTPUT_TOKENS", "0"),
    ("RESEARCH_GROQ_TPM", "0"),
    ("RESEARCH_GROQ_RPM", "0"),
    ("RESEARCH_CHUNK_CHARS", "999"),
    ("RESEARCH_MAX_CHUNKS", "0"),
])
def test_research_request_limits_reject_invalid_values(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
