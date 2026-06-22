import asyncio
import app.api.admin as admin_mod
from app.api.deps import require_internal_key
from app.main import app


def _bypass_auth():
    app.dependency_overrides[require_internal_key] = lambda: True


def test_collect_endpoint_starts_run(monkeypatch):
    try:
        _bypass_auth()
        captured = {}
        monkeypatch.setattr(
            admin_mod.RUN_STORE,
            "start",
            lambda rid, trigger: captured.setdefault("rid", rid) or True,
        )
        async def _noop_bg(settings, rid):
            pass
        monkeypatch.setattr(admin_mod, "_background_collection", _noop_bg)
        # avoid scheduling a real bg task:
        monkeypatch.setattr(admin_mod.asyncio, "create_task", lambda coro: coro.close() or None)
        result = asyncio.run(admin_mod.trigger_question_collection())
        assert result["status"] == "running"
        assert result["already_running"] is False
        assert "run_id" in result and result["run_id"]
    finally:
        app.dependency_overrides.clear()


def test_collect_endpoint_already_running(monkeypatch):
    try:
        _bypass_auth()
        # Simulate a run already in progress: start returns False.
        monkeypatch.setattr(
            admin_mod.RUN_STORE,
            "start",
            lambda rid, trigger: False,
        )
        monkeypatch.setattr(admin_mod.RUN_STORE, "run_id", "existing-run-123", raising=False)
        monkeypatch.setattr(admin_mod.RUN_STORE, "status", "running", raising=False)
        result = asyncio.run(admin_mod.trigger_question_collection())
        assert result["already_running"] is True
        assert result["status"] == admin_mod.RUN_STORE.status
    finally:
        app.dependency_overrides.clear()
