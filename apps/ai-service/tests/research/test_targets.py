import asyncio

import httpx
import pytest

import app.research.targets as targets_mod
from app.config import Settings
from app.research.targets import ResearchTarget, TargetsUnavailable, fetch_research_targets

REAL_CLIENT = httpx.AsyncClient


def _patch(monkeypatch, handler):
    monkeypatch.setattr(targets_mod.httpx, "AsyncClient",
                        lambda **kw: REAL_CLIENT(transport=httpx.MockTransport(handler), **kw))


def test_fetch_parses_rows_sends_the_internal_key_and_skips_malformed(monkeypatch):
    seen = {}

    def handler(req):
        seen["url"], seen["key"] = str(req.url), req.headers.get("x-internal-api-key")
        return httpx.Response(200, json=[
            {"id": "c1", "name": "Meesho", "slug": "meesho", "website": None, "aliases": ["Fashnear"]},
            {"name": "no id"},
        ])
    _patch(monkeypatch, handler)
    settings = Settings(_env_file=None).model_copy(update={"api_base_url": "http://api.test", "internal_api_key": "k"})
    got = asyncio.run(fetch_research_targets(settings))
    assert got == [ResearchTarget(id="c1", name="Meesho", slug="meesho", website=None, aliases=("Fashnear",))]
    assert seen == {"url": "http://api.test/api/v1/internal/research-targets", "key": "k"}


def test_fetch_failure_raises_targets_unavailable(monkeypatch):
    _patch(monkeypatch, lambda req: httpx.Response(503, text="down"))
    with pytest.raises(TargetsUnavailable, match="research-targets"):
        asyncio.run(fetch_research_targets(Settings(_env_file=None)))
