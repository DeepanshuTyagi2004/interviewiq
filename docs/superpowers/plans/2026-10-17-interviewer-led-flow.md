# Interviewer-led flow and round shapes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live interviewer chooses the path of the conversation from what the candidate says. It can:
- go to any planned part;
- skip an optional part;
- open a short topic of its own (a thread).

The director keeps time and coverage. Each round gets a different structure (a shape) chosen at prep.

**Architecture:** The plan items in `app/interviewer/plan.py` become goals, with extra fields:
- `must`;
- `origin`, `why`, `title`, `parent`;
- `style`.

New conductor methods (`go_to`, `skip_goal`, `open_thread`, `close_thread`) validate the talker's moves against order and
coverage rules, and the talker reaches them through new tools. A "free minutes" budget (planned time left minus the planned
minutes of pending must-cover goals) limits detours, and the director's `extend` raises it. Shapes live in a new
`app/blueprint/shapes.py`: `plan_arc` builds the arc from one, the persona is written to fit it, and the live opening and
bridge texts read each part's `style`.

**Tech Stack:** Python 3.11, FastAPI service, pydantic models, pytest. One TypeScript dev script (`apps/api/scripts/dev/bench-blueprints.ts`).

**Spec:** `docs/superpowers/specs/2026-10-17-interviewer-led-flow-design.md`.

## Global Constraints

- **No new dependencies, no new LLM calls.** The talker's decisions come in its existing call, through tools.
- **Do not commit.** Leave every change in the working tree; the user commits (standing user preference). There are no
  commit steps in this plan.
- **Tests:** run from `apps/ai-service`:
  - `.venv/bin/python -m pytest -q -p no:cacheprovider tests/interviewer tests/blueprint tests/gates`.
  - Baselines: `tests/interviewer` has 21 known failures, listed in
    `/private/tmp/claude-501/-Users-salescode-Desktop-project-interviewiq/6acd6004-ecd3-44d1-b862-1bf228efd57b/scratchpad/iv_base.txt`.
    `tests/blueprint` (80) and `tests/gates` (60) pass fully. A task may add no failure outside that list.
- **Problem secrecy:** the goal map never names a problem, its topic or its difficulty. A pending problem is shown only as
  "coding problem N".
- **User-facing copy:** write "resume", never "résumé". Every interviewer is a man; do not touch persona gender.
- **Old data still works:**
  - A blueprint without `shape_id` is the `classic` shape.
  - An arc entry without `style` has style `""`.
  - An arc entry without `scored` uses `phase not in UNSCORED_PHASES` (`app/blueprint/vocabulary.py`).
  - A checkpoint without the new fields restores with their defaults.
- **Unchanged behaviour:** problem selection, answer keys, the leak guard, hint pace, the give-up flow, conduct, proctoring,
  endings, the turn-end handling, `will_skip_next_problem`, `plan_extra_problem` and the 1.5× safety ceiling.
- **Code style:** follow the surrounding code. Comments say why, in the existing style, and test names are sentences.

## Review Focus

1. **A round resumed from an old checkpoint or blueprint** (no `must`/`style`/`shape_id`/`flow_log`): restores and behaves as
   `classic`. Test in Task 1.
2. **Junk from the talker:** an unknown goal id, a missing `why`, repeated moves in one turn or `minutes: 0` must give a
   refusal dict, never an exception. Test in Task 4.
3. **The director's or the fallback's `move_on` while a thread is open:** it ends the thread and resumes the paused part with
   no new opening order. The thread must not end the paused part. Test in Task 3.
4. **The round past its planned length** (free minutes negative): may-cover moves and threads are refused, must-cover moves
   still work, and an `extend` makes room. Test in Task 3.
5. **A must-cover part jumped past** (the coding reached before the introduction): it comes next once the coding is done,
   before the candidate's questions. It is never lost. Test in Task 3.

---

## File structure

| File | Change |
|---|---|
| `apps/ai-service/app/interviewer/plan.py` | `Item` gains the goal fields. `build_items` sets `must` and `style`. Adds `min_exchanges_before_coding()`. Shape-aware `opening_hint`/`bridge_for` |
| `apps/ai-service/app/interviewer/conductor.py` | Free-minutes budget, `go_to`/`skip_goal`/`open_thread`/`close_thread`, `_next_index`, `peek_next`, `goal_map`, `flow_log`, stale-brief time ops, shape-based coding gate |
| `apps/ai-service/app/interviewer/tools.py` | Four new tool schemas and handlers |
| `apps/ai-service/app/interviewer/talker.py` | Flow tools run before the others |
| `apps/ai-service/app/interviewer/run.py` | `_view` goal keys, brief shown only for the current position, turn record `free_min`, director `flow` snapshot, `start_run` `shape_id` |
| `apps/ai-service/app/interviewer/prompts.py` | Goal map in `state_block`, thread in `item_details`, talker and director rules, director payload `flow` |
| `apps/ai-service/app/blueprint/shapes.py` (new) | `Shape`, `SHAPES`, `shapes_for`, `shape_by_id`, `choose_shape`, `apply_shape` |
| `apps/ai-service/app/blueprint/models.py` | `ArcPhase.style`, `Blueprint.shape_id` |
| `apps/ai-service/app/blueprint/stages.py` | `plan_arc(..., shape)`, `persona_stage(..., shape)` |
| `apps/ai-service/app/blueprint/prompts.py` | `persona_prompt(..., shape_about)` |
| `apps/ai-service/app/blueprint/store.py` | `recent_shapes_for_candidate`, `shape_for_session` |
| `apps/ai-service/app/blueprint/pipeline.py` | Choose the shape, pass it on, store `shape_id` |
| `apps/ai-service/scripts/judge_blueprints.py`, `apps/ai-service/app/gates/judge.py` | `persona_fits_shape` dimension |
| `apps/api/scripts/dev/bench-blueprints.ts` | Tally the shapes used |
| `apps/ai-service/scripts/flow_scenarios/*.txt` (new) | Scripted candidates for the acceptance rehearsal |
| `docs/superpowers/specs/2026-10-08-live-interviewer-design.md`, `CLAUDE.md` | Documentation |

---

### Task 1: Plan items become goals

**Files:**
- Modify: `apps/ai-service/app/interviewer/plan.py`, the `Item` dataclass (lines 25-38), `ItemKind` (line 12) and `build_items` (lines 45-59).
- Modify: `apps/ai-service/app/interviewer/conductor.py`, where `use_reserve`, `plan_extra_problem` and `insert_filler` build `Item(...)`.
- Test: `apps/ai-service/tests/interviewer/test_plan.py`, `apps/ai-service/tests/interviewer/test_conductor.py`

**Interfaces:**
- Produces:
  - `ItemKind = Literal["phase", "slot", "filler", "thread"]`.
  - `Item` gains, after `turns`:
    - `must: bool = False`
    - `origin: str = "plan"`
    - `why: str = ""`
    - `title: str = ""`
    - `parent: str | None = None`
    - `style: str = ""`
  - `build_items(blueprint)` sets:
    - `must=True` for every core slot, for `deep_dive`, and for an arc phase whose `scored` is true. A missing `scored`
      means `phase not in UNSCORED_PHASES`. `candidate_questions` and `wrap_up` are always true.
    - `style` from the arc entry's `style` (default `""`). The `core` entry's style goes only to the first slot item.
  - Conductor-built items:
    - `use_reserve`: `origin="reserve", must=True`;
    - `plan_extra_problem`: `origin="reserve", must=False`;
    - `insert_filler`: `origin="filler", must=False`.

- [ ] **Step 1: Write the failing tests** (in `test_plan.py` unless noted)

```python
def test_every_part_knows_whether_it_must_be_covered():
    items = build_items(blueprint())
    assert [(i.item_id, i.must) for i in items] == [("greeting", False), ("candidate_intro", True), ("core-1", True),
                                                    ("core-2", True), ("candidate_questions", True), ("wrap_up", True)]

def test_an_arc_without_scored_flags_uses_the_unscored_phases_and_the_questions_and_closing_are_always_must():
    bp = blueprint()
    bp["arc"] = [{"phase": p, "timebox_mins": 1} for p in ("greeting", "small_talk", "candidate_intro", "candidate_questions", "wrap_up")]
    assert [i.must for i in build_items(bp)] == [False, False, True, True, True]

def test_a_part_carries_its_style_and_the_core_style_goes_to_the_first_problem_only():
    bp = blueprint()
    bp["arc"][1]["style"] = "pointed_resume"
    bp["arc"][2]["style"] = "with_outline"
    items = {i.item_id: i for i in build_items(bp)}
    assert items["candidate_intro"].style == "pointed_resume"
    assert (items["core-1"].style, items["core-2"].style) == ("with_outline", "")
```

In `test_conductor.py`:

```python
def test_a_checkpoint_from_before_goals_restores_with_their_defaults():
    c, clock = make()
    data = c.checkpoint()
    for item in data["items"]:
        for key in ("must", "origin", "why", "title", "parent", "style"):
            item.pop(key, None)
    back = Conductor.restore(blueprint(), 3600, data, clock=clock)
    assert back.items[1].must is False and back.items[1].origin == "plan"
```

- [ ] **Step 2:** Run `.venv/bin/python -m pytest -q -p no:cacheprovider tests/interviewer/test_plan.py tests/interviewer/test_conductor.py -k "must_be_covered or scored_flags or carries_its_style or before_goals"`. Expected: the first three FAIL (no `must`/`style`); the restore test may already pass.
- [ ] **Step 3:** Implement the fields and the `build_items` rules above, and set `origin`/`must` where the conductor builds items. Import `UNSCORED_PHASES` from `app.blueprint.vocabulary`.
- [ ] **Step 4:** Run the four tests: PASS. Run the full test command from Global Constraints: no new failures.

---

### Task 2: The free-minutes budget, minimums only for must-cover parts, stale briefs keep their time changes

**Files:**
- Modify: `apps/ai-service/app/interviewer/conductor.py`:
  - `__init__`;
  - `_activate` (it increments `position`);
  - `can_advance` (around line 343);
  - `apply_brief` (around line 710);
  - `_apply_change` `extend`;
  - `checkpoint`/`restore`.
- Test: `apps/ai-service/tests/interviewer/test_conductor.py`

**Interfaces:**
- Produces:
  - **Budget methods:**
    - `Conductor.planned_seconds() -> float`: `round_seconds + granted_s`.
    - `Conductor.reserved_seconds() -> float`: the sum, over items with `status == "pending"` and `must`, of `max_seconds`
      for a part not yet started. A paused part (`started_at` set) contributes
      `max(0, max_seconds - (now - started_at))` instead. The active item contributes nothing.
    - `Conductor.free_seconds() -> float`: `planned_seconds() - (now - started_at) - reserved_seconds()`, where elapsed is 0
      before `start()`. It may be negative.
  - **New attributes:**
    - `Conductor.granted_s: float = 0.0`, raised by every accepted `extend` (`minutes * 60`) alongside `extensions`.
    - `Conductor.position_items: dict[int, str]`: `position → item_id`, written in `_activate`. Checkpointed; restored with
      int keys.
  - `Conductor.note_flow_move() -> None`: `position += 1`, `position_items[position] = current().item_id`,
    `triggers.add("flow")`. Task 3 calls it for moves that do not activate an item.
  - `can_advance()`: the `MIN_TURNS` minimum applies only when `item.must`. The background rule is unchanged here (Task 8
    changes it).
  - **`apply_brief`** with a stale `for_position`:
    - if `position_items.get(for_position) == current().item_id`, apply only its `extend`, `move_on` and `wrap_up` changes,
      through `_apply_change` and recorded as today;
    - every other part of the brief is dropped.

    The outcome dict keeps its keys (`stale`, `applied`, `dropped`).

- [ ] **Step 1: Write the failing tests**

```python
def test_free_minutes_are_the_planned_time_left_after_every_pending_must_cover_part():
    c, clock = make()
    assert c.free_seconds() == 3600 - 2820          # at the greeting: introduction, both problems, questions, closing reserved
    c.next_item("done")
    clock.advance(60)
    assert c.free_seconds() == 3600 - 60 - 2700     # the introduction is under way: its own minutes are free to spend

def test_more_time_from_the_director_raises_the_budget():
    c, _ = make()
    c.next_item("done")
    before = c.free_seconds()
    c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "extend", "minutes": 5}]})
    assert c.free_seconds() == before + 300 and c.planned_seconds() == 3900

def test_an_optional_part_has_no_minimum_exchanges():
    bp = blueprint()
    bp["arc"].insert(1, {"phase": "small_talk", "timebox_mins": 2, "scored": False, "guidance": "Chat."})
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    c.next_item("done")
    assert c.current().phase == "small_talk" and c.can_advance() == (True, "")

def test_a_brief_for_the_same_part_keeps_its_time_change_after_another_move():
    c, _ = make()
    c.next_item("done")
    pos = c.position
    c.note_flow_move()
    out = c.apply_brief({"for_position": pos, "plan_changes": [{"op": "extend", "minutes": 2}, {"op": "skip", "target": "candidate_questions"}]})
    assert out["stale"] and [ch["op"] for ch in out["applied"]] == ["extend"] and c.extensions["candidate_intro"] == 120
    assert c.items[4].status == "pending"

def test_a_brief_for_a_part_already_left_changes_nothing():
    c, _ = make()
    pos = c.position
    c.next_item("done")
    out = c.apply_brief({"for_position": pos, "plan_changes": [{"op": "extend", "minutes": 2}]})
    assert out["stale"] and out["applied"] == [] and not c.extensions
```

- [ ] **Step 2:** Run these five by name. Expected: FAIL (`free_seconds` and `note_flow_move` missing; the small-talk minimum refuses).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run the five: PASS. Run the full test command: no new failures. Some older tests may assert today's
  small-talk or framing minimum; update their expectation only if the test's subject is the minimum, and say so in the
  report.

---

### Task 3: The conductor's flow moves

**Files:**
- Modify: `apps/ai-service/app/interviewer/conductor.py`:
  - `next_item` (around lines 218-234);
  - `_activate` (lines 158-203);
  - new methods;
  - `checkpoint`/`restore`.
- Test: `apps/ai-service/tests/interviewer/test_conductor.py`

**Interfaces:**
- Consumes:
  - from Task 1: `Item.must/origin/why/title/parent`;
  - from Task 2: `free_seconds()`, `note_flow_move()`, `position_items`.
- Produces: constants `THREAD_DEFAULT_MIN = 3`, `THREAD_MAX_MIN = 6` and `MAX_THREADS = 3`, plus the following.
  - **Attributes:**
    - `Conductor.threads_opened: int = 0`.
    - `Conductor.flow_log: list[dict]`, capped at 20 entries. Each entry is
      `{"move", "target", "why", "ok", "error", "at"}`, written for every move attempt, accepted or refused, and every
      attempt adds the `"flow"` trigger. Both attributes are checkpointed.
  - `Conductor._next_index() -> int | None`, the next part to activate, used by `next_item` and `peek_next`:
    1. A thread whose `parent` is still pending: that parent.
    2. Otherwise `after` is the pending indexes after the current one in order, and `before` the pending indexes before it.
    3. If `after[0]` exists and is not `candidate_questions`/`wrap_up`: `after[0]`.
    4. Otherwise the first index of `after + before` whose phase is not `candidate_questions`/`wrap_up` (a part left
       behind comes before the questions).
    5. Otherwise `after[0]` if any, else `None`.
  - `Conductor.peek_next() -> Item | None`: the item `_next_index()` points at, with no side effects.
  - `next_item(reason)`: keeps its slot-skip logic and uses `_next_index()`.
  - `_activate(index, now, open_text=None, resume=False)`:
    - `resume=True` (used only when a thread's parent is reactivated) keeps the parent's `started_at` and issues no
      `open_item` order;
    - a `thread` item never gets an `open_item` order (the talker opened it in its own words).
  - **`go_to(target: str | None, why: str) -> tuple[bool, str]`.** Checks, in order:
    1. Ended: refused.
    2. The current item is a slot: refused, with "finish this problem first: call next_item when it is done" (the tools
       route slots to `_next_item`).
    3. `target is None`: `can_advance()`, then `next_item(f"interviewer: {why}")`.
    4. The target is unknown or not pending: refused with "{target} is not a part still to come".
    5. The current part is must-cover, has had fewer than `MIN_TURNS.get(phase, 0)` exchanges, and its time is not up:
       refused with the same minimum-exchanges message `can_advance()` gives. The "conversation before the coding" rule
       does not apply here; rule 6 covers it.
    6. The target is a slot that is not the first pending slot, or `problem_allowed()` is false: refused.
    7. The target is `candidate_questions` or `wrap_up` while another pending must-cover part exists: refused with
       "first: {ids}".
    8. The target is may-cover and `free_seconds() < 60`: refused with "less than a minute is free".

    On success:
    - the current part becomes `done`, with `ended_by=f"interviewer: {why}"`;
    - pending may-cover parts strictly between the current and target indexes become `skipped`, with
      `ended_by="passed over"`;
    - the target is activated.
  - **`skip_goal(target: str, why: str) -> tuple[bool, str]`:** the target must exist, be pending, not be current and
    not be `must`. It becomes `skipped` with `ended_by=f"interviewer: {why}"`, then `note_flow_move()`.
  - **`open_thread(title: str, why: str, minutes: int | None = None) -> tuple[bool, str]`.** Refused when:
    - the current item is a slot ("not while a problem is up");
    - the current item is a thread ("a thread is already open: close it first");
    - `threads_opened >= MAX_THREADS`;
    - `free_seconds() < 60`.

    Otherwise:
    - `minutes` is clamped to 1..6 (default 3), and `seconds = min(minutes * 60, int(free_seconds()) // 60 * 60)`;
    - the current part becomes `pending` (paused, keeping `started_at` and `turns`);
    - a new item is inserted after it:
      `Item(f"thread-{n}", "thread", "thread", seconds, origin="thread", why=why[:200], title=title[:120], parent=<current id>)`;
    - the new item is activated, and `threads_opened` increments.
  - **`close_thread(why: str, target: str | None = None) -> tuple[bool, str]`:** refused unless the current item is a
    thread. Otherwise it runs the same logic as `go_to(target, why)`, with one `flow_log` entry whose move is
    `close_thread` (no second `go_to` entry). Keep the shared logic in an unlogged private method.
  - **`next_item`:** activates with `resume=True` when the current item is a thread and the next is its parent.

- [ ] **Step 1: Write the failing tests.** Add a helper `_with_chat()` to `test_conductor.py`: `blueprint()` with
  `small_talk` (2 min, unscored) and `framing` (1 min, unscored) inserted after the greeting.

```python
def test_the_interviewer_can_go_to_a_later_part_and_optional_parts_passed_over_are_skipped():
    c = Conductor(_with_chat(), 3600, clock=Clock())
    c.start()
    ok, _ = c.go_to("candidate_intro", "they said hello and asked to get going")
    assert ok and c.current().item_id == "candidate_intro"
    assert [(i.item_id, i.status, i.ended_by) for i in c.items[:3]] == [
        ("greeting", "done", "interviewer: they said hello and asked to get going"),
        ("small_talk", "skipped", "passed over"), ("framing", "skipped", "passed over")]

def test_a_must_cover_part_jumped_past_comes_right_after_the_coding():
    c, _ = make()
    c.current().turns = 5                                        # the conversation before the coding is done
    ok, _ = c.go_to("core-1", "they want to start coding")
    assert ok and c.items[1].status == "pending"
    assert c.next_item("done").item_id == "core-2"
    assert c.next_item("done").item_id == "candidate_intro"        # before their questions, not lost
    assert c.next_item("done").item_id == "candidate_questions"

def test_a_must_cover_part_cannot_be_skipped_and_the_questions_wait_for_it():
    c, _ = make()
    c.next_item("done")
    assert c.skip_goal("core-2", "x")[0] is False
    ok, why = c.go_to("candidate_questions", "x")
    assert not ok and "core-1" in why

def test_an_optional_part_can_be_skipped_with_a_reason_and_it_moves_the_flow():
    c = Conductor(_with_chat(), 3600, clock=Clock())
    c.start()
    c.take_triggers()
    pos = c.position
    assert c.skip_goal("framing", "they said they know the format") == (True, "")
    assert c.items[2].status == "skipped" and c.position == pos + 1 and "flow" in c.take_triggers()

def test_with_no_free_minute_optional_moves_and_threads_are_refused_until_more_time_is_granted():
    clock = Clock()
    c = Conductor(_with_chat(), 3600, clock=clock)
    c.start()
    clock.advance(750)                                           # 3600 - 750 - 2820 reserved = 30 s free
    assert c.go_to("small_talk", "x") == (False, "less than a minute is free")
    assert c.open_thread("x", "y")[0] is False
    c.apply_brief({"for_position": c.position, "plan_changes": [{"op": "extend", "minutes": 10}]})
    assert c.go_to("small_talk", "x")[0] is True

def test_a_thread_pauses_the_part_it_interrupts_and_closing_it_resumes_that_part_without_a_new_opening():
    c, clock = make()
    c.next_item("done")
    intro = c.current()
    started = intro.started_at
    c.consume(c.pending_orders())
    clock.advance(30)
    ok, _ = c.open_thread("the monolith migration", "they led it; the plan has nothing on it", 3)
    t = c.current()
    assert ok and (t.kind, t.title, t.max_seconds, t.parent) == ("thread", "the monolith migration", 180, "candidate_intro")
    assert intro.status == "pending" and not c.pending_orders()
    clock.advance(120)
    assert c.close_thread("covered it") == (True, "")
    assert c.current() is intro and intro.started_at == started and not c.pending_orders()
    assert (t.status, t.ended_by) == ("done", "interviewer: covered it")

def test_a_thread_past_its_time_ends_on_the_fallback_and_the_paused_part_resumes():
    c, clock = make()
    c.next_item("done")
    c.open_thread("migration", "why", 3)
    c.set_candidate_speaking(True)
    clock.advance(300)                                           # 3 minutes plus the 2-minute fallback
    assert [o.kind for o in c.tick()] == ["move_on"]
    assert c.next_item("move_on").item_id == "candidate_intro"

def test_threads_are_limited():
    c, clock = make()
    c.next_item("done")
    assert c.open_thread("a", "w", 10)[0] and c.current().max_seconds == 360          # clamped to 6 minutes
    assert c.open_thread("b", "w") == (False, "a thread is already open: close it first")
    c.close_thread("done")
    c.open_thread("c", "w", None)
    assert c.current().max_seconds == 180                                             # 3 minutes by default
    c.close_thread("done")
    c.open_thread("d", "w")
    c.close_thread("done")
    assert c.open_thread("e", "w")[0] is False                                        # three per round
    assert c.flow_log[-1]["ok"] is False and c.flow_log[-1]["move"] == "open_thread"

def test_a_thread_gets_only_the_free_minutes_and_none_while_a_problem_is_up():
    c, clock = make()
    c.next_item("done")
    clock.advance(780)                                           # 2 free minutes left
    c.open_thread("x", "y", 3)
    assert c.current().max_seconds == 120
    c.close_thread("ok")
    c.current().turns = 5
    c.go_to(None, "done")
    assert c.current().kind == "slot" and c.open_thread("x", "y") == (False, "not while a problem is up")
```

- [ ] **Step 2:** Run these by name. Expected: FAIL (methods missing).
- [ ] **Step 3:** Implement as specified in Interfaces. Note that `free_seconds()` at `clock.advance(780)` in the
  introduction is `3600 - 780 - 2700 = 120`.
- [ ] **Step 4:** Run them: PASS. Run the full test command: no new failures.

---

### Task 4: Talker tools for the flow

**Files:**
- Modify: `apps/ai-service/app/interviewer/tools.py`:
  - `TOOLS` (lines 15-53);
  - `CONVERSATION_TOOLS` (line 57);
  - `ToolExecutor` handlers next to `_next_item` (around line 265).
- Modify: `apps/ai-service/app/interviewer/talker.py`, the call ordering (around line 236: `sorted(calls, key=lambda c: c.name != "next_item")`).
- Modify: `apps/ai-service/app/interviewer/run.py`, `_set_aside`: `moved` also counts a successful `go_to`/`close_thread`/`open_thread`.
- Test: `apps/ai-service/tests/interviewer/test_run.py`

**Interfaces:**
- Consumes: Task 3's `go_to`, `skip_goal`, `open_thread`, `close_thread` and `peek_next`.
- Produces:
  - **Tool schemas:**
    - `go_to {goal_id?: str, why: str}`, `why` required;
    - `skip_goal {goal_id: str, why: str}`, both required;
    - `open_thread {title: str, why: str, minutes?: int}`, `title` and `why` required;
    - `close_thread {why: str, goal_id?: str}`, `why` required.
  - **Constants:** `FLOW_TOOLS = frozenset({"next_item", "go_to", "skip_goal", "open_thread", "close_thread"})`, and
    `CONVERSATION_TOOLS` gains the four new names.
  - **Handler results:** each handler returns `{"ok": True, "now": <current item_id>}` or `{"ok": False, "error": <reason>}`.
    A missing `why` becomes `"no reason given"`.
  - **`_go_to` while the current item is a slot:** it delegates to `self._next_item({"reason": why})` when `goal_id` is
    empty or equals `peek_next().item_id`. Otherwise it refuses with
    "finish this problem first: call next_item when it is done".
  - **Call ordering in `talker.py`:** flow tools run first, i.e. `sorted(calls, key=lambda c: c.name not in FLOW_TOOLS)`.

- [ ] **Step 1: Write the failing tests** (they use `_in_intro` and `say` from `test_run.py` and its fakes)

```python
def test_the_interviewer_opens_a_thread_and_the_next_turn_is_on_it():
    async def go():
        run, deps, _ = await _in_intro([say("Oh, you led that migration? Tell me how it started.",
                                            tools=(("open_thread", {"title": "the monolith migration", "why": "they led it"}),)),
                                        say("And what broke first?")])
        await speak(run, "I led our move off the monolith last year")
        await speak(run, "We started with the billing service")
        return run, deps
    run, deps = asyncio.run(go())
    assert (run.conductor.current().kind, run.conductor.current().title) == ("thread", "the monolith migration")
    turn = next(t for t in deps.store.turns if t["speaker"] == "interviewer" and t["tool_calls"])
    assert turn["tool_calls"][0]["result"]["ok"] is True

def test_a_move_the_plan_refuses_is_reported_next_turn_and_breaks_nothing():
    async def go():
        run, deps, _ = await _in_intro([say("Let's jump ahead.", tools=(("go_to", {"goal_id": "nonsense", "why": ""}),
                                                                         ("skip_goal", {"goal_id": "core-1"}),
                                                                         ("open_thread", {"title": "x", "why": "y", "minutes": 0}))),
                                        say("So, tell me more.")])
        await speak(run, "Sure")
        await speak(run, "Okay")
        return run, deps
    run, deps = asyncio.run(go())
    state = deps.talker_chat.calls[1][1]["content"]
    assert "nonsense is not a part still to come" in state and run.conductor.current().kind == "thread"
```

In the second test, the `go_to` and `skip_goal` calls are refused and `open_thread` with `minutes: 0` is clamped to 1
minute and succeeds. The test proves that refusals and junk never raise.

- [ ] **Step 2:** Run the two tests: FAIL (unknown tools).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run them: PASS. Run the full test command: no new failures.

---

### Task 5: What the talker sees: the goal map, free minutes, threads, and a brief only for where it is

**Files:**
- Modify: `apps/ai-service/app/interviewer/run.py`:
  - `_view` (around lines 530-554);
  - `_next_part` (around line 594): it uses `conductor.peek_next()` for the next pending part instead of scanning items
    after the index;
  - `_on_brief` (around line 1166);
  - the interviewer `append_turn` dict (around line 998).
- Modify: `apps/ai-service/app/interviewer/conductor.py`, a new `goal_map()`.
- Modify: `apps/ai-service/app/interviewer/prompts.py`:
  - `state_block` (lines 294-365);
  - `item_details` (line 252);
  - `TALKER_RULES`.
- Test: `apps/ai-service/tests/interviewer/test_prompts.py`, `apps/ai-service/tests/interviewer/test_run.py`

**Interfaces:**
- **`Conductor.goal_map() -> list[dict]`.** One entry per pending item, in plan order:
  `{"id", "kind", "must", "about", "paused"}`. The `about` text depends on the item:
  - a phase: `PHASE_ABOUT[phase]`, where
    `PHASE_ABOUT = {"greeting": "the hello", "small_talk": "a little chat", "framing": "how the round will run", "candidate_intro": "about them", "deep_dive": "their projects in depth", "candidate_questions": "their questions for you", "wrap_up": "the closing"}`;
  - a slot: `f"coding problem {problem_number(index)}"`;
  - a filler: `f"a question on {filler['skill']}"`;
  - a thread: its title.

  `paused` is true when the item has a `started_at`.
- **`_view` gains:**
  - `"goals": conductor.goal_map()`;
  - `"free_min": int(max(0, conductor.free_seconds()) // 60)`;
  - `"thread"`: `{"title", "why"}` when the current item is a thread, else `None`;
  - `"item"` gains `"title"` and `"why"`.
- **The brief:** `_view["brief"]` is `self.brief` only when `self.brief_for == conductor.position`, else `None`. Set
  `self.brief_for = brief.for_position` in `_on_brief` whenever `self.brief` is set.
- **Turn record:** it gains `"free_min"`, and its `"brief_position"` becomes `self.brief_for` when the brief was shown,
  else `None`.
- **`state_block`:**
  - after the round-time line it adds a `## Goals` section, with one line per goal
    (`- {id} ({kind}{", must" if must}{", paused" if paused}): {about}`), then `Free minutes: {free_min}.`;
  - when a thread is open: `You are on a thread you opened: {title} ({why}). Close it with close_thread when it has done its job.`;
  - the `advance` line says "call go_to (or next_item)" in place of "call next_item".
- **`item_details`, for `kind == "thread"`:**
  `A thread you opened: {title}. Why: {why}. Keep it to about {max_min} minutes, then close_thread.`
- **`TALKER_RULES` gains, verbatim:**

```text
- You lead the path of the conversation. Follow the candidate: when they say something worth hearing out that the plan does not
  have, open a thread (open_thread, with why); when they have already covered a planned part, skip it (skip_goal, with why);
  when the plan's next part fits, go to it (go_to). Link every move with a short connecting phrase. Never leave a problem
  midway for something else. The goals and free minutes in the live state are your budget: a thread or an optional part needs
  a free minute.
```

- [ ] **Step 1: Write the failing tests**

```python
def test_the_state_lists_the_goals_without_naming_any_problem_and_the_free_minutes():
    view = {**_view_fixture(), "goals": [{"id": "core-1", "kind": "slot", "must": True, "about": "coding problem 1", "paused": False}],
            "free_min": 4, "thread": None}
    text = state_block(view)
    assert "## Goals" in text and "- core-1 (slot, must): coding problem 1" in text and "Free minutes: 4." in text

def test_the_state_says_which_thread_is_open():
    text = state_block({**_view_fixture(), "goals": [], "free_min": 2, "thread": {"title": "the migration", "why": "they led it"}})
    assert "You are on a thread you opened: the migration (they led it)." in text

def test_the_talker_rules_say_it_leads_the_path():
    assert "You lead the path of the conversation" in TALKER_RULES and "open_thread" in TALKER_RULES
```

`_view_fixture()` is whatever minimal view dict `test_prompts.py` already uses for `state_block` tests; reuse it, or add one
built from an existing test's view.

In `test_run.py`:

```python
def test_a_brief_written_before_the_interviewer_moved_is_not_shown():
    async def go():
        run, deps, clock = await _in_intro([say("Tell me more."), say("Go on.")])
        run.brief, run.brief_for = {"goal": "ask about their database choice", "next_move": {}}, run.conductor.position
        await speak(run, "I built a payments app")
        run.conductor.note_flow_move()
        await speak(run, "It used Postgres")
        return deps
    deps = asyncio.run(go())
    assert "database choice" in deps.talker_chat.calls[0][1]["content"]
    assert "database choice" not in deps.talker_chat.calls[1][1]["content"]
    turns = [t for t in deps.store.turns if t["speaker"] == "interviewer"]
    assert turns[-1]["brief_position"] is None and "free_min" in turns[-1]
```

- [ ] **Step 2:** Run the four: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run them: PASS. Run the full test command: no new failures. Prompt-text tests that pin the old
  `advance` wording are updated to the new wording.

---

### Task 6: The director follows the interviewer

**Files:**
- Modify: `apps/ai-service/app/interviewer/run.py`, `_director_messages` (around line 1095).
- Modify: `apps/ai-service/app/interviewer/prompts.py`, `director_messages` payload (lines 382-391) and `DIRECTOR_RULES`.
- Test: `apps/ai-service/tests/interviewer/test_prompts.py`, `apps/ai-service/tests/interviewer/test_run.py`

**Interfaces:**
- Consumes: `flow_log`, `threads_opened`, `free_seconds()` and `goal_map()`.
- **Snapshot:** gains
  `"flow": {"current": {"id", "kind", "title", "why"}, "moves": c.flow_log[-6:], "free_min": int(c.free_seconds() // 60), "threads_opened": c.threads_opened}`.
  `free_min` may be negative here. The payload passes it through as `"flow": snapshot.get("flow")`.
- **`DIRECTOR_RULES`:** gains, verbatim:

```text
- The interviewer leads the path: it moves between parts, skips optional ones and opens short threads of its own, and the
  payload's flow shows its moves, the ones refused and the free minutes. Write your brief for the part the conversation is on
  now. Never brief a return to a part it left or skipped unless a must-cover part is at risk, and then say so in terms of
  coverage. Use plan_changes for time and coverage: extend (also when it was refused a thread for lack of free minutes and the
  thread is worth it), move_on, wrap_up, use_reserve and reordering problems. When free minutes are low and a thread or an
  optional part runs on, say in the goal to wrap it up; move_on is behind that.
```

- [ ] **Step 1: Write the failing tests**

```python
def test_the_director_rules_say_the_interviewer_leads():
    assert "The interviewer leads the path" in DIRECTOR_RULES
```

In `test_run.py`:

```python
def test_the_director_sees_the_interviewers_moves_and_the_free_minutes():
    async def go():
        run, _, _ = await _in_intro([])
        run.conductor.open_thread("the migration", "they led it")
        return await run._director_messages()
    text = json.dumps(asyncio.run(go()))
    assert "the migration" in text and "free_min" in text and "open_thread" in text
```

- [ ] **Step 2:** Run both: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them: PASS. Run the full test command: no new failures.

---

### Task 7: The shape library and `plan_arc`

**Files:**
- Create: `apps/ai-service/app/blueprint/shapes.py`.
- Modify: `apps/ai-service/app/blueprint/models.py`: `ArcPhase` (line 244) gains `style: str = ""`, and `Blueprint` (line 417)
  gains `shape_id: str = "classic"`.
- Modify: `apps/ai-service/app/blueprint/stages.py`, `plan_arc` (lines 26-55).
- Test: `apps/ai-service/tests/blueprint/test_shapes.py` (new)

**Interfaces:**
- Produces, in `shapes.py`:
  - `@dataclass(frozen=True) class Shape` with fields:
    - `shape_id: str`;
    - `order: tuple[str, ...]` (phase names, `"core"` included);
    - `shift: dict[str, int]` (minutes moved between conversation phases, summing to 0);
    - `styles: dict[str, str]`;
    - `min_exchanges_before_coding: int`;
    - `about: str`.
  - `SHAPES: tuple[Shape, ...]`, exactly this table:

| shape_id | order | shift | styles | min_exchanges_before_coding | about |
|---|---|---|---|---|---|
| `classic` | greeting, small_talk, framing, candidate_intro, core, candidate_questions, wrap_up | {} | {} | 5 | a short chat, how the round runs, an introduction, then the coding |
| `straight_in` | greeting, framing, core, candidate_intro, candidate_questions, wrap_up | {small_talk: -2, candidate_intro: +2} | {framing: one_line, candidate_intro: after_coding} | 1 | straight to the coding after a one-line outline; the introduction comes after it |
| `resume_opener` | greeting, candidate_intro, framing, core, candidate_questions, wrap_up | {small_talk: -2, candidate_intro: +2} | {candidate_intro: pointed_resume, framing: one_line} | 2 | opens with one pointed question about their resume, then a one-line outline and the coding |
| `chat_first` | greeting, small_talk, candidate_intro, core, candidate_questions, wrap_up | {framing: -1, small_talk: +1} | {small_talk: rapport, core: with_outline} | 5 | a longer, warm chat first; the outline is folded into the move to the coding |
| `projects_first` | greeting, framing, candidate_intro, core, candidate_questions, wrap_up | {small_talk: -2, candidate_intro: +2} | {candidate_intro: one_project} | 4 | one of their projects in depth before the coding |
| `brisk` | greeting, framing, candidate_intro, core, candidate_questions, wrap_up | {small_talk: -2, candidate_questions: +2} | {candidate_intro: one_minute} | 2 | brisk and to the point: a one-minute introduction, more time for their questions |

  - `shapes_for(round_type: str, family: str) -> list[Shape]`:
    - `online-assessment`: `[classic]`;
    - family `dsa`: all six;
    - families `system-design` and `lld`: classic, straight_in, projects_first;
    - family `behavioural`: classic, resume_opener, chat_first.
  - `shape_by_id(shape_id: str | None) -> Shape`: an unknown id or `None` gives `classic`.
  - `choose_shape(seed: str, round_type: str, family: str, exclude: set[str] | frozenset[str] = frozenset()) -> Shape`:
    `random.Random` seeded from `sha256(f"shape:{seed}")`, as `name_options` does, with an equal-weight choice from
    `shapes_for(...)` minus `exclude`. When that leaves nothing, the choice is from the full `shapes_for(...)`.
- `plan_arc(ctx, core_slots, culture_slots=0, shape: Shape | None = None)`:
  1. The classic `fixed` minutes and the short-round drop rule are unchanged.
  2. With a shape, the shift is applied only when every phase it names is in `fixed`.
  3. Phases left with 0 or fewer minutes are removed.
  4. The arc follows `shape.order`, filtered to the phases present, with `style=shape.styles.get(phase, "")`.
  5. The core minutes are computed exactly as today, so they never change with the shape.

- [ ] **Step 1: Write the failing tests** (use the `Context` builder that `tests/blueprint/test_stages_and_assembly.py:32`
  uses for `plan_arc`)

```python
def test_every_dsa_shape_keeps_the_round_length_and_the_coding_minutes():
    ctx = _ctx(round_type="dsa", duration_mins=45)
    classic, per_slot, _ = plan_arc(ctx, 2)
    core = next(a.timebox_mins for a in classic if a.phase == "core")
    for shape in shapes_for("dsa", "dsa"):
        arc, slot_mins, _ = plan_arc(ctx, 2, shape=shape)
        assert sum(a.timebox_mins for a in arc) == 45 and slot_mins == per_slot
        assert next(a.timebox_mins for a in arc if a.phase == "core") == core
        assert [a.phase for a in arc] == [p for p in shape.order if p in {a.phase for a in arc}]

def test_straight_in_puts_the_introduction_after_the_coding_with_its_styles():
    arc, _, _ = plan_arc(_ctx(round_type="dsa", duration_mins=45), 2, shape=shape_by_id("straight_in"))
    assert [a.phase for a in arc] == ["greeting", "framing", "core", "candidate_intro", "candidate_questions", "wrap_up"]
    assert {a.phase: a.style for a in arc}["candidate_intro"] == "after_coding"

def test_a_short_round_that_dropped_a_shifted_phase_keeps_the_classic_minutes():
    ctx = _ctx(round_type="dsa", duration_mins=15)            # small talk and the questions are dropped: brisk's shift is not applied
    brisk = [(a.phase, a.timebox_mins) for a in plan_arc(ctx, 1, shape=shape_by_id("brisk"))[0]]
    assert brisk == [(a.phase, a.timebox_mins) for a in plan_arc(ctx, 1)[0]] and sum(m for _, m in brisk) == 15

def test_the_shape_is_seeded_varies_and_avoids_the_last_ones():
    a = choose_shape("s1", "dsa", "dsa")
    assert a == choose_shape("s1", "dsa", "dsa")
    assert len({choose_shape(f"s{i}", "dsa", "dsa").shape_id for i in range(30)}) >= 4
    assert choose_shape("s1", "dsa", "dsa", exclude={a.shape_id}).shape_id != a.shape_id
    assert choose_shape("x", "online-assessment", "dsa").shape_id == "classic"
    assert shape_by_id(None).shape_id == shape_by_id("gone").shape_id == "classic"
```

- [ ] **Step 2:** Run `.venv/bin/python -m pytest -q -p no:cacheprovider tests/blueprint/test_shapes.py`: FAIL (module missing).
- [ ] **Step 3:** Implement as specified in Interfaces. `_ctx(round_type: str = "dsa", duration_mins: int = 45) -> Context`
  is a test helper built like the `Context` in `tests/blueprint/test_stages_and_assembly.py`.
- [ ] **Step 4:** Run `tests/blueprint`: all pass (80 + new).

---

### Task 8: Prep chooses the shape, the persona fits it, and the blueprint stores it

**Files:**
- Modify: `apps/ai-service/app/blueprint/store.py`, next to `persona_names_for_candidate` (lines 187-197).
- Modify: `apps/ai-service/app/blueprint/pipeline.py`, `_pipeline` step 4 (lines 192-203) and the `Blueprint(...)` call (lines 230-237).
- Modify: `apps/ai-service/app/blueprint/stages.py`, `persona_stage` (lines 84-97).
- Modify: `apps/ai-service/app/blueprint/prompts.py`, `persona_prompt` (lines 164-180).
- Test: `apps/ai-service/tests/blueprint/test_shapes.py`, `apps/ai-service/tests/blueprint/test_stages_and_assembly.py`

**Interfaces:**
- **Store:**
  - `recent_shapes_for_candidate(candidate_id: str, exclude_session: str | None, limit: int = 2) -> list[str]` returns the
    `shape_id` of the candidate's most recent blueprints in other sessions, newest first by `created_at`, one per session.
  - `shape_for_session(session_id: str) -> str | None` returns the `shape_id` of any earlier blueprint of this session.
- **Pipeline:** the shape is chosen before `plan_arc`:
  - with a session id, `shape_by_id(await store.shape_for_session(session_id))` when that returns an id, else
    `choose_shape(seed, ctx.round_type, ctx.family, set(await store.recent_shapes_for_candidate(candidate_id, session_id)))`;
  - bench runs use `choose_shape(seed, ...)` with no exclusions.

  It is passed to `plan_arc(..., shape=shape)` and `persona_stage(..., shape=shape)`, and stored with
  `Blueprint(..., shape_id=shape.shape_id)`.
- **`persona_stage(..., shape: Shape | None = None)`:** passes `shape.about` to the prompt.
- **`persona_prompt(ctx_view, phases, names=None, shape_about: str = "")`:** when `shape_about` is set, it adds, verbatim,
  `The round's shape: {shape_about}. Write a persona whose manner fits it: brisk and direct for a round that goes straight to the work, warm and unhurried for one that starts with a longer chat.`

- [ ] **Step 1: Write the failing tests**

```python
def test_the_persona_prompt_names_the_shape():
    text = P.persona_prompt({"company": "x"}, ["greeting"], ["Arjun Mehta"], shape_about="brisk and to the point")
    assert "The round's shape: brisk and to the point." in text

def test_a_candidate_never_gets_the_shape_of_their_last_two_rounds(monkeypatch):
    async def recent(candidate_id, exclude_session, limit=2):
        return ["classic", "brisk"]
    async def none(session_id):
        return None
    monkeypatch.setattr(store, "recent_shapes_for_candidate", recent)
    monkeypatch.setattr(store, "shape_for_session", none)
    for i in range(20):
        shape = asyncio.run(pipeline.pick_shape(_ctx(), f"s{i}", "cand", f"s{i}"))
        assert shape.shape_id not in ("classic", "brisk")

def test_a_re_prepared_blueprint_keeps_its_sessions_shape(monkeypatch):
    async def same(session_id):
        return "projects_first"
    monkeypatch.setattr(store, "shape_for_session", same)
    assert asyncio.run(pipeline.pick_shape(_ctx(), "s1", "cand", "s1")).shape_id == "projects_first"

def test_a_bench_run_chooses_a_shape_without_the_store(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("bench runs do not read the store")
    monkeypatch.setattr(store, "shape_for_session", boom)
    monkeypatch.setattr(store, "recent_shapes_for_candidate", boom)
    assert asyncio.run(pipeline.pick_shape(_ctx(), "run-1", "cand", None)).shape_id in {s.shape_id for s in shapes_for("dsa", "dsa")}
```

The pipeline tests go through the smallest pipeline seam. Extract the choice into
`async def pick_shape(ctx, seed: str, candidate_id: str, session_id: str | None) -> Shape` in `pipeline.py`, call it from
`_pipeline`, and test `pick_shape` with the store functions monkeypatched (the pattern in
`tests/blueprint/test_pipeline_and_routes.py:29-39`).

- [ ] **Step 2:** Run them: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `tests/blueprint`: all pass.

---

### Task 9: The live round follows the shape

**Files:**
- Modify: `apps/ai-service/app/interviewer/plan.py`, `opening_hint` (lines 193-209), `bridge_for` (line 189) and `BRIDGES`;
  new `min_exchanges_before_coding`.
- Modify: `apps/ai-service/app/interviewer/conductor.py`:
  - `can_advance`'s background rule (around lines 351-357);
  - `problem_allowed` (around lines 365-390);
  - `_activate`'s opening texts (lines 178-203);
  - the second `opening_hint`/`BRIDGES` site (around line 512).
- Modify: `apps/ai-service/app/interviewer/run.py`, `_next_part`/`_problem_hint` (around lines 589-605).
- Modify: `apps/ai-service/app/interviewer/prompts.py`, the `BRIDGES` uses at lines 212, 218, 228 and 264, and
  `_phase_details` for `small_talk` (around line 199).
- Test: `apps/ai-service/tests/interviewer/test_plan.py`, `apps/ai-service/tests/interviewer/test_conductor.py`

**Interfaces:**
- **`min_exchanges_before_coding(blueprint) -> int`:**
  `shape_by_id(blueprint.get("shape_id")).min_exchanges_before_coding`. That is 5 for a blueprint without a shape.
- **The conductor's coding gate:** the number of exchanges counted is the sum of `turns` over non-slot items placed before
  the first slot item in `items`. It replaces `MIN_BACKGROUND_TURNS` and the `BACKGROUND_PHASES` membership tests in
  `can_advance` and `problem_allowed`. The minimum is `min_exchanges_before_coding(self.blueprint)`. The existing
  "the part's time is up" escape is kept.
- **`opening_hint(blueprint, phase, style="") -> str | None`:** returns these verbatim texts. `{probe}` is the first
  `personalization.resume_probes[].prompt` and `{hook}` the first `personalization.rapport_hooks[].line`. When the text
  needs a probe or hook that is missing, the style falls back to today's text.
  - `candidate_intro` / `pointed_resume`:
    `Ask one pointed question about something on their resume, not "tell me about yourself", for example: "{probe}".`
  - `candidate_intro` / `one_minute`: `Ask for a one-minute introduction: who they are and what they work on now.`
  - `candidate_intro` / `one_project`:
    `Ask them to walk you through one project from their resume in depth, for example: "{probe}".`
  - `candidate_intro` / `after_coding`: `Ask them to tell you a little about themselves and one project they are proud of.`
  - `framing` / `one_line`:
    `Say in one sentence that there will be some coding and then time for their questions. Nothing more about the format.`
  - `small_talk` / `rapport`: `After the chat about the call, ask one light question about their work, starting from this: "{hook}".`
- **`bridge_for(phase, style="") -> str | None`:** `STYLE_BRIDGES.get((phase, style))`, falling back to `BRIDGES.get(phase)`,
  where `STYLE_BRIDGES` is:
  - `("candidate_intro", "after_coding")`: `"Now let's talk a bit about you."`
  - `("candidate_intro", "pointed_resume")`: `"Before we get going, I was looking at your resume."`
  - `("candidate_intro", "one_project")`: `"Before the coding, I'd like to hear about one of your projects."`

  Every caller that reads `BRIDGES[...]`/`BRIDGES.get(...)` for a part passes that part's `style` through `bridge_for`.
  The callers are listed in Files.
- **`core` / `with_outline`:** the first problem's opening order (`_activate`, position > 1, slot) gains, before the
  problem line:
  `Before the problem, say in one sentence how the coding will run: about {core_minutes} minutes, then time for their questions.`
  `{core_minutes}` is the sum of the slot items' `max_seconds // 60`.
- **The icebreakers** (`plan.ICEBREAKERS`, `icebreaker()`) stay unchanged.

- [ ] **Step 1: Write the failing tests**

```python
def test_a_shape_sets_how_many_exchanges_come_before_the_coding():
    assert min_exchanges_before_coding(blueprint()) == 5
    assert min_exchanges_before_coding({**blueprint(), "shape_id": "straight_in"}) == 1

def test_the_introduction_opens_in_the_parts_style():
    bp = blueprint()
    assert "pointed question" in opening_hint(bp, "candidate_intro", "pointed_resume")
    assert "split-bill app's settlement logic" in opening_hint(bp, "candidate_intro", "pointed_resume")
    assert opening_hint(bp, "candidate_intro", "") == opening_hint(bp, "candidate_intro")
    assert bridge_for("candidate_intro", "after_coding") == "Now let's talk a bit about you."
```

In `test_conductor.py`:

```python
def test_a_straight_in_round_may_start_the_coding_after_one_exchange():
    bp = {**blueprint(), "shape_id": "straight_in"}
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    c.current().turns = 1
    assert c.problem_allowed() and c.go_to("core-1", "ready")[0]

def test_an_introduction_after_the_coding_opens_with_its_own_bridge():
    bp = {**blueprint(), "shape_id": "straight_in"}
    bp["arc"] = [bp["arc"][0], bp["arc"][2], {**bp["arc"][1], "style": "after_coding"}, *bp["arc"][3:]]
    c = Conductor(bp, 3600, clock=Clock())
    c.start()
    c.current().turns = 1
    c.next_item("done")
    c.next_item("done")
    c.next_item("done")                                      # both problems done
    assert c.current().item_id == "candidate_intro"
    order = [o for o in c.pending_orders() if o.kind == "open_item"][-1]
    assert "Now let's talk a bit about you." in order.text and "coding part is done" in order.text
```

- [ ] **Step 2:** Run them: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run them: PASS. Run the full test command: no new failures.

---

### Task 10: The judge and the bench see the shape, and the run records it

**Files:**
- Modify: `apps/ai-service/scripts/judge_blueprints.py`, `DIMENSIONS` (line 37) and `view()` (line 111).
- Modify: `apps/ai-service/app/gates/judge.py`, which holds the Jev screen's question per dimension.
- Modify: `apps/api/scripts/dev/bench-blueprints.ts`, near the persona-name tally (lines 211, 321-330).
- Modify: `apps/ai-service/app/interviewer/run.py`, the `start_run` doc (around line 217).
- Test: `apps/ai-service/tests/gates/test_judge_screen.py`

**Interfaces:**
- **Judge:**
  - `DIMENSIONS` gains `"persona_fits_shape": "The interviewer's manner (persona style and disposition) fits the round's shape: brisk for a round that goes straight to the work, warm for one that opens with a longer chat."`
  - `view()` adds `"shape": {"id": bp.get("shape_id", "classic"), "about": shape_by_id(bp.get("shape_id")).about}`.
  - `app/gates/judge.py` gains a question for the new key, so that `test_questions_cover_all_dimensions` passes.
- **Bench:** reads `shape_id` from each blueprint and prints a "Shapes used" tally next to "Interviewer names used".
- **Run record:** the `start_run` doc gains `"shape_id": (blueprint or {}).get("shape_id", "classic")`.

- [ ] **Step 1:** Run `tests/gates/test_judge_screen.py` after adding the dimension and before adding the question.
  Expected: `test_questions_cover_all_dimensions` FAILS.
- [ ] **Step 2:** Add the question. `tests/gates` passes.
- [ ] **Step 3:** Add the bench tally and the run-record field. Check with `cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json`,
  or the repo's existing typecheck for scripts if that tsconfig excludes `scripts/` (report which was used). Expected:
  no new errors in `bench-blueprints.ts`.
- [ ] **Step 4:** Run the full test command: no new failures.

---

### Task 11: Rehearsal scripts and documentation

**Files:**
- Create the scripted candidates for `python -m app.interviewer.simulate --session <id> --script <file>`, in the script-line
  format that `simulate.py` documents:
  - `apps/ai-service/scripts/flow_scenarios/unplanned_topic.txt`
  - `apps/ai-service/scripts/flow_scenarios/intro_covers_projects.txt`
  - `apps/ai-service/scripts/flow_scenarios/wanders_off.txt`
- Modify: `docs/superpowers/specs/2026-10-08-live-interviewer-design.md` and `CLAUDE.md`.

**Content:**
- **`unplanned_topic.txt`:** the candidate answers the greeting, then in the introduction says they led a monolith-to-microservices
  migration and lost a weekend to a failed cutover. Then ordinary answers through the first problem: about 12 lines plus
  `#wait` lines, then `#end`.
- **`intro_covers_projects.txt`:** the candidate's introduction describes their main project in depth, with its design and
  their role. Then ordinary answers: about 10 lines, then `#end`.
- **`wanders_off.txt`:** the candidate raises three unrelated topics in a row in the introduction (a startup idea, a
  conference, a side project). Checks the thread limit and that the coding still starts: about 12 lines, then `#end`.
- **Spec (`2026-10-08-live-interviewer-design.md`):** add a §5.8 "Interviewer-led flow (2026-10-17)" of at most 12 lines,
  pointing to `2026-10-17-interviewer-led-flow-design.md`. It states:
  - the talker's moves;
  - free minutes;
  - that briefs go stale on any move;
  - shapes.

  Mark the §5.3 lines on `converge`/`move_on` orders as superseded by §5.6.
- **`CLAUDE.md`:** at the end of the *Interview blueprint* paragraph, add one sentence: "Each round gets a shape from a fixed
  library (`app/blueprint/shapes.py`, seeded per session, never one of the candidate's last two) that orders the
  conversation around the problems; the problems, their minutes and what is assessed never change with it, and the live
  interviewer leads the path within must-cover goals and a free-minutes budget (decided 2026-10-17)."

- [ ] **Step 1:** Write the three scripts and the two documentation edits.
- [ ] **Step 2:** Validate the scripts' syntax with `simulate`'s parser, without calling any model. Load each file through
  the function `simulate.py` uses to read `--script` lines, and assert no line is reported as ignored. If that needs a
  session, report that and skip the step; the controller runs the paid rehearsal.
