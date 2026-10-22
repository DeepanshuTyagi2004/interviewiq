"""One live interview (spec §5): the conductor's rules, the talker's turns, the director's briefs, the
workspace and the store, wired together. Independent of LiveKit: the worker's adapter calls the hooks,
and the simulator drives the same object with text."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import random
import re
import time
from contextlib import aclosing
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable

from app.interviewer.activity import ActivityTracker, Utterance
from app.interviewer.addressed import (ASK_ARMED_S, NUDGE_AFTER_S, QUICK_QUESTION, AddressedState, answers_checkin, classify_by_model, classify_by_rules,
                                       has_question_cue, has_direct_ask_cue, is_invite)
from app.interviewer.brief import Brief
from app.interviewer.closing import (is_acknowledgement, asked_for_walkthrough, awaiting_answer, asks_for_help, narrating_a_walkthrough, trails_off, asks_for_constraints, asks_for_format, asks_for_hint, asks_to_explain, asks_for_simpler, _CONCLUDES, announces_coding_now, unsaid_warnings, addresses_the_candidate, announces_problem, asks_for_introduction, ends_with_goodbye, asks_for_next_problem, asks_for_questions, asks_if_right, asks_to_trace, asks_yes_no, states_assumption,
                                     asks_for_a_moment, asks_format_check, asks_interviewer_to_edit, asks_to_change_problem, gives_outline, grants_a_pause, makes_a_request,
                                     closes_coding_part, asks_about_a_property, is_farewell, is_line_check, leaves_the_part, matches_probe, moves_to_another_problem,
                                     needs_no_reply, promised_topic, promises_to_return, refusal_points, says_done_coding, says_starting_to_code, says_the_problem_line, starts_coding)
from app.interviewer.change_decision import DECISION_TEMPERATURE, DECISION_TIMEOUT_S, decide_change, fallback_action
from app.interviewer.conductor import (AWAY_LINE_WORDS_PER_S, HOLD_BREAKERS, ORDER_SPACING_S, SET_ASIDE_ORDERS, TIMER_ORDERS, URGENT_ORDERS,
                                       WARNING_KINDS, Conductor, Order, Rules, is_violation_line)
from app.interviewer.digest import digest_for_utterance, digest_idle
from app.interviewer.director import Director
from app.interviewer.fillers import Fillers
from app.interviewer.guard import LeakGuard, _stems
from app.interviewer.lines import LINES, habits_of, put_up_ordinals, seed_of
from app.interviewer.llm import LLMUnavailable, ToolCall
from app.interviewer.plan import (MIN_TURNS, bridge_for, layout_for, outline_requirement, part_nouns, problem_intro, problem_put_up, promise_words, promised,
                                  outline_turn_eligible, promises_of, realism_outline, round_seconds, slot_by_id, wire_ids, with_outline_text)
from app.interviewer.prompts import CONDUCT_CHECK_PROMPT, director_messages, item_details, opening_hint, state_block, talker_messages, talker_prefix
from app.interviewer.predicates import aimed_at_them, board_typed_text, content_words, directed_abuse, echo_stems, maybe_conduct
from app.interviewer.talker import PROBLEM_GUESS_ANSWER, REFUSAL_MIN_WORDS, SCREEN_CLAIM, opens_with_verdict, Pacing, TalkerFailed, TalkerTurn, TurnResult, turn_opener
from app.interviewer.tools import ToolExecutor, tools_for

logger = logging.getLogger(__name__)
MAX_HISTORY = 20
# The tail of a wrap-up that already thanked them and was cut short: where the feedback is, then the goodbye (live round 781a1f0a, turn 58).
WRAP_UP_TAIL = "Your feedback will be on the platform shortly. Take care, and goodbye."
FAILURES_TO_END = 3
TECHNICAL_AFTER_S = 90.0     # failed replies end the round only once they have gone on this long (a provider blip is not an ending)
RETRY_AFTER_FAILURE_S = 4.0  # a reply that failed is asked for again after this long
CANDIDATE_GONE_S = 120.0
CONNECTION_TROUBLE_S = 120.0  # after the candidate left the room or came back, the interviewer may say the line was bad for this long (decided 2026-10-18)
ABSENCE_VIOLATION_S = 20.0   # away at least this long (a refresh is quicker) counts as a full violation
# Browser integrity messages the worker does not act on yet (live-integrity plan 2). They parse, then are dropped here so
# a typing window every 5 s never wakes the director. (proctor.away and proctor.back drive the return clock since 2026-10-18.)
IGNORED_WEB_TYPES = frozenset({"typing.window"})
AWAY_WELCOME_GAP_S = 2.5      # after the welcome-back line, what was held waits this long so the two never start together
AWAY_PLAYBACK_GRACE_S = 2.0   # the voice never reported a warning finishing this long after it should have: the clock starts on its expected length
# A turn held back because it broke off mid-sentence ("...and the") gets "Mm-hmm." at once, as a listener nods, and is answered
# once they stay quiet this long: a live round held back a long introduction and left the candidate in silence for 35 s, and the
# 5 s that replaced it was still a long silence (decided 2026-10-17). One step of a walk-through waits longer: they are reading
# their code, and a reply two seconds into a pause would cut the walk-through short.
TRAIL_GRACE_S = 2.0
WALK_GRACE_S = 5.0
CONDUCT_CHECK_TEMPERATURE = 0.0     # (decided 2026-10-18) the conduct check judges one remark: no sampling noise, whatever the talker's temperature
BACKCHANNEL = LINES["backchannel"][0]      # the first wording of each fixed line (lines.py); the round says a random one, none twice until its pool is used up
# The interviewer started while they were still going and they cut it off this few words in, saying no more than YIELD_MAX_WORDS
# of their own: it spoke over them, and hands the floor back in fixed words, with no model (decided 2026-10-17).
CUT_SHORT_WORDS = 5
YIELD_MAX_WORDS = 3
YIELD_LINE = LINES["yield"][0]
LINE_CHECK_REPLY = LINES["line_check"][0]


def here_said(line: str) -> str:
    return (f'You have just said "{line}" in reply to their check that the line is working: do not say it again or ask whether '
            "they can hear you. Never put a problem up or say a put-up, intro or \"give it a read\" line, and never announce a move or a change of part. "
            "If a question of yours is still open, ask it again briefly in other words; otherwise stop.")


HERE_SAID = here_said(LINE_CHECK_REPLY)
_HEARING = re.compile(r"\b(?:hear|audible|audio|sound|mic)", re.IGNORECASE)
# While the candidate is answering a question just asked, only these start a turn of their own; any other order (an opening, a
# conduct warning, a timer) waits for their reply, or for ANSWER_WAIT_S of silence.
PUTS_PROBLEM_UP = re.compile(r"\blet me put the (?:first|second|third|next) (?:problem|one|question) on your screen\b", re.IGNORECASE)
_LINE_ORDINAL = re.compile(r"\b(first|second|third|fourth)\b", re.IGNORECASE)
SAID_WHILE_THEY_ANSWER = frozenset({"end", "final_warning", "mention_violation", "problem_line", "closing", "wrap_up_now", "hold"})
ANSWER_WAIT_S = 20.0
END_REQUEST_WATCHDOG_S = 8.0
START_CODING_QUIET_S = 60.0     # after they said they were about to write the code, no filler line for this long
DEAD_AIR_S = 7.0                # a candidate turn nobody has started answering this long is answered now (live round 781a1f0a, turn 10)
MERGE_WINDOW_S = 6.0            # a fragment whose reply was cut before audio is joined to the continuation spoken within this long (live round 781a1f0a, turns 24 and 26)
UNPLAYED_AFTER_S = 8.0          # a spoken turn the voice never confirmed, with the interviewer silent this long, was dropped before it played
PATIENCE_S = 25.0               # after a question, the interviewer does not ask again or probe this long while the candidate speaks or types (2026-10-21)
CODE_QUIET_S = 15.0             # while they have typed this recently, their talk is narration: no reply
BRIDGE_BREATH_S = 1.0          # a short breath before the sentence that moves on to the problem, so the change of stage is not abrupt
PROBLEM_LINE_PAUSE_S = 1.5     # between the screen changing and the line that invites them to read the problem
END_ORDER_GRACE_S = 20.0     # an ending the talker never got to say is carried out anyway this long after the floor was last free
AWAY_END_HARD_S = 2.0        # an ending caused by staying away is carried out this long after it was ordered, whatever the voice is still saying (owner 2026-10-21)
END_ORDER_HARD_S = 90.0      # ...and this long after it was ordered whatever the voice reports (a live round ended mid-reply at 20 s)
SCREEN_HOLD_MAX_S = 25.0     # screen changes wait for the voice to finish, but never longer than this
REPLY_RETRY_S = 3.0
REPLY_IN_FLIGHT_MAX_S = 60.0   # a reply still open after this long is taken for one the voice never closed: the ticker may speak again
TIME_TALK_LEFT_S = 300.0     # "we're nearly out of time" is only said with this little of the round left (or a part's time is up)
MUST_REPHRASE = ("(What you were about to say is not allowed at this point (it would announce something that is not ready or give "
                 "something away). Say something different instead: react to what they just said and ask a real question.)")
WARNED_SAID = ("You have just said the warning above, in fixed words, so it is said and done: say no warning of your own, never repeat it or "
               "mention the screen, the tab or leaving it, and never say it was not said. Answer only what they just said, in your own words, "
               "and carry on from there.")
MUST_NOT_REPEAT = ("(What you were about to say you have already said in this interview. Do not say it again in the same words: if it "
                   "still needs saying, put it differently; otherwise react to what they just said and move the conversation on with a real question.)")
MUST_NOT_REPEAT_QUIET = ("(What you were about to say you have already said in this interview. Say it again in different, shorter words and add "
                         "nothing else: no question and no instruction.)")
MUST_CONNECT = ("(What you were about to say is not allowed at this point. You are moving on to the coding problem: say only a short connecting "
                "phrase that links to what came before, then call next_item and show_problem if the problem is not up yet. Ask nothing: "
                "no question, nothing about the problem or their projects.)")
MUST_ANSWER = ("(You said nothing, and the candidate is waiting for you: reply now with at least one spoken sentence, "
               "acknowledging what they just said. Do not use <silent>.)")
MUST_ASK = ("(Your reply asked the candidate nothing. Add one short question now, about the area the live state says you are on now. "
            "Do not repeat anything you already said, and do not open with an acknowledgement.)")
SPEAK_ENGLISH = "Speak English only."
CONDUCT_CHECK_TIMEOUT_S = 2.0      # the check on the talker's chat (reasoning off) answers in ~0.8 s, worst seen 1.4 s
SAY_ALOUD = "Say only what you would say aloud to the candidate, in the second person; never your reasoning."
MUST_BE_SPECIFIC = "(Respond to what they said with something specific.)"
MUST_NOT_LOOP = ("(You have already asked them this, in other words, more than once and they have not answered it. Do not ask it again in any "
                 "wording and do not ask anything that comes to the same thing. React in one short sentence to what they just said or did, then "
                 "give them a minute and ask them to answer the question you already asked, without repeating it (for example \"Take your "
                 "minute, then give me your answer to the question I asked.\"), and stop.)")
MUST_SAY_ORDER = ("(You said nothing, and an order is waiting for you to speak: say it now, with at least one spoken sentence. If a tool was refused, "
                  "do not call it again: ask the next question of the part you are in instead.)")
MAX_TRACKED_ACTIONS = 60
# What the talker logs when it has decided to leave the current part. It sometimes says so and forgets the next_item call.
MOVE_ON_ACTIONS = frozenset({"acknowledge_move_on", "wrap_up_slot", "move_on"})
# Logged actions that stay on the current part: with no next_item and no words leaving it, a move_on in that turn was set aside.
# The decision a turn without log_turn is recorded with, by the tool it called (next_item is the plan's "move_on").
INFERRED_ACTIONS = {"next_item": "move_on", "go_to": "go_to", "skip_goal": "skip_goal", "open_thread": "open_thread",
                    "close_thread": "close_thread", "give_hint": "give_hint", "show_problem": "show_problem", "reveal": "reveal"}
FLOW_TOOLS = frozenset({"next_item", "go_to", "skip_goal", "open_thread", "close_thread"})
# A turn that made one of these work has already moved the plan or put the problem up (skip_goal drops a later part: not a move).
MOVING_TOOLS = frozenset({"next_item", "go_to", "close_thread", "open_thread", "show_problem"})
_HINT_LEADIN = re.compile(r"\b(?:let me|i'?ll|i will|allow me to)\s+(?:just\s+)?(?:give|offer|throw)\s+you\b[^.?!]*\b(?:nudge|hint|pointer|push)\b"
                          r"|\bone more (?:nudge|hint)\b|\bhere'?s (?:a|one more) (?:nudge|hint)\b", re.IGNORECASE)


def hint_leadin_only(spoken: list[str]) -> bool:
    """Everything said this turn is a promise of a hint (and acknowledgements): the hint itself has not been spoken."""
    sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+", " ".join(spoken)) if x.strip()]
    return any(_HINT_LEADIN.search(x) for x in sentences) and all(_HINT_LEADIN.search(x) or is_acknowledgement(x) for x in sentences)


STAY_ACTIONS = frozenset({"give_hint", "clarify", "probe_deeper", "ask_follow_up", "reframe", "redirect", "encourage", "ask_complexity",
                          "ask_dry_run", "decline_politely"})


def _strings(value: Any) -> list[str]:
    """Every string inside a nested dict or list (a problem's statement, examples and keys), to know which words are the problem's."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [x for v in value.values() for x in _strings(v)]
    if isinstance(value, (list, tuple)):
        return [x for v in value for x in _strings(v)]
    return []


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


# LiveKit's ChatMessage.metrics key (seconds) -> the field stored on the interviewer's turn (whole ms). The candidate's numbers
# (endpointing, final transcript) belong to the pause before this reply, so they are kept on the reply that answered it.
_TIMING_FIELDS = (("end_of_turn_delay", "endpointing_ms"), ("transcription_delay", "stt_final_ms"), ("llm_node_ttft", "llm_ttft_ms"),
                  ("tts_node_ttfb", "tts_ttfb_ms"), ("e2e_latency", "e2e_ms"))


def turn_timings(metrics: dict[str, Any] | None) -> dict[str, int]:
    """The pipeline timings of one reply for the stored turn, from the merged user + assistant metrics. Missing or odd values are left out."""
    out: dict[str, int] = {}
    try:
        for key, name in _TIMING_FIELDS:
            value = (metrics or {}).get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value < 3600:
                out[name] = int(value * 1000)
        # The turn detector's score for the candidate's turn (0-1, not a time): below the threshold it waited the long ceiling.
        for key in ("eot_probability", "eot_threshold"):
            value = (metrics or {}).get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1:
                out[key] = round(float(value), 3)
    except Exception:  # noqa: BLE001 - a timing must never cost the candidate their reply
        return {}
    return out


_SELECTED = re.compile(r"selected(?: text)? \u201c([^\u201d]+)\u201d")
_ASKS_ABOUT_SELECTION = re.compile(r"\b(?:highlighted|selected|selection|this (?:part|bit|line|sentence|portion|text|section)|that (?:part|bit|line|sentence|portion))\b", re.IGNORECASE)


def selection_asked_about(candidate_text: str, activity_text: str | None, ask: dict[str, Any] | None, highlights: list[str]) -> str:
    """The text of the problem they highlighted when this turn asks about it, else "". They ask about it when an Ask is set, when they say
    highlighted, selected or "this part", or when the activity resolved their words to the selected text. A live round blocked every
    explanation of the sentence they had highlighted, as the statement read aloud."""
    activity_text = activity_text or ""
    found = _SELECTED.findall(activity_text)
    chosen = (ask or {}).get("quote") or (found[-1] if found else "") or (highlights[-1] if highlights else "")
    asked = bool(ask) or bool(_ASKS_ABOUT_SELECTION.search(candidate_text or "")) or "\u2192 the selected text" in activity_text
    return chosen if chosen and asked else ""


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RunDeps:
    blueprint: dict[str, Any]
    context: dict[str, Any]
    talker_chat: Any
    director_chat: Any
    workspace: Any
    api: Any
    store: Any
    clock: Callable[[], float] = time.time
    first_token_timeout_s: float = 3.0
    rules: Rules | None = None
    fallback_chat: Any = None            # raced against a slow talker model (see talker.py)
    pacing: Pacing | None = None
    conduct_chat: Any = None             # the conduct check's chat; the director's when none is given
    addressed_mode: str = "off"          # "off" | "shadow" | "on" (setting ADDRESSED_CHECK); off keeps today's behaviour with no model call


class InterviewRun:
    def __init__(self, deps: RunDeps) -> None:
        self.d = deps
        self.session_id: str = deps.context["session_id"]
        self.candidate_id: str = deps.context["candidate_id"]
        self.skills: list[str] = (deps.context.get("profile") or {}).get("skills") or []
        self.round_seconds = round_seconds(deps.blueprint, deps.context)
        # Words the candidate gave (their name, their resume and profile): a name in another script is not the interviewer switching language.
        self.known_words = frozenset(re.findall(r"\w+", (str(deps.context.get("first_name") or "") + " "
                                                          + json.dumps(deps.context.get("profile") or {}, ensure_ascii=False)).lower()))
        self.conductor = Conductor(deps.blueprint, self.round_seconds, deps.rules, deps.clock, self.skills)
        self.wire = wire_ids(deps.blueprint)   # slot_id -> the id the browser sees
        self.guard = LeakGuard(deps.blueprint)
        self.tools = ToolExecutor(self)
        # The wait fillers are drawn at random from the persona's own wordings when the blueprint has them (seeded, so a rehearsal replays).
        self.talker = TalkerTurn(deps.talker_chat, self.guard, self.tools, deps.first_token_timeout_s,
                                 fallback=deps.fallback_chat, pacing=deps.pacing, on_slow=self._on_slow,
                                 fillers=Fillers(random.Random(f"fillers:{seed_of(deps.blueprint)}"), habits_of(deps.blueprint)))
        self._bind_lines()
        self._stale_rerun_for: int | None = None        # the position whose stale brief was already re-asked for (live round 781a1f0a)
        self.director = Director(deps.director_chat, self._director_messages, self._on_brief, self._on_director_failure)
        self.prefix = talker_prefix(deps.blueprint, deps.context)
        self.tracker = ActivityTracker(deps.clock)
        self.digests: list[dict[str, Any]] = []     # the stored digest of each turn, for the director (never raw events)
        self.last_activity: dict[str, Any] | None = None
        self._utterance: Utterance | None = None    # the candidate's last turn, waiting for its reply
        self.speaker: Any = None
        self.history: list[dict[str, Any]] = []
        self.transcript: list[dict[str, Any]] = []
        self.seq = 0
        self.summary = ""
        self.brief: dict[str, Any] | None = None
        self.brief_for: int | None = None       # the conductor position the brief was written for; it is shown only there
        self.ask: dict[str, Any] | None = None
        self.ask_for_turn: dict[str, Any] | None = None
        self._skip_why = ""                                      # why skip_reply last stayed silent (stored as `skip_reason`)
        self._trailed: tuple[str, float, float] | None = None   # a turn held back as unfinished, when, and how long to wait
        self.answer_late: str | None = None               # that turn, once they stayed quiet: the next reply answers it
        self._cut_short = False                           # they cut the interviewer's last turn off a few words in
        self.candidate_said: dict[str, str] = {}
        self.actions: dict[str, str] = {}          # workspace message id -> type, until its ack is reported to the talker
        self.code_seen: list[str] | None = None    # the code the talker was shown this turn (anchors refer to it)
        self.failures = 0
        self.first_failure_at: float | None = None   # when the current run of failed replies began
        self.failed_at: float | None = None          # when the last reply failed (cleared by the next one that works)
        self.tool_refused: list[dict[str, Any]] = []   # tool calls the plan refused last turn, told to the talker once
        self._merged: tuple[str, str] | None = None       # (continuation, fragment + continuation) while the reply to a cut fragment is owed
        self._cut_before_audio = False                    # the last assistant item was cut before any audio played (see on_conversation_item)
        self._request_routed = False                      # the last candidate fragment was routed as a request on the problem (see on_user_text)
        self.unanswered: str | None = None           # what the candidate said that has not been answered yet
        self._asked = ""                             # what the current reply answers
        self._greeted = False                        # the greeting has been said (no filler line ever precedes it)
        self.slow = False                            # the interviewer is taking longer than usual (shown on the page)
        self._room_sent: tuple[str, bool] | None = None
        self.finishing = False
        self._wrap_goodbye_said = False         # the wrap-up goodbye minimum fires once per round
        self.finished = asyncio.Event()
        self.turn_ended_at: float | None = None
        self.awaiting_audio: int | None = None
        self._unconfirmed: dict[int, dict[str, Any]] = {}   # turns spoken as far as we know, until the voice confirms each was played
        self._started_coding_at: float | None = None   # when they said they were about to write the code, until the interviewer speaks again
        self._skips = 0                               # replies skipped in a row because they were still talking
        self.loudness: Any = None                      # a loudness.CandidateLoudness fed from the candidate's microphone (worker.py); None when there is none
        self._last_ask_at = float("-inf")             # when the interviewer last asked a question that was said (patience before it asks again)
        self._code_at = float("-inf")                  # when their code last changed
        self._audio_base: float | None = None         # what first_audio_ms counts from: the candidate's last words, or the turn's own start
        self._owed_question = False                  # the last reply lost a sentence to a guard and asked them nothing: an acknowledgement next is an answer
        self._lines_spoken: set[int] = set()         # problem numbers whose put-up or intro line the candidate has heard (by any path)
        self._line_due: int | None = None            # the problem went up: its invitation to read is said once the screen has changed
        self._line_number: int | None = None         # which problem that line is for, fixed when it became due (the plan may move meanwhile)
        self.conduct_timeout_s = CONDUCT_CHECK_TIMEOUT_S
        self.conduct_check: dict[str, Any] = {}      # the last conduct check: verdict, reason, failed, ms
        self._change_pending: str | None = None      # their words asking for another problem, until a reply takes it to decide what the ask gets
        self._change_in_flight = False               # a reply has taken the ask and is deciding it: no other reply decides or applies it too
        self.change_decision: dict[str, Any] = {}    # that decision: action, source (model | fallback | prior | limit), ms, why (the model's reason, "" otherwise), allowed (sorted list)
        self.change_timeout_s = DECISION_TIMEOUT_S
        self._end_reply_at = float("-inf")           # when a reply carrying the end order last started: the ending's grace counts from it
        self.board_seen_by_director = ""
        self.ended_run: dict[str, Any] | None = None   # the saved run, when this interview already finished
        self.reply_requested_at = float("-inf")
        self._replies_open = 0                        # replies being generated now; the ticker starts no other while one is (decided 2026-10-18)
        self._reply_open_at = float("-inf")
        self._warned_now: list[tuple[str, str]] = []     # (order kind, what about) of the warnings the reply in progress says in fixed words
        self._brief_waiting: tuple[Brief, dict[str, Any]] | None = None     # a director brief that arrived while they were away
        self._back_until = float("-inf")                 # the welcome-back line was just said: held orders wait until then
        self._away_line: dict[str, Any] | None = None    # the warning that tells them to come back: when it was handed to the voice, how long it takes
        self.left_at: float | None = None
        self.connection_event_at: float | None = None      # when the candidate last dropped out of the room or came back
        self._left_task: asyncio.Task | None = None
        self._tasks: set[asyncio.Task] = set()
        self.begun = asyncio.Event()                  # the round has started (the candidate arrived); the greeting waits for it
        self._early: list[Any] = []                   # what the browser sent before then, handled in order once it has
        self.candidate_in_room = asyncio.Event()      # a candidate (not an interviewer) is in the room; the greeting waits for it too
        self._screen_held = False                     # a problem going up or a layout change waits until the voice has said its part
        self._screen_held_at = 0.0
        self._held_turn_over = False                  # the reply that is being held for has been fully generated
        self._spoke_while_held = False                # the voice has started on it
        # Who the candidate's words are for (decided 2026-10-19; addressed.py): the state across the round, the latest utterance's rule result and its
        # pending model check, and when the problem on screen went up.
        self.addressed = AddressedState()
        self._direct_sent = False                 # what the web page was last told (addressed.state); it starts as "not direct-only"
        self._addressed_now: tuple[str | None, asyncio.Task | None] = (None, None)
        self._addr_ctx: dict[str, Any] = {}
        self._problem_shown_at: float | None = None
        self._speech_start: float | None = None      # when the candidate began the utterance now being heard (the Ask arm is judged at its start)
        self._checkin_turn: int | None = None        # the turn that carries the check-in, until the voice confirms it was played (or it is dropped)

    def _bind_lines(self) -> None:
        """The talker draws its fallback lines from the conductor's picker (a restored conductor has a new one) and replaces a repeated opener
        with one of the persona's own acknowledgements."""
        self.talker.said.lines = self.conductor.lines
        self.conductor.lines.opener_of = turn_opener                 # a fixed line never opens the way the interviewer's last turn did
        self.conductor.lines.avoid = self._previous_openers
        self.talker.habit_acks = tuple(str(a) for a in (habits_of(self.d.blueprint) or {}).get("acks") or ())

    def _previous_openers(self) -> set[str]:
        """The opener of the interviewer's last turn (what the next fixed line must not open with)."""
        last = next((m["content"] for m in reversed(self.history) if m["role"] == "assistant"), "")
        opener = turn_opener(last.removesuffix(" (interrupted)")) if last else None          # a fixed line's opener counts too: it is what they heard
        return {opener} if opener else set()

    # ------------------------------------------------------------ lifecycle

    async def start(self, saved: dict[str, Any] | None) -> None:
        """Load or restore the round and start its clock. The worker calls this when the candidate arrives, not when the
        interviewer joins the room. An interview that had already finished never begins (it is never greeted again)."""
        await self._start(saved)
        if self.ended_run is not None:
            return
        self.begun.set()
        early, self._early = self._early, []
        for message in early:                          # no await inside on_web_message, so nothing can interleave
            await self.on_web_message(message)

    def set_candidate_in_room(self, present: bool) -> None:
        """The worker says whether a candidate is in the room. The interviewer speaks to no one: the greeting waits for this."""
        (self.candidate_in_room.set if present else self.candidate_in_room.clear)()

    async def _start(self, saved: dict[str, Any] | None) -> None:
        if saved and saved.get("ended_at"):
            # A re-dispatch into an interview that already finished (its end never reached the API, say): never run it
            # again. The worker repeats the ending (reaffirm_end) and leaves.
            self.ended_run = saved
            self.history = list(saved.get("history") or [])[-MAX_HISTORY:]
            return
        if saved and saved.get("checkpoint"):
            self.conductor = Conductor.restore(self.d.blueprint, self.round_seconds, saved["checkpoint"], self.d.rules,
                                               self.d.clock, self.skills)
            self.history = list(saved.get("history") or [])[-MAX_HISTORY:]
            self.talker.said.seed(m["content"] for m in self.history if m["role"] == "assistant" and not m["content"].endswith("(interrupted)"))
            self._bind_lines()
            self.talker.seed_openers([m["content"] for m in self.history if m["role"] == "assistant"])
            self.summary = saved.get("summary") or ""
            self.addressed = AddressedState.from_dict(saved.get("addressed"))
            ago = (saved.get("addressed") or {}).get("problem_shown_ago")
            if ago is not None:
                self._problem_shown_at = self.d.clock() - float(ago)       # the lean to "reading it aloud" counts from the put-up, across a restart
            # The crash can beat the last checkpoint: number new turns after every turn already stored.
            self.seq = max(int(saved.get("seq") or 0), await self.d.store.max_seq(self.session_id))
            self.d.workspace.restore_mirror(saved.get("mirror") or {})
            await self._sync_room_state()
            return
        await self.d.store.start_run({
            "session_id": self.session_id, "candidate_id": self.candidate_id,
            "blueprint_id": self.d.blueprint.get("blueprint_id"), "blueprint_version": self.d.blueprint.get("version"),
            "shape_id": (self.d.blueprint or {}).get("shape_id", "classic"),
            "talker_prefix": self.prefix, "started_at": _iso(),
            "models": {"talker": getattr(self.d.talker_chat, "model", None), "director": getattr(self.d.director_chat, "model", None)},
        })
        self.conductor.start()
        await self._sync_room_state()

    async def _sync_room_state(self) -> None:
        """Tell the page the layout (conversation full width until a problem needs the editor, and again for the
        closing) and whether the interviewer is slow. Sent whole, and only when it changed."""
        layout = "talk" if self.finishing or self.conductor.ended else layout_for(self.d.blueprint, self.conductor.current())
        state = (layout, self.slow)
        if state == self._room_sent:
            return
        self._room_sent = state
        try:
            await self.d.workspace.send({"type": "room.state", "layout": layout, "slow": self.slow})
        except Exception as exc:  # noqa: BLE001 - the layout is a nicety, it must never break the interview
            logger.warning("could not send the room state: %s", exc)

    def _on_slow(self, slow: bool) -> None:
        self.slow = slow
        self._spawn(self._sync_room_state())

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("interview task failed: %s", task.exception())

    def _can_speak(self) -> bool:
        return (not self.finishing and self.left_at is None and not self._reply_in_flight()
                and not self.conductor.agent_speaking and not self.conductor.candidate_speaking)

    def _reply_in_flight(self) -> bool:
        """A reply is still being generated. The voice is not "speaking" until its first audio, so the ticker saw a quiet interviewer, took
        the open_item order the reply's own go_to had just made for a new one and started a second reply beside the first: they shared the
        talker's per-turn state and the candidate heard the outline twice, in two wordings (live round bae894ce, turns 11 and 12)."""
        return self._replies_open > 0 and self.d.clock() - self._reply_open_at < REPLY_IN_FLIGHT_MAX_S

    def _speak_soon(self, force: bool = False) -> None:
        if self.speaker is None or not self._can_speak():
            return
        if self.conductor.away_paused() and not self.conductor.speakable_orders():
            return                                     # they are away: the interview is paused, only the away warnings and the ending are said (force too)
        if self.d.clock() < self._back_until:
            return                                     # the welcome-back line is playing: what was held follows on the next tick
        if not force and self.conductor.held() and not any(o.kind in HOLD_BREAKERS for o in self.conductor.pending_orders()):
            return                                     # they asked for a moment: nothing is said until they speak or it runs out
        if not force and self._waiting_for_their_answer() \
                and not any(o.kind in SAID_WHILE_THEY_ANSWER for o in self.conductor.speakable_orders()):
            return                                     # the question just asked is theirs to answer: the order goes in that reply
        self.reply_requested_at = self.d.clock()
        try:
            self.speaker.reply()
        except Exception as exc:  # noqa: BLE001 - a failed nudge must never break the ticker or an End request
            logger.warning("could not ask for a reply: %s", exc)

    def _waiting_for_their_answer(self) -> bool:
        """The last thing they heard asks them something and they have not spoken since. A live round asked "How would you approach
        this problem?" and 5.5 s later started a new turn for a warning, cutting off the answer. Not for ever: a candidate who stays
        quiet is not left waiting on an order."""
        if self.tracker.turn_open(self.d.clock()):
            return True                                # they are partway through saying something: never talk over it
        # A fixed violation mention asks nothing and does not take the question back: the one before it is still the one they owe an answer to.
        last = next((h for h in reversed(self.history) if not (h["role"] == "assistant" and is_violation_line(h["content"]))), None)
        if last is None or last["role"] != "assistant" or not awaiting_answer(last["content"].removesuffix(" (interrupted)")):
            return False
        return self.conductor.quiet_for_s() < ANSWER_WAIT_S

    def _recent_text(self) -> str:
        """The last two candidate turns and the last two interviewer turns: what a "let me stay on X" can truthfully link to."""
        said = lambda role: [h["content"].removesuffix(" (interrupted)") for h in self.history if h["role"] == role][-2:]  # noqa: E731
        return " ".join([*said("user"), *said("assistant")])

    def _said_since_played(self, candidate_text: str | None) -> str:
        """Everything the candidate said since the last interviewer turn that was actually played (unplayed turns are not in the transcript, and an
        empty one is skipped), plus the text being answered: an answer split by a turn they never heard, or a restatement of an earlier
        fragment, is still their own words (live round c8e70bb8, turns 15/19)."""
        parts: list[str] = []
        for x in reversed(self.transcript):
            if x["speaker"] == "interviewer":
                if x["text"]:
                    break
                continue
            parts.append(x["text"])
        parts.reverse()
        now = (candidate_text or "").strip()
        if now and not any(now in p for p in parts):
            parts.append(now)
        return " ".join(p for p in parts if p).strip()

    def _reports_a_test(self, text: str) -> bool:
        """The interviewer asked them to trace or run an input and this turn is their result (not a question)."""
        return "?" not in text and len(text.split()) >= 4 and asks_to_trace(self._last_interviewer_line())

    def _verdict_budget(self, candidate_text: str | None) -> bool:
        """The previous spoken interviewer turn opened with a verdict, so this reply carries none (rehearsals opened 37-48% of turns
        with one). Not when they asked anything, asked whether something is right, stated an assumption or reported a trace: a
        confirmation is the answer then. Neutral acknowledgements ("Okay", "Got it") never count."""
        text = candidate_text or ""
        if "?" in text or asks_if_right(text) or states_assumption(text) or self._reports_a_test(text):
            return False
        last = self._last_interviewer_line().strip()
        return opens_with_verdict(next(iter(re.split(r"(?<=[.?!])\s+", last)), ""))

    def _end_reason(self, default: str) -> str:
        """An ending already decided (misconduct, a violation) is never replaced by a later, milder one."""
        return self.conductor.end_reason or default

    # ------------------------------------------------------------ LiveKit-facing hooks

    def on_user_text(self, text: str) -> None:
        text = (text or "").strip()
        if not text or self.finishing or not self.begun.is_set():
            return
        now = self.d.clock()
        self._trailed = None                    # they spoke again: a held-back turn is part of this one now
        if not (is_acknowledgement(text) or is_line_check(text)):
            self.conductor.drop_resay()         # they carried on with something of their own: the turn they never heard is not owed
        self._started_coding_at = now if self._starts_coding_on_screen(text) else None
        # The reply to the last fragment was cut before any audio, so the candidate heard nothing and carried on: the two are one turn and
        # get one answer, not a reply to the tail alone ("Can you" ... "change it?", live round 781a1f0a, turns 24 and 26). The transcript
        # and the store keep both fragments as their own turns.
        joined = text
        if (self._cut_before_audio and self.history and self.history[-1]["role"] == "user"
                and self.turn_ended_at is not None and now - self.turn_ended_at <= MERGE_WINDOW_S):
            joined = self.history[-1]["content"] + " " + text
        merged_after_a_request = joined != text and self._request_routed
        self._cut_before_audio = False
        self._merged = (text, joined) if joined != text else None
        self.seq += 1
        item_id = self.conductor.current().item_id
        if self._merged is not None:
            self.history[-1] = {"role": "user", "content": joined}
        else:
            self.history.append({"role": "user", "content": text})
        self.transcript.append({"seq": self.seq, "speaker": "candidate", "text": text})
        self.candidate_said[item_id] = (self.candidate_said.get(item_id, "") + " " + text)[-4000:]
        self.ask_for_turn, self.ask = self.ask, None
        self.unanswered = joined
        self.conductor.reply_owed = True
        stale = self.conductor.on_candidate_turn(keeps_hold=is_line_check(text), text=joined)     # a check-in on their silence is moot now
        # A fragment that was already routed as a request is not routed again as part of the merged text: the reply to it was cut before any audio, so
        # the candidate has not heard that ask answered, and counting it twice granted the change on that first ask (final review, live round 781a1f0a).
        addressed_rule = self._classify_addressed(joined, item_id, now) if self.d.addressed_mode != "off" else None
        # Reading the problem aloud asks for nothing: "constraints" in a read-out is not a request to reveal them (mode on only). Thinking aloud still routes
        # every other request (a hint, a different problem): the rules never place an ask as thinking aloud, and a request is never lost.
        reading_aloud = self.d.addressed_mode == "on" and addressed_rule == "reading_problem"
        self._request_routed = False if merged_after_a_request else self._note_request(joined, reading=reading_aloud)
        self._note_abuse(joined)
        if asks_for_a_moment(text):
            self.conductor.hold()                      # "I want a minute to settle in": acknowledged, then quiet until they are back
        self.turn_ended_at = now
        try:
            self._utterance = self.tracker.take_turn(text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("activity turn ignored: %s", exc)
            self._utterance = None
        placed_by_rule = self._addr_ctx.get("result") is not None
        self._spawn(self.d.store.append_turn({"session_id": self.session_id, "candidate_id": self.candidate_id, "seq": self.seq,
                                              "speaker": "candidate", "text": text, "at": now, "item_id": item_id,
                                              "ask": self.ask_for_turn, **({"cancelled": [o.kind for o in stale]} if stale else {}),
                                              # placed by rule: known now, so it is stored with the turn (an update_turn on a turn not yet stored would be lost)
                                              **({"addressed": self._addressed_doc(self._addr_ctx)} if placed_by_rule else {})}))
        self._trigger_director()

    @staticmethod
    def _specific_ask(ctx: dict[str, Any]) -> bool:
        """On a direct-only item: a rule or model `to_interviewer` (the model's raw label counts whatever its confidence) or any ask cue."""
        return ctx.get("result") == "to_interviewer" or ctx.get("raw") == "to_interviewer" or has_direct_ask_cue(ctx.get("text") or "")

    def _item_direct_only(self) -> bool:
        return self.conductor.current().item_id in self.addressed.direct_only_items

    def _typing_recently(self) -> bool:
        return self.d.clock() - self._code_at < CODE_QUIET_S

    def _classify_addressed(self, text: str, item_id: str, now: float) -> str | None:
        """Who the words are for. The rules place most of them at once; what they cannot place goes to the model, as a task the reply awaits (mode on)
        or a record only (shadow). Returns the rule result (None while the model is still to say). `text` is the whole turn, a cut fragment joined to
        its continuation, the same words the reply and the request routing see."""
        st, item = self.addressed, self.conductor.current()
        self._addressed_now, self._addr_ctx = (None, None), {}
        level_db, volume = self._measure_volume()
        # The Ask button counts for words that BEGAN within its window: a press, a think and a long question still counts (the arm is judged at the start).
        began = min(now, self._speech_start) if self._speech_start is not None and now - self._speech_start <= 90.0 else now
        self._speech_start = None
        armed = st.ask_armed_until is not None and began < st.ask_armed_until
        source, result = "rules", None
        on_problem = item.kind == "slot"
        if st.checkin_at is not None and not armed:
            # Their words answer "is that one for me?"
            source = "checkin_reply"
            if answers_checkin(text) == "thinking":
                st.thinking_items.add(st.checkin_item or item_id)
                result = "thinking_aloud"
            else:
                result = "to_interviewer"
            st.checkin_at = None
        else:
            if armed:
                st.checkin_at = None                    # the button answers the check-in too: they are talking to the interviewer
            reading = on_problem and self._reading_the_problem(text, item)
            result = classify_by_rules(text, last_line=self._last_line_for_addressed(), reading=reading, typing=self._typing_recently(), ask_armed=armed,
                                       on_problem=on_problem, volume=volume)
        st.ask_armed_until = None                       # the button counts once
        if QUICK_QUESTION.search(text):
            st.ask_armed_until = now + ASK_ARMED_S      # "quick question" arms like the button: the question that follows is for the interviewer
        ctx: dict[str, Any] = {"seq": self.seq, "item_id": item_id, "result": result, "source": source, "confidence": 1.0 if result else None,
                               "ms": 0, "mode": self.d.addressed_mode, "text": text, "direct_only": item_id in st.direct_only_items,
                               "volume": volume, "level_db": level_db}
        self._addr_ctx = ctx
        if result is not None:
            self._addressed_now = (result, None)
            return result
        since = now - self._problem_shown_at if self._problem_shown_at is not None else None
        slot = (slot_by_id(self.d.blueprint, item.slot_id) or {}).get("problem", {}) if on_problem else {}
        content = slot.get("content") or {}
        excerpt = str(content.get("statement") or content.get("question") or "")
        recent = [x["text"] for x in self.transcript if x["speaker"] == "candidate"][-4:-1]
        overlaps = on_problem and self._shares_problem_words(text, item, 0.3)
        task = asyncio.create_task(self._model_addressed(ctx, last_line=self._last_line_for_addressed(), text=text, phase=item.phase,
                                                          problem_excerpt=excerpt, typing=self._typing_recently(), recent=recent, since_problem_s=since,
                                                          overlaps_problem=overlaps, on_problem=on_problem, volume=volume))
        self._tasks.add(task)
        task.add_done_callback(self._done)
        self._addressed_now = (None, task)
        return None

    def _measure_volume(self) -> tuple[float | None, str | None]:
        """(mean dBFS, quiet | normal | loud | None) of the utterance just finished, from the candidate's microphone; (None, None) when there is no meter,
        no frames or an error: the volume is then simply unknown."""
        if self.loudness is None:
            return None, None
        try:
            level, volume = self.loudness.measure()
            return (round(level, 1) if level is not None else None), volume
        except Exception as exc:  # noqa: BLE001
            logger.debug("loudness measure ignored: %s", exc)
            return None, None

    def _last_line_for_addressed(self) -> str:
        """The interviewer's last line that is not one of its own addressed remarks (the check-in "...for me?", the nudge, the reading nod): answering
        the check-in must not read as answering a question, and a later utterance is not an answer to a check-in the candidate already settled."""
        pool = {_norm(x) for key in ("addressed:checkin", "addressed:nudge", "addressed:reading") for x in LINES.get(key, ())}
        for h in reversed(self.history):
            if h["role"] != "assistant":
                continue
            content = h["content"].removesuffix(" (interrupted)")
            if _norm(content) not in pool:
                return content
        return ""

    @staticmethod
    def _addressed_doc(ctx: dict[str, Any]) -> dict[str, Any]:
        return {"result": ctx["result"], "source": ctx["source"], "confidence": ctx["confidence"], "ms": ctx["ms"], "mode": ctx["mode"],
                "direct_only": bool(ctx.get("direct_only")),
                **({"volume": ctx["volume"], "level_db": ctx.get("level_db")} if ctx.get("volume") or ctx.get("level_db") is not None else {})}

    async def _model_addressed(self, ctx: dict[str, Any], **facts: Any) -> None:
        started = time.monotonic()
        chat = self.d.conduct_chat or self.d.talker_chat
        raw: dict[str, str] = {}
        result, confidence, source = await classify_by_model(chat, raw=raw, **facts)      # never raises; bounded by its own timeout
        if ctx["item_id"] in self.addressed.thinking_items:
            if source == "model" and result in ("unclear", "thinking_aloud") and has_question_cue(facts.get("text") or ""):
                result = "to_interviewer"   # they said they were thinking on this problem, then asked something: a real ask, answered (never silenced)
            elif result == "unclear" and source == "model":
                result = "thinking_aloud"   # the model cannot tell and there is no ask: stay out of it (never for a failed check)
        ctx.update(raw=raw.get("label"), result=result, source=source, confidence=confidence, ms=int((time.monotonic() - started) * 1000))
        self._record_addressed(ctx)

    def _record_addressed(self, ctx: dict[str, Any]) -> None:
        self._spawn(self.d.store.update_turn(self.session_id, ctx["seq"], {"addressed": self._addressed_doc(ctx)}))

    async def _addressed_gate(self, candidate_text: str | None) -> tuple[str, str | None] | None:
        """Mode on, before the talker: ("silent", None) when the words were for nobody, ("checkin", line) when the interviewer asks once whether they
        were for it, None for a normal reply. A pending model check is awaited (its own timeout bounds the wait): the talker never runs beside it."""
        if self.d.addressed_mode != "on" or candidate_text is None:
            return None
        rule, task = self._addressed_now
        ctx = self._addr_ctx
        self._addressed_now, self._addr_ctx = (None, None), {}
        if not ctx or (rule is None and task is None):
            return None
        if (self.ask_for_turn is not None or self.conductor.pending_orders() or self._change_pending is not None or self.conductor.ended
                or is_line_check(candidate_text) or self._change_in_flight or self._owed_question or self._yields_floor(candidate_text)):
            return None
        if task is not None:
            await asyncio.shield(task)
        result, item_id, st = ctx["result"], ctx["item_id"], self.addressed
        if item_id in st.direct_only_items:
            # Questions were invited here (decided 2026-10-20): a specific ask is answered; everything else is murmur, with no check-in.
            return None if self._specific_ask(ctx) else ("silent", None)
        if result in ("reading_problem", "thinking_aloud"):
            return "silent", None
        if result != "unclear":
            return None
        if item_id in st.thinking_items and has_question_cue(ctx.get("text") or ""):
            return None            # they said they were thinking, then asked something: a real ask, answered (no check-in, no silence)
        if item_id in st.checkin_used:
            return None            # asked once on this problem: not asked again, and not silenced either (only "just thinking" does that): a normal reply
        if ctx.get("source") == "fallback" and has_question_cue(ctx.get("text") or ""):
            return None            # the model could not be asked and it reads like a question: answered, never checked in on or silenced
        # The check-in counts as asked now; the nudge clock and the "answers the check-in" state start when the voice confirms it played (see _checkin_played).
        st.checkin_used.add(item_id)
        st.checkin_item, st.nudged = item_id, False
        return "checkin", self.conductor.lines.pick("addressed:checkin")

    def _nod(self, key: str) -> bool:
        """A short remark from the line pool, said like a backchannel (not waited on, cut off when they go on). False when the voice is busy."""
        reply_coming = self.awaiting_audio is not None and self.d.clock() - (self._audio_base or 0.0) < UNPLAYED_AFTER_S
        backchannel = getattr(self.speaker, "backchannel", None)
        if backchannel is None or self.conductor.agent_speaking or self._screen_held or reply_coming:
            return False
        try:
            line = self.conductor.lines.pick(key)
            backchannel(line)
            if key == "addressed:nudge" and self.d.addressed_mode != "off" and is_invite(line):
                # A backchannel never reaches on_conversation_item: an inviting nudge ("let me know if...") turns direct-only on here. (The check-in
                # stays pending: the nudge is not an answer to it.)
                self.addressed.direct_only_items.add(self.conductor.current().item_id)
            return True
        except Exception as exc:  # noqa: BLE001 - a remark that can't be said is simply not said
            logger.warning("addressed remark failed: %s", exc)
            return False

    @staticmethod
    def _typing(activity: dict[str, Any] | None) -> bool:
        return bool(activity and "typed line" in (activity.get("text") or ""))

    def _note_request(self, text: str, reading: bool = False) -> bool:
        """A request on a problem the interviewer must not simply grant (a different problem, or something written in their editor) is
        handed to the conductor, which tells the talker what to do about it in this very reply. True when the text was routed as a request."""
        cur = self.conductor.current()
        if cur.kind != "slot" or not self.tools.in_play():      # (a question asked aloud has nothing on screen)
            return False
        try:
            if self.conductor.is_change_ask(text):
                if self.conductor.on_change_request():           # the reply decides what the ask gets (see _decide_change), before the talker speaks
                    self._change_pending = text
            elif asks_for_hint(text):
                self.conductor.on_hint_request()
            elif asks_interviewer_to_edit(text):
                self.conductor.on_edit_request()
            elif not reading and asks_for_constraints(text):          # (read out loud, "constraints" is the statement, not a request)
                self.conductor.on_reveal_request("constraints", asks_about_a_property(text))
            elif not reading and asks_for_format(text):
                self.conductor.on_reveal_request("format")
            elif self._asks_to_explain(text):
                self.conductor.on_explain_request()
            else:
                return False
            return True
        except Exception as exc:  # noqa: BLE001 - a request that can't be classified is simply answered like any other turn
            logger.warning("request ignored: %s", exc)
        return False

    def _asks_to_explain(self, text: str) -> bool:
        """An ask to explain the problem, or (once an explanation is on the screen) to have it shorter or simpler."""
        return asks_to_explain(text) or (self.conductor.current().item_id in self.conductor.explained and asks_for_simpler(text))

    def _note_abuse(self, text: str) -> None:
        """Swearing or a strong insult aimed at the interviewer ends the round at once (decided 2026-10-17). It is decided here, before the
        talker speaks: the talker's tools run after its words, so waiting for its flag meant a warning first and the ending 7 s later."""
        if directed_abuse(text) and not self.conductor.ended:
            self.conductor.on_conduct("abusive", text, f"candidate-turn-{self.seq}", "run")

    async def _decide_change(self) -> tuple[str, str, float, str, list[str]] | None:
        """What the candidate's ask for another problem gets (decided 2026-10-18), decided (here) and carried out (`_apply_change`) before the talker speaks: the conductor's hard
        limits say what is allowed, the model picks among it in one fast call (the persona's prior when it cannot, and always for a blueprint without a
        realism block, which keeps the old rule), and the order the action makes is what this reply then speaks (a resist) or the run carries out in fixed
        words (a change, the end of the coding). The ask is taken when the decision starts (an overlapping reply finds it gone and cannot apply it twice) and put back when that reply is cancelled mid-call, so the next one decides it.
        Returns (action, source, started, why, allowed), or None when nothing is allowed any more."""
        # The ask is taken here (decided 2026-10-18): a reply that overlaps this one finds nothing pending and so cannot decide and apply the same ask a second
        # time. A reply cancelled mid-call puts it back, so the next one decides it.
        if self._change_pending is None:
            return None                                                    # another reply has the ask (or there is none)
        text, self._change_pending = self._change_pending, None
        self._change_in_flight = True
        try:
            c = self.conductor
            allowed = c.allowed_change_actions()
            if not allowed or c.ended:
                return None
            cur = c.current()
            firmness, prior = c.change_stance()
            started = self.d.clock()
            refusals_problem = c.refusals.get(cur.item_id, 0)
            if c.policy_for(cur) != "decide":
                action, source, why = next(iter(allowed)), "policy", ""   # the round's pack settles it (never / on_no_example): the one allowed action, no call
            elif len(allowed) == 1:
                action, source, why = next(iter(allowed)), "limit", ""    # nothing to decide: no call
            elif not c.has_change_stance():
                action, source, why = fallback_action(prior, refusals_problem, allowed), "prior", ""      # an old blueprint: today's rule, no call
            else:
                chat = self.d.conduct_chat or self.d.talker_chat
                if hasattr(chat, "with_temperature"):
                    chat = chat.with_temperature(DECISION_TEMPERATURE)
                action, source, why = await decide_change(
                    chat, firmness=firmness, refusals_problem=refusals_problem, refusals_round=c.refusals_round(), changes_round=c.changes_round,
                    candidate_text=text, attempted=bool(cur.coded), minutes_left=c.minutes_left(), allowed=allowed, timeout_s=self.change_timeout_s,
                    refusals_prior=prior)
            return action, source, started, why, sorted(allowed)
        except asyncio.CancelledError:
            if self._change_pending is None:
                self._change_pending = text
            raise
        except Exception as exc:  # noqa: BLE001 - a decision that cannot be made leaves the ask unanswered, like a request that cannot be classified
            logger.warning("change decision failed: %s", exc)
            return None
        finally:
            self._change_in_flight = False

    def _apply_change(self, decision: tuple[str, str, float, str, list[str]] | None) -> None:
        """Carry out the decision. The round may have ended or moved while the call ran (the conduct check runs beside it), so what is allowed is read
        again by the conductor: an ending the check issued stops the change."""
        if decision is None:
            return
        action, source, started, why, allowed = decision
        try:
            if self.conductor.apply_change_action(action) is not None:
                # why and allowed are kept for the trace (decided 2026-10-18 after live round 781a1f0a): what the model gave as its reason, and what it could pick from.
                self.change_decision = {"action": action, "source": source, "ms": int((self.d.clock() - started) * 1000), "why": why, "allowed": allowed}
        except Exception as exc:  # noqa: BLE001 - a change that cannot be carried out is simply not made: the reply goes on like any other turn
            logger.warning("change not applied: %s", exc)

    CONDUCT_SCHEMA = {"type": "object", "properties": {"verdict": {"type": "string", "enum": ["abuse", "rude", "none"]}, "reason": {"type": "string"}},
                      "required": ["verdict", "reason"]}

    async def _check_conduct(self, text: str) -> None:
        """A turn the broad screen caught is judged by the model before the reply is made (decided 2026-10-18: a candidate can say anything,
        so no list of phrases is enough). Abuse ends the round with the fixed line, rude words get the warning order on this reply, and a
        check that fails or times out leaves the regex's decision (already taken in on_user_text)."""
        # The talker's chat: reasoning off answers in ~0.8 s; the director's (reasoning on) timed out on 19 of 32 probes at 1.5 s.
        chat = self.d.conduct_chat or self.d.talker_chat
        if hasattr(chat, "with_temperature"):
            chat = chat.with_temperature(CONDUCT_CHECK_TEMPERATURE)         # a classifier, not speech: the talker's 0.7 would make its verdicts vary
        started = self.d.clock()
        record: dict[str, Any] = {"verdict": None, "reason": "", "failed": False, "ms": None}
        self.conduct_check = record
        messages = [{"role": "system", "content": CONDUCT_CHECK_PROMPT},
                    {"role": "user", "content": f'Interviewer\'s previous line: "{self._last_interviewer_line()}"\nCandidate: "{text}"'}]
        try:
            data, _ = await asyncio.wait_for(chat.json(messages, "conduct_check", self.CONDUCT_SCHEMA, 60), self.conduct_timeout_s)
            kind = str(data.get("verdict") or "").lower()
            if kind not in ("abuse", "rude", "none"):
                raise LLMUnavailable(f"unusable verdict: {kind!r}")
            record["verdict"], record["reason"] = kind, str(data.get("reason") or "")[:200]
        except Exception as exc:  # noqa: BLE001 - a check that cannot run never blocks the reply
            record["failed"] = True
            record["reason"] = f"{type(exc).__name__}: {exc}"[:200]
            logger.warning("conduct check failed: %s", record["reason"])
        record["ms"] = int((self.d.clock() - started) * 1000)
        turn_id = f"conduct-check-{self.seq}"
        if record["verdict"] == "abuse" and not aimed_at_them(text):
            record["verdict"], record["reason"] = "rude", "abuse not aimed at the interviewer: warned, not ended. " + record["reason"]
        if record["verdict"] == "abuse":
            self.conductor.on_conduct("abusive", text, turn_id, "model")
        elif record["verdict"] == "rude":
            self.conductor.on_conduct("inappropriate", text, turn_id, "model")

    def skip_reply(self, text: str) -> bool:
        """True when the candidate only acknowledged ("okay", "got it") something that was not a question: a real interviewer says nothing
        and lets them carry on. Never when an order is waiting to be spoken or they are asking about something on their screen."""
        if self.finishing or self.conductor.ended or self.ask_for_turn is not None or self.conductor.pending_orders() or self._change_pending is not None \
                or self._change_in_flight or self._owed_question:
            return False                        # (an owed question: the last reply held something back and asked them nothing, so "yes" answers it)
        if self._yields_floor(text):
            return False                        # the reply hands the floor back: see reply
        last = self._last_interviewer_line()
        placed = self._addressed_now[0] if self.d.addressed_mode == "on" else None
        if placed == "to_interviewer":
            return False                        # for the interviewer (an Ask press, a request, an answer): a normal reply, never skipped, typing or not
        direct = self.d.addressed_mode == "on" and self._item_direct_only()
        # The model has yet to place it. Words with an ask cue are never narration (typing or not): the gate checks in or answers. On an item where
        # the interviewer invited questions the gate alone decides, apart from acknowledgements ("okay") and "writing it now", which stay quiet.
        gate_decides = self.d.addressed_mode == "on" and placed is None and (direct or has_question_cue(text))
        if placed in ("reading_problem", "thinking_aloud") and not says_done_coding(text):
            # For nobody (decided 2026-10-19): no cap on how many in a row, and no late answer to it. Reading the problem gets one nod per problem
            # (none on an item where questions were invited: there everything but a specific ask is silence).
            if (placed == "reading_problem" and not direct and self._addr_ctx.get("item_id") not in self.addressed.reading_said
                    and self._nod("addressed:reading")):
                self.addressed.reading_said.add(self._addr_ctx["item_id"])
        elif needs_no_reply(text, last) or self._starts_coding_on_screen(text):
            self._skip_why = "ack" if needs_no_reply(text, last) else "starting_to_code"
            pass                                # "okay, writing it now": a real interviewer lets them type, as the gold transcript does
        elif gate_decides:
            # Only a sentence that breaks off is held (and answered late if it was a question: tick -> _for_nobody); never on a direct-only item, never
            # as typing narration.
            if direct or self._skips >= 2 or not self._trails_whole(text):
                return False
            self._skips += 1
            self._trailed = (text, self.d.clock(), TRAIL_GRACE_S)
            self._skip_why = "trailing"
            if self.d.clock() - self._code_at >= CODE_QUIET_S:
                self._backchannel()
        elif self._skips < 2 and self._still_talking(text, last):
            self._skips += 1                    # never more than two in a row: a candidate who has stopped is not left in silence
            if self._skip_why == "typing":
                # Narration while typing is skipped, but never stranded: if they stay quiet CODE_QUIET_S after the last keystroke it is answered once
                # (the tick takes `_trailed`; a keystroke re-arms it, and any new utterance clears it).
                self._trailed = (text, self._code_at, CODE_QUIET_S)
            elif self.d.clock() - self._code_at >= CODE_QUIET_S:
                # Not typing: they hear that they were heard, and if they stay quiet, this turn is answered.
                self._trailed = (text, self.d.clock(), TRAIL_GRACE_S if trails_off(text) else WALK_GRACE_S)
                self._backchannel()
        else:
            return False
        self._cut_short = False
        self.unanswered, self.conductor.reply_owed = None, False
        self._record_skip(self._skip_why or placed or "skipped")
        return True

    def _record_skip(self, why: str) -> None:
        """Why this candidate turn got no reply, stored on the turn (so a trace shows silence was a decision, not a loss)."""
        self._skip_why = ""
        self._spawn(self.d.store.update_turn(self.session_id, self.seq, {"skip_reason": why}))

    def _starts_coding_on_screen(self, text: str | None) -> bool:
        """They say they are about to write the code and the problem is on their screen: nothing to answer."""
        return says_starting_to_code(text or "") and self.conductor.current().kind == "slot" and self.tools._on_screen()

    def _yields_floor(self, text: str | None) -> bool:
        """They cut the interviewer off a few words in and said only a word or two, not a question: it spoke over them."""
        words = (text or "").split()
        return (self._cut_short and 0 < len(words) <= YIELD_MAX_WORDS and "?" not in (text or "") and not is_line_check(text or "")
                and not any(o.kind in SAID_WHILE_THEY_ANSWER for o in self.conductor.pending_orders()))

    def _backchannel(self) -> None:
        reply_coming = self.awaiting_audio is not None and self.d.clock() - (self._audio_base or 0.0) < UNPLAYED_AFTER_S
        if self.speaker is None or self.conductor.agent_speaking or self._screen_held or reply_coming:
            return                              # the voice is busy, or a reply is about to play: a nod would talk over it
        backchannel = getattr(self.speaker, "backchannel", None)
        if backchannel is None:
            return
        try:
            backchannel(self.conductor.lines.pick("backchannel"))
        except Exception as exc:  # noqa: BLE001 - a nod that can't be said is simply not said
            logger.warning("backchannel failed: %s", exc)

    def _question_open(self) -> bool:
        """Their answer to the interviewer's last question is still owed (they have not spoken since it was asked). A live round
        warned about a tab switch after asking about sprints; the warning asked nothing, a follow-up was ordered at once, and the
        interviewer moved on to the coding before the candidate had answered."""
        for x in reversed(self.transcript):
            if x["speaker"] == "candidate":
                return False
            if addresses_the_candidate(x["text"]):
                return True
        return False

    def _last_interviewer_line(self) -> str:
        return next((h["content"] for h in reversed(self.history) if h["role"] == "assistant"), "").removesuffix(" (interrupted)")

    def _reading_the_problem(self, text: str, item) -> bool:
        """The candidate is reading the problem on their screen aloud (or working it over to themselves): most of what they say is the problem's own
        words. It is no answer and no question, so the interviewer lets them read (live round 6eeb5dae: a read-aloud was answered, and it set off the constraints)."""
        if "?" in text or not self.tools._on_screen():
            return False
        return self._shares_problem_words(text, item, 0.6)

    def _shares_problem_words(self, text: str, item, fraction: float) -> bool:
        """At least `fraction` of the words they said (4 or more distinct) are the problem's own."""
        content = (slot_by_id(self.d.blueprint, item.slot_id) or {}).get("problem", {}).get("content") or {}
        shown = echo_stems(" ".join(str(x) for x in (content.get("statement") or content.get("question") or "", " ".join(str(c) for c in content.get("constraints") or []),
                                                    json.dumps(content.get("examples") or []))))
        said = echo_stems(text)
        return len(said) >= 4 and len(said & shown) >= fraction * len(said)

    @staticmethod
    def _trails_whole(text: str) -> bool:
        return trails_off(text) and not (_CONCLUDES.search(text) or asks_for_help(text) or asks_to_change_problem(text))

    def _still_talking(self, text: str, last: str) -> bool:
        """The candidate is partway through something: a sentence that breaks off, one more step of a walk-through they were asked for,
        or narration while they type. A person nods and waits; a reply now would be talked over or thrown away."""
        if says_done_coding(text):
            return False                 # "I have typed the solution" hands over: never narration (live round b6280b69, turn 19)
        if self._trails_whole(text):
            self._skip_why = "trailing"
            return True                  # ("That's all", "I'm done with this", "Can we end this" end on a dangling word but are whole)
        item = self.conductor.current()
        if item.kind != "slot":
            return False
        if narrating_a_walkthrough(text, last):
            self._skip_why = "walkthrough"
            return True
        if self._reading_the_problem(text, item):
            self._skip_why = "reading"
            return True
        typing = self.d.clock() - self._code_at < CODE_QUIET_S
        if typing and len(text.split()) >= 4 and not asks_for_help(text) and not awaiting_answer(last):   # an answer to what they asked is never skipped
            self._skip_why = "typing"
            return True
        return False

    def on_conversation_item(self, role: str, text: str, interrupted: bool, metrics: dict[str, Any] | None = None) -> None:
        if role != "assistant":
            return
        if not (text or "").strip():
            if interrupted:
                # Cut before any audio: LiveKit reports an empty interrupted item, which was ignored, so the candidate never heard the turn
                # and nothing noticed (live round 781a1f0a, turn 9). Every turn still waiting for confirmation was never played.
                self._cut_before_audio = True
                for t in sorted(self._unconfirmed):
                    self._drop_unplayed(t)
            return
        self._cut_before_audio = False
        self._started_coding_at = None            # the interviewer has spoken since: the quiet is over
        self.history.append({"role": "assistant", "content": text.strip() + (" (interrupted)" if interrupted else "")})
        self.history = self.history[-MAX_HISTORY * 2:]
        if self.d.addressed_mode != "off" and is_invite(text):
            # The interviewer invited questions on this item ("let me know if..."): from here only a specific ask is answered there (direct-only, 2026-10-20).
            self.addressed.direct_only_items.add(self.conductor.current().item_id)
            self.addressed.checkin_at = None
        key = _norm(text)[:24]
        hit = next((t for t, u in sorted(self._unconfirmed.items()) if key and u["key"] == key), None)
        if hit is None and self._unconfirmed:
            hit = min(self._unconfirmed)
        if hit is not None:
            for t in [t for t in sorted(self._unconfirmed) if t < hit]:
                self._drop_unplayed(t)            # a later turn was played, so an earlier one never was: the voice speaks in order
            u = self._unconfirmed.pop(hit, None)
            if hit == self._checkin_turn:
                self._checkin_played()
            timings = turn_timings(metrics) if u is not None else {}
            if timings:
                self._spawn(self.d.store.update_turn(self.session_id, hit, timings))
            if u is not None and interrupted:
                self._cut_off(hit, u, text.strip())

    def _checkin_played(self) -> None:
        """The voice played the check-in ("is that one for me?"): from now their next words answer it, and the 10 s of quiet before the one nudge count from here."""
        self._checkin_turn = None
        self.addressed.checkin_at, self.addressed.nudged = self.d.clock(), False

    def _cut_off(self, turn: int, u: dict[str, Any], heard: str) -> None:
        """The voice was interrupted partway through this turn: only what was played counts as said. The rest may be said again
        (the repeat guard would otherwise hold back a question they never heard), the outline is not given if its sentence was cut,
        and the record keeps what they heard next to what was meant."""
        intended = " ".join(u.get("spoken") or [])
        if _norm(heard) == _norm(intended):
            return                                  # cut at the very end: they heard all of it
        logger.info("turn %s was cut off; heard %r of %r", turn, heard, intended)
        self._cut_short = len(heard.split()) <= CUT_SHORT_WORDS
        if "?" not in heard:
            self.conductor.forget_ask(turn)           # cut before its question was said: not heard, not counted
        self.talker.said.keep_only(str(turn), heard)
        if u.get("covered"):
            # Only what they heard counts: a promise this turn covered stays covered only if the part they heard still asks about it.
            self.conductor.reopen([p for p in u["covered"] if not self.conductor.still_covers(heard, p)])
        if u.get("outline") and not gives_outline(heard):
            self.conductor.outline_said = False
            self.conductor.format_confirm_asked = False
        elif u.get("outline") and not asks_format_check(heard):
            self.conductor.format_confirm_asked = False       # the outline was heard, the check on it was not
        for x in self.transcript:
            if x["seq"] == turn and x["speaker"] == "interviewer":
                x["text"] = heard
        self._spawn(self.d.store.update_turn(self.session_id, turn, {"heard": heard, "cut_off": True}))

    def _drop_unplayed(self, turn: int) -> None:
        """A turn the voice never played (the candidate carried on talking before it started): the candidate did not hear it, so
        nothing it set in motion counts as said, and what it was ordered to say is ordered again."""
        u = self._unconfirmed.pop(turn, None)
        if u is None:
            return
        logger.warning("turn %s was never played to the candidate; asking for it again", turn)
        self.talker.said.forget(str(turn))
        self.conductor.forget_warnings(turn)
        self.conductor.forget_ask(turn)          # a question the candidate never heard is not an ask they ignored
        if turn == self._checkin_turn:
            # The check-in was never heard: it is not spent (it may be asked on this problem again), and there is nothing to nudge or to answer.
            self._checkin_turn = None
            self.addressed.checkin_used.discard(self.addressed.checkin_item or "")
            self.addressed.checkin_at, self.addressed.checkin_item = None, None
        if self._away_line is not None and self._away_line["turn"] == turn:
            self._away_line = None
        cur = self.conductor.current()
        opened = cur.kind == "slot" and self.tools.in_play()          # the problem this turn opened is on their screen (or was asked aloud)
        for o in u["orders"]:
            if o.kind == "open_item" and opened:
                # The problem is up already: saying the opening again would restate what the candidate has since carried on from and add a second
                # bridge (live round c8e70bb8, turns 15-19). The order is spent; the invitation to read it is what they may not have heard.
                o.consumed = True
                continue
            # An ending is carried out whether or not it was heard, and a part's timer order was already acted on (the plan moved):
            # re-arming it would move the plan again. The other orders (a warning, an opening) are said again.
            if o.kind == "drop_question" and self.conductor.ask_streak < 3:
                continue                                      # the heard asks no longer make three: the order is not said again
            if o.kind != "end" and o.kind not in TIMER_ORDERS and not (o.kind == "skip_notice" and (self.conductor.ended or self.conductor.current().phase == "wrap_up")):
                o.consumed = False
        if opened and any(o.kind == "open_item" for o in u["orders"]):
            number = self.conductor.problem_number()
            self._lines_spoken.discard(number)               # the put-up line was never heard: the line that invites them to read it covers both
            if self._line_due is None:
                self._line_due = number
                self._spawn(self._say_problem_line())
        if u["outline"]:
            self.conductor.outline_said = False
            self.conductor.format_confirm_asked = False
        self.conductor.reopen(u.get("covered") or [])        # what they never heard asked is still owed
        if any(o.kind == "keep_problem" for o in u["orders"]) and u.get("item_id") in self.conductor.refusals:
            # A refusal they never heard must not count toward the ceiling of 3 (final review, live round 781a1f0a): it is taken back, never below 0.
            self.conductor.refusals[u["item_id"]] = max(0, self.conductor.refusals[u["item_id"]] - 1)
        if u.get("paused"):
            self.conductor.hold_until = 0.0       # a pause they never heard granted is not one they are taking
        self.transcript = [x for x in self.transcript if not (x["seq"] == turn and x["speaker"] == "interviewer")]
        self._spawn(self.d.store.update_turn(self.session_id, turn, {"spoken": False}))
        text = " ".join(u.get("spoken") or [])
        if text and addresses_the_candidate(text) and not self.finishing and not self.conductor.ended \
                and not any(x["speaker"] == "interviewer" and x["seq"] > turn for x in self.transcript) \
                and not any(k > turn for k in self._unconfirmed) \
                and not any(x["speaker"] == "candidate" and x["seq"] > turn and not (is_acknowledgement(x["text"]) or is_line_check(x["text"]))
                            for x in self.transcript):
            # A sweep-driven drop can come long after a substantive candidate turn, which already moved past the question (final review, live round 781a1f0a).
            # A question they never heard is asked again in the next reply: otherwise they answered into silence (live round 781a1f0a).
            self.conductor.resay(text)
        if self.conductor.urgent_pending():
            self._speak_soon()

    def on_agent_state(self, state: str) -> None:
        speaking = state == "speaking"
        if speaking and self.awaiting_audio is not None and self._audio_base is not None:
            seq, self.awaiting_audio = self.awaiting_audio, None
            self._spawn(self.d.store.update_turn(self.session_id, seq, {"first_audio_ms": int((self.d.clock() - self._audio_base) * 1000)}))
        self.conductor.set_agent_speaking(speaking)
        self._away_clock_started(speaking)
        if self._screen_held:
            if speaking:
                self._spoke_while_held = True
            elif self._held_turn_over and self._spoke_while_held:
                self._spawn(self._release_screen())

    def _away_clock_started(self, speaking: bool) -> None:
        """The voice has played the warning that told them to come back: the return clock (now from the episode start) is unaffected. A change of state before the
        line was handed to the voice is the turn before it, not this."""
        line = self._away_line
        if line is None or self.d.clock() < line["at"]:
            return
        if speaking:
            line["playing"] = True
        elif line["playing"]:
            self._away_line = None
            self.conductor.start_return_clock(self.d.clock())

    def _hold_screen(self) -> None:
        """What the candidate sees (the problem, the layout) follows the voice: it is kept back until the interviewer has finished speaking."""
        hold = getattr(self.d.workspace, "hold", None)
        if hold is None:
            return
        hold()
        self._screen_held, self._screen_held_at = True, self.d.clock()
        self._held_turn_over = self._spoke_while_held = False

    async def _release_screen(self) -> None:
        if not self._screen_held:
            return
        self._screen_held = False
        try:
            await self.d.workspace.release()
        except Exception as exc:  # noqa: BLE001 - the screen must never stay frozen because one send failed
            logger.warning("could not show the held screen changes: %s", exc)
        if self._line_due is not None:
            self._spawn(self._say_problem_line())

    def _note_problem_line(self, text: str) -> None:
        """Record which problem's put-up or intro line these words said, whoever said them (the talker or the run's own fixed lines)."""
        if not (says_the_problem_line(text) or PUTS_PROBLEM_UP.search(text) or put_up_ordinals(text)):
            return
        said = _LINE_ORDINAL.findall(text)
        if said:
            self._lines_spoken.add(("first", "second", "third", "fourth").index(said[-1].lower()) + 1)
            return
        c = self.conductor
        cur = c.current()
        at = c.index if cur.kind == "slot" and cur.status == "pending" else next(
            (n for n in range(c.index + 1, len(c.items)) if c.items[n].kind == "slot" and c.items[n].status == "pending"), c.index)
        self._lines_spoken.add(c.problem_number(at))

    def _show_the_problem_already_introduced(self, turn: int, item_id: str, result, failed: bool, started: float) -> None:
        """The plan became current on a problem whose put-up line was already spoken (the talker said it in words and the move came only
        afterwards, b6b unplanned_story seq 25-26): show the problem with no new words and spend the order that would say it again."""
        cur = self.conductor.current()
        if (result.interrupted or failed or self.conductor.ended or cur.kind != "slot" or cur.item_id == item_id
                or self.conductor.problem_number() not in self._lines_spoken or not self.conductor.problem_allowed()):
            return
        if self.tools.shows_card() and not self.tools._on_screen():
            self._spawn(self.tools.execute(ToolCall(id="line-said", name="show_problem", arguments={}), str(turn)))
        self.conductor.consume([o for o in self.conductor.pending_orders() if o.kind == "open_item" and o.at >= started])

    async def _say_problem_line(self) -> None:
        """The screen has just changed: a short pause, then the one line that invites them to read the problem."""
        number, self._line_due = self._line_due, None
        await asyncio.sleep(PROBLEM_LINE_PAUSE_S)
        if number is None or self.finishing or self.conductor.ended or not self.tools._on_screen():
            return
        self._line_number = number              # the line names this problem, whatever the plan does meanwhile
        self.conductor.add_problem_line(number)
        self._speak_soon()                      # when the voice or the candidate is busy the ticker speaks it as soon as it can

    def _deep_dive_exhausted(self) -> bool:
        """The deep dive promised areas and every one is done or dropped: a reply that asked nothing there is not pushed into another question about
        a closed area ("That's fine, no problem." after an "I don't know.", final review, live round 781a1f0a)."""
        c = self.conductor
        return c.current().phase == "deep_dive" and bool(c.promises) and c.focus_promise() is None

    def _focus_keys(self) -> dict[str, Any]:
        """The deep dive's focus area and the one after it, as promise keys for the pool the talker is shown (absent without promises)."""
        if not self.conductor.promises:
            return {}
        focus = self.conductor.focus_promise()
        order = promises_of(self.d.blueprint)
        later = [p for p in order[order.index(focus) + 1:] if self.conductor.promises.get(p) != "dropped"] if focus in order else []     # a dropped area is never next
        return {"focus": focus, "focus_next": later[0] if later else None}

    def _focus_label(self, after: bool = False) -> str | None:
        """The promised area the deep dive is on (or the one after it), worded for the interviewer; None when there is none."""
        focus = self.conductor.focus_promise()
        if focus is None or not self.conductor.promises:
            return None
        if not after:
            return promise_words(focus)
        order = promises_of(self.d.blueprint)
        later = [p for p in order[order.index(focus) + 1:] if self.conductor.promises.get(p) != "dropped"] if focus in order else []
        return promise_words(later[0]) if later else None

    def on_user_state(self, state: str) -> None:
        self.conductor.set_candidate_speaking(state == "speaking")
        if state == "speaking" and self._speech_start is None:
            self._speech_start = self.d.clock()          # (the Ask arm is judged at the start of what they say, not its end)
        if state == "speaking" and self.loudness is not None:
            try:
                self.loudness.speech_started()           # their level for this utterance is measured from here to the final transcript
            except Exception as exc:  # noqa: BLE001 - loudness is evidence, never required
                logger.debug("loudness start ignored: %s", exc)

    def on_user_transcript(self, text: str, is_final: bool, created_at: float) -> None:
        """An interim or final speech-to-text update: stamps the candidate's words for the activity digest."""
        try:
            self.tracker.on_transcript(text, is_final, created_at)
        except Exception as exc:  # noqa: BLE001 - activity is context, it never breaks the interview
            logger.warning("activity transcript ignored: %s", exc)

    def _ingest_activity(self, message) -> None:
        try:
            self.tracker.ingest_batch(message)
        except Exception as exc:  # noqa: BLE001
            logger.warning("activity batch ignored: %s", exc)

    def _digest(self, spoken: bool):
        """The activity around the candidate's last utterance (or since they last spoke, for a turn with no speech), or
        None when there is none or it can't be built."""
        utterance, self._utterance = self._utterance, None
        try:
            now = self.d.clock()
            digest = digest_for_utterance(self.tracker, utterance, now) if spoken and utterance is not None else digest_idle(self.tracker, now)
        except Exception as exc:  # noqa: BLE001
            logger.warning("activity digest failed: %s", exc)
            return None
        return digest if digest.text else None

    # ------------------------------------------------------------ the talker's turn

    def _view(self, orders: list[Order], refused: list[dict[str, Any]], activity: str | None = None) -> dict[str, Any]:
        now = self.d.clock()
        item = self.conductor.current()
        code = getattr(self.d.workspace, "code", None)
        keeping = any(o.kind == "keep_problem" for o in orders)
        next_part = self._next_part()
        return {
            "round_elapsed_min": int((now - (self.conductor.started_at or now)) / 60), "round_min": int(self.conductor.planned_seconds()) // 60,
            # What the part is opened with and what really comes after it: the details never assume the arc's order.
            "item": {"item_id": self.conductor.public_id(item), "internal_id": item.item_id, "kind": item.kind, "phase": item.phase, "slot_id": item.slot_id,
                     "style": self.conductor.style_of(item), "outline_said": self.conductor.outline_said,
                     "next_phase": None if next_part is None else ("resume" if next_part.get("resume") else next_part["phase"]),
                     "problem_number": self.conductor.problem_number(), "put_up": self.conductor.put_up_line(self.conductor.problem_number()),
                     "shown": item.kind == "slot" and (self._on_screen(item)["problem_shown"] or self.conductor.is_opened_aloud(item)),
                     "aloud": item.kind == "slot" and not self.conductor.words_for(item)["on_screen"], "culture": self.conductor.is_culture(item),
                     "elapsed_min": int((now - (item.started_at or now)) / 60), "max_min": max(1, item.max_seconds // 60),
                     "hint_step": item.hint_step, "filler": item.filler, "title": item.title, "why": item.why,
                     "codes": self.conductor._codes(item), "hide_ladder": keeping, **self._focus_keys()},
            # The round's own words for the item (round packs): "coding problem" / "design question" / "question", and its part.
            "words": self.conductor.words_for(item), "noun": self.conductor._noun(item), "part": self.conductor._part_name(item), "gated": self.conductor._gates(),
            "goals": self.conductor.goal_map(), "free_min": self._free_min(),
            "promises": ({"open": [promise_words(p) for p in self.conductor.uncovered()],
                          "covered": [promise_words(p) for p, st in self.conductor.promises.items() if st == "covered"],
                          # The deep dive takes one area at a time, in outline order (live round 781a1f0a, turns 41-54).
                          "focus": self._focus_label(), "next": self._focus_label(after=True)} if self.conductor.promises else None),
            "thread": {"title": item.title, "why": item.why} if item.kind == "thread" else None,
            "orders": [{"kind": o.kind, "text": o.text} for o in orders],
            # A turn that keeps the problem sees neither the director's brief nor the hint ladder: both led the talker to give hint 1 inside a
            # refusal (live round 781a1f0a, turns 27-33).
            "brief": self.brief if self.brief_for == self.conductor.position and not keeping else None, "brief_age": self.conductor.candidate_turns - getattr(self, "brief_turns", self.conductor.candidate_turns),
            "follow_ups": self.conductor.follow_ups.get(item.item_id, []),
            "ask": {"surface": self.ask_for_turn["surface"], "quote": self.ask_for_turn["quote"]} if self.ask_for_turn else None,
            "highlights": self._their_highlights(item),
            "code": {"language": code["language"], "version": code["version"], "lines": self.d.workspace.code_lines()} if code else None,
            "board": self.d.workspace.board_summary, "summary": self.summary,
            "on_screen": self._on_screen(item), "refused": refused, "activity": activity,
            "advance": dict(zip(("ok", "why"), self.conductor.can_advance())),
            "problem_left": any(i.kind == "slot" and i.status in ("pending", "active") for i in self.conductor.items),
            "extra_problem": self.conductor.would_extend(),
            "next_part": next_part,
            "skip_next_problem": self.conductor.will_skip_next_problem(),
            "next_after_give_up": self.conductor.next_problem_after_give_up(),
            "warnings": self._warnings_view(),
            # How a behavioural part of a technical round is run (round packs): shown while that question is current.
            **({"item_rules": rules} if (rules := self._item_rules("talker")) else {}),
        }

    def _item_rules(self, who: str) -> str | None:
        """The behavioural pack's rules for one question, for the talker or the director, while a culture slot is current (None otherwise)."""
        c = self.conductor
        if not c.is_culture(c.current()):
            return None
        return ((c.round_rules.get("item_rules") or {}).get("behavioural") or {}).get(who) or None

    def _warnings_view(self) -> dict[str, Any]:
        """What the interviewer has warned about, and whether its last turn was a warning (it is picked up from, never ignored)."""
        said = [t["seq"] for t in self.transcript if t["speaker"] == "interviewer"]
        given = self.conductor.warnings_given
        return {"summary": self.conductor.warnings_summary(), "just_said": [k for k, _ in self._warned_now],
                "after_warning": bool(given) and bool(said) and given[-1]["turn"] == said[-1]}

    def _free_min(self) -> int:
        return int(max(0, self.conductor.free_seconds()) // 60)

    def _their_highlights(self, item) -> list[str]:
        """What the candidate highlighted on this problem (newest last). A live round was asked five times about "the part I
        highlighted" and could only say it could not see it: the highlight reached the workspace but not the talker."""
        card = (getattr(self.d.workspace, "cards", None) or {}).get(item.item_id) or {}
        return [h["quote"] for h in card.get("highlights", []) if h.get("author") == "candidate" and h.get("quote")][-3:]

    def _time_talk_ok(self, item, orders: list[Order]) -> bool:
        """Saying time is short is only true near the round's end, once this part's time is up, or when the conductor moves on for time."""
        now = self.d.clock()
        left_s = self.round_seconds - (now - (self.conductor.started_at or now))
        part_up = item.max_seconds > 0 and now - (item.started_at or now) >= item.max_seconds
        return left_s <= TIME_TALK_LEFT_S or part_up or any(o.kind in ("converge", "move_on", "wrap_up_now") for o in orders)

    def _open_the_part_the_words_opened(self, text: str, result, failed: bool, item_id: str) -> None:
        """The counterpart of leaving a part by words: the talker gave the outline or asked for the introduction without calling a
        flow tool, while the plan still sat on an earlier part. Move the plan there through the normal rules (a refusal is ignored)."""
        c = self.conductor
        # A moving tool that landed short of where the words went (the outline and the introduction in one turn, next_item to the
        # framing): the inference completes the move, from the part the tool landed on. Any other flow tool is the turn's own word.
        landed = any(t["name"] in MOVING_TOOLS and (t.get("result") or {}).get("ok") for t in result.tool_calls)
        if landed and gives_outline(text) and c.current().kind == "phase" and c.current().phase == "framing":
            c.outline_said = True                        # the framing is given: its exchange is had, so the move on is not refused
            c.current().turns = max(c.current().turns, MIN_TURNS.get("framing", 0))
        elif not landed and any(t["name"] in FLOW_TOOLS for t in result.tool_calls):
            return
        elif landed and not gives_outline(text):
            return
        if not text or result.interrupted or failed or c.ended or (c.current().item_id != item_id and not landed):
            return

        def pending_ahead(phase: str):
            return next((i for i in c.items[c.index + 1:] if i.kind == "phase" and i.phase == phase and i.status == "pending"), None)

        why = "inferred from the interviewer's words"
        if gives_outline(text) and pending_ahead("framing") is not None and c.current().phase in ("greeting", "small_talk"):
            c.outline_said = True                       # before the move: the framing is then known to be given
            c.go_to("framing", why)
        cur = c.current()
        # An outline that ends by asking for the introduction opens it in the same turn; one that only mentions it inside does not.
        sentences = [x for x in re.split(r"(?<=[.?!])\s+", text.strip()) if x]
        asks_now = asks_for_introduction(text) if not gives_outline(text) else (
            len(sentences) > 1 and not gives_outline(sentences[-1]) and asks_for_introduction(sentences[-1]))
        if asks_now and pending_ahead("candidate_intro") is not None and cur.kind == "phase" \
                and cur.phase in ("greeting", "small_talk", "framing"):
            c.go_to("candidate_intro", why)

    def _keep_the_promise_to_return(self, text: str, result, failed: bool, item_id: str) -> None:
        """The interviewer deferred what the candidate raised ("let's keep that thread for later") and the plan did not keep it, so
        it was never heard again. A promise never moves the plan: it is recorded with `defer_topic` (a follow-up of the projects
        discussion when that is still ahead, else a short may-cover part before their questions), whatever else the turn did. Only a
        thread the turn opened itself counts as already kept."""
        c = self.conductor
        cur = c.current()
        item = next((i for i in c.items if i.item_id == item_id), cur)
        probes = [str(p.get("prompt") or "") for p in (self.d.blueprint.get("personalization") or {}).get("resume_probes") or []]
        slot = slot_by_id(self.d.blueprint, item.slot_id)
        # What is not a topic of theirs: the problem, the part's probes and its opening, which a noun phrase of theirs may share.
        exclude = " ".join([*probes, *_strings(slot), opening_hint(self.d.blueprint, item.phase, c.style_of(item)) or ""])
        spoken = [x["text"] for x in self.transcript if x["speaker"] == "candidate"]
        recent = " ".join(spoken[-2:])      # what a promised noun phrase must come from
        # A turn the interviewer starts itself (moving on between parts) answers no candidate message: the topic it promises is the
        # last thing they said (a rehearsal's "We'll come back to that in depth later" was lost for want of a title).
        topic = self._asked.strip() or (spoken[-1].strip() if spoken else "")
        if not text or result.interrupted or failed or c.ended or cur.kind not in ("phase", "slot") \
                or not promises_to_return(text, recent, exclude) or not topic \
                or any(t["name"] == "open_thread" and (t.get("result") or {}).get("ok") for t in result.tool_calls):
            return
        if asks_for_introduction(text) or matches_probe(text, probes):
            return                  # it also asks the part's own planned question: "that" there is sequencing, not a topic to keep
        c.defer_topic(promised_topic(text) or topic[:60], "inferred: promised to return")

    def _followed(self, text: str, item_id: str) -> bool:
        """The turn's question builds on what the candidate just said (two or more distinctive words in common) with words the part's
        own prepared probes and opening do not use: the interviewer followed the conversation rather than the plan. For the trace."""
        sentences = [x for x in re.split(r"(?<=[.?!])\s+", (text or "").strip()) if x]
        if not sentences or not sentences[-1].rstrip("\"')\u201d ").endswith("?"):
            return False
        shared = _stems(sentences[-1]) & _stems(self._asked)
        if len(shared) < 2:
            return False
        item = next((i for i in self.conductor.items if i.item_id == item_id), None)
        personal = self.d.blueprint.get("personalization") or {}
        slot = slot_by_id(self.d.blueprint, item.slot_id) if item is not None else None
        prepared = [str(p.get("prompt") or "") for p in personal.get("resume_probes") or []]
        prepared.append(str(((slot or {}).get("ask") or {}).get("opening") or ""))
        if item is not None and item.kind == "phase":
            prepared.append(opening_hint(self.d.blueprint, item.phase, self.conductor.style_of(item)) or "")
        return not (shared & _stems(" ".join(prepared)))

    def _follow_the_conversation(self, text: str, result, failed: bool, item_id: str) -> None:
        """The talker sometimes starts the next part without calling next_item. When what it asked is unmistakably the next part, move
        the plan to it so the screen, the time and the orders follow the conversation."""
        c = self.conductor
        item = c.current()
        if not text or result.interrupted or failed or c.ended or item.item_id != item_id or any(t["name"] == "next_item" for t in result.tool_calls):
            return
        if item.kind == "slot" and not c.may_leave_problem(item)[0]:
            return
        ahead = next((i for i in c.items[c.index + 1:] if i.status == "pending"), None)
        if ahead is None or ahead.kind != "phase" or not c.can_advance()[0]:
            return
        probes = [p.get("prompt", "") for p in (self.d.blueprint.get("personalization") or {}).get("resume_probes", [])]
        slot_shown = item.kind == "slot" and self.tools.in_play()
        if item.kind == "slot" and c.would_extend():
            c.plan_extra_problem()                  # time for another problem: the conversation about the projects waits for it
            return
        if slot_shown and ahead.phase == "deep_dive" and (matches_probe(text, probes) or any(closes_coding_part(x) for x in re.split(r"(?<=[.!?])\s+", text))):
            # Saying the coding part is over, with nothing more to code, is the move itself (b6b drifter seq 35-37: the plan stayed on
            # the last problem for two more turns of questions about the projects).
            c.next_item("moved to the projects")
        elif item.phase == "deep_dive" and ahead.phase == "candidate_questions" and asks_for_questions(text):
            c.next_item("invited their questions")

    def _outline_expect(self, item) -> tuple[list[str], list[str]] | None:
        """What the spoken outline must name (promised areas, promised projects), while the outline is still to be said: only a blueprint with a
        realism block and a deep dive to keep promises in, and only up to the turn that puts the first problem up (a coding-first round says it
        there, in the `with_outline` hint)."""
        c = self.conductor
        if c.outline_said or realism_outline(self.d.blueprint) is None or not promises_of(self.d.blueprint):
            return None                                    # nothing promised (no deep dive in the live plan): nothing to check
        if not outline_turn_eligible([(i.item_id, i.kind) for i in c.items], item.item_id):
            return None                                    # the coding has begun: the outline was said (or skipped) before it
        return promised(self.d.blueprint, "fundamentals"), promised(self.d.blueprint, "projects")

    def _tools_for_turn(self, problem_in_play: bool, item) -> list[dict[str, Any]]:
        """The turn's tools by the item's workspace. A culture slot has none, but the turn that leaves it for a coding problem must still be able to call
        show_problem, so the next planned item's workspace is offered too (the tools of both)."""
        board = bool(self.d.workspace.board_summary)
        offered = tools_for(problem_in_play, board, self.conductor.workspace_for(item))
        if item.kind == "slot" and self.conductor.is_culture(item) and (nxt := self.conductor.peek_next()) is not None and nxt.kind == "slot":
            names = {t["function"]["name"] for t in offered}
            offered += [t for t in tools_for(True, board, self.conductor.workspace_for(nxt)) if t["function"]["name"] not in names]
        return offered

    def _problem_hint(self, number: int, item=None) -> str:
        """How to move on to a coding problem, said in the turn that moves (the problem's own prompt only arrives after the move)."""
        outline = ""
        first = next((i for i in self.conductor.items if i.kind == "slot"), None)
        if number == 1 and first is not None and first.style == "with_outline" and not self.conductor.outline_said:
            outline = f"before the problem, {with_outline_text(self.d.blueprint)} "
        if item is not None and not self.conductor.words_for(item)["on_screen"]:
            # A question asked aloud (a behavioural round's, or a culture slot's, which uses the behavioural pack's links): nothing goes on the screen.
            pack_id = "behavioural" if self.conductor.is_culture(item) else None
            return (f'{outline}start with a short connecting phrase (for example "{bridge_for("problem", "", self.d.blueprint, pack_id)}"), call next_item, '
                    f'and then ask the {self.conductor.words_for(item)["problem"]} aloud in your own words; nothing goes on their screen')
        return (f'{outline}start with a short connecting phrase (for example "{bridge_for("problem", "", self.d.blueprint)}"), call next_item and then show_problem, and about the '
                f'problem say only this line, last: "{problem_intro(number, self.conductor.lines, peek=True, pack_id=self.conductor._pack_id())}"')

    def _next_part(self) -> dict[str, Any] | None:
        if self.conductor.resumes_parent():
            # Inside a thread the next part is the one it paused: it is picked up where it was left, never opened again.
            parent = self.conductor.peek_next()
            return {"phase": parent.phase, "resume": True, "hint": self.conductor.pick_up_text(parent)}
        if self.conductor.would_extend():
            return {"phase": "problem", "hint": self._problem_hint(self.conductor.problem_number() + 1, self.conductor.peek_next())}   # time for another problem after this one
        nxt = self.conductor.peek_next()
        if nxt is not None and nxt.kind == "slot" and self.conductor.will_skip_next_problem():
            # the next problem will not be given: the first pending part that is not a problem
            nxt = next((i for i in self.conductor.items if i.status == "pending" and i.kind != "slot"
                        and self.conductor.items.index(i) > self.conductor.index), None)
        if nxt is None:
            return None
        if nxt.kind == "slot":
            return {"phase": "problem", "hint": self._problem_hint(self.conductor.problem_number(self.conductor.items.index(nxt)), nxt)}
        return {"phase": nxt.phase, "hint": opening_hint(self.d.blueprint, nxt.phase, self.conductor.style_of(nxt))}

    def _take_refused(self) -> list[dict[str, Any]]:
        """Workspace actions the candidate's screen refused since last turn, and tool calls the plan refused; acked ones
        are forgotten."""
        refused, self.tool_refused = list(self.tool_refused), []
        for message_id, kind in list(self.actions.items()):
            ack = self.d.workspace.acks.get(message_id)
            if ack is None:
                continue
            del self.actions[message_id]
            if not ack.get("ok"):
                refused.append({"tool": kind, "reason": ack.get("reason")})
        for message_id in list(self.actions)[:-MAX_TRACKED_ACTIONS]:
            del self.actions[message_id]
        return refused

    def _on_screen(self, item) -> dict[str, Any]:
        card = self.d.workspace.cards.get(self.wire.get(item.slot_id or "", ""))
        return {"problem_shown": card is not None, "sections": [s["kind"] for s in (card or {}).get("sections", [])]}

    def _limits_revealed(self, item) -> bool:
        """The constraints of the problem this item is are on the candidate's screen: their numbers are not spoken any more."""
        return item.kind == "slot" and "constraints" in self._on_screen(item)["sections"]

    def _screen_for_director(self) -> dict[str, Any]:
        """What the interviewer has put on the candidate's screen, per problem (public id): the director cannot see the screen, and without
        this it asked seven briefs in a row for constraints that had been revealed (a live round, 2026-10-17)."""
        out: dict[str, Any] = {}
        # A reveal the candidate asked for is on its way (the order is pending until the reply that puts it up): the director's snapshot is taken
        # as that reply starts, and a live round briefed "constraints are NOT on their screen, so stating them is fine" 2.5 s before they were.
        asked = " ".join(o.text for o in self.conductor.pending_orders() if o.kind == "reveal_request")
        for i in self.conductor.items:
            if i.kind == "slot" and i.status in ("active", "done"):
                screen = self._on_screen(i)
                if screen["problem_shown"]:
                    current = i is self.conductor.current()
                    out[self.conductor.public_id(i)] = {
                        "constraints_shown": "constraints" in screen["sections"] or (current and "kind=constraints" in asked),
                        "input_output_format_shown": "format" in screen["sections"] or (current and "kind=format" in asked)}
        return out

    def _warning_orders(self, orders: list[Order]) -> list[Order]:
        """The warning orders a reply says in their fixed words: the screen warning (a final warning outranks a mention) and the conduct one.
        None when an ending is to be said (the ending says everything) or the round is over."""
        if self.conductor.ended or any(o.kind == "end" and o.speak for o in orders):
            return []
        warned = [o for o in orders if o.kind in WARNING_KINDS and o.line]
        screen = [o for o in warned if o.kind == "final_warning"] or [o for o in warned if o.kind == "mention_violation"][-1:]
        return [*screen, *[o for o in warned if o.kind == "conduct_warning"][-1:]]

    def _told_to_come_back(self, turn: int, warning_orders: list[Order]) -> None:
        """A screen warning is being said while they are away: the return clock starts when it has played (see `_away_clock_started`)."""
        said = next((o for o in warning_orders if o.kind in ("mention_violation", "final_warning")), None)
        if said is not None and self.conductor.away_warning_pending():
            self._away_line = {"turn": turn, "at": self.d.clock(), "seconds": len((said.line or "").split()) / AWAY_LINE_WORDS_PER_S, "playing": False}

    async def reply(self, candidate_text: str | None) -> AsyncIterator[str]:
        """One reply: counted while it runs, so the ticker never starts a second one beside it (see _reply_in_flight)."""
        self._replies_open += 1
        self._reply_open_at = self.d.clock()
        try:
            async with aclosing(self._reply(candidate_text)) as sentences:
                async for sentence in sentences:
                    yield sentence
        finally:
            self._replies_open -= 1

    def _patient(self) -> bool:
        """The interviewer's own move (no candidate words to answer) waits while the last question is under 25 s old and the candidate has spoken or typed
        since it: thinking on the question is the answer (live round 3e574171, where the same question was asked over and over). Urgent orders and the end never wait."""
        now = self.d.clock()
        if now - self._last_ask_at >= PATIENCE_S or self.conductor.urgent_pending() or self.conductor.end_order is not None or self.conductor.ended:
            return False
        return self.conductor.last_candidate_at > self._last_ask_at or self._code_at > self._last_ask_at or self.conductor.candidate_speaking

    async def _reply(self, candidate_text: str | None) -> AsyncIterator[str]:
        if self.finishing:
            return
        if self.conductor.away_paused() and not self.conductor.speakable_orders():
            if candidate_text is not None:
                self._record_skip("away_pause")
                self.answer_late = candidate_text      # they spoke as they left: it is answered when they are back (nothing is said to an empty screen)
            return
        if self._merged is not None:
            if candidate_text == self._merged[0]:
                candidate_text = self._merged[1]          # answer the fragment together with its continuation
            self._merged = None
        gate = await self._addressed_gate(candidate_text)
        if gate is not None and gate[0] == "silent":
            # Their words were for nobody (reading the problem, thinking aloud): no turn, no sound. The turn itself is recorded already.
            self._cut_short = False
            self.unanswered, self.conductor.reply_owed = None, False
            return
        if candidate_text is None and self._patient():
            return                                      # they are busy answering the last question: no re-ask or probe yet (the tick tries again)
        checkin_line = gate[1] if gate is not None else None
        if candidate_text is None:
            self.addressed.checkin_at = None            # the interviewer speaks on its own: the check-in is stale
        yields_floor = candidate_text is not None and self._yields_floor(candidate_text)
        self._cut_short = False                         # one chance: what they say next is answered
        self.seq += 1
        turn = self.seq
        self._skips = 0
        entered_ms = int((self.d.clock() - self.turn_ended_at) * 1000) if candidate_text is not None and self.turn_ended_at is not None else None
        if entered_ms is not None and entered_ms > 3000:
            # The wait before the reply began is outside the talker (the voice pipeline held it): the turn doc says how long.
            logger.warning("reply %s began %d ms after the candidate finished (agent speaking: %s)", turn, entered_ms, self.conductor.agent_speaking)
        self.conduct_check = {}
        self.change_decision = {}
        checking = candidate_text is not None and maybe_conduct(candidate_text) and not self.conductor.ended
        if checking and self._change_pending is not None:
            # Side by side, not one after the other (an angry ask would wait 3 s): an ending the check issues stops the change from being applied.
            _, decision = await asyncio.gather(self._check_conduct(candidate_text), self._decide_change())
            self._apply_change(decision)
        elif checking:
            await self._check_conduct(candidate_text)   # before the orders are read: a verdict adds the warning or the ending to them
        elif self._change_pending is not None:
            self._apply_change(await self._decide_change())      # before the orders are read: the action's order is this reply's
        self._hold_screen()
        if candidate_text is not None:
            self.conductor.drop_stale_conduct(self.d.clock())        # a warning left pending long ago is not about what they just said
        orders = self.conductor.speakable_orders()      # during a moment they asked for, only what cannot wait
        item = self.conductor.current()
        refused = self._take_refused()
        if any(o.kind == "end" for o in orders):
            self._end_reply_at = self.d.clock()        # this reply is saying the ending: its grace counts from here
        if candidate_text is None and self.answer_late is not None:
            candidate_text, self.answer_late = self.answer_late, None   # they trailed off and then stayed quiet: answer that turn
        if candidate_text is None and self.failed_at is not None:
            candidate_text = self.unanswered           # asking again for a reply that failed: it answers the same turn
        self._asked = candidate_text or ""                 # what this reply answers (the backstops read it after the turn)
        asked_them = self._last_interviewer_line()        # what this reply follows: after a question, a bare "yes" is the answer
        utterance = self._utterance
        digest = self._digest(candidate_text is not None)
        activity = digest.doc() if digest is not None else None
        self.last_activity = activity
        if activity is not None:
            self.digests = [*self.digests, activity][-30:]
        # Every warning is said first, in fixed words, and never mixed with anything else (decided 2026-10-18): the candidate may leave again
        # while the rest is being said, and a model glued "this one stays now, so let's work with it. Where would you begin?" onto a final warning.
        warning_orders = self._warning_orders(orders)
        warning_first = [o.line for o in warning_orders]
        # Every warning order is spent by the one said (an earlier mention is superseded by a final warning), and the talker is never ordered
        # to say what is said for it.
        spent = [o for o in orders if o.kind in WARNING_KINDS and o.line] if warning_orders else []
        talker_orders = [o for o in orders if o not in spent]
        self._warned_now = [(o.kind, o.about or "screen") for o in warning_orders]
        # Only once the round is under way: a "Hi" answering the greeting is a greeting, not a check that the line is alive.
        here_first = ([self.conductor.lines.pick("line_check" if _HEARING.search(candidate_text) else "presence")]
                      if candidate_text is not None and is_line_check(candidate_text)
                      and item.phase not in ("greeting", "small_talk") and not any(o.kind == "end" for o in orders) else [])
        reveal = next((o for o in orders if o.kind == "reveal_request"), None)
        reveal_kind = "format" if reveal is not None and "kind=format" in reveal.text else "constraints"
        # Constraints already on their screen stay off the air for the rest of this problem, whatever the turn (a live round read the limits
        # aloud on a proactive turn eight turns after "Let me pull those up for you.").
        limits_revealed = self._limits_revealed(item)
        view = self._view(talker_orders, refused, digest.text if digest is not None else None)
        budget = self._verdict_budget(candidate_text)
        view["no_verdict"] = budget
        self.talker.board_typed = bool(board_typed_text(self.d.workspace.board_summary))
        self.talker.outline_expect = self._outline_expect(item)
        # A refusal turn must say something new: the points the round's earlier refusals made are blocked (the guard's `repeated_refusal`).
        self.talker.refusal_said = set(self.conductor.refusal_points) if any(o.kind == "keep_problem" for o in talker_orders) else None
        self.talker.refusal_sentences = list(self.conductor.refusal_sentences) if self.talker.refusal_said is not None else []
        self.tools.keeping_problem = self.talker.refusal_said is not None          # a turn that keeps the problem gives no hint (live round 781a1f0a, turns 27-33)
        self.talker.selection = selection_asked_about(candidate_text or "", (activity or {}).get("text"),
                                                      self.ask_for_turn, view["highlights"]) if candidate_text is not None else ""
        self.code_seen = list(view["code"]["lines"]) if view["code"] else None
        state = state_block(view) + "\n\n## Current item\n" + item_details(self.d.blueprint, view["item"])
        messages = talker_messages(self.prefix, state, self.history[-MAX_HISTORY:], proactive=candidate_text is None)
        started = self.d.clock()
        self.awaiting_audio = turn
        self._audio_base = (self.turn_ended_at or started) if candidate_text is not None else started
        self._entered_ms = entered_ms
        failed = False
        problem_in_play = self.conductor.problem_allowed()
        quiet_coding = item.kind == "slot" and self.tools._on_screen() and starts_coding(candidate_text or "")
        # Never "say a bit more" to someone about to type: now, and on a proactive turn within a minute of their saying so.
        no_filler = quiet_coding or (candidate_text is None and self._started_coding_at is not None
                                     and self.d.clock() - self._started_coding_at < START_CODING_QUIET_S)
        time_ok = self._time_talk_ok(item, orders)
        # The plan has not left the problem on screen, so the coding part is not over however the talker words it (b2 quiet_thinker).
        holds_problem = item.kind == "slot" and self.tools.in_play() and not self.conductor.may_leave_problem(item)[0]
        # The put-up and intro lines of the problem already on their screen are never said again (live round 2a2cb5c2, turns 23 and 25).
        shown_problem = self.conductor.problem_number() if item.kind == "slot" and self.tools._on_screen() else None
        offered = self._tools_for_turn(problem_in_play, item)
        problem_ahead = any(i.kind == "slot" and i.status == "pending" for i in self.conductor.items)
        # Their questions come at the end: until the plan reaches that part, inviting them is held back (the conductor owns the order).
        left = [i for i in self.conductor.items if i.status in ("pending", "active")]
        qa_early = item.phase not in ("candidate_questions", "wrap_up") and not any(o.kind in ("end", "closing") for o in orders) and (
            any(i.kind == "slot" for i in left) or any(i.phase == "deep_dive" and i.status == "pending" for i in left)
            or (item.phase == "deep_dive" and not self.conductor.can_advance()[0]))
        # Opening the candidate's questions (this part or the one the plan moves to this very turn) is no goodbye: no thanks for their time until
        # they have had their say (bf82d318 turn 37). Their own goodbye, an end or the closing order lift it.
        ahead = next((i for i in self.conductor.items[self.conductor.index + 1:] if i.status == "pending"), None)
        opening_questions = ((item.phase == "candidate_questions" and item.turns < MIN_TURNS.get("candidate_questions", 1))
                             or (item.kind == "phase" and item.phase not in ("candidate_questions", "wrap_up") and ahead is not None
                                 and ahead.phase == "candidate_questions"))
        block_leave_taking = (opening_questions and not any(o.kind in ("end", "closing") for o in orders)
                              and not (candidate_text is not None and ends_with_goodbye(candidate_text)))
        heard = " ".join(self.candidate_said.values())
        only_the_line = (candidate_text is None and any(o.kind == "problem_line" for o in orders)
                         and not any(o.kind in ("end", "closing", "final_warning", "mention_violation", "conduct_warning") for o in orders))
        try:
            spoken = 0
            if checkin_line is not None:
                # Unsure whether the words were for the interviewer: it asks once, in fixed words (the question stays in the history, so a "yes" answers it).
                orders = []
                self._checkin_turn = turn
                self.talker.last = TurnResult(spoken=[checkin_line])
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                self.unanswered, self.conductor.reply_owed = None, False
                yield checkin_line
                return
            if yields_floor and not warning_first and not here_first:
                # The interviewer spoke over them: it stops and hands the floor back, as a person does. Nothing ordered was said, so
                # nothing ordered is spent.
                orders = []
                yield_line = self.conductor.lines.pick("yield")
                self.talker.last = TurnResult(spoken=[yield_line])
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                self.unanswered, self.conductor.reply_owed = None, False
                yield yield_line
                return
            if only_the_line:
                # The screen has just changed and the only thing left to say is the fixed line that invites them to read it: said as it is,
                # with no model in between to add "let me put it up" after it is already up.
                line = next((o.line for o in orders if o.kind == "problem_line" and o.line), None) \
                    or problem_intro(self._line_number or self.conductor.problem_number(), self.conductor.lines, pack_id=self.conductor._pack_id())
                self.talker.last = TurnResult(spoken=[line])
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                self.unanswered, self.conductor.reply_owed = None, False
                yield line
                return
            ending_now = next((o for o in orders if o.kind == "end" and o.speak), None)
            if ending_now is not None and not warning_first:
                # The ending is said by the run, in fixed words: told to say goodbye after the candidate pressed End, a live model
                # said "Take your minute, then tell me..." instead.
                line = ending_now.line or self._goodbye_line()
                self.talker.last = TurnResult(spoken=[line])
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                self.unanswered, self.conductor.reply_owed = None, False
                yield line
                return
            owed = candidate_text is not None and not needs_no_reply(candidate_text, asked_them)
            if warning_first and not here_first and (candidate_text is None or not owed or self.conductor.away_paused()):
                # A warning stands alone: on a turn of its own, or on one where the candidate said nothing that needs an answer. Only the warning
                # orders are spent; anything else pending waits for the next turn.
                orders = spent
                self.talker.last = TurnResult(spoken=list(warning_first))
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                if self.conductor.away_paused() and candidate_text is not None:
                    self.answer_late = candidate_text          # they spoke as they left: only the warning is said now, the words are answered after they return
                else:
                    self.unanswered, self.conductor.reply_owed = None, False
                self._told_to_come_back(turn, warning_orders)
                said, warning_first = warning_first, []
                for line in said:
                    yield line
                return
            give_up = next((o for o in orders if o.kind == "move_on" and o.line), None)
            if give_up is not None and not any(o.kind == "end" for o in orders):
                # Their second ask on a problem (decided 2026-10-18): the round's one change moves on to the next planned problem and puts it up,
                # or the coding part ends and the interviewer opens the next part with its next order. The run does it in fixed words, with no
                # model in between, so none can refuse.
                self.conductor.next_item("asked for another problem")
                new_cur = self.conductor.current()
                shown = (await self.tools.execute(ToolCall(id="give-up", name="show_problem", arguments={}), str(turn))
                         if new_cur.kind == "slot" and self.conductor.words_for(new_cur)["on_screen"] else None)      # (a question asked aloud has nothing to put up)
                self.talker.last = TurnResult(spoken=[*warning_first, give_up.line],
                                              tool_calls=[{"name": "show_problem", "arguments": {}, "result": shown}] if shown is not None else [])
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                self.unanswered, self.conductor.reply_owed = None, False
                self._told_to_come_back(turn, warning_orders)
                said, warning_first = [*warning_first, give_up.line], []
                for line in said:
                    yield line
                return
            swap = next((o for o in orders if o.kind == "open_item" and o.line), None)
            if swap is not None and not any(o.kind == "end" for o in orders):
                # A different problem on request is current already: the run puts it up and says it, so it is never current and unshown.
                await self.tools.execute(ToolCall(id="swap", name="show_problem", arguments={}), str(turn))
                swap.consumed = True
                self.talker.last = TurnResult(spoken=[*warning_first, swap.line],
                                              tool_calls=[{"name": "show_problem", "arguments": {}, "result": {"ok": True}}])
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                self.unanswered, self.conductor.reply_owed = None, False
                self._told_to_come_back(turn, warning_orders)
                said, warning_first = [*warning_first, swap.line], []
                for line in said:
                    yield line
                return
            if warning_first:
                self._told_to_come_back(turn, warning_orders)
            for line in warning_first:
                spoken += 1
                yield line
            if warning_first:
                messages = [*messages, {"role": "assistant", "content": " ".join(warning_first)}, {"role": "user", "content": WARNED_SAID}]
            if here_first:
                # A line check is answered at once, before the model: a live round answered "Hello?" a second or more late and the
                # candidate said "Hello?" again before it played, cutting it off, three times.
                spoken += 1
                yield here_first[0]
                messages = [*messages, {"role": "assistant", "content": here_first[0]}, {"role": "user", "content": here_said(here_first[0])}]
            # A real answer is owed (four words or more, not a request): a reply that only nods or promises is asked for again, once.
            # Not while they type (quiet coding), and not for a yes/no question ("is it okay if I use Python?"): "Sure." answers it.
            ack_check = (candidate_text is not None and len(candidate_text.split()) >= 4 and (not makes_a_request(candidate_text) or self._asks_to_explain(candidate_text))
                         and not quiet_coding and not self._typing(activity) and (not asks_yes_no(candidate_text) or self._asks_to_explain(candidate_text)))
            bridge = next((o.bridge for o in orders if o.kind == "open_item" and o.bridge), None)
            moves_on = any(o.kind in ("open_item", "closing") and not o.line for o in orders)
            bridged, bridged_before, said_first = False, "", []
            async for sentence in self.talker.run(messages, turn_id=str(turn), current_slot=item.slot_id,
                                                  candidate_said=self.candidate_said.get(item.item_id, ""), tools=offered,
                                                  block_screen_claims=not problem_in_play, neutral_on_blocked=False,
                                                  block_qa_invites=qa_early, highlights_known=bool(view.get("highlights")),
                                                  fillers_allowed=self._greeted, quiet_coding=quiet_coding,
                                                  block_values=reveal is not None, values_words_ok=asks_about_a_property(candidate_text or ""), heard=heard, recent=self._recent_text(), hint_step=item.hint_step,
                                                  has_code=self.conductor.has_code(), time_talk_ok=time_ok, limits_revealed=limits_revealed,
                                                  block_clarify=item.kind == "slot" and self.tools.in_play(), framing=item.phase == "framing",
                                                  check_empty_ack=ack_check,
                                                  verdict_budget=budget, block_close_coding=holds_problem, block_leave_taking=block_leave_taking, line_trouble_ok=self._connection_trouble(), shown_problem=shown_problem, problem_ahead=problem_ahead, outline_said=self.conductor.outline_said, confirm_asked=self.conductor.format_confirm_asked, known_words=self.known_words,
                                                  echo_of=self._said_since_played(candidate_text) if candidate_text else "", trace_reported=self._reports_a_test(candidate_text or ""),
                                                  speak_after_tools=candidate_text is not None and (item.kind != "slot" or not self._typing(activity))
                                                  and not needs_no_reply(candidate_text, asked_them)):
                if bridge is not None and not bridged and (put_up_ordinals(sentence) or PUTS_PROBLEM_UP.search(sentence)) \
                        and not announces_coding_now(" ".join(said_first)) and not announces_coding_now(sentence):
                    # The sentence that moves on to the problem is said by the run, as its own sentence, right before the put-up line (the model's
                    # own connecting phrases were restatements and improvised bridges, live round c8e70bb8).
                    bridged, bridged_before = True, sentence
                    spoken += 1
                    await asyncio.sleep(BRIDGE_BREATH_S)
                    yield bridge
                if spoken == 1 and moves_on and bridge is None and not bridged:
                    await asyncio.sleep(BRIDGE_BREATH_S)      # a part opens as: a reaction to what they said, a breath, then the way into the new part
                said_first.append(sentence)
                spoken += 1
                yield sentence
            first = self.talker.last
            if bridged:
                first.spoken.insert(first.spoken.index(bridged_before) if bridged_before in first.spoken else 0, bridge)
                self.talker.said.add(bridge, str(turn))
            ending = any(o.kind == "end" for o in orders)
            # A turn that has already said goodbye is finished: a retry after it reopened the round ("Have a great day! But it's a
            # sensible question... Anything else you'd like to ask me?", p21 seq 41).
            closed = spoken > 0 and ends_with_goodbye(" ".join(first.spoken))
            if first.blocked and not first.interrupted and not self.finishing and not (ending and spoken > 0) and not closed \
                    and not all(b["rule"] == "after_problem_line" for b in first.blocked) \
                    and (spoken == 0 or not addresses_the_candidate(" ".join(first.spoken))
                         or (any(b["rule"] == "screen_claim" for b in first.blocked) and "?" not in " ".join(first.spoken))):
                # Everything the talker said was held back, or what is left is a remark that asks them nothing and would leave
                # them waiting: ask again, saying why, rather than speak a bare filler line or go quiet.
                already = (f' You have already said this in this turn: "{" ".join(first.spoken)}" Do not repeat or reword it; add only what is missing.'
                           if first.spoken else "")
                repeats = [b for b in first.blocked if b["rule"] == "repeat"]
                if repeats:
                    already += " You were about to repeat: " + " ".join(f'"{b["sentence"]}"' for b in repeats[:3])
                # A refusal to write in their editor or swap the problem ends with the refusal: the retry must not ask for a question.
                declining = any(o.kind in ("decline_request", "keep_problem", "reveal_request", "explain_request") for o in orders)
                looping = any(b["rule"] == "question_loop" for b in first.blocked)
                empty = all(b["rule"] == "empty_ack" for b in first.blocked)
                if any(b["rule"] == "language" for b in first.blocked):
                    already += " " + SPEAK_ENGLISH
                if any(b["rule"] == "reasoning_aloud" for b in first.blocked):
                    already += " " + SAY_ALOUD
                if any(b["rule"] == "outline_mismatch" for b in first.blocked):
                    already += " " + outline_requirement(self.d.blueprint)
                if any(b["rule"] == "problem_guess_affirmed" for b in first.blocked):
                    already += f' They guessed what the problem is: never confirm or deny it. Say only: "{PROBLEM_GUESS_ANSWER}"'
                # The turn's job is moving on to the coding problem (the plan is on it, or it already went up): the retry says a connecting phrase and
                # asks nothing; a question here would be followed by the put-up lines (decided 2026-10-18; run_a seq 9).
                now_on = self.conductor.current()
                to_problem = ((now_on.kind == "slot" and now_on.item_id != item.item_id) or (item.kind == "slot" and any(o.kind == "open_item" and "next coding problem" in o.text for o in orders))
                              or any(c["name"] == "show_problem" and c["result"].get("ok") for c in first.tool_calls))
                nudge = MUST_BE_SPECIFIC if empty else (MUST_NOT_LOOP if looping else (MUST_NOT_REPEAT_QUIET if declining else MUST_NOT_REPEAT)) \
                    if len(repeats) == len(first.blocked) or looping else (MUST_CONNECT if to_problem and not declining else MUST_REPHRASE)
                async for sentence in self.talker.run([*messages, {"role": "user", "content": nudge + already}], turn_id=str(turn),
                                                      current_slot=item.slot_id, candidate_said=self.candidate_said.get(item.item_id, ""),
                                                      tools=offered, block_screen_claims=not problem_in_play, neutral_on_blocked=False,
                                                      block_qa_invites=qa_early, highlights_known=bool(view.get("highlights")),
                                                  fillers_allowed=self._greeted, quiet_coding=quiet_coding,
                                                      block_values=reveal is not None, values_words_ok=asks_about_a_property(candidate_text or ""), heard=heard, recent=self._recent_text(), hint_step=item.hint_step,
                                                  has_code=self.conductor.has_code(), time_talk_ok=time_ok, limits_revealed=limits_revealed,
                                                  block_clarify=item.kind == "slot" and self.tools.in_play(), framing=item.phase == "framing",
                                                  spoken_before=first.spoken, verdict_budget=budget, block_close_coding=holds_problem, block_leave_taking=block_leave_taking, line_trouble_ok=self._connection_trouble(), shown_problem=shown_problem, problem_ahead=problem_ahead, outline_said=self.conductor.outline_said, confirm_asked=self.conductor.format_confirm_asked, known_words=self.known_words):
                    spoken += 1
                    yield sentence
                before, first = first, self.talker.last
                first.spoken = before.spoken + first.spoken            # the turn is what was said in both passes
                first.tool_calls = before.tool_calls + first.tool_calls
                first.blocked = before.blocked + first.blocked
                first.decision = first.decision or before.decision
                shown = any(c["name"] == "show_problem" and c["result"].get("ok") for c in first.tool_calls)
                if spoken == 0 and not (no_filler and not shown and reveal is None):
                    # Nothing the talker said could be spoken. Right after a problem goes up the only sensible line is the one that
                    # says it is there ("what do you think?" about nothing confused the candidate); otherwise a plain follow-up, or
                    # "Sure, go ahead." (or silence) when they have just said what they will do next.
                    line = (self.conductor.put_up_line(self.conductor.problem_number(), take=True) if shown
                            else "Let me pull those up for you." if reveal is not None else self.talker.said.neutral(candidate_text or ""))
                    if line is not None:
                        spoken = 1
                        first.spoken.append(line)
                        yield line
            tail = self.talker.last
            if item.kind == "slot" and tail.spoken and not tail.interrupted and not self.finishing and hint_leadin_only(tail.spoken):
                # A hint lead-in ("Let me give you a nudge here.") that stopped there left the candidate waiting, and their "Okay" was then answered
                # with "What would you try next?" (decided 2026-10-19; live round 6eeb5dae). The hint follows the lead-in in the same turn.
                given = next((c for c in tail.tool_calls if c["name"] == "give_hint" and c["result"].get("ok")), None)
                if given is None:
                    outcome = await self.tools.execute(ToolCall("hint-leadin", "give_hint", {}), str(turn))
                    tail.tool_calls.append({"name": "give_hint", "arguments": {}, "result": outcome})
                    given = tail.tool_calls[-1] if outcome.get("ok") else None
                if given is not None and given["result"].get("hint"):
                    spoken += 1
                    tail.spoken.append(given["result"]["hint"])
                    yield given["result"]["hint"]
            tail_text = " ".join(tail.spoken)
            waits_on_them = (candidate_text is not None and bool(tail.spoken) and not tail.interrupted and not self.finishing and not ending
                             and not self.conductor.ended and item.phase != "wrap_up" and not needs_no_reply(candidate_text, asked_them)
                             and not any(o.kind in URGENT_ORDERS or o.kind in ("decline_request", "keep_problem", "reveal_request", "explain_request", "hint_request")
                                         for o in orders)
                             and not any(c["name"] in ("show_problem", "give_hint") and c["result"].get("ok") for c in tail.tool_calls)
                             and not grants_a_pause(tail_text) and not self.conductor.held())
            held_back = [b for b in tail.blocked if b["rule"] not in ("empty_ack", "after_problem_line")]      # (an empty acknowledgement is a nod: it owes nothing)
            if waits_on_them and held_back and not addresses_the_candidate(tail_text) and not (item.kind == "slot" and self._typing(activity)):
                # Something the interviewer was going to say was held back and what is left asks them nothing: the turn would end as a bare statement
                # and they would wait in silence (live round c8e70bb8, turns 41-44: "Yes" was then skipped as an acknowledgement). A neutral prompt closes it.
                line = self.talker.said.neutral(candidate_text or "")
                if line is not None:
                    spoken += 1
                    tail.spoken.append(line)
                    tail_text = " ".join(tail.spoken)
                    yield line
            if addresses_the_candidate(tail_text):
                self._owed_question = False
            elif waits_on_them and held_back:
                self._owed_question = True          # they were left without a question: their next "yes" is the answer to it, never skipped
            typing = self._typing(activity)
            owed_speech = candidate_text is not None and (item.kind != "slot" or not typing) and not needs_no_reply(candidate_text, asked_them)
            ordered_speech = candidate_text is None and any(o.kind in URGENT_ORDERS for o in orders)
            if spoken == 0 and (owed_speech or ordered_speech) and not first.interrupted \
                    and not first.blocked and not self.finishing:
                # <silent> is for a candidate thinking aloud over their code. After a conversational answer nothing said is dead
                # air: ask once more, telling the model it must answer.
                async for sentence in self.talker.run([*messages, {"role": "user", "content": MUST_ANSWER if candidate_text is not None else MUST_SAY_ORDER}], turn_id=str(turn),
                                                      current_slot=item.slot_id, candidate_said=self.candidate_said.get(item.item_id, ""),
                                                      tools=offered, block_screen_claims=not problem_in_play, fillers_allowed=self._greeted, quiet_coding=quiet_coding,
                                                      time_talk_ok=time_ok, framing=item.phase == "framing", spoken_before=first.spoken, verdict_budget=budget,
                                                      limits_revealed=limits_revealed, block_close_coding=holds_problem, block_leave_taking=block_leave_taking, line_trouble_ok=self._connection_trouble(), shown_problem=shown_problem, problem_ahead=problem_ahead, outline_said=self.conductor.outline_said, confirm_asked=self.conductor.format_confirm_asked, known_words=self.known_words):
                    yield sentence
                again = self.talker.last
                again.tool_calls = first.tool_calls + again.tool_calls
                again.decision = again.decision or first.decision
            joined = self.talker.last
            moved_to = self.conductor.current()
            said_so_far = " ".join(joined.spoken)
            if (moved_to.item_id != item.item_id and moved_to.kind == "slot" and joined.spoken and not joined.interrupted and not self.finishing
                    and not ending and not self.conductor.ended and self.conductor.problem_allowed() and self.conductor.words_for(moved_to)["on_screen"] and not self.tools._on_screen()
                    and (says_the_problem_line(said_so_far) or PUTS_PROBLEM_UP.search(said_so_far) or put_up_ordinals(said_so_far))
                    and not any(c["name"] == "show_problem" and (c["result"].get("ok") or c["result"].get("deferred")) for c in joined.tool_calls)):
                # The words put the next problem up and the plan moved onto it, but the talker never called show_problem (b5 seq 23: "Let me
                # put the second one on your screen. Here's your second question." shown nothing, then the open_item order said it all again).
                # The run shows it now, in this turn, and the order to open that part is spent.
                put = await self.tools.execute(ToolCall(id="put-up", name="show_problem", arguments={}), str(turn))
                joined.tool_calls.append({"name": "show_problem", "arguments": {}, "result": put})
                if put.get("ok"):
                    self.conductor.consume([o for o in self.conductor.pending_orders() if o.kind == "open_item" and o.at >= started])
            opening = [o for o in self.conductor.speakable_orders() if o.kind == "open_item" and o.at >= started]
            if (moved_to.item_id != item.item_id and opening and joined.spoken and not joined.interrupted and not self.finishing
                    and not ending and not self.conductor.ended and not addresses_the_candidate(said_so_far)
                    and not announces_problem(said_so_far)
                    and not any(c["name"] == "show_problem" and c["result"].get("ok") for c in joined.tool_calls)):
                # The turn moved the plan on with a bare line ("Perfect."): the new part is opened in this same reply. A live round
                # said "Perfect.", fell silent, and 3 s later started on the introduction as a turn of its own.
                view2 = self._view(opening, [], None)
                state2 = state_block(view2) + "\n\n## Current item\n" + item_details(self.d.blueprint, view2["item"])
                history2 = [*self.history[-MAX_HISTORY:], {"role": "assistant", "content": said_so_far}]
                in_play = self.conductor.problem_allowed()
                async for sentence in self.talker.run(talker_messages(self.prefix, state2, history2, proactive=True), turn_id=str(turn),
                                                      current_slot=moved_to.slot_id, candidate_said=self.candidate_said.get(moved_to.item_id, ""),
                                                      tools=tools_for(in_play, bool(self.d.workspace.board_summary), self.conductor.workspace_for(moved_to)),
                                                      block_screen_claims=not in_play, neutral_on_blocked=False,
                                                      fillers_allowed=self._greeted, heard=heard, recent=self._recent_text(), hint_step=moved_to.hint_step,
                                                      time_talk_ok=time_ok, framing=moved_to.phase == "framing", spoken_before=joined.spoken,
                                                      limits_revealed=self._limits_revealed(moved_to)):
                    spoken += 1
                    yield sentence
                more = self.talker.last
                more.spoken = joined.spoken + more.spoken
                more.tool_calls = joined.tool_calls + more.tool_calls
                more.blocked = joined.blocked + more.blocked
                more.decision = more.decision or joined.decision
            base = self.talker.last
            base_text = " ".join(base.spoken)
            if (item.kind == "phase" and item.phase == "deep_dive" and self.conductor.current().item_id == item.item_id and base.spoken
                    and not base.interrupted and not self.finishing and not ending and not self.conductor.ended
                    and not any(c["name"] in ("next_item", "go_to") for c in base.tool_calls)
                    and not addresses_the_candidate(base_text) and not grants_a_pause(base_text) and not self.conductor.held()
                    and not self._question_open() and not self._deep_dive_exhausted()
                    and all(any(o is x for x in orders) for o in self.conductor.pending_orders() if o.kind == "open_item")):
                # A deep-dive reply that asked nothing leaves the candidate waiting. Ask for the question inside this same reply, once
                # (open_item orders of this turn are still pending here; one from earlier means the part's opening is still owed):
                # the ask_follow_up order below would be spoken as a second interviewer turn straight after this one (live round
                # 781a1f0a, turns 49 and 50).
                async for sentence in self.talker.run([*messages, {"role": "assistant", "content": base_text}, {"role": "user", "content": MUST_ASK}],
                                                      turn_id=str(turn), current_slot=item.slot_id, candidate_said=self.candidate_said.get(item.item_id, ""),
                                                      tools=offered, block_screen_claims=not problem_in_play, fillers_allowed=self._greeted,
                                                      quiet_coding=quiet_coding, time_talk_ok=time_ok, framing=item.phase == "framing",
                                                      spoken_before=base.spoken, verdict_budget=budget, limits_revealed=limits_revealed,
                                                      block_close_coding=holds_problem, block_leave_taking=block_leave_taking,
                                                      line_trouble_ok=self._connection_trouble(), shown_problem=shown_problem, problem_ahead=problem_ahead,
                                                      outline_said=self.conductor.outline_said, confirm_asked=self.conductor.format_confirm_asked,
                                                      known_words=self.known_words):
                    spoken += 1
                    yield sentence
                more = self.talker.last
                more.spoken = base.spoken + more.spoken
                more.tool_calls = base.tool_calls + more.tool_calls
                more.blocked = base.blocked + more.blocked
                more.decision = more.decision or base.decision
            bare = self.talker.last
            if ((item.phase == "wrap_up" or (self.conductor.current().phase == "wrap_up" and re.search(r"\bthank", " ".join(bare.spoken), re.IGNORECASE)))
                    and not self._wrap_goodbye_said and bare.spoken and not bare.interrupted and not self.finishing and not ending
                    and len(" ".join(bare.spoken).split()) < 6
                    and not re.search(r"\b(?:good ?bye|bye|take care)\b", " ".join(bare.spoken), re.IGNORECASE)):
                # The plan may have moved into the wrap-up inside this very turn (next_item), so the phase at the start of the reply is not enough
                # (final review, live round 781a1f0a, turn 58); the word count is over everything the turn said, both passes joined. A turn that only moved
                # the plan there counts when it said thanks (a leave-taking), not when it merely asked something.
                # The closing was cut to a bare thanks when its other sentence was held back ("Thanks for your time." is a leave-taking but no goodbye, live round 781a1f0a,
                # turn 58): the wrap-up always ends with the goodbye line, said and recorded like any other sentence of the turn.
                goodbye = WRAP_UP_TAIL if re.search(r"\bthank", " ".join(bare.spoken), re.IGNORECASE) else self._goodbye_line()
                self._wrap_goodbye_said = True
                bare.spoken.append(goodbye)
                self.talker.said.add(goodbye, str(turn))
                spoken += 1
                yield goodbye
            last = self.talker.last
            if not last.interrupted and not self.finishing and not ending:
                # A warning order the model did not carry out (a final warning swallowed by an answer about the constraints)
                # is said anyway, last: a later ending must never be the first the candidate hears of it.
                for line in unsaid_warnings([o.kind for o in talker_orders], " ".join(last.spoken)):
                    last.spoken.append(line)
                    yield line
            if not last.interrupted and not self.finishing:
                shown_ok = [c for c in last.tool_calls if c["name"] == "show_problem" and c["result"].get("ok")]
                line_said = any(says_the_problem_line(x) for x in last.spoken)
                if not line_said and any(o.kind == "problem_line" for o in orders):
                    line = next((o.line for o in orders if o.kind == "problem_line" and o.line), None) \
                        or problem_intro(self._line_number or self.conductor.problem_number(), self.conductor.lines, pack_id=self.conductor._pack_id())   # asked for this line alone: said exactly
                    last.spoken.append(line)
                    yield line
                elif not line_said and shown_ok and any(not c["result"].get("already") for c in shown_ok) \
                        and any(x.rstrip().endswith("?") for x in last.spoken):
                    # The turn asked them something in its own words and the problem went up anyway (it went up before the retry): no put-up line
                    # is said after the question; the invitation to read it comes as a turn of its own once the screen has changed.
                    self._line_due = self.conductor.problem_number()
                    if self.speaker is None or getattr(self.d.workspace, "hold", None) is None:
                        self._spawn(self._say_problem_line())
                elif not line_said and shown_ok and any(not c["result"].get("already") for c in shown_ok):
                    if not any(re.search(r"\bon your screen\b", x, re.IGNORECASE) for x in last.spoken):
                        late = bridge or next((o.bridge for o in self.conductor.pending_orders() if o.kind == "open_item" and o.bridge), None)
                        if late is not None and not bridged and not announces_coding_now(" ".join(last.spoken)):
                            bridged = True
                            last.spoken.append(late)
                            self.talker.said.add(late, str(turn))
                            yield late
                        put = self.conductor.put_up_line(self.conductor.problem_number(), take=True)      # the screen is about to change: they are told so first
                        last.spoken.append(put)
                        yield put
                    if self.speaker is not None and getattr(self.d.workspace, "hold", None) is not None:
                        self._line_due = self.conductor.problem_number()        # said after the screen changes, once the voice is done
                    else:
                        line = problem_intro(self.conductor.problem_number(), self.conductor.lines, pack_id=self.conductor._pack_id())
                        last.spoken.append(line)
                        yield line
                elif not line_said and shown_ok and any(o.kind == "open_item" for o in orders):
                    line = problem_intro(self.conductor.problem_number(), self.conductor.lines, pack_id=self.conductor._pack_id())       # it was already up: nothing will change, say it now
                    last.spoken.append(line)
                    yield line
            if reveal is not None and not self.talker.last.interrupted and not any(
                    c["name"] == "reveal" and c["result"].get("ok") for c in self.talker.last.tool_calls):
                # They asked for the constraints and the model did not put them on the screen: do it, the words said were only a promise.
                self._spawn(self.tools.execute(ToolCall(id="backstop", name="reveal", arguments={"kind": reveal_kind}), str(turn)))
            if not self.talker.last.interrupted:
                self.failures, self.first_failure_at, self.failed_at = 0, None, None
                self.unanswered, self.conductor.reply_owed = None, False
                if self.slow:
                    self.slow = False
            else:
                self.conductor.reply_owed = False      # the candidate took the floor: what they say next is the turn
        except TalkerFailed:
            failed = True
            self.failures += 1
            self.failed_at = self.d.clock()
            if self.first_failure_at is None:
                self.first_failure_at = self.failed_at
            self.slow = True
            self._utterance = utterance                # the retry builds the same activity digest
        finally:
            if warning_first or here_first:
                self.talker.last.spoken[:0] = warning_first + here_first   # the record says it was said, and first
            self._after_turn(turn, orders, item.item_id, started, failed, refused, activity, item.phase == "wrap_up", view["brief"] is not None, view["free_min"])

    def _set_aside(self, result: TurnResult, orders: list[Order], item_id: str) -> tuple[list[dict[str, str]], list[Order]]:
        """Orders this turn did not act on because what the candidate just said made them stale (decided 2026-10-17): the ones the
        talker named in log_turn, and a move_on it did not carry out (no next_item, no words leaving the part) in a turn it logged
        as staying on the part (a follow-up, a hint). A live round's plan moved to the next part after a turn that kept asking about
        the current one. With no log, a move_on not carried out still moves the plan: a turn often opens the next part's question
        without calling next_item."""
        decision = result.decision or {}
        named = {k for k in (decision.get("set_aside") or []) if isinstance(k, str)}
        why = str(decision.get("set_aside_why") or "").strip()[:200] or "no reason given"
        declared = str(decision.get("action") or "")
        moved = (any((c["name"] == "next_item" and not (c.get("result") or {}).get("deferred")) or (c["name"] in ("go_to", "open_thread", "close_thread") and (c.get("result") or {}).get("ok"))
                     for c in result.tool_calls) or leaves_the_part(" ".join(result.spoken))
                 or self.conductor.current().item_id != item_id)
        out: list[dict[str, str]] = []
        taken: list[Order] = []          # the orders it set aside: they were not acted on, so they cover nothing
        for o in orders:
            if o.consumed or o.kind not in SET_ASIDE_ORDERS or o.line:
                continue
            if o.kind == "move_on":
                refused = any(c["name"] in ("next_item", "go_to") and (c.get("result") or {}).get("deferred") for c in result.tool_calls)
                if moved or refused or o.at < (self.conductor.current().started_at or 0.0):
                    continue
                if o.kind in named:
                    reason = why
                elif declared in STAY_ACTIONS:
                    reason = f"stayed on the part ({declared})"
                else:
                    continue
            elif o.kind in named:
                reason = why
            else:
                continue
            if self.conductor.set_aside([o], reason):
                out.append({"kind": o.kind, "why": reason})
                taken.append(o)
        if any(x["kind"] == "move_on" for x in out):
            logger.info("move_on set aside: %s", out)
            self._trigger_director()
        return out, taken

    def _after_turn(self, turn: int, orders: list[Order], item_id: str, started: float, failed: bool,
                    refused: list[dict[str, Any]], activity: dict[str, Any] | None = None, started_in_wrap_up: bool = False,
                    brief_shown: bool = False, free_min: int | None = None) -> None:
        result = self.talker.last
        if result.interrupted or failed:
            self._away_line = None                    # the warning was not heard whole: the return clock waits for the next one
        warned, self._warned_now = self._warned_now, []
        # The talker asked a question in this turn and so was not allowed to put the problem up (decided 2026-10-18): the order to open it waits.
        deferred = any(c["name"] == "show_problem" and c["result"].get("deferred") for c in result.tool_calls)
        move_deferred = any(c["name"] in ("next_item", "go_to") and c["result"].get("deferred") for c in result.tool_calls)   # a coding problem refused: a question was asked
        absent = self.conductor.away_paused()      # they left while this reply ran: nothing moves the plan now
        pending_before = [o for o in self.conductor.orders if not o.consumed]
        self._held_turn_over = True
        if self._screen_held and (not result.spoken or result.interrupted or failed
                                  or (self._spoke_while_held and not self.conductor.agent_speaking)):
            self._spawn(self._release_screen())        # nothing left for the voice to say (or it already has): show it now
        cur = self.conductor.current()
        set_aside: list[dict[str, str]] = []
        aside_orders: list[Order] = []
        if not result.interrupted and not failed:
            for kind, about in warned:
                self.conductor.note_warning(kind, about, turn)       # the interviewer remembers what it warned about
            set_aside, aside_orders = self._set_aside(result, orders, item_id)
            self.conductor.consume([o for o in orders if not ((deferred and o.kind == "open_item") or (move_deferred and o.kind == "move_on")
                                                              or (absent and o.kind in ("move_on", "wrap_up_now")))])      # a deferred problem or move is still owed
            # Only a timer order issued for the part we are still in moves the plan on: one from an earlier part is spent, and
            # one this turn set aside leaves the part where it is (the director decides again).
            moved_on = any(o.kind in ("move_on", "wrap_up_now") and o.at >= (cur.started_at or 0.0)
                           and not any(x["kind"] == o.kind for x in set_aside) for o in orders) and not move_deferred and not absent
            if moved_on and cur.item_id == item_id and not self.conductor.ended and self.conductor.can_advance()[0]:
                self.conductor.next_item("move_on")
                if self.tools.shows_card() and not self.tools._on_screen():
                    # A slot never becomes current with nothing on screen: put the problem up as the other paths do (the open_item
                    # order the move made has the interviewer invite them to read it).
                    self._spawn(self.tools.execute(ToolCall(id="move-on", name="show_problem", arguments={}), str(turn)))
        text = " ".join(result.spoken)
        if text and not result.interrupted and not failed:
            self._note_problem_line(text)
            self._greeted = True
            # Tools run after the speech: a remark flagged by a turn that already warned about it must not be warned about again.
            flagged_now = [o for o in self.conductor.pending_orders() if o.kind == "conduct_warning" and o.at >= started]
            if flagged_now and not unsaid_warnings(["conduct_warning"], text):
                self.conductor.consume(flagged_now)
            # Likewise an ending its own flag decided, in a turn that already said goodbye: saying it again is a second goodbye.
            ending = self.conductor.end_order
            if ending is not None and not ending.consumed and ending.at >= started and is_farewell(text):
                self.conductor.consume([ending])
        if text and not result.interrupted and not failed and gives_outline(text):
            self.conductor.outline_said = True
            if asks_format_check(text):
                self.conductor.format_confirm_asked = True       # the check on the outline is asked once, ever
        if not result.interrupted and not failed and any(c["result"].get("ok") for c in result.tool_calls):
            self.conductor.reset_asks()
        if result.decision is None and not result.interrupted and not failed:
            # The model did not call log_turn: record what the turn did, so the trace is complete.
            result.decision = {"condition": "not recorded by the model", "reason": "conductor-recorded", "inferred": True,
                               "action": next((INFERRED_ACTIONS[c["name"]] for c in result.tool_calls if c["name"] in INFERRED_ACTIONS), "continue")}
        covered_now: list[str] = []

        def taken_orders() -> list[Order]:
            """The orders this turn took (consumed by now): a set-aside order was not acted on and covers nothing (decided 2026-10-18)."""
            return [o for o in pending_before if o.consumed and all(o is not x for x in aside_orders)]

        if text and not result.interrupted and not failed:
            if "?" in text:
                self._last_ask_at = self.d.clock()
            self.conductor.note_interviewer_line(text, turn)      # a question asked a second time with no answer in between is dropped (counted only if played: see _drop_unplayed)
            for o in orders:
                if o.kind == "skip_notice" and not self.finishing and not self.conductor.notice_said(o, text):
                    self.conductor.renew_notice(o)          # the notice was ordered and not said: ordered again
        if not result.interrupted:
            self.tool_refused = [{"tool": c["name"], "reason": c["result"].get("error")} for c in result.tool_calls
                                 if c["result"].get("ok") is False]
        # The plan follows the conversation first: moving to the next part creates the order to open it, which this very turn
        # may already have satisfied (it asked the part's opening question), so it must exist before that is checked.
        self._open_the_part_the_words_opened(text, result, failed, item_id)       # earlier parts first: this one only moves forward from them
        self._keep_the_promise_to_return(text, result, failed, item_id)
        self._follow_the_conversation(text, result, failed, item_id)
        if text and not result.interrupted and not failed:
            # After the moves the words made (a turn that opens the deep dive without next_item moves the plan above): the outline's promises
            # this turn asked about are kept, whatever they answer.
            covered_now = self.conductor.mark_covered(text, taken_orders())
        opened_now = bool(result.spoken) and (addresses_the_candidate(" ".join(result.spoken))
                                              or any(c["name"] == "show_problem" and c["result"].get("ok") for c in result.tool_calls))
        if opened_now and not deferred and not result.interrupted and not failed:
            # An order to open the part this very turn moved to is satisfied when the turn asked a question or showed the problem.
            self.conductor.consume([o for o in self.conductor.pending_orders()
                                    if o.kind == "open_item" and all(o is not x for x in orders)
                                    and (not o.opens_aloud or self.conductor.asks_the_item(o, " ".join(result.spoken)))])      # (a question asked aloud is opened by being asked)
        shown_this_turn = any(c["name"] == "show_problem" and c["result"].get("ok") for c in result.tool_calls)
        if (text and not result.interrupted and not failed and not self.conductor.ended and not shown_this_turn
                and self.conductor.problem_allowed() and self.tools.shows_card() and not self.tools._on_screen() and any(announces_problem(s) for s in result.spoken)):
            # They were told the problem is on their screen (from the problem itself or from the conversation before it, once a
            # problem is allowed) and it is not: show it, the words were already spoken. show_problem runs the plan on if needed.
            # Never when this turn put a problem up already: the plan may have moved to the next one since, and that one is not promised.
            self._spawn(self.tools.execute(ToolCall(id="backstop", name="show_problem", arguments={}), str(turn)))
        cur = self.conductor.current()
        paused = grants_a_pause(text)
        if paused and text and not result.interrupted and not failed and not self.conductor.held():
            # "take your minute, I'll wait": the plan keeps that promise too. It was said in this turn's words, so its order is
            # spent: left pending, a later turn told them "you can take it" as if they had asked.
            self.conductor.consume([self.conductor.hold()])
        if (text and not result.interrupted and not failed and not self.conductor.ended and cur.kind == "phase"
                and cur.phase in ("small_talk", "framing", "candidate_intro", "deep_dive") and not addresses_the_candidate(text)
                and not paused and not self.conductor.held() and not self._question_open() and not self._deep_dive_exhausted()
                and not any(o.kind == "open_item" for o in self.conductor.pending_orders())):
            # A turn in the conversation that asked them nothing leaves the candidate waiting: the next turn must ask. Not when it
            # asked nothing on purpose, because they asked for a moment: a question then would take the moment back.
            self.conductor.ask_follow_up(held_back_problem=any(b.get("rule") == "screen_claim" for b in result.blocked))
        declared = (result.decision or {}).get("action")
        # A different problem was promised, or asked for and told "it's on your screen", with no next_item behind it: do the move.
        promised = ((moves_to_another_problem(text) or (asks_for_next_problem(self._asked) and (announces_problem(text) or SCREEN_CLAIM.search(text))))
                    and self.conductor.current().kind == "slot"
                    and not any(c["name"] == "show_problem" and c["result"].get("ok") for c in result.tool_calls))
        if (text and ((leaves_the_part(text) and declared in MOVE_ON_ACTIONS) or promised) and not result.interrupted and not failed and not self.conductor.ended
                and not any(c["name"] == "next_item" for c in result.tool_calls) and self.conductor.can_advance()[0]
                and self.conductor.current().item_id == item_id and self.conductor.current().phase not in ("candidate_questions", "wrap_up")
                and (self.conductor.current().kind != "slot" or self.tools.in_play())
                # A turn whose own flow tool succeeded already moved the plan (or put the problem up): its words are about that move.
                and not any(c["name"] in MOVING_TOOLS and c["result"].get("ok") for c in result.tool_calls)
                # Whatever path leaves a problem: one nobody has spoken on yet is not left (rh13_wanders_off turn 19: the plan was
                # already on it when the turn began, so item_id was the problem itself and the same-item check above proved nothing).
                and self.conductor.may_leave_problem(self.conductor.current())[0]):
            if self.conductor.current().kind == "slot":
                self.conductor.plan_extra_problem()
            self.conductor.next_item("declared move on")
        self._show_the_problem_already_introduced(turn, item_id, result, failed, started)
        phase = self.conductor.current().phase
        problems_done = not any(i.kind == "slot" and i.status in ("pending", "active") for i in self.conductor.items)
        # A goodbye exchange closes the round in any part: the interviewer's farewell answering the candidate's own goodbye.
        goodbye_back = bool(self.transcript) and self.transcript[-1]["speaker"] == "candidate" and ends_with_goodbye(self.transcript[-1]["text"])
        # A farewell in the candidate's questions before they have had a turn there is not the end: the interviewer opened the part (or said a
        # goodbye while inviting them) and the candidate has asked nothing yet (bf82d318 turn 37; decided 2026-10-18). Only their own goodbye,
        # the conduct and proctor ends, their End button and the time cap close the round without that exchange.
        unasked = phase == "candidate_questions" and self.conductor.current().turns < MIN_TURNS.get("candidate_questions", 1)
        said_goodbye = ((phase in ("candidate_questions", "wrap_up") or problems_done) and is_farewell(text) and not unasked) \
            or (goodbye_back and ends_with_goodbye(text))
        if not result.interrupted and not failed and text and not self.conductor.ended and (said_goodbye or started_in_wrap_up):
            self.conductor.close_out()                  # the closing has been said: the round is over, nothing more is asked
        if text and not result.interrupted and not failed and any(o.kind == "keep_problem" for o in orders):
            self.conductor.refusal_points |= refusal_points(text)       # what the candidate heard this refusal say: the next one makes other points
            # ... and in which words, so the next one cannot say the same thing again in other words (live round 781a1f0a, turns 27 and 29).
            said = [x for x in re.split(r"(?<=[.!?])\s+", text) if len(content_words(x)) >= REFUSAL_MIN_WORDS]
            self.conductor.refusal_sentences = [*self.conductor.refusal_sentences, *said][-12:]
        self.transcript.append({"seq": turn, "speaker": "interviewer", "text": text})
        self._spawn(self.d.store.append_turn({
            "session_id": self.session_id, "candidate_id": self.candidate_id, "seq": turn, "speaker": "interviewer",
            "text": text, "at": started, "item_id": item_id, "orders": [asdict(o) for o in orders], "decision": result.decision,
            "tool_calls": result.tool_calls, "blocked": result.blocked, "first_token_ms": result.first_token_ms,
            "end_to_first_token_ms": (int((started - self.turn_ended_at) * 1000 + (result.first_token_ms or 0))
                                      if self.turn_ended_at is not None else None),
            "usage": result.usage, "provider": result.provider, "interrupted": result.interrupted, "error": result.error,
            "model": result.model, "hedged": result.hedged, "fillers": result.fillers, "attempts": result.attempts,
            "spoke_after_tools": result.spoke_after_tools, "repaired": result.repaired,
            # the wordings of lines.py the run picked since the last turn and that this turn's words contain: the run's own fixed lines, as opposed to
            # the model saying the same words (the trace check exempts only the first from the opener check)
            "fixed": [w for w in self.conductor.lines.take_log() if w in text], "followed": self._followed(text, item_id),
            "brief_position": self.brief_for if brief_shown else None, "free_min": self._free_min() if free_min is None else free_min, "refused": refused, "activity": activity, "set_aside": set_aside,
            "reply_began_ms": getattr(self, "_entered_ms", None),
            **({"conduct_check_ms": self.conduct_check["ms"], "conduct_check": self.conduct_check} if self.conduct_check else {}),
            **({"change_decision": self.change_decision} if self.change_decision else {}),
        }))
        if text and not result.interrupted and not failed and self.speaker is not None:
            # Spoken as far as anyone knows, until the voice confirms it played (conversation_item_added): see _drop_unplayed.
            self._unconfirmed[turn] = {"key": _norm(text)[:24], "at": self.d.clock(), "outline": gives_outline(text),
                                       "paused": paused and self.conductor.held(),
                                       "orders": taken_orders(), "spoken": list(result.spoken),
                                       "covered": covered_now, "item_id": item_id}
        elif turn == self._checkin_turn:
            if text and not result.interrupted and not failed:
                self._checkin_played()          # no voice to confirm anything (a text session): it counts as played when said
            else:
                # Nothing reached the voice (cut, failed, no sound): the check-in was not asked.
                self._checkin_turn = None
                self.addressed.checkin_used.discard(self.addressed.checkin_item or "")
                self.addressed.checkin_item = None
        end = self.conductor.end_order
        if self.failures >= FAILURES_TO_END and self.first_failure_at is not None \
                and self.d.clock() - self.first_failure_at >= TECHNICAL_AFTER_S:
            self._spawn(self.finish(self._end_reason("technical")))
        elif end is not None and (end.consumed or not end.speak):
            self._spawn(self.finish(end.end_reason or "completed"))
        self._trigger_director()
        self._spawn(self._sync_room_state())
        self._spawn(self._checkpoint())

    async def _checkpoint(self) -> None:
        await self.d.store.save_checkpoint(self.session_id, {
            "checkpoint": self.conductor.checkpoint(), "history": self.history[-MAX_HISTORY * 2:], "summary": self.summary,
            "seq": self.seq, "mirror": self.d.workspace.mirror_state(), "addressed": {**self.addressed.to_dict(), "problem_shown_ago": (self.d.clock() - self._problem_shown_at) if self._problem_shown_at is not None else None},
            "updated_at": _iso()})

    # ------------------------------------------------------------ events and time

    async def on_web_message(self, m) -> None:
        if m.type in IGNORED_WEB_TYPES:
            return
        if not self.begun.is_set():
            self._early.append(m)                      # the round has not started: held, then handled in order
            return
        if m.type == "activity.batch":
            self._ingest_activity(m)
            return
        if m.type == "proctor.event":
            if m.kind == "foreign_paste":
                self.conductor.on_paste(m.source or "external", m.chars or 0, m.lines or 0, float(m.at))   # a record only: nothing is said or ordered
                return
            self.conductor.on_proctor(m.kind, m.weight, m.at)
            self._speak_soon()
        elif m.type == "proctor.away":
            self.conductor.on_away(list(m.kinds))
        elif m.type == "proctor.back":
            gap = max(0.0, self.d.clock() - float(self.conductor.away["started"])) if self.conductor.away else 0.0
            welcome = self.conductor.on_back()         # back in time: the pending clock is gone, the paused clocks are moved on and it costs nothing
            self._away_line = None
            self._shift_run_clocks(gap)
            if self._brief_waiting is not None and not self.conductor.ended:
                waiting, self._brief_waiting = self._brief_waiting, None
                await self._on_brief(*waiting, saved=True)
            if welcome and not self.conductor.ended and self._nod("away:back"):
                self._back_until = self.d.clock() + AWAY_WELCOME_GAP_S         # (once per episode: the flag went with the episode)
            elif self.conductor.pending_orders():
                self._speak_soon()                     # what was held while they were away is spoken now, in order
        elif m.type == "code.snapshot":
            self._code_at = self.d.clock()
            if self._trailed is not None and self._trailed[2] == CODE_QUIET_S:
                self._trailed = (self._trailed[0], self._code_at, CODE_QUIET_S)      # still typing: the late answer waits for the quiet
            self.conductor.on_code_change(m.text, m.language)
        elif m.type == "board.summary":
            self.conductor.on_board_change()
            self.conductor.on_board_summary(m.text)
        elif m.type == "ask.interviewer":
            self.addressed.ask_armed_until = self.d.clock() + ASK_ARMED_S      # classification itself respects the mode
        elif m.type == "ask.selection":
            self.ask = {"surface": m.surface, "quote": m.quote, "item_id": m.item_id}
        elif m.type == "session.end_request":
            last = next((t["text"] for t in reversed(self.transcript) if t["speaker"] == "interviewer" and t["text"]), "")
            order = self.conductor.on_end_request(farewell_said=ends_with_goodbye(last))
            if order.speak:
                self._speak_soon()
            else:
                # Their goodbye was already answered: nothing is said, the round ends now rather than at the watchdog.
                self._spawn(self.finish(self._end_reason("candidate_ended")))
            self._spawn(self._end_request_watchdog())
        self._trigger_director()

    def _shift_run_clocks(self, gap: float) -> None:
        """The run's own clocks stop while they are away, as the conductor's do (never past now)."""
        now = self.d.clock()
        if gap <= 0:
            return
        if self._problem_shown_at is not None:
            self._problem_shown_at = min(self._problem_shown_at + gap, now)
        if self._started_coding_at is not None:
            self._started_coding_at = min(self._started_coding_at + gap, now)
        if self.addressed.checkin_at is not None:
            self.addressed.checkin_at = min(self.addressed.checkin_at + gap, now)

    async def _end_request_watchdog(self) -> None:
        await asyncio.sleep(END_REQUEST_WATCHDOG_S)
        if not self.finishing:
            await self.finish(self._end_reason("candidate_ended"))

    async def _sync_direct_only(self) -> None:
        """Mode on: tell the web page when the current item turns direct-only, and again when the item changes (so the panel's note matches)."""
        if self.d.addressed_mode != "on":
            return
        direct = self._item_direct_only()
        if direct == self._direct_sent:
            return
        self._direct_sent = direct
        try:
            await self.d.workspace.send({"type": "addressed.state", "direct_only": direct})
        except Exception as exc:  # noqa: BLE001 - a panel note that cannot be sent is not worth failing a tick
            logger.warning("addressed.state not sent: %s", exc)

    async def _for_nobody(self) -> bool:
        """Mode on: the check on the latest candidate turn (waited for, bounded by its own timeout) placed it as thinking aloud or reading the problem."""
        if self.d.addressed_mode != "on" or self._addr_ctx.get("seq") != self.seq:
            return False
        _, task = self._addressed_now
        if task is not None and not task.done():
            await asyncio.wait({task})
        if self._addr_ctx.get("item_id") in self.addressed.direct_only_items:
            return not self._specific_ask(self._addr_ctx)
        return self._addr_ctx.get("result") in ("reading_problem", "thinking_aloud")

    async def tick(self) -> None:
        if self.finishing:
            return
        new = self.conductor.tick()
        self._trigger_director()
        now_s = self.d.clock()
        if self._trailed is not None and now_s - self._trailed[1] >= self._trailed[2] and not self.conductor.candidate_speaking \
                and not self.conductor.agent_speaking and not self.tracker.turn_open(now_s):
            # They trailed off ("So...") and then stayed quiet: they had finished. Answer that turn now, not at the next check-in.
            late, self._trailed = self._trailed[0], None
            if await self._for_nobody():
                self.unanswered, self.conductor.reply_owed = None, False        # the model placed it as thinking or reading: nothing was asked
            else:
                self.answer_late = late
                self._speak_soon(force=True)
        st = self.addressed
        if (self.d.addressed_mode == "on" and st.checkin_at is not None and not st.nudged and not self._item_direct_only() and now_s - st.checkin_at >= NUDGE_AFTER_S
                and not self.conductor.candidate_speaking and not self.conductor.agent_speaking and not self.tracker.turn_open(now_s)
                and not self._reply_in_flight() and not self.conductor.away_paused() and self._nod("addressed:nudge")):
            st.nudged = True       # one nudge after the check-in, never a second, never a reply: a silence is not a question
        await self._sync_room_state()
        await self._sync_direct_only()
        now = self.d.clock()
        if self.conductor.reply_owed and self.unanswered is not None and self.turn_ended_at is not None \
                and now - self.turn_ended_at >= DEAD_AIR_S and now - self.reply_requested_at >= DEAD_AIR_S \
                and not self._reply_in_flight() and not self.conductor.agent_speaking and not self.conductor.candidate_speaking \
                and not self.tracker.turn_open(now) and not self.conductor.held() and self._trailed is None:
            # Nothing started answering them: a reply cut before its audio, or one that never began, left dead air (live round 781a1f0a, turn 10).
            logger.warning("candidate turn %s was left unanswered for %.0f s; answering it", self.seq, now - self.turn_ended_at)
            self.answer_late = self.unanswered
            self._speak_soon(force=True)
        if not self.conductor.agent_speaking:
            for turn in [t for t, u in self._unconfirmed.items() if now - u["at"] >= UNPLAYED_AFTER_S]:
                self._drop_unplayed(turn)
        line = self._away_line
        if line is not None and now - line["at"] >= line["seconds"] + AWAY_PLAYBACK_GRACE_S and not self.conductor.agent_speaking:
            # The voice never said the warning finished: it has taken as long as the line takes to say, so the clock starts from there.
            self._away_line = None
            self.conductor.start_return_clock(line["at"] + line["seconds"])
        if self._screen_held and now - self._screen_held_at >= SCREEN_HOLD_MAX_S:
            await self._release_screen()              # the voice never reported finishing: show it anyway
        if self.failed_at is not None and self.conductor.reply_owed and now - self.failed_at >= RETRY_AFTER_FAILURE_S \
                and now - self.reply_requested_at >= RETRY_AFTER_FAILURE_S:
            self._speak_soon(force=True)               # the last reply failed: ask for it again, never a "you're quiet" check-in
        pending = self.conductor.speakable_orders()
        if pending and not new and self.conductor.end_order is None and now - self.reply_requested_at >= REPLY_RETRY_S \
                and (self.conductor.urgent_pending() or self.conductor.quiet_for_s() >= ORDER_SPACING_S):
            self._speak_soon()                          # an order that waited for the interviewer to have been quiet a moment
        end = self.conductor.end_order
        if end is not None and end.speak and not end.consumed:
            # An ending decided while the agent or candidate was talking: say it as soon as the floor is free, and carry it out
            # even if it never gets said. The grace counts from when the floor was last free (the voice may still be finishing the
            # turn before) or from the start of the reply that is saying it, so that reply is never cut off by its own deadline.
            now = self.d.clock()
            counts_from = max(end.at, self._end_reply_at, self.conductor.agent_spoke_at)
            if now - end.at >= (AWAY_END_HARD_S if end.about == "away_cap" else END_ORDER_HARD_S) or (now - counts_from >= END_ORDER_GRACE_S and not self.conductor.agent_speaking):
                await self.finish(self._end_reason("technical"))
            elif now - self.reply_requested_at >= REPLY_RETRY_S:
                self._speak_soon()
        elif new and (self.conductor.urgent_pending() or self.conductor.quiet_for_s() >= ORDER_SPACING_S):
            self._speak_soon()

    async def tick_forever(self, every: float = 1.0) -> None:
        while not self.finished.is_set():
            try:
                await self.tick()
            except Exception as exc:  # noqa: BLE001 - one bad tick must not stop the clock
                logger.warning("tick failed: %s", exc)
            await asyncio.sleep(every)

    def _connection_trouble(self) -> bool:
        """The candidate left the room or came back in the last two minutes: the only time the interviewer may say the line was bad."""
        return self.connection_event_at is not None and self.d.clock() - self.connection_event_at < CONNECTION_TROUBLE_S

    def on_candidate_left(self) -> None:
        self.connection_event_at = self.d.clock()
        # A dropped connection is not an away episode (spec §7.2): the absence rules below own it, so the two never count the same minutes.
        self.conductor.on_back()
        self._away_line = None
        if self.left_at is None:
            self.left_at = self.d.clock()
        if self._left_task is None or self._left_task.done():
            self._left_task = asyncio.create_task(self._wait_for_return())

    def on_candidate_back(self) -> None:
        self.connection_event_at = self.d.clock()
        if self._left_task is not None:
            self._left_task.cancel()
            self._left_task = None
        if self.left_at is None:
            return
        away, self.left_at = self.d.clock() - self.left_at, None
        if away >= ABSENCE_VIOLATION_S and not self.finishing:
            # Gone long enough to be more than a page refresh: it counts like leaving the tab.
            self.conductor.on_proctor("tab_hidden", 1, int(self.d.clock() * 1000))
            self._trigger_director()
            self._speak_soon()

    async def _wait_for_return(self) -> None:
        await asyncio.sleep(CANDIDATE_GONE_S)
        if not self.finishing:
            await self.finish(self._end_reason("technical"))

    # ------------------------------------------------------------ the director

    def _trigger_director(self) -> None:
        if self.conductor.away_paused():
            return                                     # paused: no new brief while they are away (the reasons wait and fire when they are back)
        reasons = self.conductor.take_triggers()
        if reasons and not self.finishing:
            self.director.trigger(reasons)

    async def _director_messages(self) -> list[dict[str, Any]]:
        image = None
        board = self.d.workspace.board_summary
        if board and board != self.board_seen_by_director:
            self.board_seen_by_director = board
            image = await self.d.workspace.request_snapshot()
        c = self.conductor
        now = self.d.clock()
        used = int((now - (c.started_at or now)) / 60)
        planned_min = int(c.planned_seconds()) // 60
        snapshot = {
            "position": c.position,
            # The director has no other clock: without this it guessed, and briefed "we're nearly out of time" ten minutes into 45.
            "clock": {"round_min": planned_min, "used_min": used, "left_min": max(0, planned_min - used)},
            "items": [{"item_id": i.item_id, "kind": i.kind, "phase": i.phase, "status": i.status, "hint_step": i.hint_step,
                       "elapsed_min": int(((i.ended_at or now) - i.started_at) / 60) if i.started_at else 0,
                       "max_min": max(1, i.max_seconds // 60), "extra_min": int(c.extensions.get(i.item_id, 0.0) // 60),
                       "filler": i.filler}
                      for i in c.items],
            "current": {"item_id": c.current().item_id, "slot_id": c.current().slot_id,
                        "follow_ups": c.follow_ups.get(c.current().item_id, []),
                        **({"item_rules": rules} if (rules := self._item_rules("director")) else {})},
            "transcript": self.transcript[-120:], "summary": self.summary, "code": getattr(self.d.workspace, "code", None),
            "board": board, "proctor": c.proctor, "conduct": c.conduct, "warnings": {"summary": c.warnings_summary(), "given": c.warnings_given}, "plan_changes": c.plan_changes, "last_brief": self.brief,
            "set_aside": c.dropped[-8:], "on_screen": self._screen_for_director(),
            "focus": self._focus_label(),
            "flow": {"current": {"id": c.current().item_id, "kind": c.current().kind, "title": c.current().title, "why": c.current().why},
                     "moves": c.flow_log[-6:], "free_min": int(c.free_seconds() // 60), "threads_opened": c.threads_opened},
            "activity": [{"started_at": d["started_at"], "duration_s": d["duration_s"], "text": d["text"]} for d in self.digests[-12:]],
        }
        return director_messages(self.d.blueprint, self.d.context, snapshot, image)

    _QUESTION_OPENER = re.compile(r"^\W*(?:can|could|would|will|do|did|does|is|are|how|what|why|where|which)\b", re.IGNORECASE)

    def _recent_candidate_words(self) -> str:
        """What the candidate last said, with a dangling fragment before it joined on ("Can you" + "See the solution yourself.")."""
        said = [t["text"] for t in self.transcript if t["speaker"] == "candidate"][-2:]
        if len(said) == 2 and "?" not in said[0] and len(said[0].split()) <= 3:
            return " ".join(said)
        return said[-1] if said else ""

    def _director_conduct_is_rudeness(self, brief: Brief) -> bool:
        """A director finding may be spoken only for rudeness or abuse aimed at the interviewer: the candidate's recent words must pass the code screen,
        the director must not call it dismissive/not abusive, and joined fragments that make a question are no conduct matter."""
        reason = (brief.conduct.reason or "").lower()
        if re.search(r"\bnot (?:abusive|rude|an insult)|dismissive|curt|blunt|impatient", reason):
            return False
        words = self._recent_candidate_words()
        if self._QUESTION_OPENER.search(words) and not directed_abuse(words):
            return False
        return maybe_conduct(words) or directed_abuse(words)

    async def _on_brief(self, brief: Brief, meta: dict[str, Any], saved: bool = False) -> None:
        if self.conductor.away_paused():
            # Paused: the brief and its evidence are stored at once (as an unpaused run would); applying it waits until they are back.
            await self.d.store.append_brief({"session_id": self.session_id, "candidate_id": self.candidate_id,
                                             "at": self.d.clock(), "brief": brief.model_dump(), "outcome": {"paused": True}, **meta})
            if brief.evidence:
                await self.d.store.upsert_evidence(self.session_id, self.candidate_id, [e.model_dump() for e in brief.evidence])
            self._brief_waiting = (brief, meta)
            return
        outcome = self.conductor.apply_brief(brief.model_dump())
        if brief.summary:
            self.summary = brief.summary
        if outcome["stale"]:
            self.brief = {**(self.brief or {}), "tone": brief.tone}
            # A brief for a part the plan had already left applied nothing (live round 781a1f0a: a 27 s brief came back for a finished part
            # and no new one followed), so ask once more for the part now current. Once per position, so a slow director cannot loop.
            # Per-run state, not checkpointed: a restarted run briefs afresh anyway.
            c = self.conductor
            same_part = c.position_items.get(brief.for_position) == c.current().item_id
            if not same_part and not self.finishing and self._stale_rerun_for != c.position:
                self._stale_rerun_for = c.position
                self.director.trigger({"stale"})
        else:
            self.brief = {"for_position": brief.for_position, "goal": brief.goal, "next_move": brief.next_move.model_dump(),
                          "tone": brief.tone}
            # A change the brief itself made (a swapped problem) moved the position: it was written for the part the talker is
            # on now, so it is shown there.
            self.brief_for = self.conductor.position
            self.brief_turns = self.conductor.candidate_turns    # how many of their turns it has seen (it ages as they speak)
        # The director may open a conduct incident the talker missed, never add a second one: a repeat is the
        # talker's to flag, so one remark can't be counted twice (once by the talker, once by the director).
        if brief.conduct.concern != "none" and not self.conductor.conduct and not self._director_conduct_is_rudeness(brief):
            self.conductor.note_conduct(f"director:{brief.conduct.concern}", brief.conduct.reason, "director",
                                        "not rudeness or abuse aimed at the interviewer (no screen match, or a question once the fragments are joined)")
        elif brief.conduct.concern != "none" and not self.conductor.conduct:
            if self.conductor.on_conduct(f"director:{brief.conduct.concern}", brief.conduct.reason,
                                         f"brief-{self.director.runs}", "director") is not None:
                self._speak_soon()
        if saved:
            return
        await self.d.store.append_brief({"session_id": self.session_id, "candidate_id": self.candidate_id,
                                         "at": self.d.clock(), "brief": brief.model_dump(), "outcome": outcome, **meta})
        if brief.evidence:
            await self.d.store.upsert_evidence(self.session_id, self.candidate_id, [e.model_dump() for e in brief.evidence])

    async def _on_director_failure(self, error: str) -> None:
        await self.d.store.append_brief({"session_id": self.session_id, "candidate_id": self.candidate_id,
                                         "at": self.d.clock(), "error": error})

    # ------------------------------------------------------------ ending

    def _unsaid_ending(self) -> str | None:
        """The fixed sentence of an ending the talker never got to say, or None when it was said (or there is none)."""
        end = self.conductor.end_order
        return end.line if end is not None and end.speak and not end.consumed and end.line else None

    def _goodbye_line(self) -> str:
        first = str(self.d.context.get("first_name") or "").strip()
        return f"Thank you for your time today{', ' + first if first else ''}. Take care, and goodbye."

    def _ending_message(self, reason: str) -> str:
        if reason == "completed":
            return (self.d.blueprint.get("persona") or {}).get("closing") or "Thanks for your time today."
        if reason == "ended_by_interviewer":
            unsaid = self._unsaid_ending()
            if unsaid:
                return unsaid                          # the last line said was not the ending: the page must not show it as one
            last = next((h["content"] for h in reversed(self.history) if h["role"] == "assistant"), "")
            return last or "The interviewer ended the interview."
        if reason == "candidate_ended":
            return "You ended the interview."
        return "The connection to your interviewer was lost."

    async def reaffirm_end(self) -> None:
        """Say a finished interview's ending again: to the page (once it has said hello), to the API (idempotent, and
        the call that may have been missed), then free the room. Writes nothing over the finished run."""
        saved = self.ended_run or {}
        reason = saved.get("end_reason") or "completed"
        self.finishing = True
        try:
            await self.d.workspace.send({"type": "session.ending", "reason": reason, "message": self._ending_message(reason)[:1000]})
            await self.d.workspace.wait_ready(10.0)
            try:
                await self.d.api.end(self.session_id, reason, saved.get("live_summary") or {})
            except Exception as exc:  # noqa: BLE001 - the API's sweep is the backstop
                logger.warning("ending session %s in the API failed: %s", self.session_id, exc)
            if self.speaker is not None:
                await self.speaker.delete_room()
        finally:
            self.finished.set()

    async def finish(self, reason: str) -> None:
        if self.finishing:
            return
        self.finishing = True
        self._brief_waiting = None                    # (already stored when it arrived; never applied to a finished round)
        try:
            if self.speaker is not None:
                await self.speaker.wait_for_playout()
                unsaid = self._unsaid_ending()
                if unsaid and reason == "ended_by_interviewer":
                    # The talker never said why it is over: the fixed line is said, so the candidate hears it rather than silence.
                    try:
                        await self.speaker.say(unsaid)
                    except Exception as exc:  # noqa: BLE001 - the page gets the same line; the ending goes on
                        logger.warning("could not say the ending: %s", exc)
            await self.d.workspace.send({"type": "session.ending", "reason": reason, "message": self._ending_message(reason)[:1000]})
            summary = self.conductor.live_summary()
            # The run is finalized BEFORE the API hears the round ended: ending it there starts the evaluation, which reads this
            # record (its end reason, checkpoint and board) and must never see it half-written.
            board_backup = getattr(self.d.workspace, "board_backup", None)
            try:
                await self.d.store.finalize_run(self.session_id, {
                    "ended_at": _iso(), "end_reason": reason, "live_summary": summary, "summary": self.summary,
                    "checkpoint": self.conductor.checkpoint(), "seq": self.seq,
                    "board_scene": base64.b64encode(board_backup[0]).decode() if board_backup else None})
            except Exception as exc:  # noqa: BLE001 - the session must still end in the API; the evaluation retries a run not final
                logger.warning("finalizing live run %s failed: %s", self.session_id, exc)
            try:
                await self.d.api.end(self.session_id, reason, summary)
            except Exception as exc:  # noqa: BLE001 - the API's sweep is the backstop
                logger.warning("ending session %s in the API failed: %s", self.session_id, exc)
            await self.director.aclose()
            if self.speaker is not None:
                await self.speaker.delete_room()
        finally:
            self.finished.set()
