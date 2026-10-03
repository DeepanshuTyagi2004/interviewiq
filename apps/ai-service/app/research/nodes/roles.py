"""Role discovery and per-role research (evidence-hardening spec §8).

A role is (title key, employment type): title variants ("SDE- UI" / "SDE - UI", job codes) merge,
internships stay separate from full-time roles. Roles are discovered only from non-community
sources. Every role-specific claim is attached by its page section: the title in the passage, the
title of a single-role page, or the nearest title above the passage. A claim whose role the page
does not establish stays in a compatible role's `unverified` list or company notes, never its fields."""
from __future__ import annotations

import hashlib
import re
from collections import Counter

from app.prompts.research import company_roles as prompt
from app.research.concurrency import gather_ordered
from app.research.coverage import followup_budget, plan_followups, role_missing
from app.research.failures import is_degradable
from app.research.models import field, unavailable
from app.research.nodes.evidence import ResearchOutcome, cap_unverified, company_names, research, unverified_entry
from app.research.nodes.role_corroboration import corroborate, employment_signals
from app.research.normalize.identity import domain_of
from app.research.normalize.merge import (
    TIER_WEIGHT, choose, choose_list, ctc_observations, ctc_range, extractive_text, observations_field, reported_passages,
)
from app.research.normalize.titles import employment_from_title, infer_role, job_ids, role_in_context, role_section, title_key

RoleId = tuple[str, str]   # (title key, employment type)
UNVERIFIED_CAP = 10
_MAX_TITLE_CHARS = 80
_NOT_A_ROLE = re.compile(r"\b(manager|director|vp|vice president|careers?|opportunities|openings|hiring|join us)\b"
                         r"|interview experience", re.I)
# A title the model did not tie to a role (role_title null) must at least read like an engineering role,
# so a page heading ("Explore career opportunities…") never becomes one.
_ROLE_NOUN = re.compile(r"\b(engineer(?:ing)?|developer|sde|swe|sdet|programmer|architect|scientist|analyst|intern(?:ship)?"
                        r"|trainee|technical staff|mts|smts|lmts|consultant|specialist|devops|sre|qa|tester)\b", re.I)
_LISTS = (("required_skills", "required_skill"), ("preferred_skills", "preferred_skill"),
          ("tech_stack", "tech_stack"), ("locations", "location"))


def role_key(level: str | None, specialization: str | None, title: str, employment_type: str | None = None) -> str:
    parts = [level or "unknown", specialization or "general", title]
    if employment_type in ("intern", "contract"):   # full-time keys stay as before
        parts.append(employment_type)
    text = "-".join(parts).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return slug if len(slug) <= 128 else slug[:115] + "-" + hashlib.sha256(text.encode()).hexdigest()[:12]


class _Roles:
    """Bookkeeping for one company's roles: which title keys exist, which sources say what
    employment type, and where each claim belongs."""

    def __init__(self, claims: list[dict], sources: dict[str, dict]):
        self.sources = dict(sources)
        self.etypes: dict[str, str | None] = {}
        self.title_keys_by_url: dict[str, set[str]] = {}
        self._learn(claims)
        candidates: dict[RoleId, list[dict]] = {}
        for c in claims:
            value = c["value"] if c["field"] == "title" else None
            if (value is None or len(value) > _MAX_TITLE_CHARS or _NOT_A_ROLE.search(value)
                    or (c.get("role_title") and title_key(c["role_title"]) != title_key(value))
                    or (not c.get("role_title") and not _ROLE_NOUN.search(value))):
                continue
            etype = employment_from_title(value) or self.etypes.get(c["url"]) or "full_time"
            candidates.setdefault((title_key(value), etype), []).append({**c, "role_title": c.get("role_title") or value})
        self.known = {tk for tk, _ in candidates}
        # A LinkedIn post or interview write-up can support a role, never create one.
        self.found = {rid: cs for rid, cs in candidates.items() if any(x.get("source_type") != "community" for x in cs)}
        self.variants: dict[str, set[str]] = {}
        for tk, et in self.found:
            self.variants.setdefault(tk, set()).add(et)

    def _learn(self, claims: list[dict]) -> None:
        for c in claims:
            if c["field"] == "employment_type":
                if not self.etypes.get(c["url"]):
                    self.etypes[c["url"]] = c["value"]
            if c["field"] == "title":
                self.title_keys_by_url.setdefault(c["url"], set()).add(title_key(c["value"]))
        for c in claims:   # a posting's stated "intern" level is an internship signal too
            if c["field"] == "level" and c["value"] == "intern":
                if not self.etypes.get(c["url"]):
                    self.etypes[c["url"]] = "intern"
        for url, source in self.sources.items():
            self.etypes.setdefault(url, employment_from_title(source.get("title") or ""))

    def add_sources(self, outcome: ResearchOutcome) -> None:
        self.sources.update(outcome.sources)
        self._learn(outcome.claims)

    def variant(self, tk: str, etype: str | None) -> str | None:
        have = self.variants.get(tk, set())
        if etype:
            return etype if etype in have else None
        if "full_time" in have:
            return "full_time"
        return next(iter(have)) if len(have) == 1 else None

    def assign(self, claim: dict) -> tuple[RoleId | None, str | None, str | None]:
        """(role, reason, the title key the claim named or resolved to)."""
        source = self.sources.get(claim["url"]) or {}
        page_title, text = source.get("title") or "", source.get("content") or ""
        keys = self.known | self.title_keys_by_url.get(claim["url"], set())
        named = title_key(claim["role_title"]) if claim.get("role_title") else None
        if named:
            if not role_in_context(named, quote=claim["quote"], geo_quote=claim.get("geo_quote") or "",
                                   page_title=page_title, text=text, known_keys=keys):
                return None, "role_not_in_context", named
            tk = named
        else:
            tk = infer_role(quote=claim["quote"], page_title=page_title, text=text, known_keys=keys)
            if tk is None:
                return None, "role_not_in_context", None
        if tk not in self.variants:
            return None, "role_unknown", tk
        section = role_section(claim["quote"], text, keys)
        signals = employment_signals(section or page_title)
        if len(signals) > 1:
            return None, "role_mismatch", tk
        etype = self.variant(tk, next(iter(signals), None) or self.etypes.get(claim["url"]))
        if etype is None:
            return None, "role_mismatch", tk
        return (tk, etype), None, tk


def _support(claims: list[dict]) -> float:
    best: dict[str, float] = {}
    for c in claims:
        domain = domain_of(c["url"]) or c["url"]
        best[domain] = max(best.get(domain, 0.0), TIER_WEIGHT.get(c.get("tier") or 3, 1.0))
    return sum(best.values())


def build_row(rid: RoleId, claims: list[dict], unverified: list[dict], title: str, failure: BaseException | None = None) -> dict:
    _, etype = rid
    row = {name: choose(claims, name) for name in ("level", "specialization", "yoe_min", "yoe_max")}
    title_claims = [c for c in claims if c["field"] == "title"]
    row["title"] = choose(title_claims, "title")
    if any(c["field"] == "employment_type" for c in claims):
        row["employment_type"] = choose(claims, "employment_type")
    elif etype != "full_time":
        row["employment_type"] = field(etype, confidence="medium", provenance="derived", note="From the role title",
                                       source_urls=sorted({c["url"] for c in title_claims}))
    else:
        row["employment_type"] = unavailable("Employment type not stated in the sources")
    low, high = row["yoe_min"]["value"], row["yoe_max"]["value"]
    if low is not None and high is not None and low > high:
        row["yoe_min"] = unavailable("Source experience range is reversed or conflicting")
        row["yoe_max"] = unavailable("Source experience range is reversed or conflicting")
    for out_name, claim_name in _LISTS:
        row[out_name] = choose_list(claims, claim_name)
    row["ctc_observations"] = observations_field(ctc_observations(claims))
    row["ctc_min_lpa"], row["ctc_max_lpa"], row["ctc_source_count"] = ctc_range(claims)
    row["jd"] = extractive_text(claims, "jd")
    row["interview_process"] = extractive_text(claims, "interview_process", tiers={1})
    row["reported_interview_process"] = reported_passages(claims)
    official = sorted({c["url"] for c in claims if c.get("tier") == 1})
    ids = job_ids(official, [c["value"] for c in title_claims] + [c.get("role_title") or "" for c in claims])
    row["job_ids"] = (field(ids, confidence="medium", provenance="derived", source_urls=official,
                            note="Job codes from official posting URLs and role titles") if ids
                      else unavailable("No job codes in the sources"))
    for claim in claims:
        if not claim.get("corroborating_urls"):
            continue
        name = claim["field"]
        affected = ({"interview_process", "reported_interview_process"} if name == "interview_process"
                    else {"ctc_observations", "ctc_min_lpa", "ctc_max_lpa"} if name.startswith("ctc_")
                    else {next((out for out, raw in _LISTS if raw == name), name)})
        for key in affected:
            value = row.get(key)
            if not isinstance(value, dict) or claim["url"] not in value.get("source_urls", []):
                continue
            value["source_urls"] = sorted(set(value["source_urls"]) | set(claim["corroborating_urls"]))
            value["provenance"] = "derived"
            note = claim["corroboration_note"]
            if note not in (value.get("note") or ""):
                value["note"] = "; ".join(filter(None, [value.get("note"), note]))
    if failure is not None:
        for value in row.values():
            if isinstance(value, dict) and value.get("provenance") == "unavailable":
                value["note"] = f"Detail research failed: {type(failure).__name__}"
    row["unverified"] = [{k: v for k, v in e.items() if not k.startswith("_")}
                         for e in cap_unverified(unverified, UNVERIFIED_CAP)]
    row["role_key"] = role_key(row["level"]["value"], row["specialization"]["value"], title, etype)
    return row


async def roles(state, deps) -> dict:
    discovery = await research(state, deps, prompt, kind="roles", queries=prompt.QUERIES)
    retried = set(discovery.retryable_sources)
    retry_notes = []
    if retried:
        try:
            recovered = await research(state, deps, prompt, kind="roles", queries=(),
                                       skip_urls=set(discovery.successful_urls), retry_sources=discovery.retryable_sources)
        except Exception as exc:
            if not is_degradable(exc):
                raise
            retry_notes.append(f"roles: saved-source retry failed ({type(exc).__name__})")
        else:
            discovery = discovery.merge(recovered)
    book = _Roles(discovery.claims, discovery.sources)
    titles = {rid: choose(cs, "title")["value"] for rid, cs in book.found.items()}
    ranked = sorted(book.found, key=lambda rid: (-_support(book.found[rid]), titles[rid], rid[1]))
    cap = max(0, deps.settings.research_max_roles)
    kept = ranked[:cap]
    notes = [*(state.get("notes") or []), *discovery.notes("roles"), *retry_notes]
    if len(ranked) > cap:
        notes.append("Role research cap reached; omitted: " + ", ".join(titles[rid] for rid in ranked[cap:]))

    claims: dict[RoleId, list[dict]] = {rid: list(book.found[rid]) for rid in kept}
    unverified: dict[RoleId, list[dict]] = {rid: [] for rid in kept}
    dropped: Counter = Counter()
    pending: list[dict] = []
    all_claims = list(discovery.claims)
    successful = set(discovery.successful_urls)
    retryable = {u: s for u, s in discovery.retryable_sources.items() if u not in retried and u not in successful}

    def target(tk: str | None, entry: dict) -> RoleId | None:
        source = book.sources.get(entry["url"], {})
        signals = employment_signals((source.get("title") or "") + " " + role_section(
            entry["quote"], source.get("content") or "", book.known))
        etype = next(iter(signals)) if len(signals) == 1 else book.etypes.get(entry["url"])
        if len(signals) > 1 or (not etype and len(book.variants.get(tk, set())) > 1):
            return None
        rid = (tk, book.variant(tk, etype)) if tk in book.variants else None
        return rid if rid in unverified else None

    def route(claim: dict, pass_tk: str | None = None) -> None:
        if claim["field"] == "title":
            return
        rid, reason, tk = book.assign(claim)
        if reason is None and pass_tk is not None and rid[0] != pass_tk:
            reason = "role_mismatch"          # in context, but for another role than this search's
        if reason is None:
            if rid in claims:
                claims[rid].append(claim)
            else:
                dropped["role_not_researched"] += 1
            return
        dest = None if reason == "role_unknown" else target(tk, claim)
        if dest is None:
            dropped[reason] += 1
            pending.append(unverified_entry(claim, reason))
        else:
            unverified[dest].append(unverified_entry(claim, reason))

    def route_unverified(entry: dict) -> None:
        # Resolve after all passes: an official corroborating posting may arrive later.
        # The search title is not evidence that an unknown claim belongs to that role.
        pending.append(entry)

    for claim in discovery.claims:
        route(claim)
    for entry in discovery.unverified:
        route_unverified(entry)

    async def search_title(title: str, queries) -> tuple[ResearchOutcome | None, BaseException | None]:
        try:
            # Only successful extractions are permanently satisfied. Failed URLs are handled
            # by the shared saved-source queue, then suppressed once their retry is exhausted.
            return await research(state, deps, prompt, kind="roles", queries=queries, role_title=title,
                                  skip_urls=successful | retried | set(retryable)), None
        except Exception as exc:
            if not is_degradable(exc):
                raise
            return None, exc

    def absorb(title: str | None, outcome: ResearchOutcome) -> None:
        book.add_sources(outcome)
        all_claims.extend(outcome.claims)
        successful.update(outcome.successful_urls)
        retryable.update({u: s for u, s in outcome.retryable_sources.items() if u not in retried and u not in successful})
        for url in successful:
            retryable.pop(url, None)
        notes.extend(outcome.notes(f"roles · {title}" if title else "roles · source retry"))
        for claim in outcome.claims:
            route(claim, title_key(title) if title else None)
        for entry in outcome.unverified:
            route_unverified(entry)

    async def retry_failed() -> None:
        # Reserve the whole batch before awaiting. Concurrent per-title searches cannot each
        # retry the same saved failure; each URL gets at most one retry across all waves.
        batch = {u: s for u, s in retryable.items() if u not in retried and u not in successful}
        if not batch:
            return
        retried.update(batch)
        for url in batch:
            retryable.pop(url, None)
        try:
            outcome = await research(state, deps, prompt, kind="roles", queries=(),
                                     skip_urls=successful, retry_sources=batch)
        except Exception as exc:
            if not is_degradable(exc):
                raise
            notes.append(f"roles: saved-source retry failed ({type(exc).__name__})")
        else:
            absorb(None, outcome)

    await retry_failed()

    distinct = list(dict.fromkeys(titles[rid] for rid in kept))
    failed: dict[str, BaseException] = {}
    for title, (outcome, err) in zip(distinct, await gather_ordered(
            [search_title(t, prompt.DETAIL_QUERIES) for t in distinct])):
        if err is not None:
            failed[title] = err
            notes.append(f"roles: detail research for {title} failed ({type(err).__name__}); its details are unavailable")
        else:
            absorb(title, outcome)

    await retry_failed()

    def rows() -> list[dict]:
        return [build_row(rid, claims[rid], unverified[rid], titles[rid], failed.get(titles[rid])) for rid in kept]

    used = int(state.get("followups_used") or 0)
    budget = followup_budget(state, deps.settings.research_followup_max_queries)
    plans = []
    current = rows()
    for title in distinct:
        if budget <= 0:
            break
        if title in failed:
            continue
        missing = list(dict.fromkeys(p for row in current if row["title"]["value"] == title for p in role_missing(row)))
        queries = plan_followups(missing, prompt.ROLE_FOLLOWUPS, budget)
        if queries:
            plans.append((title, queries))
            budget -= len(queries)
            used += len(queries)
    for (title, _), (outcome, err) in zip(plans, await gather_ordered(
            [search_title(title, queries) for title, queries in plans])):
        if err is not None:
            notes.append(f"roles: follow-up search for {title} failed ({type(err).__name__})")
        else:
            absorb(title, outcome)

    await retry_failed()
    seen_pending = set()
    for entry in pending:
        identity = (entry["url"], entry["field"], str(entry["value"]), entry.get("role_title"), entry["reason"])
        if identity in seen_pending:
            continue
        seen_pending.add(identity)
        promoted = corroborate(entry, book=book, claims=all_claims, company_names=company_names(state))
        if promoted is not None:
            route(promoted)
            continue
        named = title_key(entry["role_title"]) if entry.get("role_title") else book.assign(entry)[2]
        dest = target(named, entry)
        public_entry = {k: v for k, v in entry.items() if not k.startswith("_")}
        if dest is not None:
            unverified[dest].append(public_entry)
        else:
            dropped[entry["reason"]] += 1
            notes.append(f"roles: pending {entry['field']} for {entry.get('role_title') or 'unknown role'} "
                         f"({entry['reason']}) · {entry['url']} · {str(entry['value'])[:500]}")

    if dropped:
        deps.tracer.emit("log", "roles: claims not attached to a researched role: "
                         + ", ".join(f"{k} {v}" for k, v in sorted(dropped.items())), level="debug", data=dict(dropped))
    return {"roles": rows(), "notes": notes, "followups_used": used}
