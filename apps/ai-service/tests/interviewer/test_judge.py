"""The transcript judge: the prompt names the six dimensions and sees only the transcript; a reply parses into a table row."""
import asyncio

from app.interviewer.judge import DIMENSIONS, judge_record, table_row
from app.interviewer.judge_prompt import JUDGE_PROMPT, judge_messages, transcript_lines

RECORD = {"persona": "drifter", "round_type": "dsa", "turns": [
    {"speaker": "interviewer", "seq": 1, "text": "Hi, I'm Siddharth.", "tool_calls": [{"name": "secret_tool"}], "orders": [{"kind": "internal_order"}]},
    {"speaker": "candidate", "seq": 2, "text": "Hello!"}, {"speaker": "interviewer", "seq": 3, "text": ""}]}


def verdict(score=4):
    return ({**{d: {"score": score, "evidence": f"quote for {d}"} for d in DIMENSIONS}, "overall": score,
             "worst_moment": {"quote": "Hi.", "why": "flat"}}, {"cost": 0.01})


class JudgeChat:
    model = "fake-judge"

    def __init__(self):
        self.calls = []

    async def json(self, messages, schema_name, schema, max_tokens=3000):
        self.calls.append(messages)
        return verdict()


def test_the_prompt_names_the_six_dimensions_and_the_overall_score():
    assert DIMENSIONS == ("realism", "follows_candidate", "flow", "problem_handling", "tone", "integrity")
    for d in DIMENSIONS:
        assert d in JUDGE_PROMPT
    assert "overall" in JUDGE_PROMPT and "worst_moment" in JUDGE_PROMPT and "Indian product company" in JUDGE_PROMPT


def test_the_judge_sees_only_transcript_lines_the_round_type_and_that_the_candidate_was_simulated():
    assert transcript_lines(RECORD) == ["INTERVIEWER: Hi, I'm Siddharth.", "CANDIDATE: Hello!"]
    text = " ".join(m["content"] for m in judge_messages(RECORD))
    assert "INTERVIEWER: Hi, I'm Siddharth." in text and "dsa" in text and "simulated" in text
    assert "secret_tool" not in text and "internal_order" not in text
    assert "simulated" not in " ".join(m["content"] for m in judge_messages({**RECORD, "persona": None}))


def test_a_judge_reply_becomes_a_row_with_scores_and_the_worst_moment():
    chat = JudgeChat()
    result = asyncio.run(judge_record(chat, RECORD))
    assert result["overall"] == 4 and result["realism"]["score"] == 4 and result["usage"] == {"cost": 0.01}
    row = table_row("drifter", result)
    assert row[0] == "drifter" and row[1:7] == [4] * 6 and row[7] == 4 and "flat" in row[8]
