import asyncio

from app.interviewer.simulate import simulate
from tests.interviewer.fakes import FakeChat, say, state_of
from tests.interviewer.fixtures import blueprint, context


def test_simulates_a_short_round_through_to_the_end():
    lines_out: list[str] = []
    talker = FakeChat([
        say("Hi, I'm Siddharth. How are you doing?", tools=(("next_item", {"reason": "greeted"}),)),   # a greeting asks something
        say("Tell me about yourself."),
        say("What was your last project?"),
        say("How did you settle the balances?"),
        say("Good. Why that way?"),
        say("Thanks, let's code.", tools=(("next_item", {"reason": "intro done"}), ("show_problem", {"item_id": "core-1"}))),
        say("I noticed you switched tabs. Please stay here."),
        say("Thanks for your time, take care."),
    ])
    script = ["Hi!", "I'm Asha, a backend engineer.", "A split-bill app.", "Greedily, on net balances.", "Because it is simple.",
              "#wait 5", "Sounds good.", "#tab", "#end"]

    run = asyncio.run(simulate(blueprint(), context(), script, talker, FakeChat(), seconds_per_line=5, out=lines_out.append))

    assert run.finished.is_set() and run.d.api.ended[0][1] == "candidate_ended"
    assert any(l.startswith("INTERVIEWER: Hi, I'm Siddharth.") for l in lines_out)
    assert any("panel.show_problem" in l and "Problem 1" in l for l in lines_out)
    assert any("I noticed you switched tabs" in l for l in lines_out)


def test_activity_commands_and_speech_timing_reach_the_digest_the_talker_sees():
    out: list[str] = []
    talker = FakeChat([say("Hi, I'm Siddharth."), say("I see the loop. Go on.")])
    script = [
        "#wait 12",
        "#at -6 type 3     for i, x in enumerate(nums):",
        "#at 1.0 point code 3 for i, x in enumerate(nums):",
        "So this loop walks the array once and I keep a dictionary of what I have seen.",
    ]
    asyncio.run(simulate(blueprint(), context(), script, talker, FakeChat(), seconds_per_line=8, out=out.append))
    state = state_of(talker.calls[1])
    assert "## Activity" in state
    # 11 s, not 10: the opening's 1.2 s of speech now takes simulated time, as it does in the room
    assert "Since they last spoke (11 s): typed line 3 (1 edit)." in state
    assert "- says “this loop” at" in state and "line 3 `for i, x in enumerate(nums):`" in state
    assert any(line.startswith("  [activity]") for line in out)


def test_a_bad_activity_command_is_reported_and_skipped():
    out: list[str] = []
    talker = FakeChat([say("Hi."), say("Okay.")])
    script = ["#at 1 teleport somewhere", "#at x type 3 hello", "Hello there."]
    asyncio.run(simulate(blueprint(), context(), script, talker, FakeChat(), seconds_per_line=4, out=out.append))
    assert sum("(ignored" in line for line in out) == 2


class _Source:
    """A line source: hands out one batch per interviewer reply, and the views it was shown are kept."""

    def __init__(self, batches):
        self.batches, self.views = list(batches), []

    async def next_lines(self, view):
        self.views.append(view)
        return self.batches.pop(0) if self.batches else None


def test_a_line_source_is_asked_for_more_after_each_interviewer_reply():
    out: list[str] = []
    talker = FakeChat([say("Hi, I'm Siddharth. How are you?"), say("Glad to hear it. Tell me about yourself."), say("Nice. What did you build?")])
    source = _Source([["Doing well, thanks."], ["#wait 3", "I'm a backend engineer."], None])

    run = asyncio.run(simulate(blueprint(), context(), source, talker, FakeChat(), seconds_per_line=5, out=out.append))

    assert [l for l in out if l.startswith("CANDIDATE:")] == ["CANDIDATE: Doing well, thanks.", "CANDIDATE: I'm a backend engineer."]
    assert len(source.views) == 3 and not run.finished.is_set()
    first = source.views[0]
    assert set(first) == {"transcript", "on_screen", "code", "clock_s", "item"}
    assert first["transcript"][0].startswith("INTERVIEWER: Hi, I'm Siddharth") and first["code"] == "" and first["on_screen"] is None
    assert source.views[1]["transcript"][-1].startswith("INTERVIEWER: Glad to hear it") and source.views[2]["clock_s"] > source.views[1]["clock_s"]


def test_a_line_source_ending_with_end_presses_end_and_the_view_shows_the_problem_and_code():
    out: list[str] = []
    talker = FakeChat([say("Hi, I'm Siddharth."), say("Okay.", tools=(("next_item", {"reason": "x"}), ("show_problem", {"item_id": "core-1"}))),
                       say("The problem is on your screen.")])
    source = _Source([["Hello."], ["#code def f():\\n    return 1", "Here it is."], ["#end"]])
    run = asyncio.run(simulate(blueprint(), context(), source, talker, FakeChat(), seconds_per_line=5, out=out.append))
    assert "(candidate pressed End)" in out and run.finished.is_set()
    assert source.views[2]["code"] == "def f():\n    return 1"


def test_select_panel_is_the_browsers_panel_selection_event():
    from app.interviewer.simulate import _event
    assert _event("select panel two indices", 1500) == {"k": "sel", "t": 1500, "s": "panel", "text": "two indices"}
    assert _event("select panel " + "x" * 400, 1)["text"] == "x" * 300


def _run_capturing(monkeypatch):
    """simulate() builds its own InterviewRun; this keeps a handle on it for a test that needs to reach in."""
    from app.interviewer import simulate as sim
    made = []

    class Capturing(sim.InterviewRun):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            made.append(self)

    monkeypatch.setattr(sim, "InterviewRun", Capturing)
    return made


def test_an_order_waits_for_the_candidates_answer_to_a_question_just_asked_as_it_does_live(monkeypatch):
    out: list[str] = []
    made = _run_capturing(monkeypatch)
    talker = FakeChat([say("Hi, I'm Siddharth. How are you doing?"), say("Good to hear. Let's get going.")])

    class Source:
        calls = 0

        async def next_lines(self, view):
            self.calls += 1
            if self.calls == 1:
                made[0].conductor._order("move_on", "Move on to the next part.", made[0].d.clock())
                return ["#wait 1", "Doing well."]
            return None

    run = asyncio.run(simulate(blueprint(), context(), Source(), talker, FakeChat(), seconds_per_line=5, out=out.append))

    said_lines = [l for l in out if l.startswith(("INTERVIEWER:", "CANDIDATE:"))]
    assert [l.split(":")[0] for l in said_lines] == ["INTERVIEWER", "CANDIDATE", "INTERVIEWER"]
    assert "Good to hear" in said_lines[2] and run.speaker.requested == 0


def test_the_sim_clock_advances_by_the_time_the_interviewer_speaks():
    out: list[str] = []
    talker = FakeChat([say("Hi, I'm Siddharth. How are you doing?")])       # 7 words

    class Source:
        views: list = []

        async def next_lines(self, view):
            self.views.append(view)
            return None

    source = Source()
    asyncio.run(simulate(blueprint(), context(), source, talker, FakeChat(), seconds_per_line=5, out=out.append))
    assert abs(source.views[0]["clock_s"] - 7 / 2.6) < 0.01


def test_a_bare_okay_after_a_statement_is_met_with_silence_as_the_live_agent_does():
    out: list[str] = []
    talker = FakeChat([say("Hi, I'm Siddharth. Thanks for joining."), say("Let's start with your project."), say("Which part of it was yours?")])
    script = ["Hi!", "Okay.", "I built the settlement part."]
    asyncio.run(simulate(blueprint(), context(), script, talker, FakeChat(), seconds_per_line=5, out=out.append))
    assert "(interviewer stays silent)" in out
    assert len(talker.calls) == 3                       # the opening and two replies: "Okay." called no model
