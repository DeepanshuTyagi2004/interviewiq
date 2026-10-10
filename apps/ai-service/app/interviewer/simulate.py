"""Text-only rehearsal of the live interviewer (spec §14): the same InterviewRun on a real blueprint,
with no LiveKit or audio. Candidate lines come from a script file (one per line) or the keyboard.

    .venv/bin/python -m app.interviewer.simulate --session <id> [--script scripts/interviewer_sim_script.txt]

Script lines: text = the candidate speaks; `#wait N` = N seconds pass; `#tab` / `#window` / `#fullscreen` /
`#share` = a proctor event; `#code <text>` = the candidate's code (use \\n); `#end` = the candidate presses End;
`#at <seconds> <command>` = something the candidate does, relative to the start of the NEXT spoken line (negative = before
it): `type <line> <text>`, `point code <line> <text>`, `point board <label>`, `point panel <quote>`, `point out`,
`draw <kind> <label>`, `select <a>-<b> <text>`, `focus <code|board|panel>`.
A candidate line now takes `seconds_per_line` BEFORE the reply (as in a live call, where the reply follows the
speech), so transcripts from before that change are not comparable. Calls OpenRouter (costs cents)."""
from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any, Callable

from app.interviewer.protocol import parse_web
from app.interviewer.run import InterviewRun, RunDeps
from app.interviewer.store import MemoryStore

PROCTOR = {"#tab": ("tab_hidden", 1), "#window": ("window_blur", 1), "#fullscreen": ("fullscreen_exit", 0.5),
           "#share": ("share_stopped", 0.5)}


class SimClock:
    def __init__(self) -> None:
        self.t = 1_000_000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class SimWorkspace:
    def __init__(self, out: Callable[[str], None]) -> None:
        self.out = out
        self.sent: list[dict[str, Any]] = []
        self.code: dict[str, Any] | None = None
        self.board_summary = ""
        self.mirror: dict[str, Any] = {}
        self.cards: dict[str, dict[str, Any]] = {}
        self.acks: dict[str, dict[str, Any]] = {}

    async def send(self, body: dict[str, Any]) -> str:
        self.sent.append(body)
        if body["type"] == "panel.show_problem":
            self.cards.setdefault(body["item_id"], {"sections": []})
        elif body["type"] == "panel.add_section" and body["item_id"] in self.cards:
            self.cards[body["item_id"]]["sections"].append(body["section"])
        self.out(f"  [workspace] {json.dumps(body, ensure_ascii=False)[:300]}")
        return f"sim_{len(self.sent)}"

    def code_lines(self) -> list[str]:
        return self.code["text"].split("\n") if self.code else []

    async def request_snapshot(self) -> bytes | None:
        return None

    def mirror_state(self) -> dict[str, Any]:
        return self.mirror

    def restore_mirror(self, data: dict[str, Any]) -> None:
        self.mirror = data


class SimSpeaker:
    def __init__(self) -> None:
        self.requested = 0

    def reply(self) -> None:
        self.requested += 1

    def take(self) -> bool:
        wanted, self.requested = self.requested > 0, 0
        return wanted

    async def say(self, text: str) -> None:
        pass

    async def wait_for_playout(self) -> None:
        pass

    async def delete_room(self) -> None:
        pass


class SimApi:
    def __init__(self, out: Callable[[str], None]) -> None:
        self.out = out
        self.ended: list[tuple[str, str, dict[str, Any]]] = []

    async def end(self, session_id: str, reason: str, summary: dict[str, Any]) -> dict[str, Any]:
        self.ended.append((session_id, reason, summary))
        self.out(f"  [api] session ended: {reason} {summary}")
        return {"status": "COMPLETED"}


def _web(body: dict[str, Any]):
    return parse_web(json.dumps({"v": 1, "id": "sim", **body}))


def _event(command: str, t: int) -> dict[str, Any] | None:
    """One `#at` command as the browser's wire event at browser time `t` (ms), or None if it isn't one."""
    verb, _, rest = command.partition(" ")
    if verb == "type":
        n, _, text = rest.partition(" ")
        return {"k": "edit", "t": t, "from_line": int(n), "to_line": int(n), "ins": text[:200], "removed": 0}
    if verb == "point":
        surface, _, tail = rest.partition(" ")
        if surface == "code":
            n, _, text = tail.partition(" ")
            return {"k": "ptr", "t": t, "s": "code", "line": int(n), "col": 1, "text": text[:80]}
        if surface == "board":
            return {"k": "ptr", "t": t, "s": "board", "x": 0, "y": 0, "over": tail[:60]}
        if surface == "panel":
            return {"k": "ptr", "t": t, "s": "panel", "quote": tail[:120]}
        if surface == "out":
            return {"k": "ptr", "t": t, "s": "out"}
    if verb == "draw":
        kind, _, label = rest.partition(" ")
        return {"k": "shape", "t": t, "op": "add", "id": label or kind, "kind": kind, "label": label[:60]}
    if verb == "select":
        span, _, text = rest.partition(" ")
        a, _, b = span.partition("-")
        return {"k": "caret", "t": t, "line": int(a), "col": 1, "sel": [int(a), int(b or a)], "text": text[:120]}
    if verb == "focus" and rest.strip() in ("code", "board", "panel"):
        return {"k": "focus", "t": t, "s": rest.strip()}
    return None


def _speech(run: InterviewRun, line: str, start: float, seconds: float) -> None:
    """The candidate's line as interim transcripts spread evenly over `seconds`, the last one final."""
    words = line.split()
    step = seconds / max(1, len(words))
    for i in range(len(words)):
        run.on_user_transcript(" ".join(words[: i + 1]), i == len(words) - 1, start + (i + 1) * step)


def _activity(run: InterviewRun, pending: list[tuple[float, str]], start: float, seconds: float, out: Callable[[str], None]) -> None:
    events: list[dict[str, Any]] = []
    for offset, command in pending:
        try:
            event = _event(command, int((start + offset) * 1000))
        except ValueError:
            event = None
        if event is None:
            out(f"  (ignored activity command: {command})")
        else:
            events.append(event)
    pending.clear()
    if events:
        end = start + seconds
        run.tracker.ingest(int(end * 1000), events, received_at=end)


async def _speak(run: InterviewRun, text: str | None, out: Callable[[str], None]) -> None:
    pieces = [p async for p in run.reply(text)]
    spoken = " ".join(pieces)
    if spoken:
        out(f"INTERVIEWER: {spoken}")
    run.on_conversation_item("assistant", spoken, False)
    result = run.talker.last
    if result.decision:
        out(f"  [decision] {result.decision}")
    if run.last_activity and run.last_activity.get("text"):
        out("  [activity] " + run.last_activity["text"].replace("\n", "\n    "))
    for blocked in result.blocked:
        out(f"  [guard] blocked ({blocked['rule']}): {blocked['sentence']}")
    for _ in range(3):
        await asyncio.sleep(0)


async def simulate(blueprint: dict[str, Any], context: dict[str, Any], lines: list[str], talker_chat, director_chat, *,
                   fallback_chat=None, seconds_per_line: float = 20.0, out: Callable[[str], None] = print) -> InterviewRun:
    clock = SimClock()
    workspace = SimWorkspace(out)
    run = InterviewRun(RunDeps(blueprint=blueprint, context=context, talker_chat=talker_chat, director_chat=director_chat,
                               workspace=workspace, api=SimApi(out), store=MemoryStore(), clock=clock, first_token_timeout_s=15.0,
                               fallback_chat=fallback_chat))
    speaker = SimSpeaker()
    run.speaker = speaker
    await run.start(None)
    await _speak(run, None, out)
    tabs = screen = full = 0
    pending: list[tuple[float, str]] = []
    for raw in lines:
        if run.finished.is_set():
            break
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#at "):
            _, offset, command = (line.split(maxsplit=2) + ["", ""])[:3]
            try:
                pending.append((float(offset), command))
            except ValueError:
                out(f"  (ignored activity command: {line})")
            continue
        if line.startswith("#wait"):
            clock.advance(float(line.split()[1]))
        elif line in PROCTOR:
            kind, weight = PROCTOR[line]
            tabs += kind == "tab_hidden"
            screen += weight if kind != "tab_hidden" else 0
            full += weight == 1
            out(f"(proctor: {kind})")
            await run.on_web_message(_web({"type": "proctor.event", "kind": kind, "weight": weight, "at": int(clock() * 1000),
                                           "counts": {"tab_changes": tabs, "screen_changes": screen, "full_violations": full}}))
        elif line.startswith("#code"):
            workspace.code = {"language": "python", "text": line[5:].strip().replace("\\n", "\n"), "version": 1}
            await run.on_web_message(_web({"type": "code.snapshot", "version": 1, "language": "python", "text": workspace.code["text"]}))
        elif line == "#end":
            out("(candidate pressed End)")
            await run.on_web_message(_web({"type": "session.end_request"}))
        else:
            out(f"CANDIDATE: {line}")
            start = clock()
            _speech(run, line, start, seconds_per_line)
            _activity(run, pending, start, seconds_per_line, out)
            clock.advance(seconds_per_line)
            run.on_user_text(line)
            await _speak(run, line, out)
        await run.tick()
        if speaker.take() and not run.finished.is_set():
            await _speak(run, None, out)
        for _ in range(5):
            await asyncio.sleep(0)
    await run.director.idle()
    for _ in range(10):
        if run.finished.is_set():
            break
        await asyncio.sleep(0)
    return run


async def _load(session_id: str, skills: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    from app.blueprint import store
    blueprint = await store.current_blueprint(session_id)
    if blueprint is None:
        raise SystemExit(f"no current blueprint for session {session_id}")
    run = await store.get_run(blueprint["run_id"])
    profile = ((run or {}).get("request") or {}).get("candidate_profile") or {}
    rnd = blueprint.get("round") or {}
    context = {"session_id": f"sim-{session_id}", "candidate_id": blueprint["candidate_id"], "first_name": "there",
               "round": {"company": rnd.get("company"), "company_name": rnd.get("company"), "role": "Software Engineer",
                         "level": "", "round_type": rnd.get("type"), "duration_mins": rnd.get("duration_mins")},
               "profile": {"headline": profile.get("headline"), "skills": skills or profile.get("skills") or [],
                           "projects": [p.get("name") for p in profile.get("projects") or []]}}
    return blueprint, context


async def _main(args: argparse.Namespace) -> None:
    from app.config import get_settings
    from app.db import mongo
    from app.interviewer.llm import build_chats
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set in apps/ai-service/.env")
    await mongo.connect(settings)
    try:
        blueprint, context = await _load(args.session, [s.strip() for s in (args.skills or "").split(",") if s.strip()])
    finally:
        await mongo.close()
    lines = open(args.script, encoding="utf-8").read().splitlines() if args.script else list(_keyboard())
    talker, fallback, director = build_chats(settings)
    try:
        await simulate(blueprint, context, lines, talker, director, fallback_chat=fallback)
    finally:
        await talker.aclose()
        if fallback is not None:
            await fallback.aclose()
        await director.aclose()


def _keyboard():
    while True:
        try:
            yield input("you> ")
        except EOFError:
            return


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True)
    parser.add_argument("--script")
    parser.add_argument("--skills")
    asyncio.run(_main(parser.parse_args()))
