import asyncio

import app.interview_agent.llm_ops as ops
from app.interview_agent.types import Artifact, ArtifactKind
from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.prompts.grade import build_grade_prompt
from app.config import get_settings


def test_artifact_constructs():
    a = Artifact(kind=ArtifactKind.CODE, content="def f(): pass", language="python")
    assert a.kind == ArtifactKind.CODE and a.language == "python"


def test_scripted_transport_serves_artifact():
    a = Artifact(kind=ArtifactKind.CODE, content="x = 1", language="python")
    t = ScriptedTransport(script=[], artifact=a)
    assert asyncio.run(t.current_artifact()) is a


def test_grade_prompt_includes_artifact_code():
    p = build_grade_prompt([{"criterion": "correctness", "weight": 1.0}], "two sum", "use a map",
                           artifact=Artifact(kind=ArtifactKind.CODE, content="d={}; return d", language="python"))
    assert "d={}" in p and "python" in p


def test_grade_answer_passes_artifact_into_prompt(monkeypatch):
    captured = {}
    async def fake(llm, system, user, response_model, *, max_repairs, label):
        captured["user"] = user
        return response_model.model_validate({"criteria": [{"criterion": "correctness", "score": 0.9}],
                                              "coherence": 0.8})
    monkeypatch.setattr(ops, "complete_structured", fake)
    art = Artifact(kind=ArtifactKind.CODE, content="return sorted(nums)", language="python")
    comp, coh = asyncio.run(ops.grade_answer(llm=None, settings=get_settings(),
                                             rubric=[{"criterion": "correctness", "weight": 1.0}],
                                             question="sort", answer="I sort it", artifact=art))
    assert "return sorted(nums)" in captured["user"]
    assert comp == 0.9
