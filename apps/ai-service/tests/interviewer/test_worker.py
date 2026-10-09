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
