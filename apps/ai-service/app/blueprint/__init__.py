"""Interview blueprint: the prep phase (docs/superpowers/specs/2026-10-07-interview-blueprint-design.md).

A booked round gets a blueprint: problems chosen from the bank by company, JD and round, a persona,
a timed arc, per-question playbooks with condition -> action branches, answer keys, global policies
and the evaluation signals to collect. Entry points: `pipeline.start_run` (internal routes in
`api.py`) and the admin diagnostics routes in `admin_api.py`.
"""
