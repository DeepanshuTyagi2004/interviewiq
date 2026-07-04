"""Round-scope guard. The DETERMINISTIC half of topic-pivot handling: a pure keyword guard that
guarantees cross-round requests (e.g. "ask me system design" in a DSA round) are caught as OUT of
scope regardless of what the LLM classifier thinks. The LLM handles nuance for in-scope pivots;
this code makes the hard cross-round refusal a code invariant (spec §8.1)."""
from __future__ import annotations

from app.interview_agent.types import RoundType

# Per round: a human-readable in-scope description (for prompts) + markers that, if they appear in a
# pivot request, mean the candidate is asking to leave the round entirely (definitively OUT).
_SCOPE: dict[RoundType, tuple[str, tuple[str, ...]]] = {
    RoundType.DSA: (
        "a DSA round — data structures & algorithms plus core CS fundamentals "
        "(operating systems, DBMS, computer networks, OOP concepts)",
        ("system design", "hld", "high level design", "high-level design", "scalab", "load balanc",
         "microservice", "distributed system", "design pattern", "low level design", "low-level design",
         "lld", "machine coding", "behavioural", "behavioral", "tell me about a time", "class diagram"),
    ),
    RoundType.SYSTEM_DESIGN: (
        "a System Design round — HLD, scalability, caching, databases/sharding, consistency, "
        "messaging, API design, and back-of-envelope estimation",
        ("leetcode", "dsa", "dynamic programming", "two pointer", "behavioural", "behavioral",
         "tell me about a time", "class diagram", "design pattern"),
    ),
    RoundType.LLD: (
        "an LLD round — object-oriented design, class modeling, design patterns, SOLID, and "
        "concurrency in design",
        ("system design", "hld", "scalab", "leetcode", "dynamic programming", "behavioural",
         "behavioral", "tell me about a time", "dsa"),
    ),
    RoundType.BEHAVIOURAL: (
        "a Behavioural round — situational / STAR questions about teamwork, conflict, ownership, "
        "and learning from failure",
        ("dsa", "coding problem", "leetcode", "algorithm", "system design", "hld", "lld",
         "class diagram", "design pattern", "sql query"),
    ),
    RoundType.HIRING_MANAGER: (
        "a Hiring Manager round — motivation, role and company fit, project deep-dives, high-level "
        "technical judgement, and career goals",
        ("leetcode", "dsa coding", "solve this algorithm", "class diagram", "dsa"),
    ),
}

_FALLBACK_DESC = "this interview round"


def out_of_scope_by_markers(round_type: RoundType, topic_text: str) -> bool:
    """True when the requested topic clearly belongs to a DIFFERENT round type (hard refusal).
    Case-insensitive substring match against the round's out-of-scope markers."""
    _, markers = _SCOPE.get(round_type, (_FALLBACK_DESC, ()))
    low = (topic_text or "").lower()
    return any(m in low for m in markers)


def scope_prompt_context(round_type: RoundType) -> str:
    """In-scope description for injection into the classifier / refusal prompts."""
    desc, _ = _SCOPE.get(round_type, (_FALLBACK_DESC, ()))
    return f"This is {desc}."
