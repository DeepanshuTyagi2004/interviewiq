# Round packs

> PRODUCT IP DRAFT for owner review. The five non-DSA pack texts are drafts; the DSA pack is the interviewer's existing text, moved unchanged.
> Authority: `docs/superpowers/specs/2026-10-20-round-packs-design.md`. This page summarises it.

One shared interviewer runs every round. What differs by round type is a **pack**: the rules the talker (what is said) and the director
(what happens next) read, plus a few flags the conductor and tools obey.

## Layers and the merge

`app/rounds/compose.py` merges, with no LLM call:

1. **Shared base** (`app/rounds/base.py`): the rules every round obeys (never say a duration, one question at a time, the screen and tool rules).
2. **Round pack** (`app/rounds/<pack>.py`): chosen by round type, else the round type's family (`family()`), else `dsa`. Hiring manager and
   online assessment have their own packs; they are not folded into behavioural or DSA.
3. **Level overlay**: one text per band (early: intern, fresher; mid: sde1, sde2; senior: sde3 and up; a missing level is mid).

Per section the base lines come first, then the pack's; the overlay and the `log_turn` tail close the last section. The result is stored on the
blueprint as the `rules` block (`version rules2`, `pack`, `band`, `talker`, `director`, `item_rules`, `flags`, `words`, `part_nouns`,
`banned_spoken`, `live_policies`, `focus`), so an interview keeps the rules it was prepared with. A blueprint without `rules` is composed at
load from its round (`rules_of`), which for DSA gives the old text. `PREP_VERSION packs-1` makes the reconcile job re-prepare ready sessions.
Policies are `pol2` (pol1 plus per-pack overrides in `live_policies`).

A behavioural (`culture-`) slot inside a dsa, lld or system-design round runs on the behavioural pack's `item_rules` while it is active.

## Standard per pack

- **dsa**: problem on screen, never read aloud; two problems, the second only if the first went well; ladder hints; a request for a different
  problem is decided by the interviewer within hard limits.
- **online-assessment**: a quiet proctor. One line of instructions, answers only what the statement means, no hints, no follow-ups, no
  "how would you scale or extend".
- **system-design**: an open question; the candidate drives. The interviewer answers, pushes and plays devil's advocate, never leads, never
  asks for code, and does not speak of a "problem one/two".
- **lld**: machine-coding style object design of a bounded system; classes, interfaces and extension, with code on the editor; fundamentals-led
  variants keep the design as a warm-up.
- **behavioural**: questions about the candidate's own past; depth beats breadth. Probes their own examples (their role, the decision, the
  result), no hints, nothing about code. Banned words are the system-design set plus "hint".
- **hiring-manager**: the future manager assessing role fit; a warmer two-way conversation with must-cover goals and the candidate's questions.

## Trace check, judge, bench

- `round_words` (`app/interviewer/tracecheck.py`): a fail per interviewer sentence that matches the pack's `banned_spoken`. Fixed lines are
  skipped (tests cover them); a culture slot is judged by the behavioural set; a record with no blueprint gives no findings.
- Judge dimension `round_fit` in `scripts/judge_blueprints.py`.
- `apps/api/scripts/dev/bench-blueprints.ts` prints each run's pack and flags one that does not match the round type.

## Adding a pack

1. Create `app/rounds/<name>.py` starting with the PRODUCT IP DRAFT docstring; build a `RoundPack` (talker and director sections, three
   overlays, flags, words, link examples and intent, signals, `banned_spoken`, any `live_policy_overrides`).
2. Register it in `PACKS` in `compose.py` (and in `FAMILY_OF_ROUND` in `app/blueprint/vocabulary.py` if it is a new round type).
3. If its fixed lines differ, add `@<pack>` pools to `app/interviewer/lines.py`.
4. Bump `RULES_VERSION` (and `PREP_VERSION` if prep output changes) so stored blueprints are re-prepared.
5. Add tests, run the bench across the round type, then the judge. `app/rounds/` imports only the stdlib and `app.blueprint.vocabulary`.

## Versions

`RULES_VERSION rules2` (rules2, 2026-10-28: the DSA interviewer points to examples and never reads a whole test case aloud; prep was not re-run, stored blueprints keep their stricter rules1 text) · `POLICY_VERSION pol2` · `PREP_VERSION packs-1`.

## Owner follow-ups

- Review the five non-DSA pack texts before `LIVE_INTERVIEWER_AVAILABLE` opens non-DSA rounds.
- Run `bench-blueprints.ts` across round types, then `judge_blueprints.py`.
- One paid rehearsal per non-DSA pack (pending OpenRouter credit).
- Run the test suites (not run by the builder).
