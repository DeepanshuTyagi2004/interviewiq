"""Text comparison form shared by grounding and merging. Pure."""
from __future__ import annotations

_TRANSLATE = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "‑": "-",
                            "*": " ", "#": " ", "|": " ", "`": " ", ">": " ", "_": " ", " ": " "})


def clean(text: str) -> str:
    """Typographic quotes/dashes unified, markdown markers dropped, whitespace collapsed,
    casefolded. Used only for comparison, never stored."""
    return " ".join((text or "").translate(_TRANSLATE).split()).casefold()
