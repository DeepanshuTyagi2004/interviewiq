"""Content-generation prompts, one per round family (`docs/question-bank.md`).

PRODUCT IP — drafts for human review. The prompt receives the index facts only (title, round,
difficulty, tags, pattern hints) and never any source text, so every statement is ours. Bump
CONTENT_VERSION when a prompt changes materially: stored content is keyed on it and regenerates.
"""
from __future__ import annotations

import json

from app.models.engineering_levels import ENGINEERING_LEVELS

CONTENT_VERSION = "v3"

CONTENT_SYSTEM = (
    "You write interview problems for an Indian software-engineering interview-practice platform. "
    "You are given the title and tags of a well-known interview question. Write an ORIGINAL problem of "
    "your own that tests the same idea and pattern: new wording, your own scenario, your own numbers. "
    "Never reproduce or paraphrase any published problem statement, examples or constraints. "
    "Be concrete, complete and interview-realistic: a strong interviewer could run the round from "
    "this alone. Respond with VALID JSON ONLY: one object, no markdown, no preamble."
)

_INDEX_FILL = """
"inferred": {
  "difficulty": "<easy|medium|hard, your judgement; use the given one when present>",
  "level_tags": ["<LEVELS where this is typically asked; fill when empty>"],
  "topic_tags": ["<concepts; add to the given ones>"],
  "company_tags": ["<lowercase company slugs where this kind of question is commonly asked, only when the given list is empty or short; may be inferred>"]
}"""

_DSA = """
Return exactly:
{
  INDEX_FILL,
  "content": {
    "statement": "<the full problem, 120+ characters, with a short real-world framing>",
    "input_format": "<parameters and their types>",
    "output_format": "<what to return>",
    "constraints": ["<realistic bounds, e.g. 1 <= n <= 10^5>", "..."],
    "examples": [
      {"args": {"<param>": <JSON value>}, "expected": <JSON value>, "explanation": "<why>"},
      {"args": {"<param>": <JSON value>}, "expected": <JSON value>, "explanation": "<why>"}
    ],
    "judge_tests": [ {"args": {...}, "expected": <your best value>}, ... at least 5 DISTINCT tests including edge cases: empty, single element, duplicates, negative where meaningful, a larger case; outputs must vary (not all true / all the same) ],
    "hints": ["<nudge 1, gentle>", "<hint 2, more explicit>", "<hint 3, almost the approach>"],
    "follow_ups": ["<harder variant or constraint change>", "..."],
    "approaches": [
      {"name": "Brute force", "idea": "...", "time_complexity": "O(...)", "space_complexity": "O(...)"},
      {"name": "<optimal>", "idea": "...", "time_complexity": "O(...)", "space_complexity": "O(...)"}
    ],
    "reference_solution": {"language": "python", "entry_point": "<function name>", "code": "<the optimal solution: complete Python 3.11 code defining that function; stdlib only; no input(), print() or I/O; deterministic>"},
    "brute_force_solution": {"language": "python", "entry_point": "<the SAME function name>", "code": "<an INDEPENDENT, simple, obviously-correct brute-force implementation with the same signature (not a copy of the optimal one: different algorithm, e.g. try every case)>"},
    "edge_cases": ["..."],
    "common_mistakes": ["..."],
    "rubric": [{"criterion": "<e.g. correctness>", "weight": 3, "strong": "<what a strong answer shows>", "weak": "<what a weak one shows>"}, ... 3 or more],
    "patterns": ["<e.g. two-pointers, sliding-window>"],
    "what_it_tests": "<one sentence>",
    "answer_order_irrelevant": <true only if the statement accepts the answer in any order>,
    "estimated_minutes": <int>
  }
}
Rules: BOTH solutions will be executed on every example and test, and every expected value will be compared with their output; they must agree. Hand-trace each example before writing it; the explanation must describe the real output, step by step. Example 1 must be non-trivial: its expected output must NOT equal its input. Two examples must use different inputs. For problems whose natural form is a class with methods (design a data structure, LRU cache, trie, iterator), use the call-sequence form: a single function `run(operations: list[str], arguments: list[list])` that applies each operation in order to a fresh object and returns the list of each operation's return value (null for operations that return nothing), and write the examples in that form too. `args` keys MUST match the entry point's parameter names exactly; every `expected` MUST be the
value that function returns for those args (use the same JSON types: lists for arrays, strings, ints,
booleans, null); results must not depend on dict ordering or randomness; keep examples small enough to
read in an interview.
"""

_DSA_GROUNDED = """
Return exactly this JSON (nothing else):
{
  INDEX_FILL,
  "content": {
    "statement": "<the problem reworded in your own words, a short real-world framing allowed, 120+ characters>",
    "input_format": "<parameters and types, using the given parameter names>",
    "output_format": "<what to return>",
    "constraints": ["<bounds, equivalent to the reference statement>"],
    "examples": [{"explanation": "<your own step-by-step walkthrough of example 1>"}, {"explanation": "<same for example 2>"}],
    "hints": ["<gentle nudge>", "<more explicit>", "<almost the approach>"],
    "follow_ups": ["<harder variant>", "<constraint change>"],
    "edge_cases": ["..."],
    "common_mistakes": ["..."],
    "patterns": ["<e.g. two-pointers>"],
    "what_it_tests": "<one sentence>",
    "answer_order_irrelevant": <true only if the statement accepts the answer in any order>,
    "estimated_minutes": <int>
  }
}
"""

_SYSTEM_DESIGN = """
Return exactly:
{
  INDEX_FILL,
  "content": {
    "prompt": "<the design question as an interviewer would pose it, 40+ characters>",
    "clarifying_questions": ["<question a strong candidate asks first>", "...", "..."],
    "functional_requirements": ["...", "..."],
    "non_functional_requirements": ["<latency, availability, consistency, durability targets>", "..."],
    "scale_assumptions": ["<users, QPS, data size, growth>", "..."],
    "expected_design": {
      "components": [{"name": "<component>", "purpose": "<why it exists>"}, ... 3 or more],
      "data_model": "<key entities, keys, storage choice and why>",
      "api_sketch": ["<METHOD /path — purpose>", "..."],
      "data_flow": "<the main request path end to end>"
    },
    "deep_dives": ["<area the interviewer will push on>", "..."],
    "trade_offs": [{"decision": "...", "options": ["...", "..."], "recommendation": "..."}],
    "follow_ups": ["<scale 10x / failure / new feature>", "..."],
    "rubric": [{"criterion": "...", "weight": 3, "strong": "...", "weak": "..."}, ... 3 or more],
    "red_flags": ["..."],
    "strong_answer_summary": "<what a strong 45-minute answer covers, 40+ characters>",
    "what_it_tests": "<one sentence>",
    "estimated_minutes": <int>
  }
}
"""

_LLD = """
Return exactly:
{
  INDEX_FILL,
  "content": {
    "prompt": "<the design/machine-coding task as posed, 40+ characters>",
    "requirements": ["...", "..."],
    "entities": ["<core domain entities>", "..."],
    "expected_design": {
      "classes": [{"name": "...", "responsibilities": "...", "key_methods": ["..."]}, ... 2 or more],
      "relationships": ["<A has many B; C implements D>", "..."],
      "patterns": ["<strategy, observer, factory...>"]
    },
    "sample_api": ["<method signatures or endpoints a solution exposes>"],
    "evaluation_mode": "<working-code if a timed implementation is expected, else discussion>",
    "follow_ups": ["<extensibility question>", "<concurrency / scale question>"],
    "rubric": [{"criterion": "...", "weight": 3, "strong": "...", "weak": "..."}, ... 3 or more],
    "red_flags": ["..."],
    "strong_answer_summary": "<what a strong answer looks like, 40+ characters>",
    "what_it_tests": "<one sentence>",
    "estimated_minutes": <int>
  }
}
"""

_BEHAVIOURAL = """
Return exactly:
{
  INDEX_FILL,
  "content": {
    "question": "<the question as the interviewer asks it>",
    "competency": "<e.g. ownership, conflict resolution, customer focus>",
    "what_it_tests": "<one sentence>",
    "star_guide": {"situation": "<what a good Situation includes>", "task": "...", "action": "...", "result": "..."},
    "strong_answer_summary": "<what a strong answer sounds like, 30+ characters>",
    "weak_answer_summary": "<what a weak answer sounds like>",
    "follow_up_probes": ["<probe to go deeper or test honesty>", "..."],
    "red_flags": ["..."],
    "principle": "<the company principle or value this maps to, or null>",
    "deep_dive_guidance": "<for hiring-manager rounds: how to run a project deep-dive on this answer, else null>",
    "estimated_minutes": <int>
  }
}
"""

_SCHEMAS = {
    "dsa": _DSA, "online-assessment": _DSA,
    "system-design": _SYSTEM_DESIGN,
    "lld": _LLD,
    "behavioural": _BEHAVIOURAL, "hiring-manager": _BEHAVIOURAL,
}

# Index fields the prompt may see. Never `url`, never any fetched text.
_CONTEXT_FIELDS = ("title", "round_type", "difficulty", "topic_tags", "company_tags", "level_tags", "category",
                   "patterns_tested", "components_tested", "entities_involved", "domain", "evaluation_mode", "is_machine_coding")


def _source_section(source) -> str:
    """The reference statement for a source-grounded problem. `source` is a SourceStatement."""
    names = ", ".join(next(iter(source.examples)).args)
    shown = "\n".join(f"  Example {i + 1}: " + ", ".join(f"{k} = {json.dumps(v)}" for k, v in e.args.items()) + f" -> {json.dumps(e.expected)}" for i, e in enumerate(source.examples))
    return (
        "\n\nREFERENCE STATEMENT (a real, validated version of this problem):\n" + source.description[:3500]
        + "\n\nWrite the problem in your OWN words: reword the statement, keep it exactly equivalent in meaning, constraints and "
          "answer format; you may change the story and names. Use these exact parameter names for the function: " + names
        + ". The two worked examples are fixed ground truth and will be used as given (do not change their values); write your own "
          "step-by-step explanation for each, in the same order:\n" + shown
        + "\nSolutions and answer analysis are produced later, so OMIT `reference_solution` and `brute_force_solution` and do not include "
          "`judge_tests`, `approaches` or `rubric`. The example values are supplied; return only each example's explanation."
    )


def build_content_prompt(record: dict, source=None) -> str:
    round_type = str(record.get("round_type") or "dsa")
    schema = (_DSA_GROUNDED if source is not None else _SCHEMAS.get(round_type, _DSA)).replace("INDEX_FILL", _INDEX_FILL.strip()).replace("LEVELS", "|".join(ENGINEERING_LEVELS))
    context = {k: record.get(k) for k in _CONTEXT_FIELDS if record.get(k) not in (None, "", [])}
    hint = {
        "dsa": "Write a coding problem testing this pattern.",
        "online-assessment": "Write a coding problem testing this pattern, suitable for a timed online test.",
        "system-design": "Write a high-level system design question around this system. Keep the exact system the "
                         "title names as the thing to design (a chat app stays a chat app): your own "
                         "requirements, numbers and wording.",
        "lld": "Write a low-level design / machine-coding task around this. Keep the exact system the title names as the "
               "thing to design (a vending machine stays a vending machine, a parking lot stays a parking lot): your "
               "own requirements, numbers and wording.",
        "behavioural": "Expand this behavioural question with everything an interviewer needs to run and judge it.",
        "hiring-manager": "Expand this hiring-manager question with everything a hiring manager needs to run and judge it, including a project deep-dive.",
    }.get(round_type, "")
    return (
        f"Known question (index facts only):\n{json.dumps(context, ensure_ascii=False, indent=2)}\n\n"
        f"{hint}\n{schema}" + (_source_section(source) if source is not None else "")
    )


def build_repair_prompt(record: dict, previous: dict, issues: list[str], source=None) -> str:
    """Second-chance prompt: the exact failures of the last attempt, asking for the full corrected JSON."""
    listing = "\n".join(f"- {i}" for i in issues[:12])
    return (
        build_content_prompt(record, source)
        + "\n\nYour previous attempt (JSON) was executed and failed these checks:\n" + listing
        + "\n\nPrevious attempt:\n" + json.dumps(previous, ensure_ascii=False)[:14000]
        + "\n\nReturn the COMPLETE corrected JSON in the same format. Re-derive each failing example by hand against the "
          "solutions' real behaviour; fix whichever of solution, example or test is wrong, and rewrite explanations to match the real outputs."
    )
