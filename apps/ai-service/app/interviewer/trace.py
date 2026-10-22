"""Replay a live interview's decisions (spec §9.3):
    .venv/bin/python -m app.interviewer.trace <session_id>
Prints every turn with its decision, orders, guard blocks, tool calls and timings, and every brief. An interviewer turn shows
what was meant; when the voice reported otherwise it also shows what the candidate heard: "(never played)" for a turn dropped
before its audio started, and a HEARD line with the part played of a turn that was cut off."""
from __future__ import annotations

import argparse
import asyncio
from typing import Any

from app.config import get_settings
from app.db import mongo
from app.interviewer.store import MongoStore


def render(run: dict[str, Any] | None, turns: list[dict[str, Any]], briefs: list[dict[str, Any]]) -> list[str]:
    if run is None:
        return ["no live run for this session"]
    lines = [f"run {run['session_id']} started {run.get('started_at')} ended {run.get('ended_at', '-')} "
             f"reason {run.get('end_reason', '-')}"]
    events = [(t.get("at", 0.0), "turn", t) for t in turns] + [(b.get("at", 0.0), "brief", b) for b in briefs]
    for _, kind, doc in sorted(events, key=lambda e: (e[0], e[1] != "turn")):
        if kind == "brief":
            brief, outcome = doc.get("brief", {}), doc.get("outcome", {})
            lines.append(f"  BRIEF (position {brief.get('for_position')}): {brief.get('goal', '')}"
                         + (" [stale]" if outcome.get("stale") else "")
                         + (f" applied={len(outcome.get('applied', []))} dropped={len(outcome.get('dropped', []))}" if outcome else "")
                         + (" (" + ", ".join([f"latency {doc['latency_ms']}ms", *(doc.get("triggers") or [])]) + ")" if doc.get("latency_ms") is not None else ""))
            continue
        if doc.get("speaker") == "candidate":
            lines.append(f"#{doc['seq']} CANDIDATE: {doc.get('text', '')}")
            if doc.get("addressed"):
                ad = doc["addressed"]
                detail = f"{ad.get('source')} {ad.get('confidence') or 0:.2f}" + (f", {ad['ms']} ms" if ad.get("ms") is not None else "")
                lines.append(f"    addressed: {ad.get('result')} ({detail})" + (", direct-only" if ad.get("direct_only") else "")
                             + (f", volume {ad['volume']}" if ad.get("volume") else "") + (f" ({ad['level_db']} dBFS)" if ad.get("level_db") is not None else ""))
            continue
        if doc.get("speaker") == "event":
            lines.append(f"#{doc['seq']} EVENT: {doc.get('text', '')}")
            continue
        decision = doc.get("decision") or {}
        # The first two are the run's own clock; the rest are LiveKit's pipeline metrics (endpointing and the final transcript are the
        # candidate's side of the pause before this reply; e2e is the end of their speech to the first audio).
        timing = ", ".join(f"{label} {doc[key]}ms" for label, key in (
            ("first token", "first_token_ms"), ("first audio", "first_audio_ms"), ("endpointing", "endpointing_ms"),
            ("stt", "stt_final_ms"), ("tts", "tts_ttfb_ms"), ("e2e", "e2e_ms")) if doc.get(key) is not None)
        if doc.get("eot_probability") is not None and doc.get("eot_threshold") is not None:
            # The turn detector's score for the candidate's turn: under the threshold it read the turn as unfinished.
            timing += (", " if timing else "") + f"eot {doc['eot_probability']:.2f}/{doc['eot_threshold']:.2f}"
        lines.append(f"#{doc['seq']} INTERVIEWER: {doc.get('text', '')}"
                     + (f"  [{decision.get('condition')} → {decision.get('action')}: {decision.get('reason')}]" if decision else "")
                     + (f"  ({timing})" if timing else "") + ("  (interrupted)" if doc.get("interrupted") else "")
                     + ("  (never played)" if doc.get("spoken") is False else ""))
        if doc.get("cut_off"):
            lines.append(f"    HEARD (cut off): {doc.get('heard', '')}")
        if doc.get("change_decision"):
            cd = doc["change_decision"]
            lines.append(f"    change {cd.get('action')} via {cd.get('source')} ({cd.get('ms')} ms; allowed {cd.get('allowed')}): {cd.get('why', '')}")
        lines += [f"    order [{o['kind']}] {o['text']}" for o in doc.get("orders", [])]
        lines += [f"    blocked ({b['rule']}): {b['sentence']}" for b in doc.get("blocked", [])]
        lines += [f"    tool {c['name']} {c.get('arguments')} → {c.get('result')}" for c in doc.get("tool_calls", [])]
        if (doc.get("activity") or {}).get("text"):
            lines += [f"    {line}" for line in doc["activity"]["text"].split("\n")]
        if doc.get("error"):
            lines.append(f"    error: {doc['error']}")
    return lines


async def timeline(session_id: str, store: MongoStore | None = None) -> list[str]:
    s = store or MongoStore()
    return render(await s.load_run(session_id), await s.turns(session_id), await s.briefs(session_id))


async def _main(session_id: str) -> None:
    await mongo.connect(get_settings())
    try:
        print("\n".join(await timeline(session_id)))
    finally:
        await mongo.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("session_id")
    asyncio.run(_main(parser.parse_args().session_id))
