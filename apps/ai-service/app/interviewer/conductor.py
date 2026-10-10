"""The conductor (spec §5.3): the interview's rules in plain code, no LLM. It walks the plan, times
every item, keeps the proctor and conduct ledgers, validates the director's plan changes, and issues
orders the talker must follow on its next turn. Clock-injected and pure, so every rule is tested;
it checkpoints to a dict after every turn (spec §11)."""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from app.interviewer.plan import (BACKGROUND_PHASES, MIN_BACKGROUND_TURNS, MIN_TURNS, PROTECTED_PHASES, Item, build_items, opening_hint,
                                  reserve_slots)

OrderKind = Literal["converge", "move_on", "wrap_up_now", "nudge", "mention_violation", "final_warning",
                    "conduct_warning", "closing", "open_item", "end"]

# Orders the talker must act on at once; every other order waits for a pause so the interviewer never speaks twice in a row.
URGENT_ORDERS = frozenset({"mention_violation", "final_warning", "conduct_warning", "wrap_up_now", "closing", "open_item", "end"})
ORDER_SPACING_S = 12.0
# A problem solved early with this much of the round to spare is followed by another (a reserve problem), so a 30-minute
# round is used, not ended after twelve minutes.
EXTRA_PROBLEM_MIN_SLACK_S = 360.0
EXTRA_PROBLEM_MIN_S = 180
HARDER_PROBLEM_MIN_SLACK_S = 720.0
STANDARD_PROBLEMS = 2           # a DSA round's standard: two problems; a reserve is only added to reach it, never beyond
MIN_SECOND_PROBLEM_S = 480.0   # a second problem is only started when the round has this much left for it
STRUGGLED_HINT_STEPS = 2

# What the talker is told about each proctor event (spec §7). PRODUCT IP draft.
MENTION: dict[str, str] = {
    "tab_hidden": "The candidate switched to another tab.",
    "window_blur": "The candidate moved to another window or app.",
    "external_display": "A second display is connected.",
    "fullscreen_exit": "The candidate left full screen.",
    "share_stopped": "The candidate's screen share stopped; ask them to share their entire screen again.",
}


@dataclass
class Order:
    kind: OrderKind
    text: str
    at: float
    end_reason: str | None = None
    speak: bool = True
    consumed: bool = False


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


class Conductor:
    def __init__(self, blueprint: dict[str, Any], round_seconds: int, rules: Rules | None = None,
                 clock: Callable[[], float] = time.time, skills: tuple[str, ...] | list[str] = ()) -> None:
        self.blueprint = blueprint
        self.rules = rules or Rules()
        self.clock = clock
        self.round_seconds = round_seconds
        self.skills = {s.strip().lower() for s in skills if s and s.strip()}
        self.items: list[Item] = build_items(blueprint)
        self.reserves: dict[str, dict[str, Any]] = {s["slot_id"]: s for s in reserve_slots(blueprint)}
        self.index = 0
        self.position = 0
        self.started_at: float | None = None
        self.orders: list[Order] = []
        self.proctor: list[dict[str, Any]] = []
        self.full_violations = 0
        self.conduct: list[dict[str, Any]] = []
        self.conduct_turns: set[str] = set()
        self.redirects: dict[str, int] = {}
        self.labels: dict[str, str] = {}
        self.follow_ups: dict[str, list[str]] = {}
        self.plan_changes: list[dict[str, Any]] = []
        self.last_activity = 0.0
        self.nudged_at = 0.0
        self.candidate_speaking = False
        self.agent_speaking = False
        self.reply_owed = False   # the candidate spoke and the interviewer has not answered yet (set by the run)
        self.agent_spoke_at = float("-inf")
        self.signals: dict[str, str] = {}     # the director's latest read of each problem: strong / adequate / struggling
        self.no_more_problems = False         # a later problem was skipped (the candidate struggled, or the round is out of time)
        self.outline_said = False             # the interviewer has already told them how the round will run (not repeated at the framing)
        self.fired: dict[str, set[str]] = {}
        self.turns_since_director = 0
        self.triggers: set[str] = set()
        self.ended = False
        self.end_reason: str | None = None

    # ------------------------------------------------------------ position

    def current(self) -> Item:
        return self.items[self.index]

    def start(self) -> None:
        now = self.clock()
        self.started_at = now
        self.last_activity = now
        self._activate(0, now)

    def _activate(self, index: int, now: float) -> None:
        self.index = index
        item = self.items[index]
        if item.kind == "slot" and any(i.kind == "slot" and i.status == "done" for i in self.items[:index]):
            # A later problem gets the time that is really left, not more than its box.
            now_s = now - (self.started_at or now)
            left = self.round_seconds - now_s - sum(i.max_seconds for i in self.items[index + 1:] if i.status == "pending" and i.kind != "slot")
            item.max_seconds = int(min(item.max_seconds, max(180.0, left)))
        item.status = "active"
        item.started_at = now
        self.position += 1
        self.nudged_at = now
        self.triggers.add("item")
        if item.phase == "wrap_up":
            self._order("closing", "Say your closing now, warmly and briefly, and thank them. The interview ends when you have "
                                   "said it: no further questions.", now)
        elif self.position > 1:
            # The talker is not always exact about opening a new part in the turn that moves to it. This order makes sure it
            # is opened: at once if the last turn was a bare transition, and consumed when that turn already opened it.
            if item.kind == "slot":
                self._order("open_item", "You have moved on to the next coding problem: put it on their screen now (show_problem), say "
                                         "only that it is on their screen, and invite their questions. If you just said you would talk "
                                         "about something else, say you have a problem for them first.", now)
            elif item.phase == "framing" and self.outline_said:
                self._order("open_item", "You have moved on, and you already told them how the round will run: do not repeat it. "
                                         "Ask for a short introduction of their background (or follow up on what they just said).", now)
            elif (hint := opening_hint(self.blueprint, item.phase)) is not None:
                self._order("open_item", f"You have moved on to {item.phase}: open it now. {hint[0].upper() + hint[1:]}", now)

    def _find(self, item_id: str) -> int | None:
        return next((i for i, it in enumerate(self.items) if it.item_id == item_id), None)

    def label_for(self, item_id: str) -> str:
        if item_id not in self.labels:
            self.labels[item_id] = f"Problem {len(self.labels) + 1}"
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
        for i in range(self.index + 1, len(self.items)):
            if self.items[i].status == "pending":
                self._activate(i, now)
                return self.items[i]
        self._end("completed", "The interview is complete.", now, speak=False)
        return None

    # ------------------------------------------------------------ orders

    def _order(self, kind: OrderKind, text: str, now: float) -> Order:
        order = Order(kind, text, now)
        self.orders.append(order)
        return order

    def _end(self, reason: str, text: str, now: float, speak: bool = True) -> Order:
        if self.ended and self.end_order is not None:
            return self.end_order
        self.ended = True
        self.end_reason = reason
        order = Order("end", text, now, end_reason=reason, speak=speak)
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

    def take_triggers(self) -> set[str]:
        triggers, self.triggers = self.triggers, set()
        return triggers

    # ------------------------------------------------------------ events

    def on_candidate_turn(self) -> None:
        self.current().turns += 1
        self.last_activity = self.clock()
        self.turns_since_director += 1
        if self.turns_since_director >= self.rules.director_every_turns:
            self.turns_since_director = 0
            self.triggers.add("turns")

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

    def can_advance(self) -> tuple[bool, str]:
        """Whether the talker may leave the current item now, and if not, why (told to the talker in the live state)."""
        if self.ended:
            return False, "the interview is already over"
        item = self.current()
        elapsed = self.clock() - (item.started_at or self.clock())
        if item.max_seconds > 0 and elapsed >= item.max_seconds:
            return True, ""                                       # the plan's time is up: the plan comes first
        if item.kind == "phase" and item.phase in BACKGROUND_PHASES:
            ahead = next((i for i in self.items[self.index + 1:] if i.status == "pending"), None)
            if ahead is None or ahead.kind == "slot":              # leaving the conversation for the coding
                total = sum(i.turns for i in self.items if i.kind == "phase" and i.phase in BACKGROUND_PHASES)
                if total < MIN_BACKGROUND_TURNS:
                    return False, (f"the conversation before the coding has had {total} of {MIN_BACKGROUND_TURNS} exchanges: "
                                   "ask about their background and follow up on what they say first")
        need = MIN_TURNS.get(item.phase, 0) if item.kind == "phase" else 0
        if item.turns < need:
            more = need - item.turns
            return False, (f"you are in {item.phase} and the candidate has had {item.turns} of {need} exchanges: "
                           f"ask {more} more real question{'s' if more > 1 else ''} first (follow up on what they say)")
        return True, ""

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
        if cur.phase not in BACKGROUND_PHASES:
            return False
        total = sum(i.turns for i in self.items if i.kind == "phase" and i.phase in BACKGROUND_PHASES)
        # A part's time being up only opens the problem when no other part of the conversation is still ahead: a framing that
        # ran long moves on to the introduction, and promising the problem then would be a promise nothing can keep.
        conversation_ahead = any(i.kind == "phase" and i.phase in BACKGROUND_PHASES and i.status == "pending" for i in self.items[self.index + 1:])
        part_time_up = cur.max_seconds > 0 and self.clock() - (cur.started_at or self.clock()) >= cur.max_seconds and not conversation_ahead
        # Or the whole conversation has used its time (a plan item that lags far behind the talker never keeps the problem off the screen).
        background = [i for i in self.items if i.kind == "phase" and i.phase in BACKGROUND_PHASES]
        began = min((i.started_at for i in background if i.started_at is not None), default=None)
        budget_up = began is not None and self.clock() - began >= sum(i.max_seconds for i in background)
        return total >= MIN_BACKGROUND_TURNS or part_time_up or budget_up

    def performance(self, item: Item) -> str:
        """`struggled` or `strong` for a problem. The director's read decides when it has one; two ladder hints or running out of the
        problem's time (with the director not calling it strong) also count as struggling."""
        signal = self.signals.get(item.item_id)
        if signal == "struggling" or item.hint_step >= STRUGGLED_HINT_STEPS:
            return "struggled"
        out_of_time = item.max_seconds > 0 and self.clock() - (item.started_at or self.clock()) >= item.max_seconds
        if out_of_time and signal != "strong":
            return "struggled"
        return "strong"

    def _time_for_next_problem(self) -> float:
        """What is left of the round for a next problem, once everything else still planned after the current part has its time."""
        now = self.clock()
        left = self.round_seconds - (now - (self.started_at or now))
        return left - sum(i.max_seconds for i in self.items[self.index + 1:] if i.status == "pending" and i.kind != "slot")

    def will_skip_next_problem(self) -> bool:
        """Leaving the current problem now would skip the next one: the candidate struggled on this one, or there is no time for it."""
        cur = self.current()
        if cur.kind != "slot" or self.ended:
            return False
        if not any(i.kind == "slot" and i.status == "pending" for i in self.items[self.index + 1:]):
            return False
        return self.performance(cur) == "struggled" or self._time_for_next_problem() < MIN_SECOND_PROBLEM_S

    def slack_s(self) -> float:
        """Round time left once everything still planned after the current item has had its time."""
        now = self.clock()
        left = self.round_seconds - (now - (self.started_at or now))
        return left - sum(i.max_seconds for i in self.items[self.index + 1:] if i.status == "pending")

    def would_extend(self) -> bool:
        """Whether leaving the current problem now would add another one: it is the last planned problem, a reserve is
        left, and the round has the time."""
        cur = self.current()
        given = sum(1 for i in self.items if i.kind == "slot" and i.status in ("done", "active"))
        return (not self.ended and not self.no_more_problems and cur.kind == "slot" and bool(self.reserves) and given < STANDARD_PROBLEMS
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
        item = Item(slot["slot_id"], "slot", "core", seconds, slot_id=slot["slot_id"])
        self.items.insert(self.index + 1, item)
        self.plan_changes.append({"op": "extra_problem", "target": slot["slot_id"], "at": self.clock(), "position": self.position})
        return item

    def ask_follow_up(self, held_back_problem: bool = False) -> Order:
        held = (" The coding problem is not next yet: you were not allowed to put it up, so do not mention it or the coding part."
                if held_back_problem else "")
        return self._order("open_item", "Your last turn did not ask the candidate anything. Ask them a real follow-up question now, about "
                                        "what they just said (do not announce what comes next)." + held, self.clock())

    def close_out(self) -> None:
        """The interviewer has said goodbye: finish the plan through the wrap-up and end the round."""
        while not self.ended:
            self.next_item("closing")

    def on_code_change(self) -> None:
        self.last_activity = self.clock()
        self.triggers.add("workspace")

    def on_board_change(self) -> None:
        self.last_activity = self.clock()
        self.triggers.add("workspace")

    def on_proctor(self, kind: str, weight: float, at: float) -> Order:
        now = self.clock()
        self.proctor.append({"kind": kind, "weight": weight, "at": at, "seen_at": now})
        self.triggers.add("proctor")
        mention = MENTION.get(kind, "The candidate left the interview screen.")
        if weight >= 1:
            self.full_violations += 1
            if self.full_violations >= self.rules.proctor_end_at:
                return self._end("ended_by_interviewer",
                                 f"{mention} That is the third time. Say plainly that you are ending the interview "
                                 "because of repeated screen switching.", now)
            if self.full_violations >= self.rules.proctor_final_warning_at:
                return self._order("final_warning", f"{mention} Give a firm final warning: one more and you will end the interview.", now)
        return self._order("mention_violation", f"{mention} Mention it briefly and ask them to stay on this screen.", now)

    def on_conduct(self, kind: str, quote: str, turn_id: str, source: str) -> Order | None:
        if turn_id in self.conduct_turns:
            return None
        self.conduct_turns.add(turn_id)
        now = self.clock()
        self.conduct.append({"kind": kind, "quote": (quote or "")[:300], "turn_id": turn_id, "source": source, "at": now})
        self.triggers.add("conduct")
        if len(self.conduct) >= self.rules.conduct_end_at:
            return self._end("ended_by_interviewer",
                             f"The candidate repeated unacceptable conduct ({kind}). Say firmly, without insults, that you "
                             "are ending the interview because of it.", now)
        return self._order("conduct_warning",
                           f"The candidate's last remark was not acceptable ({kind}). Say plainly and firmly that it isn't "
                           "appropriate in an interview and must not happen again, then continue.", now)

    def on_redirect(self, turn_id: str) -> Order | None:
        item_id = self.current().item_id
        self.redirects[item_id] = self.redirects.get(item_id, 0) + 1
        if self.redirects[item_id] >= self.rules.off_topic_redirects:
            self.redirects[item_id] = 0
            return self.on_conduct("persistent_off_topic", "", turn_id, "conductor")
        return None

    def on_end_request(self) -> Order:
        return self._end("candidate_ended", "The candidate asked to end the interview. Thank them briefly and say goodbye.", self.clock())

    # ------------------------------------------------------------ time

    def tick(self) -> list[Order]:
        if self.ended or self.started_at is None:
            return []
        now = self.clock()
        item = self.current()
        new: list[Order] = []
        round_fired = self.fired.setdefault("_round", set())
        if now - self.started_at >= self.rules.ceiling_factor * self.round_seconds and item.phase != "wrap_up" \
                and "ceiling" not in round_fired:
            round_fired.add("ceiling")
            wrap = next((i for i, it in enumerate(self.items) if it.phase == "wrap_up"), None)
            if wrap is not None and wrap != self.index:
                for it in self.items[self.index:wrap]:
                    if it.status == "active":
                        it.status, it.ended_at, it.ended_by = "done", now, "ceiling"
                    elif it.status == "pending":
                        it.status = "skipped"
                self._activate(wrap, now)
                new.append(self._order("wrap_up_now", "We are well past the planned time. Move straight to the wrap-up: "
                                                      "thank the candidate and close.", now))
                return new
        elapsed = now - (item.started_at or now)
        fired = self.fired.setdefault(item.item_id, set())
        if item.max_seconds > 0:
            if elapsed >= 0.5 * item.max_seconds and "half" not in fired:
                fired.add("half")
                self.triggers.add("time")
            if item.kind in ("slot", "filler") and elapsed >= self.rules.converge_at * item.max_seconds and "converge" not in fired:
                fired.add("converge")
                self.triggers.add("time")
                new.append(self._order("converge", "Time on this question is nearly up. Ask for their final approach and its complexity.", now))
            if elapsed >= item.max_seconds and "move_on" not in fired:
                if not self.candidate_speaking or elapsed - item.max_seconds >= self.rules.grace_seconds:
                    fired.add("move_on")
                    self.triggers.add("time")
                    text = ("Time for this question is up. Say something like 'seems like we have to move on', note where they "
                            "got to, then call next_item. Decline any request for more time firmly."
                            if item.kind in ("slot", "filler") else
                            "This part's time is up. First acknowledge what the candidate just said in a few words, "
                            "then move on naturally and call next_item.")
                    new.append(self._order("move_on", text, now))
        if not self.candidate_speaking and not self.agent_speaking and not self.reply_owed and item.phase != "wrap_up":
            coding = item.kind == "slot"
            limit = self.rules.silence_coding_s if coding else self.rules.silence_talking_s
            if now - max(self.last_activity, self.nudged_at) >= limit:
                self.nudged_at = now
                new.append(self._order("nudge", (
                    "The candidate has been quiet with no code changes for a while. Ask how it's going and invite them to "
                    "talk through their thinking." if coding else
                    "The candidate has been quiet for a while. Check in gently: ask what they are thinking."), now))
        return new

    # ------------------------------------------------------------ director briefs

    def apply_brief(self, brief: dict[str, Any]) -> dict[str, Any]:
        if brief.get("for_position") == self.position and self.current().kind == "slot":
            signal = brief.get("problem_signal")
            if signal in ("strong", "adequate", "struggling"):           # "unknown" never overwrites a judgement
                self.signals[self.current().item_id] = signal
        if brief.get("for_position") != self.position:
            dropped = ["goal", "next_move"] + [f"plan_change:{c.get('op')}" for c in brief.get("plan_changes") or []]
            return {"stale": True, "applied": [], "dropped": dropped}
        applied: list[dict[str, Any]] = []
        dropped: list[dict[str, Any]] = []
        for change in brief.get("plan_changes") or []:
            ok, why = self._apply_change(change)
            if ok:
                applied.append(change)
                self.plan_changes.append({**change, "at": self.clock(), "position": self.position})
            else:
                dropped.append({**change, "why": why})
        return {"stale": False, "applied": applied, "dropped": dropped}

    def _apply_change(self, change: dict[str, Any]) -> tuple[bool, str]:
        op = change.get("op")
        target = str(change.get("target") or "")
        now = self.clock()
        if op == "skip":
            idx = self._find(target)
            if idx is None or self.items[idx].status != "pending" or self.items[idx].phase in PROTECTED_PHASES:
                return False, "only a pending item outside the candidate questions and wrap-up can be skipped"
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
            slot = self.reserves.get(target)
            replace = str(change.get("replace") or self.current().item_id)
            ridx = self._find(replace)
            if slot is None or ridx is None or self.items[ridx].kind != "slot" or self.items[ridx].status not in ("active", "pending"):
                return False, "needs an unused reserve and a current or pending problem to replace"
            replaced = self.items[ridx]
            if ridx == self.index and (replaced.turns >= 1 or now - (replaced.started_at or now) > 90):
                return False, "the candidate is already working on this problem: it cannot be swapped out now"
            del self.reserves[target]
            new_item = Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"])
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
                          filler={"question": question[:500], "skill": skill, "sound_answer": str(change.get("sound_answer") or "")[:1000]})
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
            "screen_changes_weighted": float(sum(e["weight"] for e in self.proctor if e["kind"] != "tab_hidden")),
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
            "conduct_turns": sorted(self.conduct_turns), "redirects": self.redirects, "labels": self.labels,
            "follow_ups": self.follow_ups, "plan_changes": self.plan_changes, "fired": {k: sorted(v) for k, v in self.fired.items()},
            "ended": self.ended, "end_reason": self.end_reason, "signals": self.signals, "no_more_problems": self.no_more_problems,
        }

    @classmethod
    def restore(cls, blueprint: dict[str, Any], round_seconds: int, data: dict[str, Any], rules: Rules | None = None,
                clock: Callable[[], float] = time.time, skills: tuple[str, ...] | list[str] = ()) -> "Conductor":
        c = cls(blueprint, round_seconds, rules, clock, skills)
        c.items = [Item(**i) for i in data["items"]]
        c.index, c.position, c.started_at = data["index"], data["position"], data["started_at"]
        c.reserves = {k: v for k, v in c.reserves.items() if k in set(data.get("reserves", []))}
        c.orders = [Order(**o) for o in data.get("orders", [])]
        c.proctor, c.full_violations, c.conduct = data.get("proctor", []), data.get("full_violations", 0), data.get("conduct", [])
        c.conduct_turns = set(data.get("conduct_turns", []))
        c.redirects, c.labels = data.get("redirects", {}), data.get("labels", {})
        c.follow_ups, c.plan_changes = data.get("follow_ups", {}), data.get("plan_changes", [])
        c.fired = {k: set(v) for k, v in data.get("fired", {}).items()}
        c.ended, c.end_reason = data.get("ended", False), data.get("end_reason")
        c.signals, c.no_more_problems = data.get("signals", {}), data.get("no_more_problems", False)
        now = clock()
        c.last_activity = now
        c.nudged_at = now
        return c
