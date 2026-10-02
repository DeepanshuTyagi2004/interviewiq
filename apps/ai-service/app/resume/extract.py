"""Resume PDF -> text that keeps the resume's formatting.

pypdf reads the text layer only — it does NOT OCR. A scanned/photographed resume (image-only
PDF) yields little or no text; we raise ResumeExtractError so the caller returns a clean 422 and
the UI falls back to manual entry rather than feeding the LLM an empty page.

Plain text extraction loses the two things that carry a resume's structure, so we keep them:

- **Bold.** Every text run reports its font; runs set in a bold face (Arial-BoldMT,
  Calibri-Bold, Inter-SemiBold, …) are wrapped in ``**…**``.
- **Indentation.** Bullets are often drawn as shapes rather than text, so the only trace of a
  bullet — or a nested one — is how far its line is indented. Each line's left edge is mapped to
  an indent level (two leading spaces per level), clustered per page.

The parse prompt turns these hints into clean Markdown lines (``- `` bullets, ``  - `` nested
bullets, plain sub-headings, bold kept where the resume has it). If the formatting-aware pass
recovers noticeably less text than plain extraction (odd font encodings), we fall back to plain.
"""
from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field

from pypdf import PdfReader
from pypdf.errors import PdfReadError

logger = logging.getLogger(__name__)

# Below this, treat the PDF as unreadable (image-only scan, empty, or garbled). A real one-page
# resume is comfortably 800-3000 chars; 40 is well under any genuine resume but filters noise.
_MIN_USEFUL_CHARS = 40

# Font-name markers for a bold face. Matched case-insensitively against /BaseFont.
_BOLD_FONT = re.compile(r"bold|black|heavy|semibold|demi", re.IGNORECASE)
# Left edges within this many points belong to the same indent level.
_INDENT_TOLERANCE_PT = 3.0
# Lines starting further right than this are centred/right-aligned text, not indentation.
_MAX_INDENT_PT = 110.0
_MAX_LEVELS = 3
# The formatting pass must recover at least this share of the plain pass's text to be trusted.
_MIN_FORMATTED_RATIO = 0.8


class ResumeExtractError(ValueError):
    """The PDF could not be turned into usable text (corrupt, encrypted, or image-only)."""


@dataclass
class _Line:
    x: float | None = None
    segments: list[tuple[str, bool]] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "".join(t for t, _ in self.segments)


def _is_bold(font: object) -> bool:
    try:
        name = str(font.get("/BaseFont", "")) if font else ""  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001 — a malformed font dict just means "not bold"
        return False
    return bool(_BOLD_FONT.search(name))


def _user_x(cm: list[float] | None, tm: list[float] | None) -> float | None:
    """Horizontal position of a run in page space (text matrix through the CTM, no rotation)."""
    if not tm:
        return None
    if not cm:
        return float(tm[4])
    return float(cm[0] * tm[4] + cm[2] * tm[5] + cm[4])


def render_segments(segments: list[tuple[str, bool]]) -> str:
    """Join a line's (text, is_bold) runs into Markdown: adjacent runs of the same weight merge,
    bold runs become **…** with surrounding whitespace kept outside the markers."""
    merged: list[list] = []
    for text, bold in segments:
        if merged and merged[-1][1] == bold:
            merged[-1][0] += text
        else:
            merged.append([text, bold])
    out: list[str] = []
    for text, bold in merged:
        core = text.strip()
        if bold and core:
            lead = text[: len(text) - len(text.lstrip())]
            trail = text[len(text.rstrip()):]
            out.append(f"{lead}**{core}**{trail}")
        else:
            out.append(text)
    return re.sub(r"[ \t]+", " ", "".join(out)).strip()


def _page_lines(page) -> list[_Line]:
    lines: list[_Line] = [_Line()]

    def visit(text, cm, tm, font, size):  # pypdf's visitor_text signature
        if not text:
            return
        bold = _is_bold(font)
        for i, part in enumerate(text.split("\n")):
            if i > 0:
                lines.append(_Line())
            if not part:
                continue
            line = lines[-1]
            if line.x is None and part.strip():
                line.x = _user_x(cm, tm)
            line.segments.append((part, bold))

    page.extract_text(visitor_text=visit)
    return [ln for ln in lines if ln.text.strip()]


def _indent_levels(lines: list[_Line]) -> dict[int, int]:
    """Map each line (by index) to an indent level from its left edge, clustered per page."""
    xs = sorted(ln.x for ln in lines if ln.x is not None)
    if not xs:
        return {}
    base = xs[0]
    clusters: list[float] = []
    for x in xs:
        if x - base > _MAX_INDENT_PT:
            break
        if not clusters or x - clusters[-1] > _INDENT_TOLERANCE_PT:
            clusters.append(x)
    levels: dict[int, int] = {}
    for i, ln in enumerate(lines):
        if ln.x is None or ln.x - base > _MAX_INDENT_PT:
            levels[i] = 0
            continue
        level = max(j for j, c in enumerate(clusters) if ln.x >= c - _INDENT_TOLERANCE_PT)
        levels[i] = min(level, _MAX_LEVELS)
    return levels


def _formatted_page(page) -> str:
    lines = _page_lines(page)
    levels = _indent_levels(lines)
    return "\n".join("  " * levels.get(i, 0) + render_segments(ln.segments) for i, ln in enumerate(lines))


def _open(pdf_bytes: bytes) -> PdfReader:
    if not pdf_bytes:
        raise ResumeExtractError("empty file")
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except (PdfReadError, OSError, ValueError) as exc:
        raise ResumeExtractError(f"not a readable PDF ({type(exc).__name__})") from exc
    if reader.is_encrypted:
        # Try the common empty-password case; give up if it's truly locked.
        try:
            reader.decrypt("")
        except Exception as exc:  # noqa: BLE001 — any decrypt failure means we can't read it
            raise ResumeExtractError("password-protected PDF") from exc
    return reader


def extract_text(pdf_bytes: bytes) -> str:
    """Extract the text layer of a resume PDF with bold (**…**) and indentation (two spaces per
    level) preserved. Raises ResumeExtractError when the bytes aren't a readable, text-bearing PDF."""
    reader = _open(pdf_bytes)
    plain_parts: list[str] = []
    formatted_parts: list[str] = []
    try:
        for page in reader.pages:
            try:
                plain_parts.append(page.extract_text() or "")
            except Exception as exc:  # noqa: BLE001 — one bad page must not lose the rest
                logger.warning("[resume] page extract failed (%s: %s)", type(exc).__name__, exc)
                continue
            try:
                formatted_parts.append(_formatted_page(page))
            except Exception as exc:  # noqa: BLE001 — formatting is best-effort; plain still counts
                logger.warning("[resume] formatted extract failed (%s: %s)", type(exc).__name__, exc)
                formatted_parts.append(plain_parts[-1])
    except PdfReadError as exc:
        # A still-encrypted doc (wrong/blank password) raises FileNotDecryptedError while the pages
        # iterator advances — outside the per-page guard above. Surface it as a clean 422.
        raise ResumeExtractError("password-protected or unreadable PDF") from exc

    plain = "\n".join(plain_parts).strip()
    if len(plain) < _MIN_USEFUL_CHARS:
        raise ResumeExtractError(
            "no extractable text — the resume is likely a scanned image (no OCR); enter details manually"
        )
    formatted = "\n".join(formatted_parts).strip()
    visible = re.sub(r"\*\*|\s", "", formatted)
    if len(visible) < _MIN_FORMATTED_RATIO * len(re.sub(r"\s", "", plain)):
        logger.info("[resume] formatted pass recovered too little text; using plain extraction")
        return plain
    return formatted
