"""The conductor (spec §5.3): the interview's rules in plain code, no LLM. It walks the plan, times
every item, keeps the proctor and conduct ledgers, validates the director's plan changes, and issues
orders the talker must follow on its next turn. Clock-injected and pure, so every rule is tested;
it checkpoints to a dict after every turn (spec §11)."""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from app.interviewer.plan import PROTECTED_PHASES, Item, build_items, reserve_slots

OrderKind = Literal["converge", "move_on", "wrap_up_now", "nudge", "mention_violation", "final_warning",
                    "conduct_warning", "end"]

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
        item.status = "active"
        item.started_at = now
        self.position += 1
        self.nudged_at = now
        self.triggers.add("item")

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
            self.last_activity = self.clock()

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
                            if item.kind in ("slot", "filler") else "This part's time is up. Move on naturally and call next_item.")
                    new.append(self._order("move_on", text, now))
        if not self.candidate_speaking and not self.agent_speaking:
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
            del self.reserves[target]
            new_item = Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"])
            replaced = self.items[ridx]
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
            "ended": self.ended, "end_reason": self.end_reason,
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
        now = clock()
        c.last_activity = now
        c.nudged_at = now
        return c
