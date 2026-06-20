"""Run: python -m tests.test_aggregate_prompt"""
from app.prompts.aggregate_experience import build_aggregate_prompt, AGGREGATE_SYSTEM


def test_prompt_states_provenance_and_fallback_rules():
    p = build_aggregate_prompt("razorpay/software-engineer/fresher/backend", '[{"rounds":[]}]')
    low = (p + AGGREGATE_SYSTEM).lower()
    assert "evidence_backed" in low and "inferred" in low
    assert "india" in low
    assert "never invent" in low or "do not invent" in low
    assert "razorpay/software-engineer/fresher/backend" in p


if __name__ == "__main__":
    test_prompt_states_provenance_and_fallback_rules()
    print("ok")
