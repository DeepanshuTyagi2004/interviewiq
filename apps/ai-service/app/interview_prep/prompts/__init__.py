"""Interview-prep prompt modules (Pipeline 1).

Each module is a versioned prompt template shaped exactly like app/prompts/extract_source.py:
a `*_VERSION` constant, a `*_SYSTEM` constant, a `_SCHEMA` block, and a `build_*_prompt(...)`
function. The version is recorded on every stored plan (provenance) so old plans can be
re-generated when a prompt changes — bump it whenever the prompt text changes.

The interviewer-voice text is product IP, drafted/tuned with a human in the loop. Spoken-delivery
rules shared across all three prompts (natural speech + name shortening + one-question-at-a-time,
plus the in-platform environment) live in `style.py` and are folded into each SYSTEM prompt — bump
every including prompt's `*_VERSION` when that shared text changes.
"""
