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
from app.interviewer.conductor import Conductor, Order, Rules
from app.interviewer.digest import digest_for_utterance, digest_idle
from app.interviewer.director import Director
from app.interviewer.guard import LeakGuard
from app.interviewer.plan import round_seconds, wire_ids
from app.interviewer.prompts import director_messages, item_details, state_block, talker_messages, talker_prefix
from app.interviewer.talker import TalkerFailed, TalkerTurn
from app.interviewer.tools import ToolExecutor

logger = logging.getLogger(__name__)
MAX_HISTORY = 20
FAILURES_TO_END = 3
CANDIDATE_GONE_S = 120.0
ABSENCE_VIOLATION_S = 20.0   # away at least this long (a refresh is quicker) counts as a full violation
END_REQUEST_WATCHDOG_S = 8.0
END_ORDER_GRACE_S = 20.0     # an ending the talker never got to say is carried out anyway after this long
REPLY_RETRY_S = 3.0
MAX_TRACKED_ACTIONS = 60


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
    first_token_timeout_s: float = 4.0
    rules: Rules | None = None


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
        self.talker = TalkerTurn(deps.talker_chat, self.guard, self.tools, deps.first_token_timeout_s)
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

    # ------------------------------------------------------------ lifecycle

    async def start(self, saved: dict[str, Any] | None) -> None:
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
            self.summary = saved.get("summary") or ""
            # The crash can beat the last checkpoint: number new turns after every turn already stored.
            self.seq = max(int(saved.get("seq") or 0), await self.d.store.max_seq(self.session_id))
            self.d.workspace.restore_mirror(saved.get("mirror") or {})
            return
        await self.d.store.start_run({
            "session_id": self.session_id, "candidate_id": self.candidate_id,
            "blueprint_id": self.d.blueprint.get("blueprint_id"), "blueprint_version": self.d.blueprint.get("version"),
            "talker_prefix": self.prefix, "started_at": _iso(),
            "models": {"talker": getattr(self.d.talker_chat, "model", None), "director": getattr(self.d.director_chat, "model", None)},
        })
        self.conductor.start()

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
        if not text or self.finishing:
            return
        now = self.d.clock()
        self.seq += 1
        item_id = self.conductor.current().item_id
        self.history.append({"role": "user", "content": text})
        self.transcript.append({"seq": self.seq, "speaker": "candidate", "text": text})
        self.candidate_said[item_id] = (self.candidate_said.get(item_id, "") + " " + text)[-4000:]
        self.ask_for_turn, self.ask = self.ask, None
        self.conductor.on_candidate_turn()
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
                     "elapsed_min": int((now - (item.started_at or now)) / 60), "max_min": max(1, item.max_seconds // 60),
                     "hint_step": item.hint_step, "filler": item.filler},
            "orders": [{"kind": o.kind, "text": o.text} for o in orders],
            "brief": self.brief, "follow_ups": self.conductor.follow_ups.get(item.item_id, []),
            "ask": {"surface": self.ask_for_turn["surface"], "quote": self.ask_for_turn["quote"]} if self.ask_for_turn else None,
            "code": {"language": code["language"], "version": code["version"], "lines": self.d.workspace.code_lines()} if code else None,
            "board": self.d.workspace.board_summary, "summary": self.summary,
            "on_screen": self._on_screen(item), "refused": refused, "activity": activity,
        }

    def _take_refused(self) -> list[dict[str, Any]]:
        """Workspace actions the candidate's screen refused since last turn; acked ones are forgotten."""
        refused: list[dict[str, Any]] = []
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
        orders = self.conductor.pending_orders()
        item = self.conductor.current()
        refused = self._take_refused()
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
        try:
            async for sentence in self.talker.run(messages, turn_id=str(turn), current_slot=item.slot_id,
                                                  candidate_said=self.candidate_said.get(item.item_id, "")):
                yield sentence
            self.failures = 0
        except TalkerFailed:
            failed = True
            self.failures += 1
        finally:
            self._after_turn(turn, orders, item.item_id, started, failed, refused, activity)

    def _after_turn(self, turn: int, orders: list[Order], item_id: str, started: float, failed: bool,
                    refused: list[dict[str, Any]], activity: dict[str, Any] | None = None) -> None:
        result = self.talker.last
        if not result.interrupted and not failed:
            self.conductor.consume(orders)
            kinds = {o.kind for o in orders}
            if kinds & {"move_on", "wrap_up_now"} and self.conductor.current().item_id == item_id and not self.conductor.ended:
                self.conductor.next_item("move_on")
        text = " ".join(result.spoken)
        self.transcript.append({"seq": turn, "speaker": "interviewer", "text": text})
        self._spawn(self.d.store.append_turn({
            "session_id": self.session_id, "candidate_id": self.candidate_id, "seq": turn, "speaker": "interviewer",
            "text": text, "at": started, "item_id": item_id, "orders": [asdict(o) for o in orders], "decision": result.decision,
            "tool_calls": result.tool_calls, "blocked": result.blocked, "first_token_ms": result.first_token_ms,
            "end_to_first_token_ms": (int((started - self.turn_ended_at) * 1000 + (result.first_token_ms or 0))
                                      if self.turn_ended_at is not None else None),
            "usage": result.usage, "provider": result.provider, "interrupted": result.interrupted, "error": result.error,
            "brief_position": (self.brief or {}).get("for_position"), "refused": refused, "activity": activity,
        }))
        end = self.conductor.end_order
        if self.failures >= FAILURES_TO_END:
            self._spawn(self.finish(self._end_reason("technical")))
        elif end is not None and (end.consumed or not end.speak):
            self._spawn(self.finish(end.end_reason or "completed"))
        self._trigger_director()
        self._spawn(self._checkpoint())

    async def _checkpoint(self) -> None:
        await self.d.store.save_checkpoint(self.session_id, {
            "checkpoint": self.conductor.checkpoint(), "history": self.history[-MAX_HISTORY * 2:], "summary": self.summary,
            "seq": self.seq, "mirror": self.d.workspace.mirror_state(), "updated_at": _iso()})

    # ------------------------------------------------------------ events and time

    async def on_web_message(self, m) -> None:
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
        end = self.conductor.end_order
        if end is not None and end.speak and not end.consumed:
            # An ending decided while the agent or candidate was talking: say it as soon as the floor is free,
            # and carry it out even if it never gets said.
            now = self.d.clock()
            if now - end.at >= END_ORDER_GRACE_S:
                await self.finish(self._end_reason("technical"))
            elif now - self.reply_requested_at >= REPLY_RETRY_S:
                self._speak_soon()
        elif new:
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
