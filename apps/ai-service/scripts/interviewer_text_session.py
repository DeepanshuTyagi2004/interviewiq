"""Interactive text-to-text rehearsal of the live interviewer, for a person (or an agent) playing the candidate.

    .venv/bin/python -u scripts/interviewer_text_session.py --run <blueprint_run_id> --input in.txt --log out.log --jsonl turns.jsonl

The same InterviewRun the worker uses, on a real blueprint, with the real models (OpenRouter) and no LiveKit or
Deepgram, so it costs only LLM credits. Candidate lines are read from `--input` as they are appended (one per line);
after each one the interviewer's reply is written to the log and `<<READY mm:ss>>` is printed. The clock is virtual
but behaves like a call: the candidate's speech takes words/2.6 s, the interviewer's reply takes its model latency
plus words/2.7 s to speak, and `#wait N` is N seconds of silence in 5 s steps (so silence nudges and time limits fire).

Commands (a line starting with #): `#wait N`, `#code <text with \\n>`, `#at <secs> <command>` (activity before the next
spoken line: type/point/draw/select/focus, see simulate.py), `#tab` `#window` `#fullscreen` `#share` (proctor events),
`#end` (the candidate presses End), `#quit`. Everything else is spoken by the candidate."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.interviewer import simulate as sim  # noqa: E402
from app.interviewer.run import InterviewRun, RunDeps  # noqa: E402
from app.interviewer.store import MemoryStore  # noqa: E402

CANDIDATE_WPS = 2.6
INTERVIEWER_WPS = 2.7
TTS_FIRST_AUDIO_S = 0.45


def mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"


class Session:
    def __init__(self, run: InterviewRun, clock: sim.SimClock, workspace: sim.SimWorkspace, speaker: sim.SimSpeaker,
                 log, jsonl) -> None:
        self.run, self.clock, self.workspace, self.speaker = run, clock, workspace, speaker
        self.t0 = clock()
        self.log, self.jsonl = log, jsonl
        self.pending: list[tuple[float, str]] = []
        self.tabs = self.screen = self.full = 0
        self.sent_seen = 0
        self.layout = None

    def now(self) -> float:
        return self.clock() - self.t0

    def say(self, line: str) -> None:
        self.log.write(line + "\n")
        self.log.flush()
        print(line, flush=True)

    def record(self, doc: dict[str, Any]) -> None:
        self.jsonl.write(json.dumps(doc, ensure_ascii=False) + "\n")
        self.jsonl.flush()

    def workspace_news(self) -> None:
        for body in self.workspace.sent[self.sent_seen:]:
            kind = body["type"]
            if kind == "room.state":
                if body["layout"] != self.layout:
                    self.layout = body["layout"]
                    self.say(f"[{mmss(self.now())}]   (room layout -> {body['layout']})")
                if body["slow"]:
                    self.say(f"[{mmss(self.now())}]   (page shows: interviewer is taking a moment)")
            elif kind == "panel.show_problem":
                self.say(f"[{mmss(self.now())}]   (problem on screen: {body.get('label')}; statement: {body.get('statement', '')[:400]})")
            elif kind in ("code.comment", "code.highlight", "code.insert", "panel.highlight", "panel.add_section", "board.draw"):
                self.say(f"[{mmss(self.now())}]   ({kind}: {json.dumps(body, ensure_ascii=False)[:260]})")
            elif kind == "session.ending":
                self.say(f"[{mmss(self.now())}]   (session.ending {body.get('reason')}: {body.get('message')})")
        self.sent_seen = len(self.workspace.sent)

    async def interviewer(self, candidate_text: str | None, kind: str) -> None:
        run = self.run
        orders = [f"{o.kind}" for o in run.conductor.pending_orders()]
        wall0 = time.perf_counter()
        pieces = [p async for p in run.reply(candidate_text)]
        wall = time.perf_counter() - wall0
        spoken = " ".join(pieces)
        result = run.talker.last
        run.on_conversation_item("assistant", spoken, False)
        delay = (result.first_token_ms or int(wall * 1000)) / 1000 + TTS_FIRST_AUDIO_S
        self.clock.advance(delay)
        speaking_s = len(spoken.split()) / INTERVIEWER_WPS
        run.on_agent_state("speaking")
        self.clock.advance(speaking_s)
        run.on_agent_state("listening")
        item = run.conductor.current().item_id
        tools = [c["name"] + ("" if c["result"].get("ok") else f"(REFUSED: {str(c['result'].get('error'))[:90]})") for c in result.tool_calls]
        self.say(f"[{mmss(self.now())}] INTERVIEWER{'' if kind == 'reply' else ' (' + kind + ')'}: {spoken}")
        extras = []
        if orders:
            extras.append("orders=" + ",".join(orders))
        if tools:
            extras.append("tools=" + ",".join(tools))
        if result.decision:
            extras.append(f"decision={result.decision.get('action')} <- {result.decision.get('condition')}")
        if result.fillers:
            extras.append(f"fillers={result.fillers}")
        if result.hedged:
            extras.append("HEDGED")
        if result.error:
            extras.append(f"error={result.error}")
        for b in result.blocked:
            extras.append(f"GUARD-BLOCKED({b['rule']}): {b['sentence'][:80]}")
        extras.append(f"item={item}")
        extras.append(f"model={result.model} first_token={result.first_token_ms}ms wall={wall:.1f}s")
        if run.last_activity and run.last_activity.get("text"):
            extras.append("activity=" + run.last_activity["text"].replace("\n", " | ")[:300])
        self.say("    [" + "; ".join(extras) + "]")
        self.workspace_news()
        self.record({"t": mmss(self.now()), "who": "interviewer", "kind": kind, "text": spoken, "item": item, "tools": tools,
                     "orders": orders, "decision": result.decision, "fillers": result.fillers, "hedged": result.hedged,
                     "model": result.model, "first_token_ms": result.first_token_ms, "wall_s": round(wall, 2),
                     "words": len(spoken.split()), "blocked": result.blocked, "error": result.error,
                     "layout": self.layout, "activity": (run.last_activity or {}).get("text")})

    async def settle(self) -> None:
        run = self.run
        await run.tick()
        while self.speaker.take() and not run.finished.is_set():
            await self.interviewer(None, "proactive")
            await run.tick()
        for _ in range(5):
            await asyncio.sleep(0)
        self.workspace_news()      # the room state is sent by a task spawned after the turn: report it now, not a turn later

    async def candidate(self, line: str) -> None:
        run = self.run
        words = len(line.split())
        speech_s = max(2.0, words / CANDIDATE_WPS)
        start = self.clock()
        self.say(f"[{mmss(self.now())}] CANDIDATE: {line}")
        run.on_user_state("speaking")
        sim._speech(run, line, start, speech_s)
        sim._activity(run, self.pending, start, speech_s, self.say)
        self.clock.advance(speech_s)
        run.on_user_state("listening")
        run.on_user_text(line)
        self.record({"t": mmss(self.now()), "who": "candidate", "text": line, "words": words, "speech_s": round(speech_s, 1)})
        if run.skip_reply(line):                       # what the LiveKit agent does for a bare "okay": the turn is kept, nothing is said
            self.say(f"[{mmss(self.now())}] INTERVIEWER: (says nothing: that needed no reply)")
            await self.settle()
            return
        await self.interviewer(line, "reply")
        await self.settle()

    async def silence(self, seconds: float) -> None:
        end = self.clock() + seconds
        self.say(f"[{mmss(self.now())}]   ... {int(seconds)}s of silence")
        while self.clock() < end and not self.run.finished.is_set():
            self.clock.advance(min(5.0, end - self.clock()))
            await self.settle()

    async def command(self, line: str) -> bool:
        run = self.run
        if line.startswith("#quit"):
            return False
        if line.startswith("#at "):
            _, offset, command = (line.split(maxsplit=2) + ["", ""])[:3]
            try:
                self.pending.append((float(offset), command))
            except ValueError:
                self.say(f"  (ignored: {line})")
        elif line.startswith("#wait"):
            await self.silence(float(line.split()[1]))
        elif line in sim.PROCTOR:
            kind, weight = sim.PROCTOR[line]
            self.tabs += kind == "tab_hidden"
            self.screen += weight if kind != "tab_hidden" else 0
            self.full += weight == 1
            self.say(f"[{mmss(self.now())}]   (proctor: {kind})")
            await run.on_web_message(sim._web({"type": "proctor.event", "kind": kind, "weight": weight, "at": int(self.clock() * 1000),
                                               "counts": {"tab_changes": self.tabs, "screen_changes": self.screen, "full_violations": self.full}}))
            await self.settle()
        elif line.startswith("#code"):
            text = line[5:].strip().replace("\\n", "\n")
            version = (self.workspace.code or {}).get("version", 0) + 1
            self.workspace.code = {"language": "python", "text": text, "version": version}
            self.say(f"[{mmss(self.now())}]   (candidate's code v{version}: {len(text.splitlines())} lines)")
            await run.on_web_message(sim._web({"type": "code.snapshot", "version": version, "language": "python", "text": text}))
        elif line == "#end":
            self.say(f"[{mmss(self.now())}]   (candidate pressed End)")
            await run.on_web_message(sim._web({"type": "session.end_request"}))
            await self.settle()
        else:
            self.say(f"  (unknown command: {line})")
        return True


async def main(args: argparse.Namespace) -> None:
    from app.blueprint import store
    from app.config import get_settings
    from app.db import mongo
    from app.interviewer.llm import build_chats

    settings = get_settings()
    await mongo.connect(settings)
    try:
        doc = await store.get_run(args.run, full=True)
        blueprint = (doc or {}).get("blueprint")
        if not blueprint:       # newer runs keep their blueprint only in the blueprints collection
            blueprint = await mongo.get_db()[store.BLUEPRINTS].find_one({"run_id": args.run}, {"_id": 0})
        if not doc or not blueprint:
            raise SystemExit(f"run {args.run} has no blueprint")
        profile = (doc.get("request") or {}).get("candidate_profile") or {}
    finally:
        await mongo.close()
    rnd = blueprint.get("round") or {}
    first = (args.first_name or "").strip()
    context = {"session_id": f"text-{args.run}", "candidate_id": blueprint.get("candidate_id") or "c-text", "first_name": first or None,
               "round": {"company": rnd.get("company"), "company_name": (rnd.get("company") or "").title(),
                         "role": "Software Engineer", "level": rnd.get("level"), "round_type": rnd.get("type"),
                         "duration_mins": rnd.get("duration_mins")},
               "profile": {"headline": profile.get("headline"), "skills": profile.get("skills") or [],
                           "projects": [p.get("name") for p in profile.get("projects") or []]}}
    talker, fallback, director = build_chats(settings)
    log = open(args.log, "w", encoding="utf-8")
    jsonl = open(args.jsonl, "w", encoding="utf-8")
    clock = sim.SimClock()
    workspace = sim.SimWorkspace(lambda _line: None)       # the harness narrates what matters itself
    speaker = sim.SimSpeaker()
    run = InterviewRun(RunDeps(blueprint=blueprint, context=context, talker_chat=talker, director_chat=director, workspace=workspace,
                               api=sim.SimApi(lambda line: None), store=MemoryStore(), clock=clock, first_token_timeout_s=3.0,
                               fallback_chat=fallback))
    run.speaker = speaker
    session = Session(run, clock, workspace, speaker, log, jsonl)
    session.say(f"== text session: {rnd.get('company')} {rnd.get('level')} {rnd.get('type')} round, {rnd.get('duration_mins')} min, "
                f"interviewer {blueprint['persona']['name']}, run {args.run}")
    await run.start(None)
    await session.interviewer(None, "opening")
    await session.settle()
    session.say(f"<<READY {mmss(session.now())}>>")
    path, taken = Path(args.input), 0
    try:
        while not run.finished.is_set():
            lines = path.read_text(encoding="utf-8").split("\n")[:-1] if path.exists() else []
            if taken >= len(lines):
                await asyncio.sleep(0.4)
                continue
            line = lines[taken].strip()
            taken += 1
            if not line:
                continue
            if line.startswith("#"):
                if not await session.command(line):
                    break
            else:
                await session.candidate(line)
            if run.finished.is_set():
                break
            session.say(f"<<READY {mmss(session.now())}>>")
        await run.director.idle()
        for _ in range(10):
            await asyncio.sleep(0)
        end = sim.SimApi.__dict__  # noqa: F841 - kept simple: the api fake records the ending below
        session.workspace_news()
        session.say(f"== finished at {mmss(session.now())}: ended={run.conductor.end_reason} failures={run.failures}")
        session.say("<<DONE>>")
    finally:
        await talker.aclose()
        if fallback is not None:
            await fallback.aclose()
        await director.aclose()
        log.close()
        jsonl.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True, help="a blueprint run id (bench run) whose blueprint to use")
    parser.add_argument("--input", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--jsonl", required=True)
    parser.add_argument("--first-name", default="")
    asyncio.run(main(parser.parse_args()))
