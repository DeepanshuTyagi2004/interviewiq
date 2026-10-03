import pytest
from pydantic import ValidationError

from app.config import Settings


def _settings(**kwargs):
    return Settings(
        _env_file=None, EXA_API_KEY="test-exa", MONGODB_URL="mongodb://localhost/test",
        INTERNAL_API_KEY="test-internal", LLM_API_KEY="test-google", LLM_MODEL_NAME="test-model",
        LIVEKIT_URL="wss://test.livekit.cloud", LIVEKIT_API_KEY="test-livekit",
        LIVEKIT_API_SECRET="test-secret", DEEPGRAM_API_KEY="test-deepgram", **kwargs,
    )


@pytest.fixture(autouse=True)
def clear_groq_environment(monkeypatch):
    for name in ("GROQ_API_KEY", "GROQ_MODEL_NAME", "GROQ_FALLBACK_MODELS", "GROQ_BASE_URL", "GROQ_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)


def test_groq_optional_defaults(monkeypatch):
    settings = _settings()
    assert settings.groq_api_keys == []
    assert settings.groq_model == "openai/gpt-oss-120b"
    assert settings.groq_fallback_models == []
    assert settings.groq_base_url == "https://api.groq.com/openai/v1"
    assert settings.groq_timeout_seconds == 30


@pytest.mark.parametrize("keys,expected", [
    (" , ", []), (" one, two ,one,, two,three ", ["one", "two", "three"]),
    ([" one ", "", "one", "two"], ["one", "two"]),
])
def test_groq_keys_trim_deduplicate_and_drop_blanks(keys, expected):
    assert _settings(GROQ_API_KEY=keys).groq_api_keys == expected


@pytest.mark.parametrize("models,expected", [
    (" , ", []),
    (" openai/gpt-oss-20b, other-model ,openai/gpt-oss-20b,, ", ["openai/gpt-oss-20b", "other-model"]),
    ([" other-model ", "", "other-model", "openai/gpt-oss-20b"], ["other-model", "openai/gpt-oss-20b"]),
])
def test_groq_fallback_models_trim_deduplicate_and_preserve_order(models, expected):
    settings = _settings(GROQ_MODEL_NAME="primary-model", GROQ_FALLBACK_MODELS=models)
    assert settings.groq_fallback_models == expected
    assert settings.groq_model == "primary-model"


def test_groq_env_aliases(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "example-one, example-two,example-one")
    monkeypatch.setenv("GROQ_MODEL_NAME", "example-model")
    monkeypatch.setenv("GROQ_FALLBACK_MODELS", " example-backup, other-backup,example-backup ")
    monkeypatch.setenv("GROQ_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("GROQ_TIMEOUT_SECONDS", "2.5")
    settings = _settings()
    assert settings.groq_api_keys == ["example-one", "example-two"]
    assert settings.groq_model == "example-model"
    assert settings.groq_fallback_models == ["example-backup", "other-backup"]
    assert settings.groq_base_url == "https://example.test/v1"
    assert settings.groq_timeout_seconds == 2.5


@pytest.mark.parametrize("value", [0, -1, "NaN", "Infinity"])
def test_groq_timeout_must_be_positive_and_finite(value):
    with pytest.raises(ValidationError):
        _settings(GROQ_TIMEOUT_SECONDS=value)
