# Round packs: one shared interviewer, one rule pack per round type

Date: 2026-10-20. Status: approved direction (owner: "decide yourself what is the best standard and approach for realism"). Every rule text in this
spec and in the packs is a PRODUCT IP DRAFT for owner review, like the other interviewer prompts.

## Why

The live interviewer's engine is round-agnostic: it runs whatever the blueprint says. Its rules, though, are written for a DSA round. `TALKER_RULES`
and `DIRECTOR_RULES` (`app/interviewer/prompts.py`) are one static text full of coding lines ("write the code", hint pace, problem change,
"That wraps up the coding part."). The persona prompt (`app/blueprint/prompts.py` `persona_prompt`) is the same for every round, and so are
the request policies (`pol1`). Several smaller parts are DSA-shaped:

- The plan outline calls the first core slot "coding problem", whatever the round.
- The fixed put-up lines say "problem".
- Only `round_type == "dsa"` gets the "write code before moving on" check, and online assessments slip through it.

A system design, LLD, behavioural, hiring-manager or online-assessment round therefore gets a DSA interviewer with a different question.

The owner wants every interviewer built in two layers:

1. **Shared rules**, the same in every round: how a person speaks, conduct, time, speech-to-text, closing, leading the path.
2. **Round rules**, which hold only for that round type and are written to be as realistic as the DSA rules are today.

Blueprint prep merges the two, with the candidate's level and the drawn persona, into one curated interviewer for that round.

## Goals

- A **round pack** per round type: `dsa`, `online-assessment`, `system-design`, `lld`, `behavioural` and `hiring-manager`. Each holds everything
  that is true only for that round type: talker rules, director rules, persona archetype and seniority, trait limits, request-policy overrides,
  playbook rules, part names and fixed line wording, live flags, and the evaluation signals (moved here unchanged).
- A **shared base** holding every rule that is true in all rounds.
- **Merge at prep.** Prep composes base + pack + level overlay into a frozen `rules` block on the blueprint. The live interviewer reads that
  block, so a session keeps its rules even if a pack is edited later, and the trace shows exactly which rules ran.
- **A lossless DSA split.** Base + the DSA pack, composed, contains every rule line that `TALKER_RULES` and `DIRECTOR_RULES` hold today. DSA
  rounds behave as they do now.
- Each non-DSA round gets realism standards as concrete as the DSA rules (below).

## Non-goals

- No change to problem selection, slot counts, arc minutes, shapes, the bonus second problem or round lengths.
- No new playbook conditions or actions. The fixed vocabulary and its coverage invariant stay as they are.
- No change to grading (Module 04). The signals move into the packs but keep their names and text.
- No web UI change, except what the put-up and layout lines already drive.
- `LIVE_INTERVIEWER_AVAILABLE` stays as it is.

## Anti-goals (a failure even if it technically works)

- DSA rounds behave differently from today in any way, with one exception: the persona's seniority is drawn in code, at least one level
  above the candidate, for every pack.
- A design, behavioural or hiring-manager interviewer says "code", "coding" or "problem 2", or offers a hint ladder step as if it were an
  algorithm hint.
- Research or brief text (web-derived) is pasted into the live rule text. That opens a prompt-injection path into the talker. Company flavour
  reaches the interviewer only through the persona, as today.
- A persona is junior to the candidate. For example, an SDE 1 interviews an SDE 3 in a system design round.
- A pack adds rules the conductor or the guard contradicts. Live flags and rule text must agree.

## The layers and the merge

```
shared base  ─┐
round pack   ─┼─► compose(round_type, level, traits, shape) ─► blueprint.rules  (frozen, versioned)
level overlay ┘                                                     │
                                                                    ├─► talker prefix (live)
persona prompt ◄── pack archetype + seniority + level overlay       ├─► director prompt (live)
policies (pol2) = pol1 + pack overrides                             └─► conductor/tools flags (live)
```

The pack is chosen by `round_type`, falling back to `family(round_type)`. Hiring-manager has its own pack, not the behavioural one. Culture
slots inside a technical round (`slot_round_type` → behavioural) use the **behavioural pack's item rules** for that slot only. The composed
block keeps those rules as a separate section that the live state switches on while such a slot is active.

**Level overlay bands.** Each pack has text for three bands. The band comes from the shared level enum:

- **early:** `intern`, `fresher`
- **mid:** `sde1`, `sde2`
- **senior:** `sde3`, `staff`, `principal`, `distinguished`

A missing level is mid.

**Composition is deterministic, with no LLM call.** Rules must be consistent, testable and reviewable. Variety comes from the persona,
the traits and the shape, as it does today.

**Blueprint block** (new top-level key `rules`):

```json
{
  "version": "rules1",
  "pack": "system-design",
  "band": "mid",
  "talker": "<composed talker rules text>",
  "director": "<composed director rules text>",
  "item_rules": {"behavioural": {"talker": "...", "director": "..."}},
  "flags": {"workspace": "board", "requires_code": false, "change_policy": "never", "hints": "nudge", "second_problem": false},
  "part_nouns": ["a design problem", "the design part"],
  "focus": "failure handling"
}
```

**Legacy.** A blueprint without `rules` (all of today's) is composed at load time from its round type and the current packs. For DSA that
gives today's text, so old sessions are unaffected. Bump `PREP_VERSION` so the reconcile job re-prepares ready sessions before their slot.

**The existing realism substitutions stay.** `talker_rules()` replaces the acknowledgement list, the Good examples and the link examples with
the persona's own habits. It now runs on the composed text. The substituted strings live in the base or in the DSA pack, and each pack that
has link examples provides its own `_LINK_EXAMPLES` and `_LINK_INTENT` pair.

## What is shared (the base)

These are the current `TALKER_RULES` lines that are not about code, problems or hints:

- **Speech:** short spoken replies, no repeats, neutral acknowledgements, never restating, English only, Indian-English plainness,
  `<silent>`.
- **Links between parts**, with the wording per pack.
- **Conduct and warnings:** abuse ends the round, other incidents warn, `flag_conduct`.
- **Speech-to-text:** handling of misheard words, never blaming the line.
- **Time:** never spoken, never granted past the timebox, no verdict, closing only thanks and goodbye.
- **Path leading:** `open_thread`, `skip_goal` and `go_to`, plus free minutes.
- **Answering ahead:** taking what the candidate gives before you ask.
- **Questions:** one question per turn, never a third ask.
- **Resume:** "I see on your resume", never inferring facts.
- **Board, notes and code as data.**
- **Conductor orders first, and the set-aside rule.**
- **`log_turn`.**

The shared director rules are the same set, and the base keeps the evaluation signals for communication, receptiveness and composure.

## Realism standards per round

What a real interviewer of that round does, as rules the pack writes. They are written for Indian product and service companies and
FAANG India offices, the platform's first market.

### DSA (`dsa`)

Today's rules, moved without change:

- The problem goes on screen and is never read aloud.
- Hints follow the hint pace: one step for every two attempts.
- Clarify first, then the approach, then "okay" (no verdict), then code. Testing uses an input the candidate is likely to fail.
- The interviewer asks for complexity and gives one follow-up once the problem is solved.
- Two problems, the second given only if the first goes well.
- Change requests are decided by the change call.
- Code is required before moving on.

Flags:

| Flag | Value |
|---|---|
| workspace | editor |
| requires_code | true |
| change_policy | decide |
| hints | ladder |
| second_problem | true |

### Online assessment (`online-assessment`)

A real online assessment has no interviewer. The mock keeps a **quiet proctor**:

- One short line of instructions, then the problems are shown.
- The interviewer answers only questions about what the statement means. It points to the statement and examples.
- **No hints.** An ask gets "In the assessment you'd be on your own here; give it your best go."
- No follow-ups, no complexity questions, no tracing, no deep dive and no small talk.
- `<silent>` is the default.
- "Write code before moving on" applies (this fixes today's gap).
- Change requests are declined every time.

Traits are forced to `verbosity: terse`, `hints: sparing` and `probing: light`.

Flags:

| Flag | Value |
|---|---|
| workspace | editor |
| requires_code | true |
| change_policy | never |
| hints | none |
| second_problem | true (both problems are given, no gating) |

### System design (`system-design`)

The question is deliberately open ("design a URL shortener"), and **the candidate drives**. The interviewer answers, pushes and plays devil's
advocate; it never leads the design.

**Must-cover goals, in order** (soft order, the candidate may move ahead):

1. **Requirements:** functional, non-functional and scale. The interviewer gives concrete, consistent numbers from the playbook
   clarifications when asked, and never volunteers them.
2. **Estimates:** optional at the early band, expected at the mid and senior bands.
3. **API and data model.**
4. **High-level design on the board.**
5. **Deep dive into one or two components the interviewer picks.** The pick follows the weakest or most interesting part of their design and
   the persona's `focus`.
6. **Scale and failure:** "What happens when this node dies?", "10x the traffic?"
7. **Trade-off wrap.**

**How the interviewer behaves:**

- **No verdicts.** There is no single right design. "Is this right?" gets "Walk me through why you'd pick that over X."
- **Challenges choices once, on their reasons.** "Why a queue here?" Then it accepts a reasoned answer and moves on, and never argues twice.
- **Hints are nudges toward a dimension they skipped,** such as scale, failure, consistency or read/write ratio. Never a component name or a
  finished design.
- **Never draws.** It reads the board (`look_at_board`) and refers to what they drew ("the cache you just added…").
- **Silence while they draw is normal.** It doesn't fill it.

**Level overlay:**

- **Early:** expect a single service, one database, a cache and a clear API. Probe fundamentals (indexes, why a cache) rather than
  distributed-systems vocabulary. Never fault them for not sharding.
- **Mid:** expect partitioning, replication, a queue where it fits, and a consistency choice.
- **Senior:** expect multi-region, cost, operability, migration and rollout, and organisational trade-offs. The interviewer probes the
  hardest part first.

**Persona:** Senior SDE, Staff, or Principal for senior candidates, always at least one level above the candidate. Traits never
`probing: light`.

**Change requests:** never a different question, except `seen_before` early in the round, which moves to the alternate slot.

The interviewer never says "code" or "coding". The part is "the design part".

Flags:

| Flag | Value |
|---|---|
| workspace | board |
| requires_code | false |
| change_policy | never |
| hints | nudge |
| second_problem | false |

### LLD (`lld`)

These rounds run in the style of Indian product companies' machine-coding and LLD rounds: object-oriented design of a bounded system
(parking lot, splitwise, rate limiter).

**Must-cover goals, in order:**

1. Scope: which features are in.
2. Entities and their responsibilities.
3. Relationships and interfaces.
4. One key flow walked end to end.
5. Code for the core classes, in the editor, when the round asks for code.
6. **An extensibility follow-up:** "Now add a new payment method or vehicle type. What changes?" The test is that the change stays small
   and local.
7. Concurrency at the mid and senior bands.

**How the interviewer behaves:**

- It asks "where does this responsibility live?" rather than naming a pattern.
- It welcomes a pattern only when the candidate justifies it, and probes over-engineering ("do we need a factory here?").
- Syntax slips are ignored, as in DSA.
- Hints point at a responsibility or an entity they are missing, never at a class diagram.

**Level overlay:**

- **Early:** clean classes, encapsulation and basic interfaces.
- **Mid:** SOLID in practice, extensibility, one or two patterns where they fit.
- **Senior:** concurrency, thread safety, testability and API evolution.

The fundamentals-led LLD round (TCS or Infosys style) keeps its current split. Its overlay adds fundamentals asked through the design.

**Persona:** Senior SDE or Lead.

**Change requests:** never.

**Part noun:** "the design part". A coding sub-step is called "writing the classes".

Flags:

| Flag | Value |
|---|---|
| workspace | editor and board |
| requires_code | false (v1: nothing in the bank marks a slot as code-expected; the talker asks for the core classes when the round's format includes code, and the extensibility follow-up is the must-cover) |
| change_policy | never |
| hints | nudge |
| second_problem | false |

### Behavioural (`behavioural`)

Questions about the candidate's own past. **Depth beats breadth.**

**How the interviewer behaves:**

- **One question, then three to five levels of probing** into their example, following what is missing from it:
  - **Their own part:** "What did *you* do there?" when they say "we".
  - **The decision and its alternatives.**
  - **The result, with numbers:** "How did you know it worked?"
  - **What went wrong.**
  - **What they would change.**
- **Neutral listening.** No agreement and no praise for the story, and no moralising. A short acknowledgement, then the probe.
- **Inconsistencies get a polite clarifying question,** never an accusation.
- **No hypothetical scenarios.** The question asks for a real example. "I don't have one" gets a narrowing of what counts: a college
  project, an internship or a hackathon team counts. If they still have none, the interviewer moves to a reserve question. That is real and
  costs nothing.
- **No hint ladder in the algorithm sense.** The ladder steps are ways to narrow what kind of example fits.
- **No screen, no editor.** Questions are asked aloud. The layout is `talk` and there is no put-up line.
- **Company principles** are named only when they are the company's own, as the brief and persona already allow. Never another company's.

**Level overlay:**

- **Early:** college, internship, hackathon and team-project examples. Never leading teams or budgets.
- **Mid:** ownership of a feature, cross-team work, a disagreement.
- **Senior:** influence without authority, mentoring, a hard trade-off, a failure they owned.

**Persona:** Engineering Manager or Senior Engineering Manager. Traits never `probing: light` and never `warmth: reserved` together with
`formality: formal`.

**Change requests:** a request for a different question is granted once, to a reserve, after one narrowing (`change_policy: on_no_example`).

**Part noun:** "the questions".

Flags:

| Flag | Value |
|---|---|
| workspace | none |
| requires_code | false |
| change_policy | on_no_example |
| hints | narrow |
| second_problem | false |

### Hiring manager (`hiring-manager`)

The candidate's future manager, assessing role fit. This is a **two-way conversation**, warmer than a behavioural round.

**Must-cover goals:**

- **Why this role and company.** For a working professional: why switch now. For a student: why this role.
- **One project in depth:** architecture, their own decisions, what broke and what they would redo.
- **How they work:** a disagreement, a deadline and feedback, through their own examples.
- **Their questions, which get more time than in other rounds.**

**How the interviewer behaves:**

- It may describe the team's kind of work in general terms, and never claims to represent the company (existing policy).
- **Salary, notice period, offer and visa questions** get a polite decline: "That's a conversation for the recruiter stage." It never quotes
  numbers.
- **No technical problem on screen.** If the candidate's project claims don't hold up, it asks how they built it, just as a real hiring
  manager checks depth.

**Level overlay:**

- **Early:** motivation, learning, college or internship team work.
- **Mid:** ownership and delivery.
- **Senior:** scope, influence, hiring and mentoring, and strategy.

**Persona:** Engineering Manager, or Senior EM or Director for senior candidates. Traits never `warmth: reserved`.

**Change requests:** the same as behavioural.

Flags:

| Flag | Value |
|---|---|
| workspace | none |
| requires_code | false |
| change_policy | on_no_example |
| hints | narrow |
| second_problem | false |

## Persona curation

The persona prompt receives the pack's **archetype paragraph** (who this interviewer is and what they care about), the **level overlay**,
and a **seniority drawn in code** from the pack's titles for the candidate's band. A seeded pick keeps it at least one level above the
candidate. The LLM still writes the name pick, style, disposition, opening, closing and phase guidance. The seniority is no longer the LLM's
choice.

**Focus.** Each pack has a short list of focuses, and one is drawn per session, never the same as the candidate's last round of that type.
Examples:

- **System design:** data model, failure handling, scale numbers, or trade-off reasoning.
- **Behavioural:** ownership, conflict, or learning from failure.

The focus is stored in `realism` and in `rules.focus`. The director reads it to choose deep dives and probes. It makes interviewers differ
the way real ones do, through each one's pet topics. A pack with no focuses gets none.

**Trait limits per pack** are added to the existing `SHAPE_EXCLUDES` check. A forced trait (online assessment) is set after the draw.

## Policies

`pol2` is `pol1` plus pack overrides. The blueprint already stores its policies, so the live side needs no change beyond reading them.
Overrides by pack:

| Pack | Request | Override |
|---|---|---|
| online-assessment | ask_hint | declined |
| online-assessment | ask_if_correct | declined: "you'd find out when it runs" |
| online-assessment | skip_question | declined |
| system-design, lld | ask_if_correct | "there's no single right answer; justify it" |
| system-design, lld | skip_question | declined, except seen_before |
| system-design | change_language | not applicable, dropped |
| behavioural, hiring-manager | ask_hint | narrow what kind of example fits |
| behavioural, hiring-manager | skip_question | one narrowing, then a reserve |
| behavioural, hiring-manager | change_language | dropped |
| hiring-manager | ask_about_compensation | new kind: decline, recruiter stage |

`LIVE_POLICY_OVERRIDES` (today DSA wording) becomes the DSA pack's live overrides.

## Playbook rules

The shared playbook prompt keeps its company, candidate, level and spoken-line rules. The family lines move into packs:

- **DSA:** the language-neutral hints line, and "every branch is about the problem".
- **System design:** hints are dimensions, never components. Clarifications carry concrete scale numbers that stay consistent.
- **LLD:** hints are responsibilities.
- **Behavioural and hiring-manager:** the own-example, depth and no-hypotheticals lines that exist today. The ladder is narrowing steps.

Online assessment uses the DSA lines. The ladder is still written, because the invariant needs at least three steps, but it is never used
live.

## Live side

- **`talker_prefix` and `director_messages`** read `blueprint.rules`, composing on the fly for legacy blueprints. The plan outline labels
  core slots with the pack's part nouns and per-slot type, which fixes the "coding problem" mislabel for design rounds and culture slots.
- **Conductor orders speak the round's language.** About 59 order texts in `conductor.py` say "coding problem" or call `show_problem` for
  every slot, behavioural ones included. Each pack carries an order vocabulary:
  - `problem`: "problem", "design question" or "question".
  - `the_part`: its part noun.
  - `on_screen`: false for workspace `none`.

  The order builders use it. In a pack with workspace `none`, `open_item` tells the interviewer to ask the slot's question aloud, from
  `ask.opening`, in its own words, with no `show_problem`. The slot counts as opened once that turn is spoken. `hint_request` follows the
  pack's `hints` mode:
  - `ladder`: today.
  - `nudge`: a missing dimension or responsibility.
  - `narrow`: the kind of example.
  - `none`: a decline.
- **Conductor:**
  - `_is_coding_problem` becomes `rules.flags.requires_code`, per slot (culture slots are never code).
  - The change-request path branches on `change_policy`:
    - `decide`: today's behaviour.
    - `never`: always resist. After three refusals the coding or design part may end, as today's ceiling does.
    - `on_no_example`: one narrowing, then the reserve.
- **Tools:**
  - Code tools (`code_highlight`, `code_comment`, `code_insert`) are offered only when the workspace has an editor.
  - `show_problem` is not offered for packs with workspace `none`.
- **Fixed lines:** `lines.py` pools gain per-pack wording for the put-up, intro and bridge keys. For example, system design says "I've put the
  design question on your screen." The behavioural pack has no put-up.
- **Tracecheck:** a new check, `round_words`, fails when a pack's banned words are spoken:
  - System design and behavioural: code, coding, "problem one/two", "write the code".
  - Online assessment: hints and follow-up questions.

## Versioning and owner review

- **Versions:** `RULES_VERSION = "rules1"`, `POLICY_VERSION = "pol2"`, and a `PREP_VERSION` bump.
- **Owner review:** the pack texts are PRODUCT IP DRAFTS. Pack files carry a header saying so. The owner reviews the five non-DSA packs
  before `LIVE_INTERVIEWER_AVAILABLE` opens non-DSA rounds.

## Acceptance

- **Lossless DSA:**
  - Every sentence of today's `TALKER_RULES` and `DIRECTOR_RULES`, frozen in a fixture before the split, appears in the composed DSA talker and
    director text (unit test). Sentences may move between lines and sections; none may be lost or reworded.
  - A DSA blueprint's talker prefix differs from today's only in where sentences sit. The DSA pack's level overlays are empty in v1:
    the blueprint's `level_expectations` already carries level, and a new overlay would change DSA behaviour.
- **Pack contents:** each pack composes for all three bands, holds no banned word for its own round, and carries the flags above (unit
  tests).
- **Benches:**
  - `bench-blueprints.ts` across personas × round types produces a `rules` block with the right pack.
  - `judge_blueprints.py` gets one more question: "does the interviewer's rule set fit this round type?"
- **Rehearsals:** one paid rehearsal per non-DSA pack with zero `round_words` fails. This is pending OpenRouter credit; the owner runs it.
- **Tests:** written but not run by the builder (owner's standing rule). The owner runs pytest.

## Left to the builder

- The exact module layout. Suggested: `app/rounds/` with `base.py`, `compose.py` and one file per pack.
- How `item_rules` for a culture slot reach the turn: a state-block section or a prefix section switched by the live state. Keep the
  prefix cache stable; a state-block section is preferred.
- The wording of every pack's rules, within the standards above, in the voice of the existing DSA rules.

## Sequencing

The addressed-to-interviewer follow-up wave (`.superpowers/sdd/2026-10-19-addressed-to-interviewer/`) edits `run.py` and `prompts.py`. This
work starts only after it lands, and takes `TALKER_RULES` as it stands then.
