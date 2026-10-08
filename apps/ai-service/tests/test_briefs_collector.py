"""Named problems in research briefs join the index with the brief's company as reported evidence."""
from app.questions.collectors.briefs import problem_slug, records_from_briefs
from app.questions.content.prompts import build_content_prompt


def _brief(company, rounds):
    return {"company": company, "final_experience": {"rounds": rounds}}


def test_problems_merge_across_briefs_by_round_and_slug():
    briefs = [
        _brief("amazon", [{"type": "lld", "difficulty": "medium", "topics": ["OOP"], "problems": ["Design a parking lot", "Design a vending machine"]},
                          {"type": "behavioural", "problems": ["Tell me about a time you failed"]},
                          {"type": "aptitude", "problems": ["ignored: unknown round type"]}]),
        _brief("Razorpay", [{"type": "lld", "problems": ["Design a Parking Lot!", "x"]}]),
    ]
    records = records_from_briefs(briefs)
    by_slug = {r.slug: r for r in records}
    assert set(by_slug) == {"brief/design-a-parking-lot", "brief/design-a-vending-machine", "brief/tell-me-about-a-time-you-failed"}
    lot = by_slug["brief/design-a-parking-lot"]
    assert lot.round_type.value == "lld" and lot.company_tags == ["amazon", "razorpay"]
    assert lot.company_evidence == {"amazon": "reported", "razorpay": "reported"}
    assert lot.difficulty.value == "medium" and lot.topic_tags == ["OOP"] and lot.sources == ["briefs"] and lot.url == ""
    assert problem_slug("  Rate limiter / token bucket ") == "brief/rate-limiter-token-bucket"


def test_brief_records_prompt_without_any_url():
    [record] = records_from_briefs([_brief("zerodha", [{"type": "system-design", "problems": ["Design an order book"]}])])
    prompt = build_content_prompt(record.model_dump(mode="json"))
    assert "Design an order book" in prompt and "url" not in prompt.lower() and "system design" in prompt


def test_collector_merges_own_and_published_briefs_and_survives_outages(monkeypatch):
    import asyncio
    import app.questions.collectors.briefs as mod
    from app.config import Settings

    async def own(): return [_brief("amazon", [{"type": "lld", "problems": ["Design a parking lot"]}])]
    async def published(settings): return [_brief("razorpay", [{"type": "lld", "problems": ["Design a parking lot"]}, {"type": "system-design", "problems": ["Rate limiter"]}])]
    monkeypatch.setattr(mod.repo, "brief_rounds", own)
    monkeypatch.setattr(mod, "fetch_published_briefs", published)
    records = asyncio.run(mod.collect_brief_problems(Settings()))
    by_slug = {r.slug: r for r in records}
    assert by_slug["brief/design-a-parking-lot"].company_tags == ["amazon", "razorpay"]
    assert by_slug["brief/rate-limiter"].round_type.value == "system-design"

    async def broken(): raise RuntimeError("no mongo")
    async def nothing(settings): return []
    monkeypatch.setattr(mod.repo, "brief_rounds", broken)
    monkeypatch.setattr(mod, "fetch_published_briefs", nothing)
    assert asyncio.run(mod.collect_brief_problems(Settings())) == []
