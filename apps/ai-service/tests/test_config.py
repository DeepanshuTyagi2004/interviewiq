"""Self-check that pipeline settings load. Run: python -m tests.test_config"""
import os


def _base_env():
    os.environ.setdefault("EXA_API_KEY", "x")
    os.environ.setdefault("MONGODB_URL", "mongodb://localhost")
    os.environ.setdefault("INTERNAL_API_KEY", "x")
    os.environ.setdefault("LLM_API_KEY", "g")
    os.environ.setdefault("LLM_MODEL_NAME", "gemma-3-27b-it")


def test_settings_load_llm_and_search():
    _base_env()
    from app.config import Settings
    s = Settings()
    assert s.llm_model == "gemma-3-27b-it"
    assert s.exa_num_results == 10           # results per query variant
    assert s.exa_type == "auto"
    assert s.exa_user_location == "IN"
    assert s.extract_concurrency == 2
    assert isinstance(s.llm_capture_thoughts, bool)   # debug flag loads + coerces (default False)
    assert s.exa_include_domains == []   # open web by default (no domain restriction)
    assert "prepfully.com" in s.exa_exclude_domains   # content-farm deny-list ships with defaults


def test_include_domains_accepts_comma_string():
    os.environ["EXA_INCLUDE_DOMAINS"] = "foo.com, bar.com"
    _base_env()
    from app.config import Settings
    s = Settings()
    assert s.exa_include_domains == ["foo.com", "bar.com"]
    del os.environ["EXA_INCLUDE_DOMAINS"]


def test_exclude_domains_overridable_via_env():
    os.environ["EXA_EXCLUDE_DOMAINS"] = "spammy.com, junk.io"
    _base_env()
    from app.config import Settings
    s = Settings()
    assert s.exa_exclude_domains == ["spammy.com", "junk.io"]   # env replaces defaults
    del os.environ["EXA_EXCLUDE_DOMAINS"]


def test_llm_api_keys_split_comma():
    os.environ["LLM_API_KEY"] = "k1, k2 ,k3"
    _base_env()
    from app.config import Settings
    s = Settings()
    assert s.llm_api_keys == ["k1", "k2", "k3"]   # trimmed, blanks dropped
    os.environ["LLM_API_KEY"] = "g"   # restore single-key default for other tests


if __name__ == "__main__":
    test_settings_load_llm_and_search()
    test_include_domains_accepts_comma_string()
    test_exclude_domains_overridable_via_env()
    test_llm_api_keys_split_comma()
    print("ok")
