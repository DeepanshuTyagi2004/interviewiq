from app.config import get_settings


def test_deepgram_api_key_present():
    assert get_settings().deepgram_api_key   # conftest sets a dummy so this loads offline
