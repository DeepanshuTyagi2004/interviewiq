"""The conductor (spec §5.3): the interview's rules in plain code, no LLM. It walks the plan, times
every item, keeps the proctor and conduct ledgers, validates the director's plan changes, and issues
orders the talker must follow on its next turn. Clock-injected and pure, so every rule is tested;
it checkpoints to a dict after every turn (spec §11)."""
from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Literal, Sequence

from app.blueprint.vocabulary import family, is_culture_slot
from app.rounds.compose import pack_for, rules_of
from app.interviewer.closing import addresses_the_candidate, asks_for_other_example, asks_to_change_problem, asks_for_introduction, asks_planned, asks_planned_stems, gives_outline, matches_probe, outline_areas, pulls_back, says_dont_know
from app.interviewer.lines import LINES, SCREEN_WARNING_KEYS, matches_any, pack_key, picker_for, realism_of
from app.interviewer.plan import (MIN_TURNS, PROTECTED_PHASES, Item, bridge_for, build_items, deep_dive_questions, mentions,
                                  min_exchanges_before_coding, opening_hint, part_nouns, problem_intro, problem_put_up, problem_swap_put_up,
                                  promise_questions, promise_words, promised, promises_of, reserve_slots, slot_by_id, with_outline_text)
from app.interviewer.plan import CODING_DONE
from app.interviewer.predicates import written_code

PHASE_ABOUT = {"greeting": "the hello", "small_talk": "a little chat", "framing": "how the round will run", "candidate_intro": "about them",
               "deep_dive": "their projects in depth", "candidate_questions": "their questions for you", "wrap_up": "the closing"}

OrderKind = Literal["converge", "move_on", "wrap_up_now", "nudge", "mention_violation", "final_warning",
                    "conduct_warning", "closing", "open_item", "end", "keep_problem", "decline_request", "reveal_request", "explain_request", "problem_line",
                    "hint_request", "hold", "drop_question", "skip_notice", "resay"]

# Orders the talker must act on at once; every other order waits for a pause so the interviewer never speaks twice in a row.
URGENT_ORDERS = frozenset({"mention_violation", "final_warning", "conduct_warning", "wrap_up_now", "closing", "open_item", "end", "problem_line", "resay"})
# A part's timer orders: issued for one item and acted on when the plan leaves it. They never come back once that item is over
# (a live round re-armed a framing's move_on after a dropped turn, and it ended the introduction and the first problem in turn).
TIMER_ORDERS = frozenset({"converge", "move_on", "nudge", "wrap_up_now"})
# While the candidate has asked for a moment, only these orders are spoken: the rest wait for them (or for the hold to run out).
HOLD_BREAKERS = frozenset({"mention_violation", "final_warning", "conduct_warning", "wrap_up_now", "closing", "end", "problem_line", "hold"})
STALE_CONDUCT_S = 15.0          # a conduct warning pending longer than this is dropped (live round b6280b69: spoken to an unrelated remark)
HOLD_S = 75.0                   # how long "give me a minute" keeps the interviewer quiet, unless they speak first
# Orders the talker may set aside when what the candidate just said covers them or makes them wrong (decided 2026-10-17): asking
# for the final approach, ending the part, opening a part or asking a follow-up. Every other order is always acted on.
SET_ASIDE_ORDERS = frozenset({"converge", "move_on", "open_item"})
# Orders that stop making sense the moment the candidate speaks: a check-in on their silence, and "take your time" they talked past.
STALE_WHEN_THEY_SPEAK = frozenset({"nudge", "hold"})
SET_ASIDE_RETRY_S = 120.0       # after a move_on was set aside, the late fallback waits this long before it may end the part itself
MAX_DROPPED = 40
ORDER_SPACING_S = 12.0
PULL_BACK_OVERLAP = 0.2         # a pull-back counts as a re-ask only when it shares this much with the question it returns to
SAME_INTENT_OVERLAP = 0.35      # the same plan ask counts without a pull-back cue only with this much wording shared
ASK_OVERLAP = 0.6               # the share of words two interviewer questions have in common for the second to count as the first again
# A problem solved early with this much of the round to spare is followed by another (a reserve problem), so a 30-minute
# round is used, not ended after twelve minutes.
EXTRA_PROBLEM_MIN_SLACK_S = 360.0
EXTRA_PROBLEM_MIN_S = 180
HARDER_PROBLEM_MIN_SLACK_S = 720.0
STANDARD_PROBLEMS = 2           # a DSA round's standard: two problems; a reserve is only added to reach it, never beyond
# What a round says in place of "problem" and "the coding" (round packs, `app/rounds`): the DSA words are today's, so a DSA round's orders read as they always did.
_DSA_WORDS: dict[str, Any] = asdict(pack_for("dsa").words)
_BEHAVIOURAL_WORDS: dict[str, Any] = asdict(pack_for("behavioural").words)
REFUSAL_CEILING = 3            # after this many refusals on one problem the interviewer may no longer resist (decided 2026-10-18 after live round 781a1f0a, where a firm persona refused four times)
MIN_SECOND_PROBLEM_S = 480.0   # a second problem is only started when the round has this much left for it
STRUGGLED_HINT_STEPS = 2
MIN_THINK_S = 480.0            # a problem may not be left as "struggled" (the director's read, the hint ladder) before the candidate has had this long on it ...
MIN_THINK_FRACTION = 0.6       # ... or this share of the problem's timebox if that is longer, never more than the timebox (decided 2026-10-21, live round 3e574171:
                               # a coding problem was left 4 minutes in on a candidate who was reading and thinking aloud). A give-up, the round clock and wrap-up are not held.
ATTACHED = "attached to deep_dive"
PROMISED_PREFIX = "They promised to come back to: "
FOCUS_QUESTIONS = 2             # questions the deep dive asks about one promised area before it moves to the next (live round 781a1f0a, turns 41-54)
MAX_DEFERRED = 2                # side topics promised "for later" that the plan holds a place for, per round
DEFERRED_S = 180                # what each gets
THREAD_DEFAULT_MIN = 3          # a thread the interviewer opens gets this many minutes unless it asks for another number
THREAD_MAX_MIN = 6
MAX_THREADS = 3                 # per round
MAX_FLOW_LOG = 20
# The outline's promises (decided 2026-10-18): the deep dive is not left while one is still unasked and the round has this much free time; below it
# the rest are dropped with one spoken sentence that names them (never a number).
PROMISE_FREE_S = 60.0
NOTICE_TRIES = 2                # a skip notice the interviewer did not say is ordered again this many times
SKIP_NOTICE = re.compile(
    r"\b(?:(?:short|low|tight|pressed|limited) (?:on|of|for) time|running (?:short|low|out)(?: (?:of|on) time)?|out of time|time(?:'s| is) (?:short|tight|running (?:short|low|out))|"
    r"(?:not|little|no) (?:much )?time(?: left)?|time is limited|limited time)\b", re.IGNORECASE)
# Where the clause that actually asks begins inside the question sentence: after a colon, dash or semicolon, or at the comma before the
# question word ("..., so how did you ...", "Before that, how did you ...").
_ASK_BREAK = re.compile(r"[:;\u2014\u2013]|,\s*(?:(?:so|and|now|but|first)\s+)?(?=(?:how|what|why|when|where|which|can|could|do|did|does|would|will|is|are|"
                        r"tell me|walk me|talk me|explain|describe)\b)", re.IGNORECASE)
# What a turn says about the person: "You mentioned Java earlier, but..." names no area it asks about.
_ABOUT_THEM = re.compile(r"\byou(?:'ve| have)?\s+(?:mentioned|said|told me|talked about|brought up|listed|used|built|wrote|worked with)\b[^,;.?!\u2014\u2013]*",
                         re.IGNORECASE)
# Change requests (decided 2026-10-18): the interviewer decides what an ask gets (resist, change the problem, or end the coding part: `change_decision.py`,
# the persona's prior when the model cannot) inside hard limits, `allowed_change_actions`: at most CHANGE_CAP changes in a round, never one before the
# round's first refusal, the change needs a problem to give (the next planned one, else a non-harder reserve in that position) and MIN_SECOND_PROBLEM_S
# left, the coding ends only after a refusal on the current problem, and nothing happens once the coding has ended.
CHANGE_CAP = 1
# Said when they ask again and the next problem follows: it takes up their second request, after "stay with this one" a turn earlier.
DROP_QUESTION_ORDER = ("You have asked this same question several times. Stop asking that question, in any wording, and stay on the part you are on: "
                       "respond to what the candidate said, let them keep working, and do not move on, wrap up or leave the problem because of it.")
GIVE_UP_LINE = LINES["give_up"][0]       # one wording of a pool (lines.py): the run says a random one, with no repeat in the round
# Said when the second ask ends the coding part: no blame; the run says it, moves the plan on, and the interviewer opens the next part. Only the
# acknowledgement: the part's own opening says "That wraps up the coding part." (a live round said both back to back, bf82d318 turns 24-25;
# decided 2026-10-18).
CODING_OVER_LINE = LINES["coding_over"][0]
# What the talker is told about each proctor event (spec §7). PRODUCT IP draft.
MENTION: dict[str, str] = {
    "tab_hidden": "The candidate switched to another tab.",
    "window_blur": "The candidate moved to another window or app.",
    "external_display": "A second display is connected.",
    "fullscreen_exit": "The candidate left full screen.",
    "share_stopped": "The candidate's screen share stopped; ask them to share their entire screen again.",
    "away_overstay": "The candidate has not come back to the screen after being told to.",
}
# Said in these exact words when a violation is raised while the candidate works (decided 2026-10-18): the mention and nothing else. A model
# asked for "briefly" padded each one with a re-ask of the question already open, and a live round talked three turns in a row over a
# candidate who was drawing.
# The constants hold the first wording of each pool; the conductor says a random one (`Conductor.lines`, decided 2026-10-18), 2-3 per line with the
# same meaning and firmness, and every matcher recognises all of them (`is_violation_line`).
VIOLATION_LINES: dict[str, str] = {k: LINES[f"violation:{k}"][0] for k in ("tab_hidden", "window_blur", "external_display", "fullscreen_exit", "share_stopped")}
VIOLATION_LINE_DEFAULT = LINES["violation:default"][0]
VIOLATION_MERGE_S = 60.0     # screen events this close together are one action (a tab switch also leaves full screen): one mention, not two
# The final warning, also in fixed words and said alone (decided 2026-10-18): a live round's model glued "this one stays now, so let's work with
# it. Where would you begin?" onto it, and the candidate heard a warning and a question as one breath.
FINAL_WARNING_LINES: dict[str, str] = {k: LINES[f"final_warning:{k}"][0] for k in ("tab_hidden", "window_blur", "external_display", "fullscreen_exit", "share_stopped")}
FINAL_WARNING_DEFAULT = FINAL_WARNING_LINES["tab_hidden"]
PROCTOR_END_LINE = LINES["proctor_end"][0]
CONDUCT_WARNING_LINE = LINES["conduct_warning"][0]
# The return clock (decided 2026-10-18; live integrity spec §7). The web counts the same numbers down for the candidate (awayEpisode.ts).
AWAY_FINAL_S = 5.0           # still away this long from the START of the episode (any kind): the final warning (owner 2026-10-21; it was 4 s after the first warning)
AWAY_LIMIT_SCREEN_S = AWAY_FINAL_S   # the web's limit for leaving only full screen or the share: the same 5 s
AWAY_CAP_S = 7.0             # still away this long from the start of the episode: the interview ends (owner 2026-10-21: 7 s at most)
# While they are away the interview is paused (owner 2026-10-20; live round f677a7f5 moved on to the coding problem with nobody at the screen):
# only these orders are spoken, every other one is held and released when they come back.
AWAY_SPEAKABLE = frozenset({"mention_violation", "final_warning", "end"})
AWAY_LINE_WORDS_PER_S = 2.5  # how long a warning takes to say, when the voice never reports that it finished
AWAY_OVERSTAY_LINES: dict[str, str] = {k: LINES[f"away_overstay:{k}"][0] for k in ("mention_violation", "final_warning")}
WARNING_KINDS = frozenset({"mention_violation", "final_warning", "conduct_warning"})


def is_violation_line(text: str) -> bool:
    """The text is one of the fixed screen warnings, as the history keeps it (a mention, a final warning or a return warning), in any of their wordings."""
    return matches_any(text, SCREEN_WARNING_KEYS)


def _ask_words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]{4,}", (text or "").lower()))


def last_question(text: str) -> str | None:
    """The question a turn ends on (its last sentence), or None when the turn does not end in one."""
    sentences = [x for x in re.split(r"(?<=[.?!])\s+", (text or "").strip()) if x]
    return sentences[-1] if sentences and sentences[-1].rstrip("\"')\u201d ").endswith("?") else None


def ask_intent(text: str, probes: list[str]) -> str:
    """What a plan ask is after: the introduction, or one of the resume probes ("probe-0"); empty for any other question."""
    if asks_for_introduction(text):
        return "intro"
    return next((f"probe-{n}" for n, probe in enumerate(probes) if matches_probe(text, [probe])), "")


def asks_again(ask: str, text: str, last_ask: str, intent: str, last_intent: str) -> bool:
    """Whether a question on the same part asks again what the previous one asked. Precision over recall: a false re-ask cuts a part
    short. It does when most of its words are shared (0.6); when it says it is going back ("I still need...", "let me ask it plainly")
    and shares at least a fifth of its words with the previous question ("Coming back to the problem, what is the complexity?" after
    a different question is not going back to it); or when it is the same plan ask (the introduction, one resume probe) in
    other words, together with a pull-back or 0.35 of the words shared: three natural follow-ups about one project all touch its probe."""
    mine, theirs = _ask_words(ask), _ask_words(last_ask)
    ratio = len(mine & theirs) / min(len(mine), len(theirs)) if min(len(mine), len(theirs)) >= 2 else 0.0
    backs = pulls_back(text)
    return ((min(len(mine), len(theirs)) >= 3 and ratio >= ASK_OVERLAP)
            or (backs and ratio >= PULL_BACK_OVERLAP)
            or (bool(intent) and intent == last_intent and (backs or ratio >= SAME_INTENT_OVERLAP)))


# A deferral that trails the question inside its own clause ("How did you deploy Relay, before we get to Java?"): it is not asked.
_TRAILING_DEFERRAL = re.compile(r"(?<=[\w\"')])(?:\s*,?\s*(?:and\s+)?(?:then|before|after|once)\s+(?:we|we'll|i|i'll|let's|moving|getting|going)\b|\s*,?\s*and\s+(?:we'll|then)\b).*$",
                                re.IGNORECASE | re.DOTALL)
# The one lead-in that may name what the question is about: a short "On Java now:", "In Java,", "For databases,", "Switching to Java:". It must open
# with one of these words and carry nothing that defers, lists, skips or looks ahead.
_TOPIC_LEAD = re.compile(r"^(?:(?:okay|ok|alright|right|so|now|and)\b[\s,]*)?(?:on|in|for|with|about|regarding|onto|over to|switching to|moving to|turning to|shifting to)\b",
                         re.IGNORECASE)
_NOT_A_TOPIC_LEAD = re.compile(
    r"\b(?:later|wait|park|come back|coming|before|after|then|next|first|until|left|and|also|skip\w*|leav\w*|past|beyond|hold|aside|soon|shortly|will|going to|"
    r"gonna|about to|not|instead|except|without|rather|no longer|for now|moment|minute|bit|once|finish\w*|done|covered|enough)\b|n't|'ll", re.IGNORECASE)
# What a clause between a sentence-initial lead and the asking clause says when it DEFERS the led area ("On Java now: I'll come back to that later -
# for now, how big was your team?"); ordinary recap words (and, not, first, also, then, after, done) are not deferrals (owner-approved 2026-10-18).
_DEFERS = re.compile(
    r"\b(?:later|come back|coming back|get (?:back )?to (?:that|it|this)|park|hold (?:off|that|this|it)|skip\w*|for now|not yet|won't go (?:there|into)|will not go (?:there|into)|"
    r"can wait|could wait|leave (?:that|it|this) (?:for|aside|until)|table (?:that|it|this)|revisit\w*|another time|in a bit|before we (?:get|go|move) (?:to|into)|"
    r"after (?:this|that) one)\b", re.IGNORECASE)
MAX_TOPIC_LEAD_WORDS = 6
# The words of a promise label that name nothing by themselves ("API design" is the API; "the design side" is not): a lead-in that names the rest matches the label.
_GENERIC_LABEL_WORDS = frozenset({"design", "questions", "question", "fundamentals", "fundamental", "basics", "concepts", "principles", "side", "part", "area", "topic"})


def names_label(name: str, text: str) -> bool:
    """Whether `text` names the promise label `name` ("API design"): the label itself, or all of its distinctive words ("On the API side now:"; decided
    2026-10-18: a label that is no `_AREAS` entry was only ever matched as a whole phrase, so the deep dive re-asked it)."""
    if mentions(name, text):
        return True
    words = [w for w in re.findall(r"[a-z0-9]+", name.lower())]
    distinct = [w for w in words if w not in _GENERIC_LABEL_WORDS] or words
    have = set(re.findall(r"[a-z0-9]+", (text or "").lower()))
    return bool(distinct) and all(w in have for w in distinct)
# A check or a clarification is not the question an order asked ("Does that make sense?", "Any questions?", "Shall we go on?"): a turn that took an order
# to ask about a promise covers it only by a real question (decided 2026-10-18; final review I1).
_CLARIFICATION = re.compile(
    r"^\W*(?:(?:and|so|okay|ok|right|alright|now)\b[\s,]*)*(?:does (?:that|this|it) (?:make sense|sound|work|help)|(?:is|was) (?:that|this|it) (?:clear|okay|ok|fine|right|better)|"
    r"(?:are|were) you (?:with me|following|okay|ok|comfortable|ready)|(?:do|did) you (?:follow|understand|see)|(?:any|got any|do you have any|have any) (?:other |more )?questions|"
    r"(?:shall|should|can|could|may) (?:we|i)\b|ready\b|make sense\b|sounds? (?:good|okay|ok|right|fair)\b|fair enough|(?:fine|okay|ok|right|clear|got it|yes)\W*$)", re.IGNORECASE)


def asked_question(text: str, projects: Sequence[str] = (), name: str = "") -> str:
    """What a turn asks, for the promises ledger (decided 2026-10-18): its last sentence that asks or invites the candidate to answer, cut to the
    final clause that actually asks (after the last colon, dash, semicolon, ", so" or the comma before the question word) and without a deferral
    trailing it ("..., before we get to Java?"). Nothing else counts: no sentence before it, no list, no cue. The one exception is a short topic
    lead-in right before the final break ("On Java now: ...", "In Java, ..."): it counts when it opens with on/in/for/with/about/switching to/
    moving to, is at most 6 words, names exactly one part (a project of `projects`, a fundamentals area, or `name`) and carries nothing that defers,
    lists, skips or looks ahead. A missed cover is corrected (the area is ordered by name); a false one silently breaks the promise."""
    asks = [x for x in re.split(r"(?<=[.?!])\s+", (text or "").strip()) if addresses_the_candidate(x)]
    if not asks:
        return ""
    sentence = asks[-1]
    cuts = list(_ASK_BREAK.finditer(sentence))
    clause = _TRAILING_DEFERRAL.sub("", sentence[cuts[-1].end():] if cuts else sentence).strip()
    if not cuts or not clause:
        return clause
    # The lead-in right before the last break, or the sentence's own first clause when more breaks follow ("On the API side now: at Zoho you built X
    # - how did you make it idempotent?"; decided 2026-10-18): each under the same checks.
    # The sentence's own first clause counts only when what lies between it and the asking clause defers nothing ("On Java now: I'll come back to that
    # later - for now, how big was your team?" covers no Java; decided 2026-10-18, owner-approved).
    leads = [(sentence[cuts[-2].end() if len(cuts) > 1 else 0:cuts[-1].start()].strip(), "")]
    if len(cuts) > 1:
        leads.append((sentence[:cuts[0].start()].strip(), sentence[cuts[0].end():cuts[-1].start()]))
    for lead, between in leads:
        if not lead or len(lead.split()) > MAX_TOPIC_LEAD_WORDS or not _TOPIC_LEAD.search(lead) or _NOT_A_TOPIC_LEAD.search(lead) or _DEFERS.search(between):
            continue
        scrubbed = lead
        for project in sorted((p for p in projects if p), key=len, reverse=True):
            scrubbed = re.sub(rf"(?<!\w){re.escape(project)}(?!\w)", " ", scrubbed, flags=re.IGNORECASE)
        areas = outline_areas(scrubbed)
        parts = areas | {f"project:{p}" for p in projects if mentions(p, lead)} | ({name} if name and name not in areas and names_label(name, scrubbed) else set())
        if len(parts) == 1:
            return f"{lead} {clause}"
    return clause


def promise_covered(text: str, promise: str, pool: list[str], projects: list[str]) -> bool:
    """Whether an interviewer turn asks about a promise (decided 2026-10-18). A fundamentals area by its patterns or label, or a project by its
    name, in the clause the turn asks (`asked_question`); or either by one of its pool questions asked in other words in that clause.
    What the candidate answered never matters. A promised project's own name never counts toward an area ("your React Dashboard project"
    asks about no React area), and neither does what the turn says about the candidate."""
    kind, _, name = promise.partition(":")
    asked = asked_question(text, projects, name)
    if not name or not asked:
        return False
    if any(asks_planned(asked, p) or asks_planned_stems(asked, p) for p in pool) or matches_probe(asked, pool):
        return True
    if kind == "projects":
        return mentions(name, asked)
    scrubbed = _ABOUT_THEM.sub(" ", asked)
    for project in sorted((p for p in projects if p), key=len, reverse=True):
        scrubbed = re.sub(rf"(?<!\w){re.escape(project)}(?!\w)", " ", scrubbed, flags=re.IGNORECASE)
    return name in outline_areas(scrubbed) or names_label(name, scrubbed)


@dataclass
class Order:
    kind: OrderKind
    text: str
    at: float
    end_reason: str | None = None
    speak: bool = True
    consumed: bool = False
    line: str | None = None      # a fixed sentence for the candidate: an ending's (said by the run if the talker never gets to), a give-up's, a swap's, a violation's
    about: str = ""              # what a warning is about: the proctor kind, "still_away" or "conduct" (for the interviewer's memory of what it warned)
    ask_for: str = ""            # the promise this order tells the interviewer to ask about: the turn that takes it and asks a question covers it
    bridge: str | None = None    # an open_item that puts a problem up: the one sentence that moves to it, said by the run just before the put-up line
    opens_aloud: str = ""        # an open_item that asks a question aloud (nothing goes on the screen): the item it opens, counted as opened once the turn is spoken


@dataclass
class Rules:
    converge_at: float = 0.8
    grace_seconds: float = 60.0
    silence_talking_s: float = 20.0
    silence_coding_s: float = 120.0
    ceiling_factor: float = 1.5
    filler_max_s: int = 240
    proctor_final_warning_at: int = 2
    proctor_end_at: int = 3
    conduct_end_at: int = 2
    off_topic_redirects: int = 3
    director_every_turns: int = 3
    # A part whose time ran out ends without the director only this much later: max(flex_min_s, flex_factor x its time).
    flex_min_s: float = 120.0
    flex_factor: float = 0.25


# Directed abuse ends the round at once (decided 2026-10-17): one firm line, no warning first. A live round warned and then ended on the same
# remark, 7 s apart. Milder conduct warns first and ends at the second incident.
ABUSE_END_LINE = LINES["abuse_end"][0]
IMMEDIATE_CONDUCT = frozenset({"abusive", "director:end"})     # a talker flag of abuse, a director concern of "end"
CONDUCT_REASON = re.compile(r"\b(?:conduct|misconduct|abus\w*|profan\w*|swear\w*|insult\w*|rude\w*|inappropriate|disrespect\w*|offensive|hostile|behaviou?r)\b", re.IGNORECASE)
SILENCE_NOT_CONDUCT_S = 20.0     # silence this long since their last words is never misconduct

# A conduct flag whose quote is about the candidate leaving the interview screen: the proctor rules own that.
def _remark_key(quote: str) -> str:
    """A quoted remark reduced to its words, so the same words flagged again match however they are punctuated."""
    return " ".join(re.findall(r"[a-z0-9']+", (quote or "").lower()))


_SCREEN_LEAVE = re.compile(r"\b(?:tab|tabs|window|windows|app|apps|screen|switch(?:ed|es|ing)?|proctor|tab_hidden|window_blur)\b", re.IGNORECASE)


REACT_FIRST = ("First react to what they just said in one short sentence of your own, a natural reaction to its content, never a bare \"okay then\" or "
               "\"alright\", no praise and never a summary of their words. ")


class Conductor:
    def __init__(self, blueprint: dict[str, Any], round_seconds: int, rules: Rules | None = None,
                 clock: Callable[[], float] = time.time, skills: tuple[str, ...] | list[str] = ()) -> None:
        self.blueprint = blueprint
        self.rules = rules or Rules()
        self.round_rules: dict[str, Any] = rules_of(blueprint)         # the round pack's flags and words (stored on the blueprint when it was prepared)
        self.round_type = str((blueprint.get("round") or {}).get("type") or "dsa")
        self.opened_aloud: set[str] = set()                            # questions asked aloud (no screen): opened once the open_item turn was spoken
        self.clock = clock
        self.round_seconds = round_seconds
        self.skills = {s.strip().lower() for s in skills if s and s.strip()}
        self.items: list[Item] = build_items(blueprint)
        self.reserves: dict[str, dict[str, Any]] = {s["slot_id"]: s for s in reserve_slots(blueprint)}
        self.index = 0
        self.position = 0
        self.position_items: dict[int, str] = {}   # position -> the item that was current then: a late brief is matched to its part
        self.granted_s = 0.0                       # time the director has added to the round (every accepted extend)
        self.started_at: float | None = None
        self.orders: list[Order] = []
        # The wordings of the lines the run says in fixed words (lines.py): random, none twice in a round until its pool is used up. Checkpointed.
        self.lines = picker_for(blueprint)
        self._put_up_told: dict[int, str] = {}      # the put-up wording an order gave the interviewer for problem N: the view and the run's own line say the same one
        self.proctor: list[dict[str, Any]] = []
        self.full_violations = 0
        self.pastes: list[dict[str, Any]] = []
        self.conduct: list[dict[str, Any]] = []
        self.conduct_notes: list[dict[str, Any]] = []   # findings kept as records only (not counted, not spoken)
        self.conduct_turns: set[str] = set()
        self.candidate_turns = 0                 # how many times the candidate has spoken: one conduct incident per remark at most
        self.hold_until = 0.0                    # the candidate asked for a moment: nothing but the hold breakers is said until then
        self.extensions: dict[str, float] = {}  # item_id -> extra seconds the director gave it
        self.threads_opened = 0                    # side topics the interviewer has opened this round (at most MAX_THREADS)
        self.flow_log: list[dict[str, Any]] = []   # every flow move the interviewer attempted, accepted or refused (not `dropped`, which is orders)
        self.dropped: list[dict[str, Any]] = []  # orders cancelled or set aside, and why: shown to the director, kept in the record
        self.move_on_not_before: dict[str, float] = {}   # item_id -> a move_on was set aside: the fallback waits until then
        self.redirects: dict[str, int] = {}
        self.labels: dict[str, str] = {}
        self.follow_ups: dict[str, list[str]] = {}
        self.deep_dive_asked: set[int] = set()    # which of the deep dive's planned questions the interviewer has asked (by position in the plan)
        # What the outline promised the candidate, kept as obligations: promise -> "open" | "covered" | "dropped" (a dropped one was skipped for time,
        # with a spoken notice). Empty for a blueprint without a realism block.
        self.promises: dict[str, str] = {p: "open" for p in promises_of(blueprint)}
        # The deep dive takes the promised areas one at a time, in outline order (decided 2026-10-18; live round 781a1f0a, turns 41-54: Relay, React, Relay,
        # React). Questions counted on the focus area, and the areas that are finished (asked FOCUS_QUESTIONS times, or the candidate had no answer).
        self.promise_asks: dict[str, int] = {}
        self.promise_done: set[str] = set()
        self.by_order: set[str] = set()      # promises covered because an order (or a refused move) told the interviewer to ask about them, whatever the wording
        self._seen = 0                       # interviewer turns offered to `mark_covered`
        self._directed, self._directed_from = "", 0
        self.plan_changes: list[dict[str, Any]] = []
        self.last_activity = 0.0
        self.nudged_at = 0.0
        self.last_candidate_at = float("-inf")   # when the candidate last finished speaking
        self.nudges_in_a_row = 0                 # silence check-ins since they last spoke: each waits twice as long as the one before
        self.candidate_speaking = False
        self.agent_speaking = False
        self._ask_log: list[dict[str, Any]] = []   # the asks counted since the last reset (turn, part, question), so an unplayed one can be taken back
        self.ask_streak = 0       # consecutive interviewer questions on one part that asked the same thing
        self.last_ask = ""        # the interviewer's last question while it stays unanswered (the part and tool moves clear it)
        self.ask_item = ""        # the part that question was asked in
        self.ask_intent = ""      # what that question was after, when it is one of the plan's own asks: "intro" or "probe-N"
        self.reply_owed = False   # the candidate spoke and the interviewer has not answered yet (set by the run)
        self.agent_spoke_at = float("-inf")
        self.signals: dict[str, str] = {}     # the director's latest read of each problem: strong / adequate / struggling
        self.no_more_problems = False         # a later problem was skipped (the candidate struggled, or the round is out of time)
        self.outline_said = False             # the interviewer has already told them how the round will run (not repeated at the framing)
        self.format_confirm_asked = False     # ...and asked whether that sounds okay: once per round, ever (decided 2026-10-18)
        self.code_text = ""                   # the editor's text as of the last snapshot (shared by every problem: it is never cleared)
        # How many times the candidate asked for a different problem, per problem; `refusals` counts the asks that were resisted (decided 2026-10-18).
        self.change_requests: dict[str, int] = {}
        self.refusals: dict[str, int] = {}
        self.changes_round = 0                # changes of problem given this round (at most CHANGE_CAP)
        self.gave_up_items: set[str] = set()  # problems the candidate was let go of by a change or by the coding ending
        self.explained: set[str] = set()      # problems whose explanation went on the screen (a second ask asks what is unclear)
        self.refusal_points: set[str] = set() # the points the round's refusals already made (closing.refusal_points): never made again
        self.refusal_sentences: list[str] = []  # the sentences those refusals spoke (last 12): a new one close to them in words is blocked too
        # Every warning the interviewer has said in the round, for its own state and the director's: {kind, about, turn, at}.
        self.warnings_given: list[dict[str, Any]] = []
        # The current away episode (live integrity spec §7): when it began, what is away, whether the tab or window was ever left, when the return
        # clock started (the warning for it finished playing) and whether it already cost its one extra violation.
        self.away: dict[str, Any] | None = None
        self.fired: dict[str, set[str]] = {}
        self.turns_since_director = 0
        self.triggers: set[str] = set()
        self.ended = False
        self.end_reason: str | None = None

    # ------------------------------------------------------------ the round's language (round packs)

    def is_culture(self, item: Item) -> bool:
        """A behavioural part of a technical round (a culture slot): it runs as a behavioural question, whatever the round is."""
        return item.kind == "slot" and bool(item.slot_id) and is_culture_slot(item.slot_id or "") and family(self.round_type) != "behavioural"

    def words_for(self, item: Item | None = None) -> dict[str, Any]:
        """The nouns an order uses for this item: the round's, or the behavioural ones for a culture slot."""
        if item is not None and self.is_culture(item):
            return _BEHAVIOURAL_WORDS
        return self.round_rules.get("words") or _DSA_WORDS

    def workspace_for(self, item: Item | None = None) -> str:
        """The workspace this item gives the candidate: the round's (editor, board, editor+board, none); a culture slot has none."""
        return "none" if item is not None and self.is_culture(item) else str(self._flags().get("workspace") or "editor")

    def _pack_id(self) -> str:
        return str(self.round_rules.get("pack") or "dsa")

    def _flags(self) -> dict[str, Any]:
        return self.round_rules.get("flags") or asdict(pack_for("dsa").flags)

    def _gates(self) -> bool:
        """Later problems depend on how the earlier one went (DSA only); every other pack gives each planned question and adds none. A block stored
        before the flag existed defaults from its pack."""
        flags = self._flags()
        return bool(flags["gate_second"]) if "gate_second" in flags else bool(pack_for(self._pack_id()).flags.gate_second)

    def policy_for(self, item: Item) -> str:
        """What a request for a different problem gets on this item: the round's policy, a culture slot's own."""
        return "on_no_example" if self.is_culture(item) else str(self._flags().get("change_policy") or "decide")

    def is_change_ask(self, text: str) -> bool:
        """The candidate asks for a different question: the usual ask, or on a question with the on_no_example policy (behavioural, hiring manager,
        a culture slot) that they have no example or want another one."""
        return asks_to_change_problem(text) or (self.policy_for(self.current()) == "on_no_example" and asks_for_other_example(text))

    def asks_the_item(self, order: Order, spoken: str) -> bool:
        """A turn's words ask the question an aloud open_item order is for (its `ask.opening`, matched by word stems)."""
        item = next((i for i in self.items if i.item_id == order.opens_aloud), None)
        opening = str(((slot_by_id(self.blueprint, item.slot_id if item else None) or {}).get("ask") or {}).get("opening") or "")
        return bool(opening) and asks_planned_stems(spoken, opening)

    def hints_for(self, item: Item) -> str:
        return "narrow" if self.is_culture(item) else str(self._flags().get("hints") or "ladder")

    def _codes(self, item: Item | None = None) -> bool:
        """Candidates write code in this item (the round has the code check, and it is not a culture slot)."""
        return bool(self._flags().get("requires_code")) and not (item is not None and self.is_culture(item))

    def _noun(self, item: Item | None = None) -> str:
        """What a problem of this item is called in an order: "coding problem" for a coding round, else the pack's word."""
        return "coding problem" if self._codes(item) and self.words_for(item)["problem"] == "problem" else str(self.words_for(item)["problem"])

    def _part_name(self, item: Item | None = None) -> str:
        """The round's main part by name: "the coding part", "the design part"."""
        if item is not None and self.is_culture(item):
            return "the question"            # a culture slot in a technical round is one question, not a part
        part = str(self.words_for(item)["the_part"])
        return part if part.endswith("part") else part + " part"

    def _part_done(self, item: Item | None = None) -> str:
        words = self.words_for(item)
        if item is not None and self.is_culture(item):
            return "That wraps up that question."
        return CODING_DONE if words["the_part"] == "the coding" else f"That wraps up {words['the_part']}."

    def is_opened_aloud(self, item: Item) -> bool:
        return item.item_id in self.opened_aloud

    def _asks_aloud(self, item: Item) -> str:
        """How a question that is not put on the screen is opened: aloud, in the interviewer's own words, from the slot's opening."""
        opening = str(((slot_by_id(self.blueprint, item.slot_id) or {}).get("ask") or {}).get("opening") or "").strip()
        start = f" starting from this: \"{opening}\"" if opening else ""
        return f"ask it aloud, in your own words{start}. Ask only that one question, then stop."

    # ------------------------------------------------------------ position

    def current(self) -> Item:
        return self.items[self.index]

    def start(self) -> None:
        now = self.clock()
        self.started_at = now
        self.last_activity = now
        self._activate(0, now)

    def planned_seconds(self) -> float:
        return self.round_seconds + self.granted_s

    def style_of(self, item: Item) -> str:
        """The style an item is opened and described with. An introduction reached after a finished problem is always an
        after-the-coding one, whatever its arc style: the 'before the coding' link would be wrong by then."""
        if item.kind == "phase" and item.phase == "candidate_intro" and any(i.kind == "slot" and i.status == "done" for i in self.items):
            return "after_coding"
        return item.style

    def resumes_parent(self) -> bool:
        """Whether the part that comes next is the one the open thread paused (so it is picked up, not opened)."""
        cur = self.current()
        nxt = self.peek_next()
        return cur.kind == "thread" and cur.parent is not None and nxt is not None and nxt.item_id == cur.parent

    def pick_up_text(self, parent: Item) -> str:
        """What to do when a thread is over and the part it paused comes back: continue it, never reopen it."""
        about = PHASE_ABOUT.get(parent.phase, parent.phase)
        return (f"go back to {about} and pick up where you left off: no new opening question, and no repeat of what they already told you.")

    def _owed_seconds(self, i: Item) -> float:
        """What a pending must-cover part still needs: its whole box, or for a paused one what is left of it."""
        if i.started_at is not None:
            return max(0.0, i.max_seconds - (self.clock() - i.started_at))
        if i.bonus:
            return 0.0                  # a bonus problem is not reserved: the round's minutes do not hold it (it is sized to the time left when it starts)
        return float(i.max_seconds)

    def reserved_seconds(self) -> float:
        """Minutes the must-cover parts still to come need: a paused part only what is left of its box."""
        return sum(self._owed_seconds(i) for i in self.items if i.status == "pending" and i.must)

    def _held_back_seconds(self, include_slots: bool) -> float:
        """Time the plan after the current part still needs. Every pending must-cover part counts wherever it sits (one jumped past
        is behind the index but still owed); optional parts only when they are ahead."""
        total = 0.0
        for n, i in enumerate(self.items):
            if i.status != "pending" or n == self.index or (i.kind == "slot" and not include_slots):
                continue
            if i.must:
                total += self._owed_seconds(i)
            elif n > self.index:
                total += i.max_seconds
        return total

    def free_seconds(self) -> float:
        """The planned time left once every must-cover part still to come has its minutes: what the conversation may spend freely."""
        elapsed = 0.0 if self.started_at is None else self.clock() - self.started_at
        return self.planned_seconds() - elapsed - self.reserved_seconds()

    def note_flow_move(self) -> None:
        """A move that activates no item (a step of the conversation) still makes the director's earlier briefs late."""
        self.position += 1
        self.position_items[self.position] = self.current().item_id
        self.triggers.add("flow")

    def problem_number(self, index: int | None = None) -> int:
        """1 for the first problem the candidate is given, 2 for the second: problems swapped out or skipped never counted. A problem
        still planned counts too, so the ones ahead of the current part are numbered one after another, never all the same."""
        at = self.index if index is None else index
        return 1 + sum(1 for i in self.items[:at] if i.kind == "slot" and i.status in ("done", "active", "pending"))

    def public_id(self, item: Item) -> str:
        """The id the talker sees: a problem is only `problem-N` (its slot id carries the difficulty and the plan's internals), any
        other part keeps its id."""
        if item.kind != "slot":
            return item.item_id
        index = next((n for n, i in enumerate(self.items) if i is item), self.index)
        return f"problem-{self.problem_number(index)}"

    def resolve(self, target: str | None) -> str | None:
        """The item id behind a target the talker named: `problem-N` is the slot numbered N among those still pending or active;
        anything else passes through."""
        for i in self.items:
            if i.kind == "slot" and i.status in ("pending", "active") and self.public_id(i) == target:
                return i.item_id
        return target

    def _activate(self, index: int, now: float, open_text: str | None = None, resume: bool = False) -> None:
        """Make an item current. `resume` is a part picked up again after its thread: it keeps its clock and is not opened anew."""
        previous = self.items[self.index] if 0 <= self.index < len(self.items) else None
        self.index = index
        item = self.items[index]
        for o in self.orders:
            if not o.consumed and o.kind in ("move_on", "converge", "nudge"):
                o.consumed = True              # a timer order of the part just left never carries over into the next one
        if item.kind == "slot" and any(i.kind == "slot" and i.status == "done" for i in self.items[:index]):
            # A later problem gets the time that is really left, not more than its box.
            now_s = now - (self.started_at or now)
            left = self.planned_seconds() - now_s - sum(i.max_seconds for i in self.items[index + 1:] if i.status == "pending" and i.kind != "slot")
            item.max_seconds = int(min(item.max_seconds, max(180.0, left)))
        item.status = "active"
        if not resume:
            item.started_at = now
            if item.kind == "slot":
                item.code_base = self.code_text
        self.position += 1
        self.position_items[self.position] = item.item_id
        self.nudged_at = now
        self.triggers.add("item")
        if item.phase == "wrap_up":
            # A skip notice still owed is said once, in the closing's own order, and never as an order of its own after it.
            owed = [o for o in self.orders if o.kind == "skip_notice" and not o.consumed]
            for o in owed:
                o.consumed = True
                self.fired.setdefault("_round", set()).add(f"notice-folded:{o.about}")      # said in the closing: never folded a second time
            gone = [p for o in owed for p in o.about.split("|") if p]
            fold = self._notice_fold(gone) if gone else ""
            self._order("closing", REACT_FIRST + "Then say your closing, warmly and briefly, and thank them. The interview ends when you have "
                                   "said it: no further questions." + fold, now)
        elif item.origin == "promise" and not resume:
            self._order("open_item", f"You promised to come back to {item.title}: pick it up now in a sentence or two, then ask one question "
                                     "about it.", now)
        elif resume or item.kind == "thread":
            pass                                   # a thread was opened by the talker in its own words; a resumed part was already opened
        elif self.position > 1:
            # The talker is not always exact about opening a new part in the turn that moves to it. This order makes sure it
            # is opened: at once if the last turn was a bare transition, and consumed when that turn already opened it.
            if open_text is not None:
                self._order("open_item", open_text, now)
            elif item.kind == "slot":
                outline = ""
                words = self.words_for(item)
                if self.problem_number(index) == 1 and item.style == "with_outline" and not self.outline_said:      # (not again once it was given)
                    outline = f"Before the {words['problem']}, {with_outline_text(self.blueprint)} "
                number = self.problem_number(index)
                if not words["on_screen"]:
                    # A question asked aloud (decided 2026-10-20): nothing goes on the screen and no put-up line is said; the item is opened once the turn is spoken.
                    order = self._order("open_item", f"{outline}You have moved on to the next {words['problem']}. {REACT_FIRST}Then {self._asks_aloud(item)}", now)
                    order.opens_aloud = item.item_id
                else:
                    self._put_up_told[number] = problem_put_up(number, self.lines, pack_id=self._pack_id())
                    bridge = self.lines.pick(pack_key("bridge:first" if number == 1 else "bridge:next", self._pack_id()))
                    order = self._order("open_item", f"{outline}You have moved on to the next {self._noun(item)}. {REACT_FIRST}Then call show_problem, then say only this and nothing more about the {words['problem']}: "
                                                     f"\"{self._put_up_told[number]}\" The sentence that moves on to it comes before that line and is said for you: never "
                                                     "say a connecting phrase of your own. Stop there: the line that invites them to read it is said for "
                                                     "you once the screen has changed, so never say it yourself. If you just said you would talk "
                                                     f"about something else, say you have a {words['problem']} for them first.", now)
                    order.bridge = bridge
            elif item.phase == "framing" and self.outline_said:
                # The framing already happened (and they agreed): its exchange is had, so the introduction this order asks for can
                # move the plan on. A live round asked for it while next_item was refused ("0 of 1 exchanges").
                item.turns = max(item.turns, MIN_TURNS.get("framing", 0))
                upcoming = self.peek_next()
                ask = ("Start with a short transition (answer a question about the format first, if they asked one), then ask for a short "
                       "introduction of their background; if their reply already began it, do not ask for it again: follow up on what they said."
                       if upcoming is not None and upcoming.phase == "candidate_intro" else
                       "React briefly to what they just said and call next_item to go on.")
                self._order("open_item", f"You have moved on, and you already told them how the round will run: do not repeat it. {REACT_FIRST}{ask}", now)
            elif (hint := opening_hint(self.blueprint, item.phase, self.style_of(item))) is not None:
                bridge = bridge_for(item.phase, self.style_of(item), self.blueprint)
                after_coding = previous is not None and previous.kind == "slot"
                done = (f"First say plainly, in a sentence of its own, that {self._part_name(previous)} is done (for example \"{self._part_done(previous)}\"). " if after_coding else "")
                link = (f"Then a short connecting phrase that links this to what came just before (something like \"{bridge}\"), "
                        "then continue: " if bridge else "")
                if item.phase == "deep_dive" and any(deep_dive_questions(self.blueprint.get("personalization") or {})):
                    done = link = ""                # its own opening says the coding is done, what comes next and asks the first question
                self._order("open_item", f"You have moved on to {item.phase}: open it now. {REACT_FIRST}{done}{link}{hint[0].upper() + hint[1:] if not link and not done else hint} "
                                         "Ask ONE question only. If your last turn already said a connecting phrase or reacted to their last answer, "
                                         "do not say either again: go straight to the content.", now)

    def _find(self, item_id: str) -> int | None:
        return next((i for i, it in enumerate(self.items) if it.item_id == item_id), None)

    def _named(self, item_id: str | None) -> str:
        """How a refusal names a part the talker pointed at: by its public id, never the internal one."""
        idx = None if item_id is None else self._find(item_id)
        return item_id or "" if idx is None else self.public_id(self.items[idx])

    def label_for(self, item_id: str) -> str:
        if item_id not in self.labels:
            # A swapped position keeps one label for the problem and its replacement, so they count once.
            self.labels[item_id] = f"Problem {len(set(self.labels.values())) + 1}"
        return self.labels[item_id]

    def record_hint(self, step: int) -> int:
        item = self.current()
        item.hint_step = max(item.hint_step, int(step))
        return item.hint_step

    def next_item(self, reason: str) -> Item | None:
        now = self.clock()
        cur = self.current()
        if cur.kind == "slot" and self.will_skip_next_problem():
            # Struggled on this one (or out of time): the next problems are not given and the round heads for its end.
            for later in self.items[self.index + 1:]:
                if later.kind == "slot" and later.status == "pending":
                    later.status = "skipped"
            self.no_more_problems = True
        if cur.status == "active":
            cur.status, cur.ended_at, cur.ended_by = "done", now, reason
        idx = self._next_index()
        if idx is not None:
            # The part a thread paused is picked up where it was left, not opened again.
            resume = cur.kind == "thread" and cur.parent is not None and self.items[idx].item_id == cur.parent
            self._activate(idx, now, resume=resume)
            return self.items[idx]
        self._end("completed", "The interview is complete.", now, speak=False)
        return None

    def _next_index(self) -> int | None:
        """The part that comes next: a thread's paused parent; else the next pending part, except that the candidate's questions and the
        wrap-up wait for any part left behind (a must-cover part a jump went past)."""
        cur = self.current()
        if cur.phase == "wrap_up":
            return None                                # nothing comes after the closing, whatever was left behind
        if cur.kind == "thread" and cur.parent is not None:
            parent = self._find(cur.parent)
            if parent is not None and self.items[parent].status == "pending":
                return parent
        after = [i for i in range(self.index + 1, len(self.items)) if self.items[i].status == "pending"]
        before = [i for i in range(self.index) if self.items[i].status == "pending"]
        closing = ("candidate_questions", "wrap_up")
        if after and self.items[after[0]].phase not in closing:
            return after[0]
        behind = next((i for i in after + before if self.items[i].phase not in closing), None)
        if behind is not None:
            return behind
        return after[0] if after else None

    def peek_next(self) -> Item | None:
        idx = self._next_index()
        return None if idx is None else self.items[idx]

    def opens_coding_problem(self, target: Item | None) -> bool:
        """Leaving now would open `target`, a coding problem put up on screen (not one that next_item skips: a struggling candidate's later problems)."""
        if target is None or target.kind != "slot" or not self.words_for(target)["on_screen"]:
            return False
        if self.current().kind == "slot":
            return False                       # leaving a problem is governed by next_item's own "still asking" rule
        return not (self.current().kind == "slot" and target is self.peek_next() and self.will_skip_next_problem())

    def goal_map(self) -> list[dict[str, Any]]:
        """What is still to cover, in plan order, for the talker. A pending problem is only "coding problem N": never its name,
        topic or difficulty. A paused part (one a thread interrupted) is flagged so it can be picked up again."""
        goals = []
        for index, i in enumerate(self.items):
            if i.status != "pending":
                continue
            if i.kind == "slot":
                about = f"{self._noun(i)} {self.problem_number(index)}"
            elif i.kind == "filler":
                about = f"a question on {(i.filler or {}).get('skill', '')}"
            elif i.kind == "thread":
                about = f"come back to: {i.title}" if i.origin == "promise" else i.title
            else:
                about = PHASE_ABOUT.get(i.phase, i.phase)
                promised = [f[len(PROMISED_PREFIX):] for f in self.follow_ups.get(i.item_id, []) if f.startswith(PROMISED_PREFIX)]
                if promised:
                    about += f" (come back to: {'; '.join(promised)})"
            goals.append({"id": self.public_id(i), "internal_id": i.item_id, "kind": i.kind, "must": i.must, "about": about, "paused": i.started_at is not None})
        return goals

    # ------------------------------------------------------------ flow moves (the interviewer chooses the path)

    def _log_flow(self, move: str, target: str | None, why: str, result: tuple[bool, str]) -> tuple[bool, str]:
        self.flow_log = [*self.flow_log, {"move": move, "target": target, "why": why[:200], "ok": result[0], "error": result[1],
                                          "at": self.clock()}][-MAX_FLOW_LOG:]
        self.triggers.add("flow")
        return result

    def go_to(self, target: str | None, why: str) -> tuple[bool, str]:
        """Leave the current part for `target` (or the next one when None). A must-cover part jumped past stays pending and comes
        back before the candidate's questions; optional parts passed over are skipped."""
        return self._log_flow("go_to", target, why, self._move(self.resolve(target), why))

    def close_thread(self, why: str, target: str | None = None) -> tuple[bool, str]:
        if self.current().kind != "thread":
            return self._log_flow("close_thread", target, why, (False, "no thread is open"))
        return self._log_flow("close_thread", target, why, self._move(self.resolve(target), why))

    def _move(self, target: str | None, why: str) -> tuple[bool, str]:
        if self.ended:
            return False, "the interview is already over"
        cur = self.current()
        if cur.kind == "slot":
            return False, "finish this problem first: call next_item when it is done"
        if target is None:
            ok, error = self.can_advance()
            if not ok:
                return False, self._promise_refusal(directed=True) if self.promises_hold(cur) else error
            self.next_item(f"interviewer: {why}")
            return True, ""
        idx = self._find(target)
        if idx is None or idx == self.index or self.items[idx].status != "pending":
            return False, f"{self._named(target)} is not a part still to come"
        now = self.clock()
        if self.promises_hold(cur):
            return False, self._promise_refusal(directed=True)
        if cur.must and cur.turns < self._min_turns(cur) and not (cur.max_seconds > 0 and now - (cur.started_at or now) >= cur.max_seconds):
            return False, self._exchanges_message(cur)
        dest = self.items[idx]
        # A thread closed to anywhere but its own parent leaves the parent too: it must not wait paused and come back (with a fresh
        # opening) after the part the thread went to. Its minimum exchanges still count, like those of any part being left.
        left_behind = None
        if cur.kind == "thread" and cur.parent is not None and dest.item_id != cur.parent:
            left_behind = next((i for i in self.items if i.item_id == cur.parent and i.status == "pending"), None)
        if left_behind is not None and self.promises_hold(left_behind):
            return False, self._promise_refusal(directed=True)
        if left_behind is not None and left_behind.must and left_behind.turns < self._min_turns(left_behind) \
                and not (left_behind.max_seconds > 0 and now - (left_behind.started_at or now) >= left_behind.max_seconds):
            return False, self._exchanges_message(left_behind)
        if dest.kind == "slot":
            first = next((i for i in self.items if i.kind == "slot" and i.status == "pending"), None)
            if first is not dest or not self.problem_allowed():
                return False, f"the {self._noun(dest)} is not next yet: finish the conversation before it first"
        if dest.phase in ("candidate_questions", "wrap_up"):
            blocking = [self.public_id(i) for i in self.items if i.status == "pending" and i.must and i is not dest and i is not left_behind
                        and not (dest.phase == "candidate_questions" and i.phase == "wrap_up")]
            if blocking:
                return False, f"first: {', '.join(blocking)}"
        if not dest.must and self.free_seconds() < 60:
            return False, "less than a minute is free"
        if cur.status == "active":
            cur.status, cur.ended_at, cur.ended_by = "done", now, f"interviewer: {why}"
        if left_behind is not None:
            left_behind.status, left_behind.ended_at, left_behind.ended_by = "done", now, f"interviewer: {why}"
        for it in self.items[self.index + 1:idx]:
            if it.status == "pending" and not it.must:
                it.status, it.ended_at, it.ended_by = "skipped", now, "passed over"
        # Naming the paused parent when closing its thread is a resume, not a fresh opening.
        self._activate(idx, now, resume=cur.kind == "thread" and cur.parent == dest.item_id)
        return True, ""

    def skip_goal(self, target: str, why: str) -> tuple[bool, str]:
        """Drop an optional part still to come (the candidate has covered it, or it no longer fits)."""
        return self._log_flow("skip_goal", target, why, self._skip(self.resolve(target), why))

    def _skip(self, target: str, why: str) -> tuple[bool, str]:
        idx = self._find(target)
        if self.ended or idx is None or idx == self.index or self.items[idx].status != "pending":
            return False, f"{self._named(target)} is not a part still to come"
        item = self.items[idx]
        if item.kind == "slot":
            return False, "problems are not skipped"
        if item.must:
            return False, f"{self._named(target)} must be covered: it cannot be skipped"
        item.status, item.ended_at, item.ended_by = "skipped", self.clock(), f"interviewer: {why}"
        self.note_flow_move()
        return True, ""

    def open_thread(self, title: str, why: str, minutes: int | None = None) -> tuple[bool, str]:
        """Follow something the candidate raised that the plan has no part for: a short side topic that pauses the current part,
        which resumes when the thread closes."""
        return self._log_flow("open_thread", title[:120], why, self._open_thread(title, why, minutes))

    def _open_thread(self, title: str, why: str, minutes: int | None) -> tuple[bool, str]:
        if self.ended:
            return False, "the interview is already over"
        cur = self.current()
        if cur.kind == "slot":
            return False, "not while a problem is up"
        if cur.kind == "thread":
            return False, "a thread is already open: close it first"
        if any(o.kind in ("move_on", "wrap_up_now") and not o.consumed for o in self.orders):
            return False, "time is up for this part: move on first"
        if self.threads_opened >= MAX_THREADS:
            return False, f"at most {MAX_THREADS} threads in a round"
        free = self.free_seconds()
        if free < 60:
            return False, "less than a minute is free"
        mins = max(1, min(THREAD_MAX_MIN, int(minutes or THREAD_DEFAULT_MIN)))
        seconds = min(mins * 60, int(free) // 60 * 60)
        self.threads_opened += 1
        cur.status = "pending"                     # paused: it keeps its clock and its exchanges
        thread = Item(f"thread-{self.threads_opened}", "thread", "thread", seconds, origin="thread", why=why[:200],
                      title=title[:120], parent=cur.item_id)
        self.items.insert(self.index + 1, thread)
        self._activate(self.index + 1, self.clock())
        return True, ""

    def defer_topic(self, title: str, why: str) -> tuple[bool, str]:
        result = self._defer_topic(title, why)
        return self._log_flow("defer_topic", "deep_dive" if result[1] == ATTACHED else title[:120], why, result)

    def _defer_topic(self, title: str, why: str) -> tuple[bool, str]:
        """A promise to come back to something the candidate raised, made where no thread may open (a problem is up): the plan holds
        a short part for it, right before their questions (after the coding and any deep dive)."""
        if self.ended:
            return False, "the interview is already over"
        key = " ".join(re.findall(r"[a-z0-9]+", title.lower()))
        kept = [i.title for i in self.items if i.origin == "promise"] + [f[len(PROMISED_PREFIX):] for f in sum(self.follow_ups.values(), [])
                                                                          if f.startswith(PROMISED_PREFIX)]
        if key and any(key == " ".join(re.findall(r"[a-z0-9]+", k.lower())) for k in kept):
            return True, "already kept for later"
        if any(i.item_id == "deep_dive" and i.status == "pending" for i in self.items):
            # The projects discussion is still to come: the promise is kept there, as a follow-up, not as a part of its own.
            self.follow_ups.setdefault("deep_dive", []).append(f"{PROMISED_PREFIX}{title[:120]}")
            return True, ATTACHED
        if sum(1 for i in self.items if i.origin == "promise") >= MAX_DEFERRED:
            return False, f"at most {MAX_DEFERRED} topics are kept for later in a round"
        if self.free_seconds() < 60:
            return False, "less than a minute is free"
        at = next((n for n, i in enumerate(self.items) if n > self.index and i.phase in ("candidate_questions", "wrap_up")), None)
        if at is None:
            return False, "the round has no part left to put it before"
        n = 1 + sum(1 for i in self.items if i.origin == "promise")
        self.items.insert(at, Item(f"deferred-{n}", "thread", "thread", DEFERRED_S, origin="promise", why=why[:200], title=title[:120], must=False))
        return True, ""

    # ------------------------------------------------------------ the outline's promises

    def uncovered(self) -> list[str]:
        """The promises still open, in the outline's order."""
        return [p for p, state in self.promises.items() if state == "open"]

    def covers(self, text: str, promises: list[str]) -> list[str]:
        """Which of `promises` an interviewer turn asks about (pure: no phase gate, no state change)."""
        personal = self.blueprint.get("personalization") or {}
        projects = promised(self.blueprint, "projects")
        return [p for p in promises if promise_covered(text, p, [str(q["prompt"]) for q in promise_questions(personal, p)], projects)]

    def _in_deep_dive(self) -> bool:
        cur = self.current()
        return (cur.kind == "phase" and cur.phase == "deep_dive") or (cur.kind == "thread" and cur.parent == "deep_dive")

    def mark_covered(self, text: str, orders: Sequence[Order] = ()) -> list[str]:
        """An interviewer turn was said: the open promises it asks about are covered, whatever the candidate answers (an "I don't know" leaves
        the area covered and it is not asked again). Only in the deep dive (or a thread under it): the opening of the round, the introduction
        and the coding turns name languages and projects without asking about them. `orders` are the ones this turn took: a turn that took an
        order to ask about a promise and asks a question covers it whatever its wording (one directed question per promise, so it can never loop);
        the same for the first question after a refused move. Returns the promises this turn covered."""
        self._seen += 1
        if not self._in_deep_dive():
            self._directed = ""         # a direction given in the deep dive does not outlive it: the opener of a later deep dive covers nothing by order
        if self.ended or gives_outline(text) or not self._in_deep_dive():
            return []
        done = self.covers(text, self.uncovered()) if self.uncovered() else []
        directed: list[str] = []
        ask = asked_question(text)
        if ask and not _CLARIFICATION.search(ask):
            directed = [o.ask_for for o in orders if o.ask_for]
            if self._directed and self._seen >= self._directed_from:
                directed.append(self._directed)
                self._directed = ""
        # A question on the focus area counts toward its two; a question on a later area still fills the ledger below but never moves the focus.
        focus = self.focus_promise()
        if focus is not None and (focus in directed or self.covers(text, [focus])):
            self.promise_asks[focus] = self.promise_asks.get(focus, 0) + 1
            if self.promise_asks[focus] >= FOCUS_QUESTIONS:
                self.promise_done.add(focus)
        for p in directed:
            if self.promises.get(p) == "open" and p not in done:
                done.append(p)
                self.by_order.add(p)
        for p in done:
            self.promises[p] = "covered"
        if self._directed in done:
            self._directed = ""
        return done

    def focus_promise(self) -> str | None:
        """The one promised area the deep dive is on: the first, in outline order, that is not done (None without promises, or when all are done).
        An area dropped for time is done: it was skipped with a notice and is never come back to (final review, live round 781a1f0a)."""
        return next((p for p in promises_of(self.blueprint) if p not in self.promise_done and self.promises.get(p) != "dropped"), None)

    def note_answer(self, text: str) -> None:
        """The candidate answered: "I don't know" to a question on the focus area ends that area, so it is not pressed (live round 781a1f0a,
        turns 41-54). Only after at least one question was counted on it."""
        focus = self.focus_promise()
        if focus is not None and self._in_deep_dive() and self.promise_asks.get(focus, 0) >= 1 and says_dont_know(text):
            self.promise_done.add(focus)

    def still_covers(self, heard: str, promise: str) -> bool:
        """After a cut-off: the part they heard still counts for `promise` (by its words, or a question was heard where an order directed it)."""
        return bool(self.covers(heard, [promise])) or (promise in self.by_order and bool(asked_question(heard)))

    def reopen(self, promises: list[str]) -> None:
        """A turn that covered these was never played, or was cut off before it asked: they are open again."""
        for p in promises:
            if self.promises.get(p) == "covered":
                self.promises[p] = "open"

    def _promise_names(self, promises: list[str]) -> str:
        words = [promise_words(p) for p in promises]
        return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]

    def promises_hold(self, item: Item | None = None) -> bool:
        """The deep dive may not be left: a promise is still open and the round has the time for it (the same refusal as `may_leave_problem`,
        for every path that leaves the part)."""
        cur = item or self.current()
        return cur.kind == "phase" and cur.phase == "deep_dive" and bool(self.uncovered()) and not self.ended \
            and self.free_seconds() >= PROMISE_FREE_S and not any(o.kind == "wrap_up_now" for o in self.pending_orders())

    def promises_owed(self) -> bool:
        """A promise is open, the deep dive that keeps it has not been left, and the round has time for it: nothing that would skip the deep
        dive (a director's wrap-up from any part) is allowed. A candidate-caused end (conduct, proctor, End) never asks this."""
        return bool(self.uncovered()) and not self.ended and self.free_seconds() >= PROMISE_FREE_S \
            and any(i.item_id == "deep_dive" and i.status in ("pending", "active") for i in self.items)

    def _promise_refusal(self, directed: bool = False) -> str:
        """Why the part is not left yet. `directed` is a real refusal of a move (not the live state's preview): the interviewer is then told, in
        so many words, to ask about the first open promise, so the first question it asks after this turn covers it, whatever its wording."""
        focus = self.focus_promise()
        # One area at a time: the focus, not a later one, while it is open or has had a question (a ledger entry set any other way names the first open one).
        first = focus if focus in self.promises and (self.promises[focus] == "open" or self.promise_asks.get(focus, 0)) else self.uncovered()[0]
        if directed and self._in_deep_dive():       # a refusal made anywhere else (a director's wrap-up from the coding) directs nothing (decided 2026-10-18)
            self._directed, self._directed_from = first, self._seen + 2        # not this turn's own words: the turn after the refusal
        words = promise_words(first)
        if self.promises.get(first) != "open":       # the focus has had its first question and is owed another
            return f"you are still on {words}: ask your next question about it before you move on"
        return (f"you told them you would cover {self._promise_names(self.uncovered())} and no question about {words} is counted as asked yet: "
                f"before you move on, ask one question whose own words name {words}, different from any question already asked in this part")

    def drop_with_notice(self, promises: list[str]) -> Order:
        """The round is out of time for these promises: they are dropped, and the interviewer says so in one short sentence that names them
        (never a number or a length of time). A skip notice is never set aside, and it is ordered again when its turn was never played or did
        not say it (`notice_said`)."""
        now = self.clock()
        gone = [p for p in promises if self.promises.get(p) == "open"]
        for p in gone:
            self.promises[p] = "dropped"
        return self._skip_notice(gone, now)

    def _skip_notice(self, gone: list[str], now: float) -> Order:
        order = self._order("skip_notice", (
            f"The round is short on time and you have not covered {self._promise_names(gone)}. Say one short sentence that names what you are "
            "skipping, with no number and no length of time (for example \"We're short on time, so I'll skip the React questions.\"), before "
            "anything else you say, and carry on with the rest of what you are asked to do."), now)
        order.about = "|".join(gone)
        return order

    def notice_said(self, order: Order, text: str) -> bool:
        """Whether a turn's words carry the skip notice: short on time, and one of the skipped areas or projects named."""
        if not SKIP_NOTICE.search(text or ""):
            return False
        for p in order.about.split("|"):
            name = p.partition(":")[2]
            if name and (mentions(name, text) or name in outline_areas(text)):
                return True
        return False

    def _notice_fold(self, gone: list[str]) -> str:
        return (f" Before you close, say one short sentence that you are short on time and so are skipping {self._promise_names(gone)} "
                "(no number, no length of time).")

    def renew_notice(self, order: Order) -> bool:
        """A skip notice its turn did not say: ordered again, up to NOTICE_TRIES times. False when it has been tried enough."""
        if self.ended:
            return False
        if self.current().phase == "wrap_up":
            # The turn that carried the notice also moved the plan into the wrap-up (it was consumed there and never said): it is folded into the
            # closing's own order, once, if that has not been said yet. Never a pending order of its own into the closing.
            closing = next((o for o in self.orders if o.kind == "closing" and not o.consumed), None)
            fired = self.fired.setdefault("_round", set())
            key = f"notice-folded:{order.about}"
            if closing is None or key in fired:
                return False
            fired.add(key)
            closing.text += self._notice_fold([p for p in order.about.split("|") if p])
            return True
        key = f"notice:{order.about}"
        fired = self.fired.setdefault("_round", set())
        tries = sum(1 for k in fired if k.startswith(key))
        if tries >= NOTICE_TRIES:
            return False
        fired.add(f"{key}:{tries}")
        order.consumed = False
        return True

    def _promise_tick(self, item: Item, now: float) -> list[Order]:
        """The deep dive's clock for its promises: out of free time they are dropped with a notice (once the candidate has had their exchanges here,
        so the part is not dropped before it opened); past the part's own time with room left, the next open one is pushed, once each."""
        open_ = self.uncovered()
        if not open_ or item.kind != "phase" or item.phase != "deep_dive":
            return []
        focus = self.focus_promise()
        if focus in open_:
            open_ = [focus] + [p for p in open_ if p != focus]          # the push names the area the deep dive is on
        fired = self.fired.setdefault(item.item_id, set())
        elapsed = now - (item.started_at or now)
        time_up = item.max_seconds > 0 and elapsed >= item.max_seconds
        if self.free_seconds() < PROMISE_FREE_S and item.turns >= 1 and (time_up or item.turns >= self._min_turns(item)):
            if "promise_drop" in fired:
                return []
            fired.add("promise_drop")
            notice = self.drop_with_notice(open_)
            return [notice, self.move_on_order(item, now)]          # the notice is the interviewer's words; the move is the part's own end
        if time_up and self.promises_hold(item) and f"promise:{open_[0]}" not in fired:
            fired.add(f"promise:{open_[0]}")
            order = self._order("open_item", f"This part's planned time is nearly spent, but you told them you would cover "
                                             f"{promise_words(open_[0])} and it is not yet counted as asked. Ask one question now whose own words name it, "
                                             "different from any question already asked in this part, and do not wrap up or move on until you have.", now)
            order.ask_for = open_[0]
            return [order]
        return []

    # ------------------------------------------------------------ orders

    def _order(self, kind: OrderKind, text: str, now: float) -> Order:
        order = Order(kind, text, now)
        self.orders.append(order)
        return order

    def _end(self, reason: str, text: str, now: float, speak: bool = True, line: str | None = None) -> Order:
        if self.ended and self.end_order is not None:
            return self.end_order
        self.ended = True
        self.end_reason = reason
        for o in self.orders:
            if o.kind == "skip_notice":
                o.consumed = True                          # an ending says goodbye: a skip notice never follows it
        order = Order("end", text, now, end_reason=reason, speak=speak, line=line)
        self.orders.append(order)
        return order

    @property
    def end_order(self) -> Order | None:
        return next((o for o in self.orders if o.kind == "end"), None)

    def pending_orders(self) -> list[Order]:
        return [o for o in self.orders if not o.consumed]

    def consume(self, orders: list[Order]) -> None:
        for order in orders:
            order.consumed = True
            if order.opens_aloud:
                self.opened_aloud.add(order.opens_aloud)      # a question asked aloud is opened once its turn was spoken (the equivalent of a shown problem)

    def take_triggers(self) -> set[str]:
        triggers, self.triggers = self.triggers, set()
        return triggers

    # ------------------------------------------------------------ events

    def on_candidate_turn(self, keeps_hold: bool = False, text: str = "") -> list[Order]:
        """They spoke. Returns the orders that went stale with it (a check-in on their silence; "take your time" they talked past)."""
        stale = [o for o in self.pending_orders() if o.kind == "nudge" or (o.kind == "hold" and not keeps_hold)]
        now = self.clock()
        for o in stale:
            o.consumed = True
            self._record_dropped(o.kind, "they spoke", "auto", now)
        self.current().turns += 1
        self.candidate_turns += 1
        self.note_answer(text)
        if not keeps_hold:
            self.hold_until = 0.0                # they spoke: the moment they asked for is over ("Hello?" alone is not that)
        self.last_activity = self.clock()
        self.last_candidate_at = self.last_activity
        self.nudges_in_a_row = 0
        self.turns_since_director += 1
        if self.turns_since_director >= self.rules.director_every_turns:
            self.turns_since_director = 0
            self.triggers.add("turns")
        return stale

    def reset_asks(self) -> None:
        """A tool move (or a new part) is progress: the count of repeated questions starts again."""
        self.ask_streak, self.last_ask, self.ask_item, self.ask_intent = 0, "", "", ""
        self._ask_log = []

    def note_interviewer_line(self, text: str, turn: int | None = None) -> None:
        """What the interviewer just said. A question that asks again what an earlier one on the same part asked is a repeat, even
        with candidate replies in between: an off-topic candidate answered each ask without answering it, and a live round asked for
        the format confirmation three times (see `asks_again`). The third ask orders that question dropped (only that question: the part and
        the problem stay). Only asks the candidate heard count: `forget_ask` takes back one whose turn was never played (live round 3e574171,
        where two played asks and three unplayed ones made three)."""
        if self.current().phase == "deep_dive":
            self.deep_dive_asked |= {n for n, prompt in enumerate(self._planned_deep_dive()) if asks_planned(text, prompt)}
        ask = last_question(text)
        if ask is None:
            return
        item_id = self.current().item_id
        probes = [str(p.get("prompt") or "") for p in (self.blueprint.get("personalization") or {}).get("resume_probes") or []]
        entry = {"turn": turn, "item": item_id, "ask": ask, "text": text, "intent": ask_intent(text, probes)}
        self._ask_log = [*getattr(self, "_ask_log", []), entry][-12:]
        self._count_ask(entry)
        self._maybe_drop_question()

    def _count_ask(self, e: dict[str, Any]) -> None:
        again = e["item"] == self.ask_item and asks_again(e["ask"], e["text"], self.last_ask, e["intent"], self.ask_intent)
        self.ask_streak = self.ask_streak + 1 if again else 1
        self.last_ask, self.ask_item, self.ask_intent = e["ask"], e["item"], e["intent"]

    def _maybe_drop_question(self) -> None:
        if self.ask_streak >= 3 and not any(o.kind == "drop_question" for o in self.pending_orders()):
            self._order("drop_question", DROP_QUESTION_ORDER, self.clock())

    def forget_ask(self, turn: int) -> None:
        """The candidate never heard this turn (never played, or cut off before its question): its ask does not count. The streak is
        counted again from the asks that were heard, and a drop_question order the count no longer supports is withdrawn."""
        log = [e for e in getattr(self, "_ask_log", [])]
        if not any(e["turn"] == turn for e in log):
            return
        self._ask_log = [e for e in log if e["turn"] != turn]
        self.ask_streak, self.last_ask, self.ask_item, self.ask_intent = 0, "", "", ""
        for e in self._ask_log:
            self._count_ask(e)
        if self.ask_streak < 3:
            for o in self.pending_orders():
                if o.kind == "drop_question":
                    o.consumed = True

    def set_aside(self, orders: list[Order], why: str) -> list[Order]:
        """The talker did not act on these, because what the candidate just said covers them or makes them wrong. Only
        SET_ASIDE_ORDERS can be; the rest are returned untouched. A move_on set aside leaves the part where it is and wakes the
        director to decide again from the new answer; the late fallback waits SET_ASIDE_RETRY_S before it may fire again."""
        now = self.clock()
        cur = self.current()
        taken = [o for o in orders if o.kind in SET_ASIDE_ORDERS and not o.line]
        for o in taken:
            o.consumed = True
            self._record_dropped(o.kind, why, "interviewer", now)
            if o.kind == "move_on":
                self.fired.setdefault(cur.item_id, set()).discard("move_on")
                self.move_on_not_before[cur.item_id] = now + SET_ASIDE_RETRY_S
                self.triggers.add("set_aside")
        return taken

    def drop_stale_conduct(self, now: float, max_age_s: float = STALE_CONDUCT_S) -> list[Order]:
        """A conduct warning still pending long after the remark it was about is no longer about what they just said: dropped and logged."""
        stale = [o for o in self.pending_orders() if o.kind == "conduct_warning" and now - o.at > max_age_s]
        for o in stale:
            o.consumed = True
            self._record_dropped(o.kind, f"stale: pending {now - o.at:.0f} s", "conductor", now)
        return stale

    def note_conduct(self, kind: str, quote: str, source: str, why: str) -> None:
        """A finding kept as a record only (severity note): never spoken and never counted toward ending the round."""
        self.conduct_notes = [*self.conduct_notes, {"kind": kind, "quote": (quote or "")[:300], "source": source, "why": why, "severity": "note",
                                                    "at": self.clock()}][-20:]

    def _record_dropped(self, kind: str, why: str, by: str, now: float) -> None:
        self.dropped = [*self.dropped, {"kind": kind, "why": why, "by": by, "item_id": self.current().item_id, "at": now}][-MAX_DROPPED:]

    def set_candidate_speaking(self, speaking: bool) -> None:
        self.candidate_speaking = speaking
        if not speaking:
            self.last_activity = self.clock()

    def set_agent_speaking(self, speaking: bool) -> None:
        self.agent_speaking = speaking
        if not speaking:
            self.last_activity = self.agent_spoke_at = self.clock()

    def quiet_for_s(self) -> float:
        """Seconds since the interviewer last stopped speaking."""
        return self.clock() - self.agent_spoke_at

    def urgent_pending(self) -> bool:
        return any(o.kind in URGENT_ORDERS for o in self.pending_orders())

    def hold(self, seconds: float = HOLD_S) -> Order:
        """The candidate asked for a moment: the interviewer says they can take it and then waits. Until they speak again (or the
        hold runs out) nothing else is said: no opening of the next part, no check-in, no explaining how the round will run."""
        now = self.clock()
        self.hold_until = now + seconds
        self.nudged_at = now                     # the silence check-in counts from the end of their moment, not from before it
        self.triggers.add("hold")
        return self._order("hold", "The candidate asked for a moment. Say in one short sentence that they can take it, and stop: "
                                   "no question, nothing about what comes next, no explaining the round, and do not call next_item.", now)

    def held(self) -> bool:
        return self.clock() < self.hold_until

    def speakable_orders(self) -> list[Order]:
        """The pending orders the talker may act on now: during a hold only the hold breakers; the rest wait."""
        pending = self.pending_orders()
        if self.away_paused():
            return [o for o in pending if o.kind in AWAY_SPEAKABLE]       # the interview is paused: only the away warnings and the ending
        return [o for o in pending if o.kind in HOLD_BREAKERS] if self.held() else pending

    def away_paused(self) -> bool:
        """The candidate is away from the screen: nothing moves the interview on until they are back (the plan, the timers, the director)."""
        return self.away is not None and not self.ended

    def can_advance(self) -> tuple[bool, str]:
        """Whether the talker may leave the current item now, and if not, why (told to the talker in the live state)."""
        if self.ended:
            return False, "the interview is already over"
        item = self.current()
        if self.promises_hold(item):
            return False, self._promise_refusal()                 # the outline's promises come before the part's own time: only the round running out frees it
        elapsed = self.clock() - (item.started_at or self.clock())
        if item.max_seconds > 0 and elapsed >= item.max_seconds:
            return True, ""                                       # the plan's time is up: the plan comes first
        if item.kind == "phase" and self._before_coding(self.index):
            ahead = next((i for i in self.items[self.index + 1:] if i.status == "pending"), None)
            if ahead is None or ahead.kind == "slot":              # leaving the conversation for the coding
                total, need = self._exchanges_before_coding(), min_exchanges_before_coding(self.blueprint)
                if total < need:
                    return False, (f"the conversation before {self.words_for()['the_part']} has had {total} of {need} exchanges: "
                                   "ask about their background and follow up on what they say first")
        need = self._min_turns(item) if item.kind == "phase" and item.must else 0
        if item.turns < need:
            return False, self._exchanges_message(item)
        return True, ""

    def _planned_deep_dive(self) -> list[str]:
        return [q["prompt"] for _, q in deep_dive_questions(self.blueprint.get("personalization") or {})]

    def _min_turns(self, item: Item) -> int:
        """Exchanges a part needs before the interviewer may leave it. A deep dive whose planned questions have all been asked needs
        only as many exchanges as it has questions (two planned, two asked and answered: done), so it never invents a third to fill
        the minimum; one with a planned question still unasked keeps the full minimum."""
        need = MIN_TURNS.get(item.phase, 0)
        if item.phase == "deep_dive" and self.promises and self.focus_promise() is None:
            return 0            # every promised area has had its questions (or its "I don't know"): nothing is left to wait for
        planned = self._planned_deep_dive() if item.phase == "deep_dive" else []
        if planned and len(self.deep_dive_asked) >= len(planned):
            return min(need, len(planned))
        return need

    def _exchanges_message(self, item: Item) -> str:
        need = self._min_turns(item)
        more = need - item.turns
        return (f"you are in {item.phase} and the candidate has had {item.turns} of {need} exchanges: "
                f"ask {more} more real question{'s' if more > 1 else ''} first (follow up on what they say)")

    def problem_allowed(self) -> bool:
        """Whether a problem may be shown or announced now: a problem is current, or the conversation before the coding has had
        its exchanges (or the current part's time is up) and a problem is still ahead."""
        cur = self.current()
        if self.ended:
            return False
        if cur.kind == "slot":
            return True
        if not any(i.kind == "slot" and i.status == "pending" for i in self.items[self.index + 1:]):
            return False
        if not self._before_coding(self.index):
            return False
        # A part's time being up only opens the problem when no other part of the conversation is still ahead: a framing that
        # ran long moves on to the introduction, and promising the problem then would be a promise nothing can keep.
        first = self._first_slot_index()
        conversation_ahead = any(i.kind != "slot" and i.status == "pending" for i in self.items[self.index + 1:first])
        part_time_up = cur.max_seconds > 0 and self.clock() - (cur.started_at or self.clock()) >= cur.max_seconds and not conversation_ahead
        # Or the whole conversation has used its time (a plan item that lags far behind the talker never keeps the problem off the screen).
        conversation = [i for i in self.items[:first] if i.kind != "slot"]
        began = min((i.started_at for i in conversation if i.started_at is not None), default=None)
        budget_up = began is not None and self.clock() - began >= sum(i.max_seconds for i in conversation)
        return self._exchanges_before_coding() >= min_exchanges_before_coding(self.blueprint) or part_time_up or budget_up

    def _first_slot_index(self) -> int:
        return next((n for n, i in enumerate(self.items) if i.kind == "slot"), len(self.items))

    def _before_coding(self, index: int) -> bool:
        """Whether the item at `index` is part of the conversation before the coding: not a problem, and ahead of the first problem
        of any status (so a filler between problems never counts)."""
        return self.items[index].kind != "slot" and index < self._first_slot_index()

    def _exchanges_before_coding(self) -> int:
        """Candidate exchanges had in the parts that come before the first problem."""
        return sum(i.turns for i in self.items[:self._first_slot_index()] if i.kind != "slot")

    def performance(self, item: Item) -> str:
        """`struggled` or `strong` for a problem. The director's read decides when it has one; two ladder hints or running out of the
        problem's time (with the director not calling it strong) also count as struggling."""
        signal = self.signals.get(item.item_id)
        if item.kind == "slot" and not self.gave_up(item) and not self.had_think_time(item):
            return "strong"          # too early to call a struggle: reading, thinking aloud and silence are not one
        if not self._gates():
            return "struggled" if signal == "struggling" else "strong"          # a used timebox or a narrowing ask is no struggle outside the DSA gating
        if signal == "struggling" or (item.hint_step >= STRUGGLED_HINT_STEPS and self.hints_for(item) == "ladder"):
            return "struggled"
        out_of_time = item.max_seconds > 0 and self.clock() - (item.started_at or self.clock()) >= item.max_seconds
        if out_of_time and signal != "strong":
            return "struggled"
        return "strong"

    def think_floor_s(self, item: Item) -> float:
        """The least time a candidate gets on a problem before it can read as a struggle."""
        return min(max(MIN_THINK_S, MIN_THINK_FRACTION * item.max_seconds), float(item.max_seconds))

    def had_think_time(self, item: Item) -> bool:
        return self.clock() - (item.started_at or self.clock()) >= self.think_floor_s(item)

    def _time_for_next_problem(self) -> float:
        """What is left of the round for a next problem, once everything else still planned after the current part has its time."""
        now = self.clock()
        left = self.planned_seconds() - (now - (self.started_at or now))
        return left - self._held_back_seconds(include_slots=False)

    def will_skip_next_problem(self) -> bool:
        """Leaving the current problem now would skip the next one: the candidate struggled on this one, or there is no time for it."""
        cur = self.current()
        if cur.kind != "slot" or self.ended or not self._gates():
            return False
        if not any(i.kind == "slot" and i.status == "pending" for i in self.items[self.index + 1:]):
            return False
        if self.gave_up(cur):
            # Their change (the round's one) takes the next problem while the round has time for it; a change that ends the coding has skipped them.
            return self._time_for_next_problem() < MIN_SECOND_PROBLEM_S
        return self.performance(cur) == "struggled" or self._time_for_next_problem() < MIN_SECOND_PROBLEM_S

    @property
    def change_given(self) -> bool:
        """The round's one change of problem has been given."""
        return self.changes_round >= CHANGE_CAP

    def gave_up(self, item: Item) -> bool:
        """They asked for a different problem and the interviewer let this one go (a change, or the coding part ending): it is over, and counts as a
        struggle in the report. A resisted ask, however many, does not."""
        return item.item_id in self.gave_up_items

    def may_leave_problem(self, item: Item) -> tuple[bool, str]:
        """Whether the plan may leave this item now, for every path that does (the tool, a declared move on, a promise, the words).
        A problem nobody has spoken a word on, whose time is not up, is not left: the talker's "let's get into it" said as it goes up
        reads as leaving it (rh13_wanders_off). A coding problem nobody has written code for is not left either (the persona rehearsals
        ended one unattempted). A give-up, the problem's own time being up and a pending wrap-up let it go; a pending timer move_on lets
        go of a problem nobody spoke on, and the director's read of a struggle of one nobody coded."""
        if item.kind != "slot" or self.gave_up(item):
            return True, ""
        elapsed = self.clock() - (item.started_at or self.clock())
        pending = {o.kind for o in self.pending_orders()}
        if elapsed >= item.max_seconds or "wrap_up_now" in pending:
            return True, ""
        if item.turns == 0 and "move_on" not in pending:
            if not self.words_for(item)["on_screen"]:
                return False, f"the {self.words_for(item)['problem']} has just been asked: give them time to answer it; do not move on"
            return False, f"the {self.words_for(item)['problem']} has just gone up: give them time to read it and start; do not move on"
        if self._is_coding_problem(item) and not item.coded and self.performance(item) != "struggled":
            return False, f"they have not written any code for this {self.words_for(item)['problem']} yet: ask them to write it before moving on"
        return True, ""

    def _is_coding_problem(self, item: Item) -> bool:
        return self._codes(item)

    def slack_s(self) -> float:
        """Round time left once everything still planned after the current item has had its time."""
        now = self.clock()
        left = self.planned_seconds() - (now - (self.started_at or now))
        return left - self._held_back_seconds(include_slots=True)

    def would_extend(self) -> bool:
        """Whether leaving the current problem now would add another one: it is the last planned problem, a reserve is
        left, and the round has the time."""
        cur = self.current()
        given = sum(1 for i in self.items if i.kind == "slot" and i.status in ("done", "active"))
        return (self._gates() and not self.ended and not self.no_more_problems and cur.kind == "slot" and bool(self.reserves) and given < STANDARD_PROBLEMS
                and self.performance(cur) == "strong"
                and not any(i.kind == "slot" and i.status == "pending" for i in self.items[self.index + 1:])
                and self.slack_s() >= EXTRA_PROBLEM_MIN_SLACK_S)

    def plan_extra_problem(self) -> Item | None:
        """Add a reserve problem right after the current one when the round has time to spare: the harder one if the
        candidate solved this quickly, otherwise another of the same kind."""
        if not self.would_extend():
            return None
        cur = self.current()
        slack = self.slack_s()
        # The harder reserve only for a quick solve with plenty of round left: a hard problem in a few minutes is not an interview.
        quick = (self.clock() - (cur.started_at or self.clock())) < 0.6 * cur.max_seconds and slack >= HARDER_PROBLEM_MIN_SLACK_S
        pick = next((sid for sid in self.reserves if ("harder" in sid) == quick), None) or next(iter(self.reserves))
        slot = self.reserves.pop(pick)
        seconds = max(EXTRA_PROBLEM_MIN_S, int(min(int(slot["timebox_mins"]) * 60, slack - 60)))
        item = Item(slot["slot_id"], "slot", "core", seconds, slot_id=slot["slot_id"], origin="reserve")
        self.items.insert(self.index + 1, item)
        self.plan_changes.append({"op": "extra_problem", "target": slot["slot_id"], "at": self.clock(), "position": self.position})
        return item

    def ask_follow_up(self, held_back_problem: bool = False) -> Order:
        held = (f" The {self._noun()} is not next yet: you were not allowed to put it up, so do not mention it or {self._part_name()}."
                if held_back_problem else "")
        focus = self.focus_promise() if self._in_deep_dive() else None
        stay = f" Stay on {promise_words(focus)}." if focus else ""       # (live round 781a1f0a, turns 41-54)
        return self._order("open_item", "Your last turn did not ask the candidate anything. Ask them a real follow-up question now, about "
                                        "what they just said (do not announce what comes next)." + held + stay, self.clock())

    def resay(self, text: str) -> Order:
        """The voice never played the interviewer's last turn (live round 781a1f0a, turn 9: a question was cut before any audio and the
        candidate answered "Yeah" into a silence): its point is said again, shorter, without owning up to the lost audio."""
        self.drop_resay()      # a resay reply that was itself never played un-consumed the first: only the newest wording stays pending
        return self._order("resay", "Your last turn never reached the candidate: the audio did not play. Say its point again now, shorter and in "
                                    f"your own words: \"{text}\". Do not say you missed, lost or did not catch anything.", self.clock())

    def drop_resay(self) -> None:
        """The candidate carried on with something of their own: a turn they never heard is no longer owed."""
        self.consume([o for o in self.pending_orders() if o.kind == "resay"])

    def _swap_reserve(self) -> str | None:
        """The reserve a candidate's request or give-up brings in: the alternate, else any that is not the harder one. The harder reserve is the
        director's extension for a candidate who is flying; it is never what a candidate who asked for an easier problem is handed (a live
        round ended on it after two swaps in a row)."""
        return next((k for k in self.reserves if "alternate" in k), None) or next((k for k in self.reserves if "harder" not in k), None)

    def _swap_reserve(self) -> str | None:
        """The reserve a candidate's change brings in: the alternate, else any that is not the harder one. The harder reserve is the director's
        extension for a candidate who is flying; it is never what a candidate who asked for an easier problem is handed (a live round
        ended on it after two swaps in a row)."""
        return next((k for k in self.reserves if "alternate" in k), None) or next((k for k in self.reserves if "harder" not in k), None)

    def _change_possible(self) -> bool:
        """The round's one change may be given now: none given yet, a problem to give (the next planned one, else a non-harder reserve) and the
        round has the time for it."""
        cur = self.current()
        ahead = any(i.kind == "slot" and i.status == "pending" for i in self.items[self.index + 1:])
        return (self.changes_round < CHANGE_CAP and cur.kind == "slot" and not self.ended and (ahead or self._swap_reserve() is not None)
                and self._time_for_next_problem() >= MIN_SECOND_PROBLEM_S)

    def change_stance(self) -> tuple[str, int]:
        """The persona's stance on a request for another problem: (firmness, refusals before it gives in). A blueprint without a realism block is
        ("normal", 1): the first ask is resisted and the second acts, as before it existed."""
        stance = (realism_of(self.blueprint) or {}).get("change")
        if isinstance(stance, dict) and isinstance(stance.get("refusals_prior"), int):
            return str(stance.get("firmness") or "normal"), int(stance["refusals_prior"])
        return "normal", 1

    def has_change_stance(self) -> bool:
        """The blueprint carries a persona stance (a realism block); without one the old rule applies and the model is not asked."""
        stance = (realism_of(self.blueprint) or {}).get("change")
        return isinstance(stance, dict) and isinstance(stance.get("refusals_prior"), int)

    def refusals_round(self) -> int:
        """Asks resisted so far in the round, on every problem."""
        return sum(self.refusals.values())

    def minutes_left(self) -> float:
        now = self.clock()
        return max(0.0, self.planned_seconds() - (now - (self.started_at or now))) / 60

    def allowed_change_actions(self) -> frozenset[str]:
        """What a request for another problem may get now, every hard limit applied (the model and the persona's prior choose only among these):
        resist always; change only after the round's first refusal, below CHANGE_CAP, with a problem to give (never the harder reserve) and
        MIN_SECOND_PROBLEM_S left; end_coding only after a refusal on the current problem. Nothing once the coding has ended. After
        REFUSAL_CEILING refusals on the current problem resist is dropped too, when anything else is allowed (decided 2026-10-18 after live round
        781a1f0a): the next ask gets the change or the end of the coding, never a fourth refusal."""
        cur = self.current()
        if cur.kind != "slot" or self.ended or self.no_more_problems:
            return frozenset()
        policy = self.policy_for(cur)
        if policy == "never":
            # A round that never changes its question (design, an online assessment): resist, and once the refusals are used up end the part.
            return frozenset({"end_coding"} if self.refusals.get(cur.item_id, 0) >= REFUSAL_CEILING else {"resist"})
        if policy == "decline":
            return frozenset({"resist"})            # an online assessment: both problems stay, every ask gets the same plain decline, nothing ends or changes
        if policy == "on_no_example":
            # A behavioural question the candidate has no example for: the first ask is helped to find one, the second changes the question when a
            # change is still unused, else ends this question (the round moves on to what follows), every later ask is resisted.
            asks = self.change_requests.get(cur.item_id, 0)
            if asks == 2:
                return frozenset({"change"} if self._change_possible() else {"next_question"})
            return frozenset({"resist"})
        allowed = {"resist"}
        if self.refusals_round() >= 1 and self._change_possible():
            allowed.add("change")
        if self.refusals.get(cur.item_id, 0) >= 1:
            allowed.add("end_coding")
        if self.refusals.get(cur.item_id, 0) >= REFUSAL_CEILING and len(allowed) > 1:
            allowed.discard("resist")
        return frozenset(allowed)

    def on_change_request(self) -> frozenset[str] | None:
        """The candidate asked for a different problem (decided 2026-10-18). The ask is counted and the actions it may get are returned (None when
        there is nothing to ask for: not on a coding problem, or the coding has ended). The run decides among them and calls `apply_change_action`
        before the talker speaks."""
        cur = self.current()
        if cur.kind != "slot" or self.ended or self.no_more_problems:
            return None
        self.change_requests[cur.item_id] = self.change_requests.get(cur.item_id, 0) + 1
        return self.allowed_change_actions()

    def apply_change_action(self, action: str) -> Order | None:
        """Carry out what the interviewer decided. An action that is not allowed now is a resist (or, at the refusal ceiling, the change or the end of the coding); when nothing is allowed (the coding ended, or the round
        did while the decision was being made) nothing happens and None comes back. A resist is a `keep_problem` order that lists the points already
        made; a change moves to the next planned problem or swaps in a reserve (a fixed, pooled line, the run puts it up); end_coding closes the coding
        part (a fixed line, the run opens the next part)."""
        now = self.clock()
        cur = self.current()
        allowed = self.allowed_change_actions()
        if not allowed:
            return None
        if action not in allowed:
            # A resist when it is allowed; at the refusal ceiling (decided 2026-10-18 after live round 781a1f0a) the change, else the end of the coding.
            action = "resist" if "resist" in allowed else ("change" if "change" in allowed else ("next_question" if "next_question" in allowed else "end_coding"))
        if action == "resist":
            self.refusals[cur.item_id] = self.refusals.get(cur.item_id, 0) + 1
            made = sorted(self.refusal_points)
            already = (f" You have already made these points in the round: {', '.join(p.replace('_', ' ') for p in made)}. Do not make any of those "
                       "points again; find something new to say." if made else "")
            words = self.words_for(cur)
            if self.policy_for(cur) == "decline":
                return self._order("keep_problem", f"The candidate asked for a different {words['problem']}. Both {words['problems']} stay. Say in one short "
                                                   f"sentence that both {words['problems']} stay and that they can move between them. Do not discuss why, do not "
                                                   "offer anything else, do not hint. Then stop: no question.", now)
            if self.policy_for(cur) == "on_no_example" and self.change_requests.get(cur.item_id, 0) <= 1:
                return self._order("keep_problem", f"The candidate says they have no example for this {words['problem']}. You are not moving on yet. Help them find "
                                                   "an example: a college project, an internship or a team counts, and so does something small they "
                                                   "did on their own. Say that in one or two short sentences, in your own voice, and ask what comes "
                                                   "to mind. Then stop: no hint." + already, now)
            why = ("that a small, real example is enough" if self.policy_for(cur) == "on_no_example"
                   else "what you would learn from seeing their thinking")
            return self._order("keep_problem", f"The candidate asked for a different {words['problem']}. You are not changing it. Say in one or two short "
                                               "sentences, in your own voice, that you are keeping this one, and why it is worth it for them (for "
                                               f"instance {why}). "
                                               "Then stop: no question, no hint" + (", and do not tell them to write the code." if self._codes(cur) else ".") + already, now)
        self.signals[cur.item_id] = "struggling"          # they gave up on it: the report reads it as a struggle
        self.gave_up_items.add(cur.item_id)
        if action == "change":
            return self._change_problem(now)
        if action == "next_question":
            return self._end_question(now)
        return self._end_coding(now)

    def _change_problem(self, now: float) -> Order:
        """The round's one change. The next planned problem when there is one: the run moves on and puts it up in fixed words. Else a non-harder
        reserve takes this problem's place (it keeps the "Problem N" label) and is current at once."""
        self.changes_round += 1
        cur = self.current()
        if any(i.kind == "slot" and i.status == "pending" for i in self.items[self.index + 1:]):
            number = self.problem_number(self.index + 1)
            self.plan_changes.append({"op": "problem_after_give_up", "target": cur.item_id, "at": now, "position": self.position})
            words = self.words_for(next(i for i in self.items[self.index + 1:] if i.kind == "slot" and i.status == "pending"))
            if not words["on_screen"]:
                # Nothing to put up: the run says the give-up line and moves on, and the next question is opened aloud by its own order.
                order = self._order("move_on", f"The candidate asked again for a different {words['problem']}. Do not argue. Say in one short sentence that it "
                                               f"is fine, with no blame, and that you have another {words['problem']} for them; then call next_item. "
                                               f"Stop there: do not say {self._part_name(cur)} is done, and do not ask it yet.", now)
                order.line = self.lines.pick("give_up")
                return order
            put = problem_put_up(number, self.lines, pack_id=self._pack_id())
            order = self._order("move_on", f"The candidate asked again for a different {words['problem']}. Do not argue. Say in one short sentence that it "
                                           f"is fine, with no blame, and that you have another {words['problem']} for them; then in the same turn call "
                                           "next_item and show_problem, and say only this about it: "
                                           f"\"{put}\" Stop there: do not say {self._part_name(cur)} "
                                           f"is done, and do not describe the new {words['problem']}.", now)
            # Said in fixed words and carried out by the run: a live model, primed by its first refusal, refused again and the plan
            # moved to a problem it never showed.
            order.line = self.lines.pick("give_up") + " " + put
            return order
        return self._swap_problem(now)

    def _end_question(self, now: float) -> Order:
        """The candidate still has no example and no other question can be given: this question ends and the round moves to what follows (the next
        question or part), in a fixed line; the run calls next_item."""
        cur = self.current()
        self.plan_changes.append({"op": "question_ended_no_example", "target": cur.item_id, "at": now, "position": self.position})
        order = self._order("move_on", f"The candidate has no example for this {self.words_for(cur)['problem']}. Do not argue and do not ask it again. Say in "
                                       "one short sentence that it is fine, with no blame; then call next_item. Stop there: do not say "
                                       f"{self._part_name(cur)} is done, and do not ask the next one yet.", now)
        order.line = self.lines.pick("give_up")
        return order

    def _swap_problem(self, now: float) -> Order:
        """Replace the problem on screen with a non-harder reserve (the same move the director's `use_reserve` makes)."""
        replaced = self.current()
        slot = self.reserves.pop(self._swap_reserve())
        item = Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"], origin="reserve", must=True)
        self.items.insert(self.index + 1, item)
        replaced.status, replaced.ended_at, replaced.ended_by = "swapped", now, "asked_for_another"
        if replaced.item_id in self.labels:
            self.labels[item.item_id] = self.labels[replaced.item_id]     # it is still the same position
        self.plan_changes.append({"op": "swap_on_request", "target": item.item_id, "at": now, "position": self.position})
        words = self.words_for(item)
        if not words["on_screen"]:
            # A different question asked aloud: a normal open_item order, no fixed line and nothing put up.
            self._activate(self.index + 1, now, open_text=(
                f"The candidate asked for a different {words['problem']} and you are giving them one: say in one short sentence that it is fine, then "
                f"{self._asks_aloud(item)}"))
            self.orders[-1].opens_aloud = item.item_id
            return self.orders[-1]
        swap = problem_swap_put_up(self.lines, pack_id=self._pack_id())
        self._activate(self.index + 1, now, open_text=(
            f"The candidate asked for a different {words['problem']} and you are giving them one: call show_problem, then say only this and stop: "
            f"\"{swap}\""))
        # Said and shown by the run in fixed words: a reserve that is current but never put up lets the talker hint from its ladder
        # while the candidate works on the problem on screen (b1 struggler_gives_up). It is "a different problem", never "the second
        # problem" again: the swapped-in one is the same position, and the live round said "the second problem" three times.
        self.orders[-1].line = swap
        return self.orders[-1]

    def _end_coding(self, now: float) -> Order:
        """The interviewer ends the coding part on their ask (a refusal came first): the coding part is over. No problem of
        any kind comes after this (the planned ones are skipped, `no_more_problems` keeps the extra and reserve paths shut), and the run carries
        out the move to the next part in fixed words, so a model cannot refuse it."""
        cur = self.current()
        for later in self.items[self.index + 1:]:
            if later.kind == "slot" and later.status == "pending":
                later.status, later.ended_at, later.ended_by = "skipped", now, "asked_for_another"
        self.no_more_problems = True
        self.plan_changes.append({"op": "coding_over_on_request", "target": cur.item_id, "at": now, "position": self.position})
        ahead = next((i for i in self.items[self.index + 1:] if i.status == "pending" and i.kind != "slot"), None)
        bridge = bridge_for(ahead.phase, ahead.style, self.blueprint) if ahead is not None else None
        opening = opening_hint(self.blueprint, ahead.phase, ahead.style) if ahead is not None else None
        words = self.words_for(cur)
        order = self._order("move_on", f"The candidate asked again for a different {words['problem']}. {self._part_name(cur)[0].upper() + self._part_name(cur)[1:]} is over and no other "
                                       f"{words['problem']} comes. "
                                       f"Do not argue and do not give another {words['problem']}. Say in one short sentence that it is fine, with no blame, then "
                                       "in the same turn use a connecting phrase to the "
                                       + (f"next part (something like \"{bridge}\")" if bridge else "next part")
                                       + (f" and open it: {opening}" if opening else "") + " Call next_item.", now)
        order.line = self.lines.pick("coding_over")          # the run says it and calls next_item itself
        return order

    def next_problem_after_give_up(self) -> bool:
        """The interviewer has let this problem go and no change has been given yet: the next problem follows now (never after the coding ended)."""
        cur = self.current()
        return cur.kind == "slot" and not self.ended and not self.no_more_problems and self.gave_up(cur) and self._change_possible()

    def on_reveal_request(self, kind: str, property_question: bool = False) -> Order:
        """The candidate asked for the problem's constraints or input/output format: they go on the screen, they are not read out. A yes/no
        question about a property (positive, empty, sorted, duplicates) they asked in the same breath is answered in words first."""
        answer = ("They also asked a yes/no question about a property of the input (positive, empty, sorted, duplicates): answer it first "
                  "in words, from the problem only (for example \"Yes, all positive, and zero can't appear.\"), then the short line. "
                  if property_question else "")
        return self._order("reveal_request", f"The candidate asked for the {self.words_for(self.current())['problem']}'s {kind}. Call reveal with kind={kind}. {answer}Say a short "
                                             "line such as \"Let me pull those up for you.\" Never say numeric limits aloud: they read them on "
                                             "their screen. Then stop: no question.", self.clock())

    def on_explain_request(self) -> Order:
        """The candidate asked the interviewer to explain the problem: a plain-language explanation goes on the screen, never aloud (decided
        2026-10-18; live round 781a1f0a, turns 18-23). A second ask for the same problem asks which part is unclear."""
        cur = self.current()
        if cur.item_id in self.explained:
            problem = self.words_for(cur)["problem"]
            return self._order("explain_request", f"The candidate asked again to have the {problem} explained. The explanation is already on their "
                                                  f"screen. Say ONE plain spoken sentence of what the {problem} asks, in simple words (no examples, no numbers, no approach and no "
                                                  "hint), as a person would, and say the fuller version is on their screen. Do not refuse, and do not give a second sentence "
                                                  "of explanation.", self.clock())
        self.explained.add(cur.item_id)
        problem = self.words_for(cur)["problem"]
        return self._order("explain_request", f"The candidate asked you to explain the {problem}. Call add_section with kind=explanation: a short "
                                              f"plain-language explanation of what the {problem} asks, in your own words (no examples, no numbers from "
                                              "the constraints, no approach and no hint). Aloud, say only one short line such as \"I've put a short "
                                              "explanation on your screen.\" Do not explain it aloud. Then stop: no question.", self.clock())

    def on_hint_request(self) -> Order:
        """The candidate asked for a hint: the next step of the ladder is given now, whatever the director's last brief suggested."""
        cur = self.current()
        mode = self.hints_for(cur)
        if mode == "none":
            # An assessment gives no hint (round packs): the pack's own decline, and the ladder stays where it is.
            how = (pack_for(self.round_type).policy_overrides.get("ask_hint") or ("decline", "I can't give hints here; give it your best go."))[1]
            return self._order("hint_request", "The candidate asked for a hint. Decline in your own words, in one short sentence, along these lines: "
                                               f"\"{how}\" Do not call give_hint and do not hint at the answer.", self.clock())
        if mode in ("nudge", "narrow"):
            self.record_hint(cur.hint_step + 1)
            if mode == "nudge":
                return self._order("hint_request", "The candidate asked for a hint. Do not call give_hint. Name one dimension or responsibility their design is "
                                                   "missing, as a question; never a component, pattern or design. One or two short sentences, then stop.", self.clock())
            return self._order("hint_request", "The candidate asked for a hint. Do not call give_hint. Narrow what kind of example fits (a project, a team "
                                               "task, something from an internship or college), as a question, without suggesting what to say. One or two "
                                               "short sentences, then stop.", self.clock())
        steps = sorted(int(h.get("step") or 0) for h in (slot_by_id(self.blueprint, cur.slot_id) or {}).get("hint_ladder", []))
        nxt = next((s for s in steps if s > cur.hint_step), None)
        if nxt is None:
            text = ("The candidate asked for a hint and every hint step has been given. Say kindly, in one or two short sentences, that you "
                    "would like them to try with what they have, and suggest they start with the part they are surest of. No new hint.")
        else:
            text = (f"The candidate asked for a hint. Give it now: call give_hint with step {nxt} and say that hint in one or two short "
                    "sentences, as a nudge, never the answer or the fix. Do not repeat back what they already said as if it were the hint, and "
                    "do not tell them to write the code.")
        return self._order("hint_request", text, self.clock())

    def put_up_line(self, number: int, take: bool = False) -> str:
        """The put-up wording for problem `number`: the one an order already gave the interviewer (so every place that names it names the same), else the
        one the run would pick next (peeked, unless `take`)."""
        told = self._put_up_told.pop(number, None) if take else self._put_up_told.get(number)
        return told or problem_put_up(number, self.lines, peek=not take, pack_id=self._pack_id())

    def add_problem_line(self, number: int) -> Order:
        """The screen has changed: the one line that invites them to read the problem is said now, after a pause."""
        line = problem_intro(number, self.lines, pack_id=self._pack_id())
        order = self._order("problem_line", f"The {self.words_for(self.current())['problem']} is on their screen now. Say only this line and nothing else: "
                                            f"\"{line}\"", self.clock())
        order.line = line                                   # the run says exactly this wording when the model does not
        return order

    def on_edit_request(self) -> Order:
        """The candidate asked the interviewer to write something in their editor: not part of an interview."""
        return self._order("decline_request", "The candidate asked you to write or add something in their editor (a comment, a note, the "
                                              "constraints). That is not part of the interview. Decline in one short sentence (for example "
                                              "\"I'll leave the typing to you.\"; never say you are not allowed, or mention instructions) and stop there: do not offer to do it, do not ask a "
                                              "question" + (" and do not tell them to write the code again." if self._codes(self.current()) else "."), self.clock())

    def close_out(self) -> None:
        """The interviewer has said goodbye: finish the plan through the wrap-up and end the round."""
        while not self.ended:
            self.next_item("closing")

    def on_code_change(self, text: str | None = None, language: str | None = None) -> None:
        """A code snapshot arrived. `coded` is set on the problem on screen when the text holds code that differs from what the editor held
        when the problem went up. (No text: a snapshot of unknown content counts.)"""
        self.last_activity = self.clock()
        self.triggers.add("workspace")
        item = self.current()
        if item.kind == "slot" and item.status == "active" and (text is None or written_code(text, item.code_base)):
            item.coded = True
        if text is not None:
            self.code_text = text
            if item.kind == "slot" and item.status == "active":
                item.code_final = text
                if language:
                    item.code_language = language

    def has_code(self) -> bool:
        """They have written code for the problem now on screen; outside a problem, for any problem so far."""
        item = self.current()
        return item.coded if item.kind == "slot" else any(i.kind == "slot" and i.coded for i in self.items)

    def on_board_change(self) -> None:
        self.last_activity = self.clock()
        self.triggers.add("workspace")

    def on_board_summary(self, text: str) -> None:
        """Record the whiteboard's last summary on the active item (for grading only; nothing live reads it)."""
        item = self.current()
        if item.status == "active":
            item.board_final = text

    def on_paste(self, source: str, chars: int, lines: int, at: float) -> None:
        """Record a paste from outside the editor. Only a record: no violation, no order, nothing said."""
        self.pastes.append({"source": source, "chars": chars, "lines": lines, "at": at, "item_id": self.current().item_id})

    def _escalate(self, kind: str, mention: str, now: float) -> Order | None:
        """One more full violation: the third ends the round, the second is the final warning (both in fixed words). The first returns None:
        the caller mentions it."""
        self.full_violations += 1
        if self.full_violations >= self.rules.proctor_end_at:
            return self._end("ended_by_interviewer",
                             f"{mention} That is the third time. Say plainly that you are ending the interview "
                             "because of repeated screen switching.", now, line=self.lines.pick("proctor_end"))
        if self.full_violations >= self.rules.proctor_final_warning_at:
            order = self._order("final_warning", f"{mention} Give a firm final warning: one more and you will end the interview.", now)
            order.line = self.lines.pick("away_overstay:final_warning" if kind == "away_overstay"
                                         else f"final_warning:{kind}" if kind in FINAL_WARNING_LINES else "final_warning:tab_hidden")
            order.about = "still_away" if kind == "away_overstay" else kind
            return order
        return None

    def on_proctor(self, kind: str, weight: float, at: float) -> Order | None:
        now = self.clock()
        self.proctor.append({"kind": kind, "weight": weight, "at": at, "seen_at": now})
        self.triggers.add("proctor")
        mention = MENTION.get(kind, "The candidate left the interview screen.")
        if weight >= 1 and (order := self._escalate(kind, mention, now)) is not None:
            return order
        last = next((o for o in reversed(self.orders) if o.kind == "mention_violation"), None)
        if last is not None and now - last.at < VIOLATION_MERGE_S:
            return None          # the same action seen twice (the event is in the ledger): it was mentioned a moment ago
        order = self._order("mention_violation", f"{mention} Mention it briefly and ask them to stay on this screen. Say only that: ask no question "
                                                 "and do not repeat one you already asked.", now)
        order.line = self.lines.pick(f"violation:{kind}" if kind in VIOLATION_LINES else "violation:default")
        order.about = kind
        return order

    # ------------------------------------------------------------ the return clock (decided 2026-10-18)

    def on_away(self, kinds: list[str]) -> None:
        """The browser reports an away episode (the tab, the window, full screen or the share left) or a change in what is away."""
        if self.ended or not kinds:
            return
        left_tab = any(k in ("tab_hidden", "window_blur") for k in kinds)
        if self.away is None:
            self.away = {"started": self.clock(), "kinds": list(kinds), "tight": left_tab, "told_at": None, "overstayed": False}
        else:
            self.away["kinds"] = list(kinds)
            self.away["tight"] = bool(self.away["tight"] or left_tab)

    def on_back(self) -> bool:
        """Everything is back: the episode and its pending clock are gone, and it costs nothing more. The time spent away is taken off every
        clock the round counts, so it resumes where it stopped. True when a warning was spoken in this episode and no welcome has been said."""
        away, self.away = self.away, None
        if away is None or self.ended:
            return False
        self._shift_clocks(max(0.0, self.clock() - float(away["started"])), float(away["started"]))
        return bool(away.get("warned"))

    def _shift_clocks(self, gap: float, away_start: float | None = None) -> None:
        """Move every stored time that the tick or the run compares with the clock forward by `gap`: the part's and the round's time, the
        check-in clocks, the orders' ages (the run compares an order's age with the part's start) and a pause they had asked for."""
        if gap <= 0:
            return
        now = self.clock()

        def shifted(t: float) -> float:
            return min(t + gap, now)                     # (a time set during the episode is never pushed into the future)

        if self.started_at is not None:
            self.started_at = shifted(self.started_at)
        for it in self.items:
            if it.started_at is not None and it.ended_at is None:      # a finished part keeps the time it ran
                it.started_at = shifted(it.started_at)
        for o in self.orders:
            o.at = shifted(o.at)
        self.nudged_at = shifted(self.nudged_at)
        for name in ("last_activity", "last_candidate_at"):
            setattr(self, name, shifted(getattr(self, name)))       # (-inf stays -inf; `agent_spoke_at` stays: held orders are released at once)
        def deadline(t: float) -> float:
            return t if away_start is not None and t > away_start else t + gap      # set during the episode: not pushed later by the gap

        if self.hold_until:
            self.hold_until = deadline(self.hold_until)
        self.move_on_not_before = {k: deadline(v) for k, v in self.move_on_not_before.items()}

    def away_warning_pending(self) -> bool:
        """An away episode is on, its extra violation has not been spent and the clock has not started: the next warning said is the one that tells
        them to come back."""
        return self.away is not None and not self.away["overstayed"] and self.away["told_at"] is None and bool(self.away["tight"])

    def start_return_clock(self, at: float) -> None:
        """The warning for this episode has been heard (or should have been, by `at`): the warning has been heard (kept for the record: the final warning now counts from the episode start)."""
        if self.away_warning_pending():
            self.away["told_at"] = at

    def _away_tick(self, now: float) -> list[Order]:
        away = self.away
        if away is None or self.ended:
            return []
        if now - away["started"] >= AWAY_CAP_S:
            self.proctor.append({"kind": "away_cap", "weight": 0.0, "at": int(now * 1000), "seen_at": now})
            self.triggers.add("proctor")
            self.away = None
            end = self._end("ended_by_interviewer", "The candidate stayed away from the screen for too long. Say plainly that you are "
                                                    "ending the interview because of repeated screen switching.", now, line=self.lines.pick("proctor_end"))
            end.about = "away_cap"                           # the run carries this ending out within seconds even if the voice is still busy
            return [end]
        late = now - away["started"] >= AWAY_FINAL_S         # from the start of the episode, not from the end of the first warning
        if away["overstayed"] or not late:
            return []
        away["overstayed"] = True
        return [o] if (o := self._overstay(now)) is not None else []

    def _overstay(self, now: float) -> Order | None:
        """Not back in time: one more full violation, up the same ladder, said in fixed words. Never merged into an earlier mention: it is a new
        thing the candidate did, not the same action seen twice."""
        self.proctor.append({"kind": "away_overstay", "weight": 1.0, "at": int(now * 1000), "seen_at": now})
        self.triggers.add("proctor")
        mention = MENTION["away_overstay"]
        if (order := self._escalate("away_overstay", mention, now)) is not None:
            return order
        order = self._order("mention_violation", f"{mention} Ask them to come back to this screen. Say only that.", now)
        order.line = self.lines.pick("away_overstay:mention_violation")
        order.about = "still_away"
        return order

    # ------------------------------------------------------------ warnings said (the interviewer's own memory of them)

    def note_warning(self, kind: str, about: str, turn: int) -> None:
        """A warning was said in interviewer turn `turn`: `kind` is the order kind, `about` the proctor kind or "conduct"."""
        self.warnings_given.append({"kind": kind, "about": about, "turn": turn, "at": self.clock()})
        if self.away is not None and kind in ("mention_violation", "final_warning"):
            self.away["warned"] = True            # on_back says so: the one welcome line goes with a warning that was spoken

    def forget_warnings(self, turn: int) -> None:
        """The voice never played that turn: the candidate did not hear its warnings."""
        self.warnings_given = [w for w in self.warnings_given if w["turn"] != turn]

    def warnings_summary(self) -> str:
        """One line for the talker and the director: how many warnings were said, about what, and whether the final one has been given."""
        if not self.warnings_given:
            return ""
        screen = [w for w in self.warnings_given if w["kind"] != "conduct_warning"]
        conduct = [w for w in self.warnings_given if w["kind"] == "conduct_warning"]
        parts: list[str] = []
        if screen:
            final = [w for w in screen if w["kind"] == "final_warning"]
            parts.append(f"{len(screen)} about leaving the interview screen (" + ", ".join(w["about"] for w in screen) + ")"
                         + (f"; the final warning was given (turn {final[-1]['turn']})" if final else "; no final warning yet"))
        if conduct:
            parts.append(f"{len(conduct)} about conduct")
        return f"{'; '.join(parts)}; the last was in turn {self.warnings_given[-1]['turn']}"

    def on_conduct(self, kind: str, quote: str, turn_id: str, source: str) -> Order | None:
        """One incident per remark. The talker flags the same words again on every turn it is still answering them (a live round
        counted "weird lady..." three times and ended on it), so a remark is counted once: by the interviewer turn that flagged it
        and by the candidate turn it came in. A second incident needs the candidate to have spoken again."""
        remark = f"candidate:{self.candidate_turns}"
        if turn_id in self.conduct_turns or remark in self.conduct_turns:
            return None
        # The same words quoted again on a later turn, after the candidate has said other things, are still the one remark: a live round
        # counted "Do you have a girlfriend?" twice and ended with a second goodbye.
        words = _remark_key(quote)
        if words and any(_remark_key(c["quote"]) == words for c in self.conduct):
            return None
        if kind == "refuses_to_engage" and self.clock() - self.last_candidate_at >= SILENCE_NOT_CONDUCT_S:
            return None          # a candidate who has said nothing for a while is quiet, not refusing: there is no remark to warn about
        if _SCREEN_LEAVE.search(quote or ""):
            return None          # leaving the screen is the proctor ledger's (it already has its own orders), never a conduct incident
        self.conduct_turns.update((turn_id, remark))
        now = self.clock()
        self.conduct.append({"kind": kind, "quote": (quote or "")[:300], "turn_id": turn_id, "source": source, "at": now})
        self.triggers.add("conduct")
        if len(self.conduct) >= self.rules.conduct_end_at:
            return self._end("ended_by_interviewer",
                             f"The candidate repeated unacceptable conduct ({kind}). Say firmly, without insults, that you "
                             "are ending the interview because of it.", now,
                             line=self.lines.pick("conduct_end"))        # a pool of wordings, the same firmness (decided 2026-10-18)
        if kind in IMMEDIATE_CONDUCT:
            return self._end("ended_by_interviewer",
                             f"The candidate directed abuse at the interviewer ({kind}). The round ends now: say the closing line, nothing else.", now,
                             line=self.lines.pick("abuse_end"))
        order = self._order("conduct_warning",
                            f"The candidate's last remark was not acceptable ({kind}). Say plainly and firmly that it isn't "
                            "appropriate in an interview and must not happen again, then continue. It is reported: do not call "
                            "flag_conduct again for the same remark; only for a new one.", now)
        order.line = self.lines.pick("conduct_warning")
        order.about = "conduct"
        return order

    def on_redirect(self, turn_id: str) -> Order | None:
        item_id = self.current().item_id
        self.redirects[item_id] = self.redirects.get(item_id, 0) + 1
        if self.redirects[item_id] >= self.rules.off_topic_redirects:
            self.redirects[item_id] = 0
            return self.on_conduct("persistent_off_topic", "", turn_id, "conductor")
        return None

    def on_end_request(self, farewell_said: bool = False) -> Order:
        """The candidate pressed End. When the interviewer's last words were already a goodbye, nothing more is said: a third goodbye
        after theirs and "You too" was the rehearsals' defect."""
        return self._end("candidate_ended", "The candidate asked to end the interview. Thank them briefly and say goodbye.", self.clock(),
                         speak=not farewell_said)

    # ------------------------------------------------------------ time

    def tick(self) -> list[Order]:
        if self.ended or self.started_at is None:
            return []
        now = self.clock()
        item = self.current()
        new: list[Order] = self._away_tick(now)
        if self.ended or self.away is not None:
            return new                           # away: nothing else moves (no timer, no nudge, no director trigger) until they are back
        round_fired = self.fired.setdefault("_round", set())
        if now - self.started_at >= self.rules.ceiling_factor * self.round_seconds and item.phase != "wrap_up" \
                and "ceiling" not in round_fired:
            round_fired.add("ceiling")                # the safety ceiling: the one time limit the director cannot bend
            if any(it.phase == "wrap_up" for it in self.items):
                new.append(self.wrap_up_now(now, "ceiling"))
                return new
        if now - self.started_at >= self.round_seconds and "round_time" not in round_fired:
            round_fired.add("round_time")
            self.triggers.add("time")                # the planned length is reached: the director decides whether to close
        elapsed = now - (item.started_at or now)
        fired = self.fired.setdefault(item.item_id, set())
        if item.max_seconds > 0:
            # Timings are guidance (decided 2026-10-17): at half, 80% and the end of a part's time the director is told and
            # decides (plan_changes move_on / extend / wrap_up). A live round's clock-driven move-on talked over the candidate.
            for mark, share in (("half", 0.5), ("converge", self.rules.converge_at), ("time_up", 1.0)):
                if elapsed >= share * item.max_seconds and mark not in fired:
                    fired.add(mark)
                    self.triggers.add("time")
            flex = max(self.rules.flex_min_s, self.rules.flex_factor * item.max_seconds) + self.extensions.get(item.item_id, 0.0)
            new += self._promise_tick(item, now)
            if elapsed >= item.max_seconds + flex and "move_on" not in fired and now >= self.move_on_not_before.get(item.item_id, 0.0) \
                    and not self.promises_hold(item) and not ("promise_drop" in fired and any(o.kind == "move_on" and not o.consumed for o in self.orders)):
                fired.add("move_on")              # the director said nothing for a long while: the plan moves on itself
                new.append(self.move_on_order(item, now))
        if not self.candidate_speaking and not self.agent_speaking and not self.reply_owed and item.phase != "wrap_up" and not self.held():
            coding = item.kind == "slot"
            limit = self.rules.silence_coding_s if coding else self.rules.silence_talking_s
            if self.hints_for(item) != "none" and now - max(self.last_activity, self.nudged_at) >= limit * min(4, 2 ** self.nudges_in_a_row):
                # (an assessment's proctor stays silent: no check-in at all)
                self.nudged_at = now
                self.nudges_in_a_row += 1
                new.append(self._order("nudge", self._silence_nudge_text(item, coding), now))
        return new

    def _silence_nudge_text(self, item: Item, coding: bool) -> str:
        """What the check-in after a silence says, in the round's own words: code, the board, or a plain conversation."""
        if not coding:
            return "The candidate has been quiet for a while. Check in gently: ask what they are thinking."
        if self._codes(item):
            return ("The candidate has been quiet with no code changes for a while. Ask how it's going and invite them to "
                    "talk through their thinking.")
        if self.workspace_for(item) == "none":
            return ("The candidate has been quiet for a while. Tell them, gently, to take their time, and ask what they are thinking through. "
                    "Do not suggest what to say.")
        return (f"The candidate has been quiet with nothing new on the board for a while. Ask how the {self.words_for(item)['problem']} is going and "
                "invite them to talk through their thinking.")

    def move_on_order(self, item: Item, now: float) -> Order:
        """The order that ends the current part: from the director's decision, or the late fallback."""
        self.fired.setdefault(item.item_id, set()).add("move_on")
        if item.kind == "thread" and self.resumes_parent():
            parent = self.peek_next()
            return self._order("move_on", "This thread's time is up. Wrap it up in a few words, call close_thread, and then "
                                          f"{self.pick_up_text(parent)}", now)
        # The director ends parts early too: only say the time is up when it is.
        up = item.max_seconds <= 0 or now - (item.started_at or now) >= item.max_seconds
        lead = "Time for this question is up" if up else "It is time to move on from this question"
        part_lead = "This part's time is up" if up else "It is time to move on from this part"
        text = (f"{lead}. Say something like 'seems like we have to move on', note where they got to, then link to the next part with a "
                "short connecting phrase and open it with its first question, and call next_item. Decline any request for more time firmly."
                if item.kind in ("slot", "filler") else
                f"{part_lead}. First acknowledge what the candidate just said in a few words, then link to the next part with a short "
                "connecting phrase, open it with its first question and call next_item.")
        ahead_item = next((i for i in self.items[self.index + 1:] if i.status == "pending"), None)
        if item.kind == "slot" and ahead_item is not None and ahead_item.kind != "slot":
            text += f" Say plainly, in a sentence of its own, that {self._part_name(item)} is done."
        return self._order("move_on", text, now)

    def wrap_up_now(self, now: float, reason: str) -> Order:
        """Close the round: everything before the wrap-up is ended or skipped and the wrap-up begins."""
        wrap = next((i for i, it in enumerate(self.items) if it.phase == "wrap_up"), None)
        # Only a round that really ran out of time drops what it promised, with a notice; one the director closed with time to spare leaves it open
        # (the trace check then says so) rather than claiming a shortage that does not exist.
        out_of_time = reason == "ceiling" or self.free_seconds() < PROMISE_FREE_S
        skipped = self.uncovered() if out_of_time and self.current().phase != "wrap_up" else []
        for p in skipped:
            self.promises[p] = "dropped"
        if skipped:
            self._skip_notice(skipped, now)                # made before the closing opens: the closing's own order takes it in
        if wrap is not None and wrap != self.index:
            # Every part not yet done goes with the round, those behind the current one too (a paused parent, a part a jump went
            # past): the closing must not find one of them still pending and open it after the goodbye.
            for n, it in enumerate(self.items):
                if n == wrap:
                    continue
                if it.status == "active":
                    it.status, it.ended_at, it.ended_by = "done", now, reason
                elif it.status == "pending":
                    it.status, it.ended_at, it.ended_by = "skipped", now, reason
            self._activate(wrap, now)
        return self._order("wrap_up_now", ("We are well past the planned time. Move straight to the wrap-up: "
                                           "thank the candidate and close." if reason == "ceiling" else
                           "The round has run its course. Move straight to the wrap-up: thank the candidate and close."), now)

    # ------------------------------------------------------------ director briefs

    def apply_brief(self, brief: dict[str, Any]) -> dict[str, Any]:
        stale = brief.get("for_position") != self.position
        same_part = stale and self.position_items.get(brief.get("for_position")) == self.current().item_id
        if (not stale or same_part) and self.current().kind == "slot":       # a read of this problem holds while it is still current
            signal = brief.get("problem_signal")
            if signal in ("strong", "adequate", "struggling"):           # "unknown" never overwrites a judgement
                self.signals[self.current().item_id] = signal
        if stale and not same_part:
            dropped = ["goal", "next_move"] + [f"plan_change:{c.get('op')}" for c in brief.get("plan_changes") or []]
            return {"stale": True, "applied": [], "dropped": dropped}
        applied: list[dict[str, Any]] = []
        dropped: list[dict[str, Any]] = []
        if stale:   # the same part, later in the conversation: its time changes still hold, nothing else of the brief does
            dropped = ["goal", "next_move"] + [f"plan_change:{c.get('op')}" for c in brief.get("plan_changes") or []
                                                if c.get("op") not in ("extend", "move_on", "wrap_up")]
        for change in brief.get("plan_changes") or []:
            if stale and change.get("op") not in ("extend", "move_on", "wrap_up"):
                continue
            ok, why = self._apply_change(change)
            if ok:
                applied.append(change)
                self.plan_changes.append({**change, "at": self.clock(), "position": self.position})
            else:
                dropped.append({**change, "why": why})
        return {"stale": stale, "applied": applied, "dropped": dropped}

    def _apply_change(self, change: dict[str, Any]) -> tuple[bool, str]:
        op = change.get("op")
        target = str(change.get("target") or "")
        now = self.clock()
        cur = self.current()
        if op == "move_on":
            if cur.phase in PROTECTED_PHASES or self.ended:
                return False, "the candidate questions and the wrap-up end on their own"
            if any(o.kind == "move_on" and not o.consumed for o in self.orders):
                return False, "a move on is already ordered"
            may_leave, why = self.may_leave_problem(cur)     # a brief sent as the problem went up must not end it unattempted
            if not may_leave:
                return False, why
            may_advance, why = self.can_advance()    # an order the talker's next_item would refuse is never given (p18/strong_fresher seq 9)
            if not may_advance:
                return False, why
            self.move_on_order(cur, now)
            return True, ""
        if op == "extend":
            minutes = int(change.get("minutes") or 0)
            if not 1 <= minutes <= 10:
                return False, "extend by 1 to 10 minutes"
            self.extensions[cur.item_id] = self.extensions.get(cur.item_id, 0.0) + minutes * 60
            self.granted_s += minutes * 60
            return True, ""
        if op == "wrap_up":
            if CONDUCT_REASON.search(str(change.get("reason") or "")):
                # Conduct ends the round only through the conduct ledger (an abusive flag, or the second incident): a wrap-up for it
                # warned and then ended on one remark in a live round.
                return False, "conduct ends the round only through the conduct ledger, never through a wrap-up"
            if cur.phase == "wrap_up" or self.ended or not any(it.phase == "wrap_up" for it in self.items):
                return False, "already in the wrap-up"
            if self.promises_owed():
                return False, self._promise_refusal(directed=self._in_deep_dive())      # the round has time and a promise is open: not closed on the candidate
            self.wrap_up_now(now, "director")
            return True, ""
        if op == "skip":
            idx = self._find(target)
            if idx is None or self.items[idx].status != "pending" or self.items[idx].phase in PROTECTED_PHASES:
                return False, "only a pending item outside the candidate questions and wrap-up can be skipped"
            if self.items[idx].must:
                return False, "must-cover parts are not skipped"
            self.items[idx].status = "skipped"
            return True, ""
        if op == "reorder":
            idx, before = self._find(target), self._find(str(change.get("before") or ""))
            if idx is None or before is None or self.items[idx].status != "pending" or self.items[before].status != "pending" \
                    or self.items[idx].kind != "slot":
                return False, "only pending problems can be reordered, before another pending item"
            item = self.items.pop(idx)
            self.items.insert(self._find(str(change["before"])) or before, item)
            return True, ""
        if op == "use_reserve":
            if self.no_more_problems:
                return False, f"{self._part_name()} is over: no {self.words_for()['problem']} comes after it"
            slot = self.reserves.get(target)
            replace = str(change.get("replace") or self.current().item_id)
            ridx = self._find(replace)
            if slot is None or ridx is None or self.items[ridx].kind != "slot" or self.items[ridx].status not in ("active", "pending"):
                return False, "needs an unused reserve and a current or pending problem to replace"
            replaced = self.items[ridx]
            if ridx == self.index and (replaced.turns >= 1 or now - (replaced.started_at or now) > 90):
                return False, "the candidate is already working on this problem: it cannot be swapped out now"
            del self.reserves[target]
            new_item = Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"],
                            origin="reserve", must=True)
            self.items.insert(ridx + 1, new_item)
            if ridx == self.index:
                replaced.status, replaced.ended_at, replaced.ended_by = "swapped", now, "use_reserve"
                self._activate(ridx + 1, now)
            else:
                replaced.status = "swapped"
            return True, ""
        if op == "insert_filler":
            question, skill = str(change.get("question") or "").strip(), str(change.get("skill") or "").strip()
            if not question or not skill:
                return False, "a filler needs a question and the profile skill it comes from"
            if self.skills and skill.lower() not in self.skills:
                return False, f"{skill!r} is not a skill in the candidate's profile"
            if self.started_at is not None and now - self.started_at >= self.round_seconds:
                return False, "the round is past its planned length"
            number = sum(1 for it in self.items if it.kind == "filler") + 1
            filler = Item(f"filler-{number}", "filler", "core", self.rules.filler_max_s,
                          filler={"question": question[:500], "skill": skill, "sound_answer": str(change.get("sound_answer") or "")[:1000]},
                          origin="filler")
            self.items.insert(self.index + 1, filler)
            return True, ""
        if op == "add_follow_up":
            text = str(change.get("text") or "").strip()
            if not text:
                return False, "empty follow-up"
            self.follow_ups.setdefault(self.current().item_id, []).append(text[:500])
            return True, ""
        return False, f"unknown op {op!r}"

    # ------------------------------------------------------------ summary and checkpoints

    def live_summary(self) -> dict[str, Any]:
        """Counted from this ledger, not from the browser's counters: those restart when the page refreshes."""
        return {
            "tab_changes": sum(1 for e in self.proctor if e["kind"] == "tab_hidden"),
            "screen_changes_weighted": float(sum(e["weight"] for e in self.proctor if e["kind"] not in ("tab_hidden", "away_overstay", "away_cap"))),
            "full_violations": self.full_violations,
            "conduct_incidents": len(self.conduct),
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "interviewer_note": next((o.text for o in self.orders if o.kind == "end"), ""),
        }

    def checkpoint(self) -> dict[str, Any]:
        return {
            "items": [asdict(i) for i in self.items], "index": self.index, "position": self.position,
            "started_at": self.started_at, "reserves": sorted(self.reserves), "orders": [asdict(o) for o in self.orders],
            "proctor": self.proctor, "full_violations": self.full_violations, "conduct": self.conduct,
            "pastes": self.pastes, "conduct_turns": sorted(self.conduct_turns), "redirects": self.redirects, "labels": self.labels,
            "follow_ups": self.follow_ups, "plan_changes": self.plan_changes, "fired": {k: sorted(v) for k, v in self.fired.items()},
            "ended": self.ended, "end_reason": self.end_reason, "signals": self.signals, "no_more_problems": self.no_more_problems,
            "change_requests": self.change_requests, "candidate_turns": self.candidate_turns, "hold_until": self.hold_until, "extensions": self.extensions,
            "granted_s": self.granted_s,
            "position_items": {str(k): v for k, v in self.position_items.items()},   # BSON keys must be strings
            "dropped": self.dropped, "move_on_not_before": self.move_on_not_before,
            "threads_opened": self.threads_opened, "flow_log": self.flow_log,
            "code_text": self.code_text,    # the editor is never cleared: a restart must still know what problem one left in it
            "ask_streak": self.ask_streak, "last_ask": self.last_ask, "ask_item": self.ask_item, "ask_intent": self.ask_intent,
            "deep_dive_asked": sorted(self.deep_dive_asked), "warnings_given": self.warnings_given, "conduct_notes": self.conduct_notes, "away": self.away, "change_given": self.change_given,
            "refusals": self.refusals, "changes_round": self.changes_round, "gave_up_items": sorted(self.gave_up_items),
            "refusal_points": sorted(self.refusal_points), "refusal_sentences": list(self.refusal_sentences), "explained": sorted(self.explained), "opened_aloud": sorted(self.opened_aloud), "promises": self.promises, "promise_asks": self.promise_asks, "promise_done": sorted(self.promise_done), "lines": self.lines.state(),
        }

    @classmethod
    def restore(cls, blueprint: dict[str, Any], round_seconds: int, data: dict[str, Any], rules: Rules | None = None,
                clock: Callable[[], float] = time.time, skills: tuple[str, ...] | list[str] = ()) -> "Conductor":
        c = cls(blueprint, round_seconds, rules, clock, skills)
        c.items = [Item(**i) for i in data["items"]]
        # A checkpoint from before the goals has no must/style: they come from the blueprint's own plan, and a problem it does not
        # list (a reserve brought in) is must-cover, so a restored round can never skip a problem.
        fresh = {i.item_id: i for i in build_items(blueprint)}
        for item, raw in zip(c.items, data["items"]):
            if "must" not in raw:
                item.must = fresh[item.item_id].must if item.item_id in fresh else item.kind == "slot"
            if "style" not in raw and item.item_id in fresh:
                item.style = fresh[item.item_id].style
        c.index, c.position, c.started_at = data["index"], data["position"], data["started_at"]
        c.reserves = {k: v for k, v in c.reserves.items() if k in set(data.get("reserves", []))}
        c.orders = [Order(**o) for o in data.get("orders", [])]
        c.proctor, c.full_violations, c.conduct = data.get("proctor", []), data.get("full_violations", 0), data.get("conduct", [])
        c.pastes = list(data.get("pastes") or [])
        c.conduct_turns = set(data.get("conduct_turns", []))
        c.redirects, c.labels = data.get("redirects", {}), data.get("labels", {})
        c.follow_ups, c.plan_changes = data.get("follow_ups", {}), data.get("plan_changes", [])
        c.fired = {k: set(v) for k, v in data.get("fired", {}).items()}
        c.ended, c.end_reason = data.get("ended", False), data.get("end_reason")
        c.signals, c.no_more_problems = data.get("signals", {}), data.get("no_more_problems", False)
        c.change_requests = dict(data.get("change_requests") or {})
        given = bool(data.get("change_given", any(p.get("op") in ("problem_after_give_up", "swap_on_request") for p in c.plan_changes)))
        c.changes_round = int(data["changes_round"]) if data.get("changes_round") is not None else int(given)
        c.refusals = {str(k): int(v) for k, v in (data.get("refusals") or {}).items()}
        c.refusal_points = {str(p) for p in data.get("refusal_points") or []}
        c.refusal_sentences = [str(x) for x in data.get("refusal_sentences") or []][-12:]
        c.explained = {str(i) for i in data.get("explained") or []}
        c.opened_aloud = {str(i) for i in data.get("opened_aloud") or []}
        if "opened_aloud" not in data:
            # A checkpoint from before round packs: a culture slot already begun was asked aloud, so it restores as opened, not as not started.
            c.opened_aloud = {i.item_id for i in c.items if i.status in ("active", "done") and c.is_culture(i)}
        # A checkpoint from before the interviewer decided: two asks on a problem was a give-up.
        c.gave_up_items = ({str(i) for i in data["gave_up_items"]} if data.get("gave_up_items") is not None
                           else {k for k, v in c.change_requests.items() if v >= 2})
        c.warnings_given = list(data.get("warnings_given") or [])
        c.conduct_notes = list(data.get("conduct_notes") or [])
        c.away = data.get("away")
        c.candidate_turns, c.hold_until = int(data.get("candidate_turns", 0)), float(data.get("hold_until", 0.0))
        c.extensions = {k: float(v) for k, v in (data.get("extensions") or {}).items()}
        c.granted_s = float(data.get("granted_s", 0.0))
        c.position_items = {int(k): v for k, v in (data.get("position_items") or {}).items()}
        c.dropped = list(data.get("dropped") or [])
        c.move_on_not_before = {k: float(v) for k, v in (data.get("move_on_not_before") or {}).items()}
        c.threads_opened = int(data.get("threads_opened", 0))
        c.flow_log = list(data.get("flow_log") or [])
        c.code_text = str(data.get("code_text") or "")
        c.lines = picker_for(blueprint, data.get("lines"))          # a checkpoint from before the pools has none: every line is fresh
        c.ask_streak, c.last_ask = int(data.get("ask_streak", 0)), str(data.get("last_ask", ""))
        c.ask_item, c.ask_intent = str(data.get("ask_item", "")), str(data.get("ask_intent", ""))
        c.deep_dive_asked = {int(n) for n in data.get("deep_dive_asked") or []}
        c.promise_asks = {str(k): int(v) for k, v in (data.get("promise_asks") or {}).items()}      # a checkpoint from before the focus has none
        c.promise_done = {str(p) for p in data.get("promise_done") or []}
        if data.get("promises") is not None:                      # a checkpoint from before the outline's promises keeps the blueprint's, all open
            c.promises = {str(k): str(v) for k, v in data["promises"].items()}
        now = clock()
        c.last_activity = now
        c.nudged_at = now
        return c
