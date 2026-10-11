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


def test_the_voice_is_an_aura_2_voice_male_by_default_and_female_only_when_the_persona_says_so():
    from app.config import Settings
    from app.interviewer.voices import tts_voice

    settings = Settings(_env_file=None)
    assert tts_voice(settings, {"name": "Siddharth Menon"}) == "aura-2-orpheus-en"
    assert tts_voice(settings, None) == "aura-2-orpheus-en"
    assert tts_voice(settings, {"gender": "Female"}) == "aura-2-athena-en"


def test_a_woman_interviewer_gets_the_female_voice_and_a_man_the_male_voice_by_name_when_the_persona_has_no_gender():
    from app.blueprint.prompts import INTERVIEWER_NAMES
    from app.config import Settings
    from app.interviewer.voices import persona_gender, tts_voice

    settings = Settings(_env_file=None)
    women = {"Pooja Shetty", "Ananya Iyer", "Priya Deshpande", "Meera Kulkarni", "Sneha Reddy", "Aisha Khan", "Neha Agarwal",
             "Divya Pillai", "Kavya Hegde", "Ishita Chatterjee", "Lakshmi Narayanan", "Harpreet Kaur", "Tanvi Bhatt", "Nandini Rao",
             "Ritika Saxena", "Shreya Mukherjee", "Zoya Sheikh", "Anjali Mishra"}
    for name in INTERVIEWER_NAMES:
        expected = "aura-2-athena-en" if name in women else "aura-2-orpheus-en"
        assert tts_voice(settings, {"name": name}) == expected, name
        assert persona_gender({"name": name}) == ("female" if name in women else "male"), name
    assert persona_gender({"name": "Someone Unknown", "gender": "female"}) == "female"     # an explicit gender wins
    assert persona_gender({"name": "Pooja Shetty", "gender": "male"}) == "male"
    assert persona_gender({"name": "Someone Unknown"}) == "male"                           # nothing known: the default voice


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

