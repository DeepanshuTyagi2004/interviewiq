"""Structured résumé schema (onboarding parse output).

Descriptive only — factual extraction of what the résumé states. No scoring, ranking, or
comparison (Profile Builder hard rule). The LLM is messy, so every field is optional and the
validators coerce the usual slop (a scalar where a list is expected, ints for year fields,
None-laden lists) instead of 422-ing a mostly-good parse. The backend maps this 1:1 onto
CandidateProfile, which the user then edits — so "wrong but present" is fine; "crashed" is not.
"""
from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic import model_validator


def _coerce_str(v):
    """None/'' stay None; everything else becomes a trimmed string ('' -> None)."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _safe_url(v):
    """Normalize an explicitly supplied external URL and reject unsafe authorities/schemes."""
    value = _coerce_str(v)
    if not value or any(ord(ch) <= 0x20 or ord(ch) == 0x7F for ch in value):
        return None
    candidate = value if "://" in value else f"https://{value}"
    try:
        parsed = urlsplit(candidate)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return None
        # Accessing port validates malformed port values without changing the URL's path/query.
        _ = parsed.port
        return urlunsplit((parsed.scheme.lower(), parsed.netloc, parsed.path, parsed.query, parsed.fragment))
    except (TypeError, ValueError):
        return None


def _coerce_str_list(v) -> list[str]:
    """Tolerate a bare string, None, or a list with junk entries -> clean list[str]."""
    if v is None:
        return []
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, (list, tuple)):
        return []
    out: list[str] = []
    for item in v:
        s = _coerce_str(item)
        if s:
            out.append(s)
    return out


class Education(BaseModel):
    model_config = ConfigDict(extra="ignore")

    institution: str | None = None
    degree: str | None = None
    field: str | None = None
    start_year: str | None = None   # str: tolerates "2021", 2021, "2021-2025", null
    end_year: str | None = None
    grade: str | None = None        # CGPA / percentage as written

    _s = field_validator("institution", "degree", "field", "start_year", "end_year", "grade",
                          mode="before")(_coerce_str)


def _coerce_line_list(v) -> list[str]:
    """Like _coerce_str_list, but for Markdown highlight lines: keep each line's leading
    indentation (it encodes nested bullets), drop trailing whitespace and blank lines."""
    if v is None:
        return []
    if isinstance(v, str):
        v = v.split("\n")
    if not isinstance(v, (list, tuple)):
        return []
    out: list[str] = []
    for item in v:
        if item is None:
            continue
        line = str(item).rstrip()
        if line.strip():
            out.append(line)
    return out


class Experience(BaseModel):
    model_config = ConfigDict(extra="ignore")

    company: str | None = None
    title: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    location: str | None = None
    link: str | None = None             # live/company URL if explicitly present
    # Markdown lines in the resume's own order: "- " bullets, "  - " nested bullets, plain
    # sub-heading lines, **bold** where the resume has it.
    bullets: list[str] = []

    _s = field_validator("company", "title", "start_date", "end_date", "location",
                          mode="before")(_coerce_str)
    _url = field_validator("link", mode="before")(_safe_url)
    _b = field_validator("bullets", mode="before")(_coerce_line_list)

    @model_validator(mode="before")
    @classmethod
    def _link_alias(cls, value):
        if isinstance(value, dict) and "link" not in value and "url" in value:
            return {**value, "link": value["url"]}
        return value


class Project(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = None
    description: str | None = None      # one-line summary of what the project is
    tech: list[str] = []                # technologies/stack used
    bullets: list[str] = []             # Markdown lines, as for Experience.bullets
    link: str | None = None             # repo or live URL if present

    _s = field_validator("name", "description", mode="before")(_coerce_str)
    _url = field_validator("link", mode="before")(_safe_url)
    _l = field_validator("tech", mode="before")(_coerce_str_list)
    _b = field_validator("bullets", mode="before")(_coerce_line_list)


class ResumeLinks(BaseModel):
    """Profile URLs detected in the résumé — used to prefill the connectors step."""
    model_config = ConfigDict(extra="ignore")

    github: str | None = None
    leetcode: str | None = None
    linkedin: str | None = None
    portfolio_website: str | None = None

    _url = field_validator("github", "leetcode", "linkedin", "portfolio_website", mode="before")(_safe_url)


class ParsedResume(BaseModel):
    model_config = ConfigDict(extra="ignore")

    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    headline: str | None = None          # a one-line summary / current title
    portfolio_website: str | None = None # personal site, only when explicitly printed
    links: ResumeLinks = ResumeLinks()
    education: list[Education] = []
    experience: list[Experience] = []
    projects: list[Project] = []
    skills: list[str] = []
    achievements: list[str] = []         # awards, honours, hackathon wins, competitions

    _s = field_validator("full_name", "email", "phone", "location", "headline",
                          mode="before")(_coerce_str)
    _portfolio = field_validator("portfolio_website", mode="before")(_safe_url)
    _sk = field_validator("skills", mode="before")(_coerce_str_list)
    _ach = field_validator("achievements", mode="before")(_coerce_str_list)

    @field_validator("links", mode="before")
    @classmethod
    def _links(cls, v):
        # LLM sometimes emits null or a list; normalise to an object.
        return v if isinstance(v, dict) else {}

    @field_validator("education", "experience", "projects", mode="before")
    @classmethod
    def _drop_non_dict_rows(cls, v):
        # Tolerate a single object where a list is expected, and drop stray non-object entries.
        if isinstance(v, dict):
            return [v]
        if not isinstance(v, (list, tuple)):
            return []
        return [item for item in v if isinstance(item, dict)]
