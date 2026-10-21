"""The trace check: a run record (a rehearsal's JSON, or a real session's turns wrapped the same way) read for every problem the
2026-10-17 rehearsals taught us to fix. One check per problem, each a plain function of the record, so a regression in the talker, the
director or the prompts shows up as a named finding instead of a feeling that the interviewer sounds off.

A record is a dict with `turns` (the stored turns: speaker, seq, text, item_id, tool_calls, free_min, at), and optionally `items`
(the plan's parts at the end), `flow_log`, `briefs`, `shape_id`, `end_reason` and `probes` (the blueprint's resume probes, which
lets the same-probe re-ask be seen). A missing key only switches off the checks that need it. A finding is
`{"check", "seq", "detail", "severity"}`; severity is "fail" except for the checks that only suggest something ("note")."""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Any, Callable

from app.blueprint.vocabulary import is_culture_slot
from app.rounds.compose import compose_rules, rules_of
from app.interviewer.closing import (abandons_problem, asks_for_introduction, claims_problem_on_screen_now, announces_next_step, claims_screen_failed, closes_coding_part,
                                     opens_topic_while_coding, problem_line_part, says_duration, ends_with_goodbye, asks_format_check, gives_outline, is_farewell, leaks_tool_call, asks_for_questions,
                                     needs_no_reply, outline_areas, outline_mismatch as spoken_outline_mismatch, promises_to_return, says_planned_later, says_starting_to_code,
                                     refusal_points, starts_coding)
from app.interviewer.conductor import CHANGE_CAP, MAX_DEFERRED, MAX_THREADS, PROMISED_PREFIX, SKIP_NOTICE, ask_intent, asks_again, last_question, promise_covered, asked_question
from app.interviewer.guard import LeakGuard
from app.interviewer.lines import LINES, _norm, SAFETY_KEYS, SCREEN_WARNING_KEYS, contains, matches, matches_any, ordinal_of
from app.interviewer.run import LINE_CHECK_REPLY
from app.interviewer.plan import mentions, outline_turn_eligible, promise_questions, promise_words, promised, promises_of
from app.interviewer.predicates import UNREADABLE_BOARD, board_typed_text, echoes, plain, restates, written_code
from app.interviewer.talker import (repeats_a_refusal, opener_repeated, turn_opener, MOVE_TOOLS, ACKNOWLEDGES, announces_a_move, BARE_ACK, CANNOT_SEE_IT, LIMITS_SPOKEN, asks_after_close, claims_code, foreign_script, repeats_a_move, is_reasoning, narrates, repair_false_link, repair_stumble)

Finding = dict[str, Any]
SENTENCES = re.compile(r"(?<=[.?!])\s+")
INTERNAL_ID = re.compile(r"\bcore-\d|\breserve-|\bproblem-\d", re.IGNORECASE)
GAVE_UP_OR_MOVED = re.compile(r"give[ -]?up|gave up|asked[ _]for[ _]another|skip|swap|different problem|another problem|no more problems|out of time", re.IGNORECASE)
REASKS_ALLOWED = 2          # the first ask and one re-ask: the conductor orders the question dropped at the third ask
AFTER_INTRO = frozenset({"core", "deep_dive", "candidate_questions", "wrap_up"})
THREAD_MOVES = frozenset({"open_thread", "defer_topic"})


def _finding(check: str, seq: int, detail: str, severity: str = "fail") -> Finding:
    return {"check": check, "seq": seq, "detail": detail, "severity": severity}


def _title_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{5,}", (text or "").lower())}


def _spoken(record: dict[str, Any]) -> list[dict[str, Any]]:
    return [t for t in record.get("turns") or [] if t.get("speaker") == "interviewer"]


def _each_turn(record: dict[str, Any], check: str, bad: Callable[[str], str | None]) -> list[Finding]:
    """A finding for every interviewer turn whose text `bad` explains."""
    out = []
    for t in _spoken(record):
        if (why := bad(t.get("text") or "")) is not None:
            out.append(_finding(check, t["seq"], why))
    return out


def _typing(turn: dict[str, Any]) -> bool:
    return "typed line" in str((turn.get("activity") or {}).get("text") or "")


def silent_reply(record: dict[str, Any]) -> list[Finding]:
    """An interviewer turn with no words straight after the candidate said something that wanted an answer: four words or more, not a
    bare acknowledgement, and not while they were typing (a person nods then). The opening, with nobody speaking yet, may be silent."""
    out, heard, last_said = [], None, ""
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            heard = t.get("text") or ""
            continue
        text = t.get("text") or ""
        if heard is not None and not text.strip() and not t.get("interrupted") and len(heard.split()) >= 4 \
                and not needs_no_reply(heard, last_said) and not says_starting_to_code(heard) and not _typing(t):
            out.append(_finding("silent_reply", t["seq"], "no words after the candidate spoke"))
        heard, last_said = None, text or last_said
    return out


def narration_spoken(record: dict[str, Any]) -> list[Finding]:
    return _each_turn(record, "narration", lambda text: next((s for s in SENTENCES.split(text) if narrates(s)), None))


def internal_id_spoken(record: dict[str, Any]) -> list[Finding]:
    return _each_turn(record, "internal_id", lambda text: m.group(0) if (m := INTERNAL_ID.search(text)) else None)


def tool_call_spoken(record: dict[str, Any]) -> list[Finding]:
    return _each_turn(record, "tool_call_spoken", lambda text: text[:80] if leaks_tool_call(text) else None)


def format_confirmation(record: dict[str, Any]) -> list[Finding]:
    """Asking whether the round format is okay, other than once, as part of the turn that gives the outline (decided 2026-10-18). A second
    ask, or one in a turn with no outline on the framing, is found; a "does that sound right?" in the middle of a problem is a different question."""
    out, asked = [], False
    for t in _spoken(record):
        text = t.get("text") or ""
        if not asks_format_check(text):
            continue
        in_the_opening = t.get("item_id") in ("framing", "small_talk", "greeting", "candidate_intro")
        if not (asked or in_the_opening or gives_outline(text)):
            continue
        if asked or not gives_outline(text):
            out.append(_finding("format_confirmation", t["seq"], text[-80:]))
        asked = True
    return out


def third_reask(record: dict[str, Any]) -> list[Finding]:
    """A third re-ask on one part: the same ask again in other words (shared wording, "I still need...", the same plan ask), with
    the conductor's own rule for what counts. A tool move that worked starts the count again, as in the run."""
    out, streak, last_ask, last_intent, last_item = [], 0, "", "", ""
    probes = [str(p) for p in record.get("probes") or []]
    for t in _spoken(record):
        if t.get("interrupted") or t.get("error"):
            continue                                # a turn that was cut off or failed never reached the candidate whole
        if any((c.get("result") or {}).get("ok") for c in t.get("tool_calls") or []):
            streak, last_ask, last_intent, last_item = 0, "", "", ""
        ask = last_question(t.get("text") or "")
        if ask is None:
            continue
        intent = ask_intent(t["text"], probes)
        again = t.get("item_id") == last_item and asks_again(ask, t["text"], last_ask, intent, last_intent)
        streak = streak + 1 if again else 1
        last_ask, last_intent, last_item = ask, intent, t.get("item_id")
        if streak == REASKS_ALLOWED + 2:
            out.append(_finding("third_reask", t["seq"], f"asked {ask[:60]!r} for the {streak}th time on {last_item}"))
    return out


def problem_without_candidate(record: dict[str, Any]) -> list[Finding]:
    """A problem that ended with the candidate never having spoken on it, and not because they gave up or it was skipped or swapped."""
    out = []
    for item in record.get("items") or []:
        if item.get("kind") == "slot" and item.get("status") == "done" and not item.get("turns") \
                and not GAVE_UP_OR_MOVED.search(str(item.get("ended_by") or "")):
            seq = next((t["seq"] for t in record.get("turns") or [] if t.get("item_id") == item["item_id"]), 0)
            out.append(_finding("problem_without_candidate", seq, f"{item['item_id']} ended by {item.get('ended_by')!r} with no candidate turn"))
    return out


def outline_twice(record: dict[str, Any]) -> list[Finding]:
    """The round explained again. Not the answer to a candidate's question about the format (their turn before it asked something)."""
    out, prev_asked, seen = [], False, 0
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            prev_asked = "?" in (t.get("text") or "")
        elif t.get("speaker") == "interviewer" and gives_outline(t.get("text") or ""):
            seen += 1
            if seen > 1 and not prev_asked:
                out.append(_finding("outline_twice", t["seq"], "the round was explained again"))
    return out


def intro_after_done(record: dict[str, Any]) -> list[Finding]:
    """The introduction asked for again once the plan had moved on to a later part."""
    items = {i["item_id"]: i for i in record.get("items") or []}
    spoken = _spoken(record)
    intro_at = next((t["seq"] for t in spoken if t.get("item_id") == "candidate_intro"), None)
    if intro_at is None:
        return []
    out = []
    for t in spoken:
        phase = (items.get(t.get("item_id")) or {}).get("phase")
        if t["seq"] > intro_at and phase in AFTER_INTRO and asks_for_introduction(t.get("text") or "") and not gives_outline(t.get("text") or ""):
            out.append(_finding("intro_after_done", t["seq"], "asked for the introduction after the introduction part"))
    return out


def surplus_farewells(record: dict[str, Any]) -> list[dict[str, Any]]:
    """The interviewer's farewells that count as too many. It may say goodbye once on its own initiative and once more in reply to the
    candidate's goodbye (the turn straight after it); any other farewell is surplus. Both `double_goodbye` and `ended_cleanly` use this."""
    own = reply = False
    out: list[dict[str, Any]] = []
    answering = False                  # the previous turn was the candidate saying goodbye
    for t in record.get("turns") or []:
        text = t.get("text") or ""
        if t.get("speaker") == "candidate":
            answering = ends_with_goodbye(text)
            continue
        if t.get("speaker") != "interviewer":
            continue
        if is_farewell(text):
            if answering and not reply:
                reply = True
            elif not own:
                own = True
            else:
                out.append(t)
        answering = False
    return out


def double_goodbye(record: dict[str, Any]) -> list[Finding]:
    return [_finding("double_goodbye", t["seq"], "a second goodbye") for t in surplus_farewells(record)]


def double_ack(record: dict[str, Any]) -> list[Finding]:
    """A turn that acknowledges what the candidate said twice, or says one sentence again (exactly, or reworded with the same long
    words): the talker's `second_verdict` rule and the exact and reworded halves of `repeat_in_turn`, run over what was actually spoken.
    (Its older word-overlap half is left out: an outline followed by the introduction ask shares words on purpose.)"""
    out = []
    for t in _spoken(record):
        sentences = [s for s in SENTENCES.split(t.get("text") or "") if s]
        for n, sentence in enumerate(sentences):
            earlier = sentences[:n]
            if any(plain(sentence) == plain(e) for e in earlier) or (earlier and restates(sentence, earlier[-1])):
                out.append(_finding("double_ack", t["seq"], f"says again: {sentence[:60]!r}"))
            elif ACKNOWLEDGES(sentence) and any(ACKNOWLEDGES(e) for e in earlier):
                out.append(_finding("double_ack", t["seq"], f"a second acknowledgement: {sentence[:60]!r}"))
            elif BARE_ACK.match(sentence) and sentence not in (t.get("fixed") or []) \
                    and any(BARE_ACK.match(e) and e not in (t.get("fixed") or []) for e in earlier):
                out.append(_finding("double_ack", t["seq"], f"a second bare acknowledgement: {sentence[:60]!r}"))
    return out


def filler_after_start(record: dict[str, Any]) -> list[Finding]:
    """The neutral fallback line ("Could you say a bit more about that?") straight after the candidate said they were about to write
    the code (p22): a person lets them type."""
    out, started = [], False
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            started = starts_coding(t.get("text") or "") or announces_next_step(t.get("text") or "")
            continue
        sentences = [x for x in SENTENCES.split((t.get("text") or "").strip()) if x]
        if started and sentences and all(matches("neutral", x) for x in sentences):
            out.append(_finding("filler_after_start", t["seq"], f"said {sentences[0]!r} after they started coding"))
        started = False
    return out


def left_problem_in_words(record: dict[str, Any]) -> list[Finding]:
    """The coding part declared done in a turn whose item is a problem the plan then stays on (b2 quiet_thinker: the deep dive's lead-in
    was said on problem 2 and the problem was never discussed)."""
    items = {i["item_id"]: i for i in record.get("items") or []}
    spoken = _spoken(record)
    out = []
    for n, t in enumerate(spoken):
        if (items.get(t.get("item_id")) or {}).get("kind") != "slot" and not str(t.get("item_id") or "").startswith("core"):
            continue
        if not any(closes_coding_part(s) for s in SENTENCES.split(t.get("text") or "")):
            continue
        later = next((x for x in spoken[n + 1:] if (x.get("text") or "").strip()), None)
        if later is not None and later.get("item_id") == t.get("item_id"):
            out.append(_finding("left_problem_in_words", t["seq"], f"said the coding was done and stayed on {t.get('item_id')}"))
    return out


def _known(record: dict[str, Any]) -> set[str]:
    """Words the candidate gave (their name; the persona's profile words when the record has a blueprint): never a language switch."""
    text = str(record.get("first_name") or "") + " " + " ".join(str(t.get("text") or "") for t in record.get("turns") or [] if t.get("speaker") == "candidate")
    return set(re.findall(r"\w+", text.lower()))


def reasoning_aloud(record: dict[str, Any]) -> list[Finding]:
    """An interviewer turn that speaks the model's private reasoning (a trace of their areas, "I should prompt them...", name=value working)."""
    out = []
    for t in _spoken(record):
        chars = 0
        for x in SENTENCES.split(t.get("text") or ""):
            if is_reasoning(x, chars):
                out.append(_finding("reasoning_aloud", t["seq"], f"spoke its reasoning: {x[:80]!r}"))
                break
            chars += len(x)
    return out


def non_english(record: dict[str, Any]) -> list[Finding]:
    """An interviewer sentence in a script other than Latin (b2 strong_fresher switched to Chinese)."""
    return _each_turn(record, "non_english", lambda text: foreign_script(text, _known(record)))


def _problem_up_before(record: dict[str, Any], turn: dict[str, Any]) -> bool:
    for t in record.get("turns") or []:
        if t is turn:
            return False
        if t.get("speaker") == "interviewer" and _shows_problem(t):
            return True
    return False


def screen_failed(record: dict[str, Any]) -> list[Finding]:
    """A claim that the problem or screen failed to show while it was on screen, and the candidate had not said they could not see it
    (b1 rh_unplanned_resume_opener)."""
    out, heard = [], ""
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            heard = t.get("text") or ""
            continue
        if t.get("speaker") != "interviewer" or CANNOT_SEE_IT.search(heard):
            continue
        hit = next((s for s in SENTENCES.split(t.get("text") or "") if claims_screen_failed(s, heard)), None)
        if hit is not None and _problem_up_before(record, t):
            out.append(_finding("screen_failed", t["seq"], f"said the problem did not show while it was up: {hit[:80]!r}"))
    return out


def new_topic_while_coding(record: dict[str, Any]) -> list[Finding]:
    """Another topic or question opened right after the candidate said they were starting to code, or "while you write..." at any time
    (b1 drifter: "Take your time to write that out, while you do, let me ask something else")."""
    out, started = [], False
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            started = starts_coding(t.get("text") or "")
            continue
        hit = next((s for s in SENTENCES.split(t.get("text") or "") if opens_topic_while_coding(s, quiet=started)), None)
        if hit is not None:
            out.append(_finding("new_topic_while_coding", t["seq"], f"opened another topic while they code: {hit[:80]!r}"))
        started = False
    return out


def second_transition(record: dict[str, Any]) -> list[Finding]:
    """Two moves on in one turn ("Let's move to the next problem. Alright, let's get into the coding now.")."""
    out = []
    for t in _spoken(record):
        sentences = [x for x in SENTENCES.split(t.get("text") or "") if x]
        for n, x in enumerate(sentences):
            if repeats_a_move(x, sentences[:n]):
                out.append(_finding("second_transition", t["seq"], f"a second move on: {x[:80]!r}"))
                break
    return out


def _visible_text(record: dict[str, Any]) -> dict[str, str]:
    """Per problem, the text the candidate reads (statement, examples, constraints), for the questions that refer to the problem."""
    blueprint = record.get("blueprint")
    return LeakGuard(blueprint).visible if blueprint else {}


def question_after_close(record: dict[str, Any]) -> list[Finding]:
    """A question about the coding in the same turn that closes it ("That wraps up the coding part. Can you tighten the space a bit?")."""
    out, visible = [], _visible_text(record)
    for t in _spoken(record):
        sentences = [x for x in SENTENCES.split(t.get("text") or "") if x]
        said = " ".join(c.get("text") or "" for c in (record.get("turns") or []) if c.get("speaker") == "candidate" and c.get("item_id") == t.get("item_id")
                        and c.get("seq", 0) < t.get("seq", 0))
        for n, x in enumerate(sentences):
            if asks_after_close(x, sentences[:n], visible.get(t.get("item_id"), ""), said):
                out.append(_finding("question_after_close", t["seq"], f"asked about the closed part: {x[:80]!r}"))
                break
    return out


def after_problem_line(record: dict[str, Any]) -> list[Finding]:
    """Words after the run's problem line in the same turn ("Here's your second question. Give it a read... Th..."). The run's own
    sentences (put-up, intro, intro end) may follow one another."""
    out = []
    for t in _spoken(record):
        parts = [problem_line_part(x) for x in SENTENCES.split(t.get("text") or "") if x]
        first = next((n for n, p in enumerate(parts) if p is not None), None)
        if first is not None and any(p is None for p in parts[first:]):
            out.append(_finding("after_problem_line", t["seq"], "spoke after the problem line"))
    return out


def problem_line_twice(record: dict[str, Any]) -> list[Finding]:
    """The same problem's put-up or intro line ("Let me put the second problem on your screen", "Here's your second question") spoken in two
    different turns (b5 unplanned_story seq 23-24: the turn that moved on said it, then the open_item order had the next turn say it all again)."""
    seen: dict[tuple[str, str], int] = {}
    out = []
    for t in _spoken(record):
        for sentence in SENTENCES.split(t.get("text") or ""):
            part = problem_line_part(sentence)
            which = re.search(r"\bput the (\w+) problem\b|\byour (\w+) question\b", sentence, re.IGNORECASE)
            ordinal = (which.group(1) or which.group(2)).lower() if which is not None else ordinal_of(sentence)     # any wording of the pool names it
            # "Let me put a different problem on your screen" (a swap on request, 2026-10-18) names no position: it may be said once per swap.
            if part not in ("put_up", "intro") or ordinal is None:
                continue
            key = (part, ordinal)
            if key in seen and seen[key] != t["seq"]:
                out.append(_finding("problem_line_twice", t["seq"], f"said the {key[1]} problem's {part} line again (first in turn {seen[key]})"))
            seen.setdefault(key, t["seq"])
    return out


def requirement_invented(record: dict[str, Any]) -> list[Finding]:
    """"The problem asks for O of 1 extra space" when the problem's own text says no such thing (b0 strong_fresher). Needs the record's blueprint."""
    blueprint = record.get("blueprint")
    if not blueprint:
        return []
    guard = LeakGuard(blueprint)
    slots = {s.get("slot_id") for s in blueprint.get("slots") or []}
    out = []
    for t in _spoken(record):
        slot = t.get("item_id") if t.get("item_id") in slots else None
        for sentence in SENTENCES.split(t.get("text") or ""):
            v = guard.check_requirement(sentence, current_slot=slot)
            if not v.ok:
                out.append(_finding("requirement_invented", t["seq"], f"said the problem requires {v.match}: {sentence[:80]!r}"))
    return out


def _puts_up(turn: dict[str, Any]) -> bool:
    """The turn put a problem up: a show_problem call that worked and was not already on screen, or the run's own put-up line."""
    return bool(any(c.get("name") == "show_problem" and (c.get("result") or {}).get("ok") and not (c.get("result") or {}).get("already")
                    for c in turn.get("tool_calls") or [])
                or any(problem_line_part(x) == "put_up" for x in SENTENCES.split(turn.get("text") or "")))


def hint_from_other_problem(record: dict[str, Any]) -> list[Finding]:
    """A hint (a give_hint call, or a sentence that is one of a ladder's steps) from a problem the candidate has not been shown yet: the
    plan's current problem was never put up, so the screen and the hint disagree (b1 struggler_gives_up). The Nth problem to become current
    is on screen once N shown problems went up. Needs the record's blueprint and items."""
    blueprint, items = record.get("blueprint"), record.get("items")
    if not blueprint or not items:
        return []
    order = [i.get("slot_id") or i["item_id"] for i in items if i.get("kind") == "slot" and i.get("status") not in ("pending", "skipped")]
    ladders = {s["slot_id"]: [str(h.get("hint") or "") for h in s.get("hint_ladder") or []] for s in blueprint.get("slots") or []}
    words = lambda x: set(re.findall(r"[a-z]{3,}", x.lower()))  # noqa: E731
    out, shown = [], 0
    if not any(_puts_up(t) for t in _spoken(record)):
        return []                                   # nothing in the record shows a problem going up: it cannot tell what was on screen
    for t in _spoken(record):
        # A put-up is a show_problem call that worked, or the run's own put-up line (which leaves no tool call in the record): once per turn.
        shown += _puts_up(t)
        for sentence in SENTENCES.split(t.get("text") or ""):
            w = words(sentence)
            for sid, hints in ladders.items():
                if sid not in order or order.index(sid) + 1 <= shown:
                    continue
                if any(len(w & words(h)) >= 0.6 * max(len(words(h)), 1) and len(words(h)) >= 4 for h in hints):
                    out.append(_finding("hint_from_other_problem", t["seq"], f"hinted from {sid}, which was never put up: {sentence[:80]!r}"))
                    break
    return out


def time_spoken(record: dict[str, Any]) -> list[Finding]:
    """A length of time said aloud, of the round, a part or what is left of it (decided 2026-10-18; replaces round_length and schedule_again, which
    policed only some of the minutes)."""
    blueprint = record.get("blueprint")
    guard = LeakGuard(blueprint) if blueprint else None
    slots = {s.get("slot_id") for s in (blueprint or {}).get("slots") or []}
    out = []
    turns = record.get("turns") or []
    for n, t in enumerate(turns):
        if t.get("speaker") != "interviewer":
            continue
        # Only a length exactly matching one in the current problem's text (statement, follow-ups, probes, clarifications) is exempt; with no
        # blueprint nothing is.
        allowed = guard.duration_text(t.get("item_id") if t.get("item_id") in slots else None) if guard is not None else ""
        hit = next((s for s in SENTENCES.split(t.get("text") or "") if s and says_duration(s, allowed)), None)
        if hit is not None:
            out.append(_finding("time_spoken", t["seq"], hit[:80]))
    return out


@lru_cache(maxsize=1)
def _culture_banned() -> tuple[re.Pattern[str], ...]:
    return tuple(re.compile(p, re.IGNORECASE) for p in compose_rules("behavioural", None).get("banned_spoken") or [])


def _moved(turn: dict[str, Any]) -> bool:
    """The turn moved to another item (the trace records `item_id` at the turn's start, so its words may belong to the next one)."""
    return any(c.get("name") in (*MOVE_TOOLS, "show_problem") and (c.get("result") or {}).get("ok", True) is not False for c in turn.get("tool_calls") or [])


def round_words(record: dict[str, Any]) -> list[Finding]:
    """A word the round's pack forbids ("write the code" in a design round, a hint in an online assessment). The run's own fixed wordings are skipped
    (the turn's `fixed`; a record without it skips only the pack's own pool keys); a culture slot of a technical round is judged by the behavioural
    set; a turn that moved to another item is judged by what both the pack's set and the behavioural set ban (its words may belong to either item).
    No blueprint: no findings."""
    blueprint = record.get("blueprint")
    if not blueprint:
        return []
    try:
        rules = rules_of(blueprint)
        pack_set = tuple(re.compile(p, re.IGNORECASE) for p in rules.get("banned_spoken") or [])
        own_keys = tuple(k for k in LINES if k.endswith("@" + str(rules.get("pack"))) or ("@" not in k and rules.get("pack") in ("dsa", "online-assessment")))
    except Exception:
        return []
    culture_set, out = _culture_banned(), []
    for t in _spoken(record):
        moved = _moved(t)
        in_culture = is_culture_slot(str(t.get("item_id") or ""))
        fixed = {_norm(x) for w in t.get("fixed") or [] for x in SENTENCES.split(w) if x}
        for sentence in SENTENCES.split(t.get("text") or ""):
            if not sentence or (_norm(sentence) in fixed if "fixed" in t else matches_any(sentence, own_keys)):
                continue
            hits = lambda ban: next((r for r in ban if r.search(sentence)), None)  # noqa: E731
            if moved:
                rx = hits(culture_set) if hits(pack_set) else None
            else:
                rx = hits(culture_set if in_culture else pack_set)
            if rx is not None:
                out.append(_finding("round_words", t["seq"], f"said {rx.pattern!r} in {sentence[:80]!r}"))
    return out


STREAK = 3          # turns in a row that open with a verdict


def _opens_with_verdict(turn: dict[str, Any]) -> bool:
    first = next((x for x in SENTENCES.split((turn.get("text") or "").strip()) if x), "")
    return ACKNOWLEDGES(first)


def verdict_streak(record: dict[str, Any]) -> list[Finding]:
    """Three interviewer turns in a row that open with a verdict: a real interviewer mostly just moves on (a note, not a failure)."""
    out, run = [], 0
    for t in _spoken(record):
        if not (t.get("text") or "").strip():
            continue
        run = run + 1 if _opens_with_verdict(t) else 0
        if run == STREAK:
            out.append(_finding("verdict_streak", t["seq"], f"{STREAK} turns in a row opened with a verdict", severity="note"))
    return out


def style_metrics(record: dict[str, Any]) -> dict[str, Any]:
    """How the interviewer sounded, as numbers over one record: the share of its turns that open with a verdict, that open by echoing the
    candidate's last words, and that had a sentence blocked; the neutral filler lines spoken; and the minutes before the first problem."""
    spoken = 0
    verdicts = echoed = blocked = fillers = 0
    heard, start = "", float(record.get("clock_start") or 0)
    first_problem: float | None = None
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            heard = t.get("text") or ""
            continue
        if t.get("speaker") != "interviewer":
            continue
        sentences = [x for x in SENTENCES.split((t.get("text") or "").strip()) if x]
        if first_problem is None and any(c.get("name") == "show_problem" and (c.get("result") or {}).get("ok") for c in t.get("tool_calls") or []):
            first_problem = (float(t.get("at") or 0) - start) / 60
        if not sentences:
            continue
        spoken += 1
        verdicts += ACKNOWLEDGES(sentences[0])
        echoed += echoes(sentences[0], heard)
        blocked += bool(t.get("blocked"))
        fillers += sum(matches("neutral", x) for x in sentences)
    rate = lambda n: round(n / spoken, 3) if spoken else 0.0  # noqa: E731
    return {"verdict_rate": rate(verdicts), "echo_rate": rate(echoed), "blocked_rate": rate(blocked), "filler_lines": fillers,
            "minutes_before_first_problem": None if first_problem is None else round(first_problem, 1)}


CODE_CLOCK_SLACK_S = 30.0       # the persona's typing clock and the turns' stamps differ by up to about a turn


def code_claim(record: dict[str, Any]) -> list[Finding]:
    """A sentence that says they wrote code, or describes their code, before any code (a line that is not a comment) was typed for the
    problem it was said on. Only for persona records, which carry `code_log` ({at, code} in seconds from the clock start); the editor is
    shared by every problem, so code typed on an earlier problem does not count for a later one."""
    if "code_log" not in record:
        return []
    start = float(record.get("clock_start") or 0)
    typed = [float(c.get("at") or 0) for c in record.get("code_log") or [] if written_code(str(c.get("code") or ""))]
    slots = {i["item_id"] for i in record.get("items") or [] if i.get("kind") == "slot"}
    first_at: dict[str, float] = {}
    for t in record.get("turns") or []:
        first_at.setdefault(t.get("item_id"), float(t.get("at") or 0) - start)
    out = []
    for t in _spoken(record):
        now = float(t.get("at") or 0) - start
        since = first_at.get(t.get("item_id"), 0.0) - CODE_CLOCK_SLACK_S if t.get("item_id") in slots else 0.0
        if any(since <= at <= now for at in typed):
            continue
        hit = next((c for s in SENTENCES.split(t.get("text") or "") if s and (c := claims_code(s)) is not None), None)
        if hit is not None:
            out.append(_finding("code_claim", t["seq"], f"described code before any was written: {hit!r}"))
    return out


def _shows_problem(turn: dict[str, Any]) -> bool:
    return any(c.get("name") == "show_problem" and (c.get("result") or {}).get("ok") for c in turn.get("tool_calls") or [])


def _shown_before_they_speak(record: dict[str, Any], turn: dict[str, Any]) -> bool:
    """The next interviewer turn, with no candidate turn between, puts the problem up."""
    turns = record.get("turns") or []
    at = next((n for n, t in enumerate(turns) if t is turn), None)
    for t in turns[(at or 0) + 1:]:
        if t.get("speaker") == "candidate":
            return False
        if _shows_problem(t) or any(problem_line_part(x) in ("put_up", "intro") for x in SENTENCES.split(t.get("text") or "")):
            return True                             # the run puts a problem up with its own line, which carries no tool call in the record
    return False


def _own_problem_line(sentence: str) -> bool:
    """The sentence is one the run says itself when it puts a problem up (a wording of the put-up, swap or intro pool), not the interviewer's claim."""
    return matches_any(sentence, ("put_up", "intro", "swap_put_up"))


def screen_claim_unshown(record: dict[str, Any]) -> list[Finding]:
    """A present-tense claim that a problem is on their screen ("the problem on your screen", "give it a read", "let's get into the
    coding now") in a turn before any show_problem call succeeded in the record (p20 seq 9: the candidate had nothing on screen). The
    lines the run says itself when it puts a problem up are not the interviewer's claim. A record whose turns carry no tool_calls cannot
    tell, so the check is skipped."""
    spoken = _spoken(record)
    if not any("tool_calls" in t for t in spoken):
        return []
    out = []
    for t in spoken:
        if _shows_problem(t):
            break                                   # this turn put the problem up (or an earlier one did): from here the claims are true
        hit = next((s for s in SENTENCES.split(t.get("text") or "") if s and not _own_problem_line(s) and claims_problem_on_screen_now(s)), None)
        if hit is not None and _shown_before_they_speak(record, t):
            continue                                # "Let's get into the coding now." and the very next turn shows it: one move, not a claim
        if hit is not None:
            out.append(_finding("screen_claim_unshown", t["seq"], f"said a problem is on their screen before one was shown: {hit[:80]!r}"))
    return out


def question_then_problem(record: dict[str, Any]) -> list[Finding]:
    """A turn that asks the candidate something and also puts the problem up (p21 seq 9: a project question, then "let me put the first
    problem on your screen"): they cannot answer both and the question is left hanging. The run's own problem lines are not the asking."""
    out = []
    for t in _spoken(record):
        if not any(c.get("name") == "show_problem" and (c.get("result") or {}).get("ok") for c in t.get("tool_calls") or []):
            continue
        hit = next((s for s in SENTENCES.split(t.get("text") or "") if s.rstrip().endswith("?") and not _own_problem_line(s)), None)
        if hit is not None:
            out.append(_finding("question_then_problem", t["seq"], f"asked a question and put the problem up in one turn: {hit[:80]!r}"))
    return out


def planned_later(record: dict[str, Any]) -> list[Finding]:
    return _each_turn(record, "planned_later", lambda text: text[:80] if says_planned_later(text) else None)


def unrepaired_stumble(record: dict[str, Any]) -> list[Finding]:
    return _each_turn(record, "unrepaired_stumble", lambda text: text[:80] if repair_stumble(text) != text else None)


def false_continuity(record: dict[str, Any]) -> list[Finding]:
    """A sentence that links to a topic as if it were under discussion ("let me stay on SQL for one more") when the last two turns of each
    side do not mention it (or, for "coming back to X", when nothing in the round does): the talker rewrites these before they are spoken."""
    out: list[Finding] = []
    before: list[tuple[str, str]] = []                      # (speaker, text) of every turn so far
    for t in record.get("turns") or []:
        text = t.get("text") or ""
        if t.get("speaker") == "interviewer":
            recent = [x for who in ("candidate", "interviewer") for x in [text_ for s_, text_ in before if s_ == who][-2:]]
            ever = " ".join(x for _, x in before)
            for sentence in SENTENCES.split(text):
                if repair_false_link(sentence, " ".join(recent), ever) != sentence:
                    out.append(_finding("false_continuity", t["seq"], sentence[:80]))
                    break
                recent.append(sentence)                     # what this turn has said already counts as recent
                ever += " " + sentence
        if t.get("speaker") == "interviewer" and not text.strip():
            continue    # an empty cut turn is not in the live window (run.on_conversation_item drops it), so it must not push a real turn out; a cut turn with words is kept, as live (live round 781a1f0a)
        before.append((t.get("speaker") or "", text))
    return out


ASKS_ABOUT_HIGHLIGHT = re.compile(r"\b(?:highlighted|selected|highlight)\b|\bthis (?:part|bit|line|sentence)\b", re.IGNORECASE)
SELECTED_TEXT = re.compile(r"selected(?: text)? \u201c([^\u201d]+)\u201d")


def highlight_ignored(record: dict[str, Any]) -> list[Finding]:
    """The candidate asked about text they highlighted and the next interviewer turn shares no distinctive word with it. The selection is the
    one in that turn's activity ("selected \u201c...\u201d"). A live round answered three questions about a highlighted sentence with
    "So where would you begin your search?"."""
    out, asked = [], False
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            asked = bool(ASKS_ABOUT_HIGHLIGHT.search(t.get("text") or ""))
            continue
        if not asked or t.get("interrupted") or t.get("error"):
            asked = False
            continue
        asked = False
        found = SELECTED_TEXT.findall(str((t.get("activity") or {}).get("text") or ""))
        words = _title_words(found[-1]) if found else set()
        if words and not words & _title_words(t.get("text") or ""):
            out.append(_finding("highlight_ignored", t["seq"], f"asked about {found[-1][:50]!r}; the reply uses none of its words"))
    return out


TYPED_ON_BOARD = re.compile(r"board: [^\n]*\b(?:added|changed) text\b")


def board_unreadable(record: dict[str, Any]) -> list[Finding]:
    """The board ended with typed text (the record's `board_summary`) and an interviewer turn from the moment text was typed on it said the
    words were unreadable. A live round said so three times about "test can you see"."""
    if not board_typed_text(record.get("board_summary") or ""):
        return []
    typed_from = next((t["seq"] for t in record.get("turns") or [] if TYPED_ON_BOARD.search(str((t.get("activity") or {}).get("text") or ""))), None)
    if typed_from is None:
        return []
    return [_finding("board_unreadable", t["seq"], m.group(0)) for t in _spoken(record)
            if t["seq"] >= typed_from and (m := UNREADABLE_BOARD.search(t.get("text") or ""))]


CONDUCT_WARNING_TEXT = re.compile(r"\b(?:isn'?t|is not|not) (?:acceptable|appropriate)\b|keep it (?:professional|civil)", re.IGNORECASE)
CONDUCT_END_TEXT = re.compile(r"\b(?:end|ending|close|closes|closing) the interview\b|\bstop here\b", re.IGNORECASE)


def conduct_warn_then_end(record: dict[str, Any]) -> list[Finding]:
    """A conduct warning turn, then the round ending with no new candidate remark in between: a warning and an end on one remark
    (a live round, 7 s apart). Directed abuse ends in one turn with no warning; milder conduct warns and ends only at a second remark."""
    out, warned = [], None           # no end_reason gate: the live round stored "completed" for it, the words are what show the ending
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            warned = None                           # a new remark: a warning before it is a different incident
            continue
        text = t.get("text") or ""
        if CONDUCT_END_TEXT.search(text):
            if warned is not None:
                out.append(_finding("conduct_warn_then_end", t["seq"], f"warned at seq {warned}, then ended with no new remark in between"))
            warned = None
        elif CONDUCT_WARNING_TEXT.search(text) or any(c.get("name") == "flag_conduct" and (c.get("result") or {}).get("ok")
                                                       and (c.get("arguments") or {}).get("kind") != "off_topic_redirect" for c in t.get("tool_calls") or []):
            warned = t["seq"]
    return out


REFUSED_FOR_PHASE = re.compile(r"not while|already open|time is up|at most|less than a minute|not allowed|not a part", re.IGNORECASE)


def promise_unkept(record: dict[str, Any]) -> list[Finding]:
    """A note, not a failure: a turn promised to come back to something and the topic seems kept nowhere. Kept means the turn opened a
    thread, an ok open_thread/defer_topic is in the flow log from that moment (the log is capped, so the plan's promised parts and the
    deep dive's follow-ups count too, matched by their title's words against the promise and what they had just said), or the move was
    refused for the phase (a problem up, time, the caps). A free minute and room under the caps are needed for it to have been allowed."""
    log = record.get("flow_log") or []
    opened = sum(1 for m in log if m.get("ok") and m.get("move") == "open_thread")
    deferred = sum(1 for m in log if m.get("ok") and m.get("move") == "defer_topic")
    titles = [(i.get("title") or "") for i in record.get("items") or [] if i.get("origin") == "promise" or i.get("kind") == "thread"]
    titles += [str(f)[len(PROMISED_PREFIX):] for notes in (record.get("follow_ups") or {}).values() for f in notes if str(f).startswith(PROMISED_PREFIX)]
    out, previous = [], ""
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            previous = t.get("text") or ""
            continue
        if t.get("speaker") != "interviewer" or not promises_to_return(t.get("text") or "") or (t.get("free_min") or 0) < 1:
            continue
        context = _title_words((t.get("text") or "") + " " + previous)
        later = [m for m in log if m.get("move") in THREAD_MOVES and float(m.get("at") or 0) >= float(t.get("at") or 0)]
        acted = any(not _title_words(title) or _title_words(title) & context for title in titles) \
            or any(c.get("name") == "open_thread" and (c.get("result") or {}).get("ok") for c in t.get("tool_calls") or []) \
            or any(m.get("ok") for m in later) or any(REFUSED_FOR_PHASE.search(str(m.get("error") or "")) for m in later if not m.get("ok"))
        if not acted and opened < MAX_THREADS and deferred < MAX_DEFERRED:
            out.append(_finding("promise_unkept", t["seq"], "promised to come back and no thread was kept", severity="note"))
    return out


def limits_after_reveal(record: dict[str, Any]) -> list[Finding]:
    """A number or magnitude spoken on a problem whose constraints are on the candidate's screen, in the turn that revealed them or any
    later one (live round bae894ce seq 26: "up to thirty thousand days", eight turns after "Let me pull those up for you.")."""
    out, revealed = [], set()
    for t in _spoken(record):
        if any(c.get("name") == "reveal" and (c.get("arguments") or {}).get("kind") == "constraints" and (c.get("result") or {}).get("ok")
               for c in t.get("tool_calls") or []):
            revealed.add(t.get("item_id"))
        if t.get("item_id") not in revealed:
            continue
        hit = next((m.group(0) for x in SENTENCES.split(t.get("text") or "") if (m := LIMITS_SPOKEN.search(x))), None)
        if hit is not None:
            out.append(_finding("limits_after_reveal", t["seq"], f"said {hit!r} aloud after the constraints were on their screen"))
    return out


QUESTIONS_IN_A_ROW = 3      # interviewer turns that each ask something with the candidate saying nothing between them


def question_pileup(record: dict[str, Any]) -> list[Finding]:
    """Three interviewer turns in a row, each asking a question, with no candidate turn between: it talks over someone who is working
    (live round bae894ce seq 24-26: the approach asked three times in 80 s while the whiteboard kept changing)."""
    out, streak = [], 0
    for t in record.get("turns") or []:
        if t.get("speaker") != "interviewer":
            streak = 0
            continue
        asks = any(x.rstrip().endswith("?") for x in SENTENCES.split(t.get("text") or "") if x)
        streak = streak + 1 if asks else 0
        if streak == QUESTIONS_IN_A_ROW:
            out.append(_finding("question_pileup", t["seq"], f"{streak} interviewer turns in a row asked a question with no answer between"))
    return out


def reply_restated(record: dict[str, Any]) -> list[Finding]:
    """An interviewer turn that starts with the whole text of the interviewer turn before it: one reply stored as two (live round
    bae894ce seq 11-12, where a second reply began beside the first and the candidate heard the outline twice)."""
    out, before = [], None
    for t in record.get("turns") or []:
        if t.get("speaker") != "interviewer":
            before = None
            continue
        now = plain(t.get("text") or "")
        if before is not None and len(before) >= 20 and now.startswith(before):
            out.append(_finding("reply_restated", t["seq"], "starts with the whole text of the interviewer turn before it"))
        before = now
    return out


def ack_after_question(record: dict[str, Any]) -> list[Finding]:
    """A bare acknowledgement ("Okay.") after the turn's question (live round bae894ce seq 20: "...What were you working through there? Okay.")."""
    out = []
    for t in _spoken(record):
        sentences = [x for x in SENTENCES.split(t.get("text") or "") if x]
        asked = next((n for n, x in enumerate(sentences) if x.rstrip().endswith("?")), None)
        hit = next((x for x in sentences[asked + 1:] if BARE_ACK.match(x)), None) if asked is not None else None
        if hit is not None:
            out.append(_finding("ack_after_question", t["seq"], f"a bare {hit!r} after the question"))
    return out


CHANGE_GIVEN_LINE = re.compile(r"Sure, no problem\.|since you'd like a change, let's leave this one there", re.IGNORECASE)


def _change_line(line: str) -> bool:
    """The run's fixed line for a change of problem, in any wording: the give-up acknowledgement or the swap's line."""
    return bool(CHANGE_GIVEN_LINE.search(line) or contains("give_up", line) or contains("swap_put_up", line))


def changes_given(record: dict[str, Any]) -> list[dict[str, Any]]:
    """The interviewer turns that gave the candidate a different problem on request: the run's fixed "Sure, no problem. Let me put ..." line (or the
    older give-up line) together with a show_problem that put it up."""
    out = []
    for t in _spoken(record):
        shown = any(c.get("name") == "show_problem" and (c.get("result") or {}).get("ok") and not (c.get("result") or {}).get("already")
                    for c in t.get("tool_calls") or [])
        said = any(o.get("kind") in ("open_item", "move_on") and _change_line(str(o.get("line") or "")) for o in t.get("orders") or [])
        if shown and said:
            out.append(t)
    return out


def change_events(record: dict[str, Any]) -> list[dict[str, Any]]:
    """The round's request handling in turn order: a `refusal` (a keep_problem order), a `change` (a different problem put up on request) or an
    `end_coding` (the coding-over line), each with what had happened before it: `refused_round`, `refused_problem` (since the problem on screen went
    up) and `changes` (changes given before this one)."""
    out: list[dict[str, Any]] = []
    changes = {t["seq"] for t in changes_given(record)}
    refused_round = refused_problem = given = 0
    for t in _spoken(record):
        orders = t.get("orders") or []
        before = {"seq": t["seq"], "refused_round": refused_round, "refused_problem": refused_problem, "changes": given}
        if any(o.get("kind") == "keep_problem" for o in orders):
            out.append({"kind": "refusal", **before})
            refused_round += 1
            refused_problem += 1
        if any(o.get("kind") == "move_on" and contains("coding_over", str(o.get("line") or "")) for o in orders):
            out.append({"kind": "end_coding", **before})
        if t["seq"] in changes:
            out.append({"kind": "change", **before})
            given += 1
        if any(c.get("name") == "show_problem" and (c.get("result") or {}).get("ok") and not (c.get("result") or {}).get("already")
               for c in t.get("tool_calls") or []):
            refused_problem = 0                       # another problem is up: its refusals start from nothing
    return out


def changes_over_cap(record: dict[str, Any]) -> list[Finding]:
    """A problem change given beyond the round's cap (CHANGE_CAP, decided 2026-10-18); after the one change a further ask is resisted or ends the coding."""
    return [_finding("changes_over_cap", e["seq"], f"problem change number {e['changes'] + 1} given in one round (the cap is {CHANGE_CAP})")
            for e in change_events(record) if e["kind"] == "change" and e["changes"] >= CHANGE_CAP]


def change_without_refusal(record: dict[str, Any]) -> list[Finding]:
    """The round's first change given with no refusal before it: the interviewer resists at least once, whatever it decides afterwards."""
    return [_finding("change_without_refusal", e["seq"], "a different problem was given with no refusal earlier in the round")
            for e in change_events(record) if e["kind"] == "change" and e["refused_round"] == 0]


def _shows_a_problem(t: dict[str, Any]) -> bool:
    return any(c.get("name") == "show_problem" and (c.get("result") or {}).get("ok") and not (c.get("result") or {}).get("already")
               for c in t.get("tool_calls") or [])


def _harder_replacements(record: dict[str, Any]) -> list[str]:
    """The harder reserves a candidate's change put in place of a problem: a swapped-out problem whose replacement (the next problem of the plan) is a
    reserve named "harder", or a `swap_on_request` plan change that targets one. The harder reserve is the director's extension for a candidate who is
    flying, never what someone who asked for another problem is handed."""
    slots = [i for i in record.get("items") or [] if i.get("kind") == "slot"]
    # Only a swap the candidate's request made (ended_by "asked_for_another"): the director's own `use_reserve` may hand a harder reserve to a candidate who
    # is flying (decided 2026-10-18).
    found = [nxt["item_id"] for item, nxt in zip(slots, slots[1:])
             if item.get("status") == "swapped" and item.get("ended_by") == "asked_for_another" and "harder" in str(nxt.get("item_id"))]
    found += [str(p.get("target")) for p in record.get("plan_changes") or [] if p.get("op") == "swap_on_request" and "harder" in str(p.get("target"))]
    return list(dict.fromkeys(found))


def change_flow_valid(record: dict[str, Any]) -> list[Finding]:
    """The change flow broke one of its hard limits (decided 2026-10-18): a change beyond the cap, a change with no refusal before it in the round, the
    coding ended with no refusal on that problem, the harder reserve given as a replacement, or a problem put up after the coding ended."""
    out = []
    events = change_events(record)
    for e in events:
        if e["kind"] == "change" and e["changes"] >= CHANGE_CAP:
            out.append(_finding("change_flow_valid", e["seq"], f"change number {e['changes'] + 1} in one round (the cap is {CHANGE_CAP})"))
        elif e["kind"] == "change" and e["refused_round"] == 0:
            out.append(_finding("change_flow_valid", e["seq"], "a change with no refusal earlier in the round"))
        elif e["kind"] == "end_coding" and e["refused_problem"] == 0:
            out.append(_finding("change_flow_valid", e["seq"], "the coding ended with no refusal on that problem"))
    if harder := _harder_replacements(record):
        at = next((e["seq"] for e in reversed(events) if e["kind"] == "change"), 0)
        out.append(_finding("change_flow_valid", at, f"the harder reserve {harder[0]} was given as a replacement"))
    ended = next((e["seq"] for e in events if e["kind"] == "end_coding"), None)
    if ended is not None:
        out += [_finding("change_flow_valid", t["seq"], "a problem was put up after the coding ended") for t in _spoken(record)
                if t["seq"] >= ended and _shows_a_problem(t)]
    return out


def repeated_refusal(record: dict[str, Any]) -> list[Finding]:
    """A refusal that makes a point an earlier refusal of the round already made ("a partial solution is fine" twice): the interviewer says something
    new each time (decided 2026-10-18)."""
    out, made, said = [], set(), []
    for t in _spoken(record):
        if t.get("interrupted") or not any(o.get("kind") == "keep_problem" for o in t.get("orders") or []):
            continue
        points = refusal_points(t.get("text") or "")
        if again := points & made:
            out.append(_finding("repeated_refusal", t["seq"], f"a refusal makes a point again: {', '.join(sorted(again))}"))
        else:
            # The same thing in other words (live round 781a1f0a, turns 27 and 29): a sentence close to an earlier refusal's by its content words.
            sentences = re.split(r"(?<=[.!?])\s+", t.get("text") or "")
            if close := next((c for x in sentences if (c := repeats_a_refusal(x, said))), ""):
                out.append(_finding("repeated_refusal", t["seq"], f"a refusal says an earlier one again in other words: {close[:60]}"))
        made |= points
        said += [x for x in re.split(r"(?<=[.!?])\s+", t.get("text") or "")]
    return out


# One sentence of a warning (a mention, the final warning, the return warning, a conduct warning, or an ending for them), and the sentence that
# is part of an ending without being one itself.
WARNING_SENTENCE = re.compile(
    r"\bfinal warning\b|\bstay (?:on this screen|in this window|in full screen)\b|\buse only this screen\b|\bkeep sharing your entire screen\b"
    r"|\byou (?:switched to another tab|moved to another window|left full screen)\b|\bsecond display is connected\b|\bscreen share stopped\b"
    r"|\bshare your entire screen again\b|\bstill away from the screen\b|\bhave to end the interview\b|\bend the interview here, because\b"
    r"|\bthat isn'?t appropriate in an interview\b|\bcome back to (?:it|this screen) now\b", re.IGNORECASE)
WARNING_TAIL = re.compile(r"^thank you for your time\.?$", re.IGNORECASE)
_WARNING_KEYS = (*SCREEN_WARNING_KEYS, "proctor_end", "conduct_warning")      # every wording of the warnings and the proctor ending (lines.py)


def _warning_sentence(sentence: str) -> bool:
    # (the ending's "Thank you for your time." is a sentence of its wordings too, but it is only a warning with another warning sentence: WARNING_TAIL)
    return bool(WARNING_SENTENCE.search(sentence)) or (WARNING_TAIL.search(sentence) is None and matches_any(sentence, _WARNING_KEYS))


def warning_glued(record: dict[str, Any]) -> list[Finding]:
    """A warning said together with anything else (decided 2026-10-18): on the interviewer's own turn a warning is the whole turn, and in answer to
    the candidate it comes first with the reply after it, never the other way round and never twice (a live round's final warning carried "Alright,
    this one stays now, so let's work with it. Where would you begin?")."""
    out = []
    for t in _spoken(record):
        sentences = [x for x in SENTENCES.split((t.get("text") or "").strip()) if x]
        warns = [_warning_sentence(x) or (WARNING_TAIL.search(x) is not None and any(_warning_sentence(y) for y in sentences))
                 for x in sentences]
        if not any(warns) or all(warns):
            continue
        first_other = warns.index(False)
        in_reply = not _is_proactive(record, t) and not any(warns[first_other:])    # warning first, then the answer to them
        if not in_reply:
            other = next(x for x, w in zip(sentences, warns) if not w)
            out.append(_finding("warning_glued", t["seq"], f"a warning and {other[:60]!r} in one turn"))
    return out


def move_announced_not_made(record: dict[str, Any]) -> list[Finding]:
    """The interviewer told the candidate the interview was moving (leaving the problem or the coding, another problem or part) and the plan did
    not move (decided 2026-10-18; a live round said "let's leave this one there too... shift gears" on problem 2, its go_to was refused and
    the candidate then sat on a problem it had been told was over). Two ways to see it: a move tool (go_to, next_item, close_thread) that
    was refused in a turn whose words announced a move, unless the turn took it back; and words that leave the problem while the very next turn
    is still on that problem. The run's own fixed lines move the plan before the next turn, so they never show as one."""
    out = []
    turns = record.get("turns") or []
    for n, t in enumerate(turns):
        if t.get("speaker") != "interviewer" or t.get("interrupted"):
            continue
        sentences = [x for x in SENTENCES.split((t.get("text") or "").strip()) if x]
        calls = t.get("tool_calls") or []
        refused = [c for c in calls if c.get("name") in MOVE_TOOLS and (c.get("result") or {}).get("ok") is False]
        moved = any(c.get("name") in MOVE_TOOLS and (c.get("result") or {}).get("ok") for c in calls)
        taken_back = bool(sentences) and sentences[-1].lower().startswith("actually, let's stay")
        if refused and any(announces_a_move(x) for x in sentences) and not taken_back:
            out.append(_finding("move_announced_not_made", t["seq"], f"{refused[0]['name']} was refused after the turn announced a move: "
                                                                   f"{next(x for x in sentences if announces_a_move(x))[:70]!r}"))
            continue
        later = next((x for x in turns[n + 1:] if x.get("speaker") in ("candidate", "interviewer") and x.get("item_id") is not None), None)
        on_problem = bool(re.match(r"(?:core|reserve)-", str(t.get("item_id") or "")))
        if (on_problem and not moved and later is not None and later.get("item_id") == t.get("item_id") and not taken_back
                and any(abandons_problem(x) for x in sentences)):
            out.append(_finding("move_announced_not_made", t["seq"], f"announced leaving {t.get('item_id')}, which the plan stayed on: "
                                                                   f"{next(x for x in sentences if abandons_problem(x))[:70]!r}"))
    return out


def ended_on_question(record: dict[str, Any]) -> list[Finding]:
    """The round completed right after an interviewer turn that asked the candidate something (or invited their questions), or with the
    candidate's questions never having had a candidate turn (decided 2026-10-18; bf82d318 turn 37: "thank you for your time today. What
    questions do you have for me?" ended a 45-minute round at 5 minutes). Only a normal completion counts: a candidate's End, a conduct or
    proctor end and the time cap end rounds on any turn."""
    if record.get("end_reason") != "completed":
        return []
    last = next((t for t in reversed(record.get("turns") or []) if t.get("speaker") in ("candidate", "interviewer")), None)
    if last is None or last.get("speaker") != "interviewer" or last.get("interrupted"):
        return []
    text = (last.get("text") or "").strip()
    sentences = [x for x in SENTENCES.split(text) if x]
    questions = next((i for i in record.get("items") or [] if i.get("phase") == "candidate_questions"), None)
    if questions is None or questions.get("status") not in ("active", "done"):
        return []                                  # the round never reached their questions: it ended some other way (the plan's own checks see it)
    asked = bool(sentences) and (sentences[-1].rstrip(" \"").endswith("?") or asks_for_questions(text))
    unasked = not questions.get("turns")
    if asked:
        return [_finding("ended_on_question", last["seq"], f"the round ended right after a question to the candidate: {sentences[-1][:70]!r}")]
    if unasked:
        return [_finding("ended_on_question", last["seq"], "the round ended before the candidate had a turn in their questions")]
    return []


# The outline's promises (decided 2026-10-18). A record carries the conductor's ledger (`promises`: promise -> open | covered | dropped) when it has
# one; without it the states are read from the turns against the blueprint's realism block. A record with neither is not checked.

def _promises(record: dict[str, Any]) -> list[str] | None:
    if record.get("promises") is not None:
        return list(record["promises"])
    blueprint = record.get("blueprint")
    return promises_of(blueprint) if blueprint else None


def _in_deep_dive(record: dict[str, Any], turn: dict[str, Any]) -> bool:
    """The turn was said in the deep dive (or a thread under it): the only place a promise is asked about."""
    item = next((i for i in record.get("items") or [] if i.get("item_id") == turn.get("item_id")), None)
    if item is None:
        return turn.get("item_id") == "deep_dive"
    return item.get("phase") == "deep_dive" or (item.get("kind") == "thread" and item.get("parent") == "deep_dive")


def _skip_notice_said(record: dict[str, Any], promise: str) -> bool:
    """An interviewer turn said it was short on time and named this promise's area or project."""
    name = promise.partition(":")[2]
    return any(SKIP_NOTICE.search(t.get("text") or "") and (mentions(name, t.get("text") or "") or name in outline_areas(t.get("text") or ""))
               for t in _spoken(record))


def _promise_states(record: dict[str, Any], promises: list[str]) -> dict[str, str]:
    ledger = record.get("promises")
    if ledger is not None:
        return {p: str(ledger.get(p, "open")) for p in promises}
    blueprint = record.get("blueprint") or {}
    personal = blueprint.get("personalization") or {}
    projects = promised(blueprint, "projects")
    states = {p: "open" for p in promises}
    for t in _spoken(record):
        text = t.get("text") or ""
        if gives_outline(text):
            continue
        for p in promises:
            if states[p] != "open":
                continue
            if _skip_notice_said(record, p) and SKIP_NOTICE.search(text):
                states[p] = "dropped"
            elif _in_deep_dive(record, t) and (promise_covered(text, p, [str(q["prompt"]) for q in promise_questions(personal, p)], projects)
                                               or (asked_question(text) and any(o.get("ask_for") == p for o in t.get("orders") or []))):
                states[p] = "covered"
    return states


def outline_unkept(record: dict[str, Any]) -> list[Finding]:
    """A promised area or project the interviewer never asked about in the deep dive and never skipped with a spoken notice, in a round that
    ended normally. A promise the ledger calls dropped counts only when an interviewer turn really said so (short on time, naming it)."""
    promises = _promises(record)
    if not promises or record.get("end_reason") != "completed":
        return []
    seq = max((t["seq"] for t in _spoken(record)), default=0)
    out = []
    for p, state in _promise_states(record, promises).items():
        if state == "open":
            out.append(_finding("outline_unkept", seq, f"promised {promise_words(p)} and never asked about it or said it was skipped"))
        elif state == "dropped" and not _skip_notice_said(record, p):
            out.append(_finding("outline_unkept", seq, f"{promise_words(p)} was dropped for time and the interviewer never said so"))
    return out


def outline_mismatch(record: dict[str, Any]) -> list[Finding]:
    """The spoken outline does not name every promised area, or names one that is not promised. It is the first turn that gives the outline,
    the one the guard checks: said before the coding or in the turn that puts the first problem up (not a later description of the round)."""
    promises = _promises(record)
    if not promises:
        return []
    areas = [p.partition(":")[2] for p in promises if p.partition(":")[0] == "fundamentals"]
    projects = [p.partition(":")[2] for p in promises if p.partition(":")[0] == "projects"]
    items = record.get("items") or []
    for t in _spoken(record):
        if not gives_outline(t.get("text") or ""):
            continue
        if not outline_turn_eligible([(i.get("item_id"), i.get("kind")) for i in items], t.get("item_id")):
            return []                      # the first description of the round came too late to be the outline: the guard never checked it
        why = spoken_outline_mismatch(t.get("text") or "", areas, projects)
        return [_finding("outline_mismatch", t["seq"], f"the spoken outline {why}")] if why else []
    return []


def repeated_opener(record: dict[str, Any]) -> list[Finding]:
    """A turn that opens with the same words as the turn before it, or for the third time within five turns ("Mm, okay." again and again; decided
    2026-10-18; the talker's `repeated_opener` guard, run over what was actually spoken). The opener is the first sentence when it only
    acknowledges, else the one to three words before its first comma. The lines the run says in fixed words (every pool of lines.py: the warnings,
    the endings, the problem lines, the fallbacks) are exempt when the run says so (the turn's `fixed` list): the picker keeps their openers apart. A model
    saying the same words is not exempt (only the warnings and the endings are, by their words)."""
    out: list[Finding] = []
    recent: list[str | None] = []
    for t in _spoken(record):
        if t.get("interrupted"):
            continue
        sentences = [x for x in SENTENCES.split((t.get("text") or "").strip()) if x]
        first = sentences[0] if sentences else ""
        fixed = [x for w in t.get("fixed") or [] for x in SENTENCES.split(w)]
        opener = None if not first or first in fixed or matches_any(first, SAFETY_KEYS) else turn_opener(first)
        if opener is not None and opener_repeated(opener, recent, recent.count(opener)):
            out.append(_finding("repeated_opener", t["seq"], f"opens with {opener!r} again (recent openers: {[o for o in recent[-5:] if o]})"))
        recent.append(opener)
    return out


CHECKS: tuple[Callable[[dict[str, Any]], list[Finding]], ...] = (
    silent_reply, narration_spoken, internal_id_spoken, tool_call_spoken, format_confirmation, third_reask, problem_without_candidate,
    outline_twice, intro_after_done, double_goodbye, double_ack, code_claim, planned_later, unrepaired_stumble, false_continuity, promise_unkept,
    screen_claim_unshown, question_then_problem, filler_after_start, verdict_streak, left_problem_in_words, non_english, reasoning_aloud, screen_failed, new_topic_while_coding, second_transition,
    question_after_close, after_problem_line, problem_line_twice, time_spoken, round_words, requirement_invented, hint_from_other_problem, highlight_ignored, board_unreadable, conduct_warn_then_end,
    limits_after_reveal, question_pileup, reply_restated, ack_after_question, changes_over_cap, change_without_refusal, change_flow_valid, repeated_refusal, warning_glued, move_announced_not_made, ended_on_question, outline_unkept, outline_mismatch, repeated_opener)


def check_record(record: dict[str, Any]) -> list[Finding]:
    """Every finding of every check over one run record, in turn order."""
    findings = [f for check in CHECKS for f in check(record)]
    return sorted(findings, key=lambda f: (f["seq"], f["check"]))


# ------------------------------------------------------------------ expectations
# What a persona rehearsal should have shown. Each id is a plain function of the record (the rehearsal's JSON); the persona specs list
# the ids they expect. `clock_start`, `silences`, `selections`, `change_requests` and `blueprint` are what the rehearsal runner adds for them.

REPEAT_REQUEST = re.compile(r"\brepeat\b|say (?:that|it) again|come again|once more|didn'?t (?:catch|hear|get) (?:that|the question)", re.IGNORECASE)
CANNOT_SEE = re.compile(r"(?:can'?t|cannot|unable to|don'?t|do not) (?:currently )?(?:see|tell|know) (?:what|which|that|the selection)", re.IGNORECASE)
CODING_SILENCE_S = 90          # a silence this long, with code changing, is the candidate working
SILENCE_GRACE_S = 60           # the interviewer starts nothing of its own before this much of it has passed
LONG_WORD = re.compile(r"[a-z]{6,}")
Result = dict[str, Any]


def _result(expect: str, ok: bool, detail: str) -> Result:
    return {"expect": expect, "ok": ok, "detail": detail}


def _candidate_turns(record: dict[str, Any]) -> int:
    return sum(1 for t in record.get("turns") or [] if t.get("speaker") == "candidate")


def _is_proactive(record: dict[str, Any], turn: dict[str, Any]) -> bool:
    """An interviewer turn the interviewer started itself: nothing from the candidate came between it and the interviewer turn before."""
    turns = record.get("turns") or []
    i = next((n for n, t in enumerate(turns) if t is turn), 0)
    return i == 0 or turns[i - 1].get("speaker") != "candidate"


def _rel(record: dict[str, Any], turn: dict[str, Any]) -> float:
    return float(turn.get("at") or 0) - float(record.get("clock_start") or 0)


def _next_spoken(record: dict[str, Any], after: dict[str, Any]) -> dict[str, Any] | None:
    turns = record.get("turns") or []
    i = next((n for n, t in enumerate(turns) if t is after), -1)
    return next((t for t in turns[i + 1:] if t.get("speaker") == "interviewer"), None)


def _tool_ok(turn: dict[str, Any], name: str) -> bool:
    return any(c.get("name") == name and (c.get("result") or {}).get("ok") for c in turn.get("tool_calls") or [])


def _problem_reached(record: dict[str, Any], expect: str) -> Result:
    hit = next((i for i in record.get("items") or [] if i.get("kind") == "slot" and i.get("status") != "pending" and (i.get("turns") or 0) >= 2), None)
    return _result(expect, hit is not None, f"{hit['item_id']} had {hit['turns']} candidate turns" if hit else "no problem got two candidate turns")


def _ended_cleanly(record: dict[str, Any], expect: str) -> Result:
    farewells = sum(1 for t in _spoken(record) if is_farewell(t.get("text") or ""))
    surplus = len(surplus_farewells(record))
    wrapped = any(i.get("phase") in ("candidate_questions", "wrap_up") and i.get("status") in ("active", "done") for i in record.get("items") or [])
    ended = record.get("end_reason") == "candidate_ended"
    if wrapped:
        return _result(expect, farewells >= 1 and not surplus, f"reached the closing parts, {farewells} farewell(s), {surplus} too many")
    if ended:
        return _result(expect, not surplus, f"the candidate pressed End, {farewells} farewell(s), {surplus} too many")
    return _result(expect, False, "the round neither reached the closing parts nor was ended by the candidate")


def _picked_up(record: dict[str, Any]) -> int | None:
    """The interviewer turn that took up the persona's own topic (its `topic` words): the first reply after they raise it that names it or
    shares a distinctive word with what they said, and asks or invites more ("tell me what happened")."""
    topic = [w.lower() for w in record.get("topic") or []]
    raised = next((t for t in record.get("turns") or [] if t.get("speaker") == "candidate" and any(w in (t.get("text") or "").lower() for w in topic)), None)
    reply = _next_spoken(record, raised) if raised is not None and topic else None
    if reply is None:
        return None
    said = (reply.get("text") or "").lower()
    about = any(w in said for w in topic) or _title_words(said) & _title_words(raised.get("text") or "")
    invites = "?" in said or re.search(r"\b(?:tell me|walk me through|go ahead|what happened)\b", said)
    return reply["seq"] if about and invites else None


def _followed_or_kept(record: dict[str, Any], expect: str) -> Result:
    followed = _picked_up(record) or next((t["seq"] for t in _spoken(record) if t.get("followed")), None)
    kept = any(m.get("ok") and m.get("move") in THREAD_MOVES for m in record.get("flow_log") or []) \
        or any(i.get("kind") == "thread" or i.get("origin") == "promise" for i in record.get("items") or [])
    return _result(expect, followed is not None or kept, f"followed turn {followed}" if followed is not None else
                   "a thread or deferral was kept" if kept else "no followed turn and no thread or deferral")


def _intro_not_reasked(record: dict[str, Any], expect: str) -> Result:
    again = intro_after_done(record)
    outlines = len(outline_twice(record)) + (1 if any(gives_outline(t.get("text") or "") for t in _spoken(record)) else 0)
    if again:
        return _result(expect, False, f"the introduction was asked for again at seq {again[0]['seq']}")
    return _result(expect, outlines <= 1, f"the outline was given {outlines} time(s)")


def _hint_given(record: dict[str, Any], expect: str) -> Result:
    hit = next((t["seq"] for t in _spoken(record) if _tool_ok(t, "give_hint")), None)
    return _result(expect, hit is not None, f"give_hint ok at seq {hit}" if hit is not None else "no give_hint call succeeded")


def _change_flow_valid(record: dict[str, Any], expect: str) -> Result:
    """The interviewer's handling of requests for another problem (decided 2026-10-18) kept its hard limits (one change at most, a refusal before it,
    a refusal on the problem before the coding ends), and a problem it let go of was left for the next problem, a reserve or a closed coding part,
    never a hanging one. Holding every ask is valid; at least one ask must have been made."""
    asks = record.get("change_requests") or {}
    gave_up = record.get("gave_up_items")
    if gave_up is None:                            # a record from before the interviewer decided: two asks on a problem was a give-up
        gave_up = [k for k, v in asks.items() if v >= 2]
    if not asks and not gave_up:
        return _result(expect, False, "no problem was asked to be changed")
    if broken := change_flow_valid(record):
        return _result(expect, False, f"seq {broken[0]['seq']}: {broken[0]['detail']}")
    slots = [i for i in record.get("items") or [] if i.get("kind") == "slot"]
    for item_id in gave_up:
        item = next((i for i in slots if i["item_id"] == item_id), None)
        others = [i for i in slots if i is not item]
        moved = any(i.get("status") in ("active", "done") for i in others) or not any(i.get("status") == "pending" for i in others)
        if item is None or item.get("status") not in ("done", "swapped") or not moved:
            return _result(expect, False, f"{item_id} was let go of and left {item and item.get('status')}")
    given = len(changes_given(record))
    if given > CHANGE_CAP:
        return _result(expect, False, f"{given} problem changes were given in one round")
    if not gave_up:
        return _result(expect, True, f"every ask was resisted ({sum(asks.values())} ask(s))")
    return _result(expect, True, f"{', '.join(gave_up)} moved on after a decision to let go ({given} change given)")


def _no_answer_given(record: dict[str, Any], expect: str) -> Result:
    if (hit := next((t["seq"] for t in _spoken(record) if _tool_ok(t, "code_insert")), None)) is not None:
        return _result(expect, False, f"code_insert was called at seq {hit}")
    if not record.get("blueprint"):
        return _result(expect, True, "no code_insert call; no blueprint in the record, so the spoken sentences were not leak-checked")
    guard = LeakGuard(record["blueprint"])
    slot_of = {i["item_id"]: i.get("slot_id") or i["item_id"] for i in record.get("items") or []}
    said = ""
    for t in record.get("turns") or []:
        if t.get("speaker") == "candidate":
            said = t.get("text") or ""
            continue
        for sentence in [s for s in SENTENCES.split(t.get("text") or "") if s]:
            v = guard.check_sentence(sentence, current_slot=slot_of.get(t.get("item_id")), candidate_said=said)
            if not v.ok and v.rule in ("solution_code", "insight_completed"):
                return _result(expect, False, f"seq {t['seq']} broke {v.rule}: {sentence[:60]!r}")
    return _result(expect, True, "no sentence gave the solution or finished the insight; no code_insert")


def _coding_silence_respected(record: dict[str, Any], expect: str) -> Result:
    silences = [s for s in record.get("silences") or [] if s["wait_s"] >= CODING_SILENCE_S and s.get("code")]
    if not silences:
        return _result(expect, True, "the candidate had no long silence with code changing")
    for s in silences:
        inside = [t for t in _spoken(record) if _is_proactive(record, t) and s["start"] < _rel(record, t) <= s["start"] + s["wait_s"]]
        if len(inside) > 1:
            return _result(expect, False, f"{len(inside)} interviewer-started turns in the {s['wait_s']} s silence from {s['start']:.0f} s")
        if inside and _rel(record, inside[0]) - s["start"] < SILENCE_GRACE_S:
            return _result(expect, False, f"the interviewer spoke {_rel(record, inside[0]) - s['start']:.0f} s into a silence (seq {inside[0]['seq']})")
    return _result(expect, True, f"{len(silences)} long coding silence(s) left alone")


_LINE_ALIVE = re.compile(r"^(?:yes|yeah|yep)?[,.!\s—-]*(?:i'm here|i am here|i can hear you|you're coming through|i hear you)")


def _line_check_answered(record: dict[str, Any], expect: str) -> Result:
    items = {i["item_id"]: i for i in record.get("items") or []}
    checks = [t for t in record.get("turns") or [] if t.get("speaker") == "candidate" and "can you hear me" in (t.get("text") or "").lower()]
    if not checks:
        return _result(expect, False, "the candidate never asked whether they could be heard")
    for c in checks:
        item = items.get(c.get("item_id")) or {}
        if c.get("item_id") in ("greeting", "small_talk") or item.get("phase") in ("greeting", "small_talk"):
            continue
        reply = _next_spoken(record, c)
        # The run's canned reply or any opening that tells them the line is alive ("I'm here, you're coming through fine").
        head = (reply or {}).get("text", "").strip().lower()[:60]
        first = next(iter(SENTENCES.split((reply or {}).get("text", "").strip())), "")
        if reply is None or not (head.startswith(LINE_CHECK_REPLY.rstrip(".").lower()) or _LINE_ALIVE.search(head)
                                 or matches_any(first, ("line_check", "presence"))):
            return _result(expect, False, f"seq {c['seq']}: the reply began {(reply or {}).get('text', '')[:40]!r}")
    return _result(expect, True, f"{len(checks)} line check(s) answered")


def _repeat_honoured(record: dict[str, Any], expect: str) -> Result:
    turns = record.get("turns") or []
    asks = [(n, t) for n, t in enumerate(turns) if t.get("speaker") == "candidate" and REPEAT_REQUEST.search(t.get("text") or "")]
    if not asks:
        return _result(expect, False, "the candidate never asked for a repeat")
    for n, t in asks:
        before = next((last_question(x.get("text") or "") for x in reversed(turns[:n]) if x.get("speaker") == "interviewer"
                       and last_question(x.get("text") or "")), None)
        reply = _next_spoken(record, t)
        # 5+ letter words: a short question's key noun ("what to cache") is often 5 letters, and a faithful rewording keeps it.
        words = set(re.findall(r"\b[a-z]{5,}\b", (before or "").lower()))
        if not words or reply is None:
            continue
        share = len(words & set(re.findall(r"\b[a-z]{5,}\b", (reply.get("text") or "").lower()))) / len(words)
        if share < 0.5:
            return _result(expect, False, f"seq {t['seq']}: the reply repeated {share:.0%} of the question's words")
    return _result(expect, True, f"{len(asks)} repeat request(s) honoured")


def _selection_used(record: dict[str, Any], expect: str) -> Result:
    selections = record.get("selections") or []
    if not selections:
        return _result(expect, False, "the candidate never selected anything")
    asked = 0
    for sel in selections:
        speech = next((t for t in record.get("turns") or [] if t.get("speaker") == "candidate" and _rel(record, t) > sel["at"]), None)
        if speech is not None and not ("?" in speech.get("text", "") and re.search(r"\b(?:this|that|here|it says)\b", speech["text"], re.IGNORECASE)):
            continue                            # a highlight while explaining, not a question about the highlighted words
        asked += 1
        reply = _next_spoken(record, speech) if speech is not None else next((t for t in _spoken(record) if _rel(record, t) > sel["at"]), None)
        if reply is None:
            return _result(expect, False, f"no interviewer turn after the selection {sel['text'][:30]!r}")
        said = (reply.get("text") or "").lower()
        # The highlighted words or the words of their question about it ("on this — the minimum of the two heights, right?").
        question = next((q for q in reversed(re.split(r"(?<=[.?!])\s+", (speech or {}).get("text", ""))) if "?" in q), "")
        words = _title_words(sel["text"])
        shared = max(len(words & _title_words(said)), min(len(_title_words(question) & _title_words(said)), len(words)))
        need = 1 if len(words) <= 3 else 2      # a short highlight ("arbitrary spaces") is answered with its key word
        if CANNOT_SEE.search(said) or not (shared >= min(need, len(words)) and words or sel["text"].lower() in said):
            return _result(expect, False, f"seq {reply['seq']} did not use the selection {sel['text'][:30]!r} ({shared} shared word(s))")
    if not asked:
        return _result(expect, False, "the candidate never asked about a highlighted phrase")
    return _result(expect, True, f"{asked} highlighted question(s) answered about the highlighted words")


def _conduct_warned(record: dict[str, Any], expect: str) -> Result:
    hit = next((t["seq"] for t in _spoken(record) if _tool_ok(t, "flag_conduct") or any(o.get("kind") == "conduct_warning" for o in t.get("orders") or [])), None)
    return _result(expect, hit is not None, f"a conduct warning at seq {hit}" if hit is not None else "no conduct warning order and no flag_conduct call")


EXPECTATIONS: dict[str, Callable[[dict[str, Any], str], Result]] = {
    "problem_reached": _problem_reached, "ended_cleanly": _ended_cleanly, "followed_or_kept": _followed_or_kept,
    "intro_not_reasked": _intro_not_reasked, "hint_given": _hint_given, "change_flow_valid": _change_flow_valid,
    "no_answer_given": _no_answer_given, "coding_silence_respected": _coding_silence_respected,
    "line_check_answered": _line_check_answered, "repeat_honoured": _repeat_honoured, "selection_used": _selection_used,
    "conduct_warned": _conduct_warned}


def check_expectations(record: dict[str, Any], expect: list[str]) -> list[Result]:
    """One `{"expect", "ok", "detail"}` per id, in the order given; an unknown id fails with its name."""
    return [EXPECTATIONS[e](record, e) if e in EXPECTATIONS else _result(e, False, f"unknown expectation {e!r}") for e in expect]
