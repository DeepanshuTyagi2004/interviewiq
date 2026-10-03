"""Conservative cross-source geography corroboration for exact official requisitions."""
from __future__ import annotations

import re

from app.research.normalize.sources import FOREIGN, INDIA
from app.research.normalize.titles import contains_key, job_ids, norm_text, role_section

_EMPLOYMENT = {
    "intern": re.compile(r"\bintern(?:ship)?\b", re.I),
    "contract": re.compile(r"\bcontract(?:ual)?\b", re.I),
    "full_time": re.compile(r"\bfull[ -]?time\b|\bpermanent\b", re.I),
}
_HQ = re.compile(r"\bheadquarters?\b|\bHQ\b|\bhead office\b", re.I)
_JOB_SCOPE = re.compile(r"\b(?:job|role|position|location|based|work|working|hiring|candidate|remote|relocat\w*)\b", re.I)


def employment_signals(text: str) -> set[str]:
    return {kind for kind, pattern in _EMPLOYMENT.items() if pattern.search(text)}


def _foreign_job_context(section: str, company_names: list[str]) -> bool:
    """Corporate introductions are not job locations (nor evidence for India).

    Official postings may include a multinational company overview, mentioning global offices
    and dollar-denominated payment volume. Ignore only standalone company-introduction
    paragraphs without any job-scope language. Foreign job metadata/prose still vetoes.
    """
    for paragraph in re.split(r"\n\s*\n", section):
        if not FOREIGN.search(paragraph):
            continue
        introduction = any(re.match(rf"\s*{re.escape(name)}\s+is\b", paragraph, re.I)
                           for name in company_names if name)
        corporate = re.search(r"\bcompany\b|\bheadquartered\b", paragraph, re.I)
        if introduction and corporate and not _JOB_SCOPE.search(paragraph):
            continue
        return True
    return False


def corroborate(entry: dict, *, book, claims: list[dict], company_names: list[str]) -> dict | None:
    """Promote only an otherwise-grounded passage with one matching official India job code.

    Geography comes from a validated role-location/employment passage, never company geography.
    Retaining the original claim is necessary for numeric units and full-length source quotes.
    """
    if entry.get("reason") != "geo_unconfirmed":
        return None
    claim = entry.get("_claim") or entry
    if claim["field"] not in {"interview_process", "jd"} and not entry.get("_claim"):
        return None
    source = book.sources.get(claim["url"], {})
    text = source.get("content") or ""
    section = role_section(claim["quote"], text, book.known)
    if not section:
        return None
    heading = source.get("title") or ""
    if not any(contains_key(norm_text(heading + " " + section), norm_text(n)) for n in company_names):
        return None
    if ((claim.get("geo") or "unknown").casefold() not in {"unknown", "in", "india", ""}
            or FOREIGN.search(section + " " + heading + " " + (claim.get("geo_quote") or ""))):
        return None
    rid, reason, _ = book.assign(claim)
    if reason is not None:
        return None
    signals = employment_signals(section + " " + heading)
    if signals and signals != {rid[1]}:
        return None
    candidate_codes = set(re.findall(r"(?<![\w-])[A-Za-z]{2,}-[A-Za-z0-9-]*\d[A-Za-z0-9-]*(?![\w-])",
                                     heading + " " + section))
    candidate_codes = {code.upper() for code in candidate_codes}
    matches = []
    for anchor in claims:
        if (anchor.get("tier") != 1 or anchor["field"] not in {"location", "employment_type"}
                or anchor["url"] == claim["url"]):
            continue
        anchor_rid, anchor_reason, _ = book.assign(anchor)
        if anchor_reason or anchor_rid != rid or not INDIA.search(anchor["quote"]) or _HQ.search(anchor["quote"]):
            continue
        official = book.sources.get(anchor["url"], {})
        anchor_text = official.get("content") or ""
        anchor_section = role_section(anchor["quote"], anchor_text, book.known)
        if not anchor_section or _foreign_job_context(anchor_section, company_names):
            continue
        if employment_signals(anchor_section) != {rid[1]}:
            continue
        codes = job_ids([anchor["url"]], [official.get("title") or "", anchor.get("role_title") or ""])
        for code in codes:
            # Exact tokens, including punctuation: DEV-BE01 must not match DEV-BE010 or DEVBE01.
            if candidate_codes == {code}:
                matches.append((code, anchor["url"]))
    if len({code for code, _ in matches}) != 1:
        return None
    code = matches[0][0]
    return {**claim, "source_type": source.get("source_type"), "tier": source.get("tier"),
            "corroborating_urls": sorted({url for _, url in matches}),
            "corroboration_note": f"India job geography derived/corroborated by exact official job code {code}; "
                                  "matching company, role and employment variant"}
