"""The live interviewer's acceptance tools: rehearse a scripted candidate, compare runs, and check a record for known problems.

  .venv/bin/python scripts/rehearse_flow.py run SESSION SCRIPT OUT_PREFIX [--shape ID]
      Simulates the scripted candidate against SESSION's stored blueprint (optionally re-laid out in memory as another round
      shape) with the real talker and director models (paid: OpenRouter), writing OUT_PREFIX.txt (the transcript) and
      OUT_PREFIX.json (every turn record, the plan's parts, the flow log, the briefs). Reads Mongo, writes nothing to it.
  .venv/bin/python scripts/rehearse_flow.py compare PREFIX [PREFIX ...]
      For PREFIX + each of the four scenarios (unplanned_topic, intro_covers_projects, wanders_off, unplanned_resume_opener)
      prints cost per turn, cached share, first-token median and p90, log_turn share, tool moves and blocked sentences.
  .venv/bin/python scripts/rehearse_flow.py check RECORD.json [RECORD.json ...]
  .venv/bin/python scripts/rehearse_flow.py check --session SESSION
      Runs app/interviewer/tracecheck.py over the records (or over a real session's stored turns) and prints each finding.
      Exits 1 when there is any failure; notes (a promise that seems kept nowhere) are printed and do not fail. Run it after any
      talker, director or prompt change. `--expect id,id` also checks those persona expectations (a persona record carries its own list,
      used when --expect is not given); a failed expectation fails the run too.
  .venv/bin/python scripts/rehearse_flow.py persona SPEC.json OUT_PREFIX [--session ID] [--shape ID] [--candidate-model M] [--realism-seed N]
      Like `run`, but the candidate is a model playing the persona in SPEC (scripts/flow_scenarios/personas/*.json): it answers what the
      interviewer actually said, types code, goes quiet and highlights the problem. Its resume is the profile the blueprint was prepared
      from. Also writes the persona's id, first name, silences, selections and its own usage (kept apart from the interviewer's).
      Paid: the interviewer's models and the candidate model (default deepseek/deepseek-v4.1-flash-1017, reasoning low).
      `--realism-seed N` (also on `run`): a stored blueprint was prepared before the realism stage and has no `realism` block, so the run would
      only test the old behaviour. With a seed the block is built in memory from the stored blueprint (traits, speech habits, the outline with its
      promises, the change stance; the classic opening's intro swap from the seed) with the prep's own code, and attached before the run. The
      persona's prose is not regenerated (no prep LLM call): it was written without the drawn traits, so the traits steer only the run's prompts.
  .venv/bin/python scripts/rehearse_flow.py variety RECORD.json RECORD.json [...]
      Per pair of records, which of length (the round's minutes), outline order, promised areas, projects asked, persona traits and the five
      most used openers differ. Pass = every pair differs in at least 3 (the realism spec's variety check). Exits 1 on a failed pair.
  .venv/bin/python scripts/rehearse_flow.py personas DIR OUT_DIR [--parallel N]
      Runs every spec in DIR (N at a time, default 3) into OUT_DIR/<id>.txt/.json, then prints one row per persona: session, shape, turns,
      trace failures, expectations passed, interviewer cost. Exits 1 on any trace failure or failed expectation.
  .venv/bin/python scripts/rehearse_flow.py batch PERSONA_DIR OUT_DIR [--parallel 5] [--scripted] [--judge]
      The measurement batch: every persona spec in PERSONA_DIR (and with --scripted the four scripted rehearsals, written as rh_<name>),
      then the trace checks and expectations on each record and, with --judge, the judge. Prints one table (trace fails, expectations,
      the six judge scores and overall, major/minor issue counts, verdict/echo/blocked rates, fillers, minutes before the first problem)
      and the means, and writes OUT_DIR/summary.json. A record is INVALID (and left
      out of the means) only when the candidate model failed, an interviewer turn failed with no speech, or a turn's error says
      credits, quota or payment; failed-over attempts are only counted (failover column). Paid.
  .venv/bin/python scripts/rehearse_flow.py judge RECORD.json [RECORD.json ...] [--model M] [--out FILE]
      A model scores each transcript as a senior interviewer at an Indian product company would (realism, follows_candidate, flow,
      problem_handling, tone, integrity, 1-5, plus overall and the worst moment). Reads only the transcript lines. Default model
      anthropic/claude-sonnet-5.5, reasoning low. Prints a table, writes JSON to --out. Paid.
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import copy
import glob
import json
import os
import re
import statistics
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # run from anywhere: `app` is the sibling package
from app.interviewer.tracecheck import check_expectations, check_record, style_metrics  # noqa: E402

SCENARIOS = ["unplanned_topic", "intro_covers_projects", "wanders_off", "unplanned_resume_opener"]
FLOW = {"go_to", "skip_goal", "open_thread", "close_thread"}
ITEM_FIELDS = ("item_id", "slot_id", "kind", "phase", "status", "ended_by", "must", "origin", "title", "why", "parent", "style", "turns", "coded")


def relayout(blueprint: dict[str, Any], shape_id: str) -> dict[str, Any]:
    """The stored arc re-laid out as `shape_id`: the same rule plan_arc uses (shift only when every named phase is present,
    phases at 0 minutes dropped, the shape's order and styles), applied to the stored minutes."""
    from app.blueprint.shapes import shape_by_id
    shape = shape_by_id(shape_id)
    bp = copy.deepcopy(blueprint)
    minutes = {a["phase"]: int(a.get("timebox_mins") or 0) for a in bp["arc"]}
    by_phase = {a["phase"]: a for a in bp["arc"]}
    if shape.shift and all(p in minutes for p in shape.shift):
        for p, d in shape.shift.items():
            minutes[p] += d
    order = [p for p in shape.order if p in minutes and minutes[p] > 0]
    if len(order) != len([p for p in minutes if minutes[p] > 0]):
        order = [a["phase"] for a in bp["arc"] if minutes[a["phase"]] > 0]
    bp["arc"] = [{**by_phase[p], "timebox_mins": minutes[p], "style": shape.styles.get(p, "")} for p in order]
    bp["shape_id"] = shape.shape_id
    return bp


def record_of(run: Any, blueprint: dict[str, Any]) -> dict[str, Any]:
    """What a finished simulated run leaves for the checks: the file the `check` and `compare` commands read."""
    from app.interviewer.simulate import SimClock
    store = run.d.store
    return {"shape_id": blueprint.get("shape_id", "classic"), "round_type": (blueprint.get("round") or {}).get("type"),
            "clock_start": SimClock.START, "change_requests": dict(run.conductor.change_requests), "gave_up_items": sorted(run.conductor.gave_up_items), "plan_changes": list(run.conductor.plan_changes), "blueprint": blueprint,
            "arc": [(a["phase"], a.get("timebox_mins"), a.get("style", "")) for a in blueprint["arc"]],
            "probes": [str(p.get("prompt") or "") for p in (blueprint.get("personalization") or {}).get("resume_probes") or []],
            "turns": store.turns, "briefs": store.briefs,
            "items": [{k: getattr(i, k) for k in ITEM_FIELDS} for i in run.conductor.items],
            "flow_log": run.conductor.flow_log, "follow_ups": run.conductor.follow_ups, "dropped": run.conductor.dropped, "end_reason": run.conductor.end_reason,
            "promises": dict(run.conductor.promises)}


def attach_realism(blueprint: dict[str, Any], seed: int, profile_projects: list[str] | None = None) -> dict[str, Any]:
    """A copy of a stored blueprint with a realism block built in memory from `seed`, with the prep's own code (`app/blueprint/realism.py`;
    no LLM call, no store): the traits that fit the blueprint's shape, the habits, the outline mirroring the blueprint's arc and the change
    stance. The classic opening swaps framing and the introduction when the seed says so (the arc is re-laid in memory, as `--shape` does),
    so the seed varies the order as it does at prep. Raises SystemExit when the block does not validate against the blueprint."""
    from app.blueprint import realism as R
    from app.blueprint.models import Realism
    bp = copy.deepcopy(blueprint)
    phases = [a["phase"] for a in bp["arc"]]
    if R.swap_intro(seed) and tuple(phases[:4]) == ("greeting", "small_talk", "framing", "candidate_intro"):
        bp["arc"][2], bp["arc"][3] = bp["arc"][3], bp["arc"][2]
    rnd = bp.get("round") or {}
    personal = bp.get("personalization") or {}
    traits = R.draw_realism_traits(seed, [], bp.get("shape_id"))
    areas, projects = R.pools(personal, str(rnd.get("type") or ""), profile_projects) if int(rnd.get("deep_dive_mins") or 0) > 0 else ([], [])
    block = R.build_realism(seed, traits, R.family_of(str(rnd.get("type") or "")), [a["phase"] for a in bp["arc"]], areas, projects,
                            int(rnd.get("duration_mins") or 0))
    problems = R.validate_realism(block, {**bp, "profile_projects": profile_projects})
    if problems:
        raise SystemExit(f"the realism block for seed {seed} does not fit this blueprint: " + "; ".join(problems))
    bp["realism"], bp["realism_seed"], bp["realism_traits"] = block.model_dump(mode="json"), seed, traits
    assert Realism.model_validate(bp["realism"])
    return bp


def _profile_projects(profile: dict[str, Any]) -> list[str]:
    return [str(p.get("name") or "") for p in profile.get("projects") or []]


DEFAULT_FIRST_NAME = "Rahul"           # the candidate in scripted runs, as in persona runs: never the interviewer's own name


def scripted_context(context: dict[str, Any], first_name: str | None) -> dict[str, Any]:
    """The scripted run's context with the candidate's own first name (the stored one can be the interviewer's: "Hi Faisal, I'm Faisal")."""
    return {**context, "first_name": first_name or DEFAULT_FIRST_NAME}


async def cmd_run(args: argparse.Namespace) -> int:
    from app.config import get_settings
    from app.db import mongo
    from app.interviewer.llm import build_chats
    from app.interviewer.simulate import load_with_profile, simulate
    settings = get_settings()
    await mongo.connect(settings)
    try:
        blueprint, context, profile = await load_with_profile(args.session, [])
    finally:
        await mongo.close()
    context = scripted_context(context, args.first_name)
    if args.shape:
        blueprint = relayout(blueprint, args.shape)
    if args.realism_seed is not None:
        blueprint = attach_realism(blueprint, args.realism_seed, _profile_projects(profile))
    lines = Path(args.script).read_text(encoding="utf-8").splitlines()
    transcript: list[str] = []
    talker, fallback, director = build_chats(settings)
    try:
        run = await simulate(blueprint, context, lines, talker, director, fallback_chat=fallback, out=lambda s: transcript.append(str(s)),
                             addressed_mode=settings.addressed_check)
    finally:
        await talker.aclose()
        if fallback is not None:
            await fallback.aclose()
        await director.aclose()
    Path(args.out_prefix + ".txt").write_text("\n".join(transcript))
    Path(args.out_prefix + ".json").write_text(json.dumps(record_of(run, blueprint), default=str, indent=1))
    print("wrote", args.out_prefix + ".txt", args.out_prefix + ".json")
    return 0


CANDIDATE_MODEL = "deepseek/deepseek-v4.1-flash-1017"
JUDGE_MODEL = "anthropic/claude-sonnet-5.5"


def prepare_persona(spec: dict[str, Any], blueprint: dict[str, Any], context: dict[str, Any], profile: dict[str, Any],
                    shape: str | None = None) -> tuple[dict[str, Any], dict[str, Any], str]:
    """The persona's blueprint (re-laid out when a shape is given), the run context with the persona's own first name (so the
    interviewer does not greet "Hi Faisal, I'm Faisal"), and the resume text the candidate model is given."""
    from app.interviewer.persona import resume_text
    if shape:
        blueprint = relayout(blueprint, shape)
    return blueprint, {**context, "first_name": spec["first_name"]}, resume_text(profile)


def _openrouter(settings: Any, model: str, timeout_s: float, *, price_cap: bool = True) -> Any:
    from app.interviewer.llm import PROVIDER_ROUTING, OpenRouterChat
    # The live price cap is the DeepSeek flash tier; the judge is a stronger, dearer model and is never on the live path.
    routing = PROVIDER_ROUTING if price_cap else {k: v for k, v in PROVIDER_ROUTING.items() if k != "max_price"}
    return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url, model=model, reasoning="low",
                          timeout_s=timeout_s, routing=routing)


async def cmd_persona(args: argparse.Namespace) -> int:
    from app.config import get_settings
    from app.db import mongo
    from app.interviewer.llm import build_chats
    from app.interviewer.persona import PersonaCandidate
    from app.interviewer.simulate import load_with_profile, simulate
    if os.environ.get("REHEARSE_NO_PRICE_CAP"):
        # A model comparison (INTERVIEWER_TALKER_MODEL set to a dearer model for the run): the live price cap would refuse it. Rehearsal only.
        import app.interviewer.llm as llm_module
        llm_module.PROVIDER_ROUTING = {k: v for k, v in llm_module.PROVIDER_ROUTING.items() if k != "max_price"}
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    session, shape = args.session or spec["session"], args.shape or spec.get("shape")
    settings = get_settings()
    await mongo.connect(settings)
    try:
        blueprint, context, profile = await load_with_profile(session, [])
    finally:
        await mongo.close()
    blueprint, context, resume = prepare_persona(spec, blueprint, context, profile, shape)
    if args.realism_seed is not None:
        blueprint = attach_realism(blueprint, args.realism_seed, _profile_projects(profile))
    candidate_chat = _openrouter(settings, args.candidate_model, 60.0)
    persona = PersonaCandidate(spec, candidate_chat, resume)
    transcript: list[str] = []
    talker, fallback, director = build_chats(settings)
    try:
        run = await simulate(blueprint, context, persona, talker, director, fallback_chat=fallback, out=lambda s: transcript.append(str(s)),
                             addressed_mode=settings.addressed_check)
    finally:
        await talker.aclose()
        if fallback is not None:
            await fallback.aclose()
        await director.aclose()
        await candidate_chat.aclose()
    record = {**record_of(run, blueprint), "persona": spec["id"], "first_name": spec["first_name"], "session": session, "expect": spec.get("expect") or [],
              "max_candidate_turns": spec["max_candidate_turns"], "candidate_model": args.candidate_model, "candidate_usage": persona.usage,
              "candidate_failed": persona.failed, "silences": persona.silences, "selections": persona.selections, "code_log": persona.code_log, "topic": spec.get("topic") or []}
    Path(args.out_prefix + ".txt").write_text("\n".join(transcript))
    Path(args.out_prefix + ".json").write_text(json.dumps(record, default=str, indent=1))
    print("wrote", args.out_prefix + ".txt", args.out_prefix + ".json")
    return 0


def interviewer_cost(record: dict[str, Any]) -> float:
    return sum(((t.get("usage") or {}).get("cost") or 0) for t in record.get("turns") or [] if t.get("speaker") == "interviewer") \
        + sum(((b.get("usage") or {}).get("cost") or 0) for b in record.get("briefs") or [])


def persona_row(record: dict[str, Any]) -> list[Any]:
    """persona, session, shape, interviewer turns, trace failures, expectations passed/total, interviewer cost."""
    failures = [f for f in check_record(record) if f["severity"] == "fail"]
    results = check_expectations(record, record.get("expect") or [])
    return [record.get("persona"), str(record.get("session") or "")[:8], record.get("shape_id"),
            sum(1 for t in record.get("turns") or [] if t.get("speaker") == "interviewer"), len(failures),
            f"{sum(r['ok'] for r in results)}/{len(results)}", f"${interviewer_cost(record):.3f}"]


def _table(header: list[str], rows: list[list[Any]]) -> None:
    widths = [max(len(str(x)) for x in col) for col in zip(header, *rows)]
    for r in [header, *rows]:
        print("  ".join(str(x).ljust(w) for x, w in zip(r, widths)).rstrip())


async def _run_jobs(jobs: list[tuple[str, list[str]]], parallel: int) -> list[tuple[str, int]]:
    """Each job (a name and this script's arguments) as a subprocess, `parallel` at a time; the name and its exit code, in order."""
    gate = asyncio.Semaphore(parallel)

    async def one(name: str, args: list[str]) -> tuple[str, int]:
        async with gate:
            cmd = [sys.executable, os.path.abspath(__file__), *args[1:]]
            proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            out, _ = await proc.communicate()
            if proc.returncode:
                print(f"--- {name} failed ({proc.returncode}):\n{out.decode(errors='replace')[-1500:]}", file=sys.stderr)
            return name, proc.returncode or 0

    return list(await asyncio.gather(*(one(n, a) for n, a in jobs)))


async def cmd_personas(args: argparse.Namespace) -> int:
    specs = sorted(Path(args.dir).glob("*.json"))
    Path(args.out_dir).mkdir(parents=True, exist_ok=True)
    jobs = []
    for path in specs:
        cmd = [os.path.abspath(__file__), "persona", str(path), str(Path(args.out_dir) / path.stem)]
        if args.candidate_model:
            cmd += ["--candidate-model", args.candidate_model]
        jobs.append((path.stem, cmd))
    done = [(path, code) for path, (_, code) in zip(specs, await _run_jobs(jobs, args.parallel))]
    rows, bad = [], 0
    for path, code in done:
        out = Path(args.out_dir) / f"{path.stem}.json"
        if code or not out.exists():
            rows.append([path.stem, "-", "-", "-", "-", "RUN FAILED", "-"])
            bad += 1
            continue
        record = json.loads(out.read_text())
        row = persona_row(record)
        rows.append(row)
        bad += bool(row[4]) or any(not r["ok"] for r in check_expectations(record, record.get("expect") or []))
    _table(["persona", "session", "shape", "turns", "trace fails", "expect", "interviewer"], rows)
    for path, _ in done:
        out = Path(args.out_dir) / f"{path.stem}.json"
        if out.exists():
            for r in check_expectations(json.loads(out.read_text()), json.loads(path.read_text()).get("expect") or []):
                if not r["ok"]:
                    print(f"  FAIL {path.stem}: {r['expect']}: {r['detail']}")
    return 1 if bad else 0


BATCH_SESSION = "06b8d419-0a12-492d-9c14-ffcc682f6b7f"          # the session the scripted rehearsals run against
SCRIPTED = (("unplanned_topic", "unplanned_topic", None), ("intro_covers_projects", "intro_covers_projects", None), ("wanders_off", "wanders_off", None),
            ("unplanned_resume_opener", "unplanned_topic", "resume_opener"))      # (record name, script, shape)
JUDGE_KEYS = ("realism", "follows_candidate", "flow", "problem_handling", "tone", "integrity")


def batch_jobs(persona_dir: str, out_dir: str, scripted: bool) -> list[tuple[str, list[str]]]:
    """What the batch runs: `persona` for every spec in the directory, then with `scripted` the four scripted rehearsals (`run`)."""
    me = os.path.abspath(__file__)
    jobs = [(p.stem, [me, "persona", str(p), f"{out_dir}/{p.stem}"]) for p in sorted(Path(persona_dir).glob("*.json"))]
    if scripted:
        scripts = Path(me).parent / "flow_scenarios"
        for name, script, shape in SCRIPTED:
            jobs.append((f"rh_{name}", [me, "run", BATCH_SESSION, str(scripts / f"{script}.txt"), f"{out_dir}/rh_{name}", *(["--shape", shape] if shape else [])]))
    return jobs


BROKEN_RUN = re.compile(r"402|credit|insufficient|quota|payment", re.IGNORECASE)


def invalid_reason(record: dict[str, Any]) -> str | None:
    """Why a record cannot be trusted (credits or an outage ruin records silently): the candidate model failed, an interviewer turn failed
    with no speech, or a turn's error says credits, quota or payment. An attempt that failed over to another model is only counted."""
    if record.get("candidate_failed"):
        return "candidate model failed"
    for t in record.get("turns") or []:
        if t.get("speaker") != "interviewer" or not t.get("error"):
            continue
        if not str(t.get("text") or "").strip():
            return f"seq {t.get('seq')}: failed with no speech ({str(t['error'])[:60]})"
        if BROKEN_RUN.search(str(t["error"])):
            return f"seq {t.get('seq')}: {str(t['error'])[:60]}"
    return None


def failover_attempts(record: dict[str, Any]) -> int:
    return sum(1 for t in record.get("turns") or [] for a in t.get("attempts") or [] if not a.get("ok"))


def batch_row(name: str, record: dict[str, Any], judged: dict[str, Any] | None) -> dict[str, Any]:
    """One record's line in the batch summary: the trace and expectation results, the judge's scores and issue counts, the style metrics."""
    results = check_expectations(record, record.get("expect") or [])
    issues = [i.get("severity") for i in (judged or {}).get("issues") or []]
    reason = invalid_reason(record)
    return {"name": name, "valid": reason is None, "invalid_reason": reason,
            "trace_fails": sum(1 for f in check_record(record) if f["severity"] == "fail"),
            "expect": [sum(r["ok"] for r in results), len(results)], "failover": failover_attempts(record),
            "judge": {k: (judged[k] or {}).get("score") if isinstance(judged[k], dict) else judged[k] for k in (*JUDGE_KEYS, "overall") if k in judged}
            if judged and "error" not in judged else None,
            "major": issues.count("major"), "minor": issues.count("minor"), "style": style_metrics(record)}


def _mean(xs: list[float]) -> float | None:
    return round(sum(xs) / len(xs), 2) if xs else None


def batch_means(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """The means over the valid records only."""
    ok = [r for r in rows if r["valid"]]
    judged = [r for r in ok if r["judge"]]
    return {"records": len(ok), "trace_fails": _mean([r["trace_fails"] for r in ok]),
            "judge": {k: _mean([r["judge"][k] for r in judged if r["judge"].get(k) is not None]) for k in (*JUDGE_KEYS, "overall")},
            "major": _mean([r["major"] for r in judged]), "minor": _mean([r["minor"] for r in judged]),
            "style": {k: _mean([r["style"][k] for r in ok if r["style"][k] is not None]) for k in
                      ("verdict_rate", "echo_rate", "blocked_rate", "filler_lines", "minutes_before_first_problem")}}


def _batch_line(r: dict[str, Any]) -> list[Any]:
    j, st = r["judge"] or {}, r["style"]
    return [r["name"] + ("" if r["valid"] else " INVALID"), r["trace_fails"], f"{r['expect'][0]}/{r['expect'][1]}",
            *[j.get(k, "-") for k in (*JUDGE_KEYS, "overall")], r["major"] if r["judge"] else "-", r["minor"] if r["judge"] else "-",
            st["verdict_rate"], st["echo_rate"], st["blocked_rate"], st["filler_lines"], st["minutes_before_first_problem"] if st["minutes_before_first_problem"] is not None else "-",
            r["failover"]]


BATCH_HEADER = ["record", "fails", "expect", "real", "follow", "flow", "prob", "tone", "integ", "overall", "major", "minor",
                "verdict", "echo", "blocked", "filler", "min1st", "failover"]


async def cmd_batch(args: argparse.Namespace) -> int:
    import contextlib
    import io
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = batch_jobs(args.persona_dir, str(out_dir), args.scripted)
    done = dict(await _run_jobs(jobs, args.parallel))
    records = {n: json.loads((out_dir / f"{n}.json").read_text()) for n, _ in jobs if not done[n] and (out_dir / f"{n}.json").exists()}
    judged: dict[str, Any] = {}
    if args.judge and records:
        judge_file = out_dir / "judge.json"
        with contextlib.redirect_stdout(io.StringIO()):       # the batch prints one table of its own
            await cmd_judge(argparse.Namespace(records=[str(out_dir / f"{n}.json") for n in records], model=JUDGE_MODEL, out=str(judge_file)))
        by_path = json.loads(judge_file.read_text()) if judge_file.exists() else {}
        judged = {n: by_path.get(str(out_dir / f"{n}.json")) for n in records}
    rows = [batch_row(n, r, judged.get(n)) for n, r in records.items()]
    means = batch_means(rows)
    lines = [_batch_line(r) for r in rows]
    for n, _ in jobs:
        if n not in records:
            lines.append([f"{n} RUN FAILED", *["-"] * (len(BATCH_HEADER) - 1)])
    j, st = means["judge"], means["style"]
    lines.append(["MEAN (valid)", means["trace_fails"], "-", *[j.get(k) for k in (*JUDGE_KEYS, "overall")], means["major"], means["minor"],
                  st["verdict_rate"], st["echo_rate"], st["blocked_rate"], st["filler_lines"], st["minutes_before_first_problem"], "-"])
    _table(BATCH_HEADER, [[("-" if c is None else c) for c in line] for line in lines])
    (out_dir / "summary.json").write_text(json.dumps({"records": rows, "means": means, "run_failed": [n for n, c in done.items() if c]}, indent=1))
    left_out = [f"{r['name']} INVALID ({r['invalid_reason']})" for r in rows if not r["valid"]] + [f"{n} RUN FAILED" for n, c in done.items() if c]
    if left_out:
        print("Left out of the means: " + "; ".join(left_out))
    print("wrote", out_dir / "summary.json")
    return 0


async def cmd_judge(args: argparse.Namespace) -> int:
    from app.config import get_settings
    from app.interviewer.judge import DIMENSIONS, judge_record, table_row
    from app.interviewer.llm import LLMUnavailable
    settings = get_settings()
    chat = _openrouter(settings, args.model, 180.0, price_cap=False)
    results: dict[str, Any] = {}
    rows = []
    try:
        for pattern in args.records:
            for path in sorted(glob.glob(pattern)) or [pattern]:
                record = json.loads(Path(path).read_text())
                txt = Path(path).with_suffix(".txt")    # the event log: what the candidate saw, highlighted and typed
                log = txt.read_text().splitlines() if txt.exists() else None
                for attempt in range(2):                # one retry: a truncated or failed reply should not lose the batch
                    try:
                        result = await judge_record(chat, record, log)
                        break
                    except LLMUnavailable as exc:
                        result = {"error": str(exc)[:300]}
                results[path] = result
                if "error" in result:
                    print("judge failed:", path, result["error"][:120], file=sys.stderr)
                else:
                    rows.append(table_row(record.get("persona") or Path(path).stem, result))
                if args.out:                            # written as it goes, so a crash keeps what was judged
                    Path(args.out).write_text(json.dumps(results, indent=1))
    finally:
        await chat.aclose()
    _table(["transcript", *DIMENSIONS, "overall", "worst moment"], [[*r[:8], str(r[8])[:90]] for r in rows])
    if args.out:
        Path(args.out).write_text(json.dumps(results, indent=1))
        print("wrote", args.out)
    return 0


def _pct(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else 0


def _stats(prefix: str) -> tuple[dict[str, float], list[float], list[float], collections.Counter, list[tuple]]:
    agg: dict[str, float] = collections.defaultdict(float)
    first_token, end_to_first, rows = [], [], []
    blocked: collections.Counter = collections.Counter()
    for scenario in SCENARIOS:
        path = Path(f"{prefix}{scenario}.json")
        if not path.exists():
            continue
        r = json.loads(path.read_text())
        t = [x for x in r["turns"] if x.get("speaker") == "interviewer"]
        usage = [x.get("usage") or {} for x in t]
        tcost = sum(u.get("cost") or 0 for u in usage)
        dcost = sum(((b.get("usage") or {}).get("cost") or 0) for b in r["briefs"])
        prompt = sum(u.get("prompt_tokens") or 0 for u in usage)
        cached = sum(((u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0) for u in usage)
        out = sum(u.get("completion_tokens") or 0 for u in usage)
        logged = sum(1 for x in t if x.get("decision") and not x["decision"].get("inferred"))    # the model's own log_turn calls
        unlogged = sum(1 for x in t if x.get("decision") and x["decision"].get("inferred"))
        moves = sum(1 for x in t for c in x.get("tool_calls") or [] if c["name"] in FLOW)
        inferred = sum(1 for m in r["flow_log"] if "inferred" in (m.get("why") or ""))
        skipped = [i["item_id"] for i in r["items"] if i["kind"] == "slot" and i["status"] == "done" and i["turns"] == 0]
        for x in t:
            if x.get("first_token_ms"):
                first_token.append(x["first_token_ms"])
            if x.get("end_to_first_token_ms") is not None and x["end_to_first_token_ms"] > 0:
                end_to_first.append(x["end_to_first_token_ms"])
            for b in x.get("blocked") or []:
                blocked[b.get("rule")] += 1
        for key, value in (("turns", len(t)), ("tcost", tcost), ("dcost", dcost), ("prompt", prompt), ("cached", cached), ("out", out),
                           ("logged", logged), ("unlogged", unlogged), ("moves", moves), ("inferred", inferred), ("briefs", len(r["briefs"]))):
            agg[key] += value
        rows.append((scenario, len(t), tcost, dcost, logged, moves, inferred, skipped))
    return agg, first_token, end_to_first, blocked, rows


def cmd_compare(args: argparse.Namespace) -> int:
    for prefix in args.prefixes:
        agg, ft, e2e, blocked, rows = _stats(prefix)
        n = agg["turns"] or 1
        print(f"\n######## {prefix}")
        for s, turns, tc, dc, lg, mv, inf, sk in rows:
            print(f"  {s:26s} turns {turns:3d} | talker ${tc:.4f} | director ${dc:.4f} | log_turn {lg} | tool moves {mv} | inferred {inf} | problems skipped {sk or '-'}")
        print(f"  TOTAL turns {int(n)} | talker ${agg['tcost']:.4f} (${agg['tcost'] / n:.5f}/turn) | director ${agg['dcost']:.4f} over {int(agg['briefs'])} briefs")
        print(f"  prompt tokens/turn {agg['prompt'] / n:.0f}, cached {100 * agg['cached'] / max(1, agg['prompt']):.0f}% | output tokens/turn {agg['out'] / n:.0f}")
        print(f"  first token ms: median {statistics.median(ft) if ft else 0:.0f}, p90 {_pct(ft, 0.9)} | end-of-turn to first token ms: "
              f"median {statistics.median(e2e) if e2e else 0:.0f}, p90 {_pct(e2e, 0.9)}")
        print(f"  log_turn {100 * agg['logged'] / n:.0f}% of turns (model decisions; {int(agg['unlogged'])} turns had it inferred by the conductor) | tool moves {int(agg['moves'])} | inferred moves {int(agg['inferred'])} | "
              f"blocked sentences {dict(blocked)}")
        print(f"  estimate per 45-min round at 80 talker turns: talker ${80 * agg['tcost'] / n:.3f}")
    return 0


async def _session_record(session_id: str) -> dict[str, Any]:
    """A real session's stored turns, wrapped like a rehearsal record (the plan's parts and flow log from its last checkpoint)."""
    from app.config import get_settings
    from app.db import mongo
    from app.interviewer.store import MongoStore
    await mongo.connect(get_settings())
    try:
        store = MongoStore()
        run = await store.load_run(session_id) or {}
        checkpoint = run.get("checkpoint") or {}
        return {"shape_id": run.get("shape_id", "classic"), "turns": await store.turns(session_id), "briefs": await store.briefs(session_id),
                "items": checkpoint.get("items") or [], "flow_log": checkpoint.get("flow_log") or [],
                "follow_ups": checkpoint.get("follow_ups") or {}, "end_reason": run.get("end_reason"), "promises": checkpoint.get("promises"),
                "board_summary": (run.get("mirror") or {}).get("board_summary") or ""}
    finally:
        await mongo.close()


async def cmd_check(args: argparse.Namespace) -> int:
    records: dict[str, dict[str, Any]] = {}
    if args.session:
        records[f"session {args.session}"] = await _session_record(args.session)
    for pattern in args.records:
        for path in sorted(glob.glob(pattern)) or [pattern]:
            records[path] = json.loads(Path(path).read_text())
    if not records:
        print("nothing to check: give RECORD.json files or --session ID", file=sys.stderr)
        return 2
    total = 0
    wanted = [e for e in (args.expect or "").split(",") if e]
    for name, record in records.items():
        for r in check_expectations(record, wanted or record.get("expect") or []):
            total += not r["ok"]
            print(f"  {'ok  ' if r['ok'] else 'FAIL'} expect {r['expect']:<26} {r['detail']}")
        findings = check_record(record)
        failures = [f for f in findings if f["severity"] == "fail"]
        total += len(failures)
        print(f"{name}: {len(failures)} finding(s), {len(findings) - len(failures)} note(s)")
        for f in findings:
            print(f"  seq {f['seq']:>3}  {f['severity'].upper():<4} {f['check']:<26} {f['detail']}")
    return 1 if total else 0


# ---------------------------------------------------------------- the variety report

MIN_DIFFERENCES = 3                 # a pair of runs passes when it differs in at least this many of the six aspects


def _realism(record: dict[str, Any]) -> dict[str, Any]:
    return (record.get("blueprint") or {}).get("realism") or {}


def _spoken_by_interviewer(record: dict[str, Any]) -> list[str]:
    return [str(t.get("text") or "") for t in record.get("turns") or [] if t.get("speaker") == "interviewer" and not t.get("interrupted")]


def top_openers(record: dict[str, Any], n: int = 5) -> list[str]:
    """The `n` most used openers (talker.turn_opener of each interviewer turn's first sentence), most used first, ties in order of first use."""
    from app.interviewer.talker import turn_opener
    counts: collections.Counter = collections.Counter()
    for text in _spoken_by_interviewer(record):
        first = next((x for x in re.split(r"(?<=[.?!])\s+", text.strip()) if x), "")
        opener = turn_opener(first) if first else None
        if opener:
            counts[opener] += 1
    return [o for o, _ in counts.most_common(n)]


def variety_profile(record: dict[str, Any]) -> dict[str, Any]:
    """What the report compares for one record: the round's length, the outline's part order, the areas and projects the deep dive promised
    (projects: those the interviewer actually named), the persona's traits and the five most used openers."""
    from app.interviewer.plan import mentions
    bp = record.get("blueprint") or {}
    outline = _realism(record).get("outline") or []
    promises = [str(x) for part in outline for x in part.get("promises") or []]
    projects = [p.partition(":")[2] for p in promises if p.startswith("projects:")]
    text = " ".join(_spoken_by_interviewer(record))
    return {"length": (bp.get("round") or {}).get("duration_mins"), "outline order": [p.get("part") for p in outline],
            "promised areas": sorted(p.partition(":")[2] for p in promises if p.startswith("fundamentals:")),
            "projects asked": sorted(p for p in projects if mentions(p, text)), "persona traits": _realism(record).get("traits") or {},
            "openers": sorted(top_openers(record))}


VARIETY_ASPECTS = ("length", "outline order", "promised areas", "projects asked", "persona traits", "openers")


def variety_differences(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    """The aspects in which two records differ, in the report's order."""
    pa, pb = variety_profile(a), variety_profile(b)
    return [k for k in VARIETY_ASPECTS if pa[k] != pb[k]]


def variety_verdict(records: list[dict[str, Any]]) -> tuple[bool, list[tuple[int, int, list[str]]]]:
    """Every pair's differences, and whether every pair differs in at least MIN_DIFFERENCES aspects."""
    rows = [(i, j, variety_differences(records[i], records[j])) for i in range(len(records)) for j in range(i + 1, len(records))]
    return bool(rows) and all(len(d) >= MIN_DIFFERENCES for _, _, d in rows), rows


def cmd_variety(args: argparse.Namespace) -> int:
    paths = [p for pattern in args.records for p in (sorted(glob.glob(pattern)) or [pattern])]
    records = [json.loads(Path(p).read_text()) for p in paths]
    if len(records) < 2:
        print("variety needs at least two RECORD.json files", file=sys.stderr)
        return 2
    for path, record in zip(paths, records):
        print(f"{path}")
        for key, value in variety_profile(record).items():
            print(f"  {key:15} {value}")
    ok, rows = variety_verdict(records)
    for i, j, diff in rows:
        verdict = "PASS" if len(diff) >= MIN_DIFFERENCES else "FAIL"
        print(f"{verdict} {paths[i]} vs {paths[j]}: {len(diff)} difference(s) of {len(VARIETY_ASPECTS)}: {', '.join(diff) or 'none'}")
    print("variety: " + ("PASS" if ok else f"FAIL (every pair must differ in at least {MIN_DIFFERENCES})"))
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="simulate a scripted candidate and write OUT_PREFIX.txt / .json (paid)")
    run.add_argument("session")
    run.add_argument("script")
    run.add_argument("out_prefix")
    run.add_argument("--shape", help="re-lay the stored blueprint out as this round shape, in memory")
    run.add_argument("--first-name", default=DEFAULT_FIRST_NAME, help="the candidate's first name (default %(default)s)")
    run.add_argument("--realism-seed", type=int, help="build a realism block in memory from this seed (a stored blueprint has none)")
    per = sub.add_parser("persona", help="simulate a model-played persona candidate and write OUT_PREFIX.txt / .json (paid)")
    per.add_argument("spec")
    per.add_argument("out_prefix")
    per.add_argument("--session", help="use this session's blueprint instead of the spec's")
    per.add_argument("--shape", help="re-lay the blueprint out as this round shape (default: the spec's)")
    per.add_argument("--candidate-model", default=CANDIDATE_MODEL)
    per.add_argument("--realism-seed", type=int, help="build a realism block in memory from this seed (a stored blueprint has none)")
    pers = sub.add_parser("personas", help="run every persona spec in DIR and print a summary table (paid)")
    pers.add_argument("dir")
    pers.add_argument("out_dir")
    pers.add_argument("--parallel", type=int, default=3)
    pers.add_argument("--candidate-model", default=None)
    bat = sub.add_parser("batch", help="run the personas (and with --scripted the four scripted rehearsals), check, optionally judge, and summarise (paid)")
    bat.add_argument("persona_dir")
    bat.add_argument("out_dir")
    bat.add_argument("--parallel", type=int, default=5)
    bat.add_argument("--scripted", action="store_true")
    bat.add_argument("--judge", action="store_true")
    jdg = sub.add_parser("judge", help="a model scores transcripts as a senior interviewer would (paid)")
    jdg.add_argument("records", nargs="+", metavar="RECORD.json")
    jdg.add_argument("--model", default=JUDGE_MODEL)
    jdg.add_argument("--out", help="write the judgements as JSON here")
    cmp_ = sub.add_parser("compare", help="cost, latency and move statistics for PREFIX + each scenario")
    cmp_.add_argument("prefixes", nargs="+", metavar="PREFIX")
    var = sub.add_parser("variety", help="how different two or more runs of one persona were; exit 1 when a pair differs in fewer than 3 aspects")
    var.add_argument("records", nargs="+", metavar="RECORD.json")
    chk = sub.add_parser("check", help="run the trace check; exit 1 on any finding")
    chk.add_argument("records", nargs="*", metavar="RECORD.json")
    chk.add_argument("--expect", help="comma-separated persona expectation ids to check as well")
    chk.add_argument("--session", help="check a real session's stored turns instead of (or as well as) record files")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "compare":
        return cmd_compare(args)
    if args.command == "variety":
        return cmd_variety(args)
    commands = {"run": cmd_run, "check": cmd_check, "persona": cmd_persona, "personas": cmd_personas, "judge": cmd_judge, "batch": cmd_batch}
    return asyncio.run(commands[args.command](args))


if __name__ == "__main__":
    sys.exit(main())
