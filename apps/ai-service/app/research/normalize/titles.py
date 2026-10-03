"""Role identity and role-section resolution (evidence-hardening spec §8.1–8.2). Pure functions.

title_key() makes punctuation, dashes, job codes and I/II/III vs 1/2/3 irrelevant, but never
expands abbreviations ("SDE" stays distinct from "Software Development Engineer") and keeps
different numbers different. A role-specific passage belongs to a role when the role's title is in
the passage, in the page title of a single-role page, or is the nearest title above the passage."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlsplit

_ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4"}
_JOB_CODE = r"[A-Za-z]{2,}[-_ ]?[A-Za-z0-9-]*\d[A-Za-z0-9-]*"
_PAREN_CODE = re.compile(rf"\(\s*({_JOB_CODE})\s*\)")
_URL_CODE = re.compile(r"^[A-Za-z]{2,}-[A-Za-z0-9-]*\d[A-Za-z0-9-]*$")
_ELLIPSIS = re.compile(r"…|\.\.\.|\[\s*(?:…|\.\.\.)\s*\]")


def norm_text(text: str) -> str:
    spaced = re.sub(r"[\W_]+", " ", text or "")
    folded = unicodedata.normalize("NFKD", spaced).encode("ascii", "ignore").decode().lower()
    tokens = re.sub(r"[^a-z0-9]+", " ", folded).split()
    return " ".join(_ROMAN.get(t, t) for t in tokens)


def title_key(title: str) -> str:
    return norm_text(_PAREN_CODE.sub(" ", title or ""))


def contains_key(haystack: str, key: str) -> bool:
    return bool(key) and f" {key} " in f" {haystack} "


def _starts(haystack: str, key: str) -> list[int]:
    padded, needle, out, i = f" {haystack} ", f" {key} ", [], 0
    while key and (i := padded.find(needle, i)) >= 0:
        out.append(i)
        i += 1
    return out


def job_ids(urls: list[str], titles: list[str]) -> list[str]:
    found: list[str] = []
    for url in urls:
        segment = urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]
        if _URL_CODE.match(segment):
            found.append(segment.upper())
    for title in titles:
        found += [m.upper() for m in _PAREN_CODE.findall(title or "")]
    return list(dict.fromkeys(found))


def employment_from_title(title: str) -> str | None:
    tokens = set(title_key(title).split())
    if tokens & {"intern", "internship"}:
        return "intern"
    if tokens & {"contract", "contractual"}:
        return "contract"
    return None


def _distinct(keys: set[str], key: str) -> set[str]:
    """Other known titles, ignoring ones contained in `key` ("SDE" inside "SDE Frontend")."""
    return {k for k in keys if k and k != key and not contains_key(key, k)}


def _single_page_title_role(page_title: str, known_keys: set[str]) -> str | None:
    pt = norm_text(page_title)
    present = {k for k in known_keys if contains_key(pt, k)}
    longest = {k for k in present if not any(o != k and contains_key(o, k) for o in present)}
    return next(iter(longest)) if len(longest) == 1 else None


def _nearest_title(quote: str, text: str, keys: set[str]) -> str | None:
    first = next((p for p in (norm_text(x) for x in _ELLIPSIS.split(quote or "")) if p), "")
    t = norm_text(text)
    pos = t.find(first) if first else -1
    if pos < 0:
        return None
    best: tuple[int, int, str] | None = None
    for key in keys:
        before = [s for s in _starts(t, key) if s + len(key) <= pos]
        if before:
            cand = (before[-1], len(key), key)
            best = cand if best is None or cand[:2] > best[:2] else best
    return best[2] if best else None


def _heading_keys(text: str) -> set[str]:
    """Recognize clear standalone engineering headings, including undiscovered roles."""
    found = set()
    for line in text.splitlines():
        label = line.strip().strip("#* ")
        if (len(label) <= 120 and not re.search(r"[.!?;]", label)
                and re.match(r"(?:software|backend|frontend|data|SDE\b|SWE\b|SDET\b)", label, re.I)
                and re.search(r"\b(?:engineer|developer|scientist|analyst|SDE|SWE|SDET)\b", label, re.I)
                and not re.search(r"\b(?:builds?|years?|experience|skills?|we|you|our|hiring)\b", label, re.I)):
            found.add(title_key(label))
    return found


def role_in_context(key: str, *, quote: str, geo_quote: str, page_title: str, text: str,
                    known_keys: set[str]) -> bool:
    keys = {*known_keys, key}
    # A section on a multi-role page outranks the page's SEO title. A separate geography
    # passage must not lend its role identity to an unrelated claim passage.
    return infer_role(quote=quote, page_title=page_title, text=text, known_keys=keys) == key


def infer_role(*, quote: str, page_title: str, text: str, known_keys: set[str]) -> str | None:
    """The role a passage with no stated role belongs to, or None when the page does not say."""
    keys = known_keys | _heading_keys(text)
    return (_single_page_title_role(quote, keys) or _nearest_title(quote, text, keys)
            or _single_page_title_role(page_title, keys))


def role_section(quote: str, text: str, known_keys: set[str]) -> str:
    """The heading-bounded section containing a unique passage; ambiguity returns no section."""
    known_keys = known_keys | _heading_keys(text)
    lines = text.splitlines(keepends=True)
    starts, offset = [], 0
    for line in lines:
        normalized = title_key(line.strip().strip("#* "))
        if any(normalized == k or normalized.startswith(k + " ") for k in known_keys):
            starts.append(offset)
        offset += len(line)
    needle = next((p.strip() for p in _ELLIPSIS.split(quote or "") if p.strip()), "")
    if not needle or text.count(needle) != 1:
        return ""
    pos = text.find(needle)
    begin = max((s for s in starts if s <= pos), default=0)
    end = min((s for s in starts if s > pos), default=len(text))
    return text[begin:end]
