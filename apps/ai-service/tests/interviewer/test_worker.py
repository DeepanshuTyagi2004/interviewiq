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
