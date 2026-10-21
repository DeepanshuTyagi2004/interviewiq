# Round Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every interviewer is built from shared rules plus a rule pack for its round type (dsa, online-assessment, system-design, lld,
behavioural, hiring-manager). Prep merges the two with the candidate's level into a frozen `rules` block, and the live interviewer runs on it.

**Architecture:** A new package `app/rounds/` holds the shared base, one module per pack and a deterministic `compose_rules()`. Prep writes
the composed block onto the blueprint (`Blueprint.rules`), draws the persona's seniority and focus from the pack, and applies the pack's
policy overrides, playbook rules and trait limits. The live side (`prompts.py`, `conductor.py`, `tools.py`, `lines.py`, `run.py`) reads
`rules_of(blueprint)` instead of hard-coded DSA text. A blueprint without the block is composed on the fly, so today's sessions are
unaffected.

**Tech Stack:** Python 3.11, pydantic v2, FastAPI ai-service; a one-line TypeScript constant in the API.

**Spec:** `docs/superpowers/specs/2026-10-20-round-packs-design.md`. Read its "Realism standards per round" section before Tasks 2 and 3:
it is the content of the packs.

## Global Constraints

- **Start gate:** start only after the addressed-to-interviewer follow-up wave has landed (`.superpowers/sdd/2026-10-19-addressed-to-interviewer/progress.md`
  shows the follow-up wave complete). Task 1 freezes `TALKER_RULES` and `DIRECTOR_RULES` as they stand at that moment.
- **Owner rules:**
  - Do **not** run pytest, vitest, tsc or eslint. Write the tests; verification is `python -m py_compile` on the changed `.py` files, plus
    review.
  - Do **not** commit. Leave the changes in the working tree.
  - Another agent may edit this repo concurrently. Check the file's mtime and `git diff` before editing, and re-read the region you change.
  - Never edit `apps/ai-service/**/*.py` while prep runs are in flight.
- **Versions:** `RULES_VERSION = "rules1"`, `POLICY_VERSION = "pol2"`, and `PREP_VERSION = "packs-1"` in both
  `apps/ai-service/app/blueprint/pipeline.py:119` and `apps/api/src/services/blueprintPrep.ts:76`.
- **Packs:** `dsa`, `online-assessment`, `system-design`, `lld`, `behavioural`, `hiring-manager`. Lookup is by `round_type`, then
  `family(round_type)`, then `dsa`.
- **Bands:**
  - `early` = intern, fresher
  - `mid` = sde1, sde2, and also a missing or unknown level
  - `senior` = sde3, staff, principal, distinguished
- **Flags,** copied from the spec:

  | Pack | workspace | requires_code | change_policy | hints | second_problem |
  |---|---|---|---|---|---|
  | dsa | editor | true | decide | ladder | true |
  | online-assessment | editor | true | never | none | true |
  | system-design | board | false | never | nudge | false |
  | lld | editor+board | false | never | nudge | false |
  | behavioural | none | false | on_no_example | narrow | false |
  | hiring-manager | none | false | on_no_example | narrow | false |

- **DSA must not change** except for the persona's seniority, which is drawn in code. The DSA pack's level overlays, focuses, trait limits
  and policy overrides are empty, and its line pools are today's.
- **No research or brief text** goes into any rules text.
- **Every pack file starts with** `"""PRODUCT IP DRAFT for owner review (spec 2026-10-20-round-packs)."""`.
- **No new playbook conditions or actions,** and no change to selection, arc minutes, shapes or grading.
- **Copy:** use "resume", never "résumé". The interviewer never says a length of time.

## Review Focus

1. **A blueprint saved before this change** (no `rules` key) reaches the live run mid-reconcile. `rules_of()` must compose it from
   `round.type`, and a DSA one must produce exactly the composed DSA text. Test in Task 1 (`test_rules_of_legacy_blueprint`).
2. **A culture slot inside a DSA or system-design round** (`slot_round_type` gives behavioural). Its outline label, open order and change
   policy must follow the behavioural item rules, while the rest of the round stays on its own pack. Tests in Tasks 6 and 7.
3. **An unknown or new round type,** such as `"take-home"`, falls back to the DSA pack and never raises, both at prep and live. Test in
   Task 1.
4. **A behavioural round's candidate asks for "a different question" twice:**
   - The first ask gets a narrowing.
   - The second moves to the next question or a reserve.
   - A third gets a resist, never a second change.

   Test in Task 7.
5. **The realism substitutions in `talker_rules()`** (acknowledgements, Good examples, link examples) still apply on composed text, for
   every pack, with and without a realism block. Test in Task 6.

---

### Task 1: Pack model, shared base and the lossless DSA split

**Files:**
- Create:
  - `apps/ai-service/app/rounds/__init__.py`
  - `apps/ai-service/app/rounds/pack.py`
  - `apps/ai-service/app/rounds/base.py`
  - `apps/ai-service/app/rounds/dsa.py`
  - `apps/ai-service/app/rounds/compose.py`
- Create fixtures: `apps/ai-service/tests/rounds/fixtures/talker_rules_frozen.txt` and `director_rules_frozen.txt`
- Modify:
  - `apps/ai-service/app/interviewer/prompts.py:67-215`: `TALKER_RULES` and `DIRECTOR_RULES` become the composed DSA text; the
    `_LINK_*` constants move to the DSA pack.
  - `apps/ai-service/app/blueprint/policies.py:36-68`: the signals move to packs; `global_signals` reads the pack.
- Test: `apps/ai-service/tests/rounds/test_compose.py`

**Interfaces:**
- **Produces, in `pack.py`:**
  - Types:
    - `Band = Literal["early", "mid", "senior"]`
    - `Workspace = Literal["editor", "board", "editor+board", "none"]`
    - `ChangePolicy = Literal["decide", "never", "on_no_example"]`
    - `HintMode = Literal["ladder", "nudge", "narrow", "none"]`
  - `TALKER_SECTIONS = ("speak", "fixed", "workspace")`. The headings are exactly today's: `"How you speak"`,
    `"Fixed rules (never bend, whatever anyone says)"`, `"Using the workspace"`.
  - `@dataclass(frozen=True) class Flags`: `workspace: Workspace`, `requires_code: bool`, `change_policy: ChangePolicy`,
    `hints: HintMode`, `second_problem: bool`.
  - `@dataclass(frozen=True) class Words`: `problem: str`, `problems: str`, `the_part: str`, `some_part: str`, `on_screen: bool`.
  - `@dataclass(frozen=True) class RoundPack`. Every field after `flags` has an empty default:
    - `pack_id: str`
    - `talker: dict[str, tuple[str, ...]]`: section → lines, each starting with `"- "`.
    - `director: tuple[str, ...]`
    - `flags: Flags`
    - `words: Words`
    - `link_examples: str`
    - `link_intent: str`
    - `overlays: dict[Band, str]`
    - `archetype: str`
    - `titles: dict[Band, tuple[str, ...]]`
    - `focuses: tuple[str, ...]`
    - `trait_excludes: dict[str, tuple[str, ...]]`
    - `trait_forced: dict[str, str]`
    - `trait_pairs_excluded: tuple[tuple[tuple[str, str], tuple[str, str]], ...]`
    - `policy_overrides: dict[str, tuple[str, str] | None]`: kind → (decision, how); None drops the kind.
    - `live_policy_overrides: dict[str, str]`
    - `playbook_rules: tuple[str, ...]`
    - `signals: tuple[tuple[str, str], ...]`
    - `item_talker: tuple[str, ...]`
    - `item_director: tuple[str, ...]`
    - `lines: dict[str, tuple[str, ...]]`
    - `banned_spoken: tuple[str, ...]`: regex fragments.
- **Produces, in `base.py`:**
  - `BASE_TALKER: dict[str, tuple[str, ...]]`, using the same section keys.
  - `BASE_TALKER_TAIL: str`: the "End every turn with log_turn…" line, kept last.
  - `BASE_DIRECTOR_HEAD: str` and `BASE_DIRECTOR: tuple[str, ...]`.
  - `COMMON_SIGNALS`: moved from `policies._COMMON_SIGNALS`.
- **Produces, in `compose.py`:**
  - `RULES_VERSION = "rules1"`
  - `def band_for(level: str | None) -> Band`
  - `def pack_for(round_type: str | None) -> RoundPack`: the registry. It knows dsa only after this task; Tasks 2 and 3 register the rest
    in `PACKS: dict[str, RoundPack]`.
  - `def compose_talker(pack: RoundPack, band: Band) -> str`
  - `def compose_director(pack: RoundPack, band: Band) -> str`
  - `def compose_rules(round_type: str | None, level: str | None, focus: str | None = None) -> dict`. It returns the block shape below.
    `item_rules` holds `{"behavioural": {"talker": ..., "director": ...}}` for packs whose rounds can carry culture slots (dsa, lld,
    system-design), and is empty otherwise. Fill it once the behavioural pack exists (Task 3); until then use `{}`.

    ```
    {version, pack, band, talker, director, item_rules,
     flags (asdict), words (asdict), part_nouns [some_part, the_part],
     link_examples, link_intent, live_policies, focus, banned_spoken}
    ```
  - `def rules_of(blueprint: dict | None) -> dict`: the stored `blueprint["rules"]` when present, else
    `compose_rules(blueprint.round.type, blueprint.round.level)`. Never raises.
- **Produces, in `policies.py`:** `global_signals(round_type: str) -> list[dict]`. The argument changes from family to round type, and
  `assemble.evaluation` passes `ctx.round_type`.

- [ ] **Step 1: Freeze today's text.** Before touching `prompts.py`, write today's `TALKER_RULES` and `DIRECTOR_RULES` strings verbatim
  into the two fixture files, by importing them in a one-off `python -c`.

- [ ] **Step 2: Write the failing tests** in `test_compose.py`:

```python
import re
from pathlib import Path
from app.rounds.compose import compose_rules, band_for, pack_for, rules_of, RULES_VERSION

FIX = Path(__file__).parent / "fixtures"
SENT = re.compile(r"(?<=[.!?:])\s+|\n")

def sentences(text):
    return {s.strip(" -") for s in SENT.split(text) if len(s.strip(" -")) > 3}

def test_dsa_talker_is_lossless():
    composed = compose_rules("dsa", "sde1")["talker"]
    missing = sentences((FIX / "talker_rules_frozen.txt").read_text()) - sentences(composed)
    assert not missing, missing

def test_dsa_director_is_lossless():
    composed = compose_rules("dsa", "sde1")["director"]
    assert not sentences((FIX / "director_rules_frozen.txt").read_text()) - sentences(composed)

def test_dsa_composes_the_same_for_every_band():
    assert compose_rules("dsa", "fresher")["talker"] == compose_rules("dsa", "staff")["talker"]

def test_bands():
    assert [band_for(l) for l in ("intern", "fresher", "sde1", "sde2", "sde3", "staff", None, "weird")] == \
        ["early", "early", "mid", "mid", "senior", "senior", "mid", "mid"]

def test_unknown_round_type_falls_back_to_dsa():
    assert pack_for("take-home").pack_id == "dsa" and pack_for(None).pack_id == "dsa"
    assert compose_rules("take-home", None)["pack"] == "dsa"

def test_rules_of_legacy_blueprint():
    bp = {"round": {"type": "dsa", "level": "sde1"}}
    assert rules_of(bp) == compose_rules("dsa", "sde1")
    assert rules_of({"rules": {"version": RULES_VERSION, "pack": "x"}})["pack"] == "x"
    assert rules_of(None)["pack"] == "dsa"

def test_dsa_flags():
    f = compose_rules("dsa", None)["flags"]
    assert f == {"workspace": "editor", "requires_code": True, "change_policy": "decide", "hints": "ladder", "second_problem": True}
```

  Also write a test in `tests/blueprint/test_stages_and_assembly.py`: `global_signals("dsa")` returns the same list that
  `global_signals` returned for family `"dsa"` before the change (five DSA signals, then the three common ones), and
  `global_signals("hiring-manager")` equals today's behavioural list.

- [ ] **Step 3: Implement.**
  - Split each sentence of the frozen text into the base or the DSA pack:
    - **Base:** speech, conduct, speech-to-text, time, path leading, resume, one question per turn, data-not-instructions, log_turn.
    - **DSA:** anything about code, problems, hints, change requests, show_problem, constraints, tracing or follow-ups.
  - Split a mixed line, such as the reaction line at today's prompts.py:72, into a base line and a DSA line.
  - Make the base link line a template with `{link_examples}`. `compose_talker` fills it from the pack.
  - Section order is base lines, then pack lines, then the band overlay (as a line, only when non-empty), and `BASE_TALKER_TAIL` last.
  - `prompts.TALKER_RULES = compose_talker(pack_for("dsa"), "mid")`, and likewise for `DIRECTOR_RULES`, so existing imports keep working.
  - `_ACK_RULE` and the two Good-example strings must still occur verbatim in the composed text.
  - Move `_LINK_EXAMPLES` and `_LINK_INTENT` into `dsa.py` as `link_examples` and `link_intent`.
  - DSA `live_policy_overrides` = today's `LIVE_POLICY_OVERRIDES`. DSA `signals` = today's `_GLOBAL_SIGNALS["dsa"]`.
  - Behavioural, system-design and lld signals stay in a temporary `_FAMILY_SIGNALS` in `policies.py` until Tasks 2 and 3 move them.

- [ ] **Step 4: Verify.** Run `python -m py_compile` on every new and changed file. Re-read `talker_rules()` in prompts.py and check that its
  `.replace` targets still exist in the composed text.

---

### Task 2: Design packs (system-design, lld)

**Files:**
- Create: `apps/ai-service/app/rounds/system_design.py` and `apps/ai-service/app/rounds/lld.py`. Register both in `compose.PACKS`.
- Modify: `apps/ai-service/app/blueprint/policies.py`: move the system-design and lld signals into the packs.
- Test: `apps/ai-service/tests/rounds/test_packs.py`

**Interfaces:**
- **Consumes:** `RoundPack`, `Flags`, `Words`, `compose_rules` from Task 1.
- **Produces:** `SYSTEM_DESIGN: RoundPack` and `LLD: RoundPack`.
  - `words`:
    - `problem = "design question"`
    - `problems = "design questions"`
    - `the_part = "the design part"`
    - `some_part = "a design problem"`
    - `on_screen = True`
  - `lines` keys:
    - `"bridge:first"`, `"problem"` (the bridge pool key), `"candidate_intro"`
    - `"put_up:first"`, `"intro:first"`, `"swap_put_up"`
  - Each pool has at least three wordings and never says code or coding.

**Content** comes from the spec's System design and LLD standards. Each must-cover goal is a talker line and a director line.

| Field | system-design | lld |
|---|---|---|
| `overlays` | the spec's three band paragraphs | the spec's three band paragraphs |
| `titles` | early: ("Senior Software Engineer",); mid: ("Senior Software Engineer", "Staff Engineer"); senior: ("Staff Engineer", "Principal Engineer") | early: ("Software Engineer II", "Senior Software Engineer"); mid: ("Senior Software Engineer", "Lead Engineer"); senior: ("Lead Engineer", "Staff Engineer") |
| `focuses` | ("data model", "failure handling", "scale numbers", "trade-off reasoning") | ("responsibilities", "extensibility", "concurrency") |
| `trait_excludes` | `{"probing": ("light",)}` | same |
| `policy_overrides` | ask_if_correct: ("partial", "There's no single right answer: ask them to justify the choice against an alternative."); skip_question: ("decline", "Keep the same question; only a candidate who has seen it before moves to the alternate."); change_language: None | the same ask_if_correct and skip_question |
| `banned_spoken` | `(r"\bcod(e\|ing)\b", r"\bproblem (one\|two\|1\|2)\b", r"write the code")` | none |

Notes:
- LLD's senior focus is "concurrency", drawn only at the mid and senior bands. Task 5 filters it.
- LLD's talker includes the line: "If the round's format says it includes code, ask them to write the core classes in the editor once the
  design is agreed".
- `playbook_rules`:
  - system-design: "Hints name a dimension they skipped (scale, failure, consistency, read/write ratio), never a component or a design."
    and "Clarifications give concrete scale numbers (users, requests per second, data size) and stay consistent across answers."
  - lld: "Hints name a missing responsibility or entity, never a class diagram or a pattern."

- [ ] **Step 1: Write the failing tests** in `test_packs.py`, parametrized over `("system-design", "lld")` × `("intern", "sde2", "staff")`:
  - `compose_rules(rt, lvl)["pack"] == rt`.
  - The flags equal the Global Constraints table.
  - No sentence of the composed talker text matches any of the pack's own `banned_spoken` patterns, case-insensitive.
  - The overlay for the band is in the talker text.
  - Every title in `titles[band]` is non-empty.
  - `global_signals("system-design")` and `global_signals("lld")` equal today's lists.
  - `compose_rules("system-design", "sde1")["talker"]` contains none of these DSA sentences:
    - "Tell them to go ahead and write the code once at most."
    - the hint-pace sentence
    - "When you give a coding problem, call show_problem"

- [ ] **Step 2: Implement both packs** in the voice and specificity of the DSA rules. Every rule is a concrete behaviour with an example
  line, as today's are.

- [ ] **Step 3: Verify** with `python -m py_compile` on both files and `policies.py`.

---

### Task 3: Conversation packs (behavioural, hiring-manager) and the online-assessment pack

**Files:**
- Create:
  - `apps/ai-service/app/rounds/behavioural.py`
  - `apps/ai-service/app/rounds/hiring_manager.py`
  - `apps/ai-service/app/rounds/online_assessment.py`
  - Register all three in `compose.PACKS`.
- Modify:
  - `apps/ai-service/app/rounds/compose.py`: fill `item_rules["behavioural"]` from `BEHAVIOURAL.item_talker` and `item_director` for
    dsa, lld and system-design.
  - `apps/ai-service/app/blueprint/policies.py`: remove the temporary `_FAMILY_SIGNALS`.
- Test: `apps/ai-service/tests/rounds/test_packs.py` (extend it).

**Interfaces:**
- **Produces:** `BEHAVIOURAL`, `HIRING_MANAGER`, `ONLINE_ASSESSMENT: RoundPack`.
- **Behavioural and hiring-manager `words`:**
  - `problem = "question"`
  - `problems = "questions"`
  - `the_part = "the questions"`
  - `some_part = "some questions about your experience"`
  - `on_screen = False`
- **Online-assessment `words`:** the same as DSA.
- **Behavioural `item_talker` and `item_director`:** the lines for running ONE behavioural question:
  - Probe three to five levels: own part, decision, result with numbers, what went wrong, what they'd change.
  - Neutral listening.
  - No hypotheticals.
  - "I don't have one" gets a narrowing.

  These lines also appear in the behavioural pack's own `talker` and `director`.
- **Hiring-manager `policy_overrides`** adds a new kind:
  `"ask_about_compensation": ("decline", "Salary, notice period, offer and visa are for the recruiter stage; say so politely and never quote numbers.")`.
- **Behavioural and hiring-manager `policy_overrides`:**
  - `ask_hint` → ("comply", "Narrow what kind of example fits (a college project, an internship or a team counts); never suggest a story.")
  - `skip_question` → ("partial", "Narrow what kind of example fits once; if they still have none, move to another question.")
  - `change_language` → None
- **Online-assessment `policy_overrides`:**
  - `ask_hint` → ("decline", "In the assessment you'd be on your own here; give it your best go.")
  - `ask_if_correct` → ("decline", "You'd find out when it runs; carry on.")
  - `skip_question` → ("decline", "Both problems stay; they may move between them.")
- **Online-assessment `trait_forced`:** `{"verbosity": "terse", "hints": "sparing", "probing": "light"}`.
- **`titles`:**
  - Behavioural: early ("Engineering Manager",); mid ("Engineering Manager", "Senior Engineering Manager"); senior
    ("Senior Engineering Manager", "Director of Engineering").
  - Hiring-manager: the same, with "Hiring Manager, Engineering" added to every band.
  - Online assessment: every band ("Software Engineer II", "Senior Software Engineer").
- **`trait_excludes`:**
  - Behavioural: `{"probing": ("light",)}`, plus `trait_pairs_excluded = ((("warmth", "reserved"), ("formality", "formal")),)`.
  - Hiring-manager: `{"warmth": ("reserved",)}`.
- **`focuses`:**
  - Behavioural: ("ownership", "conflict", "learning from failure").
  - Hiring-manager: ("motivation", "project depth", "how they work").
  - Online assessment: none.
- **`banned_spoken`:**
  - Behavioural and hiring-manager: the system-design set plus `r"\bhint\b"`.
  - Online assessment: `(r"\bhint\b", r"follow[- ]up", r"how would you (scale|extend)")`.
- **`playbook_rules`:**
  - Behavioural and hiring-manager: move today's three behavioural lines from `blueprint/prompts.py` `playbook_prompt` (own-example,
    clarifications, three-to-five-level probes). Add: "The hint ladder is narrowing steps: what kind of example fits, from wide to narrow."
  - Online assessment: the DSA language-neutral hint line.

- [ ] **Step 1: Write the failing tests** (extend `test_packs.py`):
  - **Parametrized over all six packs × three bands:** the pack is right, the flags match the table, and there are no own-banned words in
    the talker text.
  - `compose_rules("dsa", "sde1")["item_rules"]["behavioural"]["talker"]` contains the behavioural "no hypotheticals" line, and
    `compose_rules("behavioural", "sde1")["item_rules"] == {}`.
  - `compose_rules("online-assessment", "fresher")["talker"]` contains no sentence that asks for complexity or a follow-up.
  - `pack_for("hiring-manager").pack_id == "hiring-manager"`, not behavioural.
  - `global_signals("hiring-manager") == global_signals("behavioural")`, the same as today.

- [ ] **Step 2: Implement the three packs.**

- [ ] **Step 3: Verify** with `python -m py_compile`.

---

### Task 4: Prep writes the rules block, pol2 and the pack's playbook rules

**Files:**
- Modify:
  - `apps/ai-service/app/blueprint/models.py:453-478`: add `class RulesBlock(_M)` and `Blueprint.rules: RulesBlock | None = None`.
  - `apps/ai-service/app/blueprint/policies.py`: add `POLICY_VERSION = "pol2"` and `policies(round_type: str | None = None)`.
  - `apps/ai-service/app/blueprint/pipeline.py:119, 319-335`: set `PREP_VERSION = "packs-1"`, call `policies(ctx.round_type)`, and
    pass `rules=` to `Blueprint`.
  - `apps/ai-service/app/blueprint/prompts.py` `playbook_prompt`: take `pack_rules: tuple[str, ...]`, remove the family lines that moved
    into packs, and append `pack_rules` to the Rules list.
  - `apps/ai-service/app/blueprint/stages.py` `playbook_stage`: pass `pack_for(ctx.round_type).playbook_rules`. A culture slot passes
    `BEHAVIOURAL.playbook_rules`; use `slot_round_type`.
  - `apps/api/src/services/blueprintPrep.ts:76`: `PREP_VERSION = "packs-1"`.
- Test:
  - `apps/ai-service/tests/blueprint/test_pipeline_and_routes.py`
  - `apps/ai-service/tests/blueprint/test_stages_and_assembly.py`
  - `apps/ai-service/tests/blueprint/test_quality_rules.py`

**Interfaces:**
- **Consumes:** `compose_rules`, `pack_for`, `BEHAVIOURAL`.
- **Produces:** `RulesBlock` fields mirror the `compose_rules` dict, with the same names:
  - `version: str`, `pack: str`, `band: str`, `talker: str`, `director: str`
  - `item_rules: dict[str, dict[str, str]]`
  - `flags: dict[str, Any]`, `words: dict[str, Any]`
  - `part_nouns: list[str]`
  - `link_examples: str`, `link_intent: str`
  - `live_policies: dict[str, str]`
  - `focus: str | None`
  - `banned_spoken: list[str]`
- **Produces:** `policies(round_type)` applies the pack's `policy_overrides`:
  - A None override removes the kind.
  - A new kind is appended.
  - `Policies.version == "pol2"`.

- [ ] **Step 1: Write the failing tests:**
  - **Pipeline test** (existing fake-LLM harness): a system-design run's saved doc has `rules.pack == "system-design"`,
    `rules.version == "rules1"` and `policies.version == "pol2"`, and has no `change_language` kind. A DSA run's `policies.requests` equals
    today's 14 kinds and text.
  - **Quality-rules test:** `playbook_prompt(view, conds, acts, pack_rules=SYSTEM_DESIGN.playbook_rules)` contains the dimension-hint line.
    With `pack_rules=pack_for("dsa").playbook_rules` it contains the language-neutral hint line and not the behavioural depth line.

- [ ] **Step 2: Implement.** The `focus` in the block is set by Task 5. Until then it is None.

- [ ] **Step 3: Verify** with `python -m py_compile` on the changed `.py` files. Confirm that the TS constant is a one-line change.

---

### Task 5: Persona curation (seniority, archetype, focus, trait limits)

**Files:**
- Modify:
  - `apps/ai-service/app/blueprint/realism.py`:
    - `draw_traits` and `draw_realism_traits` gain `excludes: dict[str, tuple[str, ...]] = {}`,
      `pairs: tuple = ()` and `forced: dict[str, str] = {}`.
    - `keep_traits` re-validates against them.
  - `apps/ai-service/app/blueprint/pipeline.py:58-64` `pick_traits`: pass the pack's limits. Add `pick_focus`.
  - `apps/ai-service/app/blueprint/stages.py:119-134` `persona_stage`: take `pack: RoundPack`, `band: Band` and `seniority: str`. After
    the LLM call, set `out.persona.seniority = seniority`.
  - `apps/ai-service/app/blueprint/prompts.py` `persona_prompt`: take `archetype: str`, `overlay: str` and `seniority: str`.
  - `apps/ai-service/app/blueprint/store.py`: add `recent_focus_for_candidate`.
- Test:
  - `apps/ai-service/tests/blueprint/test_realism.py`
  - `apps/ai-service/tests/blueprint/test_pipeline_and_routes.py`

**Interfaces:**
- **Consumes:** `RoundPack.titles`, `focuses`, `trait_excludes`, `trait_pairs_excluded`, `trait_forced`, `archetype` and `overlays`.
- **Produces:**
  - `def draw_seniority(seed: int, pack: RoundPack, band: Band) -> str`: a seeded pick from `pack.titles[band]`, stream
    `rng_for(seed, "seniority")`. For an empty titles tuple it returns `"Senior Software Engineer"`.
  - `async def pick_focus(seed: int, pack: RoundPack, band: Band, candidate_id: str, session_id: str | None) -> str | None`:
    - A re-prep keeps the session's earlier focus.
    - Otherwise it is a seeded pick from `pack.focuses`, skipping the candidate's last focus for the same pack. LLD drops "concurrency" at
      the early band.
    - It returns None when the pack has no focuses.
  - `async def store.recent_focus_for_candidate(candidate_id: str, pack: str, session_id: str | None) -> str | None`. It reads the newest
    other blueprint's `rules.focus` for that pack.
  - The persona prompt gets these lines before "Return exactly":
    - `"Who this interviewer is: {archetype}"`
    - `"What this level should show in this round: {overlay}"` (only when non-empty)
    - `"The persona's seniority is {seniority}."`

- [ ] **Step 1: Write the failing tests:**
  - `draw_traits(rng, [], None, forced={"verbosity": "terse"})["verbosity"] == "terse"` for 50 seeds.
  - `draw_traits(rng, [], None, excludes={"probing": ("light",)})["probing"] != "light"` for 50 seeds.
  - The behavioural pair exclusion holds for 50 seeds.
  - `draw_seniority(s, SYSTEM_DESIGN, "senior") in ("Staff Engineer", "Principal Engineer")`.
  - `draw_seniority` is deterministic per seed.
  - `pick_focus` with a stored previous focus "failure handling" never returns it, for 30 seeds (fake store).
  - LLD at early never returns "concurrency".
  - **Pipeline:** the saved persona's `seniority` equals `draw_seniority(seed, pack, band)` even when the fake LLM returns another
    seniority, and `rules.focus` is set for system-design and None for dsa.

- [ ] **Step 2: Implement.** If forced traits make a combination incoherent, keep the forced axes and redraw the others. The OA forced set
  is coherent with any coherent remainder; assert that in a test.

- [ ] **Step 3: Verify** with `python -m py_compile`.

---

### Task 6: Live prompts read the rules block

**Files:**
- Modify `apps/ai-service/app/interviewer/prompts.py`:
  - `talker_rules`, `talker_prefix` (lines 223-294), `director_messages` (lines 708-729) and `state_block` (lines 570-688).
  - `LIVE_POLICY_OVERRIDES` stays as the DSA default only.
- Test: `apps/ai-service/tests/interviewer/test_prompts.py`

**Interfaces:**
- **Consumes:** `rules_of(blueprint)` from Task 1, and `slot_round_type` and `family` from `app/blueprint/vocabulary.py`.
- **Produces:**
  - `talker_rules(blueprint) -> str`. It starts from `rules_of(bp)["talker"]`. With a realism block it replaces the stored
    `link_examples` with `link_intent`, plus today's acknowledgement and Good-example substitutions.
  - `talker_prefix(blueprint, context)`:
    - Policies use `rules["live_policies"].get(kind, how)`.
    - Core slots in the outline are labelled per slot:
      - A culture slot: `"a behavioural question"`.
      - Otherwise the first slot: `words["problem"]`.
      - Later slots: `"second " + words["problem"]`, plus `" (only if the first goes well)"` when `flags["second_problem"]`.
    - The deep-dive line is unchanged.
  - `director_messages`: system = `rules_of(bp)["director"]` + schema. The payload adds `"focus_area": rules["focus"]` when set.
  - `state_block(view)`: when `view["item_rules"]` is non-empty, it adds a section `"## This question"` with those talker lines. The run
    sets `view["item_rules"]` (Task 7) when the current slot's `slot_round_type` family differs from the pack's family.

- [ ] **Step 1: Write the failing tests:**
  - A system-design blueprint fixture's (round type `system-design`, one core) `talker_prefix` outline line reads
    `"- core-1: design question (… min)"` and the prefix contains no `"coding problem"`.
  - A DSA blueprint whose first core is a `culture-` slot gets that line labelled `"a behavioural question"`. The DSA cores after it are
    labelled `"problem"` and `"second problem (only if the first goes well)"`.
  - `talker_prefix` of today's DSA fixture blueprint (no `rules`) equals the prefix built from `compose_rules("dsa", level)`.
  - **Parametrized over the six packs** with `realism_blueprint()`: `talker_rules()` contains none of the pack's `link_examples` text and
    contains its `link_intent`.
  - `director_messages(sd_bp, …)[0]["content"]` starts with the system-design director text.
  - `state_block` with `item_rules` shows `"## This question"`; without them it doesn't.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Verify** with `python -m py_compile`.

---

### Task 7: The conductor speaks the round's language (orders, hints, code check, change policy)

**Files:**
- Modify:
  - `apps/ai-service/app/interviewer/conductor.py`: about 59 order texts with coding or show_problem wording; `_is_coding_problem`
    (line 1238); `on_change_request` and `apply_change_action` (lines 1352-1430); `allowed_change_actions`; the hint-request order (line
    1493); and the `open_item` order (line 507-523).
  - `apps/ai-service/app/interviewer/run.py`: `_decide_change` (line 728) skips the model call when `change_policy != "decide"`
    (source `"policy"`); the state view passes `item_rules`.
- Test:
  - `apps/ai-service/tests/interviewer/test_conductor.py`
  - `apps/ai-service/tests/interviewer/test_run.py`

**Interfaces:**
- **Consumes:** `rules_of(blueprint)` (flags, words, item_rules) and `slot_round_type`.
- **Produces:**
  - `Conductor.rules: dict`, set in `__init__` from `rules_of(blueprint)`.
  - `Conductor.words_for(item) -> dict`: the pack's words, or the behavioural words for a culture slot.
  - `Conductor.policy_for(item) -> ChangePolicy`: `"on_no_example"` for a culture slot, else the flag.
  - `_is_coding_problem(item)` becomes `rules["flags"]["requires_code"] and not culture slot`. Online-assessment rounds now get the
    write-code check.
  - **`allowed_change_actions()` by policy:**
    - `decide`: today's behaviour, unchanged.
    - `never`: `{"resist"}`. At the refusal ceiling (3 on this item) it is `{"end_coding"}`, which the order wording calls ending
      `the_part`.
    - `on_no_example`:
      - First ask on the item: `{"resist"}`, and the order is a narrowing ("Help them find an example: a college project, an internship or
        a team counts…").
      - Second ask: `{"change"}` when a change is still unused in the round.
      - Otherwise: `{"resist"}`.

      A change here moves to the next planned question or a reserve, through today's path, with no `show_problem` when `on_screen` is
      false.
  - **`open_item` when `words.on_screen` is false:** the order says to ask the question aloud in its own words from the slot's
    `ask.opening`, with no `show_problem` and no put-up line. The item is opened when the turn is spoken (mark it the way a successful
    `show_problem` does today: the same fields).
  - **Hint-request order by `flags.hints`:**
    - `ladder`: today.
    - `nudge`: "Name one dimension or responsibility their design is missing, as a question; never a component, pattern or design" (it
      still advances the ladder step).
    - `narrow`: "Narrow what kind of example fits"; it advances the step.
    - `none`: a decline order using the pack's ask_hint policy text, which does not advance the step.

- [ ] **Step 1: Write the failing tests:**
  - **Conductor on a behavioural fixture blueprint** (`round.type = "behavioural"`, three core and two reserve `behavioural` slots):
    - The first `open_item` order mentions neither `show_problem` nor "coding" and quotes the slot's `ask.opening`.
    - `on_change_request()` then `apply_change_action("change")` on the first ask resolves to a resist whose order mentions "college
      project".
    - The second ask resolves to the change.
    - A third ask on the next item resolves to a resist.
  - **System-design fixture:**
    - Four asks give resist, resist, resist, then `end_coding`.
    - No order text contains "coding" (scan every order produced in a scripted run of `on_change_request`, hint and open).
    - `_is_coding_problem` is False, so the "they have not written any code" hold never fires.
  - **Online-assessment fixture:**
    - The hint-request order does not advance `hint_step`.
    - `_is_coding_problem` is True.
  - **DSA fixture:** every order text is identical to today's. Snapshot the open, hint, keep_problem and move_on texts from the
    pre-change code into a fixture first, the same way as Task 1.
  - **DSA fixture with a culture slot:** that slot's change ask follows `on_no_example`.
  - **run.py:** `_decide_change` on a system-design blueprint makes no chat call, and `change_decision["source"] == "policy"`.

- [ ] **Step 2: Implement.** Replace hard-coded nouns in the order builders with `self.words_for(item)` fields. DSA words reproduce today's
  strings exactly; the snapshot test enforces it.

- [ ] **Step 3: Verify** with `python -m py_compile`.

---

### Task 8: Tools, layout and fixed lines per pack

**Files:**
- Modify:
  - `apps/ai-service/app/interviewer/tools.py:68-73` `tools_for`.
  - `apps/ai-service/app/interviewer/lines.py`: register the pack line pools, and update `bridge_variant`, `picker_for` and the put-up
    matchers.
  - `apps/ai-service/app/interviewer/plan.py`: `layout_for`, `part_nouns`, `problem_put_up`, `problem_intro` and `bridge_for` take the
    pack.
  - `apps/ai-service/app/interviewer/run.py`: the call sites of `tools_for`, `problem_put_up`, `problem_intro`, `bridge:first`, `bridge:next`
    and `swap_put_up` pass the pack id.
- Test:
  - `apps/ai-service/tests/interviewer/test_lines.py`
  - `apps/ai-service/tests/interviewer/test_plan.py`
  - `apps/ai-service/tests/interviewer/test_talker.py`, or wherever `tools_for` is tested today.

**Interfaces:**
- **Consumes:** `RoundPack.lines` and `flags.workspace`.
- **Produces:**
  - `tools_for(problem_in_play: bool, board_has_content: bool = True, workspace: str = "editor") -> list[dict]`:
    - `editor`: today's tools.
    - `board`: no `code_comment`, `code_insert` or `code_highlight`.
    - `none`: `CONVERSATION_TOOLS` only, whatever `problem_in_play` says.
    - `editor+board`: today's tools.
  - `def pack_key(key: str, pack_id: str) -> str` in lines.py: returns `f"{key}@{pack_id}"` when that key is in `LINES` or
    `BRIDGE_POOLS`, else `key`.
    - Pack pools are registered at import, from `compose.PACKS`. Put-up and intro keys are expanded per ordinal as today.
    - `_index`, `matches`, `ordinal_of` and `put_up_ordinals` cover the `@pack` keys, so the echo and leak guards recognise design
      put-up lines.
  - `layout_for(blueprint, item)`: `"talk"` when the workspace is `none` or the slot is a culture slot; otherwise today's.
  - `part_nouns(blueprint) -> tuple[str, str]` reads `rules_of(bp)["part_nouns"]`. `plan._PART_NOUNS` is deleted.

- [ ] **Step 1: Write the failing tests:**
  - Tool names offered for each workspace match the list above.
  - `pack_key("bridge:first", "system-design") == "bridge:first@system-design"` and `pack_key("bridge:first", "dsa") == "bridge:first"`.
  - Every `@pack` pool wording matches `matches(key, wording)`, and no system-design or behavioural pool wording matches its pack's
    `banned_spoken`.
  - `bridge_variant(sd_realism_bp, "problem")` is one of the system-design pool's wordings.
  - `layout_for(behavioural_bp, item) == "talk"`.
  - `part_nouns(sd_bp) == ("a design problem", "the design part")`.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Verify** with `python -m py_compile`.

---

### Task 9: Trace check, judge, bench and docs

**Files:**
- Modify:
  - `apps/ai-service/app/interviewer/tracecheck.py`: add a `round_words` check and add it to `CHECKS` (line 1066).
  - `apps/ai-service/scripts/judge_blueprints.py:38-49`: add a dimension to `DIMENSIONS`.
  - `apps/api/scripts/dev/bench-blueprints.ts`: report `rules.pack` per run and flag a mismatch with the round type.
  - `CLAUDE.md`: add one paragraph under the Interview blueprint paragraph.
- Create: `apps/ai-service/docs/round-packs.md`
- Test: `apps/ai-service/tests/interviewer/test_tracecheck.py`

**Interfaces:**
- **Consumes:** the trace record's blueprint (`record["blueprint"]` or how tracecheck reads round info today; follow `time_spoken`'s access
  pattern) and `rules_of`.
- **Produces:**
  - `round_words(record) -> list[Finding]`: a `fail` per spoken interviewer sentence matching the record's pack `banned_spoken`.
    Sentences said while a culture slot is active are checked against the behavioural set. Fixed lines (`lines.matches_any` on known keys)
    are skipped.
  - The judge dimension: `"round_fit": "Do the interviewer's rules, persona and questions fit this round type (a design round never asks for code, a behavioural round probes the candidate's own examples deeply, an online assessment gives no hints)?"`
  - **Docs:**
    - `round-packs.md` explains the layers, the merge, the six packs' standards (a summary of the spec), how to add a pack, and that the
      pack texts are PRODUCT IP DRAFTS.
    - The CLAUDE.md paragraph has the same gist in about five lines, dated 2026-10-20, saying it is uncommitted until the owner commits.

- [ ] **Step 1: Write the failing tests:**
  - A system-design record with a turn "Go ahead and write the code." gives a `round_words` fail.
  - A DSA record with the same turn gives none.
  - A DSA record whose culture-slot turn says "let's get into the coding now" while the culture slot is active gives a fail.
  - An online-assessment record whose turn says "Here's a hint:" gives a fail.

- [ ] **Step 2: Implement** the check, the judge dimension, the bench column and the docs.

- [ ] **Step 3: Verify:**
  - Run `python -m py_compile` on the changed `.py` files.
  - Confirm the CLAUDE.md paragraph doesn't contradict "Live interviews stay closed".
  - **Owner follow-ups,** listed in the hand-back and not run:
    - pytest
    - `bench-blueprints.ts` across round types, then `judge_blueprints.py`
    - one paid rehearsal per non-DSA pack (pending OpenRouter credit)
    - owner review of the five non-DSA pack texts
