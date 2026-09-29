"""Run: python -m tests.test_extract_prompt"""
from app.prompts.extract_source import build_extract_prompt, EXTRACT_SYSTEM


def test_prompt_contains_source_and_rules():
    src = {"title": "My Razorpay interview", "url": "https://x.com/1",
           "content": "Round 1 DSA...", "date": "2025-02-01"}
    p = build_extract_prompt("razorpay/software-engineer/sde2/backend", src)
    assert "https://x.com/1" in p
    assert "Round 1 DSA" in p
    assert "null" in p.lower()           # instructs to return null when not an interview post
    assert "geo" in p.lower()
    assert "evaluat" not in EXTRACT_SYSTEM.lower()  # descriptive, never evaluative


if __name__ == "__main__":
    test_prompt_contains_source_and_rules()
    print("ok")
