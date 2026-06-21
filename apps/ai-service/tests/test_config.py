"""Self-check that new pipeline settings load. Run: python -m tests.test_config"""
import os


def test_settings_load_groq_and_search():
    os.environ.setdefault("PERPLEXITY_API_KEY", "x")
    os.environ.setdefault("PERPLEXITY_MODEL", "sonar")
    os.environ.setdefault("MONGODB_URL", "mongodb://localhost")
    os.environ.setdefault("INTERNAL_API_KEY", "x")
    os.environ.setdefault("GROQ_API_KEY", "g")
    from app.config import Settings
    s = Settings()
    assert s.groq_model == "qwen/qwen3-32b"
    assert s.collect_max_results == 20
    assert s.extract_concurrency == 8
    assert s.perplexity_search_domains == []   # open web by default (no domain restriction)


def test_search_domains_accepts_comma_string():
    import os
    os.environ["PERPLEXITY_SEARCH_DOMAINS"] = "foo.com, bar.com"
    os.environ.setdefault("PERPLEXITY_API_KEY", "x")
    os.environ.setdefault("PERPLEXITY_MODEL", "sonar")
    os.environ.setdefault("MONGODB_URL", "mongodb://localhost")
    os.environ.setdefault("INTERNAL_API_KEY", "x")
    os.environ.setdefault("GROQ_API_KEY", "g")
    from app.config import Settings
    s = Settings()
    assert s.perplexity_search_domains == ["foo.com", "bar.com"]
    del os.environ["PERPLEXITY_SEARCH_DOMAINS"]


if __name__ == "__main__":
    test_settings_load_groq_and_search()
    test_search_domains_accepts_comma_string()
    print("ok")
