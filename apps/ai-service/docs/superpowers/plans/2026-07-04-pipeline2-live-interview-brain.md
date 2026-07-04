# Pipeline 2 — Live Interview Brain (LangGraph) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the LangGraph "brain" that runs a live, voice-driven mock interview in `interviewiq-ai-service` — executing a Pipeline-1 `InterviewPlan`, steering off-script candidate behavior, keeping a real-time hybrid score, and adaptively pacing the session (early-end on weak performance, extend on strong).

**Architecture:** A per-turn **decision graph** (LangGraph `StateGraph`: classify → scope-route → decide → generate) produces a `DecisionOutput`. A thin async **session driver** owns all I/O (the assumed transport interface), the mutable `SessionState`, the opening turn, the post-turn **evaluation tail** (score + pacing), the topic-derivation flow (with wait/nudge lines), and finalization. Deterministic rails (time floor/ceiling, score bands, scope refusal) live in **pure modules** (`scope.py`, `scoring.py`, `pacing.py`) that never call an LLM and are unit-tested directly. All LLM I/O is isolated in `llm_ops.py` so tests stub it.

**Tech Stack:** Python 3.11, FastAPI service, Pydantic v2, `langgraph` (NEW dep), the existing `app/llm` client + `complete_structured` wrapper, pytest with `monkeypatch` + `asyncio.run` (no HTTP/TestClient layer). Assumed transport interface for LiveKit/voice (sub-projects A + D) — mocked in tests via a `ScriptedTransport`.

**Spec:** `docs/superpowers/specs/2026-07-04-pipeline2-live-interview-brain-design.md` (in the interviewiq-backend repo).

## Global Constraints

- **Scope = sub-projects B (brain) + C (scoring/pacing) only.** LiveKit room/token/media (A), STT/LLM/TTS choice (D), and the authoritative final scorecard + round-gating (E) are OUT. Design against the assumed transport interface; the brain must be fully testable with no live voice.
- **New runtime dep:** `langgraph` only. Do NOT add `livekit`/`livekit-agents` in this plan (the real transport adapter is a documented stub; voice stack is still an open decision). Pin to a lower bound in `requirements.txt`, matching the file's existing style.
- **Deterministic rails are code, never prompt instructions.** The 15-20 min floor, 45 min base, 60 min ceiling, and score bands live in `pacing.py`; scope refusal for cross-round requests lives in `scope.py`. An LLM may only confirm/phrase a decision the rails already permit.
- **Rubric/score never leaks.** The live/final score and any rubric material stay interviewer-side. Never add them to any Profile Builder / `ProfileSummary` contract.
- **Prompts are product IP.** Prompt modules ship as versioned functional *scaffolds* with `*_PROMPT_VERSION` constants; real production text is human-drafted later. Import `SPOKEN_STYLE` + `PLATFORM_CONTEXT` from `app/interview_prep/prompts/style.py`. Bump the version constant on any text change.
- **Models are config-driven, never hardcoded.** Conversation turns use `INTERVIEW_LLM_MODEL`; scoring/classification/derivation use `INTERVIEW_SCORER_MODEL`. Empty → fall back to `LLM_MODEL_NAME` (mirror the existing `PREP_LLM_MODEL` pattern). Reuse `build_llm_client(settings, model=...)`; do NOT write a new client.
- **camelCase wire shape.** Any model that crosses the service boundary uses the existing `_CamelModel` base (alias_generator=to_camel, populate_by_name). Internal-only value objects can be plain dataclasses.
- **Test env:** `tests/conftest.py` already sets required env vars via `setdefault`. New settings must have safe defaults so the suite runs without new env.
- **Build/run env:** JDK is irrelevant here (ai-service is Python). Run tests with the ai-service venv: `pytest` from the repo root.

---

## Shared interfaces (authoritative signatures — every task must match these exactly)

These are defined by the tasks noted; later tasks consume them. Names/types here are the contract.

```python
# app/interview_agent/types.py  (Task 3)
class RoundType(str, Enum)            # REUSED from app.models.brief (import, do not redefine)

class TurnClass(str, Enum):          # ANSWER, CLARIFY, OFF_TOPIC, CHALLENGE, DISTRESS, IDK_SILENCE, PIVOT_REQUEST
class TopicScope(str, Enum):         # IN, OUT, UNCLEAR
class PacingGate(str, Enum):         # LOCKED, CONTINUE, MAY_WIND_DOWN, MAY_EXTEND, MUST_WRAP
class PacingDirective(str, Enum):    # CONTINUE, WIND_DOWN, EXTEND
class Action(str, Enum):             # OPEN, ASK_BASE, ESCALATE_FOLLOWUP, GIVE_HINT, MOVE_ON,
                                     # ANSWER_CLARIFY, REDIRECT, DEESCALATE, REASSURE,
                                     # PIVOT_DERIVE, REFUSE_OUT_OF_SCOPE, HOLD_GROUND,
                                     # WIND_DOWN, EXTEND_RESERVE, WRAP, CLOSE
class EndedReason(str, Enum):        # NATURAL_COMPLETE, EARLY_WEAK, TIME_CEILING, ABORTED_TECHNICAL
class ArtifactKind(str, Enum):       # CODE, DIAGRAM

@dataclass(frozen=True)
class UtteranceTiming: t_start: float; t_end: float; time_to_first_word_s: float
@dataclass(frozen=True)
class Artifact: kind: ArtifactKind; content: str; language: str | None = None   # Task 15
@dataclass(frozen=True)
class Turn: speaker: str; text: str; t_start: float = 0.0; t_end: float = 0.0
@dataclass(frozen=True)
class BehavioralSignals: ttf_word_s: float; filler_density: float; self_corrections: int; recovered_after_hint: bool
@dataclass(frozen=True)
class PerAnswerScore: slug: str | None; competency: float; behavioral: float; answer_score: float; weight: float
@dataclass(frozen=True)
class NegativeEvent: type: str; magnitude: float; reason: str; at_s: float
@dataclass(frozen=True)
class SessionOutcome:  # see Task 12
    session_id: str; ended_reason: EndedReason; live_score_final: float
    per_answer_evidence: list[PerAnswerScore]; negative_events: list[NegativeEvent]
    arc_completed: bool; extensions_granted: int; derived_topics: list[str]; duration_s: float

# app/interview_agent/scope.py  (Task 4)
def out_of_scope_by_markers(round_type: RoundType, topic_text: str) -> bool
def scope_prompt_context(round_type: RoundType) -> str

# app/interview_agent/scoring.py  (Task 5)
def extract_behavioral(text: str, timing: UtteranceTiming, hint_was_given: bool) -> BehavioralSignals
def behavioral_score(sig: BehavioralSignals) -> float                       # 0..1
def answer_score(competency: float, behavioral: float, w_c: float, w_b: float) -> float
def rolling_score(per_answer: list[PerAnswerScore], negatives: list[NegativeEvent]) -> float
def coverage(attempted_core: int, total_core: int) -> float

# app/interview_agent/pacing.py  (Task 6)
@dataclass(frozen=True)
class PacingBands: min_s: float; base_s: float; max_s: float; low: float; high: float
    extend_lookahead_s: float; min_coverage: float
def evaluate_gate(elapsed_s: float, rolling: float, cov: float,
                  reserve_available: bool, bands: PacingBands) -> PacingGate

# app/interview_agent/state.py  (Task 7)
@dataclass
class SessionState:  # mutable, driver-owned. See Task 7 for full field list + helpers.
    @classmethod
    def from_plan(cls, plan: dict, bands: PacingBands) -> "SessionState"
    def active_ladder(self) -> dict | None
    def advance_to_next_question(self) -> None
    def next_followup(self) -> str | None
    def next_hint(self) -> str | None
    def take_reserve(self) -> dict | None
    def mark_asked(self, slug: str | None) -> None

# app/interview_agent/llm_ops.py  (Task 9) — all async; each takes (llm, settings, ...)
async def classify_turn(llm, settings, *, round_type, active_item_summary, last_text) -> tuple[TurnClass, str | None]
async def grade_answer(llm, settings, *, rubric, question, answer, artifact=None) -> tuple[float, float]  # (competency, coherence); artifact: Artifact | None added in Task 15
async def judge_pacing(llm, settings, *, gate, rolling, transcript_summary) -> PacingDirective
async def derive_ladder(llm, settings, *, round_type, topic, brief, jd) -> dict              # a QuestionLadder-shaped dict
async def generate_line(llm, settings, *, action, persona, active_item, transcript_tail, extra) -> str

# app/interview_agent/graph.py  (Task 10)
def decide(inputs: DecisionInputs) -> Action        # PURE router (tested directly)
def build_interview_graph(deps) -> "CompiledGraph"  # LangGraph; deps carries llm+settings+plan
async def run_decision(graph, state: SessionState, utterance: Turn | None) -> DecisionOutput

# app/interview_agent/transport.py  (Task 11)
class Transport(Protocol):
    async def say(self, text: str) -> None: ...
    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None: ...
    async def current_artifact(self) -> Artifact | None: ...   # Task 15
    async def end_session(self) -> None: ...
class ScriptedTransport:  # test double implementing Transport

# app/interview_agent/session.py  (Task 12)
async def run_session(transport: Transport, plan: dict, settings) -> SessionOutcome
```

`DecisionInputs` / `DecisionOutput` are TypedDicts defined in Task 7 / Task 10.

---

### Task 1: Add `langgraph` dependency + interview settings

**Files:**
- Modify: `requirements.txt`
- Modify: `app/config.py:150-158` (append after the "Interview prep (Pipeline 1)" block)
- Test: `tests/test_config.py` (add one test)

**Interfaces:**
- Produces: new `Settings` fields consumed everywhere: `interview_llm_model`, `interview_scorer_model`, `interview_min_duration_min`, `interview_base_duration_min`, `interview_max_duration_min`, `interview_low_band`, `interview_high_band`, `interview_w_competency`, `interview_w_behavioral`, `interview_pivot_cap`, `interview_nudge_after_s`, `interview_extend_lookahead_s`, `interview_min_coverage`, `interview_pivot_penalty`, `interview_out_of_scope_penalty`, `interview_idk_penalty`, `interview_max_repairs`, `interview_silence_retries`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_config.py`:

```python
def test_interview_settings_have_defaults(monkeypatch):
    from app.config import Settings
    s = Settings()
    assert s.interview_min_duration_min == 18
    assert s.interview_base_duration_min == 45
    assert s.interview_max_duration_min == 60
    assert s.interview_low_band == 0.40
    assert s.interview_high_band == 0.70
    assert s.interview_w_competency + s.interview_w_behavioral == 1.0
    assert s.interview_pivot_cap == 2
    # empty model → caller falls back to llm_model
    assert s.interview_llm_model == ""
    assert s.interview_scorer_model == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_config.py::test_interview_settings_have_defaults -v`
Expected: FAIL with `AttributeError: 'Settings' object has no attribute 'interview_min_duration_min'`

- [ ] **Step 3: Add the settings**

Append to `app/config.py` inside the `Settings` class, after line 158 (the `prep_concurrency` field):

```python
    # --- Live interview (Pipeline 2) ---
    # Conversation-turn model (spoken lines). Empty → falls back to llm_model. Same keys/client.
    interview_llm_model: str = Field("", alias="INTERVIEW_LLM_MODEL")
    # Scoring / classification / pacing-judgment / topic-derivation model (cheaper/faster). Empty → llm_model.
    interview_scorer_model: str = Field("", alias="INTERVIEW_SCORER_MODEL")
    # Pacing rails (minutes). Floor = never end before this; base = target; max = hard ceiling.
    interview_min_duration_min: int = Field(18, alias="INTERVIEW_MIN_DURATION_MIN")
    interview_base_duration_min: int = Field(45, alias="INTERVIEW_BASE_DURATION_MIN")
    interview_max_duration_min: int = Field(60, alias="INTERVIEW_MAX_DURATION_MIN")
    # Score bands (0..1): below low → may wind down; above high → may extend.
    interview_low_band: float = Field(0.40, alias="INTERVIEW_LOW_BAND")
    interview_high_band: float = Field(0.70, alias="INTERVIEW_HIGH_BAND")
    # Hybrid answer-score weights (must sum to 1.0): competency vs behavioral.
    interview_w_competency: float = Field(0.75, alias="INTERVIEW_W_COMPETENCY")
    interview_w_behavioral: float = Field(0.25, alias="INTERVIEW_W_BEHAVIORAL")
    # Negative-event penalties applied to the rolling score.
    interview_pivot_penalty: float = Field(0.15, alias="INTERVIEW_PIVOT_PENALTY")
    interview_out_of_scope_penalty: float = Field(0.30, alias="INTERVIEW_OUT_OF_SCOPE_PENALTY")
    interview_idk_penalty: float = Field(0.05, alias="INTERVIEW_IDK_PENALTY")
    # How many in-scope pivots to honor before holding ground.
    interview_pivot_cap: int = Field(2, alias="INTERVIEW_PIVOT_CAP")
    # Seconds into a topic derivation before emitting a "bear with me" nudge line.
    interview_nudge_after_s: float = Field(8.0, alias="INTERVIEW_NUDGE_AFTER_S")
    # How long before base_s the extend gate opens.
    interview_extend_lookahead_s: float = Field(300.0, alias="INTERVIEW_EXTEND_LOOKAHEAD_S")
    # Minimum plan-core coverage before a wind-down is allowed (guards the floor with evidence).
    interview_min_coverage: float = Field(0.34, alias="INTERVIEW_MIN_COVERAGE")
    # structured.py re-ask budget for live LLM ops.
    interview_max_repairs: int = Field(1, alias="INTERVIEW_MAX_REPAIRS")
    # How many "sorry, didn't catch that" retries before aborting on persistent silence.
    interview_silence_retries: int = Field(2, alias="INTERVIEW_SILENCE_RETRIES")
```

Add to `requirements.txt` (after the `pypdf` line), matching the file's comment style:

```
langgraph>=0.2          # Pipeline 2 live-interview decision graph (stateful per-turn routing)
```

- [ ] **Step 4: Install the dep and run the test**

Run: `pip install 'langgraph>=0.2' && pytest tests/test_config.py::test_interview_settings_have_defaults -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add requirements.txt app/config.py tests/test_config.py
git commit -m "feat(interview-agent): add langgraph dep + Pipeline-2 interview settings"
```

---

### Task 2: Add `reserve` field to InterviewPlan schema

**Files:**
- Modify: `app/interview_prep/schema.py:171-187` (InterviewPlan) and add a `ReserveSet` wrapper near `LadderSet` (~line 200)
- Test: `tests/test_interview_plan_endpoint.py` (add one test) OR a new `tests/test_plan_reserve.py`

**Interfaces:**
- Produces: `InterviewPlan.reserve: list[QuestionLadder]` (defaults `[]`); `ReserveSet.ladders: list[QuestionLadder]` (LLM call target, mirrors `LadderSet`). Consumed by `SessionState.take_reserve()` (Task 7) and reserve generation (Task 14).

- [ ] **Step 1: Write the failing test**

Create `tests/test_plan_reserve.py`:

```python
from app.interview_prep.schema import InterviewPlan, ReserveSet, QuestionLadder


def _min_plan_kwargs():
    from app.interview_prep.schema import InterviewerPersona, PlanProvenance
    from app.models.brief import utcnow
    return dict(
        session_id="s1", candidate_id="c1", company="razorpay", role="software-engineer",
        level="sde2", specialization="backend", round_type="dsa",
        provenance=PlanProvenance(plan_version="v1", input_hash="h", model="m", generated_at=utcnow()),
        persona=InterviewerPersona(name="Ada", seniority="senior", disposition="warm"),
    )


def test_plan_reserve_defaults_empty():
    plan = InterviewPlan(**_min_plan_kwargs())
    assert plan.reserve == []


def test_plan_reserve_accepts_ladders_and_roundtrips_camel():
    plan = InterviewPlan(reserve=[QuestionLadder(base_prompt="Design a rate limiter")], **_min_plan_kwargs())
    doc = plan.model_dump(by_alias=True, mode="json")
    assert doc["reserve"][0]["basePrompt"] == "Design a rate limiter"


def test_reserve_set_wrapper():
    rs = ReserveSet.model_validate({"ladders": [{"base_prompt": "harder q"}]})
    assert rs.ladders[0].base_prompt == "harder q"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_plan_reserve.py -v`
Expected: FAIL with `ImportError: cannot import name 'ReserveSet'`

- [ ] **Step 3: Implement**

In `app/interview_prep/schema.py`, add `reserve` to `InterviewPlan` (after `red_flag_watchlist`, line ~187):

```python
    red_flag_watchlist: list[str] = Field(default_factory=list)
    # Pipeline-2 extension reserve: extra hard ladders used ONLY when the live agent extends a
    # strong candidate toward the ceiling. Empty is valid (the brain falls back to follow_ups).
    reserve: list[QuestionLadder] = Field(default_factory=list)
```

Add the LLM-call wrapper next to `LadderSet` (line ~202):

```python
class ReserveSet(_CamelModel):
    ladders: list[QuestionLadder] = Field(default_factory=list)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_plan_reserve.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/interview_prep/schema.py tests/test_plan_reserve.py
git commit -m "feat(interview-prep): add reserve field to InterviewPlan for live-agent extension"
```

---

### Task 3: Interview-agent value objects & enums (`types.py`)

**Files:**
- Create: `app/interview_agent/types.py`
- Test: `tests/interview_agent/test_types.py` (create `tests/interview_agent/__init__.py` too)

**Interfaces:**
- Produces: every enum/dataclass in the "Shared interfaces" block above. `RoundType` is imported from `app.models.brief` and re-exported.

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/__init__.py` (empty) and `tests/interview_agent/test_types.py`:

```python
from app.interview_agent.types import (
    RoundType, TurnClass, TopicScope, PacingGate, PacingDirective, Action, EndedReason,
    UtteranceTiming, Turn, BehavioralSignals, PerAnswerScore, NegativeEvent, SessionOutcome,
)


def test_enums_have_expected_members():
    assert TurnClass.PIVOT_REQUEST.value == "pivot_request"
    assert PacingGate.MUST_WRAP.value == "must_wrap"
    assert PacingDirective.WIND_DOWN.value == "wind_down"
    assert Action.EXTEND_RESERVE.value == "extend_reserve"
    assert EndedReason.EARLY_WEAK.value == "early_weak"
    assert RoundType.DSA.value == "dsa"   # reused from app.models.brief


def test_value_objects_construct():
    t = Turn(speaker="candidate", text="hi", t_start=1.0, t_end=2.0)
    assert t.speaker == "candidate"
    sig = BehavioralSignals(ttf_word_s=1.0, filler_density=0.1, self_corrections=0, recovered_after_hint=False)
    assert sig.filler_density == 0.1
    o = SessionOutcome(session_id="s1", ended_reason=EndedReason.NATURAL_COMPLETE, live_score_final=0.7,
                       per_answer_evidence=[], negative_events=[], arc_completed=True,
                       extensions_granted=0, derived_topics=[], duration_s=1800.0)
    assert o.live_score_final == 0.7
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_types.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.interview_agent.types'`

- [ ] **Step 3: Implement**

Create `app/interview_agent/types.py`:

```python
"""Value objects and enums for the live-interview brain (Pipeline 2). No behavior, no I/O —
just the typed vocabulary the graph, driver, and pure modules share. RoundType is REUSED from
app.models.brief so the round vocabulary stays single-sourced."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from app.models.brief import RoundType  # re-exported


class TurnClass(str, Enum):
    ANSWER = "answer"
    CLARIFY = "clarify"
    OFF_TOPIC = "off_topic"
    CHALLENGE = "challenge"
    DISTRESS = "distress"
    IDK_SILENCE = "idk_silence"
    PIVOT_REQUEST = "pivot_request"


class TopicScope(str, Enum):
    IN = "in"
    OUT = "out"
    UNCLEAR = "unclear"


class PacingGate(str, Enum):
    LOCKED = "locked"
    CONTINUE = "continue"
    MAY_WIND_DOWN = "may_wind_down"
    MAY_EXTEND = "may_extend"
    MUST_WRAP = "must_wrap"


class PacingDirective(str, Enum):
    CONTINUE = "continue"
    WIND_DOWN = "wind_down"
    EXTEND = "extend"


class Action(str, Enum):
    OPEN = "open"
    ASK_BASE = "ask_base"
    ESCALATE_FOLLOWUP = "escalate_followup"
    GIVE_HINT = "give_hint"
    MOVE_ON = "move_on"
    ANSWER_CLARIFY = "answer_clarify"
    REDIRECT = "redirect"
    DEESCALATE = "deescalate"
    REASSURE = "reassure"
    PIVOT_DERIVE = "pivot_derive"
    REFUSE_OUT_OF_SCOPE = "refuse_out_of_scope"
    HOLD_GROUND = "hold_ground"
    WIND_DOWN = "wind_down"
    EXTEND_RESERVE = "extend_reserve"
    WRAP = "wrap"
    CLOSE = "close"


class EndedReason(str, Enum):
    NATURAL_COMPLETE = "natural_complete"
    EARLY_WEAK = "early_weak"
    TIME_CEILING = "time_ceiling"
    ABORTED_TECHNICAL = "aborted_technical"


@dataclass(frozen=True)
class UtteranceTiming:
    t_start: float
    t_end: float
    time_to_first_word_s: float


@dataclass(frozen=True)
class Turn:
    speaker: str            # "interviewer" | "candidate"
    text: str
    t_start: float = 0.0
    t_end: float = 0.0


@dataclass(frozen=True)
class BehavioralSignals:
    ttf_word_s: float
    filler_density: float
    self_corrections: int
    recovered_after_hint: bool


@dataclass(frozen=True)
class PerAnswerScore:
    slug: str | None
    competency: float
    behavioral: float
    answer_score: float
    weight: float


@dataclass(frozen=True)
class NegativeEvent:
    type: str
    magnitude: float
    reason: str
    at_s: float


@dataclass(frozen=True)
class SessionOutcome:
    session_id: str
    ended_reason: EndedReason
    live_score_final: float
    per_answer_evidence: list[PerAnswerScore]
    negative_events: list[NegativeEvent]
    arc_completed: bool
    extensions_granted: int
    derived_topics: list[str]
    duration_s: float
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_types.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/types.py tests/interview_agent/
git commit -m "feat(interview-agent): value objects and enums for the live brain"
```

---

### Task 4: Round-scope guard (`scope.py`)

**Files:**
- Create: `app/interview_agent/scope.py`
- Test: `tests/interview_agent/test_scope.py`

**Interfaces:**
- Consumes: `RoundType` (Task 3).
- Produces: `out_of_scope_by_markers(round_type, topic_text) -> bool` (deterministic hard guard for cross-round requests) and `scope_prompt_context(round_type) -> str` (in-scope description injected into classifier/refusal prompts). Consumed by `llm_ops.classify_turn` (Task 9) and `generate_line` (refusal, Task 9).

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_scope.py`:

```python
from app.interview_agent.scope import out_of_scope_by_markers, scope_prompt_context
from app.interview_agent.types import RoundType


def test_dsa_round_rejects_system_design_request():
    assert out_of_scope_by_markers(RoundType.DSA, "can you ask me a system design question instead") is True
    assert out_of_scope_by_markers(RoundType.DSA, "ask me about HLD / scalability") is True
    assert out_of_scope_by_markers(RoundType.DSA, "let's do a behavioural question") is True


def test_dsa_round_allows_other_dsa_or_cs_fundamentals():
    assert out_of_scope_by_markers(RoundType.DSA, "I'm weak at graphs, can you ask DP instead") is False
    assert out_of_scope_by_markers(RoundType.DSA, "ask me something on operating systems") is False


def test_behavioural_round_rejects_any_coding():
    assert out_of_scope_by_markers(RoundType.BEHAVIOURAL, "give me a dsa coding problem") is True


def test_scope_prompt_context_names_the_round():
    ctx = scope_prompt_context(RoundType.DSA)
    assert "DSA" in ctx or "data structures" in ctx.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_scope.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.interview_agent.scope'`

- [ ] **Step 3: Implement**

Create `app/interview_agent/scope.py`:

```python
"""Round-scope guard. The DETERMINISTIC half of topic-pivot handling: a pure keyword guard that
guarantees cross-round requests (e.g. "ask me system design" in a DSA round) are caught as OUT of
scope regardless of what the LLM classifier thinks. The LLM handles nuance for in-scope pivots;
this code makes the hard cross-round refusal a code invariant (spec §8.1)."""
from __future__ import annotations

from app.interview_agent.types import RoundType

# Per round: a human-readable in-scope description (for prompts) + markers that, if they appear in a
# pivot request, mean the candidate is asking to leave the round entirely (definitively OUT).
_SCOPE: dict[RoundType, tuple[str, tuple[str, ...]]] = {
    RoundType.DSA: (
        "a DSA round — data structures & algorithms plus core CS fundamentals "
        "(operating systems, DBMS, computer networks, OOP concepts)",
        ("system design", "hld", "high level design", "high-level design", "scalab", "load balanc",
         "microservice", "distributed system", "design pattern", "low level design", "low-level design",
         "lld", "machine coding", "behavioural", "behavioral", "tell me about a time"),
    ),
    RoundType.SYSTEM_DESIGN: (
        "a System Design round — HLD, scalability, caching, databases/sharding, consistency, "
        "messaging, API design, and back-of-envelope estimation",
        ("leetcode", "dsa", "dynamic programming", "two pointer", "behavioural", "behavioral",
         "tell me about a time", "class diagram", "design pattern"),
    ),
    RoundType.LLD: (
        "an LLD round — object-oriented design, class modeling, design patterns, SOLID, and "
        "concurrency in design",
        ("system design", "hld", "scalab", "leetcode", "dynamic programming", "behavioural",
         "behavioral", "tell me about a time"),
    ),
    RoundType.BEHAVIOURAL: (
        "a Behavioural round — situational / STAR questions about teamwork, conflict, ownership, "
        "and learning from failure",
        ("dsa", "coding problem", "leetcode", "algorithm", "system design", "hld", "lld",
         "class diagram", "design pattern", "sql query"),
    ),
    RoundType.HIRING_MANAGER: (
        "a Hiring Manager round — motivation, role and company fit, project deep-dives, high-level "
        "technical judgement, and career goals",
        ("leetcode", "dsa coding", "solve this algorithm", "class diagram"),
    ),
}

_FALLBACK_DESC = "this interview round"


def out_of_scope_by_markers(round_type: RoundType, topic_text: str) -> bool:
    """True when the requested topic clearly belongs to a DIFFERENT round type (hard refusal).
    Case-insensitive substring match against the round's out-of-scope markers."""
    _, markers = _SCOPE.get(round_type, (_FALLBACK_DESC, ()))
    low = (topic_text or "").lower()
    return any(m in low for m in markers)


def scope_prompt_context(round_type: RoundType) -> str:
    """In-scope description for injection into the classifier / refusal prompts."""
    desc, _ = _SCOPE.get(round_type, (_FALLBACK_DESC, ()))
    return f"This is {desc}."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_scope.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/scope.py tests/interview_agent/test_scope.py
git commit -m "feat(interview-agent): deterministic round-scope guard for topic pivots"
```

---

### Task 5: Scoring aggregation (`scoring.py`)

**Files:**
- Create: `app/interview_agent/scoring.py`
- Test: `tests/interview_agent/test_scoring.py`

**Interfaces:**
- Consumes: `UtteranceTiming`, `BehavioralSignals`, `PerAnswerScore`, `NegativeEvent` (Task 3).
- Produces: `extract_behavioral`, `behavioral_score`, `answer_score`, `rolling_score`, `coverage` (signatures in Shared interfaces). Consumed by the eval tail in `session.py` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_scoring.py`:

```python
import pytest

from app.interview_agent import scoring
from app.interview_agent.types import UtteranceTiming, BehavioralSignals, PerAnswerScore, NegativeEvent


def test_extract_behavioral_counts_fillers_and_corrections():
    text = "um so I think, uh, actually no wait, I mean we use a hash map"
    timing = UtteranceTiming(t_start=0.0, t_end=10.0, time_to_first_word_s=1.5)
    sig = scoring.extract_behavioral(text, timing, hint_was_given=True)
    assert sig.ttf_word_s == 1.5
    assert sig.filler_density > 0           # um, uh present
    assert sig.self_corrections >= 1        # "actually no wait" / "I mean"
    assert sig.recovered_after_hint is True


def test_behavioral_score_is_bounded_0_1():
    good = BehavioralSignals(ttf_word_s=0.5, filler_density=0.0, self_corrections=0, recovered_after_hint=False)
    bad = BehavioralSignals(ttf_word_s=12.0, filler_density=0.5, self_corrections=6, recovered_after_hint=False)
    assert 0.0 <= scoring.behavioral_score(bad) <= scoring.behavioral_score(good) <= 1.0


def test_answer_score_weights():
    assert scoring.answer_score(competency=1.0, behavioral=0.0, w_c=0.75, w_b=0.25) == pytest.approx(0.75)
    assert scoring.answer_score(competency=0.0, behavioral=1.0, w_c=0.75, w_b=0.25) == pytest.approx(0.25)


def test_rolling_score_weighted_mean_then_penalized():
    per = [
        PerAnswerScore(slug="a", competency=0.8, behavioral=0.6, answer_score=0.75, weight=1.0),
        PerAnswerScore(slug="b", competency=0.4, behavioral=0.4, answer_score=0.40, weight=1.0),
    ]
    base = scoring.rolling_score(per, negatives=[])
    assert base == pytest.approx((0.75 + 0.40) / 2)
    penalized = scoring.rolling_score(per, negatives=[NegativeEvent("out_of_scope", 0.30, "r", 100.0)])
    assert penalized == pytest.approx(base - 0.30)


def test_rolling_score_clamped_and_empty():
    assert scoring.rolling_score([], negatives=[]) == 0.0
    per = [PerAnswerScore(slug="a", competency=0.1, behavioral=0.1, answer_score=0.1, weight=1.0)]
    assert scoring.rolling_score(per, [NegativeEvent("x", 0.9, "r", 1.0)]) == 0.0  # clamped >= 0


def test_coverage():
    assert scoring.coverage(0, 6) == 0.0
    assert scoring.coverage(3, 6) == pytest.approx(0.5)
    assert scoring.coverage(2, 0) == 1.0   # no core → treated as fully covered
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_scoring.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

Create `app/interview_agent/scoring.py`:

```python
"""Pure scoring math for the live interview (spec §6). No LLM, no I/O. The COMPETENCY grade itself
comes from an LLM (llm_ops.grade_answer); everything here — behavioral signal extraction from the
transcript, combining into an answer score, and aggregating the rolling score with penalties — is
deterministic and unit-tested."""
from __future__ import annotations

import re

from app.interview_agent.types import BehavioralSignals, NegativeEvent, PerAnswerScore, UtteranceTiming

_FILLERS = ("um", "uh", "erm", "hmm", "like", "so")
_CORRECTION_MARKERS = ("actually no", "no wait", "i mean", "sorry", "let me restart", "scratch that")


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def extract_behavioral(text: str, timing: UtteranceTiming, hint_was_given: bool) -> BehavioralSignals:
    """Derive transcript+timing behavioral signals (spec §6). recovered_after_hint is True when a
    hint was given before this answer AND the answer is substantive (>= 12 words)."""
    words = re.findall(r"[a-zA-Z']+", text.lower())
    n = len(words) or 1
    fillers = sum(1 for w in words if w in _FILLERS)
    low = text.lower()
    corrections = sum(low.count(m) for m in _CORRECTION_MARKERS)
    recovered = bool(hint_was_given and n >= 12)
    return BehavioralSignals(
        ttf_word_s=timing.time_to_first_word_s,
        filler_density=fillers / n,
        self_corrections=corrections,
        recovered_after_hint=recovered,
    )


def behavioral_score(sig: BehavioralSignals) -> float:
    """Map signals to 0..1 (higher = more confident/fluent). Each penalty is bounded so no single
    signal can dominate; a hint recovery adds a small bonus."""
    hesitation = _clamp01(sig.ttf_word_s / 8.0)          # 8s+ to first word → maxed out
    filler = _clamp01(sig.filler_density / 0.25)          # 25%+ fillers → maxed out
    corrections = _clamp01(sig.self_corrections / 5.0)    # 5+ restarts → maxed out
    penalty = 0.5 * hesitation + 0.3 * filler + 0.2 * corrections
    score = 1.0 - penalty
    if sig.recovered_after_hint:
        score += 0.1
    return _clamp01(score)


def answer_score(competency: float, behavioral: float, w_c: float, w_b: float) -> float:
    return _clamp01(w_c * _clamp01(competency) + w_b * _clamp01(behavioral))


def rolling_score(per_answer: list[PerAnswerScore], negatives: list[NegativeEvent]) -> float:
    """Weight-averaged answer scores, then subtract the summed negative-event magnitudes. Clamped
    to [0,1]. Empty history → 0.0 (no evidence yet)."""
    if not per_answer:
        return 0.0
    total_w = sum(p.weight for p in per_answer) or 1.0
    weighted = sum(p.answer_score * p.weight for p in per_answer) / total_w
    penalty = sum(e.magnitude for e in negatives)
    return _clamp01(weighted - penalty)


def coverage(attempted_core: int, total_core: int) -> float:
    """Fraction of the plan's core questions meaningfully attempted. total_core == 0 → 1.0 (nothing
    to cover, so coverage is not a blocker)."""
    if total_core <= 0:
        return 1.0
    return _clamp01(attempted_core / total_core)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_scoring.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/scoring.py tests/interview_agent/test_scoring.py
git commit -m "feat(interview-agent): pure hybrid scoring math (competency + behavioral + penalties)"
```

---

### Task 6: Pacing gate (`pacing.py`)

**Files:**
- Create: `app/interview_agent/pacing.py`
- Test: `tests/interview_agent/test_pacing.py`

**Interfaces:**
- Consumes: `PacingGate` (Task 3).
- Produces: `PacingBands` dataclass + `evaluate_gate(...)` (Shared interfaces). Consumed by the eval tail (Task 12) and `SessionState.from_plan` builds `PacingBands` from settings (Task 7).

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_pacing.py`:

```python
from app.interview_agent.pacing import PacingBands, evaluate_gate
from app.interview_agent.types import PacingGate

BANDS = PacingBands(min_s=18*60, base_s=45*60, max_s=60*60, low=0.40, high=0.70,
                    extend_lookahead_s=300.0, min_coverage=0.34)


def test_locked_before_floor_even_if_weak():
    assert evaluate_gate(elapsed_s=10*60, rolling=0.1, cov=0.9, reserve_available=True, bands=BANDS) == PacingGate.LOCKED


def test_may_wind_down_after_floor_when_weak_and_enough_coverage():
    assert evaluate_gate(elapsed_s=20*60, rolling=0.30, cov=0.5, reserve_available=False, bands=BANDS) == PacingGate.MAY_WIND_DOWN


def test_weak_but_thin_coverage_does_not_wind_down():
    assert evaluate_gate(elapsed_s=20*60, rolling=0.30, cov=0.2, reserve_available=False, bands=BANDS) == PacingGate.CONTINUE


def test_may_extend_when_strong_near_base_and_reserve_present():
    assert evaluate_gate(elapsed_s=41*60, rolling=0.80, cov=0.9, reserve_available=True, bands=BANDS) == PacingGate.MAY_EXTEND


def test_no_extend_without_reserve():
    assert evaluate_gate(elapsed_s=41*60, rolling=0.80, cov=0.9, reserve_available=False, bands=BANDS) == PacingGate.CONTINUE


def test_must_wrap_at_ceiling():
    assert evaluate_gate(elapsed_s=60*60, rolling=0.95, cov=0.9, reserve_available=True, bands=BANDS) == PacingGate.MUST_WRAP


def test_continue_when_mid_and_middling():
    assert evaluate_gate(elapsed_s=30*60, rolling=0.55, cov=0.6, reserve_available=True, bands=BANDS) == PacingGate.CONTINUE
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_pacing.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

Create `app/interview_agent/pacing.py`:

```python
"""Pure pacing rails (spec §7). The DETERMINISTIC guardrails of adaptive pacing: given elapsed time,
the rolling score, coverage, and reserve availability, decide whether a pacing gate is OPEN. The LLM
(llm_ops.judge_pacing) only ever runs when a gate opens, and can only confirm — it can never make the
session end before the floor or run past the ceiling, because those are decided here."""
from __future__ import annotations

from dataclasses import dataclass

from app.interview_agent.types import PacingGate


@dataclass(frozen=True)
class PacingBands:
    min_s: float          # floor — no wind-down before this
    base_s: float         # target duration
    max_s: float          # hard ceiling
    low: float            # rolling below this (after floor) → may wind down
    high: float           # rolling above this (near base) → may extend
    extend_lookahead_s: float   # how long before base_s the extend gate opens
    min_coverage: float   # coverage floor before a wind-down is allowed


def evaluate_gate(elapsed_s: float, rolling: float, cov: float,
                  reserve_available: bool, bands: PacingBands) -> PacingGate:
    """Rails first, then bands. Order matters: the ceiling is absolute; the floor blocks all
    wind-downs; extend only near/after base with strong score AND material to extend with."""
    if elapsed_s >= bands.max_s:
        return PacingGate.MUST_WRAP
    if elapsed_s < bands.min_s:
        return PacingGate.LOCKED
    # Past the floor:
    if rolling < bands.low and cov >= bands.min_coverage:
        return PacingGate.MAY_WIND_DOWN
    if (elapsed_s >= bands.base_s - bands.extend_lookahead_s
            and rolling > bands.high and reserve_available):
        return PacingGate.MAY_EXTEND
    return PacingGate.CONTINUE
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_pacing.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/pacing.py tests/interview_agent/test_pacing.py
git commit -m "feat(interview-agent): pure deterministic pacing gate (floor/ceiling/bands)"
```

---

### Task 7: Session state (`state.py`)

**Files:**
- Create: `app/interview_agent/state.py`
- Test: `tests/interview_agent/test_state.py`

**Interfaces:**
- Consumes: `PacingBands` (Task 6); a plan dict shaped like `InterviewPlan.model_dump(by_alias=True)` (camelCase).
- Produces: `SessionState` dataclass + its helper methods (Shared interfaces), and the graph TypedDicts `DecisionInputs` / `DecisionOutput`. Consumed by `graph.py` (Task 10) and `session.py` (Task 12).

`SessionState` fields (mutable):
```
session_id, round_type: RoundType, plan: dict
transcript: list[Turn]
ladders: list[dict]                 # plan["questionLadders"]
reserve: list[dict]                 # plan["reserve"]
ladder_idx: int = 0                 # index into ladders (the "core" being worked)
followup_idx: int = -1              # -1 = base not yet escalated
hint_idx: int = -1
asked_slugs: set[str]
attempted_core: int = 0             # distinct core ladders meaningfully answered
per_answer: list[PerAnswerScore]
negative_events: list[NegativeEvent]
rolling: float = 0.0
pacing_directive: PacingDirective = CONTINUE
extensions_granted: int = 0
pivot_count: int = 0
derived_topics: list[str]
hint_just_given: bool = False
elapsed_s: float = 0.0
bands: PacingBands
session_over: bool = False
ended_reason: EndedReason | None = None
```

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_state.py`:

```python
from app.interview_agent.pacing import PacingBands
from app.interview_agent.state import SessionState
from app.interview_agent.types import RoundType, PacingDirective

BANDS = PacingBands(min_s=1080, base_s=2700, max_s=3600, low=0.4, high=0.7,
                    extend_lookahead_s=300, min_coverage=0.34)

PLAN = {
    "sessionId": "s1", "roundType": "dsa",
    "persona": {"name": "Ada", "opening": "hi", "closing": "bye"},
    "questionLadders": [
        {"questionSlug": "two-sum", "basePrompt": "solve two sum",
         "followUps": ["optimize it", "handle duplicates"], "hints": ["use a map"],
         "rubric": [{"criterion": "correctness", "weight": 1.0}]},
        {"questionSlug": "lru", "basePrompt": "design lru", "followUps": [], "hints": [],
         "rubric": [{"criterion": "correctness", "weight": 1.0}]},
    ],
    "reserve": [{"questionSlug": "res1", "basePrompt": "hard bonus", "rubric": []}],
}


def test_from_plan_initializes():
    st = SessionState.from_plan(PLAN, BANDS)
    assert st.session_id == "s1"
    assert st.round_type == RoundType.DSA
    assert len(st.ladders) == 2
    assert st.pacing_directive == PacingDirective.CONTINUE
    assert st.active_ladder()["questionSlug"] == "two-sum"


def test_next_followup_then_exhausts():
    st = SessionState.from_plan(PLAN, BANDS)
    assert st.next_followup() == "optimize it"
    assert st.next_followup() == "handle duplicates"
    assert st.next_followup() is None


def test_next_hint_then_exhausts():
    st = SessionState.from_plan(PLAN, BANDS)
    assert st.next_hint() == "use a map"
    assert st.next_hint() is None


def test_advance_to_next_question_resets_rungs():
    st = SessionState.from_plan(PLAN, BANDS)
    st.next_followup(); st.next_hint()
    st.advance_to_next_question()
    assert st.active_ladder()["questionSlug"] == "lru"
    assert st.followup_idx == -1 and st.hint_idx == -1


def test_advance_past_last_question_returns_none():
    st = SessionState.from_plan(PLAN, BANDS)
    st.advance_to_next_question()   # -> lru
    st.advance_to_next_question()   # -> past end
    assert st.active_ladder() is None


def test_take_reserve_pops_once():
    st = SessionState.from_plan(PLAN, BANDS)
    r = st.take_reserve()
    assert r["questionSlug"] == "res1"
    assert st.take_reserve() is None


def test_mark_asked_dedupes():
    st = SessionState.from_plan(PLAN, BANDS)
    st.mark_asked("two-sum"); st.mark_asked("two-sum")
    assert st.asked_slugs == {"two-sum"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_state.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

Create `app/interview_agent/state.py`:

```python
"""Mutable session state for a live interview + the graph's TypedDict I/O shapes. The driver
(session.py) owns and mutates a SessionState across turns; the decision graph reads a snapshot of it
(DecisionInputs) and returns a DecisionOutput. Navigation helpers keep ladder/follow-up/hint/reserve
position and the asked-slug dedupe set in one place."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TypedDict

from app.config import Settings
from app.interview_agent.pacing import PacingBands
from app.interview_agent.types import (
    Action, EndedReason, NegativeEvent, PacingDirective, PerAnswerScore, RoundType, Turn,
)


def bands_from_settings(settings: Settings) -> PacingBands:
    return PacingBands(
        min_s=settings.interview_min_duration_min * 60,
        base_s=settings.interview_base_duration_min * 60,
        max_s=settings.interview_max_duration_min * 60,
        low=settings.interview_low_band,
        high=settings.interview_high_band,
        extend_lookahead_s=settings.interview_extend_lookahead_s,
        min_coverage=settings.interview_min_coverage,
    )


class DecisionInputs(TypedDict):
    turn_class: str                 # TurnClass value ("" for the OPEN turn)
    requested_topic: str | None
    topic_scope: str                # TopicScope value
    pacing_directive: str           # PacingDirective value
    followups_left: bool
    hints_left: bool
    has_next_question: bool
    reserve_available: bool
    pivot_count: int
    pivot_cap: int


class DecisionOutput(TypedDict):
    action: str                     # Action value
    requested_topic: str | None


@dataclass
class SessionState:
    session_id: str
    round_type: RoundType
    plan: dict
    bands: PacingBands
    transcript: list[Turn] = field(default_factory=list)
    ladders: list[dict] = field(default_factory=list)
    reserve: list[dict] = field(default_factory=list)
    ladder_idx: int = 0
    followup_idx: int = -1
    hint_idx: int = -1
    reserve_idx: int = 0
    asked_slugs: set[str] = field(default_factory=set)
    attempted_core: int = 0
    per_answer: list[PerAnswerScore] = field(default_factory=list)
    negative_events: list[NegativeEvent] = field(default_factory=list)
    rolling: float = 0.0
    pacing_directive: PacingDirective = PacingDirective.CONTINUE
    extensions_granted: int = 0
    pivot_count: int = 0
    derived_topics: list[str] = field(default_factory=list)
    hint_just_given: bool = False
    elapsed_s: float = 0.0
    session_over: bool = False
    ended_reason: EndedReason | None = None

    @classmethod
    def from_plan(cls, plan: dict, bands: PacingBands) -> "SessionState":
        return cls(
            session_id=plan.get("sessionId") or plan.get("session_id") or "",
            round_type=RoundType(plan.get("roundType") or plan.get("round_type") or "dsa"),
            plan=plan,
            bands=bands,
            ladders=list(plan.get("questionLadders") or plan.get("question_ladders") or []),
            reserve=list(plan.get("reserve") or []),
        )

    def active_ladder(self) -> dict | None:
        if 0 <= self.ladder_idx < len(self.ladders):
            return self.ladders[self.ladder_idx]
        return None

    def advance_to_next_question(self) -> None:
        self.ladder_idx += 1
        self.followup_idx = -1
        self.hint_idx = -1
        self.hint_just_given = False

    def next_followup(self) -> str | None:
        lad = self.active_ladder()
        ups = (lad or {}).get("followUps") or (lad or {}).get("follow_ups") or []
        self.followup_idx += 1
        if 0 <= self.followup_idx < len(ups):
            return ups[self.followup_idx]
        return None

    def next_hint(self) -> str | None:
        lad = self.active_ladder()
        hints = (lad or {}).get("hints") or []
        self.hint_idx += 1
        if 0 <= self.hint_idx < len(hints):
            self.hint_just_given = True
            return hints[self.hint_idx]
        return None

    def take_reserve(self) -> dict | None:
        if self.reserve_idx < len(self.reserve):
            item = self.reserve[self.reserve_idx]
            self.reserve_idx += 1
            return item
        return None

    def mark_asked(self, slug: str | None) -> None:
        if slug:
            self.asked_slugs.add(slug)

    def followups_left(self) -> bool:
        lad = self.active_ladder() or {}
        ups = lad.get("followUps") or lad.get("follow_ups") or []
        return (self.followup_idx + 1) < len(ups)

    def hints_left(self) -> bool:
        lad = self.active_ladder() or {}
        hints = lad.get("hints") or []
        return (self.hint_idx + 1) < len(hints)

    def has_next_question(self) -> bool:
        return (self.ladder_idx + 1) < len(self.ladders)

    def reserve_available(self) -> bool:
        return self.reserve_idx < len(self.reserve)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_state.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/state.py tests/interview_agent/test_state.py
git commit -m "feat(interview-agent): mutable SessionState + navigation helpers + graph IO types"
```

---

### Task 8: Prompt scaffolds (`prompts/`)

**Files:**
- Create: `app/interview_agent/prompts/__init__.py`, `classify.py`, `grade.py`, `pacing_judge.py`, `converse.py`, `derive.py`
- Test: `tests/interview_agent/test_prompts.py`

**Interfaces:**
- Produces: for each module a `*_PROMPT_VERSION` str, a `*_SYSTEM` str, and a `build_*_prompt(...)` function returning a non-empty str. Consumed by `llm_ops.py` (Task 9). Real prompt text is product IP — these are functional scaffolds; every `_SYSTEM` imports `SPOKEN_STYLE` + `PLATFORM_CONTEXT`.

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_prompts.py`:

```python
from app.interview_agent.prompts import classify, grade, pacing_judge, converse, derive


def test_all_modules_have_version_and_system():
    for m in (classify, grade, pacing_judge, converse, derive):
        ver = next(getattr(m, a) for a in dir(m) if a.endswith("_PROMPT_VERSION"))
        sysp = next(getattr(m, a) for a in dir(m) if a.endswith("_SYSTEM"))
        assert isinstance(ver, str) and ver
        assert isinstance(sysp, str) and len(sysp) > 20


def test_build_functions_return_nonempty():
    assert classify.build_classify_prompt("This is a DSA round.", "two-sum: solve two sum", "I use a hashmap")
    assert grade.build_grade_prompt([{"criterion": "correctness", "weight": 1.0}], "solve two sum", "use a map")
    assert pacing_judge.build_pacing_judgment_prompt("may_wind_down", 0.3, "candidate struggled on 2 questions")
    assert converse.build_turn_prompt("ask_base", {"name": "Ada"}, {"basePrompt": "solve"}, [], {})
    assert derive.build_derive_prompt("dsa", "dynamic programming", "brief text", "jd text")


def test_converse_system_carries_spoken_style():
    assert "SPEAKING STYLE" in converse.CONVERSE_SYSTEM
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_prompts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.interview_agent.prompts'`

- [ ] **Step 3: Implement**

Create `app/interview_agent/prompts/__init__.py`:

```python
"""Live-interview prompt scaffolds (Pipeline 2). Same contract as app/interview_prep/prompts:
each module exports *_PROMPT_VERSION, *_SYSTEM, and build_*_prompt(). Real text is product IP —
these are functional scaffolds; bump the version on any change. All spoken-facing prompts import
SPOKEN_STYLE + PLATFORM_CONTEXT from interview_prep/prompts/style.py so the live voice matches the
plan's voice."""
```

Create `app/interview_agent/prompts/classify.py`:

```python
"""Classify a candidate turn into a TurnClass and, for pivots, extract the requested topic + scope."""
from __future__ import annotations

import json

CLASSIFY_PROMPT_VERSION = "v0-scaffold"

CLASSIFY_SYSTEM = (
    "You label ONE candidate turn in a live technical interview. Return JSON only.\n"
    "Classes: answer (they attempt the question), clarify (they ask a clarifying question about the "
    "current question), off_topic (unrelated tangent), challenge (they push back on you/the process), "
    "distress (nervous, stuck, apologetic), idk_silence (they don't know / say nothing), "
    "pivot_request (they ask to switch to a DIFFERENT topic or question).\n"
    "For pivot_request also return requested_topic (the topic they want, or null if unspecified) and "
    "topic_scope: 'in' if it still belongs to this round, 'out' if it belongs to a different kind of "
    "round, 'unclear' otherwise. Use the round context provided."
)

_SCHEMA = (
    '\nReturn EXACTLY: {"turn_class": "<one class>", "requested_topic": <string|null>, '
    '"topic_scope": "in"|"out"|"unclear"}'
)


def build_classify_prompt(round_context: str, active_item_summary: str, last_text: str) -> str:
    return (
        f"ROUND CONTEXT: {round_context}\n"
        f"CURRENT QUESTION: {active_item_summary}\n"
        f"CANDIDATE TURN: {json.dumps(last_text)}\n"
        f"{_SCHEMA}"
    )
```

Create `app/interview_agent/prompts/grade.py`:

```python
"""Grade one answer against the active question's rubric. Interviewer-only; never shown to candidate."""
from __future__ import annotations

import json

GRADE_PROMPT_VERSION = "v0-scaffold"

GRADE_SYSTEM = (
    "You grade a candidate's answer against an interviewer rubric. Return JSON only. For each rubric "
    "criterion give a score in [0,1] (1 = matches the strong descriptor, 0 = matches the weak one). "
    "Also give coherence in [0,1] for how clearly the answer was expressed. Do not invent criteria."
)

_SCHEMA = '\nReturn EXACTLY: {"criteria": [{"criterion": "<name>", "score": <0..1>}], "coherence": <0..1>}'


def build_grade_prompt(rubric: list[dict], question: str, answer: str) -> str:
    return (
        f"RUBRIC:\n{json.dumps(rubric, ensure_ascii=False)}\n"
        f"QUESTION: {json.dumps(question)}\n"
        f"ANSWER: {json.dumps(answer)}\n"
        f"{_SCHEMA}"
    )
```

Create `app/interview_agent/prompts/pacing_judge.py`:

```python
"""Confirm/deny a pacing gate the deterministic rails already opened (spec §7). The rails decide
WHETHER a decision is allowed; this decides whether to actually take it."""
from __future__ import annotations

PACING_JUDGE_PROMPT_VERSION = "v0-scaffold"

PACING_JUDGE_SYSTEM = (
    "A deterministic rule has opened a pacing decision in a live interview. Decide the directive. "
    "Return JSON only. If the gate is 'may_wind_down', return 'wind_down' ONLY if the candidate is "
    "genuinely unlikely to recover (not merely a slow starter who is improving); else 'continue'. "
    "If the gate is 'may_extend', return 'extend' ONLY if performance is genuinely strong and there "
    "is clear value in going deeper; else 'continue'."
)

_SCHEMA = '\nReturn EXACTLY: {"directive": "continue"|"wind_down"|"extend"}'


def build_pacing_judgment_prompt(gate: str, rolling: float, transcript_summary: str) -> str:
    return (
        f"GATE: {gate}\nRUNNING SCORE (0..1): {rolling:.2f}\n"
        f"RECENT PERFORMANCE SUMMARY: {transcript_summary}\n"
        f"{_SCHEMA}"
    )
```

Create `app/interview_agent/prompts/converse.py`:

```python
"""Generate the interviewer's next spoken line for a chosen Action. This is the voice the candidate
hears — spoken, one thing at a time, in the plan persona's manner."""
from __future__ import annotations

import json

from app.interview_prep.prompts.style import PLATFORM_CONTEXT, SPOKEN_STYLE

CONVERSE_PROMPT_VERSION = "v0-scaffold"

CONVERSE_SYSTEM = (
    "You ARE the interviewer in a live voice interview. Produce ONE short spoken line for the given "
    "ACTION, in the persona's voice. It is read aloud by TTS, so write speech, not prose. Ask a "
    "SINGLE thing. Never reveal the rubric or that the candidate is being scored. For a wind-down, "
    "stay warm and give no hint of underperformance. For a refusal, state plainly which round this "
    "is and that you can only cover that here, then steer back — do not be harsh.\n"
    "\n"
    + SPOKEN_STYLE
    + PLATFORM_CONTEXT
    + '\nReturn EXACTLY: {"line": "<the spoken line>"}'
)


def build_turn_prompt(action: str, persona: dict, active_item: dict,
                      transcript_tail: list[dict], extra: dict) -> str:
    return (
        f"ACTION: {action}\n"
        f"PERSONA: {json.dumps(persona, ensure_ascii=False)}\n"
        f"CURRENT ITEM: {json.dumps(active_item, ensure_ascii=False)}\n"
        f"RECENT TURNS: {json.dumps(transcript_tail, ensure_ascii=False)}\n"
        f"EXTRA: {json.dumps(extra, ensure_ascii=False)}\n"
    )
```

Create `app/interview_agent/prompts/derive.py`:

```python
"""Derive a small question ladder on a NEW in-scope topic mid-interview (spec §8.2), grounded in the
round + brief + JD. Output matches one QuestionLadder so it can be scored like any other."""
from __future__ import annotations

import json

DERIVE_PROMPT_VERSION = "v0-scaffold"

DERIVE_SYSTEM = (
    "Generate ONE question ladder on the requested topic for a live interview, calibrated to the "
    "round and grounded in the brief/JD. Return JSON only, matching the ladder shape: base_prompt, "
    "follow_ups (1-2, escalating), hints (1-2), rubric (2-3 weighted criteria). Keep it to material "
    "answerable in a few minutes."
)

_SCHEMA = (
    '\nReturn EXACTLY: {"base_prompt": "<question>", "follow_ups": ["..."], "hints": ["..."], '
    '"rubric": [{"criterion": "<name>", "weight": <number>}]}'
)


def build_derive_prompt(round_type: str, topic: str, brief: str, jd: str) -> str:
    return (
        f"ROUND: {round_type}\nTOPIC REQUESTED: {topic}\n"
        f"BRIEF (context): {brief[:1500]}\nJD (context): {jd[:1000]}\n"
        f"{_SCHEMA}"
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_prompts.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/prompts/ tests/interview_agent/test_prompts.py
git commit -m "feat(interview-agent): versioned prompt scaffolds (classify/grade/pacing/converse/derive)"
```

---

### Task 9: LLM operations (`llm_ops.py`)

**Files:**
- Create: `app/interview_agent/llm_ops.py`
- Test: `tests/interview_agent/test_llm_ops.py`

**Interfaces:**
- Consumes: `complete_structured` + `LLMClient` (`app/llm`), the prompt scaffolds (Task 8), `scope.scope_prompt_context` (Task 4), the enums (Task 3).
- Produces: the five async ops in Shared interfaces. Each returns plain Python (enum / tuple / dict), not a Pydantic model, so the graph and driver stay decoupled from LLM internals. Consumed by `graph.py` (Task 10) and `session.py` (Task 12).

**Note:** These wrap `complete_structured` against tiny local Pydantic response models. Tests stub `complete_structured` via monkeypatch (mirroring `tests/test_interview_prep_pipeline.py`), so no network.

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_llm_ops.py`:

```python
import asyncio

import app.interview_agent.llm_ops as ops
from app.interview_agent.types import TurnClass, PacingDirective
from app.config import get_settings


def _run(coro):
    return asyncio.run(coro)


def _stub_structured(monkeypatch, payload):
    async def fake(llm, system, user, response_model, *, max_repairs, label):
        return response_model.model_validate(payload)
    monkeypatch.setattr(ops, "complete_structured", fake)


def test_classify_turn_maps_result(monkeypatch):
    _stub_structured(monkeypatch, {"turn_class": "pivot_request", "requested_topic": "dp", "topic_scope": "in"})
    tc, topic = _run(ops.classify_turn(llm=None, settings=get_settings(),
                                       round_type="dsa", active_item_summary="two-sum", last_text="ask dp"))
    assert tc == TurnClass.PIVOT_REQUEST and topic == "dp"


def test_grade_answer_aggregates_criteria(monkeypatch):
    _stub_structured(monkeypatch, {"criteria": [{"criterion": "c1", "score": 0.8},
                                                 {"criterion": "c2", "score": 0.6}], "coherence": 0.5})
    comp, coh = _run(ops.grade_answer(llm=None, settings=get_settings(),
                                      rubric=[{"criterion": "c1", "weight": 0.5},
                                              {"criterion": "c2", "weight": 0.5}],
                                      question="q", answer="a"))
    assert 0.6 <= comp <= 0.8 and coh == 0.5


def test_judge_pacing_maps_directive(monkeypatch):
    _stub_structured(monkeypatch, {"directive": "wind_down"})
    d = _run(ops.judge_pacing(llm=None, settings=get_settings(), gate="may_wind_down",
                              rolling=0.3, transcript_summary="weak"))
    assert d == PacingDirective.WIND_DOWN


def test_generate_line_returns_text(monkeypatch):
    _stub_structured(monkeypatch, {"line": "So, let's start — walk me through two sum."})
    line = _run(ops.generate_line(llm=None, settings=get_settings(), action="ask_base",
                                  persona={"name": "Ada"}, active_item={"basePrompt": "two sum"},
                                  transcript_tail=[], extra={}))
    assert "two sum" in line.lower()


def test_derive_ladder_returns_dict(monkeypatch):
    _stub_structured(monkeypatch, {"base_prompt": "longest increasing subsequence",
                                   "follow_ups": ["optimize to n log n"], "hints": ["patience sorting"],
                                   "rubric": [{"criterion": "approach", "weight": 1.0}]})
    lad = _run(ops.derive_ladder(llm=None, settings=get_settings(), round_type="dsa",
                                 topic="dp", brief="b", jd="j"))
    assert lad["basePrompt"] == "longest increasing subsequence"   # camelCase out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_llm_ops.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

Create `app/interview_agent/llm_ops.py`:

```python
"""All LLM I/O for the live brain, in one place so the graph/driver stay pure and tests can stub it.
Each op wraps complete_structured against a tiny response model and returns plain Python. Errors
propagate as LLMError; callers (session.py) decide fallbacks (spec §10)."""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.config import Settings
from app.interview_agent.prompts import classify as classify_p
from app.interview_agent.prompts import converse as converse_p
from app.interview_agent.prompts import derive as derive_p
from app.interview_agent.prompts import grade as grade_p
from app.interview_agent.prompts import pacing_judge as pacing_p
from app.interview_agent.scope import scope_prompt_context
from app.interview_agent.schema import DerivedLadder   # Task 14 adds this; see note below
from app.interview_agent.types import PacingDirective, RoundType, TurnClass
from app.interview_prep.schema import QuestionLadder
from app.llm.client import LLMClient
from app.llm.structured import complete_structured


def _scorer_max_repairs(settings: Settings) -> int:
    return settings.interview_max_repairs


# ---- tiny response models (local; snake_case in, we read plainly) ----

class _Classify(BaseModel):
    turn_class: str
    requested_topic: str | None = None
    topic_scope: str = "unclear"


class _Criterion(BaseModel):
    criterion: str = ""
    score: float = 0.0


class _Grade(BaseModel):
    criteria: list[_Criterion] = Field(default_factory=list)
    coherence: float = 0.0


class _Directive(BaseModel):
    directive: str = "continue"


class _Line(BaseModel):
    line: str = ""


async def classify_turn(llm: LLMClient, settings: Settings, *, round_type, active_item_summary: str,
                        last_text: str) -> tuple[TurnClass, str | None]:
    rt = round_type if isinstance(round_type, RoundType) else RoundType(round_type)
    res = await complete_structured(
        llm, classify_p.CLASSIFY_SYSTEM,
        classify_p.build_classify_prompt(scope_prompt_context(rt), active_item_summary, last_text),
        _Classify, max_repairs=_scorer_max_repairs(settings), label="iv-classify")
    try:
        tc = TurnClass(res.turn_class)
    except ValueError:
        tc = TurnClass.ANSWER
    return tc, (res.requested_topic or None)


async def grade_answer(llm: LLMClient, settings: Settings, *, rubric: list[dict], question: str,
                       answer: str) -> tuple[float, float]:
    """Return (competency, coherence). competency = rubric-weighted mean of per-criterion scores;
    falls back to a simple mean if weights are absent."""
    res = await complete_structured(
        llm, grade_p.GRADE_SYSTEM, grade_p.build_grade_prompt(rubric, question, answer),
        _Grade, max_repairs=_scorer_max_repairs(settings), label="iv-grade")
    weights = {(c.get("criterion") or "").lower(): float(c.get("weight") or 0.0) for c in rubric}
    total_w = sum(weights.values())
    if res.criteria and total_w > 0:
        comp = sum(c.score * weights.get(c.criterion.lower(), 0.0) for c in res.criteria) / total_w
    elif res.criteria:
        comp = sum(c.score for c in res.criteria) / len(res.criteria)
    else:
        comp = 0.0
    return max(0.0, min(1.0, comp)), max(0.0, min(1.0, res.coherence))


async def judge_pacing(llm: LLMClient, settings: Settings, *, gate: str, rolling: float,
                       transcript_summary: str) -> PacingDirective:
    res = await complete_structured(
        llm, pacing_p.PACING_JUDGE_SYSTEM,
        pacing_p.build_pacing_judgment_prompt(gate, rolling, transcript_summary),
        _Directive, max_repairs=_scorer_max_repairs(settings), label="iv-pacing")
    try:
        return PacingDirective(res.directive)
    except ValueError:
        return PacingDirective.CONTINUE


async def generate_line(llm: LLMClient, settings: Settings, *, action: str, persona: dict,
                        active_item: dict, transcript_tail: list[dict], extra: dict) -> str:
    res = await complete_structured(
        llm, converse_p.CONVERSE_SYSTEM,
        converse_p.build_turn_prompt(action, persona, active_item, transcript_tail, extra),
        _Line, max_repairs=_scorer_max_repairs(settings), label="iv-converse")
    return res.line


async def derive_ladder(llm: LLMClient, settings: Settings, *, round_type, topic: str, brief: str,
                        jd: str) -> dict:
    """Return a QuestionLadder-shaped dict (camelCase, ready to slot into state.ladders)."""
    rt = round_type.value if isinstance(round_type, RoundType) else str(round_type)
    res = await complete_structured(
        llm, derive_p.DERIVE_SYSTEM, derive_p.build_derive_prompt(rt, topic, brief, jd),
        QuestionLadder, max_repairs=_scorer_max_repairs(settings), label="iv-derive")
    return res.model_dump(by_alias=True, mode="json")
```

**Note on the `DerivedLadder` import:** remove the `from app.interview_agent.schema import DerivedLadder` line — it is NOT used (an artifact). `derive_ladder` validates directly into `QuestionLadder` from `app/interview_prep/schema.py`. Delete that import line before running the test.

- [ ] **Step 4: Fix the stray import, then run the test**

Delete the line `from app.interview_agent.schema import DerivedLadder   # ...` from `llm_ops.py`.
Run: `pytest tests/interview_agent/test_llm_ops.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/llm_ops.py tests/interview_agent/test_llm_ops.py
git commit -m "feat(interview-agent): isolated LLM ops (classify/grade/judge/generate/derive)"
```

---

### Task 10: Decision graph (`graph.py`)

**Files:**
- Create: `app/interview_agent/graph.py`
- Test: `tests/interview_agent/test_graph.py`

**Interfaces:**
- Consumes: `llm_ops` (Task 9), `scope` (Task 4), `SessionState` + `DecisionInputs`/`DecisionOutput` (Task 7), enums (Task 3).
- Produces: `decide(inputs: DecisionInputs) -> Action` (pure router, tested directly), `build_inputs(state, turn_class, requested_topic, topic_scope, settings) -> DecisionInputs`, and `run_decision(state, utterance, deps) -> DecisionOutput` (does classify via llm_ops, applies the deterministic scope guard, then `decide`). Consumed by `session.py` (Task 12).

**Design note:** The LangGraph `StateGraph` here wires `classify → scope_guard → decide` as nodes over a small working dict. `decide` itself is a pure function so the routing logic is unit-tested without LangGraph. `run_decision` is the entry the driver calls.

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_graph.py`:

```python
import asyncio

import app.interview_agent.graph as g
from app.interview_agent.state import SessionState, bands_from_settings
from app.interview_agent.types import Action, PacingDirective, TurnClass, TopicScope
from app.config import get_settings

PLAN = {
    "sessionId": "s1", "roundType": "dsa", "persona": {"name": "Ada"},
    "questionLadders": [
        {"questionSlug": "q1", "basePrompt": "b1", "followUps": ["f1"], "hints": ["h1"],
         "rubric": [{"criterion": "c", "weight": 1.0}]},
        {"questionSlug": "q2", "basePrompt": "b2", "followUps": [], "hints": [], "rubric": []},
    ],
    "reserve": [{"questionSlug": "r1", "basePrompt": "hard"}],
}


def _inputs(**over):
    base = dict(turn_class="answer", requested_topic=None, topic_scope="unclear",
                pacing_directive="continue", followups_left=True, hints_left=True,
                has_next_question=True, reserve_available=True, pivot_count=0, pivot_cap=2)
    base.update(over)
    return base


def test_decide_wind_down_directive_overrides():
    assert g.decide(_inputs(pacing_directive="wind_down")) == Action.WIND_DOWN


def test_decide_extend_directive_pulls_reserve():
    assert g.decide(_inputs(pacing_directive="extend", reserve_available=True)) == Action.EXTEND_RESERVE


def test_decide_out_of_scope_pivot_refuses():
    assert g.decide(_inputs(turn_class="pivot_request", topic_scope="out")) == Action.REFUSE_OUT_OF_SCOPE


def test_decide_in_scope_pivot_derives_until_cap():
    assert g.decide(_inputs(turn_class="pivot_request", topic_scope="in", pivot_count=0)) == Action.PIVOT_DERIVE
    assert g.decide(_inputs(turn_class="pivot_request", topic_scope="in", pivot_count=2, pivot_cap=2)) == Action.HOLD_GROUND


def test_decide_answer_escalates_then_moves_on():
    assert g.decide(_inputs(turn_class="answer", followups_left=True)) == Action.ESCALATE_FOLLOWUP
    assert g.decide(_inputs(turn_class="answer", followups_left=False, has_next_question=True)) == Action.MOVE_ON
    assert g.decide(_inputs(turn_class="answer", followups_left=False, has_next_question=False)) == Action.WRAP


def test_decide_idk_gives_hint_then_moves_on():
    assert g.decide(_inputs(turn_class="idk_silence", hints_left=True)) == Action.GIVE_HINT
    assert g.decide(_inputs(turn_class="idk_silence", hints_left=False, has_next_question=True)) == Action.MOVE_ON


def test_decide_clarify_distress_challenge():
    assert g.decide(_inputs(turn_class="clarify")) == Action.ANSWER_CLARIFY
    assert g.decide(_inputs(turn_class="distress")) == Action.REASSURE
    assert g.decide(_inputs(turn_class="challenge")) == Action.DEESCALATE
    assert g.decide(_inputs(turn_class="off_topic")) == Action.REDIRECT


def test_run_decision_out_of_scope_uses_marker_guard(monkeypatch):
    # LLM says "in", but the marker guard forces "out" for a cross-round request.
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.PIVOT_REQUEST, "system design"
    monkeypatch.setattr(g.llm_ops, "classify_turn", fake_classify)
    st = SessionState.from_plan(PLAN, bands_from_settings(get_settings()))
    from app.interview_agent.types import Turn
    out = asyncio.run(g.run_decision(st, Turn("candidate", "can we do system design"),
                                     deps=g.GraphDeps(llm=None, settings=get_settings())))
    assert out["action"] == Action.REFUSE_OUT_OF_SCOPE.value
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_graph.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

Create `app/interview_agent/graph.py`:

```python
"""The per-turn decision graph — the LangGraph 'brain'. classify (LLM) → scope guard (deterministic)
→ decide (pure router). decide() is a pure function of a DecisionInputs snapshot so the routing is
unit-tested without LangGraph; build_interview_graph wires the same steps as a StateGraph for
inspectability. run_decision is what the driver (session.py) calls each turn."""
from __future__ import annotations

from dataclasses import dataclass

from langgraph.graph import END, StateGraph

from app.config import Settings
from app.interview_agent import llm_ops
from app.interview_agent.scope import out_of_scope_by_markers
from app.interview_agent.state import DecisionInputs, DecisionOutput, SessionState
from app.interview_agent.types import Action, PacingDirective, RoundType, TopicScope, Turn, TurnClass


@dataclass
class GraphDeps:
    llm: object            # LLMClient | None (None only in tests that stub llm_ops)
    settings: Settings


def _active_summary(state: SessionState) -> str:
    lad = state.active_ladder() or {}
    slug = lad.get("questionSlug") or lad.get("question_slug") or ""
    base = lad.get("basePrompt") or lad.get("base_prompt") or ""
    return f"{slug}: {base}"[:300]


def build_inputs(state: SessionState, turn_class: TurnClass, requested_topic: str | None,
                 topic_scope: TopicScope, settings: Settings) -> DecisionInputs:
    return DecisionInputs(
        turn_class=turn_class.value,
        requested_topic=requested_topic,
        topic_scope=topic_scope.value,
        pacing_directive=state.pacing_directive.value,
        followups_left=state.followups_left(),
        hints_left=state.hints_left(),
        has_next_question=state.has_next_question(),
        reserve_available=state.reserve_available(),
        pivot_count=state.pivot_count,
        pivot_cap=settings.interview_pivot_cap,
    )


def decide(inputs: DecisionInputs) -> Action:
    """Pure router. Precedence: pacing directive (wind-down/extend) overrides everything, then
    steering by turn class, then plan navigation."""
    directive = inputs["pacing_directive"]
    if directive == PacingDirective.WIND_DOWN.value:
        return Action.WIND_DOWN
    if directive == PacingDirective.EXTEND.value:
        return Action.EXTEND_RESERVE if inputs["reserve_available"] else Action.ESCALATE_FOLLOWUP

    tc = inputs["turn_class"]
    if tc == TurnClass.PIVOT_REQUEST.value:
        if inputs["topic_scope"] == TopicScope.OUT.value:
            return Action.REFUSE_OUT_OF_SCOPE
        if inputs["pivot_count"] >= inputs["pivot_cap"]:
            return Action.HOLD_GROUND
        return Action.PIVOT_DERIVE
    if tc == TurnClass.CLARIFY.value:
        return Action.ANSWER_CLARIFY
    if tc == TurnClass.DISTRESS.value:
        return Action.REASSURE
    if tc == TurnClass.CHALLENGE.value:
        return Action.DEESCALATE
    if tc == TurnClass.OFF_TOPIC.value:
        return Action.REDIRECT
    if tc == TurnClass.IDK_SILENCE.value:
        if inputs["hints_left"]:
            return Action.GIVE_HINT
        return Action.MOVE_ON if inputs["has_next_question"] else Action.WRAP

    # ANSWER (default)
    if inputs["followups_left"]:
        return Action.ESCALATE_FOLLOWUP
    return Action.MOVE_ON if inputs["has_next_question"] else Action.WRAP


async def run_decision(state: SessionState, utterance: Turn | None, deps: GraphDeps) -> DecisionOutput:
    """Classify the candidate turn (LLM), apply the deterministic cross-round scope guard, then
    route. For the OPEN turn (utterance is None) skip classification and return OPEN."""
    if utterance is None:
        return DecisionOutput(action=Action.OPEN.value, requested_topic=None)

    turn_class, requested_topic = await llm_ops.classify_turn(
        deps.llm, deps.settings, round_type=state.round_type,
        active_item_summary=_active_summary(state), last_text=utterance.text)

    topic_scope = TopicScope.UNCLEAR
    if turn_class == TurnClass.PIVOT_REQUEST:
        # Deterministic guard wins: a clear cross-round request is OUT no matter what the LLM said.
        if out_of_scope_by_markers(state.round_type, requested_topic or utterance.text):
            topic_scope = TopicScope.OUT
        else:
            topic_scope = TopicScope.IN

    inputs = build_inputs(state, turn_class, requested_topic, topic_scope, deps.settings)
    action = decide(inputs)
    return DecisionOutput(action=action.value, requested_topic=requested_topic)


def build_interview_graph(deps: GraphDeps):
    """LangGraph assembly of the same steps (classify → scope_guard → decide) for inspectability.
    State is a working dict carrying the SessionState + utterance + result. Not required by the
    driver (which calls run_decision), but kept so the decision flow is a visible graph."""
    async def _classify(s: dict) -> dict:
        out = await run_decision(s["state"], s["utterance"], deps)
        return {"result": out}

    sg = StateGraph(dict)
    sg.add_node("decide", _classify)
    sg.set_entry_point("decide")
    sg.add_edge("decide", END)
    return sg.compile()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_graph.py -v`
Expected: PASS (all decide + run_decision tests)

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/graph.py tests/interview_agent/test_graph.py
git commit -m "feat(interview-agent): decision graph — pure router + LangGraph assembly + scope guard"
```

---

### Task 11: Transport interface + scripted test double (`transport.py`)

**Files:**
- Create: `app/interview_agent/transport.py`
- Test: `tests/interview_agent/test_transport.py`

**Interfaces:**
- Produces: `Transport` Protocol, `ScriptedTransport` (records `say` calls, replays a scripted candidate utterance list), and a documented `LiveKitTransport` stub. Consumed by `session.py` (Task 12) and its tests.

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_transport.py`:

```python
import asyncio

from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.types import UtteranceTiming


def test_scripted_transport_replays_then_ends():
    t = ScriptedTransport(script=[("hello", UtteranceTiming(0, 2, 0.5)), ("world", UtteranceTiming(2, 4, 0.5))])

    async def go():
        assert (await t.next_utterance())[0] == "hello"
        assert (await t.next_utterance())[0] == "world"
        assert await t.next_utterance() is None      # exhausted → silence/disconnect
        await t.say("bye")
        await t.end_session()

    asyncio.run(go())
    assert t.said == ["bye"]
    assert t.ended is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_transport.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

Create `app/interview_agent/transport.py`:

```python
"""The assumed transport/voice interface (spec §3). The live brain talks to the outside world only
through Transport: say a line, await the next candidate utterance, end the session. The real LiveKit
+ STT/TTS adapter (sub-projects A + D) implements this later; ScriptedTransport is the test double
that drives the brain deterministically with no audio."""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.interview_agent.types import UtteranceTiming


@runtime_checkable
class Transport(Protocol):
    async def say(self, text: str) -> None: ...
    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None: ...
    async def end_session(self) -> None: ...


class ScriptedTransport:
    """Feeds a fixed list of candidate utterances; returns None once exhausted (models a silence /
    disconnect). Records every line the interviewer says + whether the session was ended."""

    def __init__(self, script: list[tuple[str, UtteranceTiming]]):
        self._script = list(script)
        self._i = 0
        self.said: list[str] = []
        self.ended = False

    async def say(self, text: str) -> None:
        self.said.append(text)

    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None:
        if self._i >= len(self._script):
            return None
        item = self._script[self._i]
        self._i += 1
        return item

    async def end_session(self) -> None:
        self.ended = True


class LiveKitTransport:
    """STUB — real implementation belongs to sub-projects A (LiveKit rooms/tokens/media) + D
    (STT/TTS choice). Wire once the voice stack is decided; the brain needs no changes."""

    async def say(self, text: str) -> None:                      # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")

    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None:   # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")

    async def end_session(self) -> None:                         # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/interview_agent/test_transport.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/interview_agent/transport.py tests/interview_agent/test_transport.py
git commit -m "feat(interview-agent): Transport protocol + ScriptedTransport test double + LiveKit stub"
```

---

### Task 12: Session driver + outcome (`session.py`, `outcome.py`)

**Files:**
- Create: `app/interview_agent/outcome.py`
- Create: `app/interview_agent/session.py`
- Test: `tests/interview_agent/test_session.py`

**Interfaces:**
- Consumes: everything from Tasks 3-11.
- Produces: `outcome.finalize(state, ended_reason) -> SessionOutcome`; `session.run_session(transport, plan, settings) -> SessionOutcome`.

**Driver responsibilities (spec §4, §7, §8.2, §10):**
1. Build `SessionState.from_plan`, `bands_from_settings`; build a scorer `LLMClient` and a conversation `LLMClient` via `build_llm_client(settings, model=...)`.
2. Speak the OPENING (`generate_line` with `action=OPEN`).
3. Loop over `transport.next_utterance()`:
   - `None` → silence: retry up to `interview_silence_retries` with a "sorry, didn't catch that" line; then finalize `ABORTED_TECHNICAL`.
   - else append candidate `Turn`; **eval tail** (score the answer that was just given, update pacing directive for the *next* decision); then `run_decision`; **apply** the decision (see below); check terminal.
4. Apply decision → maps `Action` to: choose the spoken content (via `generate_line`), advance state, and for `PIVOT_DERIVE` run the derivation flow (stall line → background `derive_ladder` with nudge → splice a 1-2 question mini-ladder as the new active ladder → record pivot negative). For `REFUSE_OUT_OF_SCOPE`/`HOLD_GROUND` record the negative. For `WIND_DOWN`/`WRAP`/`CLOSE` progress toward termination.
5. On terminal: `finalize` + `transport.end_session()`.

**Eval-tail timing (spec §4):** scoring runs AFTER the interviewer's previous line was spoken and BEFORE the next decision — i.e. during the candidate's own speaking/thinking time — so it is off the critical path, and its result (the updated `pacing_directive`) is consumed on the next turn.

**Note:** to keep the driver testable and deterministic, all LLM calls go through `llm_ops`, which tests stub. Timing uses `utterance` timestamps + a monotonic `elapsed_s` the tests set explicitly via the scripted timings (t_end), so no wall-clock.

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_session.py`:

```python
import asyncio

import app.interview_agent.session as sess
import app.interview_agent.llm_ops as ops
from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.types import EndedReason, PacingDirective, TurnClass, UtteranceTiming
from app.config import get_settings


PLAN = {
    "sessionId": "s1", "candidateId": "c1", "roundType": "dsa",
    "persona": {"name": "Ada", "opening": "hi", "closing": "bye"},
    "questionLadders": [
        {"questionSlug": "q1", "basePrompt": "b1", "followUps": ["f1"], "hints": ["h1"],
         "rubric": [{"criterion": "c", "weight": 1.0}]},
        {"questionSlug": "q2", "basePrompt": "b2", "followUps": [], "hints": [], "rubric": []},
    ],
    "reserve": [{"questionSlug": "r1", "basePrompt": "hard bonus", "rubric": []}],
}


def _install_stubs(monkeypatch, *, classify=TurnClass.ANSWER, competency=0.8, directive=None):
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return classify, None
    async def fake_grade(llm, settings, *, rubric, question, answer):
        return competency, 0.7
    async def fake_generate(llm, settings, *, action, persona, active_item, transcript_tail, extra):
        return f"[{action}]"
    async def fake_judge(llm, settings, *, gate, rolling, transcript_summary):
        return directive or PacingDirective.CONTINUE
    async def fake_derive(llm, settings, *, round_type, topic, brief, jd):
        return {"questionSlug": "derived", "basePrompt": "derived q", "rubric": []}
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    monkeypatch.setattr(ops, "grade_answer", fake_grade)
    monkeypatch.setattr(ops, "generate_line", fake_generate)
    monkeypatch.setattr(ops, "judge_pacing", fake_judge)
    monkeypatch.setattr(ops, "derive_ladder", fake_derive)
    # avoid building a real network client
    monkeypatch.setattr(sess, "build_llm_client", lambda settings, model=None: None)


def _script(n, gap=180.0, start=0.0):
    """n candidate answers, each spaced `gap` seconds apart (drives elapsed_s)."""
    out = []
    t = start
    for _ in range(n):
        out.append(("some answer here that is reasonably long and coherent", UtteranceTiming(t, t + 5, 1.0)))
        t += gap
    return out


def test_natural_completion_strong_candidate(monkeypatch):
    _install_stubs(monkeypatch, competency=0.8)
    t = ScriptedTransport(_script(6, gap=120.0))
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert isinstance(out.ended_reason, EndedReason)
    assert t.ended is True
    assert t.said[0] == "[open]"                # opening spoken first
    assert out.live_score_final > 0.5


def test_weak_candidate_ends_early_after_floor(monkeypatch):
    # weak scores + judge confirms wind-down once the floor passes
    _install_stubs(monkeypatch, competency=0.2, directive=PacingDirective.WIND_DOWN)
    # space answers so elapsed crosses the 18-min floor within the script
    t = ScriptedTransport(_script(8, gap=180.0))
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.ended_reason == EndedReason.EARLY_WEAK
    assert any(a.startswith("[wind_down]") for a in t.said)


def test_out_of_scope_pivot_is_refused_and_penalized(monkeypatch):
    _install_stubs(monkeypatch, classify=TurnClass.PIVOT_REQUEST)
    # classify returns PIVOT with topic None; make the utterance clearly cross-round
    async def fake_classify(llm, settings, *, round_type, active_item_summary, last_text):
        return TurnClass.PIVOT_REQUEST, "system design"
    monkeypatch.setattr(ops, "classify_turn", fake_classify)
    t = ScriptedTransport([("can we do system design instead", UtteranceTiming(0, 3, 1.0))])
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert any(a.startswith("[refuse_out_of_scope]") for a in t.said)
    assert any(e.type == "out_of_scope" for e in out.negative_events)


def test_silence_aborts_after_retries(monkeypatch):
    _install_stubs(monkeypatch)
    t = ScriptedTransport([])   # no utterances at all → immediate silence
    out = asyncio.run(sess.run_session(t, PLAN, get_settings()))
    assert out.ended_reason == EndedReason.ABORTED_TECHNICAL
    assert t.ended is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_session.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `outcome.py`**

Create `app/interview_agent/outcome.py`:

```python
"""Assemble the SessionOutcome handed to post-interview (E). live_score_final is PROVISIONAL — E
recomputes the authoritative verdict from the evidence (spec §9)."""
from __future__ import annotations

from app.interview_agent.state import SessionState
from app.interview_agent.types import EndedReason, SessionOutcome


def finalize(state: SessionState, ended_reason: EndedReason) -> SessionOutcome:
    arc_completed = ended_reason in (EndedReason.NATURAL_COMPLETE, EndedReason.TIME_CEILING)
    return SessionOutcome(
        session_id=state.session_id,
        ended_reason=ended_reason,
        live_score_final=state.rolling,
        per_answer_evidence=list(state.per_answer),
        negative_events=list(state.negative_events),
        arc_completed=arc_completed,
        extensions_granted=state.extensions_granted,
        derived_topics=list(state.derived_topics),
        duration_s=state.elapsed_s,
    )
```

- [ ] **Step 4: Implement `session.py`**

Create `app/interview_agent/session.py`:

```python
"""The live-interview session driver (spec §4). Owns the mutable SessionState, all transport I/O, the
opening turn, the post-turn evaluation tail (score + pacing), topic-derivation orchestration (stall +
nudge), silence handling, and finalization. The decision graph (graph.run_decision) chooses each
action; the driver executes it. All LLM I/O goes through llm_ops (stubbed in tests)."""
from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.interview_agent import llm_ops
from app.interview_agent.graph import GraphDeps, run_decision
from app.interview_agent.outcome import finalize
from app.interview_agent.pacing import evaluate_gate
from app.interview_agent.state import SessionState, bands_from_settings
from app.interview_agent.transport import Transport
from app.interview_agent.types import (
    Action, EndedReason, NegativeEvent, PacingDirective, PacingGate, PerAnswerScore, Turn, UtteranceTiming,
)
from app.interview_agent import scoring
from app.llm.client import LLMClient, LLMError, build_llm_client

logger = logging.getLogger(__name__)

_ANSWER_LIKE = ("answer",)   # turn classes whose text we grade; classify happens inside run_decision


def _transcript_tail(state: SessionState, n: int = 4) -> list[dict]:
    return [{"speaker": t.speaker, "text": t.text} for t in state.transcript[-n:]]


def _brief_text(plan: dict) -> str:
    return str(plan.get("brief") or plan.get("briefSummary") or "")


def _jd_text(plan: dict) -> str:
    jd = plan.get("jobDescription") or plan.get("job_description") or {}
    if isinstance(jd, dict):
        return str(jd.get("description") or "")
    return str(jd or "")


async def _say(transport: Transport, state: SessionState, text: str) -> None:
    await transport.say(text)
    state.transcript.append(Turn(speaker="interviewer", text=text))


async def _gen(llm, settings, *, action: Action, state: SessionState, extra: dict) -> str:
    persona = state.plan.get("persona") or {}
    return await llm_ops.generate_line(
        llm, settings, action=action.value, persona=persona,
        active_item=state.active_ladder() or {}, transcript_tail=_transcript_tail(state), extra=extra)


async def _score_last_answer(scorer, settings: Settings, state: SessionState,
                             text: str, timing: UtteranceTiming) -> None:
    """Grade the candidate's answer against the active ladder's rubric + behavioral signals; update
    rolling. Grading failure is swallowed (spec §10: never block; keep last-known score)."""
    lad = state.active_ladder() or {}
    rubric = lad.get("rubric") or []
    try:
        competency, _coh = await llm_ops.grade_answer(
            scorer, settings, rubric=rubric,
            question=lad.get("basePrompt") or lad.get("base_prompt") or "", answer=text)
    except LLMError as exc:
        logger.warning("[iv] grade failed (%s) — keeping last score", exc)
        return
    sig = scoring.extract_behavioral(text, timing, hint_was_given=state.hint_just_given)
    beh = scoring.behavioral_score(sig)
    ans = scoring.answer_score(competency, beh, settings.interview_w_competency, settings.interview_w_behavioral)
    slug = lad.get("questionSlug") or lad.get("question_slug")
    state.per_answer.append(PerAnswerScore(slug=slug, competency=competency, behavioral=beh,
                                           answer_score=ans, weight=1.0))
    state.attempted_core += 1
    state.hint_just_given = False
    state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)


async def _update_pacing(scorer, settings: Settings, state: SessionState) -> None:
    """Run the deterministic gate; only if a gate opens ask the LLM to confirm the directive."""
    total_core = len(state.ladders)
    cov = scoring.coverage(state.attempted_core, total_core)
    gate = evaluate_gate(state.elapsed_s, state.rolling, cov, state.reserve_available(), state.bands)
    if gate == PacingGate.MUST_WRAP:
        state.pacing_directive = PacingDirective.WIND_DOWN   # forced wrap uses the wind-down path
        state.ended_reason = EndedReason.TIME_CEILING
        return
    if gate in (PacingGate.LOCKED, PacingGate.CONTINUE):
        state.pacing_directive = PacingDirective.CONTINUE
        return
    try:
        directive = await llm_ops.judge_pacing(
            scorer, settings, gate=gate.value, rolling=state.rolling,
            transcript_summary=f"{state.attempted_core} questions attempted; rolling {state.rolling:.2f}")
    except LLMError:
        directive = PacingDirective.CONTINUE
    state.pacing_directive = directive


async def _derive_flow(conv_llm, scorer, settings: Settings, transport: Transport,
                       state: SessionState, topic: str | None, timing_now: float) -> None:
    """Spec §8.2: acknowledge + stall, generate a mini-ladder in the background (nudging if slow),
    splice it as the new active ladder, and record the pivot negative."""
    state.pivot_count += 1
    state.negative_events.append(NegativeEvent(
        type="pivot", magnitude=settings.interview_pivot_penalty,
        reason=f"in-scope pivot to {topic or 'another topic'}", at_s=timing_now))
    state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)

    await _say(transport, state, await _gen(conv_llm, settings, action=Action.PIVOT_DERIVE, state=state,
                                            extra={"topic": topic, "stall": True}))
    task = asyncio.ensure_future(llm_ops.derive_ladder(
        conv_llm, settings, round_type=state.round_type, topic=topic or "a related topic",
        brief=_brief_text(state.plan), jd=_jd_text(state.plan)))
    try:
        derived = await asyncio.wait_for(asyncio.shield(task), timeout=settings.interview_nudge_after_s)
    except asyncio.TimeoutError:
        await _say(transport, state, "bear with me a sec — just pulling something together…")
        try:
            derived = await task
        except LLMError:
            derived = None
    except LLMError:
        derived = None

    if not derived:
        # Fallback (spec §8.2 step 5): stay on the current question; pivot negative already recorded.
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.REDIRECT, state=state, extra={}))
        return
    # Splice the derived ladder in as the next core item and move onto it.
    state.derived_topics.append(topic or "unspecified")
    state.ladders.insert(state.ladder_idx + 1, derived)
    state.advance_to_next_question()
    await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))


async def _apply_action(action: Action, requested_topic: str | None, conv_llm, scorer,
                        settings: Settings, transport: Transport, state: SessionState, now: float) -> None:
    if action == Action.EXTEND_RESERVE:
        item = state.take_reserve()
        if item is not None:
            state.extensions_granted += 1
            state.ladders.insert(state.ladder_idx + 1, item)
            state.advance_to_next_question()
        state.pacing_directive = PacingDirective.CONTINUE
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))
        return
    if action == Action.WIND_DOWN:
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.WIND_DOWN, state=state, extra={}))
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.WRAP, state=state, extra={}))
        await _say(transport, state, state.plan.get("persona", {}).get("closing") or
                   await _gen(conv_llm, settings, action=Action.CLOSE, state=state, extra={}))
        state.session_over = True
        if state.ended_reason is None:
            state.ended_reason = EndedReason.EARLY_WEAK
        return
    if action == Action.REFUSE_OUT_OF_SCOPE:
        state.negative_events.append(NegativeEvent(
            type="out_of_scope", magnitude=settings.interview_out_of_scope_penalty,
            reason=f"requested out-of-round topic: {requested_topic}", at_s=now))
        state.rolling = scoring.rolling_score(state.per_answer, state.negative_events)
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.REFUSE_OUT_OF_SCOPE,
                                                state=state, extra={"topic": requested_topic}))
        return
    if action == Action.HOLD_GROUND:
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.HOLD_GROUND, state=state, extra={}))
        return
    if action == Action.PIVOT_DERIVE:
        await _derive_flow(conv_llm, scorer, settings, transport, state, requested_topic, now)
        return
    if action == Action.ESCALATE_FOLLOWUP:
        state.next_followup()
        await _say(transport, state, await _gen(conv_llm, settings, action=action, state=state, extra={}))
        return
    if action == Action.GIVE_HINT:
        state.next_hint()
        await _say(transport, state, await _gen(conv_llm, settings, action=action, state=state, extra={}))
        return
    if action == Action.MOVE_ON:
        state.advance_to_next_question()
        state.mark_asked((state.active_ladder() or {}).get("questionSlug"))
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))
        return
    if action == Action.WRAP:
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.WRAP, state=state, extra={}))
        await _say(transport, state, state.plan.get("persona", {}).get("closing") or
                   await _gen(conv_llm, settings, action=Action.CLOSE, state=state, extra={}))
        state.session_over = True
        if state.ended_reason is None:
            state.ended_reason = EndedReason.NATURAL_COMPLETE
        return
    # ANSWER_CLARIFY / REDIRECT / DEESCALATE / REASSURE — respond, stay on the current item.
    await _say(transport, state, await _gen(conv_llm, settings, action=action, state=state, extra={}))


async def run_session(transport: Transport, plan: dict, settings: Settings):
    """Drive one live interview to completion; return the SessionOutcome. Never raises for interview
    content — technical failures resolve to EndedReason.ABORTED_TECHNICAL (spec §10)."""
    state = SessionState.from_plan(plan, bands_from_settings(settings))
    conv_llm = build_llm_client(settings, model=settings.interview_llm_model or None)
    scorer = build_llm_client(settings, model=settings.interview_scorer_model or None)
    deps = GraphDeps(llm=conv_llm, settings=settings)

    try:
        # Opening.
        await _say(transport, state, state.plan.get("persona", {}).get("opening") or
                   await _gen(conv_llm, settings, action=Action.OPEN, state=state, extra={}))
        state.mark_asked((state.active_ladder() or {}).get("questionSlug"))
        # Ask the first question.
        await _say(transport, state, await _gen(conv_llm, settings, action=Action.ASK_BASE, state=state, extra={}))

        silence_used = 0
        while not state.session_over:
            item = await transport.next_utterance()
            if item is None:
                silence_used += 1
                if silence_used > settings.interview_silence_retries:
                    state.ended_reason = EndedReason.ABORTED_TECHNICAL
                    break
                await _say(transport, state, "sorry — I didn't catch that, could you say it again?")
                continue
            silence_used = 0
            text, timing = item
            state.elapsed_s = timing.t_end
            state.transcript.append(Turn(speaker="candidate", text=text, t_start=timing.t_start, t_end=timing.t_end))

            # Eval tail (spec §4): score the answer just given, then refresh the pacing directive.
            await _score_last_answer(scorer, settings, state, text, timing)
            await _update_pacing(scorer, settings, state)

            decision = await run_decision(state, Turn("candidate", text), deps)
            await _apply_action(Action(decision["action"]), decision.get("requested_topic"),
                                conv_llm, scorer, settings, transport, state, timing.t_end)

        if state.ended_reason is None:
            state.ended_reason = EndedReason.NATURAL_COMPLETE
        return finalize(state, state.ended_reason)
    finally:
        for c in (conv_llm, scorer):
            if isinstance(c, LLMClient):
                await c.aclose()
        await transport.end_session()
```

- [ ] **Step 5: Run the tests**

Run: `pytest tests/interview_agent/test_session.py -v`
Expected: PASS (4 tests). If `test_weak_candidate_ends_early_after_floor` doesn't cross the floor, confirm the script's cumulative `t_end` exceeds `18*60` (8 answers × 180s = 1440s < 1080? No: 1080s is the floor; 8×180=1440 ≥ 1080 ✓). The wind-down fires once `elapsed_s ≥ min_s` and the stubbed judge returns WIND_DOWN.

- [ ] **Step 6: Commit**

```bash
git add app/interview_agent/outcome.py app/interview_agent/session.py tests/interview_agent/test_session.py
git commit -m "feat(interview-agent): session driver + outcome — full live loop with eval tail, pivots, pacing"
```

---

### Task 13: Full-suite regression + module `__init__`

**Files:**
- Create: `app/interview_agent/__init__.py` (if it only contains the stub README today, leave the README; ensure `__init__.py` exists and is importable)
- Test: run the whole suite

**Interfaces:** none new — this task verifies nothing regressed and the package imports cleanly.

- [ ] **Step 1: Ensure the package `__init__.py` exists**

Confirm `app/interview_agent/__init__.py` exists (it does — the stub). Leave its content; it just needs to be a valid module.

- [ ] **Step 2: Run the full interview_agent suite**

Run: `pytest tests/interview_agent/ -v`
Expected: PASS (all tests across Tasks 3-12).

- [ ] **Step 3: Run the ENTIRE service suite (no regressions)**

Run: `pytest -q`
Expected: PASS — the prior 199 tests + the new interview_agent tests, zero failures. If `langgraph` import slows collection, that's fine.

- [ ] **Step 4: Commit**

```bash
git add -A app/interview_agent tests/interview_agent
git commit -m "test(interview-agent): full-suite green after live-brain implementation"
```

---

### Task 14: Populate the extension reserve in Pipeline 1

**Files:**
- Create: `app/interview_prep/prompts/reserve.py`
- Modify: `app/interview_prep/generate.py` (add a 4th concurrent call; return reserve)
- Modify: `app/interview_prep/pipeline.py:36-64` (`_assemble_plan` includes `reserve`)
- Modify: `app/config.py` (`prep_plan_version` default `"v1"` → `"v2"`)
- Test: `tests/test_interview_prep_reserve.py`

**Interfaces:**
- Consumes: `ReserveSet` (Task 2), the existing `PrepContext`, `complete_structured`, `build_llm_client`.
- Produces: reserve ladders on the stored plan so the live agent's EXTEND path (Task 12) has pre-baked hard material. Bumps `PREP_PLAN_VERSION` so existing cached plans regenerate.

**Why last:** the brain already falls back to follow-ups when `reserve` is empty (Task 12 `EXTEND_RESERVE` → if `take_reserve()` is None, the driver simply continues). This task upgrades EXTEND to use pre-baked hard questions. It touches Pipeline 1, so it ships independently after the brain is green.

- [ ] **Step 1: Write the failing test**

Create `tests/test_interview_prep_reserve.py`:

```python
import asyncio

import app.interview_prep.generate as gen
from app.interview_prep.schema import ReserveSet, QuestionLadder
from app.config import get_settings


def test_reserve_prompt_builds():
    from app.interview_prep.prompts import reserve as r
    assert r.RESERVE_PROMPT_VERSION
    assert "SPEAKING STYLE" in r.RESERVE_SYSTEM
    assert r.build_reserve_prompt({"company": "razorpay"}, n=2)


def test_generate_reserve_returns_ladders(monkeypatch):
    async def fake_structured(llm, system, user, response_model, *, max_repairs, label):
        return response_model.model_validate({"ladders": [{"base_prompt": "hard bonus q"}]})
    monkeypatch.setattr(gen, "complete_structured", fake_structured)

    class _Ctx:
        round_type = "dsa"
        grounding = {"company": "razorpay"}
        questions = []
    reserve = asyncio.run(gen._reserve(llm=None, ctx=_Ctx(), settings=get_settings()))
    assert isinstance(reserve, ReserveSet)
    assert reserve.ladders[0].base_prompt == "hard bonus q"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_interview_prep_reserve.py -v`
Expected: FAIL with `ModuleNotFoundError: ...prompts.reserve` / `AttributeError: _reserve`

- [ ] **Step 3: Create the reserve prompt**

Create `app/interview_prep/prompts/reserve.py`:

```python
"""Extension-reserve prompt (Pipeline 1 → Pipeline 2). Generates a few EXTRA hard ladders used ONLY
when the live agent extends a strong candidate toward the time ceiling (spec §7). Same ladder shape
as ladder.py. v1 DRAFT — product IP; bump RESERVE_PROMPT_VERSION on change."""
from __future__ import annotations

import json

from app.interview_prep.prompts.style import PLATFORM_CONTEXT, SPOKEN_STYLE

RESERVE_PROMPT_VERSION = "v1"

RESERVE_SYSTEM = (
    "Produce a small set of EXTRA, HARDER question ladders for a strong candidate who finishes early "
    "and earns extra time. Each is a fresh, harder question in this round's domain — NOT a repeat of "
    "the main questions. Same shape as a normal ladder (base_prompt, follow_ups easiest→hardest, "
    "hints subtle→explicit, weighted rubric, timebox). Calibrate to the company/role/level.\n"
    "\n"
    + SPOKEN_STYLE
    + PLATFORM_CONTEXT
    + '\nReturn VALID JSON ONLY: {"ladders": [ { ...ladder... } ]}'
)


def build_reserve_prompt(grounding: dict, n: int = 2) -> str:
    return (
        f"Produce {n} harder bonus ladders for this round, grounded in the context. Do not duplicate "
        f"typical starter questions.\n\nGROUNDING:\n{json.dumps(grounding, ensure_ascii=False, indent=2)}\n"
    )
```

- [ ] **Step 4: Add `_reserve` to `generate.py` and include it in `generate_plan_parts`**

In `app/interview_prep/generate.py`, add the import and the call. After the `_probes` function (line ~63) add:

```python
async def _reserve(llm: LLMClient, ctx: PrepContext, settings: Settings) -> ReserveSet:
    from app.interview_prep.prompts import reserve as reserve_prompt
    with obs.span("interview_prep.reserve", round_type=ctx.round_type):
        return await complete_structured(
            llm, reserve_prompt.RESERVE_SYSTEM,
            reserve_prompt.build_reserve_prompt(ctx.grounding, n=2),
            ReserveSet, max_repairs=settings.prep_max_repairs, label="prep-reserve")
```

Add `ReserveSet` to the schema import block (line ~20-26):

```python
from app.interview_prep.schema import (
    CandidateProbe,
    LadderSet,
    PersonaAndArc,
    ProbeSet,
    QuestionLadder,
    ReserveSet,
)
```

Change `generate_plan_parts` (line ~66) to run and return reserve too:

```python
async def generate_plan_parts(
    ctx: PrepContext, settings: Settings
) -> tuple[PersonaAndArc, list[QuestionLadder], list[CandidateProbe], list[QuestionLadder]]:
    """Run the four calls concurrently and return their validated content. Raises LLMError if any of
    the three REQUIRED parts fails (a plan needs persona/ladders/probes; reserve is best-effort)."""
    with obs.span("interview_prep.generate", input_hash=ctx.input_hash):
        async with build_llm_client(settings, model=settings.prep_llm_model or None) as llm:
            results = await gather_capped(
                [_persona(llm, ctx, settings),
                 _ladders(llm, ctx, settings),
                 _probes(llm, ctx, settings),
                 _reserve(llm, ctx, settings)],
                settings.prep_concurrency,
            )

    persona_res, ladder_res, probe_res, reserve_res = results
    missing = [name for name, res in zip(("persona", "ladders", "probes"), results[:3]) if res is None]
    if missing:
        raise LLMError(f"interview plan generation failed for: {', '.join(missing)}")
    reserve_ladders = reserve_res.ladders if reserve_res is not None else []
    return persona_res, ladder_res.ladders, probe_res.probes, reserve_ladders
```

- [ ] **Step 5: Wire reserve into `_assemble_plan` and the caller in `pipeline.py`**

In `app/interview_prep/pipeline.py`, change `_assemble_plan`'s signature + body and the call site:

```python
def _assemble_plan(req, ctx, persona_and_arc, ladders, probes_list, reserve_ladders, settings):
    # ... existing provenance/InterviewPlan(...) unchanged, but add:
    #     reserve=reserve_ladders,
    # inside the InterviewPlan(...) constructor (after red_flag_watchlist).
```

Concretely, add `reserve_ladders` as a parameter before `settings`, and inside the `InterviewPlan(...)` add `reserve=reserve_ladders,`. Update the call in `generate_interview_plan` (line ~87-88):

```python
        persona_and_arc, ladders, probes_list, reserve_ladders = await generate_plan_parts(ctx, settings)
        plan = _assemble_plan(req, ctx, persona_and_arc, ladders, probes_list, reserve_ladders, settings)
```

- [ ] **Step 6: Bump the plan version so cached plans regenerate**

In `app/config.py`, change `prep_plan_version` default:

```python
    prep_plan_version: str = Field("v2", alias="PREP_PLAN_VERSION")
```

- [ ] **Step 7: Run the reserve test + the existing prep pipeline tests**

Run: `pytest tests/test_interview_prep_reserve.py tests/test_interview_prep_pipeline.py -v`
Expected: PASS. If `test_interview_prep_pipeline.py` stubs `generate_plan_parts` with a 3-tuple, update that stub to return a 4-tuple `(persona, ladders, probes, [])`. Search: `grep -n "generate_plan_parts" tests/test_interview_prep_pipeline.py` and fix the stub's return arity + any `_assemble_plan(` call arity in tests.

- [ ] **Step 8: Full suite + commit**

Run: `pytest -q`
Expected: PASS (no regressions).

```bash
git add app/interview_prep/prompts/reserve.py app/interview_prep/generate.py app/interview_prep/pipeline.py app/config.py tests/test_interview_prep_reserve.py tests/test_interview_prep_pipeline.py
git commit -m "feat(interview-prep): generate extension reserve on the plan (PREP_PLAN_VERSION v2)"
```

---

### Task 15: Candidate artifact channel (code / diagram) + artifact-aware grading

**Files:**
- Modify: `app/interview_agent/types.py` (add `ArtifactKind` + `Artifact`)
- Modify: `app/interview_agent/transport.py` (add `current_artifact()` to `Transport`, `ScriptedTransport`, `LiveKitTransport`)
- Modify: `app/interview_agent/prompts/grade.py` (`build_grade_prompt` gains optional `artifact`)
- Modify: `app/interview_agent/llm_ops.py` (`grade_answer` gains optional `artifact`)
- Modify: `app/interview_agent/session.py` (`_score_last_answer` pulls + forwards the artifact)
- Test: `tests/interview_agent/test_artifact.py`

**Interfaces:**
- Produces: `ArtifactKind` (CODE/DIAGRAM), `Artifact(kind, content, language=None)`; `Transport.current_artifact() -> Artifact | None`; `grade_answer(..., artifact: Artifact | None = None)`. Spec §3.1: read-only, NO execution — the LLM judges the code/diagram text; the diagram arrives as a text summary produced by the frontend (not this repo).

**Why last / additive:** the base brain (Tasks 3-14) grades on speech alone. This task layers the artifact in via an OPTIONAL param, so every earlier task's tests still pass unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/interview_agent/test_artifact.py`:

```python
import asyncio

import app.interview_agent.llm_ops as ops
from app.interview_agent.types import Artifact, ArtifactKind
from app.interview_agent.transport import ScriptedTransport
from app.interview_agent.prompts.grade import build_grade_prompt
from app.config import get_settings


def test_artifact_constructs():
    a = Artifact(kind=ArtifactKind.CODE, content="def f(): pass", language="python")
    assert a.kind == ArtifactKind.CODE and a.language == "python"


def test_scripted_transport_serves_artifact():
    a = Artifact(kind=ArtifactKind.CODE, content="x = 1", language="python")
    t = ScriptedTransport(script=[], artifact=a)
    assert asyncio.run(t.current_artifact()) is a


def test_grade_prompt_includes_artifact_code():
    p = build_grade_prompt([{"criterion": "correctness", "weight": 1.0}], "two sum", "use a map",
                           artifact=Artifact(kind=ArtifactKind.CODE, content="d={}; return d", language="python"))
    assert "d={}" in p and "python" in p


def test_grade_answer_passes_artifact_into_prompt(monkeypatch):
    captured = {}
    async def fake(llm, system, user, response_model, *, max_repairs, label):
        captured["user"] = user
        return response_model.model_validate({"criteria": [{"criterion": "correctness", "score": 0.9}],
                                              "coherence": 0.8})
    monkeypatch.setattr(ops, "complete_structured", fake)
    art = Artifact(kind=ArtifactKind.CODE, content="return sorted(nums)", language="python")
    comp, coh = asyncio.run(ops.grade_answer(llm=None, settings=get_settings(),
                                             rubric=[{"criterion": "correctness", "weight": 1.0}],
                                             question="sort", answer="I sort it", artifact=art))
    assert "return sorted(nums)" in captured["user"]
    assert comp == 0.9
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/interview_agent/test_artifact.py -v`
Expected: FAIL with `ImportError: cannot import name 'Artifact'`

- [ ] **Step 3: Add `ArtifactKind` + `Artifact` to `types.py`**

In `app/interview_agent/types.py`, after the `EndedReason` enum, add:

```python
class ArtifactKind(str, Enum):
    CODE = "code"
    DIAGRAM = "diagram"
```

And after the `Turn` dataclass, add:

```python
@dataclass(frozen=True)
class Artifact:
    """A read-only snapshot of what the candidate produced in the in-browser tool: source code
    (DSA/LLD) or a system-design diagram rendered to a text summary. Judged by reading — never
    executed in MVP (spec §3.1)."""
    kind: ArtifactKind
    content: str
    language: str | None = None
```

- [ ] **Step 4: Add `current_artifact()` to the transports**

In `app/interview_agent/transport.py`:

Import `Artifact` alongside `UtteranceTiming`:

```python
from app.interview_agent.types import Artifact, UtteranceTiming
```

Add to the `Transport` Protocol (after `next_utterance`):

```python
    async def current_artifact(self) -> Artifact | None: ...
```

Extend `ScriptedTransport.__init__` and add the method:

```python
    def __init__(self, script: list[tuple[str, UtteranceTiming]], artifact: Artifact | None = None):
        self._script = list(script)
        self._i = 0
        self.said: list[str] = []
        self.ended = False
        self._artifact = artifact

    # ... existing say / next_utterance unchanged ...

    async def current_artifact(self) -> Artifact | None:
        return self._artifact
```

Add to `LiveKitTransport` (stub):

```python
    async def current_artifact(self) -> Artifact | None:          # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")
```

- [ ] **Step 5: Extend the grade prompt**

In `app/interview_agent/prompts/grade.py`, bump the version and add the artifact to the builder:

```python
GRADE_PROMPT_VERSION = "v0-scaffold-2"
```

```python
def build_grade_prompt(rubric: list[dict], question: str, answer: str, artifact=None) -> str:
    parts = [
        f"RUBRIC:\n{json.dumps(rubric, ensure_ascii=False)}",
        f"QUESTION: {json.dumps(question)}",
        f"SPOKEN ANSWER: {json.dumps(answer)}",
    ]
    if artifact is not None:
        parts.append(
            f"CANDIDATE {artifact.kind.value.upper()} (language={artifact.language or 'n/a'}) — judge by "
            f"reading it, do NOT assume it was executed:\n{artifact.content[:4000]}")
    return "\n".join(parts) + _SCHEMA
```

Also update `GRADE_SYSTEM` to mention the artifact (bump already done):

```python
GRADE_SYSTEM = (
    "You grade a candidate's answer against an interviewer rubric. Return JSON only. For each rubric "
    "criterion give a score in [0,1] (1 = matches the strong descriptor, 0 = matches the weak one). "
    "If the candidate's code or diagram is provided, judge it by READING it — correctness, approach, "
    "and complexity — never assume it was run or tested. Also give coherence in [0,1] for how clearly "
    "the answer was expressed. Do not invent criteria."
)
```

- [ ] **Step 6: Thread the artifact through `grade_answer`**

In `app/interview_agent/llm_ops.py`, update `grade_answer`:

```python
async def grade_answer(llm: LLMClient, settings: Settings, *, rubric: list[dict], question: str,
                       answer: str, artifact=None) -> tuple[float, float]:
    res = await complete_structured(
        llm, grade_p.GRADE_SYSTEM, grade_p.build_grade_prompt(rubric, question, answer, artifact),
        _Grade, max_repairs=_scorer_max_repairs(settings), label="iv-grade")
    # ... rest unchanged (weighted mean etc.) ...
```

- [ ] **Step 7: Pull + forward the artifact in the driver**

In `app/interview_agent/session.py`, change `_score_last_answer` to accept an artifact and forward it, and pull it in `run_session` before scoring.

Update the signature + the grade call:

```python
async def _score_last_answer(scorer, settings: Settings, state: SessionState,
                             text: str, timing: UtteranceTiming, artifact=None) -> None:
    lad = state.active_ladder() or {}
    rubric = lad.get("rubric") or []
    try:
        competency, _coh = await llm_ops.grade_answer(
            scorer, settings, rubric=rubric,
            question=lad.get("basePrompt") or lad.get("base_prompt") or "", answer=text, artifact=artifact)
    except LLMError as exc:
        logger.warning("[iv] grade failed (%s) — keeping last score", exc)
        return
    # ... rest unchanged ...
```

In `run_session`, pull the artifact and pass it (replace the existing eval-tail scoring call):

```python
            # Eval tail (spec §4): score the answer just given (with the current code/diagram),
            # then refresh the pacing directive.
            artifact = await transport.current_artifact()
            await _score_last_answer(scorer, settings, state, text, timing, artifact)
            await _update_pacing(scorer, settings, state)
```

- [ ] **Step 8: Run the artifact tests + the session tests (no regression)**

Run: `pytest tests/interview_agent/test_artifact.py tests/interview_agent/test_session.py tests/interview_agent/test_llm_ops.py tests/interview_agent/test_transport.py -v`
Expected: PASS (existing session/llm_ops/transport tests still pass — the artifact param is optional/defaulted).

- [ ] **Step 9: Full suite + commit**

Run: `pytest -q`
Expected: PASS.

```bash
git add app/interview_agent/types.py app/interview_agent/transport.py app/interview_agent/prompts/grade.py app/interview_agent/llm_ops.py app/interview_agent/session.py tests/interview_agent/test_artifact.py
git commit -m "feat(interview-agent): candidate artifact channel (code/diagram) + artifact-aware grading (no exec)"
```

---

## Self-Review

**1. Spec coverage:**
- §3 assumed transport interface → Task 11 (`Transport`, `ScriptedTransport`, LiveKit stub). ✓
- §4 dual-track topology (score off critical path, one-turn lag) → Task 12 eval tail runs after speaking, before next decision. ✓
- §5 session state → Task 7. ✓
- §6 hybrid scoring (rubric competency + transcript/timing behavioral + penalties) → Task 5 (math) + Task 9 `grade_answer` + Task 12 `_score_last_answer`. ✓
- §3.1 candidate artifacts (code/diagram channel, artifact-aware grading, read-only/no-exec, Monaco+Excalidraw as frontend tools) → Task 15 (`Artifact`, `current_artifact()`, artifact in grade prompt). The Monaco/Excalidraw frontend components + diagram→text conversion are OUT (frontend sub-project) — noted. ✓
- §7 pacing (rails/bands, gate+judgment, wind-down/extend, ceiling) → Task 6 (`evaluate_gate`) + Task 12 `_update_pacing` + `_apply_action`. ✓
- §8 steering & topic pivots (classification, in/out scope, derive with wait/nudge, cap+hold-ground, penalties) → Task 4 (scope guard) + Task 9 (`classify_turn`, `derive_ladder`) + Task 10 (`decide`) + Task 12 (`_derive_flow`, `_apply_action`). ✓
- §9 SessionOutcome contract + provisional score → Task 12 `outcome.finalize`. ✓ (Backend session-state enum + transitions belong to sub-project A — explicitly out of this plan; noted.)
- §9 InterviewPlan `reserve` touchpoint + PREP_PLAN_VERSION bump → Task 2 (field) + Task 14 (generation + bump). ✓
- §10 error handling (grade failure swallowed, pacing defaults to CONTINUE, derive fallback, silence retries→abort) → Task 12. ✓
- §11 module structure → matches Tasks 3-12 files. ✓
- §12 testing (scripted personas, pure-module unit tests, stubbed LLM, no live voice) → every task. ✓
- §13 flags: langgraph added (Task 1), livekit deferred (Task 11 stub), prompts scaffolded (Task 8), reserve schema change (Task 2/14). ✓

**Gap intentionally left:** prosodic behavioral (§14 out of scope); backend Java `SessionStatus` additions + live-session persistence + LiveKit wiring (sub-projects A/D). Called out, not silently dropped.

**2. Placeholder scan:** No "TBD"/"implement later"/"add error handling" — every code step shows complete code. The one stray import in Task 9 is explicitly flagged and removed in Step 4. LiveKit stub raises `NotImplementedError` by design (documented), not a placeholder.

**3. Type consistency:** `SessionState` helpers (`followups_left`, `hints_left`, `has_next_question`, `reserve_available`, `active_ladder`, `advance_to_next_question`, `next_followup`, `next_hint`, `take_reserve`, `mark_asked`) are defined in Task 7 and used with the same names in Tasks 10/12. `Action`/`TurnClass`/`PacingDirective`/`PacingGate`/`EndedReason` values are consistent between Task 3 definitions and Task 10/12 usage. `llm_ops` signatures in Task 9 match calls in Tasks 10/12. `DecisionInputs`/`DecisionOutput` keys (Task 7) match `build_inputs`/`decide`/`run_decision` (Task 10) and driver usage (Task 12). `generate_plan_parts` arity change (Task 14) is reconciled in its test-stub note.
