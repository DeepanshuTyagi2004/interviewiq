"""Post-processing for parsed resumes: put back the bullet nesting the LLM tends to flatten.

The extractor encodes each line's indent level as leading spaces (two per level). Models keep
bold and bullet markers reliably but often ignore that whitespace, so a sub-bullet comes back as
a top-level "- ". Here each returned bullet is matched back to its source line by its text, and
the source's indent — relative to the shallowest bullet in the same role/project — is re-applied.
Lines that can't be matched are left exactly as the model wrote them.
"""
from __future__ import annotations

import re

from app.models.resume import ParsedResume

# A Markdown list line: indent, marker ("- " / "* " / "1. "), text.
_LIST_LINE = re.compile(r"^(?P<indent>\s*)(?P<marker>[-*]|\d+[.)])\s+(?P<text>.*)$")
_GLYPHS = re.compile(r"^[\s•▪◦●○■□‣⁃–—\-*]+")
_KEY_CHARS = 32


def _key(text: str) -> str:
    """Comparable form of a line: no bold markers, bullet glyphs or spacing, lower-cased."""
    plain = _GLYPHS.sub("", text.replace("**", ""))
    return re.sub(r"\s+", " ", plain).strip().lower()[:_KEY_CHARS]


def _source_levels(source_text: str) -> dict[str, int]:
    levels: dict[str, int] = {}
    for line in source_text.splitlines():
        key = _key(line)
        if len(key) >= 8 and key not in levels:
            levels[key] = (len(line) - len(line.lstrip(" "))) // 2
    return levels


def _level_of(text: str, levels: dict[str, int]) -> int | None:
    key = _key(text)
    if key in levels:
        return levels[key]
    # The model may have joined a wrapped line, so the key can be longer than the source line's.
    for src, level in levels.items():
        if len(src) >= 16 and (key.startswith(src[:24]) or src.startswith(key[:24])):
            return level
    return None


def _renest(bullets: list[str], levels: dict[str, int]) -> list[str]:
    parsed = [(_LIST_LINE.match(b), b) for b in bullets]
    found = [_level_of(m.group("text"), levels) if m else None for m, _ in parsed]
    known = [lvl for (m, _), lvl in zip(parsed, found) if m and lvl is not None]
    if not known:
        return bullets
    base = min(known)
    out: list[str] = []
    for (m, original), lvl in zip(parsed, found):
        if not m or lvl is None:
            out.append(original)
            continue
        out.append(f"{'  ' * (lvl - base)}{m.group('marker')} {m.group('text')}")
    return out


def restore_nesting(parsed: ParsedResume, source_text: str) -> ParsedResume:
    """Return a copy of `parsed` whose highlight bullets carry the source's nesting."""
    levels = _source_levels(source_text)
    if not levels:
        return parsed
    experience = [e.model_copy(update={"bullets": _renest(e.bullets, levels)}) for e in parsed.experience]
    projects = [p.model_copy(update={"bullets": _renest(p.bullets, levels)}) for p in parsed.projects]
    return parsed.model_copy(update={"experience": experience, "projects": projects})
