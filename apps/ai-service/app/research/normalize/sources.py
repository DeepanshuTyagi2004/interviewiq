"""Source classification (evidence-hardening spec §5): tiers and source types by domain, India
signals, and the relevance filter that runs before any LLM call. Pure functions.

The domain lists are product configuration: edit them here, in one place."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from app.research.normalize.identity import domain_of
from app.research.normalize.text import clean


@dataclass(frozen=True)
class SourceClass:
    source_type: str
    tier: int


# Tier 2 and 3 source types, matched by host suffix (subdomains match). Order matters only for
# overlaps, which there are none of.
SOURCE_TYPES: tuple[tuple[str, int, tuple[str, ...]], ...] = (
    ("business_database", 2, ("tracxn.com", "crunchbase.com", "pitchbook.com", "cbinsights.com", "tofler.in",
                              "zaubacorp.com", "multiples.vc")),
    ("news", 2, ("inc42.com", "entrackr.com", "economictimes.indiatimes.com", "livemint.com", "moneycontrol.com",
                 "business-standard.com", "financialexpress.com", "thehindubusinessline.com", "yourstory.com",
                 "techcrunch.com", "reuters.com", "bloomberg.com")),
    ("review_platform", 2, ("ambitionbox.com", "glassdoor.com", "glassdoor.co.in", "indeed.com", "teamblind.com")),
    ("salary_platform", 2, ("levels.fyi", "6figr.com", "naukri.com")),
    ("community", 3, ("linkedin.com", "reddit.com", "medium.com", "geeksforgeeks.org", "leetcode.com", "quora.com",
                      "dev.to", "hashnode.dev", "substack.com", "blogspot.com", "t.me")),
    ("job_repost", 3, ("tnpofficer.com", "jobdexo.com", "freshersworld.com", "desiqna.in", "offcampusjobs4u.com",
                       "foundit.in")),
)
# Applicant-tracking hosts: official only when the URL carries the company's slug.
ATS_HOSTS = ("lever.co", "greenhouse.io", "ashbyhq.com", "myworkdayjobs.com", "darwinbox.in", "keka.com",
             "smartrecruiters.com")
# Review platforms all rate on five-point scales.
FIVE_POINT_TYPES = frozenset({"review_platform"})
# Non-.in hosts whose content is India-specific.
INDIA_PLATFORM_HOSTS = ("ambitionbox.com", "naukri.com", "in.indeed.com", "6figr.com", "inc42.com", "entrackr.com",
                        "economictimes.indiatimes.com", "livemint.com", "moneycontrol.com", "business-standard.com",
                        "financialexpress.com", "thehindubusinessline.com", "yourstory.com", "tnpofficer.com",
                        "freshersworld.com", "offcampusjobs4u.com")

_CITIES: dict[str, str] = {
    "bengaluru": "Bengaluru", "bangalore": "Bengaluru", "hyderabad": "Hyderabad", "pune": "Pune",
    "mumbai": "Mumbai", "bombay": "Mumbai", "new delhi": "Delhi", "delhi": "Delhi", "gurugram": "Gurugram",
    "gurgaon": "Gurugram", "noida": "Noida", "chennai": "Chennai", "madras": "Chennai", "kolkata": "Kolkata",
    "calcutta": "Kolkata", "ahmedabad": "Ahmedabad", "kochi": "Kochi", "cochin": "Kochi", "jaipur": "Jaipur",
    "chandigarh": "Chandigarh", "coimbatore": "Coimbatore", "indore": "Indore",
    "thiruvananthapuram": "Thiruvananthapuram", "trivandrum": "Thiruvananthapuram", "mysuru": "Mysuru",
    "mysore": "Mysuru", "bhubaneswar": "Bhubaneswar", "nagpur": "Nagpur",
}
_CITY_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, _CITIES), key=len, reverse=True)) + r")\b", re.I)
INDIA = re.compile(r"\b(india|indian|" + "|".join(sorted(map(re.escape, _CITIES), key=len, reverse=True)) + r")\b", re.I)
FOREIGN = re.compile(r"\b(USD|EUR|GBP|CAD|SGD|united states|USA|singapore|london|canada|united kingdom)\b|[$€£]", re.I)
_INR = re.compile(r"₹|\bINR\b|\bRs\.?(?=\s|\d)|\bLPA\b|\blakhs?\b|\blacs?\b|\bcrores?\b", re.I)


def _host_matches(host: str | None, domain: str) -> bool:
    return bool(host) and (host == domain or host.endswith("." + domain))


def _tokens(url: str) -> list[str]:
    parts = urlsplit(url if "://" in url else "https://" + url)
    return [t for t in re.split(r"[./]", (parts.hostname or "") + "/" + parts.path.lower()) if t]


def _slug_in(url: str, slug: str) -> bool:
    slug = slug.lower()
    return any(t == slug or t.startswith(slug + "-") or t == slug.replace("-", "") for t in _tokens(url))


def classify_source(url: str, *, company_domain: str | None, company_slug: str | None) -> SourceClass:
    host = domain_of(url)
    if company_domain and _host_matches(host, company_domain.lower()):
        return SourceClass("official", 1)
    if company_slug and any(_host_matches(host, ats) for ats in ATS_HOSTS) and _slug_in(url, company_slug):
        return SourceClass("official_job_posting", 1)
    for source_type, tier, domains in SOURCE_TYPES:
        if any(_host_matches(host, d) for d in domains):
            return SourceClass(source_type, tier)
    return SourceClass("other", 3)


def has_inr_marker(text: str) -> bool:
    return bool(_INR.search(text or ""))


def is_india_platform(url: str) -> bool:
    host = domain_of(url) or ""
    return host.endswith(".in") or any(_host_matches(host, d) for d in INDIA_PLATFORM_HOSTS)


def role_section(text: str, quote: str, role_title: str | None = None) -> str | None:
    """Locate one unambiguous role section; never cross role headings or corporate footers.

    A title supplied by a model is only a selector, not evidence. Multiple matching sections or
    stitched passages across sections deliberately yield no scope.
    """
    lines = text.splitlines(keepends=True)
    headings, footers = [], []
    pos = 0
    for line in lines:
        label = line.strip().strip("#* ")
        if (re.match(r"(?:footer\b|about (?:us|the company)\b)", label, re.I)
                or re.search(r"\b(?:copyright|headquarters|registered office|corporate office|head office|contact us)\b|©",
                             label, re.I)):
            footers.append(pos)
        if (len(label) <= 120 and not re.search(r"[.!?;]", label)
                and re.search(r"\b(?:engineer|developer|SDE|SWE)\b", label, re.I)
                and "|" not in label and not re.search(r"\bcareers\b", label, re.I)
                and not re.search(r"\b(?:years?|experience|skills?|we|you|our|seeking|hiring)\b", label, re.I)):
            headings.append(pos)
        pos += len(line)
    # Site navigation may include About us / Contact us before the actual job heading. Ignore
    # that prelude when real role headings exist; page-title chrome is not a second role section.
    boundaries = sorted(set(headings)) if headings else [0]
    boundaries.append(len(text))
    pieces = [clean(p) for p in re.split(r"…|\.\.\.", quote) if clean(p)]
    matches = []
    for start, stop in zip(boundaries, boundaries[1:]):
        stop = min((p for p in footers if start <= p < stop), default=stop)
        section = text[start:stop]
        normalized = clean(section)
        if pieces and all(p in normalized for p in pieces):
            if role_title and headings and clean(role_title) not in normalized:
                continue
            matches.append(section)
    return matches[0] if len(matches) == 1 else None


def foreign_role_context(section: str) -> bool:
    """Foreign role/pay evidence blocks propagation; explicit corporate metrics/footprint do not.

    This is only a contextual veto. A foreign marker in the claim's own quote or geo_quote is
    still rejected directly by india_signal, even when it describes a corporate fact.
    """
    for sentence in re.split(r"(?<=[.!?])\s+|\n", section):
        if not FOREIGN.search(sentence):
            continue
        role_or_pay = re.search(r"\b(?:role|position|job|opening|candidate|salary|compensation|CTC|"
                                r"base pay|based in|work location|relocat\w*|hybrid|remote)\b", sentence, re.I)
        corporate_metric = re.search(r"\b(?:payment volume|TPV|revenue|market cap|valuation)\b", sentence, re.I)
        corporate_footprint = (re.search(r"\b(?:headquartered|global network|company|corporate)\b", sentence, re.I)
                               and re.search(r"\b(?:operates across|offices in|presence in)\b", sentence, re.I))
        if not role_or_pay and (corporate_metric or corporate_footprint):
            continue
        return True
    return False


def local_location_quote(text: str, quote: str, role_title: str | None = None) -> str:
    """Only an explicit location/job metadata line in the same role section can propagate."""
    section = role_section(text, quote, role_title)
    if not section or foreign_role_context(section):
        return ""
    lines = section.splitlines(keepends=True)
    for index, line in enumerate(lines):
        # Single-line source snippets are accepted only for an explicit location/job header.
        if (len(line) <= 300 and INDIA.search(line)
                and re.search(r"\b(?:location|based in|full[ -]?time|part[ -]?time|intern(?:ship)?)\b", line, re.I)):
            return line.strip()
        # Job metadata often renders as "Full-Time\n\nMumbai" or "Location:\nBangalore".
        # Only join adjacent metadata lines, not a city buried in the description or footer.
        label = line.strip().strip("#* ").rstrip(":").strip()
        if re.fullmatch(r"(?:location|job location|based in|full[ -]?time|part[ -]?time|intern(?:ship)?)", label, re.I):
            for end in range(index + 1, min(index + 4, len(lines))):
                city = lines[end].strip().strip("#* ")
                if not city:
                    continue
                place = " ".join(city.replace(",", " ").split()).casefold()
                if place == "india" or place.removesuffix(" india") in _CITIES:
                    return "".join(lines[index:end + 1]).strip()
                break
    return ""


def india_signal(*, geo: str, geo_quote: str, quote: str, url: str, tier: int,
                 text: str, role_title: str | None = None) -> Literal["india", "foreign", "unknown"]:
    """Whether a claim is India-specific (spec §5.2). The caller has already checked that
    `geo_quote` is verbatim in the source; this only judges what the passages say."""
    if FOREIGN.search(quote or "") or FOREIGN.search(geo_quote or ""):
        return "foreign"
    if (geo or "").casefold() in {"us", "usa", "uk", "gb", "sg", "ca", "foreign"}:
        return "foreign"
    if INDIA.search(quote or "") or INDIA.search(geo_quote or ""):
        return "india"
    if has_inr_marker(quote) or is_india_platform(url):
        return "india"
    if tier == 1 and local_location_quote(text, quote, role_title):
        return "india"
    return "unknown"


def canonical_city(text: str) -> str | None:
    m = _CITY_RE.search(text or "")
    return _CITIES[m.group(1).lower()] if m else None


_RELEVANCE_HEAD_CHARS = 2000
_RELEVANCE_MIN_MENTIONS = 3


def is_relevant(source: dict, names: list[str], *, tier: int) -> bool:
    """Spend an LLM call on a source only when it is about the company (spec §5.3)."""
    if tier == 1:
        return True
    patterns = [re.compile(rf"(?<!\w){re.escape(n.strip())}(?!\w)", re.I) for n in names if n and n.strip()]
    if not patterns:
        return False
    title = source.get("title") or ""
    if any(p.search(title) for p in patterns):
        return True
    head = (source.get("content") or "")[:_RELEVANCE_HEAD_CHARS]
    return max(len(p.findall(head)) for p in patterns) >= _RELEVANCE_MIN_MENTIONS
