"""Judge finished blueprints the way a senior interviewer would (docs/superpowers/specs/2026-10-07-interview-blueprint-design.md).

  .venv/bin/python scripts/judge_blueprints.py [--since 2026-10-08T10:00] [--limit 40] [--concurrency 4] [--out DIR]
      [--model gemini-3.8-flash,gemini-2.5-flash] [--free-keys]

Read-only over `blueprint_runs` (bench runs by default; --sessions judges booked sessions' runs instead). For each
completed run, Gemini reads the whole blueprint as a {company} interviewer for that role and level, scores it on
fixed dimensions, walks a strong, an average and a struggling candidate through its branches, and lists defects
with where they are and how to fix them. Writes judge.md (tables + every defect) and judge.json to --out.
The structural audit (`apps/api/scripts/dev/bench-blueprints.ts`) checks shape; this checks whether it would feel
like a real interview. Needs GEMINI_API_KEY, or --free-keys to use the free AI Studio keys (LLM_API_KEY) when the
paid key is out. --model lists models to try in order (a busy model answers 503); each verdict records which model
judged it, since scores from different models are not directly comparable. The rubric is a PRODUCT IP draft.
"""
from __future__ import annotations

import asyncio
import collections
import json
import os
import sys
from datetime import datetime, timezone

from pydantic import BaseModel, Field, ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # run from anywhere: `app` is the sibling package
from app.config import get_settings  # noqa: E402
from app.db import mongo  # noqa: E402
from app.llm.client import LLMError  # noqa: E402
from app.llm.gemini_client import GeminiClient  # noqa: E402

DIMENSIONS = {
    "realism": "Would a candidate believe this is the company's real interview for this round (format, question choice, tone)?",
    "level_fit": "Are the questions, expectations and scenarios right for this level (a fresher is not asked to lead teams)?",
    "company_fit": "Does it stay inside this company (no other company's name, principles or values) and use what is known about it?",
    "candidate_grounding": "Does it use only real facts about the candidate (no invented employer, project or domain)?",
    "branch_logic": "Does every branch's action and line fit its condition, so the live interviewer reacts the way a good human would?",
    "hints": "Do hint ladders escalate gently, help without giving the answer away, and stay correct?",
    "answer_key": "Are the answer keys correct (approaches, complexity, must-cover points) and useful for grading?",
    "spoken_naturalness": "Do openings, transitions and lines sound like a person speaking, not a document?",
    "flow_and_timing": "Do phases, timeboxes, reserves and the order of questions make a coherent session?",
}

SYSTEM = (
    "You are a senior software engineer who has conducted hundreds of real interviews at the company named below, "
    "for this role and level, and you train other interviewers. You review a MOCK interview blueprint: the plan an AI "
    "interviewer will follow live (persona, timed arc, questions, playbooks with condition -> action branches, hint "
    "ladders, answer keys). Judge it strictly against what a real interview at this company feels like. Cite slot ids "
    "and phases. Long fields were shortened by the review tool (marked [abridged]); never count that as a defect. "
    "The candidate never sees problem titles or slugs, only what the interviewer says. The core phase holds the "
    "slots plus blueprint_round.deep_dive_mins, the time for the personalization's resume probes and round questions "
    "(they are asked live in that time, not as slots); reserves are used when a core question is skipped or already known, or the candidate finishes early. "
    "Respond with VALID JSON ONLY: one object, no markdown."
)


class Dim(BaseModel):
    score: int = Field(ge=1, le=5)
    why: str


class Walk(BaseModel):
    candidate: str
    path: str
    breaks: list[str] = Field(default_factory=list)


class Defect(BaseModel):
    severity: str
    where: str
    issue: str
    fix: str


class Verdict(BaseModel):
    overall: int = Field(ge=1, le=5)
    verdict: str
    dimensions: dict[str, Dim]
    walkthroughs: list[Walk] = Field(default_factory=list)
    defects: list[Defect] = Field(default_factory=list)


def _arg(name: str, default: str | None = None) -> str | None:
    args = sys.argv[1:]
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default


def _cut(value, n: int):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= n else text[:n] + "…"


def _abridge(value, text: int = 500, items: int = 10):
    """Shorten long fields for the judge without breaking structure (cutting a JSON string mid-way made the judge
    report "truncated keys" and "escaping bugs" that were the tool's, not the blueprint's)."""
    if isinstance(value, str):
        return value if len(value) <= text else value[:text] + " [abridged]"
    if isinstance(value, list):
        out = [_abridge(v, text, items) for v in value[:items]]
        return out + ([f"[+{len(value) - items} more, abridged]"] if len(value) > items else [])
    if isinstance(value, dict):
        return {k: _abridge(v, text, items) for k, v in value.items()}
    return value


def view(run: dict) -> dict:
    """What the judge sees: the inputs that shaped the blueprint, then the blueprint itself (abridged keys)."""
    req, bp = run.get("request") or {}, run.get("blueprint") or {}
    prof = req.get("candidate_profile") or {}
    slots = []
    for s in bp.get("slots") or []:
        p, key = s.get("problem") or {}, (s.get("answer_key") or {}).get("key") or {}
        c = p.get("content") or {}
        solution = key.get("reference_solution") or {}
        key = {k: v for k, v in key.items() if k != "reference_solution"}
        if solution:
            key["reference_solution"] = {"language": solution.get("language"), "entry_point": solution.get("entry_point"),
                                         "verified_against_examples": solution.get("verified_against_examples"),
                                         "code": "[omitted from this review: executed against the problem's examples]"}
        slots.append({
            "slot_id": s.get("slot_id"), "kind": s.get("kind"), "purpose": s.get("purpose"), "timebox_mins": s.get("timebox_mins"),
            "problem": {"title": p.get("title"), "difficulty": p.get("difficulty"),
                        "statement": _cut(c.get("statement") or c.get("prompt") or c.get("question") or "", 900)},
            "ask": s.get("ask"), "hint_ladder": s.get("hint_ladder"), "branches": s.get("branches"),
            "probes": s.get("probes"), "follow_ups": s.get("follow_ups"), "expectations": s.get("expectations"),
            "answer_key": _abridge(key),
        })
    return {
        "company": (req.get("session") or {}).get("company"), "role": (req.get("session") or {}).get("role"),
        "level": (req.get("session") or {}).get("level"),
        "job_description": _cut(req.get("job_description"), 700), "round": req.get("round"),
        "candidate": {k: prof.get(k) for k in ("headline", "level", "years_experience", "skills", "education") if prof.get(k)}
        | {"projects": [x.get("name") for x in prof.get("projects") or []],
           "experience": [f"{x.get('title')} at {x.get('company')}" for x in prof.get("experience") or []],
           "coding": prof.get("coding")},
        "blueprint_round": bp.get("round"),   # incl. deep_dive_mins: the HM resume/round-question time outside the slots
        "persona": bp.get("persona"), "arc": bp.get("arc"), "personalization": bp.get("personalization"),
        "briefing_shown_to_candidate": bp.get("briefing"), "slots": slots,
    }


def prompt(v: dict) -> str:
    dims = "\n".join(f'    "{k}": {{"score": 1-5, "why": "<one or two sentences: {q}>"}},' for k, q in DIMENSIONS.items())
    return (
        f"Blueprint under review:\n{json.dumps(v, ensure_ascii=False, default=str)}\n\n"
        "Return exactly:\n{\n"
        '  "overall": <1-5: 5 = indistinguishable from a strong real interviewer at this company, 3 = usable but clearly '
        "artificial in places, 1 = would mislead or confuse the candidate>,\n"
        '  "verdict": "<one sentence>",\n  "dimensions": {\n' + dims + "\n  },\n"
        '  "walkthroughs": [\n'
        '    {"candidate": "strong", "path": "<how the session unfolds for a well-prepared candidate, slot by slot: which '
        'branches fire, whether reserves and follow-ups are used, what is said>", "breaks": ["<moments where the blueprint '
        'gives no guidance, wrong guidance or something a real interviewer would never say>"]},\n'
        '    {"candidate": "average", "path": "...", "breaks": ["..."]},\n'
        '    {"candidate": "struggling", "path": "<stuck, asks for the answer, goes quiet, gets nervous>", "breaks": ["..."]}\n'
        "  ],\n"
        '  "defects": [{"severity": "high|medium|low", "where": "<slot id / phase / persona / personalization>", '
        '"issue": "<what is wrong, quoting the text>", "fix": "<what the blueprint or its prompt should do instead>"}]\n'
        "}\n"
        "high = a candidate would notice it is wrong or unrealistic, or grading would be wrong; medium = noticeably "
        "artificial; low = polish. List every defect you find; an empty list means you found none."
    )


async def judge(llms: list[GeminiClient], run: dict) -> dict:
    v = view(run)
    head = {"run_id": run["run_id"], "company": run.get("company"), "level": run.get("level"),
            "round_type": run.get("round_type"), "candidate": run.get("candidate_label"),
            "duration_ms": run.get("duration_ms")}
    error = "no model answered"
    for llm in llms:
        for attempt in (1, 2):
            try:
                result = await llm.complete_full(SYSTEM, prompt(v), label=f"judge:{run['run_id']}")
                return {**head, "judge_model": llm.routing_identity["model"], **Verdict.model_validate(result.data).model_dump()}
            except (LLMError, ValidationError) as exc:
                error = str(exc)[:300]
    return {**head, "error": error}


def report(rows: list[dict], out: str) -> None:
    ok = [r for r in rows if "overall" in r]
    lines = [f"# Blueprint judge · {datetime.now(timezone.utc).isoformat(timespec='minutes')}", "",
             f"- Runs judged: **{len(ok)}** of {len(rows)}",
             f"- Mean overall: **{sum(r['overall'] for r in ok) / max(1, len(ok)):.2f}** / 5",
             f"- Judged by: {', '.join(f'{m} ({n})' for m, n in collections.Counter(r.get('judge_model', '?') for r in ok).most_common())}", ""]
    lines += ["| Dimension | Mean |", "| --- | --- |"]
    for k in DIMENSIONS:
        vals = [r["dimensions"][k]["score"] for r in ok if k in r["dimensions"]]
        lines.append(f"| {k} | {sum(vals) / max(1, len(vals)):.2f} |")
    by_round = collections.defaultdict(list)
    for r in ok:
        by_round[r["round_type"]].append(r["overall"])
    lines += ["", "| Round type | Runs | Mean overall |", "| --- | --- | --- |"]
    lines += [f"| {k} | {len(v)} | {sum(v) / len(v):.2f} |" for k, v in sorted(by_round.items())]
    lines += ["", "## Runs", "", "| Company | Level | Round | Overall | Lowest dimensions | Verdict |", "| --- | --- | --- | --- | --- | --- |"]
    for r in sorted(ok, key=lambda r: r["overall"]):
        low = sorted(r["dimensions"].items(), key=lambda kv: kv[1]["score"])[:2]
        lowest = ", ".join("%s %d" % (k, d["score"]) for k, d in low)
        lines.append(f"| {r['company']} | {r['level']} | {r['round_type']} | {r['overall']} | {lowest} | {r['verdict']} |")
    for sev in ("high", "medium"):
        lines += ["", f"## {sev.title()} defects", ""]
        for r in ok:
            for d in r["defects"]:
                if d["severity"].lower() == sev:
                    lines.append(f"- **{r['company']} {r['level']} {r['round_type']} · {d['where']}**: {d['issue']} Fix: {d['fix']}")
    lines += ["", "## Walkthrough breaks", ""]
    for r in ok:
        for w in r["walkthroughs"]:
            for b in w["breaks"]:
                lines.append(f"- {r['company']} {r['round_type']} · {w['candidate']}: {b}")
    failed = [r for r in rows if "error" in r]
    if failed:
        lines += ["", "## Not judged", ""] + [f"- {r['run_id']}: {r['error']}" for r in failed]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "judge.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(out, "judge.json"), "w") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1, default=str)


async def main() -> None:
    settings = get_settings()
    keys = settings.llm_api_keys if "--free-keys" in sys.argv else settings.gemini_api_keys
    if not keys:
        raise SystemExit("no keys: set GEMINI_API_KEY, or pass --free-keys to use LLM_API_KEY")
    models = [m.strip() for m in (_arg("--model") or settings.gemini_model).split(",") if m.strip()]
    db = await mongo.connect(settings)
    query: dict = {"status": "completed", "blueprint": {"$ne": None}}
    query["trigger"] = {"$ne": "bench"} if "--sessions" in sys.argv else "bench"
    if _arg("--since"):
        query["created_at"] = {"$gte": _arg("--since")}
    runs = await db["blueprint_runs"].find(query).sort("created_at", -1).to_list(int(_arg("--limit", "40") or 40))
    if not runs:
        raise SystemExit("no completed runs match")
    # The judge thinks harder than the prep stages do, and gets room for three walkthroughs.
    llms = [GeminiClient(settings.model_copy(update={"gemini_api_keys": keys, "gemini_model": m, "gemini_thinking_level": "medium",
                                                     "gemini_timeout_seconds": 240}), max_output_tokens=16000) for m in models]
    sem = asyncio.Semaphore(int(_arg("--concurrency", "4") or 4))

    async def one(run):
        async with sem:
            row = await judge(llms, run)
            print(f"{row.get('overall', 'ERR')} {row['company']} {row['level']} {row['round_type']} {row.get('verdict', row.get('error', ''))[:120]}",
                  flush=True)
            return row

    rows = await asyncio.gather(*(one(r) for r in runs))
    for llm in llms:
        await llm.aclose()
    out = _arg("--out", ".blueprint-judge") or ".blueprint-judge"
    report(rows, out)
    print(f"report at {os.path.abspath(os.path.join(out, 'judge.md'))}")


if __name__ == "__main__":
    asyncio.run(main())
