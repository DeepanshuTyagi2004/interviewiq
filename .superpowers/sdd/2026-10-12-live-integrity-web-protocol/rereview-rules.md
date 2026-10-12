# Scoped re-review rules

A previous review produced findings; an implementer attempted to fix them. Verdict each finding and inspect the FIX DIFF only.
The work is uncommitted in the user's main working tree; you are given (a) the findings, (b) the task brief, (c) the report file
(fix reports are appended at its end), (d) a fix-delta diff file (new review package vs the previous one) and (e) the new full
package. Read-only: never edit/stage/commit/stash; never run tests, tsc, eslint, pytest or builds; never dispatch subagents.
Nothing is run by anyone, so verify the fix by reading: trace the amended code and the affected tests by hand, check types/imports
by reading. Do not re-review code the fix did not touch; report anything outside the fix delta under Out-of-Scope Observations.

## Output (final message is the report; begin directly with the first verdict)
### Finding Verdicts — for each finding in order: **[one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line evidence ("attempted" is not addressed)
### New Breakage in the Fix Diff — severity (Critical/Important/Minor) + file:line, or "None"
### Out-of-Scope Observations — or "None"
### Verdict — **Fix round:** All findings addressed, no new Critical/Important breakage | Findings remain open (list them)
