"""OpenRouter client: streamed text, assembled tool calls, routing params, failures."""
import asyncio
import json

import httpx
import pytest

from app.interviewer.llm import PROVIDER_ROUTING, FailoverChat, LLMUnavailable, OpenRouterChat, fallback_chat, reasoning_param
from app.config import Settings
from tests.interviewer.fakes import FakeChat


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


def test_the_director_falls_over_to_the_fallback_model_when_the_first_is_unavailable():
    primary = FakeChat(briefs=[LLMUnavailable("down")], model="primary")
    backup = FakeChat(briefs=[{"goal": "from the backup"}], model="fallback")
    data, _ = asyncio.run(FailoverChat(primary, backup).json([], "brief", {}))
    assert data == {"goal": "from the backup"} and len(backup.calls) == 1


def test_a_healthy_first_model_never_touches_the_fallback_and_without_one_the_failure_surfaces():
    primary, backup = FakeChat(briefs=[{"goal": "ok"}]), FakeChat(briefs=[{"goal": "unused"}])
    assert asyncio.run(FailoverChat(primary, backup).json([], "brief", {}))[0] == {"goal": "ok"} and backup.calls == []
    with pytest.raises(LLMUnavailable):
        asyncio.run(FailoverChat(FakeChat(briefs=[LLMUnavailable("down")]), None).json([], "brief", {}))


def test_the_fallback_is_glm_flash_on_openrouter_with_reasoning_kept_minimal_because_that_model_cannot_turn_it_off():
    settings = Settings(_env_file=None, OPENROUTER_API_KEY="k")
    chat = fallback_chat(settings)
    assert chat.model == "z-ai/glm-5.3-flash" and chat.reasoning == "minimal"
    assert reasoning_param(chat.reasoning) == {"effort": "minimal"}
    assert fallback_chat(Settings(_env_file=None, OPENROUTER_API_KEY="k", INTERVIEWER_FALLBACK_MODEL="")) is None


def test_routing_caps_the_price_so_a_fast_but_dear_provider_is_never_chosen():
    """A rehearsal (2026-10-17) sent 25 of 56 talker turns to an endpoint at twice Together's price with almost no prompt caching,
    tripling the cost of the round; latency-first routing is kept, above the standard DeepSeek flash tier is excluded."""
    assert PROVIDER_ROUTING["sort"] == "latency"
    assert PROVIDER_ROUTING["max_price"] == {"prompt": 0.3, "completion": 1.2}


def _seen_body(chat_kwargs: dict) -> dict:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(_chunk({"content": "ok"}, finish="stop")))

    chat = OpenRouterChat(api_key="k", base_url="https://openrouter.test/api/v1", model="m", reasoning="none", timeout_s=5,
                          http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), **chat_kwargs)

    async def run():
        return [e async for e in chat.stream([{"role": "user", "content": "hi"}])]

    asyncio.run(run())
    return seen["body"]


def test_a_session_id_is_sent_as_openrouters_sticky_routing_key_and_left_out_without_one():
    """OpenRouter sends later requests with the same session_id to the provider that served the first, keeping its prompt cache warm."""
    assert _seen_body({"session_id": "s1:talker"})["session_id"] == "s1:talker"
    assert "session_id" not in _seen_body({})


def test_a_pinned_provider_order_replaces_the_latency_sort_and_keeps_fallbacks_and_the_price_cap():
    from app.interviewer.llm import talker_routing

    assert talker_routing("") is PROVIDER_ROUTING and talker_routing(" , ") is PROVIDER_ROUTING
    pinned = talker_routing("Together, Fireworks")
    assert pinned["order"] == ["Together", "Fireworks"] and "sort" not in pinned
    assert pinned["allow_fallbacks"] is True and pinned["max_price"] == PROVIDER_ROUTING["max_price"] and pinned["data_collection"] == "deny"
    assert _seen_body({"routing": pinned})["provider"]["order"] == ["Together", "Fireworks"]


def test_each_role_of_a_round_gets_its_own_sticky_key_and_the_setting_turns_them_off():
    from app.interviewer.llm import build_chats

    settings = Settings(_env_file=None, OPENROUTER_API_KEY="k")
    talker, fallback, director = build_chats(settings, session_id="s1")
    assert talker.session_id == "s1:talker" and fallback.session_id == "s1:fallback"
    assert director.primary.session_id == "s1:director" and director.fallback.session_id == "s1:director-fallback"
    off = build_chats(Settings(_env_file=None, OPENROUTER_API_KEY="k", INTERVIEWER_STICKY_ROUTING="false"), session_id="s1")
    assert off[0].session_id is None and off[1].session_id is None and off[2].primary.session_id is None
    assert build_chats(settings)[0].session_id is None                       # the simulators pass no session


def test_the_talker_samples_at_a_moderate_temperature_and_the_director_at_a_low_one_and_a_chat_with_none_sends_no_temperature():
    """Decided 2026-10-18: explicit temperatures (talker 0.7, director 0.2, both configurable), so two interviewers do not say the same words."""
    from app.interviewer.llm import build_chats

    settings = Settings(_env_file=None, OPENROUTER_API_KEY="k")
    assert (settings.interviewer_talker_temperature, settings.interviewer_director_temperature) == (0.7, 0.2)
    talker, fallback, director = build_chats(settings)
    assert (talker.temperature, fallback.temperature, director.primary.temperature, director.fallback.temperature) == (0.7, 0.7, 0.2, 0.2)
    assert _seen_body({"temperature": 0.7})["temperature"] == 0.7
    assert "temperature" not in _seen_body({})
    tuned = Settings(_env_file=None, OPENROUTER_API_KEY="k", INTERVIEWER_TALKER_TEMPERATURE="0.4", INTERVIEWER_DIRECTOR_TEMPERATURE="0.0")
    assert build_chats(tuned)[0].temperature == 0.4 and build_chats(tuned)[2].primary.temperature == 0.0


def test_a_chat_can_be_copied_at_another_temperature_for_a_classifier_that_shares_the_talkers_model():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "g", "object": "chat.completion", "created": 1, "model": "m",
                                         "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "{\"verdict\": \"none\"}"}}]})

    chat = OpenRouterChat(api_key="k", base_url="https://openrouter.test/api/v1", model="m", reasoning="none", timeout_s=5, temperature=0.7,
                          http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    cool = chat.with_temperature(0.0)
    asyncio.run(cool.json([{"role": "user", "content": "x"}], "conduct_check", {"type": "object"}))
    assert seen["body"]["temperature"] == 0.0 and chat.temperature == 0.7 and cool is not chat and cool.model == chat.model


def test_the_warm_up_is_one_token_with_the_tools_and_never_raises():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        if seen.get("fail"):
            return httpx.Response(402, json={"error": {"message": "no credit"}})
        return httpx.Response(200, json={"id": "x", "object": "chat.completion", "created": 1, "model": "m",
                                         "choices": [{"index": 0, "finish_reason": "length", "message": {"role": "assistant", "content": "R"}}],
                                         "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

    chat = _chat(handler)
    tools = [{"type": "function", "function": {"name": "t", "parameters": {"type": "object"}}}]
    assert asyncio.run(chat.warm_up([{"role": "system", "content": "prefix"}], tools)) is True
    assert seen["body"]["max_tokens"] == 1 and seen["body"]["tools"] == tools and not seen["body"].get("stream")
    seen["fail"] = True
    assert asyncio.run(chat.warm_up([{"role": "system", "content": "prefix"}], tools)) is False
