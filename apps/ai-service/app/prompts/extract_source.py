"""Per-source extraction prompt: turn ONE collected source into a structured raw experience.

Descriptive only — report what the post says happened; never score. Return an empty/null
experience when the source is not a genuine first-hand interview account.
"""
from __future__ import annotations

EXTRACT_VERSION = "v1"

EXTRACT_SYSTEM = (
    "You read ONE web page about a job interview and extract a faithful, structured account "
    "of what the candidate reported. Report what the post says; do not infer beyond it. "
    "Respond with VALID JSON ONLY: no preamble, no markdown."
)

_SCHEMA = """
Return a JSON object with this shape (use null where the post doesn't say; do NOT invent):
{
  "is_interview_experience": <true|false>,   // false if it's a prep guide, listicle, job ad, unrelated
  "source": "<platform name, e.g. LeetCode Discuss | Glassdoor | Reddit | jointaro | blog>",
  "url": "<the page url>",
  "date": "<ISO date if stated, else null>",
  "detected_role": "<role the post is about, verbatim-ish, or null>",
  "detected_level": "<seniority the post is about (fresher/intern/sde1/sde2/sde3/...) or null>",
  "geo": "india" | "non-india" | "unknown",
  "outcome": "<selected/rejected/withdrew/unknown>",
  "rounds": [
    { "round_number": <int>, "type": "online-assessment"|"dsa"|"system-design"|"lld"|"behavioural"|"hiring-manager",
      "duration_mins": <int|null>, "format": "<short description>",
      "topics": ["<string>"], "problems": ["<specific problems/questions>"],
      "difficulty": "easy"|"medium"|"hard"|null, "hints_given": <true|false|null>, "outcome": "<or null>" }
  ]
}
If is_interview_experience is false, set rounds to [] and other fields to null.
Output ONLY the JSON object.
"""


def build_extract_prompt(combo_label: str, source: dict) -> str:
    title = (source.get("title") or "").strip()
    url = (source.get("url") or "").strip()
    date = source.get("date") or "unknown"
    content = (source.get("content") or "").strip()
    return (
        f"We are building an interview brief for: {combo_label} (India). "
        f"Extract the interview experience from this single source.\n\n"
        f"TITLE: {title}\nURL: {url}\nDATE: {date}\n\nPAGE CONTENT:\n\"\"\"\n{content}\n\"\"\"\n"
        f"{_SCHEMA}"
    )
