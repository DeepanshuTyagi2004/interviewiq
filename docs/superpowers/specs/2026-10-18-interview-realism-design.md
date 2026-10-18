# Realistic variety across mock interviews

Status: design, 2026-10-18. Owner decisions are marked **(decided)**; calls made by the author of this document are marked
**(author's call)** and can be overridden.

## Why

Candidates practise the same company round several times. Today every round of the same company, JD and round type sounds
the same: the outline is built from fixed code templates (`plan.outline_parts`, `_deep_dive_parts`), the interviewer resists a
problem change with the same words every time, says "Mm, okay." turn after turn, and runs the parts in one of six fixed shapes.
That breaks the illusion of a real interviewer and makes later rounds predictable. The owner wants every interview to feel like a
different real interviewer running that company's real round, while staying fair and without reintroducing the defects fixed on
2026-10-17/18.

Two things were also found broken and are in scope:

- The outline said "fundamentals on Java, React and databases" but only a SQL question was asked; nothing checks that what the
  outline promised is covered.
- Repeated resistance lines: "a partial solution is perfectly fine" was said again on every refusal.

## Goals

1. **Same difficulty, different interview.** Two candidates booking the same round on the same day get the same difficulty;
   everything else may differ. **(decided)**
2. **Varied per interview (decided):**
   - Round length, between 30 and 45 minutes.
   - The outline: which parts, in what order, which projects and which fundamentals areas, always fitting the selected round.
   - The flow: what is asked, in what order, what is followed up, when a part ends.
   - The interviewer's behaviour: personality, pace, warmth, firmness, verbosity, how it reacts, its own fillers and
     acknowledgements.
3. **The interviewer decides, within guardrails (decided).** Decisions now coded as fixed rules move to the model, with proper
   guidelines, better prompts and safety measures: how many times to resist a problem change, when it is convinced to change,
   whether to resist again after a change, the outline and the flow.
4. **The outline is honoured (decided).** Once said aloud, every part and area it named is covered, unless the round ends early
   for a reason the candidate caused (conduct, proctoring, ending it themselves) or time runs out; running out of time is said
   aloud ("We're short on time, so I'll skip the React questions.").
5. **No repetition.** Nothing the interviewer says repeats word for word across turns of a round unless it is a fixed safety line;
   a point already made (for example "a partial solution is fine") is not made again in the same round. Fillers and
   acknowledgements vary and sound like that persona.
6. **Every fixed defect stays fixed.** All talker guard rules and tracecheck checks stay active (updated where they assumed a
   fixed wording or count); new checks cover the new freedom.

## Non-goals

- No change to the problem bank, difficulty calibration, answer keys, scoring formulas, pass thresholds, cooldowns or readiness.
- No change to the proctoring and conduct ladders (when a warning, final warning or end happens). Their wording may vary (see
  below); their rules do not.
- No new voice, STT or LLM provider; no new runtime dependency.
- A candidate who refuses all coding still gets a short round (decided 2026-10-18); this design does not stretch it.

## Anti-goals (failure even if it technically works)

- Randomness that feels random: a persona that changes character mid-round, an outline that does not fit the round type, a
  different difficulty.
- A promise broken: an outline area never asked, "we'll come back to that" never kept.
- Any regression of a defect fixed on 2026-10-17/18 (constraints read aloud, double close, early end after inviting questions,
  "coding over" said while the plan stays on the problem, warnings glued to other content, blaming the line, second change
  given when not allowed, put-up line for a problem already on screen).
- Slower replies in the live round. Variety is decided at prep or by cheap code paths; at most one small extra model call on a
  problem-change turn (see Problem changes).
- Revealing topics, problems or difficulty in the briefing (unchanged rule).

## What stays fixed (fairness invariants)

- **Difficulty:** problem selection keeps its company/JD/round/level scoring and difficulty band. A replacement on a change
  request comes from the round's own prepped problems; the harder reserve is never a replacement. Which concrete
  problems a candidate gets may differ (it already does, via the seeded draw from the top candidates).
- **What is assessed:** the round's evaluation signals and rubric are unchanged.
- **Gating, readiness, scores:** untouched. A shorter round may give only one problem (the second already comes only when the
  first went well and time allows). The report must judge against what the round's length allowed (see Open questions).

## Design

### 1. A per-interview "realism plan" made at prep

A new blueprint stage, run after the persona stage, produces a `realism` block stored in the blueprint. Structure is decided by
code with real randomness; wording-level flavour by the existing persona LLM call. Nothing here costs live latency.

- **Seed.** A random seed is generated per prep run (not a hash of the session id) and stored in the blueprint, so a round can be
  replayed in rehearsals and benches but two sessions never share choices. Re-prep of the same session keeps its seed
  (as the shape does today). **(author's call)**
- **Round length.** 30, 35, 40 or 45 minutes, drawn per session. **(decided range; step of 5 is the author's call)** See
  section 6 for where it is chosen and how it flows.
- **Persona traits.** Drawn from a small set of axes, each with 3 levels, and handed to the persona LLM so the written persona is
  consistent with them: pace (brisk/even/unhurried), warmth (reserved/friendly/very warm), formality, verbosity (terse/normal/
  chatty), probing depth (light/normal/deep follow-ups), hint style (sparing/normal/generous within the ladder), firmness on
  problem changes (soft/normal/firm). Avoid incoherent combinations with a short exclusion list (for example very warm + reserved
  is impossible by construction). Exclude the trait combination of the candidate's last two rounds where possible.
- **Speech habits.** Per persona, the LLM picks from a curated vocabulary: 5-8 acknowledgements it tends to use ("Right.",
  "Sure.", "Got it.", "Makes sense.", "Okay, cool.", "Fair enough.", "Hmm, okay."), 3-4 backchannels ("Mm-hmm.", "Right.",
  "Yeah.", "Okay."), and filler phrases per wait stage. The talker gets these as "how you talk" in its prefix.
- **Outline.** Code builds a candidate outline from what the round allows (the round family's allowed part orders, extended from
  today's shapes), then samples: the order of conversation parts around the core, which 1-2 resume projects to dig into, which
  fundamentals areas (1-3) and how many questions per area, whether there is small talk, how long the intro is. The outline must
  fit the round: for a DSA round the core coding comes first in time weight, and every part the researched round includes stays
  in. The existing shape library becomes one input to this sampler, not the only source of variety. The outline is stored as a
  list of parts with their promises (for example `{"part": "deep_dive", "promises": ["projects: Vibe", "fundamentals: Java",
  "fundamentals: databases"]}`).
- **Change stance.** From the firmness trait: a prior for how many refusals the interviewer is likely to give before it is
  convinced (soft about 1, normal 1-2, firm 2-3). It is guidance for the live model, not a count the code enforces.

### 2. The outline, said and kept

- **Said in the interviewer's words.** The framing order gives the talker the outline's parts and promised areas as content, not
  as a template sentence; the talker phrases it in its persona's voice. A guard check confirms the spoken outline names every
  promised area and no area that is not promised (a promised area missing, or an unpromised one added, blocks the sentence and
  the talker retries). **(author's call: guard, not trust)**
- **Coverage ledger.** The conductor keeps the outline's promises as obligations. A deep-dive question asked (tagged by area, as
  `question_area` already does) or a project question asked marks its promise covered.
- **Kept.** The conductor refuses to leave the deep dive for the candidate's questions or the wrap-up while a promise is
  uncovered and the round has time for it (the same mechanism as `may_leave_problem`). When time runs out first, the talker is
  ordered to say one short sentence that names what is being skipped, and the promise is marked dropped-with-notice.
- **Free order inside.** The deep dive's questions become a pool per area, not a fixed list read in order. The talker picks which
  question to ask next, follows up on the candidate's answer, may skip a question within an area, and must cover each promised
  area at least once. Today's rule "ask the listed questions in the order given" (prompts.py ~L342) is replaced.
- **Check.** New tracecheck `outline_unkept`: a promised area never asked and never dropped with notice in a round that ended
  normally.

### 3. Problem changes, decided by the interviewer

Today the conductor hard-codes: first ask resisted, second ask is the one change or ends the coding. The new flow lets the model
decide, while the code keeps the mechanics and the hard limits.

- **Who decides.** On a turn the change-request predicate flags, the run makes one fast structured decision call to the talker
  model (short prompt: the persona's firmness, how many times it has resisted this problem and this round, what the candidate
  said, whether they have attempted anything, time left, which actions are allowed). It returns one of `resist`, `change`,
  `end_coding`. The run executes the action first (puts up the new problem, or closes the coding), then the talker speaks it. This
  keeps "never announce what was not done". The call has a tight timeout; on timeout the run falls back to the persona's prior
  (resist until the prior count, then change if allowed, else end coding). **(author's call; the builder may reuse an existing
  classifier path if it meets the latency budget)**
- **Allowed actions (hard limits in code, decided by the author of this document unless noted):**
  - `change` only when a same-difficulty replacement exists and the round has time for it (today's MIN_SECOND_PROBLEM_S).
  - At most **1** change per round. **(decided 2026-10-18)** After the change the interviewer may resist again and decide
    when to end the coding.
  - At least one refusal before the first change of the round. **(author's call: an instant swap on the first ask does not sound
    like a real interviewer; the owner can remove this)**
  - `end_coding` only after at least one refusal on the current problem.
  - The harder reserve is never a replacement; nothing brings a problem back after the coding ended.
- **Resisting sounds human.** The talker words each refusal itself, guided by what it already said this round: a point made once
  (partial solution is fine, give it a try, let's see how far you get) is not made again; a later refusal is shorter, or asks
  what part feels hard, or encourages a first step, in the persona's voice. A guard blocks repeating an already-made refusal
  point (key-phrase families, tracked per round).
- **Checks.** `changed_twice` becomes `changes_over_cap` (more than the cap of 1) plus `change_without_refusal`; `give_up_handled`
  becomes `change_flow_valid` (every change preceded by a refusal, the replacement same difficulty, no problem after the coding
  ended). New `repeated_refusal`: the same refusal point in two turns of a round.

### 4. Lines that are fixed today get variety

- **Fixed-meaning lines become small pools.** Each line the run says in fixed words (problem put-up and intro lines, the change
  lines, the coding-over acknowledgement, "Sorry, I didn't quite catch that.", "Yes, I'm here.", the presence and line-check
  replies) gets 3-6 variants with the same meaning, picked at random with no repeat within a round. Matchers and tracecheck that
  key on today's exact words key on the pool instead (a shared constant per line).
- **Warnings and endings stay deterministic in meaning.** Proctor and conduct warnings, the final warning and the endings get
  2-3 variants each, all saying the same thing with the same firmness, still said alone and still remembered (as built
  2026-10-18). **(author's call: variety here is minor and must never soften a warning)**
- **Fillers, backchannels and openers.** Chosen at random from the persona's speech habits, never the same one twice in a row and
  not more than twice in the last five turns (enforced by a talker guard rule `repeated_opener` and a tracecheck of the same
  name). The rotating counter in `fillers.py` is replaced by a random draw with a no-repeat window.

### 5. Flow freedom, with the conductor as the safety net

- The talker and director get freedom over what to ask, follow-ups and when to move on, within the parts' time guidance (already
  "guidance, not a timer" since 2026-10-17) and the outline's promises.
- Everything the conductor enforces today for correctness stays: problem visibility, reveal of constraints, hint ladder, holds
  while the candidate codes, proctoring, conduct, move refusals for a problem nobody started, warnings alone, the early-end gates.
- Prompts are rewritten where they currently prescribe exact sentences, so they describe intent plus examples drawn from the
  persona's habits, not one example sentence everyone copies.
- Talker sampling temperature: today no temperature is set for the talker or director. The builder should set an explicit,
  moderate temperature for the talker (and keep the director low) and verify it does not raise guard blocks. **(author's call)**

### 6. Round length 30-45 minutes

This replaces the 2026-10-09 decision "every mock round is 45 minutes" (`MOCK_ROUND_MINUTES` in the API, web and AI service).

- **Where it is chosen.** At booking, by the API, so the candidate's briefing and the session record show the real length before
  prep starts; the API sends it to prep as `duration_mins` (as it sends 45 today). **(author's call)** `MOCK_ROUND_MINUTES`
  becomes the maximum (45) next to a new minimum (30).
- **Arc.** `plan_arc` already drops small talk, then the candidate's questions, then the intro when the core gets short; check the
  30-minute DSA case still leaves a sensible first problem (about 15+ minutes) and treat the second problem as optional at short
  lengths (it already depends on time and performance).
- **Live ceiling.** The live 1.5x safety ceiling and the reconcile job use the session's own length, not 45.
- **Everything that reads 45** (API `liveRound.ts`, `blueprintPrep.ts`, `liveSessions.ts`, `loops.ts`, `domain/process.ts`,
  `jobs.ts` ceiling; web constants and loop presets; AI service `blueprint/context.py` and `tracecheck.round_length`) reads the
  session's length instead.
- Update the "45 minutes (decided 2026-10-09)" sentence in the root `CLAUDE.md`.

### 7. Safety measures

- **Guards stay first.** All existing talker guard rules remain. Rules that assume a fixed wording move to the shared pools; rules
  that assume a fixed count move to the new caps.
- **Prep validation.** The realism plan is validated before it is stored: the length is in range, the outline fits the round
  family and includes every part the researched round includes, promised areas exist in the round's question pool, traits are a
  coherent combination. An invalid plan falls back to today's behaviour for that session, logged.
- **Trace checks as the alarm.** New checks: `outline_unkept`, `outline_mismatch` (spoken outline vs the plan), `repeated_opener`,
  `repeated_refusal`, `changes_over_cap`, `change_without_refusal`, `change_flow_valid`, `round_length` updated to the session's
  length. Existing checks stay.
- **Variety check.** A rehearsal acceptance step runs the same persona on the same round with several seeds and reports how
  different the runs were (outline order, areas, opener distribution, distinct interviewer sentences) next to the trace check
  failures. Acceptance: zero trace check failures, and no two runs share their outline and openers. **(author's call)**
- **Cost.** Persona rehearsals use OpenRouter credit, which was nearly exhausted on 2026-10-17. A top-up is needed before the
  acceptance batch.

## Left to the builder

- Exact trait axes, levels and wording, the curated vocabulary lists, pool sizes and variants.
- How outline orders per round family are represented (extend `shapes.py` or replace it), as long as every current shape remains
  expressible and the six rehearsal fixtures still pass.
- The structured decision call's prompt, timeout and where it lives (run vs conductor), within the rules in section 3.
- How the coverage ledger tags questions (reuse `question_area`), and how the guard detects areas named in the spoken outline.
- The data shape of the `realism` block and its migration (old blueprints without it behave as today).

## Calls made after the builder check (author's calls)

- **Replacement problems.** No extra problems are prepped. A change uses today's sources: the next planned problem, else the
  non-harder reserve (`reserve-alternate`). The cap is therefore also bounded by what the blueprint holds; when nothing is left,
  `change` is not an allowed action. "Same difficulty" means the round's prepped problems at the round's band, never the harder
  reserve. After a change on problem 1 to problem 2, no further problem follows unless the model grants another change within the
  cap (no further change exists: the cap is 1).
- **Hard limits that override the model.** `MIN_SECOND_PROBLEM_S` (8 minutes for a new problem) stays a hard limit on `change`;
  the change cap and "nothing after the coding ended" are hard limits. Within them the model decides.
- **The decision call** is a separate path owned by the run, using the talker model (the `app/gates` / Jev decision machinery is
  shadow-only and has not passed its evaluation bar, so it is not used). Latency target: median under 800 ms; a 1.2 s timeout falls
  back to the persona's prior.
- **Round length, before and after booking.** Pre-booking screens (loop dashboard, presets, briefing before booking) show
  "30-45 min". The draw is uniform over 30/35/40/45 at booking; a reschedule or re-prep keeps the drawn length; a retake (a new
  session) draws again. Slot conflicts keep the existing 60-minute slot (`SLOT_MINUTES`), which covers every length. Sessions
  already booked keep 45.
- **Baseline.** The plan builds on the current working tree (the 2026-10-17/18 fixes are uncommitted; the owner commits
  themselves). No ai-service `.py` edits while blueprint prep runs are in flight.
- **Acceptance bar.** Per round type: zero trace check failures, and across the seeds every pair of runs differs in at least 3 of
  these: length, outline order, promised areas, projects asked, persona traits, the five most used openers.

## Owner answers (2026-10-18)

- The design was approved ("ok now implement"). **A problem changes at most once per round (decided)**: the model decides how
  long to resist, whether to grant the one change, and when to end the coding; no second change.
- **Scoring is unchanged (decided):** it is based on how well the candidate did; the interviewer can extend the round (already
  allowed up to the 1.5x safety ceiling), so different lengths are handled fairly.
- **Never say any time of the round (decided).** The interviewer never says a duration or minutes aloud: not the round's length,
  not a part's minutes ("about 22 minutes on problems"), not time left, not "we have N minutes". Remove every order and prompt
  that asks for minutes (the coding-outline sentence in `conductor.py` ~L385-390 and `run.py` ~L901-907, the outline minutes,
  `schedule_again` wording) and add a talker guard rule `time_spoken` that blocks any sentence giving a duration or minutes, plus a
  tracecheck of the same name. Running out of time is still said without a number ("We're short on time, so…"). The briefing
  on screen still shows the round length; only speech is affected.
- OpenRouter has about $0.55: the acceptance step is limited to 2 persona rehearsals for now.
