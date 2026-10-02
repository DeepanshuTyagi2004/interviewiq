"""resolve (spec §3.2 node 1): canonical name, official website and aliases, plus a duplicate check
against the other companies in the catalogue. A likely duplicate never blocks the run: it lands
on the draft as a `possible_duplicate` conflict for the admin to decide."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field as PField

from app.prompts.research import resolve_company as prompt
from app.research.models import field, unavailable
from app.research.normalize.identity import domain_of, find_possible_duplicates, name_key

if TYPE_CHECKING:
    from app.research.graph import CompanyState, NodeDeps

logger = logging.getLogger(__name__)

QUERY_TEMPLATE = "{name} company official website India"
_MAX_ALIASES = 6


class ResolveOutput(BaseModel):
    is_company: bool = True
    canonical_name: str = PField(min_length=1)
    website: str | None = None
    aliases: list[str] = []
    confidence: Literal["high", "medium", "low"] = "low"
    evidence_urls: list[str] = []
    reasoning: str = ""


async def resolve(state: "CompanyState", deps: "NodeDeps") -> dict:
    company = state["company"]
    query = QUERY_TEMPLATE.format(name=company["name"])
    results = await deps.io.search(query, company_slug=company["slug"], kind="resolve")
    logger.info("resolve %s: %d search result(s)", company["name"], len(results))

    raw = await deps.io.extract_json(
        prompt_name=prompt.PROMPT_NAME, prompt_version=prompt.PROMPT_VERSION, system=prompt.SYSTEM,
        user=prompt.build_user(name=company["name"], website_hint=company.get("website"),
                               aliases_hint=list(company.get("aliases") or []), results=results),
        company_slug=company["slug"], label=f"resolve:{company['slug']}",
        validate=ResolveOutput.model_validate,
    )
    out = ResolveOutput.model_validate(raw)

    result_urls = {r["url"] for r in results}
    evidence = [u for u in out.evidence_urls if u in result_urls]
    dropped = [u for u in out.evidence_urls if u not in result_urls]
    if dropped:
        logger.warning("resolve %s: ignoring %d evidence URL(s) not in the search results: %s",
                       company["name"], len(dropped), dropped)
    confidence = out.confidence if evidence else "low"
    provenance = "evidence" if evidence else "derived"

    name = field(out.canonical_name.strip(), confidence=confidence, provenance=provenance, source_urls=evidence)
    website = _website_field(company.get("website"), out.website, confidence, provenance, evidence)
    aliases = _aliases(company, out)
    identity = {
        "name": name,
        "website": website,
        "aliases": field(aliases, confidence=confidence, provenance=provenance, source_urls=evidence),
    }

    conflicts: list[dict] = []
    if not out.is_company:
        conflicts.append({"type": "not_a_company", "message": out.reasoning or "the search results do not describe a company"})
    conflicts += find_possible_duplicates(
        {"name": name["value"], "website": website["value"], "aliases": aliases}, state.get("others") or [],
    )
    for c in conflicts:
        logger.warning("resolve %s: conflict %s", company["name"], c)
    return {"identity": identity, "conflicts": conflicts}


def _website_field(admin_site: str | None, found: str | None, confidence: str, provenance: str,
                   evidence: list[str]) -> dict:
    if admin_site:
        note = f"research found {found}" if found and domain_of(found) != domain_of(admin_site) else None
        return field(admin_site, confidence="high", provenance="admin_override", note=note)
    if found:
        return field(found, confidence=confidence, provenance=provenance, source_urls=evidence)
    return unavailable("no official website in the search results")


def _aliases(company: dict, out: ResolveOutput) -> list[str]:
    canonical = name_key(out.canonical_name)
    seen: set[str] = set()
    aliases: list[str] = []
    for alias in [*(company.get("aliases") or []), *out.aliases, company["name"]]:
        alias = alias.strip()
        key = name_key(alias)
        if not alias or not key or key == canonical or key in seen:
            continue
        seen.add(key)
        aliases.append(alias)
    return aliases[:_MAX_ALIASES]
