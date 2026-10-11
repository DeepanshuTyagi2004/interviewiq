# Live interviewer: already in the room when the candidate enters (design)

Status: built 2026-10-11 (plan `docs/superpowers/plans/2026-10-11-warm-interviewer.md`); real-join timings are in the worker log. Extends `2026-10-08-live-interviewer-design.md` (Module 03). The direction in §2 is
the user's (approved in conversation, 2026-10-11); everything else is proposed.

## 1. Purpose

After **Enter interview** the candidate waits while the interviewer is dispatched, boots, loads its context and starts its
voice session, often in an empty room. A candidate on the instructions page is very likely to start the round, so the
interviewer can be got ready while they read, and be waiting when they walk in.

**Outcomes**
- The interviewer is in the room, loaded and listening, by the time the candidate enters.
- The wait between **Enter interview** and the interviewer's first words is one reply (a model call plus the first audio),
  not a whole start-up.
- A candidate who never enters costs almost nothing and leaves nothing behind.
- If the early start fails or never happens, entering works exactly as it does today.

**Not in scope:** generating the greeting before the candidate arrives (§9), changing what the interviewer says, the
round's length, proctoring, anything about prep or blueprints.

## 2. Decisions

1. **Start early, from the instructions page** (the user's). The page the candidate lands on first is the trigger, not a
   later step, because that is where "will start" is already likely.
2. **Early start is only ever an optimisation.** Entering the room still goes live and dispatches when nobody is there
   (§5). Nothing depends on the early start having worked.
3. **The round starts when the candidate arrives, not when the interviewer does.** The 45-minute clock and the greeting
   wait for the candidate (§4.3). This is why the early start is safe.
4. Proposed defaults: a waiting interviewer leaves after **15 minutes** with no candidate; the early start is only for
   accounts the live interviewer is available to; the worker's read-only context call also works for a ready round (§4.2).

## 3. What happens today

```
instructions ─▶ checks ─▶ [Enter interview] ─▶ POST /live  ─▶ room.connect  ─▶ room is empty ... interviewer boots ... greeting
                                              flips PREP_READY → LIVE_IN_PROGRESS,
                                              records problems as seen, dispatches the worker
```

The worker, once dispatched: joins the room, connects to Mongo, loads the blueprint, calls the API for the context
(refused unless the session is `LIVE_IN_PROGRESS`), builds the run and the speech-to-text and voice session, starts the
conductor's clock, and the agent's first act is to speak. The only timed log I have (a failed job, Oct 8) shows 2.3 s from
job request to Mongo connected, plus 1.56 s to initialise a worker process; the rest has never been measured (§7).
The page shows its "interviewer is joining" notice only after 10 s.

## 4. Design

### 4.1 Web
- `PrejoinView` mounts → one `POST /api/v1/interviews/sessions/{id}/live/warm`, fire-and-forget; errors are swallowed.
  Not called in local mock mode. Safe to call repeatedly (§4.2 dedupes).
- Entering waits for the interviewer to *arrive* (its participant joining), up to 15 s, before showing the room, with the
  words "Your interviewer is joining…". After 15 s the candidate enters anyway and the existing notice and 30 s nudge
  apply. The interviewer's arrival does not depend on the browser's hello (§4.3), so this cannot deadlock.

### 4.2 API
- New `LiveSessionService.warm(candidateId, sessionId)`, route `POST /sessions/:sessionId/live/warm`. Owner only. Returns
  `200 { warming: boolean }`; never an error for a session that simply is not eligible.
  - Eligible: `PREP_READY` and live-available for this account, or already `LIVE_IN_PROGRESS`.
  - Dispatches the interviewer into `interview-{id}` unless the room already has one, or has an unfinished dispatch for
    it (LiveKit `ListDispatch`), or this process dispatched it within 30 s.
  - Changes nothing else: no status change, no "seen" problems, no clock.
- `startLive` dispatches through the same guarded path instead of unconditionally, so a waiting interviewer is reused and
  a second one is not started.
- `GET /internal/live/sessions/{id}/context` also answers for a `PREP_READY` session (it stays read-only and
  internal-key only). It still refuses every other status, so a finished or cancelled round has no context to load.
- Contract: `packages/contracts/openapi.yaml` gets the new path and `WarmResponse`, the `409` note on the context path
  changes, and the web client types are regenerated.

### 4.3 Worker
- Everything up to and including starting the voice session happens as soon as the interviewer is dispatched, as today.
- The conductor's clock and the opening greeting wait for the candidate's first `workspace.hello` (the browser sends it
  once its room view is mounted; `WorkspaceBridge.wait_ready` already waits on it). One code path serves both the early
  and the cold start: when the candidate arrived first, the hello is already there and nothing waits.
  - A fresh run gets its clock from a new `InterviewRun.begin()` instead of `start()`; a resumed run keeps its stored
    clock. The ticker starts at `begin()`. `InterviewerAgent.on_enter` waits for `begin()` before it speaks.
- **The greeting waits for the candidate to be in the room.** It needs both: the round has started (the browser said hello)
  *and* a candidate (anyone who is not an interviewer) is in the room (`InterviewRun.candidate_in_room`, kept by
  `watch_candidate` from the room's join and leave events). A turn the candidate speaks before the round starts is not
  answered (the greeting that follows is the reply). Until then the interviewer says nothing.
- **A finished interview is ended again at once**, without waiting for anyone: the worker loads the saved run first and, if
  it has ended, repeats its ending and reports it to the API even if no candidate ever comes.
- **No candidate:** if no hello arrives within 15 minutes the worker leaves. A candidate who is in the room when the wait
  ends gets 60 seconds more for their hello (they are just arriving). What happens then depends on the API's state for
  the round: still `PREP_READY` (it was only warmed up) it deletes the room and leaves the session alone; `LIVE_IN_PROGRESS`
  (they went live and never arrived) it ends the round as `technical`, tells the browser, and frees the room, as it does
  for a candidate who is away too long. If the API cannot say, it leaves the session for the API's sweep.
- **Stale blueprint:** while waiting, the worker re-checks every 30 seconds that its blueprint (id and version) is still the
  current one (the reconcile job may re-prepare a round more than 30 minutes before its slot), and once more at the hello.
  If it changed it leaves without starting the round, and the next go-live or nudge dispatches an interviewer that loads the
  new blueprint. Noticed while the candidate is still on the instructions page, the swap costs them nothing they would
  not have paid without the warm-up. It does not reload in place because a new blueprint can change the interviewer's
  persona, and with it the voice, which a running voice session cannot swap. A failed blueprint lookup counts as "no change".

## 5. Failure modes

| What happens | Result |
|---|---|
| Warm call fails or is never made (offline, old page, error) | `startLive` dispatches as today |
| API restarts between warm and enter (the 30 s memory is lost) | LiveKit's own dispatch list answers: not dispatched twice |
| Candidate enters while the interviewer is still booting | Dispatch is found, not repeated; the page shows "joining" until it arrives |
| Two interviewers end up in one room | The existing guard (a worker that sees another interviewer leaves) stays |
| LiveKit closes a room that holds only the interviewer | The job ends; entering finds no interviewer and dispatches as today. Verify in the spike (§7) |
| Candidate leaves the instructions page | The interviewer waits out the 15 minutes and leaves; the session is untouched |
| Candidate reloads mid-round | Unchanged: the resume path and the stored clock |
| The round is cancelled or rescheduled while the interviewer waits | Nobody can enter it (the status gate); the interviewer is not told, waits out the 15 minutes and leaves |

## 6. Cost and abuse
A waiting interviewer holds one worker job and an open room, with no model call, no speech connection billed until audio
flows, and no database writes. The warm call is owner-only, needs a `PREP_READY` live-available session, and dedupes per
session, so repeated calls cannot start more than one interviewer.

## 7. Measuring
The worker logs one structured line per stage with the milliseconds since the job was received: `job_received`,
`room_joined`, `context_loaded`, `session_started`, `hello`, `begin`, `first_audio`. The API logs one line per attempt, `interviewer for session <id> (warm|go-live): dispatched|skipped|failed, <why>`
(`none in the room`, `interviewer in the room`, `interviewer dispatch pending`, `dispatched under 30 s ago`,
`LiveKit refused the dispatch`). `begin` is logged only when the round actually starts. At go-live the two presence
checks run side by side. A first spike answers two open questions before the build: does LiveKit keep a room open for an
interviewer alone, and does `ListDispatch` report a dispatch that has not started its job yet.

## 8. Testing and files
- API: `warm` eligibility and dedupe, `startLive` not dispatching twice, context for `PREP_READY`.
- Worker: no clock and no speech before the hello; clock and greeting after it; the 15-minute exit; the stale-blueprint
  reload; a resumed run keeps its clock.
- Web: warm is called once on the instructions page, not in mock mode; entering waits for the interviewer and gives up at 15 s.
- By hand: a real join with the instructions page left open for a minute, timed with the §7 lines.
- Files: `apps/api/src/services/liveSessions.ts`, `integrations/livekit.ts`, `routes/interviews.ts`, `routes/internal.ts`,
  `packages/contracts/openapi.yaml`; `apps/ai-service/app/interviewer/{worker,run,agent}.py`;
  `apps/web/features/interview/{api,hooks}.ts`, `features/interview-live/session/*`, `PrejoinView.tsx`, `LiveInterview.tsx`.

## 9. Later, only if §7 shows it is needed
Generate the greeting and its audio during the waiting time and hold it until the hello. It is the largest remaining piece
of the wait, but it also means the greeting is written before the candidate is there, so it is left until measured.

A known limit: the interviewer's voice track is published only once the candidate has joined (LiveKit starts the session's
audio output on the first participant), so a little start-up time remains after the hello.

## 10. Spike result (2026-10-11, the project's LiveKit)
- `ListDispatch` answers `{"agent_dispatches": [...]}` (snake_case); a dispatch no worker has taken yet is listed with
  `state.jobs: []` and `deleted_at: "0"`, so "not started" is visible. A room that does not exist answers 404.
- `CreateDispatch` creates the room, and LiveKit also lists an unnamed default dispatch (`agent_name: ""`) in it;
  `hasDispatch` only looks at the interviewer's name.
- A room with nothing but a dispatch persists with `empty_timeout: 300` and `departure_timeout: 20` (seconds).
- **An interviewer alone does not keep a room open.** Two rooms with `empty_timeout` 20 s, one holding an agent-kind
  participant (the server registered it as `AGENT`) and one empty: both closed at the same time. So a waiting interviewer
  would be dropped after LiveKit's default five minutes. `dispatchAgent` therefore creates the room first with
  `empty_timeout` 20 minutes (longer than the worker's own 15-minute wait), best effort: if `CreateRoom` fails,
  `CreateDispatch` still makes the room as before. Creating a room that already exists is safe and leaves it as it was
  (checked on the real project). The `departure_timeout` (20 s after the last candidate leaves) is left at its default.
- Real LiveKit: `hasDispatch` is true for a dispatch no worker has taken, and false for a different agent name.
