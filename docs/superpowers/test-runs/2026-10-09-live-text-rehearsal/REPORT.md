# Live interviewer: text-to-text rehearsal, 2026-10-09

What was tested: the real `InterviewRun` (conductor, talker, director, workspace protocol, real OpenRouter models, fallback armed) on a freshly prepared **30-minute** Salescode SDE I DSA blueprint, with Claude playing the candidate turn by turn. No LiveKit and no Deepgram, so only OpenRouter credits were spent. Harness: `apps/ai-service/scripts/interviewer_text_session.py` (virtual clock; candidate speech ≈ 2.6 words/s; interviewer reply = model latency + words / 2.7 s; `#wait N` is N seconds of silence so nudges and time limits fire). Booking was done through the real UI ("Start now"); prep took about 17 s. The 30-minute blueprint was produced from the same inputs by the admin bench endpoint with the round duration set to 30 (run `bpr_b845b7fc30494007a278`), because the Salescode brief says 60.

Two runs, both on the same blueprint:

| Run | Candidate | Ended | Why |
|---|---|---|---|
| 1 | strong, says "ready" early, solves fast, one planted bug | **07:48** of 30 | interviewer walked the plan to the end looking for a second problem that does not exist |
| 2 | nervous, misreads the problem, goes silent, tab switch, asks for the answer and more time | **13:16** of 30 | 10 minutes of the plan are not modelled, then the interviewer kept talking after saying goodbye |

Neither run reached 30 minutes. That is the first and biggest finding.

Raw material in this folder: `run*-session.log` (readable transcript with tools, orders, layout, timings), `run*-turns.jsonl` (structured), `run*-observer-notes.md` (my notes as it happened, with timestamps).

---

## What worked (keep)

- **Latency:** first token median 1.35 s (run 1) and 1.09 s (run 2), p90 under 2 s, max 2.8 s. The fallback model was never needed and no filler fired, because the provider was healthy. No errors, no guard blocks.
- **Socratic guidance:** it caught my single-transaction misread without giving the answer (run 2, 02:55), gave a concrete example when I was stuck (03:26), and asked "on the very first iteration what is prices[i-1]?" to expose my wrap-around bug (04:49). This is what a good interviewer does.
- **Real probing on the resume:** "why a WebSocket rather than polling?", "how does the phone learn a command failed?" (run 1).
- **Policies held:** declined extra time politely and consistently, did not give a score when asked "how did I do?", stayed silent while I was thinking aloud (an empty reply, correctly), mentioned the tab switch within 14 s and moved on, coding-silence nudge fired at about 126 s with a sensible line.
- **Activity digests** arrived every turn (pointer, typed lines, selections) and were used naturally.
- **Layout:** `talk` during greeting, small talk, framing and Q&A; `work` when the problem item became active. (Details of what went wrong below.)

## Findings, worst first

### P0: the round does not last the planned time and can end without delivering

**1. The plan walks off the end (run 1, 06:52 to 07:48).** The director swapped `core-1` for `reserve-harder` (never shown) while the talker was still discussing Relay. The talker then said "let's move on to a new problem" and called `next_item`, which ended the unshown reserve and landed on `candidate_questions`. `show_problem` was refused there, but the talker kept saying "let me put it on your screen" (06:52, 07:07, 07:31), and finally called `next_item` again twice, ending in `wrap_up` and "completed" at 7:48 after "One moment, fetching it."
- Cause: `next_item` has no guard (`tools.py` `_next_item`: always advances, ends the interview when items run out). The talker rule "show_problem and reveal only work on a problem item, so call next_item until you are on one" makes it walk the plan looking for a problem. The 30-minute plan has exactly one problem slot.
- Fix: refuse `next_item` into `candidate_questions` / `wrap_up` unless the item's time is up, the candidate asked to stop, or the current item is actually finished, and tell the talker "no problems remain, don't promise one" in the state block. Delete the "call next_item until you are on one" rule. Let the director's `use_reserve` apply only when the current item has not started its conversation (or hold it until the next item boundary).

**2. Ten minutes of the 30-minute plan are not a plan item (run 2, 09:31).** The blueprint's `core` phase is 19 minutes = one 9-minute problem + `deep_dive_mins: 10` (the resume probes: the micro-frontend project, Relay's SQLite + Claude API). The deep dive is not an item, so after the problem the conductor goes to `candidate_questions` (4 min) and `wrap_up` (1 min). Run 2 would have ended at about 15 minutes, with the resume probes never asked.
- Fix: model the deep dive as its own item(s) between the problem and Q&A (phase `deep_dive`, the blueprint's resume probes and round questions, timeboxed by `deep_dive_mins`), layout `talk`. Alternatively let the blueprint builder put two problems in a 30-minute DSA round. Add a conductor check at blueprint load: the sum of item timeboxes must cover the round duration.

**3. After the goodbye the round does not end and the nudges turn incoherent (run 2, 10:49 to 13:16).** The talker said "Take care" with the item still `candidate_questions`. The 20-second silence nudge then produced a second goodbye (11:13), a question dragging the conversation back to the coding problem (11:44, 12:16: "what does your loop compute on one, two, three?"), "seems you've stepped away" (12:45) and a fourth goodbye (13:16). Five interviewer turns after the farewell.
- Cause: the talker never called `next_item` to `wrap_up` / end; the conductor's nudge does not know a closing was spoken.
- Fix: when the candidate has no more questions, the talker must move to `wrap_up` and deliver the closing in that turn; after the `wrap_up` line is spoken, end the round (the conductor already ends after `wrap_up`; it just never got there). Suppress silence nudges in `candidate_questions` once the candidate said they are done, and always in `wrap_up`.

**4. Announce-without-doing, and refused tools the talker never hears about (every run).** Examples: run 1 00:37 "let me frame things" (turn ends, framing comes only after "ok"); run 1 01:03 "let me put it on your screen" with only `next_item` called, the candidate waited 10 s of dead air; run 1 03:27 "let me give it a look on screen" with `look_at_board` (the whiteboard tool, for code that was already in its prompt); run 2 01:18 "it's on your screen now" while `show_problem` was refused because the conductor item was still `framing` (the problem never appeared; I only got the spoken paraphrase; the room switched to `work` with an empty problem panel until I said so at 02:10).
- Cause: `show_problem` is validated against the conductor's current item, which lags the talker's intent (`next_item` and `show_problem` in different turns, or the director's move landing later). Tool errors are not fed back to the talker (only workspace-ack refusals are, via `refused`).
- Fix: (a) after `next_item` onto a phase item, run a short follow-up generation in the same turn (like the `look_at_board` follow-up) so the new item is delivered, not announced; (b) report every refused tool call back to the talker next turn ("show_problem refused: not a problem item") and add a rule "never say something is on screen unless the tool succeeded"; (c) make `show_problem` self-heal when the next slot is pending and the current item is a finished phase; (d) tell the talker that code is already in its prompt and `look_at_board` is only for the whiteboard.

### P1: not like a real interview

**5. The background / resume section is skipped or one question long.** Run 1: skipped entirely (the candidate said "ready", the talker obeyed "if the candidate has moved ahead call next_item now"; item went intro to problem in 8 s). Run 2: one question ("60-second walkthrough"), no follow-up on the internship or Relay, then "let's get into the problem" after 42 s. You wanted several resume/profile questions in the full-screen chat before coding.
- Fix: a minimum number of candidate exchanges per phase before `next_item` is allowed (e.g. intro needs at least 3 unless time is up), and tell the talker to use the blueprint's resume probes one at a time with a follow-up each. Time budget the intro by the plan (2 minutes is too short for this; 5 to 6 minutes of "talk" layout would match your intent).

**6. Layout is item-driven, so a resume discussion inside the problem item keeps the `work` layout (run 1, 04:53 to 06:52), and the layout collapses to `talk` while the interviewer is still promising a problem (07:07).** Fixing finding 2 (deep-dive items) fixes the first; fixing finding 1/4 fixes the second. For ad-hoc cases a `screen` field in `log_turn` (talk/work) is an option, but item-driven is better if the plan models the deep dive.

**7. The problem is paraphrased aloud, in the original wording (run 2, 01:18).** "Given a list of daily stock prices, return the maximum profit if you can buy and sell any number of times." The rule says never read the statement aloud, the screen says "Chef's spice shop", and "stock prices" gives away the problem's identity. The leak guard did not catch it.
- Fix: strengthen the rule ("when you show a problem say only that it is on their screen"); extend the guard with the original problem's key nouns (the blueprint knows the source title and the reworded statement).

**8. Back-to-back interviewer turns from conductor orders (run 2, 01:24 and 08:50).** 6 s after "Ask me anything you need first" a `move_on` order (the intro's time was up) produced "Take your time... any questions before you start?". 16 s after a hint, a `converge` order produced "we're about at time, give me your final approach", before the candidate could use the hint.
- Fix: do not honour non-urgent orders (`converge`, `move_on`, `nudge`) within about 10 s of the interviewer's last speech or while the candidate is mid-thought; fold them into the next natural turn.

**9. Inaccurate or unearned praise, three times.** Run 1 04:20 "you caught it yourself before I even pointed it out" (it had not noticed); run 1 04:53 "with the edge cases handled" (we never discussed them); run 2 10:36 "you self-corrected on the wrap-around without me pointing at it" (it had asked "what is prices[i-1] on the first iteration?"). For a debrief-quality product this is a trust problem.
- Fix: prompt rule "praise only what the transcript or code shows, and never say they did something unaided if you hinted"; record hints given (including improvised ones) in the state block.

**10. Hints are improvised and too large; the ladder is bypassed.** Run 2 08:34: asked for a hint on the k-transactions follow-up, it gave the whole DP formulation in one go. No `give_hint` call was made all session, so nothing appeared on screen and `hint_step` stayed 0.
- Fix: follow-ups should carry their own small hint ladder in the blueprint, or the talker must use `give_hint`; add "one small step at a time".

**11. It accepts the key insight instantly and moves on (both runs).** "That's exactly the insight... go ahead and write it up", "Looks good" on buggy code (it only noticed after my wrong answer to its probe), 3.5 of 9 minutes used in run 1. A real SDE-1 screen asks "why is that correct?", edge cases (empty, single day), maybe a quick test.
- Fix: use the blueprint's `probes` and `follow_ups` on every problem; the first review of the code should look at the code block in its prompt.

**12. Small talk repeats itself and skips (run 1 00:21: "how's your day been otherwise?" right after I answered "doing well"; run 2: one exchange).** Minor but audible in voice.

### P2: traceability and grounding

**13. `log_turn` (the decision trace) was called on 1 of 19 turns (run 1) and 2 of 29 (run 2).** The prompt says "End every turn with log_turn". The model (DeepSeek flash, reasoning off) mostly skips the optional tool. The stored decision trail, which scoring and "why is my score this?" depend on, is nearly empty.
- Fix: do not rely on the talker: have the director write the per-turn decision from the transcript, or force a tool-only second call after the text, or accept the gap and make the director's evidence the record.

**14. Digest deictic over-matching, four times.** "those differences", "that minimum", "those. That", "those are" were bound to the problem quote the pointer was resting on, but referred to the candidate's own words. The digest line says `says "those are" at +11.5s -> "buy-sell transactions..."`, which can mislead the talker.
- Fix: bind "that/those + noun" only when the pointer or caret moved within about 1.5 s before the word; keep this/here/line N as they are.

**15. Possibly invented company facts.** "Feedback on work-life balance here has generally been positive" (run 2, 09:52). Check against `persona.grounded_in`; the earlier persona was grounded in "high workload".

## How to make the interview feel closer to a real one

A real 30-minute DSA screen at this level runs roughly:
- 0 to 2 min: greeting, one small-talk exchange.
- 2 to 6 min: background and one or two resume probes with follow-ups (full-screen conversation).
- 6 to 22 min: one problem: clarify, approach, code, test and trace, complexity, one follow-up. Small hints, no praise beyond the evidence.
- 22 to 27 min: a short resume or fundamentals deep dive (conversation layout again).
- 27 to 29 min: the candidate's questions.
- 29 to 30 min: a closing that ends the round.

Today the system did roughly 0 to 1 min greeting, 0 to 1 min background, then the problem, then jumped to Q&A and ended around minute 8 to 13. The plan items and their minimums (findings 1, 2, 3, 5) are the main lever; the prompt fixes (4, 7, 9, 10, 11) are the second.

## What this rehearsal did not cover

- **Voice:** STT accuracy for an Indian accent, barge-in and interruption, TTS pacing, and the new Indian voice were not exercised.
- **Network / LiveKit connection:** not exercised, which a voice round would show.
- **Staged fillers and the fallback model:** never triggered (the provider was healthy); they are unit-tested only.
- **Browser behaviour:** the layout morph, the real code and whiteboard capture, and the problem panel were simulated through protocol messages and `#at` activity events, not clicked. The layout morph was confirmed separately in the mock room earlier.
- **Candidate realism:** I played a plausible SDE-1; answers about Relay and the internship are invented role-play, not facts about the account holder.

## Suggested order of work

1. P0 fixes (findings 1 to 4), test-first, then rerun this exact rehearsal until it reaches the end of the plan.
2. Findings 5 to 8 (intro depth, deep-dive item, statement leak, order spacing), then rerun.
3. Findings 9 to 11 (truthful praise, hint ladder, probing), then 13 to 15.
4. A real voice round.


---

# Update: fixes made and re-tested (same day)

Decision from the product owner: **every mock interview is 30 minutes, throughout the platform.** Done as one constant (`MOCK_ROUND_MINUTES = 30`) in the API (`domain/liveRound.ts`), the web (`lib/constants/interview`) and the AI service (`blueprint/context.py`). The researched real-round lengths (admin research editor, JD detail pages) are untouched because they describe real company rounds. Details at the end.

## Fixes (each written test-first; AI-service suite 1341 passing, API 954, web 1030)

| Finding | What changed |
|---|---|
| 1 Plan walks off the end | `next_item` is refused (and the talker told why) while a background part still needs exchanges, and for a problem that was never shown; the prompt rule "call next_item until you are on a problem" is gone; the state says "No coding problem is left" or "Another problem follows" |
| 2 Deep dive unmodelled | `deep_dive` is now a plan item (talk layout) from the blueprint's `deep_dive_mins`, with the resume probes as its opening |
| 3 Round doesn't end after the goodbye | a farewell in the questions phase, the wrap-up, or once the problems are done closes the round; the wrap-up issues a `closing` order and the closing turn ends the interview; nudges are off in the wrap-up |
| 4 Announce without doing, refused tools unheard | tool refusals are fed back next turn; `show_problem` moves a finished phase on by itself; `show_problem` and the workspace tools are only offered when a problem may be shown; announcing the problem (or saying it is on screen) is blocked in the spoken text until then, and the turn is regenerated with the reason instead of speaking a filler; the conductor issues an `open_item` order after every move so a bare transition is followed by the real opening within seconds |
| 5 Background section skipped | 5 real exchanges are required across greeting, small talk, framing and intro before the problem (the time limit still wins); the intro is told to use the resume probes one at a time |
| 6 Layout vs conversation | the deep dive and Q&A are `talk`; the plan follows the conversation when the talker moves to the projects or invites questions without calling `next_item` |
| 7 Problem paraphrased aloud | the leak guard also blocks a distinctive word of the original problem name that neither the screen nor the candidate used ("stock"); the talker is told to say only that it is on the screen |
| 8 Back-to-back turns from orders | non-urgent orders wait until the interviewer has been quiet for 12 s |
| 9 Unearned praise | prompt: praise only what the transcript or code shows; no "on your own" after a hint; no verdict; no false time claims |
| 10, 11 Hints and probing | prompt: one small step at a time; ask why, trace one input, test the code before praising |
| 12 Small talk repeats | tightened wording; framing is now delivered in one turn |
| 13 `log_turn` almost never called | not fixed (the decision trace is still sparse); the director's evidence remains the record |
| 14 Digest "that/those" | a deictic word over a pointer that had rested on its target for more than 6 s is marked "(the pointer had rested there)" |
| 15 Invented company facts, stiff reply | prompt: answer as a working engineer, say so briefly when unknown, never invent specifics |
| New: dead air after a spoken answer | an empty reply to a conversational answer is retried once; `<silent>` is for coding only |
| New: 17 unused minutes after a fast solve | a reserve problem is added when there is slack (the harder one only with 12+ minutes of slack), shown by the same rules |
| New: provider slowness | live in run 14: the fallback model won a real race (4.4 s first token), "Give me a second. There." was spoken and the page showed the slow state |

## Results of the later rehearsals

- **Run 3** (after the first fixes): reached 12:32. Intro had 3 real exchanges; problem delivered in one turn without paraphrase; the interviewer read my code and caught the off-by-one by asking about the last day; a 10-minute deep dive in the talk layout; found two empty replies and the farewell that did not end the round (both fixed after).
- **Runs 4 to 13**: stopped early, each to test one fix and find the next gap (early "ready" → announcement, labels lagging the conversation, a hard reserve problem in a 30-minute round, a loose "your questions" detector). All fixed with tests.
- **Run 14** (almost final code): the round ended properly at 9:20 with a single closing and "completed". Real fallback race observed. Remaining (found after, fixed): after a 2-minute solve it went to the projects instead of a second problem; a loose detector moved to the questions mid-fundamentals.
- **Not re-run end to end after the very last fixes** (a bare announcement with no question now triggers a follow-up order; another problem is announced as "next" when there is slack; the invitation detector is limited to the closing sentence). A full 30-minute pass on the final code, and a voice round, are still to do.

## The 30-minute change, where

- **AI service:** `blueprint/context.py` (`MOCK_ROUND_MINUTES`, every round type defaults to 30). The arc already sums to the duration and now allots a single 9-minute problem plus a 10-minute deep dive plus a reserve problem when there is slack.
- **API:** `resolveRound` always sends 30; the live-session sweep and the live context fall back to 30; the official process graph and the default custom round are 30; `parseProcessGraph` rewrites every round node to 30, so saved or edited processes cannot hold another length.
- **Web:** loop and process screens show 30 whatever an old saved graph holds; the editable "Minutes" box is a read-only "Length: 30 min, every mock interview"; palette presets are 30; the marketing sample rounds read 30.
- **Not migrated:** old saved loops and processes in the database still store 45/60/90 until their next save; they are shown and used as 30. A session booked earlier keeps its old briefing until it is re-prepared (the reconcile job re-prepares it when its input changes, up to 30 minutes before its slot): the booked 60-minute Salescode round from today should be cancelled and booked again.

---

# Final pass: a full round as the candidate (30-minute blueprint, no stated length)

A fresh blueprint was prepared with the round length left out of the request: the AI service default gave a 30-minute plan (1 + 2 + 1 + 2 minute opening parts, one 9-minute problem plus a 10-minute deep dive inside the 19-minute core, 4 minutes of questions, 1 minute wrap-up, one reserve problem). Four attempts, each stopped when it found something real; the fourth ran to the end.

## Found by playing the candidate, and fixed (test-first)

| Found | Fix |
|---|---|
| While I typed, the talker said nothing but logged `acknowledge_move_on`; the move-on safety net moved the plan to the extra problem, silently abandoning mine | the safety net needs spoken words that actually leave the part; silence is only allowed while the candidate is typing |
| The director swapped my half-solved problem for a HARD reserve mid-question | the director cannot swap out a problem the candidate has worked on; it also cannot skip the deep dive |
| `next_item` accepted while the interviewer was still asking about the problem | refused unless the spoken words leave the problem |
| The invitation to ask questions came at minute 7, skipping the second problem and the deep dive | inviting questions is blocked (and regenerated with the reason) until the plan reaches that part |
| "Let me look at your code" + the whiteboard tool, twice | the whiteboard tool is only offered when the board has content |
| Stray `>` in spoken text; internal word "slot" spoken | stripped from speech; the rules forbid plan vocabulary |
| Framing sentence ("...one coding problem, then your questions") blocked as an announcement | describing the round's outline is exempt |
| "I'm putting it on your screen" while the plan lagged and the problem was refused | `show_problem` runs the plan through leftover background parts when a problem is allowed |
| `reveal` gave constraints but said nothing after a direct question | silence is no longer allowed after a spoken question or answer, on a problem too |

## Attempt 4 (complete): 21:15 of 30, closed properly

- Greeting, small talk and intro in the talk layout (6 exchanges); problem 1 (Course Schedule II) delivered in one turn when the intro box ran out; a wrong first idea (sort by prerequisite counts) tested with a counterexample, then a small-step hint (nodes and edges, "which session is safe first?"); a bug found by tracing a 2-session case; a missing cycle guard found by tracing; precise complexity probes; `next_item` refused mid-question and the plan stayed put.
- Problem 2 (drones, a stack problem) added with the slack; traced three cases; deep dive on the portal (6 resume-led questions, talk layout), then the candidate's questions answered like an engineer, then one closing with the plan ending the session as "completed".
- The round ended at 21 minutes because the candidate cleared everything; it is the early-but-proper close.

## Still open (as of the 30-minute pass; see the 45-minute pass below for the current list)

- Why the second problem was added at 10:37 when the slack computed as 263 s (< 360) is unexplained; the total still came to about 30 minutes in the plan.
- `log_turn` is still rarely called.
- The first candidate turn after a problem appears sometimes gets boilerplate ("the statement covers that").
- No voice round yet (accent, interruptions, TTS pacing, connection issues).


---

# 45-minute round with two DSA problems (decided later the same day)

Decision: every mock round is 45 minutes, and a DSA blueprint always carries two coding problems. Two is the standard interview; the second is only given when the first went well, and a candidate who struggled on the first can end the round early with a proper closing.

## What was built

- `MOCK_ROUND_MINUTES = 45` (AI service blueprint context, API `liveRound`/`resolveRound`/sweep/process graph, web constants and screens). Selection returns two core problems for every non-OA DSA round (`coding_cores`).
- The conductor reads how the first problem went (director `problem_signal`, hint count, time left) and either plans the second problem or skips it (`will_skip_next_problem`, `MIN_SECOND_PROBLEM_S=480`, `STRUGGLED_HINT_STEPS=2`). The reserve problem now only ever tops the round up to two problems, never to three. The outline the interviewer gives says "a second one if that goes well".

## Verified by playing the candidate (text-to-text, real models)

| Path | Result |
|---|---|
| Struggling candidate | stuck on problem 1 with two hints, round closed early with one goodbye, ended `completed` at 18:57 virtual |
| Strong candidate (`b45-strong-complete-session.log`) | problem 1 solved in about 5 minutes, problem 2 given and shown, solved, then the project deep dive, the candidate's questions, one closing, ended `completed` at 10:39 virtual. No third problem |
| Strong candidate, final code (`b45-strong-final-check-session.log`) | problem 2 shown in the same turn as the move, and the interviewer asked the candidate to trace an input instead of working it out itself |

The strong rounds end early because the virtual candidate types and speaks quickly; that is the intended early-but-proper close.

## Found in the last runs, and fixed (test-first)

| Found | Fix |
|---|---|
| The interviewer told the candidate "have a read and tell me how you'd approach it" while the problem was not on screen (its announcement had been blocked, leaving the instruction) | read-the-problem instructions are held back by the same guard as "on your screen" while no problem may be shown |
| "You have a new problem on your screen now" said with no `show_problem` call: the order to open the part counted as satisfied and the candidate saw only problem 1 | when the interviewer announces the problem and it is not on screen, the run shows it (the words were already spoken) |
| After a blocked announcement the next proactive turns were bare stubs ("Got it, thanks for that.") and kept trying to announce the problem | the follow-up order now says the problem is not next yet and not to mention it |
| The interviewer worked the candidate's test case out itself, and got the arithmetic wrong (said 8, 9, 10 fit in one day at capacity 15) | prompt rule: give the candidate an input and have them trace it aloud; never trace or compute for them |

## Still open

- `log_turn` is rarely called, so the decision field is often empty in the stored turns.
- The first candidate turn after a problem appears sometimes gets boilerplate.
- The interviewer pushes for the coding part early in the intro (it keeps trying to announce the problem; the guards hold it back, but the candidate hears a few short, question-less turns).
- Two invitations to ask questions in a row (a proactive turn 11 s after the first) in the candidate's questions part.
- No voice round yet (accent, interruptions, TTS pacing, connection issues). The text harness cannot show those.
- The booked 60-minute Salescode round (session 23ee95b6) should be cancelled and booked again; saved loops in the database still store old lengths until their next save (shown and used as 45).


---

# First real voice round (2026-10-09 evening, candidate: the product owner) and the fixes

Ended by the interviewer at 4:02 after the third tab switch (the designed rule; the switches came about 10 s apart). What it showed:

| Found | Fix |
|---|---|
| Read the whole problem statement aloud and asked the candidate to "say the problem back" (the scoring criterion "restates the problem" leaked into the talker's questions) | `statement_read_aloud` guard (two runs of four copied words in a sentence of eight or more); talker rule: never read the statement, never ask for it back |
| A woman interviewer (Pooja Shetty) spoke with the male voice: the persona has no gender | `voices.persona_gender` judges from the persona's `gender` or the pool name; female voice for women |
| Sounded south Indian | Deepgram has no north-Indian voice; switched to Aura-2 (`aura-2-orpheus-en`, `aura-2-athena-en`), fluent English without an Indian accent |
| Replied mid-sentence ("...and most of the"), then to the tail ("of") | turn ends after 1.0 s of silence (was 0.5 s); speech recognition `en-IN` |
| Three interviewer turns in a row with nothing from the candidate (a stub, the outline, a question) | the follow-up order after a held-back problem announcement says the problem is not next (earlier fix); not yet re-checked live |

First-token latency was 0.55 to 0.9 s on every turn; no filler or fallback was needed. Audio quality and turn-taking by ear were not measured.

---

# A human-style round, text to text (2026-10-10): Accenture fresher DSA, interviewer Nandini Rao

Played as a nervous JIIT Noida fresher (Dunzo Android intern): clarifying questions, a slow first idea, a bug found while tracing, a wrong data structure, a complexity corrected after a hint, an admitted gap (money rounding), a candidate who corrects the interviewer. Notes written as the round ran: `human-round-observer-notes.md`; logs: `human-round-session.log` (the complete round, 23:35 of 45 because the answers were quick), two earlier attempts that were stopped when they found real bugs, and `human-round-opening-recheck-session.log` (the opening re-run on the final code). Text only: nothing here says how it sounds.

## Worked like a real interview

- Silence while I thought for 40 s was left alone; no filler, no nudge.
- Saw my `list` used as a `set` and asked about the membership cost instead of telling me; asked me to dry-run a bug-producing input.
- Quoted my own words back ("O of S, total characters") and gave a one-step hint (the prefix only shrinks) instead of the answer.
- Picked up the gap I admitted (rounding a split of 100 by 3) and probed it; for the salary band she said she did not know and pointed to HR.

## Found and fixed during the round (each test-first; AI-service suite 1390 passing)

| Found | Fix |
|---|---|
| The interviewer said "a fresh problem" and then nothing (no `next_item`, no `show_problem`, no nudge) for 53 s; asked, she said "it's on your screen" and still nothing | a promise of a fresh, new, another, next or second problem moves the plan (the open order puts it up), also when the candidate asked and was told "it's on your screen" |
| She spoke the problem statement (three times, before it was allowed) because the problem details told the talker "Open with: <the prepared opening>", which is the problem text | the opening is no longer given to the talker; speech copying any problem's statement or opening is blocked (screen text may still quote it) |
| Her follow-up ("...rather than just true or false...") was blocked as an example leak because the example result is `true`, leaving dead air | true, false, null, none never count as example literals |
| A turn cut down to a remark with no question (a blocked sentence) left me waiting; or a dangling "Talk me through how you'd approach it" | the turn is asked again, with the reason, when nothing that asks is left or a screen claim was blocked and no question remains |
| "Let's get started with the technical part" in the middle of the introduction, then four turns in 47 s (stub, the outline again, a blocked claim, a question) | announcing the coding part now is held back while no problem may be shown; the outline is tracked and not ordered twice |
| "Take a moment to read it, and ask if anything is unclear" said to someone halfway through a solution, three times | the invitation belongs to the turn that shows the problem only |
| She thought SQL questions appear on screen ("On your screen there's a query to write...") | the state says nothing is on their screen in the conversation parts; ask everything aloud |
| Garbled turns: "it returns false, no wait, strats... sorry, ..." | sentences that break off and correct themselves are dropped |
| `DENSE_RANK` spoken as "DENSERANK" (underscores stripped) | underscores inside identifiers become spaces |
| Asked how I did, she gave a verdict that was partly false | rule: point to the report, no verdict, strengths or weaknesses |
| The room layout line printed a turn late | harness only: now reported after the turn settles |

## Still open (not fixed)

- **Talker coherence is the biggest realism risk besides voice:** three garbled turns in the first 11 minutes (a made-up "the two cases you flagged as tricky", problem 1's "negative numbers" answered on a strings problem, a wrong Kotlin fact: "a synchronous mode for single-threaded cases" is `NONE`), and "that's a solid plan / exactly the right idea" before any probing. The guards catch the worst; a sturdier talker model should be A/B-tested on this same script.
- **Credits "you found it yourself" / "you reasoned your way there yourself" after her own leading question or hint** (three times); a phrase-level guard would catch it.
- **Monologues:** the first turns still run 60 to 85 words (reassurance, a compliment, the whole outline, the first question); cap at about three sentences.
- **Verdicts mid-round** ("puts you ahead of most freshers", "since you handled that one cleanly").
- **Deep dive repeats covered ground** (a schema question after I had described the schema; "what other tool" after I had given it).
- **No clarification for value range** ("very big numbers"): add a size/range answer to every array problem's clarifications at blueprint time.
- **Pacing:** the whole round took 23 minutes of a 45-minute slot; the deep dive could scale with the time left.
- **Voice, turn-taking and interruptions** remain untested by text.

---

# A round on the real tyagideepanshu profile (2026-10-10): Salescode SDE I, DSA, interviewer Manish Tiwari

Blueprint: a bench run on the account's own profile (Bennett 2026, Full-Stack at Salescode since Feb 2025, Experience Portal, Relay, Vibe, 49 LeetCode solves) with the problems of the booked round and the seen list excluded, so the real round is not spoiled: 4Sum, then Basic Calculator II (reserves Making A Large Island, First and Last Position). Played at the level the profile suggests: a 3Sum-style plan, a planted bug (`j > 0` instead of `j > i + 1` in the 4Sum dedupe), a floor-division slip on the calculator, an honest "no production outage, only staging". Everything technical beyond the profile is my elaboration. Text only. Logs: `profile-round-session.log`, `profile-round-turns.jsonl`, `profile-round-observer-notes.md`. The round reached 24:52 of 45 and ended without the candidate's questions (bug below).

## What felt like a real interview
- 4Sum: constraints revealed on screen when I asked about the size; a first dry run on the textbook example passed, so she pressed with "four zeros, target zero", which exposed my bug; the follow-up probes (empty list, "why does it fire there?") were the right ones.
- Basic Calculator II: she caught "integer division" before any code (floor vs truncation), chose the traces that test operator order and spaces, asked for the O(1)-space version after a correct stack solution, and then asked why folding the last term is safe.
- Project drill-down: "tell me about one specific incident", then "what did the smoke test actually assert?"; she accepted an honest "I have no production outage".

## Found and fixed (test-first; AI-service suite 1397 passing)

| Found | Fix |
|---|---|
| She invited my questions, then 10 s later said the closing and the round ended without Q&A | the plan now follows the conversation before orders already satisfied by the turn are consumed (the order to open the questions part was created after that step and produced a closing turn) |
| "The problem is on your screen" from the conversation part with no tool call: nothing appeared, dead air | the run shows the problem when she says so and one is allowed (it runs the plan on through the leftover parts) |
| The deep dive re-asked what I had answered in the first five minutes (the same resume probe went to both parts) | the introduction gets the first resume probe, the deep dive the rest; a single probe is kept for the deep dive |
| "You caught that yourself and verified it without me pointing at it" after she chose the failing input and a hint | sentences crediting "yourself / on your own / without me" are dropped |
| A legitimate question blocked as a screen claim ("How did you end up solving the singleton problem..."; "Let's go to the part you offered") | questions about their own work are not announcements; "the part/question" alone is no longer a screen claim |
| A turn cut to a remark was re-asked and the re-ask repeated the remark | the re-ask pass is told what was already said |
| "Give me a second. There." before the greeting | not fixed (below) |

## Still open
- No filler or wait should precede the greeting (first token took 3.8 s; fixed line or silence).
- Hints while the candidate is typing ("one thing to keep in mind...") and "check line six" for a guard that was correct.
- "It's the case from my earlier brief": internal words (brief, blueprint, playbook, answer key) are not banned in speech.
- A new problem appeared in a proactive turn with no words at all.
- The false "I'm putting one on your screen" in the intro (turn-start and tool-time checks disagreed) was seen once and not reproduced.
- Test inputs should come from the answer key's edge cases and wrong paths, not the textbook example.

## The five open items from the profile round, fixed (2026-10-10; AI-service suite 1408 passing)

| Item | Fix (each test-first) | Re-check (`profile-round-recheck-session.log`) |
|---|---|---|
| Filler before the greeting ("Give me a second. There.") | the talker takes `fillers_allowed`; the run turns fillers (and the recovery word) off until the greeting has been said; the page still shows "taking a moment" | greeting clean |
| Hints while typing; sent to check a line that was correct | when the candidate says they are writing/typing, the reply is at most one short remark and any hint cue is dropped (`quiet_coding`); rules: never send them to "check" a line unless it is known to be wrong, first ask them to trace the input that breaks it, highlight only as a later hint, never put the fix in a comment | silent while I typed; the next turn still jumped straight to the faulty line with a comment, so the "trace first" rule was added after and is not re-checked live |
| "my earlier brief" and other machinery aloud | speech guard `internal_words` (blueprint, playbook, conductor, timebox, answer key, hint ladder, "the director says", my/the/this brief, item ids `core-1`/`reserve-*`, leaked tool markup such as `name="reason"`); rules list brief, playbook, answer key, hint ladder | a leaked `name="reason" string="true"Start core-1 coding problem.` was seen once and is now blocked |
| False "I'm putting one on your screen" in the intro | cause found: a part's own time being up allowed the problem even though another conversation part was ahead, so the turn-start check allowed the claim while the tool refused it; now only when nothing of the conversation is ahead or the whole conversation's time is spent; plural "problems" is now recognised as a promise | claim held back |
| Textbook example as the test input | the problem's details tell the talker to pick the input from the answer key's edge cases and wrong paths, the one their code is most likely to fail, never the statement's example | picked "five ones then a four, target seven" |

Seen in the re-check and not fixed: "a good bit of ownership for an intern" (the candidate is a full-stack developer, not an intern).
