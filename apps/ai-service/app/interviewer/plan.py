"""The interview plan built from a blueprint (spec §4), and the candidate-safe problem payload (spec
§6.3): the statement and two examples under a generic label. Never names, topics or difficulty."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Literal

from app.blueprint.shapes import shape_by_id
from app.blueprint.vocabulary import UNSCORED_PHASES, family, slot_round_type
from app.interviewer.lines import BRIDGE_POOLS, LINES, LinePicker, bridge_variant, pack_key
from app.rounds.compose import PACKS, rules_of

ItemKind = Literal["phase", "slot", "filler", "thread"]
ItemStatus = Literal["pending", "active", "done", "skipped", "swapped"]
PROTECTED_PHASES = frozenset({"candidate_questions", "deep_dive", "wrap_up"})
MIN_PHASE_SECONDS = 60
# Candidate exchanges a phase needs before the interviewer may leave it early (its time being up always wins). A real
# interviewer does not skip the background questions because the candidate says "ready".
# The outline ends by asking for a yes, once per round (decided 2026-10-18, reversing the "no question at the end" rule of 2026-10-17).
CONFIRM_CHECK = '"Does that sound okay?" (or "Shall we get started?")'
MIN_TURNS: dict[str, int] = {"small_talk": 1, "framing": 1, "deep_dive": 3, "candidate_questions": 1}


@dataclass
class Item:
    item_id: str
    kind: ItemKind
    phase: str
    max_seconds: int
    slot_id: str | None = None
    status: ItemStatus = "pending"
    started_at: float | None = None
    ended_at: float | None = None
    ended_by: str | None = None
    hint_step: int = 0
    filler: dict[str, str] | None = None
    turns: int = 0                      # candidate exchanges while this item was active
    must: bool = False                  # a goal the round must cover; the rest may be dropped under time pressure
    bonus: bool = False                 # a problem the round's minutes do not hold: not reserved up front, given if the first went well
    origin: str = "plan"                # plan | reserve | filler | the interviewer's own thread
    why: str = ""
    title: str = ""
    parent: str | None = None
    style: str = ""
    coded: bool = False                 # a slot: they have written code for this problem (the editor is shared by every problem)
    code_base: str = ""                 # a slot: the editor text when it went up: only lines added since count as work on this one
    code_final: str = ""                # a slot: the last editor text seen while it was active (recorded for the report's grading; never read live)
    code_language: str = ""             # a slot: the language of that last text
    board_final: str = ""               # the last whiteboard summary seen while this item was active (recorded for grading)


def _ordered(slots: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return sorted((s for s in slots if s.get("kind") == kind), key=lambda s: s.get("order", 0))


def build_items(blueprint: dict[str, Any]) -> list[Item]:
    items: list[Item] = []
    deep_dive = int((blueprint.get("round") or {}).get("deep_dive_mins") or 0)
    for phase in blueprint.get("arc", []):
        name = phase["phase"]
        style = str(phase.get("style") or "")
        if name == "core":
            for n, slot in enumerate(_ordered(blueprint.get("slots", []), "core")):
                # The core's style belongs to the first problem only; the later ones carry none.
                items.append(Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"],
                                  must=True, style=style if n == 0 else "", bonus=bool(slot.get("bonus"))))
            if deep_dive > 0:
                # The blueprint sets time aside for questions on the candidate's projects and the round's other topics
                # inside the core's minutes. It is a conversation: its own item, so the room goes back to full width.
                items.append(Item("deep_dive", "phase", "deep_dive", deep_dive * 60, must=True))
        else:
            scored = phase.get("scored")
            must = name in ("candidate_questions", "wrap_up") or (name not in UNSCORED_PHASES if scored is None else bool(scored))
            items.append(Item(name, "phase", name, max(MIN_PHASE_SECONDS, int(phase.get("timebox_mins") or 1) * 60), must=must, style=style))
    return items


def layout_for(blueprint: dict[str, Any], item: Item) -> str:
    """`work` while the candidate is on a coding, low-level design or system design problem (they need the problem
    and the editor or board), `talk` for everything else: greetings, resume and profile questions, behavioural
    questions, their questions for the interviewer and the closing."""
    if item.kind != "slot" or (rules_of(blueprint).get("flags") or {}).get("workspace") == "none":
        return "talk"
    slot = slot_by_id(blueprint, item.slot_id) or {}
    round_type = (slot.get("problem") or {}).get("round_type") or (blueprint.get("round") or {}).get("type") or "dsa"
    return "talk" if family(slot_round_type(round_type, item.slot_id or "")) == "behavioural" else "work"


def reserve_slots(blueprint: dict[str, Any]) -> list[dict[str, Any]]:
    return _ordered(blueprint.get("slots", []), "reserve")


def wire_ids(blueprint: dict[str, Any]) -> dict[str, str]:
    """slot_id -> the id the candidate's browser sees: the slot's kind and its position among slots of that kind.
    Blueprint ids can carry a word (`reserve-harder`, `reserve-alternate`) that would show in the wire and the DOM."""
    ids: dict[str, str] = {}
    for kind in ("core", "reserve"):
        for n, slot in enumerate(_ordered(blueprint.get("slots", []), kind), start=1):
            ids[slot["slot_id"]] = f"{kind}-{n}"
    return ids


def slot_by_id(blueprint: dict[str, Any], slot_id: str | None) -> dict[str, Any] | None:
    return next((s for s in blueprint.get("slots", []) if s.get("slot_id") == slot_id), None) if slot_id else None


def round_seconds(blueprint: dict[str, Any], context: dict[str, Any]) -> int:
    minutes = ((context.get("round") or {}).get("duration_mins") or (blueprint.get("round") or {}).get("duration_mins")
               or sum(int(p.get("timebox_mins") or 0) for p in blueprint.get("arc", [])))
    return int(minutes) * 60


def _literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def format_args(args: dict[str, Any]) -> str:
    return "\n".join(f"{name} = {_literal(value)}" for name, value in args.items())


def _content(slot: dict[str, Any] | None) -> dict[str, Any]:
    return ((slot or {}).get("problem") or {}).get("content") or {}


def problem_payload(slot: dict[str, Any], label: str, item_id: str | None = None) -> dict[str, Any]:
    content = _content(slot)
    statement = (content.get("statement") or content.get("question") or (slot.get("ask") or {}).get("opening") or "").strip()
    examples = []
    for ex in (content.get("examples") or [])[:2]:
        example = {"input": format_args(ex.get("args") or {}), "output": _literal(ex.get("expected"))}
        if ex.get("explanation"):
            example["explanation"] = str(ex["explanation"])[:2000]
        examples.append(example)
    return {"type": "panel.show_problem", "item_id": item_id or slot["slot_id"], "label": label,
            "kind": "problem" if examples else "question", "statement": statement[:20000], "examples": examples}


def reveal_text(slot: dict[str, Any] | None, kind: str) -> str | None:
    """Exactly what the problem says: constraints, or the input/output format. Shown only when asked."""
    content = _content(slot)
    if kind == "constraints":
        return "\n".join(str(c) for c in content.get("constraints") or []) or None
    if kind == "format":
        parts = [f"Input: {content['input_format']}" if content.get("input_format") else "",
                 f"Output: {content['output_format']}" if content.get("output_format") else ""]
        return "\n".join(p for p in parts if p) or None
    return None


def intro_probes(personal: dict[str, Any]) -> list[dict[str, Any]]:
    """The resume probe the introduction may use: the first of two or more. With a single probe it is kept for the deep dive."""
    probes = list(personal.get("resume_probes") or [])
    return probes[:1] if len(probes) >= 2 else []


def deep_dive_probes(personal: dict[str, Any]) -> list[dict[str, Any]]:
    """The resume probes left for the deep dive, so it never re-asks what the introduction already covered."""
    probes = list(personal.get("resume_probes") or [])
    return probes[1:] if len(probes) >= 2 else probes


# The short area a round question is about, for the outline ("Java and databases") and to keep one area's questions together. The first
# pattern found in the question's `covers` wins, then in its text; a generic `covers` ("resume-based question") names no area.
_AREAS: tuple[tuple[str, re.Pattern[str]], ...] = tuple((label, re.compile(pattern, re.IGNORECASE)) for label, pattern in (
    ("Java", r"\bjava\b|\bjvm\b"), ("Python", r"\bpython\b"), ("JavaScript", r"\bjavascript\b|\btypescript\b|\bnode(?:\.?js)?\b"),
    ("React", r"\breact\b"), ("databases", r"\bsql\b|\bdatabases?\b|\bdbms\b|\bpostgres|\bmysql\b|\bmongo|\bprisma\b|\bsqlite\b|\bnormali[sz]"),
    ("operating systems", r"\boperating systems?\b|\bos\b|\bprocess(?:es)? and threads?\b|\bvirtual memory\b|\bdeadlock"),
    ("networking", r"\bnetwork(?:s|ing)?\b|\btcp\b|\bhttp\b|\bdns\b"),
    ("object-oriented design", r"\boop\b|\bobject[- ]oriented\b|\bsolid principles\b")))
_NO_AREA = re.compile(r"resume|motivation|\bfit\b|culture|behaviou?r|\bintro", re.IGNORECASE)
_VAGUE = re.compile(r"^(?:general|fundamentals?|basics?|technical|cs fundamentals?)$", re.IGNORECASE)


def _label(covers: str) -> str:
    """A round question's own `covers` as something to say aloud ("API design"), or "" when it would read badly: a category prefix
    ("Fundamentals -") is dropped, common nouns are lowercased and acronyms kept; more than three words or a dash, colon or slash leaves it out."""
    cleaned = re.sub(r"^\s*(?:cs\s+)?fundamentals?\s*[\u2013\u2014:-]\s*", "", covers, flags=re.IGNORECASE).strip()
    if re.search(r"[\u2013\u2014:/]", cleaned):
        return ""
    cleaned = re.sub(r"[-_]+", " ", cleaned).strip()
    if not cleaned or _VAGUE.match(cleaned) or len(cleaned.split()) > 3:
        return ""
    return " ".join(w.lower() if w == w.capitalize() else w for w in cleaned.split())


def question_area(question: dict[str, Any]) -> str | None:
    """The short area a round question is about ("Java", "databases"). "" for a technical question whose area cannot be said cleanly
    (it is still a fundamentals question); None for one that is about them (motivation, a resume question)."""
    covers = str(question.get("covers") or "")
    for label, pattern in _AREAS:
        if pattern.search(covers):
            return label
    if _NO_AREA.search(covers):
        return None
    for label, pattern in _AREAS:
        if pattern.search(str(question.get("prompt") or "")):
            return label
    return _label(covers)


def round_questions(personal: dict[str, Any]) -> list[dict[str, Any]]:
    """The round's own questions as dicts with a `prompt` (an old blueprint may carry bare strings)."""
    return [q if isinstance(q, dict) else {"prompt": str(q)} for q in personal.get("round_questions") or [] if q]


def deep_dive_questions(personal: dict[str, Any]) -> list[tuple[str | None, dict[str, Any]]]:
    """What the deep dive asks, in the order it is asked: the resume probes first (area None), then the round questions with each
    area's questions together (areas in the order they first appear, the questions with no area last), so no topic comes back."""
    out: list[tuple[str | None, dict[str, Any]]] = [(None, p) for p in deep_dive_probes(personal) if p.get("prompt")]
    questions = [(question_area(q), q) for q in round_questions(personal) if q.get("prompt")]
    areas = list(dict.fromkeys(a for a, _ in questions if a))
    for area in [*areas, "", None]:
        out += [(a, q) for a, q in questions if a == area]
    return out


def round_question_areas(personal: dict[str, Any]) -> list[str]:
    """The areas that can be named aloud, in the order they first appear."""
    return list(dict.fromkeys(a for a in (question_area(q) for q in round_questions(personal)) if a))


# ---------------------------------------------------------------- the outline's promises (realism block, decided 2026-10-18)
# A blueprint made after the realism stage carries the round's outline and what its deep dive promises the candidate: `projects:<name>` and
# `fundamentals:<area>`. The spoken outline names exactly those, the conductor keeps them, and the deep dive's questions are a pool per promise.

def realism_outline(blueprint: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The realism block's outline (parts with their promises), or None for a blueprint prepared before it existed (today's template)."""
    outline = (blueprint.get("realism") or {}).get("outline")
    return [p for p in outline if isinstance(p, dict)] if outline else None


def _has_deep_dive(blueprint: dict[str, Any]) -> bool:
    return any(p.get("phase") == "core" for p in blueprint.get("arc", [])) and int((blueprint.get("round") or {}).get("deep_dive_mins") or 0) > 0


def promises_of(blueprint: dict[str, Any]) -> list[str]:
    """What the deep dive promised, in the outline's order: [] without a realism block or when the live plan has no deep dive to keep it in."""
    outline = realism_outline(blueprint)
    if outline is None or not _has_deep_dive(blueprint):
        return []
    found = [str(x).strip() for part in outline if part.get("part") == "deep_dive" for x in part.get("promises") or []]
    return list(dict.fromkeys(x for x in found if x.partition(":")[0] in ("projects", "fundamentals") and x.partition(":")[2].strip()))


def promised(blueprint: dict[str, Any], kind: str) -> list[str]:
    """The names promised of one kind: `projects` (project names) or `fundamentals` (area labels)."""
    return [x.partition(":")[2].strip() for x in promises_of(blueprint) if x.partition(":")[0] == kind]


def promise_words(promise: str) -> str:
    """A promise as something to say aloud ("the Java questions", "the questions about your Relay project")."""
    kind, _, name = promise.partition(":")
    return f"the questions about your {name} project" if kind == "projects" else f"the {name} questions"


def mentions(name: str, text: str) -> bool:
    return bool(name) and re.search(rf"(?<!\w){re.escape(name)}(?!\w)", text or "", re.IGNORECASE) is not None


def promise_questions(personal: dict[str, Any], promise: str) -> list[dict[str, Any]]:
    """The pool one promise draws its questions from: the round's questions in that area, or the resume probes that name that project
    (empty when none does: the interviewer is then told to ask about the project from the resume)."""
    kind, _, name = promise.partition(":")
    if kind == "fundamentals":
        return [q for q in round_questions(personal) if q.get("prompt") and question_area(q) == name]
    return [p for p in deep_dive_probes(personal) if p.get("prompt") and (mentions(name, str(p.get("grounded_in") or "")) or mentions(name, p["prompt"]))]


def deep_dive_extras(personal: dict[str, Any], blueprint: dict[str, Any]) -> list[tuple[str | None, dict[str, Any]]]:
    """The deep dive's questions that belong to no promise: optional once every promise has been asked about."""
    used = {q["prompt"] for p in promises_of(blueprint) for q in promise_questions(personal, p)}
    return [(area, q) for area, q in deep_dive_questions(personal) if q["prompt"] not in used]


def outline_requirement(blueprint: dict[str, Any]) -> str:
    """What the spoken outline must hold, for the interviewer's instructions and for a retry after the guard held a sentence back."""
    areas, projects = promised(blueprint, "fundamentals"), promised(blueprint, "projects")
    out = ["name exactly these fundamentals areas, each one, and no other area: " + _join(areas) if areas
           else "name no fundamentals area"]
    if projects:
        out.append("mention that you will ask about their projects")
    return "Your outline must " + ", and ".join(out) + ". Say it in your own words, not as a list, and never give any length of time."


def outline_turn_eligible(items: list[tuple[str, str]], item_id: str | None) -> bool:
    """Whether a turn said on `item_id` can be the round's outline: the part is at or before the first problem in the plan's order (`items` is
    (item_id, kind) in plan order). One rule for the guard (the run's live plan) and the trace check (the record's parts), so they check the same
    turn. A part the list does not know is eligible."""
    first = next((n for n, (_, kind) in enumerate(items) if kind == "slot"), len(items))
    at = next((n for n, (iid, _) in enumerate(items) if iid == item_id), None)
    return at is None or at <= first


def with_outline_text(blueprint: dict[str, Any]) -> str:
    """What to say about the round's outline just before the first problem goes up (a round whose coding part has the `with_outline` style).
    Today's one sentence for an old blueprint; for one with a realism block, the parts after this point as content (the promised areas and
    projects included) and the same requirement the framing's outline has, since the guard checks this turn too."""
    if realism_outline(blueprint) is None:
        return (f"say in one sentence how {part_nouns(blueprint)[1]} will run, then time for their questions "
                "(never a number of minutes or any length of time).")
    return ("say in your own words how the rest of the round will run, covering each of these parts in this order (the parts, not a sentence to "
            f"read out): {'; '.join(outline_parts(blueprint, include_intro=False))}. {outline_requirement(blueprint)}")


def _fundamentals(personal: dict[str, Any]) -> bool:
    """Whether the round has fundamentals questions: any round question that is not about them."""
    return any(question_area(q) is not None for q in round_questions(personal))


def main_part_done(blueprint: dict[str, Any]) -> str:
    """The sentence that closes the round's main part: the coding for a coding round, the design part or the questions otherwise."""
    nouns = part_nouns(blueprint)
    return CODING_DONE if nouns[1] == "the coding" else f"That wraps up {nouns[1]}."


def _asks_projects(blueprint: dict[str, Any]) -> bool:
    """Whether the deep dive has questions about their projects as a part of its own: a behavioural round's questions are about their
    experience already."""
    return bool(deep_dive_probes(blueprint.get("personalization") or {})) and part_nouns(blueprint)[0] != PACKS["behavioural"].words.some_part


def _join(words: list[str]) -> str:
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def _deep_dive_parts(blueprint: dict[str, Any]) -> list[str]:
    """What the deep dive covers, in plain words: questions about their projects, and quick fundamentals questions with their areas."""
    personal = blueprint.get("personalization") or {}
    if promises_of(blueprint):
        # The realism outline decides what is said: exactly its promised projects and areas, never the pool's other areas.
        projects, areas = promised(blueprint, "projects"), promised(blueprint, "fundamentals")
        return ([f"some questions about your {_join(projects)} project{'s' if len(projects) > 1 else ''}"] if projects else []) + \
            ([f"a few quick fundamentals questions on {_join(areas)}"] if areas else [])
    parts = ["some questions about your projects"] if _asks_projects(blueprint) else []
    if _fundamentals(personal):
        areas = round_question_areas(personal)
        parts.append("a few quick fundamentals questions" + (f" on {_join(areas)}" if areas else ""))
    return parts


def outline_parts(blueprint: dict[str, Any], include_intro: bool = True) -> list[str]:
    """The round's parts as they really are, from its item list and in its order, in words the interviewer can say."""
    parts: list[str] = []
    items = build_items(blueprint)
    problems = sum(1 for i in items if i.kind == "slot")
    main_part_said = False                      # the problems are one part, however many there are
    framing_at = next((n for n, i in enumerate(items) if i.phase == "framing"), None)
    for n, item in enumerate(items):
        # Only what is still to come: with the classic arc's swap the introduction is had before the framing, so the outline never names it
        # (decided 2026-10-18; rehearsal run_a seq 7 said "a short introduction from you" after the introduction had happened).
        if item.phase == "candidate_intro" and include_intro and (framing_at is None or n > framing_at):
            parts.append("a short introduction from you")
        elif item.kind == "slot" and not main_part_said:
            main_part_said = True
            nouns = part_nouns(blueprint)[0]
            parts.append(("one or two coding problems" if problems > 1 else "a coding problem") if nouns == "some coding" else nouns)
        elif item.phase == "deep_dive":
            parts += _deep_dive_parts(blueprint)
        elif item.phase == "candidate_questions":
            parts.append("time for your questions")
    return parts


def outline_sentence(blueprint: dict[str, Any], include_intro: bool = True) -> str:
    return ", then ".join(outline_parts(blueprint, include_intro))


ORDINALS = ("first", "second", "third", "fourth")
# Said in its own sentence when the coding part is over, before the link to what comes next.
CODING_DONE = "That wraps up the coding part."
# One short line (a few wordings, see lines.py) when a problem goes up: no "think aloud", no "ask me anything that isn't clear".
PROBLEM_INTRO = "Here's your {ordinal} question. Give it a read, and let me know if you have any questions."
# A move to a new part always starts with a short link to what came before, so no topic ever arrives out of nowhere.
BRIDGES: dict[str, str] = {k: v[0] for k, v in BRIDGE_POOLS.items() if ":" not in k and "@" not in k}      # today's wordings: the first of each pool (lines.py)
# A part's own link when its style changes what comes before it.
STYLE_BRIDGES: dict[tuple[str, str], str] = {tuple(k.split(":")): v[0] for k, v in BRIDGE_POOLS.items() if ":" in k and "@" not in k}


# The chat before the round: what the interviewer asks first (the greeting) and then (the small talk), one pair per session so no two
# interviews open the same way. Only what an interviewer asks a candidate at the start of a call (hearing each other, getting settled,
# being ready): nothing personal, and nothing that makes the interviewer invent a day of their own.
ICEBREAKERS: tuple[tuple[str, str], ...] = (
    ("ask how they are doing", "check that they can hear you clearly and the connection is fine on their side"),
    ("check that they can hear you clearly", "ask whether they got into the room without any trouble"),
    ("ask how they are doing today", "ask whether they are somewhere quiet where they can talk comfortably for the round"),
    ("ask whether they got into the room without any trouble", "ask whether they have everything they need before you start, like some water"),
    ("ask how they are doing today", "ask whether they are all set and comfortable before you begin"),
    ("check that your audio is coming through clearly on their side", "ask whether they are ready to get started or would like a minute"),
)


def icebreaker(blueprint: dict[str, Any]) -> tuple[str, str]:
    """The pair for this interview, fixed by the session so a restart keeps it."""
    seed = str(blueprint.get("session_id") or blueprint.get("blueprint_id") or "")
    return ICEBREAKERS[int(hashlib.sha256(seed.encode()).hexdigest(), 16) % len(ICEBREAKERS)]


def _ordinal(number: int) -> str:
    return ORDINALS[min(max(number, 1), len(ORDINALS)) - 1]


def problem_put_up(number: int, picker: "LinePicker | None" = None, peek: bool = False, pack_id: str = "dsa") -> str:
    """The sentence said while the problem goes up; the intro line follows once the screen has changed. One of the pool's wordings (no repeat in a
    round) when the run's picker is given, else today's. `peek`: the wording the run would say next, without using it up."""
    key = pack_key(f"put_up:{_ordinal(number)}", pack_id)
    return (picker.peek(key) if peek else picker.pick(key)) if picker is not None else LINES[key][0]


def problem_swap_put_up(picker: "LinePicker | None" = None, pack_id: str = "dsa") -> str:
    """The line said while a different problem goes up for a candidate who asked for another (an acknowledgement, then the put-up sentence): not
    "the second problem" again."""
    key = pack_key("swap_put_up", pack_id)
    return picker.pick(key) if picker is not None else LINES[key][0]


def problem_intro(number: int, picker: "LinePicker | None" = None, peek: bool = False, pack_id: str = "dsa") -> str:
    """The line that invites them to read the problem. `peek`: the wording the run would say next, without using it up."""
    key = pack_key(f"intro:{_ordinal(number)}", pack_id)
    return (picker.peek(key) if peek else picker.pick(key)) if picker is not None else LINES[key][0]


def bridge_for(phase: str, style: str = "", blueprint: dict[str, Any] | None = None, pack_id: str | None = None) -> str | None:
    """The link the orders give as an example when the interview moves to this part. With the blueprint, the session's own wording of its pool
    (a blueprint with a realism block); without, today's."""
    key = f"{phase}:{style}" if (phase, style) in STYLE_BRIDGES else phase if phase in BRIDGES else None
    if key is None:
        return None
    return bridge_variant(blueprint, key, pack_id) if blueprint is not None else BRIDGE_POOLS[pack_key(key, pack_id or "dsa")][0]


def phase_style(blueprint: dict[str, Any], phase: str) -> str:
    """The style the arc gives a phase ("" when it has none)."""
    return str(next((p.get("style") for p in blueprint.get("arc", []) if p.get("phase") == phase), "") or "")


def min_exchanges_before_coding(blueprint: dict[str, Any]) -> int:
    """Candidate exchanges the conversation before the coding needs: the round's shape decides (5 for an old blueprint)."""
    return shape_by_id(blueprint.get("shape_id")).min_exchanges_before_coding


def part_nouns(blueprint: dict[str, Any]) -> tuple[str, str]:
    """(what there will be, the part by name) for the round's main part, from the round's pack: "some coding" / "the coding" for a coding round."""
    nouns = rules_of(blueprint).get("part_nouns") or ("some coding", "the coding")
    return nouns[0], nouns[1]


def opening_hint(blueprint: dict[str, Any], phase: str, style: str = "") -> str | None:
    """What to say first when the interview moves on to this part, so the move is a question and not an announcement.
    A style changes how the part opens; one that needs a probe or hook the blueprint lacks falls back to the plain opening."""
    personal = blueprint.get("personalization") or {}
    probe = next((p.get("prompt") for p in personal.get("resume_probes") or [] if p.get("prompt")), None)
    hook = next((h.get("line") for h in personal.get("rapport_hooks") or [] if h.get("line")), None)
    if phase == "candidate_intro" and style == "pointed_resume" and probe:
        return f'Ask one pointed question about something on their resume, not "tell me about yourself", for example: "{probe}".'
    if phase == "candidate_intro" and style == "one_minute":
        return "Ask for a short introduction: who they are and what they work on now."
    if phase == "candidate_intro" and style == "one_project" and probe:
        return f'Ask them to walk you through one project from their resume in depth, for example: "{probe}".'
    if phase == "candidate_intro" and style == "after_coding":
        return "Ask them to tell you a little about themselves and one project they are proud of."
    if phase == "framing" and style == "one_line":
        # One sentence, but never less than the round has: the projects and the fundamentals are named when the round has them.
        rest = _deep_dive_parts(blueprint)
        if realism_outline(blueprint) is not None:
            # Content, not a template sentence: the interviewer puts the parts in its own words (one sentence), and the guard checks the areas.
            return ("Say in one sentence, in your own words, how the round will run, covering each of these parts in this order: "
                    f"{'; '.join(outline_parts(blueprint, include_intro=False))}. {outline_requirement(blueprint)} Then end with one short check, "
                    f"{CONFIRM_CHECK}, and ask nothing else in that turn. Nothing more about the format.")
        what = f"{part_nouns(blueprint)[0]}, then {', then '.join(rest)}, then time for their questions" if rest else \
            f"{part_nouns(blueprint)[0]} and then time for their questions"
        return (f"Say in one sentence that there will be {what}. Then end with one short check, {CONFIRM_CHECK}, and ask nothing else in that turn. "
                "Nothing more about the format.")
    if phase == "small_talk" and style == "rapport" and hook:
        return f'After the chat about the call, ask one light question about their work, starting from this: "{hook}".'
    if phase == "framing" and realism_outline(blueprint) is not None:
        # The outline as content, not a sentence: the interviewer says it in its own voice, and the guard checks the areas it names.
        return ("say how the round will run in your own words, covering each of these parts in this order (the parts, not a sentence to read out): "
                f"{'; '.join(outline_parts(blueprint))}. {outline_requirement(blueprint)} Then end with one short check, "
                + CONFIRM_CHECK + ", and ask nothing else in that turn (no introduction question): the next part starts after their reply. "
                "Say nothing about their projects, resume or background until you have said how the round will run.")
    if phase == "framing":
        return (f"say how the round will run (from the outline), naming each part in this order: {outline_sentence(blueprint)}. Then end with one short check, "
                + CONFIRM_CHECK + ", and ask nothing else in that turn (no introduction question): the next part starts after their reply. "
                "Say nothing about their projects, resume or background until you have said how the round will run.")
    if phase == "candidate_intro":
        return "ask for a short introduction, then what they are working on now."
    if phase == "deep_dive":
        questions = deep_dive_questions(personal)
        if not questions:
            return "ask about a project from their resume, then a fundamentals question."
        # Led in: the coding is over, what comes next is named, and the first question is asked: no topic arrives out of nowhere.
        coming = ", then ".join([*(["a couple of questions about your projects"] if _asks_projects(blueprint) else []),
                                 *(["some quick fundamentals"] if _fundamentals(personal) else [])])
        first = questions[0][1]["prompt"]
        if promises_of(blueprint):
            # A pool per promise (the interviewer picks the order): the first question comes from the first promise that has one.
            coming = ", then ".join(_deep_dive_parts(blueprint))
            first = next((q["prompt"] for p in promises_of(blueprint) for q in promise_questions(personal, p)), first)
        said = f'Say in a sentence of its own that the main part is done (for example "{main_part_done(blueprint)}")'
        return (f'{said}, then say in a few words what comes next (for example "{coming}"), then ask the first one: '
                f'{first}' if coming else f'{said}, then ask the first question: {first}')
    if phase == "candidate_questions":
        return ("invite their questions about the team and the work, and then stop and wait for them. Do not thank them for their time, say goodbye "
                "or wish them well yet: the closing comes only after they have asked what they want to.")
    if phase == "wrap_up":
        return (blueprint.get("persona") or {}).get("closing") or "thank them and say what happens next."
    return None
