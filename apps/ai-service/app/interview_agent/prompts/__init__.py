"""Live-interview prompt scaffolds (Pipeline 2). Same contract as app/interview_prep/prompts:
each module exports *_PROMPT_VERSION, *_SYSTEM, and build_*_prompt(). Real text is product IP —
these are functional scaffolds; bump the version on any change. All spoken-facing prompts import
SPOKEN_STYLE + PLATFORM_CONTEXT from interview_prep/prompts/style.py so the live voice matches the
plan's voice."""
