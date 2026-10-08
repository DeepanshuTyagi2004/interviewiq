"""The <thought> capture seam's pure contract: extract_thought (fed by client.complete).
Plain sync tests (no asyncio_mode in this repo)."""
from app.llm.client import extract_thought


def test_extract_thought_pulls_think_block():
    assert extract_thought("<thought>reasoning here</thought>{\"x\":1}") == "reasoning here"
    assert extract_thought("no blocks") == ""
