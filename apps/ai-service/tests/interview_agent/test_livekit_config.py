from app.config import get_settings


def test_livekit_settings_present():
    s = get_settings()
    # conftest sets dummy LIVEKIT_* values so get_settings() succeeds offline
    assert s.livekit_url
    assert s.livekit_api_key
    assert s.livekit_api_secret
    # existing infra reused by the worker
    assert s.internal_api_key
    assert s.api_base_url
