from types import SimpleNamespace

from app.interviewer.worker import missing_live_settings, session_id_from


def test_session_id_comes_from_dispatch_metadata_then_the_room_name():
    assert session_id_from('{"session_id": "abc"}', "interview-zzz") == "abc"
    assert session_id_from("", "interview-zzz") == "zzz"
    assert session_id_from("not json", "lobby") is None


def test_lists_missing_live_settings_without_values():
    s = SimpleNamespace(livekit_url="wss://x", livekit_api_key="", livekit_api_secret="s", deepgram_api_key="d",
                        openrouter_api_key="", mongodb_url="m", api_base_url="http://api", internal_api_key="k")
    assert missing_live_settings(s) == ["LIVEKIT_API_KEY", "OPENROUTER_API_KEY"]


def test_cannot_start_is_best_effort_it_tells_the_browser_and_deletes_the_room_even_if_the_api_fails():
    import asyncio

    from app.interviewer.api_client import ApiError
    from app.interviewer.worker import _cannot_start

    sent, deleted = [], []

    class Participant:
        async def send_text(self, text, topic=""):
            sent.append((topic, text))

    class Ctx:
        room = SimpleNamespace(local_participant=Participant())

        async def delete_room(self):
            deleted.append(True)

    class FailingApi:
        async def end(self, session_id, reason, summary):
            raise ApiError(404, '{"code":"session_not_found"}')

    asyncio.run(_cannot_start(Ctx(), FailingApi(), "s1"))   # must not raise
    assert deleted == [True]
    assert sent and '"session.ending"' in sent[0][1] and '"technical"' in sent[0][1]


def test_flux_voices_use_the_v2_endpoint_with_the_model_improvement_programme_opted_out_and_aura_names_still_work():
    from livekit.plugins import deepgram

    from app.interviewer.voices import build_tts

    flux = build_tts("flux-naveen-en", "key")
    assert isinstance(flux, deepgram.TTSv2) and flux._opts.model == "flux-naveen-en" and flux._opts.mip_opt_out is True
    aura = build_tts("aura-2-orpheus-en", "key")
    assert isinstance(aura, deepgram.TTS) and aura._opts.model == "aura-2-orpheus-en" and aura._opts.mip_opt_out is True
    assert build_tts("aura-2-orpheus-en", "key", mip_opt_out=False)._opts.mip_opt_out is False


def test_the_stage_clock_logs_each_stage_once_in_milliseconds_since_the_job_was_received(caplog):
    import logging

    from app.interviewer.worker import StageClock

    now = [100.0]
    clock = StageClock("s1", now=lambda: now[0])
    with caplog.at_level(logging.INFO, logger="app.interviewer.worker"):
        now[0] = 101.5
        clock.mark("room_joined")
        clock.mark("room_joined")           # every stage is logged once, however often it is marked
        now[0] = 103.0
        clock.mark("begin")
    lines = [r.getMessage() for r in caplog.records]
    assert lines == ["interviewer stage room_joined at 1500 ms (session s1)", "interviewer stage begin at 3000 ms (session s1)"]


GRACE = 5      # the grace period the tests ask for: no other wait is this long


class _Bridge:
    """The workspace bridge as the real one behaves: `wait_ready` blocks for its timeout and then says no, unless the browser has
    said hello (`hello`), or the call is the grace wait (`in_grace`: the hello comes during the grace period). Remembers each timeout."""

    def __init__(self, *, hello=False, in_grace=False):
        self.hello, self.in_grace = hello, in_grace
        self.asked: list[float] = []

    async def wait_ready(self, timeout):
        import asyncio

        self.asked.append(timeout)
        if timeout == GRACE:
            return self.in_grace
        if self.hello:
            return True
        await asyncio.sleep(timeout)
        return False


class _Run:
    def __init__(self, ended=False):
        self.ended_run = None
        self.ended = ended
        self.started_with = "not started"
        self.reaffirmed = 0

    async def start(self, saved):
        self.started_with = saved
        if self.ended or (saved or {}).get("ended_at"):
            self.ended_run = saved or {"ended_at": "x"}

    async def reaffirm_end(self):
        self.reaffirmed += 1


class _Store:
    def __init__(self, saved=None):
        self.saved = saved

    async def load_run(self, session_id):
        return self.saved


def _blueprint_changed(monkeypatch, *answers):
    """The blueprint check answers from a script; the last answer repeats."""
    from app.interviewer import worker

    asked = []

    async def changed(session_id, loaded):
        asked.append(session_id)
        return answers[min(len(asked) - 1, len(answers) - 1)]

    monkeypatch.setattr(worker, "blueprint_changed", changed)
    return asked


def _begin(bridge, run, store, **kw):
    import asyncio

    from app.interviewer import worker

    return asyncio.run(worker.begin_when_candidate_arrives(bridge=bridge, run=run, store=store, session_id="s1", blueprint={}, **kw))


def test_the_round_starts_when_the_candidate_says_hello(monkeypatch):
    _blueprint_changed(monkeypatch, False)
    run, hello = _Run(), []
    outcome = _begin(_Bridge(hello=True), run, _Store({"seq": 3}), on_hello=lambda: hello.append(1))
    assert outcome == "started" and run.started_with == {"seq": 3} and hello == [1]


def test_an_interview_that_had_already_finished_is_ended_again_at_once_without_waiting_for_a_hello(monkeypatch):
    _blueprint_changed(monkeypatch, False)
    bridge, run, hello = _Bridge(hello=True), _Run(), []
    outcome = _begin(bridge, run, _Store({"ended_at": "2026-10-10T20:00:00+00:00"}), on_hello=lambda: hello.append(1))
    assert outcome == "ended" and run.ended_run is not None
    assert bridge.asked == [] and hello == []        # nobody had to arrive for its ending to be repeated and reported


def test_an_interview_found_finished_after_the_hello_is_reported_as_ended(monkeypatch):
    _blueprint_changed(monkeypatch, False)
    assert _begin(_Bridge(hello=True), _Run(ended=True), _Store({"seq": 1})) == "ended"


def test_nobody_coming_means_the_round_never_starts(monkeypatch):
    _blueprint_changed(monkeypatch, False)
    bridge, run = _Bridge(), _Run()
    assert _begin(bridge, run, _Store(), wait_s=0.01) == "nobody"
    assert run.started_with == "not started" and GRACE not in bridge.asked


def test_a_candidate_who_is_in_the_room_when_the_wait_ends_gets_a_grace_period_for_their_hello(monkeypatch):
    _blueprint_changed(monkeypatch, False)
    bridge, run = _Bridge(in_grace=True), _Run()
    assert _begin(bridge, run, _Store({"seq": 1}), wait_s=0.01, candidate_present=lambda: True, grace_s=GRACE) == "started"
    assert bridge.asked[-1] == GRACE and run.started_with == {"seq": 1}

    silent = _Bridge(in_grace=False)
    assert _begin(silent, _Run(), _Store(), wait_s=0.01, candidate_present=lambda: True, grace_s=GRACE) == "nobody"   # still no hello: gone
    assert silent.asked[-1] == GRACE


def test_no_grace_period_when_nobody_is_in_the_room(monkeypatch):
    _blueprint_changed(monkeypatch, False)
    bridge = _Bridge(in_grace=True)
    assert _begin(bridge, _Run(), _Store(), wait_s=0.01, candidate_present=lambda: False, grace_s=GRACE) == "nobody"
    assert GRACE not in bridge.asked


def test_a_blueprint_re_prepared_while_waiting_is_noticed_before_the_candidate_arrives(monkeypatch):
    asked = _blueprint_changed(monkeypatch, False, True)
    bridge, run, hello = _Bridge(), _Run(), []
    outcome = _begin(bridge, run, _Store(), wait_s=5, check_every_s=0.001, on_hello=lambda: hello.append(1))
    assert outcome == "changed" and run.started_with == "not started"
    assert hello == [] and len(asked) == 2 and len(bridge.asked) == 2      # left on the second check, long before any hello


def test_a_blueprint_re_prepared_at_the_moment_of_the_hello_still_means_leaving_without_starting(monkeypatch):
    _blueprint_changed(monkeypatch, True)
    run, hello = _Run(), []
    assert _begin(_Bridge(hello=True), run, _Store(), on_hello=lambda: hello.append(1)) == "changed"
    assert run.started_with == "not started" and hello == [1]


def test_the_blueprint_counts_as_changed_only_when_its_id_or_version_differ(monkeypatch):
    import asyncio

    from app.interviewer import worker

    loaded = {"blueprint_id": "b1", "version": 2}

    async def current(session_id):
        return current.answer

    monkeypatch.setattr(worker.bp_store, "current_blueprint", current)
    for answer, expected in (({"blueprint_id": "b1", "version": 2}, False), ({"blueprint_id": "b1", "version": 3}, True),
                             ({"blueprint_id": "b9", "version": 2}, True), (None, False)):
        current.answer = answer
        assert asyncio.run(worker.blueprint_changed("s1", loaded)) is expected


def test_a_failed_blueprint_lookup_is_not_a_changed_blueprint(monkeypatch):
    import asyncio

    from app.interviewer import worker

    async def broken(session_id):
        raise RuntimeError("mongo blip")

    monkeypatch.setattr(worker.bp_store, "current_blueprint", broken)
    assert asyncio.run(worker.blueprint_changed("s1", {"blueprint_id": "b1", "version": 2})) is False    # the wait goes on


class _Ctx:
    def __init__(self):
        self.sent, self.deleted, self.shutdowns = [], 0, []
        participant = type("P", (), {"send_text": self._send})()
        self.room = type("R", (), {"local_participant": participant})()

    async def _send(self, text, topic=""):
        self.sent.append(text)

    async def delete_room(self):
        self.deleted += 1

    def shutdown(self, reason=""):
        self.shutdowns.append(reason)


class _Api:
    def __init__(self, status="PREP_READY", fails=False):
        self.status, self.fails, self.ended = status, fails, []

    async def context(self, session_id):
        if self.fails:
            raise RuntimeError("API down")
        return {"status": self.status}

    async def end(self, session_id, reason, summary):
        self.ended.append((session_id, reason, summary))
        return {}


def _leave(outcome, ctx, run, api):
    import asyncio

    from app.interviewer import worker

    asyncio.run(worker.end_without_round(outcome, ctx=ctx, run=run, api=api, session_id="s1"))


def test_nobody_coming_to_a_round_that_is_still_ready_deletes_the_room_and_leaves_the_session_alone():
    ctx, run, api = _Ctx(), _Run(), _Api("PREP_READY")
    _leave("nobody", ctx, run, api)
    assert ctx.deleted == 1 and api.ended == [] and ctx.sent == []      # the session stays PREP_READY: nothing was told or recorded


def test_nobody_coming_to_a_round_that_went_live_ends_it_as_technical_and_tells_the_browser():
    import json

    ctx, run, api = _Ctx(), _Run(), _Api("LIVE_IN_PROGRESS")
    _leave("nobody", ctx, run, api)
    assert api.ended == [("s1", "technical", {})] and ctx.deleted == 1
    assert len(ctx.sent) == 1 and json.loads(ctx.sent[0])["reason"] == "technical"


def test_when_the_api_cannot_say_whether_the_round_is_live_the_session_is_left_for_the_sweep():
    ctx, run, api = _Ctx(), _Run(), _Api(fails=True)
    _leave("nobody", ctx, run, api)
    assert ctx.deleted == 1 and api.ended == []


def test_a_re_prepared_blueprint_ends_the_job_without_touching_the_room_or_the_session():
    ctx, run, api = _Ctx(), _Run(), _Api("LIVE_IN_PROGRESS")
    _leave("changed", ctx, run, api)
    assert len(ctx.shutdowns) == 1 and ctx.deleted == 0 and api.ended == [] and run.reaffirmed == 0


def test_a_finished_interview_has_its_ending_repeated():
    ctx, run, api = _Ctx(), _Run(), _Api()
    _leave("ended", ctx, run, api)
    assert run.reaffirmed == 1 and ctx.deleted == 0 and api.ended == []      # reaffirm_end reports it to the API and frees the room itself


class _Participant:
    def __init__(self, identity, agent=False):
        from livekit import rtc

        self.identity = identity
        self.kind = rtc.ParticipantKind.PARTICIPANT_KIND_AGENT if agent else rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD


class _Room:
    def __init__(self, *present):
        self.remote_participants = {p.identity: p for p in present}
        self.handlers = {}

    def on(self, event):
        def register(fn):
            self.handlers[event] = fn
            return fn
        return register

    def join(self, participant):
        self.remote_participants[participant.identity] = participant
        self.handlers["participant_connected"](participant)

    def leave(self, participant):
        self.handlers["participant_disconnected"](participant)     # LiveKit may or may not have dropped them from the map yet
        self.remote_participants.pop(participant.identity, None)


class _Watched:
    def __init__(self, begun=False):
        import asyncio

        self.candidate_in_room = asyncio.Event()
        self.begun = asyncio.Event()
        if begun:
            self.begun.set()
        self.left, self.back = 0, 0

    def set_candidate_in_room(self, present):
        (self.candidate_in_room.set if present else self.candidate_in_room.clear)()

    def on_candidate_left(self):
        self.left += 1

    def on_candidate_back(self):
        self.back += 1


def test_an_interviewer_alone_in_the_room_is_not_a_candidate_and_one_who_joins_is():
    import asyncio

    from app.interviewer.worker import watch_candidate

    async def go():
        room, run = _Room(_Participant("agent-1", agent=True)), _Watched()
        watch_candidate(room, run)
        alone = run.candidate_in_room.is_set()
        room.join(_Participant("cand"))
        return alone, run.candidate_in_room.is_set()

    assert asyncio.run(go()) == (False, True)


def test_a_candidate_already_in_the_room_when_the_interviewer_starts_watching_counts():
    import asyncio

    from app.interviewer.worker import watch_candidate

    async def go():
        room, run = _Room(_Participant("cand")), _Watched()
        watch_candidate(room, run)
        return run.candidate_in_room.is_set()

    assert asyncio.run(go()) is True


def test_the_candidate_leaving_clears_it_and_another_interviewer_joining_or_leaving_changes_nothing():
    import asyncio

    from app.interviewer.worker import watch_candidate

    async def go():
        cand, agent = _Participant("cand"), _Participant("agent-2", agent=True)
        room, run = _Room(cand), _Watched()
        watch_candidate(room, run)
        room.join(agent)
        room.leave(agent)
        still_there = run.candidate_in_room.is_set()
        room.leave(cand)
        return still_there, run.candidate_in_room.is_set()

    assert asyncio.run(go()) == (True, False)


def test_before_the_round_starts_a_candidate_leaving_or_returning_is_only_presence_and_after_it_the_run_is_told():
    import asyncio

    from app.interviewer.worker import watch_candidate

    async def go():
        cand = _Participant("cand")
        room, early, late = _Room(), _Watched(begun=False), _Watched(begun=True)
        watch_candidate(room, early)
        room.join(cand)
        room.leave(cand)
        early_calls = (early.back, early.left)
        room2 = _Room()
        watch_candidate(room2, late)
        room2.join(cand)
        room2.leave(cand)
        return early_calls, (late.back, late.left)

    assert asyncio.run(go()) == ((0, 0), (1, 1))        # no absence is counted against a candidate before their round began



def test_the_interviewer_always_speaks_with_the_male_voice():
    """Decided 2026-10-16: every interviewer is male, whatever name an older blueprint gave them."""
    from app.config import Settings
    from app.interviewer.voices import tts_voice, uses_sarvam

    settings = Settings(_env_file=None)
    male = settings.sarvam_tts_voice if uses_sarvam(settings) else settings.interviewer_tts_voice
    for persona in ({"name": "Siddharth Menon"}, {"name": "Ananya Iyer"}, {"gender": "female"}, None):
        assert tts_voice(settings, persona) == male, persona


def test_a_round_prepared_with_a_womans_name_is_run_by_a_man():
    from app.interviewer.voices import male_persona, persona_gender

    old = {"name": "Ananya Iyer", "seniority": "Senior Engineer", "opening": "Hi, I'm Ananya. How are you?",
           "closing": "Thanks, this was Ananya.", "style": "calm"}
    new = male_persona(old, "s1")
    assert persona_gender(new) == "male" and "Ananya" not in new["opening"] and "Ananya" not in new["closing"]
    assert new["name"].split()[0] in new["opening"] and new["seniority"] == "Senior Engineer"
    assert male_persona(old, "s1") == new                                   # the same round always gets the same name
    assert male_persona({"name": "Arjun Nair"}, "s1") == {"name": "Arjun Nair"}


def test_the_talker_warm_up_sends_the_prefix_and_tools_once_per_gap_and_never_raises():
    import asyncio

    from app.interviewer.worker import TalkerWarmUp

    class Chat:
        def __init__(self, fail: bool = False) -> None:
            self.calls: list = []
            self.fail = fail

        async def warm_up(self, messages, tools):
            self.calls.append((messages, tools))
            if self.fail:
                raise RuntimeError("down")
            return True

    clock = [100.0]
    chat, tools = Chat(), [{"type": "function"}]
    warm = TalkerWarmUp(chat, "PREFIX", tools, min_gap_s=15, now=lambda: clock[0])

    async def go():
        first = await warm.fire()
        soon = await warm.fire()                      # the candidate entering seconds after the interviewer joined
        clock[0] += 20
        later = await warm.fire()
        return first, soon, later

    assert asyncio.run(go()) == (True, False, True) and len(chat.calls) == 2
    assert chat.calls[0][0][0] == {"role": "system", "content": "PREFIX"} and chat.calls[0][1] == tools
    broken = TalkerWarmUp(Chat(fail=True), "P", [], now=lambda: 0.0)
    assert asyncio.run(broken.fire()) is False


def test_the_warm_up_waits_for_the_candidate_in_the_background_and_can_be_cancelled():
    import asyncio

    from app.interviewer.worker import TalkerWarmUp

    class Chat:
        calls = 0

        async def warm_up(self, messages, tools):
            Chat.calls += 1
            return True

    async def go():
        warm, here = TalkerWarmUp(Chat(), "P", []), asyncio.Event()
        warm.start_when(here)
        await asyncio.sleep(0.01)
        before = Chat.calls
        here.set()
        await asyncio.sleep(0.01)
        warm.start_when(asyncio.Event())
        warm.cancel()
        await asyncio.sleep(0.01)
        return before, Chat.calls, len(warm._tasks)

    assert asyncio.run(go()) == (0, 1, 0)


def test_the_sarvam_voice_speaks_each_finished_sentence_at_once_and_starts_after_30_characters():
    """LiveKit's own sentence stream held the first sentence of a reply back until the second had started (measured offline: the
    first token appeared only after the next sentence was pushed), so the voice waited for the model to finish writing sentence two."""
    import asyncio

    from app.interviewer.voices import WholeSentenceTokenizer, build_tts_for

    settings = SimpleNamespace(interviewer_tts_provider="sarvam", sarvam_tts_model="bulbul:v4-flash", sarvam_api_key="k",
                               sarvam_tts_min_buffer_size=30)
    tts = build_tts_for(settings, "shubh_enhi_ads")
    assert isinstance(tts._opts.word_tokenizer, WholeSentenceTokenizer) and tts._opts.min_buffer_size == 30

    async def go():
        stream = tts._opts.word_tokenizer.stream()
        stream.push_text("Thanks for walking me through that. ")
        first = await asyncio.wait_for(stream.__anext__(), 0.5)        # no second sentence has arrived yet
        stream.push_text("Right. ")
        stream.push_text("   ")
        stream.end_input()
        return first.token, [t.token async for t in stream]

    assert asyncio.run(go()) == ("Thanks for walking me through that.", ["Right."])
