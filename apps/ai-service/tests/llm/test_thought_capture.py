"""S2-1: the <thought> capture seam's pure contract — extract_thought.

The end-to-end "op → step.thought" path is covered by the emitter test in
tests/interview_agent/test_diagnostics_emit.py (record_thought attaches by base label) plus a
driver assertion added in S2-2. This file pins only the pure extract_thought helper that
client.complete feeds into record_thought. Plain sync tests (no asyncio_mode in this repo)."""
from app.llm.client import extract_thought


def test_extract_thought_pulls_think_block():
    assert extract_thought("<thought>reasoning here</thought>{\"x\":1}") == "reasoning here"
    assert extract_thought("no blocks") == ""
