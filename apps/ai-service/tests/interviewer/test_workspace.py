import asyncio
import json

from app.interviewer.workspace import WorkspaceBridge


class Reader:
    def __init__(self, text=None, chunks=(), attributes=None):
        self.text, self.chunks = text, list(chunks)
        self.info = type("Info", (), {"attributes": attributes or {}})()

    async def read_all(self):
        return self.text

    def __aiter__(self):
        async def gen():
            for c in self.chunks:
                yield c
        return gen()


class Writer:
    def __init__(self, sink):
        self.sink = sink

    async def write(self, data):
        self.sink.append(data)

    async def aclose(self):
        pass


class Participant:
    def __init__(self):
        self.texts, self.bytes = [], []

    async def send_text(self, text, topic=""):
        self.texts.append((topic, json.loads(text)))

    async def stream_bytes(self, name, topic="", attributes=None, mime_type="application/octet-stream"):
        self.bytes.append({"topic": topic, "attributes": attributes, "data": []})
        return Writer(self.bytes[-1]["data"])


class Room:
    def __init__(self):
        self.text, self.byte = {}, {}
        self.local_participant = Participant()

    def register_text_stream_handler(self, topic, handler):
        self.text[topic] = handler

    def register_byte_stream_handler(self, topic, handler):
        self.byte[topic] = handler


def web(body):
    return json.dumps({"v": 1, "id": "w1", **body})


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


def make():
    room, got = Room(), []

    async def on_message(m):
        got.append(m.type)

    bridge = WorkspaceBridge(room, on_message=on_message, snapshot_timeout_s=0.5)
    bridge.attach()
    return room, bridge, got


SHOW = {"type": "panel.show_problem", "item_id": "core-1", "label": "Problem 1", "kind": "problem",
        "statement": "Find the pair.", "examples": []}


def test_queues_until_hello_then_flushes_in_order():
    async def run():
        room, bridge, got = make()
        await bridge.send(SHOW)
        assert room.local_participant.texts == []
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        return room, got

    room, got = asyncio.run(run())
    assert [m["type"] for _, m in room.local_participant.texts] == ["panel.show_problem"]
    assert got == ["workspace.hello"]


def test_keeps_a_mirror_and_restores_it_on_a_fresh_hello():
    async def run():
        room, bridge, _ = make()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        await bridge.send(SHOW)
        await bridge.send({"type": "panel.add_section", "item_id": "core-1",
                           "section": {"id": "c", "kind": "constraints", "title": "Constraints", "body": "n <= 10", "author": "interviewer"}})
        room.text["workspace"](Reader(web({"type": "code.snapshot", "version": 2, "language": "java", "text": "class A {}"})), "cand")
        room.byte["workspace.board.backup"](Reader(chunks=[b"scene"], attributes={"encoding": "none"}), "cand")
        await settle()
        room.local_participant.texts.clear()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        return room, bridge

    room, bridge = asyncio.run(run())
    restore = room.local_participant.texts[0][1]
    assert restore["type"] == "workspace.restore" and restore["active_item_id"] == "core-1"
    assert restore["cards"][0]["sections"][0]["body"] == "n <= 10"
    assert restore["code"] == {"language": "java", "text": "class A {}"} and restore["board"] is True
    assert room.local_participant.bytes[0]["topic"] == "workspace.board.restore"
    assert bridge.code_lines() == ["class A {}"]


def test_snapshot_requests_resolve_with_the_png_or_time_out():
    async def run():
        room, bridge, _ = make()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        pending = asyncio.create_task(bridge.request_snapshot())
        await settle()
        request_id = room.local_participant.texts[-1][1]["request_id"]
        room.byte["workspace.board.snapshot"](Reader(chunks=[b"\x89P", b"NG"], attributes={"request_id": request_id}), "cand")
        png = await pending
        missing = await bridge.request_snapshot()
        return png, missing

    png, missing = asyncio.run(run())
    assert png == b"\x89PNG" and missing is None


def test_messages_that_arrive_before_the_run_exists_are_held_and_handled_in_order_once_it_does():
    async def go():
        room, got = Room(), []
        bridge = WorkspaceBridge(room, snapshot_timeout_s=0.5)       # the worker attaches before the run is built
        bridge.attach()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        room.text["workspace"](Reader(web({"type": "code.snapshot", "version": 1, "language": "python", "text": "x = 1"})), "cand")
        await settle()
        before = (bridge.ready, list(got), bridge.code)

        async def on_message(m):
            got.append(m.type)

        await bridge.send(SHOW)                                       # queued: nobody has said hello as far as the bridge knows
        await bridge.start_handling(on_message)
        return before, got, bridge, room

    before, got, bridge, room = asyncio.run(go())
    assert before == (False, [], None)                                # held, not lost, not half-handled
    assert got == ["workspace.hello", "code.snapshot"] and bridge.ready and bridge.code["text"] == "x = 1"
    assert [m["type"] for _, m in room.local_participant.texts] == ["panel.show_problem"]


def test_a_hello_after_a_worker_restart_restores_the_saved_mirror_to_a_blank_browser():
    async def go():
        room = Room()
        bridge = WorkspaceBridge(room, snapshot_timeout_s=0.5)
        bridge.attach()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        bridge.restore_mirror({"cards": {"core-1": {"item_id": "core-1", "label": "Problem 1", "kind": "problem", "statement": "s",
                                                    "examples": [], "sections": [], "highlights": []}},
                               "active_item": "core-1", "code": {"language": "python", "text": "x", "version": 2}, "board_summary": ""})

        async def on_message(m):
            pass

        await bridge.start_handling(on_message)
        await settle()
        return room

    room = asyncio.run(go())
    restore = [m for _, m in room.local_participant.texts if m["type"] == "workspace.restore"]
    assert len(restore) == 1 and restore[0]["cards"][0]["item_id"] == "core-1"


def test_wait_ready_returns_once_the_browser_has_said_hello_and_the_queue_is_flushed():
    async def go():
        room, got = Room(), []
        bridge = WorkspaceBridge(room, snapshot_timeout_s=0.5)
        bridge.attach()

        async def on_message(m):
            got.append(m.type)

        await bridge.start_handling(on_message)
        await bridge.send({"type": "session.ending", "reason": "completed", "message": "bye"})
        early = await bridge.wait_ready(0.05)                    # nobody has said hello
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        late = await bridge.wait_ready(1)
        return early, late, room

    early, late, room = asyncio.run(go())
    assert early is False and late is True
    assert [m["type"] for _, m in room.local_participant.texts] == ["session.ending"]   # flushed before wait_ready returned


def test_messages_that_cannot_be_parsed_are_counted_and_never_forwarded():
    async def go():
        room, bridge, got = make()
        room.text["workspace"](Reader("{nope"), "cand")
        room.text["workspace"](Reader(web({"type": "activity.batch", "sent_at": 1, "events": []})), "cand")   # empty: rejected
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        return bridge, got

    bridge, got = asyncio.run(go())
    assert bridge.dropped == 2 and got == ["workspace.hello"]


def test_the_latest_room_state_is_sent_again_on_every_hello_so_a_refreshed_page_gets_the_right_layout():
    async def go():
        room, bridge, _ = make()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        await bridge.send({"type": "room.state", "layout": "work", "slow": False})
        await bridge.send({"type": "room.state", "layout": "talk", "slow": True})
        room.local_participant.texts.clear()
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": True})), "cand")
        await settle()
        return room

    room = asyncio.run(go())
    states = [m for _, m in room.local_participant.texts if m["type"] == "room.state"]
    assert len(states) == 1 and states[0]["layout"] == "talk" and states[0]["slow"] is True


def test_a_state_queued_before_the_first_hello_is_not_sent_twice():
    async def go():
        room, bridge, _ = make()
        await bridge.send({"type": "room.state", "layout": "talk", "slow": False})
        room.text["workspace"](Reader(web({"type": "workspace.hello", "has_content": False})), "cand")
        await settle()
        return room

    room = asyncio.run(go())
    assert [m["type"] for _, m in room.local_participant.texts].count("room.state") == 1
