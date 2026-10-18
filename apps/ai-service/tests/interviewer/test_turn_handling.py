import asyncio
from types import SimpleNamespace

from livekit.agents import AgentSession, inference

from app.config import Settings
from app.interviewer import agent as agent_module
from app.interviewer.agent import PlaceholderLLM, build_turn_handling


def settings(**kwargs):
    return SimpleNamespace(**{"interviewer_turn_detector": True, "interviewer_endpointing_min_delay_seconds": 0.5, **kwargs})


def session_options(turn_handling):
    async def build():
        session = AgentSession(llm=PlaceholderLLM(), turn_handling=turn_handling)
        return session.options.endpointing, session.turn_detection
    return asyncio.run(build())


def test_turn_detector_config_defaults():
    fields = Settings.model_fields
    assert fields["interviewer_turn_detector"].default is True
    assert fields["interviewer_endpointing_min_delay_seconds"].default == 0.5
    assert fields["interviewer_endpointing_min_delay_seconds"].metadata[0].gt == 0


def test_with_the_detector_on_the_short_wait_is_the_configured_one_and_the_long_wait_is_three_seconds():
    handling = build_turn_handling(settings(interviewer_endpointing_min_delay_seconds=0.4))
    assert isinstance(handling["turn_detection"], inference.TurnDetector)
    assert handling["endpointing"] == {"mode": "fixed", "min_delay": 0.4, "max_delay": 3.0}
    assert handling["preemptive_generation"] == {"enabled": False}
    endpointing, detector = session_options(handling)
    assert endpointing["min_delay"] == 0.4 and endpointing["max_delay"] == 3.0 and endpointing["mode"] == "fixed"
    assert detector is handling["turn_detection"]


def test_with_the_switch_off_the_session_has_no_detector_and_a_flat_second(caplog):
    import logging

    with caplog.at_level(logging.WARNING, logger="app.interviewer.agent"):
        handling = build_turn_handling(settings(interviewer_turn_detector=False))
    assert handling["turn_detection"] == "stt"
    assert handling["endpointing"] == {"mode": "fixed", "min_delay": 1.0, "max_delay": 3.0}
    assert len([r for r in caplog.records if "INTERVIEWER_TURN_DETECTOR is off" in r.getMessage()]) == 1
    endpointing, detector = session_options(handling)
    assert detector == "stt" and endpointing["min_delay"] == 1.0


def test_a_detector_that_fails_to_load_falls_back_and_never_breaks_the_round(monkeypatch, caplog):
    import logging

    def broken(*args, **kwargs):
        raise RuntimeError("model missing")

    monkeypatch.setattr(agent_module.inference, "TurnDetector", broken)
    with caplog.at_level(logging.WARNING, logger="app.interviewer.agent"):
        handling = build_turn_handling(settings())
    assert handling["turn_detection"] == "stt" and handling["endpointing"]["min_delay"] == 1.0
    assert len([r for r in caplog.records if "could not be loaded" in r.getMessage()]) == 1


def test_the_detector_leaves_interruption_options_as_livekit_defaults():
    async def build():
        return AgentSession(llm=PlaceholderLLM(), turn_handling=build_turn_handling(settings())).options.interruption

    assert asyncio.run(build()) == asyncio.run(_default_interruption())


async def _default_interruption():
    return AgentSession(llm=PlaceholderLLM()).options.interruption


def test_the_unfinished_threshold_is_the_configured_one_and_zero_keeps_the_servers_default(monkeypatch):
    from app.interviewer import agent

    made = []
    monkeypatch.setattr(agent.inference, "TurnDetector", lambda **kw: made.append(kw) or SimpleNamespace(**kw))
    build_turn_handling(settings(interviewer_eot_unlikely_threshold=0.3))
    build_turn_handling(settings(interviewer_eot_unlikely_threshold=0.0))
    assert made == [{"unlikely_threshold": 0.3}, {}]
    assert Settings.model_fields["interviewer_eot_unlikely_threshold"].default == 0.3
