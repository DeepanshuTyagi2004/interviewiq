from types import SimpleNamespace

from app.interviewer.agent import wire_session_events


class FakeSession:
    def __init__(self) -> None:
        self.handlers: dict[str, object] = {}

    def on(self, name: str):
        def register(fn):
            self.handlers[name] = fn
            return fn
        return register


def make_run(heard):
    return SimpleNamespace(on_user_transcript=lambda *a: heard.append(a), on_conversation_item=lambda *a: None,
                           on_agent_state=lambda *a: None, on_user_state=lambda *a: None)


def test_interim_and_final_speech_reaches_the_run_with_its_timestamp():
    heard: list[tuple] = []
    session = FakeSession()
    wire_session_events(session, make_run(heard))
    handler = session.handlers["user_input_transcribed"]
    handler(SimpleNamespace(transcript="so this loop", is_final=False, created_at=1234.5))
    handler(SimpleNamespace(transcript="so this loop is linear", is_final=True, created_at=1236.0))
    assert heard == [("so this loop", False, 1234.5), ("so this loop is linear", True, 1236.0)]


def test_the_session_does_not_answer_before_the_candidates_turn_is_complete():
    """LiveKit's default starts the reply from the interim transcript, before on_user_turn_completed has told the run
    what was said: the run would answer as if the candidate had said nothing and throw their activity digest away."""
    import asyncio

    from livekit.agents import AgentSession

    from app.interviewer.agent import TURN_HANDLING, PlaceholderLLM

    async def build():
        default = AgentSession(llm=PlaceholderLLM()).options.preemptive_generation["enabled"]
        ours = AgentSession(llm=PlaceholderLLM(), turn_handling=TURN_HANDLING).options.preemptive_generation["enabled"]
        return default, ours

    assert asyncio.run(build()) == (True, False)      # LiveKit's default is the trap; ours turns it off


def test_the_candidate_gets_a_second_of_silence_before_their_turn_counts_as_finished():
    import asyncio

    from livekit.agents import AgentSession

    from app.interviewer.agent import TURN_HANDLING, PlaceholderLLM

    async def build():
        return AgentSession(llm=PlaceholderLLM(), turn_handling=TURN_HANDLING).options.endpointing

    ends = asyncio.run(build())
    assert ends["min_delay"] >= 1.0 and ends["max_delay"] >= 4.0      # thinking aloud pauses mid-sentence; LiveKit's 0.5 s cuts them off


def test_a_long_silence_does_not_make_every_later_reply_wait_longer():
    """A live round's replies came ever later: 'dynamic' endpointing learned the candidate's thinking silences (25 s after a
    turn the interviewer let pass, 20-40 s while coding) as pauses inside a sentence and raised the wait before every reply
    to its 6 s ceiling. The wait must stay what it was set to, however long the candidate has been quiet."""
    import asyncio

    from livekit.agents import AgentSession
    from livekit.agents.voice.endpointing import create_endpointing

    from app.interviewer.agent import TURN_HANDLING, PlaceholderLLM

    async def build():
        return AgentSession(llm=PlaceholderLLM(), turn_handling=TURN_HANDLING).options.endpointing

    endpointing = create_endpointing(asyncio.run(build()))
    before = endpointing.min_delay
    for start in (0.0, 26.0, 60.0, 100.0):            # utterances with long silences and no interviewer speech between them
        endpointing.on_start_of_speech(start)
        endpointing.on_end_of_speech(start + 1.0)
    assert endpointing.min_delay == before


def test_the_session_keeps_the_turn_detector_that_waits_longer_mid_sentence():
    """LiveKit's turn detector picks the short wait when the candidate sounds finished and the long one mid-sentence."""
    import asyncio

    from livekit.agents import AgentSession

    from app.interviewer.agent import TURN_HANDLING, PlaceholderLLM

    async def build():
        return AgentSession(llm=PlaceholderLLM(), turn_handling=TURN_HANDLING).turn_detection

    assert asyncio.run(build()) is not None


def test_a_reply_logs_where_its_delay_went_from_livekits_own_turn_metrics(caplog):
    from app.interviewer.agent import turn_latency_line

    user = {"end_of_turn_delay": 1.02, "transcription_delay": 0.31, "on_user_turn_completed_delay": 0.004, "stopped_speaking_at": 5.0}
    reply = {"llm_node_ttft": 1.4, "llm_node_ttfs": 1.9, "tts_node_ttfb": 0.5, "e2e_latency": 3.8}
    assert turn_latency_line(user, reply) == ("reply latency: endpointing 1020 ms, stt_final 310 ms, turn_hook 4 ms, first_text 1400 ms, "
                                              "to_tts 1900 ms, tts_ttfb 500 ms, e2e 3800 ms")
    assert turn_latency_line(None, {"tts_node_ttfb": 0.4}) == "reply latency: tts_ttfb 400 ms"      # the greeting answers nobody
    assert turn_latency_line(user, {}) is None                                                       # interrupted before any audio


def test_the_reply_latency_is_logged_once_per_reply_and_a_bad_metric_never_breaks_the_reply(caplog):
    import logging

    session, items = FakeSession(), []
    run = SimpleNamespace(on_user_transcript=lambda *a: None, on_conversation_item=lambda *a: items.append(a),
                          on_agent_state=lambda *a: None, on_user_state=lambda *a: None)
    wire_session_events(session, run)
    handler = session.handlers["conversation_item_added"]
    with caplog.at_level(logging.INFO, logger="app.interviewer.agent"):
        handler(SimpleNamespace(item=SimpleNamespace(role="user", metrics={"end_of_turn_delay": 1.0}, text_content="hi")))
        handler(SimpleNamespace(item=SimpleNamespace(role="assistant", metrics={"e2e_latency": 2.5, "tts_node_ttfb": 0.5},
                                                     text_content="Hello.", interrupted=False)))
        handler(SimpleNamespace(item=SimpleNamespace(role="assistant", metrics={"e2e_latency": "bad"}, text_content="Again.", interrupted=False)))
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("reply latency")]
    assert lines == ["reply latency: endpointing 1000 ms, tts_ttfb 500 ms, e2e 2500 ms"]       # the user's numbers are not reused
    assert [i[1] for i in items] == ["Hello.", "Again."]


def test_the_replys_and_the_candidates_metrics_reach_the_run_together():
    session, items = FakeSession(), []
    run = SimpleNamespace(on_user_transcript=lambda *a: None, on_conversation_item=lambda *a: items.append(a),
                          on_agent_state=lambda *a: None, on_user_state=lambda *a: None)
    wire_session_events(session, run)
    handler = session.handlers["conversation_item_added"]
    handler(SimpleNamespace(item=SimpleNamespace(role="user", metrics={"end_of_turn_delay": 1.0, "transcription_delay": 0.3}, text_content="hi")))
    handler(SimpleNamespace(item=SimpleNamespace(role="assistant", metrics={"e2e_latency": 2.5}, text_content="Hello.", interrupted=False)))
    handler(SimpleNamespace(item=SimpleNamespace(role="assistant", metrics=None, text_content="Again.", interrupted=False)))
    assert items[0][3] == {"end_of_turn_delay": 1.0, "transcription_delay": 0.3, "e2e_latency": 2.5}
    assert items[1][3] == {}                                                              # the candidate's numbers are not reused


def test_the_turn_detectors_last_score_before_the_turn_rides_with_that_turns_metrics():
    session, items = FakeSession(), []
    run = SimpleNamespace(on_user_transcript=lambda *a: None, on_conversation_item=lambda *a: items.append(a),
                          on_agent_state=lambda *a: None, on_user_state=lambda *a: None)
    wire_session_events(session, run)
    handler = session.handlers["conversation_item_added"]
    listener = session._iq_eot_listener
    listener(0.9, 0.36)
    listener(0.12, 0.36)                                     # the last pause's score is the one that chose the wait
    handler(SimpleNamespace(item=SimpleNamespace(role="user", metrics={"end_of_turn_delay": 3.0}, text_content="Please change it.")))
    handler(SimpleNamespace(item=SimpleNamespace(role="assistant", metrics={"e2e_latency": 3.5}, text_content="Okay.", interrupted=False)))
    assert items[0][3] == {"end_of_turn_delay": 3.0, "eot_probability": 0.12, "eot_threshold": 0.36, "e2e_latency": 3.5}
    handler(SimpleNamespace(item=SimpleNamespace(role="user", metrics={}, text_content="Hi.")))
    handler(SimpleNamespace(item=SimpleNamespace(role="assistant", metrics={}, text_content="Hello.", interrupted=False)))
    assert "eot_probability" not in items[1][3]              # a turn with no new score does not reuse the last one


def test_the_turn_detector_hook_is_wrapped_once_and_still_reaches_livekit():
    from livekit.agents.voice.agent_activity import AgentActivity

    from app.interviewer.agent import watch_turn_detector

    assert watch_turn_detector() and watch_turn_detector()
    wrapped = AgentActivity.on_eot_prediction
    assert getattr(wrapped, "_iq_wrapped", False)
    heard, reached = [], []
    activity = SimpleNamespace(_session=SimpleNamespace(_iq_eot_listener=lambda p, t: heard.append((p, t)), _session_host=None))
    wrapped(activity, SimpleNamespace(probability=0.2, threshold=0.36))
    assert heard == [(0.2, 0.36)]
    broken = SimpleNamespace(_session=SimpleNamespace(_iq_eot_listener=lambda p, t: 1 / 0, _session_host=None))
    wrapped(broken, SimpleNamespace(probability=0.2, threshold=0.36))   # a failing listener never stops LiveKit's own handling


def test_the_latency_line_says_how_the_detector_read_the_turn():
    from app.interviewer.agent import turn_latency_line

    line = turn_latency_line({"end_of_turn_delay": 3.0, "eot_probability": 0.12, "eot_threshold": 0.36}, {"e2e_latency": 3.5})
    assert line == "reply latency: endpointing 3000 ms, e2e 3500 ms, eot 0.12 (unfinished at 0.36)"
