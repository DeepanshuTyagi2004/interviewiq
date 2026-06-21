"""Per-source extraction prompt: turn ONE collected source into a structured raw experience.

Descriptive only — report what the post says happened; never score. Return an empty/null
experience when the source is not a genuine first-hand interview account.

IMPORTANT: the extractor must detect role/seniority/geo PURELY from the post. We deliberately
do NOT tell it which combo we're researching — leaking the target seniority makes the model
echo it back as detected_level (e.g. stamping every post "fresher"), which then corrupts the
level-match confidence downstream.
"""
from __future__ import annotations

EXTRACT_VERSION = "v2"

EXTRACT_SYSTEM = (
    "You read ONE web page about a job interview and extract a faithful, structured account of "
    "what the candidate reported. Report only what THIS post says; never infer or assume. "
    "In particular, determine seniority/role ONLY from explicit signals in the post — never guess. "
    "Respond with VALID JSON ONLY — output a single JSON object and nothing else: no reasoning, "
    "no thinking, no preamble, no explanation, no markdown fences, no text before or after it."
)

_SCHEMA = """
Return a JSON object with this shape (use null where the post doesn't say; do NOT invent):
{
  "is_interview_experience": <true|false>,   // true ONLY if this is ONE candidate's first-hand account of THEIR OWN interview rounds. false for a question bank, a "top N questions" list, a prep/preparation guide, a company review, a job posting, or any generic guide.
  "source": "<platform name, e.g. LeetCode Discuss | Glassdoor | Reddit | jointaro | Medium | blog>",
  "url": "<the page url>",
  "date": "<ISO date if stated, else null>",
  "detected_role": "<the role THIS post is about, from the post text, or null>",
  "detected_level": "<the seniority THIS post explicitly states — fresher/intern/new-grad/sde1/sde2/sde3/senior, or a years-of-experience figure. Read it ONLY from the post (e.g. 'SDE-2', '4 years experience', 'campus/fresher'). If the post does not clearly state seniority, return null. NEVER assume a level.>",
  "geo": "india" | "non-india" | "unknown",
  "outcome": "<selected/rejected/withdrew/unknown>",
  "rounds": [
    { "round_number": <int>, "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
      "duration_mins": <int|null>, "format": "<short description>",
      "topics": ["<string>"], "problems": ["<specific problems/questions>"],
      "difficulty": "easy"|"medium"|"hard"|null, "hints_given": <true|false|null>, "outcome": "<or null>" }
  ]
}
If this page is NOT one candidate's first-hand interview experience (question bank, "top N
questions", prep guide, company review, job post, empty/blocked page, unrelated), return EXACTLY
this and nothing else:
{"is_interview_experience": false, "rounds": []}
Output ONLY the JSON object — no reasoning or text around it.
"""


def build_extract_prompt(context: str, source: dict) -> str:
    """`context` is light relevance context (company + role only) — it MUST NOT contain the
    seniority/specialization we're researching, so the model detects level from the post itself."""
    title = (source.get("title") or "").strip()
    url = (source.get("url") or "").strip()
    date = source.get("date") or "unknown"
    content = (source.get("content") or "").strip()
    return (
        f"We are researching real candidate interview experiences at {context} (India). "
        f"From the SINGLE web page below, extract only what THIS post reports.\n\n"
        f"TITLE: {title}\nURL: {url}\nDATE: {date}\n\nPAGE CONTENT:\n\"\"\"\n{content}\n\"\"\"\n"
        f"{_SCHEMA}"
    )
