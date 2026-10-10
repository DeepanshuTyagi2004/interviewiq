import asyncio

from app.interviewer.simulate import simulate
from tests.interviewer.fakes import FakeChat, say
from tests.interviewer.fixtures import blueprint, context


def test_simulates_a_short_round_through_to_the_end():
    lines_out: list[str] = []
    talker = FakeChat([
        say("Hi, I'm Siddharth.", tools=(("next_item", {"reason": "greeted"}),)),
        say("Tell me about yourself."),
        say("What was your last project?"),
        say("How did you settle the balances?"),
        say("Good. Why that way?"),
        say("Thanks, let's code.", tools=(("next_item", {"reason": "intro done"}), ("show_problem", {"item_id": "core-1"}))),
        say("The problem is on your screen."),
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
    state = talker.calls[1][1]["content"]
    assert "## Activity" in state
    assert "Since they last spoke (10 s): typed line 3 (1 edit)." in state
    assert "- says “this loop” at" in state and "line 3 `for i, x in enumerate(nums):`" in state
    assert any(line.startswith("  [activity]") for line in out)


def test_a_bad_activity_command_is_reported_and_skipped():
    out: list[str] = []
    talker = FakeChat([say("Hi."), say("Okay.")])
    script = ["#at 1 teleport somewhere", "#at x type 3 hello", "Hello there."]
    asyncio.run(simulate(blueprint(), context(), script, talker, FakeChat(), seconds_per_line=4, out=out.append))
    assert sum("(ignored" in line for line in out) == 2
