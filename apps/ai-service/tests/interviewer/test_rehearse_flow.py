"""The persona runner's pure parts: the persona's context, resume and shape, and the summary row."""
import importlib.util
import json
from pathlib import Path

from tests.interviewer.fixtures import blueprint, context
from tests.interviewer.test_tracecheck import cand, iv, phase, slot

SCRIPT = Path(__file__).parents[2] / "scripts" / "rehearse_flow.py"
spec = importlib.util.spec_from_file_location("rehearse_flow", SCRIPT)
rehearse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearse)

PERSONA = {"id": "p", "first_name": "Sneha", "behaviour": "b", "coding": "c", "max_candidate_turns": 5}
PROFILE = {"headline": "Backend engineer", "skills": ["Go"], "projects": [{"name": "Split-bill app", "summary": "settles balances"}]}


def test_the_persona_sets_its_own_first_name_and_gets_the_blueprints_profile_as_its_resume():
    bp, ctx, resume = rehearse.prepare_persona(PERSONA, blueprint(), {**context(), "first_name": "there"}, PROFILE)
    assert ctx["first_name"] == "Sneha" and bp == blueprint()
    assert "Backend engineer" in resume and "Split-bill app" in resume and "settles balances" in resume


def test_a_shape_re_lays_the_arc_out_in_memory_and_leaves_the_stored_blueprint_alone():
    stored = blueprint()
    bp, _, _ = rehearse.prepare_persona(PERSONA, stored, context(), PROFILE, "brisk")
    assert bp["shape_id"] == "brisk" and stored == blueprint()


def test_the_summary_row_counts_turns_trace_failures_expectations_and_cost():
    record = {"persona": "p", "session": "574ef4b2-b391", "shape_id": "classic", "expect": ["problem_reached", "hint_given"], "clock_start": 0,
              "turns": [iv(1, "Hi.", usage={"cost": 0.01}), cand(2), iv(3, "Next.", usage={"cost": 0.02})], "items": [slot("core-1", turns=2)],
              "briefs": [{"usage": {"cost": 0.005}}]}
    assert rehearse.persona_row(record) == ["p", "574ef4b2", "classic", 2, 0, "1/2", "$0.035"]


def test_check_expectations_accepts_a_persona_records_own_list_through_the_cli(tmp_path, capsys):
    record = {"persona": "p", "expect": ["hint_given"], "turns": [iv(1, "Hello there.")], "items": [phase("greeting")], "flow_log": [], "briefs": []}
    path = tmp_path / "r.json"
    path.write_text(json.dumps(record))
    import argparse
    import asyncio
    code = asyncio.run(rehearse.cmd_check(argparse.Namespace(session=None, records=[str(path)], expect=None)))
    assert code == 1 and "FAIL expect hint_given" in capsys.readouterr().out


# ---- the measurement batch (S6)

JUDGED = {"realism": {"score": 3}, "follows_candidate": {"score": 4}, "flow": {"score": 4}, "problem_handling": {"score": 5}, "tone": {"score": 4},
          "integrity": {"score": 5}, "overall": 4, "worst_moment": {"quote": "q", "why": "w"},
          "issues": [{"quote": "a", "dimension": "tone", "severity": "major", "why": "x"}, {"quote": "b", "dimension": "flow", "severity": "minor", "why": "y"},
                     {"quote": "c", "dimension": "flow", "severity": "minor", "why": "z"}]}


def _good(name="p"):
    return {"persona": name, "expect": ["problem_reached"], "clock_start": 0, "items": [slot("core-1", turns=2)],
            "turns": [iv(1, "That's a solid start. Did it hold up?", attempts=[{"model": "m", "ms": 5, "ok": True}]), cand(2),
                      iv(3, "Okay. Next.", attempts=[{"model": "m", "ms": 5, "ok": True}])]}


def test_a_batch_row_carries_trace_fails_expectations_the_judge_scores_issue_counts_and_style_metrics():
    row = rehearse.batch_row("p", _good(), JUDGED)
    assert row["valid"] is True and row["name"] == "p"
    assert row["trace_fails"] == 0 and row["expect"] == [1, 1]
    assert row["judge"] == {"realism": 3, "follows_candidate": 4, "flow": 4, "problem_handling": 5, "tone": 4, "integrity": 5, "overall": 4}
    assert (row["major"], row["minor"]) == (1, 2)
    assert row["style"]["verdict_rate"] == 0.5


def test_a_record_is_invalid_only_for_real_breakage_and_a_failed_over_attempt_is_only_counted():
    failover = _good("f")
    failover["turns"][0]["attempts"] = [{"model": "m", "ms": 5, "ok": False, "error": "TimeoutError"}, {"model": "m2", "ms": 5, "ok": True}]
    silent_error = _good("s")
    silent_error["turns"][2].update({"text": "", "error": "all models failed"})
    credit = _good("k")
    credit["turns"][2]["error"] = "OpenRouter 402: insufficient credits"
    failed = {**_good("c"), "candidate_failed": 2}
    assert rehearse.invalid_reason(failover) is None and rehearse.invalid_reason(_good()) is None
    assert all(rehearse.invalid_reason(r) for r in (silent_error, credit, failed))
    assert rehearse.batch_row("f", failover, JUDGED)["failover"] == 1
    rows = [rehearse.batch_row("a", _good("a"), JUDGED), rehearse.batch_row("b", credit, {**JUDGED, "overall": 1}), rehearse.batch_row("c", failed, None)]
    assert [r["valid"] for r in rows] == [True, False, False]
    means = rehearse.batch_means(rows)
    assert means["records"] == 1 and means["judge"]["overall"] == 4 and means["style"]["verdict_rate"] == 0.5


def test_the_batch_runs_every_persona_and_with_scripted_the_four_scripted_rehearsals(tmp_path):
    (tmp_path / "a.json").write_text("{}")
    (tmp_path / "b.json").write_text("{}")
    jobs = rehearse.batch_jobs(str(tmp_path), "/out", scripted=True)
    names = [n for n, _ in jobs]
    assert names == ["a", "b", "rh_unplanned_topic", "rh_intro_covers_projects", "rh_wanders_off", "rh_unplanned_resume_opener"]
    last = dict(jobs)["rh_unplanned_resume_opener"]
    assert last[1] == "run" and "06b8d419-0a12-492d-9c14-ffcc682f6b7f" in last and last[-2:] == ["--shape", "resume_opener"]
    assert last[3].endswith("unplanned_topic.txt") and last[4] == "/out/rh_unplanned_resume_opener"
    assert [n for n, _ in rehearse.batch_jobs(str(tmp_path), "/out", scripted=False)] == ["a", "b"]


def test_a_scripted_run_gives_the_candidate_a_distinct_first_name_rahul_by_default():
    """b1 rh_unplanned_resume_opener opened "Hi Faisal, I'm Faisal": the stored context carried the interviewer's own first name."""
    ctx = {**context(), "first_name": "Faisal"}
    assert rehearse.scripted_context(ctx, None)["first_name"] == "Rahul"
    assert rehearse.scripted_context(ctx, "Meera")["first_name"] == "Meera"
    assert ctx["first_name"] == "Faisal"                                             # the stored context is left alone
    assert rehearse.build_parser().parse_args(["run", "s", "script.txt", "out"]).first_name == "Rahul"
    assert rehearse.build_parser().parse_args(["run", "s", "script.txt", "out", "--first-name", "Meera"]).first_name == "Meera"


def test_the_record_keeps_whether_each_problem_was_coded():
    assert "coded" in rehearse.ITEM_FIELDS
