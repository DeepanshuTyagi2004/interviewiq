@AGENTS.md
# InterviewIQ — Project Context
---

## What this is

AI-powered mock interview platform for software engineers. A voice-driven AI interviewer with full candidate context (resume + coding platform profiles) runs a target company's real interview process for a specific JD, round by round, then gives a scored, structured debrief.

**Audience:** students preparing for campus placements (first market: Tier 2/3 Indian engineering colleges) **and** working professionals preparing for a job switch. **Go-to-market:** universities (B2B, via TPOs) → public launch in parallel (B2C) → company partnerships (exclusive openings) → automated early-stage hiring.

**Why the platform exists:** Real interview practice is scarce, expensive, and inconsistent. Existing tools (Pramp, Interviewing.io) are peer-based and English-fluent-defaulting; LeetCode is solo and doesn't simulate interviews. InterviewIQ gives every candidate unlimited, company-specific, voice-based mock interviews with a personalized AI interviewer.

**The full candidate journey and the scoring rules** (per-JD loop dashboard, editable rounds where an edited loop is standalone, pass thresholds, retake cooldown, readiness levels, Interview-ready status and the readiness report, the interview score (there is no profile score), leaderboards) are in the root `CLAUDE.md`, under *Product vision* and *Scoring, round gating & readiness*. No badges: readiness is never shown as a badge or certificate, or worded to imply company endorsement. Read them before building any of those screens.

---

## Architecture: monorepo (`interviewiq/`)

1. **`apps/web`** (this app) — Next.js 16 App Router frontend. Student app + TPO admin panel + marketing. Server Components by default; Client only where needed.
2. **`apps/api`** — Node.js 22+ / Express 5 / TypeScript backend (migrated from Spring Boot; same HTTP contract). Owns all domain logic, persistence, OAuth flows, integration collectors (GitHub, LeetCode), interview session orchestration.
3. **`apps/ai-service`** — Python FastAPI service. All LLM orchestration (briefs, résumé parsing, interview prep, live interview agent).
4. **`packages/contracts`** — `openapi.yaml`, the source of truth for the web ↔ api ↔ ai-service boundaries; the web generates client types from it. **`infra/`** — docker-compose + env templates.

Services still deploy and scale independently; the monorepo only shares tooling (pnpm workspaces + Turborepo), contracts, and history.

---

## Tech stack (confirmed)

**Frontend (`apps/web`):** Next.js 16 (App Router), React 19, TypeScript, Tailwind 3.x (NOT 4), shadcn/ui, TanStack Query v5, Zod, react-hook-form. **Auth is backend-owned** — the API runs the Google OAuth handshake and email + password sign-in, and issues JWTs; the frontend is a thin Bearer-token client (NOT NextAuth — see Auth section below).

**Backend (`apps/api`):** Node.js / Express 5 / TypeScript. **Postgres (Supabase)** via Drizzle ORM for relational data (users, refresh tokens, companies/JDs, interview sessions, connections); **MongoDB (Atlas)** via the native driver for documents (candidate profiles, profile fragments, session outcomes). Local dev uses Postgres + Mongo containers.

**AI service (`apps/ai-service`):** Python 3.11+, FastAPI, async, MongoDB (Atlas). LLM via OpenAI-compatible endpoints; LiveKit Agents + Deepgram for the voice interview.

**Infra:** Vercel (web), Railway/Fly (api + ai-service), Supabase (Postgres), MongoDB Atlas, Docker Compose for the local stack. Sentry + PostHog for observability.

**Open stack decisions** (don't decide unilaterally, flag and ask):
- Background job queue: in-process schedulers today (API + ai-service) vs a real queue later
- Logging: pino (API) + stdlib logging (ai-service) → shipping target TBD
- LeetCode data sourcing: scrape vs paste-in vs unofficial community API
- Voice pipeline: stay with Deepgram+GPT+ElevenLabs vs OpenAI Realtime API (cost vs latency trade)

---

## Current focus: Profile Builder (Module 01)

The first major feature being built. Takes raw user data from multiple sources, normalizes it, and synthesizes a **descriptive** profile summary. The summary itself carries no scores or ranks, and there is no profile score: sources describe the candidate, they don't score them (see the root `CLAUDE.md`).

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
4. Post-Interview Report (scored debrief with ideal answers, topics to learn and an overall score; the pass threshold unlocks the next round, otherwise a retake cooldown applies; clearing every round of an unedited loop makes the user Interview-ready for that JD and unlocks the readiness report)
5. University Admin Panel (TPO dashboard, roster, drives)
6. Platform Essentials (auth, billing, settings, notifications)

**Full vision (16 modules — Phase 2+):** add Job Discovery & Gap Analysis, Adaptive Q&A Intelligence, Voice Conversation Engine refinements, Live Coding Environment, Integrity & Anti-Cheating, Community/Leaderboards (global interview-score boards), Hiring Partner Integration (exclusive openings, automated early-stage hiring), Analytics & Insights, Notifications Engine, Platform & Infrastructure (operational module).

---

## Integration sources (Profile Builder)

**V1 — Primary (MVP):**

1. **GitHub** — GraphQL API (backend collector). Extract: languages by byte count, account age, top 5–10 active repos, profile README, yearly contribution graph, external PR/issue contributions. Skip: fork counts, total commits (bot-inflated), tutorial repos (detect via README patterns). Weekly refresh.

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
    api/                auth/[...nextauth], webhooks/{razorpay,github}
  components/           ui/ (shadcn), layout/, feedback/, data/, visualizations/
  features/             profile/, interview/, jobs/, loops/, billing/, admin/
                        — each: hooks/, api/, types/, index.ts
  lib/
    api-client/         client.ts, generated/ (from OpenAPI), endpoints/
    auth/, analytics/, observability/, utils/, hooks/, providers/, constants/
  types/                domain.ts, ui-components.ts, env.d.ts, api.ts
  middleware.ts (pass-through — auth gating is client-side), .env.example
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

## Authentication — backend-owned (NOT NextAuth)

The API (`apps/api`) owns the **entire** Google OAuth handshake and the email + password flow, and issues tokens. The frontend never talks to Google directly and does **not** use NextAuth/Auth.js. Do not reintroduce NextAuth.

**The flow:**
1. Either `loginWithGoogle()` → `window.location` to `{API}/oauth2/authorization/google` (backend runs the Google handshake), or `AuthProvider.signIn/signUp` → `POST /api/v1/auth/login|register` with `credentials: "include"`, which returns the access token directly.
2. Backend sets an httpOnly `refresh_token` cookie (path `/api/v1/auth`, 14-day); for Google it then redirects to `/auth/callback` on the frontend.
3. `AuthProvider` (mounted at the root) runs a **silent refresh** on mount: `POST /api/v1/auth/refresh` with `credentials: "include"` → returns a 15-min access-token JWT.
4. The access token is held **in memory only** (`lib/auth/token-store.ts`) — never localStorage/sessionStorage (XSS hygiene). Persistence across reloads comes from the refresh cookie + silent refresh.
5. `apiFetch` attaches `Authorization: Bearer <token>` and, on a 401, silently refreshes once and retries.
6. `AuthProvider` schedules a refresh ~60s before token expiry to keep the session alive.
7. `logout()` → `POST /api/v1/auth/logout` (revokes server-side) + clears the in-memory token.

**Route gating is client-side.** The in-memory token and the path-scoped cookie are invisible to Next middleware, so `middleware.ts` is a pass-through. Protected route groups wrap children in `components/auth/RequireAuth.tsx`, which shows a spinner during the initial refresh and redirects to `/login?next=…` if unauthenticated.

**Email + password:** `/signup`, `/login`, `/forgot-password`, `/reset-password?token=`, `/verify-email?token=` (all in `app/(auth)`). Until a mail provider is chosen the API **logs** verification/reset links to its console. Google sign-in on an email with an unverified password account links to it and drops the password (anti pre-hijacking). Auth error copy is keyed on the API's stable codes in `app/(auth)/_components/errors.ts`. Sign-in, sign-up and logout clear the TanStack Query cache so one account's data never shows in another's session.

**Key files:** `lib/auth/{token-store,client,AuthProvider}.ts(x)`, `components/auth/RequireAuth.tsx`, `app/auth/callback/page.tsx`, `app/(auth)/_components/`, `lib/api-client/{client,errors}.ts`.

**Config:** `NEXT_PUBLIC_API_URL` must match the backend origin (`http://localhost:8080` in dev) AND the backend's `FRONTEND_URL` / CORS origin must point back at the frontend (`http://localhost:3000`). A mismatch breaks the OAuth redirect or CORS.

**Current user:** `useCurrentUser()` reads `GET /api/v1/users/me` (incl. `onboardingComplete`, `emailVerified`, `hasPassword`). Cookies are `secure=false` in dev; must flip to `true` for prod.

---

## Design & aesthetics — the InterviewIQ design (Claude Design) + Vercel craft

**The source of truth for look and layout is the Claude Design export in `InterviewIQ Landing Page/`** (a local folder at the repo root, gitignored — not in the remote) — `InterviewIQ Website v5.dc.html` (marketing), `InterviewIQ Auth.dc.html` (sign-in/up + onboarding) and `InterviewIQ App.dc.html` (app shell + screens). Implement new screens from those files first. Where the design is silent, fall back to the Vercel/Geist craft below.

**Built so far from the design:** marketing landing (`app/(marketing)`), auth + onboarding (`app/(auth)`, `app/(onboarding)`), the app shell (`components/layout/app-shell/` — top bar, ⌘K search, the menu revealed behind the page card, `M` to toggle) and the dashboard. Screens in the App design that need data the backend doesn't have yet (scores, ranks, leaderboards, readiness) render **honest empty states** ("—", "coming soon"), never the design's sample numbers.

**Fallback — Vercel craft:** the aesthetic and UX should otherwise feel like Vercel. Treat [vercel.com](https://vercel.com), the [Vercel Dashboard](https://vercel.com/dashboard), and [Vercel Design / Geist](https://vercel.com/geist/introduction) as the canonical reference for everything visual and interactive. When in doubt about how something should look or feel, the answer is "however Vercel does it."

**This applies to all of it:**
- **Visual language** — clean, minimal, high-contrast, lots of whitespace. Black/white core palette with restrained accent color. Sharp, precise, no clutter.
- **Components** — model every component on Vercel's. Use the **Geist Design System** and **shadcn/ui** (which Vercel authors) as the component foundation. Buttons, inputs, cards, tabs, dropdowns, modals, tooltips, command menus (⌘K), toasts, tables, badges — match Vercel's versions in look and behavior.
- **Typography** — use the **Geist** and **Geist Mono** typefaces. Match Vercel's type scale, weights, and tight tracking.
- **Color & theming** — adopt Geist color tokens (grays, accent scales, semantic colors). First-class dark mode, exactly like Vercel's.
- **Spacing, radius, borders, shadows** — match Vercel's tokens: subtle borders (`1px` hairline borders on `--ds-gray-*` tones), small-to-medium radii, soft layered shadows, generous consistent spacing.
- **Animations & motion** — match Vercel's feel: fast, subtle, purposeful. Smooth easing, micro-interactions on hover/focus/press, content-aware transitions, skeleton loaders, optimistic UI. No bouncy/playful/over-animated motion. Reference Vercel's motion patterns (and `framer-motion` where needed).
- **Assets & iconography** — use **Geist Icons** (or `lucide-react`, which Vercel uses) for a consistent line-icon set. Illustrations, empty states, gradients, grid/dot backgrounds, and noise textures should echo Vercel's style.
- **Layout & navigation** — dashboard shells, sidebars, breadcrumbs, page headers, and content density should mirror Vercel's dashboard.
- **Interaction patterns** — command palette, keyboard shortcuts, inline editing, loading/empty/error states — all follow Vercel's conventions.

**Practical rule:** before building or styling any UI, look at how Vercel does the equivalent thing and replicate it. Pull components/inspiration from `shadcn/ui` and Geist first; only hand-roll when Vercel has no equivalent — and even then, match the Vercel aesthetic. Don't invent a separate design language.

> Caveat: this is about look, feel, components, and motion — **not** about copying Vercel's product copy, branding, or logos. InterviewIQ keeps its own brand identity and content; it borrows Vercel's *design craft*.

---

## DO and DON'T

**DO:**
- Read existing analyzers / HLDs / code maps in the project artifacts before designing anything new
- Use the GitHub GraphQL API from the backend collectors (`apps/api/src/integrations/github`)
- Reference `github-readme-stats` source for GitHub aggregation patterns (MIT licensed)
- Use Affinda for resume parsing (or pyresparser as OSS fallback)
- Hash-check fragment content before triggering synthesis (cost discipline)
- Generate API client types from `contracts/openapi.yaml` — never hand-write
- Flag breaking decisions for human review rather than choosing unilaterally
- Default to descriptive language in the profile summary (synthesis output), never comparative; scores and ranks are shown separately

**DON'T:**
- Put scores, ranks, or comparative metrics inside the descriptive synthesis output; they belong in the separate scoring contract
- Count an edited (customized) loop toward loop progress or readiness, or treat UI-side gating as the enforcement (the API enforces thresholds, cooldowns and unlocks)
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
- **Background job queue** — jobrunr vs Quartz vs Celery vs Temporal (current lean: jobrunr for simplicity)
- **Auth provider** — NextAuth (full control, more setup) vs Clerk (hosted, faster, ~$25/mo at scale)
- **Tutorial repo detection heuristic** — needs human review of false positives before shipping (this is high-leverage product IP)
- **Synthesis prompt template** — the actual `synthesis_v1.txt` is the product's core IP, draft for human review before production use
- **Scoring formulas & thresholds** — interview-score aggregation, per-round pass thresholds, retake cooldown (1 vs 2 weeks), leaderboard rules, whether standalone interviews count toward the interview score, and the readiness-level mapping (which levels exist and what moves a user between them)
- **Scoring phasing** — which of the interview score, readiness levels/reports and leaderboards ship in the MVP vs later

---

## Working principles

**Describe in the summary, score separately.** The profile summary describes what the data shows. It doesn't grade, rank, or compare candidates: "412 problems solved (78 Easy, 268 Medium, 66 Hard)", not "above-average solver". The interview score is shown alongside the summary, comes from a separate contract, and must be explainable. There is no profile score.

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
---

## Geist implementation (strict — this is the law)

"Vercel aesthetic" is realized concretely as the **Geist Design System**. Strictly:

- **Fonts:** **Geist Sans** + **Geist Mono** via the official `geist` npm package (`geist/font/sans`, `geist/font/mono`), wired in `app/layout.tsx` (`GeistSans.variable` + `GeistMono.variable` on `<html>`) and `tailwind.config.js` (`fontFamily.sans → var(--font-geist-sans)`, `fontFamily.mono → var(--font-geist-mono)`). Do NOT reintroduce Inter or any other typeface. Use `font-mono` for all numerals/code/IDs.
- **Color tokens:** the design's **warm-neutral paper palette** — a grey `frame` behind white cards, `panel` fills, `line-*` hairlines, `faint` text — plus one **brand accent** (`brand`, `#ff5c1f`) for primary CTAs, the logo's third bar, active states and key pills. All defined as HSL CSS variables in `app/globals.css` `:root`/`.dark` and mapped onto the shadcn tokens (`primary` = ink, `accent` = neutral hover surface — use `brand` for the orange). Default `<Button>` is the brand CTA; `variant="ink"` is solid black, `strong` is the ink-bordered outline. Light is the default theme (`next-themes`, key `iq-theme`).
- **Shared design primitives:** `.iq-eyebrow` (mono section label), `.iq-h2`, `.iq-pill` / `<MonoPill>`, `.iq-float` (white card on a panel), `<Panel>`, `<Logo>`, `<ThemeToggle>`, `<Waveform>`. Reuse them before inventing new ones.
- **Components:** **shadcn/ui** is the component layer (Vercel authors it; it IS Geist for React). Do NOT add the community `@geist-ui/core` / `geist-ui` library — it's an unofficial port and is forbidden here.
- **Dark-mode first**, hairline borders, generous whitespace, small radii — per the Geist spec at vercel.com/geist.

When styling anything new: use the token classes (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, etc.) and the Geist fonts — never hard-coded hex/raw colors.
