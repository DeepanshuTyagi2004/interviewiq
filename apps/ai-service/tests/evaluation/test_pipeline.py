import asyncio

import pytest

from app.evaluation import pipeline
from app.evaluation.models import DisputeInput
from app.evaluation.score import PartScore, compute
from app.evaluation.models import PartGrade
from tests.evaluation.fakes import MemoryEvalStore, Settings, chats, load, request


def run_to_end(req, fake_chats, monkeypatch, fixture=None):
    mem = MemoryEvalStore(fixture or load()).install(monkeypatch)
    monkeypatch.setattr(pipeline, "chat_factory", lambda settings: fake_chats)

    async def go():
        out = await pipeline.start_run(req, Settings())
        await pipeline._TASKS[out["run_id"]]
        return out["run_id"]

    run_id = asyncio.run(go())
    return mem, mem.runs[run_id]


def test_full_run_dsa_fixture(monkeypatch):
    mem, run = run_to_end(request(), chats(7.0), monkeypatch)
    assert run["status"] == "completed", run.get("error")
    assert run["result"]["version"] == 1 and run["result"]["outcome"] in ("passed", "below_pass")
    rep = mem.evals[0]["report"]
    for key in ("meta", "score", "pass_mark", "outcome", "verdict", "cap", "practical_score", "theory_score", "areas", "adjustments",
                "questions", "delivery", "conduct", "integrity", "focus", "topic_gaps", "strengths", "summary", "end_questions",
                "transcript", "disputes", "weights_version", "eval_version"):
        assert key in rep, key
    assert rep["areas"] and next(a for a in rep["areas"] if a["key"] == "approach")["previous_score"] == 5.9
    assert rep["topic_gaps"][0]["topics"][0]["practice"][0]["slug"] == "two-sum"
    assert rep["questions"][0]["code"]["text"].startswith("def pair_sum")
    assert any(a["kind"] == "paste" for a in rep["adjustments"]) and rep["integrity"] and rep["conduct"]
    # reproducible: the stored arithmetic recomputes to the stored score
    ev = mem.evals[0]
    merged = {k: PartGrade.model_validate(v) for k, v in ev["merged"].items()}
    arith = run["arithmetic"]
    scores = [PartScore(p["part_id"], p["family"], p["share"], p["areas"], p["must_have_met"]) for p in arith["parts"]]
    from app.evaluation.score import Adjustment
    again = compute(scores, [Adjustment(**a) for a in arith["adjustments"]], arith["pass_mark"], arith["main_family"], arith["auto_fail"])
    assert again.score == rep["score"] == run["result"]["score"]
    assert set(merged) == {"core-1"}


def test_no_code_round_caps(monkeypatch):
    fx = load()
    cp = fx["run"]["checkpoint"]
    cp.update(proctor=[], warnings_given=[], pastes=[], change_requests={}, change_given=False, changes_round=0)
    for it in cp["items"]:
        if it["item_id"] == "core-1":
            it["code_final"], it["hint_step"] = "", 0
    mem, run = run_to_end(request(), chats(9.0, must=False, logic="no"), monkeypatch, fx)
    assert run["status"] == "completed", run.get("error")
    rep = mem.evals[0]["report"]
    assert rep["cap"] and rep["outcome"] == "below_pass" and rep["score"] <= 6.0
    assert rep["questions"][0]["code"]["text"] == ""


def test_unscorable_technical(monkeypatch):
    fx = load()
    fx["run"]["end_reason"] = "technical"
    fake = chats()

    def boom(settings):
        raise AssertionError("no LLM may be built for an unscorable round")

    mem = MemoryEvalStore(fx).install(monkeypatch)
    monkeypatch.setattr(pipeline, "chat_factory", boom)

    async def go():
        out = await pipeline.start_run(request(), Settings())
        await pipeline._TASKS[out["run_id"]]
        return out["run_id"]

    run = mem.runs[asyncio.run(go())]
    assert run["status"] == "completed" and run["result"]["outcome"] == "unscorable" and run["result"]["score"] is None
    rep = mem.evals[0]["report"]
    assert rep["outcome"] == "unscorable" and rep["unscorable_reason"] and rep["transcript"] and "areas" not in rep
    assert all(c.calls == [] for c in fake)


def _dispute(mem, monkeypatch, recheck, target="main"):
    current = max(e["version"] for e in mem.evals)
    monkeypatch.setattr(pipeline, "chat_factory", lambda settings: chats(7.0, recheck=recheck))
    req = request(trigger="dispute", dispute=DisputeInput(target_type="question", target_id=target, reason="I had it", report_version=current))

    async def go():
        out = await pipeline.start_run(req, Settings())
        await pipeline._TASKS[out["run_id"]]
        return out["run_id"]

    return mem.runs[asyncio.run(go())]


def test_dispute_upheld_and_revised(monkeypatch):
    mem, first = run_to_end(request(), chats(7.0), monkeypatch)
    score1 = mem.evals[0]["report"]["score"]
    up = _dispute(mem, monkeypatch, {"decision": "upheld", "score": 7.0, "explanation": "Stands."})
    assert up["status"] == "completed", up.get("error")
    assert len(mem.evals) == 2 and mem.evals[1]["version"] == 2 and mem.evals[1]["report"]["score"] == score1
    assert mem.evals[1]["report"]["disputes"][0]["decision"] == "upheld"
    # revised: a lower claim never lowers, a higher one raises the question and the round
    rv = _dispute(mem, monkeypatch, {"decision": "revised", "score": 9.0, "explanation": "Missed the hash map."})
    assert rv["status"] == "completed", rv.get("error")
    cur = mem.evals[2]["report"]
    assert mem.evals[2]["version"] == 3 and len(cur["disputes"]) == 2 and cur["disputes"][1]["decision"] == "revised"
    assert cur["questions"][0]["score"] == 9.0 and cur["score"] > score1
    low = _dispute(mem, monkeypatch, {"decision": "revised", "score": 3.0, "explanation": "Lower."}, target="main")
    assert mem.evals[3]["report"]["questions"][0]["score"] == 9.0 and mem.evals[3]["report"]["disputes"][2]["decision"] == "upheld"


def test_duplicate_start_returns_existing(monkeypatch):
    mem = MemoryEvalStore(load()).install(monkeypatch)
    monkeypatch.setattr(pipeline, "chat_factory", lambda settings: chats())

    async def go():
        a = await pipeline.start_run(request(), Settings())
        b = await pipeline.start_run(request(), Settings())
        await pipeline._TASKS[a["run_id"]]
        return a, b

    a, b = asyncio.run(go())
    assert not a["existing"] and b == {"run_id": a["run_id"], "status": "running", "existing": True}


def test_grading_errors_map_to_codes(monkeypatch):
    from app.interviewer.llm import LLMUnavailable
    c = chats()
    bad = {**c[0].replies, "part_grade": LLMUnavailable("down")}
    from tests.evaluation.fakes import FakeChat
    mem, run = run_to_end(request(), (FakeChat(bad), FakeChat(bad), FakeChat(bad)), monkeypatch)
    assert run["status"] == "failed" and run["error"]["code"] == "llm_unavailable" and run["error"]["transient"] is True


def test_practice_suggest_prefers_company_then_any_and_skips_seen(monkeypatch):
    import asyncio as aio
    from app.blueprint import selection
    from app.evaluation import practice
    from app.evaluation.models import GapTopic, TopicGap

    async def fake(round_type, culture=False):
        return [{"slug": "a", "title": "A", "difficulty": "medium", "topic_tags": ["Graph"], "company_tags": ["Meesho"]},
                {"slug": "seen", "title": "S", "difficulty": "easy", "topic_tags": ["Graph"], "company_tags": ["Meesho"]},
                {"slug": "b", "title": "B", "difficulty": "hard", "topic_tags": ["Graph"]},
                {"slug": "c", "title": "C", "difficulty": "easy", "topic_tags": ["Graph"]}]

    monkeypatch.setattr(selection, "load_pool", fake)
    gaps = [TopicGap(subject="DSA", topics=[GapTopic(topic="Graphs", why="w")])]
    out = aio.run(practice.suggest(gaps, "dsa", "Meesho", ["seen"], per_topic=3, max_difficulty="medium"))
    assert [p["slug"] for p in out["Graphs"]] == ["a", "c"]      # same company first; hard is above the round; seen is skipped


def test_purge_removes_evaluations_and_runs(monkeypatch):
    import asyncio as aio
    from app.evaluation import store
    calls = []

    class _Coll:
        async def delete_many(self, q):
            calls.append(q)

            class R:
                deleted_count = 2
            return R()

    monkeypatch.setattr(store, "get_db", lambda: {store.EVALUATIONS: _Coll(), store.RUNS: _Coll()})
    assert aio.run(store.purge("c1", ["s1"])) == {"deleted_evaluations": 2, "deleted_evaluation_runs": 2}
    assert calls[0] == {"$or": [{"candidate_id": "c1"}, {"session_id": {"$in": ["s1"]}}]}
    assert aio.run(store.purge(None, [])) == {"deleted_evaluations": 0, "deleted_evaluation_runs": 0}


def test_routes_start_status_and_session(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.deps import require_internal_key
    from app.evaluation import api, store

    async def start(req, settings):
        return {"run_id": "evr_x", "status": "running", "existing": False}

    async def get_run(run_id, full=True):
        return {"run_id": run_id, "session_id": "s1", "status": "completed", "result": {"version": 1}, "request": request().model_dump(mode="json")}

    async def cur(session_id, version=None):
        return None

    monkeypatch.setattr(pipeline, "start_run", start)
    monkeypatch.setattr(store, "get_run", get_run)
    monkeypatch.setattr(store, "current_evaluation", cur)
    app = FastAPI()
    app.include_router(api.router)
    app.include_router(api.admin_router)
    app.dependency_overrides[require_internal_key] = lambda: None
    c = TestClient(app)
    assert c.post("/evaluations/runs", json=request().model_dump(mode="json")).json()["run_id"] == "evr_x"
    body = c.get("/evaluations/runs/evr_x").json()
    assert body["status"] == "completed" and "request" not in body
    assert c.get("/evaluations/sessions/s1").status_code == 404
    assert c.post("/admin/evaluations/runs/evr_x/rerun").json()["run_id"] == "evr_x"


def test_question_dispute_shifts_areas_by_share_of_questions(monkeypatch):
    from tests.evaluation.fakes import FakeChat, SYNTHESIS, part_reply
    from app.evaluation.score import Adjustment
    reply = part_reply(6.0)
    reply["questions"].append({**reply["questions"][0], "id": "second"})
    base = {"part_grade": reply, "round_synthesis": SYNTHESIS}
    mem, _ = run_to_end(request(), (FakeChat(base), FakeChat(base), FakeChat(base)), monkeypatch)
    before = mem.evals[0]["report"]
    recheck = {"part_grade": reply, "round_synthesis": SYNTHESIS, "dispute_recheck": {"decision": "revised", "score": 8.0, "explanation": "x"}}
    monkeypatch.setattr(pipeline, "chat_factory", lambda settings: (FakeChat(base), FakeChat(base), FakeChat(recheck)))
    req = request(trigger="dispute", dispute=DisputeInput(target_type="question", target_id="main", reason="r", report_version=1))

    async def go():
        out = await pipeline.start_run(req, Settings())
        await pipeline._TASKS[out["run_id"]]
        return out["run_id"]

    run = mem.runs[asyncio.run(go())]
    assert run["status"] == "completed", run.get("error")
    ev = mem.evals[1]
    areas = [a for a in ev["merged"]["core-1"]["areas"]]
    assert all(a["score"] == 7.0 for a in areas)                       # +2 over two questions: +1.0 each
    scores = [PartScore("core-1", "dsa", 1.0, {a["key"]: a["score"] for a in areas}, True)]
    again = compute(scores, [Adjustment(**a) for a in ev["adjustments"]], 6.5, "dsa", False)
    assert ev["report"]["score"] == again.score and ev["report"]["score"] > before["score"]


def test_stale_dispute_report_version_fails_permanently(monkeypatch):
    mem, _ = run_to_end(request(), chats(7.0), monkeypatch)
    monkeypatch.setattr(pipeline, "chat_factory", lambda settings: chats(7.0, recheck={"decision": "upheld", "score": 7.0, "explanation": "x"}))
    req = request(trigger="dispute", dispute=DisputeInput(target_type="question", target_id="main", reason="r", report_version=5))

    async def go():
        out = await pipeline.start_run(req, Settings())
        await pipeline._TASKS[out["run_id"]]
        return out["run_id"]

    run = mem.runs[asyncio.run(go())]
    assert run["status"] == "failed" and run["error"]["code"] == "stale_report" and run["error"]["transient"] is False
    assert len(mem.evals) == 1


# ---- final-review fixes (Module 04)

def test_bonus_part_gets_no_share_and_no_must_have():
    # C1: a reached bonus problem counts only through its +0.3 adjustment; its must-have is forced met
    from app.evaluation import inputs
    from tests.evaluation.fakes import part_reply
    d = load()
    for it in d["run"]["checkpoint"]["items"]:
        if it["item_id"] == "core-2":
            it["status"] = "done"                                   # the bonus problem was given and half done
    visible = inputs.visible_transcript(d["turns"])
    parts = inputs.build_parts(d["blueprint"], d["run"], visible, d["evidence"])
    assert next(p for p in parts if p.part_id == "core-2").is_bonus
    shares = pipeline._shares(parts, 45)
    assert shares["core-2"] == 0.0 and shares["core-1"] == pytest.approx(1.0)
    merged = {"core-1": PartGrade.model_validate(part_reply(8.0)),
              "core-2": PartGrade.model_validate({**part_reply(3.0, must=False), "part_id": "core-2"})}
    scores = pipeline._part_scores(parts, merged, shares)
    bonus = next(s for s in scores if s.part_id == "core-2")
    assert bonus.bonus and bonus.must_have_met and pipeline._main_family(scores) == "dsa"
    r = compute(scores, [], 6.5, "dsa", False)
    assert r.base == 8.0 and r.cap is None


def _conduct_end_fixture(minutes_ran: float):
    fx = load()
    run = fx["run"]
    run["end_reason"] = "ended_by_interviewer"
    cp = run["checkpoint"]
    cp["conduct"] = [{"kind": "rude", "quote": "a", "turn_id": "6", "at": 2.0}, {"kind": "rude", "quote": "b", "turn_id": "8", "at": 3.0}]
    for it in cp["items"]:
        if it["item_id"] == "core-1":
            it["started_at"], it["ended_at"] = 1700000060.0, 1700000060.0 + minutes_ran * 60
    return fx


def test_conduct_end_early_is_auto_fail_not_unscorable(monkeypatch):
    # C2: the interviewer ended the round for conduct at minute 8 (7 of 20 core minutes ran, under 40%): automatic fail
    mem, run = run_to_end(request(), chats(7.0), monkeypatch, _conduct_end_fixture(7))
    assert run["status"] == "completed", run.get("error")
    assert run["result"]["outcome"] == "auto_fail" and run["result"]["score"] is not None
    rep = mem.evals[0]["report"]
    assert rep["outcome"] == "auto_fail" and rep["verdict"] in ("No Hire", "Strong No Hire")
    assert any(c["effect"] == "automatic fail" for c in rep["conduct"])


def test_short_round_not_ended_by_the_interviewer_stays_unscorable(monkeypatch):
    fx = _conduct_end_fixture(7)
    fx["run"]["end_reason"] = "completed"
    mem, run = run_to_end(request(), chats(7.0), monkeypatch, fx)
    assert run["result"]["outcome"] == "unscorable"


def test_live_run_not_final_is_transient_and_api_end_reason_is_the_fallback(monkeypatch):
    # I3: a live run with no end record yet fails transient `live_not_final`; once final without an end reason, the API's one is used
    fx = load()
    fx["run"].pop("end_reason", None)
    mem, run = run_to_end(request(), chats(7.0), monkeypatch, fx)
    assert run["status"] == "failed" and run["error"]["code"] == "live_not_final" and run["error"]["transient"] is True
    fx["run"]["ended_at"] = "2026-10-18T10:00:00+00:00"
    mem, run = run_to_end(request(ended_reason="technical"), chats(7.0), monkeypatch, fx)
    assert run["status"] == "completed" and run["result"]["outcome"] == "unscorable"
    assert "technical" in mem.evals[0]["report"]["unscorable_reason"]


def test_admin_list_runs_honours_company_and_round_type(monkeypatch):
    # M9
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.deps import require_internal_key
    from app.evaluation import api, store
    seen = []

    async def list_runs(filters, limit, before):
        seen.append(filters)
        return []

    monkeypatch.setattr(store, "list_runs", list_runs)
    app = FastAPI()
    app.include_router(api.admin_router)
    app.dependency_overrides[require_internal_key] = lambda: None
    TestClient(app).get("/admin/evaluations/runs?company=Meesho&round_type=dsa")
    assert seen[0]["company"] == "Meesho" and seen[0]["round_type"] == "dsa"

    class _Find:
        def __init__(self):
            self.q = None

        def find(self, q, proj):
            self.q = q
            return self

        def sort(self, *a):
            return self

        def limit(self, n):
            return self

        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    coll = _Find()
    monkeypatch.undo()
    monkeypatch.setattr(store, "get_db", lambda: {store.RUNS: coll})
    asyncio.run(store.list_runs({"company": "meesho", "round_type": "dsa"}, 10, None))
    assert coll.q["round_type"] == "dsa" and coll.q["company"] == {"$regex": "^meesho$", "$options": "i"}


def test_live_run_not_final_first_attempt_waits_later_triggers_grade(monkeypatch):
    fx = load()
    fx["run"].pop("end_reason", None)
    fx["run"].pop("ended_at", None)
    # the first attempt always waits for the worker's final record, even though the API sends ended_reason
    mem, run = run_to_end(request(trigger="completion", ended_reason="completed"), chats(7.0), monkeypatch, fx)
    assert run["status"] == "failed" and run["error"]["code"] == "live_not_final" and run["error"]["transient"] is True
    for trigger in ("retry", "reconcile", "admin"):
        mem, run = run_to_end(request(trigger=trigger, ended_reason="completed"), chats(7.0), monkeypatch, fx)
        assert run["status"] == "completed", (trigger, run.get("error"))


def test_session_with_no_turns_is_unscorable_but_still_a_report(monkeypatch):
    fx = load()
    fx["run"].pop("end_reason", None)
    fx["run"].pop("ended_at", None)
    fx["turns"] = []
    mem, run = run_to_end(request(trigger="admin"), chats(7.0), monkeypatch, fx)
    assert run["status"] == "completed" and run["result"]["outcome"] == "unscorable"


def test_internal_error_is_transient(monkeypatch):
    async def boom(*a, **k):
        raise ValueError("bug")
    monkeypatch.setattr(pipeline, "_pipeline", boom)
    mem, run = run_to_end(request(), chats(7.0), monkeypatch)
    assert run["status"] == "failed" and run["error"]["code"] == "internal_error" and run["error"]["transient"] is True


def test_salvaged_grade_and_fallback_synthesis_still_produce_a_full_report(monkeypatch):
    from tests.evaluation.fakes import FakeChat, SYNTHESIS, part_reply
    bad = part_reply(7.0)
    bad["questions"][0]["answer_quotes"] = [{"turn_id": 99999, "text": "x"}]
    replies = {"part_grade": bad, "round_synthesis": {"summary": 1}}
    mem, run = run_to_end(request(), (FakeChat(replies), FakeChat(replies), FakeChat(replies)), monkeypatch)
    assert run["status"] == "completed", run.get("error")
    assert run["raw"]["synthesis_fallback"] is True and run["raw"]["synthesis_fallback_error"] and run["raw"]["salvaged"]["core-1"]
    rep = mem.evals[0]["report"]
    assert rep["score"] is not None and rep["questions"][0]["answer_quotes"] == []
    assert "pass mark" in rep["summary"] and str(rep["score"]) in rep["summary"] and rep["end_questions"]["quality"] == "none"


def test_empty_question_lists_are_salvaged_into_a_main_card_and_topic_gaps(monkeypatch):
    from tests.evaluation.fakes import FakeChat, part_reply
    bad = part_reply(3.0)
    bad["questions"] = []
    replies = {"part_grade": bad, "round_synthesis": {"summary": 1}}
    mem, run = run_to_end(request(), (FakeChat(replies), FakeChat(replies), FakeChat(replies)), monkeypatch)
    assert run["status"] == "completed", run.get("error")
    rep = mem.evals[0]["report"]
    main = [q for q in rep["questions"] if q["id"] == "main"]
    assert main, rep["questions"]
    assert rep["topic_gaps"] and rep["topic_gaps"][0]["topics"]


def test_source_problem_topics_reach_practice_suggest(monkeypatch):
    seen = {}

    async def go():
        mem = MemoryEvalStore(load()).install(monkeypatch)
        monkeypatch.setattr(pipeline, "chat_factory", lambda settings: chats(7.0))

        async def capture(gaps, round_type, company, exclusions, per_topic=3, max_difficulty=None, fallback_topics=None, default_difficulty=None, sources=None, pool=None):
            seen.update(fallback=fallback_topics, sources=sources, pool=pool)
            return {t.topic: [] for g in gaps for t in g.topics}

        monkeypatch.setattr(pipeline.practice, "suggest", capture)
        out = await pipeline.start_run(request(), Settings())
        await pipeline._TASKS[out["run_id"]]
        return mem.runs[out["run_id"]]

    run = asyncio.run(go())
    assert run["status"] == "completed", run.get("error")
    assert seen["fallback"], seen
    assert seen["pool"] == []                                 # the pool loaded once for the run is handed to suggest, not loaded again
    src = seen["sources"]["Hash maps"]
    assert src.topics and src.topics <= seen["fallback"] and src.mapped, seen
