# Live Runtime (Sub-project A) — ai-service Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a LiveKit Agents **worker** to `interviewiq-ai-service` that hosts the existing interview brain (`run_session`) over a real LiveKit room: it loads the stored `InterviewPlan`, drives the brain through a real `LiveKitTransport` (data-channel text in sub-project A), and POSTs the final `SessionOutcome` to the backend. This replaces the `NotImplementedError` `LiveKitTransport` stub and gives the brain — which today only runs in tests — a real runtime.

**Architecture:** A standalone worker process (`python -m app.interview_agent.worker`) registered with LiveKit Cloud via **automatic dispatch** — it auto-joins each interview room, parses the `sessionId` from the room name `interview-{sessionId}`, loads the plan from Mongo (`repo.get_plan`), builds a `LiveKitTransport` bound to the room, and `await run_session(transport, plan, settings)`. The **`Transport` protocol is already fully async and `run_session` already awaits it** — so the real transport is a drop-in for `ScriptedTransport`; no driver changes. In sub-project A the candidate's answers arrive as **typed JSON messages over the LiveKit data channel** (real transport, real brain, real scoring); sub-project D swaps that input for Deepgram STT and adds Aura TTS audio out. On completion the worker POSTs `SessionOutcome` to the backend's internal endpoint.

**Tech Stack:** Python 3.11, LiveKit Agents `~=1.x` (+ transitive `livekit`/livekit-rtc), httpx (existing), Motor/Mongo (existing), pydantic-settings (existing), pytest (sync tests + `asyncio.run`).

## Global Constraints

- **The driver is already async — do NOT add any sync/async bridge, threads, or `run_coroutine_threadsafe`.** `run_session(transport, plan, settings)` is `async def` (`app/interview_agent/session.py:251`) and `await`s all four transport methods. The real `LiveKitTransport` implements the exact `Transport` protocol (all `async`):
  - `async def say(self, text: str) -> None`
  - `async def next_utterance(self) -> tuple[str, UtteranceTiming] | None`  (`None` = silence/disconnect → drives the driver's retry/abort)
  - `async def current_artifact(self) -> Artifact | None`
  - `async def end_session(self) -> None`
- **The brain (`app/interview_agent/session.py`, `graph.py`, `scoring.py`, `pacing.py`, `scope.py`, `state.py`, `llm_ops.py`, `types.py`, `prompts/`) is FROZEN — do not modify it.** Only `transport.py` (replace the stub) and new files are in scope. `ScriptedTransport` stays for tests.
- **Sub-project A is TEXT over the data channel.** No audio, no STT, no TTS, no Deepgram in this slice. `say()` sends a data-channel `interviewer_utterance` message; `next_utterance()` awaits a data-channel `answer` message. Audio tracks are D.
- **Worker bootstraps its own resources.** No FastAPI lifespan runs in the worker process; the entrypoint must `await mongo.connect(get_settings())` before any `repo.*` call (mirror `app/cli.py:18-27`), and close it on shutdown.
- **Plan loading:** `plan = await repo.get_plan(session_id)` (`app/db/repositories.py:174-176`) returns a camelCase `dict | None`; pass it straight to `run_session` (it calls `SessionState.from_plan` internally). If `None`, abort cleanly (log + disconnect, no outcome).
- **Outcome POST:** copy the httpx pattern in `app/targets.py:33-42`. `SessionOutcome` is a **frozen dataclass** — serialize with `dataclasses.asdict(outcome)` and coerce the enum: the dict's `ended_reason` is an `EndedReason` → send `.value` (asdict keeps the enum; convert it). POST to `settings.api_base_url.rstrip("/") + f"/api/v1/internal/sessions/{session_id}/outcome"` with header `{"X-Internal-Api-Key": settings.internal_api_key}`. Backend already has this endpoint (returns 204).
- **Config:** add `livekit_url`/`livekit_api_key`/`livekit_api_secret` as **required** `Field(..., alias="LIVEKIT_URL"|"LIVEKIT_API_KEY"|"LIVEKIT_API_SECRET")` on `Settings` (`app/config.py`). `internal_api_key` (`INTERNAL_API_KEY`) and `api_base_url` (`API_BASE_URL`, default `http://interviewiq-api:8080`) already exist — reuse them. Because the new fields are required, **`tests/conftest.py` must `os.environ.setdefault` dummy `LIVEKIT_*` values** or every test fails at `get_settings()`.
- **Tests:** mirror `tests/interview_agent/test_session.py` — plain sync test functions calling `asyncio.run(...)`, `monkeypatch.setattr` on `app.interview_agent.llm_ops` ops and on `app.interview_agent.session.build_llm_client` (→ `lambda settings, model=None: None`) so no real LLM/network is used. NO `@pytest.mark.asyncio`. Run: `.venv/bin/python -m pytest tests/interview_agent/ -q` (271 tests total today; 66 in `tests/interview_agent/`; suite is green). Keep output pristine.
- **LiveKit API is external + version-sensitive.** Verify the exact `livekit-agents` v1.x + `livekit`(rtc) API via the **context7 MCP** (`resolve-library-id` "livekit agents python" / "livekit rtc python", then `query-docs`) before writing the room-facing calls (`cli.run_app`/`WorkerOptions(entrypoint_fnc=...)`, `JobContext.connect`, `ctx.room.name`, raw data-channel send `room.local_participant.publish_data(...)` + receive `@room.on("data_received")`). Pin `livekit-agents~=1.x` in requirements.txt at the version whose docs you followed.
- **Data-channel message contract (JSON, UTF-8 bytes over `publish_data`)** — MUST match the frontend exactly (the frontend slice reuses these verbatim):
  - agent→candidate: `{"type":"interviewer_utterance","text":str}`, `{"type":"speaking","who":"interviewer"|"candidate","speaking":bool}`, `{"type":"pause","reason":str}`, `{"type":"resume"}`, `{"type":"acknowledge_violation","text":str}`, `{"type":"ended","reason":str}`
  - candidate→agent: `{"type":"answer","text":str,"tStart":float,"tEnd":float}`, `{"type":"artifact","kind":"code"|"diagram","content":str,"language":str|null}`, `{"type":"proctor","event":str}` (events: `fullscreen_exit|fullscreen_restored|tab_hidden|tab_visible|external_display|overlay_tamper`)
- **New dependency + env** are on CLAUDE.md's stop-and-ask list, but the human already approved LiveKit + Deepgram for this build in brainstorming — proceed and document.

## File Structure

- `app/config.py` — **modify**: add 3 required `livekit_*` fields.
- `tests/conftest.py` — **modify**: add dummy `LIVEKIT_*` env defaults.
- `requirements.txt` — **modify**: add `livekit-agents~=1.x`.
- `.env.example` — **modify**: add `LIVEKIT_*` (+ confirm `API_BASE_URL`).
- `app/interview_agent/transport.py` — **modify**: replace the `LiveKitTransport` stub with a real data-channel implementation (keep `Transport` protocol + `ScriptedTransport`).
- `app/interview_agent/outcome_sink.py` — **create**: `post_outcome(settings, outcome)` httpx POST to the backend.
- `app/interview_agent/worker.py` — **create**: the LiveKit Agents worker entrypoint + `cli.run_app`.
- Tests: `tests/interview_agent/test_livekit_transport.py`, `tests/interview_agent/test_outcome_sink.py`, `tests/interview_agent/test_worker.py`.

---

### Task 1: Config + dependency + conftest

**Files:**
- Modify: `app/config.py`
- Modify: `tests/conftest.py`
- Modify: `requirements.txt`
- Modify: `.env.example`
- Test: `tests/interview_agent/test_livekit_config.py`

**Interfaces:**
- Produces: `Settings.livekit_url: str`, `Settings.livekit_api_key: str`, `Settings.livekit_api_secret: str` (all required, aliases `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`). Reuses existing `Settings.internal_api_key`, `Settings.api_base_url`.

- [ ] **Step 1: Write the failing test**

`tests/interview_agent/test_livekit_config.py`:
```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_livekit_config.py -q`
Expected: FAIL — either `get_settings()` raises `ValidationError` (LIVEKIT_* required but unset) or `AttributeError` (fields don't exist). Both confirm RED.

- [ ] **Step 3: Add dummy env to conftest**

In `tests/conftest.py`, alongside the existing `os.environ.setdefault(...)` calls for `EXA_API_KEY`/`MONGODB_URL`/`INTERNAL_API_KEY`/`LLM_API_KEY`/`LLM_MODEL_NAME`, add:
```python
os.environ.setdefault("LIVEKIT_URL", "wss://test.livekit.cloud")
os.environ.setdefault("LIVEKIT_API_KEY", "test-lk-key")
os.environ.setdefault("LIVEKIT_API_SECRET", "test-lk-secret")
```
(Match the exact style of the existing setdefault block — same location, before any `get_settings()` import triggers.)

- [ ] **Step 4: Add the Settings fields**

In `app/config.py`, near the `interview_*` fields (~line 160-190), add:
```python
    livekit_url: str = Field(..., alias="LIVEKIT_URL")
    livekit_api_key: str = Field(..., alias="LIVEKIT_API_KEY")
    livekit_api_secret: str = Field(..., alias="LIVEKIT_API_SECRET")
```
(Required, no default — matches the `mongodb_url`/`internal_api_key` convention. `get_settings()` is `@lru_cache`d; the test process picks up the conftest env before first call.)

- [ ] **Step 5: Add the dependency + .env.example**

In `requirements.txt`, add (verify the exact current 1.x version via context7 first):
```
livekit-agents~=1.5      # Pipeline 2 live interview worker (LiveKit Agents; pulls livekit-rtc)
```
Install it into the venv: `.venv/bin/python -m pip install 'livekit-agents~=1.5'` (must be ONLINE). In `.env.example`, add:
```
# --- LiveKit (Pipeline 2 live interview) ---
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>
```
(Confirm `API_BASE_URL` is already present in `.env.example`; if not, add `API_BASE_URL=http://localhost:8080`.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_livekit_config.py -q`
Expected: PASS. Then run the whole interview_agent suite to confirm the new required env + conftest change didn't break collection: `.venv/bin/python -m pytest tests/interview_agent/ -q` → all green (67 now).

- [ ] **Step 7: Commit**
```bash
git add app/config.py tests/conftest.py requirements.txt .env.example tests/interview_agent/test_livekit_config.py
git commit -m "feat(live): LiveKit config + livekit-agents dep + test env"
```

---

### Task 2: Real LiveKitTransport (data-channel, text)

**Files:**
- Modify: `app/interview_agent/transport.py`
- Test: `tests/interview_agent/test_livekit_transport.py`

**Interfaces:**
- Consumes: `Transport` protocol + `UtteranceTiming`, `Artifact`, `ArtifactKind` from `app/interview_agent/types.py`.
- Produces: `class LiveKitTransport` implementing the 4 async `Transport` methods, constructed as `LiveKitTransport(room, *, send=<callable>)` where `room` is the LiveKit `rtc.Room` (or a fake) and `send` is an async callable `send(payload: dict) -> None` that publishes a JSON message to the data channel (injected so tests use a fake and the worker wires the real `room.local_participant.publish_data`). Also exposes `handle_incoming(payload: dict) -> None` (the worker registers this on the room's `data_received` event).

**Design (implement exactly this behavior):**
- Internal state: an `asyncio.Queue` of `(text, UtteranceTiming)` for incoming answers; `_latest_artifact: Artifact | None`; an `asyncio.Event` `_paused` (set when paused); a `_disconnected: asyncio.Event`.
- `handle_incoming(payload)` routes by `payload["type"]`:
  - `"answer"` → build `UtteranceTiming(t_start=payload["tStart"], t_end=payload["tEnd"], time_to_first_word_s=0.0)` (A: typed input has no meaningful first-word latency), put `(payload["text"], timing)` on the queue.
  - `"artifact"` → `self._latest_artifact = Artifact(kind=ArtifactKind(payload["kind"]), content=payload["content"], language=payload.get("language"))`.
  - `"proctor"` → on `fullscreen_exit|tab_hidden|external_display|overlay_tamper`: set `_paused`, `await send({"type":"pause","reason":event})` and `await send({"type":"acknowledge_violation","text":"..."})`; on `fullscreen_restored|tab_visible`: clear `_paused`, `await send({"type":"resume"})`. (handle_incoming is sync-callable but does async sends — schedule them via the room loop; simplest: make `handle_incoming` an `async def` and have the worker's data_received handler `asyncio.create_task(transport.handle_incoming(payload))`.)
- `async def say(self, text)`: `await send({"type":"speaking","who":"interviewer","speaking":True})`, `await send({"type":"interviewer_utterance","text":text})`, `await send({"type":"speaking","who":"interviewer","speaking":False})`.
- `async def next_utterance(self)`: if `_paused` is set, `await _paused.wait()`-style block until cleared (withhold delivery while paused = server-side enforcement). Then `await` the queue with a timeout = a silence window (e.g. `settings`-independent constant, say 45s — pass via ctor or use a module constant `SILENCE_TIMEOUT_S = 45.0`); on `asyncio.TimeoutError` return `None` (silence). If `_disconnected` is set and the queue is empty, return `None`.
- `async def current_artifact(self)`: return `self._latest_artifact`.
- `async def end_session(self)`: `await send({"type":"ended","reason":self._ended_reason or "natural_complete"})` then set `_disconnected`. (The driver calls this in `finally`; the worker sets `transport.set_ended_reason(outcome.ended_reason.value)` — add a small setter — before/around teardown so the `ended` message carries the real reason. If not set, default `"natural_complete"`.)
- Keep the `Transport` `Protocol` and `ScriptedTransport` unchanged in the file.

- [ ] **Step 1: Write the failing test**

`tests/interview_agent/test_livekit_transport.py`:
```python
import asyncio

from app.interview_agent.transport import LiveKitTransport
from app.interview_agent.types import ArtifactKind


class FakeRoom:
    """Minimal stand-in; the real room is injected only via the `send` callable + handle_incoming."""


def _make():
    sent: list[dict] = []
    async def send(payload: dict) -> None:
        sent.append(payload)
    t = LiveKitTransport(FakeRoom(), send=send)
    return t, sent


def test_say_emits_speaking_and_utterance():
    t, sent = _make()
    asyncio.run(t.say("hello there"))
    types = [m["type"] for m in sent]
    assert types == ["speaking", "interviewer_utterance", "speaking"]
    assert sent[0]["speaking"] is True and sent[2]["speaking"] is False
    assert sent[1]["text"] == "hello there"


def test_answer_message_becomes_next_utterance():
    t, sent = _make()
    async def scenario():
        await t.handle_incoming({"type": "answer", "text": "my answer", "tStart": 1.0, "tEnd": 4.0})
        return await t.next_utterance()
    item = asyncio.run(scenario())
    assert item is not None
    text, timing = item
    assert text == "my answer"
    assert timing.t_start == 1.0 and timing.t_end == 4.0


def test_artifact_snapshot_roundtrips():
    t, _ = _make()
    async def scenario():
        await t.handle_incoming({"type": "artifact", "kind": "code", "content": "def f(): pass", "language": "python"})
        return await t.current_artifact()
    art = asyncio.run(scenario())
    assert art is not None and art.kind == ArtifactKind.CODE
    assert art.content == "def f(): pass" and art.language == "python"


def test_proctor_pause_withholds_next_utterance_until_resume():
    t, sent = _make()
    async def scenario():
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_exit"})
        # an answer arrives while paused; next_utterance must NOT return it yet
        await t.handle_incoming({"type": "answer", "text": "late", "tStart": 0.0, "tEnd": 1.0})
        try:
            await asyncio.wait_for(t.next_utterance(), timeout=0.2)
            returned_while_paused = True
        except asyncio.TimeoutError:
            returned_while_paused = False
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_restored"})
        item = await asyncio.wait_for(t.next_utterance(), timeout=1.0)
        return returned_while_paused, item
    withheld, item = asyncio.run(scenario())
    assert withheld is False, "utterance must be withheld while paused"
    assert item is not None and item[0] == "late"
    kinds = [m["type"] for m in sent]
    assert "pause" in kinds and "acknowledge_violation" in kinds and "resume" in kinds


def test_end_session_emits_ended_with_reason():
    t, sent = _make()
    async def scenario():
        t.set_ended_reason("early_weak")
        await t.end_session()
    asyncio.run(scenario())
    ended = [m for m in sent if m["type"] == "ended"]
    assert ended and ended[0]["reason"] == "early_weak"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_livekit_transport.py -q`
Expected: FAIL — `LiveKitTransport.__init__` signature mismatch / methods raise `NotImplementedError`.

- [ ] **Step 3: Implement `LiveKitTransport`**

Replace the stub in `app/interview_agent/transport.py` (keep `Transport` + `ScriptedTransport`). Implement the design above. Key points: `next_utterance` must (a) block while `_paused` is set, then (b) `await asyncio.wait_for(self._queue.get(), timeout=SILENCE_TIMEOUT_S)` returning `None` on timeout. The pause-wait: loop `while self._paused.is_set(): await self._resumed.wait()` using a paired `_resumed` event, OR use a single `asyncio.Event` that is *set when NOT paused* and `await self._not_paused.wait()` before reading the queue. Use the latter (cleaner): `_not_paused = asyncio.Event(); _not_paused.set()` initially; pause → `clear()`, resume → `set()`; `next_utterance` does `await self._not_paused.wait()` first. `handle_incoming` is `async def`. Add `set_ended_reason(reason: str)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_livekit_transport.py -q`
Expected: PASS (5 tests). Then run `.venv/bin/python -m pytest tests/interview_agent/test_transport.py -q` to confirm the existing `Transport`/`ScriptedTransport` tests still pass (you kept them intact).

- [ ] **Step 5: Commit**
```bash
git add app/interview_agent/transport.py tests/interview_agent/test_livekit_transport.py
git commit -m "feat(live): real LiveKitTransport over the data channel (text; pause-withholds)"
```

---

### Task 3: Outcome sink (POST to backend)

**Files:**
- Create: `app/interview_agent/outcome_sink.py`
- Test: `tests/interview_agent/test_outcome_sink.py`

**Interfaces:**
- Consumes: `Settings` (`api_base_url`, `internal_api_key`), `SessionOutcome` (frozen dataclass) from `types.py`.
- Produces: `async def post_outcome(settings: Settings, outcome: SessionOutcome) -> bool` — POSTs the serialized outcome; returns `True` on 2xx, `False` (logged, never raises) otherwise.

- [ ] **Step 1: Write the failing test**

`tests/interview_agent/test_outcome_sink.py`:
```python
import asyncio

import httpx

from app.config import get_settings
from app.interview_agent import outcome_sink
from app.interview_agent.types import EndedReason, NegativeEvent, PerAnswerScore, SessionOutcome


def _outcome():
    return SessionOutcome(
        session_id="11111111-1111-1111-1111-111111111111",
        ended_reason=EndedReason.NATURAL_COMPLETE,
        live_score_final=0.66,
        per_answer_evidence=[PerAnswerScore(slug="two-sum", competency=0.8, behavioral=0.7, answer_score=0.75, weight=1.0)],
        negative_events=[NegativeEvent(type="idk", magnitude=0.1, reason="blanked", at_s=120.0)],
        arc_completed=True, extensions_granted=0, derived_topics=["graphs"], duration_s=1830.0,
    )


def test_post_outcome_sends_serialized_payload(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 204
        def raise_for_status(self): pass

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None, headers=None):
            captured["url"] = url; captured["json"] = json; captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    ok = asyncio.run(outcome_sink.post_outcome(get_settings(), _outcome()))

    assert ok is True
    assert captured["url"].endswith("/api/v1/internal/sessions/11111111-1111-1111-1111-111111111111/outcome")
    assert captured["headers"]["X-Internal-Api-Key"] == get_settings().internal_api_key
    body = captured["json"]
    assert body["ended_reason"] == "natural_complete"          # enum coerced to its .value
    assert body["live_score_final"] == 0.66
    assert body["per_answer_evidence"][0]["slug"] == "two-sum"
    assert body["duration_s"] == 1830.0


def test_post_outcome_returns_false_on_error(monkeypatch):
    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): raise httpx.ConnectError("backend down")

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    ok = asyncio.run(outcome_sink.post_outcome(get_settings(), _outcome()))
    assert ok is False   # tolerant: logs + returns False, never raises
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_outcome_sink.py -q`
Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement `post_outcome`**

`app/interview_agent/outcome_sink.py`:
```python
"""POST a finalized SessionOutcome to the backend's internal outcome endpoint."""
from __future__ import annotations

import dataclasses
import logging

import httpx

from app.config import Settings
from app.interview_agent.types import SessionOutcome

logger = logging.getLogger(__name__)


def _serialize(outcome: SessionOutcome) -> dict:
    body = dataclasses.asdict(outcome)
    body["ended_reason"] = outcome.ended_reason.value  # asdict keeps the Enum; send its string value
    return body


async def post_outcome(settings: Settings, outcome: SessionOutcome) -> bool:
    url = settings.api_base_url.rstrip("/") + f"/api/v1/internal/sessions/{outcome.session_id}/outcome"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                url,
                json=_serialize(outcome),
                headers={"X-Internal-Api-Key": settings.internal_api_key},
            )
            resp.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — never let outcome delivery crash the worker
        logger.warning("Failed to POST session outcome to %s: %s", url, exc)
        return False
```
NOTE: `dataclasses.asdict` recurses into the nested frozen dataclasses (`PerAnswerScore`, `NegativeEvent`) automatically. Only the top-level `ended_reason` enum needs coercion (the nested ones have no enums). Confirm the backend accepts snake_case keys (it stores the body verbatim + reads `ended_reason`/`live_score_final`/`duration_s`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_outcome_sink.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add app/interview_agent/outcome_sink.py tests/interview_agent/test_outcome_sink.py
git commit -m "feat(live): outcome sink — POST SessionOutcome to backend internal endpoint"
```

---

### Task 4: Worker entrypoint

**Files:**
- Create: `app/interview_agent/worker.py`
- Test: `tests/interview_agent/test_worker.py`

**Interfaces:**
- Consumes: `mongo.connect`/`get_db` (`app/db/mongo.py`), `repo.get_plan` (`app/db/repositories.py`), `run_session` (`app/interview_agent/session.py`), `LiveKitTransport` (Task 2), `post_outcome` (Task 3), `get_settings` (`app/config.py`), LiveKit Agents `cli`/`WorkerOptions`/`JobContext` + `rtc.Room`.
- Produces: `async def run_interview(ctx, settings) -> SessionOutcome | None` (the testable core: parse sessionId → load plan → build transport → run brain → post outcome → return outcome), `def session_id_from_room(name: str) -> str | None` (strip the `interview-` prefix), and `async def entrypoint(ctx)` + `main()` wiring `cli.run_app`.

**Design:** Keep the LiveKit-specific glue (`entrypoint`, `cli.run_app`, wiring `ctx.room` `data_received` → `transport.handle_incoming`, publishing via `room.local_participant.publish_data`) thin and UNTESTED (it needs a live room). Put ALL orchestration logic in `run_interview(ctx, settings)` and `session_id_from_room(...)`, which ARE unit-tested with fakes.

- [ ] **Step 1: Write the failing test**

`tests/interview_agent/test_worker.py`:
```python
import asyncio

from app.config import get_settings
from app.interview_agent import worker
from app.interview_agent.types import EndedReason, SessionOutcome


def test_session_id_from_room_parses_prefix():
    assert worker.session_id_from_room("interview-abc-123") == "abc-123"
    assert worker.session_id_from_room("lobby") is None


class FakeParticipant:
    async def publish_data(self, *a, **k): pass


class FakeRoom:
    def __init__(self, name):
        self.name = name
        self.local_participant = FakeParticipant()
        self._handlers = {}
    def on(self, event):
        def deco(fn): self._handlers[event] = fn; return fn
        return deco


class FakeCtx:
    def __init__(self, room):
        self.room = room
    async def connect(self, *a, **k): pass


def test_run_interview_loads_plan_runs_brain_and_posts_outcome(monkeypatch):
    calls = {}
    plan = {"sessionId": "s-1", "roundType": "dsa", "questionLadders": [], "reserve": []}

    async def fake_get_plan(sid):
        calls["get_plan"] = sid
        return plan

    async def fake_run_session(transport, p, settings):
        calls["run_session"] = (type(transport).__name__, p)
        return SessionOutcome("s-1", EndedReason.NATURAL_COMPLETE, 0.7, [], [], True, 0, [], 1200.0)

    async def fake_post_outcome(settings, outcome):
        calls["post_outcome"] = outcome.session_id
        return True

    monkeypatch.setattr(worker.repo, "get_plan", fake_get_plan)
    monkeypatch.setattr(worker, "run_session", fake_run_session)
    monkeypatch.setattr(worker, "post_outcome", fake_post_outcome)

    ctx = FakeCtx(FakeRoom("interview-s-1"))
    outcome = asyncio.run(worker.run_interview(ctx, get_settings()))

    assert calls["get_plan"] == "s-1"
    assert calls["run_session"][0] == "LiveKitTransport"
    assert calls["run_session"][1] is plan
    assert calls["post_outcome"] == "s-1"
    assert outcome is not None and outcome.session_id == "s-1"


def test_run_interview_aborts_cleanly_when_no_plan(monkeypatch):
    async def no_plan(sid): return None
    async def fake_run_session(*a, **k): raise AssertionError("must not run the brain without a plan")
    monkeypatch.setattr(worker.repo, "get_plan", no_plan)
    monkeypatch.setattr(worker, "run_session", fake_run_session)

    ctx = FakeCtx(FakeRoom("interview-missing"))
    outcome = asyncio.run(worker.run_interview(ctx, get_settings()))
    assert outcome is None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_worker.py -q`
Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement the worker**

`app/interview_agent/worker.py` (verify the LiveKit Agents/`rtc` API via context7 — the `cli.run_app`/`WorkerOptions`/`JobContext`/`connect`/`publish_data`/`data_received` names/signatures may differ by version; the `run_interview` + `session_id_from_room` logic below is fixed):
```python
"""LiveKit Agents worker hosting the interview brain over a real room (sub-project A: data-channel text)."""
from __future__ import annotations

import asyncio
import json
import logging

from app.config import Settings, get_settings
from app.db import mongo
from app.db import repositories as repo
from app.interview_agent.outcome_sink import post_outcome
from app.interview_agent.session import run_session
from app.interview_agent.transport import LiveKitTransport

logger = logging.getLogger(__name__)

ROOM_PREFIX = "interview-"


def session_id_from_room(name: str | None) -> str | None:
    if not name or not name.startswith(ROOM_PREFIX):
        return None
    sid = name[len(ROOM_PREFIX):]
    return sid or None


async def run_interview(ctx, settings: Settings):
    """Testable core: sessionId -> plan -> brain over LiveKitTransport -> post outcome. Returns the outcome or None."""
    session_id = session_id_from_room(ctx.room.name)
    if session_id is None:
        logger.warning("Room %r is not an interview room — ignoring", getattr(ctx.room, "name", None))
        return None
    plan = await repo.get_plan(session_id)
    if plan is None:
        logger.warning("No InterviewPlan for session %s — aborting", session_id)
        return None

    async def send(payload: dict) -> None:
        await ctx.room.local_participant.publish_data(json.dumps(payload).encode("utf-8"))

    transport = LiveKitTransport(ctx.room, send=send)

    # wire inbound data-channel messages to the transport (real room only; fake room in tests skips this)
    _wire_data_received(ctx.room, transport)

    outcome = await run_session(transport, plan, settings)
    if outcome is not None:
        transport.set_ended_reason(outcome.ended_reason.value)
        await post_outcome(settings, outcome)
    return outcome


def _wire_data_received(room, transport: LiveKitTransport) -> None:
    """Register the room's data_received handler → transport.handle_incoming. VERIFY the event
    name + payload accessor against the pinned livekit-rtc version via context7."""
    on = getattr(room, "on", None)
    if on is None:
        return

    @on("data_received")
    def _on_data(data_packet):  # signature varies by version — adapt to the real DataPacket shape
        try:
            payload = json.loads(bytes(data_packet.data).decode("utf-8"))
        except Exception:  # noqa: BLE001
            return
        asyncio.create_task(transport.handle_incoming(payload))


async def entrypoint(ctx) -> None:
    """LiveKit Agents entrypoint. Automatic dispatch: this worker joins every room; non-interview
    rooms are ignored by run_interview."""
    settings = get_settings()
    await mongo.connect(settings)
    try:
        await ctx.connect()  # VERIFY: AutoSubscribe options via context7 (AUDIO_ONLY needed only for D)
        await run_interview(ctx, settings)
    finally:
        await mongo.close()


def main() -> None:
    from livekit.agents import WorkerOptions, cli  # verify import path/version via context7
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
```
NOTE: import `run_session`/`post_outcome`/`repo` at MODULE level (as above) so the tests can `monkeypatch.setattr(worker, "run_session", ...)` etc. Keep `entrypoint`/`main`/`_wire_data_received` thin and out of the unit tests (they touch the live SDK). If the real `data_received` handler signature or `publish_data` API differs, adapt ONLY `send`/`_wire_data_received`/`entrypoint` — never `run_interview`/`session_id_from_room`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_worker.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Full regression + commit**

Run: `.venv/bin/python -m pytest tests/interview_agent/ -q`
Expected: all green (66 existing + new: config 1 + transport 5 + outcome 2 + worker 3 = 77).
```bash
git add app/interview_agent/worker.py tests/interview_agent/test_worker.py
git commit -m "feat(live): LiveKit Agents worker — plan load, brain run, outcome post"
```

---

## Self-Review

**Spec coverage (A design §5.2):**
- Worker entrypoint that loads plan + drives brain → Task 4 ✅
- Real `LiveKitTransport` (say/next_utterance/current_artifact/end_session) → Task 2 ✅
- Sync/async bridge → **not needed** (driver already async — documented in Global Constraints) ✅
- Brain pause/violation input → handled at the transport layer (pause withholds utterances = server-side enforcement) + `acknowledge_violation` control message → Task 2 ✅. NOTE: the *scoring penalty* for violations (a `NegativeEvent` inside the brain) is NOT wired — the brain is frozen and has no violation input; deferred as a small follow-up (the frontend already counts violations; server enforcement is real). Flagged for the final review.
- Outcome POST to backend → Task 3 ✅
- Config `LIVEKIT_*` + `INTERVIEW_LLM_MODEL` (already exists) → Task 1 ✅
- Data-channel contract matches the frontend → Global Constraints (reused by the frontend plan) ✅

**Deferred to D (not this plan):** Deepgram STT feeding `next_utterance` from audio; Aura TTS in `say`; `AutoSubscribe.AUDIO_ONLY` + audio track handling; the `livekit-plugins-deepgram` dep.

**Type consistency:** `LiveKitTransport(room, *, send)` + `handle_incoming(payload)` + `set_ended_reason(str)` used consistently across Tasks 2 & 4; `post_outcome(settings, outcome) -> bool` consistent across Tasks 3 & 4; `run_interview(ctx, settings)` / `session_id_from_room(name)` consistent in Task 4 + tests. `UtteranceTiming(t_start,t_end,time_to_first_word_s)`, `Artifact(kind,content,language)`, `SessionOutcome` fields match `types.py` exactly.

**Placeholder scan:** LiveKit Agents/`rtc` API calls (`cli.run_app`, `WorkerOptions(entrypoint_fnc=...)`, `ctx.connect`, `publish_data`, `data_received`) carry explicit "verify via context7" instructions — external + version-sensitive; every our-side logic block is complete. `livekit-agents~=1.5` version to be confirmed against context7 at Task 1.

**Known adaptation risks for the implementer:** (1) the exact `data_received` handler signature + `DataPacket.data` accessor and `publish_data` signature vary by livekit-rtc version — adapt `send`/`_wire_data_received` only. (2) `time_to_first_word_s=0.0` for typed A-phase answers is intentional (real timing arrives with STT in D). (3) `next_utterance` silence timeout is a module constant (`SILENCE_TIMEOUT_S=45.0`); the driver's `interview_silence_retries` (default 2) then governs abort — 2 timeouts ≈ 90s of silence before `ABORTED_TECHNICAL`, acceptable for MVP.
