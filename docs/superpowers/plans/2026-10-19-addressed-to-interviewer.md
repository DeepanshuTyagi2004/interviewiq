# Addressed-to-Interviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live interviewer stays quiet when the candidate reads the problem aloud or thinks out loud, answers when they talk to it, and asks once ("Is that one for me, or are you thinking it through?") when it cannot tell.

**Architecture:** A new module `app/interviewer/addressed.py` holds the rules, the one fast LLM check (pattern of `change_decision.py`), the per-round state and the check-in reply parser. `run.py` classifies every final candidate utterance in `on_user_text`, uses the result in `skip_reply` (sync, rules only) and at the start of `_reply` (awaits the model check for utterances the rules could not place). The web room gets an **Ask interviewer** button (new `ask.interviewer` message) and a one-line note under the problem.

**Tech Stack:** Python 3.11 / FastAPI / asyncio (ai-service), pydantic; Next.js 16 / React 19 / Vitest (web); LiveKit text messages on topic `workspace`.

**Spec:** `docs/superpowers/specs/2026-10-19-addressed-to-interviewer-design.md`

## Global Constraints

- Check model: the live talker chat (`deepseek/deepseek-v4.1-flash-1017`, setting `interviewer_talker_model`); no new model setting. Call shape: `await asyncio.wait_for(chat.json(messages, "addressed_check", SCHEMA, ADDRESSED_MAX_TOKENS), timeout_s)`; never raises.
- `ADDRESSED_TIMEOUT_S = 0.8`, `ADDRESSED_THRESHOLD = 0.6`, `ADDRESSED_MAX_TOKENS = 40`, `ADDRESSED_TEMPERATURE = 0.0`, `NUDGE_AFTER_S = 10.0`, `ASK_ARMED_S = 15.0`, `READING_LEAN_S = 60.0`.
- Env flag `ADDRESSED_CHECK`: `off | shadow | on`, default `shadow`. `off`: today's behaviour, no model call. `shadow`: classify and record, behave as today. `on`: act on it.
- Pools are fixed text from the spec, copied verbatim (24 check-in, 16 nudge, 12 reading), drawn with `LinePicker.pick` (no repeat within a round). The check-in never echoes the candidate's words.
- Every round type.
- A silence after a check-in is never treated as a question: one nudge at 10 s, nothing more.
- Owner rules: do **not** run pytest/vitest/tsc/eslint (write the tests; verification is `python -m py_compile` on changed `.py` files and review). Do **not** commit: leave changes in the working tree. Another agent may edit this repo concurrently: check the file's mtime/`git diff` before editing and re-read the region you change. Never edit `apps/ai-service/**/*.py` while prep runs are in flight (ask the controller if unsure).
- Copy: "resume" never "résumé"; UI note text exactly `Think aloud freely. I'll only answer when you ask me directly.`; button label exactly `Ask interviewer`.

## Review Focus

1. A real question the rules miss and the model times out on: must fall to the lean, and the lean for a question mark text is `unclear` (check-in), never silence. Test in Task 1 (`lean`) and Task 3.
2. The candidate answers the check-in with "yeah, what does zero decode to?": that is `for_me` and the talker answers it with the original question in history. Test in Task 1 (`answers_checkin`).
3. Reading aloud for more than two utterances: no reply on the third (the old `_skips < 2` cap must not apply to `reading_problem` / `thinking_aloud`), and no `_trailed` late answer. Test in Task 3.
4. `ADDRESSED_CHECK=off`: no model call, no behaviour change (existing tests stay valid). Test in Task 3.
5. The Ask button pressed, then nothing said for 15 s: the arm expires; the next utterance is classified normally. Test in Task 4.

---

### Task 1: Rules, pools, state and check-in reply parser

**Files:**
- Create: `apps/ai-service/app/interviewer/addressed.py`
- Modify: `apps/ai-service/app/interviewer/lines.py` (add three pools to `LINES`, line ~63)
- Test: `apps/ai-service/tests/interviewer/test_addressed.py`

**Interfaces:**
- Produces:
  - `Addressed = Literal["to_interviewer", "thinking_aloud", "reading_problem", "unclear"]`
  - `def classify_by_rules(text: str, *, last_line: str, reading: bool, typing: bool, ask_armed: bool) -> Addressed | None` — `None` means the rules cannot place it.
  - `def lean(text: str, *, since_problem_s: float | None) -> Addressed` — the fallback when the model is not asked or fails.
  - `def answers_checkin(text: str) -> Literal["thinking", "for_me"]`
  - `@dataclass class AddressedState`: `checkin_used: set[str]`, `thinking_items: set[str]`, `reading_said: set[str]`, `checkin_at: float | None = None`, `checkin_item: str | None = None`, `nudged: bool = False`, `ask_armed_until: float | None = None`; methods `to_dict() -> dict`, `@classmethod from_dict(d: dict | None) -> AddressedState` (sets become sorted lists, for the checkpoint).
  - `LINES` keys `"addressed:checkin"`, `"addressed:nudge"`, `"addressed:reading"`.

- [ ] **Step 1: Write the failing tests** in `test_addressed.py`:

```python
from app.interviewer.addressed import classify_by_rules, lean, answers_checkin, AddressedState
from app.interviewer.lines import LINES

def rules(text, last="Here's your first question. Give it a read.", reading=False, typing=False, armed=False):
    return classify_by_rules(text, last_line=last, reading=reading, typing=typing, ask_armed=armed)

def test_ask_button_and_quick_question_are_for_the_interviewer():
    assert rules("so the zero case", armed=True) == "to_interviewer"
    assert rules("quick question, can the string be empty") == "to_interviewer"

def test_reading_aloud_is_reading():
    assert rules("given a numeric string determine the number of ways", reading=True) == "reading_problem"

def test_answer_to_an_interviewer_question_is_for_the_interviewer():
    assert rules("I'd use a hash map", last="How would you store the counts?") == "to_interviewer"

def test_direct_requests_are_for_the_interviewer():
    for t in ("can you repeat that", "could you explain the second example", "is it okay if I use Java", "should I handle negatives", "sorry, what was that"):
        assert rules(t) == "to_interviewer", t

def test_self_talk_is_thinking():
    for t in ("hmm let me think", "so if I take the first two digits", "wait, that double counts", "okay so maybe I start from the end"):
        assert rules(t) == "thinking_aloud", t
    assert rules("now the loop over the string", typing=True) == "thinking_aloud"

def test_a_self_question_is_not_placed_by_rules():
    assert rules("and what could zero decode to?") is None

def test_lean():
    assert lean("what could zero decode to?", since_problem_s=20) == "unclear"       # a question never falls to silence
    assert lean("the string has digits only", since_problem_s=20) == "reading_problem"
    assert lean("the string has digits only", since_problem_s=200) == "thinking_aloud"

def test_answers_checkin():
    for t in ("no, just thinking", "I'm working it out", "not for you", "thinking out loud", "myself"):
        assert answers_checkin(t) == "thinking", t
    for t in ("yes", "yeah, what does zero decode to?", "it was for you", "yes please"):
        assert answers_checkin(t) == "for_me", t

def test_pools_are_rich_and_never_echo():
    assert len(LINES["addressed:checkin"]) == 24
    assert len(LINES["addressed:nudge"]) == 16
    assert len(LINES["addressed:reading"]) == 12
    assert "Is that one for me, or are you thinking it through?" in LINES["addressed:checkin"]

def test_state_round_trips():
    s = AddressedState(checkin_used={"core-1"}, thinking_items=set(), reading_said={"core-1"}, checkin_at=12.0, checkin_item="core-1")
    assert AddressedState.from_dict(s.to_dict()) == s
    assert AddressedState.from_dict(None) == AddressedState(set(), set(), set())
```

- [ ] **Step 2: Syntax-check** — Run: `cd apps/ai-service && .venv/bin/python -m py_compile tests/interviewer/test_addressed.py` → no output.

- [ ] **Step 3: Implement `addressed.py` rules and state, and add the pools to `LINES`.**
  - Rule order in `classify_by_rules`: `ask_armed` or `QUICK_QUESTION` (`\bquick question\b`) → `to_interviewer`; `reading` → `reading_problem`; `awaiting_answer(last_line)` (import from `app.interviewer.closing`) → `to_interviewer`; `DIRECT_REQUEST` regex (`can you|could you|would you|is it (?:ok|okay|fine|alright) if|should I|sorry|excuse me|do you mean|are we allowed|am I allowed`) → `to_interviewer`; text with `?` → `None`; `SELF_TALK` regex (leading `hmm|umm?|uh|wait|okay so|ok so|so if|let me think|let me see|maybe I|I'll|I will|I think I`) or `typing` → `thinking_aloud`; else `None`.
  - `lean`: `?` in text → `unclear`; `since_problem_s is not None and since_problem_s < READING_LEAN_S` → `reading_problem`; else `thinking_aloud`.
  - `answers_checkin`: `thinking` when it matches `\b(?:no|nope|just thinking|thinking|working (?:it|through)|myself|not (?:for|to) you|out loud|carry on|keep going)\b` and does not start with `yes|yeah|yep`; else `for_me`.
  - Pools: copy the 24 / 16 / 12 lines from the spec's "Fixed pools" section verbatim into `LINES` (tuples).

- [ ] **Step 4: Syntax-check** both files with `py_compile` → no output.

---

### Task 2: The model check, config flag and wiring

**Files:**
- Modify: `apps/ai-service/app/interviewer/addressed.py`
- Modify: `apps/ai-service/app/config.py` (beside `interviewer_warm_up`, line ~252)
- Modify: `apps/ai-service/app/interviewer/run.py` (`RunDeps`, line ~207)
- Modify: `apps/ai-service/app/interviewer/worker.py` (where `RunDeps(...)` is built)
- Modify: `apps/ai-service/.env.example`
- Test: `apps/ai-service/tests/interviewer/test_addressed.py`

**Interfaces:**
- Consumes: `Addressed`, `lean` (Task 1).
- Produces:
  - `async def classify_by_model(chat: Any, *, last_line: str, text: str, phase: str, problem_excerpt: str, typing: bool, recent: list[str], since_problem_s: float | None, timeout_s: float = ADDRESSED_TIMEOUT_S) -> tuple[Addressed, float, str]` — returns `(result, confidence, source)` with `source` `"model"` or `"fallback"`. A model answer with confidence below `ADDRESSED_THRESHOLD` becomes `unclear`; an answer outside the four values, a timeout or any exception returns `(lean(text, since_problem_s=since_problem_s), 0.0, "fallback")`.
  - `SCHEMA = {"type": "object", "properties": {"addressed": {"enum": [the four values]}, "confidence": {"type": "number"}}, "required": ["addressed", "confidence"]}`; `PROMPT` (short, versioned `ADDRESSED_PROMPT_VERSION = "a1"`): the four labels with one example each, "a question the candidate asks themselves while working is thinking_aloud only when it is clearly rhetorical; when in doubt answer unclear", JSON only.
  - `Settings.addressed_check: Literal["off", "shadow", "on"] = Field("shadow", alias="ADDRESSED_CHECK")`
  - `RunDeps.addressed_mode: str = "off"` (default off so existing tests and the simulator are unchanged); `worker.py` passes `settings.addressed_check`.

- [ ] **Step 1: Write the failing tests** (reuse the fake `Chat` pattern of `tests/interviewer/test_change_decision.py:146`: `answer`, `delay`, `error`, `async json(messages, schema_name, schema, max_tokens)` returning `(answer, {})`):

```python
import asyncio, time
from app.interviewer.addressed import classify_by_model

def run_model(chat, text="what could zero decode to?", since=20.0):
    return asyncio.run(classify_by_model(chat, last_line="Here's your first question.", text=text, phase="coding",
                                         problem_excerpt="Decode Ways ...", typing=False, recent=[], since_problem_s=since))

def test_model_answer_is_used():
    assert run_model(Chat({"addressed": "thinking_aloud", "confidence": 0.9})) == ("thinking_aloud", 0.9, "model")

def test_low_confidence_becomes_unclear():
    assert run_model(Chat({"addressed": "thinking_aloud", "confidence": 0.4}))[0] == "unclear"

def test_timeout_and_errors_fall_back_to_lean():
    t = time.monotonic()
    assert run_model(Chat({"addressed": "to_interviewer", "confidence": 1}, delay=3.0)) == ("unclear", 0.0, "fallback")
    assert time.monotonic() - t < 1.0
    assert run_model(Chat(error=RuntimeError("boom")), text="the input is digits", since=10) == ("reading_problem", 0.0, "fallback")
    assert run_model(Chat({"addressed": "banana", "confidence": 1}))[2] == "fallback"
```

- [ ] **Step 2: Syntax-check** the test file.
- [ ] **Step 3: Implement** `classify_by_model` (temperature via `chat.with_temperature(ADDRESSED_TEMPERATURE)` when the chat has it, as `run.py:_decide_change` does), the setting, the `RunDeps` field, the worker wiring, and `ADDRESSED_CHECK=shadow` with a one-line comment in `.env.example`.
- [ ] **Step 4: Syntax-check** all changed files.

---

### Task 3: Run integration (silence, check-in, nudge, reading line, record)

**Files:**
- Modify: `apps/ai-service/app/interviewer/run.py` — `on_user_text` (~482), `_note_request` call (~515), `skip_reply` (~662), `_reply` start (~1267, beside the `swap` branch ~1428 as the pattern for a fixed line said by the run), `tick` (~2015), checkpoint save/restore (where `pastes` / `proctor` are written and restored, ~1952 / ~1984)
- Test: `apps/ai-service/tests/interviewer/test_run_addressed.py` (builder `make` and helpers `speak`, `web` from `tests/interviewer/test_run.py`; fakes `say`, `FakeChat`, `FakeSpeaker` from `tests/interviewer/fakes.py`; `Clock.advance` from `fixtures.py`)

**Interfaces:**
- Consumes: Task 1 and Task 2 API; `RunDeps.addressed_mode`.
- Produces (on `InterviewRun`): `self.addressed: AddressedState`; `self._addressed_now: tuple[Addressed | None, asyncio.Task | None]` for the current utterance; `self._problem_shown_at: float | None` (set when `show_problem` succeeds).

Behaviour (mode `on`; in `shadow` everything is classified and recorded but the reply path is today's; in `off` nothing runs):

1. `on_user_text`: if the last interviewer line is a check-in line (`text in LINES["addressed:checkin"]` for the last spoken interviewer turn) → `answers_checkin`: `thinking` adds the item to `thinking_items` and the utterance is `thinking_aloud`; `for_me` makes it `to_interviewer`. Either way clears `checkin_at`. Otherwise `classify_by_rules(..., reading=self._reading_the_problem(text, item), typing=self._typing_recently(), ask_armed=<armed and not expired>)`; a rule result of `None` starts `classify_by_model` as a task (talker chat, as `_decide_change` picks it). `unclear`/`thinking_aloud` on an item in `thinking_items` becomes `thinking_aloud`. Disarm the Ask button after use.
2. `_note_request` runs only when the rule result is not `reading_problem` / `thinking_aloud` (today it runs on every utterance).
3. `skip_reply`: a rule result `reading_problem` / `thinking_aloud` → skip **without** the `_skips < 2` cap and without setting `_trailed`; for `reading_problem` on an item not in `reading_said`, back-channel one `addressed:reading` line (via `self.speaker.backchannel`) and add the item; otherwise no sound.
4. `_reply` start: when a model task is pending, `await` it (its own timeout bounds the wait). Result `to_interviewer` → today's reply. `reading_problem` / `thinking_aloud` → say nothing and end the turn as the silent path does. `unclear` → if the item is in `checkin_used`, treat as `thinking_aloud`; else say one `addressed:checkin` line as a fixed line (mirror the `swap` branch: `self.talker.last = TurnResult(spoken=[line])`, yield it, return), add the item to `checkin_used`, set `checkin_at = clock()`, `checkin_item`, `nudged = False`.
5. `tick`: when `checkin_at` is set, `now - checkin_at >= NUDGE_AFTER_S`, not `nudged`, nobody speaking and no candidate turn open → back-channel one `addressed:nudge` line, `nudged = True`. Never `_speak_soon` for it.
6. Record: `self._spawn(self.d.store.update_turn(self.session_id, <candidate seq>, {"addressed": {"result", "source" ("rules"|"model"|"fallback"|"checkin_reply"), "confidence", "ms", "mode"}}))`.
7. Checkpoint: `addressed` saved with `self.addressed.to_dict()` and restored with `AddressedState.from_dict`.

- [ ] **Step 1: Write the failing tests** in `test_run_addressed.py` (each builds a run with `make(..., addressed_mode="on")` and, where a model answer is needed, `deps.talker_chat` scripted with a `json` answer, or a run-level fake like `Slow` in `test_change_decision.py:307` keyed on schema name `"addressed_check"`):
  - `test_reading_aloud_three_times_gets_no_reply`: problem on screen, three utterances made of statement words → `run.skip_reply(text)` is True each time; `speaker.replies == 0`; exactly one back-channel, from `LINES["addressed:reading"]`.
  - `test_unclear_gets_one_checkin_then_nudge_once`: model answers `unclear` → the reply yields one line from `LINES["addressed:checkin"]`; `clock.advance(10)`; `await run.tick()` → one back-channel from `LINES["addressed:nudge"]`; `clock.advance(30)`; `tick` again → no second nudge and `speaker.replies` unchanged (silence is not a question).
  - `test_checkin_answer_thinking_silences_the_problem`: after a check-in, "just thinking" → no reply; a later `unclear` on the same problem → no second check-in.
  - `test_checkin_answer_for_me_gets_a_reply`: after a check-in, "yes" → the talker is asked (`speaker.replies`/talker call count rises).
  - `test_model_timeout_question_gets_checkin_not_silence`: model delays past the timeout on "what could zero decode to?" → check-in line said.
  - `test_reading_does_not_fire_the_constraints_reveal`: a read-aloud containing "constraints" → no `reveal_request` order (`run.conductor.pending_orders()` has none).
  - `test_off_mode_changes_nothing`: `addressed_mode="off"` → no `json` call on the chat, and `skip_reply` for a read-aloud follows today's cap (third utterance not skipped).
  - `test_shadow_records_but_replies`: `addressed_mode="shadow"`, model says `thinking_aloud` → the talker still replies; the candidate turn in `MemoryStore` has `addressed.result == "thinking_aloud"`.
- [ ] **Step 2: Syntax-check** the test file.
- [ ] **Step 3: Implement** items 1-7 above in `run.py`.
- [ ] **Step 4: Syntax-check** `run.py`.

---

### Task 4: Ask interviewer button, the note, and the `ask.interviewer` message

**Files:**
- Modify: `apps/web/features/interview-live/protocol/messages.ts` (web message union, near the proctor schemas ~145)
- Modify: `apps/ai-service/app/interviewer/protocol.py` (add model beside `ProctorBack` ~271; add to `_WEB_MODELS` ~374)
- Modify: `apps/ai-service/app/interviewer/run.py` (`on_web_message` ~1971)
- Modify: `apps/web/features/interview-live/controls/BottomBar.tsx` (button between mic and End, after line ~41)
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx` (~67, wire `onAsk`)
- Modify: `apps/web/features/interview-live/panel/ProblemPanel.tsx` (note as first child of the body div, before `<Statement>` ~127)
- Test: `apps/web/features/interview-live/controls/RoomChrome.test.tsx`, `apps/web/features/interview-live/panel/ProblemPanel.test.tsx`, `apps/web/features/interview-live/protocol/messages.test.ts`, `apps/ai-service/tests/interviewer/test_run_addressed.py`

**Interfaces:**
- Consumes: `AddressedState.ask_armed_until` (Task 1), `ASK_ARMED_S` (Global Constraints).
- Produces: web message `{ type: "ask.interviewer", at: number }` (TS zod schema `AskInterviewer`, Python `class AskInterviewer(_Msg): type: Literal["ask.interviewer"]; at: int = Field(ge=0)`); `BottomBar` prop `onAsk: () => void`.

- [ ] **Step 1: Write the failing tests**
  - `RoomChrome.test.tsx`: `render(<BottomBar micOn stream={null} onToggleMic={vi.fn()} onEnd={vi.fn()} onAsk={onAsk} />)`; click `getByRole("button", { name: "Ask interviewer" })`; `expect(onAsk).toHaveBeenCalledTimes(1)`.
  - `ProblemPanel.test.tsx`: once a problem is shown, `getByText("Think aloud freely. I'll only answer when you ask me directly.")` is present; absent before any problem.
  - `messages.test.ts`: `{ type: "ask.interviewer", at: 1 }` parses as a web message.
  - `test_run_addressed.py`: `test_ask_button_arms_for_15_seconds`: `await run.on_web_message(web({"type": "ask.interviewer", "at": 1}))` then an utterance that rules call `thinking_aloud` → treated `to_interviewer` (talker replies); arm again, `clock.advance(16)`, same utterance → `skip_reply` True.
- [ ] **Step 2: Syntax-check** the Python test (`py_compile`); the TS tests are reviewed, not run.
- [ ] **Step 3: Implement** the message on both sides, `on_web_message` setting `ask_armed_until = clock() + ASK_ARMED_S`, the `BottomBar` button (`Button variant="ghost"` from `@/components/ui/button`, label `Ask interviewer`), `LiveView` wiring `onAsk={() => session.send({ type: "ask.interviewer", at: Date.now() })}`, and the note in `ProblemPanel` (`text-[12.5px] text-ink-3`, one line). If `apps/web/scripts/generate-live-schema.ts` emits a file the ai-service reads or tests against, run `pnpm --filter web generate:live-schema` after the TS change (this is codegen, not a test run).
- [ ] **Step 4: Syntax-check** changed Python files.

---

### Task 5: Trace, evaluation and docs

**Files:**
- Modify: `apps/ai-service/app/interviewer/trace.py` (`render`, line ~17)
- Modify: `apps/ai-service/app/evaluation/prompts.py` (`_RULES`, the line about clarifying questions)
- Modify: `CLAUDE.md` (Module 03 / blueprint paragraph: one sentence on the addressed check)
- Test: `apps/ai-service/tests/interviewer/test_trace.py` (create if absent; else add to the existing trace test file)

**Interfaces:**
- Consumes: the `addressed` field on candidate turns (Task 3).

- [ ] **Step 1: Write the failing test** `test_render_shows_addressed`: a candidate turn with `{"addressed": {"result": "thinking_aloud", "source": "model", "confidence": 0.8, "ms": 420, "mode": "on"}}` renders a line containing `addressed: thinking_aloud (model 0.80, 420 ms)`.
- [ ] **Step 2: Syntax-check** the test.
- [ ] **Step 3: Implement** the trace line; add to the grader `_RULES`: "Thinking aloud, reading the problem aloud, and answering the interviewer's 'is that one for me?' check are normal: never a help request, a bug or a weakness."; add the CLAUDE.md sentence: "The interviewer tells talk to it from thinking aloud and reading aloud (`app/interviewer/addressed.py`, `ADDRESSED_CHECK` off|shadow|on, default shadow): rules first, one fast check on the talker model for the rest, a fixed check-in line once per problem when unclear, a nudge after 10 s of silence; the room has an Ask interviewer button (decided 2026-10-19)."
- [ ] **Step 4: Syntax-check** changed Python files.

---

## Self-review notes

- Spec coverage: rules (T1), model check + flag (T2), behaviour table, once-per-problem, thinking flag, 10 s nudge, detectors gated, ties to check-in (T3), pools (T1), UI note + Ask button (T4), trace + evaluation not penalising (T5), shadow rollout (T2/T3). The transition fix in the spec is already implemented (2026-10-19) and is not in this plan.
- Deviation from the spec, flagged for the owner: the spec runs the check in parallel with the reply and cancels the reply. This plan awaits the check (≤ 0.8 s) before starting the talker, and only for utterances the rules cannot place. Cancelling a half-run reply risks leaving the turn's bookkeeping (held tools, owed orders, turn records) half-done; the cost is up to 0.8 s extra latency on those utterances only.
