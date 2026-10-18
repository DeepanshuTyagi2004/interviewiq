"""The run: one interview end to end with fakes (no LiveKit, no network)."""
import asyncio
import json

from app.interviewer.lines import LINES, contains, matches
from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.talker import Pacing
from app.interviewer.protocol import parse_web
from app.interviewer.store import MemoryStore
from tests.interviewer.fakes import FakeApi, FakeChat, FakeSpeaker, FakeWorkspace, say, state_of
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
        clock.advance(181)                                # the greeting's minute plus the 2 min fallback
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


def test_an_end_order_that_never_gets_spoken_ends_the_round_anyway_and_the_fixed_line_is_said():
    async def go():
        run, deps, clock = make([])
        await run.start(None)
        run.on_agent_state("speaking")
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
        run.on_agent_state("listening")                   # the floor is free, and the talker never says the ending
        clock.advance(25)
        await run.tick()
        await asyncio.wait_for(run.finished.wait(), 1)
        return run, deps

    run, deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "ended_by_interviewer"
    assert len(run.speaker.said) == 1 and matches("proctor_end", run.speaker.said[0])           # the candidate hears why, rather than silence
    assert deps.workspace.of("session.ending")[0]["message"] == run.speaker.said[0]   # and the page shows the ending, not the last unrelated line


def test_the_endings_grace_counts_from_when_the_floor_was_free_so_the_reply_saying_it_is_never_cut_off():
    async def go():
        run, deps, clock = make([say("I'm ending the interview here.")])
        await run.start(None)
        run.on_agent_state("speaking")                    # the voice is still on the turn before
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
        clock.advance(19)
        run.on_agent_state("listening")                   # the floor is free only now
        clock.advance(5)
        await run.tick()                                  # 24 s after the order, 5 s after the floor was free
        assert not run.finishing and run.speaker.replies == 1
        await speak(run)                                  # the reply says the ending
        await asyncio.wait_for(run.finished.wait(), 1)
        return run, deps

    run, deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "ended_by_interviewer" and run.speaker.said == []


def test_an_ending_the_voice_never_frees_the_floor_for_is_carried_out_after_the_hard_cap():
    async def go():
        run, deps, clock = make([])
        await run.start(None)
        run.on_agent_state("speaking")
        for n in (1, 2, 3):
            await run.on_web_message(web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                                          "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}}))
        clock.advance(60)
        await run.tick()
        assert not run.finishing                          # still speaking, as far as the voice says
        clock.advance(31)
        await run.tick()
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "ended_by_interviewer"


def test_a_turn_never_played_does_not_re_arm_the_move_on_of_the_part_it_left():
    async def go():
        run, _, clock = make([say("Hello."), say("Tell me about yourself?"), say("Thanks. And what are you working on?")])
        await run.start(None)
        await speak(run)                                  # the greeting, confirmed by the voice
        clock.advance(181)                                # the greeting's minute plus the 2 min fallback
        await run.tick()                                  # the greeting's time is up: move_on
        run.on_user_text("Hi.")
        pieces = [p async for p in run.reply("Hi.")]      # carries move_on: the plan moves to the introduction
        for _ in range(5):
            await asyncio.sleep(0)
        assert pieces and run.conductor.current().item_id == "candidate_intro"
        clock.advance(9)
        await run.tick()                                  # the voice never confirmed it: dropped (they kept talking)
        assert not any(o.kind == "move_on" for o in run.conductor.pending_orders())
        await speak(run)                                  # asked again
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "candidate_intro"      # not moved on a second time by the spent order


def test_asking_for_a_minute_holds_the_next_part_and_the_check_in_until_they_speak_again():
    async def go():
        run, deps, clock = make([say("Hello."), say("Of course, take a minute.", tools=(("next_item", {}),)),
                                 say("Alright, let's start with you. Tell me about yourself?")])
        await run.start(None)
        await speak(run)
        out = await speak(run, "I want a minute to settle in.")
        assert out == ["Of course, take a minute."] and run.conductor.current().item_id == "candidate_intro"
        assert "[hold]" in json.dumps(deps.talker_chat.calls[1]) and "[open_item]" not in json.dumps(deps.talker_chat.calls[1])
        clock.advance(5)
        await run.tick()
        assert run.speaker.replies == 0                   # the order to open the next part waits for them
        clock.advance(25)
        await run.tick()
        assert run.speaker.replies == 0                   # and there is no silence check-in during their moment
        run.on_user_text("Hello?")                        # only checking the line: the moment goes on
        assert run.conductor.held()
        out = await speak(run, "Okay, I'm ready.")
        assert "[open_item]" in json.dumps(deps.talker_chat.calls[2])
        return out

    assert asyncio.run(go()) == ["Alright, let's start with you.", "Tell me about yourself?"]


def test_a_reply_that_grants_a_pause_is_not_followed_by_a_forced_question():
    async def go():
        run, _, clock = make([say("I'm here, take the minute, I'll wait.")])
        await run.start(None)
        _go_to(run, "candidate_intro")                    # a conversation part: a reply that asks nothing is normally followed up
        run.conductor.consume(run.conductor.pending_orders())
        await speak(run, "Hello?")
        assert run.conductor.held() and not any(o.kind == "open_item" for o in run.conductor.pending_orders())
        clock.advance(5)
        await run.tick()
        return run

    assert asyncio.run(go()).speaker.replies == 0


def test_a_turn_the_candidate_cut_off_counts_only_what_they_heard():
    async def go():
        run, deps, _ = make([say("Of course.", "Let me tell you how this round will run.", "Does that sound good to you?"),
                             say("Does that sound good to you?")])
        await run.start(None)
        pieces = [p async for p in run.reply(None)]
        assert len(pieces) == 3
        run.on_conversation_item("assistant", "Of course. Let me tell you how", True)   # they cut in
        for _ in range(5):
            await asyncio.sleep(0)
        out = await speak(run, "Hello?")
        return out, deps

    out, deps = asyncio.run(go())
    assert out == ["Does that sound good to you?"]           # not held back as a repeat: they never heard it
    turn = next(t for t in deps.store.turns if t["speaker"] == "interviewer")
    assert turn["cut_off"] is True and turn["heard"] == "Of course. Let me tell you how"


def test_an_outline_cut_off_by_the_candidate_does_not_count_as_given():
    async def go():
        run, _, _ = make([])
        await run.start(None)
        outline = ("It's about forty-five minutes, we'll do a bit of background, then some problem solving together, "
                   "and we'll keep time at the end for your questions.")
        run.conductor.outline_said = True
        run._unconfirmed[7] = {"key": "its about forty five minu", "at": 0.0, "outline": True, "orders": [], "spoken": [outline]}
        run.on_conversation_item("assistant", "It's about forty-five minutes, we'll do a bit", True)
        return run

    assert asyncio.run(go()).conductor.outline_said is False


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
    second_state = state_of(deps.talker_chat.calls[1])
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

    state = state_of(asyncio.run(go()).talker_chat.calls[0])
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
    assert "## Activity" not in state_of(deps.talker_chat.calls[0])
    second = state_of(deps.talker_chat.calls[1])
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
    assert out == ["Go on."] and "## Activity" not in state_of(deps.talker_chat.calls[0])


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
        run, deps, clock = make([say("Hello."), say("Let's get going. Tell me about yourself?", tools=nxt),   # greeting -> candidate_intro
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
    second_state = state_of(deps.talker_chat.calls[1])
    assert "show_problem" in second_state and "there is no problem to show" in second_state


def test_a_time_order_is_not_spoken_right_after_the_interviewer_finished_talking_but_a_violation_is():
    async def go():
        run, deps, clock = make([say("Hello."), say("Fine.")])
        await run.start(None)
        _to(run, "core-1")
        run.conductor.consume(run.conductor.pending_orders())     # the order to open the problem has been satisfied
        run.conductor.set_candidate_speaking(True)
        clock.advance(1200 + 300 + 1)                          # core-1's time (20 min box) plus the fallback: the plan moves on
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


def test_an_empty_reply_to_a_yes_that_answers_a_question_is_retried():
    """A live round asked "Does that sound good to you?", heard "Yes. Yes. Yes." and said nothing: a bare yes is a nod only when
    nothing was asked. After a question it is the answer, and the candidate waited 25 s before saying "Hello?"."""
    async def go():
        run, deps, _ = make([say(), say("Great, let's start with you then.")])     # the first reply says nothing
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_intro":
            c.current().turns = 3
            c.next_item("t")
        run.on_conversation_item("assistant", "We'll chat, then code. Does that sound good to you?", False)
        out = await speak(run, "Yes. Yes. Yes.")
        return out, deps

    out, deps = asyncio.run(go())
    assert out and "start with you" in " ".join(out)
    assert "reply now" in str(deps.talker_chat.calls[1][-1]["content"])


def _in_core(make_turns, remark="Forget it, this question is pointless."):
    # A rude remark that is not directed abuse (directed abuse, e.g. "you are useless", ends the round before any reply: L5).
    async def go():
        run, deps, _ = make(make_turns)
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        await speak(run, remark)
        return run
    return asyncio.run(go())


def test_a_warning_said_in_the_turn_that_flagged_the_remark_is_not_said_again():
    """A live round warned ("That language isn't acceptable...") and flagged the remark in the same turn; the flag queued a warning
    order and the next turn said a second, out-of-place warning after an unrelated question."""
    run = _in_core([say("That language isn't acceptable in an interview, so let's keep it civil.",
                        tools=(("flag_conduct", {"kind": "inappropriate", "quote": "this question is pointless"}),))])
    assert not [o for o in run.conductor.pending_orders() if o.kind == "conduct_warning"]


def test_a_flagged_remark_the_turn_did_not_warn_about_still_gets_its_warning():
    run = _in_core([say("Let's get back to the problem.", tools=(("flag_conduct", {"kind": "inappropriate", "quote": "this question is pointless"}),))])   # abusive ends the round at once
    assert [o for o in run.conductor.pending_orders() if o.kind == "conduct_warning"]


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
        c.current().coded = True
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
        return state_of(deps.talker_chat.calls[1])

    state = asyncio.run(go())
    assert "show_problem" in state and "do not say a problem is on their screen" in state


def test_a_bare_transition_is_followed_by_the_opening_of_the_new_part_in_the_same_reply():
    """The opening once came as a proactive turn of its own after the bare line; it now comes in the same reply, so no extra turn
    (and no pause between a fragment and the new topic)."""
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
        c.current().coded = True
        out = await speak(run, "that's my answer")            # core-1 -> core-2 with a bare transition, nothing shown
        assert c.current().item_id == "core-2"
        await run.tick()
        assert run.speaker.replies == 0                       # nothing left to open: no turn of its own
        return deps, c, out

    deps, c, out = asyncio.run(go())
    assert out[:2] == ["Right, let's move on.", "I have another problem for you, it's on your screen."]
    assert "open_item" in state_of(deps.talker_chat.calls[1]) or "show_problem" in state_of(deps.talker_chat.calls[1])
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
        c.current().coded = True
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


def _round_with_two_problems(talk, realism=None):
    async def build():
        run, deps, clock = make(talk)
        if realism is not None:
            run.d.blueprint["realism"] = realism                     # a persona's stance: the interviewer's decision is the model's
        run.d.conduct_chat = FakeChat()                           # the change decision (and the conduct check) keep off the talker's scripted calls
        _with_deep_dive(run)
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        c.current().coded = True                                  # they have written code: the problem may be left
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
        c.current().coded = True
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


def test_a_retry_pass_does_not_add_a_second_acknowledgement_to_the_one_the_first_pass_spoke():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("Right on both counts \u2014 no unary minus at the start.", "Don't worry, this is an easy problem."),     # the second is blocked
            say("Good, you've covered precedence.", "Walk me through what your stack holds at that point.")])
        pieces = await speak(run, "that's my trace")
        return pieces, run

    pieces, run = asyncio.run(go())
    assert pieces == ["Right on both counts \u2014 no unary minus at the start.", "Walk me through what your stack holds at that point."]
    assert any(b["rule"] == "second_verdict" for b in run.talker.last.blocked)


def test_a_retry_pass_that_only_restates_the_first_passes_remark_is_dropped_like_one_pass_would():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("Yes, single wall or empty returns 0.", "Don't worry, this is an easy problem."),
            say("Yes, that's the right edge case.")])
        pieces = await speak(run, "that's my trace")
        return pieces, run

    pieces, run = asyncio.run(go())
    assert pieces == ["Yes, single wall or empty returns 0."]          # the empty-turn fallback only applies when nothing at all was said
    assert any(b["rule"] == "second_verdict" for b in run.talker.last.blocked)


def test_a_turn_that_already_said_goodbye_is_not_retried_into_reopening_the_round():
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("I can't speak to that one.", "Thanks for your time, Aarav. Have a great day!",
                "We'll wrap up here and you'll see the next steps on the InterviewIQ platform shortly."),    # the last is blocked
            say("But it's a sensible question.", "Anything else you'd like to ask me?")])
        pieces = await speak(run, "how does the team pick its tools?")
        return pieces, run

    pieces, run = asyncio.run(go())
    assert pieces == ["I can't speak to that one.", "Thanks for your time, Aarav.", "Have a great day!"]


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



# ------------------------------------------------------------ conversation flow: what the screen shows when, silence, requests

INTRO = "Here's your first question. Give it a read, and let me know if you have any questions."


class HoldingWorkspace(FakeWorkspace):
    """A workspace that keeps screen changes back while holding, like the real bridge: `shown` is what the candidate has seen."""

    def __init__(self) -> None:
        super().__init__()
        self.holding, self.shown, self.deferred = False, [], []

    async def send(self, body: dict) -> str:
        message_id = await super().send(body)
        (self.deferred if self.holding and body["type"] in ("room.state", "panel.show_problem", "panel.add_section") else self.shown).append(body)
        return message_id

    def hold(self) -> None:
        self.holding = True

    async def release(self) -> None:
        self.holding = False
        self.shown, self.deferred = self.shown + self.deferred, []

    def shown_types(self) -> list[str]:
        return [m["type"] for m in self.shown]


def _make_with(workspace, turns):
    clock = Clock()
    deps = RunDeps(blueprint=blueprint(), context=context(), talker_chat=FakeChat(turns), director_chat=FakeChat(briefs=[]),
                   workspace=workspace, api=FakeApi(), store=MemoryStore(), clock=clock, first_token_timeout_s=0.2)
    run = InterviewRun(deps)
    run.speaker = FakeSpeaker()
    return run, deps, clock


def _go_to(run, item_id, turns=5):
    c = run.conductor
    while c.current().item_id != item_id:
        c.current().turns = turns
        c.next_item("t")
    c.current().turns = turns


def test_the_problem_and_the_layout_reach_the_screen_only_after_the_interviewer_has_said_them():
    async def go():
        ws = HoldingWorkspace()
        run, deps, clock = _make_with(ws, [say("Alright, let's get into the coding now. " + INTRO,
                                               tools=(("next_item", {"reason": "done"}), ("show_problem", {})))])
        await run.start(None)
        _go_to(run, "candidate_intro")
        await speak(run, "I think I'm ready for the coding")
        before = (list(ws.shown_types()), [m["type"] for m in ws.deferred])
        run.on_agent_state("speaking")
        await asyncio.sleep(0)
        assert "panel.show_problem" not in ws.shown_types()                # the voice is still talking
        run.on_agent_state("listening")
        for _ in range(5):
            await asyncio.sleep(0)
        return before, ws

    before, ws = asyncio.run(go())
    assert before[0] == ["room.state"] and "panel.show_problem" in before[1] and "room.state" in before[1]       # held, not lost
    assert ws.shown_types() == ["room.state", "panel.show_problem", "room.state"] and ws.shown[-1]["layout"] == "work"


def test_a_reply_with_nothing_to_say_shows_what_it_changed_at_once():
    async def go():
        ws = HoldingWorkspace()
        run, deps, _ = _make_with(ws, [say("<silent>", tools=(("show_problem", {}),))])
        await run.start(None)
        _go_to(run, "core-1")
        out = await speak(run, "Okay.")
        return out, ws, deps

    out, ws, deps = asyncio.run(go())
    assert out == [] and "panel.show_problem" in ws.shown_types() and not ws.holding
    assert len(deps.talker_chat.calls) == 1                                # "Okay." is not pushed for an answer


def test_a_held_screen_is_shown_anyway_when_the_voice_never_reports_that_it_finished():
    async def go():
        ws = HoldingWorkspace()
        run, deps, clock = _make_with(ws, [say(INTRO, tools=(("show_problem", {}),))])
        await run.start(None)
        _go_to(run, "core-1")
        await speak(run)
        assert "panel.show_problem" not in ws.shown_types()
        clock.advance(30)
        await run.tick()
        return ws

    assert "panel.show_problem" in asyncio.run(go()).shown_types()


def test_a_bare_okay_after_the_problem_goes_up_is_not_answered_but_an_answer_a_question_or_a_waiting_order_is():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _go_to(run, "core-1")
        deps.workspace.cards["core-1"] = {"sections": []}
        run.conductor.consume(run.conductor.pending_orders())              # the orders to open the parts were spoken
        run.on_conversation_item("assistant", INTRO, False)
        run.on_user_text("Okay.")
        assert run.skip_reply("Okay.") is True and run.unanswered is None and run.conductor.reply_owed is False
        run.on_conversation_item("assistant", "Does that make sense?", False)
        run.on_user_text("Yeah.")
        assert run.skip_reply("Yeah.") is False
        run.on_conversation_item("assistant", INTRO, False)
        run.conductor.on_proctor("tab_hidden", 1, 1)                      # the interviewer has something to say about the tab
        run.on_user_text("Okay.")
        return run.skip_reply("Okay.")

    assert asyncio.run(go()) is False


def test_resist_then_change_then_resist_then_the_coding_ends_with_the_projects_next():
    """(decided 2026-10-18) Every first ask is resisted by the talker; the second ask on a problem is the round's one change, said by the run;
    on the new problem the first ask is resisted again and the second ends the coding part, said by the run."""
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("I'd like you to stay with this one. Even a partial solution is fine, let's see how far we get."),
            say("Let's keep going with this problem. Try the idea you trust most first."),
            say("Walk me through the architecture decisions you made for the micro-frontend Experience Portal?")])
        run.conductor.current().turns = 6
        clock.advance(600)
        out1 = await speak(run, "Can you change the problem?")
        out2 = await speak(run, "I asked for another problem, actually.")
        on_second = run.conductor.current().item_id
        out3 = await speak(run, "Can we change this one too?")
        out4 = await speak(run, "I still want another one.")
        out5 = await speak(run)
        return run, deps, (out1, out2, out3, out4, out5), on_second

    run, deps, outs, on_second = asyncio.run(go())
    out1, out2, out3, out4, out5 = outs
    assert "[keep_problem]" in state_of(deps.talker_chat.calls[0]) and "[keep_problem]" in state_of(deps.talker_chat.calls[1])
    assert len(out2) == 1 and contains("give_up", out2[0]) and any(out2[0].endswith(v) for v in LINES["put_up:second"]) and on_second == "core-2"
    assert len(out4) == 1 and matches("coding_over", out4[0])
    assert len(deps.talker_chat.calls) == 3 and "[open_item]" in state_of(deps.talker_chat.calls[2]) and out1 and out3 and out5
    c = run.conductor
    assert c.current().item_id == "deep_dive" and c.no_more_problems and c.change_given
    assert [i.status for i in c.items if i.item_id in ("core-1", "core-2")] == ["done", "done"]
    assert [m["item_id"] for m in deps.workspace.of("panel.show_problem")] == ["core-2"]        # one problem put up by the run, none after the end


def test_a_request_to_write_in_their_editor_reaches_the_talker_as_an_order_to_decline_in_one_sentence():
    async def go():
        run, deps, _ = await _round_with_two_problems([say("That's yours to write in the editor.")])
        out = await speak(run, "Can you add a comment in the editor")
        return out, state_of(deps.talker_chat.calls[0])

    out, state = asyncio.run(go())
    assert out == ["That's yours to write in the editor."]
    assert "[decline_request]" in state and "do not tell them to write the code again" in state


def test_show_problem_shows_the_current_problem_whatever_label_the_talker_gives_it_and_refuses_only_another_problem():
    from app.interviewer.llm import ToolCall

    async def go():
        run, deps, _ = make([say("Alright, let's get into the coding now. " + INTRO,
                                 tools=(("next_item", {"reason": "done"}), ("show_problem", {"item_id": "coin_change"})))])
        await run.start(None)
        _go_to(run, "candidate_intro")
        await speak(run, "ready")
        refused = await run.tools.execute(ToolCall(id="x", name="show_problem", arguments={"item_id": "core-2"}), "9")
        return run, deps, refused

    run, deps, refused = asyncio.run(go())
    assert run.conductor.current().item_id == "core-1" and [m["item_id"] for m in deps.workspace.of("panel.show_problem")] == ["core-1"]
    assert refused["ok"] is False and "only shows the current problem" in refused["error"]


def test_when_everything_said_as_a_problem_went_up_was_held_back_the_candidate_hears_that_it_is_up_not_what_do_you_think():
    async def go():
        run, deps, _ = make([say("Let me check my blueprint.", tools=(("show_problem", {}),)), say()])
        await run.start(None)
        _go_to(run, "core-1")
        return await speak(run)

    out = asyncio.run(go())
    assert len(out) == 1 and out[0] in LINES["intro:first"]


def test_the_checkpoint_keeps_the_count_of_requests_for_a_different_problem():
    async def go():
        run, deps, clock = await _round_with_two_problems([say("Stay with this one, a partial solution is fine.")])
        run.conductor.current().turns = 6
        clock.advance(600)
        await speak(run, "Can you change the problem?")
        return deps.store.runs[run.session_id]["checkpoint"]["change_requests"]

    assert asyncio.run(go()) == {"core-1": 1}


def test_when_the_problem_goes_up_without_the_line_that_puts_it_up_the_run_says_it_last():
    async def go():
        run, deps, _ = make([say("I see. Let me put your first coding question up now.", tools=(("next_item", {"reason": "done"}), ("show_problem", {})))])
        await run.start(None)
        _go_to(run, "candidate_intro")
        return await speak(run, "ready")

    out = asyncio.run(go())
    assert out[-1] in LINES["intro:first"] and sum(x in LINES["intro:first"] for x in out) == 1


def test_a_talker_that_said_the_line_itself_is_not_given_a_second_one():
    async def go():
        run, deps, _ = make([say("Alright, let's get into the coding now. " + INTRO, tools=(("next_item", {"reason": "done"}), ("show_problem", {})))])
        await run.start(None)
        _go_to(run, "candidate_intro")
        return await speak(run, "ready")

    assert sum(x in LINES["intro:first"] for x in asyncio.run(go())) == 1


def test_the_talker_is_told_the_exact_line_in_the_turn_that_moves_on_to_a_problem_not_only_after_the_move():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _go_to(run, "candidate_intro")
        return run._view([], [])["next_part"]

    part = asyncio.run(go())
    assert part["phase"] == "problem" and any(v in part["hint"] for v in LINES["intro:first"]) and "connecting phrase" in part["hint"]


def test_a_second_refusal_cannot_be_turned_into_a_question_by_the_do_not_repeat_retry():
    async def go():
        run, deps, _ = await _round_with_two_problems([say("That's yours to write in the editor."),
                                                       say("That's yours to write in the editor."), say("I can't do that for you.")])
        await speak(run, "Can you add a comment in the editor")
        await speak(run, "Yeah. Can you write the constraints?")
        return deps.talker_chat.calls

    calls = asyncio.run(go())
    assert "no question and no instruction" in calls[2][-1]["content"]


def test_the_typing_window_is_accepted_and_ignored_and_never_wakes_the_director():
    async def go():
        run, _, _ = make([say("Hello.")])
        await run.start(None)
        woken = []
        run._trigger_director = lambda: woken.append(1)
        msg = web({"type": "typing.window", "t0": 0, "t1": 5000, "keys": 40, "chars": 40, "backspaces": 0, "nav": 0,
                   "longest_pause": 300, "jumps": 0, "untrusted": 0, "charless": 0})
        assert msg is not None
        await run.on_web_message(msg)
        return run, woken

    run, woken = asyncio.run(go())
    assert woken == []
    assert run.conductor.full_violations == 0 and run.conductor.proctor == [] and run.conductor.away is None
    assert run.speaker.replies == 0


def test_the_view_carries_the_candidates_own_highlights_on_the_current_problem():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": [], "highlights": [
            {"highlight_id": "h1", "quote": "No duplicate quadruplets", "occurrence": 0, "author": "candidate"},
            {"highlight_id": "h2", "quote": "target", "occurrence": 0, "author": "interviewer"}]}
        return run._view([], [])

    assert asyncio.run(go())["highlights"] == ["No duplicate quadruplets"]


def test_an_ending_decided_by_the_turn_that_already_said_goodbye_is_not_said_twice():
    """A live round said goodbye and, in the same turn, flagged a remark: the flag ended the round and a second goodbye followed."""
    async def go():
        run, deps, _ = make([say("Alright, thank you for your time, Asha. Take care, and goodbye.",
                                 tools=(("flag_conduct", {"kind": "inappropriate", "quote": "Do you have a girlfriend?"}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        c.on_candidate_turn()
        c.on_conduct("refuses_to_engage", "Let's skip that.", "t0", "director")     # the first incident
        c.consume(c.pending_orders())
        await speak(run, "No. No.")
        await asyncio.wait_for(run.finished.wait(), 1)
        return run, deps

    run, deps = asyncio.run(go())
    assert run.conductor.end_order.consumed
    assert len(deps.talker_chat.calls) == 1                     # no second turn to say the ending again


def test_the_second_ask_for_a_different_problem_puts_the_next_one_up_without_the_model():
    """A live round was ordered to give the next problem on the second ask; the model refused again ("No, that's not something I
    can do"), the plan moved to the next problem anyway without showing it, and the interviewer then asked about a problem the
    candidate had never seen. The move is done by the run, in fixed words, so the model cannot refuse it."""
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("I'd like you to stay with this one. Even a partial solution is fine."),
            say("No, that's not something I can do, a partial solution is perfectly fine.")])
        run.conductor.current().turns = 6
        clock.advance(600)
        out1 = await speak(run, "Can you change the problem?")
        out2 = await speak(run, "Can you skip this question?")
        return run, deps, out1, out2

    run, deps, out1, out2 = asyncio.run(go())
    assert len(out2) == 1 and contains("give_up", out2[0]) and any(out2[0].endswith(v) for v in LINES["put_up:second"])
    assert len(deps.talker_chat.calls) == 1                     # the second turn never reached the model
    assert run.conductor.current().item_id == "core-2"
    assert [m["item_id"] for m in deps.workspace.of("panel.show_problem")][-1] == "core-2"


def test_the_second_ask_with_no_time_left_ends_the_coding_in_fixed_words_without_the_model():
    async def go():
        run, deps, clock = await _round_with_two_problems([say("I'd like you to stay with this one. Even a partial solution is fine.")])
        run.conductor.current().turns = 6
        clock.advance(3000)                                      # too little of the round is left for another problem
        await speak(run, "Can you change the problem?")
        out = await speak(run, "Can you skip this question?")
        return run, deps, out

    run, deps, out = asyncio.run(go())
    assert len(out) == 1 and matches("coding_over", out[0]) and len(deps.talker_chat.calls) == 1
    c = run.conductor
    assert c.current().item_id == "deep_dive" and c.no_more_problems and not c.change_given
    assert next(i for i in c.items if i.item_id == "core-2").status == "skipped" and deps.workspace.of("panel.show_problem") == []


def _granting_a_pause():
    from types import SimpleNamespace

    async def go():
        run, deps, _ = make([say("I'd still like your answer to the question I asked, take your time.")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        run.speaker = SimpleNamespace(reply=lambda: None)
        pieces = [p async for p in run.reply(None)]
        return run, pieces
    return asyncio.run(go())


def test_a_pause_the_interviewer_granted_in_its_own_words_leaves_no_order_to_grant_it_again():
    """A live round said "take your time"; the hold it set left an order ("The candidate asked for a moment...") that a later turn
    carried out after the candidate had already spoken again."""
    run, _ = _granting_a_pause()
    assert run.conductor.held()
    assert not [o for o in run.conductor.pending_orders() if o.kind == "hold"]


def test_a_pause_granted_by_a_turn_that_was_never_played_is_undone():
    run, _ = _granting_a_pause()

    async def drop():
        run._drop_unplayed(run.seq)

    asyncio.run(drop())
    assert not run.conductor.held()


def _asked_and_waiting():
    """A run in the first problem whose last spoken line asked the candidate something; the voice is idle."""
    from types import SimpleNamespace

    async def go():
        run, deps, clock = make([])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        c.consume(c.pending_orders())
        asked = []
        run.speaker = SimpleNamespace(reply=lambda: asked.append(clock()))
        run.on_conversation_item("assistant", "Alright, we'll leave the highlight aside. How would you approach this problem?", False)
        c.set_agent_speaking(False)
        return run, clock, asked
    return asyncio.run(go())


def test_a_conduct_warning_waits_for_the_answer_to_the_question_just_asked():
    """A live round asked "How would you approach this problem?" and 5.5 s later started a new turn for a warning the director had
    raised, cutting off the answer. Until they answer (or 20 s pass) it waits, and is said in the reply to what they say."""
    run, clock, asked = _asked_and_waiting()
    run.conductor.on_conduct("director:warn", "off-topic chat", "brief-3", "director")
    run._speak_soon()
    assert asked == []
    clock.advance(21)
    run._speak_soon()
    assert len(asked) == 1


def test_an_ending_is_said_at_once_even_while_waiting_for_an_answer():
    run, clock, asked = _asked_and_waiting()
    run.conductor.on_end_request()
    run._speak_soon()
    assert len(asked) == 1


def test_a_bare_line_that_moves_the_plan_on_is_followed_by_the_opening_in_the_same_reply():
    """A live round said only "Perfect." and moved on; the order to open the next part then made it speak again 3 s later, so the
    candidate heard a fragment, a pause, then a new topic. The opening now comes in the same reply."""
    async def go():
        run, deps, _ = make([say("Perfect.", tools=(("next_item", {"reason": "intro done"}),)),
                             say("Alright, let's get into the coding now. Let me put the first problem on your screen.",
                                 tools=(("show_problem", {}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_intro":
            c.current().turns = 3
            c.next_item("t")
        c.current().turns = 5
        c.consume(c.pending_orders())
        out = await speak(run, "That's all about my project.")
        return run, deps, out

    run, deps, out = asyncio.run(go())
    assert out[:3] == ["Perfect.", "Alright, let's get into the coding now.", "Let me put the first problem on your screen."]
    assert len(out) == 4 and out[3] in LINES["intro:first"]                                  # the read line, once the screen has changed (no voice to wait for here)
    assert len(deps.talker_chat.calls) == 2
    assert run.conductor.current().item_id == "core-1"
    assert not [o for o in run.conductor.pending_orders() if o.kind == "open_item"]


def test_pressing_end_is_answered_with_a_goodbye_in_fixed_words():
    """A live round's candidate pressed End; ordered to say goodbye, the model said "Take your minute, then tell me...". An ending is
    said by the run itself."""
    async def go():
        run, deps, _ = make([say("I'll give you a moment to gather your thoughts on that. Take your minute.")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        c.consume(c.pending_orders())
        c.on_end_request()
        out = await speak(run)
        await asyncio.wait_for(run.finished.wait(), 1)
        return out, deps

    out, deps = asyncio.run(go())
    assert out == ["Thank you for your time today, Asha. Take care, and goodbye."]
    assert deps.talker_chat.calls == []


def test_hello_gets_an_instant_im_here_before_the_model_continues():
    """A live round answered each "Hello?" through the model, a second or more later; the candidate said "Hello?" again before it
    played and cut it off, three times. "Yes, I'm here." is said at once, then the model goes on with what is owed."""
    async def go():
        run, deps, _ = make([say("Let's make it concrete: take sizes 2 and 3 and a target of 5.")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        c.consume(c.pending_orders())
        out = await speak(run, "Hi. Are you there?")
        return run, deps, out

    run, deps, out = asyncio.run(go())
    assert matches("presence", out[0]) and "take sizes 2 and 3" in out[1]
    assert out[0].rstrip(".") in str(deps.talker_chat.calls[0][-1]["content"])      # the model knows it was said
    assert run.history[-1]["content"].startswith(out[0])


def test_a_hi_answering_the_greeting_is_not_met_with_im_here():
    async def go():
        run, deps, _ = make([say("Hi Asha, I'm Rahul. How are you doing today?"), say("Good to hear. Are you somewhere quiet?")])
        await run.start(None)
        await speak(run)                                         # the greeting
        return await speak(run, "Hi!")

    out = asyncio.run(go())
    assert not any(matches("presence", x) or matches("line_check", x) for x in out)


def test_asking_about_the_highlighted_part_reaches_the_talker_with_what_was_selected():
    """A live round's candidate selected a line of the problem and asked "can you see the highlighted part?"; the interviewer only
    had the pointer and kept saying it could not see it. The selection now reaches the talker with the words that point at it."""
    async def go():
        run, deps, clock = make([say("That line says each size can be reused.")])
        await run.start(None)
        await run.on_web_message(_batch(clock, [(997.0, {"k": "sel", "s": "panel", "text": "Each portion size can be used any number of times."})]))
        run.on_user_transcript("can you see the highlighted part", False, 999.0)
        run.on_user_transcript("can you see the highlighted part", True, 1000.0)
        await speak(run, "can you see the highlighted part")
        return deps

    state = state_of(asyncio.run(go()).talker_chat.calls[0])
    assert "the selected text “Each portion size can be used any number of times.” in the problem" in state


def test_the_rules_tell_the_talker_what_this_and_the_highlighted_part_point_at():
    from app.interviewer.prompts import TALKER_RULES

    assert "says “this” →" in TALKER_RULES and "never say you cannot see it" in TALKER_RULES


def _in_intro(turns):
    async def go():
        run, deps, clock = make(turns)
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "candidate_intro":
            c.current().turns = 3
            c.next_item("t")
        c.consume(c.pending_orders())
        return run, deps, clock
    return go()


def test_a_turn_that_trailed_off_is_answered_once_they_stay_quiet():
    """A live round's candidate ended a long introduction mid-sentence; it got no reply, and the candidate sat in silence for 35 s
    until a check-in. The interviewer says "Mm-hmm." at once, and once they stay quiet two seconds more, the turn is answered."""
    async def go():
        run, deps, clock = await _in_intro([say("Thanks for that. What are you working on these days?")])
        intro = "I work on the Experience Portal and the agent product, and I've touched Flutter and Spring Boot, and the"
        run.on_user_text(intro)
        assert run.skip_reply(intro)                                # held back, as the voice pipeline asks first: they may go on
        assert len(run.speaker.backchannels) == 1 and matches("backchannel", run.speaker.backchannels[0])            # at once, as a listener does: they know they were heard
        replies = run.speaker.replies
        clock.advance(1.5)
        await run.tick()
        assert run.speaker.replies == replies                      # still inside the grace
        clock.advance(1)
        await run.tick()
        assert run.speaker.replies == replies + 1                  # they stopped: the reply is asked for
        out = await speak(run)
        return out, deps, intro

    out, deps, intro = asyncio.run(go())
    assert out == ["Thanks for that.", "What are you working on these days?"]
    assert any(intro in str(m.get("content")) for m in deps.talker_chat.calls[0])


def test_no_order_starts_a_turn_while_the_candidate_is_mid_answer():
    """A live round asked for an introduction; the candidate answered with long pauses, and orders (the part's time, the next part's
    opening) started turns in those pauses, talking over the answer."""
    async def go():
        run, deps, clock = await _in_intro([])
        run.on_conversation_item("assistant", "Give me a short introduction, and tell me about one project.", False)
        run.conductor.set_agent_speaking(False)
        clock.advance(30)                                          # past the 20 s cap on waiting for an answer
        run.on_user_transcript("so I graduated in twenty twenty six and", False, clock() - 2)
        run.conductor.ask_follow_up()
        before = run.speaker.replies
        run._speak_soon()
        return run.speaker.replies - before

    assert asyncio.run(go()) == 0


def test_a_warning_turn_does_not_order_a_follow_up_while_their_answer_is_still_owed():
    """A live round asked about sprint planning, then warned about a tab switch; the warning asked nothing, so a follow-up was
    ordered and spoken at once, and the interviewer moved on to the coding before the candidate had answered."""
    async def go():
        run, deps, clock = await _in_intro([say("Thanks. How did you plan the sprints on that project?"),
                                            say("Please stay on this tab for the rest of the interview.")])
        await speak(run, "I led a team of three on the Experience Portal.")
        run.conductor.on_proctor("tab_hidden", 1, clock())
        await speak(run)
        return run

    run = asyncio.run(go())
    assert not [o for o in run.conductor.pending_orders() if o.kind == "open_item"]


def test_a_full_introduction_that_ends_with_so_is_answered_at_once():
    async def go():
        run, _, _ = await _in_intro([])
        intro = "I work on the Experience Portal and the agent product, and I've touched Flutter and Spring Boot. So..."
        run.on_user_text(intro)
        return run.skip_reply(intro), run.speaker.backchannels

    assert asyncio.run(go()) == (False, [])


def test_a_trailing_turn_while_they_type_gets_no_backchannel():
    async def go():
        run, _, clock = await _in_intro([])
        run._code_at = clock()
        run.on_user_text("and then I put it in the")
        run.skip_reply("and then I put it in the")
        return run.speaker.backchannels

    assert asyncio.run(go()) == []


def _cut_two_words_in(run, clock):
    run._unconfirmed[7] = {"key": "thanks which part of tha", "at": clock(), "outline": False, "orders": [],
                           "spoken": ["Thanks.", "Which part of that did you build yourself?"]}
    run.on_conversation_item("assistant", "Thanks. Which part", True)     # they carried on: the interviewer was cut two words in


def test_a_candidate_the_interviewer_spoke_over_gets_the_floor_back_in_fixed_words():
    """Decided 2026-10-17: the interviewer started while they were still going, and they cut it off a word or two in with a word
    or two of their own. A person stops and says "Sorry, go ahead." No model, and nothing ordered is said or spent."""
    async def go():
        run, deps, clock = await _in_intro([say("Which part did you build?")])
        _cut_two_words_in(run, clock)
        run.on_user_text("and the backend")
        assert not run.skip_reply("and the backend")       # not held back as trailing: the reply hands the floor back
        out = await speak(run, "and the backend")
        return out, deps, run

    out, deps, run = asyncio.run(go())
    assert len(out) == 1 and matches("yield", out[0])
    assert deps.talker_chat.calls == [] and run.speaker.backchannels == []


def test_after_cutting_the_interviewer_off_a_real_answer_or_a_question_is_answered_by_the_model():
    async def go(text):
        run, deps, clock = await _in_intro([say("Got it. Which part was hardest?")])
        _cut_two_words_in(run, clock)
        return await speak(run, text)

    assert asyncio.run(go("Actually I built the whole payment service myself.")) == ["Got it.", "Which part was hardest?"]
    assert asyncio.run(go("Which part?")) == ["Got it.", "Which part was hardest?"]


def test_the_floor_is_handed_back_only_once():
    async def go():
        run, deps, clock = await _in_intro([say("Got it. Which part was hardest?")])
        _cut_two_words_in(run, clock)
        first = await speak(run, "and the backend")
        second = await speak(run, "and the backend")
        return first, second

    first, second = asyncio.run(go())
    assert len(first) == 1 and matches("yield", first[0]) and second == ["Got it.", "Which part was hardest?"]


# ------------------------------------------------------------ queued orders that went stale (decided 2026-10-17)

def _log(**set_aside):
    return ("log_turn", {"condition": "they went on", "action": "improvised", "reason": "hear them out", **set_aside})


def test_a_queued_check_in_is_not_said_to_a_candidate_who_just_spoke():
    async def go():
        run, deps, clock = await _in_intro([say("Nice. What did you own in that?")])
        run.conductor._order("nudge", "The candidate has been quiet for a while. Check in gently: ask what they are thinking.", clock())
        await speak(run, "So I was working on the pricing service and the dashboards")
        return deps

    deps = asyncio.run(go())
    state = state_of(deps.talker_chat.calls[0])
    assert "[nudge]" not in state
    them = next(t for t in deps.store.turns if t["speaker"] == "candidate")
    assert them["cancelled"] == ["nudge"]


def test_a_move_on_the_interviewer_set_aside_keeps_the_part_wakes_the_director_and_is_recorded():
    async def go():
        why = "they just started on the caching layer"
        run, deps, clock = await _in_intro([say("Interesting, how did you cache those lookups?",
                                                tools=(_log(set_aside=["move_on"], set_aside_why=why),))])
        c = run.conductor
        c.move_on_order(c.current(), clock())
        woken: list[set] = []
        run.director.trigger = lambda reasons: woken.append(set(reasons))
        await speak(run, "And then I added a caching layer in front of the pricing service")
        return run, deps, woken, why

    run, deps, woken, why = asyncio.run(go())
    assert run.conductor.current().item_id == "candidate_intro"
    turn = [t for t in deps.store.turns if t["speaker"] == "interviewer"][-1]
    assert turn["set_aside"] == [{"kind": "move_on", "why": why}]
    assert any("set_aside" in w for w in woken)


def test_a_move_on_answered_with_a_follow_up_does_not_silently_move_the_round():
    """A live round's plan moved to the next part after a turn that kept asking about the current one: the candidate answered a
    question the plan had already left."""
    async def go():
        run, deps, clock = await _in_intro([say("Interesting, how did you cache those lookups?", tools=(_log(action="ask_follow_up"),))])
        c = run.conductor
        c.move_on_order(c.current(), clock())
        await speak(run, "And then I added a caching layer in front of the pricing service")
        return run, deps

    run, deps = asyncio.run(go())
    assert run.conductor.current().item_id == "candidate_intro"
    turn = [t for t in deps.store.turns if t["speaker"] == "interviewer"][-1]
    assert turn["set_aside"] == [{"kind": "move_on", "why": "stayed on the part (ask_follow_up)"}]


def test_a_move_on_said_in_words_still_moves_the_round():
    async def go():
        run, deps, clock = await _in_intro([say("Thanks for that, let's move on.")])
        c = run.conductor
        c.current().turns = 5                  # the gate is open: a move_on is only ever ordered then (a closed gate refuses it)
        c.move_on_order(c.current(), clock())
        await speak(run, "And then I added a caching layer in front of the pricing service")
        return run

    assert asyncio.run(go()).conductor.current().item_id != "candidate_intro"


def test_a_warning_cannot_be_set_aside():
    async def go():
        run, deps, clock = await _in_intro([say("Let's keep it professional, please. What did you own there?",
                                                tools=(_log(set_aside=["conduct_warning"], set_aside_why="no"),))])
        run.conductor._order("conduct_warning", "Warn them about the language.", clock())
        await speak(run, "It was a damn mess honestly")
        return run, deps

    run, deps = asyncio.run(go())
    assert not any(o.kind == "conduct_warning" for o in run.conductor.pending_orders())
    turn = [t for t in deps.store.turns if t["speaker"] == "interviewer"][-1]
    assert turn["set_aside"] == []


def test_the_director_sees_what_was_set_aside_and_why():
    async def go():
        run, _, clock = await _in_intro([])
        run.conductor.set_aside([run.conductor.move_on_order(run.conductor.current(), clock())], "mid-idea on caching")
        return await run._director_messages()

    assert "mid-idea on caching" in json.dumps(asyncio.run(go()))


def test_the_interviewer_opens_a_thread_and_the_next_turn_is_on_it():
    async def go():
        run, deps, _ = await _in_intro([say("Oh, you led that migration? Tell me how it started.",
                                            tools=(("open_thread", {"title": "the monolith migration", "why": "they led it"}),)),
                                        say("And what broke first?")])
        await speak(run, "I led our move off the monolith last year")
        await speak(run, "We started with the billing service")
        return run, deps
    run, deps = asyncio.run(go())
    assert (run.conductor.current().kind, run.conductor.current().title) == ("thread", "the monolith migration")
    turn = next(t for t in deps.store.turns if t["speaker"] == "interviewer" and t["tool_calls"])
    assert turn["tool_calls"][0]["result"]["ok"] is True


def test_a_move_the_plan_refuses_is_reported_next_turn_and_breaks_nothing():
    async def go():
        run, deps, _ = await _in_intro([say("Let's jump ahead.", tools=(("go_to", {"goal_id": "nonsense", "why": ""}),
                                                                         ("skip_goal", {"goal_id": "core-1"}),
                                                                         ("open_thread", {"title": "x", "why": "y", "minutes": 0}))),
                                        say("So, tell me more.")])
        await speak(run, "Sure")
        await speak(run, "Okay")
        return run, deps
    run, deps = asyncio.run(go())
    state = state_of(deps.talker_chat.calls[1])
    assert "nonsense is not a part still to come" in state and run.conductor.current().kind == "thread"


def test_a_brief_written_before_the_interviewer_moved_is_not_shown():
    async def go():
        run, deps, clock = await _in_intro([say("Tell me more."), say("Go on.")])
        run.brief, run.brief_for = {"goal": "ask about their database choice", "next_move": {}}, run.conductor.position
        await speak(run, "I built a payments app")
        run.conductor.note_flow_move()
        await speak(run, "It used Postgres")
        return deps
    deps = asyncio.run(go())
    assert "database choice" in state_of(deps.talker_chat.calls[0])
    assert "database choice" not in state_of(deps.talker_chat.calls[1])
    turns = [t for t in deps.store.turns if t["speaker"] == "interviewer"]
    assert turns[-1]["brief_position"] is None and "free_min" in turns[-1]


def test_the_director_sees_the_interviewers_moves_and_the_free_minutes():
    async def go():
        run, _, _ = await _in_intro([])
        run.conductor.open_thread("the migration", "they led it")
        return await run._director_messages()
    text = json.dumps(asyncio.run(go()))
    assert "the migration" in text and "free_min" in text and "open_thread" in text


def test_the_move_to_the_first_problem_carries_the_outline_sentence_for_that_style():
    run, _, _ = make([])
    assert "how the coding will run" not in run._problem_hint(1)
    first = next(i for i in run.conductor.items if i.kind == "slot")
    first.style = "with_outline"
    assert "how the coding will run: about" in run._problem_hint(1)
    assert "how the coding will run" not in run._problem_hint(2)


def _chat_run(talk):
    run, deps, clock = make(talk)
    bp = run.d.blueprint
    bp["arc"][1:1] = [{"phase": "small_talk", "timebox_mins": 2, "scored": False, "guidance": "Light chat."},
                      {"phase": "framing", "timebox_mins": 1, "scored": False, "guidance": "How the round runs."}]
    run.conductor = type(run.conductor)(bp, run.round_seconds, run.d.rules, run.d.clock, run.skills)
    return run, deps, clock


def test_a_problem_that_has_just_gone_up_is_not_ended_by_a_stray_next_item():
    async def go():
        run, deps, _ = make([say("Alright, let's get into the coding now.", tools=(("next_item", {"reason": "move to the first coding problem"}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}         # just shown, nothing said by the candidate yet
        assert c.current().turns == 0
        await speak(run)
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "core-1"
    assert run.talker.last.tool_calls[0]["result"] == {
        "ok": False, "error": "the problem has just gone up: give them time to read it and start; do not move on"}


def test_an_outline_given_in_words_while_the_plan_is_on_small_talk_moves_the_plan_to_framing_then_the_introduction_follows():
    async def go():
        run, deps, _ = _chat_run([
            say("Good, then let me tell you how this round will run. We'll start with a short chat about your background, then a couple of coding problems."),
            say("Let's start with you — tell me a bit about yourself.")])
        await run.start(None)
        c = run.conductor
        c.go_to("small_talk", "t")
        c.current().turns = 3
        await speak(run, "sure")
        first = (c.current().item_id, c.outline_said)
        await speak(run, "go on")
        return first, run

    first, run = asyncio.run(go())
    assert first == ("framing", True)
    assert run.conductor.current().item_id == "candidate_intro"
    assert [e for e in run.conductor.flow_log if e.get("why") == "inferred from the interviewer's words"]


def test_a_turn_that_calls_go_to_itself_is_not_second_guessed_by_the_words():
    async def go():
        run, deps, _ = _chat_run([say("Let's start with you — tell me a bit about yourself.",
                                      tools=(("go_to", {"goal_id": "framing", "why": "x"}),))])
        await run.start(None)
        c = run.conductor
        c.go_to("small_talk", "t")
        c.current().turns = 3
        await speak(run, "sure")
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "framing"


def test_next_item_on_a_just_shown_problem_is_refused_even_when_the_words_say_next_problem():
    async def go():
        run, deps, _ = make([say("Let's move on to the next problem.", tools=(("next_item", {"reason": "done"}),))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run)
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "core-1"
    assert run.talker.last.tool_calls[0]["result"]["error"].startswith("the problem has just gone up")


def test_an_outline_that_mentions_the_introduction_moves_only_to_framing_not_to_the_introduction():
    async def go():
        run, deps, _ = _chat_run([say(
            "Let me tell you how this round will run: I'll ask you to introduce yourself, then give you a couple of coding problems, "
            "and we'll keep time at the end for your questions.")])
        await run.start(None)
        c = run.conductor
        c.go_to("small_talk", "t")
        c.current().turns = 3
        await speak(run, "sure")
        return run

    assert asyncio.run(go()).conductor.current().item_id == "framing"


PROMISE = "Let's keep that thread for later."
STORY = "Honestly the funniest part was when I built a chat app during my internship and it crashed."


def test_a_promise_to_come_back_in_the_introduction_records_a_deferred_topic_and_moves_nothing():
    async def go():
        run, deps, _ = _chat_run([say(PROMISE)])
        await run.start(None)
        c = run.conductor
        c.go_to("candidate_intro", "t")
        await speak(run, STORY)
        return run

    c = asyncio.run(go()).conductor
    assert c.current().item_id == "candidate_intro" and c.threads_opened == 0
    deferred = [i for i in c.items if i.origin == "promise"]
    assert [(i.title, i.why) for i in deferred] == [(STORY[:60], "inferred: promised to return")]
    assert [e["move"] for e in c.flow_log if e["why"] == "inferred: promised to return"] == ["defer_topic"]


def _promise_during_a_problem(reply, candidate=STORY):
    async def go():
        run, deps, _ = make([say(reply)])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        await speak(run, candidate)
        return run, deps

    return asyncio.run(go())


def test_a_promise_during_a_problem_keeps_a_place_for_the_topic_after_the_coding_named_by_what_they_said():
    run, deps = _promise_during_a_problem(PROMISE)
    c = run.conductor
    assert c.current().item_id == "core-1" and c.threads_opened == 0
    deferred = [i for i in c.items if i.origin == "promise"]
    assert [(i.title, i.why, i.status) for i in deferred] == [(STORY[:60], "inferred: promised to return", "pending")]
    assert c.items.index(deferred[0]) == [i.item_id for i in c.items].index("candidate_questions") - 1
    assert [e["move"] for e in c.flow_log if e["why"] == "inferred: promised to return"] == ["defer_topic"]


def test_a_promise_that_names_its_topic_defers_it_under_that_name():
    run, _ = _promise_during_a_problem("That side project sounds worth a chat later.", "I also built a side project last year, a CLI tracker.")
    assert [i.title for i in run.conductor.items if i.origin == "promise"] == ["that side project"]


def test_a_turn_that_opens_a_thread_itself_is_not_second_guessed_by_its_promise():
    async def go():
        run, deps, _ = _chat_run([say(PROMISE, tools=(("open_thread", {"title": "the chat app", "why": "they raised it"}),))])
        await run.start(None)
        run.conductor.go_to("candidate_intro", "t")
        await speak(run, STORY)
        return run

    run = asyncio.run(go())
    assert run.conductor.threads_opened == 1 and run.conductor.current().title == "the chat app"


OWED = "I think I would use a hash map to store the counts and then scan the array once."


def test_an_empty_acknowledgement_to_a_real_answer_is_asked_for_again_once():
    async def go():
        run, deps, _ = make([say("Sure, let me clarify that."), say("A hash map gives constant lookups, so how does the scan handle duplicates?")])
        await run.start(None)
        out = await speak(run, OWED)
        return out, deps.talker_chat.calls

    out, calls = asyncio.run(go())
    assert out == ["A hash map gives constant lookups, so how does the scan handle duplicates?"]
    assert len(calls) == 2 and "Respond to what they said with something specific." in calls[1][-1]["content"]


def test_a_short_reply_to_a_request_is_not_an_empty_acknowledgement_and_a_second_empty_reply_is_spoken():
    async def go():
        run, deps, _ = make([say("Sure.")])
        await run.start(None)
        asked = await speak(run, "Can you tell me the constraints for this one please?")
        run2, deps2, _ = make([say("Sure, let me clarify that."), say("Okay, got it.")])
        await run2.start(None)
        twice = await speak(run2, OWED)
        return asked, deps.talker_chat.calls, twice, deps2.talker_chat.calls

    asked, calls, twice, calls2 = asyncio.run(go())
    assert asked == ["Sure."] and len(calls) == 1
    assert twice == ["Okay, got it."] and len(calls2) == 2


def _first_turn(deps):
    return next(t for t in deps.store.turns if t["speaker"] == "interviewer")


def test_a_turn_without_log_turn_gets_a_decision_the_conductor_infers():
    async def go():
        run, deps, _ = make([say("Hi, I'm Siddharth. Thanks for joining.")])
        await run.start(None)
        await speak(run)
        return deps

    assert _first_turn(asyncio.run(go()))["decision"] == {
        "condition": "not recorded by the model", "action": "continue", "reason": "conductor-recorded", "inferred": True}


def test_a_turn_with_log_turn_keeps_the_models_own_decision():
    async def go():
        run, deps, _ = make([say("Hi.", tools=(("log_turn", {"condition": "none", "action": "greet", "reason": "opening"}),))])
        await run.start(None)
        await speak(run)
        return deps

    decision = _first_turn(asyncio.run(go()))["decision"]
    assert decision["action"] == "greet" and "inferred" not in decision


def test_an_inferred_move_records_the_action_of_the_tool_it_called():
    async def go():
        run, deps, _ = make([say("Alright, let's go on.", tools=(("next_item", {}),))])
        await run.start(None)
        await speak(run)
        return deps

    decision = _first_turn(asyncio.run(go()))["decision"]
    assert decision["action"] == "move_on" and decision["inferred"] is True


def _turn_record(deps):
    return [t for t in deps.store.turns if t["speaker"] == "interviewer"][-1]


def _followed_after(question, candidate):
    async def go():
        run, deps, _ = make([say(question)])
        await run.start(None)
        c = run.conductor
        c.go_to("candidate_intro", "t")
        await speak(run, candidate)
        return _turn_record(deps)

    return asyncio.run(go())


def test_a_question_built_on_what_the_candidate_said_that_the_part_did_not_plan_is_recorded_as_followed():
    record = _followed_after("How did you decide when to roll back the database migration?",
                             "Last weekend our database migration failed and we had to roll back everything overnight.")
    assert record["followed"] is True


def test_the_parts_own_probe_or_an_unrelated_question_is_not_recorded_as_followed():
    own = _followed_after("How did the split app handle the settlement logic?", "I built the settlement logic of a split app with friends last year.")
    assert own["followed"] is False
    unrelated = _followed_after("What are you working on these days?", "Last weekend our database migration failed.")
    assert unrelated["followed"] is False


def test_a_promise_made_on_a_turn_that_also_calls_a_flow_tool_is_still_recorded():
    async def go():
        run, deps, _ = _chat_run([say(PROMISE, tools=(("next_item", {"reason": "go on"}),))])
        await run.start(None)
        run.conductor.go_to("candidate_intro", "t")
        await speak(run, STORY)
        return run

    c = asyncio.run(go()).conductor
    assert any(i.origin == "promise" for i in c.items) and c.threads_opened == 0


def test_a_promise_with_the_projects_discussion_pending_is_attached_to_it_even_on_the_turn_that_moves_on():
    async def go():
        run, deps, _ = make([say(PROMISE, tools=(("next_item", {"reason": "go on"}),))])
        run.d.blueprint["round"]["deep_dive_mins"] = 4
        run.conductor = type(run.conductor)(run.d.blueprint, run.round_seconds, run.d.rules, run.d.clock, run.skills)
        await run.start(None)
        run.conductor.go_to("candidate_intro", "t")
        await speak(run, STORY)
        return run

    c = asyncio.run(go()).conductor
    assert c.follow_ups["deep_dive"] == [f"They promised to come back to: {STORY[:60]}"]
    assert c.threads_opened == 0 and [e["target"] for e in c.flow_log if e["move"] == "defer_topic"] == ["deep_dive"]


def test_a_promise_on_a_turn_the_interviewer_started_itself_is_still_recorded_under_the_last_thing_they_said():
    """A rehearsal (2026-10-17): moving from the introduction to the coding, the interviewer said "We'll come back to that in depth
    later" on a turn it opened itself (no candidate message to answer), and the promise was skipped for lack of a title."""
    async def go():
        run, deps, _ = _chat_run([say("We'll come back to that in depth later. Let me ask one more thing about it.")])
        await run.start(None)
        c = run.conductor
        c.go_to("candidate_intro", "t")
        run.on_user_text(STORY)                          # they spoke; the next reply is one the interviewer starts on its own
        run._asked = ""
        pieces = [p async for p in run.reply(None)]
        run.on_conversation_item("assistant", " ".join(pieces), False)
        return run

    c = asyncio.run(go()).conductor
    assert [(i.title, i.why) for i in c.items if i.origin == "promise"] == [(STORY[:60], "inferred: promised to return")]


def test_an_empty_acknowledgement_is_accepted_for_a_yes_no_question_and_while_they_type():
    async def go(candidate, typing=False):
        run, deps, _ = make([say("Sure."), say("A second reply that should not be asked for.")])
        if typing:
            run._typing = lambda activity: True
        await run.start(None)
        out = await speak(run, candidate)
        return out, len(deps.talker_chat.calls)

    assert asyncio.run(go("Is it okay if I use Python for this one, or would you rather see Java?")) == (["Sure."], 1)
    assert asyncio.run(go(OWED, typing=True)) == (["Sure."], 1)


def test_a_noun_phrase_of_their_own_words_in_a_promise_is_kept_but_sequencing_and_the_parts_own_question_are_not():
    def promise_made(reply, candidate):
        async def go():
            run, deps, _ = make([say(reply)])
            await run.start(None)
            c = run.conductor
            while c.current().item_id != "core-1":
                c.current().turns = 3
                c.next_item("t")
            await speak(run, candidate)
            return [i.title for i in c.items if i.origin == "promise"]

        return asyncio.run(go())

    said = "We had a database migration fail once and I rolled the whole thing back over a weekend."
    assert promise_made("We'll come back to the migration later.", said) == [said[:60]]
    assert promise_made("We'll come back to the migration once you've coded it.", said) == []
    assert promise_made("We'll get back to the tech stack when we get to your questions.", said) == []
    assert promise_made("Let's keep that for later: how did the split app handle the settlement logic?", said) == []


PUT_UP = "Alright, I can see you're eager to get coding, so let's get into it. Let me put the first problem on your screen."
MOVE_ON_LOG = ("log_turn", {"condition": "they push to coding", "action": "move_on", "reason": "stop asking and go to the coding problem"})


def test_a_turn_that_puts_the_first_problem_up_from_a_thread_leaves_it_active_with_no_declared_move_on():
    async def go():
        run, deps, _ = await _in_intro([say(PUT_UP, tools=(("show_problem", {}), MOVE_ON_LOG))])
        c = run.conductor
        c.current().turns = 3
        assert c.open_thread("the startup idea", "they raised it")[0]
        await speak(run, "Can we just start the coding?")
        return run

    run = asyncio.run(go())
    c = run.conductor
    core = next(i for i in c.items if i.item_id == "core-1")
    assert (c.current().item_id, core.status, core.turns) == ("core-1", "active", 0)
    assert not [i for i in c.items if i.ended_by == "declared move on"]


def test_a_turn_that_starts_on_a_problem_with_no_candidate_turn_does_not_leave_it_on_a_declared_move_on():
    """The rh13_wanders_off record: the plan was already on the problem when the turn began (so the turn's own item was the problem and
    the same-item check could not tell), the talker said the put-up line and logged move_on."""
    async def go():
        run, deps, _ = make([say(PUT_UP, tools=(("show_problem", {}), MOVE_ON_LOG))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run)             # a reply of its own: no candidate turn has landed on the problem
        return run

    run = asyncio.run(go())
    c = run.conductor
    assert (c.current().item_id, c.current().turns) == ("core-1", 0)
    assert not [i for i in c.items if i.ended_by == "declared move on"]


def test_a_declared_move_on_that_leaves_the_part_is_refused_on_a_problem_with_no_turns_but_still_moves_after_one():
    def run_it(turns):
        async def go():
            run, deps, _ = make([say("Well done on this one, let's move on.", tools=(MOVE_ON_LOG,))])
            await run.start(None)
            c = run.conductor
            while c.current().item_id != "core-1":
                c.current().turns = 3
                c.next_item("t")
            c.current().turns = turns
            c.current().coded = True
            deps.workspace.cards["core-1"] = {"sections": []}
            await speak(run)
            return run.conductor.current().item_id
        return asyncio.run(go())

    assert run_it(0) == "core-1"
    assert run_it(1) != "core-1"


def test_a_problem_that_has_just_gone_up_may_not_be_left_but_a_give_up_or_a_pending_move_on_may():
    async def go():
        run, deps, clock = make([])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        item = c.current()
        refused = c.may_leave_problem(item)
        c.gave_up_items.add(item.item_id)
        gave_up = c.may_leave_problem(item)
        c.gave_up_items.discard(item.item_id)
        item.coded = True                       # (a problem nobody coded is not left on a move_on alone: see the conductor test)
        c._order("move_on", "time", clock())
        ordered = c.may_leave_problem(item)
        return refused, gave_up, ordered

    refused, gave_up, ordered = asyncio.run(go())
    assert refused == (False, "the problem has just gone up: give them time to read it and start; do not move on")
    assert gave_up[0] and ordered[0]


OUTLINE_ASK = ("Here is how this round will run: we'll start with a short chat about you, then a couple of coding problems, "
               "and then time at the end for your questions. To start off, tell me a bit about yourself and what you're working on these days.")
OUTLINE_MENTION = ("Here is how this round will run: first I'll ask you to introduce yourself, then a couple of coding problems, "
                   "and then time at the end for your questions. Does that make sense?")


def test_an_outline_that_ends_by_asking_for_the_introduction_lands_on_the_introduction_and_framing_is_not_repeated():
    async def go():
        run, deps, _ = _chat_run([say(OUTLINE_ASK), say("Great, and what did you own there?")])
        await run.start(None)
        c = run.conductor
        c.go_to("small_talk", "t")
        c.current().turns = 3
        await speak(run, "sure")
        landed = c.current().item_id
        framing = next(i for i in c.items if i.item_id == "framing")
        c.go_to("framing", "again") if False else None
        # The same turn's framing details, were the plan still on the framing with the outline said:
        from app.interviewer.prompts import item_details
        view = run._view([], [])
        view["item"] = {**view["item"], "kind": "phase", "phase": "framing", "item_id": "framing", "next_phase": "candidate_intro"}
        return landed, framing.status, c.outline_said, item_details(run.d.blueprint, view["item"]), view["item"]["outline_said"]

    landed, status, said, details, flag = asyncio.run(go())
    assert (landed, status, said, flag) == ("candidate_intro", "done", True, True)
    assert "do not repeat it" in details and "how this round will run" not in details


P20_OUTLINE_INTRO = ("That works well. So, let me tell you how this round will run \u2014 it'll be a fairly full round, starting with a bit "
                     "about your background and your projects, then one or two coding problems where I'll be more interested in how you think than in "
                     "perfect syntax, and we'll finish with your questions for me. To start, give me a quick walkthrough of yourself \u2014 where you are "
                     "in your studies or work, and what you've been building lately.")


def test_a_next_item_that_lands_on_the_framing_while_the_words_gave_the_outline_and_asked_for_the_introduction_completes_the_move():
    async def go():
        run, deps, _ = _chat_run([say(P20_OUTLINE_INTRO, tools=(("next_item", {"reason": "small talk finished"}),))])
        await run.start(None)
        c = run.conductor
        c.go_to("small_talk", "t")
        c.current().turns = 3
        await speak(run, "yes, a quiet room")
        framing = next(i for i in c.items if i.item_id == "framing")
        return run, framing

    run, framing = asyncio.run(go())
    assert run.talker.last.tool_calls[0]["result"]["ok"] and run.talker.last.tool_calls[0]["result"]["now"] == "framing"
    assert run.conductor.current().item_id == "candidate_intro" and framing.status == "done" and run.conductor.outline_said


def test_a_moving_tool_that_landed_on_the_framing_is_not_pushed_on_by_words_that_only_ask_for_the_introduction():
    async def go():
        run, deps, _ = _chat_run([say("Let's start with you \u2014 tell me a bit about yourself.", tools=(("next_item", {"reason": "x"}),))])
        await run.start(None)
        c = run.conductor
        c.go_to("small_talk", "t")
        c.current().turns = 3
        await speak(run, "sure")
        return run

    assert asyncio.run(go()).conductor.current().item_id == "framing"


def test_an_outline_that_only_mentions_the_introduction_inside_it_stops_at_framing_and_a_one_sentence_outline_view_carries_the_flag():
    async def go():
        run, deps, _ = _chat_run([say(OUTLINE_MENTION)])
        await run.start(None)
        c = run.conductor
        c.go_to("small_talk", "t")
        c.current().turns = 3
        await speak(run, "sure")
        return c.current().item_id, run._view([], [])["item"]["outline_said"]

    assert asyncio.run(go()) == ("framing", True)


def test_a_successful_skip_goal_does_not_stop_a_declared_move_on_from_a_problem_that_had_turns():
    async def go():
        run, deps, _ = make([say("Well done on this one, let's move on.", tools=(("skip_goal", {"goal_id": "deep_dive", "why": "x"}), MOVE_ON_LOG))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        c.current().turns = 1
        c.current().coded = True
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run)
        return run

    from app.interviewer.run import MOVING_TOOLS
    assert "skip_goal" not in MOVING_TOOLS
    run = asyncio.run(go())
    assert run.conductor.current().item_id != "core-1"


def _said_goodbye_and_heard_one_back(run):
    run.transcript += [{"seq": 1, "speaker": "interviewer", "text": "Thanks for your time today. Take care."},
                       {"seq": 2, "speaker": "candidate", "text": "Thank you, goodbye!"},
                       {"seq": 3, "speaker": "interviewer", "text": "You too, take care."}]


def test_pressing_end_after_the_goodbye_exchange_says_nothing_more_and_ends_as_candidate_ended():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _said_goodbye_and_heard_one_back(run)
        await run.on_web_message(web({"type": "session.end_request"}))
        await asyncio.wait_for(run.finished.wait(), 1)
        return run, deps

    run, deps = asyncio.run(go())
    assert deps.api.ended[0][1] == "candidate_ended"
    assert run.speaker.said == [] and deps.talker_chat.calls == []
    assert not [o for o in run.conductor.orders if o.kind == "end" and o.speak]


def test_pressing_end_after_an_ordinary_question_still_says_the_fixed_goodbye():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        run.transcript.append({"seq": 1, "speaker": "interviewer", "text": "What is the time complexity of that?"})
        await run.on_web_message(web({"type": "session.end_request"}))
        out = await speak(run)
        await asyncio.wait_for(run.finished.wait(), 1)
        return out

    assert asyncio.run(go()) == ["Thank you for your time today, Asha. Take care, and goodbye."]


def test_a_goodbye_exchange_during_a_problem_closes_the_round_out():
    async def go():
        run, deps, _ = make([say("You too, take care.")])
        await run.start(None)
        _to(run, "core-1", turns=1)
        await speak(run, "Thanks so much, bye!")
        await asyncio.wait_for(run.finished.wait(), 1)
        return run, deps

    run, deps = asyncio.run(go())
    assert run.conductor.ended and deps.api.ended[0][1] == "completed"


def test_a_consumed_move_on_whose_gate_is_closed_does_not_force_the_move():
    async def go():
        run, deps, clock = make([say("Okay, thanks for that.")])
        await run.start(None)
        _to(run, "candidate_intro", turns=0)                     # greeting 3 + this one's exchange = 4 of 5
        run.conductor.move_on_order(run.conductor.current(), clock())
        await speak(run, "I mostly worked on the backend.")
        return run

    run = asyncio.run(go())
    assert run.conductor.current().item_id == "candidate_intro"


def test_a_forced_move_onto_a_problem_puts_the_problem_on_the_screen():
    async def go():
        run, deps, clock = make([say("Okay, thanks for that.")])
        await run.start(None)
        _to(run, "candidate_intro", turns=5)
        run.conductor.consume(run.conductor.pending_orders())
        run.conductor.move_on_order(run.conductor.current(), clock())
        await speak(run, "I mostly worked on the backend.")
        await asyncio.sleep(0.05)
        return run, deps

    run, deps = asyncio.run(go())
    assert run.conductor.current().item_id == "core-1"
    assert "core-1" in deps.workspace.cards


def test_a_declared_wrap_up_of_a_problem_nobody_wrote_code_for_does_not_move_the_plan_until_code_arrives():
    async def go():
        run, deps, _ = make([say("That wraps up the first problem.", tools=(MOVE_ON_LOG,)),
                             say("Well done on this one, let's move on.", tools=(MOVE_ON_LOG,))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 3
            c.next_item("t")
        c.current().turns = 2
        deps.workspace.cards["core-1"] = {"sections": []}
        await speak(run)
        stayed = c.current().item_id
        await run.on_web_message(web({"type": "code.snapshot", "version": 1, "language": "python", "text": "def f(nums):\n    return nums\n"}))
        assert c.current().coded
        await speak(run)
        return stayed, c.current().item_id

    stayed, after = asyncio.run(go())
    assert stayed == "core-1" and after != "core-1"


def test_an_ordinary_mid_round_exchange_that_only_resembles_goodbyes_does_not_close_the_round():
    async def go():
        run, deps, _ = make([say("Best of luck with the second one.")])
        await run.start(None)
        _to(run, "core-1", turns=1)
        await speak(run, "I'll take care of the null case first.")
        return run

    run = asyncio.run(go())
    assert not run.conductor.ended and not run.finishing


def test_pressing_end_after_a_closing_that_only_resembles_a_goodbye_still_gets_the_fixed_line():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        run.transcript.append({"seq": 1, "speaker": "interviewer", "text": "Let's close out the first problem and look at the second."})
        await run.on_web_message(web({"type": "session.end_request"}))
        return [o for o in run.conductor.orders if o.kind == "end"][0]

    assert asyncio.run(go()).speak is True


# ---- interviewer style: the verdict budget (S2)

def _said_turns(run, *lines):
    for line in lines:
        run.on_conversation_item("assistant", line, False)


def test_the_verdict_budget_starts_only_when_the_previous_turn_opened_with_a_verdict():
    run, *_ = make([])
    _said_turns(run, "Okay. And the cost?", "That's a solid approach. What about duplicates?")
    assert run._verdict_budget("It's linear.") is True
    _said_turns(run, "Okay. Then the space?")
    assert run._verdict_budget("It's linear.") is False               # one turn back is the window


def test_neutral_acknowledgements_do_not_start_the_verdict_budget():
    run, *_ = make([])
    for line in ("Got it. And the cost?", "Okay, that makes sense. And the space?", "Fair. What about duplicates?", "Mm, okay. And negatives?"):
        _said_turns(run, line)
        assert run._verdict_budget("It's linear.") is False, line


def test_the_verdict_budget_never_applies_to_a_question_an_assumption_or_a_reported_trace():
    run, *_ = make([])
    _said_turns(run, "That's correct. Now the cost?")
    assert run._verdict_budget("It's linear.") is True
    for text in ("It's linear. Is that right?", "Can I use Python?", "Can the input be empty? And what is the range?", "So the array is sorted?",
                 "I assume the input is valid.", "I'll assume it is sorted, then.", "Assuming no duplicates, I scan once."):
        assert run._verdict_budget(text) is False, text
    _said_turns(run, "Good. Run it through your code with the input 5, negative 6, 7.")
    assert run._verdict_budget("At 5 I push, at negative 6 I pop it, so the stack ends as negative 6.") is False


def test_a_spent_budget_reaches_the_talkers_state_and_blocks_a_second_verdict():
    async def go():
        run, deps, _ = make([say("That's correct.", "What about duplicates?")])
        await run.start(None)
        _go_to(run, "core-1")
        _said_turns(run, "Good, that's the approach. How would you start?")
        pieces = await speak(run, "I would sort first.")
        return pieces, run.talker.last.blocked

    pieces, blocked = asyncio.run(go())
    assert pieces == ["What about duplicates?"] and [b["rule"] for b in blocked] == ["verdict_budget"]


# ---- interviewer style: coding etiquette (S4)

CODING = "Sure, writing the two-pointer version now."


def _on_problem(run, deps):
    _go_to(run, "core-1")
    deps.workspace.cards["core-1"] = {"sections": []}
    run.conductor.consume(run.conductor.pending_orders())


def test_a_candidate_starting_to_code_with_the_problem_on_screen_gets_silence():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _on_problem(run, deps)
        run.on_conversation_item("assistant", "Go ahead and code it.", False)
        run.on_user_text(CODING)
        return run.skip_reply(CODING), run.speaker.backchannels

    skipped, nods = asyncio.run(go())
    assert skipped is True and nods == []


def test_starting_to_code_is_answered_when_no_problem_is_on_screen_or_an_order_is_waiting():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _go_to(run, "candidate_intro")
        run.on_user_text(CODING)
        elsewhere = run.skip_reply(CODING)
        _on_problem(run, deps)
        run.conductor.on_proctor("tab_hidden", 1, 1)                      # the interviewer has something to say about the tab
        run.on_user_text(CODING)
        return elsewhere, run.skip_reply(CODING)

    assert asyncio.run(go()) == (False, False)


def test_when_everything_said_after_the_candidate_starts_coding_is_held_back_no_filler_is_spoken():
    async def go():
        held = "Go ahead and write it, I'll look at it when you're done."
        run, deps, clock = make([say(held), say(held), say(held), say(held), say(held), say(held)])
        await run.start(None)
        _on_problem(run, deps)
        run.talker.said.add("Go ahead and write the code when you are ready.", "earlier")
        run.on_user_text(CODING)
        first = [p async for p in run.reply(CODING)]
        later = [p async for p in run.reply(None)]                          # a proactive turn right after they started (nothing was said between)
        clock.advance(61)
        much_later = [p async for p in run.reply(None)]                     # a minute on the filler is allowed again
        return first, later, much_later

    first, later, much_later = asyncio.run(go())
    assert first == [] and later == [] and len(much_later) == 1 and matches("neutral", much_later[0])


def test_the_start_coding_quiet_is_set_when_their_words_arrive_and_ends_when_the_interviewer_speaks():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _on_problem(run, deps)
        run.on_user_text(CODING)
        armed = run._started_coding_at is not None
        run.on_conversation_item("assistant", "Sure.", False)
        return armed, run._started_coding_at

    assert asyncio.run(go()) == (True, None)


def test_a_first_sentence_that_gives_their_answer_back_is_dropped_when_the_reply_has_more():
    async def go():
        run, deps, _ = make([say("So you split the work between three people, each owning one remote, and you kept the shared contracts.",
                                 "Did the split hold up?")])
        await run.start(None)
        _go_to(run, "core-1")
        said = ("Mostly splitting the work so three of us didn't block each other. Each person owned one remote end to end, "
                "and I owned the host shell and the shared contracts between them.")
        pieces = await speak(run, said)
        return pieces, run.talker.last.blocked

    pieces, blocked = asyncio.run(go())
    assert pieces == ["Did the split hold up?"] and [b["rule"] for b in blocked] == ["echo"]


def test_a_request_for_help_while_saying_they_are_coding_still_gets_a_reply():
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _on_problem(run, deps)
        run.on_conversation_item("assistant", "Go ahead and code it.", False)
        out = []
        for text in ("I'm coding this but I'm stuck, give me a hint", "I'm writing it but I don't understand the second example",
                     "Okay I'm writing the loop now, can I use a set", "I am writing the brute force first then I will optimize"):
            run.on_user_text(text)
            out.append(run.skip_reply(text))
        return out

    assert asyncio.run(go()) == [False, False, False, False]


def test_okay_new_problem_after_the_second_problem_goes_up_does_not_swap_it_for_a_reserve():
    """b1 struggler_gives_up: the acknowledgement was read as a third ask for another problem; the second problem was swapped for a
    reserve that was never shown."""
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("I'd like you to stay with this one. Even a partial solution is fine."),
            say("Sure, tell me your first idea.")])
        run.conductor.current().turns = 6
        clock.advance(600)
        await speak(run, "Can you change the problem?")
        await speak(run, "Can you skip this question?")
        await speak(run, "Okay, new problem. So I need all triplets that add up to zero, and my first idea is three nested loops.")
        return run

    run = asyncio.run(go())
    c = run.conductor
    assert c.current().item_id == "core-2" and c.change_requests == {"core-1": 2}
    assert next(i for i in c.items if i.item_id == "core-2").status == "active"


def test_a_reserve_in_place_of_the_problem_is_put_up_by_the_run_with_the_fixed_line_when_no_planned_problem_is_left():
    async def go():
        run, deps, clock = await _round_with_two_problems([say("I'd like you to stay with this one. Even a partial solution is fine.")])
        c = run.conductor
        next(i for i in c.items if i.item_id == "core-2").status = "skipped"      # no planned problem is left
        c.current().coded = False                                  # (a candidate who coded and is going well may be given an extra problem instead)
        c.label_for("core-1")                                      # (its put-up gave it its label, as in a real round)
        c.current().turns = 3
        clock.advance(20)
        await speak(run, "Can you give me a different problem?")
        out = await speak(run, "I asked for a different problem, actually.")
        return run, deps, out

    run, deps, out = asyncio.run(go())
    assert run.conductor.current().item_id == "reserve-alternate" and run.conductor.change_given
    assert len(out) == 1 and matches("swap_put_up", out[0])
    assert "reserve-1" in [m["item_id"] for m in deps.workspace.of("panel.show_problem")]    # the wire id
    shown = [(m["item_id"], m["label"]) for m in deps.workspace.of("panel.show_problem")]
    assert shown == [("core-1", "Problem 1 (replaced)"), ("reserve-1", "Problem 1")]       # the old tab is re-sent as replaced, then the new one


def test_the_retry_after_a_non_english_turn_says_to_speak_english_only():
    async def go():
        run, deps, _ = make([say("好的，这样单次查询就能得出结果。"), say("Tell me about the query you wrote.")])
        await run.start(None)
        out = await speak(run, "I built a dashboard")
        return out, deps

    out, deps = asyncio.run(go())
    assert out == ["Tell me about the query you wrote."]
    assert "Speak English only." in str(deps.talker_chat.calls[1][-1]["content"])


def test_on_a_problem_the_lead_in_to_the_projects_never_reaches_the_talker_and_closing_the_coding_is_blocked():
    """b2 quiet_thinker seq 26 and 50: on problem 2 the talker said the deep dive's lead-in and the problem was never discussed."""
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("That wraps up the coding part. Now a couple of questions about your projects, then some quick fundamentals."),
            say("Tell me how you would start on this one.")])
        c = run.conductor
        c.next_item("t")                                           # core-2, put up and nothing said on it yet
        deps.workspace.cards["core-2"] = {"sections": []}
        out = await speak(run, "Okay, I see the problem.")
        return run, deps, out

    run, deps, out = asyncio.run(go())
    assert "wraps up the coding part" not in str(state_of(deps.talker_chat.calls[0]))
    assert out == ["Tell me how you would start on this one."]
    assert run.conductor.current().item_id == "core-2"


def test_the_retry_after_reasoning_spoken_aloud_asks_for_what_would_be_said_to_the_candidate():
    async def go():
        run, deps, _ = make([say("His areas after the first move are wrong. Let me check: l=0,r=8: min=1, width=8, area=8."),
                             say("Walk me through what your loop does after the first move.")])
        await run.start(None)
        out = await speak(run, "I moved the left pointer once")
        return out, deps

    out, deps = asyncio.run(go())
    assert out == ["Walk me through what your loop does after the first move."]
    assert "Say only what you would say aloud to the candidate, in the second person; never your reasoning." in str(deps.talker_chat.calls[1][-1]["content"])


def test_a_turn_that_puts_the_next_problem_up_in_words_shows_it_in_that_turn_and_nothing_says_the_line_again():
    """b5 unplanned_story seq 23-24: the talker moved on and said "Let me put the second one on your screen. Here's your second
    question." but showed nothing, so the open_item order had the next turn say the put-up line a second time."""
    async def go():
        nxt = (("next_item", {"reason": "done"}),)
        words = ("Spot on. That wraps up the first problem.", "Let me put the second one on your screen.",
                 "Here's your second question. Give it a read, and let me know if you have any questions.")
        run, deps, _ = make([say(*words, tools=nxt)])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        c.current().coded = True
        out = await speak(run, "that's my answer")
        shown = "core-2" in deps.workspace.cards                             # before any later turn
        await run.tick()
        return run, deps, out, shown

    run, deps, out, shown = asyncio.run(go())
    assert run.conductor.current().item_id == "core-2" and shown
    assert not [o for o in run.conductor.pending_orders() if o.kind == "open_item"]
    assert sum("second question" in x for x in out) == 1 and run.speaker.replies == 0


def test_a_put_up_line_said_in_a_turn_with_no_tools_is_not_said_again_when_the_plan_moves_on_afterwards():
    """b6b unplanned_story seq 25-26: the talker said "That wraps up this one. ... let me put the second problem on your screen. Here's your
    second question. Give it a read" with no tool calls; the plan moved to core-2 only afterwards (the declared move on), and the open_item
    order then made the next turn say the same lines again. The run shows the problem and spends the order."""
    async def go():
        words = ("That wraps up this one.", "Alright, let's get into the coding now, let me put the second problem on your screen.",
                 "Here's your second question. Give it a read, and let me know if you have any questions.")
        run, deps, _ = make([say(*words, tools=(MOVE_ON_LOG,))])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-1":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-1"] = {"sections": []}
        c.current().coded = True
        out = await speak(run, "that's my answer")
        await run.tick()
        return run, deps, out

    run, deps, out = asyncio.run(go())
    assert run.conductor.current().item_id == "core-2" and "core-2" in deps.workspace.cards
    assert not [o for o in run.conductor.pending_orders() if o.kind == "open_item"]
    assert sum("second question" in x for x in out) == 1 and run.speaker.replies == 0


def test_a_turn_that_declares_the_coding_part_done_after_the_last_problem_moves_the_plan_to_the_projects():
    """b6b drifter seq 35-37: both problems were finished and the code was in the editor; the talker said "That's the coding part done ...
    Now let me ask about your projects" (decision: continue, no tools) and the plan stayed on core-2 for two more turns, because only a
    resume-probe match moved it."""
    async def go():
        run, deps, _ = make([say("Good. That's the coding part done, both problems wrapped up cleanly.",
                                 "Now let me ask about your projects. Walk me through the one you are proudest of.")])
        await run.start(None)
        c = run.conductor
        from app.interviewer.conductor import Item
        c.items.insert(next(n for n, i in enumerate(c.items) if i.phase == "candidate_questions"), Item("deep_dive", "phase", "deep_dive", 300))
        _to(run, "core-2", turns=4)
        deps.workspace.cards["core-2"] = {"sections": []}
        await run.on_web_message(web({"type": "code.snapshot", "version": 1, "language": "python", "text": "def f(nums):\n    return nums\n"}))
        assert c.current().coded
        await speak(run, "that's my answer")
        return c

    c = asyncio.run(go())
    assert c.current().phase == "deep_dive"


def test_a_yes_no_question_about_a_property_is_answered_in_words_while_the_constraints_go_on_screen_but_limits_are_never_said():
    """b6a unplanned_story seq 12-13: "are the candidates guaranteed to be positive, and can the target be zero?" got only "Let me pull up
    the constraints". The property is answered aloud; numeric limits still go on the screen only."""
    ask = "Before I start, what are the constraints? Are the numbers guaranteed to be positive, and can the target be zero?"

    async def go(words):
        run, deps, _ = make([say(*words, tools=(("reveal", {"kind": "constraints"}),))])
        await run.start(None)
        _to(run, "core-1", turns=2)
        deps.workspace.cards["core-1"] = {"sections": []}
        run.conductor.consume(run.conductor.pending_orders())
        return await speak(run, ask)

    out = asyncio.run(go(("Yes, all positive, and zero can't appear.", "Let me pull those up for you.")))
    assert out[:2] == ["Yes, all positive, and zero can't appear.", "Let me pull those up for you."]
    out = asyncio.run(go(("Yes, all positive, and the size goes up to 100000.", "Let me pull those up for you.")))
    assert "100000" not in " ".join(out) and "Let me pull those up for you." in out


def test_a_violation_raised_on_a_proactive_turn_is_said_in_fixed_words_and_nothing_else_is_added():
    """bae894ce turns 25-26: each tab or full-screen mention was padded with a re-ask of the approach question, three interviewer turns
    in a row over a candidate who was drawing."""
    from app.interviewer.conductor import VIOLATION_LINES

    async def go():
        run, deps, clock = await _in_intro([say("Quick thing. Now, back to it: what is your plan for finding the best trades?")])
        order = run.conductor.on_proctor("tab_hidden", 1, clock())
        out = await speak(run)
        return run, deps, order, out

    run, deps, order, out = asyncio.run(go())
    assert len(out) == 1 and matches("violation:tab_hidden", out[0]) and order.consumed
    assert deps.talker_chat.calls == []                              # no model call: nothing could be added to the mention
    assert run.history[-1]["content"] == out[0]
    assert next(t for t in reversed(deps.store.turns) if t["speaker"] == "interviewer")["text"] == out[0]


def test_a_violation_mention_does_not_take_back_the_question_the_candidate_still_owes_an_answer_to():
    async def go():
        run, _, _ = make([])
        await run.start(None)
        run.conductor.set_agent_speaking(True)
        run.conductor.set_agent_speaking(False)
        run.on_conversation_item("assistant", "How would you approach this problem?", False)
        run.on_conversation_item("assistant", "I noticed you switched to another tab. Please stay on this screen for the rest of the round.", False)
        return run._waiting_for_their_answer()

    assert asyncio.run(go()) is True


def test_the_ticker_starts_no_second_reply_while_one_is_being_generated():
    """bae894ce turns 11-12: the reply's own go_to made an urgent open_item order, the voice was not speaking yet, and the ticker started a
    second reply beside the first. They shared the talker's per-turn state and the candidate heard the outline twice."""
    async def go():
        run, deps, clock = make([say("Hello there. How are you doing today?")])
        await run.start(None)
        replies = run.speaker.replies
        gen = run.reply(None)
        await gen.__anext__()
        during = run._can_speak()
        run._speak_soon(force=True)
        held_back = run.speaker.replies == replies
        async for _ in gen:
            pass
        run._speak_soon(force=True)
        return during, held_back, run.speaker.replies == replies + 1

    assert asyncio.run(go()) == (False, True, True)


def test_a_reply_that_is_abandoned_still_frees_the_ticker():
    async def go():
        run, _, _ = make([say("Hello there. How are you doing today?")])
        await run.start(None)
        gen = run.reply(None)
        await gen.__anext__()
        await gen.aclose()                                           # the candidate spoke over it: the voice closed the stream
        return run._can_speak()

    assert asyncio.run(go()) is True


def test_what_the_interviewer_has_put_on_screen_reaches_the_director_and_keeps_the_limits_off_the_air():
    """bae894ce: the constraints were revealed at turn 18, the director never learned it and briefed "give them now" seven times."""
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _on_problem(run, deps)
        item = run.conductor.current()
        before = (run._limits_revealed(item), json.loads((await run._director_messages())[1]["content"][0]["text"])["on_screen"])
        await run.tools.execute(ToolCall(id="r1", name="reveal", arguments={"kind": "constraints"}), "1")
        after = (run._limits_revealed(item), json.loads((await run._director_messages())[1]["content"][0]["text"])["on_screen"])
        return before, after

    from app.interviewer.llm import ToolCall
    before, after = asyncio.run(go())
    assert before == (False, {"problem-1": {"constraints_shown": False, "input_output_format_shown": False}})
    assert after == (True, {"problem-1": {"constraints_shown": True, "input_output_format_shown": False}})


def test_a_reveal_the_candidate_asked_for_is_already_on_its_way_in_the_directors_snapshot():
    """c8ccd40d turn 8: the director's snapshot was taken as the reply that puts the constraints up began, and it briefed "constraints are NOT on
    their screen, so stating them is fine" 2.5 s before they were. The pending reveal order tells it they are being put there."""
    async def go():
        run, deps, _ = make([])
        await run.start(None)
        _on_problem(run, deps)
        run.conductor.on_reveal_request("constraints")
        return json.loads((await run._director_messages())[1]["content"][0]["text"])["on_screen"]

    assert asyncio.run(go()) == {"problem-1": {"constraints_shown": True, "input_output_format_shown": False}}


def test_the_directors_rules_never_invite_reading_the_limits_aloud_and_know_about_the_warnings():
    from app.interviewer.prompts import DIRECTOR_RULES

    assert "never write that stating them is fine" in DIRECTOR_RULES and "never spoken, whatever on_screen says" in DIRECTOR_RULES
    assert "never brief the interviewer to repeat, soften, explain or comment on a warning" in DIRECTOR_RULES.replace("Never brief", "never brief")


def test_turn_timings_are_whole_milliseconds_and_odd_or_missing_values_are_left_out():
    from app.interviewer.run import turn_timings

    metrics = {"end_of_turn_delay": 1.02, "transcription_delay": 0.31, "llm_node_ttft": 1.4, "tts_node_ttfb": 0.5, "e2e_latency": 3.8,
               "on_user_turn_completed_delay": 0.004}
    assert turn_timings(metrics) == {"endpointing_ms": 1020, "stt_final_ms": 310, "llm_ttft_ms": 1400, "tts_ttfb_ms": 500, "e2e_ms": 3800}
    assert turn_timings({"e2e_latency": "bad", "tts_node_ttfb": None, "llm_node_ttft": -1.0, "transcription_delay": True}) == {}
    assert turn_timings({"tts_node_ttfb": 0.4}) == {"tts_ttfb_ms": 400}                  # the greeting answers nobody: no endpointing
    assert turn_timings(None) == {} and turn_timings({}) == {}
    assert turn_timings({"eot_probability": 0.12345, "eot_threshold": 0.36}) == {"eot_probability": 0.123, "eot_threshold": 0.36}
    assert turn_timings({"eot_probability": 1.7, "eot_threshold": True}) == {}             # a score is 0-1, never a bool


def test_the_replys_pipeline_timings_are_stored_on_the_interviewer_turn():
    async def go():
        run, deps, _ = make([say("Hi, I'm Siddharth.", tools=(("log_turn", {"condition": "none", "action": "greet", "reason": "opening"}),)),
                             say("Nice to meet you.")])
        await run.start(None)
        pieces = [p async for p in run.reply(None)]
        run.on_conversation_item("assistant", " ".join(pieces), False, {"tts_node_ttfb": 0.4, "e2e_latency": 1.2})
        for _ in range(5):
            await asyncio.sleep(0)
        run.on_user_text("Hello!")
        pieces = [p async for p in run.reply("Hello!")]
        run.on_conversation_item("assistant", " ".join(pieces), False, {"end_of_turn_delay": 1.02, "transcription_delay": 0.31,
                                                                        "llm_node_ttft": 1.4, "tts_node_ttfb": 0.5, "e2e_latency": 3.8})
        for _ in range(5):
            await asyncio.sleep(0)
        run.on_conversation_item("assistant", "Never reported by the voice.", False, {"e2e_latency": 9.0})   # no pending turn: nothing to store
        for _ in range(5):
            await asyncio.sleep(0)
        return [t for t in deps.store.turns if t["speaker"] == "interviewer"]

    first, second = asyncio.run(go())
    assert first["tts_ttfb_ms"] == 400 and first["e2e_ms"] == 1200 and "endpointing_ms" not in first
    assert second["endpointing_ms"] == 1020 and second["stt_final_ms"] == 310 and second["llm_ttft_ms"] == 1400
    assert second["tts_ttfb_ms"] == 500 and second["e2e_ms"] == 3800


def test_consecutive_talker_requests_share_their_start_so_the_providers_cache_grows_with_the_conversation():
    """(decided 2026-10-18) The request is [prefix, *history, state, note]: the prefix is the run's own saved one, byte for byte, and the
    earlier request up to its state is the start of the next one; only the state and the new history messages change."""
    async def go():
        run, deps, _ = make([say("Hi, I'm Siddharth."), say("Good to meet you."), say("Tell me about your last project.")])
        await run.start(None)
        await speak(run)
        await speak(run, "Hello, nice to meet you.")
        await speak(run, "Thanks, I'm doing well.")
        return run, deps.talker_chat.calls

    run, calls = asyncio.run(go())
    assert len(calls) == 3
    assert all(c[0] == {"role": "system", "content": run.prefix} for c in calls)
    for earlier, later in zip(calls, calls[1:]):
        until_state = earlier[:-2]                                    # the prefix and the history; the state and the note follow
        assert later[:len(until_state)] == until_state
        assert len(later) > len(earlier) and "## Current item" in earlier[-2]["content"] and "## Current item" in later[-2]["content"]
    assert not any("## Current item" in m["content"] for m in calls[2][:-2])     # no state in the prefix or the history


# ---------------------------------------------------------------- warnings said alone, remembered, and the return clock (decided 2026-10-18)

def _tab_event(n=1):
    return web({"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": n,
                "counts": {"tab_changes": n, "screen_changes": 0, "full_violations": n}})


def test_a_final_warning_on_the_interviewers_own_turn_is_its_fixed_line_alone_and_the_earlier_mention_is_superseded():
    from app.interviewer.conductor import FINAL_WARNING_LINES

    async def go():
        run, deps, _ = make([say("Where would you begin?")])
        await run.start(None)
        c = run.conductor
        c.on_proctor("tab_hidden", 1, 1)
        c.on_proctor("window_blur", 1, 2)
        out = await speak(run)
        return run, deps, out

    run, deps, out = asyncio.run(go())
    c = run.conductor
    assert len(out) == 1 and matches("final_warning:window_blur", out[0]) and deps.talker_chat.calls == []
    assert [(w["kind"], w["about"]) for w in c.warnings_given] == [("final_warning", "window_blur")]
    assert not [o for o in c.pending_orders() if o.kind in ("mention_violation", "final_warning")]


def test_on_a_turn_answering_the_candidate_the_warning_comes_first_and_the_reply_is_told_not_to_repeat_it():
    from app.interviewer.conductor import VIOLATION_LINES
    from app.interviewer.run import WARNED_SAID

    async def go():
        run, deps, _ = make([say("Sure, I can help with that."), say("Okay, thanks for that."), say("Okay, thanks for that.")])
        await run.start(None)
        run.conductor.on_proctor("tab_hidden", 1, 1)
        out = await speak(run, "Can you tell me how long this round is?")
        later = await speak(run, "Okay, I will stay here. Where were we?")
        return run, deps, out, later

    run, deps, out, later = asyncio.run(go())
    assert matches("violation:tab_hidden", out[0]) and "Sure, I can help with that." in out
    first, second = state_of(deps.talker_chat.calls[0]), state_of(deps.talker_chat.calls[-1])
    assert "[mention_violation]" not in first and "A warning was just said in this very turn" in first
    assert any(m["content"] == WARNED_SAID for m in deps.talker_chat.calls[0])
    assert "Warnings given so far: 1 about leaving the interview screen (tab_hidden); no final warning yet" in second
    assert later


def test_the_turn_after_a_warning_is_told_to_pick_up_from_it_never_to_ignore_it():
    async def go():
        run, deps, _ = make([say("Okay. Let's carry on from there.")])
        await run.start(None)
        run.conductor.on_proctor("tab_hidden", 1, 1)
        await speak(run)                                  # the warning, alone
        return await speak(run, "Sorry about that, I will stay here. What should I do now?"), deps

    out, deps = asyncio.run(go())
    state = state_of(deps.talker_chat.calls[0])
    assert "Your previous turn was a warning: pick up from it" in state and out


def test_a_candidate_turn_that_needs_no_answer_gets_the_warning_alone():
    from app.interviewer.conductor import VIOLATION_LINES

    async def go():
        run, deps, _ = make([say("Thanks.")])
        await run.start(None)
        run.conductor.on_proctor("tab_hidden", 1, 1)
        return await speak(run, "Okay."), deps

    out, deps = asyncio.run(go())
    assert len(out) == 1 and matches("violation:tab_hidden", out[0]) and deps.talker_chat.calls == []


def test_a_conduct_warning_is_said_in_fixed_words_first_and_the_talker_is_not_ordered_to_say_it_too():
    from app.interviewer.conductor import CONDUCT_WARNING_LINE

    async def go():
        run, deps, _ = make([say("Let's carry on with the problem.")])
        await run.start(None)
        text = "Okay, what should I do next, any idea where to begin?"
        run.on_user_text(text)
        run.conductor.on_conduct("inappropriate", "That is a stupid question", "t1", "model")
        pieces = [p async for p in run.reply(text)]
        return run, deps, pieces

    run, deps, pieces = asyncio.run(go())
    assert matches("conduct_warning", pieces[0]) and "[conduct_warning]" not in state_of(deps.talker_chat.calls[0])
    assert not [o for o in run.conductor.pending_orders() if o.kind == "conduct_warning"]


def test_a_warning_the_voice_never_played_is_forgotten_and_said_again():
    from app.interviewer.conductor import VIOLATION_LINES

    async def go():
        run, deps, clock = make([])
        await run.start(None)
        run.conductor.on_proctor("tab_hidden", 1, 1)
        pieces = [p async for p in run.reply(None)]       # said, but never confirmed by the voice
        assert run.conductor.warnings_given
        clock.advance(10)
        await run.tick()
        return run, pieces

    run, pieces = asyncio.run(go())
    assert len(pieces) == 1 and matches("violation:tab_hidden", pieces[0]) and run.conductor.warnings_given == []
    assert [o.kind for o in run.conductor.pending_orders() if o.kind == "mention_violation"] == ["mention_violation"]


def _away_run():
    async def build():
        run, deps, clock = make([])
        await run.start(None)
        await run.on_web_message(web({"type": "proctor.away", "kinds": ["tab_hidden"], "at": 1}))
        await run.on_web_message(_tab_event())
        pieces = [p async for p in run.reply(None)]       # the mention that tells them to come back
        run.on_conversation_item("assistant", " ".join(pieces), False)      # the voice confirms the words (not that it finished)
        return run, deps, clock, pieces
    return build()


def test_not_back_four_seconds_after_the_warning_finished_playing_is_one_more_violation_said_as_the_final_warning():
    from app.interviewer.conductor import AWAY_OVERSTAY_LINES

    async def go():
        run, deps, clock, pieces = await _away_run()
        run.on_agent_state("speaking")
        clock.advance(2)
        run.on_agent_state("listening")                    # the warning has finished: the 4 s count from here
        clock.advance(3.9)
        await run.tick()
        early = [o.kind for o in run.conductor.pending_orders() if o.kind in ("final_warning", "mention_violation")]
        clock.advance(0.2)
        await run.tick()
        return run, early, [p async for p in run.reply(None)]

    run, early, said = asyncio.run(go())
    assert early == []
    assert len(said) == 1 and matches("away_overstay:final_warning", said[0]) and run.conductor.full_violations == 2
    assert run.conductor.proctor[-1]["kind"] == "away_overstay"


def test_back_within_four_seconds_costs_nothing_and_the_overstay_comes_once_per_episode():
    async def go():
        run, deps, clock, _ = await _away_run()
        run.on_agent_state("speaking")
        run.on_agent_state("listening")
        clock.advance(3)
        await run.on_web_message(web({"type": "proctor.back", "at": 2}))
        clock.advance(30)
        await run.tick()
        back_in_time = run.conductor.full_violations
        await run.on_web_message(web({"type": "proctor.away", "kinds": ["tab_hidden"], "at": 3}))
        run.conductor.away["told_at"] = clock()
        clock.advance(5)
        await run.tick()
        clock.advance(5)
        await run.tick()
        return run, back_in_time

    run, back_in_time = asyncio.run(go())
    assert back_in_time == 1                                # only the tab switch itself
    assert run.conductor.full_violations == 2 and [e["kind"] for e in run.conductor.proctor].count("away_overstay") == 1


def test_when_the_voice_never_says_the_warning_finished_the_clock_starts_from_its_expected_length():
    async def go():
        run, deps, clock, pieces = await _away_run()
        clock.advance(9.5)                                  # 18 words take ~7.2 s, plus the grace for the voice to report
        await run.tick()
        started = run.conductor.away["told_at"]
        before = run.conductor.full_violations
        clock.advance(2)
        await run.tick()
        return run, started, before

    run, started, before = asyncio.run(go())
    assert started is not None and before == 1 and run.conductor.full_violations == 2


def test_still_away_at_the_cap_ends_the_interview_with_the_fixed_line_and_a_dropped_connection_is_not_an_episode():
    from app.interviewer.conductor import PROCTOR_END_LINE

    async def go():
        run, deps, clock = make([])
        await run.start(None)
        await run.on_web_message(web({"type": "proctor.away", "kinds": ["fullscreen_exit"], "at": 1}))
        clock.advance(60)
        await run.tick()
        run2, _, _ = make([])
        await run2.start(None)
        await run2.on_web_message(web({"type": "proctor.away", "kinds": ["tab_hidden"], "at": 1}))
        run2.on_candidate_left()
        gone = run2.conductor.away
        run2.on_candidate_back()
        return run, gone

    run, gone = asyncio.run(go())
    assert run.conductor.ended and matches("proctor_end", run.conductor.end_order.line)
    assert gone is None


def test_a_change_request_cut_off_at_to_by_speech_to_text_reaches_the_conductor_as_an_order():
    """Live round 2a2cb5c2 turns 19-20: no order was made and the talker improvised the change itself."""
    async def go():
        run, deps, clock = await _round_with_two_problems([
            say("I'd like you to stay with this one. Even a partial solution is fine."),
            say("Let's leave this one there too. Let me shift gears, and we'll talk about your projects instead.", tools=(("go_to", {"goal_id": "deep_dive", "why": "x"}),)),
            say("Take your time.")])
        c = run.conductor
        c.current().coded = False
        c.current().turns = 2
        clock.advance(20)
        await speak(run, "Can we change it to")
        return run, deps

    run, deps = asyncio.run(go())
    assert run.conductor.change_requests == {"core-1": 1}
    assert "[keep_problem]" in state_of(deps.talker_chat.calls[0])


def test_the_state_of_a_problem_already_on_screen_never_tells_the_talker_how_to_put_it_up():
    """Live round 2a2cb5c2 turn 23: the problem was up for minutes and the talker said "Let me put the second problem on your screen" because this
    block still told it how."""
    from app.interviewer.prompts import item_details

    async def go():
        run, deps, _ = await _round_with_two_problems([])
        view = run._view([], [])
        return item_details(run.d.blueprint, view["item"]), view["item"]["shown"]

    text, shown = asyncio.run(go())
    assert shown is True and "ALREADY on their screen" in text and "call show_problem, then say only this" not in text


def test_are_you_there_is_answered_with_presence_and_never_a_put_up_line():
    from app.interviewer.run import HERE_SAID

    assert "Never put a problem up" in HERE_SAID and "ask it again briefly" in HERE_SAID


def test_opening_the_candidates_questions_with_thanks_for_their_time_does_not_end_the_round():
    """bf82d318 turn 37: the talker thanked them for their time and invited their questions in one turn, and the run closed the round."""
    async def go():
        run, deps, _ = make([say("Thanks for your time today, take care."), say("Thank you for your time today. What questions do you have for me?")])
        await run.start(None)
        _to(run, "candidate_questions", turns=0)
        first = await speak(run)
        ended_after_first = run.conductor.ended or run.finishing
        return run, deps, first, ended_after_first

    run, deps, first, ended = asyncio.run(go())
    assert not ended and not run.conductor.ended and not deps.api.ended
    assert any(b["rule"] == "leave_taking_early" for b in run.talker.last.blocked)


def test_a_farewell_after_the_candidate_has_had_a_turn_in_their_questions_still_ends_the_round():
    async def go():
        run, deps, _ = make([say("Thanks for your time today, Deepanshu. Take care.")])
        await run.start(None)
        _to(run, "candidate_questions", turns=1)
        await speak(run, "No, that's everything.")
        await asyncio.wait_for(run.finished.wait(), 1)
        return deps

    assert asyncio.run(go()).api.ended[0][1] == "completed"


def test_the_connection_trouble_window_opens_when_the_candidate_leaves_or_returns():
    run, deps, clock = make([])
    assert not run._connection_trouble()
    run.connection_event_at = clock()
    assert run._connection_trouble()
    clock.advance(121)
    assert not run._connection_trouble()


# ---------------------------------------------------------------- the outline's promises (decided 2026-10-18)

def _realism_run(turns):
    from tests.interviewer.fixtures import realism_blueprint

    deps = RunDeps(blueprint=realism_blueprint(), context=context(), talker_chat=FakeChat(turns), director_chat=FakeChat(briefs=[]),
                   workspace=FakeWorkspace(), api=FakeApi(), store=MemoryStore(), clock=Clock(), first_token_timeout_s=0.2)
    run = InterviewRun(deps)
    run.speaker = FakeSpeaker()
    return run, deps


def test_an_interviewer_turn_that_asks_about_a_promised_area_marks_it_covered_after_the_turn():
    async def go():
        run, deps = _realism_run([say("On databases now: what is the difference between WHERE and HAVING in SQL?")])
        await run.start(None)
        while run.conductor.current().item_id != "deep_dive":
            run.conductor.next_item("done")
        await speak(run)
        return run

    run = asyncio.run(go())
    assert run.conductor.promises["fundamentals:databases"] == "covered"
    assert run.conductor.uncovered() == ["projects:Relay", "fundamentals:Java"]
    view = run._view([], [])
    assert view["promises"] == {"open": ["the questions about your Relay project", "the Java questions"], "covered": ["the databases questions"]}
    assert "Promised to the candidate and not yet counted as asked" in state_block_for(view) and "never ask again: the databases questions" in state_block_for(view)


def test_a_turn_that_takes_the_order_to_ask_about_a_promise_and_asks_covers_it_whatever_its_words():
    async def go():
        run, deps = _realism_run([say("Walk me through how an interface differs from an abstract class.")])
        await run.start(None)
        while run.conductor.current().item_id != "deep_dive":
            run.conductor.next_item("done")
        c = run.conductor
        c.promises["projects:Relay"] = c.promises["fundamentals:databases"] = "covered"
        c.current().turns = 3
        deps.clock.advance(c.current().max_seconds + 5)
        ordered = [o for o in c.tick() if o.ask_for]
        assert [o.ask_for for o in ordered] == ["fundamentals:Java"]
        await speak(run)
        return run, ordered

    run, ordered = asyncio.run(go())
    assert ordered[0].consumed and run.conductor.promises["fundamentals:Java"] == "covered" and run.conductor.uncovered() == []


def state_block_for(view):
    from app.interviewer.prompts import state_block
    return state_block(view)


def test_the_guard_is_told_what_the_outline_must_name_only_while_it_is_still_to_be_said():
    async def go():
        run, deps = _realism_run([])
        await run.start(None)
        framing = next(i for i in run.conductor.items if i.item_id == "framing")
        expect = run._outline_expect(framing)
        run.conductor.outline_said = True
        return expect, run._outline_expect(framing), run._outline_expect(next(i for i in run.conductor.items if i.item_id == "deep_dive"))

    expect, after, later = asyncio.run(go())
    assert expect == (["Java", "databases"], ["Relay"]) and after is None and later is None
    run, _, _ = make([])
    assert run._outline_expect(run.conductor.current()) is None            # a blueprint without a realism block is never checked


def test_a_turn_never_played_or_cut_off_before_it_asked_gives_its_promise_back():
    async def go(cut):
        run, deps = _realism_run([say("On databases now: what is the difference between WHERE and HAVING in SQL?")])
        await run.start(None)
        while run.conductor.current().item_id != "deep_dive":
            run.conductor.next_item("done")
        _ = [p async for p in run.reply(None)]                 # said, but the voice never confirms it played
        covered = run.conductor.promises["fundamentals:databases"]
        turn = max(run._unconfirmed)
        if cut:
            run._cut_off(turn, run._unconfirmed.pop(turn), "On databases now: what is the")
        else:
            run._drop_unplayed(turn)
        return covered, run.conductor.promises["fundamentals:databases"]

    assert asyncio.run(go(False)) == ("covered", "open")
    assert asyncio.run(go(True)) == ("covered", "open")


def test_the_guard_checks_the_outline_a_with_outline_round_says_before_its_first_problem_and_not_a_round_with_nothing_promised():
    from tests.interviewer.fixtures import realism_blueprint

    async def go(bp):
        deps = RunDeps(blueprint=bp, context=context(), talker_chat=FakeChat([]), director_chat=FakeChat(briefs=[]), workspace=FakeWorkspace(),
                       api=FakeApi(), store=MemoryStore(), clock=Clock(), first_token_timeout_s=0.2)
        run = InterviewRun(deps)
        run.speaker = FakeSpeaker()
        await run.start(None)
        c = run.conductor
        seen = {}
        while c.current().item_id != "core-1":
            seen[c.current().item_id] = run._outline_expect(c.current())
            c.next_item("done")
        seen["core-1"] = run._outline_expect(c.current())
        c.next_item("done")
        seen["core-2"] = run._outline_expect(c.current())
        return seen, run

    bp = realism_blueprint()
    bp["arc"][next(n for n, a in enumerate(bp["arc"]) if a["phase"] == "core")]["style"] = "with_outline"
    seen, run = asyncio.run(go(bp))
    want = (["Java", "databases"], ["Relay"])
    assert seen["candidate_intro"] == want and seen["core-1"] == want and seen["core-2"] is None
    assert "Java and databases" in run._problem_hint(1) and "never a number of minutes" not in run._problem_hint(1)
    none = realism_blueprint()
    none["round"]["deep_dive_mins"] = 0
    assert set(asyncio.run(go(none))[0].values()) == {None}


def test_a_deep_dive_opening_that_moves_the_plan_by_its_words_still_covers_what_it_asks():
    async def go():
        run, deps = _realism_run([say("Good, that wraps up the coding part. In the Relay project you used SQLite and Claude API together. "
                                      "How did you design the data schema and handle persistence for the command history?")])
        await run.start(None)
        c = run.conductor
        while c.current().item_id != "core-2":
            c.current().turns = 5
            c.next_item("t")
        deps.workspace.cards["core-2"] = {"sections": []}
        c.current().coded = True
        c.items[c.index + 1:] = [i for i in c.items[c.index + 1:] if i.kind == "phase"]
        c.reserves.clear()
        await speak(run, "that's my solution")
        return run

    run = asyncio.run(go())
    c = run.conductor
    assert c.current().item_id == "deep_dive"                                    # moved by the words alone (no next_item)
    assert c.promises == {"projects:Relay": "covered", "fundamentals:Java": "open", "fundamentals:databases": "open"}
    c.clock = Clock(c.clock() + 800)                                             # past the part's time: only Java and databases are pushed, never Relay again
    c.current().turns = 3
    pushed = [o.text for o in c.tick() if o.kind == "open_item"]
    assert len(pushed) == 1 and "Java" in pushed[0] and "Relay" not in pushed[0]


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

_READ_ALOUD = "Given an array of integers nums and an integer target, solve pair sum."


def _asked_then_put_up(out, deps):
    asks = [n for n, x in enumerate(out) if x.rstrip().endswith("?")]
    put = [n for n, x in enumerate(out) if any(x == v for k in ("put_up:first", "intro:first") for v in LINES[k])]
    return bool(asks) and bool(put) and min(asks) < max(put)


def test_a_retry_that_asks_a_question_never_puts_the_problem_up_in_the_same_turn_run_a_seq_9():
    """C1 backstop: the first pass was blocked, the retry asked about a project and called show_problem; the problem went up and the run said
    the put-up lines after the question (question_then_problem). Now show_problem is deferred to the next turn and the order to open it stays."""
    async def go():
        run, deps, _ = make([say(_READ_ALOUD, tools=(("next_item", {"reason": "done"}),)),
                             say("One quick thing first, what does the Shelfwise project do under the hood?", tools=(("show_problem", {}),)),
                             say("Let me put the first problem on your screen.", tools=(("show_problem", {}),))])
        await run.start(None)
        _go_to(run, "candidate_intro")
        out = await speak(run, "ready")
        first = (list(out), [m["item_id"] for m in deps.workspace.of("panel.show_problem")],
                 any(o.kind == "open_item" for o in run.conductor.pending_orders()))
        retry_nudge = deps.talker_chat.calls[1][-1]["content"]
        out2 = await speak(run, "it keeps stock and billing")
        return first, retry_nudge, out2, [m["item_id"] for m in deps.workspace.of("panel.show_problem")], deps

    (out, shown, pending), nudge, out2, shown2, deps = asyncio.run(go())
    assert "connecting phrase" in nudge and "Ask nothing" in nudge                      # the retry was told to connect and ask nothing
    assert any(x.rstrip().endswith("?") for x in out) and shown == [] and pending       # the question stands alone; the problem waits
    assert not _asked_then_put_up(out, deps)
    assert shown2 == ["core-1"]                                                         # the next turn puts it up


def test_a_problem_that_went_up_before_the_retry_gets_no_put_up_line_after_the_retrys_question():
    async def go():
        run, deps, _ = make([say(_READ_ALOUD, tools=(("next_item", {"reason": "done"}), ("show_problem", {}))),
                             say("One quick thing first, what does the Shelfwise project do under the hood?")])
        await run.start(None)
        _go_to(run, "candidate_intro")
        return await speak(run, "ready"), deps

    out, deps = asyncio.run(go())
    assert any(x.rstrip().endswith("?") for x in out) and not _asked_then_put_up(out, deps)
    assert not any(x in LINES["put_up:first"] or x in LINES["intro:first"] for x in out)


def test_a_promise_order_the_talker_set_aside_does_not_cover_its_promise_even_when_the_turn_asks_a_question():
    """I1: _set_aside consumed the order, and the consumed order was then passed to mark_covered, so the turn's question covered the promise."""
    log = ("log_turn", {"condition": "they just asked about Java", "action": "answer", "reason": "stale", "set_aside": ["open_item"],
                        "set_aside_why": "the candidate already moved on"})

    async def go(tools):
        run, deps = _realism_run([say("Walk me through how an interface differs from an abstract class.", tools=tools)])
        await run.start(None)
        while run.conductor.current().item_id != "deep_dive":
            run.conductor.next_item("done")
        c = run.conductor
        c.promises["projects:Relay"] = c.promises["fundamentals:databases"] = "covered"
        c.current().turns = 3
        deps.clock.advance(c.current().max_seconds + 5)
        assert [o.ask_for for o in c.tick() if o.ask_for] == ["fundamentals:Java"]
        await speak(run)
        return run

    kept = asyncio.run(go((log,)))
    assert kept.conductor.promises["fundamentals:Java"] == "open"                        # set aside: it covers nothing
    assert all(o.ask_for != "fundamentals:Java" for u in kept._unconfirmed.values() for o in u["orders"])
    taken = asyncio.run(go(()))
    assert taken.conductor.promises["fundamentals:Java"] == "covered"                    # unchanged when the order is taken


def test_the_current_item_names_the_same_put_up_wording_as_the_order_that_moved_on_to_the_problem():
    """M5: item_details always said the first wording of the put-up pool while the order gave the interviewer the one picked for the session."""
    from app.interviewer.prompts import item_details
    from tests.interviewer.fixtures import realism_blueprint

    different = 0
    for seed in range(8):
        bp = realism_blueprint()
        bp["realism"]["seed"] = seed
        deps = RunDeps(blueprint=bp, context=context(), talker_chat=FakeChat([]), director_chat=FakeChat(briefs=[]), workspace=FakeWorkspace(), api=FakeApi(),
                       store=MemoryStore(), clock=Clock(), first_token_timeout_s=0.2)
        run = InterviewRun(deps)

        async def go():
            await run.start(None)
            while run.conductor.current().item_id != "core-1":
                run.conductor.current().turns = 5
                run.conductor.next_item("t")

        asyncio.run(go())
        order = next(o for o in run.conductor.pending_orders() if o.kind == "open_item" and "next coding problem" in o.text)
        told = next(v for v in LINES["put_up:first"] if v in order.text)
        view = run._view([order], [])
        assert view["item"]["put_up"] == told and told in item_details(bp, view["item"])
        different += told != LINES["put_up:first"][0]
        assert run.conductor.put_up_line(1, take=True) == told                                    # the run's own put-up line says it too
    assert different >= 1                                        # at least one seed picks a wording other than the first: the check has teeth
