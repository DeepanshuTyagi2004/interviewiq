## Global Constraints

- **Dev mode:** clipboard rules are active only when `process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENFORCE_CLIPBOARD === '1'`. In dev, native copy and paste work: no local clipboard, no marker, no clipboard overwrite at Join, nothing blocked, no `foreign_paste` sent. Typing capture and the return clock stay on in dev.
- **Nothing sensitive leaves the browser:** no pasted text, no typed characters, no key identities. Only lengths, line counts, counts and timing statistics.
- **Marker:** the OS clipboard receives the fixed string `IQ-ROOM-CLIPBOARD` (no nonce; a refresh must read as "nothing to paste", never "foreign").
- **Limits (browser countdown only; the worker enforces in Phase 2):** 15 s for tab hidden or window blur, 30 s for full-screen exit or share stopped, hard cap 60 s. A second display opens no episode.
- **Wire names are snake_case** and the Zod module `protocol/messages.ts` is the source; the Pydantic mirror and `packages/contracts/live-workspace.examples.json` follow it. `v` is `1`.
- **Style:** `features/interview-live/**` uses single quotes and no semicolons; files under `app/**` (ChecksView, PrejoinView) use double quotes and semicolons. Match the file you are in.
- **Copy** in this plan is a product-IP draft for the user's review; keep it where the plan puts it.
- **Standing rules (the user's):** do not run vitest, tsc, eslint or pytest unless the user has said to; the test commands below are listed so they can be run on the user's go-ahead. Do not commit (the user commits); end each task with the files left in the working tree. Check `git status` and file mtimes before editing: another agent edits this repo concurrently. Never edit an ai-service `.py` file while a blueprint prep run is in flight or the interviewer worker is running (Task 1 step 11 is the only Python edit in this phase).

