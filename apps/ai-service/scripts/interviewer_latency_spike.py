"""Latency spike (plan 2, task 1): time to first token for the talker on OpenRouter.

Usage (from apps/ai-service):
    .venv/bin/python scripts/interviewer_latency_spike.py [--session <session-id>] [--runs 5] [--reasoning none,low]

Sends a talker-sized prompt (a real blueprint's playbooks when --session is given) with one tool, and
prints p50/p90 time to first token, total time and the providers OpenRouter picked, per reasoning
setting. Costs a few cents."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # run from anywhere: `app` is the sibling package
from app.config import get_settings  # noqa: E402
from app.interviewer.llm import OpenRouterChat  # noqa: E402

TOOL = {"type": "function", "function": {
    "name": "log_turn", "description": "Record the decision you just made.",
    "parameters": {"type": "object", "properties": {"condition": {"type": "string"}, "action": {"type": "string"},
                                                     "reason": {"type": "string"}}, "required": ["condition", "action", "reason"]}}}


async def _blueprint_context(session_id: str) -> str:
    from app.blueprint import store
    from app.db import mongo
    settings = get_settings()
    await mongo.connect(settings)
    try:
        bp = await store.current_blueprint(session_id)
    finally:
        await mongo.close()
    if not bp:
        raise SystemExit(f"no current blueprint for session {session_id}")
    keep = ("slot_id", "ask", "hint_ladder", "branches", "expectations", "answer_key")
    return json.dumps({"persona": bp["persona"], "slots": [{k: s[k] for k in keep if k in s} for s in bp["slots"][:2]]})[:24000]


async def _one(chat: OpenRouterChat, messages: list[dict]) -> tuple[float | None, float, str | None]:
    start = time.perf_counter()
    first: float | None = None
    provider: str | None = None
    async for ev in chat.stream(messages, tools=[TOOL], max_tokens=120):
        if ev.kind == "text" and first is None:
            first = time.perf_counter() - start
        if ev.kind == "done":
            provider = ev.provider
    return first, time.perf_counter() - start, provider


def _p(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * (len(ordered) - 1) + 0.5))]


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session")
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--reasoning", default="none,low")
    args = ap.parse_args()
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set in apps/ai-service/.env")
    context = await _blueprint_context(args.session) if args.session else "Interview notes. " * 1500
    messages = [
        {"role": "system", "content": "You are a warm technical interviewer. Reply in one or two short spoken sentences, "
                                      "then call log_turn.\n\n" + context},
        {"role": "user", "content": "I think I'd use two pointers here, but I'm not sure how to handle duplicates."},
    ]
    for reasoning in [r.strip() for r in args.reasoning.split(",") if r.strip()]:
        chat = OpenRouterChat(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url,
                              model=settings.interviewer_talker_model, reasoning=reasoning, timeout_s=30)
        try:
            results = [await _one(chat, messages) for _ in range(args.runs)]
        finally:
            await chat.aclose()
        ttft = [r[0] for r in results if r[0] is not None]
        totals = [r[1] for r in results]
        providers = sorted({r[2] or "?" for r in results})
        if not ttft:
            print(f"reasoning={reasoning}: no text came back in {args.runs} runs (providers {providers})")
            continue
        print(f"reasoning={reasoning}: first token p50={statistics.median(ttft):.2f}s p90={_p(ttft, 0.9):.2f}s; "
              f"total p50={statistics.median(totals):.2f}s; providers={providers}")


if __name__ == "__main__":
    asyncio.run(main())
