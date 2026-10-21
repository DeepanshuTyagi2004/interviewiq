"""Skill areas, weights and band anchors per round-type family (spec §7.4, §7.5, §7.6).
Weights are versioned: every stored report carries EVAL_WEIGHTS_VERSION so it can be recomputed."""
from __future__ import annotations

from dataclasses import dataclass, replace

EVAL_WEIGHTS_VERSION = "w1"
EVAL_VERSION = "eval1"


@dataclass(frozen=True)
class Area:
    key: str
    label: str
    weight: int
    practical: bool
    anchors: str


def _bands(b10: str, b78: str, b56: str, b34: str, b12: str) -> str:
    return f"9-10 {b10} · 7-8 {b78} · 5-6 {b56} · 3-4 {b34} · 1-2 {b12}"


_COMM = (
    "Clarity, thinking aloud, receptiveness to hints, composure and delivery, read from words and timing only; "
    "never judge accent, grammar or English fluency. "
    + _bands(
        "clear and structured, thinks aloud, takes hints well, composed",
        "mostly clear, small lapses in structure or aloud-thinking",
        "understandable but rambling or silent for long stretches",
        "hard to follow, ignores hints",
        "no usable communication",
    )
)

_CODE_CORRECTNESS = (
    "10 Logic correct on all examples and edge cases · 8 Examples correct, one edge case wrong · "
    "6-7 Logic correct, syntax slips (cost depends on code standard) · "
    "4-5 Partly works: main idea right, a key case fails · 2-3 Attempted, wrong approach · 1 Nothing usable"
)

FAMILIES: dict[str, tuple[Area, ...]] = {
    "dsa": (
        Area("understanding", "Understanding & clarifying", 10, False, _bands(
            "restated the problem and asked sharp clarifying questions",
            "understood it, one useful question missed",
            "understood the gist, skipped clarifying",
            "misread part of the problem",
            "misunderstood the problem")),
        Area("approach", "Approach & optimisation", 25, True, _bands(
            "reached the optimal approach with sound reasoning",
            "good approach, optimised with a nudge",
            "brute force found, optimisation not reached",
            "approach mostly flawed or guessed",
            "no workable approach")),
        Area("code_correctness", "Code correctness", 25, True, _CODE_CORRECTNESS),
        Area("code_quality", "Code quality", 10, True, _bands(
            "clean, well-named, well-structured code",
            "readable, minor naming or structure issues",
            "works but messy or repetitive",
            "hard to read, poor structure",
            "no usable code")),
        Area("testing", "Testing & edge cases", 10, True, _bands(
            "dry-ran examples and named the key edge cases unprompted",
            "tested examples, most edge cases found",
            "tested only when prompted, some edge cases missed",
            "token testing, key edge cases missed",
            "no testing")),
        Area("complexity", "Complexity analysis", 10, False, _bands(
            "correct time and space, justified",
            "correct with a minor slip",
            "one of time or space right",
            "mostly wrong",
            "none given or wrong")),
        Area("communication", "Communication", 10, False, _COMM),
    ),
    "system-design": (
        Area("requirements", "Requirements & scope", 15, True, _bands(
            "functional and non-functional requirements and scale scoped explicitly",
            "good scoping, one gap",
            "partial scoping, assumptions left implicit",
            "barely scoped",
            "jumped in with no scoping")),
        Area("high_level_design", "High-level design", 25, True, _bands(
            "complete, coherent design that works end to end",
            "works end to end with a minor gap",
            "main components present, a key link missing",
            "fragmented or partly broken design",
            "no usable design")),
        Area("deep_dive", "Deep dive (data, storage, APIs)", 20, False, _bands(
            "detailed, correct data model, storage choices and APIs",
            "mostly correct detail, minor gap",
            "some detail, a key part shallow or wrong",
            "very shallow",
            "none or wrong")),
        Area("trade_offs", "Trade-offs", 20, False, _bands(
            "named alternatives and justified choices with costs",
            "named trade-offs, justification thin in places",
            "mentioned trade-offs without weighing them",
            "one-sided, little awareness",
            "none")),
        Area("scale_failure", "Scale & failure", 10, True, _bands(
            "addressed bottlenecks, scaling and failure modes concretely",
            "addressed most, minor gap",
            "mentioned scaling or failure in general terms",
            "token mention",
            "ignored")),
        Area("communication", "Communication", 10, False, _COMM),
    ),
    "lld": (
        Area("requirements", "Requirements & entities", 15, False, _bands(
            "clarified requirements and identified all core entities",
            "most entities identified, one clarification missed",
            "some entities, requirements loosely scoped",
            "few entities, requirements misread",
            "none")),
        Area("class_modelling", "Class modelling", 25, True, _bands(
            "clean classes, responsibilities and relationships all sound",
            "sound model with a minor flaw",
            "core classes present, a key responsibility misplaced",
            "weak model, tangled responsibilities",
            "no usable model")),
        Area("principles", "Design principles & patterns", 20, False, _bands(
            "applies SOLID and fitting patterns and explains why",
            "applies them mostly, small gaps",
            "some principles, patterns forced or unexplained",
            "little awareness",
            "none")),
        Area("extensibility", "Extensibility", 15, True, _bands(
            "new requirements slot in with no redesign",
            "most extensions easy, one needs rework",
            "some extensions possible, others need big changes",
            "rigid design",
            "no extensibility")),
        Area("code", "Code", 15, True, _bands(
            "correct, clean code for the key classes",
            "correct with minor slips",
            "partly working or messy",
            "mostly broken",
            "no usable code")),
        Area("communication", "Communication", 10, False, _COMM),
    ),
    "behavioural": (
        Area("structure", "Structure (STAR)", 15, False, _bands(
            "clear situation, task, action and result every time",
            "mostly structured, one part thin",
            "stories wander, result often missing",
            "disorganised",
            "no structure")),
        Area("ownership", "Ownership", 25, False, _bands(
            "clear personal ownership, concrete 'I' actions",
            "mostly own actions, some 'we' blur",
            "mixed own and team credit, unclear role",
            "mostly team actions, little personal role",
            "no real example of own")),
        Area("impact", "Impact", 20, False, _bands(
            "specific, measurable results",
            "clear results, not quantified",
            "vague results",
            "unclear outcome",
            "no outcome")),
        Area("self_awareness", "Self-awareness & learning", 20, False, _bands(
            "honest reflection with specific learning applied later",
            "reflects, learning somewhat general",
            "surface-level reflection",
            "defensive or blames others",
            "none")),
        Area("company_values", "Company values", 10, False, _bands(
            "stories clearly show the company's values",
            "values shown in most stories",
            "some values, loosely linked",
            "little alignment",
            "none")),
        Area("communication", "Communication", 10, False, _COMM),
    ),
    "hiring-manager": (
        Area("project_depth", "Project depth & ownership", 25, True, _bands(
            "owns the project, explains decisions, outcomes and trade-offs",
            "clear ownership, minor gaps in decisions",
            "knows what was built, not why",
            "vague about own role",
            "cannot explain own project")),
        Area("technical_depth", "Technical depth on resume claims", 25, True, _bands(
            "claims backed by correct, detailed answers",
            "claims mostly backed, one shallow area",
            "surface knowledge of claims",
            "claims largely unsupported",
            "claims contradicted or unknown")),
        Area("motivation", "Motivation & role fit", 15, False, _bands(
            "specific reasons for this role and company, clear fit",
            "good reasons, somewhat generic",
            "generic motivation",
            "unclear motivation",
            "none")),
        Area("behavioural", "Behavioural", 15, False, _bands(
            "strong own examples, structured and reflective",
            "good examples, minor gaps",
            "examples thin or unstructured",
            "little evidence",
            "no real example")),
        Area("communication", "Communication", 10, False, _COMM),
        Area("questions_asked", "Questions asked", 10, False, _bands(
            "thoughtful, specific questions about the role and team",
            "relevant questions, somewhat generic",
            "a basic question or two",
            "token question",
            "none")),
    ),
    "online-assessment": (
        Area("code_correctness", "Code correctness", 60, True, _CODE_CORRECTNESS),
        Area("complexity", "Complexity", 25, False, _bands(
            "efficient solution with correct complexity",
            "efficient, minor complexity slip",
            "works but not efficient enough for the limits",
            "far too slow",
            "no sense of complexity")),
        Area("code_quality", "Code quality", 15, True, _bands(
            "clean, readable, well-structured",
            "readable, minor issues",
            "works but messy",
            "hard to read",
            "no usable code")),
    ),
    "knowledge": (
        Area("correctness", "Correctness", 70, False, _bands(
            "answers correct and complete",
            "mostly correct, a minor gap",
            "partly correct, a key point missing",
            "mostly wrong or very shallow",
            "wrong or no real answer")),
        Area("depth", "Depth", 20, False, _bands(
            "explains the why and edge cases",
            "good depth, minor gap",
            "knows the what, not the why",
            "very shallow",
            "none")),
        Area("communication", "Communication", 10, False, _COMM),
    ),
}

# Plain sentence for the must-have cap reason (spec §8.3), e.g. "Capped at 6.5: <sentence>".
MUST_HAVE: dict[str, str] = {
    "dsa": "the solution didn't reach working logic",
    "online-assessment": "the solution didn't reach working logic",
    "system-design": "the design didn't work end to end",
    "lld": "the core classes weren't modelled",
    "behavioural": "no real example of your own was given",
    "hiring-manager": "no real example of your own was given",
}


# What MEETS the must-have, in positive words, for the grader's prompt (spec §8.3). MUST_HAVE above is the cap note shown when it is missed.
_WORKING_LOGIC = ("working logic on the main problem: logic_works yes or syntax_only, or partly with only an edge case failing; small "
                  "syntax slips never count against it; pseudo-code counts when the code standard accepts pseudocode (pseudo_ok)")
MUST_HAVE_RULE: dict[str, str] = {
    "dsa": _WORKING_LOGIC,
    "online-assessment": _WORKING_LOGIC,
    "system-design": "a design that works end to end",
    "lld": "the core classes are modelled",
    "behavioural": "at least one real example of the candidate's own",
    "hiring-manager": "at least one real example of the candidate's own",
}


def areas_for(family: str, company: str | None = None) -> tuple[Area, ...]:
    """The family's areas; Amazon renames behavioural company_values to Leadership Principles."""
    areas = FAMILIES[family]
    if family == "behavioural" and company and "amazon" in company.lower():
        return tuple(
            replace(a, label="Leadership Principles") if a.key == "company_values" else a
            for a in areas
        )
    return areas
