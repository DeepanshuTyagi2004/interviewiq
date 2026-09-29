# Agent Diagnostics — Slice 2 Implementation Plan (reasoning capture + canvas)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the Agent Diagnostics tab: capture the LLM's raw `<thought>` reasoning per decision, fold the opening phase into turn 0 (+ tap `opening_classify` and emit `scope` on pivot turns), and add the `@xyflow/react` pipeline canvas with a click-to-inspect detail drawer + per-turn notes.

**Architecture:** Builds on Slice 1 (merged to `main`/`master`). Three parts: (A) an isolated `<thought>` capture seam at `llm/client.py::complete` writing to a contextvar keyed by the op's base label, attached to steps by the emitter — inert on the production path; (B) an opening-turn-model refactor moving turn-opening from the transport to an `emit.begin_turn(kind)` signal so opening exchanges fold into turn 0, plus `opening_classify`/`scope`/`derive` taps; (C) a `@xyflow/react` v12 canvas rendering the fixed pipeline per selected turn with a detail drawer.

**Tech Stack:** Python 3.11 / FastAPI / pytest (ai-service); Next.js 16.2.6 / React 19.2.4 / `@xyflow/react` v12 / TanStack Query / Vitest + Testing Library (frontend).

## Global Constraints

- **No brain decision-logic changes.** All new taps/thought-capture are inert when the diagnostic contextvar is unbound (production `run_session`). The `tests/interview_agent` slice + full suite must stay green.
- **ai-service regression floor:** `.venv/bin/python -m pytest -q` = 399 passed, 1 PRE-EXISTING fail (`tests/test_config.py::test_interview_settings_have_defaults`, env-leak). No NEW failures; new tests raise the count.
- **frontend gates:** `npx tsc --noEmit` clean (NO `npm run typecheck` script); `npm test` (= `vitest run`) green; `npm run build` succeeds. React-flow is client-only → mount via `dynamic(..., { ssr: false })` (precedent: `features/interview-live/work/DiagramBoard.tsx:9-10`).
- **`@xyflow/react` v12** (named import `{ ReactFlow }`, NOT default; renamed from `reactflow`). User pre-approved this dependency in the Slice-1 brainstorm.
- **AgentStep.status enum:** `pending|running|ok|failed|skipped`. Session status: `running|awaiting_input|completed|failed|abandoned|aborted`.
- **Branches:** create `feat/agent-diagnostics-slice2` off `main` in `interviewiq-ai-service` and `interviewIQ-frontend` (Slice 1 is merged to `main`). No backend changes in Slice 2 (the proxy passes `thought` through 1:1 already — `JsonNode`).
- **Spec:** `interviewiq-backend/docs/superpowers/specs/2026-07-07-agent-diagnostics-design.md` (§6.2 opening turn 0, §6.4 thought seam, §8.3 canvas). Slice-1 backlog is in the ai-service/backend `.superpowers/sdd` ledgers.

---

## File Structure

**ai-service (`interviewiq-ai-service`)**
- Modify `app/llm/client.py` — in `complete()`, after `extract_thought(content)`, write the thought to a per-session contextvar keyed by the op's base label (strip `#N`). Guarded/no-op when unbound.
- Modify `app/interview_agent/diagnostics_emit.py` — add a `thoughts` contextvar (`ContextVar[dict|None]`), `record_thought(label, thought)`, and make `step_end` attach `detail["thought"]` for the step's `llm_label`; add `begin_turn(kind)`.
- Modify `app/jobs/agent_sessions.py` — add `set_pending_candidate(...)` + `open_turn` driven by `begin_turn` (pending candidate); keep the seeded opening turn 0 step-bearing.
- Modify `app/interview_agent/diagnostic_transport.py` — `next_utterance` records pending candidate + transcript instead of calling `open_turn("main")`; silence still handled (via `begin_turn("silence")` from session).
- Modify `app/interview_agent/session.py` — `emit.begin_turn("main")` at main-loop top; `emit.begin_turn("silence")` on the silence branch; tap `opening_classify` in `_run_opening`; emit `scope` as `ok` on pivot turns; emit a `derive` step in `_apply_action` for PIVOT_DERIVE.
- Tests: extend `tests/interview_agent/test_diagnostics_emit.py`, `tests/interview_agent/test_diagnostic_runner.py`, `tests/jobs/test_agent_sessions.py`, add `tests/llm/test_thought_capture.py`.

**frontend (`interviewIQ-frontend`)**
- Add dep `@xyflow/react`.
- Create `app/(app)/intelligence/_components/agent/PipelineCanvas.tsx` (react-flow, dynamic ssr:false wrapper + inner) + `PipelineNode.tsx` (custom node) + `stepStatusColor.ts`.
- Create `app/(app)/intelligence/_components/agent/StepDetailDrawer.tsx` (renders a step's detail incl. `thought`).
- Modify `app/(app)/intelligence/_components/AgentDiagnosticsPanel.tsx` — mount canvas, add a turn selector + per-turn notes state; pass notes to `sessionToMarkdown`.
- Modify `app/(app)/intelligence/_components/agent/markdownExport.ts` — add `thought` + `prompt_system` per step.
- Modify `lib/constants/observability/index.ts` — `encodeURIComponent` the id builders (deferred minor).
- Tests: `PipelineCanvas`/`StepDetailDrawer` component tests, extend `markdownExport.test.ts`.

---

## Part A/B — ai-service

### Task S2-0: Branch + baseline
- [ ] **Step 1:** `cd /Users/salescode/Desktop/project/interviewiq-ai-service && git checkout main && git pull --ff-only 2>/dev/null; git checkout -b feat/agent-diagnostics-slice2 && git branch --show-current` → `feat/agent-diagnostics-slice2`.
- [ ] **Step 2:** `.venv/bin/python -m pytest -q` → record baseline (expect 399 passed, 1 pre-existing `test_config` fail). Regression floor.

---

### Task S2-1: `<thought>` capture seam

**Files:**
- Modify: `app/interview_agent/diagnostics_emit.py`
- Modify: `app/llm/client.py`
- Test: `tests/llm/test_thought_capture.py`, extend `tests/interview_agent/test_diagnostics_emit.py`

**Interfaces:**
- Consumes: `client.complete` (returns `(data, thought)`, threads `label`), the emitter's contextvar pattern.
- Produces:
  - `diagnostics_emit._thoughts: ContextVar[dict[str,str] | None]` (default `None`).
  - `diagnostics_emit.bind_emitter` also resets a fresh `{}` thoughts dict (bind returns both tokens or a small object); `unbind_emitter` clears both.
  - `diagnostics_emit.record_thought(label: str, thought: str) -> None` — no-op when unbound; strips a trailing `#N` from `label`; stores `thoughts[base] = thought` (last-write-wins).
  - `step_end(status, detail)` — when the current step has an `llm_label`, and `thoughts` has an entry for it, sets `detail.setdefault("thought", thoughts[llm_label])`. (The store's `end_step` merges detail; emitter must know the current step's `llm_label` — pass it, see below.)

- [ ] **Step 1: Write failing test — thought captured & keyed by base label, inert when unbound**

```python
# tests/interview_agent/test_diagnostics_emit.py  (append)
def test_record_thought_noop_when_unbound():
    from app.interview_agent import diagnostics_emit as emit
    emit.record_thought("iv-classify#1", "because X")   # must not raise, no state

def test_thought_attaches_to_llm_step_by_base_label(monkeypatch):
    from app.interview_agent import diagnostics_emit as emit
    from app.jobs.agent_sessions import AgentSessionStore
    store = AgentSessionStore(); store.start("r", {}, label="x")
    monkeypatch.setattr(emit, "AGENT_SESSIONS", store)
    tok = emit.bind_emitter("r")
    try:
        emit.step_begin("classify", llm_label="iv-classify")
        emit.record_thought("iv-classify#2", "chose answer because it addressed the prompt")  # #N stripped
        emit.step_end("ok", {"decision": "answer"})
    finally:
        emit.unbind_emitter(tok)
    step = store.snapshot("r", 0)["turns"][0]["steps"][-1]
    assert step["detail"]["thought"] == "chose answer because it addressed the prompt"
    assert step["detail"]["decision"] == "answer"
```

- [ ] **Step 2: Run → FAIL** (`record_thought`/thoughts contextvar not defined, or thought not attached).

- [ ] **Step 3: Implement in `diagnostics_emit.py`** (the emitter must remember the current step's `llm_label` so `step_end` can look up its thought). Simplest: track it in a contextvar alongside.

```python
# diagnostics_emit.py  — add near _current
_thoughts: "contextvars.ContextVar[dict | None]" = contextvars.ContextVar("diag_thoughts", default=None)
_cur_label: "contextvars.ContextVar[str | None]" = contextvars.ContextVar("diag_cur_label", default=None)

def bind_emitter(run_id: str):
    _thoughts.set({})                 # fresh per session
    return _current.set(run_id)

def unbind_emitter(token) -> None:
    _current.reset(token)
    _thoughts.set(None)

def record_thought(label: str, thought: str) -> None:
    d = _thoughts.get()
    if d is None or not thought:
        return
    base = label.split("#", 1)[0]     # "iv-classify#2" -> "iv-classify"
    d[base] = thought

def step_begin(name, llm_label=None) -> None:
    rid = _rid()
    if rid is not None:
        _cur_label.set(llm_label)
        AGENT_SESSIONS.begin_step(rid, name, llm_label=llm_label)

def step_end(status, detail) -> None:
    rid = _rid()
    if rid is None:
        return
    label = _cur_label.get()
    thoughts = _thoughts.get() or {}
    if label and label in thoughts:
        detail = {**(detail or {}), "thought": thoughts[label]}
    AGENT_SESSIONS.end_step(rid, status, detail)
    _cur_label.set(None)
```

- [ ] **Step 4: Wire `client.complete` to record the thought** — in `app/llm/client.py::complete`, at the return site where `extract_thought(content)` is computed (client.py:233 `return data, extract_thought(content)`), record it first. Import lazily to avoid a cycle (client.py must not hard-depend on interview_agent):

```python
# client.py complete(): replace the return that computes the thought
thought = extract_thought(content)
try:
    from app.interview_agent import diagnostics_emit as _emit
    _emit.record_thought(label, thought)      # no-op unless a diagnostic session is bound
except Exception:
    pass
return data, thought
```

> Verify the exact return line (client.py:233) and that `label` is in scope there (it is — `complete(self, system, user, *, label="llm")`). `complete_json` calls `complete(..., label=label)` and discards the thought, but `record_thought` already fired inside `complete`, so `complete_json`-based ops (all `llm_ops`) still capture. The `try/except Exception` keeps the LLM path bulletproof if the import/emit ever fails.

- [ ] **Step 5: Write failing integration test — a stubbed op's thought lands on its step**

```python
# tests/llm/test_thought_capture.py
import asyncio
from app.llm.client import extract_thought

def test_extract_thought_pulls_think_block():
    assert extract_thought("<thought>reasoning here</thought>{\"x\":1}") == "reasoning here"
    assert extract_thought("no blocks") == ""
```
(The end-to-end "op → step.thought" path is covered by the emitter test in Step 1 + a driver assertion added to `test_diagnostic_runner.py` in S2-2; keep this file to the pure `extract_thought` contract.)

- [ ] **Step 6: Run tests + full suite**

Run: `.venv/bin/python -m pytest tests/interview_agent/test_diagnostics_emit.py tests/llm/test_thought_capture.py -q && .venv/bin/python -m pytest -q`
Expected: new tests pass; full suite stays 399 passed / 1 pre-existing (no NEW failures — production `complete` records into an unbound (None) contextvar → no-op).

- [ ] **Step 7: Commit**

```bash
git add app/interview_agent/diagnostics_emit.py app/llm/client.py tests/llm/test_thought_capture.py tests/interview_agent/test_diagnostics_emit.py
git commit -m "feat(agent-diag): capture LLM <thought> per decision via contextvar keyed by op label"
```

---

### Task S2-2: Opening-turn model — fold opening into turn 0; tap opening_classify / scope / derive

**Files:**
- Modify: `app/jobs/agent_sessions.py`, `app/interview_agent/diagnostics_emit.py`, `app/interview_agent/diagnostic_transport.py`, `app/interview_agent/session.py`
- Test: extend `tests/jobs/test_agent_sessions.py`, `tests/interview_agent/test_diagnostic_runner.py`

**Interfaces:**
- Produces:
  - `AgentSessionStore.set_pending_candidate(run_id, candidate_text, artifact_present_this_turn, artifact_available, elapsed_s_at_turn) -> None` — stashes the next turn's candidate context.
  - `AgentSessionStore.open_pending_turn(run_id, kind) -> int` — opens a turn using the stashed pending candidate (clears it); if no pending (e.g. silence with no candidate), opens with `candidate_text=None`.
  - `diagnostics_emit.begin_turn(kind: str) -> None` — no-op when unbound; else `AGENT_SESSIONS.open_pending_turn(rid, kind)`.
- Consumes: the transport (stops calling `open_turn("main"/"silence")`), `session.py` main loop + `_run_opening`.

**Behavior target (spec §6.2):** the seeded turn 0 (`kind:"opening"`) holds the opening exchange (GREET/RAPPORT/ORIENT transcript + `opening_classify` steps). Real interview turns open at index ≥1 via `emit.begin_turn("main")`. Silence windows open `kind:"silence"` turns via `emit.begin_turn("silence")`. No empty `"main"` turns for opening replies.

- [ ] **Step 1: Write failing store test (pending → open_pending_turn)**

```python
# tests/jobs/test_agent_sessions.py (append)
def test_pending_candidate_opens_turn_on_begin():
    from app.jobs.agent_sessions import AgentSessionStore
    s = AgentSessionStore(); s.start("r", {}, label="x")
    s.set_pending_candidate("r", "my answer", True, True, 60.0)
    idx = s.open_pending_turn("r", "main")
    assert idx == 1
    t = s.snapshot("r", 0)["turns"][1]
    assert t["kind"] == "main" and t["candidate_text"] == "my answer"
    assert t["artifact_present_this_turn"] is True and t["elapsed_s_at_turn"] == 60.0
    # pending cleared: a second open with no pending yields candidate_text None
    idx2 = s.open_pending_turn("r", "silence")
    assert s.snapshot("r", 0)["turns"][idx2]["candidate_text"] is None
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement store `set_pending_candidate` + `open_pending_turn`** (reuse existing `open_turn` internals; store `_pending` per run). Keep the existing `open_turn` (still used by tests) but have `open_pending_turn` consume `_pending` then reset it. Guard on unknown run_id (no-op / return -1) per the existing convention.

- [ ] **Step 4: Add `emit.begin_turn`** in `diagnostics_emit.py`:

```python
def begin_turn(kind: str) -> None:
    rid = _rid()
    if rid is not None:
        AGENT_SESSIONS.open_pending_turn(rid, kind)
```

- [ ] **Step 5: Transport — record pending instead of opening the turn.** In `diagnostic_transport.py::next_utterance`:
  - `_TurnInput` branch: keep the transcript append + clock/artifact logic, but replace `self._store.open_turn(self._run_id, "main", item.text, present, self._artifact is not None, self._clock)` with `self._store.set_pending_candidate(self._run_id, item.text, present, self._artifact is not None, self._clock)`.
  - `_SILENCE` branch: replace `open_turn(..., "silence", ...)` with `set_pending_candidate(self._run_id, None, False, self._artifact is not None, self._clock)`.
  (The turn is now opened by `emit.begin_turn` from the session, so the emitter — which is bound in the runner's task — controls turn boundaries.)

- [ ] **Step 6: session.py taps.** (a) Main loop: immediately after `item = await transport.next_utterance()` and the `None`/silence branch split, call `emit.begin_turn("main")` for a real utterance (before `emit.step_begin("classify"...)` at :435), and `emit.begin_turn("silence")` on the silence path. (b) Scope-on-pivot: replace the `if turn_class != TurnClass.PIVOT_REQUEST: emit.step_skipped("scope")` (session.py:442-443) with: emit a real `scope` step on pivot (`emit.step_begin("scope"); emit.step_end("ok", {"decision": topic_scope.value, "requested_topic": requested_topic, "branch_reason": f"cross-round guard: {topic_scope.value}"})`), else `emit.step_skipped("scope")`. (c) Opening: in `_run_opening`, wrap the `classify_opening_turn` call (session.py:342) with `emit.step_begin("opening_classify", llm_label="iv-opening-classify")` / `emit.step_end("ok", {"decision": intent})` — these attach to turn 0. (d) `_apply_action` PIVOT_DERIVE: around the `derive_ladder` call, emit `emit.step_begin("derive", llm_label="iv-derive")` / `emit.step_end("ok", {...})` so the derive op's thought (from S2-1) attaches.

- [ ] **Step 7: Write failing driver test — opening folds into turn 0, main turns carry steps, scope on pivot**

```python
# tests/interview_agent/test_diagnostic_runner.py (append) — uses the _install_stubs harness
# Drive a scripted session: assert turns[0].kind == "opening" and has an opening_classify step;
# the first real answer opens turns[1] kind "main" with classify/grade/pacing/route/action;
# a pivot turn has a "scope" step with status "ok" (not skipped).
```
(Reuse the `_install_stubs` + `minimal_plan` fixtures from Slice 1; set `opening_intent="ready"` so opening ends after one exchange, then feed a main answer + a pivot request.)

- [ ] **Step 8: Run driver + store tests + FULL suite** — new tests pass; full suite stays 399/1 pre-existing; the whole `tests/interview_agent` slice stays green (the taps are inert unbound; the transport change is only exercised under the diagnostic runner).

- [ ] **Step 9: Commit**

```bash
git add app/jobs/agent_sessions.py app/interview_agent/diagnostics_emit.py app/interview_agent/diagnostic_transport.py app/interview_agent/session.py tests/
git commit -m "feat(agent-diag): fold opening into turn 0 (begin_turn signal) + opening_classify/scope/derive taps"
```

---

## Part C — frontend

### Task S2-3: `@xyflow/react` PipelineCanvas + node + status colors

**Files:**
- Modify: `package.json` (add `@xyflow/react`)
- Create: `app/(app)/intelligence/_components/agent/PipelineCanvas.tsx`, `PipelineNode.tsx`, `stepStatusColor.ts`
- Test: `app/(app)/intelligence/_components/agent/PipelineCanvas.test.tsx`

**Interfaces:**
- Consumes: `AgentTurn`/`AgentStep` (`@/features/agent-diagnostics`), `RunStepStatus`.
- Produces: `PipelineCanvas({ turn, onSelectStep })` — renders the fixed pipeline for one `AgentTurn`, coloring each node from that turn's `steps[].status` (a step absent from the turn → `idle`), calling `onSelectStep(step)` on node click.

- [ ] **Step 1: Install the dep**

Run: `cd /Users/salescode/Desktop/project/interviewIQ-frontend && npm install @xyflow/react`
Expected: adds `@xyflow/react` (v12) to dependencies. Commit `package.json` + lockfile with this task.

- [ ] **Step 2: `stepStatusColor.ts` + failing test**

```ts
// stepStatusColor.ts
import type { RunStepStatus } from "@/features/observability";
export const STEP_STATUS_COLOR: Record<RunStepStatus | "idle", string> = {
  idle: "#e5e7eb", pending: "#e5e7eb", running: "#fde68a", ok: "#86efac", failed: "#fca5a5", skipped: "#d1d5db",
};
export const PIPELINE_STEPS = ["stt","classify","scope","grade","pacing","route","action","tts"] as const;
```
```ts
// PipelineCanvas.test.tsx — assert a node reflects its step status; a missing step → idle
```

- [ ] **Step 3: `PipelineNode.tsx` (custom node) + `PipelineCanvas.tsx`** — react-flow v12 (named import `{ ReactFlow }`), CSS import `@xyflow/react/dist/style.css`, `nodeTypes` defined at module scope, fixed `position` per node in a horizontal row, `nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} panOnDrag={false} fitView`, `onNodeClick` → `onSelectStep`. Wrap in `ReactFlowProvider`. Build `nodes` from `PIPELINE_STEPS` mapping each to its `turn.steps` entry (by `name`) or `idle`; parent container needs an explicit height (e.g. `h-64`).

```tsx
// PipelineNode.tsx (sketch)
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { STEP_STATUS_COLOR } from "./stepStatusColor";
export function PipelineNode({ data }: NodeProps) {
  const status = (data.status as string) ?? "idle";
  return (<div style={{ background: STEP_STATUS_COLOR[status] ?? STEP_STATUS_COLOR.idle, border: "1px solid #999", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
    <Handle type="target" position={Position.Left} />
    <div>{data.label as string}</div><div style={{ opacity: 0.6 }}>{status}</div>
    <Handle type="source" position={Position.Right} />
  </div>);
}
```

- [ ] **Step 4: Run component test + tsc** — `npx vitest run "app/(app)/intelligence/_components/agent/PipelineCanvas.test.tsx"` green; `npx tsc --noEmit` clean. (If jsdom struggles with react-flow's ResizeObserver, mock it in the test's setup or assert on the node→status mapping via a pure helper extracted from the canvas.)

- [ ] **Step 5: Commit** `feat(agent-diag): @xyflow/react PipelineCanvas with per-turn status coloring`.

---

### Task S2-4: StepDetailDrawer + panel integration (turn selector, notes, thought in export)

**Files:**
- Create: `app/(app)/intelligence/_components/agent/StepDetailDrawer.tsx`
- Modify: `app/(app)/intelligence/_components/AgentDiagnosticsPanel.tsx`, `app/(app)/intelligence/_components/agent/markdownExport.ts`, `lib/constants/observability/index.ts`
- Test: extend `markdownExport.test.ts`; a panel smoke test if straightforward.

**Interfaces:**
- Consumes: `PipelineCanvas` (S2-3), `AgentStep`, `sessionToMarkdown`.
- Produces: `StepDetailDrawer({ step, onClose })` rendering `prompt_system`, `prompt_user`, `raw_response`, `parsed_output`, `thought`, `inputs`, `decision`, `branch_reason`, `duration_ms`.

- [ ] **Step 1: `StepDetailDrawer.tsx`** — a side panel/card that renders the selected `AgentStep.detail` fields (mono blocks for prompts/response/thought; JSON for inputs/decision). `null`-safe (fields absent pre-thought).

- [ ] **Step 2: Panel wiring** — in `AgentDiagnosticsPanel.tsx` interactive view (the `lg:grid-cols-[1fr_2fr]` grid at :162): add local state `selectedTurn` (default `session.data.current_turn`) + `selectedStep` + `notes: Record<number,string>`. Above/within the right column, render `<PipelineCanvas turn={session.data.turns[selectedTurn]} onSelectStep={setSelectedStep} />`, a turn `<select>` (0..turns.length-1, labeled by `kind`), a per-turn notes `<textarea>` (updates `notes[selectedTurn]`), and `<StepDetailDrawer step={selectedStep} .../>` when a step is selected. Keep `DecisionTimeline` + `RunLogStream`. Pass `notes` to `sessionToMarkdown(session.data, notes)`.

- [ ] **Step 3: markdownExport — add thought + prompt_system** in `turnToMarkdown` (after the `prompt_user`/`raw_response` lines):

```ts
if (d.prompt_system) lines.push(`- system:\n\`\`\`\n${String(d.prompt_system)}\n\`\`\``);
if (d.thought) lines.push(`- reasoning:\n\`\`\`\n${String(d.thought)}\n\`\`\``);
```
Extend `markdownExport.test.ts` to assert a step with `detail.thought` renders a "reasoning" block.

- [ ] **Step 4: encodeURIComponent (deferred Slice-1 minor)** — in `lib/constants/observability/index.ts`, wrap the `INTERVIEW_AGENT_ENDPOINTS` id builders: `runOf: (id) => \`${BASE}/runs/${encodeURIComponent(id)}\`` (and `turnOf`/`endOf`), matching the prep/resume builders.

- [ ] **Step 5: Gates** — `npx tsc --noEmit` clean; `npx vitest run "app/(app)/intelligence"` green; `npm run build` succeeds (41+ routes, no new warnings); `npx eslint "app/(app)/intelligence"` clean.

- [ ] **Step 6: Commit** `feat(agent-diag): step-detail drawer + turn selector + per-turn notes + thought/system in export + encodeURIComponent`.

---

## Part D — verification (Slice 2 acceptance)

### Task S2-5: Regression + whole-branch reviews + merge
- [ ] ai-service: `.venv/bin/python -m pytest -q` → 399+new / 1 pre-existing.
- [ ] frontend: `npx tsc --noEmit` + `npm test` + `npm run build` all green.
- [ ] Whole-branch review per repo (opus) — focus: thought seam stays inert on production `complete` (interview_agent slice green); opening replies no longer open empty `"main"` turns and turn 0 carries `opening_classify`; scope emits `ok` on pivot; canvas renders per-turn status + click-detail incl. thought; react-flow is client-only (no SSR break in `npm run build`).
- [ ] **Acceptance:**
  1. Run prep → start session → conduct an interview: turn 0 is `kind:"opening"` with `opening_classify` step(s); no empty `"main"` turns before the first question.
  2. Each main turn's canvas node lights up per status; clicking a node shows its prompt-in/response/**thought**/branch_reason/timing.
  3. A PIVOT_DERIVE turn shows a `scope` step (`ok`) + distinct `converse` (action) and `derive` thoughts.
  4. Copy-as-Markdown includes the reasoning blocks + per-turn notes.
- [ ] Merge `feat/agent-diagnostics-slice2` → `main` `--no-ff` (ai-service + frontend), unpushed, per the Slice-1 finish decision.

## Notes / out of scope
- Backend unchanged (proxy passes `thought` through as opaque `JsonNode`).
- Deferred (not Slice 2): wire the recent-sessions selector (endpoint exists), composer optimistic-disable/error-surfacing — optional polish, track if desired.
- The `_branch_reason` unused `action` param (Slice-1 minor) — optional cleanup, drop the param.
