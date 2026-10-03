"""Company culture evidence. Role-specific total CTC is researched in the roles node."""
from app.prompts.research import company_compensation as prompt
from app.research.coverage import CULTURE_FOLLOWUP_CAP, CULTURE_PATHS, followup_budget, plan_followups, section_missing
from app.research.failures import is_degradable
from app.research.models import unavailable
from app.research.nodes.evidence import cap_unverified, choose, evidence_field, extractive_text, research

OUTPUT_FIELDS = ("wlb_rating", "wlb_review_count", "review_summary", "review_quotes")
UNVERIFIED_CAP = 20


def build_culture(claims: list[dict]) -> dict:
    rating = choose(claims, "wlb_rating")
    # Review counts from a different rating/site must not be displayed as that rating's sample.
    counts = [c for c in claims if c["field"] == "wlb_review_count" and c["url"] in rating["source_urls"]]
    quotes, seen = [], set()
    for c in claims:
        if c["field"] == "review_quote" and (c["url"], c["value"]) not in seen:
            quotes.append(c)
            seen.add((c["url"], c["value"]))
        if len(quotes) == 5:
            break
    return {
        "wlb_rating": rating, "wlb_review_count": choose(counts, "wlb_review_count"),
        "review_summary": extractive_text(claims, "review_summary"),
        "review_quotes": evidence_field([
            {"text": c["value"], "sourceUrl": c["url"], "sourceName": c["source_name"], "date": c["date"]}
            for c in quotes], quotes) if quotes else {**unavailable("No supported India review quotes"), "value": []},
    }


async def compensation(state, deps) -> dict:
    outcome = await research(state, deps, prompt, kind="compensation", queries=prompt.QUERIES)
    retried = set(outcome.retryable_sources)
    if retried:
        outcome += await research(state, deps, prompt, kind="compensation", queries=(),
                                  skip_urls=outcome.successful_urls, retry_sources=outcome.retryable_sources)
    outcome.raise_if_all_failed()
    section = build_culture(outcome.claims)
    notes = list(state.get("notes") or [])
    used = int(state.get("followups_used") or 0)
    plan = plan_followups(section_missing(section, CULTURE_PATHS), prompt.FOLLOWUPS,
                          followup_budget(state, deps.settings.research_followup_max_queries, CULTURE_FOLLOWUP_CAP))
    if plan:
        used += len(plan)
        try:
            extra = await research(state, deps, prompt, kind="compensation", queries=plan,
                                   skip_urls=outcome.successful_urls | retried)
            if extra.retryable_sources:
                extra += await research(state, deps, prompt, kind="compensation", queries=(),
                                        skip_urls=outcome.successful_urls | extra.successful_urls | retried,
                                        retry_sources=extra.retryable_sources)
        except Exception as exc:
            if not is_degradable(exc):
                raise
            notes.append(f"compensation: follow-up search failed ({type(exc).__name__})")
        else:
            outcome = outcome.merge(extra)
            section = build_culture(outcome.claims)
    outcome.raise_if_all_failed()
    notes += outcome.notes("compensation")
    return {"compensation": {**section, "unverified": cap_unverified(outcome.unverified, UNVERIFIED_CAP)},
            "notes": notes, "followups_used": used}
