"""Résumé PDF -> plain text.

pypdf extracts the text layer only — it does NOT OCR. A scanned/photographed résumé (image-only
PDF) yields little or no text; we raise ResumeExtractError so the caller returns a clean 422 and
the UI falls back to manual entry rather than feeding the LLM an empty page.
"""
from __future__ import annotations

import io
import logging

from pypdf import PdfReader
from pypdf.errors import PdfReadError

logger = logging.getLogger(__name__)

# Below this, treat the PDF as unreadable (image-only scan, empty, or garbled). A real one-page
# résumé is comfortably 800-3000 chars; 40 is well under any genuine résumé but filters noise.
_MIN_USEFUL_CHARS = 40


class ResumeExtractError(ValueError):
    """The PDF could not be turned into usable text (corrupt, encrypted, or image-only)."""


def extract_text(pdf_bytes: bytes) -> str:
    """Extract and lightly normalise the text layer of a résumé PDF. Raises ResumeExtractError
    when the bytes aren't a readable, text-bearing PDF."""
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

    parts: list[str] = []
    try:
        for page in reader.pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception as exc:  # noqa: BLE001 — one bad page must not lose the rest
                logger.warning("[resume] page extract failed (%s: %s)", type(exc).__name__, exc)
    except PdfReadError as exc:
        # A still-encrypted doc (wrong/blank password) raises FileNotDecryptedError while the pages
        # iterator advances — outside the per-page guard above. Surface it as a clean 422.
        raise ResumeExtractError("password-protected or unreadable PDF") from exc
    text = "\n".join(parts).strip()

    if len(text) < _MIN_USEFUL_CHARS:
        raise ResumeExtractError(
            "no extractable text — the résumé is likely a scanned image (no OCR); enter details manually"
        )
    return text
