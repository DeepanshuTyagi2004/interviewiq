"""Perplexity brief-generation query (v5 DRAFT — product IP, pending human review).

Deliberately SIMPLE: ask Perplexity only for what it's good at — gather as many REAL, recent
candidate interview experiences as possible for a given role + seniority + company, from ANY
source, each with its URL and round-by-round detail. The role-focusing, filtering and richer
consolidation happen on our side (the local LLM + source scoring), not by over-constraining
the search. Bump BRIEF_QUERY_VERSION on any wording change; it's stored on every brief so
version-mismatched briefs regenerate.
"""
from __future__ import annotations

BRIEF_QUERY_VERSION = "v6"

BRIEF_SYSTEM = (
    "You are an interview-intelligence researcher. You search the live web for REAL, recent, "
    "first-hand candidate interview experiences for a specific role at a company, open the posts, "
    "and report them faithfully. You are descriptive, never evaluative — you report what candidates "
    "say happened; you never score or rank. Respond with VALID JSON ONLY: no preamble, no markdown "
    "code fences, no text outside the JSON object."
)

_SCHEMA = """
Output a JSON object with EXACTLY this shape (in `experiences`, use null where unknown and never invent posts or URLs):
{
  "experiences": [
    {
      "source": "<platform name, e.g. LeetCode Discuss | Glassdoor | GeeksforGeeks | AmbitionBox | Reddit | Blind | jointaro | blog>",
      "source_url": "<direct URL to the specific experience post>",
      "total_rounds": <int or null>,
      "timeline_days": <int or null>,
      "overall_outcome": "<selected/rejected/withdrew/unknown or short note>",
      "rounds": [
        {
          "round_number": <int>,
          "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
          "duration_mins": <int or null>,
          "format": "<short description of the round format>",
          "topics": ["<string>", ...],
          "problems": ["<specific problems/questions mentioned>", ...],
          "difficulty": "easy"|"medium"|"hard"|null,
          "hints_given": <true|false|null>,
          "outcome": "<outcome of this round, or null>"
        }
      ]
    }
  ],
  "consolidated_process": {
    "typical_round_count": <int or null>,
    "rounds": [
      {
        "round_number": <int>,
        "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
        "consistency": "<e.g. 'appears in 4 of 5 experiences'>",
        "format": "<what to expect in this round>",
        "dominant_topics": ["<string>", ...],
        "difficulty": "easy"|"medium"|"hard"|null
      }
    ],
    "dominant_topics": ["<top topics across all rounds>"],
    "difficulty_calibration": "<typical difficulty and what to expect>",
    "interviewer_style_notes": "<patterns in interviewer behaviour: hints, communication>",
    "red_flags": ["<common mistakes candidates make / process red flags>"],
    "company_specific_patterns": "<anything specific to this company, or null>",
    "data_confidence": "high"|"medium"|"low"
  }
}

Rules:
- `experiences`: REAL posts only — collect as MANY as you can (aim 8-10+), from ANY source. Open each
  post, extract EVERY round, capture specific problems/questions verbatim. Each MUST carry a working
  source_url so it can be verified. Never fabricate an experience or a URL.
- `consolidated_process`: ALWAYS fully populated — this is the deliverable and must never be empty. Make
  it the MOST REALISTIC round-by-round interview a candidate should expect for THIS exact role, seniority
  and company in the Indian tech-interview context, as close to the real loop as the evidence allows.
  Ground it in the experiences above when they're rich; when they're sparse or missing, fall back to the
  most realistic, plausible loop for a company/role/level of this kind and set "data_confidence": "low".
- "data_confidence": honest (high = many recent matching experiences; medium = some; low = sparse/older
  only or best-estimate fallback).
- Output ONLY the JSON object. No prose, no fences.
"""


def build_brief_query(
    company: str,
    role: str,
    level: str,
    *,
    specialization: str | None = None,
    title: str | None = None,
    emphasize_json: bool = False,
) -> str:
    emphasis = (
        "\n\nIMPORTANT: Your previous answer was not valid JSON. Respond with ONLY the "
        "JSON object described below — no preamble, no markdown fences, no trailing text."
        if emphasize_json
        else ""
    )
    role_label = role.replace("-", " ")
    spec = (specialization or "").strip().lower()
    role_phrase = f"{level} {spec} {role_label}" if spec and spec not in ("general", "") else f"{level} {role_label}"
    return (
        f"Find as many REAL, recent candidate interview experiences as you can for a {role_phrase} role "
        f"at {company} — India offices (the audience is Indian candidates), weighting the last 6-12 "
        f"months. Use ANY source (LeetCode Discuss, Glassdoor, GeeksforGeeks, AmbitionBox, Reddit, Blind, "
        f"jointaro, blogs). Open each post and capture the full round-by-round process with its source "
        f"URL, then consolidate them into one round-by-round process for this role."
        f"\n{_SCHEMA}{emphasis}"
    )
