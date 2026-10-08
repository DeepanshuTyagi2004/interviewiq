# Problem bank

The question bank (`interview_questions` in the AI service's Mongo) has two layers:

1. **The index** — what has been asked. Collected from community datasets and our research briefs:
   company-wise LeetCode lists (company tags, frequency), NeetCode 150 (patterns), the Kaggle LeetCode
   dataset (topics, acceptance), system-design and LLD repos, behavioural sets (tech-interview-handbook,
   Indian HR sets, Amazon Leadership Principles, Googleyness), and the named problems in our briefs'
   rounds (`brief/<slug>` records, company tag `reported`): both this service's own briefs and the
   API's admin-published ones, read over `GET /api/v1/internal/brief-problems`. Title, URL, tags, difficulty, sources,
   `source_hash`. No source text is ever stored.
2. **The content** — our own problem. Generated per record from the index facts only (title, round,
   tags, difficulty, pattern hints; never the URL or any fetched text), validated strictly, verified
   for DSA, and stored under `content` with `content_status`, `content_version`, `content_hash`,
   `content_generated_at`, `content_model`, `content_error`.

Design: `docs/superpowers/specs/2026-10-07-problem-bank-design.md`. Decisions: original text anchored
on known problems; richness over accuracy (missing facts are filled in, every company tag keeps its
`company_evidence`: `reported` or `inferred`); verification is advisory.

## Content shapes (`app/questions/content/models.py`)

| Round | Model | Must have |
| --- | --- | --- |
| dsa, online-assessment | `DsaContent` | statement (120+ chars), input/output format, constraints, **2+ examples** (`args`, `expected`, `explanation`), **3+ judge tests**, 3+ escalating hints, follow-ups, approaches with complexity, Python reference solution (`entry_point`, `code`), edge cases, common mistakes, 2+ rubric criteria, patterns, what it tests, minutes |
| system-design | `SystemDesignContent` | prompt, 3+ clarifying questions, functional and non-functional requirements, scale assumptions, expected design (3+ components, data model, API sketch, data flow), deep dives, trade-offs, follow-ups, rubric, red flags, strong-answer summary |
| lld | `LldContent` | prompt, requirements, entities, expected design (2+ classes, relationships, patterns), sample API, evaluation mode, follow-ups, rubric, red flags, strong-answer summary |
| behavioural, hiring-manager | `BehaviouralContent` | question, competency, what it tests, STAR guide, strong and weak answer summaries, 2+ follow-up probes, red flags, principle, deep-dive guidance (hiring manager) |

Design and LLD content keeps the exact system its title names (a vending machine stays a vending machine; added
2026-10-08: the earlier prompt turned "Design a parking lot" into a bike-sharing dock, defeating the brief's named
problems). The 12 records that had drifted were regenerated the same day with the new prompt (a backup of the old
content is kept outside the repo; a regeneration that fails validation restores the previous content, and the
cached answer keys of regenerated records are removed). `mcq/split-wise` keeps its older content: that was already a
faithful Splitwise clone, and the regeneration drifted. Selection also skips a brief-named design problem whose
content designs a different system (`content_off_title`), as a guard for future drift.

Validation absorbs the model's habits rather than rejecting richness: an elaborated LLD
`evaluation_mode` ("working-code; candidate implements…") keeps the mode it names, and a single
combined requirement counts.

The model also returns `inferred` index facts (difficulty, level tags, topic tags, company tags).
They fill only what the sources left empty; topics and companies are added, companies marked
`inferred`.

## Statuses

`none` (index only) → `generated` (design, LLD, behavioural, HR: stored, no executable checks exist for
these rounds) / `verified` (DSA, see below) / `failed` (the last attempt did not pass its checks; no
content is stored; retried next run). **Nothing unverified is ever saved:** `update_question_content`
refuses to write DSA content unless the status is `verified`, and any content unless it is `verified` or
`generated`. There is no `unverified` state.

**DSA = source-grounded.** A DSA problem is generated only when the Kaggle dataset has its statement
with two readable examples (about 1,080 problems; tree/linked-list problems are skipped). The model
rewords the statement and writes hints, follow-ups, edge cases and tags; the two examples are the
source's own (validated) and are never model-written; the model supplies only their explanations.
Solutions, approaches and the rubric are built at round-preparation time and cached (the interview blueprint's answer keys, `app/blueprint/answer_keys.py`, spec `docs/superpowers/specs/2026-10-07-interview-blueprint-design.md`), so the bank stores
none of them. Problems without a source statement are not generated unless
`QUESTION_CONTENT_ALLOW_UNGROUNDED=true`, in which case they must pass the full proof (optimal and
brute-force solutions agreeing on every example and 5+ hidden tests; failures go back to the model for
up to 3 repair rounds, then are rejected). Verification runs the solution in a separate interpreter (`-I`, empty environment, CPU and
memory limits, wall-clock timeout) in `app/questions/content/sandbox.py`.

## Running it

- `POST /admin/questions/collect` builds or refreshes the index (granular, resumable).
- `POST /admin/questions/generate?round_type=&limit=&force=` generates content for records whose
  content is missing, failed, or from another `CONTENT_VERSION` (`force=true` regenerates current
  ones). Shares the single run slot; progress on `/admin/scrape/status` (stage `question_content`,
  counts per status). Runs the collection first when the index is empty. Resumable: run it in chunks
  with `limit`.
- `GET /questions?round_type=&company=&difficulty=&content_status=&topic=&include_content=&limit=`
  and `GET /questions/stats`. The API proxies all of these under `/api/v1/intelligence/questions`
  (admin), and the Intelligence → Problem bank tab drives them.

Settings: `QUESTION_CONTENT_CONCURRENCY` (4), `QUESTION_CONTENT_MAX_OUTPUT_TOKENS` (6000),
`QUESTION_CONTENT_DEADLINE_SECONDS` (150), `QUESTION_CONTENT_GROQ_STAGE_SECONDS` (90),
`QUESTION_CONTENT_SANDBOX_TIMEOUT_SECONDS` (10). The client is Groq first, like research.

## Changing the prompts

`app/questions/content/prompts.py` is product IP: drafts for human review. Bump `CONTENT_VERSION`
after a material change; every record's `content_hash` then goes stale and the next run regenerates
it. The prompt must keep receiving index facts only.

## Adding a source

Write a collector under `app/questions/collectors/` that returns `QuestionRecord`s (title, url,
tags; never statement text), add it to `app/jobs/question_collection.py`, and give its records a
`sources` entry. Company tags from a source are `reported`.
