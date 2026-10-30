"""Concept titles never enter the system-design bank, and stored ones are never picked."""
from app.questions.quality import is_design_problem


def test_design_problems_pass():
    for title in ("Design WhatsApp", "Web Crawler", "URL Shortener", "Rate Limiting", "Google Docs",
                  "Distributed File System", "Chess Engine Design", "Design Autocomplete for Search Engines", "Mint"):
        assert is_design_problem(title), title


def test_concepts_and_reading_lists_fail():
    for title in ("Caching", "Containers and Docker", "System Design Resources", "Microservices",
                  "Message Queue Antipattern", "NoSQL Database Internals", "Distributed Transactions consistency Patterns",
                  "Capacity Estimation", "Load Balancing", "Kafka fundamentals", ""):
        assert not is_design_problem(title), title


def test_selection_skips_a_stored_concept():
    from app.blueprint import selection as S
    from app.blueprint.context import build_context
    from tests.blueprint.fixtures import request
    ctx = build_context(request("system-design", round={"type": "system-design", "topics": [], "difficulty": None}))
    assert S.unsuitable({"round_type": "system-design", "title": "Caching", "slug": "irsd/caching"}, ctx)
    assert S.unsuitable({"round_type": "system-design", "title": "Design WhatsApp", "slug": "asd/x"}, ctx) is None
