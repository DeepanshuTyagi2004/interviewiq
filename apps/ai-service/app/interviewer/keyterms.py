"""Deepgram keyterm prompting for the interviewer's speech-to-text (decided 2026-10-18). A live round heard the candidate's project name "Vibe" as
"by", "five five" and "pause in five" for 70 seconds, and the interviewer blamed the line. Keyterms bias nova-3 toward the words this round is
about: the names on the candidate's resume, the company and the two first names. Nothing but those public-facing names goes in: no ids, emails,
keys or free text. Deepgram's documented limits (keyterm is nova-3 only; roughly 100 terms and 500 tokens a request; the livekit plugin states
no limit) are kept well inside with MAX_TERMS and MAX_TERM_CHARS."""
from __future__ import annotations

import re
from typing import Any

MAX_TERMS = 30
MAX_TERM_CHARS = 40
MAX_TERM_WORDS = 4
_CUT = re.compile(r"\s+[-–—|:]\s+|[:(,;|]")          # "Relay - a CLI for X", "Vibe (UI generator)": the name is what comes first
_ALLOWED = re.compile(r"[^A-Za-z0-9 .+#&'/-]")                  # letters, digits and the punctuation tech names carry (C++, C#, Node.js, R&D)
_NOISE = frozenset({"the", "and", "for", "with", "app", "project", "website", "system", "platform", "tool", "using"})


def _term(raw: Any) -> str | None:
    """One clean keyterm from a resume entry (a string, or a dict with a name/title), or None when nothing short and name-like is left."""
    if isinstance(raw, dict):
        raw = raw.get("name") or raw.get("title") or ""
    text = _CUT.split(str(raw or "").strip(), maxsplit=1)[0]
    text = re.sub(r"\s+", " ", _ALLOWED.sub(" ", text)).strip(" .-/")
    words = text.split()
    if not text or len(text) < 2 or len(text) > MAX_TERM_CHARS or len(words) > MAX_TERM_WORDS or text.lower() in _NOISE:
        return None
    return text


def stt_keyterms(context: dict[str, Any], blueprint: dict[str, Any] | None = None) -> list[str]:
    """The keyterms for one session, most useful first and de-duplicated: the candidate's first name, the interviewer's first name, the company,
    the resume's project names, then its skills. Capped at MAX_TERMS. Never raises: a context of another shape gives what it can."""
    out: list[str] = []
    seen: set[str] = set()

    def add(raw: Any) -> None:
        term = _term(raw)
        if term is not None and term.lower() not in seen and len(out) < MAX_TERMS:
            seen.add(term.lower())
            out.append(term)

    try:
        rnd = context.get("round") or {}
        persona = (blueprint or {}).get("persona") or {}
        profile = context.get("profile") or {}
        add(str(context.get("first_name") or "").split(" ")[0])
        add(str(persona.get("name") or "").split(" ")[0])
        add(rnd.get("company_name"))
        add(rnd.get("company"))
        for project in profile.get("projects") or []:
            add(project)
        for skill in profile.get("skills") or []:
            add(skill)
    except Exception:  # noqa: BLE001 - keyterms only help recognition: a surprise in the context must never stop the round
        return out
    return out
