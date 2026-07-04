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
