"""Test bootstrap: set the required env vars (via setdefault, so tests that set their own win)
before any Settings() is constructed. Lets get_settings() succeed in tests that touch config
indirectly (obs spans, the prep pipeline), mirroring test_config._base_env(). No real services are
contacted — these are dummy values.
"""
import os

# Values MUST match tests/test_config.py::_base_env so both agree on the loaded settings.
os.environ.setdefault("EXA_API_KEY", "x")
os.environ.setdefault("MONGODB_URL", "mongodb://localhost")
os.environ.setdefault("INTERNAL_API_KEY", "x")
os.environ.setdefault("LLM_API_KEY", "g")
os.environ.setdefault("LLM_MODEL_NAME", "gemma-3-27b-it")
os.environ.setdefault("LIVEKIT_URL", "wss://test.livekit.cloud")
os.environ.setdefault("LIVEKIT_API_KEY", "test-lk-key")
os.environ.setdefault("LIVEKIT_API_SECRET", "test-lk-secret")
os.environ.setdefault("DEEPGRAM_API_KEY", "test-dg-key")
