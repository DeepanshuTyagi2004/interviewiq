"""Content models reject thin output and accept a full problem (docs/question-bank.md)."""
import pytest
from pydantic import ValidationError

from app.questions.content.models import (
    BehaviouralContent, DsaContent, GeneratedEnvelope, Inferred, LldContent, SystemDesignContent, validate_content,
)


def full_dsa(**overrides) -> dict:
    base = {
        "statement": "A warehouse stores crates in a row; each crate has a weight. Given the weights and a capacity, " \
                     "return the length of the longest contiguous run of crates whose total weight does not exceed the capacity.",
        "input_format": "weights: list[int], capacity: int",
        "output_format": "int: the longest run length",
        "constraints": ["1 <= len(weights) <= 10^5", "1 <= weights[i], capacity <= 10^9"],
        "examples": [
            {"args": {"weights": [2, 1, 1, 3, 1], "capacity": 4}, "expected": 3, "explanation": "[2, 1, 1] weighs 4 and is the longest run that fits"},
            {"args": {"weights": [5], "capacity": 4}, "expected": 0, "explanation": "No crate fits"},
        ],
        "judge_tests": [{"args": {"weights": [], "capacity": 1}, "expected": 0}, {"args": {"weights": [1, 1], "capacity": 2}, "expected": 2}, {"args": {"weights": [4, 4], "capacity": 4}, "expected": 1},
                        {"args": {"weights": [1, 2, 3, 4, 5], "capacity": 9}, "expected": 3}, {"args": {"weights": [10, 1, 1, 1], "capacity": 3}, "expected": 3}],
        "hints": ["Think about a window.", "Grow the window while the sum fits.", "Shrink from the left when it overflows."],
        "follow_ups": ["What if weights can be negative?"],
        "approaches": [{"name": "Brute force", "idea": "Try every subarray.", "time_complexity": "O(n^2)", "space_complexity": "O(1)"},
                       {"name": "Sliding window", "idea": "Two pointers over a running sum.", "time_complexity": "O(n)", "space_complexity": "O(1)"}],
        "reference_solution": {"language": "python", "entry_point": "longest_run", "code": "def longest_run(weights, capacity):\n    best = left = total = 0\n    for right, w in enumerate(weights):\n        total += w\n        while total > capacity and left <= right:\n            total -= weights[left]; left += 1\n        best = max(best, right - left + 1)\n    return best\n"},
        "brute_force_solution": {"language": "python", "entry_point": "longest_run", "code": "def longest_run(weights, capacity):\n    best = 0\n    for i in range(len(weights)):\n        for j in range(i, len(weights)):\n            if sum(weights[i:j + 1]) <= capacity:\n                best = max(best, j - i + 1)\n    return best\n"},
        "edge_cases": ["empty list"],
        "common_mistakes": ["forgetting to shrink the window"],
        "rubric": [{"criterion": "correctness", "weight": 3, "strong": "handles all edge cases", "weak": "fails on empty input"},
                   {"criterion": "complexity", "weight": 2, "strong": "O(n)", "weak": "O(n^2) only"}],
        "patterns": ["sliding-window"],
        "what_it_tests": "Sliding window over a running sum.",
        "estimated_minutes": 25,
    }
    base.update(overrides)
    return base


def test_dsa_accepts_a_full_problem_and_rejects_thin_output():
    content = validate_content("dsa", full_dsa())
    assert isinstance(content, DsaContent)
    assert len(content.examples) == 2 and content.reference_solution.entry_point == "longest_run"
    with pytest.raises(ValidationError):
        validate_content("dsa", full_dsa(examples=full_dsa()["examples"][:1]))
    with pytest.raises(ValidationError):
        validate_content("dsa", full_dsa(hints=["only one"]))
    # Hidden tests and the brute force are optional in the schema: grounded problems omit them.
    grounded = full_dsa(judge_tests=[], approaches=[], rubric=[]); del grounded["brute_force_solution"], grounded["reference_solution"]
    parsed = validate_content("dsa", grounded)
    assert parsed.brute_force_solution is None and parsed.reference_solution is None and parsed.rubric == []
    with pytest.raises(ValidationError):
        validate_content("dsa", full_dsa(statement="too short"))
    with pytest.raises(ValidationError):
        validate_content("dsa", full_dsa(reference_solution={"entry_point": "not a name", "code": "def f():\n    return 1\n"}))


def test_padding_in_object_lists_is_dropped_and_short_formats_are_fine():
    content = validate_content("dsa", full_dsa(approaches=[*full_dsa()["approaches"], "", None], rubric=[*full_dsa()["rubric"], ""], output_format="bool"))
    assert len(content.approaches) == 2 and len(content.rubric) == 2 and content.output_format == "bool"


def test_online_assessment_shares_the_dsa_shape_and_unknown_rounds_fail():
    assert isinstance(validate_content("online-assessment", full_dsa()), DsaContent)
    with pytest.raises(ValueError):
        validate_content("aptitude", full_dsa())


def test_system_design_lld_and_behavioural_minimums():
    sd = {
        "prompt": "Design a service that shortens URLs and redirects at scale across regions.",
        "clarifying_questions": ["Expected QPS?", "Custom aliases?", "Expiry?"],
        "functional_requirements": ["shorten", "redirect"],
        "non_functional_requirements": ["p99 redirect < 50 ms", "99.99% availability"],
        "scale_assumptions": ["100M new URLs a month"],
        "expected_design": {"components": [{"name": "API", "purpose": "accept requests"}, {"name": "ID generator", "purpose": "unique keys"}, {"name": "KV store", "purpose": "mapping"}],
                            "data_model": "short_key -> long_url, created_at, expires_at in a key-value store", "api_sketch": ["POST /shorten"], "data_flow": "client -> API -> KV -> redirect"},
        "deep_dives": ["ID generation", "hot keys"],
        "trade_offs": [{"decision": "ID scheme", "options": ["hash", "counter"], "recommendation": "counter with base62"}],
        "follow_ups": ["analytics?", "abuse?"],
        "rubric": [{"criterion": "requirements", "strong": "asks first", "weak": "assumes"}, {"criterion": "scale", "strong": "numbers", "weak": "hand-waves"}],
        "strong_answer_summary": "Clarifies, estimates scale, picks a KV store with a base62 counter, discusses caching and hot keys.",
        "what_it_tests": "Scale estimation and storage choices.",
        "estimated_minutes": 45,
    }
    assert isinstance(validate_content("system-design", sd), SystemDesignContent)
    with pytest.raises(ValidationError):
        validate_content("system-design", {**sd, "expected_design": {**sd["expected_design"], "components": sd["expected_design"]["components"][:2]}})
    lld = {
        "prompt": "Design a parking lot with multiple floors, spot sizes and hourly billing.",
        "requirements": ["park", "unpark"], "entities": ["Lot", "Floor", "Spot", "Ticket"],
        "expected_design": {"classes": [{"name": "ParkingLot", "responsibilities": "owns floors"}, {"name": "Spot", "responsibilities": "holds a vehicle"}], "patterns": ["strategy"]},
        "evaluation_mode": "working-code", "follow_ups": ["EV charging?", "Concurrency?"],
        "rubric": [{"criterion": "modelling", "strong": "clean entities", "weak": "god class"}, {"criterion": "extensibility", "strong": "strategy for pricing", "weak": "hard-coded"}],
        "strong_answer_summary": "Clean entities, a pricing strategy, thread-safe allocation and tests.",
        "what_it_tests": "OO modelling.", "estimated_minutes": 60,
    }
    assert validate_content("lld", lld).evaluation_mode == "working-code"
    # Elaborated modes keep the mode they name; a single combined requirement is still a requirement.
    assert validate_content("lld", {**lld, "evaluation_mode": "working-code; candidate implements core classes within 45 minutes"}).evaluation_mode == "working-code"
    assert validate_content("lld", {**lld, "evaluation_mode": "discussion with optional pseudo-code", "requirements": ["park, unpark and bill"]}).evaluation_mode == "discussion"
    beh = {
        "question": "Tell me about a time you disagreed with a senior engineer.",
        "competency": "conflict resolution", "what_it_tests": "Backbone and respect.",
        "star_guide": {"situation": "a real design disagreement", "task": "your stake", "action": "how you argued", "result": "the outcome"},
        "strong_answer_summary": "Specific, data-backed disagreement, respectful escalation, and a measurable result.",
        "weak_answer_summary": "Vague, blames the other person.",
        "follow_up_probes": ["What would you do differently?", "How did the relationship change?"],
        "estimated_minutes": 8,
    }
    assert isinstance(validate_content("hiring-manager", beh), BehaviouralContent)
    assert isinstance(validate_content("behavioural", beh), BehaviouralContent)


def test_envelope_coerces_inferred_lists_and_keeps_content_raw():
    env = GeneratedEnvelope.model_validate({"inferred": {"difficulty": "medium", "company_tags": "amazon", "topic_tags": ["Arrays", ""]}, "content": {"x": 1}})
    assert env.inferred == Inferred(difficulty="medium", company_tags=["amazon"], topic_tags=["Arrays"])
    assert env.content == {"x": 1}
    assert GeneratedEnvelope.model_validate({"content": {}}).inferred.difficulty is None


def test_titles_lose_source_markdown():
    from app.questions.models import QuestionRecord
    rec = lambda t: QuestionRecord(slug="x", round_type="dsa", title=t, url="").title
    assert rec("[211. Design Add and Search Words Data Structure]()") == "211. Design Add and Search Words Data Structure"
    assert rec("[Two Sum](https://leetcode.com/problems/two-sum)") == "Two Sum"
    assert rec("**Merge Intervals**") == "Merge Intervals"
    assert rec("Plain title") == "Plain title"
