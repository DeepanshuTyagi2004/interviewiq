# Task 17 report

Scope: Steps 1, 2, 3, 5. Step 4 (live/record walkthrough) EXCLUDED by controller ruling; not run, no numbered check outcomes recorded. Nothing started that contacts Supabase/Atlas/Exa/LLM; no real .env read.

## Implemented
- Step 1: appended the RESEARCH_* block (verbatim from brief; defaults verified against app/config.py lines 127-144, all match) to apps/ai-service/.env.example; mirrored, commented, after `# EXA_API_KEY=` in infra/.env.example; added `apps/ai-service/.research-fixtures/` to .gitignore (verified with git check-ignore).
- Step 2: added `## Company research pipeline (Phase 1)` to apps/ai-service/README.md (what runs, modes, 3 CLI examples, Mongo contract tests, Step 4 list verbatim).

## Step 3 results (tails)
- ai-service pytest: `FAILED tests/test_config.py::test_interview_settings_have_defaults` / `1 failed, 540 passed, 11 skipped in 23.03s` (known pre-existing, developer's local .env: interview_llm_model 'gemma-4-31b-it' != '').
- api typecheck: `tsc --noEmit` clean, no output.
- api test: `Test Files 43 passed (43) / Tests 510 passed (510)`.
- web typecheck: `tsc --noEmit` clean.
- web lint: `6 problems (2 errors, 4 warnings)`; errors = tailwind.config.js 1:16 and 114:5 no-require-imports; warnings = _req x3, _cb x1. Known pre-existing, exit status 1.
- web test (run separately since lint fails the && chain): `Test Files 108 passed (108) / Tests 535 passed (535)`.

## Files changed
apps/ai-service/.env.example, infra/.env.example, .gitignore, apps/ai-service/README.md (all uncommitted).

## Concerns
None beyond pre-existing failures. Step 4 pending user approval.
