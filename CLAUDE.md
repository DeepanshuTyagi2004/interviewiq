# InterviewIQ — Project Context

> Monorepo-wide context. App-specific guidance lives in `apps/web/CLAUDE.md` and `apps/api/CLAUDE.md`.

---

## What this is

AI-powered mock interview platform for software engineers. A voice-driven AI interviewer with full candidate context (resume + coding platform profiles) runs a target company's real interview process for a specific JD, round by round, then gives a scored, structured debrief.

**Audience:** students preparing for campus placements (first market: Tier 2/3 Indian engineering colleges) **and** working professionals preparing for a job switch.

**Go-to-market (phased):**

1. **Universities (B2B)** — sold to college Training & Placement Officers (TPOs) to make students interview-ready. Students' profiles and readiness reports help the college attract companies.
2. **Public launch (B2C, in parallel)** — any student or professional can build a profile and practise.
3. **Company partnerships** — partner companies post exclusive openings on the platform.
4. **Automated hiring** — automate early-stage HR hiring for companies, supplying the top layer of candidates who have already cleared that company's mock interview loop.

**Why the platform exists:** Real interview practice is scarce, expensive, and inconsistent. Existing tools (Pramp, Interviewing.io) are peer-based and English-fluent-defaulting; LeetCode is solo and doesn't simulate interviews. InterviewIQ gives every candidate unlimited, company-specific, voice-based mock interviews with a personalized AI interviewer.

---

## Product vision: the candidate journey

The target end-to-end flow. Much of it is not built yet; `docs/PROJECT_OVERVIEW.md` has the pitch version.

1. **Sign up → onboarding** (résumé-prefilled profile) **→ connect sources** (GitHub, LeetCode, other relevant platforms; all optional).
2. **Pick a target company, then one of its JDs.**
3. **See that JD's interview process**: the rounds, as close to the real process as possible, derived from the always-on background research job (briefs built from interview experiences found on the web).
4. **Per-JD loop dashboard.** Starts relatively empty and fills in as rounds are scheduled and taken.
5. **The user may add, remove or change rounds.** ⚠️ **An edited process is a standalone interview.** It still gets full analysis, but it **never counts toward the company loop or the user's readiness for that JD**. Only the unedited, suggested process counts.
6. **Schedule round 1.** On the scheduled date the AI interviewer runs the round, personalized from the user's own source data, with **real-time analysis** of many signals during the interview.
7. **Post-interview analysis:** what a strong answer would have been, which topics to learn, and an **overall score** for the round.
8. **Round gating:** score ≥ the round's pass threshold → the next round unlocks. Below it → **retake after a 1–2 week cooldown**.
9. **Readiness, not badges.** Each target JD has a **readiness level** (e.g. Getting started → Progressing → Nearly ready → **Interview-ready**) that rises as rounds of the unedited loop are cleared. Clearing every round makes the user **Interview-ready** for that JD and unlocks a shareable **readiness report** (rounds, scores, strengths, practice history).
10. **Separate profile and interview scores.** The approved profile-scoring beta evaluates local evidence under the shared eight-level enum, with coverage; source data is taken as correct (no confidence weighting; the user fixes what is wrong). The user selects one current profile level; scoring uses that choice, while the target JD remains independent. Interview aggregation remains separate and unfinished. Profile rankings are opt-in and same-level, never global cross-level comparisons. See `apps/api/docs/profile-scoring-beta.md`.

---

## Architecture: monorepo

```
interviewiq/
  apps/web/          Next.js 16 frontend (student app + TPO admin + marketing)
  apps/api/          Node.js / Express 5 / TypeScript backend (was Spring Boot — same HTTP contract)
  apps/ai-service/   Python FastAPI — ALL LLM logic (briefs, résumé parse, problem bank, interview blueprints)
  packages/contracts/openapi.yaml   source of truth for web ↔ api ↔ ai-service
  infra/             docker-compose (local stack) + env template
```

Tooling: **pnpm workspaces + Turborepo** for the JS apps; the Python service keeps `requirements.txt` + its own venv (a thin `package.json` lets `turbo` run its dev/test). Each app still deploys independently. Git history of the three former repos is preserved under their `apps/*` paths.

**Data layer (API):** Postgres (**Supabase** in prod) for the relational core — users, refresh tokens, companies, JDs, role configs, interview sessions, GitHub/LeetCode connections — via Drizzle ORM, same table/column names Hibernate created. MongoDB (**Atlas** in prod) for documents — candidate profiles, profile fragments, the problems each candidate was already given (`blueprint_seen`). **AI service:** MongoDB (Atlas), its own database. Local dev runs both databases in Docker (`pnpm db:up`).

---

## Tech stack (confirmed)

**Frontend (`apps/web`):** Next.js 16 (App Router), React 19, TypeScript, Tailwind 3.x (NOT 4), shadcn/ui (classic 2.10 CLI — latest 4.x is Tailwind-4-centric) + Geist fonts/design tokens, TanStack Query v5, Zod, react-hook-form. **Auth is backend-owned — no NextAuth/Auth.js.** Frontend holds an in-memory access token + an httpOnly refresh cookie. UI follows the Claude Design export in `InterviewIQ Landing Page/` — a local, gitignored folder (see `apps/web/CLAUDE.md`).

**Backend (`apps/api`):** Node.js 22+, Express 5, TypeScript (ESM), Drizzle ORM + node-postgres (Supabase), MongoDB native driver (Atlas), jose (HS256 JWT), zod (config), pino (logs), livekit-server-sdk. Schema via Drizzle migrations in `apps/api/drizzle/` (applied at startup). **Backend-owned auth: Google OAuth or email + password (scrypt via `node:crypto`) + custom JWT.** Verification/reset links are logged to the console until a mail provider is chosen. Tests: Vitest + supertest against in-process PGlite + mongodb-memory-server.

**AI service (`apps/ai-service`):** Python 3.11+, FastAPI, async, Motor (MongoDB). OpenAI-compatible LLM endpoints; LiveKit Agents + Deepgram for the voice interview.

**Infra:** Vercel (web), Railway/Fly (api + ai-service), Supabase (Postgres), MongoDB Atlas, Cloudflare (CDN + WAF), Docker Compose for the local stack. Sentry + PostHog for observability.

**Open stack decisions** (don't decide unilaterally, flag and ask):
- Background job queue: in-process schedulers today (API + ai-service) vs a real queue later
- Logging: pino (API) + stdlib logging (ai-service) → shipping target TBD
- LeetCode data sourcing: scrape vs paste-in vs unofficial community API
- Voice pipeline: stay with Deepgram+GPT+ElevenLabs vs OpenAI Realtime API (cost vs latency trade)

---

## Current focus: Profile Builder (Module 01)

The Profile Builder normalizes sources into a **descriptive** profile summary. That summary still carries no scores or ranks. The separately approved profile-scoring beta consumes minimized local evidence through its own contract, never through synthesis (see *Scoring, round gating & readiness*).

**Data flow:**
1. User connects sources (OAuth for GitHub, paste/upload for resume + LeetCode)
2. Backend collectors fetch raw data, normalize into a `ProfileFragment` per source, store in MongoDB (`profile_fragments`)
3. Async job triggers synthesis when any fragment hash changes
4. Python synthesis service receives all fragments, calls LLM, produces structured `ProfileSummary` (bullets + UI component refs)
5. Frontend renders summary text + visual components (heatmap, charts, badges)

**Key design decisions** (already made, don't relitigate):
- **Source-agnostic synthesis** — adding a new source is config + collector implementation, not synthesis refactor
- **Async-first** — collectors return immediately, synthesis runs in background queue
- **Idempotent** — fragment content hashing skips redundant synthesis runs (~70% LLM cost savings)
- **Hash-based change detection** — only re-synthesize when source data actually changed

---

## All modules

**MVP (6 modules — target: 4 months to first paid pilot):**
1. Profile Builder ⬅ *current*
2. Job/Loop Setup (target company + JD → the suggested interview process as a per-JD loop dashboard; user-editable rounds, where an edited loop becomes standalone)
3. Live Interview Session (voice + code + AI interviewer, real-time analysis)
4. Post-Interview Report (scored debrief with ideal answers, topics to learn and an overall score; the pass threshold unlocks the next round, otherwise a retake cooldown applies; clearing every round of an unedited loop makes the user Interview-ready for that JD and unlocks the readiness report) ⬅ *built 2026-10-18 (see Post-interview report below)*
5. University Admin Panel (TPO dashboard, roster, drives)
6. Platform Essentials (auth, billing, settings, notifications)

**Problem bank (built 2026-10-07):** the AI service's question bank is the index of what has been asked (community datasets + our briefs; titles, URLs, tags) plus content per problem. DSA content is source-grounded: a reworded statement, the source's two validated examples, hints, follow-ups and tags, status `verified`; no solutions are stored in the bank. Design, LLD, behavioural and HR content is ours, status `generated`. **Nothing unverified is ever stored** (the repository refuses it). Company tags carry `reported`/`inferred` evidence. See `apps/ai-service/docs/question-bank.md`.

**Interview blueprint (built 2026-10-07; replaced the old InterviewPlan and the live voice agent, both deleted):** booking a round starts prep at once. The AI service builds a blueprint: problems chosen deterministically from the bank by company, JD and round (never one the candidate already got), answer keys built at prep time and cached per problem (DSA solutions sandbox-checked against the source examples), persona and timed arc, per-question playbooks with condition → action branches from a fixed vocabulary, versioned policies, and evaluation signals. The candidate sees only progress steps and a briefing (interviewer, format, duration), never topics, problems or difficulty. A reconcile job re-prepares ready sessions whose inputs change, until 30 minutes before the slot; a prep that fails for infrastructure reasons is re-run automatically (twice per hour) before the candidate sees "we couldn't prepare". `apps/api/scripts/dev/bench-blueprints.ts` runs the prep audit (personas × researched JDs × round types); run it after changing selection, prompts or the bank, then `apps/ai-service/scripts/judge_blueprints.py` to have Gemini judge the results as a senior interviewer at that company would (realism, level fit, one company per interview, grounding, branch logic, hints, keys, flow). Prep LLM calls go to Gemini first (`GEMINI_API_KEY`, paid) and fall back to the free-tier Groq chain. A coding or design round whose description includes a behavioural part (Amazon's "Coding + Leadership Principles") also asks two principle questions, first. **A mock round is 30, 35, 40 or 45 minutes, drawn uniformly at booking (decided 2026-10-18; it was always 45 from 2026-10-09):** the API stores it on the session (`round_minutes`; a session booked before the draw has none and reads as 45), shows it in the briefing and sends it to prep as `duration_mins`; a reschedule or re-prep keeps it and a retake (a new session) draws again. `MOCK_ROUND_MINUTES` (45) is now the maximum, kept on stored loop and process nodes; screens show a not-yet-booked round as "30-45 min"; researched real-round lengths are display-only and never size a mock. In a coding, system design or LLD round whose equal split would leave the main problem under 15 minutes (30 and 35 minutes, and 40 with a second problem or a part; never at 45, where every round keeps the pre-change split, decided 2026-10-18) the main problem gets 15, or all that the behavioural questions leave when it is the only problem (blueprint `plan_arc`, `coding_fit`); a coding round's second problem the core does not hold is a bonus (slot `bonus`, not reserved by the live conductor, given if the first went well and time allows; no longer at 45 minutes, where an extra-part coding round is back to two 11-minute problems and a 12-minute deep dive), a behavioural part keeps fewer, shorter questions (at least 4 minutes each; one at 30 minutes), and an extra part (projects, fundamentals, puzzles) is reserved at least 4 minutes before the questions shrink, or dropped from the plan and the briefing when it cannot have them (at 30 minutes beside a behavioural part). Where the old equal split already gave the problem 15 minutes it is unchanged; online assessments, hiring-manager and behavioural rounds have no floor, and neither does a fundamentals-led LLD round (its design problem is a warm-up and the fundamentals are the main part: its old split stays at every length). In the live round the length and each part's timebox are guidance (decided 2026-10-17): the director decides when a part ends, may extend it and may run the round past the session's length, up to a 1.5× safety ceiling of that length. Every DSA blueprint has two problems, as a real round does: the live interviewer gives the second only if the first went well (the director's `problem_signal`, two ladder hints, or running out of time decide) and otherwise skips it and ends early with a proper close. A request for a different coding problem is decided by the interviewer (decided 2026-10-18, replacing the 2026-10-15 exception and the same day's fixed first-ask-resisted rule): one fast structured call chooses resist, change or end the coding part, bounded by hard limits in code. At most one change per round, never before the round's first refusal, only with 8+ minutes left and a problem to give (the next planned one, else a non-harder reserve in its place, never the harder reserve); the coding part ends only after a refusal on that problem and nothing follows it; after 3 refusals on one problem the interviewer may no longer resist: the next ask gets the change or the end of the coding (decided 2026-10-18 after live round 781a1f0a, where a firm persona refused four times); a refusal never repeats a point an earlier one made. A call that times out or fails falls back to the persona's prior (soft/normal/firm firmness and refusals before it gives in, drawn at prep), and a blueprint without a realism block never asks the model: it follows the old rule (first ask resisted, second the change, then resist, then end the coding). Live entry needs the global switch `LIVE_INTERVIEWER_AVAILABLE=true` (default false) and a `CANDIDATE` or `ADMIN` role; a plain `USER` cannot book, reschedule, retry prep or go live (decided 2026-10-21, `apps/api/src/services/interviewAccess.ts`; admins change roles in Intelligence → Access). Admins diagnose every run in Intelligence → Interview prep. Each round gets a shape from a fixed library (`app/blueprint/shapes.py`, seeded per session, never one of the candidate's last two) that orders the conversation around the problems; the problems, their minutes and what is assessed never change with it, and the live interviewer leads the path within must-cover goals and a free-minutes budget (decided 2026-10-17). The interviewer never says any duration or minutes aloud (decided 2026-10-18): not the round's length, a part's length or the time left; the talker guard drops such a sentence and the trace check flags it. The interviewer tells talk to it from thinking aloud and reading aloud (`app/interviewer/addressed.py`, `ADDRESSED_CHECK` off|shadow|on, default shadow): rules first, one fast check on the talker model for the rest, a fixed check-in line once per problem when unclear, a nudge after 10 s of silence; the room has an Ask interviewer button (decided 2026-10-19). **Live-round fixes (2026-10-21, session 3e574171, a coding problem left four minutes in):** the addressed check now defaults to `on`, and a filler-only utterance ("Hmm"), words that are the problem's own text with no ask in them, and quiet speech with no ask in it are for nobody even straight after a question; the candidate's speech level (mean dBFS above a noise gate, from the microphone track, `app/interviewer/loudness.py`; quiet is 6 dB under their own median, loud 4 dB over, needs 3 utterances) is evidence only, passed to the model check and shown in the trace, and a missing track just means unknown volume. The conductor counts an ask only if it was played (an unplayed or cut-off turn takes its ask back), and `drop_question` now stops only that question (and its rewordings) and never moves on, wraps up or leaves the problem. A problem cannot read as a struggle (director signal or hint ladder) before the candidate has had max(8 min, 60 % of its timebox), capped at the timebox, on it (a give-up, the round clock and wrap-up are unchanged), and the interviewer's own re-ask or probe waits 25 s after a question while they speak or type. Spec: `docs/superpowers/specs/2026-10-07-interview-blueprint-design.md`.

**Round packs (built 2026-10-20, uncommitted until the owner commits):** one shared interviewer, with the rules of a round type held in a pack (dsa, online-assessment, system-design, lld, behavioural, hiring-manager; `app/rounds/`) and merged with the shared base and a level overlay into a versioned `rules` block stored on each blueprint (`rules2`, policies `pol2`, prep `packs-1`); a behavioural part of a technical round runs on the behavioural pack's item rules. The trace check `round_words` fails a spoken word the round forbids, the judge has a `round_fit` dimension and the bench reports each run's pack. The five non-DSA pack texts are PRODUCT IP DRAFTS for owner review; live entry follows the switch and role rule above. Docs: `apps/ai-service/docs/round-packs.md`; spec `docs/superpowers/specs/2026-10-20-round-packs-design.md`.

**Post-interview report, round score and gating (Module 04, built 2026-10-18, uncommitted):** when a round ends, a background run in the AI service grades each part with two LLM graders (a third breaks ties), then code computes one 1-10 score, a verdict and an outcome (passed, below_pass, auto_fail, unscorable); the candidate sees a report with every point tied to a quoted moment, the strong answer, topics to study, delivery (words and timing only, no audio), conduct and integrity notes, practice suggestions and a transcript, on the result page only. Candidates can dispute one question or area (3 per report, 14 days; a re-check never lowers a score). The pass mark (level + company tier + hard round) is fixed at booking; below it, a 7 or 14 day retake cooldown; passing unlocks the next round; readiness counts rounds passed on official loops only. Everything is versioned constants the owner can change: area weights and band anchors in `apps/ai-service/app/evaluation/weights.py` (`EVAL_WEIGHTS_VERSION` w1, `EVAL_VERSION` eval1), adjustments and verdict bands in `score.py`, grader prompts in `prompts.py` (DRAFT, owner review), pass mark, code standard, cooldown and readiness in `apps/api/src/domain/evaluation.ts`. The grading model and budget (`EVALUATION_MODEL`) and the exact numbers remain owner decisions. Docs: `apps/ai-service/docs/evaluation.md`, `apps/api/docs/round-gating.md`; spec `docs/superpowers/specs/2026-10-18-post-interview-report-design.md`.

**Full vision (16 modules — Phase 2+):** add Job Discovery & Gap Analysis, Adaptive Q&A Intelligence, Voice Conversation Engine refinements, Live Coding Environment, Integrity & Anti-Cheating, Community/Leaderboards (global interview-score boards), Hiring Partner Integration (exclusive openings, automated early-stage hiring), Analytics & Insights, Notifications Engine, Platform & Infrastructure (operational module).

---

## Integration sources (Profile Builder)

**V1 — Primary (MVP):**

1. **GitHub** — GraphQL API (backend collector, `apps/api/src/integrations/github`). Extract: languages by byte count, account age, top 5–10 active repos, profile README, yearly contribution graph, external PR/issue contributions, merged PRs to other people's public repositories (open-source scoring). Skip: fork counts, total commits (bot-inflated), tutorial repos (detect via README patterns), anything private. Weekly refresh.

2. **LeetCode** — No official API. Sourcing TBD (scrape vs paste-in). Extract: total solved + difficulty split, topic-wise solve count, contest rating + percentile, acceptance rate, recent submission activity, streak data. Skip: star counts, premium status, single-problem solve times. Bi-weekly refresh.

3. **Resume (PDF)** — Affinda for parsing. Extract: work/internship history, education + CGPA, listed skills, projects, achievements with metrics. Skip: buzzword adjectives, headshot (privacy), soft skill ratings. On-demand only.

**V2 — Phase 2 (deferred):**

4. **LinkedIn** — Built as a user-uploaded LinkedIn **Save to PDF** import (2026-10-04): free, nothing fetched from LinkedIn, profile sections only (no posts). Why not the alternatives: the official API exposes no career history or posts; Proxycurl shut down in 2025 after LinkedIn sued it; Firecrawl gates profile pages behind a person-data "enrichment" opt-in that returns a data-broker record, not the page. Don't reintroduce scraping or third-party LinkedIn data providers without the human. See `apps/api/docs/linkedin-import.md`.
5. **Coding platforms (built 2026-10-05):** Codeforces (official API), AtCoder (history JSON + AtCoder Problems), CodeChef (public profile page) and takeUforward/TUF (profile page + public profile API; linked LeetCode/Codeforces/etc. handles auto-connect). One handle-based connection (`platform_connection`, `/api/v1/connections/platforms`), weekly refresh, hash-skip. Analyzer specs: `apps/api/docs/sources/platform-analyzers.md`. HackerEarth has no public source and is not collected. X/Twitter was dropped as a source (2026-10-06); don't re-add it without the human.

---

## Synthesis output schema (the contract)

The Python synthesis service produces this JSON. The frontend consumes it directly.

```json
{
  "user_id": "uuid",
  "synthesis_version": "v1",
  "generated_at": "ISO timestamp",
  "model": "gpt-4o-mini",

  "summary": {
    "most_used_skills": [
      { "skill": "Python", "evidence": "GitHub 52%, LeetCode preferred, resume claimed" }
    ],
    "crucial_achievements": [
      { "achievement": "Smart India Hackathon 2024 finalist", "source": "resume" }
    ],
    "noticeable_things": ["observations that stand out across sources"],
    "narrative": "optional flowing-prose version for text-only contexts (~80-150 words)"
  },

  "ui_components": [
    { "component": "activity_heatmap", "source": "github", "data_ref": "fragments.github.activity.daily_contributions" },
    { "component": "language_bar_chart", "source": "github", "data_ref": "fragments.github.languages" },
    { "component": "leetcode_topic_radial", "source": "leetcode", "data_ref": "fragments.leetcode.solved.by_topic" }
  ],

  "provenance": [
    { "source": "github", "fragment_version": 7, "fragment_hash": "sha256:...", "fetched_at": "ISO" }
  ],

  "metadata": { "input_tokens": 4521, "output_tokens": 893, "synthesis_duration_ms": 2340 }
}
```

**Hard rules — never violate:**

- **No scores inside this contract.** No `score`, `rating`, `rank`, `grade`, `tier_vs_peers`, or any comparative metric in this schema; the `ProfileSummary` stays purely descriptive. The interview score, round results and leaderboards are real product features, but they live in a **separate scoring contract** (e.g. `ScoringSummary`), never grafted onto this one.
- **Three bullet categories are fixed.** `most_used_skills`, `crucial_achievements`, `noticeable_things`. The LLM doesn't invent new categories — it fills these. (`at_a_glance` was dropped on 2026-10-02 — don't bring it back without the human.)
- **Every skill carries evidence.** Format: cross-source attribution naming the specific sources (e.g. "GitHub 52%, LeetCode preferred, resume claimed"). No skill without evidence.
- **Every achievement carries a source.** Format: `{ achievement, source }`. No floating claims.
- **UI components are declarative.** Frontend has a registered renderer for each component type listed in the registry. Synthesis emits the spec; UI handles rendering. Adding a new component type = a frontend component + a prompt template update + a `UIComponentType` union entry. No schema change.

---

## Scoring, round gating & readiness

Scores are part of the product (see *Product vision*), with these guardrails:

- **Separate contracts.** The interview score, per-round results, readiness levels, readiness reports and leaderboards live outside the descriptive `ProfileSummary`. The profile page shows both: the descriptive summary and the interview score.
- **Approved profile-scoring beta.** The human reversed the no-profile-score decision and authorized configurable provisional rules. Current v2 scoring uses the shared eight levels; old six-rubric v1 snapshots remain replayable. Scoring has separate contracts, reproducible snapshots, coverage and opt-in same-level rankings. v5 takes source data as correct: no confidence weighting; the score is a plain weighted sum in which every part is expected at the level in proportion to its weight, so a missing, failed or not-found part or sub-feature counts as 0 (interchangeable signals from different platforms are alternatives); and there is no minimum coverage for the opt-in leaderboard (`apps/api/docs/profile-scoring-v5.md`). It never changes interview results or readiness. Methodology is in `apps/api/docs/profile-scoring-beta.md`; advanced source/achievement verification remains deferred.
- **JD fit (approved 2026-10-06).** Each role card shows how closely the user's resume, GitHub and coding profiles match that JD ("72% match"): skills, domain, role, experience and round topics, weighted by the JD's level. It's a separate contract, fit only (the profile score is never blended in), rules only (keyword dictionary, no LLM; LLM tagging may come later behind a flag), computed on request and never stored. LinkedIn isn't read. A missing user source counts 0; a part the JD gives nothing for is dropped. Broad DSA rounds ("Data structures", a DSA round with no topic) score on total problems solved; a generic company sector falls back to domains named in the JD's text; a missing or track-name specialization is a generalist role; a job at a catalogue company counts toward that company's (specific) sector; skills can be shown by implying skills or by the role's work (backend → HTTP/APIs). `apps/api/scripts/dev/` seeds 28 fabricated persona accounts and audits the full persona × JD matrix; run the audit after changing the dictionary or targets. Practice templates carry their level's typical experience range, labelled "typical for level", and never pay. A JD 2+ levels above the user's level is capped at 40 and labelled a stretch role; a JD below the user's level is multiplied by 0.85 (one level) or 0.7 (two or more), and experience above a JD's range decays to a 0.5 floor. It never affects interview results, gating, readiness or leaderboards, and is never worded as eligibility (`apps/api/docs/jd-fit.md`).
- **One engineering-level enum everywhere.** Values: `intern`, `fresher`, `sde1`, `sde2`, `sde3`, `staff`, `principal`, `distinguished`. Onboarding/profile, company JDs, process creation/editing, experiences and scoring share this enum. Current profile level is one persisted choice, never inferred from or replaced by a target JD. No free-form level writes. Known legacy aliases normalize on reads; unknown old labels remain unset with repair metadata. Do not rewrite booked identities or frozen snapshots. Log levels and verbatim research seniority evidence are not engineering user-choice enums.
- **Explainable.** Every score must be traceable to its inputs (which answers, which rubric criteria), the same way every profile claim carries evidence. A user should always be able to ask "why is my score this?" and get an answer.
- **Official loops only.** Only interviews from an unedited, suggested loop count toward loop progress, the readiness level and Interview-ready status. Edited loops are standalone.
- **Gating is server-enforced.** The API enforces pass thresholds, the retake cooldown and round unlocks; the UI only reflects them. Interview-ready status and readiness reports feed the hiring pitch to companies, so they must be trustworthy.
- **No badges, no implied endorsement.** Never present readiness as a badge, a certificate, or anything that suggests the company endorsed it. Copy always frames it as mock-interview readiness (e.g. "Interview-ready · Meesho SDE I mock process"), never "Cleared Meesho" or "Meesho certified".
- **Formulas are product decisions.** The human decides the interview-score aggregation, per-round pass thresholds, cooldown length and leaderboard rules (see *Open decisions*). Module 04 shipped first-draft values for the per-round score, pass marks, 7/14 day cooldown and readiness mapping as versioned constants (see the Module 04 paragraph for where); the owner can change any of them, and the values are provisional until confirmed.

---

## Web frontend folder structure

```
apps/web/
  app/
    (marketing)/        layout, page, pricing, for-colleges, about, contact
    (auth)/             layout, login, signup, forgot-password, verify-email
    (app)/              layout, dashboard, practice, leaderboard, help
      onboarding/       page, resume, connections, target-role
      profile/          page, connections, _components/
      jobs/             page, [jobId], _components/
      loops/            page, new, [loopId], _components/
      interviews/[sessionId]/
        page, live/(page + _components/), report/(page + _components/)
      settings/         account, billing, notifications, privacy
    (admin)/            layout, dashboard, batches, reports, settings
      students/         page, [studentId], bulk-upload
      drives/           page, new, [driveId]
    api/                webhooks/{razorpay,github}   # no [...nextauth] — auth is backend-owned
  components/           ui/ (shadcn), layout/, feedback/, data/, visualizations/
  features/             profile/, interview/, jobs/, loops/, billing/, admin/
                        — each: hooks/, api/, types/, index.ts
  lib/
    api-client/         client.ts, generated/ (from OpenAPI), endpoints/
    auth/, analytics/, observability/, utils/, hooks/, providers/, constants/
  types/                domain.ts, ui-components.ts, env.d.ts, api.ts
  middleware.ts (auth gating), .env.example
```

---

## Critical conventions

**Route groups** `(marketing)`, `(auth)`, `(app)`, `(admin)` each have their own `layout.tsx` so they can have completely different shells without URL prefixes.

**`_components/` private folders** for route-specific UI. Use them aggressively. Promote to `components/` only when 3+ unrelated features need it.

**`features/{name}/` for cross-route feature logic.** Hooks and API clients that are used by multiple routes within a feature go here, not in any single route's `_components/`.

**Dynamic route params are async in Next.js 16:**
```tsx
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
}
```

**Server Components by default.** Use `"use client"` only when you need: interactivity, browser APIs (WebRTC, localStorage), state hooks, or third-party client-only libraries.

**OpenAPI codegen is the source of truth** for API client types. Never hand-write types that match API DTOs. Run `scripts/generate-types.ts` after any contract change.

**The `ui_components` registry in `types/ui-components.ts`** must stay in sync with both the synthesis output and the registered React renderers. Adding a new component type means updating: the type union, the prompt template (synthesis), and the renderer (web).

---

## DO and DON'T

**DO:**
- Read existing analyzers / HLDs / code maps in the project artifacts before designing anything new
- Reference `github-readme-stats` source for GitHub aggregation patterns (MIT licensed)
- Use Affinda for resume parsing (or pyresparser as OSS fallback)
- Hash-check fragment content before triggering synthesis (cost discipline)
- Generate API client types from `packages/contracts/openapi.yaml` — never hand-write
- Flag breaking decisions for human review rather than choosing unilaterally
- Default to descriptive language in the profile summary (synthesis output), never comparative; scores and ranks are shown separately

**DON'T:**
- Put scores, ranks, or comparative metrics inside the descriptive synthesis output; they belong in the separate scoring contract
- Count an edited (customized) loop toward loop progress or readiness
- Show readiness as a badge or certificate, or word it so it implies the company endorsed it
- Promise LinkedIn post analysis in UI copy (the data isn't available)
- Scrape LinkedIn via OSS libraries (TOS + account ban + reliability risk)
- Write Next.js API routes for anything beyond auth callbacks, webhooks, and BFF aggregation
- Build the Next.js admin panel sharing components with the student app shell — they should evolve independently
- Cache GitHub data on demand (always background-refresh, weekly cadence)
- Process resume headshot images (privacy + bias risk — strip on parse)
- Add new sources without writing the corresponding analyzer spec first (signals, skip-list, fragment shape, refresh cadence)
- Reach for Temporal/Kafka/etc. when a simple cron job + Redis queue would do (we're pre-revenue, ruthless on complexity)

---

## Open decisions — flag, don't decide

These are pending and should be raised with the human, not chosen autonomously:

- **LeetCode sourcing strategy** — scrape vs paste-in vs unofficial API (each has different code shape, pick one before writing the collector)
- **Voice AI pipeline** — Deepgram+GPT-4o-mini+ElevenLabs (cheaper, more parts to break) vs OpenAI Realtime API (pricier, less plumbing)
- **Background job queue** — in-process schedulers (today) vs a real queue — keep it simple until it hurts
- **Auth provider** — NextAuth (full control, more setup) vs Clerk (hosted, faster, ~$25/mo at scale)
- **Tutorial repo detection heuristic** — needs human review of false positives before shipping (this is high-leverage product IP)
- **Synthesis prompt template** — the actual `synthesis_v1.txt` is the product's core IP, draft for human review before production use
- **Scoring formulas & thresholds** — interview-score aggregation, per-round pass thresholds, retake cooldown (1 vs 2 weeks), leaderboard scopes and rules, whether standalone interviews count toward the interview score, and the readiness-level mapping (which levels exist and what moves a user between them: rounds cleared, scores, or both)
  - *Module 04 shipped drafts to confirm:* area weights, hint/bonus/penalty adjustments, pass marks (6.0-7.5 base by level, tier and hard-round bumps), cooldown 7/14 days, readiness by rounds passed, the grading model and budget (`EVALUATION_MODEL`), and the DRAFT grader prompts. Cross-round interview-score aggregation, leaderboards and the shareable readiness report are still not built.
- **Scoring phasing** — which of the interview score, readiness levels/reports and leaderboards ship in the MVP vs later

---

## Working principles

**Describe in the summary, score separately.** The profile summary describes what the data shows. It doesn't grade, rank, or compare candidates: "412 problems solved (78 Easy, 268 Medium, 66 Hard)", not "above-average solver". Interview results and the approved beta Profile score have separate explainable contracts. Never merge those scores or portray the beta as a validated hiring assessment.

**Evidence on every claim.** If the synthesis says someone uses Python, the evidence string names the sources (GitHub bytes, LeetCode preference, resume claim). Users should always be able to ask "why does my profile say this?" and get a traceable answer.

**Pre-revenue discipline.** When tempted to add a queue / cache / framework / observability tool — ask whether a simpler thing would work for the first 100 users. Most things would.

**Sources are additive, never required.** Synthesis must produce a useful summary from any subset of connected sources, including just resume + LeetCode (the V1 minimum). Don't assume GitHub or LinkedIn is present.

**Audience calibration matters.** The first market, Tier 2/3 Indian college students, has thin GitHub, strong LeetCode, and often no real LinkedIn or Twitter. Build for that reality, not for the SF senior engineer with 5 years of OSS contributions. Working professionals are a second audience with a different shape (real work experience, job-switch rather than campus-placement framing); serve both, and don't assume either profile shape.

---

## Stop-and-ask list

Stop and ask the human before:
- Choosing among the "open decisions" above
- Adding a new field to the synthesis output schema
- Adding scores, ranks, or comparisons to the descriptive synthesis output, or defining or changing any scoring formula, pass threshold, cooldown, readiness rule, or leaderboard rule
- Making a security-relevant choice (token storage, encryption, OAuth scope expansion)
- Adopting a new runtime dependency that isn't in the tech stack list above
- Touching billing, payment, or financial logic
- Implementing the synthesis prompt template (this is product IP — draft first, human reviews)

Everything else: proceed and document the choice in your PR description.
