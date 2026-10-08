import pytest
from pydantic import ValidationError

from app.config import Settings


@pytest.fixture(autouse=True)
def clear_cloudflare_environment(monkeypatch):
    for name in ("API_TOKEN", "ACCOUNT_ID", "MODEL_NAME", "TIMEOUT_SECONDS", "MAX_TOKENS"):
        monkeypatch.delenv(f"CLOUDFLARE_{name}", raising=False)


def _settings(**kwargs):
    return Settings(
        _env_file=None, EXA_API_KEY="test-exa", MONGODB_URL="mongodb://localhost/test",
        INTERNAL_API_KEY="test-internal", LLM_API_KEY="test-google", LLM_MODEL_NAME="test-model", **kwargs,
    )


def test_cloudflare_disabled_defaults():
    settings = _settings()
    assert settings.cloudflare_api_token == settings.cloudflare_account_id == ""
    assert settings.cloudflare_model == "@cf/openai/gpt-oss-120b"
    assert settings.cloudflare_timeout_seconds == 30
    assert settings.cloudflare_max_tokens == 4096


def test_cloudflare_environment_aliases_and_trimming(monkeypatch):
    for name, value in {
        "API_TOKEN": " dummy-cloudflare-token ", "ACCOUNT_ID": " Account123 ",
        "MODEL_NAME": " @cf/test/model ", "TIMEOUT_SECONDS": "2.5", "MAX_TOKENS": "2048",
    }.items():
        monkeypatch.setenv(f"CLOUDFLARE_{name}", value)
    settings = _settings()
    assert settings.cloudflare_api_token == "dummy-cloudflare-token"
    assert settings.cloudflare_account_id == "Account123"
    assert settings.cloudflare_model == "@cf/test/model"
    assert settings.cloudflare_timeout_seconds == 2.5
    assert settings.cloudflare_max_tokens == 2048
    assert "dummy-cloudflare-token" not in repr(settings)


@pytest.mark.parametrize("kwargs", [
    {"CLOUDFLARE_API_TOKEN": "dummy-token"}, {"CLOUDFLARE_ACCOUNT_ID": "Account123"},
    {"CLOUDFLARE_API_TOKEN": "dummy-token", "CLOUDFLARE_ACCOUNT_ID": " "},
])
def test_cloudflare_partial_configuration_rejected(kwargs):
    with pytest.raises(ValidationError, match="configured together"):
        _settings(**kwargs)


@pytest.mark.parametrize("account", ["../other", "id/other", "id?query", "id#fragment", "id%2fother", "id space", "ábc"])
def test_account_rejects_path_injection_and_non_ascii(account):
    with pytest.raises(ValidationError):
        _settings(CLOUDFLARE_API_TOKEN="dummy-token", CLOUDFLARE_ACCOUNT_ID=account)


@pytest.mark.parametrize("value", [0, -1, "NaN", "Infinity", "-Infinity"])
def test_cloudflare_timeout_positive_finite(value):
    with pytest.raises(ValidationError):
        _settings(CLOUDFLARE_TIMEOUT_SECONDS=value)


@pytest.mark.parametrize("value", [0, -1, 24001, 1.5, "NaN"])
def test_cloudflare_token_budget_integer_and_bounded(value):
    with pytest.raises(ValidationError):
        _settings(CLOUDFLARE_MAX_TOKENS=value)


def test_blank_credentials_disable_and_blank_model_is_invalid():
    assert _settings(CLOUDFLARE_API_TOKEN=" ", CLOUDFLARE_ACCOUNT_ID=" ").cloudflare_api_token == ""
    with pytest.raises(ValidationError):
        _settings(CLOUDFLARE_MODEL_NAME=" ")
