"""Résumé parsing prompt: turn extracted résumé text into structured JSON that prefills the
onboarding form.

Descriptive only — extract what the résumé states; never rate, rank, or editorialise. The user
edits every field afterwards, so faithfulness beats cleverness: copy what's written, leave gaps
null rather than inventing. Output is validated against app.models.resume.ParsedResume.
"""
from __future__ import annotations

RESUME_VERSION = "v3"

RESUME_SYSTEM = (
    "You extract structured data from a candidate's résumé. Report ONLY what the résumé text "
    "states — never infer, rate, rank, or embellish. Where the résumé doesn't say, use null (or an "
    "empty list). Keep values verbatim from the résumé (don't reword bullets or normalise dates). "
    "Respond with VALID JSON ONLY — a single JSON object and nothing else: no reasoning, no "
    "preamble, no explanation, no markdown fences, no text before or after it."
)

_SCHEMA = """
Return a JSON object with EXACTLY this shape (use null / [] where the résumé doesn't say; do NOT invent):
{
  "full_name": "<candidate's name or null>",
  "email": "<email or null>",
  "phone": "<phone or null>",
  "location": "<city/area as written, or null>",
  "headline": "<one-line current title or summary, or null>",
  "links": {
    "github":   "<full GitHub profile URL if present, else null>",
    "leetcode": "<full LeetCode profile URL if present, else null>",
    "linkedin": "<full LinkedIn profile URL if present, else null>"
  },
  "education": [
    { "institution": "<school/college>", "degree": "<e.g. B.Tech>", "field": "<e.g. Computer Science>",
      "start_year": "<year as written or null>", "end_year": "<year as written or null>",
      "grade": "<CGPA/percentage exactly as written, or null>" }
  ],
  "experience": [
    { "company": "<employer>", "title": "<role>", "start_date": "<as written or null>",
      "end_date": "<as written, 'Present' if ongoing, or null>", "location": "<or null>",
      "bullets": ["<each responsibility/achievement line, verbatim>"] }
  ],
  "projects": [
    { "name": "<project name>", "description": "<one-line summary if the résumé gives one, or null>",
      "tech": ["<each technology/tool the project lists>"],
      "bullets": ["<each project detail line, verbatim>"],
      "link": "<repo/live URL if present, else null>" }
  ],
  "skills": ["<each distinct skill/technology named>"],
  "achievements": ["<each award, honour, hackathon win, or competition result, verbatim>"]
}
Rules:
- Include EVERY education entry and EVERY work/internship entry the résumé lists (most recent first is fine).
- ONE experience entry = one employer + one title + one date range. If a single role lists several
  project/product sub-headings under the SAME employer, title, and dates (e.g. two products built in
  one job), that is still ONE experience entry — do NOT emit multiple entries that repeat the same
  company. Only create separate experience entries when the employer, title, OR date range differs.
- When a role has named sub-projects, keep all of their lines in that one entry's "bullets", and put
  each sub-project's heading as its own bullet immediately before that sub-project's lines, so the
  grouping is preserved (e.g. "SFA, Supervisor and EB2B Flutter Apps", then its lines, then
  "AI Sales Agent", then its lines).
- "bullets" are the résumé's own lines for that role — copy the wording verbatim, but drop any
  leading bullet marker (–, -, •, *); do not summarise or reword.
- "skills" are concrete technologies/tools/languages; skip soft-skill adjectives.
- "projects" is a SEPARATE section from work experience — personal/academic/side projects the
  résumé lists under a Projects heading. Include EVERY one. Put its own tech list in "tech" and its
  detail lines (verbatim, minus the leading marker) in "bullets"; fill "link" only if the project
  states a repo/live URL. Do NOT duplicate a work role here, and do NOT invent projects.
- "achievements" are awards, honours, hackathon/competition results, scholarships, or ranked
  standings the résumé states — copy each verbatim. Empty list if the résumé lists none; never invent.
- Only fill a link if the résumé actually contains that profile URL; otherwise null.
Output ONLY the JSON object — no reasoning or text around it.
"""


def build_parse_resume_prompt(resume_text: str) -> str:
    return (
        "Extract the structured data below from this résumé. Use only what the text states.\n\n"
        f"RÉSUMÉ TEXT:\n\"\"\"\n{resume_text}\n\"\"\"\n"
        f"{_SCHEMA}"
    )
