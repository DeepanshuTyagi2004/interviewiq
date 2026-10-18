"""The variety report (rehearse_flow.py `variety`) and `--realism-seed`: how two runs of one persona differ, and a realism block
built in memory for a blueprint stored before the realism stage."""
import importlib.util
import json
from pathlib import Path

from app.blueprint.models import Realism
from app.blueprint.realism import validate_realism
from tests.interviewer.fixtures import deep_dive_blueprint, realism_blueprint
from tests.interviewer.test_tracecheck import cand, iv

SCRIPT = Path(__file__).parents[2] / "scripts" / "rehearse_flow.py"
spec = importlib.util.spec_from_file_location("rehearse_flow", SCRIPT)
rehearse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rehearse)

TRAITS = {"pace": "even", "warmth": "friendly", "formality": "neutral", "verbosity": "normal", "probing": "normal", "hints": "normal",
          "firmness": "normal"}


def record(minutes=45, areas=("Java",), openers=("Right.", "Sure.", "Got it."), traits=None, projects=("Relay",)):
    """A run record with the fields the report reads: the round's length, the realism block, and interviewer turns that open with `openers`."""
    bp = realism_blueprint(promises=tuple([f"projects:{p}" for p in projects] + [f"fundamentals:{a}" for a in areas]))
    bp["round"]["duration_mins"] = minutes
    bp["realism"]["traits"] = dict(traits or TRAITS)
    turns = []
    for n, opener in enumerate(openers):
        turns += [iv(2 * n + 1, f"{opener} Tell me about the {projects[0]} project and what you did."), cand(2 * n + 2)]
    return {"blueprint": bp, "turns": turns}


def test_two_records_that_differ_in_length_areas_and_openers_differ_in_three_and_pass():
    a = record(minutes=30, areas=("Java",), openers=("Right.", "Sure.", "Got it."))
    b = record(minutes=45, areas=("databases",), openers=("Okay.", "Alright.", "I see."))
    assert rehearse.variety_differences(a, b) == ["length", "promised areas", "openers"]
    assert rehearse.variety_verdict([a, b])[0] is True


def test_identical_records_differ_in_nothing_and_fail():
    a = record()
    assert rehearse.variety_differences(a, record()) == []
    ok, rows = rehearse.variety_verdict([a, record()])
    assert ok is False and rows[0][2] == []


def test_two_differences_are_not_enough_and_every_pair_must_pass():
    a = record(minutes=30, areas=("Java",))
    b = record(minutes=45, areas=("databases",))                     # length + areas = 2
    assert rehearse.variety_verdict([a, b])[0] is False
    c = record(minutes=40, areas=("Java", "databases"), openers=("Okay.", "Alright.", "I see."))
    assert rehearse.variety_verdict([a, c])[0] is True               # length, areas, openers
    assert rehearse.variety_verdict([a, c, b])[0] is False           # a-b has only two


def test_the_traits_and_the_outline_order_count_as_differences():
    a = record()
    other = record(traits={**TRAITS, "warmth": "reserved"})
    parts = other["blueprint"]["realism"]["outline"]
    parts[1], parts[2] = parts[2], parts[1]
    assert rehearse.variety_differences(a, other) == ["outline order", "persona traits"]


def test_the_variety_command_prints_each_pair_and_exits_1_when_one_fails(tmp_path, capsys):
    paths = []
    for name, rec in (("a", record(minutes=30, areas=("Java",), openers=("Right.",))), ("b", record(minutes=45, areas=("databases",), openers=("Okay.",)))):
        paths.append(str(tmp_path / f"{name}.json"))
        Path(paths[-1]).write_text(json.dumps(rec))
    args = rehearse.build_parser().parse_args(["variety", *paths])
    assert rehearse.cmd_variety(args) == 0
    assert "PASS" in capsys.readouterr().out
    args = rehearse.build_parser().parse_args(["variety", paths[0], paths[0]])
    assert rehearse.cmd_variety(args) == 1


# ---------------------------------------------------------------- --realism-seed

def stored_blueprint():
    """A blueprint as stored before the realism stage: the deep-dive round, no realism block."""
    bp = deep_dive_blueprint()
    bp["round"]["duration_mins"] = 45
    bp["round"]["type"] = "dsa"
    bp["shape_id"] = "classic"
    return bp


def test_a_realism_seed_attaches_a_valid_block_to_a_stored_blueprint_without_touching_the_original():
    stored = stored_blueprint()
    before = json.dumps(stored, sort_keys=True)
    bp = rehearse.attach_realism(stored, 101, ["Relay", "Vibe"])
    assert json.dumps(stored, sort_keys=True) == before and "realism" not in stored
    realism = bp["realism"]
    assert realism["seed"] == 101 and bp["realism_seed"] == 101 and bp["realism_traits"] == realism["traits"]
    parts = [p["part"] for p in realism["outline"]]
    assert parts.index("deep_dive") == parts.index("core") + 1
    assert [p for p in parts if p != "deep_dive"] == [a["phase"] for a in bp["arc"]]       # the outline mirrors the (re-laid) arc
    assert validate_realism(Realism.model_validate(realism), {**bp, "profile_projects": ["Relay", "Vibe"]}) == []


def test_the_same_seed_gives_the_same_block_and_another_seed_a_different_one():
    stored = stored_blueprint()
    a = rehearse.attach_realism(stored, 101, ["Relay", "Vibe"])["realism"]
    assert rehearse.attach_realism(stored, 101, ["Relay", "Vibe"])["realism"] == a
    assert any(rehearse.attach_realism(stored, s, ["Relay", "Vibe"])["realism"] != a for s in (202, 303, 404))
