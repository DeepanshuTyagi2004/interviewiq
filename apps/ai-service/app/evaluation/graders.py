"""LLM grading layer of the post-interview report (spec §7.1, §7.3, §8.2, §11.4).

The LLM grades; code validates (pydantic, turn-id citations, exact area keys) and merges. `grade_round` runs graders A and B on every
part that ran, calls the tiebreak grader C only where they disagree, and returns merged grades plus every disagreement for admin
diagnosis. No retries here beyond the one repair and one re-run of an invalid reply: an unreachable model raises
`GradingError("llm_unavailable")` and the pipeline's run-level retry handles it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.evaluation import prompts
from app.evaluation.inputs import DeliveryStats, PartInput
from app.evaluation.models import (AreaGrade, DisputeInput, EndQuestions, Events, FocusItem, GapTopic, HelpRequest, Moment, PartGrade, QuestionGrade, Quote,
                                   SessionMeta, Synthesis, TopicGap, TopicRef)
from app.evaluation.topics_util import clean_bank_tags
from app.evaluation.score import majority, merge_score, needs_tiebreak
from app.evaluation.weights import FAMILIES, areas_for
from app.interviewer.predicates import written_code
from app.interviewer.llm import LLMUnavailable, OpenRouterChat

logger = logging.getLogger(__name__)

PART_MAX_TOKENS = 12000        # the budget includes the model's reasoning
SYNTHESIS_MAX_TOKENS = 8000
RECHECK_MAX_TOKENS = 4000
_TURN_REF = re.compile(r"^turn:(\d+)$")
_CODE_FAMILIES = frozenset({"dsa", "online-assessment", "lld"})
_PROBLEM_FAMILIES = frozenset({"dsa", "online-assessment", "lld", "system-design"})     # their part is a problem: one question must be "main"
_SALVAGE_SUBJECTS = {"dsa": "DSA", "online-assessment": "DSA", "system-design": "System design", "lld": "LLD"}


class GradingError(Exception):
    def __init__(self, code: Literal["invalid_grades", "llm_unavailable"], detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


@dataclass
class GradeRoundResult:
    merged: dict[str, PartGrade]
    raw: dict[str, dict[str, PartGrade]]          # part_id -> "A" / "B" / "C" -> that grader's grade
    disagreements: list[dict] = field(default_factory=list)


class RecheckOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: Literal["upheld", "revised"]
    score: float = Field(ge=1, le=10)
    explanation: str


# Grading calls take the provider's default routing with structured outputs required: the talker's price cap (PROVIDER_ROUTING) would
# exclude the Claude and GPT models used here. Both families list structured_outputs on OpenRouter, so json_schema works.
EVAL_ROUTING: dict[str, Any] = {"require_parameters": True, "allow_fallbacks": True, "data_collection": "deny"}


def build_eval_chats(settings, http_client: httpx.AsyncClient | None = None) -> tuple[OpenRouterChat, OpenRouterChat, OpenRouterChat]:
    """Chats for graders A, B (its own model family when EVALUATION_MODEL_B is set) and the tiebreak C (its model may differ).
    No temperature is sent: the current grading models (Claude Haiku/Sonnet 5.5, GPT-6 Luna) reject it, and OpenRouter then finds no
    endpoint (checked live 2026-10-18). A and B differ by model family instead."""
    def chat(model: str) -> OpenRouterChat:
        return OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url, model=model,
                              reasoning=settings.interviewer_director_reasoning, timeout_s=settings.evaluation_timeout_s,
                              http_client=http_client, routing=EVAL_ROUTING, temperature=None)
    return (chat(settings.evaluation_model), chat(settings.evaluation_model_b or settings.evaluation_model),
            chat(settings.evaluation_tiebreak_model or settings.evaluation_model))


# ---------------------------------------------------------------- validation

def _quote_ids(q: Quote | None) -> list[int]:
    return [q.turn_id] if q is not None else []


def check_citations(grade: PartGrade, visible_ids: set[int], area_keys: Iterable[str] | None = None,
                    require_evidence: bool = True, has_code: bool = True, has_board: bool = True) -> list[str]:
    """Every cited turn id is in the transcript given to the grader; areas are exactly the family's keys, each with evidence."""
    errors: list[str] = []

    def known(turn_id: int, where: str) -> None:
        if turn_id not in visible_ids:
            errors.append(f"{where} cites turn {turn_id}, which is not in the transcript")

    for q in grade.questions:
        if not q.answer_quotes and q.verdict not in ("not_answered", "not_reached"):
            errors.append(f"question {q.id} has no answer quote (verdict {q.verdict})")
        for quote in q.answer_quotes:
            known(quote.turn_id, f"question {q.id} quote")
    for a in grade.areas:
        if require_evidence and not a.evidence:
            errors.append(f"area {a.key} has no evidence")
        for item in a.evidence:
            m = _TURN_REF.match(item.strip())
            if m:
                known(int(m.group(1)), f"area {a.key} evidence")
            elif item.strip() == "code" and not has_code:
                errors.append(f'area {a.key} cites "code" but this part has no code')
            elif item.strip() == "board" and not has_board:
                errors.append(f'area {a.key} cites "board" but this part has no board')
            elif item.strip() not in ("code", "board"):
                errors.append(f'area {a.key} evidence "{item}" must be "turn:<id>", "code" or "board"')
    ev = grade.events
    for name in ("self_found_bugs", "pointed_out_bugs", "unprompted_edge_cases"):
        for quote in getattr(ev, name):
            known(quote.turn_id, f"events.{name}")
    for tid in _quote_ids(ev.recovery):
        known(tid, "events.recovery")
    for h in ev.help_requests:
        known(h.turn_id, "events.help_requests")
    for m in grade.moments:
        known(m.turn_id, "a moment")
    if area_keys is not None:
        expected, got = list(area_keys), [a.key for a in grade.areas]
        if sorted(got) != sorted(expected):
            errors.append(f"areas must be exactly {expected}; got {got}")
    return errors


async def _call(chat, messages: list[dict], model_cls: type[BaseModel], schema_name: str, max_tokens: int,
                fix: dict[str, Any], check) -> tuple[BaseModel | None, list[str], dict]:
    try:
        schema = model_cls.model_json_schema()
        schema.get("properties", {}).pop("salvage_notes", None)        # set by code only, never asked of the model
        for name in ("TopicRef", "GapTopic"):                          # bank_tags is optional for stored docs but required of the model
            d = (schema.get("$defs") or {}).get(name)
            if d and "bank_tags" in d.get("properties", {}):
                d["properties"]["bank_tags"] = {"type": "array", "items": {"type": "string"}, "title": "Bank Tags"}
                d["required"] = [*d.get("required", []), "bank_tags"]
        data, _usage = await chat.json(messages, schema_name, schema, max_tokens)
    except LLMUnavailable as exc:
        raise GradingError("llm_unavailable", str(exc)) from exc
    data = {**(data if isinstance(data, dict) else {}), **fix}
    try:
        obj = model_cls.model_validate(data)
    except ValidationError as exc:
        return None, [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()][:12], data
    return obj, check(obj), data


async def _validated(chat, messages: list[dict], model_cls: type[BaseModel], schema_name: str, max_tokens: int,
                     fix: dict[str, Any], check, salvage=None) -> BaseModel:
    """One call; on invalid output one repair message listing the errors; still invalid, one full re-run; still invalid, `salvage`
    (when given) repairs the attempt with the fewest errors instead of failing: `salvage(obj, errors) -> obj | None`. With no hook the
    run fails `invalid_grades`; with a hook and no attempt that even parsed it fails `llm_unavailable` (transient: the model is
    returning nothing usable, so the pipeline retries)."""
    best: tuple[BaseModel, list[str]] | None = None

    def consider(obj, errors) -> None:
        nonlocal best
        if obj is not None and (best is None or len(errors) < len(best[1])):
            best = (obj, list(errors))

    obj, errors, data = await _call(chat, messages, model_cls, schema_name, max_tokens, fix, check)
    if obj is not None and not errors:
        return obj
    consider(obj, errors)
    repair = messages + [{"role": "assistant", "content": json.dumps(data, ensure_ascii=False, default=str)},
                         {"role": "user", "content": "Your reply was rejected for these errors:\n- " + "\n- ".join(errors)
                          + "\nReturn the whole corrected JSON object only."}]
    obj, errors, _ = await _call(chat, repair, model_cls, schema_name, max_tokens, fix, check)
    if obj is not None and not errors:
        return obj
    consider(obj, errors)
    obj, errors, _ = await _call(chat, messages, model_cls, schema_name, max_tokens, fix, check)
    if obj is not None and not errors:
        return obj
    consider(obj, errors)
    if salvage is not None:
        if best is None:
            raise GradingError("llm_unavailable", "the model returned nothing parseable in three attempts: " + "; ".join(errors))
        saved = salvage(best[0], best[1])
        if saved is not None:
            return saved
    raise GradingError("invalid_grades", "; ".join(errors))


# ---------------------------------------------------------------- grading

def _short(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _statement(reference: dict) -> str:
    content = reference.get("content") or {}
    if isinstance(content, dict):
        for k in ("statement", "problem_statement", "description", "prompt", "summary"):
            v = content.get(k)
            if isinstance(v, str) and v.strip():
                return _short(v, 240)
    return ""


def _clean(text: Any) -> str:
    """One tidy sentence fragment: single spaces, no ';' separators, no doubled or trailing full stops."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    t = re.sub(r"\s*;\s*", ", ", t)
    t = re.sub(r"\.{2,}(?=\s|$)", "", t).replace("..", ".")
    return t.strip(" ,;:").rstrip(".").strip()


def _sentence(text: Any) -> str:
    t = _clean(text)
    return (t[0].upper() + t[1:] + ".") if t else ""


def _first_sentences(text: Any, n: int) -> str:
    parts = [p for p in re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", str(text or "")).strip()) if p.strip(" .")]
    return " ".join(_sentence(p) for p in parts[:n])


def _complexity(a: dict) -> str:
    t, sp = _clean(a.get("time_complexity")), _clean(a.get("space_complexity"))
    return ", ".join(x for x in (f"{t} time" if t and t != "?" else "", f"{sp} space" if sp and sp != "?" else "") if x)


def _strong_from_key(reference: dict) -> str:
    """The reference answer as prose a candidate can read: best approach with its idea and complexity, a simpler accepted approach as a
    first step when the key has one, then at most two short key insights."""
    key = reference.get("answer_key")
    if not isinstance(key, dict):
        return ""
    out: list[str] = []
    approaches = [a for a in key.get("approaches") or [] if isinstance(a, dict)]
    if approaches:
        best = approaches[-1]       # keys list approaches from brute force to the best
        idea = _first_sentences(best.get("idea"), 2)
        name = _clean(best.get("name"))
        head = f"A strong answer: {name}" if name else "A strong answer"
        out.append(f"{head} — {idea}" if idea else head + ".")
        cx = _complexity(best) or (_clean(key.get("complexity_target")) if key.get("complexity_target") else "")
        if cx:
            out.append(f"Complexity: {cx}.")
        simpler = next((a for a in reversed(approaches[:-1]) if "brute" not in str(a.get("name", "")).lower()
                        and _complexity(a) != _complexity(best)), None)
        if simpler:
            sname, sidea, scx = _clean(simpler.get("name")), _clean(simpler.get("idea")), _complexity(simpler)
            step = f"A good first step at this level: {sname}" + (f" — {sidea}" if sidea else "") + (f" ({scx})" if scx else "") + "."
            out.append(step)
    elif isinstance(key.get("expected_design"), str) and key["expected_design"].strip():
        out.append(_first_sentences(_short(key["expected_design"], 400), 3))
        if key.get("complexity_target"):
            out.append(f"Target complexity: {_clean(key['complexity_target'])}.")
    elif key.get("complexity_target"):
        out.append(f"Target complexity: {_clean(key['complexity_target'])}.")
    insights = [_sentence(i) for i in (key.get("key_insights") or key.get("must_cover") or []) if _clean(i)]
    if insights:
        out.append(" ".join(insights[:2]))
    return " ".join(x for x in out if x)


def _band(score: float) -> str:
    return "correct" if score >= 9 else "mostly" if score >= 7 else "partly" if score >= 5 else "wrong"


def _quote_text(text: str) -> str:
    return text if len(text) <= 200 else text[:200] + "…"


def _reference_question(reference: dict) -> tuple[str, str]:
    """(question text, strong answer) the part's reference holds for a non-problem part, when present."""
    qs = [q for q in reference.get("round_questions") or [] if isinstance(q, dict)] or [q for q in reference.get("resume_probes") or [] if isinstance(q, dict)]
    q = qs[0] if qs else {}
    ask = next((str(q[k]) for k in ("prompt", "question", "text") if q.get(k)), "")
    strong = next((str(q[k]) for k in ("strong_answer", "expected_answer", "expected", "good_answer") if q.get(k)), "")
    return ask, strong


_META_REQUEST = re.compile(
    r"\b(repeat|say that again|come again|didn'?t (?:catch|hear|understand|get)|could you explain|can you explain|explain (?:the|this|that)|"
    r"clarif|constraints?|rephrase|another (?:problem|question)|different (?:problem|question)|change (?:the|this) (?:problem|question)|"
    r"skip|move on|next question|close (?:this|the)|end (?:this|the) (?:part|problem|round|interview)|hello|hi there|good (?:morning|afternoon|evening)|"
    r"thank you|thanks)\b", re.IGNORECASE)
MIN_ATTEMPT_WORDS = 6
MAX_ATTEMPT_QUOTES = 2


def _attempt_turns(turns: list[VisibleTurn]) -> list[VisibleTurn]:
    """Up to two candidate turns that carry the candidate's actual attempt: not a short turn (under 6 words: a greeting, "hmm", a filler)
    and not a short request about the question itself (constraints, clarification, repeat, another problem). The longest win, in time order."""
    keep = [t for t in turns if t.speaker == "candidate" and len(t.text.split()) >= MIN_ATTEMPT_WORDS
            and not (len(t.text.split()) < 30 and _META_REQUEST.search(t.text))]
    top = sorted(keep, key=lambda t: len(t.text), reverse=True)[:MAX_ATTEMPT_QUOTES]
    return sorted(top, key=lambda t: t.turn_id)


def _salvage_card(part: PartInput, grade: PartGrade, qid: str) -> QuestionGrade:
    """The question card built from the part itself when the graders returned none (owner rule: a result is always complete). The score is
    the mean of the part's area scores (code_correctness/approach first) and the verdict its band; with no area score the part counts as not answered."""
    by_key = {a.key: a for a in grade.areas}
    picked = [by_key[k].score for k in ("code_correctness", "approach") if k in by_key] or [a.score for a in grade.areas]
    if picked:
        score = round(sum(picked) / len(picked), 1)
        verdict = _band(score)
    else:
        score, verdict = 1.0, "not_answered"
    labels = {a.key: a.label for a in areas_for(part.family)} if part.family in FAMILIES else {}
    weakest = sorted(grade.areas, key=lambda a: a.score)[:2]
    no_code = not ((part.code or {}).get("text") or "").strip()
    if verdict == "not_answered" or (verdict == "wrong" and no_code and part.family in _PROBLEM_FAMILIES):
        gap = "You didn't reach a working approach" + (": no code was written." if no_code and part.family in _PROBLEM_FAMILIES else ".")
    else:
        gap = "The answer was incomplete or not shown to work."
    for lead, a in zip(("Weakest: ", "Also weak: "), weakest):
        label = labels.get(a.key) or a.key.replace("_", " ").capitalize()
        reason = _clean(a.reason)
        if reason:
            gap += f" {lead}{label} — {reason[0].lower() + reason[1:] if reason[1:2].islower() else reason}."
    gap = re.sub(r"\.{2,}", ".", gap)
    subject = _SALVAGE_SUBJECTS.get(part.family, part.family.replace("-", " ").capitalize())
    topics = [TopicRef(subject=subject, topic=t) for t in (part.topics or ([part.title] if qid == "main" else [])) if t]
    if qid == "main":
        statement = _statement(part.reference)
        asked = part.title + (f": {statement}" if statement else "")
        strong = _strong_from_key(part.reference) or "Walk through the problem, state a correct approach with its complexity, and show it works on the examples."
    else:
        ask, strong = _reference_question(part.reference)
        asked = part.title + (f": {ask}" if ask else "")
        if verdict == "not_answered":
            gap = "Nothing was answered."
    return QuestionGrade(id=qid, asked=asked, answer_quotes=[Quote(turn_id=t.turn_id, text=_quote_text(t.text)) for t in _attempt_turns(part.turns)],
                         verdict=verdict, score=min(10.0, max(1.0, score)), strong_answer=strong, gap=gap, topics=topics,
                         origin="candidate_led" if qid == "main" else "asked")


def salvage_part(grade: PartGrade, errors: list[str], visible: set[int], keys: Iterable[str], has_code: bool, has_board: bool,
                 needs_code: bool = False, part: PartInput | None = None) -> PartGrade:
    """Repair a part grade the model could not get right in three attempts, so the candidate still gets a result: drop every citation
    that is not in the transcript (quotes, moments, events, evidence), keep only the family's area keys (a missing area is simply
    absent; the score renormalises over the present weights), accept a shorter code trace. A question left with no quote keeps its
    verdict and score. The original errors are recorded on the grade (`salvage_notes`) for admin diagnosis."""
    keys = list(keys)
    wanted, seen = set(keys), set()
    notes = list(errors)[:12] or ["salvaged"]
    if part is not None:
        problem = part.family in _PROBLEM_FAMILIES
        if problem and not any(q.id == "main" for q in grade.questions):
            card = _salvage_card(part, grade, "main")
            grade = grade.model_copy(update={"questions": [card, *grade.questions]})
            notes.append(f"no main question graded: built from the part (verdict {card.verdict}, score {card.score})")
        elif not problem and not grade.questions:
            card = _salvage_card(part, grade, "q1")
            grade = grade.model_copy(update={"questions": [card]})
            notes.append(f"no question graded: built from the part (verdict {card.verdict}, score {card.score})")

    def quotes(items: list[Quote]) -> list[Quote]:
        return [q for q in items if q.turn_id in visible]

    def evidence(items: list[str]) -> list[str]:
        out = []
        for item in items:
            item = item.strip()
            m = _TURN_REF.match(item)
            if (m and int(m.group(1)) in visible) or (item == "code" and has_code) or (item == "board" and has_board):
                out.append(item)
        return out

    areas: list[AreaGrade] = []
    for a in grade.areas:
        if a.key in wanted and a.key not in seen:
            seen.add(a.key)
            areas.append(a.model_copy(update={"evidence": evidence(a.evidence)}))
    if not areas and keys:
        # nothing usable per area: every family area gets the mean of the part's question scores (never a silent 1.0)
        qs = [q.score for q in grade.questions]
        if not qs:
            raise GradingError("llm_unavailable", "salvage left neither areas nor question scores")
        mean = round(sum(qs) / len(qs), 1)
        areas = [AreaGrade(key=k, score=mean, evidence=[], reason="Estimated from the question scores of this part.") for k in keys]
        notes.append(f"no usable area: every area set to the mean question score {mean}")
    if needs_code and grade.code is None:
        notes.append("code grade missing; left empty")
    ev = grade.events
    recovery = ev.recovery if ev.recovery is not None and ev.recovery.turn_id in visible else None
    events = ev.model_copy(update={
        "self_found_bugs": quotes(ev.self_found_bugs), "pointed_out_bugs": quotes(ev.pointed_out_bugs),
        "unprompted_edge_cases": quotes(ev.unprompted_edge_cases), "recovery": recovery,
        "help_requests": [h for h in ev.help_requests if h.turn_id in visible]})
    return grade.model_copy(update={
        "questions": [q.model_copy(update={"answer_quotes": quotes(q.answer_quotes)}) for q in grade.questions],
        "areas": areas, "events": events, "moments": [m for m in grade.moments if m.turn_id in visible],
        "salvage_notes": notes})


def count_examples(reference: dict) -> int:
    """How many worked examples the part's reference holds (problem content examples)."""
    content = reference.get("content") or {}
    examples = content.get("examples") if isinstance(content, dict) else None
    return len(examples) if isinstance(examples, list) else 0


def _area_keys(part: PartInput, meta: SessionMeta) -> list[str]:
    return [a.key for a in areas_for(part.family, meta.company)] if part.family in FAMILIES else []


async def grade_part(chat, part: PartInput, meta: SessionMeta, variant: Literal["A", "B", "C"],
                     prior: list[PartGrade] | None = None, pastes: list[dict] | None = None,
                     profile: dict | None = None, vocab: list[str] | None = None) -> PartGrade:
    visible = {t.turn_id for t in part.turns}
    keys = _area_keys(part, meta)
    needs_code = part.family in _CODE_FAMILIES and bool(part.code and (part.code.get("text") or "").strip())
    require_evidence = bool(part.turns or part.code or part.board)

    need_trace = max(1, count_examples(part.reference))

    def check(grade: PartGrade) -> list[str]:
        errors = check_citations(grade, visible, keys, require_evidence, bool(part.code), bool(part.board))
        if not grade.questions:
            errors.append('questions is empty: grade at least one question; always grade a problem as the question "main" (verdict not_answered when nothing was written)')
        elif part.family in _PROBLEM_FAMILIES and not any(q.id == "main" for q in grade.questions):
            errors.append('no question has id "main": the problem itself is always graded as the question "main"')
        if needs_code:
            if grade.code is None:
                errors.append("code is required: hand-trace every example")
            elif len(grade.code.trace) < need_trace:
                errors.append(f"code.trace needs one entry per example ({need_trace}); got {len(grade.code.trace)}")
        return errors

    vocab = vocab if part.family in _PROBLEM_FAMILIES else None     # tags are for problems to practise, not for behavioural or fundamentals parts
    messages = prompts.part_messages(part, meta, variant, prior, pastes or [], profile, vocab)
    grade = await _validated(chat, messages, PartGrade, "part_grade", PART_MAX_TOKENS, {"part_id": part.part_id, "salvage_notes": []}, check,
                             salvage=lambda g, errs: salvage_part(g, errs, visible, keys, bool(part.code), bool(part.board), needs_code, part))  # type: ignore[arg-type]
    for q in grade.questions:                                                   # type: ignore[union-attr]
        for t in q.topics:
            t.bank_tags = clean_bank_tags(t.bank_tags, vocab)
    return grade  # type: ignore[return-value]


# Question-list mismatches between A and B: recorded as disagreements, never sent to the tiebreak (A's list is canonical).
ONLY_A = ":only_a"
ONLY_B = ":only_b"


def _structural(d: dict) -> bool:
    return str(d.get("field", "")).endswith((ONLY_A, ONLY_B))


def _score_disagrees(a: float, b: float) -> bool:
    return needs_tiebreak(a, b)


def _by_key(items, key) -> dict:
    return {key(i): i for i in items}


def find_disagreements(part_id: str, a: PartGrade, b: PartGrade) -> list[dict]:
    """Every score gap beyond the tolerance and every categorical disagreement between A and B."""
    out: list[dict] = []
    ba = _by_key(b.areas, lambda x: x.key)
    for x in a.areas:
        y = ba.get(x.key)
        if y and _score_disagrees(x.score, y.score):
            out.append({"part_id": part_id, "field": f"area:{x.key}", "a": x.score, "b": y.score})
    bq = _by_key(b.questions, lambda x: x.id)
    aq = {x.id for x in a.questions}
    for x in a.questions:
        y = bq.get(x.id)
        if not y:
            # A's question list is canonical: an unmatched A question keeps A's score, recorded here for diagnosis
            out.append({"part_id": part_id, "field": f"question:{x.id}{ONLY_A}", "a": x.score, "b": None})
            continue
        if _score_disagrees(x.score, y.score):
            out.append({"part_id": part_id, "field": f"question:{x.id}:score", "a": x.score, "b": y.score})
        if x.verdict != y.verdict:
            out.append({"part_id": part_id, "field": f"question:{x.id}:verdict", "a": x.verdict, "b": y.verdict})
        if x.resume_consistency != y.resume_consistency:
            out.append({"part_id": part_id, "field": f"question:{x.id}:resume_consistency", "a": x.resume_consistency,
                        "b": y.resume_consistency})
    for y in b.questions:
        if y.id not in aq:
            # a question only B graded never becomes a card: it is only recorded
            out.append({"part_id": part_id, "field": f"question:{y.id}{ONLY_B}", "a": None, "b": y.score})
    if a.must_have_met != b.must_have_met:
        out.append({"part_id": part_id, "field": "must_have_met", "a": a.must_have_met, "b": b.must_have_met})
    if a.code and b.code and a.code.logic_works != b.code.logic_works:
        out.append({"part_id": part_id, "field": "logic_works", "a": a.code.logic_works, "b": b.code.logic_works})
    bh = _by_key(b.events.help_requests, lambda h: h.turn_id)
    for h in a.events.help_requests:
        if h.turn_id in bh and bh[h.turn_id].kind != h.kind:
            out.append({"part_id": part_id, "field": f"help_request:{h.turn_id}", "a": h.kind, "b": bh[h.turn_id].kind})
    return out


def _cat(a, b, c, fallback):
    """A and B agree: that value; otherwise the majority of A, B, C; with no usable C, the fallback."""
    result = majority(a, b, c)
    return fallback if result is None else result


def _merge_quotes(a: list[Quote], b: list[Quote], c: list[Quote] | None) -> list[Quote]:
    """Items both A and B report (by turn), plus items only one reports that C confirms."""
    ids_b, ids_c = {q.turn_id for q in b}, {q.turn_id for q in c or []}
    out, seen = [], set()
    for q in a + b:
        if q.turn_id in seen:
            continue
        both = q.turn_id in ids_b and q.turn_id in {x.turn_id for x in a}
        if both or q.turn_id in ids_c:
            out.append(q)
            seen.add(q.turn_id)
    return out


def _merge_events(a: Events, b: Events, c: Events | None) -> Events:
    def flag(name: str) -> bool:
        return bool(_cat(getattr(a, name), getattr(b, name), getattr(c, name) if c else None, False))

    if a.recovery and b.recovery:
        recovery = a.recovery
    else:
        one = a.recovery or b.recovery
        recovery = one if (one and c and c.recovery) else None
    ha, hb, hc = (_by_key(x.help_requests, lambda h: h.turn_id) for x in (a, b, c or Events()))
    helps: list[HelpRequest] = []
    for tid in sorted(set(ha) | set(hb)):
        if tid in ha and tid in hb:
            kind = ha[tid].kind if ha[tid].kind == hb[tid].kind else (hc[tid].kind if tid in hc else "clarification")
        elif tid in hc:
            kind = hc[tid].kind
        else:
            continue
        helps.append(HelpRequest(turn_id=tid, kind=kind))
    return Events(
        self_found_bugs=_merge_quotes(a.self_found_bugs, b.self_found_bugs, c.self_found_bugs if c else None),
        pointed_out_bugs=_merge_quotes(a.pointed_out_bugs, b.pointed_out_bugs, c.pointed_out_bugs if c else None),
        unprompted_edge_cases=_merge_quotes(a.unprompted_edge_cases, b.unprompted_edge_cases, c.unprompted_edge_cases if c else None),
        unprompted_complexity=flag("unprompted_complexity"), unprompted_dry_run=flag("unprompted_dry_run"),
        recovery=recovery, beyond_level=flag("beyond_level"), bonus_solved=flag("bonus_solved"), help_requests=helps)


def _merge_topics(*lists: list[TopicRef]) -> list[TopicRef]:
    out, seen = [], set()
    for lst in lists:
        for t in lst:
            if (t.subject, t.topic) not in seen:
                seen.add((t.subject, t.topic))
                out.append(t)
    return out


def merge_grades(a: PartGrade, b: PartGrade, c: PartGrade | None) -> PartGrade:
    """The merged grade of one part (spec §7.3): the mean of A and B, or the median of A, B, C beyond the gap; categoricals by majority.
    A's question list is canonical: a question only A graded keeps A's grade; one only B graded is dropped (`find_disagreements`
    records both)."""
    ca = _by_key(c.areas, lambda x: x.key) if c else {}
    cq = _by_key(c.questions, lambda x: x.id) if c else {}
    bq, ba = _by_key(b.questions, lambda x: x.id), _by_key(b.areas, lambda x: x.key)

    def score(x: float, y: float, z: float | None) -> float:
        return merge_score(x, y, z) if (not needs_tiebreak(x, y) or z is not None) else (x + y) / 2

    areas: list[AreaGrade] = []
    for x in a.areas:
        y, z = ba.get(x.key), ca.get(x.key)
        if y is None:
            areas.append(x)
            continue
        areas.append(AreaGrade(key=x.key, score=score(x.score, y.score, z.score if z else None),
                               evidence=list(dict.fromkeys(x.evidence + y.evidence)), reason=x.reason))
    questions: list[QuestionGrade] = []
    for x in a.questions:
        y, z = bq.get(x.id), cq.get(x.id)
        if y is None:
            questions.append(x)
            continue
        questions.append(x.model_copy(update={
            "score": score(x.score, y.score, z.score if z else None),
            "verdict": _cat(x.verdict, y.verdict, z.verdict if z else None, x.verdict),
            "resume_consistency": _cat(x.resume_consistency, y.resume_consistency, z.resume_consistency if z else None, x.resume_consistency),
            "topics": _merge_topics(x.topics, y.topics),
            "answer_quotes": x.answer_quotes or y.answer_quotes}))
    code = a.code or b.code
    if a.code and b.code:
        lw = _cat(a.code.logic_works, b.code.logic_works, c.code.logic_works if c and c.code else None, a.code.logic_works)
        code = a.code.model_copy(update={"logic_works": lw, "syntax_slips": list(dict.fromkeys(a.code.syntax_slips + b.code.syntax_slips))})
    moments: list[Moment] = []
    for m in a.moments + b.moments:
        if (m.turn_id, m.kind) not in {(x.turn_id, x.kind) for x in moments}:
            moments.append(m)
    return PartGrade(part_id=a.part_id, questions=questions, areas=areas, code=code,
                     events=_merge_events(a.events, b.events, c.events if c else None), moments=moments,
                     must_have_met=bool(_cat(a.must_have_met, b.must_have_met, c.must_have_met if c else None, a.must_have_met)),
                     salvage_notes=[f"{v}: {n}" for v, g in (("A", a), ("B", None if b is a else b), ("C", c)) if g is not None
                                    for n in g.salvage_notes])


# Areas judged from the written code: with no code at all there is nothing to judge, so they are 0 (not the grader's floor of 1).
_CODE_AREAS = frozenset({"code_correctness", "code_quality", "testing", "complexity"})
_NO_CODE_FAMILIES = frozenset({"dsa", "online-assessment"})


def zero_no_code(part: PartInput, grade: PartGrade) -> PartGrade:
    """A coding part whose final code is empty scores 0 on every code-based area. A part with no `code` block at all is untouched."""
    if part.family not in _NO_CODE_FAMILIES or part.code is None or written_code(part.code.get("text") or ""):
        return grade
    areas = [a.model_copy(update={"score": 0.0}) if a.key in _CODE_AREAS else a for a in grade.areas]
    # No code means no bug to point out or to find: whatever the graders logged as one is a mislabelled remark (live round 6eeb5dae logged a question).
    events = grade.events.model_copy(update={"pointed_out_bugs": [], "self_found_bugs": []})
    return grade.model_copy(update={"areas": areas, "events": events})


async def grade_round(chat_a, chat_b, chat_c, parts: list[PartInput], meta: SessionMeta,
                      pastes: dict[str, list[dict]] | None = None, profile: dict | None = None,
                      vocab: list[str] | None = None) -> GradeRoundResult:
    """Grade every part that ran (A and B concurrently, C only on a disagreement). Parts that did not run, and the candidate-questions
    phase (which feeds no skill area; synthesis assesses it), are not graded."""
    pastes = pastes or {}
    todo = [p for p in parts if p.ran and p.family in FAMILIES]

    async def one(part: PartInput) -> tuple[str, dict[str, PartGrade], PartGrade, list[dict]]:
        ra, rb = await asyncio.gather(grade_part(chat_a, part, meta, "A", pastes=pastes.get(part.part_id), profile=profile, vocab=vocab),
                                      grade_part(chat_b, part, meta, "B", pastes=pastes.get(part.part_id), profile=profile, vocab=vocab),
                                      return_exceptions=True)
        for r in (ra, rb):
            if isinstance(r, BaseException) and not isinstance(r, GradingError):
                raise r
        if isinstance(ra, GradingError) and isinstance(rb, GradingError):
            raise ra
        failed: list[dict] = []
        # one grader giving nothing usable does not lose the part: the other's grade stands alone (recorded for diagnosis)
        if isinstance(ra, GradingError):
            failed.append({"part_id": part.part_id, "field": "grader:A_failed", "a": None, "b": None, "c": None, "merged": None})
            ga = gb = rb
        elif isinstance(rb, GradingError):
            failed.append({"part_id": part.part_id, "field": "grader:B_failed", "a": None, "b": None, "c": None, "merged": None})
            ga = gb = ra
        else:
            ga, gb = ra, rb
        raw = {"A": ga, "B": gb} if not failed else {("B" if isinstance(ra, GradingError) else "A"): ga}
        diffs = find_disagreements(part.part_id, ga, gb)
        gc = None
        if any(not _structural(d) for d in diffs):
            try:
                gc = await grade_part(chat_c, part, meta, "C", prior=[ga, gb], pastes=pastes.get(part.part_id), profile=profile, vocab=vocab)
            except GradingError as exc:
                # the tiebreak is the only thing lost: A and B merge without it (mean of scores, A for categoricals)
                failed.append({"part_id": part.part_id, "field": "tiebreak:failed", "a": None, "b": None, "c": None, "merged": None,
                               "error": f"{exc.code}: {exc.detail}"[:300]})
            else:
                raw["C"] = gc
                cvals = _tiebreak_values(gc)
                for d in diffs:
                    d["c"] = cvals.get(d["field"])
        merged = zero_no_code(part, merge_grades(ga, gb, gc))
        mvals = _tiebreak_values(merged)
        for d in diffs:
            if _structural(d):
                d["merged"] = d["a"]          # A's question kept as graded; a B-only question dropped (None)
                d.setdefault("c", None)
            else:
                d["merged"] = mvals.get(d["field"])
                d.setdefault("c", None)
        return part.part_id, raw, merged, diffs + failed

    results = await asyncio.gather(*(one(p) for p in todo))
    out = GradeRoundResult(merged={}, raw={})
    for pid, raw, merged, diffs in results:
        out.merged[pid], out.raw[pid] = merged, raw
        out.disagreements.extend(diffs)
    return out


def _tiebreak_values(g: PartGrade) -> dict[str, Any]:
    vals: dict[str, Any] = {f"area:{a.key}": a.score for a in g.areas}
    for q in g.questions:
        vals[f"question:{q.id}:score"], vals[f"question:{q.id}:verdict"] = q.score, q.verdict
        vals[f"question:{q.id}:resume_consistency"] = q.resume_consistency
    vals["must_have_met"] = g.must_have_met
    if g.code:
        vals["logic_works"] = g.code.logic_works
    for h in g.events.help_requests:
        vals[f"help_request:{h.turn_id}"] = h.kind
    return vals


# ---------------------------------------------------------------- synthesis and re-check

_TURNS_IN_TEXT = re.compile(r"\bturns?\s+((?:\d+)(?:\s*(?:,|and|&|-|–)\s*\d+)*)", re.IGNORECASE)


def _turns_in_text(text: str) -> list[int]:
    """Turn ids written in prose: "turn 12", "turns 31, 55 and 57"."""
    return [int(n) for m in _TURNS_IN_TEXT.finditer(text or "") for n in re.findall(r"\d+", m.group(1))]


async def synthesize(chat, parts: list[PartInput], merged: dict[str, PartGrade], stats: DeliveryStats, meta: SessionMeta,
                     vocab: list[str] | None = None) -> Synthesis:
    visible = {t.turn_id for p in parts if p.ran for t in p.turns}

    def check(s: Synthesis) -> list[str]:
        # The model often writes "(turns 63, 64)" in the text and leaves turn_ids empty: take the ids from the text, and drop ids that
        # are not in the transcript. Only an item with no real moment left is an error (a live round failed grading on this).
        errors = []
        for f in s.focus:
            ids = f.turn_ids or _turns_in_text(f"{f.title} {f.why}")
            f.turn_ids = [t for t in dict.fromkeys(ids) if t in visible]
            if not f.turn_ids:
                errors.append(f'focus item "{f.title[:80]}" cites no turn id from the transcript')
        for o in s.delivery:
            o.examples = [t for t in o.examples if t in visible]
        return errors

    def salvage(s: Synthesis, errors: list[str]) -> Synthesis:
        s.focus = [f for f in s.focus if f.turn_ids]          # an item with no real moment behind it is dropped, the rest stands
        return s

    synth = await _validated(chat, prompts.synthesis_messages(parts, merged, stats, meta, vocab), Synthesis, "round_synthesis",
                             SYNTHESIS_MAX_TOKENS, {}, check, salvage=salvage)
    for gap in synth.topic_gaps:                                                # type: ignore[attr-defined]
        for t in gap.topics:
            t.bank_tags = clean_bank_tags(t.bank_tags, vocab)
    eq = synth.end_questions  # type: ignore[attr-defined]
    eq.bonus = round(min(max(eq.bonus, 0.1), 0.2), 1) if eq.quality == "thoughtful" else 0.0
    return synth  # type: ignore[return-value]


_WEAK_VERDICTS = frozenset({"partly", "wrong", "not_answered"})
_SUBJECT_BY_FAMILY = {"dsa": "Data structures and algorithms", "online-assessment": "Data structures and algorithms",
                      "system-design": "System design", "lld": "Low-level design"}


def _area_means(parts: list[PartInput], merged: dict[str, PartGrade], meta: SessionMeta) -> list[tuple[str, str, float, str, list[int]]]:
    """(key, label, mean score over the parts that graded it, a reason, cited turns) per area across the round's grades."""
    acc: dict[str, dict] = {}
    for p in parts:
        g = merged.get(p.part_id)
        if g is None or p.family not in FAMILIES:
            continue
        labels = {a.key: a.label for a in areas_for(p.family, meta.company)}
        for a in g.areas:
            row = acc.setdefault(a.key, {"label": labels.get(a.key, a.key), "scores": [], "reason": "", "turns": []})
            row["scores"].append(a.score)
            row["reason"] = row["reason"] or a.reason
            row["turns"] += [int(m.group(1)) for e in a.evidence if (m := _TURN_REF.match(e.strip()))]
    return [(k, r["label"], sum(r["scores"]) / len(r["scores"]), r["reason"], list(dict.fromkeys(r["turns"]))) for k, r in acc.items()]


def fallback_synthesis(parts: list[PartInput], merged: dict[str, PartGrade], meta: SessionMeta, score: float | None = None,
                       verdict: str | None = None) -> Synthesis:
    """The synthesis built in code when the model could not produce one, so the report still lands (owner rule: a result is always
    available). Everything in it comes from the graded areas and questions; the delivery notes and the interviewer's note are empty."""
    visible = {t.turn_id for p in parts if p.ran for t in p.turns}
    areas = sorted(_area_means(parts, merged, meta), key=lambda r: r[2])
    questions = [(p, q) for p in parts if (g := merged.get(p.part_id)) is not None for q in g.questions]
    label = " ".join(w.capitalize() for w in str(verdict).replace("_", " ").split()) if verdict else ""
    head = f"You scored {score:.1f} out of 10{f' ({label})' if label else ''}; the pass mark for this round was {meta.pass_mark:g}." if score is not None else \
        f"The pass mark for this round was {meta.pass_mark:g}."
    bits = []
    if areas:
        bits.append("Weakest areas: " + ", ".join(f"{r[1]} ({r[2]:.1f})" for r in areas[:2]) + ".")
        top = list(reversed(areas))[:2]
        bits.append("Strongest areas: " + ", ".join(f"{r[1]} ({r[2]:.1f})" for r in top) + ".")
    cands: list[tuple[float, FocusItem]] = []
    for _p, q in questions:
        ids = [x.turn_id for x in q.answer_quotes if x.turn_id in visible]
        if ids:
            cands.append((q.score, FocusItem(title=f"Revisit: {q.asked.strip()[:90]}", why=q.gap or "This answer scored low.", turn_ids=ids)))
    for _k, label, mean, reason, turns in areas:
        ids = [t for t in turns if t in visible]
        if ids:
            cands.append((mean, FocusItem(title=f"Strengthen: {label}", why=reason or "This area scored low.", turn_ids=ids)))
    focus, titles = [], set()
    for _sc, item in sorted(cands, key=lambda c: c[0]):
        if item.title not in titles and len(focus) < 3:
            titles.add(item.title)
            focus.append(item)
    gaps: dict[str, list[GapTopic]] = {}
    for p, q in questions:
        if q.verdict in _WEAK_VERDICTS:
            subject = _SUBJECT_BY_FAMILY.get(p.family, p.family.replace("-", " ").capitalize())
            for t in q.topics:
                lst = gaps.setdefault(t.subject or subject, [])
                if all(x.topic != t.topic for x in lst):
                    lst.append(GapTopic(topic=t.topic, why=q.gap or "Needs more practice.", bank_tags=t.bank_tags))
    return Synthesis(summary=" ".join([head, *bits]), strengths=[f"{r[1]}: {r[3]}" if r[3] else r[1] for r in areas if r[2] >= 7.5],
                     focus=focus, topic_gaps=[TopicGap(subject=k, topics=v) for k, v in gaps.items()], delivery=[],
                     end_questions=EndQuestions(quality="none", bonus=0.0, note=""), interviewer_note="")


async def synthesize_or_fallback(chat, parts: list[PartInput], merged: dict[str, PartGrade], stats: DeliveryStats,
                                 meta: SessionMeta, vocab: list[str] | None = None) -> tuple[Synthesis, str | None]:
    """`synthesize`, or the code-built fallback when it cannot be produced (no parse, model unavailable, anything else but a cancel); the
    second item is None, or the error string that caused the fallback."""
    try:
        return await synthesize(chat, parts, merged, stats, meta, vocab), None
    except Exception as exc:  # noqa: BLE001 - the part grading succeeded; the report must still land
        logger.warning("[evaluation] synthesis fell back to the deterministic one: %s", exc)
        return fallback_synthesis(parts, merged, meta), f"{type(exc).__name__}: {exc}"[:400]


def _current_score(grades: list[PartGrade], dispute: DisputeInput) -> float:
    def pick(g: PartGrade) -> float | None:
        if dispute.target_type == "area":
            return next((a.score for a in g.areas if a.key == dispute.target_id), None)
        return next((q.score for q in g.questions if q.id == dispute.target_id), None)

    vals = [v for v in (pick(g) for g in grades) if v is not None]
    if not vals:
        raise GradingError("invalid_grades", f"no {dispute.target_type} {dispute.target_id} in the grades")
    if len(vals) >= 3:
        return round(sorted(vals[:3])[1], 1)
    return round(sum(vals) / len(vals), 1)


async def recheck(chat, part: PartInput, grades: list[PartGrade], dispute: DisputeInput,
                  meta: SessionMeta) -> tuple[Literal["upheld", "revised"], float, str]:
    """One re-check call. It may keep or raise the disputed score, never lower it (spec §11.4)."""
    current = _current_score(grades, dispute)
    out = await _validated(chat, prompts.dispute_messages(part, grades, dispute, meta), RecheckOut, "dispute_recheck",
                           RECHECK_MAX_TOKENS, {}, lambda o: [])
    if out.decision == "revised" and out.score > current:  # type: ignore[attr-defined]
        return "revised", round(out.score, 1), out.explanation  # type: ignore[attr-defined]
    return "upheld", current, out.explanation  # type: ignore[attr-defined]
