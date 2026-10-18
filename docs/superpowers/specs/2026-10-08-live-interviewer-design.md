# Live Interviewer (Module 03, proof of concept): design

**Date:** 2026-10-08
**Status:** approved in conversation, section by section; this document is the written spec for review.
**Builds on:** the interview blueprint (`2026-10-07-interview-blueprint-design.md`). The blueprint is the plan;
this module runs it live.

## 1. Goal

An AI interviewer joins the candidate's LiveKit room, runs a prepared blueprint by voice, and shares a live
workspace with the candidate: a problem panel, a code editor and a whiteboard. Both sides can write, highlight and
draw in it. The interviewer uses the blueprint as a guide, not a script: it adapts to the candidate, may change the
plan a little, keeps each question within its time, and ends the round itself, normally or early for misconduct.
Every turn is traced so we can replay why the interviewer said what it said.

**Proof-of-concept scope:** one person takes one known-good blueprint end to end: the Salescode SDE-1 round 1 on
the `tyagideepanshu` account (coding plus Java/SQL and resume questions; accepted after evaluation, exercises
most branch types).

**Success:**
- The candidate completes the round by voice and code, and it feels like a real interviewer.
- The interviewer follows the arc, moves on at each question's time limit, and reacts correctly when the
  candidate is stuck, wrong, asks for the answer, misbehaves or breaks proctoring rules.
- The trace explains every turn.
- Median time from the end of the candidate's speech to the interviewer's first audio is **≤ 1.5 s**.

**Out of scope:**
- Scoring and the post-interview report (Module 04). This module records evidence only.
- A Run button or code execution in the room.
- Recording, or analysis of the screen share.
- Hindi/Hinglish; voice and pace preferences.
- Many users at once; opening live interviews to everyone.
- An admin "Live interviews" diagnostics tab (a CLI replay stands in for the POC, §9.3).

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Voice pipeline | LiveKit Agents in the AI service. Deepgram for speech-to-text (Nova-3, English) and the voice (Aura-2). Silero VAD plus LiveKit's turn detector. Separate stages, not a realtime speech-to-speech model. |
| LLM | **OpenRouter**, model `deepseek/deepseek-v4.1-flash` (1M context, text and image input, tool calls, ~$0.03/M input, $1/M output). Reached through LiveKit's OpenAI-compatible plugin. |
| Brain | **Talker + background director + conductor** (§5). Two LLM roles plus a rules layer in code. |
| Workspace ownership | The browser owns the problem panel, the code and the whiteboard. The agent sends instructions over the LiveKit data channel; the browser applies or refuses them (§6). No CRDT library. |
| What the candidate sees | A problem appears only when the interviewer asks it: the statement and 2 examples. Generic titles ("Problem 1"). **No problem names, topics or difficulty anywhere.** |
| Time | No countdown. Each part's maximum (roughly its blueprint timebox) and the round's 45 minutes are guidance, not rules: the director decides when a part is done and may give it more time or end the round early (decided 2026-10-17). The round may run past 45 minutes; the only hard limit is a safety ceiling at 1.5×. |
| Ending | The interviewer always ends the round and deletes the room, which removes the candidate, whether the round went well or was cut short. |
| Misconduct | One firm warning, then the round ends as `ended_by_interviewer`. Firm and blunt, never insulting. |
| Proctoring | Counters and warnings replace the old pause overlay; the round keeps running. Weighted violations; repeated full violations end the round (§7). |
| Availability | An allowlist opens live interviews for the test account only (§8.1). |
| Design language | The platform's HUD layer (§10). |

## 3. Architecture

```
 Browser (live room)                LiveKit Cloud                AI service: interviewer worker
 ┌──────────────────────┐    audio  ┌───────────────┐  audio     ┌──────────────────────────────┐
 │ mic, camera ─────────┼──────────►│ room          │───────────►│ Deepgram STT → talker LLM →  │
 │ workspace (owner)    │◄─────────►│ interview-{id}│◄──────────►│ leak guard → Deepgram TTS    │
 │  panel · code · board│  data ch. └───────────────┘  data ch.  │ director (background)        │
 │ proctoring           │                                        │ conductor (rules, timers)    │
 └─────────┬────────────┘                                        └──────┬───────────────┬───────┘
           │ HTTPS (candidate auth)                     internal key │       MongoDB  │
           ▼                                                         ▼  (live_* collections)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ API: go-live gate (allowlist), agent dispatch, internal context + end    │
 └──────────────────────────────────────────────────────────────────────────┘
```

**Browser** (`apps/web`, existing live route): owns the workspace; publishes mic and camera to the room; sends
workspace snapshots, Ask selections and proctoring events; applies the agent's instructions. It never receives the
blueprint: each problem's statement and examples arrive from the agent when it asks that problem.

**LiveKit Cloud:** room `interview-{sessionId}` (already configured in both env files).

**Interviewer worker** (`apps/ai-service/app/interviewer/`, its own process, agent name `interviewer`): a LiveKit
Agents worker. On dispatch it loads the session's current blueprint from the AI service's MongoDB, fetches the
round context and the candidate's minimal profile from the API, and runs the round. It writes the transcript,
trace and evidence to MongoDB, calls the API to end the session, and deletes the room.

**API** (`apps/api`): gates go-live behind the allowlist, dispatches the agent explicitly at go-live, serves the
internal context endpoint and records the end.

**Dependencies:**
- AI service: `livekit-agents` with the `deepgram`, `silero`, `openai` (OpenAI-compatible, pointed at OpenRouter)
  and `turn-detector` plugins. These were dependencies of the deleted agent and come back.
- API: `livekit-server-sdk` (already present) gains agent dispatch and room deletion.
- Web: nothing new (`livekit-client`, `@monaco-editor/react`, `@excalidraw/excalidraw` are installed).

**Configuration (AI service `.env`):**

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | (none; required) | OpenRouter key. Not yet present. |
| `INTERVIEWER_TALKER_MODEL` | `deepseek/deepseek-v4.1-flash` | Talker model. |
| `INTERVIEWER_TALKER_REASONING` | `none` | Reasoning off on the speaking path (lowest supported setting if `none` is refused). |
| `INTERVIEWER_DIRECTOR_MODEL` | `deepseek/deepseek-v4.1-flash` | Director model; can be switched to a Pro model later. |
| `INTERVIEWER_DIRECTOR_REASONING` | `medium` | The director is off the speaking path. |
| `INTERVIEWER_TTS_VOICE` | an Aura-2 English voice | One configured voice for the POC, chosen to suit the test blueprint's persona. |
| `INTERVIEWER_TALKER_TIMEOUT_SECONDS` | `4` | Per-call timeout before a fallback (§11). |
| `DEEPGRAM_API_KEY`, `LIVEKIT_*`, `INTERNAL_API_KEY`, `API_BASE_URL` | (present) | Already in `.env`. |

**OpenRouter request settings** (both roles): `provider.sort = "latency"`, `provider.require_parameters = true`
(only providers that support tool calls), `provider.allow_fallbacks = true`, and **`provider.data_collection =
"deny"`**, so providers that retain or train on prompts are skipped. The transcript and the candidate's profile are
personal data.

## 4. Interview state (owned by the conductor)

- **Plan:** the blueprint's arc (`greeting`, `small_talk`, `framing`, `candidate_intro`, `core`,
  `candidate_questions`, `wrap_up`). The core holds the blueprint's core slots in order. Around it sit the reserve
  slots and the filler pool (§5.4).
- **Items:** one per thing asked (a phase, a slot or a filler question), each with `item_id`, `kind`, start time,
  elapsed time, maximum, hint step reached and status (`pending`, `active`, `done`, `skipped`, `swapped`).
- **Ledgers:** proctor events with weights (§7), conduct incidents (§5.6), warnings given, nudges given.
- **Workspace mirror:** the panel cards and sections, the latest code snapshot (with version), the whiteboard summary
  and its latest backup scene.
- **Running summary:** the director's summary of earlier turns.

The conductor checkpoints this state to `live_runs` after every turn, so a restarted worker can continue (§11).

## 5. The interviewer brain

### 5.1 Talker (every turn, on the speaking path)

The talker is the LLM that speaks. One call per candidate turn, reasoning off, streamed into the TTS through the
leak guard.

**Prompt, in order** (the stable parts first, so providers that cache prompt prefixes can reuse them):
1. **Stable prefix:** the persona (name, seniority, style, disposition), the fixed rules (§5.7), the tool
   descriptions and the plan outline (generic item labels only).
2. **Current item:** for a slot, the playbook: the opening, the clarification answers, the hint ladder (marking the
   steps already given), the condition → action branches, probes, follow-ups, expectations (what a good answer must
   show) and the **answer key**. The talker needs the key to judge answers and pitch hints; the leak guard (§5.5)
   keeps it from being spoken. For a filler question, its text and what a sound answer covers.
3. **Live state:** time used against the maximum ("11 of ~15 min"), the code with line numbers, the whiteboard
   summary, any pending Ask selection, the candidate's own highlights and notes, unmentioned proctor events, the
   latest director brief, and the **conductor's orders** in force (§5.3).
4. **Conversation:** the last ~20 turns verbatim; earlier turns as the director's running summary.

**Tools:**

| Tool | Effect |
|---|---|
| `show_problem(item_id)` | Puts the slot's problem on screen (§6.3). The only way problem text reaches the browser. |
| `add_section(kind, title, body)` | Adds a panel section: `constraints`, `format`, `clarification`, `hint`, `explanation`, `note`. |
| `highlight_statement(quote, note?)` | Highlights a passage of the statement by its quoted text. |
| `code_comment(at, text, purpose)` | A comment at the top or above a line. `purpose`: `question`, `doubt`, `hint`. |
| `code_insert(at, text, purpose)` | At most 10 lines of non-comment code. `purpose`: `stub`, `test_input`. Never a solution. |
| `code_highlight(start_line, end_line, note?)` | Marks lines, for "what happens here when the array is empty?". |
| `draw(elements)` | Simple boxes, ellipses, diamonds, text and arrows on the whiteboard. |
| `look_at_board()` | Requests a PNG of the whiteboard; the image comes back as the tool result for a follow-up generation. The talker says something like "let me take a look" first. |
| `give_hint(step)` | Records the hint step given (the ladder's next step). |
| `next_item(reason)` | Asks the conductor to move to the next item. |
| `flag_conduct(kind, quote)` | Reports a conduct incident to the conductor (§5.6). |
| `log_turn(condition, action, reason)` | The decision for the trace, using the blueprint's condition and action vocabulary, or `improvised`. |

Workspace tools run while the talker speaks. The plan-2 spike (§13) verifies that tool calls don't cost a second LLM
round trip on ordinary turns; if they do, `log_turn` becomes a trailing tag that is stripped before the TTS.

**Staying quiet:** while the candidate thinks aloud during coding and isn't addressing the interviewer, the talker
may answer with an empty reply, and nothing is spoken.

### 5.2 Director (background, never on the speaking path)

**Runs when:**
- every 3 candidate turns;
- the code or whiteboard settles after a change;
- an item starts or ends;
- the current item reaches about 50%, 80% and 100% of its maximum;
- a proctor violation or conduct incident occurs.

One director call runs at a time; triggers that arrive meanwhile are merged into the next run.

**Reads:** the whole blueprint (all slots, keys, personalization, policies), the candidate's minimal profile, the
full transcript, the conductor state, the code, the whiteboard summary (plus a PNG when the board changed since the
last brief), and the evidence so far.

**Writes a structured brief:**

| Field | Content |
|---|---|
| `for_position` | The item and state version it was written for. |
| `goal`, `next_move` | What the talker should achieve next; the next move from the action vocabulary, with detail. |
| `plan_changes[]` | `reorder`, `skip`, `use_reserve`, `insert_filler`, `add_follow_up`, each with a reason. |
| `tone` | Tone notes ("candidate is nervous; slow down"). |
| `evidence[]` | Observations per item and evaluation signal, citing turn IDs. |
| `summary` | The updated running summary. |
| `conduct` | `none`, `warn` or `end`, with a reason. |
| `leak_review` | Whether the talker revealed more than the hint ladder allowed, and how far. |

**Late briefs:** the conductor drops a brief's item-specific parts if the plan position has moved since its
`for_position`. A brief that arrives while the talker is speaking applies from the next turn.

### 5.3 Conductor (plain Python, no LLM)

- Owns the plan position, the item timers, hints given, the ledgers and the end rules.
- Triggers the director and **validates its plan changes** before applying them: only allowed operations; problems
  only from the blueprint's core and reserve slots; filler questions only as described in §5.4; the
  `candidate_questions` and `wrap_up` phases are never removed.
- Issues **orders** that the talker must follow on its next turn and that override any brief:
  - `converge` at ~80% of an item's maximum (superseded by §5.6: the marks only wake the director);
  - `move_on` at the maximum (superseded by §5.6: the marks only wake the director);
  - `mention_violation`, `final_warning_proctor`, `conduct_warning`;
  - `end` with a reason.
- When an order is due and the candidate is silent, the conductor triggers a turn itself (proactive speech), for
  example to mention a violation after the candidate returns to the tab.
- Runs the leak guard (§5.5).

### 5.4 Plan changes and filler questions

The interviewer may reorder items, skip an item, swap in a reserve slot, add follow-ups, and insert **filler
questions** between problems.

- Filler questions are drawn from the **skills in the candidate's profile** (fetched from the API at the start of
  the round, §8.2). They can be theoretical, framed naturally ("I noticed Java in your profile. Can you tell me…").
  There is no fixed format or spoken label; the trace records which profile skill each one came from.
- The director writes filler questions itself. It may never invent a coding problem: problems come only from the
  blueprint.
- A filler question's maximum is 4 minutes.
- Fillers are inserted only while the round is within its soft target, and are the first thing dropped when it runs
  long.

Every plan change is recorded in `live_runs` with its reason and the brief it came from.

### 5.5 Leak guard

The talker's output is checked **sentence by sentence before the TTS speaks it**; `code_insert` and `code_comment`
text is checked before it is sent. The guard blocks:

1. fragments of the slot's reference solution (normalized token n-gram overlap above a threshold);
2. the examples read aloud (their literal input and output values): the interviewer says the problem is on screen;
3. any problem's title, the bank's topic tags, and difficulty labels, unless the candidate used the term first in
   this item;
4. any other slot's content.

A blocked sentence is dropped; if nothing safe remains, a neutral line ends the turn ("What do you think?"). Every
block is logged with the matched rule. Revealing too much of the approach in plain words isn't reliably detectable
by rules; the talker's rules forbid it and the director's `leak_review` audits it.

### 5.6 Time, silence and ending

**Per item:**
- The half-way, ~80% and 100% marks only wake the director; they order nothing by themselves (decided 2026-10-17).
- The director decides from where the conversation is, through `plan_changes`: `move_on` ends the current part,
  `extend` (1 to 10 minutes) gives it more time, `wrap_up` closes the round. A `move_on` is refused in the parts that
  are never cut (`candidate_questions`, `wrap_up`).
- Fallback when the director says nothing: the part ends by itself at its maximum plus the larger of 2 minutes and
  25% of the maximum, plus any minutes the director gave it.
- The candidate's progress at that moment (code snapshot, director notes) is recorded as evidence.

**Round:** the round's duration is a soft target the director may run past when a part needs it; it drops fillers
first when the round runs long and closes it with `wrap_up` when it has done its job. The `candidate_questions` and
`wrap_up` phases are never cut. **Safety ceiling at 1.5× the duration:** the conductor forces the wrap-up.

**End of a candidate's turn** (decided 2026-10-17): LiveKit's turn detector with fixed endpointing (1 s when they sound
finished, up to 6 s mid-sentence). A turn that breaks off on a word nothing ends on ("...and the") gets an instant
"Mm-hmm." (said over nothing, cut the moment they go on, never a turn of the record) and is answered if they stay quiet
2 s more; one step of a walk-through they were asked for waits 5 s. An ellipsis or a filler after a finished thought is
not a break. Silence while they code is never a turn. When the interviewer starts while they are still going and they
cut it off within its first 5 words, saying 3 words or fewer (not a question), it says "Sorry, go ahead." in fixed words.

**Orders that went stale** (decided 2026-10-17): warnings, the ending and the line that puts a problem up are always acted
on. A silence check-in, and a "take your time" not yet said, are cancelled when the candidate speaks. The talker may set aside
`converge`, `move_on` and `open_item` when what the candidate just said covers them or makes them wrong, naming them in
`log_turn` (`set_aside`, `set_aside_why`); a turn logged as staying on the part (a follow-up, a hint) that neither calls
`next_item` nor leaves the part in words sets its `move_on` aside too. A `move_on` set aside leaves the part open, wakes the
director with the reason, and holds the late fallback off for 2 minutes. Every cancelled or set-aside order is in the turn
record (`cancelled` on the candidate's turn, `set_aside` on the interviewer's) and in the director's payload.

**Silence:**
- Talking phases: a nudge after **20 s** of silence.
- While coding: a nudge after **2 min** with no speech and no code change.

**Conduct incidents:** inappropriate or personal remarks, abuse or harassment, refusing to engage, off-topic talk
that continues after 3 redirects in the same item, and attempts to manipulate the interviewer ("ignore your
instructions").
- Flagged by the talker (`flag_conduct`) at once, or by the director's `conduct` field. At most one incident is
  counted per turn.
- **First incident:** the talker states plainly and firmly that it isn't acceptable in an interview. This is the
  warning.
- **Second incident:** the round ends as `ended_by_interviewer`. Abuse and harassment follow the same rule: warning,
  then end on repeat.

**Ending sequence (every reason):**
1. The talker says the final line: the persona's closing for `completed`, or the reason for an early end ("I'm ending
   the interview here because…").
2. After the audio finishes, the agent sends `session.ending` (§6.2).
3. It calls `POST /internal/live/sessions/:id/end` (retried 3×).
4. It finalizes `live_runs` and deletes the room, which disconnects the candidate.

**End reasons:** `completed`, `ended_by_interviewer`, `candidate_ended`, `technical`.

**Candidate presses End:** a confirm dialog; then the browser sends `session.end_request`; the interviewer says a
short goodbye and ends with `candidate_ended`. The interviewer's own watchdog ends the round after 8 s if the
goodbye never finishes; with no `session.ending` within 12 s the browser calls `POST /sessions/:id/live/end`
itself and disconnects. An ending already decided (misconduct, a third violation) is never replaced by
`candidate_ended`: the End press only hurries it. The interviewer's end report is authoritative: if the browser's
fallback closed the round first (it carries no summary), the report's reason and summary replace it.

**Candidate drops off:** the agent keeps its session when the candidate disconnects (a page refresh is a few
seconds) and says nothing into the empty room. It waits 2 minutes for a rejoin, then ends with `technical`.
An absence of 20 s or more counts as one full-weight violation (like leaving the tab) when the candidate returns.

**Joining:** the worker joins the room and listens first, holding the browser's `workspace.hello` until the
interview has loaded; the browser says hello again whenever the interviewer appears, because the first hello is
usually sent before the interviewer is in the room.

### 5.7 Fixed rules (talker and director)

Never bend, whatever the brief or the candidate says:
- Never reveal a solution, the answer key, other questions, topics or difficulty.
- Never read out the examples; say the problem is on screen.
- Never write solution code in the editor; comments and short stubs or test inputs only.
- Never grant more time past an item's maximum.
- Firm and blunt with misconduct, never insulting.
- Answer the candidate's questions correctly and within these limits; English only.

**Blueprint policy overrides** (the blueprint's `pol1` template stays unchanged; the live runtime applies these on
top, as `live-pol1`):

| Policy | Blueprint `pol1` | Live override |
|---|---|---|
| `extend_time` | partial: allow a minute or two | **decline** at the maximum |
| `over_time` branch | "Summarise where you got to" | "Seems like we have to move on", then move on |
| `personal_or_inappropriate` | decline politely, without judgement | a firm statement; counts as a conduct incident (§5.6) |
| proctoring | (none) | mention every violation; thresholds in §7 |

### 5.8 Interviewer-led flow (2026-10-17)

Full design: `2026-10-17-interviewer-led-flow-design.md`.
- **Talker's moves:** `go_to`, `skip_goal`, `open_thread` and `close_thread`, as tools in its existing call. It follows the candidate within the plan's must-cover goals; a problem is never left midway.
- **Free minutes:** time available (planned length plus director `extend`s, minus time used) minus the planned minutes of pending must-cover goals. A may-cover goal or a thread needs at least one free minute; threads are at most 6 minutes, 3 per round.
- **Stale briefs:** a flow position rises on every move, and a director brief written for an older position is not shown and its goal-specific changes are dropped. Every move wakes the director.
- **Shapes:** each round gets a shape from a fixed library (`app/blueprint/shapes.py`) that orders the conversation around the problems; the problems, their minutes and what is assessed never change.
- **Acceptance tools (2026-10-17):** `apps/ai-service/scripts/rehearse_flow.py` is how a talker, director or prompt change is accepted. `run SESSION SCRIPT OUT_PREFIX [--shape ID]` rehearses a scripted candidate (paid), `compare PREFIX...` prints cost, cache, latency, log_turn and blocked-rule figures, and `check RECORD.json...` or `check --session ID` runs `app/interviewer/tracecheck.py` over a record or a real session's stored turns and exits 1 on any finding. The trace check has one check per problem the rehearsals found (a silent reply, narration, internal ids or a tool call spoken, a format-confirmation ask, a third re-ask on one part, a problem with no candidate turn, the outline twice, the introduction asked again, a double goodbye, "planned later", an unrepaired stumble, a promise with no thread kept). Run the rehearsals and the check after any change to the talker, the director or the prompts, and treat every finding as a regression until explained. `tests/interviewer/test_corpus.py` holds the hand-labelled corpus of interviewer lines that the speech classifiers (`closing.py`, `talker.py`) must keep satisfying.
- **Persona rehearsals and the judge (2026-10-17):**
  - `rehearse_flow.py batch PERSONA_DIR OUT_DIR [--scripted] [--judge]` is the acceptance run. It covers:
    - the persona candidates in `scripts/flow_scenarios/personas/`, each a model that answers what the interviewer actually says, with its own expectations;
    - the four scripted rehearsals;
    - the trace check, plus style metrics: verdict and echo rates, blocked turns, filler lines, minutes before the first problem;
    - the transcript judge, Claude Sonnet scoring six dimensions and listing every issue as major or minor.
  - A record broken by a credit or model failure is marked INVALID and left out of the means.
  - The judge's anchor is a hand-written gold transcript of a well-run round, which scores 4/5.
  - Judge scores vary by about ±0.5 per run, so compare pooled means over several runs and the issue counts, not single scores.
  - Talker model comparisons on the same code (2026-10-17): DeepSeek v4.1 flash scored 3.1, DeepSeek v4 pro 2.6 and Claude Haiku 5.5 2.0. Flash stays.
- **Interviewer style (2026-10-17):**
  - A poker face. Most replies carry a short neutral acknowledgement or none.
  - At most one verdict per turn, and no verdict in a reply right after one.
  - The answer is never echoed back.
  - Silence when the candidate starts coding.
  - The outline names every part, the deep dive is led in as a group, and the round closes early instead of filling time.
  - Guards keep the voice in English, never speak the model's reasoning aloud, and keep code and arithmetic exact in speech ("a <= b" was once spoken "a = b").

## 6. Shared-workspace protocol

### 6.1 Rules

- The browser is the source of truth for all three surfaces; the agent keeps a mirror built from what the browser
  sends.
- JSON messages on LiveKit **text streams**, topic `workspace` (reliable, ordered, any size), each with `v`
  (protocol version), `id` and `type`. Images and whiteboard scenes use LiveKit byte streams
  (`workspace.board.snapshot`, `workspace.board.backup`, `workspace.board.restore`).
- **The agent sends no workspace instruction before the browser's first `workspace.hello`**, so nothing arrives
  before the room is ready to apply it.
- The browser **acknowledges every agent instruction** with `ack {id, ok, reason?}`, so the trace shows whether
  each one applied.
- **Interviewer marks are always orange** (the platform's only accent) on every surface: highlights, code markers,
  inserted lines and drawings.
- The transcript (with interim words) and the agent's state (listening, thinking, speaking) come from LiveKit Agents'
  built-in transcription streams and agent-state attribute; no custom messages.
- **Contract:** the Zod module `apps/web/features/interview-live/protocol/messages.ts` is the source;
  `pnpm --filter @interviewiq/web generate:live-schema` writes `packages/contracts/live-workspace.schema.json` from it
  (a test fails when the file is stale). The AI service mirrors it in Pydantic, and both sides test against
  `packages/contracts/live-workspace.examples.json` (one example per message type).

### 6.2 Messages

| From → to | Type | Payload and behaviour |
|---|---|---|
| agent → web | `panel.show_problem` | `{item_id, label, statement, examples[2]}` (§6.3). Opens the panel and flashes its label. Every `item_id` and section id on the wire is the slot's kind and position (`core-1`, `reserve-2`), never the blueprint's slot id, which can carry a word such as `harder`. |
| agent → web | `panel.add_section` | `{item_id, section: {id, kind, title, body}}`, authored by the interviewer. |
| agent → web | `panel.highlight` | `{item_id, quote, occurrence?, note?}`. Anchored by quoted text; refused if not found. |
| agent → web | `panel.clear_highlight` | `{highlight_id}` |
| web → agent | `panel.section_added` | The candidate's own section. |
| web → agent | `panel.highlight_added` | The candidate's own highlight. |
| web → agent | `code.highlight_added` | `{start_line, end_line, text}`: lines the candidate highlighted in the editor. |
| web → agent | `ask.selection` | `{surface: statement / code / board, quote or element summary, item_id?, lines?}`. Pinned as "Asking about: …" above the transcript until the candidate's next question, which it accompanies. |
| web → agent | `code.snapshot` | `{version, language, text}`, sent 800 ms after typing stops and on a language change. |
| agent → web | `code.comment` | `{at: "top" or {line, expect}, text, purpose}`. Rendered in the current language's comment syntax. |
| agent → web | `code.insert` | `{at, text, purpose}`; at most 10 lines. |
| agent → web | `code.highlight` | `{start_line, end_line, expect, note?}`. Cleared when the candidate edits those lines or by `code.clear_highlight`. |
| web → agent | `board.summary` | `{version, text}`: shapes, labels and arrows (arrow ends resolved to labels), sent when the board settles. |
| web → agent | `board.backup` | The full scene, compressed, every 10 s while it changes (byte stream). Used for restore. |
| agent → web | `board.request_snapshot` | The browser answers with a PNG (longest side ≤ 1024 px) over a byte stream. |
| agent → web | `board.draw` | `{elements: [{type, id, label?, x?, y?, from?, to?}]}`. Converted with Excalidraw's element skeletons. The browser places the whole block in empty space inside the candidate's view (below the toolbar, clear of everything they drew, never over it); `x`/`y` are offsets within the interviewer's own block. If the view has no room it goes beside everything and the board scrolls to it. |
| web → agent | `proctor.event` | `{kind, weight, at, counts}` (§7). |
| web → agent | `workspace.hello` | Sent on every join, with what the browser already holds. |
| agent → web | `workspace.restore` | Panel cards and sections, the latest code, the board backup. Sent after `hello` when the browser is empty. |
| web → agent | `session.end_request` | The candidate pressed End and confirmed. |
| agent → web | `session.ending` | `{reason, message}`. Sent just before the room is deleted. |

### 6.3 Problem panel

- One card per problem asked, titled generically: **"Problem 1"**, "Problem 2". A card for a written question that
  needs to be on screen (for example an SQL schema) is titled "Question N".
- A card shows the **statement and the 2 examples** (input, expected output, the source's explanation). For DSA
  slots these come from the bank's `content.statement` and `content.examples`; `args` render as
  `name = value` lines.
- Constraints and the input/output format are **not shown** until the candidate asks; then the interviewer adds them
  as `constraints` / `format` sections.
- Sections (constraints, format, clarification, hint, explanation, note) are added by either side, show their author,
  and stay with that problem. Hints given aloud are added as `hint` sections too.
- Earlier problems stay reachable as tabs with their sections.
- Never shown: problem names, topics or tags, difficulty, hints not yet given.

### 6.4 Code edits

- Each instruction that targets a line carries `expect`, the line's text in the snapshot the agent saw. If that line
  changed, the browser searches ±5 lines for it; if it is gone, the instruction is refused (`ack ok=false
  reason=line_changed`) and the talker sees why on its next turn.
- Agent edits are separate undo steps (Ctrl+Z removes one cleanly), carry a glyph-margin marker, and can be deleted
  by the candidate.
- Languages: the existing list (python, javascript, typescript, java, cpp, go).

### 6.5 Reconnect

On every join the browser sends `workspace.hello`. If it holds nothing (a refresh), the agent sends
`workspace.restore` from its mirror: panel cards and sections, the latest code snapshot, and the latest board backup.

## 7. Proctoring

**Events and weights:**

| Event | Counter | Weight |
|---|---|---|
| Tab hidden | Tab changes | 1 |
| Focus moved to another window or app | Screen changes | 1 |
| Second display detected | Screen changes | 1 |
| Left full screen | Screen changes | 0.5 |
| Screen share stopped | Screen changes | 0.5 |

- Return events (tab visible, full screen restored) don't count.
- A second display that was already connected when the round began is not a violation (the checks warned about
  it); only one connected after the round began counts.
- The live summary's counts are the interviewer's own ledger, not the browser's counters (those restart on refresh).
- **One action counts once, at its heaviest weight:** events within 1.5 s merge. A tab switch fires tab-hidden,
  window blur and often a full-screen exit; it counts as one tab change.
- The header shows **Tab changes** as a count and **Screen changes** as a weighted total (e.g. `1.5`).

**Interviewer response:**
- **Every** violation is mentioned (at the candidate's next turn, or proactively within ~5 s of their return).
- **Full-weight violations** drive the end rule: the 1st is mentioned; the **2nd** gets a final warning; the
  **3rd** is mentioned and the round ends as `ended_by_interviewer`.
- **Half-weight violations** (full-screen exit, sharing stopped) are mentioned but never end the round.

**Screen share:** entire-screen sharing is required at the checks; a window or tab share fails the check
(`displaySurface` must be `monitor`). The share is kept active and checked but **not published to the room** in the
POC, since nothing consumes it.

**Esc:** in Chromium, Enter locks the Escape key (Keyboard Lock API), so Esc must be held to leave full screen and a
tap doesn't count as a violation.

## 8. API (`apps/api`)

### 8.1 Go-live gate and dispatch

- `LIVE_INTERVIEWER_ALLOWLIST`: comma-separated user IDs. Listed users can go live even while
  `LIVE_INTERVIEWER_AVAILABLE=false`; `InterviewSession.liveAvailable` becomes per-user.
- At go-live (`PREP_READY` → `LIVE_IN_PROGRESS`) the API **dispatches** the `interviewer` agent into the room with
  metadata `{session_id}` (LiveKit agent dispatch). The worker uses explicit dispatch only, so it never joins a room
  the API didn't open. This replaces the automatic dispatch the old comment in `integrations/livekit.ts` describes.
- On a resume (`GET`/`POST /sessions/:id/live` while live), if the room has no agent participant, the API
  dispatches again.

### 8.2 Internal endpoints (`INTERNAL_API_KEY`)

- `GET /internal/live/sessions/:id/context` → the round (company, role, level, round type and duration), the
  candidate's first name, and a minimal profile: skills, headline, project names. No contact details.
- `POST /internal/live/sessions/:id/end` with `{reason, live_summary}`: moves `LIVE_IN_PROGRESS` to `COMPLETED`, or
  to `ABORTED_TECHNICAL` for `technical`. Idempotent: a second call returns the stored result.
  `live_summary` = `{tab_changes, screen_changes_weighted, full_violations, conduct_incidents, ended_at,
  interviewer_note}`.

### 8.3 Candidate endpoint

- `POST /sessions/:id/live/end` (candidate auth): the browser's fallback when the interviewer doesn't answer an End
  request within 12 s. Records `candidate_ended` (see §5.6: the interviewer's report replaces it when it arrives).

### 8.4 Storage and contract

- Migration: `interview_session.end_reason` (text, nullable) and `interview_session.live_summary` (jsonb,
  nullable).
- The session response gains `endReason`, so the end screen can explain itself even if `session.ending` was missed.
- `packages/contracts/openapi.yaml` gains the fields and endpoints; the web types are regenerated.
- A sweep in the existing scheduler moves sessions still `LIVE_IN_PROGRESS` 30 minutes past their 1.5× ceiling to
  `ABORTED_TECHNICAL`.

## 9. Storage, evidence and trace (AI service MongoDB)

### 9.1 Collections

| Collection | One per | Holds |
|---|---|---|
| `live_runs` | session | Blueprint ID and version, the talker's stable prompt prefix (stored once), the final plan with every change and its reason, per-item facts (time used, hints given, final code, status), the proctor ledger (kind, weight, time, mentioned), conduct incidents, end reason, token usage and cost, the conductor checkpoint. |
| `live_turns` | turn | Speaker and text; for interviewer turns: the talker's variable prompt part, output, tool calls with the browser's acks, `condition → action → reason`, leak-guard blocks, the orders in force, and timings (end of candidate speech → first LLM token → first audio). |
| `live_briefs` | director run | Trigger, inputs (by reference), the brief, which parts were applied or dropped and why, latency. |
| `live_evidence` | item × evaluation signal | The director's observations with turn IDs, plus the conductor's facts (time used, hints, final code). **No scores.** |

Account deletion purges all four (the AI service's `/users/purge` gains them).

### 9.2 Evidence for Module 04

Recorded for each item: time used against the maximum, hints given, the final code snapshot, whether it ended by
`move_on`, the director's per-signal observations, and the transcript turn IDs. Recorded for the round: proctor and
conduct ledgers and the end reason.

**Requirements carried forward to Module 04 (decided here, implemented there):**
- An `ended_by_interviewer` round **counts as an attempt, with a heavy penalty**. The penalty's size is Module 04's
  decision.
- A question cut off by `move_on` is judged on how far the candidate got.

### 9.3 Replay (POC)

`python -m app.interviewer.trace <session_id>` prints the timeline: every turn with its decision, the brief and orders
in force, guard blocks, workspace acks and timings. An admin tab can follow the POC.

## 10. Room UI (`apps/web`, desktop ≥ 1024 px)

```
┌─ SALESCODE · SDE I · DSA ── ● LIVE ── TAB CHANGES 00 ── SCREEN CHANGES 0.5 ── 12:04 ─┐
│ ◉ Interviewer ▁▃▅▃▁      │ ┌ PROBLEM ── [Problem 1] [Problem 2] ── ⤢ ⛶ ──┐  │ [⌨]  │
│ ▢ you                    │ │ statement · 2 examples · added sections      │  │ Code │
│  ╭──────────╮            │ └──────────────────────────────────────────────┘  │      │
│  │interviewer│           │ ┌ CODE ── python ▾ ─────────────────────── ⛶ ─┐  │ [✎]  │
│  ╰──────────╯            │ │ Monaco                                       │  │Board │
│        ╭──────╮          │ │                                              │  │      │
│        │ you  │          │ └──────────────────────────────────────────────┘  │      │
│ [Asking about: "…"]      │                                                     │      │
├──────────────────────────────── [ 🎙 ]  [ End interview ] ─────────────────────────────┤
```

**Design language:** the platform's HUD layer (`@/components/hud`): mono uppercase card headers with leader lines,
corner ticks, `StatusDot` live only while the round runs, counters via `<Count>`, orange as the only accent and
reserved for interviewer marks. The existing rounded scale (cards 14px, dialogs 16px, shell 18px) and pill buttons;
light and dark themes; the room at 100% zoom (`HudZoomOff`, as today). Consistent with the rest of the signed-in app.

**Flow:** the session page's Start → pre-join → checks → **Enter** (full screen, Esc lock, connect) → live → end
screen.

**Checks:** mic, camera, entire-screen share (§7), external display (a warning, as today), desktop width. Phones and
narrow windows are stopped at pre-join.

**Header:** the round eyebrow (company · level · round type), the live status dot, the two counters and the elapsed
clock. No countdown.

**Left column (20%, min 260 px):**
- The interviewer's avatar and waveform (listening, thinking, speaking) and a small self-view.
- **Chat bubbles:** the interviewer's on the left (panel colour), the candidate's on the right (ink); interim
  words show live while someone speaks; proctor and conduct notices as centred mono chips.
- The "Asking about: …" pill above the bubbles while an Ask selection is pending.

**Right side (80%):**
- **Problem panel** on top: opens collapsed at 20% of the height, drag to resize; ⤢ fills the whole right side;
  ⛶ is its own full screen. One tab per problem, generic labels. A new problem opens the panel and flashes its
  label.
- **Work area** below: the Code editor or the Whiteboard. ⛶ fills the right side; the panel then shrinks to a
  one-line label strip that can pop it back.
- **Tool buttons** in a column on the right edge: Code, Whiteboard, with room for more tools. Both surfaces stay
  mounted, so nothing is lost when switching. A dot appears on Whiteboard when the interviewer draws while it's
  hidden.
- **Highlight and Ask:** selecting text in the statement or code shows a small toolbar, **Highlight** · **Ask**;
  selecting shapes on the whiteboard shows **Ask**.

**Proctoring UI:** on each event the counter rises and a toast appears: "Don't change screens while the interview is
running." Persistent bars while it lasts: "Return to full screen", "Share screen again". The round keeps running.

**Bottom row:** the mic toggle (with a level meter) and **End interview** (confirm dialog), **centred**. The camera
and full-screen toggles are removed (both are required).

**End screen** (leaves full screen), by reason:
- `completed`: the closing line, then "Your debrief will appear here" (the report is Module 04).
- `ended_by_interviewer`: the interviewer's stated reason and "This counts as an attempt."
- `candidate_ended`: a short confirmation.
- `technical`: "Connection lost" and a way back.

**Changes to existing code:**
- `features/interview-live/session/types.ts`: the `LiveSession` seam gains workspace send/receive, transcription
  and agent-state streams; `ControlSignal` is replaced by the §6 protocol.
- `machine.ts`: the `paused` state and `PAUSE`/`RESUME` events go; `ViolationOverlay` is deleted.
- `useProctor`: reports weighted, merged events (§7) instead of pausing; gains window-share and Esc-lock handling.
- `LiveView`, `WorkArea`, `CodeEditor`, `DiagramBoard`, `TranscriptPanel`, `BottomDrawer`, `ChecksView`, `EndedView`:
  reworked to the layout above.
- New: problem panel, workspace document logic (panel, code ops, board ops), tool rail, proctor bars and counters.

**Scripted mock session:** a `ScriptedLiveSession` implements the seam and plays a canned interview through the §6
protocol: shows problems, adds sections, highlights, comments, draws, reacts to proctor events and ends. The room
is built and tested against it before the worker exists.

## 11. Failures

| Failure | Handling |
|---|---|
| Talker call slow or failing | 4 s timeout; OpenRouter falls back to another provider. If that fails: a stalling line ("give me a second") and one retry. 3 consecutive failures → end with `technical`. |
| Director call failing | The talker keeps the last brief; logged. The conductor's orders still apply. |
| Deepgram STT/TTS failing | LiveKit's retries; persistent failure → `technical`. |
| Worker crash | After 10 s without the agent, the browser shows "Interviewer reconnecting…". The API re-dispatches on the browser's resume call; the new worker restores the conductor checkpoint and transcript and continues the current item, numbering new turns after every turn already stored. A worker dispatched into an interview that already finished (its end never reached the API) does not run it again: it repeats the saved ending to the page and the API and frees the room. |
| Instruction refused by the browser | The `ack` reason goes into the talker's next live state. |
| Candidate refresh | `workspace.hello` → `workspace.restore` (§6.5). |
| API end call failing | Retried 3×; the sweep (§8.4) is the backstop. The room is deleted regardless. |
| Blueprint missing or not current | The agent says it can't start, sends `session.ending(technical)` and ends. |

## 12. Product-IP drafts (human review before production)

- The talker's system prompt (persona rendering, fixed rules, tool guidance).
- The director's prompt and brief schema.
- Conduct wording: the warning and the early-end lines.
- Filler-question framing guidance.
- The `live-pol1` overrides (§5.7).

## 13. Build phases (one implementation plan each)

1. **Room and workspace UI** on the scripted mock session (§10), plus the protocol contract (§6.1). Needs no LLM, so
   it can start now.
2. **Interviewer worker:** voice pipeline, talker, director, conductor, leak guard, storage and the replay CLI.
   **First task: a latency spike**: measure time to first token and to first audio for the talker with the real
   prompt on OpenRouter (reasoning setting, provider routing, whether tool calls trigger a second round trip).
   Requires `OPENROUTER_API_KEY`.
3. **End-to-end wiring:** API allowlist, dispatch, internal and candidate endpoints, migration, contract, sweep;
   then a live run of the Salescode round.

## 14. Tests

- **Web:** the panel document, code operations (applied and refused, `expect` re-anchoring), highlight anchoring,
  proctor counting (weights, merging, thresholds); component tests on the mock session; the scripted interview as an
  integration test; protocol messages validated against the shared examples.
- **AI service:** the conductor (timers, orders, thresholds, plan-change validation, late briefs, checkpoint and
  restore), the leak guard, prompt-assembly snapshots, protocol models against the shared examples, and a
  **text-only simulator** that runs the brain on the Salescode blueprint against a scripted candidate (fakes in
  tests; OpenRouter for manual runs).
- **API:** the allowlist, dispatch and re-dispatch, the internal context and end endpoints (transitions,
  idempotency), the candidate end endpoint, the sweep.
- **End to end:** the human takes the Salescode round.

## Update 2026-10-09: after the first real round

The first human round ended after four minutes when the talker model stalled for over a minute (a provider slowed to ~10 s to first token) and three failed replies ended it as `technical`. What changed:

- **A slow model never means silence.** If the talker model has not produced a token after 3 s, a fallback model (`z-ai/glm-5.3-flash`, `INTERVIEWER_FALLBACK_MODEL`, reasoning `minimal` because it cannot be turned off) is raced against it; whichever speaks first wins. The director fails over to the same model. A turn gives up after 32 s.
- **Staged fillers** (`fillers.py`): while the wait grows the interviewer says a different short line per stage ("Give me a second." → "Just a little more." → "Sorry about the wait." → an apology), and opens the real answer with "There." after a short wait or "Sorry for the delay." after a long one. Wordings rotate so one line is never repeated back to back.
- **Failure policy:** a failed reply is asked for again after 4 s and answers the same candidate turn. The silence check-in is never queued while a reply is owed. The round ends as `technical` only after three failed replies *and* 90 s of failing.
- **`room.state` message** (agent → web, `{layout: talk | work, slow}`, replayed after every `workspace.hello`): the room is the conversation full width until the interviewer moves onto a coding, low-level design or system design problem (`layout_for` in `plan.py`: culture and behavioural questions stay `talk`), then morphs to the 20 / 80 workspace, and widens again for the candidate's questions and the closing. `slow: true` shows a calm "taking a moment" line.
- **Voice (changed 2026-10-10):** Deepgram Aura-2 (`aura-2-orpheus-en` male, `aura-2-athena-en` female; `INTERVIEWER_TTS_VOICE` / `INTERVIEWER_FEMALE_TTS_VOICE`). The first live round used the Indian-accented Flux voices (`flux-naveen-en`, `flux-priya-en`, `flux-meena-en`) and sounded south Indian; Deepgram has no voice tagged north Indian and Aura-2 has no Indian accent at all (American, British, Australian, Filipino), so this trades the accent for a clear, fluent English voice. A woman interviewer gets the female voice and a man the male one: the persona has no gender field, so `voices.persona_gender` reads its `gender` if present, otherwise judges from the name in the fixed interviewer pool. Needs `livekit-plugins-deepgram` 1.8.5. Candidate speech and the interviewer's text are kept out of Deepgram's model-improvement programme (`DEEPGRAM_MIP_OPT_OUT`). Speech recognition is `nova-3` with `en-IN`; a turn ends after 1.0 s of silence (LiveKit's 0.5 s cut candidates off mid-thought).
- **Prompts (drafts):** vary acknowledgements and don't re-ask; speak like an engineer in an Indian tech company; the director judges over several answers, not one thin one; a time-up order first acknowledges what the candidate just said.


## Update 2026-10-09 (later): 30-minute rounds and conversation structure

- **Every mock interview is 45 minutes** (`MOCK_ROUND_MINUTES`; it was 30 for a few hours): the API, web and AI service all use the one length; researched real-round lengths are display-only.
- **The conductor owns the structure:** `deep_dive` is a plan item; at least 5 exchanges happen before the problem; `next_item` is guarded (`can_advance`); `problem_allowed()` decides when problem tools are offered and when a problem may be announced; `open_item` orders make sure each new part is opened with a question or the problem; the `closing` order ends the round after the wrap-up; a reserve problem is added when a quick solve leaves slack (`plan_extra_problem`).
- **Run-level safety nets:** an empty reply to a conversational answer is retried; a turn whose whole text was blocked is regenerated with the reason; a declared move-on without `next_item` still moves the plan; non-urgent orders wait for 12 s of interviewer silence.
- A text-to-text rehearsal harness (`apps/ai-service/scripts/interviewer_text_session.py`) and its findings are in `docs/superpowers/test-runs/2026-10-09-live-text-rehearsal/`.


## Update 2026-10-09 (evening): 45 minutes, two problems, the second only if the first went well

- Every DSA blueprint has two core problems (plus reserves); the arc at 45 minutes is 1 + 2 + 1 + 2 opening, about 11 minutes per problem and a 12-minute projects-and-fundamentals deep dive, 4 minutes of questions, 1 of wrap-up.
- The conductor decides the second problem when the first ends (`will_skip_next_problem`): skipped if the candidate struggled (the director's `problem_signal` of `struggling`, two ladder hints, or the problem's time ran out without a `strong` signal) or if fewer than 8 minutes of the round are left for it. A skipped problem sets `no_more_problems`, so no extra reserve problem is added either, and the round goes on to the deep dive, the questions and the closing. A strong candidate gets the second problem, sized to the time that is left.
- The talker's state says "you will NOT give another problem, wrap the coding up kindly" or "another problem follows"; the framing says one or two problems depending on how the first goes.


## Update 2026-10-11 (afternoon): conversation flow, silence, requests and the screen following the voice

Found in a real round on 2026-10-11 (stored turns in `live_turns`); five changes, all in `apps/ai-service/app/interviewer/`:

- **Order and links.** The round is told in this order: greeting → small talk (light, no work talk) → how the round runs → a connecting phrase → their introduction and projects → a connecting phrase → the coding problem. The rapport hooks ("I saw you built Relay") moved from the small talk to the introduction part, as a remark after they have introduced themselves. Every `open_item` order and the time-up `move_on` orders now carry a connecting phrase (`BRIDGES` in `plan.py`), and the talker rules say to link every change of topic, link first, then the new question.
- **One line to put a problem up.** "Here's your first question. Give it a read, and let me know if you have any questions." (`PROBLEM_INTRO`; "second question" for the second). No "think aloud", no "ask me anything that isn't clear". `said.py` never counts it as a repeat. The fallback line when everything the talker said was held back is that same line right after a problem goes up, and "Could you say a bit more about that?" otherwise (it was "What do you think?", which asked about nothing). `show_problem` no longer refuses a label that is not another problem: the real round's first problem never went up because the talker passed the problem's own name as `item_id`.
- **The screen follows the voice.** Tools run as soon as the talker's text is generated, before the voice has said it, so the problem and the layout used to morph first. `WorkspaceBridge.hold()/release()` keep `room.state` and `panel.*` back during a reply; the run releases them when the agent stops speaking, at once when the reply said nothing, or after `SCREEN_HOLD_MAX_S` (25 s). The mirror (what the interviewer believes is on screen) updates immediately. The morph lands as the interviewer finishes the turn, so the talker is told to say the problem line last.
- **Not every turn is answered.** `closing.is_acknowledgement` / `needs_no_reply`: a bare "okay", "got it", "thanks", "let me read it" after something that was not a question gets no reply (`InterviewRun.skip_reply`, raised as `StopResponse` by the agent) unless an order is waiting or they are asking about something on screen; the empty-reply retry no longer pushes an answer for them. The talker may also choose `<silent>` for them.
- **Requests the interviewer must not grant.** `asks_interviewer_to_edit` ("can you add a comment in the editor?") → a `decline_request` order: one sentence, no offer, no question, no "go write the code" again. `asks_to_change_problem` → `Conductor.on_change_request`: a swap to the reserve only for a candidate who has barely started (≤ 1 turn, no hint, ≤ `SWAP_ON_REQUEST_S` = 120 s); otherwise the first ask is declined ("a partial solution is perfectly fine, let's see how far we get", `keep_problem` order); asking again ends the problem kindly, marks it `struggling` (so no second problem), and the `move_on` order has the talker link to the next part and open it. The counts are in the checkpoint (`change_requests`).
- Product choices to confirm: the swap window (120 s, no hints) and the end-of-turn morph (not mid-sentence: LiveKit gives no word timing for the Deepgram voice).
