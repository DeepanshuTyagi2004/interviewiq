"""Replays a scripted DSA round through the conductor and returns every order it wrote. The DSA texts are frozen in
fixtures/dsa_orders.json (recorded before the round-packs change); a test asserts they never change."""
from __future__ import annotations

from app.interviewer.conductor import Conductor
from tests.interviewer.fixtures import Clock, blueprint


def record_dsa_orders() -> list[dict]:
    clock = Clock()
    c = Conductor(blueprint(), 3600, clock=clock, skills=["Java", "SQL"])
    c.start()
    out: list[dict] = []
    mark = [0]

    def take(step: str) -> None:
        """Every order the conductor has written since the last call."""
        for o in c.orders[mark[0]:]:
            out.append({"step": step, "kind": o.kind, "text": o.text, "line": o.line, "bridge": o.bridge})
        mark[0] = len(c.orders)

    def ask(action: str) -> None:
        c.on_change_request()
        c.apply_change_action(action)

    take("start")
    c.next_item("done")
    take("to intro")
    c.next_item("done")
    take("open problem 1")
    c.current().turns = 2
    c.on_hint_request(); take("hint 1")
    c.record_hint(1)
    c.on_hint_request(); take("hint 2")
    c.record_hint(2)
    c.record_hint(3)
    c.on_hint_request(); take("hint exhausted")
    c.on_reveal_request("constraints"); take("reveal")
    c.on_reveal_request("input_format", property_question=True); take("reveal property")
    c.on_explain_request(); take("explain 1")
    c.on_explain_request(); take("explain 2")
    c.on_edit_request(); take("edit")
    c.add_problem_line(1); take("problem line")
    ask("resist"); take("keep_problem 1")
    c.refusal_points.add("worth_it")
    ask("resist"); take("keep_problem 2 (points made)")
    ask("change"); take("change")                       # the run then moves on
    c.next_item("gave up"); take("open problem 2")
    c.current().turns = 2
    ask("resist"); take("keep_problem on problem 2")
    ask("end_coding"); take("end coding")
    clock.advance(1500)
    c.tick(); take("tick")
    # A swap for a reserve: the change on the last planned problem.
    c2 = Conductor(blueprint(), 3600, clock=clock, skills=["Java"])
    c2.start()
    for _ in range(3):
        c2.next_item("done")
    c2.current().turns = 2
    c2.on_change_request(); c2.apply_change_action("resist")
    c2.on_change_request(); c2.apply_change_action("change")
    for o in c2.orders:
        if o.kind == "open_item" or o.kind in ("keep_problem", "move_on"):
            out.append({"step": "swap scenario", "kind": o.kind, "text": o.text, "line": o.line, "bridge": o.bridge})
    return out
