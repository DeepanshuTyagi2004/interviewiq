"""The persona candidate: a model's JSON replies become simulator script lines, capped, with the resume in its prompt."""
import asyncio
import json
from pathlib import Path

from app.interviewer.persona import PERSONA_SCHEMA, PersonaCandidate, resume_text

SPEC = {"id": "p", "first_name": "Sneha", "behaviour": "BEHAVIOUR TEXT", "coding": "CODING TEXT", "max_candidate_turns": 3}
PROFILE = {"headline": "Backend engineer", "skills": ["Go", "Postgres"], "projects": [{"name": "Split-bill app", "summary": "settles balances"}],
           "education": [{"institution": "NIT Kurukshetra", "degree": "B.Tech", "field": "CSE", "year": "2024"}]}
VIEW = {"transcript": ["INTERVIEWER: Hi, I'm Siddharth.", "CANDIDATE: Hello."], "on_screen": "Given an array nums", "code": "", "clock_s": 40.0, "item": "core-1"}


class ReplyChat:
    model = "fake-candidate"

    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append((messages, schema_name, schema))
        return self.replies.pop(0), {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost": 0.001}


def reply(**kw):
    return {"say": "", "code": None, "wait_s": 0, "select_text": None, "end": False, **kw}


def test_a_reply_becomes_wait_select_code_then_the_spoken_line_in_that_order():
    chat = ReplyChat([reply(say="What does this mean?", code="x = 1\nprint(x)", wait_s=120, select_text="an array nums")])
    lines = asyncio.run(PersonaCandidate(SPEC, chat, resume_text(PROFILE)).next_lines(VIEW))
    assert lines == ["#wait 120", "#at -1 select panel an array nums", "#code x = 1\\nprint(x)", "What does this mean?"]


def test_silence_has_no_spoken_line_and_wait_is_clamped_and_end_means_end():
    chat = ReplyChat([reply(wait_s=900, code="a"), reply(say="Thanks, bye.", end=True)])
    persona = PersonaCandidate(SPEC, chat, "")
    assert asyncio.run(persona.next_lines(VIEW)) == ["#wait 300", "#code a"]
    assert asyncio.run(persona.next_lines(VIEW)) == ["Thanks, bye.", "#end"]


def test_it_ends_after_the_turn_cap_without_calling_the_model_again():
    chat = ReplyChat([reply(say="one"), reply(say="two"), reply(say="three")])
    persona = PersonaCandidate(SPEC, chat, "")
    for _ in range(3):
        asyncio.run(persona.next_lines(VIEW))
    assert asyncio.run(persona.next_lines(VIEW)) == ["#end"] and len(chat.calls) == 3


def test_the_prompt_has_behaviour_coding_resume_and_what_the_candidate_can_see_and_the_cost_is_summed():
    chat = ReplyChat([reply(say="hi"), reply(say="again")])
    persona = PersonaCandidate(SPEC, chat, resume_text(PROFILE))
    asyncio.run(persona.next_lines(VIEW))
    asyncio.run(persona.next_lines(VIEW))
    messages, name, schema = chat.calls[0]
    system = messages[0]["content"]
    assert system.index("BEHAVIOUR TEXT") < system.index("CODING TEXT") < system.index("Split-bill app")
    for word in ("Backend engineer", "Go", "Postgres", "settles balances", "NIT Kurukshetra"):
        assert word in system
    seen = messages[-1]["content"]
    assert "INTERVIEWER: Hi, I'm Siddharth." in seen and "Given an array nums" in seen
    assert schema is PERSONA_SCHEMA and set(schema["properties"]) == {"say", "code", "wait_s", "select_text", "end"}
    assert persona.usage["cost"] == 0.002 and persona.usage["total_tokens"] == 30


def test_a_model_failure_ends_the_round_after_one_retry():
    from app.interviewer.llm import LLMUnavailable

    class Down(ReplyChat):
        async def json(self, *a, **k):
            self.calls.append(1)
            raise LLMUnavailable("down")
    chat = Down([])
    assert asyncio.run(PersonaCandidate(SPEC, chat, "").next_lines(VIEW)) == ["#end"] and len(chat.calls) == 2


def test_silences_and_selections_are_remembered_for_the_checks():
    chat = ReplyChat([reply(say="this?", wait_s=100, code="a", select_text="nums")])
    persona = PersonaCandidate(SPEC, chat, "")
    asyncio.run(persona.next_lines(VIEW))
    assert persona.silences == [{"start": 40.0, "wait_s": 100, "code": True}] and persona.selections == [{"at": 140.0, "text": "nums"}]


def test_every_shipped_spec_has_the_fields_the_runner_needs():
    specs = sorted((Path(__file__).parents[2] / "scripts" / "flow_scenarios" / "personas").glob("*.json"))
    assert len(specs) == 10
    for path in specs:
        spec = json.loads(path.read_text())
        assert {"id", "first_name", "session", "shape", "behaviour", "coding", "max_candidate_turns", "expect"} <= set(spec)
