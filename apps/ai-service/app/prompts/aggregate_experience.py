"""Aggregator prompt (PRODUCT IP — DRAFT, pending human review).

Merge the per-source raw experiences into ONE realistic round-by-round interview experience
for the given company/role/level, for INDIAN candidates. Tag every round evidence_backed or
inferred. Always return a complete experience; never invent company-specific detail without
evidence. Bump AGGREGATE_VERSION on any wording change.
"""
from __future__ import annotations

AGGREGATE_VERSION = "v1"

AGGREGATE_SYSTEM = (
    "You are an interview-intelligence analyst for Indian candidates. You merge multiple "
    "first-hand interview reports into ONE realistic round-by-round process for a specific "
    "company/role/seniority. You are descriptive, never evaluative — you never score or rank. "
    "Respond with VALID JSON ONLY: no preamble, no markdown."
)

_SCHEMA = """
Return a JSON object with this shape:
{
  "rounds": [
    { "round_number": <int>, "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
      "format": "<what to expect>", "topics": ["<string>"], "problems": ["<specific, only if evidenced>"],
      "difficulty": "easy"|"medium"|"hard"|null,
      "provenance": "evidence_backed" | "inferred",
      "evidence_urls": ["<source urls that support this round; [] when inferred>"] }
  ],
  "dominant_topics": ["<top topics across rounds>"],
  "difficulty_calibration": "<typical difficulty and what to expect>",
  "interviewer_style_notes": "<patterns in interviewer behaviour>",
  "red_flags": ["<common candidate mistakes / process red flags>"],
  "company_specific_patterns": "<company specifics — ONLY if evidenced — else null>",
  "data_confidence": "high"|"medium"|"low"
}

RULES:
- Build the MOST REALISTIC loop for this exact company/role/seniority in the INDIAN tech-interview context.
- Prefer experiences whose detected role/level match and whose geo is India; discount non-India reports.
- Tag each round:
  - "evidence_backed" — supported by >=1 source; list those source urls in evidence_urls.
  - "inferred" — not directly in the sources; filled from typical patterns for SIMILAR company/role/level
    in India. Keep inferred rounds GENERIC.
- NEVER invent company-specific details (named problems, specific OA platform, interviewer names) on an
  inferred round. Company specifics may appear ONLY on evidence_backed rounds.
- ALWAYS return a complete loop (never empty). If almost everything is inferred, set data_confidence "low".
- Output ONLY the JSON object.
"""


def build_aggregate_prompt(combo_label: str, raw_experiences_json: str) -> str:
    return (
        f"Target: {combo_label} (India).\n"
        f"Here are the extracted candidate experiences (JSON array):\n"
        f"\"\"\"\n{raw_experiences_json}\n\"\"\"\n"
        f"Consolidate them into one realistic round-by-round experience.\n{_SCHEMA}"
    )
