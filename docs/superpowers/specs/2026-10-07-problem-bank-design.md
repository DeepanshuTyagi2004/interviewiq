# Problem bank — design

**Date:** 2026-10-07 · **Status:** approved in chat (sections 1–4), built the same day · **Module:** 03 Live Interview Session (prep input)

## Intent

A large, diverse, rich problem set for every interview round the briefs use (DSA, system design,
LLD, behavioural, hiring manager; online assessments draw from the DSA pool), with company tags,
topic tags, difficulty, constraints, two worked examples, hidden judge tests, hints, follow-ups and
what a strong answer looks like. The later interview-blueprint pipeline gathers problems from it by
JD (no user context at that stage), builds the interviewer persona and the branched flow, and
evaluates the candidate against the stored expected answers.

**Decisions made (user, 2026-10-07):**

1. **Original text, anchored on known problems.** The existing thin bank (title, URL, company and
   topic tags from the community datasets and our research briefs) stays the index of *what has
   been asked*. For each entry we generate our **own** statement that tests the same pattern, never
   a copy: the prompt gets title, tags, difficulty and pattern, never the source text.
2. **Richness over accuracy.** Missing facts are filled in: difficulty, level, topics, minutes,
   follow-ups, and company tags where a problem has none. Every company tag keeps an `evidence`
   value, `reported` (dataset or brief) or `inferred` (model), so copy can say "commonly asked at"
   without overclaiming.
3. **Verification helps, never blocks.** DSA reference solutions run in a sandbox against the
   examples and hidden tests; a mismatch leaves the problem usable as `unverified` and listed for
   fixing.
4. Scope and targets, the job design, the admin surface and the test plan as below.

## Guardrails

- Statements are ours. The source URL stays as provenance only; no source text is stored or sent to
  the model.
- The prompts are product IP: drafts in the repo for human review, versioned (`CONTENT_VERSION`).
- Nothing here changes scoring, readiness or gating.

---

## 1. Scope, volume, schema

| Round | Index source | Target | Content |
| --- | --- | --- | --- |
| dsa | company-wise LeetCode lists (company tags, frequency), NeetCode 150, Kaggle (topics, acceptance), brief problems | ~2,800 | statement, input/output format, constraints, 2 examples (args, expected, explanation), 5 hidden judge tests, 3 escalating hints, follow-ups, approaches (brute → optimal with complexity), Python reference solution, edge cases, common mistakes, rubric |
| system-design | 4 SD repos, brief problems | ~150 | prompt, clarifying questions, functional and non-functional requirements, scale assumptions, expected design (components, data model, API sketch, data flow), deep dives, trade-offs, follow-ups, rubric, red flags, strong-answer summary |
| lld | 3 LLD repos, brief problems | ~150 | prompt, requirements, entities, expected class design (classes, relationships, patterns), sample API, evaluation mode, follow-ups, rubric, red flags, strong-answer summary |
| behavioural | handbook, Indian HR sets, Amazon LPs, Googleyness | ~400 | competency, what it tests, STAR guide, strong vs weak answer, follow-up probes, red flags, principle |
| hiring-manager | behavioural manager-fit subset, brief HM topics | ~150 | behavioural shape plus project deep-dive guidance |

Common fields: `difficulty`, `topic_tags`, `company_tags` + `company_evidence`, `level_tags`,
`estimated_minutes`, `what_it_tests`, `content_version`, `content_status`
(`none | generated | verified | unverified | failed`), `content_hash`, `content_generated_at`,
`content_model`, `content_error`.

## 2. Generation job (`apps/ai-service/app/questions/content/`)

Per record: skip when `content_hash` (index fields + prompt version) is unchanged → build the
round-specific prompt → Groq-first `complete_json` with a larger output budget → strict Pydantic
validation (2 examples, 3 hidden tests, 3 hints, rubric…) → DSA: run the reference solution in a
sandboxed subprocess (CPU and memory limits, isolated interpreter, no inherited environment) against
examples and hidden tests → partial update of the record (never clobbering index fields). One
failure never aborts the run; failed records retry next run. Trigger `POST /questions/generate`
(`round_type`, `limit`, `force`) shares the single run slot and the `/scrape/status` feed; `GET
/questions/stats` gives counts per round × status. Collection runs first when the index is empty.

## 3. Contract and admin surface

AI service `GET /questions` gains `content_status`, `topic`, `include_content`. The API proxies
`POST /intelligence/questions/generate`, `GET /intelligence/questions/stats` and the new filters
(admin only). The contract gets `QuestionRecord` with the content union, `QuestionBankStats`,
`QuestionGenerateRequest/Response`. A "Problem bank" tab in Intelligence shows counts per round ×
status, Collect and Generate with live status, and a filterable list opening one problem in full.

## 4. Testing, rollout, docs

Python: content models reject thin output; sandbox passes a correct solution, fails a wrong one,
kills an infinite loop; prompts never include source text; `reported` vs `inferred`; content hash
independent of enrichment; brief problems merge. API: proxy route tests. Web: panel tests.
Rollout: collect → 25-record sample across rounds → review → full chunked run (real LLM spend, with
a go-ahead at the sample). Docs: `apps/ai-service/docs/question-bank.md`, `CLAUDE.md` pointer.
