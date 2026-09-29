"""Per-source extraction prompt: turn ONE collected source into a structured raw account of a
company's interview PROCESS (the round structure) plus, when first-hand, the lived specifics.

Goal: capture the hiring process for a (company, role, level) from ANY page that genuinely
describes it — a first-hand experience, a prep/official guide, or an aggregated post. Source
type is not a gate; it is a TRUST label (`is_first_hand`). The firewall: lived specifics
(named problems, observed difficulty/hints/outcome) come ONLY from first-hand accounts. Guides
contribute round STRUCTURE only (type, format, topics) — never named problems.

Descriptive only — report what the page says; never score. Detect role/seniority/geo PURELY
from the page. We deliberately do NOT tell the model which combo we're researching — leaking the
target seniority makes it echo that back as detected_level (stamping every page "fresher"),
which corrupts level-match confidence downstream.
"""
from __future__ import annotations

EXTRACT_VERSION = "v5"

EXTRACT_SYSTEM = (
    "You read ONE web page about a company's interview process and extract a faithful, structured "
    "account of the interview ROUNDS it describes. Report only what THIS page says; never infer or "
    "assume. Determine seniority/role/geo ONLY from explicit signals in the page — never guess. "
    "A page counts whether it is one candidate's own account OR a guide/official page/aggregated "
    "post — as long as it lays out a concrete round structure for THIS company. "
    "Respond with VALID JSON ONLY — output a single JSON object and nothing else: no reasoning, "
    "no thinking, no preamble, no explanation, no markdown fences, no text before or after it."
)

_SCHEMA = """
Return a JSON object with this shape (use null where the page doesn't say; do NOT invent):
{
  "describes_process": <true|false>,   // true if the page lays out a CONCRETE interview round structure for THIS company (a sequence of rounds / stages). true for a first-hand experience, a prep/official guide, or an aggregated write-up. false ONLY for: a bare question bank / "top N questions" list with no round structure, a company review with no process, a job posting with no interview stages, an empty/blocked page, or anything unrelated.
  "is_first_hand": <true|false>,       // true ONLY if this is ONE candidate narrating THEIR OWN interview ("I interviewed...", "in my round..."). false for a guide, an official careers page, or a third-person/aggregated overview — even when it describes the process well.
  "source": "<platform name, e.g. LeetCode Discuss | Glassdoor | Reddit | Medium | blog | company-careers | guide>",
  "url": "<the page url>",
  "date": "<ISO date if stated, else null>",
  "detected_role": "<the role THIS page is about, from the page text, or null>",
  "detected_level": "<the seniority THIS page explicitly states — fresher/intern/new-grad/sde1/sde2/sde3/senior, or a years-of-experience figure. Read it ONLY from the page (e.g. 'SDE-2', '4 years experience', 'campus/fresher'). If the page does not clearly state a SINGLE seniority (e.g. a guide that lists several), return null. NEVER assume a level.>",
  "geo": "india" | "non-india" | "unknown",   // "india" ONLY if the page shows an explicit Indian signal (an Indian city/college, a company's India office, or ₹/INR/LPA pay). "non-india" only if it clearly points to another country. Otherwise "unknown". Do NOT default to "india" just because the research is about India.
  "outcome": "<selected/rejected/withdrew/unknown — ONLY if first-hand, else null>",
  "rounds": [
    { "round_number": <int>, "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
      "duration_mins": <int|null>, "format": "<short description of the round / what to expect>",
      "topics": ["<string>"],
      // FIREWALL — the next four are LIVED SPECIFICS. Fill them ONLY when is_first_hand is true.
      // When is_first_hand is false (a guide/overview), leave problems = [], difficulty = null,
      // hints_given = null, outcome = null. Never copy a guide's "frequently asked" lists into problems.
      "problems": ["<specific problems/questions ACTUALLY asked — first-hand only, else []>"],
      "difficulty": "easy"|"medium"|"hard"|null, "hints_given": <true|false|null>, "outcome": "<or null>" }
  ]
}
If this page does NOT describe a concrete interview process (bare question bank, "top N
questions" with no rounds, company review without a process, job post without stages,
empty/blocked page, unrelated), return EXACTLY this and nothing else:
{"describes_process": false, "is_first_hand": false, "rounds": []}
Output ONLY the JSON object — no reasoning or text around it.
"""


def build_extract_prompt(context: str, source: dict) -> str:
    """`context` is light relevance context (company + role only) — it MUST NOT contain the
    seniority/specialization we're researching, so the model detects level from the page itself."""
    title = (source.get("title") or "").strip()
    url = (source.get("url") or "").strip()
    date = source.get("date") or "unknown"
    content = (source.get("content") or "").strip()
    return (
        f"We are researching the interview PROCESS at {context} (India) — the round structure, "
        f"whether from a first-hand candidate account, a prep/official guide, or an aggregated post. "
        f"From the SINGLE web page below, extract only what THIS page reports.\n\n"
        f"TITLE: {title}\nURL: {url}\nDATE: {date}\n\nPAGE CONTENT:\n\"\"\"\n{content}\n\"\"\"\n"
        f"{_SCHEMA}"
    )
