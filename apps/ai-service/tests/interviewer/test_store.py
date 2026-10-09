import asyncio

from app.interviewer import store
from app.interviewer.store import MemoryStore
from app.interviewer.trace import render


class _Coll:
    def __init__(self, n):
        self.n, self.queries = n, []

    async def delete_many(self, q):
        self.queries.append(q)
        return type("R", (), {"deleted_count": self.n})()


def test_purge_removes_every_live_collection_by_candidate_and_sessions(monkeypatch):
    colls = {name: _Coll(2) for name in (store.LIVE_RUNS, store.LIVE_TURNS, store.LIVE_BRIEFS, store.LIVE_EVIDENCE)}
    monkeypatch.setattr(store, "get_db", lambda: colls)
    out = asyncio.run(store.purge("c1", ["s1"]))
    assert out == {"deleted_live_runs": 2, "deleted_live_turns": 2, "deleted_live_briefs": 2, "deleted_live_evidence": 2}
    assert colls[store.LIVE_TURNS].queries == [{"$or": [{"candidate_id": "c1"}, {"session_id": {"$in": ["s1"]}}]}]
    assert asyncio.run(store.purge(None, [])) == {"deleted_live_runs": 0, "deleted_live_turns": 0,
                                                  "deleted_live_briefs": 0, "deleted_live_evidence": 0}


def test_memory_store_and_the_timeline():
    async def run():
        s = MemoryStore()
        await s.start_run({"session_id": "s1", "candidate_id": "c1", "started_at": "t0"})
        await s.append_turn({"session_id": "s1", "seq": 1, "speaker": "interviewer", "text": "Hi there.", "at": 0.0,
                             "decision": {"condition": "none", "action": "greet", "reason": "opening"}, "orders": [],
                             "blocked": [], "tool_calls": [], "first_token_ms": 640})
        await s.update_turn("s1", 1, {"first_audio_ms": 900})
        await s.append_turn({"session_id": "s1", "seq": 2, "speaker": "candidate", "text": "Hello!", "at": 3.0})
        await s.append_brief({"session_id": "s1", "brief": {"for_position": 1, "goal": "build rapport"}, "outcome": {"stale": False}, "at": 4.0})
        await s.finalize_run("s1", {"end_reason": "completed"})
        return render(await s.load_run("s1"), s.turns, s.briefs)

    lines = asyncio.run(run())
    assert lines[0].startswith("run s1")
    assert any("INTERVIEWER: Hi there." in l and "none → greet" in l and "640ms" in l and "900ms" in l for l in lines)
    assert any("CANDIDATE: Hello!" in l for l in lines)
    assert any("BRIEF (position 1): build rapport" in l for l in lines)


def test_max_seq_is_the_highest_stored_turn_number_of_that_session():
    async def go():
        s = MemoryStore()
        for n in (1, 2, 5):
            await s.append_turn({"session_id": "s1", "seq": n})
        await s.append_turn({"session_id": "s2", "seq": 9})
        return await s.max_seq("s1"), await s.max_seq("nobody")

    assert asyncio.run(go()) == (5, 0)


def test_the_mongo_store_asks_for_the_highest_seq_of_the_session(monkeypatch):
    class Coll:
        async def find_one(self, query, projection=None, sort=None):
            self.args = (query, sort)
            return {"seq": 12}

    coll = Coll()
    monkeypatch.setattr(store, "get_db", lambda: {store.LIVE_TURNS: coll})
    assert asyncio.run(store.MongoStore().max_seq("s1")) == 12
    assert coll.args == ({"session_id": "s1"}, [("seq", -1)])


def test_the_timeline_shows_each_turns_activity_digest():
    from app.interviewer.trace import render
    run = {"session_id": "s1", "started_at": "t0"}
    turns = [{"seq": 1, "speaker": "interviewer", "text": "Nice.", "at": 1.0,
              "activity": {"text": "## Activity (what they did while speaking, and since)\nWhile speaking (8 s):\n- +1.0s typed line 6 (1 edit): `x`"}}]
    lines = render(run, turns, [])
    assert "    ## Activity (what they did while speaking, and since)" in lines
    assert "    - +1.0s typed line 6 (1 edit): `x`" in lines
