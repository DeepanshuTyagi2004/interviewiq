import asyncio
import app.api.admin as admin_mod
from app.api.deps import require_internal_key
from app.main import app


def _bypass_auth():
    app.dependency_overrides[require_internal_key] = lambda: True


def test_collect_endpoint_starts_run(monkeypatch):
    _bypass_auth()
    started = {}
    monkeypatch.setattr(admin_mod.RUN_STORE, "start", lambda rid, trigger: started.setdefault("rid", rid) or True)
    async def _noop_bg(settings, rid): pass
    monkeypatch.setattr(admin_mod, "_background_collection", _noop_bg)
    # avoid scheduling a real bg task:
    monkeypatch.setattr(admin_mod.asyncio, "create_task", lambda coro: coro.close() or None)
    result = asyncio.run(admin_mod.trigger_question_collection())
    assert result["status"] == "running"
    app.dependency_overrides.clear()
