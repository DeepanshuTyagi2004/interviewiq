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
