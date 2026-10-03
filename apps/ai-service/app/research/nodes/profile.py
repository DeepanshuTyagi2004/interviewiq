"""Company profile research; no evidence is a valid, explicitly unavailable result. A named funding
round is kept as-is and also mapped to a broad stage (provenance `derived`)."""
from app.prompts.research import company_profile as prompt
from app.research.coverage import PROFILE_FOLLOWUP_CAP, OVERVIEW_PATHS, followup_budget, plan_followups, section_missing
from app.research.failures import is_degradable
from app.research.nodes.evidence import cap_unverified, choose, map_funding_round, research

OUTPUT_FIELDS = prompt.FIELDS
UNVERIFIED_CAP = 20


def build_profile(claims: list[dict]) -> dict:
    derived = [{**c, "field": "funding_stage", "value": stage, "derived_from": c["value"]}
               for c in claims if c["field"] == "funding_round" and (stage := map_funding_round(c["value"]))]
    claims = claims + derived
    return {name: choose(claims, name) for name in prompt.FIELDS}


async def profile(state, deps) -> dict:
    outcome = await research(state, deps, prompt, kind="profile", queries=prompt.QUERIES)
    retried = set(outcome.retryable_sources)
    if retried:
        outcome += await research(state, deps, prompt, kind="profile", queries=(),
                                  skip_urls=outcome.successful_urls, retry_sources=outcome.retryable_sources)
    outcome.raise_if_all_failed()
    section = build_profile(outcome.claims)
    notes = list(state.get("notes") or [])
    used = int(state.get("followups_used") or 0)
    plan = plan_followups(section_missing(section, OVERVIEW_PATHS), prompt.FOLLOWUPS,
                          followup_budget(state, deps.settings.research_followup_max_queries, PROFILE_FOLLOWUP_CAP))
    if plan:
        used += len(plan)
        try:
            extra = await research(state, deps, prompt, kind="profile", queries=plan,
                                   skip_urls=outcome.successful_urls | retried)
            if extra.retryable_sources:
                extra += await research(state, deps, prompt, kind="profile", queries=(),
                                        skip_urls=outcome.successful_urls | extra.successful_urls | retried,
                                        retry_sources=extra.retryable_sources)
        except Exception as exc:
            if not is_degradable(exc):
                raise
            notes.append(f"profile: follow-up search failed ({type(exc).__name__})")
        else:
            outcome = outcome.merge(extra)
            section = build_profile(outcome.claims)
    outcome.raise_if_all_failed()
    notes += outcome.notes("profile")
    return {"profile": {**section, "unverified": cap_unverified(outcome.unverified, UNVERIFIED_CAP)},
            "notes": notes, "followups_used": used}
