"""Generic, company-AGNOSTIC interview-loop skeletons by (role, level).

These are the industry-standard round shapes for a seniority. They name NO company and
NO specific problems — by construction they cannot leak company-specific detail (the hard
rule that inferred/template rounds stay generic). They are fed to the aggregator only to
ensure a level's STANDARD rounds are present; any standard round the real on-level sources
don't cover is added as `provenance=template`, generic, with empty evidence_urls. The LLM
adapts each round's topics to the specialization (frontend vs backend etc.).

Round `type` values must be valid `app.models.brief.RoundType`.
"""
from __future__ import annotations

# (role, level) -> ordered [(type, generic_focus, typical_difficulty)]
_SKELETONS: dict[tuple[str, str], list[tuple[str, str, str]]] = {
    ("software-engineer", "fresher"): [
        ("online-assessment", "Timed online test: 2-3 DSA problems plus CS-fundamentals questions", "medium"),
        ("dsa", "Live problem solving on data structures & algorithms with CS fundamentals (OS, DBMS, CN, OOP)", "medium"),
        ("hiring-manager", "Projects, internships, motivation and basic behavioural fit", "easy"),
    ],
    ("software-engineer", "sde1"): [
        ("online-assessment", "Timed coding screen with DSA problems", "medium"),
        ("dsa", "Data structures & algorithms with CS fundamentals", "medium"),
        ("lld", "Light machine coding / low-level design of a small feature", "medium"),
        ("hiring-manager", "Projects, ownership and behavioural fit", "easy"),
    ],
    ("software-engineer", "sde2"): [
        ("online-assessment", "Timed coding plus aptitude screen", "medium"),
        ("dsa", "Medium-to-hard data structures & algorithms", "medium"),
        ("lld", "Machine coding / low-level design of a real-world feature with extensibility", "medium"),
        ("system-design", "High-level design: a scalable service, data modelling and trade-offs", "hard"),
        ("hiring-manager", "Past impact, ownership and cross-team collaboration", "medium"),
    ],
    ("software-engineer", "sde3"): [
        ("lld", "Low-level / machine-coding design with extensibility and clean abstractions", "hard"),
        ("system-design", "Large-scale distributed system design: reliability, scale and trade-offs", "hard"),
        ("behavioural", "Leadership, mentoring, conflict resolution and project ownership", "medium"),
        ("hiring-manager", "Strategy, scope and cross-org impact", "medium"),
    ],
}

# Used when a level has no specific skeleton — a safe mid-weight default.
_DEFAULT = _SKELETONS[("software-engineer", "sde1")]


def skeleton_for(role: str | None, level: str | None) -> list[dict]:
    """Standard loop for a (role, level), falling back to the same level for any role,
    then to a generic default. Returned as dicts ready to embed in the aggregate prompt."""
    rounds = (
        _SKELETONS.get((str(role), str(level)))
        or _SKELETONS.get(("software-engineer", str(level)))
        or _DEFAULT
    )
    return [{"type": t, "focus": f, "typical_difficulty": d} for t, f, d in rounds]


if __name__ == "__main__":  # ponytail: confirm every skeleton round uses a valid RoundType
    from app.models.brief import RoundType
    valid = {t.value for t in RoundType}
    for key, rounds in _SKELETONS.items():
        for t, _f, _d in rounds:
            assert t in valid, f"{key}: bad round type {t!r}"
    assert skeleton_for("software-engineer", "fresher")[0]["type"] == "online-assessment"
    assert skeleton_for("data-engineer", "sde2")  # falls back by level
    assert skeleton_for("x", "unheard-of")        # falls back to default
    print("ok")
