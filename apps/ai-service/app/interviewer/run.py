"""One live interview (spec §5): the conductor's rules, the talker's turns, the director's briefs, the
workspace and the store, wired together. Independent of LiveKit: the worker's adapter calls the hooks,
and the simulator drives the same object with text."""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable

from app.interviewer.activity import ActivityTracker, Utterance
from app.interviewer.brief import Brief
from app.interviewer.closing import (addresses_the_candidate, announces_problem, asks_for_next_problem, asks_for_questions,
                                     asks_interviewer_to_edit, asks_to_change_problem, gives_outline, is_acknowledgement, is_farewell,
                                     leaves_the_part, matches_probe, moves_to_another_problem, needs_no_reply, says_the_problem_line,
                                     starts_coding)
from app.interviewer.conductor import ORDER_SPACING_S, Conductor, Order, Rules
from app.interviewer.digest import digest_for_utterance, digest_idle
from app.interviewer.director import Director
from app.interviewer.guard import LeakGuard
from app.interviewer.llm import ToolCall
from app.interviewer.plan import BRIDGES, layout_for, problem_intro, round_seconds, wire_ids
from app.interviewer.prompts import director_messages, item_details, opening_hint, state_block, talker_messages, talker_prefix
from app.interviewer.talker import SCREEN_CLAIM, Pacing, TalkerFailed, TalkerTurn
from app.interviewer.tools import ToolExecutor, tools_for

logger = logging.getLogger(__name__)
MAX_HISTORY = 20
FAILURES_TO_END = 3
TECHNICAL_AFTER_S = 90.0     # failed replies end the round only once they have gone on this long (a provider blip is not an ending)
RETRY_AFTER_FAILURE_S = 4.0  # a reply that failed is asked for again after this long
CANDIDATE_GONE_S = 120.0
ABSENCE_VIOLATION_S = 20.0   # away at least this long (a refresh is quicker) counts as a full violation
END_REQUEST_WATCHDOG_S = 8.0
END_ORDER_GRACE_S = 20.0     # an ending the talker never got to say is carried out anyway after this long
SCREEN_HOLD_MAX_S = 25.0     # screen changes wait for the voice to finish, but never longer than this
REPLY_RETRY_S = 3.0
MUST_REPHRASE = ("(What you were about to say is not allowed at this point (it would announce something that is not ready or give "
                 "something away). Say something different instead: react to what they just said and ask a real question.)")
MUST_NOT_REPEAT = ("(What you were about to say you have already said in this interview. Do not say it again in the same words: if it "
                   "still needs saying, put it differently; otherwise react to what they just said and move the conversation on with a real question.)")
MUST_NOT_REPEAT_QUIET = ("(What you were about to say you have already said in this interview. Say it again in different, shorter words and add "
                         "nothing else: no question and no instruction.)")
MUST_ANSWER = ("(You said nothing, and the candidate is waiting for you: reply now with at least one spoken sentence, "
               "acknowledging what they just said. Do not use <silent>.)")
MAX_TRACKED_ACTIONS = 60
# What the talker logs when it has decided to leave the current part. It sometimes says so and forgets the next_item call.
MOVE_ON_ACTIONS = frozenset({"acknowledge_move_on", "wrap_up_slot", "move_on"})


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


class InterviewRun:
    def __init__(self, deps: RunDeps) -> None:
        self.d = deps
        self.session_id: str = deps.context["session_id"]
        self.candidate_id: str = deps.context["candidate_id"]
        self.skills: list[str] = (deps.context.get("profile") or {}).get("skills") or []
        self.round_seconds = round_seconds(deps.blueprint, deps.context)
        self.conductor = Conductor(deps.blueprint, self.round_seconds, deps.rules, deps.clock, self.skills)
        self.wire = wire_ids(deps.blueprint)   # slot_id -> the id the browser sees
        self.guard = LeakGuard(deps.blueprint)
        self.tools = ToolExecutor(self)
        self.talker = TalkerTurn(deps.talker_chat, self.guard, self.tools, deps.first_token_timeout_s,
                                 fallback=deps.fallback_chat, pacing=deps.pacing, on_slow=self._on_slow)
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
        self.ask: dict[str, Any] | None = None
        self.ask_for_turn: dict[str, Any] | None = None
        self.candidate_said: dict[str, str] = {}
        self.actions: dict[str, str] = {}          # workspace message id -> type, until its ack is reported to the talker
        self.code_seen: list[str] | None = None    # the code the talker was shown this turn (anchors refer to it)
        self.failures = 0
        self.first_failure_at: float | None = None   # when the current run of failed replies began
        self.failed_at: float | None = None          # when the last reply failed (cleared by the next one that works)
        self.tool_refused: list[dict[str, Any]] = []   # tool calls the plan refused last turn, told to the talker once
        self.unanswered: str | None = None           # what the candidate said that has not been answered yet
        self._asked = ""                             # what the current reply answers
        self._greeted = False                        # the greeting has been said (no filler line ever precedes it)
        self.slow = False                            # the interviewer is taking longer than usual (shown on the page)
        self._room_sent: tuple[str, bool] | None = None
        self.finishing = False
        self.finished = asyncio.Event()
        self.turn_ended_at: float | None = None
        self.awaiting_audio: int | None = None
        self.board_seen_by_director = ""
        self.ended_run: dict[str, Any] | None = None   # the saved run, when this interview already finished
        self.reply_requested_at = float("-inf")
        self.left_at: float | None = None
        self._left_task: asyncio.Task | None = None
        self._tasks: set[asyncio.Task] = set()
        self.begun = asyncio.Event()                  # the round has started (the candidate arrived); the greeting waits for it
        self._early: list[Any] = []                   # what the browser sent before then, handled in order once it has
        self.candidate_in_room = asyncio.Event()      # a candidate (not an interviewer) is in the room; the greeting waits for it too
        self._screen_held = False                     # a problem going up or a layout change waits until the voice has said its part
        self._screen_held_at = 0.0
        self._held_turn_over = False                  # the reply that is being held for has been fully generated
        self._spoke_while_held = False                # the voice has started on it

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
            self.summary = saved.get("summary") or ""
            # The crash can beat the last checkpoint: number new turns after every turn already stored.
            self.seq = max(int(saved.get("seq") or 0), await self.d.store.max_seq(self.session_id))
            self.d.workspace.restore_mirror(saved.get("mirror") or {})
            await self._sync_room_state()
            return
        await self.d.store.start_run({
            "session_id": self.session_id, "candidate_id": self.candidate_id,
            "blueprint_id": self.d.blueprint.get("blueprint_id"), "blueprint_version": self.d.blueprint.get("version"),
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
        return (not self.finishing and self.left_at is None
                and not self.conductor.agent_speaking and not self.conductor.candidate_speaking)

    def _speak_soon(self) -> None:
        if self.speaker is None or not self._can_speak():
            return
        self.reply_requested_at = self.d.clock()
        try:
            self.speaker.reply()
        except Exception as exc:  # noqa: BLE001 - a failed nudge must never break the ticker or an End request
            logger.warning("could not ask for a reply: %s", exc)

    def _end_reason(self, default: str) -> str:
        """An ending already decided (misconduct, a violation) is never replaced by a later, milder one."""
        return self.conductor.end_reason or default

    # ------------------------------------------------------------ LiveKit-facing hooks

    def on_user_text(self, text: str) -> None:
        text = (text or "").strip()
        if not text or self.finishing or not self.begun.is_set():
            return
        now = self.d.clock()
        self.seq += 1
        item_id = self.conductor.current().item_id
        self.history.append({"role": "user", "content": text})
        self.transcript.append({"seq": self.seq, "speaker": "candidate", "text": text})
        self.candidate_said[item_id] = (self.candidate_said.get(item_id, "") + " " + text)[-4000:]
        self.ask_for_turn, self.ask = self.ask, None
        self.unanswered = text
        self.conductor.reply_owed = True
        self.conductor.on_candidate_turn()
        self._note_request(text)
        self.turn_ended_at = now
        try:
            self._utterance = self.tracker.take_turn(text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("activity turn ignored: %s", exc)
            self._utterance = None
        self._spawn(self.d.store.append_turn({"session_id": self.session_id, "candidate_id": self.candidate_id, "seq": self.seq,
                                              "speaker": "candidate", "text": text, "at": now, "item_id": item_id,
                                              "ask": self.ask_for_turn}))
        self._trigger_director()

    def _note_request(self, text: str) -> None:
        """A request on a problem the interviewer must not simply grant (a different problem, or something written in their editor) is
        handed to the conductor, which tells the talker what to do about it in this very reply."""
        if self.conductor.current().kind != "slot" or not self.tools._on_screen():
            return
        try:
            if asks_to_change_problem(text):
                self.conductor.on_change_request()
            elif asks_interviewer_to_edit(text):
                self.conductor.on_edit_request()
        except Exception as exc:  # noqa: BLE001 - a request that can't be classified is simply answered like any other turn
            logger.warning("request ignored: %s", exc)

    def skip_reply(self, text: str) -> bool:
        """True when the candidate only acknowledged ("okay", "got it") something that was not a question: a real interviewer says nothing
        and lets them carry on. Never when an order is waiting to be spoken or they are asking about something on their screen."""
        if self.finishing or self.conductor.ended or self.ask_for_turn is not None or self.conductor.pending_orders():
            return False
        last = next((h["content"] for h in reversed(self.history) if h["role"] == "assistant"), "")
        if not needs_no_reply(text, last.removesuffix(" (interrupted)")):
            return False
        self.unanswered, self.conductor.reply_owed = None, False
        return True

    def on_conversation_item(self, role: str, text: str, interrupted: bool) -> None:
        if role != "assistant" or not (text or "").strip():
            return
        self.history.append({"role": "assistant", "content": text.strip() + (" (interrupted)" if interrupted else "")})
        self.history = self.history[-MAX_HISTORY * 2:]

    def on_agent_state(self, state: str) -> None:
        speaking = state == "speaking"
        if speaking and self.awaiting_audio is not None and self.turn_ended_at is not None:
            seq, self.awaiting_audio = self.awaiting_audio, None
            self._spawn(self.d.store.update_turn(self.session_id, seq, {"first_audio_ms": int((self.d.clock() - self.turn_ended_at) * 1000)}))
        self.conductor.set_agent_speaking(speaking)
        if self._screen_held:
            if speaking:
                self._spoke_while_held = True
            elif self._held_turn_over and self._spoke_while_held:
                self._spawn(self._release_screen())

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

    def on_user_state(self, state: str) -> None:
        self.conductor.set_candidate_speaking(state == "speaking")

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
        return {
            "round_elapsed_min": int((now - (self.conductor.started_at or now)) / 60), "round_min": self.round_seconds // 60,
            "item": {"item_id": item.item_id, "kind": item.kind, "phase": item.phase, "slot_id": item.slot_id,
                     "problem_number": self.conductor.problem_number(),
                     "elapsed_min": int((now - (item.started_at or now)) / 60), "max_min": max(1, item.max_seconds // 60),
                     "hint_step": item.hint_step, "filler": item.filler},
            "orders": [{"kind": o.kind, "text": o.text} for o in orders],
            "brief": self.brief, "follow_ups": self.conductor.follow_ups.get(item.item_id, []),
            "ask": {"surface": self.ask_for_turn["surface"], "quote": self.ask_for_turn["quote"]} if self.ask_for_turn else None,
            "code": {"language": code["language"], "version": code["version"], "lines": self.d.workspace.code_lines()} if code else None,
            "board": self.d.workspace.board_summary, "summary": self.summary,
            "on_screen": self._on_screen(item), "refused": refused, "activity": activity,
            "advance": dict(zip(("ok", "why"), self.conductor.can_advance())),
            "problem_left": any(i.kind == "slot" and i.status in ("pending", "active") for i in self.conductor.items),
            "extra_problem": self.conductor.would_extend(),
            "next_part": self._next_part(),
            "skip_next_problem": self.conductor.will_skip_next_problem(),
        }

    def _follow_the_conversation(self, text: str, result, failed: bool, item_id: str) -> None:
        """The talker sometimes starts the next part without calling next_item. When what it asked is unmistakably the next part, move
        the plan to it so the screen, the time and the orders follow the conversation."""
        c = self.conductor
        item = c.current()
        if not text or result.interrupted or failed or c.ended or item.item_id != item_id or any(t["name"] == "next_item" for t in result.tool_calls):
            return
        ahead = next((i for i in c.items[c.index + 1:] if i.status == "pending"), None)
        if ahead is None or ahead.kind != "phase" or not c.can_advance()[0]:
            return
        probes = [p.get("prompt", "") for p in (self.d.blueprint.get("personalization") or {}).get("resume_probes", [])]
        slot_shown = item.kind == "slot" and self.tools._on_screen()
        if item.kind == "slot" and c.would_extend():
            c.plan_extra_problem()                  # time for another problem: the conversation about the projects waits for it
            return
        if slot_shown and ahead.phase == "deep_dive" and matches_probe(text, probes):
            c.next_item("moved to the projects")
        elif item.phase == "deep_dive" and ahead.phase == "candidate_questions" and asks_for_questions(text):
            c.next_item("invited their questions")

    def _problem_hint(self, number: int) -> str:
        """How to move on to a coding problem, said in the turn that moves (the problem's own prompt only arrives after the move)."""
        return (f'start with a short connecting phrase (for example "{BRIDGES["problem"]}"), call next_item and then show_problem, and about the '
                f'problem say only this line, last: "{problem_intro(number)}"')

    def _next_part(self) -> dict[str, Any] | None:
        if self.conductor.would_extend():
            return {"phase": "problem", "hint": self._problem_hint(self.conductor.problem_number() + 1)}   # time for another problem after this one
        pending = [i for i in self.conductor.items[self.conductor.index + 1:] if i.status == "pending"]
        if self.conductor.will_skip_next_problem():
            pending = [i for i in pending if i.kind != "slot"]    # the next problem will not be given
        nxt = pending[0] if pending else None
        if nxt is None:
            return None
        if nxt.kind == "slot":
            return {"phase": "problem", "hint": self._problem_hint(self.conductor.problem_number(self.conductor.items.index(nxt)))}
        return {"phase": nxt.phase, "hint": opening_hint(self.d.blueprint, nxt.phase)}

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

    async def reply(self, candidate_text: str | None) -> AsyncIterator[str]:
        if self.finishing:
            return
        self.seq += 1
        turn = self.seq
        self._hold_screen()
        orders = self.conductor.pending_orders()
        item = self.conductor.current()
        refused = self._take_refused()
        if candidate_text is None and self.failed_at is not None:
            candidate_text = self.unanswered           # asking again for a reply that failed: it answers the same turn
        self._asked = candidate_text or ""                 # what this reply answers (the backstops read it after the turn)
        utterance = self._utterance
        digest = self._digest(candidate_text is not None)
        activity = digest.doc() if digest is not None else None
        self.last_activity = activity
        if activity is not None:
            self.digests = [*self.digests, activity][-30:]
        view = self._view(orders, refused, digest.text if digest is not None else None)
        self.code_seen = list(view["code"]["lines"]) if view["code"] else None
        state = state_block(view) + "\n\n## Current item\n" + item_details(self.d.blueprint, view["item"])
        messages = talker_messages(self.prefix, state, self.history[-MAX_HISTORY:], proactive=candidate_text is None)
        started = self.d.clock()
        self.awaiting_audio = turn
        failed = False
        problem_in_play = self.conductor.problem_allowed()
        quiet_coding = item.kind == "slot" and self.tools._on_screen() and starts_coding(candidate_text or "")
        offered = tools_for(problem_in_play, bool(self.d.workspace.board_summary))
        # Their questions come at the end: until the plan reaches that part, inviting them is held back (the conductor owns the order).
        left = [i for i in self.conductor.items if i.status in ("pending", "active")]
        qa_early = item.phase not in ("candidate_questions", "wrap_up") and (
            any(i.kind == "slot" for i in left) or any(i.phase == "deep_dive" and i.status == "pending" for i in left)
            or (item.phase == "deep_dive" and not self.conductor.can_advance()[0]))
        try:
            spoken = 0
            async for sentence in self.talker.run(messages, turn_id=str(turn), current_slot=item.slot_id,
                                                  candidate_said=self.candidate_said.get(item.item_id, ""), tools=offered,
                                                  block_screen_claims=not problem_in_play, neutral_on_blocked=False,
                                                  block_qa_invites=qa_early, fillers_allowed=self._greeted, quiet_coding=quiet_coding):
                spoken += 1
                yield sentence
            first = self.talker.last
            if first.blocked and not first.interrupted and not self.finishing \
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
                declining = any(o.kind in ("decline_request", "keep_problem") for o in orders)
                nudge = (MUST_NOT_REPEAT_QUIET if declining else MUST_NOT_REPEAT) if len(repeats) == len(first.blocked) else MUST_REPHRASE
                async for sentence in self.talker.run([*messages, {"role": "user", "content": nudge + already}], turn_id=str(turn),
                                                      current_slot=item.slot_id, candidate_said=self.candidate_said.get(item.item_id, ""),
                                                      tools=offered, block_screen_claims=not problem_in_play, neutral_on_blocked=False,
                                                      block_qa_invites=qa_early, fillers_allowed=self._greeted, quiet_coding=quiet_coding):
                    spoken += 1
                    yield sentence
                before, first = first, self.talker.last
                first.spoken = before.spoken + first.spoken            # the turn is what was said in both passes
                first.tool_calls = before.tool_calls + first.tool_calls
                first.blocked = before.blocked + first.blocked
                first.decision = first.decision or before.decision
                if spoken == 0:
                    spoken = 1
                    shown = any(c["name"] == "show_problem" and c["result"].get("ok") for c in first.tool_calls)
                    # Nothing the talker said could be spoken. Right after a problem goes up the only sensible line is the one that
                    # says it is there ("what do you think?" about nothing confused the candidate); otherwise a plain follow-up.
                    line = problem_intro(self.conductor.problem_number()) if shown else self.talker.said.neutral()
                    first.spoken.append(line)
                    yield line
            typing = bool(activity and "typed line" in (activity.get("text") or ""))
            if spoken == 0 and candidate_text is not None and (item.kind != "slot" or not typing) and not first.interrupted \
                    and not first.blocked and not self.finishing and not is_acknowledgement(candidate_text):
                # <silent> is for a candidate thinking aloud over their code. After a conversational answer nothing said is dead
                # air: ask once more, telling the model it must answer.
                async for sentence in self.talker.run([*messages, {"role": "user", "content": MUST_ANSWER}], turn_id=str(turn),
                                                      current_slot=item.slot_id, candidate_said=self.candidate_said.get(item.item_id, ""),
                                                      tools=offered, block_screen_claims=not problem_in_play, fillers_allowed=self._greeted, quiet_coding=quiet_coding):
                    yield sentence
                again = self.talker.last
                again.tool_calls = first.tool_calls + again.tool_calls
                again.decision = again.decision or first.decision
            last = self.talker.last
            if (not last.interrupted and not self.finishing
                    and any(c["name"] == "show_problem" and c["result"].get("ok") and not c["result"].get("already") for c in last.tool_calls)
                    and not any(says_the_problem_line(s) for s in last.spoken)):
                # The problem just went up and the talker did not say the line that puts it up: say it, last, so the screen and the voice agree.
                line = problem_intro(self.conductor.problem_number())
                last.spoken.append(line)
                yield line
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
            self._after_turn(turn, orders, item.item_id, started, failed, refused, activity, item.phase == "wrap_up")

    def _after_turn(self, turn: int, orders: list[Order], item_id: str, started: float, failed: bool,
                    refused: list[dict[str, Any]], activity: dict[str, Any] | None = None, started_in_wrap_up: bool = False) -> None:
        result = self.talker.last
        self._held_turn_over = True
        if self._screen_held and (not result.spoken or result.interrupted or failed
                                  or (self._spoke_while_held and not self.conductor.agent_speaking)):
            self._spawn(self._release_screen())        # nothing left for the voice to say (or it already has): show it now
        if not result.interrupted and not failed:
            self.conductor.consume(orders)
            kinds = {o.kind for o in orders}
            if kinds & {"move_on", "wrap_up_now"} and self.conductor.current().item_id == item_id and not self.conductor.ended:
                self.conductor.next_item("move_on")
        text = " ".join(result.spoken)
        if text and not result.interrupted and not failed:
            self._greeted = True
        if text and not result.interrupted and not failed and gives_outline(text):
            self.conductor.outline_said = True
        if not result.interrupted:
            self.tool_refused = [{"tool": c["name"], "reason": c["result"].get("error")} for c in result.tool_calls
                                 if c["result"].get("ok") is False]
        # The plan follows the conversation first: moving to the next part creates the order to open it, which this very turn
        # may already have satisfied (it asked the part's opening question), so it must exist before that is checked.
        self._follow_the_conversation(text, result, failed, item_id)
        opened_now = bool(result.spoken) and (addresses_the_candidate(" ".join(result.spoken))
                                              or any(c["name"] == "show_problem" and c["result"].get("ok") for c in result.tool_calls))
        if opened_now and not result.interrupted and not failed:
            # An order to open the part this very turn moved to is satisfied when the turn asked a question or showed the problem.
            self.conductor.consume([o for o in self.conductor.pending_orders()
                                    if o.kind == "open_item" and all(o is not x for x in orders)])
        if (text and not result.interrupted and not failed and not self.conductor.ended
                and self.conductor.problem_allowed() and not self.tools._on_screen() and any(announces_problem(s) for s in result.spoken)):
            # They were told the problem is on their screen (from the problem itself or from the conversation before it, once a
            # problem is allowed) and it is not: show it, the words were already spoken. show_problem runs the plan on if needed.
            self._spawn(self.tools.execute(ToolCall(id="backstop", name="show_problem", arguments={}), str(turn)))
        cur = self.conductor.current()
        if (text and not result.interrupted and not failed and not self.conductor.ended and cur.kind == "phase"
                and cur.phase in ("small_talk", "framing", "candidate_intro", "deep_dive") and not addresses_the_candidate(text)
                and not any(o.kind == "open_item" for o in self.conductor.pending_orders())):
            # A turn in the conversation that asked them nothing leaves the candidate waiting: the next turn must ask.
            self.conductor.ask_follow_up(held_back_problem=any(b.get("rule") == "screen_claim" for b in result.blocked))
        declared = (result.decision or {}).get("action")
        # A different problem was promised, or asked for and told "it's on your screen", with no next_item behind it: do the move.
        promised = ((moves_to_another_problem(text) or (asks_for_next_problem(self._asked) and (announces_problem(text) or SCREEN_CLAIM.search(text))))
                    and self.conductor.current().kind == "slot"
                    and not any(c["name"] == "show_problem" and c["result"].get("ok") for c in result.tool_calls))
        if (text and ((leaves_the_part(text) and declared in MOVE_ON_ACTIONS) or promised) and not result.interrupted and not failed and not self.conductor.ended
                and not any(c["name"] == "next_item" for c in result.tool_calls) and self.conductor.can_advance()[0]
                and self.conductor.current().item_id == item_id and self.conductor.current().phase not in ("candidate_questions", "wrap_up")
                and (self.conductor.current().kind != "slot" or self.tools._on_screen())):
            if self.conductor.current().kind == "slot":
                self.conductor.plan_extra_problem()
            self.conductor.next_item("declared move on")
        phase = self.conductor.current().phase
        problems_done = not any(i.kind == "slot" and i.status in ("pending", "active") for i in self.conductor.items)
        said_goodbye = (phase in ("candidate_questions", "wrap_up") or problems_done) and is_farewell(text)
        if not result.interrupted and not failed and text and not self.conductor.ended and (said_goodbye or started_in_wrap_up):
            self.conductor.close_out()                  # the closing has been said: the round is over, nothing more is asked
        self.transcript.append({"seq": turn, "speaker": "interviewer", "text": text})
        self._spawn(self.d.store.append_turn({
            "session_id": self.session_id, "candidate_id": self.candidate_id, "seq": turn, "speaker": "interviewer",
            "text": text, "at": started, "item_id": item_id, "orders": [asdict(o) for o in orders], "decision": result.decision,
            "tool_calls": result.tool_calls, "blocked": result.blocked, "first_token_ms": result.first_token_ms,
            "end_to_first_token_ms": (int((started - self.turn_ended_at) * 1000 + (result.first_token_ms or 0))
                                      if self.turn_ended_at is not None else None),
            "usage": result.usage, "provider": result.provider, "interrupted": result.interrupted, "error": result.error,
            "model": result.model, "hedged": result.hedged, "fillers": result.fillers, "attempts": result.attempts,
            "brief_position": (self.brief or {}).get("for_position"), "refused": refused, "activity": activity,
        }))
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
            "seq": self.seq, "mirror": self.d.workspace.mirror_state(), "updated_at": _iso()})

    # ------------------------------------------------------------ events and time

    async def on_web_message(self, m) -> None:
        if not self.begun.is_set():
            self._early.append(m)                      # the round has not started: held, then handled in order
            return
        if m.type == "activity.batch":
            self._ingest_activity(m)
            return
        if m.type == "proctor.event":
            self.conductor.on_proctor(m.kind, m.weight, m.at)
            self._speak_soon()
        elif m.type == "code.snapshot":
            self.conductor.on_code_change()
        elif m.type == "board.summary":
            self.conductor.on_board_change()
        elif m.type == "ask.selection":
            self.ask = {"surface": m.surface, "quote": m.quote, "item_id": m.item_id}
        elif m.type == "session.end_request":
            self.conductor.on_end_request()
            self._speak_soon()
            self._spawn(self._end_request_watchdog())
        self._trigger_director()

    async def _end_request_watchdog(self) -> None:
        await asyncio.sleep(END_REQUEST_WATCHDOG_S)
        if not self.finishing:
            await self.finish(self._end_reason("candidate_ended"))

    async def tick(self) -> None:
        if self.finishing:
            return
        new = self.conductor.tick()
        self._trigger_director()
        await self._sync_room_state()
        now = self.d.clock()
        if self._screen_held and now - self._screen_held_at >= SCREEN_HOLD_MAX_S:
            await self._release_screen()              # the voice never reported finishing: show it anyway
        if self.failed_at is not None and self.conductor.reply_owed and now - self.failed_at >= RETRY_AFTER_FAILURE_S \
                and now - self.reply_requested_at >= RETRY_AFTER_FAILURE_S:
            self._speak_soon()                         # the last reply failed: ask for it again, never a "you're quiet" check-in
        pending = self.conductor.pending_orders()
        if pending and not new and self.conductor.end_order is None and now - self.reply_requested_at >= REPLY_RETRY_S \
                and (self.conductor.urgent_pending() or self.conductor.quiet_for_s() >= ORDER_SPACING_S):
            self._speak_soon()                          # an order that waited for the interviewer to have been quiet a moment
        end = self.conductor.end_order
        if end is not None and end.speak and not end.consumed:
            # An ending decided while the agent or candidate was talking: say it as soon as the floor is free,
            # and carry it out even if it never gets said.
            now = self.d.clock()
            if now - end.at >= END_ORDER_GRACE_S:
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

    def on_candidate_left(self) -> None:
        if self.left_at is None:
            self.left_at = self.d.clock()
        if self._left_task is None or self._left_task.done():
            self._left_task = asyncio.create_task(self._wait_for_return())

    def on_candidate_back(self) -> None:
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
        snapshot = {
            "position": c.position,
            "items": [{"item_id": i.item_id, "kind": i.kind, "phase": i.phase, "status": i.status, "hint_step": i.hint_step,
                       "elapsed_min": int(((i.ended_at or now) - i.started_at) / 60) if i.started_at else 0, "filler": i.filler}
                      for i in c.items],
            "current": {"item_id": c.current().item_id, "slot_id": c.current().slot_id,
                        "follow_ups": c.follow_ups.get(c.current().item_id, [])},
            "transcript": self.transcript[-120:], "summary": self.summary, "code": getattr(self.d.workspace, "code", None),
            "board": board, "proctor": c.proctor, "conduct": c.conduct, "plan_changes": c.plan_changes, "last_brief": self.brief,
            "activity": [{"started_at": d["started_at"], "duration_s": d["duration_s"], "text": d["text"]} for d in self.digests[-12:]],
        }
        return director_messages(self.d.blueprint, self.d.context, snapshot, image)

    async def _on_brief(self, brief: Brief, meta: dict[str, Any]) -> None:
        outcome = self.conductor.apply_brief(brief.model_dump())
        if brief.summary:
            self.summary = brief.summary
        if outcome["stale"]:
            self.brief = {**(self.brief or {}), "tone": brief.tone}
        else:
            self.brief = {"for_position": brief.for_position, "goal": brief.goal, "next_move": brief.next_move.model_dump(),
                          "tone": brief.tone}
        # The director may open a conduct incident the talker missed, never add a second one: a repeat is the
        # talker's to flag, so one remark can't be counted twice (once by the talker, once by the director).
        if brief.conduct.concern != "none" and not self.conductor.conduct:
            if self.conductor.on_conduct(f"director:{brief.conduct.concern}", brief.conduct.reason,
                                         f"brief-{self.director.runs}", "director") is not None:
                self._speak_soon()
        await self.d.store.append_brief({"session_id": self.session_id, "candidate_id": self.candidate_id,
                                         "at": self.d.clock(), "brief": brief.model_dump(), "outcome": outcome, **meta})
        if brief.evidence:
            await self.d.store.upsert_evidence(self.session_id, self.candidate_id, [e.model_dump() for e in brief.evidence])

    async def _on_director_failure(self, error: str) -> None:
        await self.d.store.append_brief({"session_id": self.session_id, "candidate_id": self.candidate_id,
                                         "at": self.d.clock(), "error": error})

    # ------------------------------------------------------------ ending

    def _ending_message(self, reason: str) -> str:
        if reason == "completed":
            return (self.d.blueprint.get("persona") or {}).get("closing") or "Thanks for your time today."
        if reason == "ended_by_interviewer":
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
        try:
            if self.speaker is not None:
                await self.speaker.wait_for_playout()
            await self.d.workspace.send({"type": "session.ending", "reason": reason, "message": self._ending_message(reason)[:1000]})
            summary = self.conductor.live_summary()
            try:
                await self.d.api.end(self.session_id, reason, summary)
            except Exception as exc:  # noqa: BLE001 - the API's sweep is the backstop
                logger.warning("ending session %s in the API failed: %s", self.session_id, exc)
            await self.d.store.finalize_run(self.session_id, {
                "ended_at": _iso(), "end_reason": reason, "live_summary": summary, "summary": self.summary,
                "checkpoint": self.conductor.checkpoint(), "seq": self.seq})
            await self.director.aclose()
            if self.speaker is not None:
                await self.speaker.delete_room()
        finally:
            self.finished.set()
