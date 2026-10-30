"""Bank quality rules shared by the collectors (keep a record out) and selection (skip one already stored).

Some system-design sources list concepts beside problems: InterviewReady's README has a section per topic
("Caching", "Containers and Docker", "System Design Resources"). A concept is not a design problem: generated
content for it is a lecture, and an interviewer cannot ask a candidate to "design Microservices"."""
from __future__ import annotations

import re

# Titles seen in the live sources (2026-10-30) that name a concept, a pattern or a resource list.
CONCEPT_TITLES = frozenset({
    "api design", "authorization", "batch processing", "caching", "capacity estimation",
    "cluster and workflow management", "containers and docker", "database replication", "distributed consensus",
    "distributed transactions consistency patterns", "event driven architectures", "intra service messaging",
    "load balancing", "message queue antipattern", "microservices", "network protocols", "nosql database algorithms",
    "nosql database internals", "practical system design", "publisher subscriber", "real time stream processing",
    "service mesh", "single point of failure", "software architectures", "system design interviews",
    "system design resources", "testing distributed systems", "time series databases",
})

# Words that mark a concept or a reading list even in a title not seen yet.
_CONCEPT_WORDS = re.compile(r"\b(antipatterns?|internals|algorithms|architectures|patterns|protocols|resources|"
                            r"interviews?|estimation|fundamentals|basics|concepts|primer|tutorial|guide|introduction)\b", re.I)
_DESIGN_VERB = re.compile(r"^\s*(design|build|implement|architect|scale)\b", re.I)


def _norm(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


def is_design_problem(title: str) -> bool:
    """A system-design title names a system to design ("Design WhatsApp", "Web Crawler"), not a concept."""
    norm = _norm(title)
    if not norm or norm in CONCEPT_TITLES:
        return False
    if _DESIGN_VERB.match(title or ""):
        return True
    return not _CONCEPT_WORDS.search(title or "")
