import asyncio

from app.interviewer.director import Director
from app.interviewer.llm import LLMUnavailable
from tests.interviewer.fakes import FakeChat


def test_merges_triggers_into_single_flight_runs_and_survives_failures():
    briefs, failures, built = [], [], []

    async def build():
        built.append(1)
        await asyncio.sleep(0)
        return [{"role": "user", "content": "x"}]

    async def on_brief(brief, meta):
        briefs.append((brief.for_position, meta["triggers"]))

    async def on_failure(error):
        failures.append(error)

    async def run():
        chat = FakeChat(briefs=[{"for_position": 3, "goal": "probe"}, LLMUnavailable("down"), {"goal": "missing position"}])
        d = Director(chat, build, on_brief, on_failure)
        d.trigger({"turns"})
        d.trigger({"time"})        # issued before the loop first runs: both merge into the first run
        await d.idle()
        d.trigger({"item"})
        await asyncio.sleep(0)     # the run has started (it is building its messages) ...
        d.trigger({"proctor"})     # ... so this one arrives mid-flight and merges into the NEXT run
        await d.idle()
        return d

    d = asyncio.run(run())
    assert briefs == [(3, ["time", "turns"])]
    assert len(failures) == 2 and d.runs == 1      # the "item" run fails (LLMUnavailable); "proctor" gets an invalid brief
    assert len(built) == 3
