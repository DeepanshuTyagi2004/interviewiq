from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.llm import decisions as dec
from app.llm.decisions import DecisionsClient, DecisionsUnavailable, choice, noul, score, shared_decisions_client

URL = "https://openrouter.ai/api/alpha/decisions"

OK_BODY = {
    "id": "x", "model": "typesafe/jev-1.14-20261014", "provider": "TypeSafe",
    "answers": {
        "a": {"noul": 0.91},
        "b": {"choice": "x", "confidence": 0.8, "probabilities": {"x": 0.8, "y": 0.2}},
        "c": {"score": 2.4, "confidence": 0.7, "probabilities": {}, "legend": {}},
    },
    "usage": {"input_tokens": 120, "output_tokens": 0, "cost": 0.000005},
}


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def _nosleep(_s):
        return None
    monkeypatch.setattr(asyncio, "sleep", _nosleep)


def _client(handler) -> DecisionsClient:
    return DecisionsClient(api_key="k", model="typesafe/jev-1.14", url=URL, timeout_seconds=5,
                           http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_request_shape():
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["auth"] = req.headers["authorization"]
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json=OK_BODY)

    qs = {"a": noul("q", true="t", false="f")}
    s = Settings(_env_file=None, OPENROUTER_API_KEY="k")
    asyncio.run(_client(handler).decide("hello", qs))
    assert seen["url"] == s.decisions_url
    assert seen["auth"] == "Bearer k"
    assert seen["body"]["model"] == "typesafe/jev-1.14"
    assert seen["body"]["state"] == "hello"
    assert seen["body"]["questions"] == qs
    assert seen["body"]["provider"] == {"data_collection": "deny"}


def test_parses_answers_and_usage():
    d = asyncio.run(_client(lambda r: httpx.Response(200, json=OK_BODY)).decide("s", {}))
    assert d.p_yes("a") == 0.91
    assert d.choice_of("b") == "x"
    assert d.score_of("c") == 2.4
    assert d.model == "typesafe/jev-1.14-20261014"
    assert d.cost_usd == 0.000005
    assert d.input_tokens == 120


def test_malformed_answer_is_unknown():
    def run(answers):
        body = {**OK_BODY, "answers": answers}
        return asyncio.run(_client(lambda r: httpx.Response(200, json=body)).decide("s", {}))

    d = run({"a": {"noul": "high"}})
    assert d.p_yes("a") is None
    assert d.p_yes("zz") is None
    assert run({"a": {"noul": 1.7}}).p_yes("a") is None
    assert run({"a": {"noul": True}}).p_yes("a") is None


def test_retries_once_then_raises():
    calls = []

    def always_529(req):
        calls.append(1)
        return httpx.Response(529)

    with pytest.raises(DecisionsUnavailable):
        asyncio.run(_client(always_529).decide("s", {}))
    assert len(calls) == 2

    calls2 = []

    def flaky(req):
        calls2.append(1)
        return httpx.Response(429) if len(calls2) == 1 else httpx.Response(200, json=OK_BODY)

    assert asyncio.run(_client(flaky).decide("s", {})).p_yes("a") == 0.91
    assert len(calls2) == 2


def test_400_not_retried():
    calls = []

    def bad(req):
        calls.append(1)
        return httpx.Response(400)

    with pytest.raises(DecisionsUnavailable):
        asyncio.run(_client(bad).decide("s", {}))
    assert len(calls) == 1


def test_timeout_raises_unavailable():
    calls = []

    def boom(req):
        calls.append(1)
        raise httpx.ReadTimeout("slow")

    with pytest.raises(DecisionsUnavailable):
        asyncio.run(_client(boom).decide("s", {}))
    assert len(calls) == 1   # a timeout is never retried


def test_connect_error_still_retried_once():
    calls = []

    def flaky(req):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("reset")
        return httpx.Response(200, json=OK_BODY)

    assert asyncio.run(_client(flaky).decide("s", {})).p_yes("a") == 0.91
    assert len(calls) == 2


class _Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def _breaker_client(handler, clock):
    return DecisionsClient(api_key="k", model="typesafe/jev-1.14", url=URL, timeout_seconds=5,
                           http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), clock=clock)


def test_breaker_opens_after_three_failures_and_fails_fast():
    calls, clock = [], _Clock()

    def bad(req):
        calls.append(1)
        return httpx.Response(400)

    client = _breaker_client(bad, clock)

    async def main():
        for _ in range(3):
            with pytest.raises(DecisionsUnavailable, match="HTTP 400"):
                await client.decide("s", {})
        with pytest.raises(DecisionsUnavailable, match="breaker open"):
            await client.decide("s", {})

    asyncio.run(main())
    assert len(calls) == 3   # the fourth call never reached the endpoint


def test_breaker_closes_after_60s_and_success_resets():
    calls, clock, ok = [], _Clock(), [False]

    def handler(req):
        calls.append(1)
        return httpx.Response(200, json=OK_BODY) if ok[0] else httpx.Response(400)

    client = _breaker_client(handler, clock)

    async def main():
        for _ in range(3):
            with pytest.raises(DecisionsUnavailable):
                await client.decide("s", {})
        clock.now += 59.0
        with pytest.raises(DecisionsUnavailable, match="breaker open"):
            await client.decide("s", {})
        clock.now += 1.5
        ok[0] = True
        assert (await client.decide("s", {})).p_yes("a") == 0.91   # half-open trial succeeds
        ok[0] = False
        for _ in range(2):                                          # the count restarted at zero
            with pytest.raises(DecisionsUnavailable, match="HTTP 400"):
                await client.decide("s", {})

    asyncio.run(main())
    assert len(calls) == 6


def test_oversize_state_does_not_trip_breaker():
    calls, clock = [], _Clock()

    def handler(req):
        calls.append(1)
        return httpx.Response(200, json=OK_BODY)

    client = _breaker_client(handler, clock)

    async def main():
        for _ in range(4):
            with pytest.raises(DecisionsUnavailable, match="state too large"):
                await client.decide("x" * 30_001, {})
        return await client.decide("s", {})

    assert asyncio.run(main()).p_yes("a") == 0.91 and len(calls) == 1


def test_oversize_state_refused_without_request():
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(200, json=OK_BODY)

    with pytest.raises(DecisionsUnavailable):
        asyncio.run(_client(handler).decide("x" * 30_001, {}))
    assert calls == []
    assert dec.state_bytes("x" * 5) == 5
    assert dec.state_bytes({"a": "é"}) == len(json.dumps({"a": "é"}, ensure_ascii=False).encode())


def test_shared_client_none_without_key():
    assert shared_decisions_client(Settings(_env_file=None, OPENROUTER_API_KEY="")) is None


def test_question_builders():
    assert noul("q", true="t", false="f") == {"type": "noul", "instructions": "q", "criteria": {"true": "t", "false": "f"}}
    assert choice("q", {"x": "d"}) == {"type": "choice", "instructions": "q", "criteria": {"x": "d"}}
    assert score("q", ["lo", "hi"]) == {"type": "score", "instructions": "q", "criteria": ["lo", "hi"]}
