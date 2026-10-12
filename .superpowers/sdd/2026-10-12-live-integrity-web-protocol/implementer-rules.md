# Implementer rules (read with your task brief)

You implement ONE task of a plan, in the user's main working tree: /Users/salescode/Desktop/project/interviewiq (branch main).
The plan's spec: docs/superpowers/specs/2026-10-12-live-integrity-design.md. The binding project-wide constraints are in
`.superpowers/sdd/2026-10-12-live-integrity-web-protocol/constraints.md` — read them. Your task brief contains the exact code and
test text to use verbatim.

## Standing rules from the user (they override anything in the brief or in generic habits)
1. **Do NOT commit, stage, stash, branch or revert anything.** Leave your work in the working tree. Other files in the tree are
   modified or untracked and are not yours (apps/ai-service/{.env.example, app/config.py, app/interviewer/worker.py, package.json,
   app/interviewer/lifecycle.py, tests/interviewer/test_lifecycle.py}, `.opencode/`): never touch or revert them.
2. **Do NOT run vitest, pytest, `tsc`, eslint, `pnpm test`, `pnpm typecheck` or `pnpm lint`.** Not even a single test. Write the test
   files exactly as the brief says; the "run the tests" steps in the brief are for the user, who will run them later. (Running the
   generator `pnpm generate:live-schema` is a generator, not a test, and is allowed when the brief says so.) Because nothing runs,
   check your own work by READING: re-read every file you wrote against the brief, trace each test's assertions by hand against the
   code, and check every import, export name and type signature against the neighbouring files.
3. **Do NOT edit anything under apps/ai-service** unless your brief says so explicitly (the dev stack is running and reloads on edit).
4. Another agent may edit this repo concurrently. Before editing an existing file, `git status --short -- <file>` it; if it already
   shows changes you did not make, stop and report NEEDS_CONTEXT. Re-read a file right before editing it.
5. Do not run the dev server, open a browser, or start any long-running process.

## Your job
1. Read the brief, then every existing file it tells you to modify (read them fully before editing; match their style: files under
   features/interview-live use single quotes and no semicolons, files under app/ use double quotes and semicolons).
2. Implement exactly what the brief specifies, using its code and test text verbatim. Where the brief's "old" text must match an
   existing file and does not, do not guess: report NEEDS_CONTEXT with the mismatch (file, expected, actual).
3. If something in the brief looks wrong (a type error, a wrong import, a test that cannot pass against the code in the same brief),
   do not silently change it: fix only if the fix is unambiguous and tiny, and list every deviation under "Deviations" in your
   report; otherwise report DONE_WITH_CONCERNS or NEEDS_CONTEXT.
4. Self-review (reading only): completeness against the brief, names and exports against consumers named in the brief's
   "Interfaces", no extra features, no stray debug output, files end with a newline.
5. You never dispatch subagents of any kind (no helpers, no reviewers). Review is the controller's job.

## Report
Write your full report to the report file named in your dispatch: what you implemented; files created/modified (paths); deviations
from the brief (or "none"); a hand-trace of each new test file ("test X asserts Y; code does Z; consistent"); "Tests: not run (user's
standing rule)"; concerns. Then reply with ONLY (under 12 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT);
"Commits: none (by rule)"; the list of files touched; "Tests: not run"; concerns; the report file path.
If you are resumed with review findings: fix them, re-read the amended code, append a fix report (what changed, files, hand-trace of the
affected tests) to the same report file, and reply with the same short contract.
