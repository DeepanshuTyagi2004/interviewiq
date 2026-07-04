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
