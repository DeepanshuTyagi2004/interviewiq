"""LinkedIn "Save to PDF" file -> plain text. Stateless: bytes are never stored or logged.

Plain extraction (no bold/indent markers, unlike the resume reader) keeps the text the extractor
quotes identical to the text the evidence gate checks. LinkedIn's export has a recognisable shape:
a sidebar "Contact" block carrying ``www.linkedin.com/in/<slug> (LinkedIn)`` and a ``Page N of M``
footer on every page. A resume that merely links to LinkedIn lacks both, so it is rejected with a
pointer to the Resume source instead of being imported as LinkedIn evidence.
"""
from __future__ import annotations

import io
import re

from pypdf import PdfReader

from app.linkedin.url import canonical_profile_url

MAX_PDF_BYTES = 5 * 1024 * 1024
MAX_TEXT_CHARS = 50_000
_MIN_USEFUL_CHARS = 200

_PAGE_FOOTER = re.compile(r"^\s*Page \d+ of \d+\s*$", re.MULTILINE)
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# The sidebar column is narrow, so a long slug can wrap onto the next line before "(LinkedIn)".
_PROFILE_LINK = re.compile(r"linkedin\.com/in/([A-Za-z0-9_%-]+(?:\s*\n\s*[A-Za-z0-9_%-]+)*)\s*\(LinkedIn\)", re.IGNORECASE)
_ANY_PROFILE_LINK = re.compile(r"linkedin\.com/in/[A-Za-z0-9_%-]+", re.IGNORECASE)


class LinkedInPdfError(ValueError):
    """Constant user-facing reasons only; never include file contents."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _unreadable() -> LinkedInPdfError:
    return LinkedInPdfError("linkedin_pdf_unreadable", "We couldn't read text from this PDF. Download it again with LinkedIn's Save to PDF and upload that file.")


def _unrecognized() -> LinkedInPdfError:
    return LinkedInPdfError("linkedin_pdf_unrecognized", "This doesn't look like LinkedIn's Save to PDF file. Follow the steps to download it from your profile; a resume belongs in the Resume source.")


def _plain_text(pdf_bytes: bytes) -> str:
    if not pdf_bytes.startswith(b"%PDF-"):
        raise _unreadable()
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        if reader.is_encrypted:
            reader.decrypt("")
        parts = [page.extract_text() or "" for page in reader.pages]
    except Exception:  # noqa: BLE001 — corrupt, encrypted or malformed files are all "unreadable"
        raise _unreadable() from None
    return "\n".join(parts)


def _source_url(text: str) -> str | None:
    match = _PROFILE_LINK.search(text)
    if not match:
        return None
    try:
        return canonical_profile_url("https://www.linkedin.com/in/" + re.sub(r"\s+", "", match[1]) + "/")
    except ValueError:
        return None  # e.g. a percent-encoded vanity slug; the import still works without a link


def profile_text(pdf_bytes: bytes) -> tuple[str, str | None]:
    """Return (text for the extractor, canonical profile URL or None). Raises LinkedInPdfError."""
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise LinkedInPdfError("linkedin_pdf_too_large", "The LinkedIn PDF must be 5 MB or smaller.")
    raw = _plain_text(pdf_bytes)
    if len(raw.strip()) < _MIN_USEFUL_CHARS:
        raise _unreadable()
    has_footer = _PAGE_FOOTER.search(raw) is not None
    if not _ANY_PROFILE_LINK.search(raw) or not (has_footer or _PROFILE_LINK.search(raw)):
        raise _unrecognized()
    source_url = _source_url(raw)
    # Footers split sentences across pages and contacts are never imported, so neither reaches the LLM.
    text = _EMAIL.sub("[email]", _PAGE_FOOTER.sub("", raw))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > MAX_TEXT_CHARS:
        raise LinkedInPdfError("linkedin_pdf_too_large", "This PDF has more text than a LinkedIn profile export. Upload the file from LinkedIn's Save to PDF.")
    return text, source_url
