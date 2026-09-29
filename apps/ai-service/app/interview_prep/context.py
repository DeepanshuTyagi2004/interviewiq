"""Stage 1 (no LLM): assemble everything needed to build a plan, and compute the cache key.

Gathers the pre-generated brief (`repo.get_brief`) and the question bank (`repo.query_questions`,
filtered by round_type + company + the brief's difficulty calibration, relaxing filters if a strict
match is empty). The JD and candidate profile arrive in the request body. Computes a deterministic
input hash over the fused inputs (brief timestamp, profile hash, jd id, round_type, sorted question
slugs) — the cache key, mirroring the hash-idempotency used elsewhere (app/questions/hashing.py).
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections import Counter
from dataclasses import dataclass, field

from app.config import Settings
from app.db import repositories as repo
from app.interview_prep.schema import GenerateInterviewPlanRequest

logger = logging.getLogger(__name__)


def _sha256(payload: dict) -> str:
    """sha256 of a canonical JSON encoding. 'sha256:<hex>', matching app/questions/hashing.py."""
    return "sha256:" + hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()


def compute_profile_hash(profile: dict) -> str:
    return _sha256(profile)


def compute_input_hash(*, brief_generated_at: str | None, profile_hash: str, jd_id: str,
                       round_type: str, question_slugs: list[str]) -> str:
    """The cache key. Any change to the brief timestamp, profile, JD, round, or the set of seed
    question slugs yields a new hash → a fresh plan; identical inputs → identical hash → cache hit."""
    return _sha256({
        "brief_generated_at": brief_generated_at,
        "profile_hash": profile_hash,
        "jd_id": jd_id,
        "round_type": round_type,
        "question_slugs": sorted(question_slugs),
    })


@dataclass
class PrepContext:
    company: str
    role: str
    level: str
    specialization: str
    round_type: str
    brief: dict | None
    has_brief_content: bool
    brief_generated_at: str | None
    difficulty: str | None
    questions: list[dict]
    question_slugs: list[str]
    red_flags: list[str]
    profile: dict
    profile_hash: str
    input_hash: str
    grounding: dict = field(default_factory=dict)


def _final_experience(brief: dict | None) -> dict:
    """The consolidated experience block, or {} for a missing/failed brief."""
    if not brief or brief.get("generation_status") == "failed":
        return {}
    return brief.get("final_experience") or {}


def _brief_generated_at(brief: dict | None) -> str | None:
    if not brief:
        return None
    ts = brief.get("generated_at")
    if ts is None:
        return None
    return ts.isoformat() if hasattr(ts, "isoformat") else str(ts)


def _derive_difficulty(fe: dict, round_type: str) -> str | None:
    """The brief's difficulty calibration for this round: the most common non-null difficulty across
    the brief's rounds of this type. None when the brief doesn't say."""
    diffs = [r.get("difficulty") for r in fe.get("rounds", [])
             if r.get("type") == round_type and r.get("difficulty")]
    if not diffs:
        return None
    return Counter(diffs).most_common(1)[0][0]


async def _gather_questions(round_type: str, company: str, difficulty: str | None,
                            limit: int) -> list[dict]:
    """Question bank for the round, relaxing filters if a strict match is empty: (company,
    difficulty) → (company) → (difficulty) → (round only). First non-empty wins, so a company with
    no company-tagged questions still gets round-appropriate ones."""
    for comp, diff in ((company, difficulty), (company, None), (None, difficulty), (None, None)):
        items = await repo.query_questions(round_type, comp, diff, limit)
        if items:
            return items
    return []


def _profile_summary(profile: dict) -> dict:
    """Compact, prompt-friendly view of the profile (keeps the grounding blob small)."""
    return {
        "headline": profile.get("headline"),
        "targetRole": profile.get("targetRole"),
        "skills": profile.get("skills") or [],
        "education": [
            {"institution": e.get("institution"), "degree": e.get("degree"),
             "field": e.get("field"), "grade": e.get("grade")}
            for e in (profile.get("education") or [])
        ],
        "experience": [
            {"company": x.get("company"), "title": x.get("title"),
             "bullets": x.get("bullets") or []}
            for x in (profile.get("experience") or [])
        ],
        "projects": [
            {"name": p.get("name"), "description": p.get("description"),
             "tech": p.get("tech") or [], "bullets": p.get("bullets") or []}
            for p in (profile.get("projects") or [])
        ],
        "achievements": profile.get("achievements") or [],
        # Curated GitHub/LeetCode signals (already compact from the backend) — richest grounding for
        # coding rounds. None when the candidate hasn't connected those sources.
        "codingSignals": profile.get("codingProfile"),
        "links": profile.get("links") or {},
    }


def _round_scoped_brief(fe: dict, round_type: str, difficulty: str | None) -> dict:
    """The brief signals that belong to THIS round only — drawn from the brief's rounds whose type
    matches, so a DSA prompt isn't fed the LLD/OA/machine-coding context of other rounds. Topics,
    named problems, and formats are unioned across the matching rounds (deduped, order-preserving)."""
    topics: list[str] = []
    problems: list[str] = []
    formats: list[str] = []
    provenance: str | None = None
    for r in fe.get("rounds", []):
        if r.get("type") != round_type:
            continue
        for t in (r.get("topics") or []):
            if t not in topics:
                topics.append(t)
        for p in (r.get("problems") or []):
            if p not in problems:
                problems.append(p)
        fmt = r.get("format")
        if fmt and fmt not in formats:
            formats.append(fmt)
        provenance = provenance or r.get("provenance")
    return {
        "difficulty": difficulty,
        "topics": topics,
        "problems": problems,          # named questions real candidates got in THIS round
        "formats": formats,
        "provenance": provenance,
    }


def _build_grounding(*, session, jd, profile: dict, fe: dict, difficulty: str | None) -> dict:
    """The deterministic context every prompt is grounded in. Round-specific signals live in
    `round` (the primary signal for the beats/ladders); company-wide signals that span the WHOLE
    loop live in `overallProcess` as background — never as this round's content (so e.g. a DSA
    prompt doesn't import machine-coding/LLD/OA topics from the other rounds)."""
    return {
        "company": session.company,
        "role": session.role,
        "level": session.level,
        "specialization": session.specialization,
        "roundType": session.round_type.value,
        "round": _round_scoped_brief(fe, session.round_type.value, difficulty),
        "overallProcess": {
            # Company-wide context across ALL rounds — for general flavour only. The free text may
            # name other rounds (e.g. "the OA is Hard, the LLD needs working code"); prompts must NOT
            # pull those other-round topics/formats into this round.
            "difficultyCalibration": fe.get("difficulty_calibration"),
            "interviewerStyleNotes": fe.get("interviewer_style_notes"),
            "dominantTopics": fe.get("dominant_topics") or [],
            "companySpecificPatterns": fe.get("company_specific_patterns"),
            "redFlags": fe.get("red_flags") or [],
        },
        "jobDescription": {
            "title": jd.title,
            "description": (jd.description or "")[:4000] or None,
            "techStack": jd.tech_stack,
        },
        "candidateProfile": _profile_summary(profile),
    }


async def build_context(req: GenerateInterviewPlanRequest, settings: Settings) -> PrepContext:
    session = req.session
    jd = req.job_description
    round_type = session.round_type.value

    brief = await repo.get_brief(session.company, session.role, session.level, session.specialization)
    fe = _final_experience(brief)
    difficulty = _derive_difficulty(fe, round_type)

    questions = await _gather_questions(round_type, session.company, difficulty,
                                        settings.prep_questions_per_round)
    question_slugs = [q["slug"] for q in questions if q.get("slug")]

    profile = req.candidate_profile.model_dump(by_alias=True, mode="json")
    profile_hash = compute_profile_hash(profile)
    brief_generated_at = _brief_generated_at(brief)
    input_hash = compute_input_hash(
        brief_generated_at=brief_generated_at, profile_hash=profile_hash, jd_id=jd.id,
        round_type=round_type, question_slugs=question_slugs)

    grounding = _build_grounding(session=session, jd=jd, profile=profile, fe=fe, difficulty=difficulty)

    ctx = PrepContext(
        company=session.company, role=session.role, level=session.level,
        specialization=session.specialization, round_type=round_type,
        brief=brief, has_brief_content=bool(fe), brief_generated_at=brief_generated_at,
        difficulty=difficulty, questions=questions, question_slugs=question_slugs,
        red_flags=fe.get("red_flags") or [], profile=profile,
        profile_hash=profile_hash, input_hash=input_hash, grounding=grounding,
    )
    logger.info("[prep] context: %s/%s/%s/%s round=%s brief=%s questions=%d input_hash=%s",
                session.company, session.role, session.level, session.specialization,
                round_type, "yes" if ctx.has_brief_content else "no", len(questions), input_hash)
    return ctx
