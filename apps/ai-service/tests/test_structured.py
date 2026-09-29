"""structured.complete_structured: validate-and-repair loop over the LLM client.

Covers: valid first try, repair-then-valid, never-valid -> LLMError (raw ValidationError must never
escape), client LLMError propagates, and the repair note folding errors back into the prompt.
"""
import asyncio

import pytest
from pydantic import BaseModel

from app.llm.client import LLMError
from app.llm.structured import complete_structured


class _Model(BaseModel):
    name: str
    age: int


class _SeqLLM:
    """Fake LLMClient: complete_json returns queued dicts in order (raises a queued Exception)."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0
        self.seen_users: list[str] = []

    async def complete_json(self, system, user, *, label="llm"):
        self.calls += 1
        self.seen_users.append(user)
        r = self._responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def test_valid_first_try():
    llm = _SeqLLM([{"name": "A", "age": 3}])
    out = asyncio.run(complete_structured(llm, "s", "u", _Model, max_repairs=2, label="t"))
    assert out.name == "A" and out.age == 3
    assert llm.calls == 1


def test_repairs_then_valid():
    llm = _SeqLLM([{"name": "A"}, {"name": "A", "age": 5}])  # 1st missing age -> repaired
    out = asyncio.run(complete_structured(llm, "s", "u", _Model, max_repairs=2, label="t"))
    assert out.age == 5
    assert llm.calls == 2


def test_never_valid_raises_llmerror():
    llm = _SeqLLM([{"x": 1}, {"x": 2}, {"x": 3}])  # always invalid; max_repairs=2 -> 3 attempts
    with pytest.raises(LLMError):
        asyncio.run(complete_structured(llm, "s", "u", _Model, max_repairs=2, label="t"))
    assert llm.calls == 3  # initial + 2 repairs, then give up


def test_zero_repairs_one_attempt():
    llm = _SeqLLM([{"x": 1}])
    with pytest.raises(LLMError):
        asyncio.run(complete_structured(llm, "s", "u", _Model, max_repairs=0, label="t"))
    assert llm.calls == 1


def test_client_llmerror_propagates():
    llm = _SeqLLM([LLMError("transport boom")])
    with pytest.raises(LLMError):
        asyncio.run(complete_structured(llm, "s", "u", _Model, max_repairs=2, label="t"))


def test_repair_note_folds_errors_into_next_prompt():
    llm = _SeqLLM([{"name": "A"}, {"name": "A", "age": 1}])
    asyncio.run(complete_structured(llm, "s", "BASE-PROMPT", _Model, max_repairs=2, label="t"))
    assert llm.seen_users[0] == "BASE-PROMPT"                 # first ask is the raw prompt
    assert "BASE-PROMPT" in llm.seen_users[1]                 # repair keeps the original ask
    assert "schema" in llm.seen_users[1].lower()              # + the corrective instruction
    assert "age" in llm.seen_users[1]                         # names the failing field
