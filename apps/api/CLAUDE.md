# InterviewIQ — Project Context

> Drop this file at the root of any repo (`interviewiq-web`, `interviewiq-api`, `interviewiq-synthesis`, `interviewiq-infra`). Claude Code reads it at session start. Many tools also recognize the filename `CLAUDE.md` — rename if your tool expects that.

---

## What this is

AI-powered mock interview platform for software engineers. Voice-driven interviewer with full candidate context (resume + coding platform profiles), conducts role/company-specific interview loops, generates structured feedback.

**Primary audience:** Tier 2/3 Indian engineering college students preparing for campus placements. **Go-to-market:** B2B sales to college Training & Placement Officers (TPOs), then B2C expansion.

**Why the platform exists:** Real interview practice is scarce, expensive, and inconsistent. Existing tools (Pramp, Interviewing.io) are peer-based and English-fluent-defaulting; LeetCode is solo and doesn't simulate interviews. InterviewIQ gives every student unlimited, role-specific, voice-based mock interviews with a personalized AI interviewer.

---

## Architecture: polyrepo (2 repos today → 4 eventually)

**Today — what actually exists:**

1. **`interviewiq-backend`** — Spring Boot 4.0.6 + Java 25 backend. Owns all domain logic, persistence, OAuth flows (backend-owned), integration collectors (GitHub, LeetCode, etc.), interview session orchestration, billing. *(Referred to as `interviewiq-api` in older doc names.)*
2. **`interviewiq-frontend`** — Next.js 16 App Router frontend. Student app + TPO admin panel + marketing. Server Components by default; Client only where needed. *(Referred to as `interviewiq-web` in older doc names.)*

**Eventually — planned, not yet created:**

3. **`interviewiq-synthesis`** — Python FastAPI microservice. Single responsibility: AI orchestration. Takes profile fragments → calls LLM → returns structured summary. Voice pipeline orchestration (Deepgram + GPT-4o-mini + ElevenLabs) lives here. **Does not exist yet** — design for it, but synthesis has no running home today.
4. **`interviewiq-infra`** — Terraform + docker-compose + OpenAPI contracts + shared scripts. The `contracts/openapi.yaml` here is the source of truth for the api ↔ web and api ↔ synthesis boundaries; both web and synthesis generate client stubs from it.

Polyrepo is intentional — services can be deployed and scaled independently, and the synthesis service in particular needs different dependencies (Python ML libs) than the rest.

---

## Tech stack (confirmed)

**Frontend (`interviewiq-frontend`):** Next.js 16 (App Router), React 19, TypeScript, Tailwind 3.x (NOT 4), shadcn/ui (classic 2.10 CLI — latest 4.x is Tailwind-4-centric) + Geist fonts/design tokens, TanStack Query v5, Zod, react-hook-form. **Auth is backend-owned — no NextAuth/Auth.js.** Frontend holds an in-memory access token + an httpOnly refresh cookie.

**Backend (`interviewiq-backend`):** Spring Boot 4.0.6, Java 25, Hibernate 7, Jackson 3, PostgreSQL 16, Redis 7. Schema via Hibernate `ddl-auto=update` — **no Flyway**. Octokit Java for GitHub. **Backend-owned auth: Google OAuth + custom JWT (no Auth.js).** Razorpay for payments. Resend for transactional email.

**Synthesis (`interviewiq-synthesis`):** Python 3.11, FastAPI, async. Deepgram (STT) + GPT-4o-mini (LLM) + ElevenLabs (TTS) for voice. Affinda for resume parsing (paid) with pyresparser as OSS fallback. Judge0 (Dockerized) for code execution.

**Infra:** Vercel (web), Railway/Fly (api + synthesis), Cloudflare (CDN + WAF), S3 + MinIO (local dev), Docker Compose for local stack. Sentry + PostHog + Spring Actuator/Micrometer for observability (day-one).

**Open stack decisions** (don't decide unilaterally, flag and ask):
- Background job queue: jobrunr (current lean) vs Quartz vs Temporal vs Celery (Python side)
- Logging: Logback + logstash-encoder + Logtail (current lean)
- LeetCode data sourcing: scrape vs paste-in vs unofficial community API
- Voice pipeline: stay with Deepgram+GPT+ElevenLabs vs OpenAI Realtime API (cost vs latency trade)

---

## Current focus: Profile Builder (Module 01)

The first major feature being built. Takes raw user data from multiple sources, normalizes it, and synthesizes a **descriptive** profile summary (no scoring, no ranking).

**Data flow:**
1. User connects sources (OAuth for GitHub, paste/upload for resume + LeetCode)
2. Backend collectors fetch raw data, normalize into `ProfileFragment` per source, store in Postgres + S3 (raw response cache)
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
2. Job/Loop Setup (target role + company + JD)
3. Live Interview Session (voice + code + AI interviewer)
4. Post-Interview Report (structured debrief)
5. University Admin Panel (TPO dashboard, roster, drives)
6. Platform Essentials (auth, billing, settings, notifications)

**Full vision (17 modules — Phase 2+):** add Job Discovery & Gap Analysis, Adaptive Q&A Intelligence, Voice Conversation Engine refinements, Live Coding Environment, Integrity & Anti-Cheating, Community/Leaderboards, Hiring Partner Integration, Reputation Score, Analytics & Insights, Notifications Engine, Platform & Infrastructure (operational module).

---

## Integration sources (Profile Builder)

**V1 — Primary (MVP):**

1. **GitHub** — GraphQL API via Octokit Java. Extract: languages by byte count, account age, top 5–10 active repos, profile README, yearly contribution graph, external PR/issue contributions. Skip: fork counts, total commits (bot-inflated), tutorial repos (detect via README patterns). Weekly refresh.

2. **LeetCode** — No official API. Sourcing TBD (scrape vs paste-in). Extract: total solved + difficulty split, topic-wise solve count, contest rating + percentile, acceptance rate, recent submission activity, streak data. Skip: star counts, premium status, single-problem solve times. Bi-weekly refresh.

3. **Resume (PDF)** — Affinda for parsing. Extract: work/internship history, education + CGPA, listed skills, projects, achievements with metrics. Skip: buzzword adjectives, headshot (privacy), soft skill ratings. On-demand only.

**V2 — Phase 2 (deferred):**

4. **LinkedIn** — API locked down post-2023 (no posts, no activity). Options: OAuth-for-verification-only, Proxycurl paid service ($0.01-0.10/lookup), or manual paste-in. Avoid OSS scrapers (TOS + account ban risk).
5. **HackerRank** — No public API. Certifications (Python, SQL) + star ratings per domain are the value. Monthly refresh.
6. **Codeforces** — Clean public API. Rating + tier + contests + tag-wise solves. Niche audience (top-tier college CP enthusiasts).
7. **X/Twitter** — Paid API only since 2023. Recommend storing handle for link-out, no extraction at MVP. Add only if a clear use case emerges.

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
    "at_a_glance": ["3-5 high-level identifier bullets"],
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

- **No scoring, ever.** No `score`, `rating`, `rank`, `grade`, `tier_vs_peers`, or any comparative metric in this schema. Profile Builder is purely descriptive. If a scoring feature is requested, it belongs in a separate `ScoringSummary` contract, never grafted onto this one.
- **Four bullet categories are fixed.** `at_a_glance`, `most_used_skills`, `crucial_achievements`, `noticeable_things`. The LLM doesn't invent new categories — it fills these.
- **Every skill carries evidence.** Format: cross-source attribution naming the specific sources (e.g. "GitHub 52%, LeetCode preferred, resume claimed"). No skill without evidence.
- **Every achievement carries a source.** Format: `{ achievement, source }`. No floating claims.
- **UI components are declarative.** Frontend has a registered renderer for each component type listed in the registry. Synthesis emits the spec; UI handles rendering. Adding a new component type = a frontend component + a prompt template update + a `UIComponentType` union entry. No schema change.

---

## Web frontend folder structure

```
interviewiq-web/
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

**OpenAPI codegen is the source of truth** for API client types. Never hand-write types that match Spring DTOs. Run `scripts/generate-types.ts` after any contract change.

**The `ui_components` registry in `types/ui-components.ts`** must stay in sync with both the synthesis output and the registered React renderers. Adding a new component type means updating: the type union, the prompt template (synthesis), and the renderer (web).

---

## DO and DON'T

**DO:**
- Read existing analyzers / HLDs / code maps in the project artifacts before designing anything new
- Use Octokit Java for GitHub API (don't write HTTP from scratch)
- Reference `github-readme-stats` source for GitHub aggregation patterns (MIT licensed)
- Use Affinda for resume parsing (or pyresparser as OSS fallback)
- Hash-check fragment content before triggering synthesis (cost discipline)
- Generate API client types from `contracts/openapi.yaml` — never hand-write
- Flag breaking decisions for human review rather than choosing unilaterally
- Default to descriptive language in Profile Builder output, never comparative

**DON'T:**
- Add scoring, ranking, or comparative metrics anywhere in Profile Builder
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
- **Background job queue** — jobrunr vs Quartz vs Celery vs Temporal (current lean: jobrunr for simplicity)
- **Auth provider** — NextAuth (full control, more setup) vs Clerk (hosted, faster, ~$25/mo at scale)
- **Tutorial repo detection heuristic** — needs human review of false positives before shipping (this is high-leverage product IP)
- **Synthesis prompt template** — the actual `synthesis_v1.txt` is the product's core IP, draft for human review before production use

---

## Working principles

**Descriptive over evaluative.** Profile Builder describes what the data shows. It doesn't grade, rank, or compare candidates. "412 problems solved (78 Easy, 268 Medium, 66 Hard)" not "above-average solver".

**Evidence on every claim.** If the synthesis says someone uses Python, the evidence string names the sources (GitHub bytes, LeetCode preference, resume claim). Users should always be able to ask "why does my profile say this?" and get a traceable answer.

**Pre-revenue discipline.** When tempted to add a queue / cache / framework / observability tool — ask whether a simpler thing would work for the first 100 users. Most things would.

**Sources are additive, never required.** Synthesis must produce a useful summary from any subset of connected sources, including just resume + LeetCode (the V1 minimum). Don't assume GitHub or LinkedIn is present.

**Audience calibration matters.** Tier 2/3 Indian college students have thin GitHub, strong LeetCode, often no real LinkedIn or Twitter. Build for that reality, not for the SF senior engineer with 5 years of OSS contributions.

---

## Stop-and-ask list

Stop and ask the human before:
- Choosing among the "open decisions" above
- Adding a new field to the synthesis output schema
- Adding scoring, ranking, or comparison logic anywhere in Profile Builder
- Making a security-relevant choice (token storage, encryption, OAuth scope expansion)
- Adopting a new runtime dependency that isn't in the tech stack list above
- Touching billing, payment, or financial logic
- Implementing the synthesis prompt template (this is product IP — draft first, human reviews)

Everything else: proceed and document the choice in your PR description.