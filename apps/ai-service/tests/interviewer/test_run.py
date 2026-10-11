"""The run: one interview end to end with fakes (no LiveKit, no network)."""
import asyncio
import json

from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.talker import Pacing
from app.interviewer.protocol import parse_web
from app.interviewer.store import MemoryStore
from tests.interviewer.fakes import FakeApi, FakeChat, FakeSpeaker, FakeWorkspace, say
from tests.interviewer.fixtures import Clock, blueprint, context


def make(turns, briefs=(), **extra):
    clock = Clock()
    deps = RunDeps(blueprint=blueprint(), context=context(), talker_chat=FakeChat(turns), director_chat=FakeChat(briefs=list(briefs)),
                   workspace=FakeWorkspace(), api=FakeApi(), store=MemoryStore(), clock=clock, first_token_timeout_s=0.2, **extra)
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
        comment = deps.workspace.of("code.comment")[0]
        mid = f"m{deps.workspace.sent.index(comment) + 1}"      # the fake numbers each message by its place in `sent`
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


def _states(deps):
    return [(m["layout"], m["slow"]) for m in deps.workspace.of("room.state")]


def test_the_room_starts_as_a_conversation_and_widens_to_the_work_area_only_for_a_problem_then_back_for_the_closing():
    async def go():
        nxt = (("next_item", {"reason": "done"}),)
        run, deps, clock = make([say("Hello."), say("Let's get going.", tools=nxt),                    # greeting -> candidate_intro
                             say("Tell me more."), say("And that project?"), say("Why that choice?"),   # three real exchanges
                             say("Over to you.", tools=nxt + (("show_problem", {}),)),               # -> core-1
                             say("Next one.", tools=nxt + (("show_problem", {}),)),                    # -> core-2, shown
                             say("Any questions?", tools=nxt)])                                        # -> candidate_questions
        await run.start(None)
        assert _states(deps) == [("talk", False)]
        await speak(run)                                             # greeting
        await speak(run, "hi")                                       # -> candidate_intro
        for text in ("I am a student.", "I built Relay.", "It uses WebSockets."):
            await speak(run, text)
            assert _states(deps) == [("talk", False)]                # still the conversation: nothing is re-sent
        await speak(run, "ready")                                    # -> core-1
        assert _states(deps)[-1] == ("work", False)
        await speak(run, "done with it")                             # -> core-2: still work, nothing new sent
        assert _states(deps)[-1] == ("work", False) and len(_states(deps)) == 2
        clock.advance(3000)                                          # the round is nearly over: no time for an extra problem
        await speak(run, "done again")                               # -> candidate_questions
        return _states(deps)

    states = asyncio.run(go())
    assert states == [("talk", False), ("work", False), ("talk", False)]


def test_the_page_is_told_when_the_interviewer_is_slow_and_when_it_recovers():
    async def go():
        run, deps, _ = make(["hang"], fallback_chat=FakeChat([("delay", 0.15, say("Sorry about that. Where were we?"))]),
                            pacing=Pacing(hedge_after_s=0.05, filler_after_s=(0.06, 0.2), deadline_s=1.0, retry_gap_s=0.01))
        await run.start(None)
        await speak(run, "hello")
        return deps

    deps = asyncio.run(go())
    assert [s for _, s in _states(deps)] == [False, True, False]


def test_a_failed_reply_is_retried_and_no_check_in_is_queued_meanwhile():
    async def go():
        from app.interviewer.llm import LLMUnavailable
        run, deps, clock = make([LLMUnavailable("down")] * 4 + [say("Sorry, I'm back. Tell me about Relay.")])
        await run.start(None)
        await speak(run, "I built Relay.")          # the model is down: the turn fails
        assert run.conductor.reply_owed and not run.finishing
        replies = run.speaker.replies
        clock.advance(30)                           # long enough for a silence nudge, if one were allowed
        await run.tick()
        assert [o.kind for o in run.conductor.orders if o.kind == "nudge"] == []
        assert run.speaker.replies == replies + 1   # the reply is asked for again instead
        out = await speak(run)                      # the retry now succeeds, and answers what the candidate said
        return run, out

    run, out = asyncio.run(go())
    assert out[-1] == "Tell me about Relay." or "Relay" in " ".join(out)
    assert not run.conductor.reply_owed and run.failures == 0


def test_the_round_ends_as_technical_only_after_failures_have_lasted_a_while():
    async def go():
        from app.interviewer.llm import LLMUnavailable
        run, deps, clock = make([LLMUnavailable("down")] * 40)
        await run.start(None)
        for _ in range(3):
            await speak(run, "hello?")
        await asyncio.sleep(0.05)
        assert not run.finishing and deps.api.ended == []           # three quick failures are not enough
        clock.advance(100)
        await speak(run, "hello?")
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "technical"


def _to(run, item_id, turns=3):
    c = run.conductor
    while c.current().item_id != item_id:
        c.current().turns = 3
        c.next_item("test")
    c.current().turns = turns


def test_a_goodbye_in_the_questions_phase_ends_the_round_even_when_the_talker_forgot_to_move_on():
    async def go():
        run, deps, _ = make([say("Thanks, Deepanshu. That's all from my side. Take care.")])
        await run.start(None)
        _to(run, "candidate_questions", turns=1)
        await speak(run, "No, that's everything, thank you.")
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "completed" and len(deps.workspace.of("session.ending")) == 1


def test_a_goodbye_before_the_closing_phases_is_not_an_ending():
    async def go():
        run, deps, _ = make([say("Good luck with the rest, take care of that edge case.")])
        await run.start(None)
        _to(run, "core-1")
        await speak(run, "ok")
        return run

    run = asyncio.run(go())
    assert not run.finishing and not run.conductor.ended


def test_entering_the_wrap_up_orders_the_closing_and_the_closing_turn_ends_the_round():
    async def go():
        run, deps, _ = make([say("Anything else?", tools=(("next_item", {"reason": "no more questions"}),)),
                             say("It was good talking to you. We will share feedback on the platform.")])
        await run.start(None)
        _to(run, "candidate_questions", turns=1)
        await speak(run, "No more questions.")                 # moves on to wrap_up without a closing
        assert run.conductor.current().item_id == "wrap_up" and not run.finishing
        assert any(o.kind == "closing" for o in run.conductor.pending_orders())
        run.conductor.set_agent_speaking(True); run.conductor.set_agent_speaking(False)
        await speak(run)                                       # the interviewer speaks the closing on its own
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "completed"


def test_a_tool_the_plan_refused_is_told_to_the_talker_on_its_next_turn():
    async def go():
        run, deps, _ = make([say("Let me check something.", tools=(("show_problem", {}),)), say("Sorry, one thing first.")])
        await run.start(None)
        await speak(run, "ready")                              # still greeting: show_problem is refused
        await speak(run, "hello?")
        return deps

    deps = asyncio.run(go())
    second_state = deps.talker_chat.calls[1][1]["content"]
    assert "show_problem" in second_state and "there is no problem to show" in second_state


def test_a_time_order_is_not_spoken_right_after_the_interviewer_finished_talking_but_a_violation_is():
    async def go():
        run, deps, clock = make([say("Hello."), say("Fine.")])
        await run.start(None)
        _to(run, "core-1")
        run.conductor.consume(run.conductor.pending_orders())     # the order to open the problem has been satisfied
        run.conductor.set_candidate_speaking(True)
        clock.advance(0.8 * 1200 + 1)                          # core-1's converge point (20 min box)
        run.conductor.set_candidate_speaking(False)
        run.conductor.set_agent_speaking(True); run.conductor.set_agent_speaking(False)   # it has just finished a sentence
        await run.tick()
        early = run.speaker.replies
        clock.advance(13)
        await run.tick()
        return early, run.speaker.replies

    early, later = asyncio.run(go())
    assert early == 0 and later == 1


def test_a_goodbye_after_the_last_problem_ends_the_round_even_from_the_deep_dive():
    async def go():
        run, deps, _ = make([say("Thanks, Deepanshu. Take care.")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_questions":
            c.current().turns = 3
            c.next_item("t")
        c.current().phase = "deep_dive"                       # a plan where the conversation never left the deep dive
        await speak(run, "No, that's all from me, thank you.")
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    assert asyncio.run(go()).api.ended[0][1] == "completed"


def test_an_empty_reply_to_a_conversational_answer_is_retried_once_so_the_candidate_is_never_left_in_dead_air():
    async def go():
        run, deps, _ = make([say(), say("Right, that covers it. Anything you'd like to ask me?")])   # the first reply says nothing
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_intro":
            c.current().turns = 3
            c.next_item("t")
        out = await speak(run, "I built Relay with WebSockets.")
        return out, deps

    out, deps = asyncio.run(go())
    assert out and "ask me" in " ".join(out)
    assert "reply now" in str(deps.talker_chat.calls[1][-1]["content"])


def test_silence_is_still_allowed_while_the_candidate_codes():
    async def go():
        run, deps, _ = make([say("<silent>")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        return await speak(run, "hmm let me think while I type")

    assert asyncio.run(go()) == [] 


def test_a_move_on_the_talker_declared_but_forgot_to_make_still_moves_the_plan_and_adds_the_extra_problem():
    async def go():
        run, deps, _ = make([say("Well done on this one.", tools=(("log_turn", {"condition": "solved", "action": "acknowledge_move_on", "reason": "done"}),))])
        await run.start(None)
        c = run.conductor
        c.items = [i for i in c.items if i.item_id != "core-2"]    # a plan with one problem: the only case where a reserve is added
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}         # it is on screen
        await speak(run, "thank you")
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "reserve-alternate"


def test_a_declared_move_on_is_not_forced_while_a_background_phase_still_needs_its_exchanges():
    async def go():
        run, deps, _ = make([say("Okay.", tools=(("log_turn", {"condition": "c", "action": "acknowledge_move_on", "reason": "r"}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_intro":
            c.current().turns = 3
            c.next_item("t")
        await speak(run, "sure")
        return run

    assert asyncio.run(go()).conductor.current().item_id == "candidate_intro"


def test_the_problem_tools_are_only_offered_when_a_problem_is_current_or_may_come_next():
    async def go():
        nxt = (("next_item", {"reason": "done"}),)
        run, deps, _ = make([say("Hello."), say("Tell me about yourself."), say("Over to you.", tools=nxt), say("ok")])
        await run.start(None)
        await speak(run)                                    # greeting: a background phase, the problem is far off
        c = run.conductor
        c.current().turns = 3
        c.next_item("t")                                    # candidate_intro, with too few exchanges to move on yet
        await speak(run, "hi")
        c.current().turns = 3                               # now it may move on, and a problem is next
        await speak(run, "I am a student")
        return deps.talker_chat.tools_seen

    seen = asyncio.run(go())
    assert "show_problem" not in seen[0] and "next_item" in seen[0] and "flag_conduct" in seen[0]
    assert "show_problem" not in seen[1] and "code_comment" not in seen[1]
    assert "show_problem" in seen[2] and "give_hint" in seen[2]


def test_a_refused_problem_request_explains_what_to_do_instead():
    from app.interviewer.tools import ToolExecutor  # noqa: F401 - the wording is asserted through the live path below

    async def go():
        run, deps, _ = make([say("Let me check something.", tools=(("show_problem", {}),)), say("Sorry.")])
        await run.start(None)
        await speak(run, "hi")
        await speak(run, "ok")
        return deps.talker_chat.calls[1][1]["content"]

    state = asyncio.run(go())
    assert "show_problem" in state and "do not say a problem is on their screen" in state


def test_a_bare_transition_is_followed_by_a_proactive_turn_that_opens_the_new_part():
    async def go():
        nxt = (("next_item", {"reason": "done"}),)
        run, deps, clock = make([say("Right, let's move on.", tools=nxt),
                                 say("I have another problem for you, it's on your screen.", tools=(("show_problem", {}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run, "that's my answer")                  # core-1 -> core-2 with a bare transition, nothing shown
        assert c.current().item_id == "core-2"
        await run.tick()
        assert run.speaker.replies == 1                       # the interviewer is asked to open the new problem
        await speak(run)
        return deps, c

    deps, c = asyncio.run(go())
    assert "open_item" in deps.talker_chat.calls[1][1]["content"] or "show_problem" in deps.talker_chat.calls[1][1]["content"]
    assert not [o for o in c.pending_orders() if o.kind == "open_item"]


def test_no_extra_turn_when_the_talker_already_opened_the_new_part_in_the_same_turn():
    async def go():
        nxt = (("next_item", {"reason": "done"}),)
        run, deps, _ = make([say("Good. Let's talk about something else: how did you build the portal?", tools=nxt)])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_intro":
            c.current().turns = 5
            c.next_item("t")
        c.current().turns = 5
        await speak(run, "that's my intro")
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run.speaker.replies == 0


def _with_deep_dive(run):
    run.d.blueprint["round"]["deep_dive_mins"] = 6
    run.d.blueprint["personalization"]["resume_probes"] = [
        {"prompt": "Walk me through the architecture decisions you made for the micro-frontend Experience Portal.", "grounded_in": "projects",
         "what_it_tests": "x"}]


def test_a_move_to_the_projects_without_next_item_is_recognised_from_what_the_talker_asked():
    async def go():
        run, deps, _ = make([say("Good. Now, walk me through the architecture decisions you made for the micro-frontend Experience Portal?")])
        _with_deep_dive(run)
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-2":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-2"] = {"sections": []}
        c.items[c.index + 1:] = [i for i in c.items[c.index + 1:] if i.kind == "phase"]      # the last planned problem
        c.reserves.clear()                                                                  # and no extra problem to add
        await speak(run, "that's my solution")
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "deep_dive"


def test_a_question_to_the_candidate_in_the_deep_dive_moves_to_their_questions_once_it_has_had_its_exchanges():
    async def go(turns):
        run, deps, _ = make([say("Good. Do you have any questions for me?")])
        _with_deep_dive(run)
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "deep_dive":
            c.current().turns = 5
            c.next_item("t")
        c.current().turns = turns
        await speak(run, "that's how I built it")
        return run

    assert asyncio.run(go(3)).conductor.current().item_id == "candidate_questions"
    assert asyncio.run(go(1)).conductor.current().item_id == "deep_dive"


def test_an_instruction_to_the_candidate_counts_as_opening_the_part_so_no_second_prompt_follows():
    async def go():
        nxt = (("next_item", {"reason": "done"}),)
        run, deps, _ = make([say("Good. Before we dive in, tell me a bit about your background.", tools=nxt)])
        await run.start(None)
        c = run.conductor
        c.current().turns = 5
        c.next_item("t")
        c.current().turns = 5
        await speak(run, "I'm doing well")
        await run.tick()
        return run

    run = asyncio.run(go())
    assert not [o for o in run.conductor.pending_orders() if o.kind == "open_item"] and run.speaker.replies == 0


def test_when_everything_the_talker_said_was_blocked_it_is_asked_again_for_a_real_question_not_left_with_a_filler_line():
    async def go():
        run, deps, _ = make([say("Let me put the problem up on your screen."), say("Tell me more about the micro-frontend work.")])
        await run.start(None)                                      # the greeting: no problem may be shown or announced
        return await speak(run, "I built a dashboard"), deps

    out, deps = asyncio.run(go())
    assert out == ["Tell me more about the micro-frontend work."]
    assert "not allowed at this point" in str(deps.talker_chat.calls[1][-1]["content"])


def test_after_a_quick_solve_the_state_says_another_problem_follows_not_the_projects():
    async def go():
        run, deps, clock = make([say("ok")])
        _with_deep_dive(run)
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        c = run.conductor
        c.items = [i for i in c.items if i.item_id != "core-2"]    # a plan with one problem
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        clock.advance(200)
        return run._next_part(), run._view([], [])["extra_problem"]

    part, extra = asyncio.run(go())
    assert part == {"phase": "problem", "hint": None} and extra is True


def test_a_question_about_the_projects_after_a_quick_solve_does_not_end_the_problem_part_while_another_problem_is_due():
    async def go():
        run, deps, clock = make([say("Good. Now, walk me through the architecture decisions you made for the micro-frontend Experience Portal?")])
        _with_deep_dive(run)
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        c = run.conductor
        c.items = [i for i in c.items if i.item_id != "core-2"]
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        clock.advance(200)
        await speak(run, "that's my answer")
        return run

    run = asyncio.run(go())
    assert run.conductor.current().kind == "slot"          # an extra problem follows, the plan does not jump to the deep dive


def test_inviting_the_candidates_questions_is_recognised_only_from_the_closing_sentence_of_a_turn():
    from app.interviewer.closing import asks_for_questions

    for text in ("Good. Do you have any questions for me?", "Right on both. Now the floor is yours: what would you like to ask me about the team?",
                 "Thanks for that. Anything you'd like to ask me?", "That covers it from my side. Any questions for me?"):
        assert asks_for_questions(text), text
    for text in ("Let me switch to fundamentals, then we'll get to your questions. In Java, why must equals and hashCode be overridden together?",
                 "Good. Tell me more about your questions to the team lead at that time.",
                 "Before your questions, one more thing: how do you handle retries?"):
        assert not asks_for_questions(text), text


def test_a_background_turn_that_asks_the_candidate_nothing_is_followed_by_a_question():
    async def go():
        run, deps, _ = make([say("Good, that's a clean architecture. Let's move into the core part of the round then."),
                             say("What made you choose WebSockets over polling?")])
        await run.start(None)
        c = run.conductor
        c.next_item("t")                                           # small talk
        c.current().turns = 2
        await speak(run, "A desktop agent, a phone client and a relay")
        assert [o.kind for o in c.pending_orders()].count("open_item") == 1
        c.set_agent_speaking(True); c.set_agent_speaking(False)
        deps.clock_advance = None
        return run, deps

    run, deps = asyncio.run(go())
    order = next(o for o in run.conductor.pending_orders() if o.kind == "open_item")
    assert "did not ask" in order.text


def test_a_turn_that_asks_a_question_adds_no_follow_up_order():
    async def go():
        run, deps, _ = make([say("Good. What made you choose WebSockets over polling?")])
        await run.start(None)
        run.conductor.next_item("t")
        await speak(run, "A desktop agent, a phone client and a relay")
        return run

    run = asyncio.run(go())
    assert not [o for o in run.conductor.pending_orders() if o.kind == "open_item"]


def test_a_move_on_label_with_nothing_said_does_not_move_the_plan():
    async def go():
        run, deps, _ = make([say(tools=(("log_turn", {"condition": "c", "action": "acknowledge_move_on", "reason": "acknowledge the plan and let them code"}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run, "I'll write it now, first the graph")
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "core-1"


def test_a_move_on_label_with_a_sentence_that_does_not_leave_the_problem_does_not_move_the_plan():
    async def go():
        run, deps, _ = make([say("Good, go ahead and write it.", tools=(("log_turn", {"condition": "c", "action": "acknowledge_move_on", "reason": "r"}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run, "I'll write it now")
        return run

    assert asyncio.run(go()).conductor.current().item_id == "core-1"


def test_after_a_spoken_answer_with_no_typing_silence_is_not_allowed_on_a_problem_either():
    async def go():
        run, deps, _ = make([say(), say("Right, that's why a single queue works. Walk me through the first iteration.")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        return await speak(run, "Done. Seeding with every zero in-degree session is fine because none of them depend on anything.")

    out = asyncio.run(go())
    assert out and "first iteration" in " ".join(out)


def test_the_whiteboard_tool_is_only_offered_when_there_is_something_on_the_board():
    async def go():
        run, deps, _ = make([say("ok"), say("ok")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        await speak(run, "hello")
        deps.workspace.board_summary = "rectangle \"cache\""
        await speak(run, "look at my diagram")
        return deps.talker_chat.tools_seen

    seen = asyncio.run(go())
    assert "look_at_board" not in seen[0] and "draw" in seen[0] and "look_at_board" in seen[1]


def _round_with_two_problems(talk):
    async def build():
        run, deps, clock = make(talk)
        _with_deep_dive(run)
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        return run, deps, clock
    return build()


def test_a_struggling_first_problem_ends_the_coding_the_second_is_skipped_and_the_projects_come_next():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("Let's leave the coding there, you showed good instincts on the graph model. Walk me through the architecture decisions you made for the micro-frontend Experience Portal?",
                tools=(("next_item", {"reason": "done"}),))])
        run.conductor.signals["core-1"] = "struggling"
        view = run._view([], [])
        assert view["skip_next_problem"] is True and view["next_part"]["phase"] == "deep_dive"
        await speak(run, "I think I'm stuck, I can't see how to do it")
        return run

    run = asyncio.run(go())
    c = run.conductor
    assert c.current().item_id == "deep_dive" and next(i for i in c.items if i.item_id == "core-2").status == "skipped"


def test_a_strong_first_problem_is_followed_by_the_second_problem_on_screen():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("Well done on this one, I have another problem for you.", tools=(("next_item", {"reason": "done"}), ("show_problem", {})))])
        run.conductor.signals["core-1"] = "strong"
        clock.advance(300)
        await speak(run, "that's my complexity")
        return run, deps

    run, deps = asyncio.run(go())
    assert run.conductor.current().item_id == "core-2"
    assert [m["item_id"] for m in deps.workspace.of("panel.show_problem")] == ["core-2"]


def test_saying_the_problem_is_on_their_screen_without_showing_it_shows_it():
    async def go():
        nxt = (("next_item", {"reason": "done"}),)
        run, deps, clock = make([say("Right, let's move on.", tools=nxt),
                                 say("You have a new problem on your screen now, take a look.")])      # said, never shown
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run, "that's my answer")
        await run.tick()
        await speak(run)
        return deps

    deps = asyncio.run(go())
    assert [m["item_id"] for m in deps.workspace.of("panel.show_problem")] == ["core-2"]


def test_promising_a_fresh_problem_without_moving_on_moves_the_plan_so_the_candidate_is_not_left_waiting():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("That covers it. Let's try a fresh problem now, since you handled that one cleanly.")])     # no tool call
        run.conductor.signals["core-1"] = "strong"
        clock.advance(300)
        await speak(run, "that's my complexity")
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "core-2"
    assert run.speaker.replies == 1                       # the open_item order has the interviewer put the problem up


def test_a_candidate_asking_for_the_missing_problem_and_being_told_it_is_up_gets_it_without_a_tool_call_from_the_talker():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("You're right, that's on me. Let me put it up now, it's on your screen.")])                 # said, no tools
        run.conductor.signals["core-1"] = "strong"
        clock.advance(300)
        await speak(run, "I think you said a fresh problem, I don't see anything new on my screen")
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "core-2"


def test_describing_the_problem_they_are_on_or_naming_a_next_question_is_not_a_promise_of_another_problem():
    from app.interviewer.closing import moves_to_another_problem

    for line in ("This second problem is on your screen, take your time.", "Next question: what happens with an empty list?",
                 "That is a new problem for me too."):
        assert not moves_to_another_problem(line), line
    for line in ("Let's try a fresh problem now.", "I have another problem for you.", "Let's move on to the next problem."):
        assert moves_to_another_problem(line), line


def test_a_turn_cut_down_to_a_remark_with_no_question_is_asked_again_so_the_candidate_is_not_left_in_silence():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("That's a clean trace.", "Don't worry, this is an easy problem."),                  # the second sentence is blocked
            say("One follow-up: how would you return the duplicate values instead?")])
        pieces = await speak(run, "that's my trace")
        return pieces, deps

    pieces, deps = asyncio.run(go())
    assert pieces == ["That's a clean trace.", "One follow-up: how would you return the duplicate values instead?"]
    assert len(deps.talker_chat.calls) == 2
    assert "not allowed at this point" in str(deps.talker_chat.calls[1][-1]["content"])
    assert "already said" in str(deps.talker_chat.calls[1][-1]["content"]) and "That's a clean trace." in str(deps.talker_chat.calls[1][-1]["content"])


def test_saying_the_problem_is_on_their_screen_from_the_conversation_part_when_a_problem_is_allowed_shows_it():
    async def go():
        run, deps, clock = make([say("Good. Now let's get into the coding. The problem is on your screen, so take a look.")])      # said, no tools
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_intro":
            c.current().turns = 5
            c.next_item("t")
        c.current().turns = 5
        assert c.problem_allowed() and c.current().kind == "phase"
        await speak(run, "that's how I decided what goes in the shell")
        await asyncio.sleep(0)
        return run, deps

    run, deps = asyncio.run(go())
    assert [m["item_id"] for m in deps.workspace.of("panel.show_problem")] == ["core-1"]
    assert run.conductor.current().item_id == "core-1"


def test_inviting_their_questions_in_the_turn_that_moves_to_that_part_does_not_leave_an_order_to_open_it_again():
    async def go():
        run, deps, clock = make([say("Both forms are right. What questions do you have for me about the team and the work?")])
        _with_deep_dive(run)
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "deep_dive":
            c.current().turns = 5
            c.next_item("t")
        c.current().turns = 5
        await speak(run, "that's my SQL answer")
        await run.tick()
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "candidate_questions"
    assert not [o for o in run.conductor.pending_orders() if o.kind == "open_item"]
    assert run.speaker.replies == 0                       # they are given the floor: no second turn (it said goodbye before the first question)


def test_the_greeting_is_never_preceded_by_a_filler_but_a_later_slow_reply_still_gets_one():
    from app.interviewer.fillers import STAGES
    from app.interviewer.talker import Pacing

    pacing = Pacing(hedge_after_s=0.03, filler_after_s=(0.04, 0.08, 0.12, 0.5), deadline_s=2.0)

    async def go():
        run, deps, clock = make([("delay", 0.2, say("Hi, I'm Siddharth. How are you doing?")),
                                 ("delay", 0.2, say("Good to hear. Tell me about yourself."))], pacing=pacing,
                                fallback_chat=FakeChat(["hang"] * 6, model="fallback"))      # the hedge goes to a model that never answers
        await run.start(None)
        greeting = await speak(run)
        later = await speak(run, "I'm fine, thanks")
        return greeting, later

    greeting, later = asyncio.run(go())
    assert greeting == ["Hi, I'm Siddharth.", "How are you doing?"]
    assert later[0] in STAGES[0] and later[-1] == "Tell me about yourself."


def test_a_candidate_who_says_they_are_writing_the_code_gets_one_short_remark_and_no_hint():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("Take your time, no rush.", "While you type, keep in mind what you add to the running total.")])
        return await speak(run, "Okay, writing it now.")

    assert asyncio.run(go()) == ["Take your time, no rush."]


def test_a_framing_that_ran_long_does_not_let_the_interviewer_promise_a_problem_it_cannot_put_up():
    from app.interviewer.conductor import Item

    async def go():
        run, deps, clock = make([say("Good, thanks for that.", "I'm putting one on your screen now.", tools=(("next_item", {"reason": "time"}),))])
        await run.start(None)
        c = run.conductor
        c.items.insert(c.index + 1, Item("framing", "phase", "framing", 60))
        c.current().turns = 1
        c.next_item("t")
        clock.advance(90)                                                # the framing's minute is up; the introduction is still ahead
        pieces = await speak(run, "ok")
        return pieces, run

    pieces, run = asyncio.run(go())
    assert pieces == ["Good, thanks for that."]
    assert run.talker.last.blocked and run.talker.last.blocked[0]["rule"] == "screen_claim"


def test_messages_that_arrive_before_the_round_starts_are_held_and_handled_in_order_once_it_has():
    async def go():
        run, _, _ = make([say("Hello.")])
        assert not run.begun.is_set()
        tab = {"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": 1, "counts": {"tab_changes": 1, "screen_changes": 0, "full_violations": 0}}
        await run.on_web_message(web(tab))
        await run.on_web_message(web({"type": "code.snapshot", "version": 1, "language": "python", "text": "x = 1"}))
        assert len(run._early) == 2 and run.conductor.live_summary()["tab_changes"] == 0
        await run.start(None)
        return run

    run = asyncio.run(go())
    assert run.begun.is_set() and run._early == []
    assert run.conductor.live_summary()["tab_changes"] == 1          # the held proctor event was handled after the start


def test_a_finished_interview_never_begins_so_it_is_never_greeted_again():
    async def go():
        run, _, _ = make([say("Hello.")])
        await run.start({"ended_at": "2026-10-10T20:00:00+00:00", "end_reason": "completed", "history": []})
        return run

    run = asyncio.run(go())
    assert run.ended_run is not None and not run.begun.is_set()


def test_what_the_candidate_says_before_the_round_starts_is_not_taken_as_a_turn():
    async def go():
        run, _, _ = make([say("Hello.")])
        run.on_user_text("Hi, can you hear me?")
        before = (run.seq, list(run.history), run.unanswered, run.conductor.reply_owed)
        await run.start(None)
        run.on_user_text("Hello")
        return before, (run.seq, run.history[-1]["content"], run.unanswered)

    before, after = asyncio.run(go())
    assert before == (0, [], None, False)            # nothing was recorded, nothing is owed
    assert after == (1, "Hello", "Hello")            # once the round has started a turn is a turn


def test_a_resumed_run_keeps_its_stored_clock_instead_of_starting_a_new_one():
    async def go():
        run, deps, clock = make([say("Hello.")])
        await run.start(None)
        started = run.conductor.started_at
        await run._checkpoint()
        clock.advance(600)                                  # the worker restarts ten minutes into the round
        again = InterviewRun(RunDeps(blueprint=blueprint(), context=context(), talker_chat=FakeChat([say("Welcome back.")]),
                                     director_chat=FakeChat(briefs=[]), workspace=FakeWorkspace(), api=FakeApi(), store=deps.store,
                                     clock=clock, first_token_timeout_s=0.2))
        await again.start(await deps.store.load_run("s1"))
        return started, again.conductor.started_at, clock()

    started, resumed, now = asyncio.run(go())
    assert resumed == started and resumed < now              # the round's 45 minutes did not start over


def test_the_run_knows_whether_a_candidate_is_in_the_room():
    run, _, _ = make([say("Hello.")])
    assert not run.candidate_in_room.is_set()                  # an interviewer alone in a room has no one to speak to
    run.set_candidate_in_room(True)
    assert run.candidate_in_room.is_set()
    run.set_candidate_in_room(False)
    assert not run.candidate_in_room.is_set()
