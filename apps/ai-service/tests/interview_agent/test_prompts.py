from app.interview_agent.prompts import classify, grade, pacing_judge, converse, derive, opening_classify


def test_all_modules_have_version_and_system():
    for m in (classify, grade, pacing_judge, converse, derive, opening_classify):
        ver = next(getattr(m, a) for a in dir(m) if a.endswith("_PROMPT_VERSION"))
        sysp = next(getattr(m, a) for a in dir(m) if a.endswith("_SYSTEM"))
        assert isinstance(ver, str) and ver
        assert isinstance(sysp, str) and len(sysp) > 20


def test_build_functions_return_nonempty():
    assert classify.build_classify_prompt("This is a DSA round.", "two-sum: solve two sum", "I use a hashmap")
    assert grade.build_grade_prompt([{"criterion": "correctness", "weight": 1.0}], "solve two sum", "use a map")
    assert pacing_judge.build_pacing_judgment_prompt("may_wind_down", 0.3, "candidate struggled on 2 questions")
    assert converse.build_turn_prompt("ask_base", {"name": "Ada"}, {"basePrompt": "solve"}, [], {})
    assert derive.build_derive_prompt("dsa", "dynamic programming", "company: google; round: dsa")
    assert opening_classify.build_opening_classify_prompt("what's the format going to look like?")


def test_converse_system_carries_spoken_style():
    assert "SPEAKING STYLE" in converse.CONVERSE_SYSTEM


def test_converse_system_acknowledges_last_turn_then_transitions():
    lower = converse.CONVERSE_SYSTEM.lower()
    assert "acknowledge" in lower or "react" in lower
    assert "recent turns" in lower or "transcript_tail" in lower
    assert "transition" in lower
    assert "current item" in lower


def test_converse_system_clarify_never_reveals_solution():
    lower = converse.CONVERSE_SYSTEM.lower()
    assert "answer_clarify" in lower
    assert "never reveal" in lower
    assert "approach" in lower and "algorithm" in lower


def test_converse_system_covers_opening_and_rapport_actions():
    lower = converse.CONVERSE_SYSTEM.lower()
    for action in ("greet", "rapport", "orient", "answer_opening"):
        assert action in lower
    assert "profile" in lower  # RAPPORT grounded in candidate profile when present


def test_converse_system_handles_new_actions_via_build_turn_prompt():
    for action in ("greet", "rapport", "orient", "answer_opening"):
        prompt = converse.build_turn_prompt(action, {"name": "Ada"}, {"basePrompt": "solve"}, [], {})
        assert f"ACTION: {action}" in prompt


def test_converse_system_retains_existing_guidance():
    lower = converse.CONVERSE_SYSTEM.lower()
    assert "rubric" in lower and "scor" in lower
    assert "single" in lower
    assert "wind-down" in lower
    assert "refus" in lower and "steer back" in lower


def test_converse_prompt_version_bumped():
    assert converse.CONVERSE_PROMPT_VERSION != "v0-scaffold"
    assert "conversational" in converse.CONVERSE_PROMPT_VERSION
