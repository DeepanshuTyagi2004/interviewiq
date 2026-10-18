# Decision Gates (Jev) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a cheap decision model (Jev 1.14 via OpenRouter Decisions API) in front of three LLM calls, so they are skipped only when they would have produced nothing, plus the eval tooling that proves it.

**Architecture:**
- A small `DecisionsClient` (httpx) sits under a shared `Gate` abstraction with `off | shadow | on` modes. Every decision is written to a Mongo gate log.
- Three call sites each wrap their existing LLM call in `run_gated`: the research window extract, the brief source extract, and the DSA answer-key review.
- A pure-function eval module plus a CLI script reads the log or stored history, sweeps thresholds, and reports agreement and lost work.

**Tech Stack:** Python 3.11, FastAPI service, httpx 0.28, pydantic-settings, Motor (MongoDB), pytest (sync tests calling `asyncio.run`, `httpx.MockTransport`).

**Spec:** `docs/superpowers/specs/2026-10-16-decision-gates-design.md`

All paths below are relative to `apps/ai-service/` unless they start with `docs/`.

## Global Constraints

- **Scope and dependencies:** `apps/ai-service` only. No new dependencies; use `httpx`, which is already present.
- **Endpoint:** `POST https://openrouter.ai/api/alpha/decisions`, `Authorization: Bearer $OPENROUTER_API_KEY` (the existing `openrouter_api_key` setting).
- **Model:** `typesafe/jev-1.14` (setting `DECISIONS_MODEL`). Record the response's dated `model` snapshot on every log document.
- **Routing:** request body includes `"provider": {"data_collection": "deny"}`.
- **State size:** every state serialises to at most 30,000 bytes (UTF-8, `json.dumps(..., ensure_ascii=False)`). Larger states are refused before sending, and the caller treats that as "unknown".
- **Timeout and retry:** default 8 s timeout. One retry on HTTP 429, 5xx, 524 or 529 (backoff 0.5 s). Then raise `DecisionsUnavailable`.
- **Defaults:** every gate's config default is `shadow`. With `OPENROUTER_API_KEY` empty, every gate behaves as `off`.
- **Skip rule:** skip only when `mode == on` and P(yes) of the stage's skip question is below `skip_below`. A Jev error, timeout or over-size state means the LLM runs.
- **Shadow mode never adds latency:** Jev runs concurrently with the LLM call.
- **Research replay and record modes:** the gate behaves as `off`.
- **Gate log failures:** a failure to write the log never raises into a pipeline. Log it at warning level and continue.
- **Generated content is untouched:** no change to any generated content, prompt text or existing LLM output handling beyond the skip paths specified.
- **Tests:** no real network calls. `tests/conftest.py` already blanks `OPENROUTER_API_KEY`.
- **Running tests:** `cd apps/ai-service && .venv/bin/python -m pytest -q <path>`.
- **No commits:** the user commits. "Checkpoint" steps mean: leave the changes in the working tree and list the touched files in your report.
- **Before editing any `.py` file in `apps/ai-service`:**
  - Confirm no blueprint prep run is in flight: `ps aux | grep -i "blueprint\|bench-blueprints" | grep -v grep` is empty, and no ai-service log line in the last 2 minutes shows prep.
  - Another agent may edit this repo concurrently. Re-read a file right before editing it.

## Review Focus

1. **Jev returns 200 but the answer is missing or malformed** (a question key absent, `noul` not a number). This must yield `p_yes=None` (unknown), so the LLM runs. Never an exception, never a skip. Owner: Task 1, `test_malformed_answer_is_unknown`.
2. **The LLM call raises while a shadow Jev task is in flight.** The LLM exception must propagate unchanged, and the shadow task must be awaited or cancelled, never left pending. The log still records `llm_error`. Owner: Task 2, `test_shadow_llm_error_propagates_and_no_pending_task`.
3. **Mongo unavailable when writing the gate log.** The pipeline result must be identical to gate `off`. Owner: Task 2, `test_log_failure_never_raises`.
4. **A research request that isn't a source payload** (`chunk.user` isn't JSON, or has no `source.text`). No gate call, behaviour unchanged. Owner: Task 3, `test_non_source_request_not_gated`.
5. **Cancellation during a gated call.** `asyncio.CancelledError` (research run pause or stop) must propagate through `run_gated` in both modes, and must not be logged as a Jev error. Owner: Task 2, `test_cancellation_propagates`.

---

### Task 1: Decisions client and settings

**Files:**
- Create: `app/llm/decisions.py`
- Modify: `app/config.py`, near the OpenRouter block at about lines 185-198
- Modify: `.env.example`, after `OPENROUTER_API_KEY` at about line 165
- Test: `tests/llm/test_decisions.py`

**Interfaces:**
- Produces:
  - `class DecisionsUnavailable(RuntimeError)`
  - `noul(instructions: str, *, true: str, false: str) -> dict`
  - `choice(instructions: str, options: dict[str, str]) -> dict`
  - `score(instructions: str, levels: list[str]) -> dict`. Each returns a question dict `{"type", "instructions", "criteria"}`.
  - `@dataclass(frozen=True) class Decision`, with fields:
    - `answers: dict[str, dict]`: the raw per-question answer objects.
    - `model: str`: the dated snapshot.
    - `cost_usd: float`
    - `input_tokens: int`
    - `latency_ms: int`
    - `def p_yes(self, name: str) -> float | None`: the `noul` value in [0, 1], else `None`.
    - `def score_of(self, name: str) -> float | None`
    - `def choice_of(self, name: str) -> str | None`
  - `class DecisionsClient`:
    - `__init__(self, *, api_key: str, model: str, url: str, timeout_seconds: float, http_client: httpx.AsyncClient | None = None)`
    - `async def decide(self, state: str | dict | list, questions: dict[str, dict], *, model: str | None = None, session_id: str | None = None) -> Decision`
    - `async def aclose(self) -> None`
  - `def state_bytes(state) -> int`: the UTF-8 length of the `json.dumps` form, or of the string itself when `state` is a `str`.
  - `MAX_STATE_BYTES = 30_000`
  - `shared_decisions_client(settings) -> DecisionsClient | None`: a process-wide lazy singleton. Returns `None` when `openrouter_api_key` is empty.
  - `async def close_shared_decisions_client() -> None`
  - Settings fields:

    | Attribute | Alias | Default |
    |---|---|---|
    | `decisions_model: str` | `DECISIONS_MODEL` | `"typesafe/jev-1.14"` |
    | `decisions_url: str` | `DECISIONS_URL` | `"https://openrouter.ai/api/alpha/decisions"` |
    | `decisions_timeout_seconds: float` | `DECISIONS_TIMEOUT_SECONDS` | `8.0` |
    | `research_window_gate_mode: Literal["off","shadow","on"]` | `RESEARCH_WINDOW_GATE_MODE` | `"shadow"` |
    | `research_window_gate_skip_below: float` | `RESEARCH_WINDOW_GATE_SKIP_BELOW` | `0.05` |
    | `brief_source_gate_mode` | `BRIEF_SOURCE_GATE_MODE` | `"shadow"` |
    | `brief_source_gate_skip_below` | `BRIEF_SOURCE_GATE_SKIP_BELOW` | `0.05` |
    | `key_review_gate_mode` | `KEY_REVIEW_GATE_MODE` | `"shadow"` |
    | `key_review_gate_skip_below` | `KEY_REVIEW_GATE_SKIP_BELOW` | `0.05` |
    | `decision_gate_log_ttl_days: int` | `DECISION_GATE_LOG_TTL_DAYS` | `60` |

- [ ] **Step 1: Write the failing tests** in `tests/llm/test_decisions.py`. Use `httpx.MockTransport` injected via `http_client`, the same pattern as `tests/interviewer/test_llm.py:25-27`.
  - `test_request_shape`: the handler captures the request.
    - Assert the URL equals `settings.decisions_url` and the header is `Authorization: Bearer k`.
    - Assert the JSON body has `model == "typesafe/jev-1.14"`, the `state` as given, `questions` as given, and `provider == {"data_collection": "deny"}`.
  - `test_parses_answers_and_usage`: the response is `{"id":"x","model":"typesafe/jev-1.14-20261014","provider":"TypeSafe","answers":{"a":{"noul":0.91},"b":{"choice":"x","confidence":0.8,"probabilities":{"x":0.8,"y":0.2}},"c":{"score":2.4,"confidence":0.7,"probabilities":{},"legend":{}}},"usage":{"input_tokens":120,"output_tokens":0,"cost":0.000005}}`.
    - `p_yes("a") == 0.91`, `choice_of("b") == "x"`, `score_of("c") == 2.4`.
    - `model == "typesafe/jev-1.14-20261014"`, `cost_usd == 0.000005`, `input_tokens == 120`.
  - `test_malformed_answer_is_unknown`: `answers == {"a": {"noul": "high"}}` gives `p_yes("a") is None`. A missing key gives `p_yes("zz") is None`. A `noul` of 1.7 gives `None`.
  - `test_retries_once_then_raises`: 529 then 529 raises `DecisionsUnavailable`, with exactly 2 requests made. 429 then 200 succeeds with 2 requests.
  - `test_400_not_retried`: 400 raises `DecisionsUnavailable` after 1 request.
  - `test_timeout_raises_unavailable`: the handler raises `httpx.ReadTimeout`, and `DecisionsUnavailable` is raised.
  - `test_oversize_state_refused_without_request`: the state is `"x" * 30_001`. `DecisionsUnavailable` is raised and the handler is never called.
  - `test_shared_client_none_without_key`: `Settings(_env_file=None, OPENROUTER_API_KEY="")` gives `shared_decisions_client(s) is None`.
  - `test_question_builders`: `noul("q", true="t", false="f") == {"type":"noul","instructions":"q","criteria":{"true":"t","false":"f"}}`. The choice and score builders behave analogously.
  - Monkeypatch `asyncio.sleep` to a no-op for the retry tests.

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/llm/test_decisions.py`. Expected: ImportError, or collection errors.

- [ ] **Step 3: Implement.**
  - Write `app/llm/decisions.py` and the settings fields, matching the `Field(default, alias=...)` style in `app/config.py`.
  - `Decision.p_yes` accepts only `int` or `float` values in [0, 1] (bools excluded).
  - `decide` measures latency with `time.monotonic()`.
  - Add the new variables to `.env.example` with comments. Also add the missing `OPENROUTER_BASE_URL` line.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: all pass.

- [ ] **Step 5: Checkpoint.** List the touched files.

---

### Task 2: Gate core (modes, `run_gated`, log, builder)

**Files:**
- Create: `app/gates/__init__.py` (empty)
- Create: `app/gates/core.py`
- Create: `app/gates/log.py`
- Modify: `app/db/mongo.py`. Call `ensure_gate_log_indexes(db, ttl_days)` from `ensure_indexes`, next to `ensure_blueprint_indexes` at about line 83.
- Modify: `app/main.py`. In the lifespan shutdown, `await close_shared_decisions_client()`.
- Test: `tests/gates/__init__.py`, `tests/gates/fakes.py` (`FakeDecisions`, a helper `decision(p: dict[str, float], model="typesafe/jev-1.14-test") -> Decision`, used by Tasks 3-5), and `tests/gates/test_core.py`

**Interfaces:**
- Consumes (Task 1): `DecisionsClient`, `Decision`, `DecisionsUnavailable`, `shared_decisions_client`, and the settings fields.
- Produces, in `app/gates/core.py`:
  - `class GateMode(StrEnum)`: `OFF = "off"`, `SHADOW = "shadow"`, `ON = "on"`.
  - `@dataclass(frozen=True) class Verdict`, with fields:
    - `p_yes: float | None`
    - `answers: dict`
    - `model: str | None`
    - `cost_usd: float`
    - `latency_ms: int`
    - `error: str | None`
  - `@dataclass class GatedResult(Generic[T])`, with fields:
    - `value: T`
    - `skipped: bool`
    - `verdict: Verdict | None`
    - `record_id: str | None`
  - `class Gate`:
    - `__init__(self, stage: str, *, mode: GateMode, skip_below: float, client: DecisionsClient | None, log: GateLog)`. It exposes public `stage`, `mode`, `skip_below` and `log` attributes.
    - Property `active -> bool`: `mode != OFF and client is not None`.
    - `async def ask(self, state, questions: dict, *, skip_question: str) -> Verdict`. It never raises except `CancelledError`. A `DecisionsUnavailable` or any `Exception` gives `Verdict(p_yes=None, error=<type: msg[:200]>)`.
    - `def should_skip(self, v: Verdict) -> bool`
  - `async def run_gated(gate: Gate | None, *, state, questions: dict, skip_question: str, call_llm: Callable[[], Awaitable[T]], label_of: Callable[[T], dict], on_skip: Callable[[], T], context: dict) -> GatedResult[T]`
- Produces, in `app/gates/log.py`:
  - `class GateLog(Protocol)`:
    - `async def insert(self, doc: dict) -> str | None`
    - `async def update(self, record_id: str, fields: dict) -> None`
    - `async def find(self, stage: str, *, limit: int, since: datetime | None = None) -> list[dict]`
  - `class MongoGateLog`: collection `decision_gate_log`, using `app.db.mongo.get_db()`.
  - `class MemoryGateLog`: for tests, with `.docs: list[dict]`.
  - `async def ensure_gate_log_indexes(db, ttl_days: int)`: a compound index on `(stage, created_at)`, plus a TTL index on `created_at` with `expireAfterSeconds = ttl_days * 86400`.
  - `def build_gate(settings, stage: Literal["research_window","brief_source","key_review"], *, log: GateLog | None = None, client: DecisionsClient | None = ...) -> Gate`
    - Reads `getattr(settings, f"{stage}_gate_mode")` and `getattr(settings, f"{stage}_gate_skip_below")`.
    - `client` defaults to `shared_decisions_client(settings)`. Pass `None` explicitly in tests.
    - `log` defaults to `MongoGateLog()`.
- **Log document shape**, written by `run_gated`:
  - `stage`, `mode`, `created_at` (UTC)
  - `model`, `state` (the full state), `state_hash` (sha256 hex of the serialised state)
  - `questions` (names only), `answers`, `p_yes`
  - `skipped`, `jev_error`, `jev_cost_usd`, `jev_latency_ms`
  - `llm_label` (dict from `label_of`, or `None` if skipped), `llm_error` (str or `None`), `llm_latency_ms`
  - `context` (a caller dict: run, combo, slug, label, url)
- **`run_gated` semantics:**
  - Gate `None` or inactive: `value = await call_llm()`. No Jev call and no log. Return `GatedResult(value, False, None, None)`.
  - SHADOW:
    1. Start `ask` as a task.
    2. Run `call_llm` concurrently.
    3. If `call_llm` raises (not `CancelledError`): await the task (bounded by the client timeout), record with `llm_error`, then re-raise the original exception.
    4. On `CancelledError`: cancel the task and re-raise. No log.
    5. On success: await the task, then record with `llm_label = label_of(value)`.
  - ON:
    1. `v = await ask(...)`.
    2. If `should_skip(v)`: record with `skipped=True` and return `GatedResult(on_skip(), True, v, id)`.
    3. Otherwise behave like SHADOW's success and failure path, without a concurrent Jev call.
  - **Log writes:** wrapped in `try/except Exception`. On failure, `logger.warning("[gate] log write failed ...")` and `record_id=None`.

- [ ] **Step 1: Write the failing tests** in `tests/gates/test_core.py`. Use a `FakeDecisions` with an async `decide` that returns a scripted `Decision`, raises a scripted exception, or sleeps; put it in `tests/gates/fakes.py`. Use `MemoryGateLog`.
  - `test_off_never_asks`: mode OFF. Assert `FakeDecisions.calls == 0`, `log.docs == []`, and the value comes from `call_llm`.
  - `test_inactive_without_client`: mode SHADOW with `client=None`. Same assertions as above.
  - `test_shadow_runs_both_and_logs`:
    - Assert both were called, the value is the LLM's, and there is one log doc.
    - The doc has `skipped False`, `p_yes 0.2`, `llm_label {"positive": True}` and `model` equal to the snapshot.
    - The doc has `state` equal to the input and `state_hash` equal to the sha256.
  - `test_shadow_is_concurrent`: Jev sleeps 0.2 s and the LLM sleeps 0.2 s. Total wall time is under 0.35 s.
  - `test_shadow_jev_error_ignored`: Jev raises `DecisionsUnavailable`. The value comes from the LLM, and the doc has `jev_error` set and `p_yes None`.
  - `test_shadow_llm_error_propagates_and_no_pending_task`:
    - The LLM raises `LLMError("x")`, and the same `LLMError` propagates.
    - The doc has `llm_error` containing `"LLMError"`.
    - Afterwards, `[t for t in asyncio.all_tasks() if not t.done()]` contains only the current task.
  - `test_on_skips_below_threshold`: `p_yes 0.01` and `skip_below 0.05`.
    - `call_llm` is never awaited, and the value equals `on_skip()`.
    - `skipped True`, and the doc has `skipped True` and `llm_label None`.
  - `test_on_runs_llm_at_or_above_threshold`: `p_yes 0.05` and `skip_below 0.05`. The LLM is called, and `skipped False`.
  - `test_on_jev_error_runs_llm`: Jev raises. The LLM is called, and `skipped False`.
  - `test_on_unknown_answer_runs_llm`: the answers lack the skip question. The LLM is called.
  - `test_log_failure_never_raises`: a log whose `insert` raises `RuntimeError`. The value comes from the LLM and `record_id is None`, in both SHADOW and ON-skip.
  - `test_cancellation_propagates`: `call_llm` raises `asyncio.CancelledError`. It propagates in SHADOW and ON, `log.docs == []`, and the Jev task is cancelled.
  - `test_build_gate_reads_settings`: `Settings(_env_file=None, KEY_REVIEW_GATE_MODE="on", KEY_REVIEW_GATE_SKIP_BELOW="0.1")`. `build_gate(s, "key_review", log=MemoryGateLog(), client=FakeDecisions())` gives mode ON and `skip_below 0.1`.
  - `test_build_gate_defaults_shadow`: a default `Settings(_env_file=None)` gives mode SHADOW for all three stages.

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/gates/test_core.py`. Expected: ImportError.

- [ ] **Step 3: Implement** `app/gates/core.py` and `app/gates/log.py`, then wire them into `ensure_indexes` and the lifespan.

- [ ] **Step 4: Run the tests and see them pass.** Run `.venv/bin/python -m pytest -q tests/gates tests/llm/test_decisions.py`. Expected: all pass.

- [ ] **Step 5: Checkpoint.**

---

### Task 3: Research window gate

**Files:**
- Modify: `app/research/gateway.py`
  - `ResearchIO.__init__` (about line 113) gains a keyword argument `gate: Gate | None = None`.
  - `extract_claims` (about lines 241-286) changes.
  - Add method `label_grounded`.
- Modify: `app/research/chunks.py`. `ExtractedClaims` (about line 42) gains `gate_windows`.
- Modify: `app/research/nodes/evidence.py`. After `ground_page_claims` (about line 615), call `deps.io.label_grounded(...)`.
- Modify: `app/research/runner.py:250`. Pass `gate=build_gate(self._settings, "research_window")`.
- Create: `app/gates/research.py`, holding the questions and the pure helpers.
- Test: `tests/research/test_window_gate.py`

**Interfaces:**
- Consumes (Task 2): `Gate`, `run_gated`, `build_gate`, `GatedResult`.
- Produces, in `app/gates/research.py`:
  - `def window_state(chunk_user: str) -> dict | None`
    - Parses `json.loads(chunk.user)`.
    - Returns `{"company": ..., "fields": <render_field_docs(allowed_fields)>, "title": source.title, "text": source.text}`.
    - Returns `None` when the payload isn't a dict with `source.text` as a str and `allowed_fields` as a list.
  - `WINDOW_QUESTIONS: dict`
    - `"has_field_info"` (the skip question): `noul`. Instructions: "`text` contains at least one explicit statement about `company` that answers one of the fields described in `fields`." The `true` and `false` criteria spell out explicit statements vs. nothing relevant.
    - `"about_company"`: `noul`, "`text` is about `company`". Logged only.
  - `def grounded_windows(quotes: list[str], text: str, windows: list[tuple[int, int]]) -> list[bool]`: True for window i iff some quote occurs in `text[start:end]` after whitespace normalisation (collapse runs of whitespace).
- Produces on `ExtractedClaims`:
  - Attribute `gate_windows: list[dict]`, default `[]`.
  - Each item is `{"record_id": str | None, "start": int, "end": int}`, appended only for gated windows that were logged.
- Produces on `ResearchIO`:
  - `async def label_grounded(self, claims: ExtractedClaims | list, source_text: str, accepted_quotes: list[str]) -> None`
  - For each `gate_windows` item with a `record_id`, it updates the log with `{"llm_label.grounded": bool}`.
  - No-op when the gate is absent or the list is empty. Never raises.
- **Behaviour in `extract_claims`:**
  - Gating applies when all hold: `self._gate` is set, `self._mode` is live (neither `Mode.REPLAY` nor `Mode.RECORD`), and `window_state(chunk.user)` is not `None`.
  - When gated, the per-window call is wrapped in `run_gated`:
    - `call_llm` is the existing extract-and-repair body.
    - `label_of = lambda claims: {"raw_claims": len(claims), "positive_raw": len(claims) > 0}`.
    - `on_skip = lambda: []`.
    - `context = {"company_slug", "label": chunk_label, "start", "end", "url"}`.
  - A skip:
    - Does not call `extract_json`, so there is no budget charge and no cache write.
    - Counts as a successful empty window, so it never contributes to the all-failed error.
    - Increments `ExtractedClaims.diagnostics`'s companion counter `skipped_windows: int`, a new attribute with default 0.
  - The current error-classification and `LLMError` and `ValidationError` handling stay exactly as they are. `run_gated` re-raises the LLM's exception, and the existing `except` clauses handle it.
- **In `nodes/evidence.py`,** after grounding:
  - `accepted = [g.claim["quote"] for _, g in results if g.reason is None and g.claim]`
  - Then `await deps.io.label_grounded(raw_claims, source.get("content") or "", accepted)`.

- [ ] **Step 1: Write the failing tests** in `tests/research/test_window_gate.py`. Use `tests/research/helpers.py` and `fakes.py` (`FakeLLM`, `wired_deps`), `FakeDecisions` from `tests/gates/fakes.py`, and `MemoryGateLog`.
  - `test_non_source_request_not_gated`: the `user` passed to `extract_claims` isn't JSON. Zero Jev calls, and the LLM is called once.
  - `test_shadow_logs_each_window`: a source whose text spans 2 windows (`research_chunk_chars` small). Two log docs, each with `context.start` and `end`, and `llm_label.raw_claims` equal to the claims returned for that window. The result is the same as with no gate.
  - `test_on_skip_window_no_budget_no_cache`:
    - Mode ON, and Jev returns `p_yes 0.0` for window 1 and 0.9 for window 2.
    - The LLM is called only for window 2.
    - `budget` LLM count increments by 1.
    - The store's `put_extract` was called once.
    - `result.skipped_windows == 1`.
  - `test_all_windows_skipped_returns_empty_not_error`: the result is `[]` and nothing is raised.
  - `test_replay_mode_bypasses_gate`: `Mode.REPLAY` with fixtures present. Zero Jev calls.
  - `test_grounded_windows_helper`: text `"aaa bbb\nccc ddd"`, windows `[(0,7),(8,15)]`, quotes `["ccc  ddd"]` gives `[False, True]`.
  - `test_label_grounded_updates_log`: after a shadow run plus `label_grounded(...)` with one accepted quote in window 2, doc 2 has `llm_label.grounded True` and doc 1 has `False`.

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/research/test_window_gate.py`.

- [ ] **Step 3: Implement** as specified above.

- [ ] **Step 4: Run the new tests and the whole research suite.** Run `.venv/bin/python -m pytest -q tests/research tests/gates`. Expected: all pass, and the existing tests are unchanged (they build `ResearchIO` without `gate`).

- [ ] **Step 5: Checkpoint.**

---

### Task 4: Brief source gate

**Files:**
- Modify: `app/jobs/brief_generation.py`
  - `_extract_all` (about lines 321-367) gains a keyword argument `gate: Gate | None = None`.
  - `generate_one` passes `build_gate(settings, "brief_source")`. Find where it calls `_extract_all`.
- Create: `app/gates/briefs.py`
- Test: `tests/test_brief_source_gate.py`

**Interfaces:**
- Consumes (Task 2): `Gate`, `run_gated`, `build_gate`.
- Produces, in `app/gates/briefs.py`:
  - `def source_state(context: str, src: dict) -> dict`
    - Returns `{"target": context, "title", "url", "date", "text"}`.
    - `text` is truncated so that `state_bytes(state) <= 28_000`. Cut on a character boundary and append `"…"` when cut.
  - `SOURCE_QUESTIONS: dict`
    - `"describes_process"` (the skip question): `noul`. "`text` describes the interview process (rounds, questions asked, or format) for the role in `target`."
    - `"is_first_hand"`: `noul`. "`text` is the author's own first-hand account of interviewing." Logged only.
- **Behaviour:** inside `_one`, wrap the `llm.complete(...)` call in `run_gated`.
  - `call_llm` returns `(raw, thought)`.
  - `on_skip = lambda: ({"describes_process": False}, None)`, so the existing code path records `status "no_process"`.
  - `label_of = lambda r: {"describes_process": bool(r[0].get("describes_process")), "is_first_hand": bool(r[0].get("is_first_hand"))}`.
  - After the disposition is decided, update the record with `{"llm_label.status": <final status>}` via `gate.log.update` (skipped if `record_id` is `None`). Wrap it in `try/except`.
  - `context = {"combo": combo.label(), "url": url}`.
  - An `LLMError` from `call_llm` keeps today's `extract_failed` path, because `run_gated` re-raises.

- [ ] **Step 1: Write the failing tests** in `tests/test_brief_source_gate.py`. Use an inline fake LLM with `complete(system, user, *, label) -> (dict, None)`, plus `FakeDecisions` and `MemoryGateLog`. `Combination` is built as in `tests/test_pipeline_helpers.py`.
  - `test_shadow_logs_label_and_status`: two sources, with LLM replies `describes_process True` and valid rounds, and `False`.
    - Two docs. Doc 1 has `llm_label.describes_process True` and `llm_label.status "extracted"`. Doc 2 has `False` and `"no_process"`.
    - The dispositions are identical to `gate=None`.
  - `test_on_skip_marks_no_process_without_llm`: `p_yes 0.01` for source 1. The LLM is called once (source 2 only), and source 1's disposition status is `"no_process"`.
  - `test_state_truncated_under_limit`: a source with a 60,000-char text. `state_bytes(source_state(...)) <= 28_000`, and it ends with `"…"`.
  - `test_llm_error_still_extract_failed`: the LLM raises `LLMError`. The status is `"extract_failed"`, and the doc has `llm_error`.

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/test_brief_source_gate.py`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** Run `.venv/bin/python -m pytest -q tests/test_brief_source_gate.py tests/test_pipeline_helpers.py tests/gates`. Expected: all pass.

- [ ] **Step 5: Checkpoint.**

---

### Task 5: Answer-key review gate

**Files:**
- Modify: `app/blueprint/models.py:177-184`. On `DsaAnswerKey`, add `review_source: Literal["llm", "gate"] | None = None`.
- Modify: `app/blueprint/answer_keys.py:89-108`. In `_review`, add the gate. Build it from `settings` via `build_gate(settings, "key_review")`, or accept `gate` through a module-level factory `_review_gate(settings)` so tests can monkeypatch it.
- Create: `app/gates/keys.py`
- Test: `tests/blueprint/test_key_review_gate.py`

**Interfaces:**
- Consumes (Task 2): `run_gated`, `build_gate`.
- Produces, in `app/gates/keys.py`:
  - `def key_state(problem: dict, key: dict) -> dict`
    - Returns `{"problem": <the same facts dict as P.dsa_key_review: title, statement, input_format, output_format, constraints>, "answer_key": <key JSON string truncated to 7000 chars>}`.
    - Includes everything except `reference_solution.code`, which the sandbox already checked. Replace it with `"<verified by sandbox>"`.
  - `REVIEW_QUESTIONS: dict`
    - `"has_error"` (the skip question): `noul`. "`answer_key` contains a factual error about `problem`: a wrong time or space complexity, a false insight or wrong path, or an edge case that contradicts the statement or constraints."
- **Behaviour:**
  - `call_llm` is the existing `structured(...)` review.
    - A `StageError` stays handled exactly as today. Catch it inside the `call_llm` wrapper and return a sentinel `None`.
    - `label_of = lambda review: {"review_ran": review is not None, "errors": len(review.errors) if review else 0, "patched": bool(<patch non-empty>)}`.
  - `on_skip` returns the sentinel `"skipped"`.
  - Then:
    - **Skipped:** `key.model_copy(update={"reviewed": True, "review_source": "gate"})`, plus a trace record `{"label": f"review:{slug}", "attempt": 0, "valid": True, "skipped_by_gate": True, "p_has_error": v.p_yes}`.
    - **Ran:** today's patch logic, with `review_source="llm"` set on the reviewed key.
    - **`None`:** today's "review skipped" path. The key is returned unreviewed.
  - `context = {"slug": problem["slug"]}`.

- [ ] **Step 1: Write the failing tests** in `tests/blueprint/test_key_review_gate.py`. Use `tests/blueprint/fixtures.py` (`FakeLLM`, `MemoryTrace`, `dsa_key_reply`), mirroring `tests/blueprint/test_answer_keys.py:126-140`.
  - `test_on_skip_marks_gate_reviewed`: `p_yes 0.01`, mode ON.
    - The review label is never sent to the LLM. `FakeLLM` has no `":review"` reply scripted, so a call would raise.
    - The returned key has `reviewed True` and `review_source "gate"`, and the trace has `skipped_by_gate True`.
  - `test_shadow_review_runs_and_logs_patched`: the review reply has one error and a corrected `complexity_target`.
    - The key is patched as today and `review_source "llm"`.
    - The doc has `llm_label.patched True` and `errors 1`.
  - `test_on_above_threshold_runs_review`: `p_yes 0.6`. The review runs.
  - `test_stage_error_keeps_unreviewed`: the review reply is an exception. The key is unreviewed, and the doc has `llm_label.review_ran False`.
  - `test_old_cached_key_without_review_source_validates`: `DsaAnswerKey.model_validate(<dict without review_source>)` gives `review_source is None`.

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/blueprint/test_key_review_gate.py`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests.** Run `.venv/bin/python -m pytest -q tests/blueprint tests/gates`. Expected: all pass.

- [ ] **Step 5: Checkpoint.**

---

### Task 6: Eval module and script

**Files:**
- Create: `app/gates/evaluate.py` (pure functions)
- Create: `app/gates/history.py` (loaders)
- Create: `scripts/eval_decision_gates.py` (CLI)
- Test: `tests/gates/test_evaluate.py`

**Interfaces:**
- Consumes: the log docs (Task 2 shape), and the stage modules' `*_state` and `*_QUESTIONS` (Tasks 3-5).
- Produces, in `app/gates/evaluate.py`:
  - `@dataclass(frozen=True) class Item`, with fields:
    - `id: str`
    - `p_yes: float | None`
    - `positive: bool`: the LLM said work was needed.
    - `state_excerpt: str`
    - `llm_latency_ms: int | None`
    - `jev_latency_ms: int`
    - `jev_cost_usd: float`
    - `llm_tokens: int | None`
  - `def positive_of(stage: str, doc: dict) -> bool | None`
    - `research_window`: `llm_label.grounded` if present, else `llm_label.positive_raw`.
    - `brief_source`: `llm_label.status == "extracted"` if present, else `llm_label.describes_process`.
    - `key_review`: `llm_label.patched`.
    - `None` when `llm_error` is set or the label is missing. Such docs are excluded.
  - `@dataclass(frozen=True) class SweepRow`, with fields:
    - `threshold: float`
    - `skip_rate: float`
    - `lost_positives: int`
    - `agreement: float`
    - `calls_saved: int`
    - `net_latency_ms_per_item: float`
  - `def sweep(items: list[Item], thresholds: list[float]) -> list[SweepRow]`
    - Items with `p_yes None` count as "not skipped".
    - Agreement: Jev "work needed" (`p_yes >= t`) equals `positive`, over items with a `p_yes`.
    - Net latency: `(skipped_count * mean_llm_latency - n * mean_jev_latency) / n`.
  - `def recommend(rows: list[SweepRow], *, positives: int) -> SweepRow | None`
    - Returns the highest-skip-rate row satisfying all of:
      - `agreement >= 0.95`
      - `lost_positives == 0`
      - `positives >= 100`
      - `skip_rate >= 0.15`
      - `net_latency_ms_per_item > 0`
    - Otherwise `None`.
  - `DEFAULT_THRESHOLDS = [0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3]`
  - `def report_markdown(stage: str, model: str, items: list[Item], rows: list[SweepRow], pick: SweepRow | None) -> str`
    - Includes: n, positives, Jev cost total, Jev p50 and p90 latency, the sweep table, the recommendation (or the reason none passed, naming the failing criterion), and every lost positive and disagreement near the recommended or best threshold (up to 50, with excerpts).
- Produces, in `app/gates/history.py`:
  - `async def from_log(stage: str, *, limit: int) -> list[dict]`: wraps `MongoGateLog.find`.
  - `async def key_review_history(*, limit: int) -> list[dict]`
    - Scans `blueprint_runs` traces for attempts whose label ends with `":review"` and `valid` is true.
    - Rebuilds `{"state": key_state-like dict parsed from the attempt's "user" prompt, "llm_label": {"patched": <raw reply has a non-null reviewable field and non-empty errors>, "review_ran": True}, "llm_latency_ms": attempt.latency_ms}`.
    - Dedupes by problem slug plus the key hash.
  - `async def research_history(*, limit: int) -> list[dict]`
    - Best effort from `research_spans` of kind `llm` whose input `user` parses with `window_state`.
    - The label is `positive_raw` from the span output's claims count.
    - Returns `[]` when the inputs are not recoverable, and prints how many spans were skipped and why.
- **CLI** `scripts/eval_decision_gates.py`:
  - Arguments:
    - `--stage {research_window,brief_source,key_review}` (required)
    - `--source {log,history}` (default `log`)
    - `--model` (default `settings.decisions_model`)
    - `--limit 500`
    - `--budget-usd 2.0`
    - `--out <dir>` (default `os.path.join(tempfile.gettempdir(), "decision-gates")`)
    - `--concurrency 4`
  - With `--source history`, or when `--model` differs from the logged model, it re-asks with `DecisionsClient.decide(state, <stage questions>, model=...)`.
    - It stops when the cumulative `cost_usd` reaches the budget, and reports `budget_reached`.
  - It writes `<stage>-<model-slug>.md` and `.json`, and prints the recommendation line: `RECOMMEND <stage> on skip_below=<t>`, or `KEEP <stage> shadow: <reason>`.
  - Exit code 0 in both cases.

- [ ] **Step 1: Write the failing tests** in `tests/gates/test_evaluate.py` (pure functions only).
  - `test_sweep_counts`: 4 items, p `[0.01, 0.04, 0.5, 0.9]` and positive `[False, False, True, True]`. At t=0.05: `skip_rate 0.5`, `lost_positives 0`, `agreement 1.0`, `calls_saved 2`.
  - `test_lost_positive_counted`: the item with p 0.01 has positive True. At t=0.05, `lost_positives == 1`.
  - `test_unknown_p_never_skipped`: `p None` is excluded from agreement and counted as not skipped.
  - `test_recommend_requires_100_positives`: an otherwise perfect sweep with 50 positives gives `None`.
  - `test_recommend_picks_highest_skip_passing`: rows at 0.05 (skip 0.3, ok) and 0.1 (skip 0.4, lost 1) give the 0.05 row.
  - `test_recommend_rejects_negative_net_latency`: `net_latency_ms_per_item -5` gives `None`.
  - `test_positive_of_rules`:
    - research uses `grounded` over `positive_raw`.
    - brief uses `status` over `describes_process`.
    - key review uses `patched`.
    - `llm_error` gives `None`.
  - `test_report_names_failing_criterion`: when nothing passes because of positives, the markdown contains `"insufficient data"`.

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/gates/test_evaluate.py`.

- [ ] **Step 3: Implement** the evaluate module, the history loaders, and the CLI. Follow the existing `scripts/judge_blueprints.py` for settings, Mongo connect and close, and argparse style.

- [ ] **Step 4: Run the tests.** Run `.venv/bin/python -m pytest -q tests/gates`, then `.venv/bin/python scripts/eval_decision_gates.py --help`. Expected: the tests pass, and the help text lists all the flags.

- [ ] **Step 5: Checkpoint.**

---

### Task 7: Judge quick-screen (`--engine jev`)

**Files:**
- Modify: `scripts/judge_blueprints.py`. Add the flags `--engine {llm,jev}` (default `llm`) and `--compare <path to judge.json>`.
- Create: `app/gates/judge.py`
- Test: `tests/gates/test_judge_screen.py`

**Interfaces:**
- Consumes: `DecisionsClient` (Task 1), and the script's existing `view()`, `DIMENSIONS` and `report()` helpers.
- Produces, in `app/gates/judge.py`:
  - `JUDGE_QUESTIONS: dict`: one `score` question per entry in `DIMENSIONS`, plus `"overall"`. Each has 5 one-line levels ordered from 1 to 5, condensed from the rubric's anchors (overall: 1 = would mislead, 3 = usable but clearly artificial in places, 5 = indistinguishable from a strong real interviewer).
  - `def verdict_from(decision: Decision) -> dict`: returns `{"overall": round(score+1), "dimensions": {d: {"score": round(score+1), "why": "jev quick screen"}}, "walkthroughs": [], "defects": []}`, clamped to 1-5. A missing score omits that dimension, and a missing overall gives an `"error"` key.
  - `def compare(jev_rows: list[dict], llm_rows: list[dict]) -> dict`: joins on `run_id` and returns `{"n": int, "overall_mae": float, "dimension_mae": {d: float}}`.
- **Script behaviour with `--engine jev`:**
  - The state is `view(blueprint)`. If `state_bytes > 30_000`, cut the longest list fields until it fits, or mark the row `error: "state too large"`.
  - The report title is suffixed with `" (Jev quick screen)"`.
  - `--compare` prints the MAE table.

- [ ] **Step 1: Write the failing tests:**
  - `test_score_index_maps_to_1_5`: a score of 3.6 gives 5 (rounded and clamped), and 0.2 gives 1.
  - `test_missing_overall_is_error`.
  - `test_compare_mae`: two runs with overall jev `[4, 2]` and llm `[5, 2]` give `overall_mae 0.5`.
  - `test_questions_cover_all_dimensions`: `set(JUDGE_QUESTIONS) == set(DIMENSIONS) | {"overall"}`, and every question has exactly 5 levels.

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/gates/test_judge_screen.py`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and see them pass.** Then run `.venv/bin/python scripts/judge_blueprints.py --help`, which shows `--engine` and `--compare`.

- [ ] **Step 5: Checkpoint.**

---

### Task 8: ScaleDown extract resume benchmark

**Files:**
- Create: `scripts/bench_resume_extract.py`
- Create: `app/gates/resume_bench.py` (pure comparison)
- Test: `tests/gates/test_resume_bench.py`

**Interfaces:**
- Consumes:
  - `app/resume/extract.py` `extract_text`.
  - The current parse path, `build_llm_client(settings, model=settings.resume_llm_model or None)` plus `P.build_parse_resume_prompt` plus `ParsedResume`, as in `app/api/routes.py:148-160`.
  - `ParsedResume.model_json_schema()`.
- Produces, in `app/gates/resume_bench.py`:
  - `def field_agreement(a: dict, b: dict) -> dict`, returning:
    - `identity`: the share of `full_name`, `email`, `phone` and `location` that are equal after casefold and strip.
    - `education_entries`: matched by casefolded institution.
    - `experience_entries`: matched by casefolded company plus title. Also the bullet overlap: Jaccard over normalised bullet sets of matched entries.
    - `skills_jaccard`
    - `projects_entries`: matched by name.
    - Each value is a float in [0, 1]. Empty-vs-empty counts as 1.0.
- **Script:**
  - `--inputs <dir or files>`: PDFs or `.txt`. The default is `tests/fixtures/formatted_resume.pdf` only.
  - `--budget-usd 0.5`
  - For each input:
    - Run the current parser.
    - Run `scaledown/extract` via `POST {openrouter_base_url}/chat/completions` with `model "scaledown/extract"`, `messages` (the same system and user prompt as the current parser), and `response_format {"type":"json_schema","json_schema":{"name":"parsed_resume","schema": ParsedResume.model_json_schema(), "strict": false}}`.
    - Validate both with `ParsedResume`.
  - `--out <dir>`, with the same default as the eval script.
  - It writes `<out>/resume-extract.md` with the per-file `field_agreement`, latency, cost (`usage.cost`), and the validation failures.
  - If the API rejects `response_format`, retry once without it and note it in the report.
  - The report only. Nothing in production changes.

- [ ] **Step 1: Write the failing tests:**
  - `test_identical_is_one`
  - `test_skills_jaccard`: `["Python","Go"]` vs `["python","Rust"]` gives 1/3.
  - `test_empty_vs_empty_is_one`
  - `test_experience_matched_by_company_title`

- [ ] **Step 2: Run the tests and see them fail.** Run `.venv/bin/python -m pytest -q tests/gates/test_resume_bench.py`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests and see them pass.** Then run `.venv/bin/python scripts/bench_resume_extract.py --help`.

- [ ] **Step 5: Checkpoint.**

---

### Task 9: Live evaluation, data collection, switch-on (main session, not a subagent)

This task spends real money and makes the quality call, so the orchestrator runs it. The total OpenRouter spend is at most $2 for Jev plus $0.5 for ScaleDown. Exa, Groq and Gemma usage for the extra research and brief runs was approved by the human.

- [ ] **Step 1: Full suite.** Run `.venv/bin/python -m pytest -q`. Record pass and fail. Pre-existing failures that don't involve touched files are noted, not fixed.

- [ ] **Step 2: Key review from history.**
  - Run `scripts/eval_decision_gates.py --stage key_review --source history --budget-usd 0.5`.
  - Then run again with `--model scaledown/classify-1 --budget-usd 0.25`. If that model is rejected, note "classify-1 not reachable via Decisions".

- [ ] **Step 3: Research history attempt.** Run `--stage research_window --source history --budget-usd 0.5`. If too few positives, go to Step 4.

- [ ] **Step 4: Collect shadow data.**
  - Confirm no prep runs are in flight.
  - Trigger a research run for already-catalogued companies through the existing admin route (`POST /research/runs` on the ai-service, via the API or the internal key), sized to reach about 150 positives at roughly 3 positive windows per company.
  - Trigger a brief refresh for about 15 existing combos (`/briefs/.../refresh`, or the admin brief run).
  - Wait for completion by polling run status. Do not edit `.py` files meanwhile.

- [ ] **Step 5: Eval from the log.**
  - Run `--stage research_window --source log` and `--stage brief_source --source log`.
  - For each, also run `--model scaledown/classify-1` within the remaining budget.

- [ ] **Step 6: Read every lost-positive candidate and disagreement** near the recommended threshold in each report. Reject a recommendation that shows a systematic miss: a field, page type or problem class Jev consistently misses.

- [ ] **Step 7: Switch on the passing stages.**
  - For each stage with a `RECOMMEND` line that survives Step 6, append `<STAGE>_GATE_MODE=on` and `<STAGE>_GATE_SKIP_BELOW=<t>` to `apps/ai-service/.env` with `printf ... >> .env`. Never read or print the file.
  - Restart is up to the user. Note that the change takes effect on the next ai-service start.

- [ ] **Step 8: Resume benchmark.** Run `scripts/bench_resume_extract.py --budget-usd 0.5`.

- [ ] **Step 9: Report to the user:**
  - Per stage: the verdict, the threshold, the skip rate, the calls saved, the net latency, and links to the reports.
  - Which stages went on.
  - The total spend.
  - The test results.
