# Decision gates (Jev) — design

Date: 2026-10-16 · Status: draft for approval · Scope: `apps/ai-service` only

## Intent

Some of our LLM calls only make a yes/no decision. In other cases, a cheap
yes/no could tell us an expensive call isn't needed at all. A decision model
(TypeSafe **Jev 1.14**, through OpenRouter) answers typed questions in about
70–500 ms. It costs about $0.04 per million input tokens and output is free.
Our current LLM calls take 10–60 s on free-tier Groq and Gemma quota.

Asking Jev first, and skipping the LLM when the answer is clearly "nothing
here", cuts LLM calls, quota pressure and pipeline time. Cost and latency have
not hurt yet. This is deliberate early optimisation: the user said "optimise
aggressively anywhere we can, but not at the cost of quality".

**The quality rule shapes the design.** Jev may only *skip* work the LLM
would have thrown away. It never writes content, never replaces generated
text, and never changes a decision that survives into a product output
unless the eval proves the LLM would have made the same call.

## Facts about Jev that the design relies on

- **Endpoint and auth:** `POST https://openrouter.ai/api/alpha/decisions`,
  with `Authorization: Bearer $OPENROUTER_API_KEY` (the key already used by
  the interviewer). There is no waitlist and no TypeSafe account.
- **Request body:** `model` (`typesafe/jev-1.14`), `state` (a string, object
  or array), and `questions`, a map of `name → {type, instructions, criteria}`.
  - `noul`: `criteria` is `{true, false}`. The answer is `noul`, the
    probability of yes.
  - `choice`: `criteria` maps each option to its description. The answer has
    `choice`, `probabilities` and `confidence`.
  - `score`: `criteria` is an ordered list of levels. The answer has `score`
    (a fractional index from 0), `probabilities`, `confidence` and `legend`.
  - Optional body fields: `provider` (routing, including `data_collection`
    and `zdr`), `session_id` and `trace`.
- **Response:** `id`, `model` (a dated snapshot such as
  `typesafe/jev-1.14-YYYYMMDD`), `provider`, `answers` and
  `usage {input_tokens, output_tokens, cost}`.
- **How questions behave:** they run in parallel and can't see each other.
  Ask one snap judgment per question.
- **Limits:** text over ~32 KB runs in a long-context mode that TypeSafe says
  is slower and less accurate. We keep every state under 30,000 bytes.
- **Output:** probabilities only. There is no reasoning text.
- **Endpoint stability:** the path is `/alpha/`, so its shape may change.
  All Jev code sits in one module.
- **ScaleDown `classify-1`:** advertised as the same kind of model on the
  same Decisions API, so it is just another model id. Unverified until the
  build.
- **ScaleDown `extract`:** a chat-completions model that reportedly accepts
  a JSON schema. Unverified.

## Goals

1. A shared Decisions client in the ai-service.
2. Three **gates**, each with an `off | shadow | on` switch:
   - **Research window gate:** skip a claim-extraction LLM call for a page
     window that holds nothing about the company's fields.
   - **Brief source gate:** skip the extract LLM call for a search result
     that doesn't describe an interview process.
   - **Answer-key review gate:** skip the LLM review of a sandbox-verified
     DSA key when Jev is confident the prose has no factual error.
3. An **eval script** that measures, per stage:
   - how often Jev agrees with the current LLM decision;
   - how much work Jev would wrongly skip ("lost positives");
   - LLM calls and tokens saved;
   - Jev's own cost and latency, and the net latency change.

   The script lists every disagreement for human review.
4. A **quick-screen mode** for the blueprint judge script, scored by Jev.
5. **ScaleDown benchmarks:**
   - `classify-1` against Jev on the same gate eval sets;
   - `extract` against the current resume parser.
6. Unit tests, plus a live eval run on real data (budget ≤ $2 total).

## Non-goals

- No change to generated content: personas, personalization, playbooks,
  answer keys, question content, research claims, brief prose, or
  resume/LinkedIn extraction in production.
- No live-interviewer change (see *Why not elsewhere*).
- No change to profile scoring, JD fit or interview scoring.
- No web or admin UI. Results live in logs and in the eval script's report.
- No production switch of resume parsing to ScaleDown in this project.

## Anti-goals (failure even if it "works")

- A gate in `on` mode that loses a claim, a kept source, or a needed key
  correction that the LLM would have kept.
- A gate whose failure blocks a pipeline. If Jev is down, slow or
  unconfigured, today's path runs unchanged.
- Shadow mode adding latency. Shadow Jev calls run *concurrently* with the
  LLM call and never in front of it.
- Any stage flipped to `on` before its eval passes the bar below.
  **Every gate ships in `shadow` as its config default.**
  - Decided by the human (2026-10-16): the builder switches on any stage
    that passes the bar, at the passing threshold.
  - The switch is made by setting `<STAGE>_GATE_MODE=on` and
    `<STAGE>_GATE_SKIP_BELOW=<T>` in the local `apps/ai-service/.env`. Append
    only; never print the file's secrets.
  - The builder then reports which stages went on and shows their
    disagreements.

## Gate behaviour (shared by all three)

| Mode | Behaviour |
|---|---|
| `off` | Today's behaviour. No Jev call. |
| `shadow` (default when `OPENROUTER_API_KEY` is set) | Jev runs concurrently with the existing LLM call. Both results are written to the gate log, and the LLM result is used exactly as today. A Jev error is logged and ignored. |
| `on` | Jev runs first. If the "work needed" probability (P(yes) of the stage's skip question) is below the stage's `skip_below` threshold, the LLM call is skipped. The downstream effect is identical to the LLM answering "nothing here" (details per gate). Otherwise the LLM runs as today. A Jev error, a timeout, or an over-size state means the LLM runs. |

- **Threshold direction:** every gate skips when P(yes) < `skip_below`, so
  one threshold rule covers all three. For key review the question is "the
  key has an error", so a low P(yes) means skipping is safe.
- **Replay and record modes** (research fixtures): Jev is bypassed, and the
  gate behaves as `off` so replays stay deterministic.
- **Log write:** one document per decision, written once after the LLM
  outcome is known (or after the skip).
  - Research and briefs then add one follow-up label update: the grounded
    result for research, the final disposition for briefs. Those are known
    only later.
  - If that update is lost, the document keeps the stricter raw label.
- **Logged state (my call):** the **full** Jev state (≤ 30 KB), not an
  excerpt. `--source log` can then re-run Jev or another model on the exact
  input, and the human can read the whole thing when reviewing
  disagreements. The content is public web text or our own problem content.
  Volume is roughly 10 MB a week at the research cap, so a 60-day TTL is
  fine on Atlas.

- **No key:** with `OPENROUTER_API_KEY` empty, every gate behaves as `off`.
- **Audit share (added after final review):**
  - In `on` mode, a would-be skip still runs the LLM with probability
    `<STAGE>_GATE_AUDIT_RATE` (default 0.05). The doc is logged with
    `audit=True` and the LLM's label, so lost positives stay measurable
    after a gate is on.
  - Re-evaluating a stage that is already on must use shadow logs, or weight
    audit docs by 1/rate.
- **Circuit breaker (added after final review):** after 3 consecutive Jev
  failures, the client fails fast for 60 s, and the LLM path runs during
  that window.
- **Cache first (added after final review):** in `on` mode the research gate
  asks Jev only on an extract-cache miss.
- **Latency in `on` mode:** Jev's latency is added before every call it does
  *not* skip. The eval reports the net change: skip rate × average LLM
  latency, minus Jev latency. A stage whose net effect is negative is not
  worth flipping.
- **Gate log:** a Mongo collection, one document per gated decision. Each
  document holds:
  - stage, mode and model (the dated snapshot);
  - a state hash, plus a state excerpt for human review (all three stages
    see only public web text or our own problem content, never candidate
    data);
  - Jev's answers;
  - the LLM outcome label (filled in when the LLM ran);
  - whether the call was skipped;
  - Jev cost and latency, LLM latency when known;
  - the owning run or combo id.

  Documents carry a TTL; the builder picks the value (about 60 days).

## The three gates

### 1. Research window gate (biggest win)

- **Where:** `app/research/gateway.py` `extract_claims`. Sources are split
  into windows of up to 4,500 chars, up to 4 per source, and *every* window
  costs one LLM call, even when it holds nothing. Official (tier-1) pages
  skip the existing relevance check entirely.
- **Jev question:** a `noul` asking whether the window contains at least one
  statement about the company that answers one of the section's fields. The
  field list and docs come from the section's existing field docs. One extra
  parallel `noul`, "the text is about this company", is allowed if it helps
  in the eval.
- **Placement (my call):** gate per window inside `extract_claims`, where
  windowing happens.
  - `extract_claims` gets an optional keyword argument carrying the
    company name and the section's field docs.
  - The window text comes from the chunk itself, not from parsing the
    prompt.
  - Callers that don't pass the argument are never gated.
  - The `research()` path in `nodes/evidence.py` passes it.
- **LLM outcome label (revised after final review):** the window produced
  at least one raw claim (`positive_raw`).
  - The earlier "survived grounding" label was dropped. Its quote matcher
    was weaker than grounding's, it ran before text repair, and it ignored
    unverified claims. Together these made it undercount lost positives.
  - A window with zero raw claims can never yield a kept, unverified or
    repaired claim, so `positive_raw` is safe.
  - It only overcounts positives, which makes the eval stricter.
- **Diagnostics:** a skipped window counts as a successful empty window, so
  it never triggers the "all windows failed" error. `ExtractedClaims`
  diagnostics gain a skipped count.
- **Skip in `on` mode:**
  - The window yields an empty claims list, exactly like an LLM reply of
    `[]`.
  - Do **not** write a skip into the extract cache. A later run with the
    gate off must still ask the LLM.
  - Do **not** charge the research budget for a skipped window.
- **Eval data:** stored research spans and extracts, where the window input
  can be recovered. Otherwise, shadow logs from normal research runs.

### 2. Brief source gate

- **Where:** `app/jobs/brief_generation.py`, `_extract_all._one`, before the
  extract call. There are up to 10 search results per combo, each sent in
  full (up to 10,000 chars). Today the LLM's own `describes_process` field
  is the only relevance check, so every irrelevant page costs a call.
- **Jev state:** title, URL, date, and the page text, capped to stay under
  30,000 bytes.
- **Jev questions:**
  - `noul` `describes_process`: the text describes the interview process
    (rounds, questions or format) for this role at this company.
  - `noul` `is_first_hand`: **logged only**, never used to skip. It is there
    to measure whether Jev could later check the LLM's first-hand label.
- **Skip in `on` mode:** only on low `describes_process`. The source is then
  recorded as `no_process`, exactly as when the LLM says
  `describes_process: false`.
- **LLM outcome label:** the LLM's `describes_process`, and whether the
  source reached the aggregate pool.
- **Eval data:** shadow logs. The builder should confirm whether page text is
  persisted anywhere today.

### 3. Answer-key review gate

- **Where:** `app/blueprint/answer_keys.py` `_review`. It runs once per new
  DSA problem after the sandbox passes, and keys are cached across sessions.
  The saving is small, but it shortens prep on cache misses.
- **Jev state:** the same problem facts and key JSON (truncated to 7,000
  chars) that the review prompt sees.
- **Jev question:** a `noul` asking whether the key's prose contains a
  factual error about this problem: wrong complexity, wrong approach, wrong
  edge case, or a wrong insight.
- **Skip in `on` mode:**
  - Applies only when the error probability is below `skip_below`.
  - The key is treated as reviewed and cached, but carries a new marker
    `review_source: "gate"`. LLM reviews carry `review_source: "llm"`.
  - These keys can be found and re-reviewed later. `KEY_VERSION` is
    unchanged.
  - `review_source` is a new optional field on `DsaAnswerKey` and the cached
    document. It defaults to `"llm"`, so existing keys and consumers are
    unaffected.
  - A backfill or re-review job is out of scope.
- **LLM outcome label:** the review returned errors *and* a patch was
  applied.
- **Eval data:** stored `blueprint_runs` traces, which keep each review's
  prompt and result. Those form a ready-made historical set.

## Eval and the quality bar

`apps/ai-service/scripts/eval_decision_gates.py`

- **Arguments:**
  - `--stage {research_window, brief_source, key_review}`
  - `--source {log, history}`: logged shadow answers, or re-run Jev on
    stored historical inputs.
  - `--model` (default `typesafe/jev-1.14`; also `scaledown/classify-1`)
  - `--limit`
  - `--budget-usd`: a hard stop.
- **Report** (markdown plus JSON):
  - n, positives and agreement;
  - a threshold sweep over `skip_below`, giving skip rate, lost positives,
    and LLM calls and tokens saved at each threshold;
  - Jev cost, p50 and p90 latency, and the net latency estimate;
  - every lost positive and disagreement, with excerpts.

A stage may be recommended for `on` at threshold T only if **all** hold:

1. Overall agreement with the LLM decision is at least **95%**.
2. There are **zero lost positives** at T, on at least 100 positives. With
   fewer positives the report says "insufficient data" and the stage stays
   in shadow.
3. The skip rate at T is at least **15%**. Below that it isn't worth the
   added latency on non-skipped calls.
4. The builder has read every disagreement and lost-positive candidate near
   T. None of them shows a systematic miss, such as a whole field or page
   type Jev never recognises.

If no T meets 1–4, the stage stays in `shadow`, or is turned `off` if the
data shows Jev can't do the job.

**Collecting eval data (approved by the human, 2026-10-16).** If stored
history is too thin, the builder may trigger extra research and brief runs
with the gates in `shadow` to build the eval set.

- **Spend:** these runs use Exa credits and Groq or Gemma quota, on top of
  the ≤ $2 OpenRouter budget for Jev.
- **Coverage:** pick companies and combos that are already researched or
  catalogued, enough to reach 100+ positives per stage.
- **Order:** run them only after the gate code is in place, so every call
  is logged.
- **Timing:** never while blueprint prep runs are in flight.

## Judge quick-screen

`scripts/judge_blueprints.py --engine jev` scores the 9 rubric dimensions
and the overall score as Jev `score` questions. Their levels come from the
existing rubric text and 1–5 anchors, and the state is the existing `view()`
output (kept under 30 KB).

- **Output:** the same report shape, labelled *quick screen*, without
  walkthroughs or defects.
- **`--compare <judge.json>`:** prints the per-dimension mean absolute
  difference against an LLM judge run.
- The LLM judge stays the reference. This mode exists for cheap bulk
  screening after prompt and bank changes.
- **Score mapping (my call):** a Jev score index i maps to i + 1 on the
  1–5 scale.
  - Overall is its own `score` question, not an average of the dimensions.
  - Each dimension's levels are short one-line anchors condensed from the
    rubric, to keep to "one snap judgment per question".
- A weak correlation with the LLM judge is a reported result, not a build
  failure.

## ScaleDown benchmarks

- **`classify-1`:** run through `eval_decision_gates.py --model
  scaledown/classify-1`. If the Decisions endpoint doesn't accept it, the
  report says so and we drop it.
- **`extract`:** `scripts/bench_resume_extract.py` runs the current resume
  parser and ScaleDown `extract` (chat completions with a JSON schema derived
  from `ParsedResume`) on the same resume texts.
  - **Inputs:** the fixture PDF, plus whatever stored resume texts the
    builder finds, such as the seeded persona accounts.
  - **Report:** field-level agreement (identity fields, education entries,
    experience entries and bullets, skill overlap), cost and latency.
  - The report is all it does. There is no production switch.
- **Result (2026-10-16), benchmark removed:**
  - ScaleDown `extract` is entity-span extraction. It requires
    `provider.options.scaledown.entities` (name → description) and returns
    flat spans with type, confidence and offsets.
  - It rejects chat-plus-JSON-schema requests, and it does not produce
    nested entries. An education line comes back as one span.
  - It can't produce `ParsedResume` without an LLM to assemble the result,
    so it is not a replacement for the parser.
  - The benchmark script and its module were deleted.
- **Result (2026-10-16), `classify-1`:**
  - It works on the Decisions endpoint only with a string state. The eval
    script serialises dict states for `scaledown/*` models.
  - On the key-review history it never scored below 0.3, so it would skip
    nothing. Jev did better.

## Decisions client

Module: `app/llm/decisions.py`.

- **Transport:** `httpx`, which is already a dependency, so there is no new
  package.
- **Shape:** typed builders for noul, choice and score; typed answers; and
  `usage.cost`.
- **Routing:** `provider: {data_collection: "deny"}`, matching the
  interviewer's routing.
- **Failure handling:** a short timeout (default 8 s), and one retry on
  429, 5xx, 524 or 529 with a small backoff. After that it raises
  `DecisionsUnavailable`. It never waits long: a gate is optional by
  definition.
- **Size guard:** a state over 30,000 bytes is refused before sending, and
  the caller treats that as "unknown", so the LLM runs.
- **Config:** pydantic-settings, matching existing naming:
  - `DECISIONS_MODEL=typesafe/jev-1.14`
  - `DECISIONS_URL`
  - `DECISIONS_TIMEOUT_SECONDS`
  - per gate, `<STAGE>_GATE_MODE` and `<STAGE>_GATE_SKIP_BELOW`

  Add the new variables to `.env.example`.

## Why not elsewhere (decided)

| Call | Verdict | Reason |
|---|---|---|
| Live interviewer: speech classifiers, sentence checks, LeakGuard | No | All are regex or rules at about 0 ms on the critical path. Jev would add 70–500 ms per check, so it is slower and gives no latency win. |
| Live interviewer: director | No | Off the critical path. The same call also writes plan changes, evidence and summary, so Jev can't remove it. |
| Live interviewer: talker | No | Generation. |
| Research `resolve` | No | One call per company, mostly generation. |
| Brief aggregate, question enrich and content, blueprint persona, personalization and playbooks, key generation | No | Generation. |
| Profile-scoring assessment | No | Needs a rationale and verbatim evidence for "why is my score this?". Scoring rules are the human's. |
| Profile-scoring company context | No | Needs headcounts and world knowledge, not a typed decision. |
| Resume / LinkedIn parse | Benchmark only | Extraction, so it is ScaleDown `extract`'s job, not Jev's. |

Revisit the live interviewer once it is rebuilt. A shadow per-turn
`problem_signal` from Jev may later justify fewer director calls.

## Constraints

- `apps/ai-service` only. No new dependencies. Use the existing
  `OPENROUTER_API_KEY`.
- Pin `typesafe/jev-1.14`, and record the dated snapshot from every
  response.
- Tests make no real network calls: `tests/conftest.py` already blanks the
  OpenRouter key. Live calls happen only in the eval and benchmark scripts.
- Don't edit ai-service `.py` files while blueprint prep runs are in flight.
  Another agent (omnirush) edits this repo concurrently, so check file
  modification times first.
- Leave everything in the working tree: the user commits.

## Tests

- **Client** (`httpx.MockTransport`): request shape, answer parsing per
  type, error to `DecisionsUnavailable`, timeout, missing key means
  disabled, and the over-size state guard.
- **Each gate**, with a fake decisions client and the existing fake LLMs:
  - `off` makes no Jev call.
  - `shadow` still calls the LLM, writes the log, and ignores a Jev error.
  - `on` skips below the threshold, calls the LLM above it, and calls the
    LLM on a Jev error.
  - Research skips don't charge the budget or touch the cache.
  - A key-review skip sets `review_source: "gate"`.
- **Eval script:** the threshold sweep and lost-positive math, as pure
  functions.
- **Live:** run the eval on real stored data with real Jev (≤ $2), and
  report the numbers.

## Left to the builder

- Exact Jev instruction and criteria wording (one judgment per question,
  reusing existing field docs and rubric text).
- Gate-log field names, index and TTL.
- Placeholder `skip_below` defaults (for example 0.05). They don't matter
  while the gates are in shadow.
- How to recover eval inputs from stored research spans and blueprint
  traces.

## Found along the way (out of scope, for the human)

- **Inflated company weight:** enrich-guessed `company_tags` carry no
  evidence, so blueprint selection weights them as `reported` (25 instead
  of 10). See `questions/enrich.py:24`, `blueprint/selection.py:277`.
- **Repeated LLM calls on failed DSA content:** failed DSA content is
  re-selected on every run, spending up to 4 LLM calls each time. See
  `db/repositories.py:175`.
- **Aggregate on an empty pool:** brief aggregate is called even when the
  pool is empty. See `jobs/brief_generation.py:416`.
- **Unread director field:** the director's `leak_review` is never read.
  See `interviewer/brief.py:42`.
- **Shadowed test:** two tests share the name
  `test_dsa_without_a_validated_source_is_left_alone_by_default` in
  `tests/test_question_content_generate.py`, so the first never runs.
- **Mismatched error message:** the personalization check message says
  "2–4 entries", but the code only checks that the list is non-empty. See
  `blueprint/stages.py:144`.
