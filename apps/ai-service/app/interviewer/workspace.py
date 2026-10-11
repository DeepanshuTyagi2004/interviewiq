"""The agent's side of the shared workspace (spec §6) over LiveKit text and byte streams. Sends nothing
until the browser's first `workspace.hello` (queued meanwhile), keeps a mirror of what the candidate
sees (panel cards, the latest code, the board summary and backup) and restores it after a refresh."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

from app.interviewer.protocol import (BOARD_BACKUP_TOPIC, BOARD_RESTORE_TOPIC, BOARD_SNAPSHOT_TOPIC, WORKSPACE_TOPIC,
                                      agent_message, new_id, parse_web)

logger = logging.getLogger(__name__)
# What changes what the candidate sees. Held back while the interviewer is speaking, so the screen follows the voice instead of leading it.
HOLDABLE = frozenset({"room.state", "panel.show_problem", "panel.add_section", "panel.highlight", "panel.clear_highlight"})


class WorkspaceBridge:
    def __init__(self, room, *, on_message: Callable[[Any], Awaitable[None]] | None = None,
                 snapshot_timeout_s: float = 6.0) -> None:
        """With no `on_message` the bridge holds every inbound message (in order) until `start_handling`: the worker
        joins the room and attaches first, so a browser hello is never dropped while the interview is still loading."""
        self.room = room
        self.on_message: Callable[[Any], Awaitable[None]] | None = on_message
        self._held: list[Any] = []
        self._said_hello = asyncio.Event()
        self.snapshot_timeout_s = snapshot_timeout_s
        self.ready = False
        self.dropped = 0
        self._queue: list[dict[str, Any]] = []
        self.cards: dict[str, dict[str, Any]] = {}
        self.active_item: str | None = None
        self.code: dict[str, Any] | None = None
        self.board_summary = ""
        self.board_backup: tuple[bytes, dict[str, str]] | None = None
        self.room_state: dict[str, Any] | None = None   # the latest `room.state`, sent again after every hello
        self.acks: dict[str, dict[str, Any]] = {}
        self._holding = False
        self._deferred: list[dict[str, Any]] = []     # screen changes made while holding, sent in order on release
        self._snapshots: dict[str, asyncio.Future] = {}
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------ wiring

    def attach(self) -> None:
        self.room.register_text_stream_handler(WORKSPACE_TOPIC, self._on_text)
        self.room.register_byte_stream_handler(BOARD_SNAPSHOT_TOPIC, self._on_snapshot)
        self.room.register_byte_stream_handler(BOARD_BACKUP_TOPIC, self._on_backup)

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("workspace handler failed: %s", task.exception())

    def _on_text(self, reader, participant_identity: str) -> None:
        self._spawn(self._read_text(reader))

    def _on_snapshot(self, reader, participant_identity: str) -> None:
        self._spawn(self._read_snapshot(reader))

    def _on_backup(self, reader, participant_identity: str) -> None:
        self._spawn(self._read_backup(reader))

    # ------------------------------------------------------------ inbound

    async def _read_text(self, reader) -> None:
        message = parse_web(await reader.read_all())
        if message is None:
            self.dropped += 1          # counted, never logged with its content (it may be the candidate's text)
            logger.debug("dropped a workspace message that did not parse (%d so far)", self.dropped)
            return
        if self.on_message is None:
            self._held.append(message)
        else:
            await self._handle(message)

    async def start_handling(self, on_message: Callable[[Any], Awaitable[None]]) -> None:
        """The run exists: handle what arrived meanwhile, in order, then everything after it."""
        self.on_message = on_message
        while self._held:
            await self._handle(self._held.pop(0))

    async def _handle(self, m) -> None:
        if m.type == "workspace.hello":
            self.ready = True
            queued, self._queue = self._queue, []
            for msg in queued:
                await self._send_text(msg)
            # A hello from a browser with nothing on screen, while the mirror has cards the queue didn't just send,
            # is a refresh (or a worker restart): rebuild the screen from the mirror. When the queue carried the
            # cards (a fresh room) restoring too would show every problem twice.
            if not queued and not m.has_content and self.cards:
                await self._restore()
            if self.room_state is not None and not any(q["type"] == "room.state" for q in queued):
                await self._send_text(self.room_state)    # a refreshed page needs the layout too
            self._said_hello.set()
        elif m.type == "ack":
            self.acks[m.ref] = {"ok": m.ok, "reason": m.reason}
        elif m.type == "code.snapshot":
            self.code = {"language": m.language, "text": m.text, "version": m.version}
        elif m.type == "board.summary":
            self.board_summary = m.text
        elif m.type == "panel.section_added" and m.item_id in self.cards:
            self.cards[m.item_id]["sections"].append(m.section.model_dump(exclude_none=True))
        elif m.type == "panel.highlight_added" and m.item_id in self.cards:
            self.cards[m.item_id]["highlights"].append({"highlight_id": m.highlight_id, "quote": m.quote,
                                                       "occurrence": m.occurrence, "author": "candidate"})
        if self.on_message is not None:
            await self.on_message(m)

    async def _read_snapshot(self, reader) -> None:
        data = b"".join([chunk async for chunk in reader])
        future = self._snapshots.get((reader.info.attributes or {}).get("request_id", ""))
        if future is not None and not future.done():
            future.set_result(data)

    async def _read_backup(self, reader) -> None:
        self.board_backup = (b"".join([chunk async for chunk in reader]), dict(reader.info.attributes or {}))

    # ------------------------------------------------------------ outbound

    async def send(self, body: dict[str, Any]) -> str:
        message = agent_message(body)
        self._mirror(message)                          # what the interviewer knows is on screen is true at once
        if self._holding and message["type"] in HOLDABLE:
            self._deferred.append(message)             # what the candidate sees waits for the voice
        else:
            await self._deliver(message)
        return message["id"]

    async def _deliver(self, message: dict[str, Any]) -> None:
        if self.ready:
            await self._send_text(message)
        else:
            self._queue.append(message)

    def hold(self) -> None:
        """From now on screen changes (a problem going up, the layout) are kept back until `release`."""
        self._holding = True

    async def release(self) -> None:
        """Show what was held back, in the order it was made, and stop holding."""
        self._holding = False
        deferred, self._deferred = self._deferred, []
        for message in deferred:
            await self._deliver(message)

    async def _send_text(self, message: dict[str, Any]) -> None:
        await self.room.local_participant.send_text(json.dumps(message), topic=WORKSPACE_TOPIC)

    def _mirror(self, m: dict[str, Any]) -> None:
        t = m["type"]
        if t == "room.state":
            self.room_state = m
        elif t == "panel.show_problem":
            card = self.cards.get(m["item_id"], {"sections": [], "highlights": []})
            self.cards[m["item_id"]] = {**card, **{k: m[k] for k in ("item_id", "label", "kind", "statement", "examples")}}
            self.active_item = m["item_id"]
        elif t == "panel.add_section" and m["item_id"] in self.cards:
            sections = [s for s in self.cards[m["item_id"]]["sections"] if s["id"] != m["section"]["id"]]
            self.cards[m["item_id"]]["sections"] = [*sections, m["section"]]
        elif t == "panel.highlight" and m["item_id"] in self.cards:
            self.cards[m["item_id"]]["highlights"].append({
                "highlight_id": m["highlight_id"], "quote": m["quote"], "occurrence": m.get("occurrence", 0),
                "author": "interviewer", **({"note": m["note"]} if m.get("note") else {})})
        elif t == "panel.clear_highlight":
            for card in self.cards.values():
                card["highlights"] = [h for h in card["highlights"] if h["highlight_id"] != m["highlight_id"]]

    async def _restore(self) -> None:
        code = {"language": self.code["language"], "text": self.code["text"]} if self.code else None
        await self._send_text(agent_message({"type": "workspace.restore", "cards": list(self.cards.values()),
                                             "active_item_id": self.active_item, "code": code,
                                             "board": self.board_backup is not None}))
        if self.board_backup is not None:
            data, attributes = self.board_backup
            writer = await self.room.local_participant.stream_bytes("board-restore", topic=BOARD_RESTORE_TOPIC, attributes=attributes)
            await writer.write(data)
            await writer.aclose()

    async def wait_ready(self, timeout: float) -> bool:
        """Whether the browser has said hello (and what was queued for it has been sent) within `timeout` seconds."""
        try:
            await asyncio.wait_for(self._said_hello.wait(), timeout)
            return True
        except TimeoutError:
            return False

    async def request_snapshot(self) -> bytes | None:
        request_id = new_id("snap")
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._snapshots[request_id] = future
        try:
            await self.send({"type": "board.request_snapshot", "request_id": request_id})
            return await asyncio.wait_for(future, timeout=self.snapshot_timeout_s)
        except TimeoutError:
            return None
        finally:
            self._snapshots.pop(request_id, None)

    # ------------------------------------------------------------ state for the run

    def code_lines(self) -> list[str]:
        return (self.code or {}).get("text", "").split("\n") if self.code else []

    def mirror_state(self) -> dict[str, Any]:
        return {"cards": self.cards, "active_item": self.active_item, "code": self.code, "board_summary": self.board_summary}

    def restore_mirror(self, data: dict[str, Any]) -> None:
        self.cards = data.get("cards") or {}
        self.active_item = data.get("active_item")
        self.code = data.get("code")
        self.board_summary = data.get("board_summary") or ""
