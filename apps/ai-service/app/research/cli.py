"""Run the research pipeline from a terminal, streaming every trace event (spec §12.2).

    # ad-hoc company, nothing else running: no API, no Mongo, free replay
    python -m app.research.cli run --name "Meesho" --mode replay --memory --verbose

    # record real responses once (costs Exa + LLM calls), then replay them for free
    python -m app.research.cli run --name "Meesho" --mode record --memory

    # catalogue companies by slug (needs interviewiq-api running); writes to MONGODB_DB
    python -m app.research.cli run --company meesho --company razorpay --mode live

Live/record runs use research's Groq-first client and the configured LLM provider as fallback.
Exit code: 0 all companies done/skipped, 1 any failed, 2 bad arguments / nothing to run."""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from app.config import get_settings
from app.db import mongo
from app.research.memory_store import InMemoryResearchStore
from app.research.normalize.identity import slugify
from app.research.store import LEVEL_RANK, MongoResearchStore, ensure_research_indexes
from app.research.targets import ResearchTarget, fetch_research_targets
from app.research.trace.log_handler import ResearchLogHandler
from app.research.wiring import build_research_runner


def _echo(min_rank: int):
    def echo(ev: dict) -> None:
        if ev["level_rank"] < min_rank:
            return
        print(f"{ev['seq']:>6} {ev['ts']:%H:%M:%S} {ev['level']:<5} {(ev.get('node') or '-'):<12} "
              f"{ev['type']:<18} {ev['message']}", flush=True)
    return echo


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    if args.mode:
        settings = settings.model_copy(update={"research_mode": args.mode})
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("app.research").setLevel(logging.DEBUG)
    logging.getLogger().addHandler(ResearchLogHandler())

    if args.memory:
        store = InMemoryResearchStore()
    else:
        db = await mongo.connect(settings)
        await ensure_research_indexes(db, ttl_days=settings.research_trace_ttl_days)
        store = MongoResearchStore(db)

    if args.name:
        slug = slugify(args.name)
        targets = [ResearchTarget(id=f"cli-{slug}", name=args.name, slug=slug, website=args.website)]
    else:
        wanted = set(args.company or [])
        targets = [t for t in await fetch_research_targets(settings) if t.slug in wanted]
        if not targets:
            print(f"no active catalogue company matches {sorted(wanted)}", file=sys.stderr)
            return 2

    async def fixed_targets() -> list[ResearchTarget]:
        return targets

    runner = build_research_runner(settings, store=store, targets=fixed_targets,
                                   echo=_echo(LEVEL_RANK["trace" if args.verbose else "info"]))
    try:
        run = await runner.start_run(trigger="cli", scope="selected", company_ids=[t.id for t in targets],
                                     mode=settings.research_mode)
        await runner.wait_idle()
        run = await store.get_run(run["run_id"])
        items = await store.list_items(run["run_id"])
        print(f"\nrun {run['run_id']} · {run['status']} · mode={run['mode']} · budget {run['budget']}")
        for item in items:
            err = f" · {item['error']['type']}: {item['error']['message']}" if item.get("error") else ""
            print(f"  {item['company_name']:<24} {item['status']}{err}")
        return 1 if any(i["status"] == "failed" for i in items) else 0
    finally:
        if not args.memory:
            await mongo.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.research.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="research one or more companies and stream the trace")
    who = run.add_mutually_exclusive_group(required=True)
    who.add_argument("--name", help="ad-hoc company name (no API needed)")
    who.add_argument("--company", action="append", help="catalogue slug (repeatable; needs interviewiq-api)")
    run.add_argument("--website", help="website hint for --name")
    run.add_argument("--mode", choices=["live", "record", "replay"])
    run.add_argument("--memory", action="store_true", help="keep all state in memory (no Mongo)")
    run.add_argument("--verbose", action="store_true", help="print trace/debug events too")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
