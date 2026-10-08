"""Shared fixtures for the blueprint tests: a request, bank docs and a fake LLM."""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from app.blueprint.models import BlueprintRunRequest
from app.blueprint.vocabulary import PINNED_ACTIONS


def request(round_type: str = "dsa", **overrides) -> BlueprintRunRequest:
    data = {
        "session": {"session_id": "s1", "candidate_id": "c1", "company": "Amazon", "role": "SDE", "level": "sde1",
                    "round_type": round_type},
        "job_description": {"title": "SDE I", "description": "Backend services for payments with Java.", "tech_stack": "Java"},
        "round": {"type": round_type, "duration_mins": 45, "topics": ["arrays", "graphs"], "problems": ["Two Sum"],
                  "difficulty": "medium"},
        "company_brief": {"dominant_topics": ["dynamic programming"], "interviewer_style_notes": "friendly"},
        "candidate_profile": {"level": "sde1", "skills": ["Java"],
                              "projects": [{"name": "Split app", "stack": ["Spring"], "summary": "Splits bills"}]},
        "exclusions": [],
        "trigger": "booking",
    }
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(data.get(key), dict):
            data[key] = {**data[key], **value}
        else:
            data[key] = value
    return BlueprintRunRequest.model_validate(data)


def dsa_doc(slug: str, *, difficulty: str = "medium", tags=("Array",), companies=("amazon",), evidence=None,
            level_tags=("sde1",), title: str | None = None) -> dict:
    return {
        "slug": slug, "round_type": "dsa", "title": title or slug.replace("-", " ").title(), "difficulty": difficulty,
        "topic_tags": list(tags), "company_tags": list(companies), "company_evidence": evidence or {},
        "level_tags": list(level_tags), "content_status": "verified", "content_hash": f"h-{slug}",
        "content": {"statement": "x" * 130, "examples": [{"args": {"nums": [1, 2]}, "expected": 3, "explanation": "sum"},
                                                         {"args": {"nums": [2, 2]}, "expected": 4, "explanation": "sum"}],
                    "answer_order_irrelevant": False},
    }


def behavioural_doc(slug: str, category: str, companies=()) -> dict:
    return {"slug": slug, "round_type": "behavioural", "title": slug, "category": category, "difficulty": None,
            "topic_tags": [], "company_tags": list(companies), "company_evidence": {}, "level_tags": [],
            "content_status": "generated", "content_hash": f"h-{slug}",
            "content": {"question": f"Tell me about {slug}", "strong_answer_summary": "A specific story with results.",
                        "star_guide": {"situation": "s", "task": "t", "action": "a", "result": "r"}}}


@dataclass
class FakeResult:
    data: dict
    content: str = ""
    usage: dict = field(default_factory=dict)
    latency_ms: int = 1
    attempts: int = 1
    model: str = "fake-model"
    provider: str = "fake"


class FakeLLM:
    """Answers by label prefix; a list answer is consumed one reply per call."""

    def __init__(self, replies: dict):
        self.replies = replies
        self.calls: list[tuple[str, str]] = []

    async def complete_full(self, system: str, user: str, *, label: str = "") -> FakeResult:
        self.calls.append((label, user))
        for prefix, reply in self.replies.items():
            if label.startswith(prefix):
                if isinstance(reply, list):
                    reply = reply.pop(0) if len(reply) > 1 else reply[0]
                if isinstance(reply, Exception):
                    raise reply
                return FakeResult(data=reply, content=json.dumps(reply))
        raise AssertionError(f"no fake reply for {label}")

    async def aclose(self) -> None:
        pass


class MemoryTrace:
    """A RunTrace stand-in that never touches Mongo."""

    def __init__(self):
        from app.blueprint.trace import RunTrace
        self.inner = RunTrace("run-test")
        self.records: list[dict] = []

    def llm(self, stage: str, record: dict) -> None:
        self.records.append({"stage": stage, **record})

    def note(self, stage: str, **detail) -> None:
        pass


def playbook_reply(conditions) -> dict:
    return {
        "ask": {"opening": "Let's look at this problem together.", "clarifications": [{"question": "Range?", "answer": "1..10^5"}]},
        "hint_ladder": [{"step": 1, "hint": "Think about it"}, {"step": 2, "hint": "Use a map"}, {"step": 3, "hint": "Store complements"}],
        "branches": [{"condition": c, "action": PINNED_ACTIONS.get(c, "encourage"), "say": "Keep going", "notes": ""}
                     for c in conditions],
        "probes": ["Why a map?"], "follow_ups": ["Sorted input?"],
        "expectations": {"must_show": ["correct approach"], "strong_signals": ["fast"], "weak_signals": ["slow"]},
        "evaluation_signals": [{"signal": "clarity", "observe": "explains clearly"}],
    }


def dsa_key_reply(code: str = "def solve(nums):\n    return sum(nums)\n") -> dict:
    return {
        "approaches": [{"name": "Brute force", "idea": "try every pair of values", "time_complexity": "O(n^2)", "space_complexity": "O(1)"},
                       {"name": "Sum", "idea": "add all the values together", "time_complexity": "O(n)", "space_complexity": "O(1)"}],
        "complexity_target": "O(n) time",
        "key_insights": ["The answer is the total", "One pass suffices"],
        "common_wrong_paths": [{"path": "Sorting first", "why_wrong": "unnecessary work", "nudge": "Do you need order?"},
                               {"path": "Nested loops", "why_wrong": "too slow here", "nudge": "Can one pass do it?"}],
        "edge_cases": ["empty", "single element"],
        "reference_solution": {"language": "python", "entry_point": "solve", "code": code},
    }
