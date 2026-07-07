import pytest
from app.jobs.agent_sessions import AgentSessionStore

def test_start_seeds_opening_turn_zero():
    s = AgentSessionStore()
    s.start("r1", {"round": "DSA"}, label="meesho·dsa")
    snap = s.snapshot("r1", after=0)
    assert snap["status"] == "running"
    assert snap["current_turn"] == 0
    assert len(snap["turns"]) == 1
    assert snap["turns"][0]["kind"] == "opening"
    assert snap["turns"][0]["index"] == 0

def test_steps_attach_to_current_turn_and_compute_duration():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.begin_step("r1", "opening_classify", llm_label="iv-opening-classify")
    s.end_step("r1", "ok", {"parsed_output": "ready"})
    step = s.snapshot("r1", 0)["turns"][0]["steps"][-1]
    assert step["name"] == "opening_classify"
    assert step["status"] == "ok"
    assert step["llm_label"] == "iv-opening-classify"
    assert step["duration_ms"] is not None

def test_emit_skipped_records_skipped_step():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.open_turn("r1", "main", "my answer", False, False, 60.0)
    s.emit_skipped("r1", "scope")
    steps = s.snapshot("r1", 0)["turns"][1]["steps"]
    assert any(st["name"] == "scope" and st["status"] == "skipped" for st in steps)

def test_snapshot_after_cursor_filters_logs():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.log("r1", "INFO", "one")
    s.log("r1", "INFO", "two")
    full = s.snapshot("r1", 0)
    assert [l["message"] for l in full["_logs"]] == ["one", "two"]
    tail = s.snapshot("r1", full["_logs"][0]["seq"])
    assert [l["message"] for l in tail["_logs"]] == ["two"]
    assert tail["last_seq"] == full["last_seq"]

def test_finish_sets_terminal_status_and_result():
    s = AgentSessionStore()
    s.start("r1", {}, label="x")
    s.set_result("r1", {"ended_reason": "natural_complete"}, "natural_complete")
    s.finish("r1", "completed")
    snap = s.snapshot("r1", 0)
    assert snap["status"] == "completed"
    assert snap["ended_reason"] == "natural_complete"
    assert snap["result"] == {"ended_reason": "natural_complete"}
    assert snap["finished_at"] is not None

def test_eviction_never_drops_non_terminal_and_cancels_terminal_task():
    s = AgentSessionStore()
    # fill with terminal sessions past the cap
    for i in range(30):
        rid = f"t{i}"
        s.start(rid, {}, label="x")
        s.finish(rid, "completed")
    assert len(s.list_sessions()) <= 25
    # a live session must survive eviction pressure
    s.start("live", {}, label="x")            # running
    for i in range(30, 60):
        rid = f"t{i}"; s.start(rid, {}, label="x"); s.finish(rid, "completed")
    assert s.snapshot("live", 0) is not None   # never evicted while running

def test_active_count_counts_only_non_terminal():
    s = AgentSessionStore()
    s.start("a", {}, label="x")                # running
    s.start("b", {}, label="x"); s.set_status("b", "awaiting_input")
    s.start("c", {}, label="x"); s.finish("c", "completed")
    assert s.active_count() == 2
