"""Brief source gate: does this web page describe the interview process for the target role?"""
from __future__ import annotations

from app.llm.decisions import noul, state_bytes

MAX_SOURCE_STATE_BYTES = 28_000

SOURCE_QUESTIONS: dict = {
    "describes_process": noul(
        "`text` describes the interview process (rounds, questions asked, or format) for the role in `target`.",
        true="`text` describes the interview process (rounds, questions asked, or format) for the "
             "role in `target`.",
        false="`text` does not describe an interview process for that role: unrelated content, "
              "job listings only, or no mention of interview rounds or questions.",
    ),
    "is_first_hand": noul(
        "`text` is the author's own first-hand account of interviewing.",
        true="`text` is written by a candidate about their own interview experience.",
        false="`text` is a guide, an official page, a listing or an aggregated post, not one "
              "candidate's own account.",
    ),
}


def source_state(context: str, src: dict) -> dict:
    state = {"target": context, "title": src.get("title"), "url": src.get("url"),
             "date": src.get("date"), "text": src.get("content") or ""}
    if state_bytes(state) <= MAX_SOURCE_STATE_BYTES:
        return state
    text = state["text"]
    lo, hi = 0, len(text)
    while lo < hi:  # largest prefix whose state (with the ellipsis) still fits
        mid = (lo + hi + 1) // 2
        state["text"] = text[:mid] + "…"
        if state_bytes(state) <= MAX_SOURCE_STATE_BYTES:
            lo = mid
        else:
            hi = mid - 1
    state["text"] = text[:lo] + "…"
    return state
