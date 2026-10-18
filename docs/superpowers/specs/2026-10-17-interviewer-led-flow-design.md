# Interviewer-led flow and varied round shapes: design

Status: draft for review (2026-10-17). Extends `2026-10-08-live-interviewer-design.md` (the live interviewer) and
`2026-10-07-interview-blueprint-design.md` (prep). The user asked for this design and skipped the question round; every
decision marked **(my call)** is open to their correction.

---

## 1. Why

Two complaints from live rounds in the tyagideepanshu account (2026-10-11 to 2026-10-17):

1. **The interviewer does not decide what to do from what the candidate says.** It picks its next sentence, but where the
   conversation goes is decided elsewhere: the conductor walks a fixed list of parts, the director changes the plan in the
   background every few turns, and the interviewer can only "go to the next part" once a minimum number of exchanges is
   reached. When a candidate says something the plan did not foresee, the interviewer cannot follow it. When the director's
   brief was written before that answer, the interviewer follows steps that are no longer valid, or the plan jumps to the next
   part in the middle of a thread ("suddenly starts talking about the next thing").
   The user's words: the talker "should have the ability to decide when to follow the blueprint and when to create and follow its
   own flow, and align the director agent to that."
2. **Every round has the same structure.** Greeting → small talk → how the round runs → "tell me about yourself" → one project
   question → coding → questions → goodbye. The user's words: "every experience should be different for the user, this feels
   repetitive. We can make it while creating the interviewer persona."

Decisions the user already made that this design builds on:
- Timings are guidance, not rules; the director bends them; the 45-minute round may run longer (safety ceiling 1.5×).
- Turn ends are context-aware ("Mm-hmm.", "Sorry, go ahead.") rather than long silences.
- Queued orders that went stale may be set aside by the interviewer, with a reason (built 2026-10-17).
- Every interviewer is a man, with a new persona each round.

## 2. Goals

- G1. **The interviewer leads the path.** On every turn it decides, from the candidate's words, whether to stay on the current
  topic, move to another planned topic, skip a planned topic that is already covered, or open a short topic of its own that the
  plan did not have (a *thread*).
- G2. **The director follows.** Its briefs are written for where the conversation is now. It keeps the round on time and makes
  sure everything that must be assessed still happens. It never pulls the conversation back to a plan the interviewer left,
  unless coverage is at risk.
- G3. **What is assessed does not change.** The same problems, the same evaluation signals, the same must-cover parts, whatever
  path the conversation takes. Two candidates in the same round are judged on the same things.
- G4. **Each round has a different structure.** Prep picks a *round shape* together with the persona: what the round opens
  with, whether and how the round is explained, where the background and project talk sit, how the introduction is asked. A
  candidate never gets the same shape twice in a row.
- G5. **No slower replies.** No new LLM call on the speaking path; the interviewer's decisions come in the same model call
  that writes its reply.

## 3. Non-goals

- Changing how problems are chosen, answer keys, hint ladders, the leak guard, proctoring, conduct handling or endings.
- Inventing coding problems or design questions live (the rule "never invent a coding problem" stands).
- A new model, provider or runtime dependency.
- The post-interview report and scoring (Module 04). This design only fixes what the round records for it (§9).
- Admin UI for the new trace fields (they are written; showing them is later work).
- Changing the 45-minute booking slot or `MOCK_ROUND_MINUTES`.

## 4. Anti-goals (a failure even if it works)

- A round that wanders and never reaches the coding, or the second problem it should have reached.
- An interviewer that changes topic abruptly or at random. Every move is linked with a connecting phrase, as today.
- Different candidates in the same round assessed on different things.
- A shape that contradicts the company's real process. For example, in Amazon's "Coding + Leadership Principles" the
  principle questions still come first.
- A persona whose manner contradicts its shape, such as a "warm, chatty" interviewer who skips all conversation.

## 5. Who decides what

| Decision | Today | After |
|---|---|---|
| What to say | Interviewer | Interviewer |
| Stay on the topic, follow up | Interviewer, within the current part | Interviewer |
| Move to another planned topic, in any order the rules allow | Only "next part", after minimum exchanges | **Interviewer** (`go_to`) |
| Skip a planned topic that is already covered | Director only (`skip`) | **Interviewer**, for may-cover topics, with a reason (`skip_goal`) |
| Open a topic the plan did not have | Nobody | **Interviewer** (`open_thread`), within limits |
| Set aside a stale order | Interviewer (built 2026-10-17) | Interviewer |
| Time: more time for a part, end a part, close the round | Director (built 2026-10-17) | Director |
| The time budget the interviewer may spend on its own topics | Nobody | **Director** (its `extend` grants it) |
| Swap a problem for a reserve, add a skill question, reorder problems | Director | Director |
| Must-cover topics are reached; order rules; safety ceiling; endings; warnings; leak guard | Conductor | Conductor |
| Round structure (shape) | Fixed | **Prep**, per round (§8) |

In short, the interviewer drives the path, the director keeps the time and coverage, and the conductor enforces the hard rules.
When the interviewer and the director disagree, the interviewer wins on the path within the coverage budget, the director
wins on time and coverage, and the conductor's rules win over both.

## 6. The plan becomes a set of goals

Today's plan is an ordered list of *items* (`plan.Item`). It becomes a list of **goals** with the same fields plus the
following:

- `must`: must-cover or may-cover. Must-cover goals are:
  - every core problem, subject to the existing rules that skip the second problem when the candidate struggled or too little
    time is left (`will_skip_next_problem`, unchanged);
  - every arc phase marked `scored` (for example the background in a hiring-manager round, or principle questions);
  - `candidate_questions`;
  - `wrap_up`.

  Everything else is may-cover: small talk, the round outline, a background part that is not scored, the project deep dive
  when it is not scored, skill questions (fillers) and threads.
- its planned minutes, reserved while it is pending (§7.3).
- `origin`: `plan`, `reserve`, `filler` or `thread`.
- `why`: for threads and skips, the interviewer's reason.

**Order rules (conductor-enforced):**
- The greeting is first. `wrap_up` is last, and `candidate_questions` comes right before it.
- Problems come in the blueprint's order (the director may still reorder them). One problem at a time: once a problem is up,
  the conversation does not leave it for another topic until the problem is closed. Problem endings are unchanged: the
  interviewer closes it, or the existing rules or the director do.
- Coding may not start before the shape's `min_exchanges_before_coding` (§8), and no earlier than the shape allows. This
  replaces today's fixed `MIN_BACKGROUND_TURNS = 5`.
- No threads while a problem is up. The interviewer already follows up freely inside a problem; a thread there would derail
  the coding. **(my call)**
- Principle questions a round asks first (a coding or design round whose description includes a behavioural part, such as
  Amazon's "Coding + Leadership Principles") stay first in every shape.

Today's per-phase `MIN_TURNS` minimums apply only to must-cover goals. A may-cover goal can be left or skipped as soon as the
interviewer judges it done.

## 7. The live turn

### 7.1 What the interviewer sees

Its prompt gains a short **goal map**, roughly 150 tokens:
- each pending goal's id, its kind, whether it is must-cover, and one line on it;
- the open thread, if any;
- the **free minutes** (§7.3).

The current goal's details (playbook, hints, probes) are shown as today. The director's brief is shown only while it is still
valid (§7.4). Conductor orders are shown as today, with "(may be set aside)" on the three kinds that can be.

### 7.2 What the interviewer can do

It acts with tools in the same call that writes its reply. Tools run after the speech, as today. New and changed tools:

| Tool | Does | Refused when |
|---|---|---|
| `go_to(goal_id?, why)` | Ends the current goal and opens the target, or the next pending goal by default. May-cover goals it jumps past are skipped ("passed over"); must-cover goals it jumps past stay pending and come next once the coding (or the goal it went to) is done. `next_item` stays as an alias with no target. | The target is not pending, breaks an order rule (§6), or is a may-cover goal and less than a minute is free (§7.3) |
| `skip_goal(goal_id, why)` | Marks a may-cover goal skipped ("they covered their projects in the introduction") | The goal is must-cover |
| `open_thread(title, why, minutes?)` | Starts a topic the candidate raised that the plan did not have. It becomes the current goal; the goal it interrupted is paused (its clock keeps running) and resumes, with no new opening, when the thread closes. Minutes are clamped to 1–6 and to the free minutes. | A problem is up; a thread is already open; three threads were already opened; less than a minute is free |
| `close_thread(why)` | Ends the thread and goes back to the goal it interrupted, or to `go_to`'s target | No thread is open |
| `log_turn` | Unchanged, plus `set_aside` (built 2026-10-17) | Never |

Thread limits: 3 minutes by default, at most 6, at most 3 per round, one at a time. **(my call)** A thread refused for lack
of free minutes wakes the director, which may grant more time with `extend`. A thread past its minutes is
handled like any part past its time: the director decides, and the conductor's late fallback ends it if the director says
nothing. Threads are conversation only: no problem, no code, no board task.

A refused tool is reported in the next turn's state with the reason, as `refused` already is today, so the interviewer can
link back gracefully.

The interviewer's rules gain one paragraph, in plain words:
- Follow the candidate. When what they said opens something worth hearing that the plan does not have, open a thread.
- When they have already covered a planned topic, skip it with the reason.
- When the plan's next topic fits, go to it.
- Link every move with a connecting phrase.
- Never leave a problem midway for something else.

### 7.3 Free minutes (the budget the interviewer may spend)

- **time available** = planned round length + all minutes the director granted with `extend` − time used.
- **reserved** = the planned minutes of every pending must-cover goal (its timebox). The goal under way is not reserved: its
  remaining minutes are the interviewer's to spend. **(my call, revised 2026-10-17: an earlier draft reserved only 8 minutes per
  problem, which would have let threads squeeze the problems below their planned time, against G3)**
- **free minutes** = time available − reserved. The interviewer's prompt shows it, rounded down. A move to a may-cover goal or
  a new thread needs at least one free minute. More free minutes come from time saved elsewhere or from the director's `extend`.

This gives the director control of the budget without it steering the path. A director `extend` of N minutes on the current
goal also raises the planned round length by N. **(my call)** That is how "the 45 minutes can go longer" reaches the
interviewer.

### 7.4 Keeping the director's brief valid

The conductor keeps a **flow position** that increases on every move (go_to, skip, thread opened or closed, a problem swap)
in addition to today's item position. A brief carries the flow position it was written for. If the flow has moved since, the
interviewer does not see the brief and its goal-specific `plan_changes` are dropped (today: only on item position). Time
changes (`extend`, `move_on`, `wrap_up`) still apply if they target the goal that is still current. This removes "the
interviewer follows director steps that are not valid any more" at the source.

Every interviewer move wakes the director (a new trigger, `flow`), so a fresh brief for the new position usually arrives within
one or two turns.

### 7.5 The director's new job

It sees a `flow` block in its payload:
- the current goal or thread;
- the interviewer's last moves with their reasons;
- refused moves;
- the free minutes;
- set-aside and cancelled orders (built 2026-10-17).

Its rules change from steering to coaching:
- The interviewer leads the path. Write the brief for the goal the conversation is on now. Never brief a return to a goal the
  interviewer left or skipped unless a must-cover goal is at risk; then say so in coverage terms.
- Use `plan_changes` for time and coverage:
  - `extend`, `move_on` and `wrap_up`;
  - `use_reserve` and reordering problems;
  - adding a skill question as a may-cover goal.

  Today's `skip` of a conversation goal and `insert_filler` stay available, but are described as suggestions the interviewer
  is told about, not orders.
- When free minutes are low and a thread or a may-cover goal runs on, say so in the goal ("wrap this up in a minute, the coding
  needs its time"). If that is ignored, `move_on` remains the director's tool.

### 7.6 What stays exactly as it is

These keep their current rules and override the interviewer:
- turn-taking (live interviewer design §5.6, "End of a candidate's turn");
- the fixed lines;
- conductor orders that must be said;
- the leak guard and the sentence checks;
- problem gating;
- hint pace;
- the give-up flow;
- conduct;
- proctoring;
- the safety ceiling;
- the endings.

## 8. Round shapes (prep)

A **round shape** decides the conversation around the problems. It never changes the problems, their minutes or what is
assessed.

### 8.1 What a shape sets

- **Opening:** small talk with a rapport hook from the personalization; one line of small talk; or straight to business.
- **Outline:** said in full as today; one line folded into the move to coding ("let's do some coding, about thirty minutes"); or
  not said.
- **Background:** "tell me about yourself"; one pointed question on a resume item (a resume probe); a one-minute version; or
  none before coding.
- **Project talk:** before coding, after coding, or none. The default is to follow the round's `deep_dive_mins`.
- **min_exchanges_before_coding.**
- **The minutes of each conversation part,** as shifts between conversation parts that sum to zero, so the conversation total
  and the coding minutes are exactly today's for the round. **(my call: stricter than the ±3 minutes first drafted)**

### 8.2 The library

Shapes are data in prep: a fixed, reviewed library per round type, not invented by the model. That keeps them realistic and
testable. **(my call)** The first library is for DSA rounds, the main use case. Per-phase minutes are left to the builder
within §8.1's rules.

| Shape | Order of the conversation | Before coding |
|---|---|---|
| `classic` | greeting → small talk → outline → "tell me about yourself" → coding → questions → close | 5 exchanges |
| `straight_in` | greeting → one-line outline → coding → about you and one project → questions → close | 0 |
| `resume_opener` | greeting → one pointed resume question → one-line outline → coding → questions → close | 2 |
| `chat_first` | greeting → longer small talk on a rapport hook → about you → outline folded into the move to coding → coding → questions → close | 5 |
| `projects_first` | greeting → outline → one project in depth → coding → questions → close | 4 |
| `brisk` | greeting → outline → "a minute on yourself" → coding → questions → close | 2 |

Other round types get two or three shapes each from the same dimensions. The builder writes them, keeping each round type's
real process:
- **System design and LLD:** requirements first.
- **Behavioural and hiring manager:** the background is the assessment, so it is must-cover in every shape.
- **Online assessment:** keeps its single shape.

### 8.3 Choosing the shape

- Seeded by the session id, like the persona name.
- It excludes the shapes this candidate had in their last two blueprints. `persona_names_for_candidate` already reads past
  blueprints, and gets a shape counterpart.
- **(my call)** Equal weights.
- Stored on the blueprint as `shape_id`, so a re-prepared blueprint for the same session keeps its shape.

### 8.4 Persona fits the shape

- The shape is chosen first. The persona prompt is given the shape and writes a persona that fits: a brisk manner for
  `straight_in` and `brisk`, a warm one for `chat_first`.
- It writes phase guidance per conversation part, as today.
- The six seeded icebreaker pairs (`plan.ICEBREAKERS`) stay: the persona's own small-talk guidance always came out as "how's
  your day going?", which is why they exist, and small talk stays about the call itself. The `chat_first` shape adds one light
  question about their work from a personalization rapport hook after that chat. **(my call, revised 2026-10-17)**

### 8.5 Where shapes change the code

- `plan_arc` builds the arc from the shape. Arc entries gain a `style` (for example `candidate_intro: pointed_resume_question`)
  that the live opening hints and bridges read.
- The bridges and `opening_hint` texts become shape-aware. For example, "But before the coding, let's start with you." is
  wrong after the coding.
- `MIN_BACKGROUND_TURNS` and `problem_allowed` read the shape's `min_exchanges_before_coding`.
- The blueprint bench script (`bench-blueprints.ts`) and judge (`judge_blueprints.py`) report the shape, and the judge checks
  that the persona fits it.

Shapes count as the interviewer's style, not a user edit. A round with any shape still counts toward the official loop and
readiness, and the loop rules are unchanged.

## 9. What the round records

- **Interviewer turn:** its flow moves (`go_to`, `skip_goal`, `open_thread`, `close_thread`) with reasons, refused moves with
  the conductor's reason, the free minutes at the time, and the existing `set_aside`.
- **Brief:** the flow position it was written for, and whether it was shown or dropped as stale.
- **Run:** `shape_id`, the goals in the order they happened (including threads and skips), and per goal the time used, how
  it ended and who ended it (interviewer, director, fallback, rule).
- **Report (Module 04):** the report must not assume a fixed order of parts. Evidence is per goal, and a thread's evidence goes
  to the background signals.

## 10. Acceptance

Run with the existing text-simulation harness (`app/interviewer/simulate.py`) and scripted candidates, plus one real voice
round on the allowlisted account.

1. **Unplanned topic:** a candidate who raises one is followed with a thread in at least 4 of 5 scripted cases, and the round
   still reaches every must-cover goal.
2. **Topic already covered:** a candidate whose introduction already answers the planned project question is not asked it
   again (the interviewer follows up on something new or moves on) in at least 4 of 5 cases, and a may-cover part they made
   moot (the outline, after they said they know the format) is skipped with a reason.
3. **No stale briefs:** no turn follows a brief written for a flow position that has moved (trace check, 0 cases).
4. **Coverage:** 100% of simulated rounds reach every must-cover goal the problem-skip rules keep, then the candidates'
   questions and the closing, within the safety ceiling.
5. **Speed:** the median time from the end of their speech to the interviewer's first audio does not rise by more than 100 ms,
   and the talker prompt grows by at most 10%.
6. **Variety:** across 10 consecutive prepared rounds for one candidate, no shape repeats within any three in a row, and the
   blueprint judge passes the persona-fits-shape check on each.
7. **Trace:** every move, refusal, thread, skip and stale brief is in the trace (§9).

## 11. Risks

- **The live model wanders** (DeepSeek v4.1 flash, chosen for speed). Mitigations:
  - thread limits;
  - free minutes shown and enforced;
  - the director's coverage nudges, with `move_on` behind them;
  - the conductor's fallback;
  - the safety ceiling.

  If acceptance 1–4 fail, a stronger talker model is the escalation. That is the user's decision (cost).
- **Tool calls are missed**, for example the interviewer says "let's talk about your migration work" without `open_thread`.
  Same pattern as `next_item` today: words that clearly leave the goal move the plan (`leaves_the_part`), and the director sees
  the transcript. A thread talked into without the tool is not detected; the director sees it in the transcript.
- **Rehearsal findings (2026-10-17, paid text rehearsals):**
  - DeepSeek v4.1 flash with reasoning off used none of the flow tools in 121 turns and called `log_turn` in only 8% of them. It
    treats tools as optional side actions and keeps only the visible ones (show the problem, reveal, hint).
  - The lead-the-path rule, buried in a 19,000-character prompt, lost to each part's concrete instructions.
  - Fixes:
    - a short path note sent after the candidate's words on every turn (`prompts.PATH_NOTE`, "decide silently");
    - a rule to take an answer given ahead of the question;
    - a guard that drops narrated decisions ("go with the plan");
    - the plan follows the talk when the interviewer gives the outline or asks for the introduction in words
      (`run._open_the_part_the_words_opened`).
  - Results:
    - on the replayed decision point, the model follows the candidate 7 of 8 times (it pulled them back to the plan 5 of 6
      times before);
    - it logs its decision on about 40% of turns;
    - it opened and closed a thread through the tools in 1 of 8 full runs;
    - first-token time is unchanged (~0.6 s).
  - Alternatives measured:
    - GLM 5.3 needs reasoning on (~1.1 s to the first token) and used no flow tools;
    - Claude Haiku 5.5 follows the candidate and logs reliably at ~0.9 s.
- **Prompt growth slows the talker.** The goal map is capped at the pending goals, one line each.

## 12. Left to the builder

- Exact tool argument names and the goal-map wording.
- Per-phase minutes inside each shape, within §8.1's rules.
- The shapes for round types other than DSA, within §8.2.
- How `plan.Item` grows into a goal (extend the dataclass rather than a parallel type) and the checkpoint fields.
- The scripted candidates for §10.
