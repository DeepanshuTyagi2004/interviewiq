"""Answer-key review gate: does this DSA answer key contain a factual error worth a reviewer pass?"""
from __future__ import annotations

import copy
import json

from app.llm.decisions import noul

MAX_KEY_CHARS = 7000

REVIEW_QUESTIONS: dict = {
    "has_error": noul(
        "`answer_key` contains a factual error about `problem`: a wrong time or space complexity, a "
        "false insight or wrong path, or an edge case that contradicts the statement or constraints.",
        true="`answer_key` contains a factual error about `problem`: a wrong time or space complexity, "
             "a false insight or wrong path, or an edge case that contradicts the statement or constraints.",
        false="`answer_key` is factually consistent with `problem`: complexities, insights, wrong paths "
              "and edge cases all hold.",
    ),
}


def key_state(problem: dict, key: dict) -> dict:
    c = problem.get("content") or {}
    facts = {"title": problem.get("title"), "statement": c.get("statement"), "input_format": c.get("input_format"),
             "output_format": c.get("output_format"), "constraints": c.get("constraints")}
    shown = copy.deepcopy(key)
    solution = shown.get("reference_solution")
    if isinstance(solution, dict) and "code" in solution:
        solution["code"] = "<verified by sandbox>"   # the sandbox already ran it against the examples
    return {"problem": facts, "answer_key": json.dumps(shown, ensure_ascii=False, default=str)[:MAX_KEY_CHARS]}
