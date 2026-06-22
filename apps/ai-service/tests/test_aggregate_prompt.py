"""Run: python -m tests.test_aggregate_prompt"""
from app.prompts.aggregate_experience import build_aggregate_prompt, AGGREGATE_SYSTEM
from app.templates.skeletons import skeleton_for


def test_prompt_states_provenance_template_and_coverage_rules():
    sk = skeleton_for("software-engineer", "fresher")
    p = build_aggregate_prompt(
        "razorpay/software-engineer/fresher/backend",
        '[{"rounds":[],"match_tier":"exact"}]', sk)
    low = (p + AGGREGATE_SYSTEM).lower()
    assert "evidence_backed" in low and "inferred_from_similar" in low and "template" in low
    assert "india" in low
    assert "never invent" in low or "do not invent" in low
    assert "standard loop" in low                 # skeleton-coverage instruction present
    assert "razorpay/software-engineer/fresher/backend" in p
    assert "online-assessment" in p               # the skeleton was embedded


if __name__ == "__main__":
    test_prompt_states_provenance_template_and_coverage_rules()
    print("ok")
