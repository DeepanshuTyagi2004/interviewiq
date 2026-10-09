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
