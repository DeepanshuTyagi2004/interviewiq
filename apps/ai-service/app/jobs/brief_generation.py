"""Brief generation job — staged collect → extract → aggregate pipeline.

For each company+role+level combination (read from interviewiq-api), the pipeline:
  1. Collect: query Exa Search for N source URLs.
  2. Extract: run each source through LLM to produce a RawExperience (parallel-capped).
  3. Aggregate: merge all raw experiences into one FinalExperience via LLM.

Both raw_experiences[] and final_experience are stored per brief document. Sequential
across combos with a delay between calls; one failure never aborts the run.

Trigger rules (skipped unless `force`): regenerate when no brief exists, the brief is
older than the staleness window, its query_version != PIPELINE_VERSION, or its status
is failed/insufficient_data. Successful (success) briefs settle until stale.
"""
from __future__ import annotations

import asyncio
import json as _json
import logging
import re
from datetime import timedelta
from urllib.parse import urlparse

from pydantic import ValidationError

from app.config import Settings
from app.db import repositories as repo
from app.llm.client import LLMClient, LLMError, build_llm_client, gather_capped
from app.models.brief import (
    DataConfidence,
    FinalExperience,
    Geo,
    GenerationStatus,
    Provenance,
    RawExperience,
    utcnow,
)
from app.exa.client import ExaClient, ExaConfigError, ExaError
from app.prompts.extract_source import EXTRACT_SYSTEM, build_extract_prompt
from app.prompts.aggregate_experience import AGGREGATE_SYSTEM, build_aggregate_prompt
from app.jobs.run_store import RUN_STORE
from app.levels import classify, match_tier, is_on_level
from app.templates.skeletons import skeleton_for
from app.targets import Combination, fetch_combinations

logger = logging.getLogger(__name__)

PIPELINE_VERSION = "v13"   # v13: process-source model — guides/posts feed round structure (forces regen)

# A round's exact-level evidence is "stale" only if every stated date is older than this. Absence
# of a date never demotes. NB: Exa is not recency-filtered at search time (unlike the old
# Perplexity recency=year), so this gate is the only thing bounding evidence age now.
RECENCY_YEARS = 3
# Two sources are the same experience reposted when their extracted problem-sets overlap this much.
_DEDUP_JACCARD = 0.6
_YEAR_RE = re.compile(r"\b(20\d{2})\b")


def build_search_queries(combo: "Combination") -> list[str]:
    """India-weighted search query for one combo. Experience-shaped ("interview experience") —
    NOT "questions asked", which baited question banks. Entry-level combos also carry campus
    phrasing (that's where fresher posts live)."""
    role = combo.role.replace("-", " ")
    spec = (combo.specialization or "").strip().lower()
    spec_part = "" if spec in ("", "general") else f"{spec} "
    base = f"{combo.company} {spec_part}{role} {combo.level}".strip()
    bucket, _ = classify(combo.level)
    # Fresher/intern/sde1 posts cluster under campus/off-campus phrasing; senior ones don't.
    extra = " campus placement off-campus new grad" if bucket == "entry" else ""
    # Every variant carries the seniority+specialization so we don't collect off-level posts
    # (e.g. SDE-2 / "4 years experience" results for a fresher query).
    return [f"{base} interview experience India{extra}"]


def drop_denied(sources: list[dict], deny_domains: list[str]) -> list[dict]:
    """Filter out sources whose host matches a denied domain (content farms / job boards), so we
    never spend an extract LLM call on a page that structurally can't be a first-hand experience.
    Host suffix match -> subdomains (blog.huntingcube.ai) are covered. Empty deny-list = no-op."""
    if not deny_domains:
        return sources
    return [s for s in sources if not _is_denied(s.get("url") or "", deny_domains)]


def _is_denied(url: str, deny_domains: list[str]) -> bool:
    host = urlparse(url).hostname or "" if url else ""
    if host.startswith("www."):
        host = host[4:]
    return any(host == d or host.endswith("." + d) for d in deny_domains)


def is_off_geo(exp: "RawExperience") -> bool:
    """A source explicitly placed outside India. india + unknown both pass (we don't punish a post
    for simply not stating a location — Exa is already weighted to IN via userLocation)."""
    return exp.geo == Geo.NON_INDIA


def _fingerprint(exp: "RawExperience") -> set[str]:
    """Content signature for dedup: the problem set across rounds (lowercased), falling back to
    topics when no problems were extracted. Empty -> the source stands alone (can't prove an echo)."""
    probs = {p.strip().lower() for r in exp.rounds for p in r.problems if p and p.strip()}
    if probs:
        return probs
    return {t.strip().lower() for r in exp.rounds for t in r.topics if t and t.strip()}


def _near_dup(a: set[str], b: set[str]) -> bool:
    if not a or not b:
        return False
    return len(a & b) / len(a | b) >= _DEDUP_JACCARD


def dedup_clusters(raw_experiences: list["RawExperience"]) -> dict[str, int]:
    """Map each source url to an independence-group id. Sources whose extracted problem-sets are
    near-duplicates (one experience syndicated across sites) share a group, so they corroborate a
    round ONCE — not N times. Union-find over a pairwise scan.
    ponytail: O(n^2), n<=EXTRACT_MAX_SOURCES (40); switch to MinHash/LSH only if N grows."""
    exps = [e for e in raw_experiences if e.url]
    fps = [_fingerprint(e) for e in exps]
    parent = list(range(len(exps)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(exps)):
        for j in range(i + 1, len(exps)):
            if _near_dup(fps[i], fps[j]):
                parent[find(i)] = find(j)
    return {e.url: find(i) for i, e in enumerate(exps)}


def _year_of(date: str | None) -> int | None:
    """First 20xx year mentioned in a (messy) date string, else None."""
    if not date:
        return None
    m = _YEAR_RE.search(str(date))
    return int(m.group(1)) if m else None


def count_provenance(fe: "FinalExperience") -> tuple[int, int]:
    """Return (evidence_backed_round_count, inferred_round_count) for the final experience."""
    ev = sum(1 for r in fe.rounds if r.provenance == Provenance.EVIDENCE_BACKED)
    return ev, len(fe.rounds) - ev


def _url_tiers(raw_experiences: list["RawExperience"], combo_level: str | None) -> dict[str, str]:
    """Map each source url to its match tier against the JD level (exact/adjacent/unknown/off)."""
    return {e.url: match_tier(combo_level, e.detected_level) for e in raw_experiences if e.url}


def partition_by_level(
    raw_experiences: list["RawExperience"], combo_level: str | None
) -> tuple[list["RawExperience"], list["RawExperience"], list["RawExperience"]]:
    """Split sources by their detected level vs the JD level:
      on_level    = exact/adjacent (genuine level evidence)
      unconfirmed = null/unknown level (may inform inferred rounds, never counts as level proof)
      excluded    = dropped before the aggregator — a different seniority bucket OR explicitly
                    outside India. Off-geo is gated here exactly like off-level."""
    on_level, unconfirmed, excluded = [], [], []
    for e in raw_experiences:
        if is_off_geo(e):
            excluded.append(e)
            continue
        tier = match_tier(combo_level, e.detected_level)
        if is_on_level(tier):
            on_level.append(e)
        elif tier == "unknown":
            unconfirmed.append(e)
        else:
            excluded.append(e)
    return on_level, unconfirmed, excluded


def annotate_rounds(
    fe: "FinalExperience", raw_experiences: list["RawExperience"], combo_level: str | None
) -> "FinalExperience":
    """Set each round's provenance + trust metadata DETERMINISTICALLY (we do not trust the LLM's
    self-labels — that was a source of false 'evidence_backed'):
      - cites >=1 on-level FIRST-HAND url -> evidence_backed (may carry named problems)
      - cites >=1 on-level url but none first-hand (guide/official/post) -> process_guide (structure only)
      - cites only level-unconfirmed urls -> inferred_from_similar
      - cites nothing -> keep `template` if the LLM marked it so, else inferred_from_similar
    Firewall: named `problems` survive ONLY on evidence_backed rounds; stripped everywhere else.
    Any off-level / off-geo / unknown-to-us url is stripped from evidence_urls. support_count and
    the "of N" total count INDEPENDENT sources (echoed re-posts collapse to one). Mutates fe."""
    tiers = _url_tiers(raw_experiences, combo_level)
    sublevel = {e.url: classify(e.detected_level)[1] for e in raw_experiences if e.url}
    off_geo = {e.url for e in raw_experiences if e.url and is_off_geo(e)}
    first_hand = {e.url: e.is_first_hand for e in raw_experiences if e.url}
    groups = dedup_clusters(raw_experiences)   # url -> independence-group id
    on_level_total = len({groups[e.url] for e in raw_experiences
                          if e.url and is_on_level(match_tier(combo_level, e.detected_level))
                          and not is_off_geo(e)})
    for r in fe.rounds:
        kept = [u for u in r.evidence_urls
                if tiers.get(u) in ("exact", "adjacent", "unknown") and u not in off_geo]
        on = [u for u in kept if is_on_level(tiers.get(u))]           # on-level (exact/adjacent)
        on_fh = [u for u in on if first_hand.get(u, True)]           # on-level first-hand
        on_guide = [u for u in on if not first_hand.get(u, True)]    # on-level guide/official/post
        r.evidence_urls = kept
        if on_fh:
            r.provenance = Provenance.EVIDENCE_BACKED
            r.support_count = len({groups[u] for u in on_fh if u in groups})
            r.source_sublevels = sorted({sublevel.get(u) for u in on_fh if sublevel.get(u)})
        elif on_guide:
            r.provenance = Provenance.PROCESS_GUIDE
            r.support_count = len({groups[u] for u in on_guide if u in groups})
            r.source_sublevels = sorted({sublevel.get(u) for u in on_guide if sublevel.get(u)})
        else:
            if kept or r.provenance != Provenance.TEMPLATE:
                r.provenance = Provenance.INFERRED_FROM_SIMILAR
            r.support_count = 0
            r.source_sublevels = []
        if r.provenance != Provenance.EVIDENCE_BACKED:
            r.problems = []   # firewall: named problems are first-hand only
        r.source_count_total = on_level_total
        r.rare = (r.provenance == Provenance.EVIDENCE_BACKED
                  and r.support_count == 1 and on_level_total >= 3)
    fe.template_used = any(r.provenance == Provenance.TEMPLATE for r in fe.rounds)
    return fe


def count_provenance(fe: "FinalExperience") -> tuple[int, int]:
    """Return (evidence_backed_round_count, non_evidence_backed_round_count)."""
    ev = sum(1 for r in fe.rounds if r.provenance == Provenance.EVIDENCE_BACKED)
    return ev, len(fe.rounds) - ev


def count_process_rounds(fe: "FinalExperience") -> int:
    """Rounds attested by on-level NON-first-hand sources (guides/official/posts) — real company
    structure without a candidate account. Powers the process-coverage confidence tier."""
    return sum(1 for r in fe.rounds if r.provenance == Provenance.PROCESS_GUIDE)


def count_onlevel_rounds(
    fe: "FinalExperience", raw_experiences: list["RawExperience"], combo_level: str | None
) -> int:
    """Evidence_backed rounds citing >=1 on-level (exact/adjacent) source. Powers the stored
    `level_matched_round_count`."""
    tiers = _url_tiers(raw_experiences, combo_level)
    return sum(1 for r in fe.rounds if r.provenance == Provenance.EVIDENCE_BACKED
               and any(is_on_level(tiers.get(u)) for u in r.evidence_urls))


def count_exact_rounds(
    fe: "FinalExperience", raw_experiences: list["RawExperience"], combo_level: str | None
) -> int:
    """Rounds backed by >=1 EXACT-level source — the strongest grounding signal."""
    tiers = _url_tiers(raw_experiences, combo_level)
    return sum(1 for r in fe.rounds if r.provenance == Provenance.EVIDENCE_BACKED
               and any(tiers.get(u) == "exact" for u in r.evidence_urls))


def _exact_is_stale(
    fe: "FinalExperience", raw_experiences: list["RawExperience"], combo_level: str | None
) -> bool:
    """True only when we have dated EXACT-level evidence and ALL of it predates the recency window.
    No stated dates -> not stale (search recency already bounds collection; absence isn't staleness)."""
    tiers = _url_tiers(raw_experiences, combo_level)
    year_by_url = {e.url: _year_of(e.date) for e in raw_experiences if e.url}
    cutoff = utcnow().year - RECENCY_YEARS
    years = [year_by_url[u] for r in fe.rounds if r.provenance == Provenance.EVIDENCE_BACKED
             for u in r.evidence_urls
             if tiers.get(u) == "exact" and year_by_url.get(u) is not None]
    return bool(years) and max(years) < cutoff


def derive_status(
    fe: "FinalExperience", raw_experiences: list["RawExperience"], combo_level: str | None
) -> tuple["GenerationStatus", "DataConfidence"]:
    """Confidence from GENUINE on-level evidence. null and off-level no longer inflate it; EXACT-level
    evidence weighs above adjacent, and HIGH additionally requires that exact evidence not be provably
    stale. A complete loop is always returned (templates fill gaps) — status and confidence just tell
    the truth about how well that loop is grounded."""
    if not fe.rounds:
        return GenerationStatus.INSUFFICIENT_DATA, DataConfidence.LOW
    n = len(fe.rounds)
    exact = count_exact_rounds(fe, raw_experiences, combo_level)
    on_level = count_onlevel_rounds(fe, raw_experiences, combo_level)
    process = count_process_rounds(fe)
    if exact / n >= 0.5 and not _exact_is_stale(fe, raw_experiences, combo_level):
        return GenerationStatus.SUCCESS, DataConfidence.HIGH
    if exact >= 1 or on_level / n >= 0.4:
        return GenerationStatus.SUCCESS, DataConfidence.MEDIUM
    # No first-hand grounding, but on-level guides/posts attest at least half the loop — the company
    # process is known even if the lived specifics aren't. That's a useful brief: MEDIUM, not LOW.
    if (on_level + process) / n >= 0.5:
        return GenerationStatus.SUCCESS, DataConfidence.MEDIUM
    return GenerationStatus.INSUFFICIENT_DATA, DataConfidence.LOW


async def needs_regeneration(combo: Combination, settings: Settings) -> bool:
    existing = await repo.get_brief(combo.company, combo.role, combo.level, combo.specialization)
    if existing is None:
        return True
    if existing.get("query_version") != PIPELINE_VERSION:
        return True
    if existing.get("generation_status") in ("failed", "insufficient_data"):
        return True
    # 'success' briefs settle until stale; only failed/insufficient retry on a manual run.
    generated_at = existing.get("generated_at")
    if generated_at is None:
        return True
    return utcnow() - generated_at > timedelta(days=settings.brief_stale_after_days)


async def _collect(exa: ExaClient, combo: Combination, settings: Settings) -> list[dict]:
    queries = build_search_queries(combo)
    sources = await exa.collect_sources(
        queries,
        include_domains=settings.exa_include_domains,
        exclude_domains=settings.exa_exclude_domains,
    )
    # Exa already excludes via excludeDomains; re-apply locally to catch subdomains (host-suffix
    # match) BEFORE the extract LLM runs, then cap.
    return drop_denied(sources, settings.exa_exclude_domains)[: settings.extract_max_sources]


async def _extract_all(llm: LLMClient, combo: Combination, sources: list[dict],
                       settings: Settings) -> tuple[list[RawExperience], list[dict]]:
    """Returns (kept_experiences, dispositions). `dispositions` records EVERY collected source's
    fate so the UI can explain why each was or wasn't used. Context passed to the extractor is
    company+role ONLY (no level/spec) so the model detects seniority from the post, not the target."""
    label = combo.label()
    context = f"{combo.company} {combo.role.replace('-', ' ')}"

    async def _one(src: dict) -> dict:
        url, title = src.get("url"), src.get("title")
        try:
            # Per-source label so an LLM failure names WHICH source it choked on (not just the combo).
            raw, thought = await llm.complete(
                EXTRACT_SYSTEM, build_extract_prompt(context, src), label=f"{label} · {url}")
        except LLMError:
            return {"url": url, "title": title, "status": "extract_failed", "exp": None, "thought": None}
        # Only carry the reasoning when capturing is on (keeps docs lean otherwise).
        thought = (thought or None) if settings.llm_capture_thoughts else None
        base = {"url": url, "title": title, "thought": thought}
        if not raw.get("describes_process"):
            return {**base, "status": "no_process", "exp": None}
        raw.setdefault("url", url)
        first_hand = bool(raw.get("is_first_hand"))
        raw["is_first_hand"] = first_hand
        try:
            exp = RawExperience.model_validate(raw)
        except ValidationError:
            return {**base, "status": "extract_failed", "exp": None}
        if not exp.rounds:
            return {**base, "status": "no_rounds", "exp": None}
        if not first_hand:
            # Firewall: a non-first-hand source (guide/official/aggregated post) contributes round
            # STRUCTURE only. Strip any lived specifics the model leaked from "frequently asked" lists.
            for rd in exp.rounds:
                rd.problems = []
                rd.difficulty = None
                rd.hints_given = None
                rd.outcome = None
        return {**base, "status": "extracted", "exp": exp}

    results = await gather_capped([_one(s) for s in sources], settings.extract_concurrency)
    dispositions = [
        r if r is not None
        else {"url": s.get("url"), "title": s.get("title"), "status": "extract_failed", "exp": None, "thought": None}
        for s, r in zip(sources, results)
    ]
    kept = [d["exp"] for d in dispositions if d["status"] == "extracted"]
    return kept, dispositions


async def _aggregate(llm: LLMClient, combo: Combination, raw_experiences: list[RawExperience],
                     settings: Settings) -> tuple[FinalExperience, str | None]:
    """Consolidate ON-LEVEL + level-unconfirmed experiences into one FinalExperience. Off-level
    sources are EXCLUDED here (deterministic gate, not a soft prompt instruction). The level's
    standard-loop skeleton is passed so the model fills any missing standard round as a generic
    template. Returns (experience, aggregate reasoning); reasoning is None unless capturing."""
    on_level, unconfirmed, _off = partition_by_level(raw_experiences, combo.level)

    def _tagged(e: RawExperience, tier: str) -> dict:
        d = e.model_dump(mode="json")
        d["match_tier"] = tier
        return d

    pool = ([_tagged(e, match_tier(combo.level, e.detected_level)) for e in on_level]
            + [_tagged(e, "level-unconfirmed") for e in unconfirmed])
    payload = _json.dumps(pool)
    skeleton = skeleton_for(combo.role, combo.level)
    raw, thought = await llm.complete(
        AGGREGATE_SYSTEM, build_aggregate_prompt(combo.label(), payload, skeleton))
    return FinalExperience.model_validate(raw), ((thought or None) if settings.llm_capture_thoughts else None)


async def generate_one(
    exa: ExaClient,
    llm: LLMClient,
    combo: Combination,
    settings: Settings,
    *,
    force: bool = False,
) -> dict:
    """Generate (or skip) the brief for one combination via collect -> extract -> aggregate."""
    label = combo.label()
    if not force and not await needs_regeneration(combo, settings):
        logger.info("[brief] %s fresh (v=%s); skipping", label, PIPELINE_VERSION)
        RUN_STORE.record_combo(label, status="skipped")
        return {"combo": label, "status": "skipped"}

    RUN_STORE.record_combo(label, status="running")
    try:
        sources = await _collect(exa, combo, settings)
        RUN_STORE.add_combo_request(
            label, prompt=" | ".join(build_search_queries(combo)),
            raw_response=f"{len(sources)} sources collected", citations=[s["url"] for s in sources],
        )
        raw_experiences, dispositions = await _extract_all(llm, combo, sources, settings)
        final, aggregate_thought = await _aggregate(llm, combo, raw_experiences, settings)
        annotate_rounds(final, raw_experiences, combo.level)   # deterministic provenance + trust metadata
    except ExaConfigError:
        raise
    except (ExaError, LLMError, ValueError, ValidationError) as exc:
        logger.warning("[brief] %s FAILED: %s", label, exc)
        failed = _failed_doc(combo, settings, str(exc))
        await repo.upsert_brief(failed)
        RUN_STORE.record_combo(label, status="failed", error=str(exc), stored_doc=_jsonable(failed))
        return {"combo": label, "status": "failed"}

    status, confidence = derive_status(final, raw_experiences, combo.level)
    final.data_confidence = confidence
    doc = _success_doc(combo, final, raw_experiences, sources, settings, status, dispositions, aggregate_thought)
    await repo.upsert_brief(doc)
    ev, inf = count_provenance(final)
    strong = count_onlevel_rounds(final, raw_experiences, combo.level)
    logger.info("[brief] %s OK (status=%s, conf=%s, rounds=%d ev=%d inf=%d on_level=%d, raw=%d, sources=%d, template=%s)",
                label, status.value, confidence.value, len(final.rounds), ev, inf, strong,
                len(raw_experiences), len(sources), final.template_used)
    RUN_STORE.record_combo(label, status=status.value, data_confidence=confidence.value,
                           brief=final.model_dump(mode="json"), stored_doc=_jsonable(doc))
    return {"combo": label, "status": status.value, "data_confidence": confidence.value}


def _jsonable(doc: dict) -> dict:
    """JSON-safe copy of a stored doc for the live snapshot (datetime -> ISO string)."""
    out = dict(doc)
    generated = out.get("generated_at")
    if hasattr(generated, "isoformat"):
        out["generated_at"] = generated.isoformat()
    return out


def _success_doc(combo, final, raw_experiences, sources, settings, status, dispositions, aggregate_thought=None) -> dict:
    ev, inf = count_provenance(final)
    fe = final.model_dump(mode="json")
    fe["evidence_backed_round_count"] = ev
    fe["inferred_round_count"] = inf   # all non-evidence rounds (process_guide + inferred + template)
    fe["process_guide_round_count"] = count_process_rounds(final)
    fe["level_matched_round_count"] = count_onlevel_rounds(final, raw_experiences, combo.level)
    # The sources actually cited by the final experience (vs. everything collected) — powers the
    # "chosen for the final experience" view. match_tier is the new truth; level_matched kept for
    # frontend back-compat (= on-level == exact|adjacent).
    chosen_urls = {u for r in final.rounds for u in r.evidence_urls}
    fe["chosen_sources"] = [
        {"url": e.url, "source": e.source, "detected_level": e.detected_level,
         "geo": e.geo.value if hasattr(e.geo, "value") else e.geo,
         "match_tier": match_tier(combo.level, e.detected_level),
         "level_matched": is_on_level(match_tier(combo.level, e.detected_level)),
         "is_first_hand": e.is_first_hand}
        for e in raw_experiences if e.url in chosen_urls
    ]
    # Full funnel: EVERY collected source + why it was/wasn't used. status is one of
    # cited | off_geo_excluded | off_level_excluded | extracted_unused | no_process |
    # no_rounds | extract_failed.  (cited covers first-hand AND guide/process sources — see is_first_hand)
    source_funnel = []
    for d in dispositions:
        exp = d.get("exp")
        tier = match_tier(combo.level, exp.detected_level) if exp else None
        if d["status"] != "extracted":
            st = d["status"]
        elif d.get("url") in chosen_urls:
            st = "cited"
        elif exp and is_off_geo(exp):
            st = "off_geo_excluded"     # genuine experience, but outside India -> dropped before the LLM
        elif tier == "off":
            st = "off_level_excluded"   # genuine experience, but a different seniority -> dropped before the LLM
        else:
            st = "extracted_unused"
        source_funnel.append({
            "url": d.get("url"),
            "title": d.get("title"),
            "source": exp.source if exp else None,
            "detected_level": exp.detected_level if exp else None,
            "geo": (exp.geo.value if exp and hasattr(exp.geo, "value") else None),
            "match_tier": tier,
            "level_matched": is_on_level(tier) if tier else None,
            "is_first_hand": exp.is_first_hand if exp else None,
            "status": st,
            "thought": d.get("thought"),   # model reasoning for this source (None unless LLM_CAPTURE_THOUGHTS)
        })
    fe["source_funnel"] = source_funnel
    fe["aggregate_thought"] = aggregate_thought   # reasoning behind the consolidated experience
    return {
        "company": combo.company,
        "role": combo.role,
        "level": combo.level,
        "specialization": combo.specialization,
        "generated_at": utcnow(),
        "query_version": PIPELINE_VERSION,
        "raw_experiences": [e.model_dump(mode="json") for e in raw_experiences],
        "final_experience": fe,
        "sources": [s["url"] for s in sources],
        "data_confidence": final.data_confidence.value,
        "generation_status": status.value,
        "models": {
            "search": f"exa-{settings.exa_type}",
            "extract": settings.llm_model,
            "aggregate": settings.llm_model,
        },
    }


def _failed_doc(combo, settings, error: str) -> dict:
    return {
        "company": combo.company,
        "role": combo.role,
        "level": combo.level,
        "specialization": combo.specialization,
        "generated_at": utcnow(),
        "query_version": PIPELINE_VERSION,
        "search_provider": f"exa-{settings.exa_type}",
        "brief": None,
        "sources": [],
        "data_confidence": None,
        "generation_status": GenerationStatus.FAILED.value,
        "error": error[:1000],
    }


async def run_brief_generation(exa: ExaClient, settings: Settings) -> dict:
    """Generate briefs for all combinations, sequentially, with a delay between calls."""
    combos = await fetch_combinations(settings)
    counts = {"success": 0, "insufficient_data": 0, "failed": 0, "skipped": 0}
    if not combos:
        logger.warning("[brief] no combinations to process")
        return {"combinations": 0, **counts}

    async with build_llm_client(settings) as llm:
        processed = 0
        for i, combo in enumerate(combos, start=1):
            if RUN_STORE.is_cancelled():
                logger.info("[brief] stop requested — halting after %d/%d", processed, len(combos))
                break
            logger.info("[brief] (%d/%d) %s", i, len(combos), combo.label())
            result = await generate_one(exa, llm, combo, settings)
            counts[result["status"]] = counts.get(result["status"], 0) + 1
            processed += 1
            if i < len(combos):
                await asyncio.sleep(settings.brief_inter_call_delay_seconds)

        # Prune only on a COMPLETE run — a stopped run hasn't visited every combo, so its
        # set is partial and must not delete briefs it simply didn't reach this time.
        if not RUN_STORE.is_cancelled():
            valid = {(c.company, c.role, c.level, c.specialization) for c in combos}
            pruned = await repo.prune_briefs(valid)
            if pruned:
                logger.info("[brief] pruned %d stale brief(s) not in the current catalogue", pruned)

    logger.info("[brief] run complete: %s (processed %d/%d)", counts, processed, len(combos))
    return {"combinations": len(combos), **counts}


async def execute_tracked_run(exa: ExaClient, settings: Settings, run_id: str) -> dict:
    """Run brief generation under RUN_STORE tracking (powers the live admin console)."""
    logger.info("=== brief generation run %s starting ===", run_id)
    try:
        RUN_STORE.set_stage("brief_generation")
        result = await run_brief_generation(exa, settings)
        RUN_STORE.record_stage_result(
            "brief_generation", {k: v for k, v in result.items() if isinstance(v, int)}
        )
        RUN_STORE.finish("cancelled" if RUN_STORE.is_cancelled() else "completed")
        logger.info("=== brief generation run %s done: %s ===", run_id, result)
        return result
    except Exception as exc:  # noqa: BLE001 — record failure for the live view, then re-raise
        logger.exception("=== brief generation run %s failed ===", run_id)
        RUN_STORE.finish("failed", error=str(exc))
        raise


async def any_combination_missing_brief(settings: Settings) -> bool:
    """Used on startup: true if at least one JD target has no brief yet."""
    for combo in await fetch_combinations(settings):
        if await repo.get_brief(combo.company, combo.role, combo.level, combo.specialization) is None:
            return True
    return False
