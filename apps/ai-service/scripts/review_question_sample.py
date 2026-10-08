"""Print generated problems for human review (docs/question-bank.md).

  .venv/bin/python scripts/review_question_sample.py [--round-type dsa] [--status verified] [--limit 3] [--full]

Read only. Shows the index facts, the status, and the content (abridged unless --full).
"""
from __future__ import annotations

import asyncio
import json
import sys
import textwrap

from app.config import get_settings
from app.db import mongo
from app.db import repositories as repo


def _arg(name: str, default: str | None = None) -> str | None:
    args = sys.argv[1:]
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else default


def _lines(label: str, items, limit: int | None) -> None:
    items = list(items or [])
    print(f"  {label}:")
    for x in items[: limit or len(items)]:
        print(textwrap.indent(textwrap.fill(str(x), 110), "    - "))
    if limit and len(items) > limit:
        print(f"    … {len(items) - limit} more")


async def main() -> None:
    full = "--full" in sys.argv
    limit = int(_arg("--limit", "3") or 3)
    settings = get_settings()
    await mongo.connect(settings)
    try:
        print("stats:", json.dumps(await repo.question_stats()))
        rounds = [_arg("--round-type")] if _arg("--round-type") else ["dsa", "system-design", "lld", "behavioural", "hiring-manager"]
        for rt in rounds:
            docs = await repo.query_questions(rt, None, None, limit, content_status=_arg("--status"), include_content=True)
            docs = [d for d in docs if d.get("content")]
            print(f"\n==================== {rt}: {len(docs)} shown")
            for d in docs:
                c = d["content"]
                print(f"\n# {d['title']}  [{d['slug']}]  {d.get('difficulty')}  status={d.get('content_status')}  model={d.get('content_model')}")
                print(f"  companies: {', '.join(f'{k}({v[0]})' for k, v in (d.get('company_evidence') or {}).items()) or '—'}   topics: {', '.join(d.get('topic_tags') or [])[:160]}")
                if d.get("content_error"):
                    print(f"  error: {d['content_error'][:300]}")
                if rt in ("dsa", "online-assessment"):
                    print("  statement:", textwrap.fill(c["statement"], 110, subsequent_indent="    ")[: None if full else 700])
                    _lines("constraints", c["constraints"], None if full else 4)
                    for i, e in enumerate(c["examples"][: None if full else 2], 1):
                        print(f"  example {i}: {json.dumps(e['args'])} -> {json.dumps(e['expected'])}  ({e['explanation'][:140]})")
                    print(f"  judge tests: {len(c['judge_tests'])}")
                    _lines("hints", c["hints"], None)
                    _lines("follow-ups", c["follow_ups"], None if full else 2)
                    _lines("approaches", [f"{a['name']}: {a['time_complexity']} / {a['space_complexity']} — {a['idea']}" for a in c["approaches"]], None)
                    _lines("rubric", [f"{r['criterion']} (w{r['weight']}): strong = {r['strong']} | weak = {r['weak']}" for r in c["rubric"]], None if full else 3)
                    if full:
                        print("  reference solution:\n" + textwrap.indent(c["reference_solution"]["code"], "    "))
                elif rt == "system-design":
                    print("  prompt:", textwrap.fill(c["prompt"], 110, subsequent_indent="    "))
                    _lines("clarifying", c["clarifying_questions"], None if full else 3)
                    _lines("functional", c["functional_requirements"], None if full else 3)
                    _lines("non-functional", c["non_functional_requirements"], None if full else 3)
                    _lines("components", [f"{x['name']}: {x['purpose']}" for x in c["expected_design"]["components"]], None if full else 4)
                    print("  data flow:", textwrap.fill(c["expected_design"]["data_flow"], 110, subsequent_indent="    "))
                    _lines("trade-offs", [f"{t['decision']}: {' vs '.join(t['options'])} -> {t['recommendation']}" for t in c["trade_offs"]], None if full else 2)
                    _lines("follow-ups", c["follow_ups"], None if full else 2)
                    _lines("rubric", [f"{r['criterion']} (w{r['weight']})" for r in c["rubric"]], None)
                    print("  strong answer:", textwrap.fill(c["strong_answer_summary"], 110, subsequent_indent="    "))
                elif rt == "lld":
                    print(f"  prompt ({c['evaluation_mode']}):", textwrap.fill(c["prompt"], 110, subsequent_indent="    "))
                    _lines("requirements", c["requirements"], None if full else 3)
                    _lines("classes", [f"{k['name']}: {k['responsibilities']}" for k in c["expected_design"]["classes"]], None if full else 4)
                    _lines("patterns", c["expected_design"].get("patterns"), None)
                    _lines("follow-ups", c["follow_ups"], None if full else 2)
                    _lines("rubric", [f"{r['criterion']} (w{r['weight']})" for r in c["rubric"]], None)
                else:
                    print("  question:", textwrap.fill(c["question"], 110, subsequent_indent="    "))
                    print(f"  competency: {c['competency']}   principle: {c.get('principle')}")
                    print("  STAR:", json.dumps(c["star_guide"])[: None if full else 400])
                    print("  strong:", textwrap.fill(c["strong_answer_summary"], 110, subsequent_indent="    "))
                    print("  weak:", textwrap.fill(c["weak_answer_summary"], 110, subsequent_indent="    "))
                    _lines("probes", c["follow_up_probes"], None if full else 3)
                    if c.get("deep_dive_guidance"):
                        print("  deep dive:", textwrap.fill(c["deep_dive_guidance"], 110, subsequent_indent="    "))
    finally:
        await mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
