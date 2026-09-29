"""Aggregator prompt (PRODUCT IP — DRAFT, pending human review).

Merge the per-source raw experiences into ONE realistic round-by-round interview experience
for the given company/role/level, for INDIAN candidates.

Coverage-first, provenance-honest (v3):
  - The caller has ALREADY removed off-level sources. Every source passed in is either on-level
    (tagged exact/adjacent) or level-unconfirmed, and carries `is_first_hand` (true = a candidate's
    own account; false = a guide/official page/aggregated post describing the process).
  - UNION distinct rounds across sources — keep even a round only one source reported
    (rarity is tracked separately downstream; more rounds don't hurt a prep tool, missing
    a round does).
  - Tag each round evidence_backed / process_guide / inferred_from_similar / template (below).
  - Ensure the level's STANDARD LOOP is covered; fill any gap with a generic `template` round.
  - Company-specific detail (named problems, named platforms) is allowed ONLY on evidence_backed
    rounds (those backed by an on-level FIRST-HAND account). Never on process_guide,
    inferred_from_similar, or template rounds.
NOTE: the pipeline RE-DERIVES provenance deterministically after you respond (it does not trust
these labels), so be accurate but know the firewall is enforced downstream regardless.
Bump AGGREGATE_VERSION on any wording change.
"""
from __future__ import annotations

import json as _json

AGGREGATE_VERSION = "v4"

AGGREGATE_SYSTEM = (
    "You are an interview-intelligence analyst for Indian candidates. You merge multiple "
    "interview sources — first-hand candidate accounts AND process guides/official pages — into "
    "ONE realistic round-by-round process for a specific company/role/seniority. You are "
    "descriptive, never evaluative — you never score or rank. "
    "Respond with VALID JSON ONLY: no preamble, no markdown."
)

_SCHEMA = """
Return a JSON object with this shape:
{
  "rounds": [
    { "round_number": <int>, "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
      "format": "<what to expect>", "topics": ["<string>"], "problems": ["<specific, ONLY on evidence_backed rounds>"],
      "difficulty": "easy"|"medium"|"hard"|null,
      "provenance": "evidence_backed" | "process_guide" | "inferred_from_similar" | "template",
      "evidence_urls": ["<source urls that support THIS round; [] when inferred_from_similar/template>"] }
  ],
  "dominant_topics": ["<top topics across rounds>"],
  "difficulty_calibration": "<typical difficulty and what to expect>",
  "interviewer_style_notes": "<patterns in interviewer behaviour>",
  "red_flags": ["<common candidate mistakes / process red flags>"],
  "company_specific_patterns": "<company specifics — ONLY if evidenced — else null>",
  "data_confidence": "high"|"medium"|"low"
}

RULES:
- Build the MOST REALISTIC loop for this EXACT company/role/seniority in the INDIAN tech-interview context.
- UNION the rounds: include every DISTINCT round that appears across the provided experiences, even if
  only ONE candidate reported it. Merge rounds that are clearly the SAME round (same stage/purpose) into
  one, combining their topics and problems. Do not collapse genuinely different rounds together.
- Tag each round's provenance:
  - "evidence_backed" — supported by >=1 ON-LEVEL (exact/adjacent) source that is FIRST-HAND
    (is_first_hand=true). Put those source urls in evidence_urls. Company-specific detail allowed here.
  - "process_guide" — described by >=1 ON-LEVEL source but NONE first-hand (a guide/official page/
    aggregated post). Put those urls in evidence_urls. STRUCTURE ONLY — no named problems.
  - "inferred_from_similar" — not attested by an on-level source: drawn from the LEVEL-UNCONFIRMED
    sources or from typical patterns for a SIMILAR company/role/level in India. Keep it GENERIC.
    evidence_urls may be [] or may list the level-unconfirmed urls that informed it.
  - "template" — a STANDARD LOOP round (see below) that NO provided source covers.
    Generic, evidence_urls = []. Do not name company-specific problems or platforms.
- COVERAGE: the final loop MUST contain every round in the STANDARD LOOP for this seniority. Any standard
  round not already present from the experiences MUST be added as a "template" round (adapt its topics to
  the specialization in the target — e.g. frontend vs backend).
- NEVER invent company-specific details (named problems, specific OA platform, interviewer names) on an
  inferred_from_similar or template round. Those may appear ONLY on evidence_backed rounds.
- ORDER rounds realistically: screening/online-assessment → coding/DSA → design (LLD then system-design)
  → behavioural → hiring-manager. Number them 1..N in that order.
- ALWAYS return a complete loop. Output ONLY the JSON object.
"""


def build_aggregate_prompt(combo_label: str, tagged_experiences_json: str, standard_loop: list[dict]) -> str:
    """`tagged_experiences_json` is the JSON array of on-level + level-unconfirmed sources, each with
    a `match_tier` field (exact | adjacent | level-unconfirmed) and an `is_first_hand` flag.
    `standard_loop` is the generic skeleton of rounds this seniority should always cover."""
    loop_str = _json.dumps(standard_loop, indent=0)
    return (
        f"Target: {combo_label} (India).\n"
        f"Below are the extracted interview sources (JSON array). Each carries `match_tier` and `is_first_hand`:\n"
        f"  match_tier: exact/adjacent = ON-LEVEL; level-unconfirmed = the page never stated a seniority "
        f"(use ONLY for inferred_from_similar — never as level evidence).\n"
        f"  is_first_hand: true = a candidate's own account (an on-level one backs an evidence_backed round; "
        f"named problems allowed); false = a guide/official page/aggregated post (an on-level one backs a "
        f"process_guide round — STRUCTURE ONLY, never named problems).\n"
        f"Off-level sources have already been removed; do not ask for them.\n"
        f"\"\"\"\n{tagged_experiences_json}\n\"\"\"\n\n"
        f"STANDARD LOOP for this seniority (cover every round; fill gaps as generic `template` rounds):\n"
        f"{loop_str}\n\n"
        f"Consolidate everything into one realistic, complete round-by-round experience.\n{_SCHEMA}"
    )
