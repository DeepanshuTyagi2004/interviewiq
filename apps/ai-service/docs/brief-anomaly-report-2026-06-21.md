# Interview Brief Anomaly Report — Razorpay/software-engineer (all 9 JDs)

_Generated 2026-06-21 · pipeline `v9` · DB `interviewiq_intelligence.interview_briefs`_

## TL;DR

All **9** briefs in the DB are Razorpay/software-engineer across `fresher | sde2 | sde3` × `backend | frontend | fullstack`. **Every one self-reports `generation_status=success`, `data_confidence=high`, 100 % `evidence_backed`, 0 `inferred`, and `level_matched_round_count == round_count`.** That uniform "all green" is not a sign of good data — it is structurally impossible to fail given the current scoring rules.

The headline defect is in the **SCORE stage**: confidence is computed by arithmetic that can only *reward* citations and never *penalise* off-level or thin ones. The aggregator LLM is actually more honest than the score — in ≥4 briefs its own reasoning says "Medium confidence, some are SDE-2," which the pipeline overwrites to `high`.

Net user-visible harm (this is the original "SDE2 / 4-year refs for freshers" complaint): a single **SDE-2, 3-years-at-Juspay** Medium post is cited as evidence in the **fresher** loop _and_ in all three **sde3** loops. Fresher briefs get inflated with experienced-candidate rounds (standalone LLD + UPI system-design); sde3 briefs are built on mid-level evidence.

---

## 1. The dataset

| Combo | rounds | funnel (cited / unused / not-exp / no-rounds) | chosen | reported |
|---|---|---|---|---|
| fresher/backend | 4 | 3 / 3 / 14 / 0 | 3 | success · high |
| fresher/frontend | 3 | 3 / 4 / 13 / 0 | 3 | success · high |
| fresher/fullstack | 4 | 5 / 0 / 14 / 1 | 5 | success · high |
| sde2/backend | 4 | 5 / 2 / 13 / 0 | 5 | success · high |
| sde2/frontend | 5 | 5 / 4 / 11 / 0 | 5 | success · high |
| sde2/fullstack | 5 | 7 / 0 / 13 / 0 | 7 | success · high |
| sde3/backend | 3 | 5 / 0 / 14 / 1 | 5 | success · high |
| sde3/frontend | 5 | 5 / 2 / 13 / 0 | 5 | success · high |
| sde3/fullstack | 5 | 6 / 1 / 13 / 0 | 6 | success · high |

Per query, Perplexity returns ~20 sources; ~13–14 are correctly rejected as "not an interview experience" (question banks, prep guides). The problem is not collection volume — it is what happens to the ~5–7 that survive.

---

## 2. The core finding — "SUCCESS/HIGH" is fabricated by the scorer

Confidence is `HIGH` when `count_strong_rounds / round_count ≥ 0.6`. A round is "strong" if **≥1** of its `evidence_urls` is level-matched, and `_level_matches()` returns **TRUE for the combo bucket OR for `null`/unknown** ("benefit of the doubt").

**Counterfactual:** recompute each brief's confidence with the single change that `null` detected_level does **not** count as a match:

| Combo | rounds | strong (current, null=match) | strong (null≠match) | honest verdict |
|---|---|---|---|---|
| fresher/backend | 4 | 4 (HIGH) | 2 → 0.50 | **MEDIUM** |
| **fresher/frontend** | 3 | 3 (HIGH) | **0 → 0.00** | **LOW / insufficient_data** |
| fresher/fullstack | 4 | 4 (HIGH) | 3 → 0.75 | HIGH |
| sde2/backend | 4 | 4 (HIGH) | 4 → 1.00 | HIGH |
| sde2/frontend | 5 | 5 (HIGH) | 5 → 1.00 | HIGH |
| sde2/fullstack | 5 | 5 (HIGH) | 5 → 1.00 | HIGH |
| sde3/backend | 3 | 3 (HIGH) | 3 → 1.00 | HIGH |
| sde3/frontend | 5 | 5 (HIGH) | 5 → 1.00 | HIGH |
| sde3/fullstack | 5 | 5 (HIGH) | 3 → 0.60 | HIGH |

**`fresher/frontend` is entirely propped up by `null`-level sources** — all three cited sources have `detected_level=null`, none state "fresher" — and would honestly be `insufficient_data`. `fresher/backend` drops to MEDIUM. The inflation concentrates on the freshers, which is exactly where the original complaint lives.

> Note the sde2/sde3 rows that *stay* HIGH-strict are still contaminated — see Anomaly C and the `≥1-per-round` free-rider problem. Fixing `null=match` cures freshers; curing sde2/sde3 needs Fix 2 + Fix 3 below.

### The laundering chain (why failure is impossible today)

1. **EXTRACT** emits `detected_level=null` for **20 of 60** raw experiences, and raw strings like `"3 years at Juspay"` for the rest (no canonical bucket).
2. **`_level_matches` null=match** turns every null source into a guaranteed match for *any* combo → ~⅓ of all evidence is "on-level for free."
3. **AGGREGATE** has no enforcement of its own "discount off-level" instruction, so it freely cites Senior / Associate / 3yr-Juspay posts into rounds and pads each round with multiple URLs.
4. **`count_strong_rounds` ≥1 rule** means a round needs only *one* matched-or-null URL to be "strong." Off-level co-citations are never subtracted → every round is strong → ratio forced to 1.0.
5. Ratio ≥ 0.6 → **HIGH**; every round had a citation → **100 % evidence_backed / 0 inferred**.

The scorer can only add, never subtract, and the null-rule almost always supplies a matched URL. "Success/high" is therefore the only reachable state.

---

## 3. Per-brief anomalies (auditor verdicts)

| Combo | realism | off-level cited | on-level dropped | evidence | headline |
|---|---|---|---|---|---|
| fresher/backend | questionable | 1 | 0 | suspect | Level-unknown "SDE" (Codinzhub) split into two fabricated rounds (LLD + UPI system-design) → fresher loop looks like SDE-2. |
| fresher/frontend | questionable | 0 | 2 | loose | "100 % level-matched HIGH" is a `null`=match artifact; the only two explicit entry-level sources (intern GfG, FE-Dev Glassdoor) were dropped. |
| fresher/fullstack | questionable | 2 | 0 | loose | Two cited sources explicitly off-level (a Senior SE + the 3yr-Juspay candidate); model's own note said "Medium." |
| sde2/backend | plausible | 2 | 2 | loose | SDE-2 loop stitched from a **Senior** SDE + an entry-level **Associate** (incl. the HM round) while a level-matched India source was dropped. |
| sde2/frontend | plausible | 1 | 2 | loose | A **senior** source is the sole origin of R5 "Micro-Frontends / Module Federation"; an exact **SDE-2** post was dropped as unused. |
| sde2/fullstack | questionable | 1 | 0 | loose | 5-round loop **no single candidate experienced** — unioned across siloed FE/BE candidates + an off-spec backend hire. |
| sde3/backend | questionable | 3 | 1 | loose | Built on a 3yr-mid Juspay post (its spine) + a campus IIT-BHU report; the only genuinely **Principal** India source was discarded as `no_rounds`. |
| sde3/frontend | questionable | 1 | 2 | loose | An off-level **backend** Medium post is primary evidence for the HM round of a senior **frontend** brief; two correct-level FE Glassdoor sources dropped. |
| sde3/fullstack | questionable | 4 | 0 | suspect | Zero genuine SDE-3 sources; core rounds lean on a mid-level backend post; the fullstack round rests on one LinkedIn post of unknown role/level/geo with empty `problems[]`. |

---

## 4. Anomaly catalogue + pipeline-stage attribution

**A. `null` detected_level laundered into "level-matched."** 20/60 sources are null; `_level_matches` treats null as a match for every combo. `fresher/frontend` cites three null sources and scores HIGH; `sde3/fullstack` cites four. → **SCORE / `_level_matches`** (master mechanism).

**B. One mid-level post spans fresher → sde3.** `arpit09chauhan.medium.com` (stored `"3 years at Juspay"`, **verified SDE-2 / India / backend-leaning**) is cited under fresher/fullstack, sde2/*, and all three sde3 briefs — six mutually-exclusive buckets. It is the *spine* of sde3/backend and primary HM evidence in sde3/frontend (despite being backend). → **EXTRACT** (emits raw string, no bucket identity) **+ AGGREGATE** (soft "discount" never enforced; thoughts relabel it per-brief to justify reuse).

**C. Inversion — off-level kept, on-level dropped.** sde2/backend cites a **Senior** (jointaro, verified SDE-3-equiv) and an **Associate** while dropping a level-matched India source; sde2/frontend cites a **senior** post while dropping an exact **SDE-2** post (`kuljeet`); sde3/backend discards the only genuine **Principal** India source as `no_rounds`. → **AGGREGATE** (inconsistent filtering — it applies a *spec* filter but not a *seniority* one) **+ SCORE** (`count_strong_rounds ≥1` never subtracts the off-level URLs it kept).

**D. Fabricated / forced round structure.** Codinzhub's extractor literally wrote _"the text doesn't explicitly say Round 1 and Round 2… I am assuming they were separate rounds"_ — one topic-list split into two `evidence_backed` rounds. fullstack briefs synthesize **5-round loops no single candidate had** (real loops were 1–4 rounds). `dsa` is forced as a catch-all on pure JS-internals rounds (fresher/frontend R2, sde3/frontend R3); sde2/fullstack & sde3/fullstack have **duplicate `lld` round types**. → **AGGREGATE** (loop synthesis) **+ schema** (round-type enum too coarse).

**E. `evidence_backed` over-applied; `inferred` never used (0 across all 9).** Difficulty (`hard`/`medium`) asserted everywhere though raw rounds carry `difficulty=null`. HM rounds tagged evidence_backed cite candidates rejected earlier or who "didn't reach this round" (sde2/backend R4). sde3/fullstack R4 has empty `problems[]` + boilerplate, one unknown-role/level/geo source, yet `evidence_backed`. A pipeline that produces *zero* inferred rounds across 9 heterogeneous briefs is mis-tagging by construction. → **AGGREGATE prompt** (provenance keyed off "a URL exists," not "a source attests this fact").

**F. Geo back-filled from the prompt header (anti-leak violation).** Extractor thoughts repeatedly: _"the post doesn't explicitly say India… I will use unknown"_ then flip to `india`. The same anti-leak discipline that correctly keeps `detected_level=null` is **not** applied to geo, so "Razorpay India" context leaks in and inflates geo-matched counts. → **EXTRACT**.

### Beyond the metrics (auditor-only findings)
- **Single-source rounds presented as universal.** sde2/frontend R1 (OA) and sde2/backend R1 (OA, with atypical RAG/TopP/TopK AI-ML topics) each rest on **n=1**, unknown geo. The "100 % evidence_backed" metric hides round-level _n_.
- **Within-round level-mixing.** sde3/backend R2 fuses a *campus* IIT-BHU problem with *senior* job-scheduler problems into one "SDE3 HLD round" — five evidence_urls spanning fresher/mid/~6yr/senior/geo-unknown inside one round.
- **Cross-round evidence reuse that doesn't map.** sde2/fullstack cites a `type=null` "project discussion" round as evidence for the **DSA** round; sde3/fullstack double-maps Codinzhub's LLD round onto its HLD round.
- **The pool *had* on-level senior data, mis-filed.** The jointaro "senior" source belongs in the sde3 pool (where the sde3 briefs lacked genuine senior evidence) but was filed under sde2.

---

## 5. Ground-truth verification (re-fetched live)

| URL | stored detected_level | **verified reality** | cited under | verdict |
|---|---|---|---|---|
| arpit09chauhan.medium.com/…-feb-2025 | `3 years at Juspay` | **SDE-2 equiv, 3 yrs, India, backend-leaning** | fresher/fullstack + all 3 sde3 | fresher & sde3 citations are confirmed mis-maps |
| geeksforgeeks…razorpay-pse-intern…2025 | `intern` | **Intern, campus final-year, MERN+AI-ML (fullstack)** | fresher/backend + fresher/fullstack | intern ≠ full-time fresher; backend citation *doubly* wrong (level + spec) |
| jointaro…senior-software-development-engineer | `senior` | **Senior SDE = SDE-3 equiv, India** | sde2/backend (`level_matched=false`) | belongs in sde3 pool, not sde2 |

All three were fetchable; the misattribution direction is confirmed, not inferred.

---

## 6. Where in the pipeline

```
COLLECT (build_search_queries → Perplexity)
  • Level/spec are in the query, but the web has no level-segregated content,
    so the same ~5–7 generic Razorpay posts recur across every combo.
  • Contributes to: B (cross-level reuse), spec leakage (12/22 cited URLs span >1 spec).

EXTRACT (extract_source prompt → RawExperience)
  • 20/60 sources → detected_level=null (anti-leak working as designed, but...).
  • Emits raw strings ("3 years at Juspay") instead of a canonical bucket → no stable level identity.
  • Geo NOT held to the same anti-leak rule → back-filled "india" (Anomaly F).
  • Root of: A (fuel), B (no bucket), F.

AGGREGATE (aggregate_experience prompt → FinalExperience)   ← biggest behavioural offender
  • "Prefer on-level / discount off-level" is a SOFT instruction with zero enforcement.
  • Cites off-level sources, drops on-level ones (C); splits/unions rounds (D);
    tags everything evidence_backed, never inferred (E).
  • Model's own thoughts are more honest ("Medium", "discount") than the emitted brief.

SCORE (derive_status / _level_matches / count_strong_rounds)   ← biggest defect, fix here first
  • null = match  →  ⅓ of evidence is free on-level (A).
  • round strong if ≥1 matched URL  →  off-level co-citations never subtract (C free-rider).
  • Overwrites the model's "Medium" self-assessment with arithmetic "high."
  • This stage is why every brief is structurally incapable of failing.
```

---

## 7. Fixes, ranked by leverage

1. **Stop counting `null` as a level match.** _(SCORE, `_level_matches`)_ Treat null as a distinct "unknown" tier that does **not** satisfy `count_strong_rounds`. Collapses the false HIGH on fresher/frontend (→ insufficient_data), fresher/backend (→ medium), sde3/fullstack, and removes the "free third" everywhere. Highest single-change impact.
2. **Enforce the off-level discount in scoring, not the prompt.** _(SCORE, `count_strong_rounds`)_ Change "≥1 evidence_url matched" → "**majority** matched, and subtract off-level URLs." Kills the free-rider that keeps sde2/* and sde3/* at HIGH while citing Senior/Associate/3yr posts.
3. **Normalise `detected_level` to a bucket at extraction; hard-drop cross-bucket citations in aggregation.** _(EXTRACT + AGGREGATE)_ Stops one SDE-2 Medium post from being the spine of six mutually-exclusive briefs.
4. **Make `inferred` first-class and mandatory.** _(AGGREGATE prompt)_ Any round whose difficulty/topics/structure/type was supplied by the aggregator (not attested by a source) must be `inferred`. 0-inferred-across-9 is the tell.
5. **Apply anti-leak to geo.** _(EXTRACT)_ Geo from post text or `unknown` — never back-filled from the "Razorpay India" header.
6. **Cap synthesised loop breadth.** _(AGGREGATE)_ Disallow more rounds than the max any single matched source reported, or flag the excess `inferred`. Fixes the phantom 5-round fullstack loops.

---

## 8. Caveats / what could not be checked

- **Raw page content is discarded.** The pipeline keeps only the structured `RawExperience` (plus `thought` tokens when capture is on); original page text is not stored. Misattribution was therefore judged from the extractor's own `detected_level` (which is itself its verdict), captured reasoning, and a live re-fetch of three public URLs. LinkedIn/Glassdoor URLs were not re-fetched (commonly blocked).
- **`interview_sources` collection is stale/orphaned** — `razorpay` has `sources: []`, `google` holds a prep-guide repo (jwasham), neither feeds this Perplexity-driven pipeline. Worth deleting or wiring, but unrelated to the anomalies above.
- These 9 briefs are a single company (Razorpay). The mechanisms are company-agnostic, but absolute confidence numbers will differ for companies with thicker/leveled public data.

_Method: deterministic Mongo queries for the structural facts + counterfactual scoring; a 9-way parallel per-brief LLM audit; live re-fetch verification of 3 key sources; cross-cutting synthesis. Findings cross-checked between the deterministic layer and the audit layer._
