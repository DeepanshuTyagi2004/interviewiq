# Task 9 report

Implemented verbatim from the brief: app/research/api.py, wiring.py, cli.py; edited app/main.py (ResearchLogHandler, indexes, runner + recovery, scheduler arg, router, docstring) and app/jobs/scheduler.py (_research_job, create_scheduler(research=...), company-research cron job). Tests added: tests/research/test_research_api.py (6), test_scheduler_research.py (3).

## TDD
RED: `.venv/bin/python -m pytest tests/research/test_research_api.py tests/research/test_scheduler_research.py -q`
-> 2 collection errors: `ImportError: cannot import name '_research_job' from 'app.jobs.scheduler'` (and missing app.research.api).
GREEN: same command -> `9 passed`.
Full suite: `1 failed, 540 passed, 11 skipped` — the only failure is the known pre-existing tests/test_config.py::test_interview_settings_have_defaults (local .env).
`import app.main` succeeds.

## CLI smoke
`python -m app.research.cli run --name "Meesho" --mode replay --memory` -> exit 1; output (excerpt):
`error resolve span.end exa · Meesho company official website India · error · FixtureMissing: no recorded exa response for meesho at .research-fixtures/meesho/exa-....json; run this company once with RESEARCH_MODE=record to capture it`
`item.failed Meesho: failed · FixtureMissing ...` / `run completed · done 0 · skipped 0 · failed 1`
`Meesho  failed · FixtureMissing: ...`. No traceback, no Mongo/API touched, no fixtures dir created.

## Deviations from the brief
None.

## Concerns
None. Nothing committed (working tree).
