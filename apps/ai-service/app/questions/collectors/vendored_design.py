"""Vendored system-design and LLD lists (<data_dir>/system_design/*.json, <data_dir>/lld/*.json).

Titles only, like every design source: content is generated later from index facts. A file names its source and
an optional page; each problem may carry its own `url`, `company_tags` (only where that source reports the
company, so they are `reported`) and `is_machine_coding`. One bad file is skipped, never the run."""
from __future__ import annotations

import glob
import json
import logging
import os
import re

from app.models.brief import RoundType
from app.questions.models import QuestionRecord
from app.questions.quality import is_design_problem

logger = logging.getLogger(__name__)

_PREFIX = {"kumaransg-lld": "kum", "workat-tech": "wat", "interviewiq-lld": "iqlld",
           "reported-sd": "repsd", "interviewiq-sd": "iqsd"}
_SLUG_RE = re.compile(r"[^a-z0-9]+")
_DIRS = {RoundType.SYSTEM_DESIGN: "system_design", RoundType.LLD: "lld"}


def _slug(title: str) -> str:
    return _SLUG_RE.sub("-", title.lower()).strip("-")[:90]


def parse_vendored(doc: dict, round_type: RoundType) -> list[QuestionRecord]:
    source = doc["source"]
    prefix = _PREFIX.get(source, source)
    out: list[QuestionRecord] = []
    for p in doc["problems"]:
        title = p["title"].strip()
        if round_type == RoundType.SYSTEM_DESIGN and not is_design_problem(title):
            continue
        companies = [c.lower() for c in p.get("company_tags") or []]
        url = p.get("url") or doc.get("url") or ""
        out.append(QuestionRecord(
            slug=f"{prefix}/{_slug(title)}", round_type=round_type, title=title, url=url, sources=[source],
            company_tags=companies, company_evidence={c: "reported" for c in companies},
            solution_url=p.get("url") or None,
            is_machine_coding=p.get("is_machine_coding") if round_type == RoundType.LLD else None,
        ))
    return out


def collect_vendored_design(settings, round_type: RoundType) -> list[QuestionRecord]:
    recs: list[QuestionRecord] = []
    seen: set[str] = set()
    for path in sorted(glob.glob(os.path.join(settings.questions_data_dir, _DIRS[round_type], "*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                for r in parse_vendored(json.load(f), round_type):
                    if r.slug not in seen:
                        seen.add(r.slug)
                        recs.append(r)
        except Exception as exc:  # noqa: BLE001 — one bad seed file must not abort the run
            logger.warning("[questions] vendored %s %s failed (%s) — skipping", round_type.value, path, exc)
    logger.info("[questions] vendored %s: %d records", round_type.value, len(recs))
    return recs
