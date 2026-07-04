"""Keyed pipeline run store: step lifecycle, incremental logs, terminal transitions, LRU."""
from app.jobs.pipeline_runs import PipelineRunStore


def _store():
    return PipelineRunStore(max_runs=3)


def test_start_run_predeclares_pending_steps():
    s = _store()
    rid = s.start_run("resume_parse", "bench", "cv.pdf", ["a", "b", "c"])
    snap = s.snapshot(rid)
    assert snap["status"] == "running"
    assert [step["name"] for step in snap["steps"]] == ["a", "b", "c"]
    assert all(step["status"] == "pending" for step in snap["steps"])


def test_step_lifecycle_and_detail():
    s = _store()
    rid = s.start_run("resume_parse", "bench", "cv.pdf", ["extract", "llm"])
    s.begin_step(rid, "extract")
    s.end_step(rid, "extract", "ok", {"char_count": 42})
    snap = s.snapshot(rid)
    extract = snap["steps"][0]
    assert extract["status"] == "ok"
    assert extract["detail"]["char_count"] == 42
    assert extract["duration_ms"] is not None
    assert snap["current_step"] is None


def test_logs_are_incremental_by_seq():
    s = _store()
    rid = s.start_run("resume_parse", "bench", "cv.pdf", ["a"])
    s.log(rid, "INFO", "one")
    s.log(rid, "INFO", "two")
    full = s.snapshot(rid, after=0)
    assert [e["message"] for e in full["logs"]] == ["one", "two"]
    assert full["last_seq"] == 2
    incremental = s.snapshot(rid, after=1)
    assert [e["message"] for e in incremental["logs"]] == ["two"]


def test_finish_failed_marks_pending_skipped_and_running_failed():
    s = _store()
    rid = s.start_run("resume_parse", "bench", "cv.pdf", ["a", "b", "c"])
    s.begin_step(rid, "a")
    s.end_step(rid, "a", "ok")
    s.begin_step(rid, "b")  # left running
    s.finish(rid, "failed", {"step": "b", "message": "boom"})
    snap = s.snapshot(rid)
    statuses = {step["name"]: step["status"] for step in snap["steps"]}
    assert statuses == {"a": "ok", "b": "failed", "c": "skipped"}
    assert snap["status"] == "failed"
    assert snap["error"]["step"] == "b"


def test_set_result_and_completed():
    s = _store()
    rid = s.start_run("resume_parse", "bench", "cv.pdf", ["done"])
    s.set_result(rid, {"full_name": "Asha"})
    s.finish(rid, "completed")
    snap = s.snapshot(rid)
    assert snap["status"] == "completed"
    assert snap["result"] == {"full_name": "Asha"}


def test_list_runs_newest_first_and_pipeline_filter():
    s = _store()
    r1 = s.start_run("resume_parse", "bench", "one", ["a"])
    r2 = s.start_run("interview_prep", "bench", "two", ["a"])
    runs = s.list_runs()
    assert [r["run_id"] for r in runs] == [r2, r1]  # newest first
    only_resume = s.list_runs("resume_parse")
    assert [r["run_id"] for r in only_resume] == [r1]


def test_lru_evicts_oldest_non_running():
    s = _store()  # max_runs = 3
    rids = []
    for i in range(3):
        rid = s.start_run("resume_parse", "bench", str(i), ["a"])
        s.finish(rid, "completed")  # not running, evictable
        rids.append(rid)
    r4 = s.start_run("resume_parse", "bench", "3", ["a"])
    assert s.snapshot(rids[0]) is None      # oldest evicted
    assert s.snapshot(rids[2]) is not None
    assert s.snapshot(r4) is not None


def test_snapshot_unknown_run_id_is_none():
    assert _store().snapshot("does-not-exist") is None
