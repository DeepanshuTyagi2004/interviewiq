import asyncio

import app.interview_prep.generate as gen
from app.interview_prep.schema import ReserveSet, QuestionLadder
from app.config import get_settings


def test_reserve_prompt_builds():
    from app.interview_prep.prompts import reserve as r
    assert r.RESERVE_PROMPT_VERSION
    assert "SPEAKING STYLE" in r.RESERVE_SYSTEM
    assert r.build_reserve_prompt({"company": "razorpay"}, n=2)


def test_generate_reserve_returns_ladders(monkeypatch):
    async def fake_structured(llm, system, user, response_model, *, max_repairs, label):
        return response_model.model_validate({"ladders": [{"base_prompt": "hard bonus q"}]})
    monkeypatch.setattr(gen, "complete_structured", fake_structured)

    class _Ctx:
        round_type = "dsa"
        grounding = {"company": "razorpay"}
        questions = []
    reserve = asyncio.run(gen._reserve(llm=None, ctx=_Ctx(), settings=get_settings()))
    assert isinstance(reserve, ReserveSet)
    assert reserve.ladders[0].base_prompt == "hard bonus q"
