## Task 5: LLM raw result, fixtures, budget and the ResearchIO gateway

**Files:**
- Modify: `apps/ai-service/app/llm/client.py`
- Create: `apps/ai-service/app/research/fixtures.py`, `apps/ai-service/app/research/budget.py`, `apps/ai-service/app/research/gateway.py`
- Test: `apps/ai-service/tests/llm/test_complete_full.py`, `apps/ai-service/tests/research/fakes.py`, `apps/ai-service/tests/research/test_gateway.py`

**Interfaces:**
- Consumes: Tracer (Task 4), store (Task 3), `Mode` (Task 1).
- Produces:
  - `LLMResult(data, thought, content, usage, latency_ms, key_index, attempts)` and `LLMClient.complete_full(system, user, *, label) -> LLMResult`.
  - `FixtureStore(root)` with:
    - `.read(company_slug, kind, request)`;
    - `.write(company_slug, kind, request, response) -> Path`;
    - `.path_for(...)`;
    - `FixtureStore.request_hash(request) -> str`.
  - `FixtureMissing`.
  - `Budget(store, run_id, *, exa_cap, llm_cap, exa_used=0, llm_used=0)` with:
    - `Budget.from_run(store, run)`;
    - `await .charge(kind)` (raises `BudgetExhausted(kind, used, cap)`);
    - `await .add_tokens(tokens_in, tokens_out)`;
    - `.set_caps(exa_cap=None, llm_cap=None)`.
  - `content_hash(text) -> "sha256:…"` and `extract_key(prompt_name, prompt_version, system, user) -> str`.
  - `ResearchIO(*, mode, exa, llm, fixtures, tracer, budget, store, settings)` with:
    - `await .search(query, *, company_slug, kind) -> list[{title, url, content, date}]`;
    - `await .extract_json(*, prompt_name, prompt_version, system, user, company_slug, label) -> dict`.

  Fakes for tests:
  - `FakeExa(respond: Callable[[str], list[dict]] | None = None, fail=None)` with `.calls`.
  - `FakeLLM(respond: Callable[[system, user, label], dict | Exception], on_call=None)` with `.calls`.
  - `result(url, title=..., content=..., date=None)` and `resolve_answer(name, website)`.

- [ ] **Step 1: Write the failing LLM test**

`apps/ai-service/tests/llm/test_complete_full.py`:

```python
"""complete_full() exposes what the research trace needs (raw content, token usage, which key,
how many attempts) without changing complete()'s (data, thought) contract."""
import asyncio
import json

import httpx

from app.llm.client import LLMClient


def _client(handler) -> LLMClient:
    llm = LLMClient(base_url="https://llm.test/v1", api_keys=["k0-long-key", "k1-long-key"], model="m", timeout_seconds=5)
    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return llm


def test_complete_full_returns_raw_content_usage_and_key_index():
    body = {"choices": [{"message": {"content": "<thought>hmm</thought>{\"a\": 1}"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3}}

    async def go():
        llm = _client(lambda req: httpx.Response(200, json=body))
        r = await llm.complete_full("sys", "user", label="t")
        data, thought = await llm.complete("sys", "user", label="t")
        await llm.aclose()
        return r, data, thought

    r, data, thought = asyncio.run(go())
    assert r.data == {"a": 1} and r.thought == "hmm"
    assert r.content == body["choices"][0]["message"]["content"]
    assert r.usage == {"prompt_tokens": 11, "completion_tokens": 3}
    assert r.key_index == 0 and r.attempts == 1 and r.latency_ms >= 0
    assert (data, thought) == ({"a": 1}, "hmm")


def test_complete_full_counts_attempts_across_key_rotation():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(500, text="boom")
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"ok": True})}}]})

    async def go():
        llm = _client(handler)
        r = await llm.complete_full("s", "u", label="t")
        await llm.aclose()
        return r

    r = asyncio.run(go())
    assert r.data == {"ok": True} and r.attempts == 2 and r.key_index == 1 and r.usage == {}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/llm/test_complete_full.py -q`
Expected: FAIL with `AttributeError: 'LLMClient' object has no attribute 'complete_full'`.

- [ ] **Step 3: Refactor the LLM client**

In `apps/ai-service/app/llm/client.py`:

1. Add `from dataclasses import dataclass` to the imports.
2. Add this class above `class LLMClient`:

```python
@dataclass(frozen=True)
class LLMResult:
    """Everything one successful call produced. complete() keeps returning just (data, thought); the
    research trace uses complete_full() to also show the raw reply, token usage, key and attempts."""
    data: dict
    thought: str
    content: str
    usage: dict
    latency_ms: int
    key_index: int
    attempts: int
```

3. Rename `async def complete(self, system: str, user: str, *, label: str = "llm") -> tuple[dict, str]:` to `async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:`. Keep its docstring, and add one sentence: "Returns LLMResult; complete() is the (data, thought) shorthand."
4. Inside the success branch, replace `return data, thought` with:

```python
                            return LLMResult(
                                data=data, thought=thought, content=content, usage=_usage,
                                latency_ms=_llm_ms, key_index=key_i, attempts=attempt,
                            )
```

5. Add this method directly above `complete_full`:

```python
    async def complete(self, system: str, user: str, *, label: str = "llm") -> tuple[dict, str]:
        """One chat call returning (parsed JSON object, reasoning text). See complete_full()."""
        result = await self.complete_full(system, user, label=label)
        return result.data, result.thought
```

`complete_json` keeps calling `self.complete(...)`, so it is unchanged.

- [ ] **Step 4: Run the LLM tests**

Run: `.venv/bin/python -m pytest tests/llm tests/test_llm_helpers.py -q`
Expected: PASS.

- [ ] **Step 5: Write the fakes and the failing gateway tests**

`apps/ai-service/tests/research/fakes.py`:

```python
"""Test doubles for the two external clients ResearchIO wraps. Same method names and return shapes
as ExaClient.collect_sources and LLMClient.complete_full."""
from __future__ import annotations

import copy
import json
from collections.abc import Awaitable, Callable

from app.llm.client import LLMResult


def result(url: str, title: str = "Official site", content: str = "Company homepage text.", date: str | None = None) -> dict:
    return {"title": title, "url": url, "content": content, "date": date}


def resolve_answer(name: str, website: str | None) -> dict:
    return {"is_company": True, "canonical_name": name, "website": website, "aliases": [],
            "confidence": "high", "evidence_urls": [website] if website else [], "reasoning": "official site in results"}


class FakeExa:
    def __init__(self, respond: Callable[[str], list[dict]] | None = None, fail: Exception | None = None):
        self._respond = respond or (lambda q: [])
        self._fail = fail
        self.calls: list[str] = []

    async def collect_sources(self, queries, *, include_domains, exclude_domains):
        query = queries[0]
        self.calls.append(query)
        if self._fail is not None:
            raise self._fail
        return copy.deepcopy(self._respond(query))


class FakeLLM:
    def __init__(self, respond: Callable[[str, str, str], dict | Exception],
                 on_call: Callable[[str], Awaitable[None]] | None = None):
        self._respond = respond
        self._on_call = on_call
        self.calls: list[str] = []

    async def complete_full(self, system: str, user: str, *, label: str = "llm") -> LLMResult:
        self.calls.append(label)
        if self._on_call is not None:
            await self._on_call(label)
        data = self._respond(system, user, label)
        if isinstance(data, Exception):
            raise data
        return LLMResult(data=data, thought="", content=json.dumps(data),
                         usage={"prompt_tokens": 100, "completion_tokens": 20},
                         latency_ms=5, key_index=0, attempts=1)

    async def aclose(self) -> None:
        return None


class Exploding:
    """Stands in for a client that must never be called (replay mode)."""

    async def collect_sources(self, *a, **kw):
        raise AssertionError("Exa must not be called in replay mode")

    async def complete_full(self, *a, **kw):
        raise AssertionError("the LLM must not be called in replay mode")

    async def aclose(self) -> None:
        return None
```

`apps/ai-service/tests/research/test_gateway.py`:

```python
import asyncio

import pytest

from app.config import Settings
from app.research.budget import Budget, BudgetExhausted
from app.research.fixtures import FixtureMissing, FixtureStore
from app.research.gateway import ResearchIO
from app.research.memory_store import InMemoryResearchStore
from app.research.models import Mode
from app.research.store import EventFilter
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE
from app.research.trace.tracer import Tracer, utcnow
from tests.research.fakes import Exploding, FakeExa, FakeLLM, result


def _settings(**kw) -> Settings:
    return Settings(_env_file=None).model_copy(update={"research_results_per_query": 2, **kw})


async def _io(tmp_path, *, mode=Mode.LIVE, exa=None, llm=None, exa_cap=10, llm_cap=10, store=None):
    store = store or InMemoryResearchStore()
    if await store.get_run("run1") is None:
        await store.insert_run({"run_id": "run1", "status": "running", "last_seq": 0, "created_at": utcnow(),
                                "budget": {"exa_used": 0, "llm_used": 0, "tokens_in": 0, "tokens_out": 0}})
        await store.insert_items([{"run_id": "run1", "company_id": "c1", "position": 0, "nodes": {}}])
    tracer = Tracer(store, "run1", secrets={}, flush_interval=0.01)
    budget = Budget(store, "run1", exa_cap=exa_cap, llm_cap=llm_cap)
    io = ResearchIO(mode=mode, exa=exa, llm=llm, fixtures=FixtureStore(tmp_path / "fx"), tracer=tracer,
                    budget=budget, store=store, settings=_settings())
    return io, store, tracer


def _bind():
    return CURRENT_COMPANY.set("c1"), CURRENT_NODE.set("resolve")


def test_live_search_truncates_charges_budget_counts_per_node_and_remembers_sources(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com"), result("https://b.com"), result("https://c.com")])
        io, store, tracer = await _io(tmp_path, exa=exa)
        c, n = _bind()
        try:
            results = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        finally:
            CURRENT_NODE.reset(n)
            CURRENT_COMPANY.reset(c)
        await tracer.close()
        assert [r["url"] for r in results] == ["https://a.com", "https://b.com"]
        assert exa.calls == ["Meesho company"]
        run = await store.get_run("run1")
        assert run["budget"]["exa_used"] == 1
        (item,) = await store.list_items("run1")
        assert item["nodes"]["resolve"]["exa_calls"] == 1
        assert store.sources["https://a.com"]["kinds"] == ["resolve"]
        assert store.sources["https://a.com"]["content_hash"].startswith("sha256:")
        (span,) = await store.list_spans("run1")
        full = await store.get_span(span["span_id"])
        assert span["kind"] == "exa" and full["output"]["count"] == 2
    asyncio.run(go())


def test_record_then_replay_serves_identical_results_without_calling_exa(tmp_path):
    async def go():
        exa = FakeExa(lambda q: [result("https://a.com")])
        io, _, t1 = await _io(tmp_path, mode=Mode.RECORD, exa=exa)
        recorded = await io.search("Meesho company", company_slug="meesho", kind="resolve")
        await t1.close()
        io2, store2, t2 = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        replayed = await io2.search("Meesho company", company_slug="meesho", kind="resolve")
        await t2.close()
        assert replayed == recorded
        assert (await store2.get_run("run1"))["budget"]["exa_used"] == 0
        assert list((tmp_path / "fx" / "meesho").glob("exa-*.json"))
    asyncio.run(go())


def test_replay_miss_fails_loudly_with_how_to_fix(tmp_path):
    async def go():
        io, _, t = await _io(tmp_path, mode=Mode.REPLAY, exa=Exploding())
        with pytest.raises(FixtureMissing, match="RESEARCH_MODE=record"):
            await io.search("never recorded", company_slug="meesho", kind="resolve")
        await t.close()
    asyncio.run(go())


def test_extract_cache_reuses_identical_calls_and_emits_cache_hit(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 42})
        io, store, tracer = await _io(tmp_path, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="sys", user="user", company_slug="meesho", label="t")
        first = await io.extract_json(**kwargs)
        second = await io.extract_json(**kwargs)
        await tracer.close()
        assert first == second == {"answer": 42}
        assert llm.calls == ["t"]
        run = await store.get_run("run1")
        assert run["budget"]["llm_used"] == 1
        assert (run["budget"]["tokens_in"], run["budget"]["tokens_out"]) == (100, 20)
        events = await store.list_events("run1", EventFilter(type_prefix="cache.hit"))
        assert len(events) == 1
        llm_spans = [s for s in await store.list_spans("run1") if s["kind"] == "llm"]
        assert [s["attrs"]["cache"] for s in llm_spans] == ["miss", "hit"]
        assert llm_spans[0]["attrs"]["tokens_in"] == 100
    asyncio.run(go())


def test_record_mode_bypasses_the_extract_cache(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"answer": 1})
        io, _, tracer = await _io(tmp_path, mode=Mode.RECORD, llm=llm)
        kwargs = dict(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="meesho", label="t")
        await io.extract_json(**kwargs)
        await io.extract_json(**kwargs)
        await tracer.close()
        assert llm.calls == ["t", "t"]
    asyncio.run(go())


def test_exhausted_budget_raises_before_any_call(tmp_path):
    async def go():
        llm = FakeLLM(lambda s, u, label: {"a": 1})
        io, _, tracer = await _io(tmp_path, llm=llm, llm_cap=0)
        with pytest.raises(BudgetExhausted) as caught:
            await io.extract_json(prompt_name="p", prompt_version="v1", system="s", user="u", company_slug="m", label="t")
        await tracer.close()
        assert caught.value.kind == "llm" and llm.calls == []
    asyncio.run(go())
```

- [ ] **Step 6: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/research/test_gateway.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.research.budget'`.

- [ ] **Step 7: Implement fixtures, budget and the gateway**

`apps/ai-service/app/research/fixtures.py`:

```python
"""Record / replay store for research I/O (spec §12.2). `record` writes every Exa and LLM response
as <root>/<company-slug>/<kind>-<request-hash>.json; `replay` serves only from those files and
fails loudly on a miss. Keyed by a hash of the canonical request, so a changed query, prompt or
model is a different fixture."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.research.trace.tracer import utcnow


class FixtureMissing(RuntimeError):
    """Replay asked for a response that was never recorded."""


class FixtureStore:
    def __init__(self, root: str | Path):
        self._root = Path(root)

    @staticmethod
    def request_hash(request: dict) -> str:
        canonical = json.dumps(request, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()[:20]

    def path_for(self, company_slug: str, kind: str, request: dict) -> Path:
        return self._root / company_slug / f"{kind}-{self.request_hash(request)}.json"

    def read(self, company_slug: str, kind: str, request: dict) -> Any:
        path = self.path_for(company_slug, kind, request)
        if not path.exists():
            raise FixtureMissing(
                f"no recorded {kind} response for {company_slug} at {path}; "
                f"run this company once with RESEARCH_MODE=record to capture it"
            )
        return json.loads(path.read_text(encoding="utf-8"))["response"]

    def write(self, company_slug: str, kind: str, request: dict, response: Any) -> Path:
        path = self.path_for(company_slug, kind, request)
        path.parent.mkdir(parents=True, exist_ok=True)
        doc = {"recorded_at": utcnow().isoformat(), "request": request, "response": response}
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        return path
```

`apps/ai-service/app/research/budget.py`:

```python
"""Per-run call caps (spec §5.3). charge() runs BEFORE each external call: it checks the cap and
counts the call in memory before its first await, so concurrent companies can never overshoot the
cap. The runner turns BudgetExhausted into an auto-pause with pause_reason=budget_exhausted."""
from __future__ import annotations

from typing import Literal

from app.research.store import ResearchStore
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE

Kind = Literal["exa", "llm"]


class BudgetExhausted(RuntimeError):
    def __init__(self, kind: str, used: int, cap: int):
        super().__init__(f"{kind} budget exhausted ({used}/{cap} calls)")
        self.kind, self.used, self.cap = kind, used, cap


class Budget:
    def __init__(self, store: ResearchStore, run_id: str, *, exa_cap: int, llm_cap: int,
                 exa_used: int = 0, llm_used: int = 0):
        self._store = store
        self._run_id = run_id
        self._caps: dict[str, int] = {"exa": exa_cap, "llm": llm_cap}
        self._used: dict[str, int] = {"exa": exa_used, "llm": llm_used}

    @classmethod
    def from_run(cls, store: ResearchStore, run: dict) -> "Budget":
        b = run["budget"]
        return cls(store, run["run_id"], exa_cap=b["exa_cap"], llm_cap=b["llm_cap"],
                   exa_used=b.get("exa_used", 0), llm_used=b.get("llm_used", 0))

    def set_caps(self, *, exa_cap: int | None = None, llm_cap: int | None = None) -> None:
        if exa_cap is not None:
            self._caps["exa"] = exa_cap
        if llm_cap is not None:
            self._caps["llm"] = llm_cap

    async def charge(self, kind: Kind) -> None:
        used, cap = self._used[kind], self._caps[kind]
        if used >= cap:
            raise BudgetExhausted(kind, used, cap)
        self._used[kind] = used + 1   # before any await: this is what makes concurrent charges safe
        await self._store.update_run(self._run_id, inc={f"budget.{kind}_used": 1})
        company, node = CURRENT_COMPANY.get(), CURRENT_NODE.get()
        if company and node:
            await self._store.update_item(self._run_id, company, inc={f"nodes.{node}.{kind}_calls": 1})

    async def add_tokens(self, tokens_in: int, tokens_out: int) -> None:
        if tokens_in or tokens_out:
            await self._store.update_run(self._run_id, inc={"budget.tokens_in": tokens_in, "budget.tokens_out": tokens_out})
```

`apps/ai-service/app/research/gateway.py`:

```python
"""ResearchIO: the only way research nodes reach the outside world (spec §3.3, §10.1, §12.2).

Every Exa search and LLM call goes through here, which:
  1. opens a traced span carrying the full request and the full response;
  2. charges the run's budget (live/record only; replay is free);
  3. records to / replays from fixtures according to the run's mode;
  4. caches LLM extracts by a hash of their full input (bypassed in record mode so every call
     gets a fixture), and remembers every search result in research_sources.

Phase 1 stores full prompts on LLM spans (resolve prompts are a few KB). Phase 2's per-source
extracts switch to template + research_sources refs (spec §4.3)."""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from app.config import Settings
from app.research.budget import Budget
from app.research.fixtures import FixtureStore
from app.research.models import Mode
from app.research.normalize.identity import domain_of
from app.research.store import ResearchStore
from app.research.trace.tracer import Tracer, utcnow

logger = logging.getLogger(__name__)


def content_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def extract_key(prompt_name: str, prompt_version: str, system: str, user: str) -> str:
    h = hashlib.sha256()
    for part in (prompt_name, prompt_version, system, user):
        h.update(part.encode())
        h.update(b"\x00")
    return h.hexdigest()


class ResearchIO:
    def __init__(self, *, mode: Mode, exa: Any, llm: Any, fixtures: FixtureStore, tracer: Tracer,
                 budget: Budget, store: ResearchStore, settings: Settings):
        self._mode = Mode(mode)
        self._exa = exa
        self._llm = llm
        self._fixtures = fixtures
        self._tracer = tracer
        self._budget = budget
        self._store = store
        self._settings = settings

    async def search(self, query: str, *, company_slug: str, kind: str) -> list[dict]:
        n = self._settings.research_results_per_query
        request = {"query": query, "num_results": n, "user_location": self._settings.exa_user_location,
                   "exclude_domains": sorted(self._settings.exa_exclude_domains)}
        async with self._tracer.span("exa", query, input=request,
                                     attrs={"query": query, "mode": self._mode.value, "kind": kind}) as sp:
            if self._mode is Mode.REPLAY:
                results = self._fixtures.read(company_slug, "exa", request)
                sp.set_attrs(replay=True)
            else:
                await self._budget.charge("exa")
                raw = await self._exa.collect_sources(
                    [query], include_domains=[], exclude_domains=list(self._settings.exa_exclude_domains),
                )
                results = raw[:n]
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "exa", request, results)))
            logger.debug("exa %r → %d result(s)", query, len(results))
            sp.set_output({"count": len(results), "results": results})
        for r in results:
            text = r.get("content") or ""
            await self._store.upsert_source({
                "url": r["url"], "domain": domain_of(r["url"]), "title": r.get("title"),
                "published_date": r.get("date"), "text": text, "content_hash": content_hash(text),
                "fetched_at": utcnow(), "kinds": [kind],
            })
        return results

    async def extract_json(self, *, prompt_name: str, prompt_version: str, system: str, user: str,
                           company_slug: str, label: str) -> dict:
        model = self._settings.llm_model
        key = extract_key(prompt_name, prompt_version, system, user)
        request = {"model": model, "prompt_name": prompt_name, "prompt_version": prompt_version,
                   "system": system, "user": user}
        async with self._tracer.span("llm", f"{prompt_name}@{prompt_version}", input=request,
                                     attrs={"model": model, "prompt_name": prompt_name,
                                            "prompt_version": prompt_version, "mode": self._mode.value,
                                            "label": label}) as sp:
            if self._mode is not Mode.RECORD:
                hit = await self._store.get_extract(key)
                if hit is not None:
                    sp.set_attrs(cache="hit")
                    self._tracer.emit("cache.hit", f"{prompt_name}@{prompt_version}: reused cached extract", level="debug")
                    sp.set_output({"data": hit["output"], "cache": "hit"})
                    return hit["output"]
            if self._mode is Mode.REPLAY:
                response = self._fixtures.read(company_slug, "llm", request)
                sp.set_attrs(replay=True)
            else:
                await self._budget.charge("llm")
                r = await self._llm.complete_full(system, user, label=label)
                response = {"data": r.data, "thought": r.thought, "content": r.content, "usage": r.usage,
                            "latency_ms": r.latency_ms, "key_index": r.key_index, "attempts": r.attempts}
                await self._budget.add_tokens(int(r.usage.get("prompt_tokens") or 0),
                                              int(r.usage.get("completion_tokens") or 0))
                if self._mode is Mode.RECORD:
                    sp.set_attrs(recorded_to=str(self._fixtures.write(company_slug, "llm", request, response)))
            usage = response.get("usage") or {}
            sp.set_attrs(cache="miss", tokens_in=usage.get("prompt_tokens"), tokens_out=usage.get("completion_tokens"),
                         latency_ms=response.get("latency_ms"), key_index=response.get("key_index"),
                         retries=max(0, int(response.get("attempts") or 1) - 1))
            sp.set_output(response)
        await self._store.put_extract({"key": key, "prompt_name": prompt_name, "prompt_version": prompt_version,
                                       "output": response["data"], "created_at": utcnow()})
        return response["data"]
```

The gateway imports `domain_of` from `app/research/normalize/identity.py`, which is created in Task 6. Create it now with only `domain_of`; Task 6 adds the rest of the file:

```python
"""Company identity helpers (spec §3.2 resolve): slugs, name keys, domains, duplicate detection."""
from __future__ import annotations

from urllib.parse import urlparse


def domain_of(url: str | None) -> str | None:
    if not url:
        return None
    s = url.strip()
    if "://" not in s:
        s = "https://" + s
    host = urlparse(s).hostname
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host
```

Also create `apps/ai-service/app/research/normalize/__init__.py`:

```python
"""Pure normalization helpers for research data (spec §6)."""
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/research tests/llm -q`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

