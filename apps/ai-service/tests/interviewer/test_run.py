"""The run: one interview end to end with fakes (no LiveKit, no network)."""
import asyncio
import json

from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.protocol import parse_web
from app.interviewer.store import MemoryStore
from tests.interviewer.fakes import FakeApi, FakeChat, FakeSpeaker, FakeWorkspace, say
from tests.interviewer.fixtures import Clock, blueprint, context


def make(turns, briefs=()):
    clock = Clock()
    deps = RunDeps(blueprint=blueprint(), context=context(), talker_chat=FakeChat(turns), director_chat=FakeChat(briefs=list(briefs)),
                   workspace=FakeWorkspace(), api=FakeApi(), store=MemoryStore(), clock=clock, first_token_timeout_s=0.2)
    run = InterviewRun(deps)
    run.speaker = FakeSpeaker()
    return run, deps, clock


async def speak(run, text=None):
    if text is not None:
        run.on_user_text(text)
    pieces = [p async for p in run.reply(text)]
    run.on_conversation_item("assistant", " ".join(pieces), False)
    for _ in range(5):
        await asyncio.sleep(0)
    return pieces


def web(body):
    return parse_web(json.dumps({"v": 1, "id": "w9", **body}))


def test_greets_records_the_turn_and_checkpoints():
    async def go():
        run, deps, _ = make([say("Hi, I'm Siddharth. Thanks for joining.", tools=(("log_turn", {"condition": "none", "action": "greet", "reason": "opening"}),))])
        await run.start(None)
        out = await speak(run)
        await run.director.idle()
        return out, deps

    out, deps = asyncio.run(go())
    assert out == ["Hi, I'm Siddharth.", "Thanks for joining."]   # one piece per sentence: the leak guard checks each
    turn = next(t for t in deps.store.turns if t["speaker"] == "interviewer")
    assert turn["text"] == "Hi, I'm Siddharth. Thanks for joining."
    assert turn["decision"]["action"] == "greet" and turn["candidate_id"] == "c1"
    assert deps.store.runs["s1"]["checkpoint"]["items"][0]["item_id"] == "greeting"


def test_a_move_on_order_advances_the_item_even_if_the_talker_forgets_next_item():
    async def go():
        run, _, clock = make([say("Hello."), say("Seems like we have to move on.")])
        await run.start(None)
        await speak(run)
        clock.advance(61)
        await run.tick()
        assert run.speaker.replies == 1
        await speak(run)
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "candidate_intro"


def test_the_third_full_violation_ends_the_round_after_the_talker_says_why():
    async def go():
        run, deps, _ = make([say("Please stay on this screen."), say("Final warning."), say("I'm ending the interview here.")])
        await run.start(None)
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
            await speak(run)
        await asyncio.wait_for(run.finished.wait(), 1)
        return run, deps

    run, deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "ended_by_interviewer" and deps.api.ended[0][2]["tab_changes"] == 3
    assert deps.workspace.of("session.ending")[0]["reason"] == "ended_by_interviewer"
    assert run.speaker.deleted


def test_three_failed_turns_end_the_round_as_technical():
    async def go():
        from app.interviewer.llm import LLMUnavailable
        down = [LLMUnavailable("down")] * 9
        run, deps, _ = make(down)
        await run.start(None)
        for _ in range(3):
            await speak(run, "hello?")
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "technical"


def test_the_candidate_end_request_gets_a_goodbye_then_ends():
    async def go():
        run, deps, _ = make([say("Thanks for your time, take care.")])
        await run.start(None)
        await run.on_web_message(web({"type": "session.end_request"}))
        await speak(run)
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "candidate_ended"


def test_a_stale_brief_keeps_its_summary_but_drops_its_moves():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        from app.interviewer.brief import Brief
        await run._on_brief(Brief.model_validate({"for_position": 0, "goal": "old", "summary": "Intro went well.",
                                                  "plan_changes": [{"op": "skip", "target": "core-2"}]}), {"triggers": ["turns"]})
        return run, deps

    run, deps = asyncio.run(go())
    assert run.summary == "Intro went well."
    assert next(i for i in run.conductor.items if i.item_id == "core-2").status == "pending"
    assert deps.store.briefs[0]["outcome"]["stale"] is True


class _FailingSpeaker(FakeSpeaker):
    def reply(self):
        raise RuntimeError("AgentSession isn't running")


def test_a_speaker_that_fails_never_breaks_the_ticker_or_the_end_request():
    async def go():
        run, deps, clock = make([])
        run.speaker = _FailingSpeaker()
        await run.start(None)
        clock.advance(21)
        await run.tick()                                   # a nudge order wants a reply: the speaker raises, the tick must not
        await run.on_web_message(web({"type": "session.end_request"}))   # and End must still start its watchdog
        return run

    run = asyncio.run(go())
    assert not run.finishing and run.conductor.end_order is not None


def test_an_end_order_made_while_the_agent_speaks_is_delivered_on_a_later_tick():
    async def go():
        run, deps, clock = make([say("I'm ending the interview here.")])
        await run.start(None)
        run.on_agent_state("speaking")
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
        assert run.speaker.replies == 0                    # swallowed: the agent was mid-sentence
        run.on_agent_state("listening")
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run.speaker.replies == 1


def test_an_end_order_that_never_gets_spoken_ends_the_round_anyway():
    async def go():
        run, deps, clock = make([])
        await run.start(None)
        run.on_agent_state("speaking")
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
        clock.advance(25)
        await run.tick()
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "ended_by_interviewer"


def test_a_candidate_end_request_or_a_dropped_connection_cannot_launder_a_misconduct_ending(monkeypatch):
    import app.interviewer.run as run_module
    monkeypatch.setattr(run_module, "END_REQUEST_WATCHDOG_S", 0)
    monkeypatch.setattr(run_module, "CANDIDATE_GONE_S", 0)

    async def go(trigger):
        run, deps, _ = make([])
        await run.start(None)
        run.on_agent_state("speaking")
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
        await trigger(run)
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    async def press_end(run):
        await run.on_web_message(web({"type": "session.end_request"}))

    async def leave(run):
        run.on_candidate_left()

    assert asyncio.run(go(press_end)).api.ended[0][1] == "ended_by_interviewer"
    assert asyncio.run(go(leave)).api.ended[0][1] == "ended_by_interviewer"


def test_a_long_absence_counts_as_a_full_violation_and_a_quick_refresh_does_not():
    async def go(seconds):
        run, deps, clock = make([])
        await run.start(None)
        run.on_candidate_left()
        clock.advance(seconds)
        run.on_candidate_back()
        await asyncio.sleep(0)
        return run

    assert asyncio.run(go(5)).conductor.full_violations == 0
    long_run = asyncio.run(go(25))
    assert long_run.conductor.full_violations == 1 and long_run.conductor.proctor[0]["kind"] == "tab_hidden"


def test_workspace_actions_the_screen_refused_reach_the_talker_next_turn():
    async def go():
        run, deps, _ = make([say("Look at line two.", tools=(("code_comment", {"line": 2, "text": "Why?", "purpose": "question"}),)),
                             say("Sorry, let me try again.")])
        await run.start(None)
        deps.workspace.lines = ["def f():", "    pass"]
        run.conductor.next_item("x"); run.conductor.next_item("x")          # onto core-1
        await speak(run, "hello")
        mid = deps.workspace.sent[-1]["type"] == "code.comment" and "m1"
        deps.workspace.acks[mid] = {"ok": False, "reason": "line_changed"}
        await speak(run, "go on")
        return deps

    deps = asyncio.run(go())
    second_state = deps.talker_chat.calls[1][1]["content"]
    assert "code.comment: line_changed" in second_state


def test_a_second_director_conduct_concern_is_not_a_second_incident():
    async def go():
        from app.interviewer.brief import Brief
        run, deps, _ = make([])
        await run.start(None)
        run.conductor.on_conduct("inappropriate", "rude", "t1", "talker")          # the talker already warned once
        await run._on_brief(Brief.model_validate({"for_position": run.conductor.position, "conduct": {"concern": "warn", "reason": "still the same remark"}}), {"triggers": []})
        await run._on_brief(Brief.model_validate({"for_position": run.conductor.position, "conduct": {"concern": "end", "reason": "same remark again"}}), {"triggers": []})
        return run

    run = asyncio.run(go())
    assert len(run.conductor.conduct) == 1 and not run.conductor.ended


def test_a_first_director_concern_the_talker_missed_counts_once():
    async def go():
        from app.interviewer.brief import Brief
        run, deps, _ = make([])
        await run.start(None)
        await run._on_brief(Brief.model_validate({"for_position": run.conductor.position, "conduct": {"concern": "warn", "reason": "abusive"}}), {"triggers": []})
        return run

    run = asyncio.run(go())
    assert len(run.conductor.conduct) == 1 and run.conductor.pending_orders()[-1].kind == "conduct_warning"


def test_the_interviewer_does_not_talk_to_an_empty_room_while_the_candidate_is_away():
    async def go():
        run, deps, clock = make([])
        await run.start(None)
        run.on_candidate_left()
        clock.advance(30)                                  # long enough for a silence nudge
        await run.tick()
        away = run.speaker.replies
        run.on_candidate_back()
        await asyncio.sleep(0)
        return away, run.speaker.replies

    away, after = asyncio.run(go())
    assert away == 0 and after == 1                        # held back while away; the 30s absence is a violation to mention


def test_a_restart_numbers_new_turns_after_every_stored_turn_not_just_the_last_checkpointed_one():
    async def go():
        run, deps, _ = make([])
        for n in range(1, 10):                                   # nine turns were stored; the crash beat the checkpoint at five
            await deps.store.append_turn({"session_id": "s1", "seq": n})
        saved = {"session_id": "s1", "seq": 5, "history": [], "summary": "", "mirror": {},
                 "checkpoint": run.conductor.checkpoint() if run.conductor.started_at else _started(run).checkpoint()}
        await run.start(saved)
        return run

    assert asyncio.run(go()).seq == 9


def _started(run):
    run.conductor.start()
    return run.conductor


def test_a_finished_run_repeats_its_ending_instead_of_restarting_the_interview():
    async def go():
        run, deps, _ = make([say("Never spoken.")])
        saved = {"session_id": "s1", "ended_at": "2026-10-09T10:00:00+00:00", "end_reason": "ended_by_interviewer",
                 "live_summary": {"tab_changes": 3, "full_violations": 3}, "seq": 40,
                 "history": [{"role": "assistant", "content": "I'm ending the interview here."}], "checkpoint": {"items": []}}
        await run.start(saved)
        assert run.ended_run is saved
        await run.reaffirm_end()
        return run, deps

    run, deps = asyncio.run(go())
    ending = deps.workspace.of("session.ending")
    assert len(ending) == 1 and ending[0]["reason"] == "ended_by_interviewer" and ending[0]["message"] == "I'm ending the interview here."
    assert deps.api.ended == [("s1", "ended_by_interviewer", {"tab_changes": 3, "full_violations": 3})]
    assert run.speaker.deleted and run.finished.is_set()
    assert run.conductor.started_at is None                      # the interview was not started again
    assert deps.store.turns == [] and deps.store.runs == {}      # and nothing was written over the finished run


def _batch(clock, events):
    """An activity.batch the browser sent now, with events at absolute worker seconds."""
    return web({"type": "activity.batch", "sent_at": int(clock() * 1000), "events": [{**body, "t": int(at * 1000)} for at, body in events]})


def _typing_and_pointing(clock):
    return _batch(clock, [
        (997.0, {"k": "edit", "from_line": 6, "to_line": 6, "ins": "if target - x in seen:", "removed": 0}),
        (999.4, {"k": "ptr", "s": "code", "line": 5, "col": 1, "text": "seen = {}"}),
    ])


async def _narrate(run, clock):
    await run.on_web_message(_typing_and_pointing(clock))
    run.on_user_transcript("so I keep a dictionary", False, 998.0)
    run.on_user_transcript("so I keep a dictionary and this", False, 999.6)
    run.on_user_transcript("so I keep a dictionary and this finds it", True, 1000.0)
    await speak(run, "so I keep a dictionary and this finds it")


def test_what_the_candidate_did_while_speaking_reaches_the_talker_as_an_activity_block():
    async def go():
        run, deps, clock = make([say("Nice, go on.")])
        await run.start(None)
        await _narrate(run, clock)
        return deps

    state = asyncio.run(go()).talker_chat.calls[0][1]["content"]
    assert "## Activity" in state and "typed line 6 (1 edit): `if target - x in seen:`" in state
    assert "- says “this finds” at +1.6s → line 5 `seen = {}`" in state


def test_a_silence_nudge_gets_a_since_they_last_spoke_digest_and_a_quiet_start_gets_none():
    async def go():
        run, deps, clock = make([say("Take your time."), say("How is it going?")])
        await run.start(None)
        await speak(run)                                              # the greeting: nothing has happened yet
        clock.advance(10)
        await run.on_web_message(_batch(clock, [(1008.0, {"k": "edit", "from_line": 1, "to_line": 3, "ins": "def f():", "removed": 0})]))
        clock.advance(20)
        await speak(run)                                              # a proactive turn, no candidate speech
        return deps

    deps = asyncio.run(go())
    assert "## Activity" not in deps.talker_chat.calls[0][1]["content"]
    second = deps.talker_chat.calls[1][1]["content"]
    assert "## Activity (since they last spoke)" in second and "Since they last spoke (30 s): typed lines 1–3 (1 edit)." in second


def test_the_turn_record_carries_the_digest_and_nothing_raw():
    async def go():
        run, deps, clock = make([say("Nice, go on.")])
        await run.start(None)
        await _narrate(run, clock)
        return run, deps

    run, deps = asyncio.run(go())
    turn = next(t for t in deps.store.turns if t["speaker"] == "interviewer")
    assert turn["activity"]["text"].startswith("## Activity") and turn["activity"]["spans"] and turn["activity"]["refs"]
    assert "events" not in turn["activity"]
    stored = json.dumps(deps.store.runs, default=str) + json.dumps(deps.store.turns, default=str)
    assert '"ptr"' not in stored and '"edit"' not in stored          # the raw event kinds are stored nowhere
    assert run.last_activity == turn["activity"]


def test_the_director_gets_each_digest_as_its_budgeted_text_not_every_span():
    async def go():
        run, deps, clock = make([say("Nice, go on.")])
        await run.start(None)
        await _narrate(run, clock)
        return json.loads((await run._director_messages())[1]["content"][0]["text"])

    activity = asyncio.run(go())["activity"]
    assert activity and activity[0]["text"].startswith("## Activity") and "spans" not in activity[0]
    assert len(json.dumps(activity[0])) < 1500                       # one digest costs the director about a block, not a span list


def test_a_failing_tracker_never_blocks_a_reply_a_batch_or_an_end(monkeypatch):
    async def go():
        run, deps, clock = make([say("Go on.")])
        await run.start(None)

        def boom(*args, **kwargs):
            raise RuntimeError("tracker broke")

        monkeypatch.setattr(run.tracker, "take_turn", boom)
        monkeypatch.setattr(run.tracker, "ingest_batch", boom)
        monkeypatch.setattr(run.tracker, "on_transcript", boom)
        await run.on_web_message(_batch(clock, [(999.0, {"k": "focus", "s": "code"})]))      # must not raise
        run.on_user_transcript("hello", True, 1000.0)                                        # must not raise
        out = await speak(run, "hello")
        return out, deps

    out, deps = asyncio.run(go())
    assert out == ["Go on."] and "## Activity" not in deps.talker_chat.calls[0][1]["content"]


def test_an_activity_batch_does_not_wake_the_director_or_start_a_turn():
    async def go():
        run, deps, clock = make([])
        await run.start(None)
        await run.on_web_message(_typing_and_pointing(clock))
        await run.director.idle()
        return run, deps

    run, deps = asyncio.run(go())
    assert deps.director_chat.calls == [] and run.speaker.replies == 0
    assert len(run.tracker.events) == 2


def test_a_restarted_worker_starts_with_an_empty_buffer():
    async def go():
        run, deps, clock = make([say("Go on.")])
        await run.start(None)
        await _narrate(run, clock)
        again, _, _ = make([])
        await again.start(deps.store.runs["s1"])
        return again

    assert len(asyncio.run(go()).tracker.events) == 0
