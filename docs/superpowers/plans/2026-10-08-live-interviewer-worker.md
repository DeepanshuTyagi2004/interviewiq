# Live Interviewer Worker (Module 03, plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AI interviewer as a LiveKit Agents worker in the AI service: a voice pipeline (Deepgram speech-to-text and voice), a talker LLM on OpenRouter that speaks and drives the shared workspace, a background director LLM that steers, a rules layer in code that enforces time, conduct and proctoring, a leak guard, storage of the trace and evidence, and a text-only simulator.

**Architecture:** Everything except a thin adapter is independent of LiveKit. `InterviewRun` owns one interview: the `Conductor` (plain rules), `TalkerTurn` (one streamed OpenRouter reply, guarded sentence by sentence, then its tool calls), the `Director` (single-flight background briefs), the `WorkspaceBridge` (protocol over LiveKit text/byte streams) and a store. The LiveKit adapter (`InterviewerAgent`) overrides `llm_node` to stream `InterviewRun.reply()` into LiveKit's TTS, so tool calls never cost a second LLM round trip. The simulator drives the same `InterviewRun` with text.

**Tech Stack:** Python 3.12 (AI service venv), FastAPI app untouched except purge, Motor (MongoDB), `livekit-agents` 1.8.3 (built-in Silero VAD and end-of-turn detector via `livekit-local-inference`), `livekit-plugins-deepgram` 1.8.3, `openai` 2.x SDK pointed at OpenRouter (`deepseek/deepseek-v4.1-flash`), pydantic v2, pytest.

**Spec:** `docs/superpowers/specs/2026-10-08-live-interviewer-design.md` (§3 architecture and config, §4 state, §5 brain, §6 protocol, §7 proctoring, §9 storage, §11 failures, §12 product IP). Depends on plan 1 Task 1 (`packages/contracts/live-workspace.examples.json`). Plan 3 adds the API endpoints this worker calls (`/api/v1/internal/live/sessions/:id/context` and `/end`); until then the worker runs only through the simulator.

## Global Constraints

- **No commits.** Leave all changes in the working tree; the user reviews and commits.
- **Test runs:** the user's standing rule is no pytest/lint runs unless they say so. Ask once at the start of execution; if not allowed, skip every "Run" step, keep writing the tests, and report them as written but not run. Steps that call OpenRouter (Task 1's spike, Task 14's manual run) cost cents and need `OPENROUTER_API_KEY`; ask before running them too.
- **Never edit AI-service `.py` files while blueprint prep runs are in flight**: uvicorn `--reload` orphans them. Before editing, ask the user whether prep runs are active (or check `blueprint_runs` for `status: "running"`).
- **Dependencies:** declare `openai>=2.0` (already installed as a `livekit-agents` dependency), `livekit-agents~=1.8` and `livekit-plugins-deepgram~=1.8` (already installed in the venv). Nothing else: Silero VAD and the turn detector ship inside `livekit-agents` 1.8.
- **No paid API in tests:** tests never call OpenRouter, Deepgram or LiveKit; `tests/conftest.py` blanks `OPENROUTER_API_KEY` and `DEEPGRAM_API_KEY`.
- **Style:** `from __future__ import annotations`; module docstrings saying what and why; pydantic v2 models with `extra="ignore"`; tests are plain functions calling `asyncio.run(...)` and using `monkeypatch`, like `tests/blueprint/`.
- **Prompts and canned lines are PRODUCT IP drafts** (spec §12): keep them in `app/interviewer/prompts.py` and `conductor.py` (`MENTION`), marked as drafts for human review.
- **Candidate-facing text** never names a problem, topic or difficulty; problems are labelled "Problem N".
- **OpenRouter request settings** (spec §3): `provider = {"sort": "latency", "require_parameters": true, "allow_fallbacks": true, "data_collection": "deny"}`.
- **English only.** Copy says "resume", never "résumé".

## Review Focus

1. **The candidate interrupts the interviewer mid-reply** → LiveKit cancels the reply; tool calls from the cut-off reply are not executed and the turn is stored as interrupted (Task 7 test).
2. **OpenRouter is slow or down** → a silent retry, then "Give me a second." and one more try; three failed turns in a row end the round as `technical` (Task 7 and Task 12 tests).
3. **A director brief written for an earlier question arrives after the interviewer moved on** → its question-specific parts are dropped; its summary and tone still apply (Task 4 and Task 12 tests).
4. **The browser hasn't said hello yet, or refreshes** → instructions queue until `workspace.hello`, and a hello with no content gets `workspace.restore` plus the whiteboard bytes (Task 11 test).
5. **A sentence quotes the reference solution, reads an example aloud or names the problem** → it never reaches the voice; a turn with nothing safe left says "What do you think?" (Task 5 and Task 7 tests).

---

### Task 1: Settings, OpenRouter client and the latency spike

**Files:**
- Modify: `apps/ai-service/app/config.py`
- Modify: `apps/ai-service/requirements.txt`
- Modify: `apps/ai-service/.env.example`
- Modify: `apps/ai-service/tests/conftest.py`
- Create: `apps/ai-service/app/interviewer/__init__.py`
- Create: `apps/ai-service/app/interviewer/llm.py`
- Create: `apps/ai-service/tests/interviewer/__init__.py`
- Create: `apps/ai-service/tests/interviewer/test_llm.py`
- Create: `apps/ai-service/scripts/interviewer_latency_spike.py`

**Interfaces:**
- Produces: `Settings` fields `livekit_url`, `livekit_api_key`, `livekit_api_secret`, `deepgram_api_key`, `openrouter_api_key`, `openrouter_base_url`, `interviewer_agent_name`, `interviewer_talker_model`, `interviewer_talker_reasoning`, `interviewer_director_model`, `interviewer_director_reasoning`, `interviewer_tts_voice`, `interviewer_talker_timeout_seconds`, `interviewer_director_timeout_seconds`.
- Produces (`app/interviewer/llm.py`): `PROVIDER_ROUTING`, `LLMUnavailable`, `reasoning_param(setting) -> dict`, `ToolCall(id, name, arguments)`, `StreamEvent(kind: "text"|"tool_call"|"done", text, tool_call, usage, provider)`, `OpenRouterChat(api_key, base_url, model, reasoning, timeout_s, http_client=None)` with `stream(messages, tools=None, max_tokens=400) -> AsyncIterator[StreamEvent]`, `json(messages, schema_name, schema, max_tokens=3000) -> (dict, usage)`, `aclose()`; factories `talker_chat(settings)`, `director_chat(settings)`.

- [ ] **Step 1: Add the settings**

In `app/config.py`, after the `api_base_url` field, add:

```python
    # --- Live interviewer (Module 03; docs/superpowers/specs/2026-10-08-live-interviewer-design.md §3) ---
    # Optional for the HTTP service; the interviewer worker checks them at start (app/interviewer/worker.py).
    livekit_url: str = Field("", alias="LIVEKIT_URL")
    livekit_api_key: str = Field("", alias="LIVEKIT_API_KEY")
    livekit_api_secret: str = Field("", alias="LIVEKIT_API_SECRET")
    deepgram_api_key: str = Field("", alias="DEEPGRAM_API_KEY")
    openrouter_api_key: str = Field("", alias="OPENROUTER_API_KEY")
    openrouter_base_url: str = Field("https://openrouter.ai/api/v1", alias="OPENROUTER_BASE_URL")
    interviewer_agent_name: str = Field("interviewer", alias="INTERVIEWER_AGENT_NAME")
    interviewer_talker_model: str = Field("deepseek/deepseek-v4.1-flash", alias="INTERVIEWER_TALKER_MODEL")
    # "none" turns reasoning off on the speaking path; anything else is sent as OpenRouter's reasoning effort.
    interviewer_talker_reasoning: str = Field("none", alias="INTERVIEWER_TALKER_REASONING")
    interviewer_director_model: str = Field("deepseek/deepseek-v4.1-flash", alias="INTERVIEWER_DIRECTOR_MODEL")
    interviewer_director_reasoning: str = Field("medium", alias="INTERVIEWER_DIRECTOR_REASONING")
    # A Deepgram Aura-2 English voice, matched by hand to the test blueprint's persona for the POC.
    interviewer_tts_voice: str = Field("aura-2-orion-en", alias="INTERVIEWER_TTS_VOICE")
    interviewer_talker_timeout_seconds: float = Field(4.0, alias="INTERVIEWER_TALKER_TIMEOUT_SECONDS", gt=0)
    interviewer_director_timeout_seconds: float = Field(45.0, alias="INTERVIEWER_DIRECTOR_TIMEOUT_SECONDS", gt=0)
```

In `tests/conftest.py`, append:

```python
# The live interviewer must never reach paid APIs from tests.
os.environ["OPENROUTER_API_KEY"] = ""
os.environ["DEEPGRAM_API_KEY"] = ""
```

In `requirements.txt`, append:

```
openai>=2.0                      # Live interviewer: OpenRouter (OpenAI-compatible) for the talker and director
livekit-agents~=1.8              # Live interviewer worker (voice pipeline, built-in Silero VAD + turn detector)
livekit-plugins-deepgram~=1.8    # Live interviewer: Deepgram speech-to-text and Aura voice
```

In `.env.example`, append:

```
# --- Live interviewer worker (python -m app.interviewer.worker dev) ---
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>
DEEPGRAM_API_KEY=<deepgram-key>
OPENROUTER_API_KEY=<openrouter-key>
INTERVIEWER_TALKER_MODEL=deepseek/deepseek-v4.1-flash
INTERVIEWER_TALKER_REASONING=none
INTERVIEWER_DIRECTOR_MODEL=deepseek/deepseek-v4.1-flash
INTERVIEWER_DIRECTOR_REASONING=medium
INTERVIEWER_TTS_VOICE=aura-2-orion-en
```

- [ ] **Step 2: Write the failing client test**

Create `tests/interviewer/__init__.py` (empty) and `tests/interviewer/test_llm.py`:

```python
"""OpenRouter client: streamed text, assembled tool calls, routing params, failures."""
import asyncio
import json

import httpx
import pytest

from app.interviewer.llm import PROVIDER_ROUTING, LLMUnavailable, OpenRouterChat, reasoning_param


def _sse(*chunks: dict) -> bytes:
    return ("".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n").encode()


def _chunk(delta: dict | None = None, finish: str | None = None, usage: dict | None = None) -> dict:
    c = {"id": "gen-1", "object": "chat.completion.chunk", "created": 1, "model": "m", "provider": "Novita",
         "choices": [] if usage else [{"index": 0, "delta": delta or {}, "finish_reason": finish}]}
    if usage:
        c["usage"] = usage
    return c


def _chat(handler) -> OpenRouterChat:
    return OpenRouterChat(api_key="k", base_url="https://openrouter.test/api/v1", model="m", reasoning="none", timeout_s=5,
                          http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_streams_text_then_assembled_tool_calls_and_sends_the_routing():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        body = _sse(
            _chunk({"role": "assistant", "content": "Sure. "}),
            _chunk({"content": "Look at line 3."}),
            _chunk({"tool_calls": [{"index": 0, "id": "c1", "type": "function",
                                    "function": {"name": "code_highlight", "arguments": "{\"start_line\": 3,"}}]}),
            _chunk({"tool_calls": [{"index": 0, "function": {"arguments": " \"end_line\": 4}"}}]}, finish="tool_calls"),
            _chunk(usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}),
        )
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    async def run():
        tools = [{"type": "function", "function": {"name": "code_highlight", "parameters": {"type": "object"}}}]
        return [e async for e in _chat(handler).stream([{"role": "user", "content": "hi"}], tools=tools)]

    events = asyncio.run(run())
    assert [e.text for e in events if e.kind == "text"] == ["Sure. ", "Look at line 3."]
    call = next(e.tool_call for e in events if e.kind == "tool_call")
    assert call.name == "code_highlight" and call.arguments == {"start_line": 3, "end_line": 4}
    assert events[-1].kind == "done" and events[-1].usage["total_tokens"] == 15 and events[-1].provider == "Novita"
    assert seen["body"]["provider"] == PROVIDER_ROUTING
    assert seen["body"]["reasoning"] == {"enabled": False}
    assert seen["body"]["stream"] is True and seen["body"]["tools"][0]["function"]["name"] == "code_highlight"


def test_a_failed_call_is_unavailable():
    def handler(request):
        return httpx.Response(502, json={"error": {"message": "upstream"}})

    async def run():
        return [e async for e in _chat(handler).stream([{"role": "user", "content": "hi"}])]

    with pytest.raises(LLMUnavailable):
        asyncio.run(run())


def test_json_parses_the_brief_and_rejects_prose():
    replies = iter(['{"goal": "probe"}', "not json"])

    def handler(request):
        return httpx.Response(200, json={"id": "x", "object": "chat.completion", "created": 1, "model": "m",
                                         "choices": [{"index": 0, "finish_reason": "stop",
                                                      "message": {"role": "assistant", "content": next(replies)}}],
                                         "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

    chat = _chat(handler)
    data, usage = asyncio.run(chat.json([{"role": "user", "content": "x"}], "brief", {"type": "object"}))
    assert data == {"goal": "probe"} and usage["total_tokens"] == 2
    with pytest.raises(LLMUnavailable):
        asyncio.run(chat.json([{"role": "user", "content": "x"}], "brief", {"type": "object"}))


def test_reasoning_settings():
    assert reasoning_param("none") == {"enabled": False}
    assert reasoning_param("") == {"enabled": False}
    assert reasoning_param("Medium") == {"effort": "medium"}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_llm.py -q`
Expected: FAIL — `ModuleNotFoundError: app.interviewer`.

- [ ] **Step 4: Write the client**

Create `app/interviewer/__init__.py`:

```python
"""The live interviewer (Module 03): a LiveKit Agents worker that runs a blueprint by voice."""
```

Create `app/interviewer/llm.py`:

```python
"""OpenRouter for the live interviewer (spec §2, §3): streamed talker turns with tool calls, and JSON
director briefs. OpenAI-compatible, through the `openai` SDK; no retries here (the callers decide)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal

import httpx
from openai import AsyncOpenAI

# Spec §3: the lowest-latency provider that supports every parameter we send (tools), OpenRouter's
# own fallbacks allowed, and never a provider that retains or trains on prompts (personal data).
PROVIDER_ROUTING: dict[str, Any] = {
    "sort": "latency", "require_parameters": True, "allow_fallbacks": True, "data_collection": "deny",
}


class LLMUnavailable(Exception):
    """The call failed, timed out or returned something unusable."""


def reasoning_param(setting: str) -> dict[str, Any]:
    s = (setting or "").strip().lower()
    return {"enabled": False} if s in ("", "none", "off") else {"effort": s}


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class StreamEvent:
    kind: Literal["text", "tool_call", "done"]
    text: str = ""
    tool_call: ToolCall | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider: str | None = None


class OpenRouterChat:
    def __init__(self, *, api_key: str, base_url: str, model: str, reasoning: str, timeout_s: float,
                 http_client: httpx.AsyncClient | None = None) -> None:
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout_s, max_retries=0, http_client=http_client)
        self.model = model
        self.reasoning = reasoning

    def _extra(self) -> dict[str, Any]:
        return {"provider": PROVIDER_ROUTING, "reasoning": reasoning_param(self.reasoning), "usage": {"include": True}}

    async def stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None,
                     max_tokens: int = 400) -> AsyncIterator[StreamEvent]:
        kwargs: dict[str, Any] = {"tools": tools} if tools else {}
        try:
            response = await self._client.chat.completions.create(
                model=self.model, messages=messages, stream=True, max_tokens=max_tokens, extra_body=self._extra(), **kwargs)
        except Exception as exc:  # noqa: BLE001 - any SDK or transport failure means "unavailable"
            raise LLMUnavailable(str(exc)) from exc
        pending: dict[int, dict[str, str]] = {}
        usage: dict[str, Any] = {}
        provider: str | None = None
        try:
            async for chunk in response:
                provider = provider or (chunk.model_extra or {}).get("provider")
                if chunk.usage is not None:
                    usage = chunk.usage.model_dump()
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    yield StreamEvent("text", text=delta.content)
                for tc in delta.tool_calls or []:
                    slot = pending.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function is not None:
                        slot["name"] += tc.function.name or ""
                        slot["arguments"] += tc.function.arguments or ""
        except LLMUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise LLMUnavailable(str(exc)) from exc
        for index in sorted(pending):
            slot = pending[index]
            try:
                args = json.loads(slot["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            yield StreamEvent("tool_call", tool_call=ToolCall(slot["id"] or f"call_{index}", slot["name"],
                                                               args if isinstance(args, dict) else {}))
        yield StreamEvent("done", usage=usage, provider=provider)

    async def json(self, messages: list[dict[str, Any]], schema_name: str, schema: dict[str, Any],
                   max_tokens: int = 3000) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            response = await self._client.chat.completions.create(
                model=self.model, messages=messages, max_tokens=max_tokens, extra_body=self._extra(),
                response_format={"type": "json_schema", "json_schema": {"name": schema_name, "schema": schema, "strict": False}})
        except Exception as exc:  # noqa: BLE001
            raise LLMUnavailable(str(exc)) from exc
        content = (response.choices[0].message.content or "").strip() if response.choices else ""
        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMUnavailable(f"not JSON: {content[:200]}") from exc
        usage = response.usage.model_dump() if response.usage else {}
        return (data if isinstance(data, dict) else {}), usage

    async def aclose(self) -> None:
        await self._client.close()


def talker_chat(settings, http_client: httpx.AsyncClient | None = None) -> OpenRouterChat:
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_talker_model, reasoning=settings.interviewer_talker_reasoning,
                          timeout_s=30.0, http_client=http_client)


def director_chat(settings, http_client: httpx.AsyncClient | None = None) -> OpenRouterChat:
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                          model=settings.interviewer_director_model, reasoning=settings.interviewer_director_reasoning,
                          timeout_s=settings.interviewer_director_timeout_seconds, http_client=http_client)
```

(The talker's own 4-second budget is on the first token, enforced in `TalkerTurn`, Task 7; the SDK timeout only bounds a stuck stream.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_llm.py -q`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the latency spike**

Create `scripts/interviewer_latency_spike.py`:

```python
"""Latency spike (plan 2, task 1): time to first token for the talker on OpenRouter.

Usage (from apps/ai-service):
    .venv/bin/python scripts/interviewer_latency_spike.py [--session <session-id>] [--runs 5] [--reasoning none,low]

Sends a talker-sized prompt (a real blueprint's playbooks when --session is given) with one tool, and
prints p50/p90 time to first token, total time and the providers OpenRouter picked, per reasoning
setting. Costs a few cents."""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time

from app.config import get_settings
from app.interviewer.llm import OpenRouterChat

TOOL = {"type": "function", "function": {
    "name": "log_turn", "description": "Record the decision you just made.",
    "parameters": {"type": "object", "properties": {"condition": {"type": "string"}, "action": {"type": "string"},
                                                     "reason": {"type": "string"}}, "required": ["condition", "action", "reason"]}}}


async def _blueprint_context(session_id: str) -> str:
    from app.blueprint import store
    from app.db import mongo
    settings = get_settings()
    await mongo.connect(settings)
    try:
        bp = await store.current_blueprint(session_id)
    finally:
        await mongo.close()
    if not bp:
        raise SystemExit(f"no current blueprint for session {session_id}")
    keep = ("slot_id", "ask", "hint_ladder", "branches", "expectations", "answer_key")
    return json.dumps({"persona": bp["persona"], "slots": [{k: s[k] for k in keep if k in s} for s in bp["slots"][:2]]})[:24000]


async def _one(chat: OpenRouterChat, messages: list[dict]) -> tuple[float | None, float, str | None]:
    start = time.perf_counter()
    first: float | None = None
    provider: str | None = None
    async for ev in chat.stream(messages, tools=[TOOL], max_tokens=120):
        if ev.kind == "text" and first is None:
            first = time.perf_counter() - start
        if ev.kind == "done":
            provider = ev.provider
    return first, time.perf_counter() - start, provider


def _p(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * (len(ordered) - 1) + 0.5))]


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session")
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--reasoning", default="none,low")
    args = ap.parse_args()
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set in apps/ai-service/.env")
    context = await _blueprint_context(args.session) if args.session else "Interview notes. " * 1500
    messages = [
        {"role": "system", "content": "You are a warm technical interviewer. Reply in one or two short spoken sentences, "
                                      "then call log_turn.\n\n" + context},
        {"role": "user", "content": "I think I'd use two pointers here, but I'm not sure how to handle duplicates."},
    ]
    for reasoning in [r.strip() for r in args.reasoning.split(",") if r.strip()]:
        chat = OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                              model=settings.interviewer_talker_model, reasoning=reasoning, timeout_s=30)
        try:
            results = [await _one(chat, messages) for _ in range(args.runs)]
        finally:
            await chat.aclose()
        ttft = [r[0] for r in results if r[0] is not None]
        totals = [r[1] for r in results]
        providers = sorted({r[2] or "?" for r in results})
        if not ttft:
            print(f"reasoning={reasoning}: no text came back in {args.runs} runs (providers {providers})")
            continue
        print(f"reasoning={reasoning}: first token p50={statistics.median(ttft):.2f}s p90={_p(ttft, 0.9):.2f}s; "
              f"total p50={statistics.median(totals):.2f}s; providers={providers}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 7: Run the spike and record the decision (ask the user first; costs cents)**

Run: `cd apps/ai-service && .venv/bin/python scripts/interviewer_latency_spike.py --session cceda82c-5e3b-4db5-b104-f8fb856146f9 --runs 5`
(`cceda82c-…` is the Salescode round's session; any session with a current blueprint works.)

Expected: one line per reasoning setting. **Gate:** if `reasoning=none` gives first-token p50 ≤ 1.0 s, keep the defaults. If it's slower, or reasoning can't be disabled (no text, or the provider rejects it), stop and report the numbers to the user before continuing; the options are another `INTERVIEWER_TALKER_MODEL`, a pinned provider order, or accepting the latency for the POC. Write the measured numbers into the task's report.

---

### Task 2: Workspace protocol in Python

**Files:**
- Create: `apps/ai-service/app/interviewer/protocol.py`
- Create: `apps/ai-service/tests/interviewer/test_protocol.py`

**Interfaces:**
- Consumes: `packages/contracts/live-workspace.examples.json` (plan 1, Task 1).
- Produces: constants `PROTOCOL_VERSION`, `WORKSPACE_TOPIC`, `BOARD_SNAPSHOT_TOPIC`, `BOARD_BACKUP_TOPIC`, `BOARD_RESTORE_TOPIC`; `AGENT_TYPES`, `WEB_TYPES` (sets of type strings); `parse_web(raw: str) -> WebMessage | None`; `agent_message(body: dict) -> dict` (stamps `v` and `id`, validates, returns a JSON-ready dict); `new_id(prefix: str) -> str`; models `ProctorEventMessage`, `CodeSnapshot`, `BoardSummary`, `AskSelection`, `Hello`, `EndRequest`, `Ack`, `SectionAdded`, `HighlightAdded`, `CodeHighlightAdded` (web → agent) and the agent → web models.

- [ ] **Step 1: Write the failing test**

```python
"""The Python mirror of the workspace protocol accepts every shared example and rejects the rest."""
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.interviewer.protocol import AGENT_TYPES, WEB_TYPES, agent_message, parse_web

EXAMPLES = json.loads((Path(__file__).resolve().parents[4] / "packages/contracts/live-workspace.examples.json").read_text())


def test_examples_cover_exactly_the_protocol():
    assert set(EXAMPLES) == AGENT_TYPES | WEB_TYPES


@pytest.mark.parametrize("message_type", sorted(EXAMPLES))
def test_every_example_validates_in_its_direction(message_type):
    example = EXAMPLES[message_type]
    if message_type in WEB_TYPES:
        parsed = parse_web(json.dumps(example))
        assert parsed is not None and parsed.type == message_type
    else:
        body = {k: v for k, v in example.items() if k not in ("v", "id")}
        out = agent_message(body)
        assert out["type"] == message_type and out["v"] == 1 and out["id"].startswith("a_")


def test_parse_web_drops_agent_messages_bad_json_and_other_versions():
    assert parse_web(json.dumps(EXAMPLES["panel.show_problem"])) is None
    assert parse_web("{nope") is None
    assert parse_web(json.dumps({**EXAMPLES["workspace.hello"], "v": 2})) is None


def test_agent_message_rejects_invalid_bodies():
    with pytest.raises(ValidationError):
        agent_message({"type": "code.insert", "at": "top", "text": "x" * 2001, "purpose": "stub"})
    with pytest.raises(ValidationError):
        agent_message({"type": "panel.show_problem", "item_id": "s", "label": "Problem 1", "kind": "problem",
                       "statement": "x", "examples": [{"input": "a", "output": "b"}] * 3})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_protocol.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `protocol.py`**

```python
"""The workspace protocol (spec §6), mirroring apps/web/features/interview-live/protocol/messages.ts
(the Zod source). Both sides test against packages/contracts/live-workspace.examples.json."""
from __future__ import annotations

import itertools
import json
import time
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

PROTOCOL_VERSION = 1
WORKSPACE_TOPIC = "workspace"
BOARD_SNAPSHOT_TOPIC = "workspace.board.snapshot"
BOARD_BACKUP_TOPIC = "workspace.board.backup"
BOARD_RESTORE_TOPIC = "workspace.board.restore"

Id = Annotated[str, Field(min_length=1, max_length=64)]
Line = Annotated[int, Field(ge=1)]
SectionKind = Literal["constraints", "format", "clarification", "hint", "explanation", "note"]
Author = Literal["interviewer", "candidate"]
CodeLanguage = Literal["python", "javascript", "typescript", "java", "cpp", "go"]
EndReason = Literal["completed", "ended_by_interviewer", "candidate_ended", "technical"]
ProctorKind = Literal["tab_hidden", "window_blur", "external_display", "fullscreen_exit", "share_stopped"]


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _Msg(_M):
    v: Literal[1]
    id: Id


class Example(_M):
    input: str = Field(max_length=4000)
    output: str = Field(max_length=4000)
    explanation: str | None = Field(None, max_length=2000)


class Section(_M):
    id: Id
    kind: SectionKind
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4000)
    author: Author


class WireHighlight(_M):
    highlight_id: Id
    quote: str = Field(min_length=1, max_length=500)
    occurrence: int = Field(ge=0)
    note: str | None = Field(None, max_length=300)
    author: Author


class Card(_M):
    item_id: Id
    label: str = Field(min_length=1, max_length=40)
    kind: Literal["problem", "question"]
    statement: str = Field(min_length=1, max_length=20000)
    examples: list[Example] = Field(max_length=2)
    sections: list[Section] = Field(max_length=50)
    highlights: list[WireHighlight] = Field(max_length=100)


class LineAt(_M):
    line: Line
    expect: str = Field(max_length=1000)


class DrawElement(_M):
    type: Literal["rectangle", "ellipse", "diamond", "text", "arrow"]
    id: Id
    label: str | None = Field(None, max_length=200)
    x: float | None = None
    y: float | None = None
    from_: Id | None = Field(None, alias="from")
    to: Id | None = None


# ---------------------------------------------------------------- agent → web

class ShowProblem(_Msg):
    type: Literal["panel.show_problem"]
    item_id: Id
    label: str = Field(min_length=1, max_length=40)
    kind: Literal["problem", "question"]
    statement: str = Field(min_length=1, max_length=20000)
    examples: list[Example] = Field(max_length=2)


class AddSection(_Msg):
    type: Literal["panel.add_section"]
    item_id: Id
    section: Section


class PanelHighlight(_Msg):
    type: Literal["panel.highlight"]
    item_id: Id
    highlight_id: Id
    quote: str = Field(min_length=1, max_length=500)
    occurrence: int | None = Field(None, ge=0)
    note: str | None = Field(None, max_length=300)


class PanelClearHighlight(_Msg):
    type: Literal["panel.clear_highlight"]
    highlight_id: Id


class CodeComment(_Msg):
    type: Literal["code.comment"]
    at: Literal["top"] | LineAt
    text: str = Field(min_length=1, max_length=1000)
    purpose: Literal["question", "doubt", "hint"]


class CodeInsert(_Msg):
    type: Literal["code.insert"]
    at: Literal["top"] | LineAt
    text: str = Field(min_length=1, max_length=2000)
    purpose: Literal["stub", "test_input"]


class CodeHighlight(_Msg):
    type: Literal["code.highlight"]
    highlight_id: Id
    start_line: Line
    end_line: Line
    expect: str = Field(max_length=1000)
    note: str | None = Field(None, max_length=300)


class CodeClearHighlight(_Msg):
    type: Literal["code.clear_highlight"]
    highlight_id: Id


class BoardRequestSnapshot(_Msg):
    type: Literal["board.request_snapshot"]
    request_id: Id


class BoardDraw(_Msg):
    type: Literal["board.draw"]
    elements: list[DrawElement] = Field(min_length=1, max_length=40)


class RestoreCode(_M):
    language: CodeLanguage
    text: str = Field(max_length=100000)


class WorkspaceRestore(_Msg):
    type: Literal["workspace.restore"]
    cards: list[Card] = Field(max_length=20)
    active_item_id: Id | None
    code: RestoreCode | None
    board: bool


class SessionEnding(_Msg):
    type: Literal["session.ending"]
    reason: EndReason
    message: str = Field(max_length=1000)


AgentMessage = Annotated[Union[ShowProblem, AddSection, PanelHighlight, PanelClearHighlight, CodeComment, CodeInsert,
                               CodeHighlight, CodeClearHighlight, BoardRequestSnapshot, BoardDraw, WorkspaceRestore,
                               SessionEnding], Field(discriminator="type")]

# ---------------------------------------------------------------- web → agent


class Ack(_Msg):
    type: Literal["ack"]
    ref: Id
    ok: bool
    reason: str | None = Field(None, max_length=200)


class SectionAdded(_Msg):
    type: Literal["panel.section_added"]
    item_id: Id
    section: Section


class HighlightAdded(_Msg):
    type: Literal["panel.highlight_added"]
    item_id: Id
    highlight_id: Id
    quote: str = Field(min_length=1, max_length=500)
    occurrence: int = Field(ge=0)


class CodeHighlightAdded(_Msg):
    type: Literal["code.highlight_added"]
    start_line: Line
    end_line: Line
    text: str = Field(max_length=4000)


class AskSelection(_Msg):
    type: Literal["ask.selection"]
    surface: Literal["statement", "code", "board"]
    quote: str = Field(min_length=1, max_length=4000)
    item_id: Id | None = None
    lines: tuple[int, int] | None = None


class CodeSnapshot(_Msg):
    type: Literal["code.snapshot"]
    version: int = Field(ge=0)
    language: CodeLanguage
    text: str = Field(max_length=100000)


class BoardSummary(_Msg):
    type: Literal["board.summary"]
    version: int = Field(ge=0)
    text: str = Field(max_length=20000)


class ProctorCounts(_M):
    tab_changes: int = Field(ge=0)
    screen_changes: float = Field(ge=0)
    full_violations: int = Field(ge=0)


class ProctorEventMessage(_Msg):
    type: Literal["proctor.event"]
    kind: ProctorKind
    weight: Literal[1, 0.5]
    at: int = Field(ge=0)
    counts: ProctorCounts


class Hello(_Msg):
    type: Literal["workspace.hello"]
    has_content: bool


class EndRequest(_Msg):
    type: Literal["session.end_request"]


WebMessage = Annotated[Union[Ack, SectionAdded, HighlightAdded, CodeHighlightAdded, AskSelection, CodeSnapshot,
                             BoardSummary, ProctorEventMessage, Hello, EndRequest], Field(discriminator="type")]

_AGENT = TypeAdapter(AgentMessage)
_WEB = TypeAdapter(WebMessage)


def _types(union) -> set[str]:
    members = union.__metadata__ and union.__origin__.__args__ if hasattr(union, "__origin__") else ()
    return {m.model_fields["type"].annotation.__args__[0] for m in members}


AGENT_TYPES: set[str] = _types(AgentMessage)
WEB_TYPES: set[str] = _types(WebMessage)

_seq = itertools.count(1)


def new_id(prefix: str = "a") -> str:
    return f"{prefix}_{int(time.time() * 1000):x}_{next(_seq):x}"


def parse_web(raw: str) -> Any | None:
    """A web → agent message from a text stream, or None if it isn't one this version understands."""
    try:
        return _WEB.validate_json(raw)
    except (ValidationError, ValueError):
        return None


def agent_message(body: dict[str, Any]) -> dict[str, Any]:
    """Stamp `v` and `id` on an agent → web body, validate it, and return the wire dict."""
    model = _AGENT.validate_python({**body, "v": PROTOCOL_VERSION, "id": new_id("a")})
    return json.loads(model.model_dump_json(by_alias=True, exclude_none=True))
```

Note on `_types`: `AgentMessage` is `Annotated[Union[...], Field(...)]`; `__origin__` is the `Union`, whose `__args__` are the member models. If your Python's `typing` exposes it differently, compute the sets explicitly from the member class lists instead (the test pins the result).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_protocol.py -q`
Expected: PASS (one test per example plus three).

---

### Task 3: The interview plan and the candidate-safe problem payload

**Files:**
- Create: `apps/ai-service/app/interviewer/plan.py`
- Create: `apps/ai-service/tests/interviewer/fixtures.py`
- Create: `apps/ai-service/tests/interviewer/test_plan.py`

**Interfaces:**
- Produces: `Item` dataclass (`item_id, kind: "phase"|"slot"|"filler", phase, max_seconds, slot_id, status, started_at, ended_at, ended_by, hint_step, filler`), `PROTECTED_PHASES`, `build_items(blueprint)`, `reserve_slots(blueprint)`, `slot_by_id(blueprint, slot_id)`, `round_seconds(blueprint, context)`, `format_args(args)`, `problem_payload(slot, label) -> dict` (a `panel.show_problem` body), `reveal_text(slot, kind) -> str | None`.
- Produces (tests): `fixtures.blueprint()`, `fixtures.context()`, `fixtures.Clock`.

- [ ] **Step 1: Write the fixtures**

Create `tests/interviewer/fixtures.py`:

```python
"""A small, realistic blueprint and run context for the interviewer tests, and a manual clock."""
from __future__ import annotations

REFERENCE = ("def pair_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n"
             "        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n")


def _slot(slot_id: str, kind: str, order: int, title: str) -> dict:
    return {
        "slot_id": slot_id, "kind": kind, "order": order, "purpose": "", "timebox_mins": 20,
        "problem": {"round_type": "dsa", "slug": f"slug-{slot_id}", "title": title, "difficulty": "medium", "content_hash": "h",
                    "content": {"statement": f"Given an array of integers nums and an integer target, solve {title.lower()}.",
                                "examples": [{"args": {"nums": [2, 7, 11, 15], "target": 9}, "expected": [0, 1], "explanation": "2 + 7 = 9"},
                                             {"args": {"nums": [3, 3], "target": 6}, "expected": [0, 1], "explanation": "3 + 3 = 6"}],
                                "constraints": ["2 <= len(nums) <= 10^4", "exactly one answer"],
                                "input_format": "nums: list[int], target: int", "output_format": "list[int] of two indices",
                                "patterns": ["hash map"]}},
        "answer_key": {"key": {"approaches": [{"name": "Brute force", "idea": "check every pair", "time_complexity": "O(n^2)", "space_complexity": "O(1)"},
                                              {"name": "One pass", "idea": "remember each value's index", "time_complexity": "O(n)", "space_complexity": "O(n)"}],
                               "complexity_target": "O(n) time", "key_insights": ["look up the complement", "one pass is enough"],
                               "common_wrong_paths": [{"path": "sorting first", "why_wrong": "loses the indices", "nudge": "What happens to the indices?"}],
                               "edge_cases": ["duplicates", "negative numbers"],
                               "reference_solution": {"language": "python", "entry_point": "pair_sum", "code": REFERENCE}}},
        "ask": {"opening": f"Let's work on a problem about {title.lower()}.", "clarifications": [{"question": "Can values repeat?", "answer": "Yes."}]},
        "hint_ladder": [{"step": 1, "hint": "What do you need to remember as you scan?"},
                        {"step": 2, "hint": "A lookup structure could help."},
                        {"step": 3, "hint": "Store each value's index as you go."}],
        "branches": [{"condition": "stuck", "action": "give_hint", "say": "Let's take a step back.", "notes": ""},
                     {"condition": "asks_for_answer", "action": "decline_politely", "say": "I'd rather see how you think it through.", "notes": ""}],
        "probes": ["Why that structure?"], "follow_ups": ["What if the array were sorted?"],
        "expectations": {"must_show": ["an O(n) approach"], "strong_signals": [], "weak_signals": []},
        "evaluation_signals": [{"signal": "approach", "observe": "moves from brute force to one pass"}],
    }


def blueprint() -> dict:
    return {
        "blueprint_id": "bp1", "session_id": "s1", "candidate_id": "c1", "version": 1, "status": "current",
        "input_hash": "h", "run_id": "run1", "created_at": "2026-10-08T00:00:00+00:00",
        "round": {"company": "salescode", "type": "dsa", "duration_mins": 60},
        "persona": {"name": "Siddharth Menon", "seniority": "Software Engineer", "style": "warm, asks probing follow-ups",
                    "disposition": "Patient and curious; lets the candidate think.", "opening": "Hi, I'm Siddharth. Thanks for joining.",
                    "closing": "Thanks for your time today. That's all from my side.", "grounded_in": []},
        "arc": [{"phase": "greeting", "timebox_mins": 1, "scored": False, "guidance": "Greet warmly."},
                {"phase": "candidate_intro", "timebox_mins": 2, "scored": True, "guidance": "Ask for a short intro."},
                {"phase": "core", "timebox_mins": 40, "scored": True, "guidance": ""},
                {"phase": "candidate_questions", "timebox_mins": 4, "scored": True, "guidance": "Invite their questions."},
                {"phase": "wrap_up", "timebox_mins": 1, "scored": False, "guidance": "Close warmly."}],
        "personalization": {"rapport_hooks": [{"line": "I saw your split-bill app.", "source": "projects"}],
                            "resume_probes": [{"prompt": "Tell me about the split-bill app's settlement logic.", "grounded_in": "projects", "what_it_tests": "ownership"}],
                            "level_expectations": "SDE-1: working code, complexity, a few edge cases.", "round_questions": []},
        "slots": [_slot("core-1", "core", 1, "Pair Sum"), _slot("core-2", "core", 2, "Window Peak"),
                  _slot("reserve-alternate", "reserve", 3, "Island Count")],
        "policies": {"version": "pol1",
                     "requests": [{"kind": "extend_time", "decision": "partial", "how": "Allow a minute or two."},
                                  {"kind": "ask_solution", "decision": "decline", "how": "Decline kindly; offer a hint."}],
                     "off_topic": "Steer back.", "time_management": "Watch the timebox.", "integrity": "Ask them to explain.",
                     "fallback": "Act as a fair interviewer."},
        "evaluation": {"global_signals": [{"signal": "communication", "observe": "thinks aloud"}]},
        "briefing": {"interviewer_name": "Siddharth Menon", "interviewer_style": "warm", "format": "coding", "duration_mins": 60},
        "provenance": {},
    }


def context() -> dict:
    return {"session_id": "s1", "candidate_id": "c1", "first_name": "Asha",
            "round": {"company": "salescode", "company_name": "Salescode", "role": "Software Engineer", "level": "sde1",
                      "round_type": "dsa", "duration_mins": 60},
            "profile": {"headline": "Backend engineer", "skills": ["Java", "SQL", "React"], "projects": ["Split app"]}}


class Clock:
    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds
```

- [ ] **Step 2: Write the failing test**

Create `tests/interviewer/test_plan.py`:

```python
from app.interviewer.plan import build_items, format_args, problem_payload, reserve_slots, reveal_text, round_seconds, slot_by_id
from tests.interviewer.fixtures import blueprint, context


def test_items_follow_the_arc_with_core_problems_in_order():
    items = build_items(blueprint())
    assert [(i.item_id, i.kind) for i in items] == [
        ("greeting", "phase"), ("candidate_intro", "phase"), ("core-1", "slot"), ("core-2", "slot"),
        ("candidate_questions", "phase"), ("wrap_up", "phase")]
    assert items[2].max_seconds == 1200 and items[0].max_seconds == 60
    assert [s["slot_id"] for s in reserve_slots(blueprint())] == ["reserve-alternate"]


def test_the_problem_payload_is_candidate_safe():
    payload = problem_payload(slot_by_id(blueprint(), "core-1"), "Problem 1")
    assert payload["type"] == "panel.show_problem" and payload["label"] == "Problem 1"
    assert payload["examples"][0] == {"input": "nums = [2, 7, 11, 15]\ntarget = 9", "output": "[0, 1]", "explanation": "2 + 7 = 9"}
    flat = str(payload)
    for secret in ("Pair Sum", "medium", "hash map", "seen[x]", "constraints", "hint"):
        assert secret not in flat


def test_reveal_texts_and_round_length():
    slot = slot_by_id(blueprint(), "core-1")
    assert reveal_text(slot, "constraints") == "2 <= len(nums) <= 10^4\nexactly one answer"
    assert reveal_text(slot, "format") == "Input: nums: list[int], target: int\nOutput: list[int] of two indices"
    assert reveal_text(slot, "hint") is None
    assert round_seconds(blueprint(), context()) == 3600
    assert format_args({"s": "eceba"}) == 's = "eceba"'
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_plan.py -q`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `plan.py`**

```python
"""The interview plan built from a blueprint (spec §4), and the candidate-safe problem payload (spec
§6.3): the statement and two examples under a generic label. Never names, topics or difficulty."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

ItemKind = Literal["phase", "slot", "filler"]
ItemStatus = Literal["pending", "active", "done", "skipped", "swapped"]
PROTECTED_PHASES = frozenset({"candidate_questions", "wrap_up"})
MIN_PHASE_SECONDS = 60


@dataclass
class Item:
    item_id: str
    kind: ItemKind
    phase: str
    max_seconds: int
    slot_id: str | None = None
    status: ItemStatus = "pending"
    started_at: float | None = None
    ended_at: float | None = None
    ended_by: str | None = None
    hint_step: int = 0
    filler: dict[str, str] | None = None


def _ordered(slots: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return sorted((s for s in slots if s.get("kind") == kind), key=lambda s: s.get("order", 0))


def build_items(blueprint: dict[str, Any]) -> list[Item]:
    items: list[Item] = []
    for phase in blueprint.get("arc", []):
        name = phase["phase"]
        if name == "core":
            for slot in _ordered(blueprint.get("slots", []), "core"):
                items.append(Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"]))
        else:
            items.append(Item(name, "phase", name, max(MIN_PHASE_SECONDS, int(phase.get("timebox_mins") or 1) * 60)))
    return items


def reserve_slots(blueprint: dict[str, Any]) -> list[dict[str, Any]]:
    return _ordered(blueprint.get("slots", []), "reserve")


def slot_by_id(blueprint: dict[str, Any], slot_id: str | None) -> dict[str, Any] | None:
    return next((s for s in blueprint.get("slots", []) if s.get("slot_id") == slot_id), None) if slot_id else None


def round_seconds(blueprint: dict[str, Any], context: dict[str, Any]) -> int:
    minutes = ((context.get("round") or {}).get("duration_mins") or (blueprint.get("round") or {}).get("duration_mins")
               or sum(int(p.get("timebox_mins") or 0) for p in blueprint.get("arc", [])))
    return int(minutes) * 60


def _literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def format_args(args: dict[str, Any]) -> str:
    return "\n".join(f"{name} = {_literal(value)}" for name, value in args.items())


def _content(slot: dict[str, Any] | None) -> dict[str, Any]:
    return ((slot or {}).get("problem") or {}).get("content") or {}


def problem_payload(slot: dict[str, Any], label: str) -> dict[str, Any]:
    content = _content(slot)
    statement = (content.get("statement") or content.get("question") or (slot.get("ask") or {}).get("opening") or "").strip()
    examples = []
    for ex in (content.get("examples") or [])[:2]:
        example = {"input": format_args(ex.get("args") or {}), "output": _literal(ex.get("expected"))}
        if ex.get("explanation"):
            example["explanation"] = str(ex["explanation"])[:2000]
        examples.append(example)
    return {"type": "panel.show_problem", "item_id": slot["slot_id"], "label": label,
            "kind": "problem" if examples else "question", "statement": statement[:20000], "examples": examples}


def reveal_text(slot: dict[str, Any] | None, kind: str) -> str | None:
    """Exactly what the problem says: constraints, or the input/output format. Shown only when asked."""
    content = _content(slot)
    if kind == "constraints":
        return "\n".join(str(c) for c in content.get("constraints") or []) or None
    if kind == "format":
        parts = [f"Input: {content['input_format']}" if content.get("input_format") else "",
                 f"Output: {content['output_format']}" if content.get("output_format") else ""]
        return "\n".join(p for p in parts if p) or None
    return None
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_plan.py -q`
Expected: PASS (3 tests).

---

### Task 4: The conductor (rules in code)

**Files:**
- Create: `apps/ai-service/app/interviewer/conductor.py`
- Create: `apps/ai-service/tests/interviewer/test_conductor.py`

**Interfaces:**
- Consumes: `Item`, `build_items`, `reserve_slots`, `PROTECTED_PHASES` (Task 3).
- Produces: `MENTION`, `Order(kind, text, at, end_reason=None, speak=True, consumed=False)`, `Rules` (defaults per spec), `Conductor(blueprint, round_seconds, rules=None, clock=time.time, skills=())` with: `start()`, `current() -> Item`, `label_for(item_id) -> str`, `record_hint(step) -> int`, `next_item(reason) -> Item | None`, `on_candidate_turn()`, `set_candidate_speaking(bool)`, `set_agent_speaking(bool)`, `on_code_change()`, `on_board_change()`, `on_proctor(kind, weight, at) -> Order`, `on_conduct(kind, quote, turn_id, source) -> Order | None`, `on_redirect(turn_id) -> Order | None`, `on_end_request() -> Order`, `tick() -> list[Order]`, `pending_orders()`, `consume(orders)`, `end_order` (property), `take_triggers() -> set[str]`, `apply_brief(brief: dict) -> {"stale", "applied", "dropped"}`, `live_summary(counts) -> dict`, `checkpoint() -> dict`, `Conductor.restore(blueprint, round_seconds, data, rules=None, clock=time.time, skills=())`; attributes `position`, `items`, `ended`, `end_reason`, `full_violations`, `conduct`, `proctor`, `follow_ups`, `plan_changes`, `candidate_speaking`, `agent_speaking`, `started_at`.

- [ ] **Step 1: Write the failing test**

```python
"""The conductor: walking the plan, time limits, silence, proctoring, conduct, briefs, checkpoints."""
from app.interviewer.conductor import Conductor
from tests.interviewer.fixtures import Clock, blueprint


def make() -> tuple[Conductor, Clock]:
    clock = Clock()
    c = Conductor(blueprint(), 3600, clock=clock, skills=["Java", "SQL"])
    c.start()
    return c, clock


def to_core(c: Conductor) -> None:
    c.next_item("done")
    c.next_item("done")
    assert c.current().item_id == "core-1"


def test_walks_the_plan_and_ends_quietly_after_wrap_up():
    c, _ = make()
    seen = [c.current().item_id]
    while (nxt := c.next_item("done")) is not None:
        seen.append(nxt.item_id)
    assert seen == ["greeting", "candidate_intro", "core-1", "core-2", "candidate_questions", "wrap_up"]
    assert c.ended and c.end_reason == "completed" and c.end_order.speak is False


def test_converges_then_moves_on_waiting_for_a_pause_up_to_the_grace():
    c, clock = make()
    to_core(c)
    clock.advance(960)
    assert [o.kind for o in c.tick()] == ["converge"]
    clock.advance(240)
    c.set_candidate_speaking(True)
    assert c.tick() == []
    clock.advance(59)
    assert c.tick() == []
    clock.advance(1)
    assert [o.kind for o in c.tick()] == ["move_on"]
    assert c.tick() == []


def test_moves_on_at_once_when_the_candidate_is_quiet():
    c, clock = make()
    to_core(c)
    c.on_code_change()
    clock.advance(1200)
    assert "move_on" in [o.kind for o in c.tick()]


def test_silence_nudges_after_20s_talking_and_2min_coding():
    c, clock = make()
    clock.advance(21)
    assert [o.kind for o in c.tick()] == ["nudge"]
    to_core(c)
    clock.advance(100)
    assert c.tick() == []
    clock.advance(21)
    assert [o.kind for o in c.tick()] == ["nudge"]


def test_proctor_rule_mentions_warns_then_ends_and_half_weights_never_end():
    c, _ = make()
    assert c.on_proctor("fullscreen_exit", 0.5, 1).kind == "mention_violation"
    assert c.on_proctor("tab_hidden", 1, 2).kind == "mention_violation"
    assert c.on_proctor("share_stopped", 0.5, 3).kind == "mention_violation"
    assert c.on_proctor("window_blur", 1, 4).kind == "final_warning"
    order = c.on_proctor("tab_hidden", 1, 5)
    assert order.kind == "end" and order.end_reason == "ended_by_interviewer" and c.ended


def test_conduct_warns_then_ends_and_counts_one_incident_per_turn():
    c, _ = make()
    assert c.on_conduct("inappropriate", "…", "t1", "talker").kind == "conduct_warning"
    assert c.on_conduct("inappropriate", "…", "t1", "director") is None
    assert c.on_conduct("abusive", "…", "t2", "talker").kind == "end"


def test_three_redirects_in_one_item_make_an_incident():
    c, _ = make()
    assert c.on_redirect("t1") is None and c.on_redirect("t2") is None
    assert c.on_redirect("t3").kind == "conduct_warning"


def test_a_stale_brief_is_dropped_and_a_fresh_one_changes_the_plan_within_the_rules():
    c, _ = make()
    to_core(c)
    stale = c.apply_brief({"for_position": c.position - 1, "plan_changes": [{"op": "skip", "target": "core-2"}]})
    assert stale["stale"] and c.items[3].status == "pending"
    fresh = c.apply_brief({"for_position": c.position, "plan_changes": [
        {"op": "skip", "target": "wrap_up"},
        {"op": "insert_filler", "question": "How does HashMap handle collisions?", "skill": "Java"},
        {"op": "insert_filler", "question": "Tell me about Kubernetes.", "skill": "Kubernetes"},
        {"op": "add_follow_up", "text": "What if the input streams in?"},
    ]})
    assert [d["op"] for d in fresh["dropped"]] == ["skip", "insert_filler"]
    assert c.items[c.items.index(c.current()) + 1].kind == "filler"
    assert c.follow_ups["core-1"] == ["What if the input streams in?"]


def test_use_reserve_swaps_the_current_problem():
    c, _ = make()
    to_core(c)
    before = c.position
    out = c.apply_brief({"for_position": before, "plan_changes": [{"op": "use_reserve", "target": "reserve-alternate"}]})
    assert out["applied"] and c.current().item_id == "reserve-alternate"
    assert next(i for i in c.items if i.item_id == "core-1").status == "swapped"
    assert c.position == before + 1


def test_the_round_ceiling_forces_the_wrap_up():
    c, clock = make()
    to_core(c)
    clock.advance(1.5 * 3600)
    assert [o.kind for o in c.tick()] == ["wrap_up_now"]
    assert c.current().item_id == "wrap_up"


def test_labels_are_generic_and_stable():
    c, _ = make()
    assert c.label_for("core-2") == "Problem 1"
    assert c.label_for("core-1") == "Problem 2"
    assert c.label_for("core-2") == "Problem 1"


def test_checkpoint_round_trip():
    c, clock = make()
    to_core(c)
    c.on_proctor("tab_hidden", 1, 1)
    c.record_hint(2)
    restored = Conductor.restore(blueprint(), 3600, c.checkpoint(), clock=clock)
    assert restored.current().item_id == "core-1" and restored.current().hint_step == 2
    assert restored.full_violations == 1 and restored.position == c.position
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_conductor.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `conductor.py`**

```python
"""The conductor (spec §5.3): the interview's rules in plain code, no LLM. It walks the plan, times
every item, keeps the proctor and conduct ledgers, validates the director's plan changes, and issues
orders the talker must follow on its next turn. Clock-injected and pure, so every rule is tested;
it checkpoints to a dict after every turn (spec §11)."""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from app.interviewer.plan import PROTECTED_PHASES, Item, build_items, reserve_slots

OrderKind = Literal["converge", "move_on", "wrap_up_now", "nudge", "mention_violation", "final_warning",
                    "conduct_warning", "end"]

# What the talker is told about each proctor event (spec §7). PRODUCT IP draft.
MENTION: dict[str, str] = {
    "tab_hidden": "The candidate switched to another tab.",
    "window_blur": "The candidate moved to another window or app.",
    "external_display": "A second display is connected.",
    "fullscreen_exit": "The candidate left full screen.",
    "share_stopped": "The candidate's screen share stopped; ask them to share their entire screen again.",
}


@dataclass
class Order:
    kind: OrderKind
    text: str
    at: float
    end_reason: str | None = None
    speak: bool = True
    consumed: bool = False


@dataclass
class Rules:
    converge_at: float = 0.8
    grace_seconds: float = 60.0
    silence_talking_s: float = 20.0
    silence_coding_s: float = 120.0
    ceiling_factor: float = 1.5
    filler_max_s: int = 240
    proctor_final_warning_at: int = 2
    proctor_end_at: int = 3
    conduct_end_at: int = 2
    off_topic_redirects: int = 3
    director_every_turns: int = 3


class Conductor:
    def __init__(self, blueprint: dict[str, Any], round_seconds: int, rules: Rules | None = None,
                 clock: Callable[[], float] = time.time, skills: tuple[str, ...] | list[str] = ()) -> None:
        self.rules = rules or Rules()
        self.clock = clock
        self.round_seconds = round_seconds
        self.skills = {s.strip().lower() for s in skills if s and s.strip()}
        self.items: list[Item] = build_items(blueprint)
        self.reserves: dict[str, dict[str, Any]] = {s["slot_id"]: s for s in reserve_slots(blueprint)}
        self.index = 0
        self.position = 0
        self.started_at: float | None = None
        self.orders: list[Order] = []
        self.proctor: list[dict[str, Any]] = []
        self.full_violations = 0
        self.conduct: list[dict[str, Any]] = []
        self.conduct_turns: set[str] = set()
        self.redirects: dict[str, int] = {}
        self.labels: dict[str, str] = {}
        self.follow_ups: dict[str, list[str]] = {}
        self.plan_changes: list[dict[str, Any]] = []
        self.last_activity = 0.0
        self.nudged_at = 0.0
        self.candidate_speaking = False
        self.agent_speaking = False
        self.fired: dict[str, set[str]] = {}
        self.turns_since_director = 0
        self.triggers: set[str] = set()
        self.ended = False
        self.end_reason: str | None = None

    # ------------------------------------------------------------ position

    def current(self) -> Item:
        return self.items[self.index]

    def start(self) -> None:
        now = self.clock()
        self.started_at = now
        self.last_activity = now
        self._activate(0, now)

    def _activate(self, index: int, now: float) -> None:
        self.index = index
        item = self.items[index]
        item.status = "active"
        item.started_at = now
        self.position += 1
        self.nudged_at = now
        self.triggers.add("item")

    def _find(self, item_id: str) -> int | None:
        return next((i for i, it in enumerate(self.items) if it.item_id == item_id), None)

    def label_for(self, item_id: str) -> str:
        if item_id not in self.labels:
            self.labels[item_id] = f"Problem {len(self.labels) + 1}"
        return self.labels[item_id]

    def record_hint(self, step: int) -> int:
        item = self.current()
        item.hint_step = max(item.hint_step, int(step))
        return item.hint_step

    def next_item(self, reason: str) -> Item | None:
        now = self.clock()
        cur = self.current()
        if cur.status == "active":
            cur.status, cur.ended_at, cur.ended_by = "done", now, reason
        for i in range(self.index + 1, len(self.items)):
            if self.items[i].status == "pending":
                self._activate(i, now)
                return self.items[i]
        self._end("completed", "The interview is complete.", now, speak=False)
        return None

    # ------------------------------------------------------------ orders

    def _order(self, kind: OrderKind, text: str, now: float) -> Order:
        order = Order(kind, text, now)
        self.orders.append(order)
        return order

    def _end(self, reason: str, text: str, now: float, speak: bool = True) -> Order:
        if self.ended and self.end_order is not None:
            return self.end_order
        self.ended = True
        self.end_reason = reason
        order = Order("end", text, now, end_reason=reason, speak=speak)
        self.orders.append(order)
        return order

    @property
    def end_order(self) -> Order | None:
        return next((o for o in self.orders if o.kind == "end"), None)

    def pending_orders(self) -> list[Order]:
        return [o for o in self.orders if not o.consumed]

    def consume(self, orders: list[Order]) -> None:
        for order in orders:
            order.consumed = True

    def take_triggers(self) -> set[str]:
        triggers, self.triggers = self.triggers, set()
        return triggers

    # ------------------------------------------------------------ events

    def on_candidate_turn(self) -> None:
        self.last_activity = self.clock()
        self.turns_since_director += 1
        if self.turns_since_director >= self.rules.director_every_turns:
            self.turns_since_director = 0
            self.triggers.add("turns")

    def set_candidate_speaking(self, speaking: bool) -> None:
        self.candidate_speaking = speaking
        if not speaking:
            self.last_activity = self.clock()

    def set_agent_speaking(self, speaking: bool) -> None:
        self.agent_speaking = speaking
        if not speaking:
            self.last_activity = self.clock()

    def on_code_change(self) -> None:
        self.last_activity = self.clock()
        self.triggers.add("workspace")

    def on_board_change(self) -> None:
        self.last_activity = self.clock()
        self.triggers.add("workspace")

    def on_proctor(self, kind: str, weight: float, at: float) -> Order:
        now = self.clock()
        self.proctor.append({"kind": kind, "weight": weight, "at": at, "seen_at": now})
        self.triggers.add("proctor")
        mention = MENTION.get(kind, "The candidate left the interview screen.")
        if weight >= 1:
            self.full_violations += 1
            if self.full_violations >= self.rules.proctor_end_at:
                return self._end("ended_by_interviewer",
                                 f"{mention} That is the third time. Say plainly that you are ending the interview "
                                 "because of repeated screen switching.", now)
            if self.full_violations >= self.rules.proctor_final_warning_at:
                return self._order("final_warning", f"{mention} Give a firm final warning: one more and you will end the interview.", now)
        return self._order("mention_violation", f"{mention} Mention it briefly and ask them to stay on this screen.", now)

    def on_conduct(self, kind: str, quote: str, turn_id: str, source: str) -> Order | None:
        if turn_id in self.conduct_turns:
            return None
        self.conduct_turns.add(turn_id)
        now = self.clock()
        self.conduct.append({"kind": kind, "quote": (quote or "")[:300], "turn_id": turn_id, "source": source, "at": now})
        self.triggers.add("conduct")
        if len(self.conduct) >= self.rules.conduct_end_at:
            return self._end("ended_by_interviewer",
                             f"The candidate repeated unacceptable conduct ({kind}). Say firmly, without insults, that you "
                             "are ending the interview because of it.", now)
        return self._order("conduct_warning",
                           f"The candidate's last remark was not acceptable ({kind}). Say plainly and firmly that it isn't "
                           "appropriate in an interview and must not happen again, then continue.", now)

    def on_redirect(self, turn_id: str) -> Order | None:
        item_id = self.current().item_id
        self.redirects[item_id] = self.redirects.get(item_id, 0) + 1
        if self.redirects[item_id] >= self.rules.off_topic_redirects:
            self.redirects[item_id] = 0
            return self.on_conduct("persistent_off_topic", "", turn_id, "conductor")
        return None

    def on_end_request(self) -> Order:
        return self._end("candidate_ended", "The candidate asked to end the interview. Thank them briefly and say goodbye.", self.clock())

    # ------------------------------------------------------------ time

    def tick(self) -> list[Order]:
        if self.ended or self.started_at is None:
            return []
        now = self.clock()
        item = self.current()
        new: list[Order] = []
        round_fired = self.fired.setdefault("_round", set())
        if now - self.started_at >= self.rules.ceiling_factor * self.round_seconds and item.phase != "wrap_up" \
                and "ceiling" not in round_fired:
            round_fired.add("ceiling")
            wrap = next((i for i, it in enumerate(self.items) if it.phase == "wrap_up"), None)
            if wrap is not None and wrap != self.index:
                for it in self.items[self.index:wrap]:
                    if it.status == "active":
                        it.status, it.ended_at, it.ended_by = "done", now, "ceiling"
                    elif it.status == "pending":
                        it.status = "skipped"
                self._activate(wrap, now)
                new.append(self._order("wrap_up_now", "We are well past the planned time. Move straight to the wrap-up: "
                                                      "thank the candidate and close.", now))
                return new
        elapsed = now - (item.started_at or now)
        fired = self.fired.setdefault(item.item_id, set())
        if item.max_seconds > 0:
            if elapsed >= 0.5 * item.max_seconds and "half" not in fired:
                fired.add("half")
                self.triggers.add("time")
            if item.kind in ("slot", "filler") and elapsed >= self.rules.converge_at * item.max_seconds and "converge" not in fired:
                fired.add("converge")
                self.triggers.add("time")
                new.append(self._order("converge", "Time on this question is nearly up. Ask for their final approach and its complexity.", now))
            if elapsed >= item.max_seconds and "move_on" not in fired:
                if not self.candidate_speaking or elapsed - item.max_seconds >= self.rules.grace_seconds:
                    fired.add("move_on")
                    self.triggers.add("time")
                    text = ("Time for this question is up. Say something like 'seems like we have to move on', note where they "
                            "got to, then call next_item. Decline any request for more time firmly."
                            if item.kind in ("slot", "filler") else "This part's time is up. Move on naturally and call next_item.")
                    new.append(self._order("move_on", text, now))
        if not self.candidate_speaking and not self.agent_speaking:
            coding = item.kind == "slot"
            limit = self.rules.silence_coding_s if coding else self.rules.silence_talking_s
            if now - max(self.last_activity, self.nudged_at) >= limit:
                self.nudged_at = now
                new.append(self._order("nudge", (
                    "The candidate has been quiet with no code changes for a while. Ask how it's going and invite them to "
                    "talk through their thinking." if coding else
                    "The candidate has been quiet for a while. Check in gently: ask what they are thinking."), now))
        return new

    # ------------------------------------------------------------ director briefs

    def apply_brief(self, brief: dict[str, Any]) -> dict[str, Any]:
        if brief.get("for_position") != self.position:
            dropped = ["goal", "next_move"] + [f"plan_change:{c.get('op')}" for c in brief.get("plan_changes") or []]
            return {"stale": True, "applied": [], "dropped": dropped}
        applied: list[dict[str, Any]] = []
        dropped: list[dict[str, Any]] = []
        for change in brief.get("plan_changes") or []:
            ok, why = self._apply_change(change)
            if ok:
                applied.append(change)
                self.plan_changes.append({**change, "at": self.clock(), "position": self.position})
            else:
                dropped.append({**change, "why": why})
        return {"stale": False, "applied": applied, "dropped": dropped}

    def _apply_change(self, change: dict[str, Any]) -> tuple[bool, str]:
        op = change.get("op")
        target = str(change.get("target") or "")
        now = self.clock()
        if op == "skip":
            idx = self._find(target)
            if idx is None or self.items[idx].status != "pending" or self.items[idx].phase in PROTECTED_PHASES:
                return False, "only a pending item outside the candidate questions and wrap-up can be skipped"
            self.items[idx].status = "skipped"
            return True, ""
        if op == "reorder":
            idx, before = self._find(target), self._find(str(change.get("before") or ""))
            if idx is None or before is None or self.items[idx].status != "pending" or self.items[before].status != "pending" \
                    or self.items[idx].kind != "slot":
                return False, "only pending problems can be reordered, before another pending item"
            item = self.items.pop(idx)
            self.items.insert(self._find(str(change["before"])) or before, item)
            return True, ""
        if op == "use_reserve":
            slot = self.reserves.get(target)
            replace = str(change.get("replace") or self.current().item_id)
            ridx = self._find(replace)
            if slot is None or ridx is None or self.items[ridx].kind != "slot" or self.items[ridx].status not in ("active", "pending"):
                return False, "needs an unused reserve and a current or pending problem to replace"
            del self.reserves[target]
            new_item = Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"])
            replaced = self.items[ridx]
            self.items.insert(ridx + 1, new_item)
            if ridx == self.index:
                replaced.status, replaced.ended_at, replaced.ended_by = "swapped", now, "use_reserve"
                self._activate(ridx + 1, now)
            else:
                replaced.status = "swapped"
            return True, ""
        if op == "insert_filler":
            question, skill = str(change.get("question") or "").strip(), str(change.get("skill") or "").strip()
            if not question or not skill:
                return False, "a filler needs a question and the profile skill it comes from"
            if self.skills and skill.lower() not in self.skills:
                return False, f"{skill!r} is not a skill in the candidate's profile"
            if self.started_at is not None and now - self.started_at >= self.round_seconds:
                return False, "the round is past its planned length"
            number = sum(1 for it in self.items if it.kind == "filler") + 1
            filler = Item(f"filler-{number}", "filler", "core", self.rules.filler_max_s,
                          filler={"question": question[:500], "skill": skill, "sound_answer": str(change.get("sound_answer") or "")[:1000]})
            self.items.insert(self.index + 1, filler)
            return True, ""
        if op == "add_follow_up":
            text = str(change.get("text") or "").strip()
            if not text:
                return False, "empty follow-up"
            self.follow_ups.setdefault(self.current().item_id, []).append(text[:500])
            return True, ""
        return False, f"unknown op {op!r}"

    # ------------------------------------------------------------ summary and checkpoints

    def live_summary(self, counts: dict[str, Any]) -> dict[str, Any]:
        return {
            "tab_changes": int(counts.get("tab_changes", 0)),
            "screen_changes_weighted": float(counts.get("screen_changes", 0)),
            "full_violations": self.full_violations,
            "conduct_incidents": len(self.conduct),
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "interviewer_note": next((o.text for o in self.orders if o.kind == "end"), ""),
        }

    def checkpoint(self) -> dict[str, Any]:
        return {
            "items": [asdict(i) for i in self.items], "index": self.index, "position": self.position,
            "started_at": self.started_at, "reserves": sorted(self.reserves), "orders": [asdict(o) for o in self.orders],
            "proctor": self.proctor, "full_violations": self.full_violations, "conduct": self.conduct,
            "conduct_turns": sorted(self.conduct_turns), "redirects": self.redirects, "labels": self.labels,
            "follow_ups": self.follow_ups, "plan_changes": self.plan_changes, "fired": {k: sorted(v) for k, v in self.fired.items()},
            "ended": self.ended, "end_reason": self.end_reason,
        }

    @classmethod
    def restore(cls, blueprint: dict[str, Any], round_seconds: int, data: dict[str, Any], rules: Rules | None = None,
                clock: Callable[[], float] = time.time, skills: tuple[str, ...] | list[str] = ()) -> "Conductor":
        c = cls(blueprint, round_seconds, rules, clock, skills)
        c.items = [Item(**i) for i in data["items"]]
        c.index, c.position, c.started_at = data["index"], data["position"], data["started_at"]
        c.reserves = {k: v for k, v in c.reserves.items() if k in set(data.get("reserves", []))}
        c.orders = [Order(**o) for o in data.get("orders", [])]
        c.proctor, c.full_violations, c.conduct = data.get("proctor", []), data.get("full_violations", 0), data.get("conduct", [])
        c.conduct_turns = set(data.get("conduct_turns", []))
        c.redirects, c.labels = data.get("redirects", {}), data.get("labels", {})
        c.follow_ups, c.plan_changes = data.get("follow_ups", {}), data.get("plan_changes", [])
        c.fired = {k: set(v) for k, v in data.get("fired", {}).items()}
        c.ended, c.end_reason = data.get("ended", False), data.get("end_reason")
        now = clock()
        c.last_activity = now
        c.nudged_at = now
        return c
```

Note on `reorder`: after `pop`, indices after `idx` shift by one, so the insert position is looked up again by id.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_conductor.py -q`
Expected: PASS (12 tests).

---

### Task 5: The leak guard

**Files:**
- Create: `apps/ai-service/app/interviewer/guard.py`
- Create: `apps/ai-service/tests/interviewer/test_guard.py`

**Interfaces:**
- Produces: `NEUTRAL_LINE = "What do you think?"`, `Verdict(ok, rule="", match="")`, `LeakGuard(blueprint)` with `check_sentence(text, *, current_slot, candidate_said="") -> Verdict` and `check_code(text) -> Verdict`. Rules: `solution_code`, `example_read_aloud`, `name_or_topic`, `difficulty`.

Decision recorded here: the blueprint slot carries no bank topic tags, and a slot's `patterns` overlap the hint ladder's wording ("a lookup structure"), so the guard blocks problem **titles** (for every slot) rather than topic words. The talker's rules forbid naming topics, and the director's `leak_review` audits it.

- [ ] **Step 1: Write the failing test**

```python
from app.interviewer.guard import LeakGuard
from tests.interviewer.fixtures import blueprint


def guard() -> LeakGuard:
    return LeakGuard(blueprint())


def test_lets_ordinary_interviewer_speech_through():
    assert guard().check_sentence("Nice, what's the complexity of that loop?", current_slot="core-1").ok


def test_blocks_reference_solution_code_in_speech_and_in_code_inserts():
    g = guard()
    spoken = "You could write for i, x in enumerate(nums): if target - x in seen: return [seen[target - x], i]."
    assert g.check_sentence(spoken, current_slot="core-1").rule == "solution_code"
    assert g.check_code("for i, x in enumerate(nums):\n    if target - x in seen:\n        return [seen[target - x], i]").rule == "solution_code"
    assert g.check_code("print(pair_sum([1, 2], 3))  # expect [0, 1]").ok


def test_blocks_reading_the_current_examples_aloud():
    g = guard()
    assert g.check_sentence("For nums equal to [2, 7, 11, 15] the answer is clear.", current_slot="core-1").rule == "example_read_aloud"
    assert g.check_sentence("For nums equal to [2, 7, 11, 15] the answer is clear.", current_slot=None).ok


def test_blocks_problem_names_unless_the_candidate_said_them_first():
    g = guard()
    assert g.check_sentence("This is the classic Pair Sum problem.", current_slot="core-1").rule == "name_or_topic"
    assert g.check_sentence("Yes, it's like pair sum.", current_slot="core-1", candidate_said="isn't this just pair sum?").ok
    assert g.check_sentence("Next up is Island Count.", current_slot="core-1").rule == "name_or_topic"


def test_blocks_difficulty_labels():
    assert guard().check_sentence("Don't worry, this one is an easy problem.", current_slot="core-1").rule == "difficulty"
    assert guard().check_sentence("That's a hard question to answer quickly, take your time.", current_slot="core-1").rule == "difficulty"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_guard.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `guard.py`**

```python
"""The leak guard (spec §5.5): checks each sentence before the voice speaks it, and every code insert
before it is sent. Deterministic rules; the director's leak_review audits what rules can't catch."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

NGRAM = 6
MIN_SHARED_NGRAMS = 2
NEUTRAL_LINE = "What do you think?"
_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|[-+*/%<>=\[\](){}:,.]")
_DIFFICULTY = re.compile(
    r"\b(easy|medium|hard)\b[^.?!]{0,20}\b(problem|question|one|level)\b|\b(problem|question)\b[^.?!]{0,20}\b(easy|medium|hard)\b",
    re.IGNORECASE)


@dataclass
class Verdict:
    ok: bool
    rule: str = ""
    match: str = ""


def _ngrams(text: str) -> set[tuple[str, ...]]:
    tokens = _TOKEN.findall(text)
    return {tuple(tokens[i:i + NGRAM]) for i in range(len(tokens) - NGRAM + 1)}


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


class LeakGuard:
    def __init__(self, blueprint: dict[str, Any]) -> None:
        self.solutions: dict[str, set[tuple[str, ...]]] = {}
        self.examples: dict[str, list[str]] = {}
        self.titles: list[str] = []
        for slot in blueprint.get("slots", []):
            sid = slot["slot_id"]
            key = (slot.get("answer_key") or {}).get("key") or {}
            self.solutions[sid] = _ngrams(((key.get("reference_solution") or {}).get("code")) or "")
            content = (slot.get("problem") or {}).get("content") or {}
            literals: list[str] = []
            for ex in (content.get("examples") or [])[:2]:
                for value in [*(ex.get("args") or {}).values(), ex.get("expected")]:
                    lit = _squash(json.dumps(value, ensure_ascii=False)).strip('"')
                    if len(lit) >= 4 or lit.startswith("["):
                        literals.append(lit)
            self.examples[sid] = literals
            title = ((slot.get("problem") or {}).get("title") or "").strip().lower()
            if len(title) >= 4:
                self.titles.append(title)

    def _solution(self, text: str) -> Verdict | None:
        grams = _ngrams(text)
        for sid, solution in self.solutions.items():
            if solution and len(grams & solution) >= MIN_SHARED_NGRAMS:
                return Verdict(False, "solution_code", sid)
        return None

    def check_sentence(self, text: str, *, current_slot: str | None, candidate_said: str = "") -> Verdict:
        if (v := self._solution(text)) is not None:
            return v
        flat = _squash(text)
        for literal in self.examples.get(current_slot or "", []):
            if literal in flat:
                return Verdict(False, "example_read_aloud", literal)
        low, said = text.lower(), candidate_said.lower()
        for title in self.titles:
            if title in low and title not in said:
                return Verdict(False, "name_or_topic", title)
        if (m := _DIFFICULTY.search(text)) is not None:
            return Verdict(False, "difficulty", m.group(0))
        return Verdict(True)

    def check_code(self, text: str) -> Verdict:
        return self._solution(text) or Verdict(True)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_guard.py -q`
Expected: PASS (5 tests).

---

### Task 6: The brief model and the prompts (PRODUCT IP drafts)

**Files:**
- Create: `apps/ai-service/app/interviewer/brief.py`
- Create: `apps/ai-service/app/interviewer/prompts.py`
- Create: `apps/ai-service/tests/interviewer/test_prompts.py`

**Interfaces:**
- Consumes: `slot_by_id` (Task 3), `Order` (Task 4).
- Produces (`brief.py`): `NextMove`, `PlanChange`, `EvidenceNote`, `Conduct`, `LeakReview`, `Brief(for_position, goal, next_move, plan_changes, tone, evidence, summary, conduct, leak_review)`, `BRIEF_SCHEMA`.
- Produces (`prompts.py`): `LIVE_POLICY_OVERRIDES`, `talker_prefix(blueprint, context) -> str`, `item_details(blueprint, view_item: dict) -> str`, `state_block(view: dict) -> str`, `talker_messages(prefix, state, history, proactive) -> list[dict]`, `director_messages(blueprint, context, snapshot, image) -> list[dict]`, `PROACTIVE_NOTE`.
- The `view` for `state_block`: `{"round_elapsed_min", "round_min", "item": {"item_id","kind","phase","elapsed_min","max_min","hint_step","slot_id","filler"}, "orders": [{"kind","text"}], "brief": {"goal","next_move","tone"} | None, "follow_ups": [str], "ask": {"surface","quote"} | None, "code": {"language","version","lines"} | None, "board": str, "summary": str}`.

- [ ] **Step 1: Write the failing test**

```python
from app.interviewer.brief import BRIEF_SCHEMA, Brief
from app.interviewer.prompts import director_messages, item_details, state_block, talker_messages, talker_prefix
from tests.interviewer.fixtures import REFERENCE, blueprint, context


def test_prefix_carries_persona_rules_live_overrides_and_an_outline_without_names():
    p = talker_prefix(blueprint(), context())
    assert "Siddharth Menon" in p and "Asha" in p
    assert "Never read out examples" in p
    assert "Decline firmly once the question's time is up" in p
    assert "- core-1: coding problem (20 min)" in p and "Reserve problems: reserve-alternate" in p
    assert "Pair Sum" not in p and "Island Count" not in p


def test_item_details_show_the_playbook_and_key_but_never_the_reference_code():
    text = item_details(blueprint(), {"item_id": "core-1", "kind": "slot", "slot_id": "core-1", "hint_step": 1, "phase": "core"})
    assert "1. (given) What do you need to remember as you scan?" in text
    assert "2. A lookup structure could help." in text
    assert "stuck → give_hint" in text and "look up the complement" in text
    assert REFERENCE.splitlines()[2].strip() not in text
    assert "reveal" in text


def test_state_block_lists_orders_ask_and_numbered_code():
    text = state_block({
        "round_elapsed_min": 12, "round_min": 60,
        "item": {"item_id": "core-1", "kind": "slot", "phase": "core", "elapsed_min": 8, "max_min": 20, "hint_step": 0, "slot_id": "core-1", "filler": None},
        "orders": [{"kind": "move_on", "text": "Time for this question is up."}],
        "brief": {"goal": "check complexity", "next_move": {"action": "ask_complexity", "detail": ""}, "tone": "encouraging"},
        "follow_ups": ["What if it streams?"], "ask": {"surface": "statement", "quote": "exactly one answer"},
        "code": {"language": "python", "version": 3, "lines": ["def f():", "    pass"]}, "board": "", "summary": "Intro went well.",
    })
    assert "[move_on] Time for this question is up." in text
    assert 'asking about this (statement): "exactly one answer"' in text
    assert "1| def f():" in text and "2|     pass" in text
    assert "12 of ~60 min" in text


def test_talker_messages_add_a_note_for_proactive_turns():
    msgs = talker_messages("P", "S", [{"role": "user", "content": "hi"}], proactive=True)
    assert [m["role"] for m in msgs] == ["system", "system", "user", "user"]
    assert "No new speech" in msgs[-1]["content"]
    assert talker_messages("P", "S", [{"role": "user", "content": "hi"}], proactive=False)[-1]["content"] == "hi"


def test_director_messages_carry_the_schema_and_an_optional_image():
    snapshot = {"position": 4, "items": [], "current": {}, "transcript": [], "summary": "", "code": None, "board": "",
                "proctor": [], "conduct": [], "plan_changes": [], "last_brief": None}
    msgs = director_messages(blueprint(), context(), snapshot, b"\x89PNG")
    assert "for_position" in msgs[0]["content"]
    assert msgs[1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert Brief.model_validate({"for_position": 4}).conduct.concern == "none"
    assert "plan_changes" in BRIEF_SCHEMA["properties"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_prompts.py -q`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `brief.py`**

```python
"""The director's brief (spec §5.2): the structured output the background LLM writes every few turns."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


class NextMove(_M):
    action: str = ""
    detail: str = ""


class PlanChange(_M):
    op: Literal["reorder", "skip", "use_reserve", "insert_filler", "add_follow_up"]
    target: str = ""
    before: str = ""
    replace: str = ""
    question: str = ""
    skill: str = ""
    sound_answer: str = ""
    text: str = ""
    reason: str = ""


class EvidenceNote(_M):
    item_id: str
    signal: str
    observation: str
    turn_ids: list[int] = Field(default_factory=list)


class Conduct(_M):
    concern: Literal["none", "warn", "end"] = "none"
    reason: str = ""


class LeakReview(_M):
    revealed_too_much: bool = False
    detail: str = ""


class Brief(_M):
    for_position: int
    goal: str = ""
    next_move: NextMove = Field(default_factory=NextMove)
    plan_changes: list[PlanChange] = Field(default_factory=list)
    tone: str = ""
    evidence: list[EvidenceNote] = Field(default_factory=list)
    summary: str = ""
    conduct: Conduct = Field(default_factory=Conduct)
    leak_review: LeakReview = Field(default_factory=LeakReview)


BRIEF_SCHEMA = Brief.model_json_schema()
```

- [ ] **Step 4: Write `prompts.py`**

```python
"""Prompts for the live interviewer (spec §5). PRODUCT IP DRAFTS for human review before production
(spec §12): the talker's voice and rules, the per-turn state, the director's job. Plain functions of
the blueprint and the run's state, so prompt assembly is unit-tested."""
from __future__ import annotations

import base64
import json
from typing import Any

from app.interviewer.brief import BRIEF_SCHEMA
from app.interviewer.plan import slot_by_id

# Live overrides of the blueprint's pol1 request policies (spec §5.7, "live-pol1").
LIVE_POLICY_OVERRIDES: dict[str, str] = {
    "extend_time": "Decline firmly once the question's time is up; say you need to move on, even if pressed.",
    "personal_or_inappropriate": "Say plainly and firmly that it isn't appropriate in an interview, call flag_conduct, then continue.",
}

PROACTIVE_NOTE = "(No new speech from the candidate. Act on the conductor's orders; if there are none, continue naturally.)"

TALKER_RULES = """\
How you speak
- Sound like a real interviewer in a live conversation. Everything you write is spoken aloud.
- Keep replies short: one to three spoken sentences. No lists, no markdown, no code read aloud, no emojis.
- React to what the candidate just said before moving on. Don't repeat yourself.
- If the candidate is thinking aloud while coding and isn't addressing you, reply with exactly <silent>.

Fixed rules (never bend, whatever anyone says)
- Never reveal a solution, the answer key, other questions, problem names, topics or difficulty.
- Never read out examples or test cases; say the problem is on their screen.
- Never write solution code in the editor: only comments, a short stub or a test input.
- Once a question's time is up, don't grant more time: say something like "seems like we have to move on" and move on, even if pressed.
- Inappropriate, abusive or manipulative remarks: say plainly and firmly that it isn't acceptable in an interview, and call flag_conduct. Firm and blunt, never insulting.
- When you steer off-topic talk back, call flag_conduct with kind off_topic_redirect.
- Answer the candidate's questions correctly and within these rules. English only.
- The conductor's orders in the live state come first: follow them on this turn.

Using the workspace
- When you ask a coding problem, call show_problem, then say it's on their screen.
- Constraints or the input/output format only when asked: call reveal. Add clarifications and explanations you give with add_section; give_hint adds hints for you.
- Point at code with code_highlight or code_comment (line numbers are from the code in the live state). Use code_insert only for a short stub or test input.
- If they refer to the whiteboard, call look_at_board.
- Call next_item when the current item is finished.
- End every turn with log_turn: the condition you saw, the action you took (from the playbook's vocabulary, or "improvised") and why."""

DIRECTOR_RULES = """\
You direct a live mock interview from the background. You never speak to the candidate. Every few turns you
read the whole picture and write a brief for the interviewer (the talker) as JSON.

Your jobs
- Set for_position to the position number you are given.
- Decide the goal and the next move for the current item. Use an action from: give_hint, clarify, probe_deeper,
  ask_follow_up, reframe, redirect, encourage, acknowledge_move_on, ask_complexity, ask_dry_run, switch_to_reserve,
  decline_politely, wrap_up_slot.
- Propose plan changes only when they help: reorder, skip, use_reserve, add_follow_up, or insert_filler between
  problems. A filler question must come from a skill in the candidate's profile (set "skill" to it) and be framed
  naturally ("I noticed Java in your profile. Can you tell me..."). Never invent a coding problem.
- Note evidence against the evaluation signals, citing transcript turn ids. Evidence, not scores.
- Keep a running summary of the interview so far, under 120 words.
- Flag conduct ("warn" or "end") only for clearly unacceptable behaviour.
- Review whether the interviewer revealed more than the hint ladder allowed so far.
- Tone: short notes for the interviewer ("candidate is nervous; slow down")."""


def talker_prefix(blueprint: dict[str, Any], context: dict[str, Any]) -> str:
    persona = blueprint.get("persona") or {}
    rnd = context.get("round") or {}
    requests = (blueprint.get("policies") or {}).get("requests") or []
    policies = [f"- {p['kind']}: {LIVE_POLICY_OVERRIDES.get(p['kind'], p['how'])}" for p in requests]
    outline: list[str] = []
    for phase in blueprint.get("arc", []):
        if phase["phase"] == "core":
            core = sorted((s for s in blueprint.get("slots", []) if s.get("kind") == "core"), key=lambda s: s.get("order", 0))
            outline += [f"- {s['slot_id']}: coding problem ({s['timebox_mins']} min)" for s in core]
        else:
            outline.append(f"- {phase['phase']} ({phase['timebox_mins']} min)")
    reserves = [s["slot_id"] for s in blueprint.get("slots", []) if s.get("kind") == "reserve"]
    candidate = context.get("first_name") or "the candidate"
    company = rnd.get("company_name") or rnd.get("company") or "the company"
    return "\n\n".join([
        f"You are {persona.get('name', 'the interviewer')}, {persona.get('seniority', 'an engineer')}, interviewing "
        f"{candidate} for a {rnd.get('role', 'software')} role ({rnd.get('level', '')}) at {company}. This is a live "
        "voice mock interview: everything you write is spoken aloud.",
        f"Your manner: {persona.get('style', '')}. {persona.get('disposition', '')}",
        TALKER_RULES,
        "Request policies\n" + "\n".join(policies),
        "The plan (follow it, but adapt to the candidate)\n" + "\n".join(outline)
        + (f"\nReserve problems: {', '.join(reserves)}" if reserves else ""),
        f"What this level should show: {(blueprint.get('personalization') or {}).get('level_expectations', '')}",
    ])


def _phase_details(blueprint: dict[str, Any], phase: str) -> list[str]:
    persona = blueprint.get("persona") or {}
    personal = blueprint.get("personalization") or {}
    guidance = next((p.get("guidance", "") for p in blueprint.get("arc", []) if p["phase"] == phase), "")
    lines = [f"Phase: {phase}. {guidance}".strip()]
    if phase == "greeting":
        lines.append(f"Open with something like: {persona.get('opening', '')}")
    elif phase == "small_talk":
        lines += [f"Rapport idea: {h['line']}" for h in personal.get("rapport_hooks", [])]
    elif phase == "candidate_intro":
        lines.append("Ask for a short introduction, then follow up on one thing they mention.")
        lines += [f"Resume probe: {p['prompt']}" for p in personal.get("resume_probes", [])]
    elif phase == "candidate_questions":
        lines.append("Invite their questions. Answer honestly and generally; never claim to represent the company.")
    elif phase == "wrap_up":
        lines.append(f"Close with something like: {persona.get('closing', '')} Then call next_item.")
    return lines


def item_details(blueprint: dict[str, Any], item: dict[str, Any]) -> str:
    if item["kind"] == "phase":
        return "\n".join(_phase_details(blueprint, item["phase"]))
    if item["kind"] == "filler":
        f = item.get("filler") or {}
        return "\n".join(["A short question from the candidate's profile, between problems (keep it to a few minutes).",
                          f"Ask, framed naturally: {f.get('question', '')}",
                          f"A sound answer covers: {f.get('sound_answer', '') or 'use your judgement'}"])
    slot = slot_by_id(blueprint, item.get("slot_id")) or {}
    key = (slot.get("answer_key") or {}).get("key") or {}
    step = int(item.get("hint_step") or 0)
    lines = [f"Problem {item['item_id']}. Open with: {(slot.get('ask') or {}).get('opening', '')}",
             "Call show_problem when you ask it. Constraints and the input/output format exist; reveal them only when asked."]
    lines += [f"Clarification: {c['question']} → {c['answer']}" for c in (slot.get("ask") or {}).get("clarifications", [])]
    lines.append("Hint ladder (give the next step only):")
    lines += [f"  {h['step']}. {'(given) ' if h['step'] <= step else ''}{h['hint']}" for h in slot.get("hint_ladder", [])]
    lines.append("Playbook (condition → action: what to say):")
    lines += [f"  {b['condition']} → {b['action']}: {b['say']}" for b in slot.get("branches", [])]
    lines += [f"Probe: {p}" for p in slot.get("probes", [])]
    lines += [f"Follow-up: {f}" for f in slot.get("follow_ups", [])]
    lines.append("A good answer must show: " + "; ".join((slot.get("expectations") or {}).get("must_show", [])))
    lines.append("Answer key (for judging only; never reveal):")
    lines += [f"  Approach {a['name']}: {a['idea']} ({a['time_complexity']} time, {a['space_complexity']} space)" for a in key.get("approaches", [])]
    if key.get("complexity_target"):
        lines.append(f"  Target: {key['complexity_target']}")
    lines += [f"  Insight: {i}" for i in key.get("key_insights", [])]
    lines += [f"  Wrong path: {w['path']} → nudge: {w['nudge']}" for w in key.get("common_wrong_paths", [])]
    lines += [f"  Edge case: {e}" for e in key.get("edge_cases", [])]
    return "\n".join(lines)


def state_block(view: dict[str, Any]) -> str:
    item = view["item"]
    lines = ["## Live state",
             f"Round time: {view['round_elapsed_min']} of ~{view['round_min']} min. Current item: {item['item_id']} "
             f"({item['kind']}), {item['elapsed_min']} of ~{item['max_min']} min, hint step {item['hint_step']}."]
    if view.get("orders"):
        lines.append("Conductor orders (follow these now):")
        lines += [f"- [{o['kind']}] {o['text']}" for o in view["orders"]]
    brief = view.get("brief")
    if brief:
        move = brief.get("next_move") or {}
        lines.append(f"Director brief: goal: {brief.get('goal', '')}; next move: {move.get('action', '')} {move.get('detail', '')}".rstrip()
                     + (f"; tone: {brief['tone']}" if brief.get("tone") else ""))
    if view.get("follow_ups"):
        lines += [f"Follow-up to use: {f}" for f in view["follow_ups"]]
    if view.get("ask"):
        lines.append(f'The candidate is asking about this ({view["ask"]["surface"]}): "{view["ask"]["quote"]}"')
    code = view.get("code")
    if code and code.get("lines"):
        lines.append(f"## Candidate's code ({code['language']}, version {code['version']})")
        lines += [f"{n}| {line}" for n, line in enumerate(code["lines"], start=1)]
    if view.get("board"):
        lines += ["## Whiteboard", view["board"]]
    if view.get("summary"):
        lines += ["## Earlier in the interview", view["summary"]]
    return "\n".join(lines)


def talker_messages(prefix: str, state: str, history: list[dict[str, Any]], proactive: bool) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": prefix}, {"role": "system", "content": state}, *history]
    if proactive:
        messages.append({"role": "user", "content": PROACTIVE_NOTE})
    return messages


def director_messages(blueprint: dict[str, Any], context: dict[str, Any], snapshot: dict[str, Any],
                      image: bytes | None) -> list[dict[str, Any]]:
    profile = context.get("profile") or {}
    slots = [{"slot_id": s["slot_id"], "kind": s["kind"], "timebox_mins": s.get("timebox_mins"),
              "hint_ladder": s.get("hint_ladder"), "expectations": s.get("expectations"),
              "evaluation_signals": s.get("evaluation_signals"), "answer_key": (s.get("answer_key") or {}).get("key")}
             for s in blueprint.get("slots", [])]
    payload = {
        "position": snapshot["position"], "round": context.get("round"),
        "candidate": {"first_name": context.get("first_name"), "skills": profile.get("skills", []), "projects": profile.get("projects", [])},
        "plan": snapshot["items"], "current_item": snapshot["current"], "slots": slots,
        "global_signals": (blueprint.get("evaluation") or {}).get("global_signals", []),
        "transcript": snapshot["transcript"], "summary_so_far": snapshot["summary"], "code": snapshot["code"],
        "whiteboard": snapshot["board"], "proctor": snapshot["proctor"], "conduct": snapshot["conduct"],
        "plan_changes_so_far": snapshot["plan_changes"], "last_brief": snapshot["last_brief"],
    }
    user: list[dict[str, Any]] = [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)}]
    if image:
        user.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode()}})
    system = DIRECTOR_RULES + "\n\nReply with JSON matching this schema (for_position is required):\n" + json.dumps(BRIEF_SCHEMA)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_prompts.py -q`
Expected: PASS (5 tests).

---

### Task 7: Talker tools and the talker turn

**Files:**
- Create: `apps/ai-service/app/interviewer/tools.py`
- Create: `apps/ai-service/app/interviewer/talker.py`
- Create: `apps/ai-service/tests/interviewer/fakes.py`
- Create: `apps/ai-service/tests/interviewer/test_talker.py`

**Interfaces:**
- Consumes: `OpenRouterChat`/`StreamEvent`/`ToolCall`/`LLMUnavailable` (Task 1), `new_id` (Task 2), `slot_by_id`, `problem_payload`, `reveal_text` (Task 3), `LeakGuard`, `NEUTRAL_LINE` (Task 5).
- Produces (`tools.py`): `TOOLS` (OpenAI tool schemas), `TOOL_NAMES`, `ToolExecutor(run)` with `execute(call, turn_id) -> dict`. It reads `run.conductor`, `run.guard`, `run.d.blueprint`, `run.d.workspace` (`send(body) -> str`, `code_lines() -> list[str]`, `request_snapshot() -> bytes | None`).
- Produces (`talker.py`): `STALL_LINE`, `SILENT`, `TalkerFailed`, `TurnResult(spoken, blocked, tool_calls, decision, first_token_ms, usage, provider, interrupted, error)`, `TalkerTurn(chat, guard, tools, first_token_timeout_s, clock=time.perf_counter)` with `run(messages, *, turn_id, current_slot, candidate_said) -> AsyncIterator[str]` and attribute `last: TurnResult`.
- Produces (`tests/interviewer/fakes.py`): `FakeChat(turns=[...], briefs=[...])`, `say(*sentences, tools=())`, `FakeWorkspace`, `FakeSpeaker`, `FakeApi`.

- [ ] **Step 1: Write the fakes**

Create `tests/interviewer/fakes.py`:

```python
"""Fakes for the interviewer tests: a scripted chat, workspace, speaker and API."""
from __future__ import annotations

import asyncio
from typing import Any

from app.interviewer.llm import LLMUnavailable, StreamEvent, ToolCall


def say(*sentences: str, tools: tuple[tuple[str, dict], ...] = ()) -> list[StreamEvent]:
    """One scripted talker reply: text chunks, then tool calls, then done."""
    events = [StreamEvent("text", text=s + " ") for s in sentences]
    events += [StreamEvent("tool_call", tool_call=ToolCall(f"c{i}", name, args)) for i, (name, args) in enumerate(tools)]
    return events + [StreamEvent("done", usage={"total_tokens": 10}, provider="fake")]


class FakeChat:
    """`turns` is consumed one per stream() call; an entry may be a list of events, an Exception to raise
    before the first event, or "hang" to never produce one."""

    def __init__(self, turns: list[Any] | None = None, briefs: list[Any] | None = None) -> None:
        self.turns = list(turns or [])
        self.briefs = list(briefs or [])
        self.calls: list[list[dict]] = []

    async def stream(self, messages, tools=None, max_tokens=400):
        self.calls.append(messages)
        turn = self.turns.pop(0) if self.turns else [StreamEvent("done")]
        if turn == "hang":
            await asyncio.sleep(3600)
        if isinstance(turn, Exception):
            raise turn
        for event in turn:
            await asyncio.sleep(0)
            yield event

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append(messages)
        brief = self.briefs.pop(0) if self.briefs else LLMUnavailable("no brief scripted")
        if isinstance(brief, Exception):
            raise brief
        return brief, {"total_tokens": 5}

    async def aclose(self):
        pass


class FakeWorkspace:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.lines: list[str] = []
        self.png: bytes | None = None
        self.board_summary = ""
        self.mirror: dict = {}

    async def send(self, body: dict) -> str:
        self.sent.append(body)
        return f"m{len(self.sent)}"

    def code_lines(self) -> list[str]:
        return self.lines

    async def request_snapshot(self) -> bytes | None:
        return self.png

    def mirror_state(self) -> dict:
        return self.mirror

    def restore_mirror(self, data: dict) -> None:
        self.mirror = data

    def of(self, message_type: str) -> list[dict]:
        return [m for m in self.sent if m["type"] == message_type]


class FakeSpeaker:
    def __init__(self) -> None:
        self.replies = 0
        self.said: list[str] = []
        self.deleted = False

    def reply(self) -> None:
        self.replies += 1

    async def say(self, text: str) -> None:
        self.said.append(text)

    async def wait_for_playout(self) -> None:
        pass

    async def delete_room(self) -> None:
        self.deleted = True


class FakeApi:
    def __init__(self) -> None:
        self.ended: list[tuple[str, str, dict]] = []

    async def end(self, session_id: str, reason: str, summary: dict) -> dict:
        self.ended.append((session_id, reason, summary))
        return {"status": "COMPLETED"}
```

- [ ] **Step 2: Write the failing test**

Create `tests/interviewer/test_talker.py`:

```python
"""One talker turn: guarded sentences, tools after the text, the whiteboard follow-up, timeouts, interruption."""
import asyncio
from types import SimpleNamespace

import pytest

from app.interviewer.conductor import Conductor
from app.interviewer.guard import NEUTRAL_LINE, LeakGuard
from app.interviewer.llm import LLMUnavailable
from app.interviewer.talker import STALL_LINE, TalkerFailed, TalkerTurn
from app.interviewer.tools import ToolExecutor
from tests.interviewer.fakes import FakeChat, FakeWorkspace, say
from tests.interviewer.fixtures import Clock, blueprint


def make(turns, timeout=0.2):
    bp = blueprint()
    conductor = Conductor(bp, 3600, clock=Clock(), skills=["Java"])
    conductor.start()
    conductor.next_item("done")
    conductor.next_item("done")  # now on core-1
    workspace = FakeWorkspace()
    run = SimpleNamespace(conductor=conductor, guard=LeakGuard(bp), d=SimpleNamespace(blueprint=bp, workspace=workspace))
    chat = FakeChat(turns)
    turn = TalkerTurn(chat, run.guard, ToolExecutor(run), first_token_timeout_s=timeout)
    return turn, run, workspace, chat


async def collect(turn, **kw):
    return [s async for s in turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="", **kw)]


def test_speaks_sentences_then_runs_tools_and_records_the_decision():
    turn, run, ws, _ = make([say("Let's start with a problem.", "It's on your screen now.",
                                 tools=(("show_problem", {"item_id": "core-1"}),
                                        ("log_turn", {"condition": "none", "action": "ask", "reason": "opening"})))])
    spoken = asyncio.run(collect(turn))
    assert spoken == ["Let's start with a problem.", "It's on your screen now."]
    assert ws.of("panel.show_problem")[0]["label"] == "Problem 1"
    assert turn.last.decision == {"condition": "none", "action": "ask", "reason": "opening"}
    assert [c["name"] for c in turn.last.tool_calls] == ["show_problem"]


def test_blocked_sentences_are_dropped_and_a_neutral_line_fills_an_empty_turn():
    turn, *_ = make([say("This is the Pair Sum problem.")])
    assert asyncio.run(collect(turn)) == [NEUTRAL_LINE]
    assert turn.last.blocked[0]["rule"] == "name_or_topic"


def test_silent_turns_say_nothing():
    turn, *_ = make([say("<silent>")])
    assert asyncio.run(collect(turn)) == []


def test_hints_land_on_screen_and_code_comments_carry_the_expected_line():
    turn, run, ws, _ = make([say("Here's a nudge.", tools=(("give_hint", {"step": 1}),
                                                            ("code_comment", {"line": 2, "text": "Why a dict?", "purpose": "question"})))])
    ws.lines = ["def f(nums):", "    seen = {}"]
    asyncio.run(collect(turn))
    hint = ws.of("panel.add_section")[0]
    assert hint["section"]["kind"] == "hint" and hint["section"]["body"] == "What do you need to remember as you scan?"
    assert ws.of("code.comment")[0]["at"] == {"line": 2, "expect": "    seen = {}"}
    assert run.conductor.current().hint_step == 1


def test_look_at_board_adds_a_follow_up_with_the_image():
    turn, run, ws, chat = make([say("Let me take a look.", tools=(("look_at_board", {}),)), say("Nice diagram.")])
    ws.png = b"\x89PNG"
    assert asyncio.run(collect(turn)) == ["Let me take a look.", "Nice diagram."]
    image_part = chat.calls[1][-1]["content"][1]
    assert image_part["image_url"]["url"].startswith("data:image/png;base64,")


def test_retries_silently_then_stalls_then_fails():
    turn, *_ = make([LLMUnavailable("down"), "hang", say("Back with you.")])
    assert asyncio.run(collect(turn)) == [STALL_LINE, "Back with you."]
    turn, *_ = make([LLMUnavailable("down"), LLMUnavailable("down"), LLMUnavailable("down")])
    with pytest.raises(TalkerFailed):
        asyncio.run(collect(turn))


def test_an_interrupted_turn_runs_no_tools():
    turn, run, ws, _ = make([say("First sentence.", "Second sentence.", tools=(("show_problem", {"item_id": "core-1"}),))])

    async def interrupt():
        gen = turn.run([{"role": "user", "content": "hi"}], turn_id="7", current_slot="core-1", candidate_said="")
        first = await gen.__anext__()
        await gen.aclose()
        return first

    assert asyncio.run(interrupt()) == "First sentence."
    assert ws.sent == [] and turn.last.interrupted
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_talker.py -q`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `tools.py`**

```python
"""The talker's tools (spec §5.1) and their execution against the conductor and the workspace."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.interviewer.llm import ToolCall
from app.interviewer.plan import problem_payload, reveal_text, slot_by_id
from app.interviewer.protocol import new_id

if TYPE_CHECKING:
    from app.interviewer.run import InterviewRun


def _tool(name: str, description: str, properties: dict[str, Any], required: tuple[str, ...] = ()) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": properties, "required": list(required)}}}


_STR = {"type": "string"}
_INT = {"type": "integer"}
_ELEMENT = {"type": "object", "properties": {
    "type": {"type": "string", "enum": ["rectangle", "ellipse", "diamond", "text", "arrow"]}, "id": _STR, "label": _STR,
    "x": {"type": "number"}, "y": {"type": "number"}, "from": _STR, "to": _STR}, "required": ["type", "id"]}

TOOLS: list[dict[str, Any]] = [
    _tool("show_problem", "Put the current problem (statement and two examples) on the candidate's screen.", {"item_id": _STR}),
    _tool("reveal", "Add the problem's exact constraints or input/output format to the screen. Only when asked.",
          {"kind": {"type": "string", "enum": ["constraints", "format"]}}, ("kind",)),
    _tool("add_section", "Add a clarification, explanation or note you gave to the problem panel.",
          {"kind": {"type": "string", "enum": ["clarification", "explanation", "note"]}, "title": _STR, "body": _STR}, ("kind", "body")),
    _tool("highlight_statement", "Highlight a passage of the problem statement, quoting its exact words.",
          {"quote": _STR, "note": _STR}, ("quote",)),
    _tool("code_comment", "Leave a comment in the candidate's code, at the top or above a line.",
          {"line": _INT, "text": _STR, "purpose": {"type": "string", "enum": ["question", "doubt", "hint"]}}, ("text",)),
    _tool("code_insert", "Insert a short stub or test input (at most 10 lines). Never solution code.",
          {"line": _INT, "text": _STR, "purpose": {"type": "string", "enum": ["stub", "test_input"]}}, ("text", "purpose")),
    _tool("code_highlight", "Mark lines of the candidate's code, optionally with a note.",
          {"start_line": _INT, "end_line": _INT, "note": _STR}, ("start_line",)),
    _tool("draw", "Draw simple boxes, ellipses, text and arrows on the whiteboard.",
          {"elements": {"type": "array", "items": _ELEMENT}}, ("elements",)),
    _tool("look_at_board", "Look at the whiteboard when the candidate refers to it.", {}),
    _tool("give_hint", "Give the next hint from the ladder; it also appears on screen.", {"step": _INT}, ("step",)),
    _tool("next_item", "The current item is finished; move to the next one.", {"reason": _STR}),
    _tool("flag_conduct", "Report unacceptable conduct, or an off-topic redirect.",
          {"kind": {"type": "string", "enum": ["inappropriate", "abusive", "refuses_to_engage", "manipulation", "off_topic_redirect"]},
           "quote": _STR}, ("kind",)),
    _tool("log_turn", "Record this turn's decision. Call it on every turn.",
          {"condition": _STR, "action": _STR, "reason": _STR}, ("condition", "action", "reason")),
]
TOOL_NAMES = frozenset(t["function"]["name"] for t in TOOLS)


class ToolExecutor:
    def __init__(self, run: InterviewRun) -> None:
        self.run = run

    async def execute(self, call: ToolCall, turn_id: str) -> dict[str, Any]:
        if call.name not in TOOL_NAMES or call.name == "log_turn":
            return {"ok": False, "error": f"unknown tool {call.name!r}"}
        handler = getattr(self, f"_{call.name}")
        try:
            return await handler(call.arguments or {}, turn_id)
        except (KeyError, TypeError, ValueError) as exc:  # pydantic's ValidationError is a ValueError
            return {"ok": False, "error": f"bad arguments: {exc}"}

    # ------------------------------------------------------------ helpers

    @property
    def _conductor(self):
        return self.run.conductor

    def _slot(self) -> dict[str, Any] | None:
        return slot_by_id(self.run.d.blueprint, self._conductor.current().slot_id)

    async def _send(self, body: dict[str, Any]) -> str:
        return await self.run.d.workspace.send(body)

    def _anchor(self, line: Any) -> Any:
        if line in (None, 0, "top"):
            return "top"
        lines, n = self.run.d.workspace.code_lines(), int(line)
        return {"line": n, "expect": lines[n - 1] if 0 < n <= len(lines) else ""}

    def _section(self, slot: dict[str, Any], section_id: str, kind: str, title: str, body: str) -> dict[str, Any]:
        return {"type": "panel.add_section", "item_id": slot["slot_id"],
                "section": {"id": section_id, "kind": kind, "title": title[:120], "body": body[:4000], "author": "interviewer"}}

    # ------------------------------------------------------------ tools

    async def _show_problem(self, args: dict[str, Any], turn_id: str) -> dict[str, Any]:
        item = self._conductor.current()
        item_id = args.get("item_id") or item.slot_id
        if item.slot_id is None or item_id != item.slot_id:
            return {"ok": False, "error": "show_problem only shows the current problem"}
        label = self._conductor.label_for(item_id)
        return {"ok": True, "label": label, "message_id": await self._send(problem_payload(self._slot(), label))}

    async def _reveal(self, args, turn_id):
        slot, kind = self._slot(), args.get("kind")
        text = reveal_text(slot, kind) if slot and kind in ("constraints", "format") else None
        if not text:
            return {"ok": False, "error": "nothing to reveal for this item"}
        title = "Constraints" if kind == "constraints" else "Input and output"
        return {"ok": True, "message_id": await self._send(self._section(slot, f"{kind}-{slot['slot_id']}", kind, title, text))}

    async def _add_section(self, args, turn_id):
        slot, kind = self._slot(), args.get("kind")
        body = str(args.get("body") or "").strip()
        if not slot or kind not in ("clarification", "explanation", "note") or not body:
            return {"ok": False, "error": "needs a problem on screen, a kind and a body"}
        title = str(args.get("title") or kind.title())
        return {"ok": True, "message_id": await self._send(self._section(slot, new_id("sec"), kind, title, body))}

    async def _highlight_statement(self, args, turn_id):
        slot, quote = self._slot(), str(args.get("quote") or "").strip()[:500]
        if not slot or not quote:
            return {"ok": False, "error": "needs a problem on screen and a quote"}
        body: dict[str, Any] = {"type": "panel.highlight", "item_id": slot["slot_id"], "highlight_id": new_id("hl"), "quote": quote}
        if args.get("note"):
            body["note"] = str(args["note"])[:300]
        return {"ok": True, "message_id": await self._send(body)}

    async def _code_comment(self, args, turn_id):
        text = str(args.get("text") or "").strip()[:1000]
        verdict = self.run.guard.check_code(text)
        if not text or not verdict.ok:
            return {"ok": False, "error": f"blocked ({verdict.rule or 'empty'})"}
        purpose = args.get("purpose") if args.get("purpose") in ("question", "doubt", "hint") else "question"
        return {"ok": True, "message_id": await self._send({"type": "code.comment", "at": self._anchor(args.get("line")),
                                                            "text": text, "purpose": purpose})}

    async def _code_insert(self, args, turn_id):
        text = str(args.get("text") or "").rstrip()[:2000]
        verdict = self.run.guard.check_code(text)
        if not text or not verdict.ok or args.get("purpose") not in ("stub", "test_input"):
            return {"ok": False, "error": f"blocked ({verdict.rule or 'needs text and a purpose'})"}
        return {"ok": True, "message_id": await self._send({"type": "code.insert", "at": self._anchor(args.get("line")),
                                                            "text": text, "purpose": args["purpose"]})}

    async def _code_highlight(self, args, turn_id):
        start = int(args["start_line"])
        end = max(start, int(args.get("end_line") or start))
        lines = self.run.d.workspace.code_lines()
        body: dict[str, Any] = {"type": "code.highlight", "highlight_id": new_id("ch"), "start_line": start, "end_line": end,
                                "expect": lines[start - 1] if 0 < start <= len(lines) else ""}
        if args.get("note"):
            body["note"] = str(args["note"])[:300]
        return {"ok": True, "message_id": await self._send(body)}

    async def _draw(self, args, turn_id):
        return {"ok": True, "message_id": await self._send({"type": "board.draw", "elements": list(args.get("elements") or [])})}

    async def _look_at_board(self, args, turn_id):
        png = await self.run.d.workspace.request_snapshot()
        return {"ok": True, "image": png} if png else {"ok": False, "error": "the board is empty or didn't answer"}

    async def _give_hint(self, args, turn_id):
        slot = self._slot()
        ladder = {int(h["step"]): h["hint"] for h in (slot or {}).get("hint_ladder", [])}
        step = int(args.get("step") or self._conductor.current().hint_step + 1)
        if step not in ladder:
            return {"ok": False, "error": f"no hint step {step}"}
        self._conductor.record_hint(step)
        await self._send(self._section(slot, f"hint-{slot['slot_id']}-{step}", "hint", f"Hint {step}", ladder[step]))
        return {"ok": True, "step": step}

    async def _next_item(self, args, turn_id):
        nxt = self._conductor.next_item(str(args.get("reason") or "done")[:200])
        return {"ok": True, "now": nxt.item_id if nxt else None}

    async def _flag_conduct(self, args, turn_id):
        kind = str(args.get("kind") or "")
        if kind == "off_topic_redirect":
            order = self._conductor.on_redirect(turn_id)
        else:
            order = self._conductor.on_conduct(kind or "inappropriate", str(args.get("quote") or ""), turn_id, "talker")
        return {"ok": True, "order": order.kind if order else None}
```

- [ ] **Step 5: Write `talker.py`**

```python
"""One talker turn (spec §5.1), independent of LiveKit: stream the reply from OpenRouter, pass each
sentence through the leak guard before it is spoken, then run the turn's tool calls. A `look_at_board`
call adds a second generation that sees the whiteboard. Tools run only if the reply wasn't cut off."""
from __future__ import annotations

import asyncio
import base64
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

from app.interviewer.guard import NEUTRAL_LINE, LeakGuard
from app.interviewer.llm import LLMUnavailable, StreamEvent, ToolCall
from app.interviewer.tools import TOOLS, ToolExecutor

SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
STALL_LINE = "Give me a second."
SILENT = "<silent>"


class TalkerFailed(Exception):
    """Three attempts at a reply failed."""


@dataclass
class TurnResult:
    spoken: list[str] = field(default_factory=list)
    blocked: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    decision: dict[str, Any] | None = None
    first_token_ms: int | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider: str | None = None
    interrupted: bool = False
    error: str | None = None


class TalkerTurn:
    def __init__(self, chat, guard: LeakGuard, tools: ToolExecutor, first_token_timeout_s: float,
                 clock: Callable[[], float] = time.perf_counter) -> None:
        self.chat = chat
        self.guard = guard
        self.tools = tools
        self.timeout = first_token_timeout_s
        self.clock = clock
        self.last = TurnResult()

    async def run(self, messages: list[dict[str, Any]], *, turn_id: str, current_slot: str | None,
                  candidate_said: str) -> AsyncIterator[str]:
        result = TurnResult()
        self.last = result
        started = self.clock()
        calls: list[ToolCall] = []
        try:
            async for sentence in self._generate(messages, result, started, calls, current_slot, candidate_said, with_tools=True):
                yield sentence
            image: bytes | None = None
            for call in calls:
                if call.name == "log_turn":
                    result.decision = {k: call.arguments.get(k) for k in ("condition", "action", "reason")}
                    continue
                outcome = await self.tools.execute(call, turn_id)
                result.tool_calls.append({"name": call.name, "arguments": call.arguments,
                                          "result": {k: v for k, v in outcome.items() if k != "image"}})
                if call.name == "look_at_board" and outcome.get("image"):
                    image = outcome["image"]
            if image is not None:
                follow = [*messages,
                          {"role": "assistant", "content": " ".join(result.spoken) or "Let me take a look."},
                          {"role": "user", "content": [
                              {"type": "text", "text": "(The whiteboard as it looks now. React in one or two spoken sentences.)"},
                              {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode()}}]}]
                async for sentence in self._generate(follow, result, started, [], current_slot, candidate_said, with_tools=False):
                    yield sentence
            if not result.spoken and result.blocked:
                result.spoken.append(NEUTRAL_LINE)
                yield NEUTRAL_LINE
        except (asyncio.CancelledError, GeneratorExit):
            result.interrupted = True
            raise

    async def _open(self, messages, with_tools: bool) -> tuple[Any, StreamEvent]:
        stream = self.chat.stream(messages, tools=TOOLS if with_tools else None)
        try:
            first = await asyncio.wait_for(stream.__anext__(), timeout=self.timeout)
        except BaseException:
            await stream.aclose()
            raise
        return stream, first

    async def _generate(self, messages, result: TurnResult, started: float, calls: list[ToolCall],
                        current_slot: str | None, candidate_said: str, *, with_tools: bool) -> AsyncIterator[str]:
        stream = first = None
        for attempt in (1, 2, 3):
            try:
                stream, first = await self._open(messages, with_tools)
                break
            except (TimeoutError, LLMUnavailable, StopAsyncIteration) as exc:
                if attempt == 2:
                    result.spoken.append(STALL_LINE)
                    yield STALL_LINE
                if attempt == 3:
                    result.error = f"{type(exc).__name__}: {exc}"
                    raise TalkerFailed(result.error) from exc

        async def events():
            yield first
            async for event in stream:
                yield event

        buffer = ""
        try:
            async for event in events():
                if event.kind == "text":
                    if result.first_token_ms is None:
                        result.first_token_ms = int((self.clock() - started) * 1000)
                    buffer += event.text
                    *done, buffer = SENTENCE_END.split(buffer)
                    for sentence in done:
                        if (out := self._check(sentence, result, current_slot, candidate_said)) is not None:
                            yield out
                elif event.kind == "tool_call" and event.tool_call is not None:
                    calls.append(event.tool_call)
                elif event.kind == "done":
                    result.usage, result.provider = event.usage, event.provider
        except LLMUnavailable as exc:
            result.error = str(exc)  # a broken stream mid-reply: keep what was already spoken
        if (out := self._check(buffer, result, current_slot, candidate_said)) is not None:
            yield out

    def _check(self, sentence: str, result: TurnResult, current_slot: str | None, candidate_said: str) -> str | None:
        text = sentence.strip()
        if not text or text == SILENT:
            return None
        verdict = self.guard.check_sentence(text, current_slot=current_slot, candidate_said=candidate_said)
        if not verdict.ok:
            result.blocked.append({"sentence": text, "rule": verdict.rule, "match": verdict.match})
            return None
        result.spoken.append(text)
        return text
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_talker.py -q`
Expected: PASS (7 tests).

---

### Task 8: The director

**Files:**
- Create: `apps/ai-service/app/interviewer/director.py`
- Create: `apps/ai-service/tests/interviewer/test_director.py`

**Interfaces:**
- Consumes: `Brief`, `BRIEF_SCHEMA` (Task 6), `LLMUnavailable` (Task 1).
- Produces: `Director(chat, build_messages: async () -> list[dict], on_brief: async (Brief, meta: dict) -> None, on_failure: async (str) -> None | None)` with `trigger(reasons: set[str])`, `idle()` (await the current run), `aclose()`, counters `runs`, `failures`.

- [ ] **Step 1: Write the failing test**

```python
import asyncio

from app.interviewer.director import Director
from app.interviewer.llm import LLMUnavailable
from tests.interviewer.fakes import FakeChat


def test_merges_triggers_into_single_flight_runs_and_survives_failures():
    briefs, failures, built = [], [], []

    async def build():
        built.append(1)
        await asyncio.sleep(0)
        return [{"role": "user", "content": "x"}]

    async def on_brief(brief, meta):
        briefs.append((brief.for_position, meta["triggers"]))

    async def on_failure(error):
        failures.append(error)

    async def run():
        chat = FakeChat(briefs=[{"for_position": 3, "goal": "probe"}, LLMUnavailable("down"), {"goal": "missing position"}])
        d = Director(chat, build, on_brief, on_failure)
        d.trigger({"turns"})
        d.trigger({"time"})        # arrives while the first run is in flight: merged into the next run
        await d.idle()
        d.trigger({"item"})
        await d.idle()
        d.trigger({"proctor"})
        await d.idle()
        return d

    d = asyncio.run(run())
    assert briefs == [(3, ["turns"])]
    assert len(failures) == 3 and d.runs == 1
    assert len(built) == 4
```

(The first run sees `{"turns"}`; `{"time"}` lands while it runs and is merged into a second run, which fails with `LLMUnavailable`; `{"item"}` gets the invalid brief, which fails validation; `{"proctor"}` finds no scripted brief.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_director.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `director.py`**

```python
"""The director (spec §5.2): a background LLM that reads the whole interview every few turns and writes
a structured brief. Single flight: triggers that arrive while a run is in progress merge into the
next run. It never speaks; failures are logged and the talker keeps the last brief."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

from pydantic import ValidationError

from app.interviewer.brief import BRIEF_SCHEMA, Brief

logger = logging.getLogger(__name__)


class Director:
    def __init__(self, chat, build_messages: Callable[[], Awaitable[list[dict[str, Any]]]],
                 on_brief: Callable[[Brief, dict[str, Any]], Awaitable[None]],
                 on_failure: Callable[[str], Awaitable[None]] | None = None) -> None:
        self.chat = chat
        self.build_messages = build_messages
        self.on_brief = on_brief
        self.on_failure = on_failure
        self._pending: set[str] = set()
        self._task: asyncio.Task | None = None
        self.runs = 0
        self.failures = 0

    def trigger(self, reasons: set[str]) -> None:
        if not reasons:
            return
        self._pending |= set(reasons)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        while self._pending:
            reasons, self._pending = self._pending, set()
            started = time.perf_counter()
            try:
                messages = await self.build_messages()
                data, usage = await self.chat.json(messages, "brief", BRIEF_SCHEMA)
                brief = Brief.model_validate(data)
            except (ValidationError, Exception) as exc:  # noqa: BLE001 - never let a brief failure end the round
                self.failures += 1
                logger.warning("director run failed: %s", exc)
                if self.on_failure is not None:
                    await self.on_failure(f"{type(exc).__name__}: {exc}")
                continue
            self.runs += 1
            await self.on_brief(brief, {"triggers": sorted(reasons), "usage": usage,
                                        "latency_ms": int((time.perf_counter() - started) * 1000)})

    async def idle(self) -> None:
        while self._task is not None and not self._task.done():
            await self._task

    async def aclose(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_director.py -q`
Expected: PASS.

---

### Task 9: Storage, purge and the replay CLI

**Files:**
- Create: `apps/ai-service/app/interviewer/store.py`
- Create: `apps/ai-service/app/interviewer/trace.py`
- Modify: `apps/ai-service/app/db/mongo.py` (`ensure_indexes`)
- Modify: `apps/ai-service/app/api/routes.py` (`purge_user`)
- Create: `apps/ai-service/tests/interviewer/test_store.py`

**Interfaces:**
- Produces: collection names `LIVE_RUNS`, `LIVE_TURNS`, `LIVE_BRIEFS`, `LIVE_EVIDENCE`; `ensure_live_indexes(db)`; `MongoStore` and `MemoryStore`, both with `load_run(session_id)`, `start_run(doc)`, `save_checkpoint(session_id, data)`, `append_turn(doc)`, `update_turn(session_id, seq, patch)`, `append_brief(doc)`, `upsert_evidence(session_id, candidate_id, notes)`, `finalize_run(session_id, patch)`; module function `purge(candidate_id, session_ids) -> dict`; `trace.timeline(session_id, store=None) -> list[str]` and `python -m app.interviewer.trace <session_id>`.

- [ ] **Step 1: Write the failing test**

```python
import asyncio

from app.interviewer import store
from app.interviewer.store import MemoryStore
from app.interviewer.trace import render


class _Coll:
    def __init__(self, n):
        self.n, self.queries = n, []

    async def delete_many(self, q):
        self.queries.append(q)
        return type("R", (), {"deleted_count": self.n})()


def test_purge_removes_every_live_collection_by_candidate_and_sessions(monkeypatch):
    colls = {name: _Coll(2) for name in (store.LIVE_RUNS, store.LIVE_TURNS, store.LIVE_BRIEFS, store.LIVE_EVIDENCE)}
    monkeypatch.setattr(store, "get_db", lambda: colls)
    out = asyncio.run(store.purge("c1", ["s1"]))
    assert out == {"deleted_live_runs": 2, "deleted_live_turns": 2, "deleted_live_briefs": 2, "deleted_live_evidence": 2}
    assert colls[store.LIVE_TURNS].queries == [{"$or": [{"candidate_id": "c1"}, {"session_id": {"$in": ["s1"]}}]}]
    assert asyncio.run(store.purge(None, [])) == {"deleted_live_runs": 0, "deleted_live_turns": 0,
                                                  "deleted_live_briefs": 0, "deleted_live_evidence": 0}


def test_memory_store_and_the_timeline():
    async def run():
        s = MemoryStore()
        await s.start_run({"session_id": "s1", "candidate_id": "c1", "started_at": "t0"})
        await s.append_turn({"session_id": "s1", "seq": 1, "speaker": "interviewer", "text": "Hi there.", "at": 0.0,
                             "decision": {"condition": "none", "action": "greet", "reason": "opening"}, "orders": [],
                             "blocked": [], "tool_calls": [], "first_token_ms": 640})
        await s.update_turn("s1", 1, {"first_audio_ms": 900})
        await s.append_turn({"session_id": "s1", "seq": 2, "speaker": "candidate", "text": "Hello!", "at": 3.0})
        await s.append_brief({"session_id": "s1", "brief": {"for_position": 1, "goal": "build rapport"}, "outcome": {"stale": False}, "at": 4.0})
        await s.finalize_run("s1", {"end_reason": "completed"})
        return render(await s.load_run("s1"), s.turns, s.briefs)

    lines = asyncio.run(run())
    assert lines[0].startswith("run s1")
    assert any("INTERVIEWER: Hi there." in l and "none → greet" in l and "640ms" in l and "900ms" in l for l in lines)
    assert any("CANDIDATE: Hello!" in l for l in lines)
    assert any("BRIEF (position 1): build rapport" in l for l in lines)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_store.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `store.py`**

```python
"""Storage for live interviews (spec §9): one run per session (final plan, ledgers, checkpoint), one
doc per turn (the decision trace), one per director brief, and evidence notes per item and signal.
No scores. Account deletion purges all four (POST /users/purge)."""
from __future__ import annotations

from typing import Any

from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from app.db.mongo import get_db

LIVE_RUNS = "live_runs"
LIVE_TURNS = "live_turns"
LIVE_BRIEFS = "live_briefs"
LIVE_EVIDENCE = "live_evidence"


async def ensure_live_indexes(db) -> None:
    await db[LIVE_RUNS].create_index([("session_id", ASCENDING)], name="session_id", unique=True)
    await db[LIVE_TURNS].create_index([("session_id", ASCENDING), ("seq", ASCENDING)], name="session_seq", unique=True)
    await db[LIVE_BRIEFS].create_index([("session_id", ASCENDING), ("at", ASCENDING)], name="session_at")
    await db[LIVE_EVIDENCE].create_index([("session_id", ASCENDING), ("item_id", ASCENDING), ("signal", ASCENDING)],
                                         name="session_item_signal", unique=True)
    for name in (LIVE_RUNS, LIVE_TURNS, LIVE_BRIEFS, LIVE_EVIDENCE):
        await db[name].create_index([("candidate_id", ASCENDING)], name="candidate_id")


class MongoStore:
    async def load_run(self, session_id: str) -> dict[str, Any] | None:
        return await get_db()[LIVE_RUNS].find_one({"session_id": session_id}, {"_id": 0})

    async def start_run(self, doc: dict[str, Any]) -> None:
        try:
            await get_db()[LIVE_RUNS].insert_one(dict(doc))
        except DuplicateKeyError:
            pass

    async def save_checkpoint(self, session_id: str, data: dict[str, Any]) -> None:
        await get_db()[LIVE_RUNS].update_one({"session_id": session_id}, {"$set": data})

    async def append_turn(self, doc: dict[str, Any]) -> None:
        await get_db()[LIVE_TURNS].insert_one(dict(doc))

    async def update_turn(self, session_id: str, seq: int, patch: dict[str, Any]) -> None:
        await get_db()[LIVE_TURNS].update_one({"session_id": session_id, "seq": seq}, {"$set": patch})

    async def append_brief(self, doc: dict[str, Any]) -> None:
        await get_db()[LIVE_BRIEFS].insert_one(dict(doc))

    async def upsert_evidence(self, session_id: str, candidate_id: str, notes: list[dict[str, Any]]) -> None:
        for note in notes:
            await get_db()[LIVE_EVIDENCE].update_one(
                {"session_id": session_id, "item_id": note["item_id"], "signal": note["signal"]},
                {"$set": {"candidate_id": candidate_id},
                 "$push": {"observations": {"text": note["observation"], "turn_ids": note.get("turn_ids", [])}}},
                upsert=True)

    async def finalize_run(self, session_id: str, patch: dict[str, Any]) -> None:
        await get_db()[LIVE_RUNS].update_one({"session_id": session_id}, {"$set": patch})

    async def turns(self, session_id: str) -> list[dict[str, Any]]:
        return [d async for d in get_db()[LIVE_TURNS].find({"session_id": session_id}, {"_id": 0}).sort("seq", ASCENDING)]

    async def briefs(self, session_id: str) -> list[dict[str, Any]]:
        return [d async for d in get_db()[LIVE_BRIEFS].find({"session_id": session_id}, {"_id": 0}).sort("at", ASCENDING)]


class MemoryStore:
    """The same interface in memory, for tests and the simulator."""

    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.turns: list[dict[str, Any]] = []
        self.briefs: list[dict[str, Any]] = []
        self.evidence: list[dict[str, Any]] = []

    async def load_run(self, session_id):
        return self.runs.get(session_id)

    async def start_run(self, doc):
        self.runs.setdefault(doc["session_id"], dict(doc))

    async def save_checkpoint(self, session_id, data):
        self.runs.setdefault(session_id, {"session_id": session_id}).update(data)

    async def append_turn(self, doc):
        self.turns.append(dict(doc))

    async def update_turn(self, session_id, seq, patch):
        for turn in self.turns:
            if turn["session_id"] == session_id and turn["seq"] == seq:
                turn.update(patch)

    async def append_brief(self, doc):
        self.briefs.append(dict(doc))

    async def upsert_evidence(self, session_id, candidate_id, notes):
        self.evidence += [{**n, "session_id": session_id, "candidate_id": candidate_id} for n in notes]

    async def finalize_run(self, session_id, patch):
        self.runs.setdefault(session_id, {"session_id": session_id}).update(patch)


async def purge(candidate_id: str | None, session_ids: list[str]) -> dict[str, int]:
    names = {"deleted_live_runs": LIVE_RUNS, "deleted_live_turns": LIVE_TURNS,
             "deleted_live_briefs": LIVE_BRIEFS, "deleted_live_evidence": LIVE_EVIDENCE}
    clauses: list[dict[str, Any]] = []
    if candidate_id:
        clauses.append({"candidate_id": candidate_id})
    if session_ids:
        clauses.append({"session_id": {"$in": session_ids}})
    if not clauses:
        return {key: 0 for key in names}
    db = get_db()
    out = {}
    for key, name in names.items():
        out[key] = (await db[name].delete_many({"$or": clauses})).deleted_count
    return out
```

Every turn, brief and evidence doc the run writes carries `candidate_id` (Task 12 adds it), so the purge by candidate covers them.

- [ ] **Step 4: Write `trace.py`**

```python
"""Replay a live interview's decisions (spec §9.3):
    .venv/bin/python -m app.interviewer.trace <session_id>
Prints every turn with its decision, orders, guard blocks, tool calls and timings, and every brief."""
from __future__ import annotations

import argparse
import asyncio
from typing import Any

from app.config import get_settings
from app.db import mongo
from app.interviewer.store import MongoStore


def render(run: dict[str, Any] | None, turns: list[dict[str, Any]], briefs: list[dict[str, Any]]) -> list[str]:
    if run is None:
        return ["no live run for this session"]
    lines = [f"run {run['session_id']} started {run.get('started_at')} ended {run.get('ended_at', '-')} "
             f"reason {run.get('end_reason', '-')}"]
    events = [(t.get("at", 0.0), "turn", t) for t in turns] + [(b.get("at", 0.0), "brief", b) for b in briefs]
    for _, kind, doc in sorted(events, key=lambda e: (e[0], e[1] != "turn")):
        if kind == "brief":
            brief, outcome = doc.get("brief", {}), doc.get("outcome", {})
            lines.append(f"  BRIEF (position {brief.get('for_position')}): {brief.get('goal', '')}"
                         + (" [stale]" if outcome.get("stale") else "")
                         + (f" applied={len(outcome.get('applied', []))} dropped={len(outcome.get('dropped', []))}" if outcome else ""))
            continue
        if doc.get("speaker") == "candidate":
            lines.append(f"#{doc['seq']} CANDIDATE: {doc.get('text', '')}")
            continue
        if doc.get("speaker") == "event":
            lines.append(f"#{doc['seq']} EVENT: {doc.get('text', '')}")
            continue
        decision = doc.get("decision") or {}
        timing = ", ".join(x for x in (f"first token {doc['first_token_ms']}ms" if doc.get("first_token_ms") is not None else "",
                                        f"first audio {doc['first_audio_ms']}ms" if doc.get("first_audio_ms") is not None else "") if x)
        lines.append(f"#{doc['seq']} INTERVIEWER: {doc.get('text', '')}"
                     + (f"  [{decision.get('condition')} → {decision.get('action')}: {decision.get('reason')}]" if decision else "")
                     + (f"  ({timing})" if timing else "") + ("  (interrupted)" if doc.get("interrupted") else ""))
        lines += [f"    order [{o['kind']}] {o['text']}" for o in doc.get("orders", [])]
        lines += [f"    blocked ({b['rule']}): {b['sentence']}" for b in doc.get("blocked", [])]
        lines += [f"    tool {c['name']} {c.get('arguments')} → {c.get('result')}" for c in doc.get("tool_calls", [])]
        if doc.get("error"):
            lines.append(f"    error: {doc['error']}")
    return lines


async def timeline(session_id: str, store: MongoStore | None = None) -> list[str]:
    s = store or MongoStore()
    return render(await s.load_run(session_id), await s.turns(session_id), await s.briefs(session_id))


async def _main(session_id: str) -> None:
    await mongo.connect(get_settings())
    try:
        print("\n".join(await timeline(session_id)))
    finally:
        await mongo.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("session_id")
    asyncio.run(_main(parser.parse_args().session_id))
```

- [ ] **Step 5: Wire the indexes and the purge**

In `app/db/mongo.py`, at the end of `ensure_indexes`, after the blueprint indexes, add:

```python
    # Live interviews: runs, turns, briefs and evidence (app/interviewer).
    from app.interviewer.store import ensure_live_indexes
    await ensure_live_indexes(db)
```

In `app/api/routes.py`, replace the body of `purge_user`:

```python
    from app.blueprint import store

    return await store.purge(req.candidate_id, req.session_ids)
```

with:

```python
    from app.blueprint import store
    from app.interviewer import store as live_store

    out = await store.purge(req.candidate_id, req.session_ids)
    out.update(await live_store.purge(req.candidate_id, req.session_ids))
    return out
```

and update its docstring to say it also removes live interview runs, turns, briefs and evidence. Update the route list in the module docstring the same way (`POST /users/purge — … drop the user's blueprints, runs and live interviews`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_store.py tests/blueprint/test_pipeline_and_routes.py -q`
Expected: PASS (the existing purge test still passes; it patches `store.get_db` for the blueprint store only, and `live_store.purge` runs against a real `get_db()` only when the route is called).

If `tests/blueprint/test_pipeline_and_routes.py` calls the purge **route** (not `store.purge`), also monkeypatch `app.interviewer.store.purge` there to return the four zero counts.

---

### Task 10: The API client (context and end)

**Files:**
- Create: `apps/ai-service/app/interviewer/api_client.py`
- Create: `apps/ai-service/tests/interviewer/test_api_client.py`

**Interfaces:**
- Produces: `ApiError`, `ApiClient(base_url, internal_key, *, transport=None, retries=3, backoff_s=1.0)` with `context(session_id) -> dict` (GET `/api/v1/internal/live/sessions/{id}/context`) and `end(session_id, reason, live_summary) -> dict` (POST `/api/v1/internal/live/sessions/{id}/end` with `{"reason", "live_summary"}`), `aclose()`.
- The response shapes are fixed by plan 3 Task 4: context = `{"session_id", "candidate_id", "first_name", "status", "round": {"company", "company_name", "role", "level", "round_type", "duration_mins"}, "profile": {"headline", "skills", "projects"}}`; end = `{"status", "ended_reason", "already_ended"}`.

- [ ] **Step 1: Write the failing test**

```python
import asyncio

import httpx
import pytest

from app.interviewer.api_client import ApiClient, ApiError


def client(handler, **kw):
    return ApiClient("http://api.test", "secret", transport=httpx.MockTransport(handler), backoff_s=0, **kw)


def test_context_sends_the_internal_key():
    seen = {}

    def handler(request):
        seen["key"] = request.headers.get("x-internal-api-key")
        seen["path"] = request.url.path
        return httpx.Response(200, json={"session_id": "s1", "profile": {"skills": ["Java"]}})

    out = asyncio.run(client(handler).context("s1"))
    assert out["profile"]["skills"] == ["Java"]
    assert seen == {"key": "secret", "path": "/api/v1/internal/live/sessions/s1/context"}


def test_end_retries_server_errors_and_gives_up_on_client_errors():
    calls = []

    def flaky(request):
        calls.append(request)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={"status": "COMPLETED", "ended_reason": "completed", "already_ended": False})

    assert asyncio.run(client(flaky).end("s1", "completed", {"tab_changes": 0}))["status"] == "COMPLETED"
    assert len(calls) == 3

    def conflict(request):
        return httpx.Response(409, json={"code": "session_not_live"})

    with pytest.raises(ApiError):
        asyncio.run(client(conflict).end("s1", "completed", {}))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_api_client.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `api_client.py`**

```python
"""The worker's calls into the API (spec §8.2), guarded by the shared X-Internal-Api-Key: the round's
context at the start, and the end of the session (retried; the API's sweep is the backstop)."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx


class ApiError(Exception):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"API {status}: {body[:200]}")
        self.status = status


class ApiClient:
    def __init__(self, base_url: str, internal_key: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 retries: int = 3, backoff_s: float = 1.0) -> None:
        self._http = httpx.AsyncClient(base_url=base_url.rstrip("/"), headers={"X-Internal-Api-Key": internal_key},
                                       timeout=15.0, transport=transport)
        self.retries = retries
        self.backoff_s = backoff_s

    async def _call(self, method: str, path: str, body: dict[str, Any] | None = None, retry: bool = False) -> dict[str, Any]:
        attempts = self.retries if retry else 1
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                response = await self._http.request(method, path, json=body)
            except httpx.TransportError as exc:
                last = exc
            else:
                if response.status_code < 300:
                    return response.json()
                last = ApiError(response.status_code, response.text)
                if response.status_code < 500:
                    raise last
            if attempt < attempts - 1:
                await asyncio.sleep(self.backoff_s * (2 ** attempt))
        raise last if isinstance(last, ApiError) else ApiError(0, str(last))

    async def context(self, session_id: str) -> dict[str, Any]:
        return await self._call("GET", f"/api/v1/internal/live/sessions/{session_id}/context")

    async def end(self, session_id: str, reason: str, live_summary: dict[str, Any]) -> dict[str, Any]:
        return await self._call("POST", f"/api/v1/internal/live/sessions/{session_id}/end",
                                {"reason": reason, "live_summary": live_summary}, retry=True)

    async def aclose(self) -> None:
        await self._http.aclose()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_api_client.py -q`
Expected: PASS (2 tests).

---

### Task 11: The workspace bridge (LiveKit streams ↔ protocol)

**Files:**
- Create: `apps/ai-service/app/interviewer/workspace.py`
- Create: `apps/ai-service/tests/interviewer/test_workspace.py`

**Interfaces:**
- Consumes: `agent_message`, `parse_web`, `new_id`, topic constants (Task 2).
- Produces: `WorkspaceBridge(room, *, on_message: async (WebMessage) -> None, snapshot_timeout_s=6.0)` with `attach()`, `send(body) -> str` (queues until hello), `request_snapshot() -> bytes | None`, `code_lines() -> list[str]`, `mirror_state() -> dict`, `restore_mirror(data)`, attributes `ready`, `cards`, `active_item`, `code`, `board_summary`, `board_backup`, `acks`.
- The `room` needs `register_text_stream_handler(topic, handler)`, `register_byte_stream_handler(topic, handler)` and `local_participant.send_text(text, topic=...)` / `local_participant.stream_bytes(name, topic=..., attributes=..., mime_type=...)` (LiveKit Python SDK 1.1).

- [ ] **Step 1: Write the failing test**

```python
import asyncio
import json

from app.interviewer.workspace import WorkspaceBridge


class Reader:
    def __init__(self, text=None, chunks=(), attributes=None):
        self.text, self.chunks = text, list(chunks)
        self.info = type("Info", (), {"attributes": attributes or {}})()

    async def read_all(self):
        return self.text

    def __aiter__(self):
        async def gen():
            for c in self.chunks:
                yield c
        return gen()


class Writer:
    def __init__(self, sink):
        self.sink = sink

    async def write(self, data):
        self.sink.append(data)

    async def aclose(self):
        pass


class Participant:
    def __init__(self):
        self.texts, self.bytes = [], []

    async def send_text(self, text, topic=""):
        self.texts.append((topic, json.loads(text)))

    async def stream_bytes(self, name, topic="", attributes=None, mime_type="application/octet-stream"):
        self.bytes.append({"topic": topic, "attributes": attributes, "data": []})
        return Writer(self.bytes[-1]["data"])


class Room:
    def __init__(self):
        self.text, self.byte = {}, {}
        self.local_participant = Participant()

    def register_text_stream_handler(self, topic, handler):
        self.text[topic] = handler

    def register_byte_stream_handler(self, topic, handler):
        self.byte[topic] = handler


def web(body):
    return json.dumps({"v": 1, "id": "w1", **body})


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


def make():
    room, got = Room(), []

    async def on_message(m):
        got.append(m.type)

    bridge = WorkspaceBridge(room, on_message=on_message, snapshot_timeout_s=0.5)
    bridge.attach()
    return room, bridge, got


SHOW = {"type": "panel.show_problem", "item_id": "core-1", "label": "Problem 1", "kind": "problem",
        "statement": "Find the pair.", "examples": []}


def test_queues_until_hello_then_flushes_in_order():
    async def run():
        room, bridge, got = make()
        await bridge.send(SHOW)
        assert room.local_participant.texts == []
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        return room, got

    room, got = asyncio.run(run())
    assert [m["type"] for _, m in room.local_participant.texts] == ["panel.show_problem"]
    assert got == ["workspace.hello"]


def test_keeps_a_mirror_and_restores_it_on_a_fresh_hello():
    async def run():
        room, bridge, _ = make()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        await bridge.send(SHOW)
        await bridge.send({"type": "panel.add_section", "item_id": "core-1",
                           "section": {"id": "c", "kind": "constraints", "title": "Constraints", "body": "n <= 10", "author": "interviewer"}})
        room.text["workspace"](Reader(web({"type": "code.snapshot", "version": 2, "language": "java", "text": "class A {}"})), "cand")
        room.byte["workspace.board.backup"](Reader(chunks=[b"scene"], attributes={"encoding": "none"}), "cand")
        await settle()
        room.local_participant.texts.clear()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        return room, bridge

    room, bridge = asyncio.run(run())
    restore = room.local_participant.texts[0][1]
    assert restore["type"] == "workspace.restore" and restore["active_item_id"] == "core-1"
    assert restore["cards"][0]["sections"][0]["body"] == "n <= 10"
    assert restore["code"] == {"language": "java", "text": "class A {}"} and restore["board"] is True
    assert room.local_participant.bytes[0]["topic"] == "workspace.board.restore"
    assert bridge.code_lines() == ["class A {}"]


def test_snapshot_requests_resolve_with_the_png_or_time_out():
    async def run():
        room, bridge, _ = make()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        pending = asyncio.create_task(bridge.request_snapshot())
        await settle()
        request_id = room.local_participant.texts[-1][1]["request_id"]
        room.byte["workspace.board.snapshot"](Reader(chunks=[b"\x89P", b"NG"], attributes={"request_id": request_id}), "cand")
        png = await pending
        missing = await bridge.request_snapshot()
        return png, missing

    png, missing = asyncio.run(run())
    assert png == b"\x89PNG" and missing is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_workspace.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `workspace.py`**

```python
"""The agent's side of the shared workspace (spec §6) over LiveKit text and byte streams. Sends nothing
until the browser's first `workspace.hello` (queued meanwhile), keeps a mirror of what the candidate
sees (panel cards, the latest code, the board summary and backup) and restores it after a refresh."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

from app.interviewer.protocol import (BOARD_BACKUP_TOPIC, BOARD_RESTORE_TOPIC, BOARD_SNAPSHOT_TOPIC, WORKSPACE_TOPIC,
                                      agent_message, new_id, parse_web)

logger = logging.getLogger(__name__)


class WorkspaceBridge:
    def __init__(self, room, *, on_message: Callable[[Any], Awaitable[None]], snapshot_timeout_s: float = 6.0) -> None:
        self.room = room
        self.on_message = on_message
        self.snapshot_timeout_s = snapshot_timeout_s
        self.ready = False
        self._queue: list[dict[str, Any]] = []
        self.cards: dict[str, dict[str, Any]] = {}
        self.active_item: str | None = None
        self.code: dict[str, Any] | None = None
        self.board_summary = ""
        self.board_backup: tuple[bytes, dict[str, str]] | None = None
        self.acks: dict[str, dict[str, Any]] = {}
        self._snapshots: dict[str, asyncio.Future] = {}
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------ wiring

    def attach(self) -> None:
        self.room.register_text_stream_handler(WORKSPACE_TOPIC, self._on_text)
        self.room.register_byte_stream_handler(BOARD_SNAPSHOT_TOPIC, self._on_snapshot)
        self.room.register_byte_stream_handler(BOARD_BACKUP_TOPIC, self._on_backup)

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("workspace handler failed: %s", task.exception())

    def _on_text(self, reader, participant_identity: str) -> None:
        self._spawn(self._read_text(reader))

    def _on_snapshot(self, reader, participant_identity: str) -> None:
        self._spawn(self._read_snapshot(reader))

    def _on_backup(self, reader, participant_identity: str) -> None:
        self._spawn(self._read_backup(reader))

    # ------------------------------------------------------------ inbound

    async def _read_text(self, reader) -> None:
        message = parse_web(await reader.read_all())
        if message is not None:
            await self._handle(message)

    async def _handle(self, m) -> None:
        if m.type == "workspace.hello":
            self.ready = True
            queued, self._queue = self._queue, []
            for msg in queued:
                await self._send_text(msg)
            if not m.has_content and self.cards:
                await self._restore()
        elif m.type == "ack":
            self.acks[m.ref] = {"ok": m.ok, "reason": m.reason}
        elif m.type == "code.snapshot":
            self.code = {"language": m.language, "text": m.text, "version": m.version}
        elif m.type == "board.summary":
            self.board_summary = m.text
        elif m.type == "panel.section_added" and m.item_id in self.cards:
            self.cards[m.item_id]["sections"].append(m.section.model_dump(exclude_none=True))
        elif m.type == "panel.highlight_added" and m.item_id in self.cards:
            self.cards[m.item_id]["highlights"].append({"highlight_id": m.highlight_id, "quote": m.quote,
                                                       "occurrence": m.occurrence, "author": "candidate"})
        await self.on_message(m)

    async def _read_snapshot(self, reader) -> None:
        data = b"".join([chunk async for chunk in reader])
        future = self._snapshots.get((reader.info.attributes or {}).get("request_id", ""))
        if future is not None and not future.done():
            future.set_result(data)

    async def _read_backup(self, reader) -> None:
        self.board_backup = (b"".join([chunk async for chunk in reader]), dict(reader.info.attributes or {}))

    # ------------------------------------------------------------ outbound

    async def send(self, body: dict[str, Any]) -> str:
        message = agent_message(body)
        self._mirror(message)
        if self.ready:
            await self._send_text(message)
        else:
            self._queue.append(message)
        return message["id"]

    async def _send_text(self, message: dict[str, Any]) -> None:
        await self.room.local_participant.send_text(json.dumps(message), topic=WORKSPACE_TOPIC)

    def _mirror(self, m: dict[str, Any]) -> None:
        t = m["type"]
        if t == "panel.show_problem":
            card = self.cards.get(m["item_id"], {"sections": [], "highlights": []})
            self.cards[m["item_id"]] = {**card, **{k: m[k] for k in ("item_id", "label", "kind", "statement", "examples")}}
            self.active_item = m["item_id"]
        elif t == "panel.add_section" and m["item_id"] in self.cards:
            sections = [s for s in self.cards[m["item_id"]]["sections"] if s["id"] != m["section"]["id"]]
            self.cards[m["item_id"]]["sections"] = [*sections, m["section"]]
        elif t == "panel.highlight" and m["item_id"] in self.cards:
            self.cards[m["item_id"]]["highlights"].append({
                "highlight_id": m["highlight_id"], "quote": m["quote"], "occurrence": m.get("occurrence", 0),
                "author": "interviewer", **({"note": m["note"]} if m.get("note") else {})})
        elif t == "panel.clear_highlight":
            for card in self.cards.values():
                card["highlights"] = [h for h in card["highlights"] if h["highlight_id"] != m["highlight_id"]]

    async def _restore(self) -> None:
        code = {"language": self.code["language"], "text": self.code["text"]} if self.code else None
        await self._send_text(agent_message({"type": "workspace.restore", "cards": list(self.cards.values()),
                                             "active_item_id": self.active_item, "code": code,
                                             "board": self.board_backup is not None}))
        if self.board_backup is not None:
            data, attributes = self.board_backup
            writer = await self.room.local_participant.stream_bytes("board-restore", topic=BOARD_RESTORE_TOPIC, attributes=attributes)
            await writer.write(data)
            await writer.aclose()

    async def request_snapshot(self) -> bytes | None:
        request_id = new_id("snap")
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._snapshots[request_id] = future
        try:
            await self.send({"type": "board.request_snapshot", "request_id": request_id})
            return await asyncio.wait_for(future, timeout=self.snapshot_timeout_s)
        except TimeoutError:
            return None
        finally:
            self._snapshots.pop(request_id, None)

    # ------------------------------------------------------------ state for the run

    def code_lines(self) -> list[str]:
        return (self.code or {}).get("text", "").split("\n") if self.code else []

    def mirror_state(self) -> dict[str, Any]:
        return {"cards": self.cards, "active_item": self.active_item, "code": self.code, "board_summary": self.board_summary}

    def restore_mirror(self, data: dict[str, Any]) -> None:
        self.cards = data.get("cards") or {}
        self.active_item = data.get("active_item")
        self.code = data.get("code")
        self.board_summary = data.get("board_summary") or ""
```

(The whiteboard backup bytes are not checkpointed: after a worker restart the next 10-second backup from the browser refills them.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_workspace.py -q`
Expected: PASS (3 tests).

---

### Task 12: The interview run (the orchestrator)

**Files:**
- Create: `apps/ai-service/app/interviewer/run.py`
- Create: `apps/ai-service/tests/interviewer/test_run.py`

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: `RunDeps(blueprint, context, talker_chat, director_chat, workspace, api, store, clock=time.time, first_token_timeout_s=4.0, rules=None)`, `InterviewRun(deps)` with:
  - `start(saved: dict | None)`,
  - LiveKit-facing hooks: `on_user_text(text)`, `on_conversation_item(role, text, interrupted)`, `on_agent_state(state: str)`, `on_user_state(state: str)`, `reply(candidate_text: str | None) -> AsyncIterator[str]`,
  - `on_web_message(m)`, `tick()`, `tick_forever(every=1.0)`, `on_candidate_left()`, `on_candidate_back()`, `finish(reason)`,
  - attributes `conductor`, `guard`, `talker`, `director`, `speaker` (set by the caller; needs `reply()`, `say(text)`, `wait_for_playout()`, `delete_room()`), `finished: asyncio.Event`, `history`, `transcript`, `summary`.

- [ ] **Step 1: Write the failing test**

```python
"""The run: one interview end to end with fakes (no LiveKit, no network)."""
import asyncio

from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.protocol import parse_web
from app.interviewer.store import MemoryStore
from tests.interviewer.fakes import FakeApi, FakeChat, FakeSpeaker, FakeWorkspace, say
from tests.interviewer.fixtures import Clock, blueprint, context


def make(turns, briefs=()):
    clock = Clock()
    deps = RunDeps(blueprint=blueprint(), context=context(), talker_chat=FakeChat(turns), director_chat=FakeChat(briefs=list(briefs)),
                   workspace=FakeWorkspace(), api=FakeApi(), store=MemoryStore(), clock=clock, first_token_timeout_s=0.2)
    run = InterviewRun(deps)
    run.speaker = FakeSpeaker()
    return run, deps, clock


async def speak(run, text=None):
    if text is not None:
        run.on_user_text(text)
    pieces = [p async for p in run.reply(text)]
    run.on_conversation_item("assistant", " ".join(pieces), False)
    for _ in range(5):
        await asyncio.sleep(0)
    return pieces


def web(body):
    return parse_web(__import__("json").dumps({"v": 1, "id": "w9", **body}))


def test_greets_records_the_turn_and_checkpoints():
    async def go():
        run, deps, _ = make([say("Hi, I'm Siddharth. Thanks for joining.", tools=(("log_turn", {"condition": "none", "action": "greet", "reason": "opening"}),))])
        await run.start(None)
        out = await speak(run)
        await run.director.idle()
        return out, deps

    out, deps = asyncio.run(go())
    assert out == ["Hi, I'm Siddharth. Thanks for joining."]
    turn = next(t for t in deps.store.turns if t["speaker"] == "interviewer")
    assert turn["decision"]["action"] == "greet" and turn["candidate_id"] == "c1"
    assert deps.store.runs["s1"]["checkpoint"]["items"][0]["item_id"] == "greeting"


def test_a_move_on_order_advances_the_item_even_if_the_talker_forgets_next_item():
    async def go():
        run, _, clock = make([say("Hello."), say("Seems like we have to move on.")])
        await run.start(None)
        await speak(run)
        clock.advance(61)
        await run.tick()
        assert run.speaker.replies == 1
        await speak(run)
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "candidate_intro"


def test_the_third_full_violation_ends_the_round_after_the_talker_says_why():
    async def go():
        run, deps, _ = make([say("Please stay on this screen."), say("Final warning."), say("I'm ending the interview here.")])
        await run.start(None)
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
            await speak(run)
        await asyncio.wait_for(run.finished.wait(), 1)
        return run, deps

    run, deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "ended_by_interviewer" and deps.api.ended[0][2]["tab_changes"] == 3
    assert deps.workspace.of("session.ending")[0]["reason"] == "ended_by_interviewer"
    assert run.speaker.deleted


def test_three_failed_turns_end_the_round_as_technical():
    async def go():
        from app.interviewer.llm import LLMUnavailable
        down = [LLMUnavailable("down")] * 9
        run, deps, _ = make(down)
        await run.start(None)
        for _ in range(3):
            await speak(run, "hello?")
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "technical"


def test_the_candidate_end_request_gets_a_goodbye_then_ends():
    async def go():
        run, deps, _ = make([say("Thanks for your time, take care.")])
        await run.start(None)
        await run.on_web_message(web({"type": "session.end_request"}))
        await speak(run)
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "candidate_ended"


def test_a_stale_brief_keeps_its_summary_but_drops_its_moves():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        from app.interviewer.brief import Brief
        await run._on_brief(Brief.model_validate({"for_position": 0, "goal": "old", "summary": "Intro went well.",
                                                  "plan_changes": [{"op": "skip", "target": "core-2"}]}), {"triggers": ["turns"]})
        return run, deps

    run, deps = asyncio.run(go())
    assert run.summary == "Intro went well."
    assert next(i for i in run.conductor.items if i.item_id == "core-2").status == "pending"
    assert deps.store.briefs[0]["outcome"]["stale"] is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_run.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `run.py`**

```python
"""One live interview (spec §5): the conductor's rules, the talker's turns, the director's briefs, the
workspace and the store, wired together. Independent of LiveKit: the worker's adapter calls the hooks,
and the simulator drives the same object with text."""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable

from app.interviewer.brief import Brief
from app.interviewer.conductor import Conductor, Order, Rules
from app.interviewer.director import Director
from app.interviewer.guard import LeakGuard
from app.interviewer.plan import round_seconds
from app.interviewer.prompts import director_messages, item_details, state_block, talker_messages, talker_prefix
from app.interviewer.talker import TalkerFailed, TalkerTurn
from app.interviewer.tools import ToolExecutor

logger = logging.getLogger(__name__)
MAX_HISTORY = 20
FAILURES_TO_END = 3
CANDIDATE_GONE_S = 120.0
END_REQUEST_WATCHDOG_S = 8.0


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RunDeps:
    blueprint: dict[str, Any]
    context: dict[str, Any]
    talker_chat: Any
    director_chat: Any
    workspace: Any
    api: Any
    store: Any
    clock: Callable[[], float] = time.time
    first_token_timeout_s: float = 4.0
    rules: Rules | None = None


class InterviewRun:
    def __init__(self, deps: RunDeps) -> None:
        self.d = deps
        self.session_id: str = deps.context["session_id"]
        self.candidate_id: str = deps.context["candidate_id"]
        self.skills: list[str] = (deps.context.get("profile") or {}).get("skills") or []
        self.round_seconds = round_seconds(deps.blueprint, deps.context)
        self.conductor = Conductor(deps.blueprint, self.round_seconds, deps.rules, deps.clock, self.skills)
        self.guard = LeakGuard(deps.blueprint)
        self.tools = ToolExecutor(self)
        self.talker = TalkerTurn(deps.talker_chat, self.guard, self.tools, deps.first_token_timeout_s)
        self.director = Director(deps.director_chat, self._director_messages, self._on_brief, self._on_director_failure)
        self.prefix = talker_prefix(deps.blueprint, deps.context)
        self.speaker: Any = None
        self.history: list[dict[str, Any]] = []
        self.transcript: list[dict[str, Any]] = []
        self.seq = 0
        self.summary = ""
        self.brief: dict[str, Any] | None = None
        self.ask: dict[str, Any] | None = None
        self.ask_for_turn: dict[str, Any] | None = None
        self.candidate_said: dict[str, str] = {}
        self.counts: dict[str, Any] = {"tab_changes": 0, "screen_changes": 0, "full_violations": 0}
        self.failures = 0
        self.finishing = False
        self.finished = asyncio.Event()
        self.turn_ended_at: float | None = None
        self.awaiting_audio: int | None = None
        self.board_seen_by_director = ""
        self.conduct_seen_by_director = 0
        self._left_task: asyncio.Task | None = None
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------ lifecycle

    async def start(self, saved: dict[str, Any] | None) -> None:
        if saved and saved.get("checkpoint") and not saved.get("ended_at"):
            self.conductor = Conductor.restore(self.d.blueprint, self.round_seconds, saved["checkpoint"], self.d.rules,
                                               self.d.clock, self.skills)
            self.history = list(saved.get("history") or [])[-MAX_HISTORY:]
            self.summary = saved.get("summary") or ""
            self.seq = int(saved.get("seq") or 0)
            self.d.workspace.restore_mirror(saved.get("mirror") or {})
            return
        await self.d.store.start_run({
            "session_id": self.session_id, "candidate_id": self.candidate_id,
            "blueprint_id": self.d.blueprint.get("blueprint_id"), "blueprint_version": self.d.blueprint.get("version"),
            "talker_prefix": self.prefix, "started_at": _iso(),
            "models": {"talker": getattr(self.d.talker_chat, "model", None), "director": getattr(self.d.director_chat, "model", None)},
        })
        self.conductor.start()

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("interview task failed: %s", task.exception())

    def _can_speak(self) -> bool:
        return not self.finishing and not self.conductor.agent_speaking and not self.conductor.candidate_speaking

    def _speak_soon(self) -> None:
        if self.speaker is not None and self._can_speak():
            self.speaker.reply()

    # ------------------------------------------------------------ LiveKit-facing hooks

    def on_user_text(self, text: str) -> None:
        text = (text or "").strip()
        if not text or self.finishing:
            return
        now = self.d.clock()
        self.seq += 1
        item_id = self.conductor.current().item_id
        self.history.append({"role": "user", "content": text})
        self.transcript.append({"seq": self.seq, "speaker": "candidate", "text": text})
        self.candidate_said[item_id] = (self.candidate_said.get(item_id, "") + " " + text)[-4000:]
        self.ask_for_turn, self.ask = self.ask, None
        self.conductor.on_candidate_turn()
        self.turn_ended_at = now
        self._spawn(self.d.store.append_turn({"session_id": self.session_id, "candidate_id": self.candidate_id, "seq": self.seq,
                                              "speaker": "candidate", "text": text, "at": now, "item_id": item_id,
                                              "ask": self.ask_for_turn}))
        self._trigger_director()

    def on_conversation_item(self, role: str, text: str, interrupted: bool) -> None:
        if role != "assistant" or not (text or "").strip():
            return
        self.history.append({"role": "assistant", "content": text.strip() + (" (interrupted)" if interrupted else "")})
        self.history = self.history[-MAX_HISTORY * 2:]

    def on_agent_state(self, state: str) -> None:
        speaking = state == "speaking"
        if speaking and self.awaiting_audio is not None and self.turn_ended_at is not None:
            seq, self.awaiting_audio = self.awaiting_audio, None
            self._spawn(self.d.store.update_turn(self.session_id, seq, {"first_audio_ms": int((self.d.clock() - self.turn_ended_at) * 1000)}))
        self.conductor.set_agent_speaking(speaking)

    def on_user_state(self, state: str) -> None:
        self.conductor.set_candidate_speaking(state == "speaking")

    # ------------------------------------------------------------ the talker's turn

    def _view(self, orders: list[Order]) -> dict[str, Any]:
        now = self.d.clock()
        item = self.conductor.current()
        code = getattr(self.d.workspace, "code", None)
        return {
            "round_elapsed_min": int((now - (self.conductor.started_at or now)) / 60), "round_min": self.round_seconds // 60,
            "item": {"item_id": item.item_id, "kind": item.kind, "phase": item.phase, "slot_id": item.slot_id,
                     "elapsed_min": int((now - (item.started_at or now)) / 60), "max_min": max(1, item.max_seconds // 60),
                     "hint_step": item.hint_step, "filler": item.filler},
            "orders": [{"kind": o.kind, "text": o.text} for o in orders],
            "brief": self.brief, "follow_ups": self.conductor.follow_ups.get(item.item_id, []),
            "ask": {"surface": self.ask_for_turn["surface"], "quote": self.ask_for_turn["quote"]} if self.ask_for_turn else None,
            "code": {"language": code["language"], "version": code["version"], "lines": self.d.workspace.code_lines()} if code else None,
            "board": self.d.workspace.board_summary, "summary": self.summary,
        }

    async def reply(self, candidate_text: str | None) -> AsyncIterator[str]:
        if self.finishing:
            return
        self.seq += 1
        turn = self.seq
        orders = self.conductor.pending_orders()
        item = self.conductor.current()
        view = self._view(orders)
        state = state_block(view) + "\n\n## Current item\n" + item_details(self.d.blueprint, view["item"])
        messages = talker_messages(self.prefix, state, self.history[-MAX_HISTORY:], proactive=candidate_text is None)
        started = self.d.clock()
        self.awaiting_audio = turn
        failed = False
        try:
            async for sentence in self.talker.run(messages, turn_id=str(turn), current_slot=item.slot_id,
                                                  candidate_said=self.candidate_said.get(item.item_id, "")):
                yield sentence
            self.failures = 0
        except TalkerFailed:
            failed = True
            self.failures += 1
        finally:
            self._after_turn(turn, orders, item.item_id, started, failed)

    def _after_turn(self, turn: int, orders: list[Order], item_id: str, started: float, failed: bool) -> None:
        result = self.talker.last
        if not result.interrupted and not failed:
            self.conductor.consume(orders)
            kinds = {o.kind for o in orders}
            if kinds & {"move_on", "wrap_up_now"} and self.conductor.current().item_id == item_id and not self.conductor.ended:
                self.conductor.next_item("move_on")
        text = " ".join(result.spoken)
        self.transcript.append({"seq": turn, "speaker": "interviewer", "text": text})
        self._spawn(self.d.store.append_turn({
            "session_id": self.session_id, "candidate_id": self.candidate_id, "seq": turn, "speaker": "interviewer",
            "text": text, "at": started, "item_id": item_id, "orders": [asdict(o) for o in orders], "decision": result.decision,
            "tool_calls": result.tool_calls, "blocked": result.blocked, "first_token_ms": result.first_token_ms,
            "end_to_first_token_ms": (int((started - self.turn_ended_at) * 1000 + (result.first_token_ms or 0))
                                      if self.turn_ended_at is not None else None),
            "usage": result.usage, "provider": result.provider, "interrupted": result.interrupted, "error": result.error,
            "brief_position": (self.brief or {}).get("for_position"),
        }))
        end = self.conductor.end_order
        if self.failures >= FAILURES_TO_END:
            self._spawn(self.finish("technical"))
        elif end is not None and (end.consumed or not end.speak):
            self._spawn(self.finish(end.end_reason or "completed"))
        self._trigger_director()
        self._spawn(self._checkpoint())

    async def _checkpoint(self) -> None:
        await self.d.store.save_checkpoint(self.session_id, {
            "checkpoint": self.conductor.checkpoint(), "history": self.history[-MAX_HISTORY * 2:], "summary": self.summary,
            "seq": self.seq, "mirror": self.d.workspace.mirror_state(), "updated_at": _iso()})

    # ------------------------------------------------------------ events and time

    async def on_web_message(self, m) -> None:
        if m.type == "proctor.event":
            self.counts = m.counts.model_dump()
            self.conductor.on_proctor(m.kind, m.weight, m.at)
            self._speak_soon()
        elif m.type == "code.snapshot":
            self.conductor.on_code_change()
        elif m.type == "board.summary":
            self.conductor.on_board_change()
        elif m.type == "ask.selection":
            self.ask = {"surface": m.surface, "quote": m.quote, "item_id": m.item_id}
        elif m.type == "session.end_request":
            self.conductor.on_end_request()
            self._speak_soon()
            self._spawn(self._end_request_watchdog())
        self._trigger_director()

    async def _end_request_watchdog(self) -> None:
        await asyncio.sleep(END_REQUEST_WATCHDOG_S)
        if not self.finishing:
            await self.finish("candidate_ended")

    async def tick(self) -> None:
        if self.finishing:
            return
        new = self.conductor.tick()
        self._trigger_director()
        if new:
            self._speak_soon()

    async def tick_forever(self, every: float = 1.0) -> None:
        while not self.finished.is_set():
            await self.tick()
            await asyncio.sleep(every)

    def on_candidate_left(self) -> None:
        if self._left_task is None or self._left_task.done():
            self._left_task = asyncio.create_task(self._wait_for_return())

    def on_candidate_back(self) -> None:
        if self._left_task is not None:
            self._left_task.cancel()
            self._left_task = None

    async def _wait_for_return(self) -> None:
        await asyncio.sleep(CANDIDATE_GONE_S)
        if not self.finishing:
            await self.finish("technical")

    # ------------------------------------------------------------ the director

    def _trigger_director(self) -> None:
        reasons = self.conductor.take_triggers()
        if reasons and not self.finishing:
            self.director.trigger(reasons)

    async def _director_messages(self) -> list[dict[str, Any]]:
        image = None
        board = self.d.workspace.board_summary
        if board and board != self.board_seen_by_director:
            self.board_seen_by_director = board
            image = await self.d.workspace.request_snapshot()
        c = self.conductor
        now = self.d.clock()
        snapshot = {
            "position": c.position,
            "items": [{"item_id": i.item_id, "kind": i.kind, "phase": i.phase, "status": i.status, "hint_step": i.hint_step,
                       "elapsed_min": int(((i.ended_at or now) - i.started_at) / 60) if i.started_at else 0, "filler": i.filler}
                      for i in c.items],
            "current": {"item_id": c.current().item_id, "slot_id": c.current().slot_id,
                        "follow_ups": c.follow_ups.get(c.current().item_id, [])},
            "transcript": self.transcript[-120:], "summary": self.summary, "code": getattr(self.d.workspace, "code", None),
            "board": board, "proctor": c.proctor, "conduct": c.conduct, "plan_changes": c.plan_changes, "last_brief": self.brief,
        }
        return director_messages(self.d.blueprint, self.d.context, snapshot, image)

    async def _on_brief(self, brief: Brief, meta: dict[str, Any]) -> None:
        outcome = self.conductor.apply_brief(brief.model_dump())
        if brief.summary:
            self.summary = brief.summary
        if outcome["stale"]:
            self.brief = {**(self.brief or {}), "tone": brief.tone}
        else:
            self.brief = {"for_position": brief.for_position, "goal": brief.goal, "next_move": brief.next_move.model_dump(),
                          "tone": brief.tone}
        # The director's conduct concern counts only when the talker didn't already flag something since the last brief.
        if brief.conduct.concern != "none" and len(self.conductor.conduct) == self.conduct_seen_by_director:
            if self.conductor.on_conduct(f"director:{brief.conduct.concern}", brief.conduct.reason,
                                         f"brief-{self.director.runs}", "director") is not None:
                self._speak_soon()
        self.conduct_seen_by_director = len(self.conductor.conduct)
        await self.d.store.append_brief({"session_id": self.session_id, "candidate_id": self.candidate_id,
                                         "at": self.d.clock(), "brief": brief.model_dump(), "outcome": outcome, **meta})
        if brief.evidence:
            await self.d.store.upsert_evidence(self.session_id, self.candidate_id, [e.model_dump() for e in brief.evidence])

    async def _on_director_failure(self, error: str) -> None:
        await self.d.store.append_brief({"session_id": self.session_id, "candidate_id": self.candidate_id,
                                         "at": self.d.clock(), "error": error})

    # ------------------------------------------------------------ ending

    def _ending_message(self, reason: str) -> str:
        if reason == "completed":
            return (self.d.blueprint.get("persona") or {}).get("closing") or "Thanks for your time today."
        if reason == "ended_by_interviewer":
            last = next((h["content"] for h in reversed(self.history) if h["role"] == "assistant"), "")
            return last or "The interviewer ended the interview."
        if reason == "candidate_ended":
            return "You ended the interview."
        return "The connection to your interviewer was lost."

    async def finish(self, reason: str) -> None:
        if self.finishing:
            return
        self.finishing = True
        try:
            if self.speaker is not None:
                await self.speaker.wait_for_playout()
            await self.d.workspace.send({"type": "session.ending", "reason": reason, "message": self._ending_message(reason)[:1000]})
            summary = self.conductor.live_summary(self.counts)
            try:
                await self.d.api.end(self.session_id, reason, summary)
            except Exception as exc:  # noqa: BLE001 - the API's sweep is the backstop
                logger.warning("ending session %s in the API failed: %s", self.session_id, exc)
            await self.d.store.finalize_run(self.session_id, {
                "ended_at": _iso(), "end_reason": reason, "live_summary": summary, "summary": self.summary,
                "checkpoint": self.conductor.checkpoint(), "seq": self.seq})
            await self.director.aclose()
            if self.speaker is not None:
                await self.speaker.delete_room()
        finally:
            self.finished.set()
```

Notes for the implementer:
- `reply()` keeps the `finally` block synchronous (`_after_turn` only spawns tasks): when LiveKit cancels an interrupted reply, nothing in cleanup awaits.
- An `end` order raised outside a turn (a proctor or conduct event) is spoken on the next turn (`_speak_soon`), and `_after_turn` finishes once that order was consumed. An `end` with `speak=False` (the plan ran out after the wrap-up) finishes right after the turn that called `next_item`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_run.py -q`
Expected: PASS (6 tests).

---

### Task 13: The LiveKit adapter and the worker

**Files:**
- Create: `apps/ai-service/app/interviewer/agent.py`
- Create: `apps/ai-service/app/interviewer/worker.py`
- Create: `apps/ai-service/tests/interviewer/test_worker.py`
- Modify: `apps/ai-service/package.json` (scripts)
- Modify: `apps/ai-service/README.md`

**Interfaces:**
- Consumes: `InterviewRun`, `RunDeps` (Task 12), `WorkspaceBridge` (Task 11), `ApiClient` (Task 10), `MongoStore` (Task 9), `talker_chat`, `director_chat` (Task 1), `bp_store.current_blueprint`.
- Produces: `PlaceholderLLM(llm.LLM)`, `InterviewerAgent(Agent)` (`llm_node` streams `InterviewRun.reply`), `LiveKitSpeaker(session, ctx)`, `wire_session_events(session, run)`; `worker.session_id_from(job_metadata, room_name) -> str | None`, `worker.missing_live_settings(settings) -> list[str]`, `worker.entrypoint(ctx)`, `worker.build_worker_options(settings)`, `python -m app.interviewer.worker dev|start`.

- [ ] **Step 1: Write the failing test (the pure parts)**

```python
from types import SimpleNamespace

from app.interviewer.worker import missing_live_settings, session_id_from


def test_session_id_comes_from_dispatch_metadata_then_the_room_name():
    assert session_id_from('{"session_id": "abc"}', "interview-zzz") == "abc"
    assert session_id_from("", "interview-zzz") == "zzz"
    assert session_id_from("not json", "lobby") is None


def test_lists_missing_live_settings_without_values():
    s = SimpleNamespace(livekit_url="wss://x", livekit_api_key="", livekit_api_secret="s", deepgram_api_key="d",
                        openrouter_api_key="", mongodb_url="m", api_base_url="http://api", internal_api_key="k")
    assert missing_live_settings(s) == ["LIVEKIT_API_KEY", "OPENROUTER_API_KEY"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_worker.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `agent.py`**

```python
"""The thin LiveKit adapter (spec §3): LiveKit Agents runs speech-to-text, turn-taking, interruptions,
the voice and transcription; InterviewerAgent.llm_node streams InterviewRun.reply() into it, so the
interviewer's own tool handling never costs a second LLM round trip."""
from __future__ import annotations

from typing import Any, AsyncIterable

from livekit.agents import Agent, AgentSession, JobContext, llm

from app.interviewer.run import InterviewRun


class PlaceholderLLM(llm.LLM):
    """The voice pipeline needs an LLM object to schedule replies; InterviewerAgent.llm_node does the work."""

    def chat(self, **kwargs: Any) -> llm.LLMStream:
        raise RuntimeError("InterviewerAgent.llm_node generates every reply; this LLM is never called")


class InterviewerAgent(Agent):
    def __init__(self, run: InterviewRun) -> None:
        super().__init__(instructions="The interviewer's instructions are assembled per turn by InterviewRun.")
        self.run = run
        self._pending_user_text: str | None = None

    async def on_enter(self) -> None:
        self.session.generate_reply()  # the opening turn: the run's greeting

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        text = new_message.text_content or ""
        self._pending_user_text = text
        self.run.on_user_text(text)

    async def llm_node(self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings) -> AsyncIterable[str]:
        text, self._pending_user_text = self._pending_user_text, None
        async for sentence in self.run.reply(text):
            yield sentence + " "


class LiveKitSpeaker:
    def __init__(self, session: AgentSession, ctx: JobContext) -> None:
        self.session = session
        self.ctx = ctx

    def reply(self) -> None:
        self.session.generate_reply()

    async def say(self, text: str) -> None:
        await self.session.say(text, allow_interruptions=False).wait_for_playout()

    async def wait_for_playout(self) -> None:
        handle = self.session.current_speech
        if handle is not None:
            await handle.wait_for_playout()

    async def delete_room(self) -> None:
        await self.ctx.delete_room()


def wire_session_events(session: AgentSession, run: InterviewRun) -> None:
    @session.on("conversation_item_added")
    def _item(ev) -> None:
        item = ev.item
        role = getattr(item, "role", None)
        if role == "assistant":
            run.on_conversation_item("assistant", item.text_content or "", bool(getattr(item, "interrupted", False)))

    @session.on("agent_state_changed")
    def _agent(ev) -> None:
        run.on_agent_state(str(ev.new_state))

    @session.on("user_state_changed")
    def _user(ev) -> None:
        run.on_user_state(str(ev.new_state))
```

- [ ] **Step 4: Write `worker.py`**

```python
"""The interviewer worker (spec §3): `python -m app.interviewer.worker dev` (or `start`). Explicit
dispatch only (agent name `interviewer`): the API dispatches it into `interview-{sessionId}` with
metadata {"session_id": …}. One interviewer per room; a restarted worker resumes from the checkpoint."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from livekit import rtc
from livekit.agents import AgentSession, JobContext, WorkerOptions, cli
from livekit.plugins import deepgram

from app.blueprint import store as bp_store
from app.config import Settings, get_settings
from app.db import mongo
from app.interviewer.agent import InterviewerAgent, LiveKitSpeaker, PlaceholderLLM, wire_session_events
from app.interviewer.api_client import ApiClient
from app.interviewer.llm import director_chat, talker_chat
from app.interviewer.protocol import WORKSPACE_TOPIC, agent_message
from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.store import MongoStore
from app.interviewer.workspace import WorkspaceBridge

logger = logging.getLogger(__name__)
ROOM_PREFIX = "interview-"
_REQUIRED = {"livekit_url": "LIVEKIT_URL", "livekit_api_key": "LIVEKIT_API_KEY", "livekit_api_secret": "LIVEKIT_API_SECRET",
             "deepgram_api_key": "DEEPGRAM_API_KEY", "openrouter_api_key": "OPENROUTER_API_KEY", "mongodb_url": "MONGODB_URL",
             "api_base_url": "API_BASE_URL", "internal_api_key": "INTERNAL_API_KEY"}


def missing_live_settings(settings: Any) -> list[str]:
    return [env for attr, env in _REQUIRED.items() if not getattr(settings, attr, "")]


def session_id_from(job_metadata: str | None, room_name: str | None) -> str | None:
    try:
        data = json.loads(job_metadata or "")
        if isinstance(data, dict) and data.get("session_id"):
            return str(data["session_id"])
    except json.JSONDecodeError:
        pass
    if room_name and room_name.startswith(ROOM_PREFIX) and len(room_name) > len(ROOM_PREFIX):
        return room_name[len(ROOM_PREFIX):]
    return None


def _is_agent(participant) -> bool:
    return getattr(participant, "kind", None) == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT


async def _cannot_start(ctx: JobContext, api: ApiClient, session_id: str) -> None:
    message = agent_message({"type": "session.ending", "reason": "technical",
                             "message": "Your interviewer couldn't start. Please try again later."})
    try:
        await ctx.room.local_participant.send_text(json.dumps(message), topic=WORKSPACE_TOPIC)
        await api.end(session_id, "technical", {})
    finally:
        await ctx.delete_room()


async def entrypoint(ctx: JobContext) -> None:
    settings = get_settings()
    session_id = session_id_from(ctx.job.metadata, ctx.room.name)
    if session_id is None:
        logger.warning("job for room %r has no session id; ignoring", ctx.room.name)
        return
    await mongo.connect(settings)
    api = ApiClient(settings.api_base_url, settings.internal_api_key)
    talker, director = talker_chat(settings), director_chat(settings)
    try:
        await ctx.connect()
        if any(_is_agent(p) for p in ctx.room.remote_participants.values()):
            logger.warning("another interviewer is already in %s; leaving", ctx.room.name)
            return
        blueprint = await bp_store.current_blueprint(session_id)
        if blueprint is None:
            logger.error("no current blueprint for session %s", session_id)
            await _cannot_start(ctx, api, session_id)
            return
        context = await api.context(session_id)

        run: InterviewRun | None = None

        async def on_message(message) -> None:
            if run is not None:
                await run.on_web_message(message)

        bridge = WorkspaceBridge(ctx.room, on_message=on_message)
        store = MongoStore()
        run = InterviewRun(RunDeps(blueprint=blueprint, context=context, talker_chat=talker, director_chat=director,
                                   workspace=bridge, api=api, store=store,
                                   first_token_timeout_s=settings.interviewer_talker_timeout_seconds))
        session = AgentSession(
            stt=deepgram.STT(model="nova-3", language="en-US", api_key=settings.deepgram_api_key),
            tts=deepgram.TTS(model=settings.interviewer_tts_voice, api_key=settings.deepgram_api_key),
            llm=PlaceholderLLM(),
        )
        run.speaker = LiveKitSpeaker(session, ctx)
        wire_session_events(session, run)
        bridge.attach()

        @ctx.room.on("participant_disconnected")
        def _left(participant) -> None:
            if not _is_agent(participant):
                run.on_candidate_left()

        @ctx.room.on("participant_connected")
        def _back(participant) -> None:
            if not _is_agent(participant):
                run.on_candidate_back()

        await run.start(await store.load_run(session_id))
        await session.start(agent=InterviewerAgent(run), room=ctx.room)
        ticker = asyncio.create_task(run.tick_forever())
        try:
            await run.finished.wait()
        finally:
            ticker.cancel()
            await session.aclose()
    finally:
        await talker.aclose()
        await director.aclose()
        await api.aclose()
        await mongo.close()


def build_worker_options(settings: Settings) -> WorkerOptions:
    """Creds come from Settings (the .env is loaded by pydantic, not exported to os.environ)."""
    return WorkerOptions(entrypoint_fnc=entrypoint, agent_name=settings.interviewer_agent_name,
                         ws_url=settings.livekit_url, api_key=settings.livekit_api_key, api_secret=settings.livekit_api_secret)


def main() -> None:
    settings = get_settings()
    missing = missing_live_settings(settings)
    if missing:
        raise SystemExit(f"interviewer worker: set {', '.join(missing)} in apps/ai-service/.env")
    cli.run_app(build_worker_options(settings))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Add the dev script and document it**

In `apps/ai-service/package.json` `scripts`, add:

```json
    "dev:interviewer": "test -x .venv/bin/python || { echo \"ai-service: no .venv — run: pnpm --filter @interviewiq/ai-service setup\"; exit 1; }; .venv/bin/python -m app.interviewer.worker dev"
```

In `apps/ai-service/README.md`, add a section:

```markdown
## Live interviewer worker (Module 03)

A LiveKit Agents worker that runs a prepared blueprint by voice (spec:
`docs/superpowers/specs/2026-10-08-live-interviewer-design.md`). It is a separate process:

    pnpm --filter @interviewiq/ai-service dev:interviewer      # = .venv/bin/python -m app.interviewer.worker dev

Needs `LIVEKIT_*`, `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `MONGODB_URL`, `API_BASE_URL` and `INTERNAL_API_KEY` in
`.env`. The API dispatches it (agent name `interviewer`) when a candidate goes live.

- Text-only rehearsal, no LiveKit: `.venv/bin/python -m app.interviewer.simulate --session <id> --script <file>`
- Replay a session's decisions: `.venv/bin/python -m app.interviewer.trace <session_id>`
- Latency spike: `.venv/bin/python scripts/interviewer_latency_spike.py --session <id>`
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_worker.py -q`
Expected: PASS (2 tests). Also confirm the worker module imports and its CLI starts: `cd apps/ai-service && .venv/bin/python -m app.interviewer.worker --help` prints LiveKit Agents' CLI help (`dev`, `start`, `console`, …).

---

### Task 14: The text-only simulator

**Files:**
- Create: `apps/ai-service/app/interviewer/simulate.py`
- Create: `apps/ai-service/tests/interviewer/test_simulate.py`
- Create: `apps/ai-service/scripts/interviewer_sim_script.txt`

**Interfaces:**
- Consumes: `InterviewRun`, `RunDeps` (Task 12), `MemoryStore` (Task 9), `parse_web` (Task 2).
- Produces: `SimClock`, `SimWorkspace`, `SimSpeaker`, `SimApi`, `simulate(blueprint, context, lines, talker_chat, director_chat, *, seconds_per_line=20.0, out=print) -> InterviewRun`, and the CLI `python -m app.interviewer.simulate --session <id> [--script <file>] [--skills "Java,SQL"]`.
- Script lines: plain text is something the candidate says; `#wait N` advances the clock N seconds (and runs the conductor); `#tab`, `#window`, `#fullscreen`, `#share` send a proctor event; `#code <text>` sets the candidate's code (`\n` for new lines); `#end` presses End.

- [ ] **Step 1: Write the failing test**

```python
import asyncio

from app.interviewer.simulate import simulate
from tests.interviewer.fakes import FakeChat, say
from tests.interviewer.fixtures import blueprint, context


def test_simulates_a_short_round_through_to_the_end():
    lines_out: list[str] = []
    talker = FakeChat([
        say("Hi, I'm Siddharth.", tools=(("next_item", {"reason": "greeted"}),)),
        say("Tell me about yourself."),
        say("Thanks, let's code.", tools=(("next_item", {"reason": "intro done"}),)),
        say("The problem is on your screen.", tools=(("show_problem", {"item_id": "core-1"}),)),
        say("I noticed you switched tabs. Please stay here."),
        say("Thanks for your time, take care."),
    ])
    script = ["Hi!", "I'm Asha, a backend engineer.", "#wait 5", "Sounds good.", "#tab", "#end"]

    run = asyncio.run(simulate(blueprint(), context(), script, talker, FakeChat(), seconds_per_line=5, out=lines_out.append))

    assert run.finished.is_set() and run.d.api.ended[0][1] == "candidate_ended"
    assert any(l.startswith("INTERVIEWER: Hi, I'm Siddharth.") for l in lines_out)
    assert any("panel.show_problem" in l and "Problem 1" in l for l in lines_out)
    assert any("I noticed you switched tabs" in l for l in lines_out)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_simulate.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `simulate.py`**

```python
"""Text-only rehearsal of the live interviewer (spec §14): the same InterviewRun on a real blueprint,
with no LiveKit or audio. Candidate lines come from a script file (one per line) or the keyboard.

    .venv/bin/python -m app.interviewer.simulate --session <id> [--script scripts/interviewer_sim_script.txt]

Script lines: text = the candidate speaks; `#wait N` = N seconds pass; `#tab` / `#window` / `#fullscreen` /
`#share` = a proctor event; `#code <text>` = the candidate's code (use \\n); `#end` = the candidate presses End.
Calls OpenRouter (costs cents)."""
from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any, Callable

from app.interviewer.protocol import parse_web
from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.store import MemoryStore

PROCTOR = {"#tab": ("tab_hidden", 1), "#window": ("window_blur", 1), "#fullscreen": ("fullscreen_exit", 0.5),
           "#share": ("share_stopped", 0.5)}


class SimClock:
    def __init__(self) -> None:
        self.t = 1_000_000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class SimWorkspace:
    def __init__(self, out: Callable[[str], None]) -> None:
        self.out = out
        self.sent: list[dict[str, Any]] = []
        self.code: dict[str, Any] | None = None
        self.board_summary = ""
        self.mirror: dict[str, Any] = {}

    async def send(self, body: dict[str, Any]) -> str:
        self.sent.append(body)
        self.out(f"  [workspace] {json.dumps(body, ensure_ascii=False)[:300]}")
        return f"sim_{len(self.sent)}"

    def code_lines(self) -> list[str]:
        return self.code["text"].split("\n") if self.code else []

    async def request_snapshot(self) -> bytes | None:
        return None

    def mirror_state(self) -> dict[str, Any]:
        return self.mirror

    def restore_mirror(self, data: dict[str, Any]) -> None:
        self.mirror = data


class SimSpeaker:
    def __init__(self) -> None:
        self.requested = 0

    def reply(self) -> None:
        self.requested += 1

    def take(self) -> bool:
        wanted, self.requested = self.requested > 0, 0
        return wanted

    async def say(self, text: str) -> None:
        pass

    async def wait_for_playout(self) -> None:
        pass

    async def delete_room(self) -> None:
        pass


class SimApi:
    def __init__(self, out: Callable[[str], None]) -> None:
        self.out = out
        self.ended: list[tuple[str, str, dict[str, Any]]] = []

    async def end(self, session_id: str, reason: str, summary: dict[str, Any]) -> dict[str, Any]:
        self.ended.append((session_id, reason, summary))
        self.out(f"  [api] session ended: {reason} {summary}")
        return {"status": "COMPLETED"}


def _web(body: dict[str, Any]):
    return parse_web(json.dumps({"v": 1, "id": "sim", **body}))


async def _speak(run: InterviewRun, text: str | None, out: Callable[[str], None]) -> None:
    pieces = [p async for p in run.reply(text)]
    spoken = " ".join(pieces)
    if spoken:
        out(f"INTERVIEWER: {spoken}")
    run.on_conversation_item("assistant", spoken, False)
    result = run.talker.last
    if result.decision:
        out(f"  [decision] {result.decision}")
    for blocked in result.blocked:
        out(f"  [guard] blocked ({blocked['rule']}): {blocked['sentence']}")
    for _ in range(3):
        await asyncio.sleep(0)


async def simulate(blueprint: dict[str, Any], context: dict[str, Any], lines: list[str], talker_chat, director_chat, *,
                   seconds_per_line: float = 20.0, out: Callable[[str], None] = print) -> InterviewRun:
    clock = SimClock()
    workspace = SimWorkspace(out)
    run = InterviewRun(RunDeps(blueprint=blueprint, context=context, talker_chat=talker_chat, director_chat=director_chat,
                               workspace=workspace, api=SimApi(out), store=MemoryStore(), clock=clock, first_token_timeout_s=15.0))
    speaker = SimSpeaker()
    run.speaker = speaker
    await run.start(None)
    await _speak(run, None, out)
    tabs = screen = full = 0
    for raw in lines:
        if run.finished.is_set():
            break
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#wait"):
            clock.advance(float(line.split()[1]))
        elif line in PROCTOR:
            kind, weight = PROCTOR[line]
            tabs += kind == "tab_hidden"
            screen += weight if kind != "tab_hidden" else 0
            full += weight == 1
            out(f"(proctor: {kind})")
            await run.on_web_message(_web({"type": "proctor.event", "kind": kind, "weight": weight, "at": int(clock() * 1000),
                                           "counts": {"tab_changes": tabs, "screen_changes": screen, "full_violations": full}}))
        elif line.startswith("#code"):
            workspace.code = {"language": "python", "text": line[5:].strip().replace("\\n", "\n"), "version": 1}
            await run.on_web_message(_web({"type": "code.snapshot", "version": 1, "language": "python", "text": workspace.code["text"]}))
        elif line == "#end":
            out("(candidate pressed End)")
            await run.on_web_message(_web({"type": "session.end_request"}))
        else:
            out(f"CANDIDATE: {line}")
            run.on_user_text(line)
            await _speak(run, line, out)
            clock.advance(seconds_per_line)
        await run.tick()
        if speaker.take() and not run.finished.is_set():
            await _speak(run, None, out)
        for _ in range(5):
            await asyncio.sleep(0)
    await run.director.idle()
    for _ in range(10):
        if run.finished.is_set():
            break
        await asyncio.sleep(0)
    return run


async def _load(session_id: str, skills: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    from app.blueprint import store
    blueprint = await store.current_blueprint(session_id)
    if blueprint is None:
        raise SystemExit(f"no current blueprint for session {session_id}")
    run = await store.get_run(blueprint["run_id"])
    profile = ((run or {}).get("request") or {}).get("candidate_profile") or {}
    rnd = blueprint.get("round") or {}
    context = {"session_id": f"sim-{session_id}", "candidate_id": blueprint["candidate_id"], "first_name": "there",
               "round": {"company": rnd.get("company"), "company_name": rnd.get("company"), "role": "Software Engineer",
                         "level": "", "round_type": rnd.get("type"), "duration_mins": rnd.get("duration_mins")},
               "profile": {"headline": profile.get("headline"), "skills": skills or profile.get("skills") or [],
                           "projects": [p.get("name") for p in profile.get("projects") or []]}}
    return blueprint, context


async def _main(args: argparse.Namespace) -> None:
    from app.config import get_settings
    from app.db import mongo
    from app.interviewer.llm import director_chat, talker_chat
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set in apps/ai-service/.env")
    await mongo.connect(settings)
    try:
        blueprint, context = await _load(args.session, [s.strip() for s in (args.skills or "").split(",") if s.strip()])
    finally:
        await mongo.close()
    lines = open(args.script, encoding="utf-8").read().splitlines() if args.script else _keyboard()
    talker, director = talker_chat(settings), director_chat(settings)
    try:
        await simulate(blueprint, context, lines, talker, director)
    finally:
        await talker.aclose()
        await director.aclose()


def _keyboard():
    while True:
        try:
            yield input("you> ")
        except EOFError:
            return


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True)
    parser.add_argument("--script")
    parser.add_argument("--skills")
    asyncio.run(_main(parser.parse_args()))
```

(The simulator never writes to MongoDB: it uses `MemoryStore` and a `sim-` session id.)

- [ ] **Step 4: Write a sample script**

Create `scripts/interviewer_sim_script.txt`:

```
Hi, thanks for having me!
I'm a backend engineer, mostly Java and SQL. I built a split-bill app last year.
#wait 30
Sure, I'm ready.
Can you tell me the constraints?
I think I'd check every pair first.
That would be O(n squared). Could I do better with something that remembers what I've seen?
#code def pair_sum(nums, target):\n    seen = {}\n    return []
Can you just tell me the answer?
#wait 600
#tab
Sorry, that was a notification.
Can I have five more minutes?
#wait 900
I don't have questions, thanks.
#end
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer/test_simulate.py -q`
Expected: PASS.

- [ ] **Step 6: Run the whole interviewer suite**

Run: `cd apps/ai-service && .venv/bin/python -m pytest tests/interviewer -q && .venv/bin/python -m pytest -q`
Expected: all PASS, nothing else in the AI service broken.

- [ ] **Step 7: Rehearse on the Salescode blueprint (ask the user first; costs cents)**

Run: `cd apps/ai-service && .venv/bin/python -m app.interviewer.simulate --session cceda82c-5e3b-4db5-b104-f8fb856146f9 --script scripts/interviewer_sim_script.txt --skills "Java,SQL"`

Check, and report what you see:
- the greeting and intro sound natural, and the problem is shown with `show_problem` and the label "Problem 1";
- asking for constraints produces a `reveal` section; asking for the answer is declined with a hint instead;
- after `#wait 600` (and the converge order) the interviewer asks for the final approach; after the time limit it says it has to move on and refuses more time;
- the tab switch is mentioned;
- every interviewer turn prints a `[decision]`; nothing reads an example aloud or names the problem (check `[guard]` lines);
- End produces a goodbye and `session ended: candidate_ended`.

Paste the transcript into the task report for the user to judge the interviewer's quality. Prompt wording changes that come out of this go to the user for review (spec §12), not straight into the code.
