"""Company identity helpers (spec §3.2 resolve): slugs, name keys, domains, duplicate detection.
Pure functions. slugify() MUST stay byte-identical to apps/api/src/domain/slug.ts."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlparse

_SUFFIX_WORDS = frozenset({
    "private", "pvt", "limited", "ltd", "inc", "llc", "llp", "plc", "technologies", "technology", "tech",
    "india", "corp", "corporation", "co", "company", "labs", "software", "solutions", "services", "group",
})


def _ascii_fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


def slugify(name: str) -> str:
    s = _ascii_fold(name).lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def name_key(name: str) -> str:
    """Compact comparison key: "Zoho Corporation Pvt. Ltd." → "zoho". Strips trailing corporate
    words but always keeps the first word, so "Services" alone stays "services"."""
    words = re.findall(r"[a-z0-9]+", _ascii_fold(name).lower())
    while len(words) > 1 and words[-1] in _SUFFIX_WORDS:
        words.pop()
    return "".join(words)


def domain_of(url: str | None) -> str | None:
    if not url:
        return None
    s = url.strip()
    if "://" not in s:
        s = "https://" + s
    try:
        host = urlparse(s).hostname
    except ValueError:  # e.g. "http://[bad": an unbalanced IPv6 bracket
        return None
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def _keys(name: str | None, aliases: list[str] | None) -> set[str]:
    return {k for k in (name_key(n) for n in [name or "", *(aliases or [])]) if k}


def find_possible_duplicates(identity: dict, others: list[dict]) -> list[dict]:
    keys = _keys(identity.get("name"), identity.get("aliases"))
    domain = domain_of(identity.get("website"))
    found: list[dict] = []
    for other in others:
        reasons: list[str] = []
        if keys & _keys(other.get("name"), other.get("aliases")):
            reasons.append("name")
        if domain and domain == domain_of(other.get("website")):
            reasons.append("website")
        if reasons:
            found.append({"type": "possible_duplicate", "company_id": other["id"],
                          "company_name": other.get("name"), "reasons": reasons})
    return found
