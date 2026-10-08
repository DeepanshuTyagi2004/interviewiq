<div align="center">

# interviewIQ

**Rehearse the interview you're actually walking into.**

An AI interviewer that knows your resume and your target company's real interview process.
You practise round by round, out loud, and get a debrief after every round.

`Next.js 16` · `Node 22 / Express 5` · `Python / FastAPI` · `LiveKit + Deepgram` · `Postgres (Supabase)` · `MongoDB (Atlas)`

</div>

---

## Contents

1. [What is InterviewIQ?](#what-is-interviewiq)
2. [The product at a glance](#the-product-at-a-glance)
3. [The user journey](#the-user-journey)
4. [How it works](#how-it-works)
   - [System architecture](#system-architecture)
   - [Company research pipeline](#company-research-pipeline)
   - [Profile builder](#profile-builder)
   - [Interview session lifecycle](#interview-session-lifecycle)
   - [Live interview: what happens in the room](#live-interview-what-happens-in-the-room)
   - [Authentication](#authentication)
5. [Tech stack](#tech-stack)
6. [Repository layout](#repository-layout)
7. [Getting started](#getting-started)
8. [Day-to-day commands](#day-to-day-commands)
9. [Design system](#design-system)
10. [Product rules we never break](#product-rules-we-never-break)
11. [Roadmap and next plans](#roadmap-and-next-plans)
12. [Contributing](#contributing)

---

## What is InterviewIQ?

**The problem.** Real interview practice is scarce, expensive and inconsistent. Peer platforms
(Pramp, Interviewing.io) depend on who you get matched with. LeetCode is solo and never asks
you a follow-up. Students at Tier 2/3 colleges rarely get to rehearse the actual process of the
companies visiting their campus.

**The solution.** InterviewIQ runs a **voice-based mock interview** with an AI interviewer that
has full context on you and on the job:

- **It knows the company.** A research pipeline turns interview experiences candidates share
  across the web into one round-by-round process per company, role and level: the rounds, the
  topics, the difficulty, the interviewer's style and the red flags.
- **It knows you.** It reads your resume, GitHub and LeetCode, then asks about *your* projects,
  so there's nothing to memorise.
- **It behaves like a real interviewer.** It speaks and listens, reads your code and whiteboard,
  gives hints when you're stuck and harder follow-ups when you're flying, and runs proctored in
  full screen.
- **It tells you exactly what to fix.** Every round is designed to end in a debrief. It will
  show what you said, what a strong answer would have been, and what to study next.

**Who it's for.**

| Audience | What they get |
| --- | --- |
| 🎓 **Students** (first market: Tier 2/3 Indian engineering colleges) | Rehearse the exact process of the companies coming to campus |
| 🏛️ **Placement cells (TPOs)** | Unlimited realistic practice for the whole batch, and readiness at a glance |
| 💼 **Working professionals** | Focused, company-specific mock interviews that fit a working week |
| 🏢 **Companies** *(later)* | A shortlist of candidates who have already cleared their mock process |

**Go-to-market, in phases:** universities (B2B, through TPOs), then a public launch (B2C) in
parallel, then company partnerships with exclusive openings, then automated early-stage hiring.

---

## The product at a glance

| Surface | Route | What it does | Status |
| --- | --- | --- | --- |
| **Landing** | `/` | Marketing site: research, interview, debrief, readiness, universities, FAQ | ✅ Built |
| **Sign up / Log in** | `/signup`, `/login` | Google or email + password; also forgot and reset password, and email verification | ✅ Built |
| **Onboarding** | `/onboarding` | 4 steps: **Resume → Profile → Sources → Target**, with a live profile preview | ✅ Built |
| **Dashboard** | `/dashboard` | Up next, readiness, score tiles, recent interviews, leaderboard | ✅ Built (scores are *coming soon*) |
| **Companies** | `/jobs` | Company library with each company's data depth and live or researching status | ✅ Built |
| **Roadmap** | `/jobs/[id]` | A JD's real interview process, round by round, plus insights; book any round | ✅ Built |
| **Interviews** | `/interviews` | Book a round (day and time chips), see upcoming and past sessions | ✅ Built |
| **Interview room** | `/interviews/[id]/live` | Pre-check, then a proctored voice interview with a code editor and whiteboard | ✅ Built (beta) |
| **Debrief** | `/interviews/[id]/report` | Layout ready; needs the scoring contract | 🟡 Placeholder |
| **Profile** | `/profile` | Identity, resume, descriptive source summary and a separate level-based profile score | ✅ Built (scoring beta) |
| **Profile leaderboard** | `/leaderboard` | Opt-in, same-level weekly profile rankings with evidence eligibility and privacy controls | ✅ Built (beta) |
| **Connections** | `/connections` | Connect GitHub (OAuth), LeetCode (username) and your resume (PDF) | ✅ Built |
| **Share experience** | `/experiences` | Contribute your own interview experience to the research pipeline | ✅ Built |
| **Intelligence** | `/intelligence` | **Admin** console: research, catalogue, access and Diagnostics for scoring replay, source freshness and weekly receipts | ✅ Built |
| **University admin** | `/admin/*` | TPO dashboard, student roster, placement drives | ⏳ Planned |

Signed-in pages live in one **app shell**. A top bar holds ⌘K search, the theme toggle,
notifications and your avatar. The page sits in a rounded card, and the **menu is revealed
behind the card**: press the 4-dot button or `M` to open it, and `Esc` to close it.

---

## The user journey

```mermaid
flowchart TD
    A([Visitor on landing page]) --> B{Sign up}
    B -->|Google| C[Account created]
    B -->|Email + password| C
    C --> D["Onboarding 1 · Resume<br/>upload a PDF, AI parses it"]
    D --> E["Onboarding 2 · Profile<br/>review and edit every field"]
    E --> F["Onboarding 3 · Sources<br/>GitHub · LeetCode (optional)"]
    F --> G["Onboarding 4 · Target<br/>pick a company and role (optional)"]
    G --> H[Roadmap for that JD<br/>its real interview process]
    H --> I[Book a round<br/>pick a day and time]
    I --> J[Interviewer prepares<br/>a plan from your profile and the brief]
    J --> K[Interview room<br/>pre-check, then live voice round]
    K --> L[Debrief<br/>strong answers and what to study]
    L --> M{Pass mark?}
    M -->|Yes| N[Next round unlocks]
    M -->|No| O[Retake after a cooldown]
    N --> P[[Interview-ready for this JD<br/>shareable readiness report]]
    O --> I
    N --> I

    classDef built fill:#1a1a1a,color:#fff,stroke:#1a1a1a;
    classDef planned fill:#f2f1ed,color:#5c5c58,stroke:#cfcec8,stroke-dasharray: 4 3;
    class A,B,C,D,E,F,G,H,I,J,K built;
    class L,M,N,O,P planned;
```

> **Dark boxes are built today.** Dashed boxes depend on the **scoring contract**, which is the
> next major milestone: scored debriefs, pass marks, retake cooldowns, readiness levels and the
> readiness report.

**Two guardrails shape the journey:**

- **Only the official process counts.** You can edit a loop's rounds, but an edited loop becomes
  standalone practice. It still gets full analysis, but it never moves your readiness.
- **Readiness, not badges.** Readiness moves through *Getting started → Progressing → Nearly
  ready → Interview-ready*. It's always framed as *mock-interview readiness* (for example
  "Interview-ready · Meesho SDE I mock process"), never as "Cleared Meesho" or "Meesho certified".

---

## How it works

### Level-based profile scoring (beta)

The profile now has a **Profile score**, separate from the existing **Interview score** placeholder.
It does not alter interview outcomes, mock-loop readiness or descriptive synthesis. Eight rubrics cover
Intern, Fresher, SDE I, SDE II, SDE III, Staff, Principal and Distinguished. Choose your **current level**
on onboarding or in the profile details. Scoring uses that same profile choice; the evidence-assessed
level remains a separate low-confidence recommendation, never a verified seniority claim.

All engineering-level pickers use the same wire enum: `intern`, `fresher`, `sde1`, `sde2`, `sde3`,
`staff`, `principal`, `distinguished`. This applies to current profile level, target JDs, custom
processes, company enrichment, shared interview experiences, leaderboards and AI user-choice inputs.
Choosing a target JD does **not** overwrite the current profile level. New free-form level writes
are rejected server-side. Known old aliases normalize on reads; unknown old values are shown as
unset with `legacyLevel` metadata and require an explicit selection before copying/confirmation/new
booking. Existing booked lookup identities are not rewritten. Trace/log levels and verbatim extracted
seniority evidence are a different domain and remain unchanged.

The current scoring policy is `profile-beta-v4`. Old v1/v2/v3 configs/snapshots remain replayable;
  Intern and Distinguished have explicit separate beta rubrics and conservative ranking review gates.

- Score, confidence and evidence coverage are separate 0–100 values. Missing evidence is unknown,
  not zero. All weights and normalization rules are provisional, explainable and versioned.
- Supported local inputs: saved resume/profile, GitHub and LeetCode fragments. No LLM chooses the
  final number. Senior architecture/impact claims remain self-reported; current collectors cannot
  qualify self-report-only senior assessments for ranking. Other platform collectors and a rich
  verified achievement ingestion UI are **not** included in this beta.
- `/leaderboard` compares eligible **opted-in** peers only at the same level, UTC Monday week,
  algorithm version and configuration hash. Privacy `hidden` excludes a user; `anonymous` uses
  a stable pseudonym. Ties share rank. Percentiles require at least five eligible profiles.
- Mongo stores minimized frozen input/config/evidence and historical snapshots. Account export
  includes `profileScoring` (settings, snapshots and relevant job receipts); account deletion purges them.
- `PROFILE_SCORING_SCHEDULER_ENABLED=true` enables a separate weekly application job: startup
  catch-up, hourly due checks, durable cross-replica lease and receipts. Missed historical weeks
  are never fabricated. Set it false before API startup to disable batch scheduling. Lazy score
  reads and explicit recalculation still work; unchanged inputs/week/config reuse one snapshot.
- **Intelligence → Diagnostics** (`/intelligence?tab=diagnostics`) reads local storage, validates
  methodology, replays a selected user's frozen snapshot, checks feature/formula/rank constraints,
  and reports freshness and weekly job status. Admin-only recalculation is explicit, with confirmation
  for all users. Live providers, interview blueprint prep and voice health are labelled **untested**, not passed.

Numerical methodology, extensibility and limitations: [`apps/api/docs/profile-scoring-beta.md`](apps/api/docs/profile-scoring-beta.md).
Change reviewed weights/normalizers in `apps/api/src/domain/profileScoring/config.ts`; every deployed
formula/extractor change must bump the version and retain the prior evaluator for historical replay.
There is no runtime admin weight editor in this beta.

### System architecture

Three apps and one contract, in a pnpm + Turborepo monorepo. Each app deploys independently.

```mermaid
flowchart LR
    subgraph Client
        U["Browser<br/>Next.js 16 app"]
    end

    subgraph web["apps/web · Vercel"]
        W[App Router UI<br/>TanStack Query]
    end

    subgraph api["apps/api · Node / Express 5"]
        A1[REST /api/v1<br/>auth · catalogue · interviews · connections]
        A2[Collectors<br/>GitHub GraphQL · LeetCode]
        A3[Schedulers<br/>blueprint reconcile · weekly refresh]
    end

    subgraph ai["apps/ai-service · Python / FastAPI"]
        B1[Research pipeline<br/>collect → extract → aggregate]
        B2[Resume parser]
        B3[Interview blueprint<br/>problem selection · playbooks]
        B4[Problem bank<br/>collection · content]
    end

    PG[(Postgres<br/>Supabase)]
    MG[(MongoDB<br/>Atlas)]
    MGAI[(MongoDB<br/>AI database)]
    LK{{LiveKit<br/>realtime rooms}}
    EXT[["Exa search · OpenAI-compatible LLM<br/>Deepgram STT + Aura TTS"]]

    U --> W
    W -- "Bearer JWT + refresh cookie" --> A1
    A1 --> PG
    A1 --> MG
    A1 -- "internal key" --> B1 & B2 & B3
    B4 -- "outcomes · internal key" --> A1
    A2 --> MG
    B1 & B3 --> MGAI
    B1 & B2 & B3 & B4 --> EXT
    U <-- "WebRTC audio" --> LK
    B4 <--> LK
    A1 -- "room tokens" --> LK
```

| Piece | Responsibility | Why it's separate |
| --- | --- | --- |
| **`apps/web`** | Every screen: landing, auth, onboarding, app, admin | A pure client of the API. Server Components by default |
| **`apps/api`** | Domain logic, persistence, auth, OAuth, collectors, session orchestration | Owns the data and every rule, e.g. gating is enforced server-side |
| **`apps/ai-service`** | **All** LLM work: briefs, resume parsing, the problem bank, interview blueprints | Python ecosystem, and we can swap LLM providers without touching the API |
| **`packages/contracts`** | `openapi.yaml`, the source of truth between the apps | The web app **generates** its types from it and never hand-writes DTOs |

### Company research pipeline

**Current workflow (2026-10-03): overview automation, human-owned detail.** The background job
resolves the company and researches its overview only. Detailed compensation, culture, role/JD
profiles and interview rounds are manually researched, edited and verified in Intelligence.

```mermaid
flowchart LR
    C[Curated companies] --> A[Resolve + overview research]
    A --> S[Source-backed suggestions]
    S --> E[Human enrichment editor]
    E --> D[Save draft privately]
    D --> V[Verify company, role and round evidence]
    V --> P[Submit and publish immediately]
    P --> DB[(Atomic Postgres publication)]
    DB --> R[Candidate roadmap]
    DB --> I[Interview preparation]
```

- **Open the editor:** Intelligence → Companies → **Enrich company**. This is admin-only; a role
  profile means a company's job/level, not a candidate's personal profile.
- **Start from collected information:** new enrichment drafts prefill available research facts,
  existing JDs and supported interview rounds, with sources and verification unchecked. Saved
  drafts are never refreshed over human edits. For an existing draft, save your edits and choose
  **Fill missing from research** to import into blank, unverified fields without publishing.
  Incomplete round evidence remains a quoted reference until a reviewer supplies missing details.
- **React Flow rounds:** add, edit, remove and reorder a linear sequence. Up/down controls persist
  order; canvas dragging only changes the visual layout. There are no branching or scoring rules.
- **Immediate publication:** Save draft is private. Submit & publish requires explicit verification
  and evidence URLs for the company, each role and each round, then publishes without another approval.
- **Preserve work:** optimistic revisions prevent overwrites. Automated refreshes cannot overwrite
  manually published content. Existing JD identities remain stable; new identities require new roles.
- **One source of truth:** candidate detail and interview preparation use the same published brief.
  Historical AI briefs remain available for legacy JDs. Scheduled detailed scraping/backfill is disabled.
- **Database setup:** migration `apps/api/drizzle/0003_supreme_grandmaster.sql` adds enrichment and
  manual brief storage; apply with the existing migration command before using the editor. It was
  generated and tested locally, not applied to your configured database during implementation.

### LinkedIn PDF import

Connections → LinkedIn → **Import** → follow the in-app steps to download your own profile with
LinkedIn's **Save to PDF** (profile → **Resources**, or **More** on older layouts → **Save to PDF**;
desktop browser only) → upload the file → consent → **Read PDF** → choose available sections →
**Confirm selected sections**. Nothing is fetched from LinkedIn: no scraping, cookies, OAuth grant or
third-party data provider, and no Firecrawl key is needed. The AI service reads the PDF once with
the private evidence-gated extractor; the PDF itself is never stored. Files that aren't LinkedIn's
export (for example a resume) are rejected with a pointer back to the steps. Restart the API and AI
service after updating.

This is a **one-time snapshot** of the uploaded PDF, not live sync or verified ownership/employment;
absent fields remain unknown. Posts are not imported. Snapshots from the retired Firecrawl URL
import stay readable until replaced. Only confirmed sections enter the source. Optional merge fills
blanks/adds deduplicated rows while preserving human edits and the selected engineering level;
conflicting dates and stale previews require review. Disconnect removes the source and drafts, not
details already merged into Profile. Details: `apps/api/docs/linkedin-import.md`.

V4 scoring uses supported LinkedIn claims as self-reported evidence (provisional 45% confidence),
deduplicates résumé overlaps, preserves v1/v2/v3 replay and does not grant collector trust just because
a scraping provider retrieved a page. No weekly scoring-job changes were made for this feature.
See `apps/api/docs/linkedin-import.md` for endpoints, configuration, privacy and limitations.

### Custom processes and simulated practice profiles

- **Create without a company:** Interview processes → New process → enter a name and select an enum
  level. Start blank, copy a suggested process, or copy one of your own saved processes.
- **Customise each node:** name, comma-separated topics, difficulty and natural-language
  instructions. Runnable nodes also have a type and duration. Instructions are interviewer
  preferences, not a command that automatically rewrites the graph. The node library includes
  109 runnable presets and 12 reference steps across 17 categories. Search names, technologies,
  topics and keywords (for example RAG, SQL, Kubernetes or accessibility), or choose a category.
  Runnable presets map to the five supported interview runtimes; reference steps remain non-runnable.
  Every preset's topics, difficulty, duration and guidance can be adapted to your role and level.
  A process still supports at most 12 interview rounds and 12 reference steps.
- **Save and start:** saved processes can start standalone tracks without a JD. Booking snapshots
  the selected node's topics, instructions, difficulty and duration; later process edits cannot
  change a booked session. Custom tracks never count toward company readiness.
- **Canvas interactions:** measured node/drag state is retained, rapid events use the latest graph,
  and moving a node does not renumber its round. Inspector typing cannot accidentally delete nodes.
- **Catalogue coverage:** `apps/api/scripts/seed-practice-profiles.ts` adds 48 explicitly simulated
  profiles per active company: eight practice levels × backend, frontend, fullstack, data science,
  AI/ML and DevOps. They are not real openings or verified company hiring loops. No salary, experience
  requirement, fabricated evidence URL or company-native level equivalence is asserted.
- **Safe boundaries:** real profiles are preserved. Simulations have `source=template`, low
  confidence and empty evidence; the UI labels them **Practice template** and the server excludes
  them from readiness. Human company enrichment does not import or archive these templates.
- **Reproduce:** from `apps/api`, run
  `pnpm exec tsx --env-file=.env scripts/seed-practice-profiles.ts` for a read-only inventory,
  then add `--apply` to insert missing templates. Repeated runs do not duplicate profiles.
- **Storage:** `apps/api/drizzle/0006_custom_practice.sql` permits nullable JD references and stores
  process/track metadata and booking-time prep snapshots. The configured database migration journal
  was verified to include it; 624 templates were then inserted across 13 companies and read back.
- **Checks:** API 680 tests; web 640 tests; AI 1,075 tests passed (11 skipped, env-file disabled);
  four Chrome canvas interaction tests passed. No live model run was performed. The versioned
  ladder prompt `v4-custom-practice` needs human review before production use.

### Profile builder

The interviewer is personal because it reads *your* work. Every source is **additive and
optional**, and a resume alone is enough to start.

```mermaid
flowchart LR
    R["Resume PDF"] -- "parse (async run)" --> AI[ai-service<br/>resume parser]
    AI --> CP[(candidate profile<br/>MongoDB)]
    GH["GitHub OAuth"] --> GC["GitHub collector<br/>GraphQL: languages, repos,<br/>contributions, external PRs"]
    LC["LeetCode username"] --> LCC["LeetCode collector<br/>solved by difficulty and topic,<br/>contest, recent activity"]
    GC --> FR[(profile fragments<br/>MongoDB · content-hashed)]
    LCC --> FR
    CP --> PA[Profile assembler]
    FR --> PA
    PA --> V["Descriptive profile<br/>most-used skills (with evidence)<br/>· achievements · noticeable things"]
    V --> UI[Profile page · interviewer context]
```

- **Descriptive, never comparative.** We write "412 problems solved (78 Easy, 268 Medium, 66
  Hard)", never "an above-average solver".
- **Every claim carries evidence.** Each skill names the sources behind it (for example "GitHub
  52%, LeetCode preferred, resume claimed"), and each achievement names its source.
- **Hash-based change detection.** A fragment is only rebuilt when its source data actually
  changed.

### Interview session lifecycle

A booked round moves through these states. The API enforces every transition atomically
(compare-and-set), so running several API replicas is safe.

```mermaid
stateDiagram-v2
    [*] --> PREP_QUEUED: candidate books a slot (prep starts at once)
    PREP_QUEUED --> PREP_READY: ai-service builds the interview blueprint
    PREP_QUEUED --> PREP_FAILED: blueprint run failed
    PREP_FAILED --> PREP_QUEUED: candidate presses Retry (3 per hour)
    PREP_READY --> PREP_READY: inputs changed, blueprint refreshed in place
    PREP_READY --> LIVE_IN_PROGRESS: candidate enters the room
    LIVE_IN_PROGRESS --> COMPLETED: round ends normally
    LIVE_IN_PROGRESS --> ABORTED_TECHNICAL: connection lost / technical failure
    COMPLETED --> [*]
    ABORTED_TECHNICAL --> [*]
```

The **interview blueprint** is the interviewer's playbook for one round. Problems are chosen
deterministically from the problem bank (company tags, round topics, JD, level; never one you
already got), each with an answer key built at prep time and cached; then a persona, a timed arc,
per-question playbooks (what to do when you're stuck, wrong, ask for a hint or go off-topic) and
the signals to collect. You only ever see progress steps and a briefing: interviewer, format,
duration. Admins can trace every run in **Intelligence → Interview prep**. See
`docs/superpowers/specs/2026-10-07-interview-blueprint-design.md`.

> **Live interviews are paused** while the live interviewer is rebuilt on the blueprint
> (`LIVE_INTERVIEWER_AVAILABLE=false`): ready rounds show their briefing but can't be joined yet.

### Live interview: what happens in the room

The room UI (pre-checks, full screen, proctoring) and LiveKit room tokens are in place; the live
interviewer that runs a blueprint is the next phase, so joining is closed for now.

### Authentication

Auth is **owned by the backend**: no NextAuth or Clerk. The browser holds a 15-minute access
token **in memory only**, plus an httpOnly refresh cookie scoped to `/api/v1/auth` that rotates
on every refresh.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as Web
    participant A as API
    participant Gg as Google

    alt Continue with Google
        U->>W: Click "Continue with Google"
        W->>A: GET /oauth2/authorization/google
        A->>Gg: OAuth (PKCE)
        Gg-->>A: code → userinfo (email_verified)
        A-->>W: Set refresh cookie, redirect to /auth/callback
    else Email + password
        U->>W: Submit the sign-up / log-in form
        W->>A: POST /api/v1/auth/register | /login
        A->>A: scrypt verify · rate limit · constant-time
        A-->>W: { accessToken } + refresh cookie
    end
    W->>A: POST /api/v1/auth/refresh (silent, on load and before expiry)
    A-->>W: New access token (refresh cookie rotated)
    W->>A: API calls with an Authorization Bearer header
```

- **Passwords** use `scrypt` from `node:crypto` (OWASP parameters, a salt per user,
  constant-time compare). A wrong password, an unknown email and a Google-only account all get
  the same "Incorrect email or password", and take the same time, so nobody can probe which
  emails exist.
- **Verification and reset links** are single-use and expire in 24 hours and 1 hour. A reset
  revokes every session. Until a mail provider is chosen, links are **printed in the API
  console**.
- **Google claims the email.** If a Google sign-in matches an unverified password account, it
  links to that account and removes the password, so nobody can pre-register your address.
- **Rate limits** apply to login, sign-up, forgot-password and resend-verification.

---

## Tech stack

| Layer | Choices |
| --- | --- |
| **Web** | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 3.4 · shadcn/ui · Geist fonts · TanStack Query v5 · react-hook-form + zod · next-themes · Monaco (code) · Excalidraw (whiteboard) · @xyflow/react (agent pipeline) · LiveKit client |
| **API** | Node.js 22 · Express 5 · TypeScript (ESM) · Drizzle ORM + node-postgres · MongoDB native driver · jose (HS256 JWT) · zod config · pino logs · livekit-server-sdk |
| **AI service** | Python 3.11 · FastAPI · Motor (async Mongo) · OpenAI-compatible LLM client · Exa search · LiveKit Agents · Deepgram STT and Aura TTS |
| **Data** | Postgres on **Supabase** (users, auth tokens, companies, JDs, sessions, connections) · MongoDB **Atlas** (candidate profiles, profile fragments, session outcomes; the AI service has its own database) |
| **Contracts** | OpenAPI 3 (`packages/contracts/openapi.yaml`) → `openapi-typescript` |
| **Testing** | Vitest + Testing Library (web) · Vitest + supertest on in-process **PGlite** and **mongodb-memory-server** (API, no Docker needed) · pytest (AI service) |
| **Tooling** | pnpm 10 workspaces · Turborepo · ESLint · Docker Compose for the local stack |
| **Planned infra** | Vercel (web) · Railway / Fly (API, AI service) · Cloudflare · Sentry · PostHog |

---

## Repository layout

```text
interviewiq/
├── apps/
│   ├── web/                    Next.js 16 frontend                          :3000
│   │   ├── app/(marketing)/    landing + marketing pages
│   │   ├── app/(auth)/         sign up, log in, forgot/reset password, verify email
│   │   ├── app/(onboarding)/   the 4-step onboarding (no sidebar)
│   │   ├── app/(app)/          signed-in app: dashboard, jobs, interviews, profile, …
│   │   ├── components/         ui/ (shadcn) · patterns/ · layout/ (app shell) · visualizations/
│   │   ├── features/           cross-route feature logic: hooks, api, types
│   │   └── lib/                api client (+ generated types), auth, analytics, utils
│   ├── api/                    Node / Express 5 API                          :8080
│   │   ├── src/routes/         one router per area (auth, catalogue, interviews, …)
│   │   ├── src/services/       domain services (sessions, blueprint prep, profile assembly, …)
│   │   ├── src/integrations/   ai-service client · GitHub · LeetCode · LiveKit
│   │   ├── src/auth/           JWT · refresh tokens · Google OAuth · password auth · mailer
│   │   ├── src/db/             Drizzle schema (Postgres) · Mongo collections
│   │   ├── drizzle/            SQL migrations (applied at startup)
│   │   └── test/               Vitest suites on PGlite + in-memory Mongo
│   └── ai-service/             Python FastAPI · all LLM logic                 :8000
│       ├── app/jobs/           brief generation, question collection, scheduler
│       ├── app/blueprint/      interview blueprint (selection, answer keys, playbooks, diagnostics)
│       └── app/resume/         resume parsing
├── packages/contracts/         openapi.yaml: the web ↔ api ↔ ai-service contract
├── infra/                      docker-compose (local stack) + env template
└── docs/                       product overview
```

---

## Getting started

### 1. Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | **22.12+** |
| pnpm | **10** (`corepack enable` picks up the pinned version) |
| Python | **3.11+** |
| Databases | **Either** Docker (local Postgres + Mongo) **or** a Supabase project plus a MongoDB Atlas cluster |
| Optional | A LiveKit project and a Deepgram key (live voice interviews), an Exa key (research), and any OpenAI-compatible LLM endpoint |

### 2. Install

```bash
git clone https://github.com/DeepanshuTyagi2004/interviewiq.git
cd interviewiq
pnpm install
pnpm --filter @interviewiq/ai-service setup     # one-time Python venv (apps/ai-service/.venv)
```

### 3. Environment files

Env files are **never committed**; copy the examples and fill them in.

```bash
cp apps/api/.env.example        apps/api/.env
cp apps/web/.env.example        apps/web/.env.local
cp apps/ai-service/.env.example apps/ai-service/.env
cp infra/.env.example           infra/.env          # only for the all-in-Docker stack
```

The variables that matter most:

| App | Variable | What it's for |
| --- | --- | --- |
| api | `DATABASE_URL` | Postgres: local Docker, or Supabase (TLS is switched on automatically for Supabase hosts) |
| api | `MONGODB_URI`, `MONGODB_DATABASE` | MongoDB: local Docker, or Atlas |
| api | `JWT_SECRET` | Signs access tokens (at least 32 bytes) |
| api | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. Redirect URI: `{API_PUBLIC_URL}/login/oauth2/code/google` |
| api | `FRONTEND_URL`, `API_PUBLIC_URL` | Must point at each other (CORS, OAuth redirects, email links) |
| api | `ADMIN_EMAILS` | Comma-separated emails promoted to **ADMIN** on sign-in; these accounts see Intelligence |
| api | `GITHUB_OAUTH_CLIENT_ID/SECRET`, `GITHUB_TOKEN_KEY` | Connect GitHub. GitHub tokens are AES-256-GCM encrypted at rest |
| api + ai | `INTERNAL_API_KEY` | Shared secret for API ↔ AI-service calls (**same value in both**) |
| api + ai | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Live interview rooms |
| ai | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_NAME` | Any OpenAI-compatible endpoint |
| ai | `EXA_API_KEY` | Web search for the research pipeline |
| ai | `MONGODB_URL`, `MONGODB_DB` | The AI service's own Mongo database |
| web | `NEXT_PUBLIC_API_URL` | API origin, e.g. `http://localhost:8080` |

### 4. Databases

**Option A, local containers:**

```bash
pnpm db:up            # Postgres 16 + Mongo 7 via infra/docker-compose.yml
```

**Option B, managed (no Docker):** set `DATABASE_URL` to your Supabase connection string and the
Mongo URIs to your Atlas cluster. Nothing else changes.

Postgres migrations in `apps/api/drizzle/` are **applied automatically when the API starts**.
To run them on their own: `pnpm db:migrate`.

### 5. Run

```bash
pnpm dev              # web :3000 + api :8080 + ai-service :8000, via Turborepo
```

| Check | URL |
| --- | --- |
| Web | <http://localhost:3000> |
| API health | <http://localhost:8080/api/v1/main/healthcheck> |
| AI service health | <http://localhost:8000/health> |

Or run everything in containers with `pnpm stack:up`, which uses `infra/.env`.

### 6. First run

1. Sign up at `/signup` with an email listed in `ADMIN_EMAILS`. That account becomes an admin.
2. In development, the **email verification link is printed in the API console**. Open it to
   confirm your address.
3. Open the menu (`M`), go to **Intelligence → Companies & JDs → Load starter companies** to
   seed the catalogue, then go to **Live ingestion → Run** to generate research briefs.
4. Finish onboarding, pick a role on **Companies**, and book your first round.

---

## Day-to-day commands

```bash
pnpm dev                   # all apps in watch mode
pnpm test                  # every app's test suite (API tests need no Docker)
pnpm typecheck             # TypeScript across the workspace
pnpm lint                  # ESLint
pnpm build                 # production builds
pnpm db:migrate            # apply the API's Postgres migrations
pnpm contracts:types       # regenerate web types from packages/contracts/openapi.yaml

pnpm --filter @interviewiq/api db:generate     # new migration after editing src/db/pg/schema.ts
pnpm --filter @interviewiq/web test            # one app only
```

---

## Design system

The UI is built from a **Claude Design** export that covers the marketing site, auth and
onboarding, and the app shell with its screens. The export is kept locally, outside the repo.

| Token | Use |
| --- | --- |
| `frame` | The warm grey page frame behind every card |
| `card` / `panel` | White cards, and the soft fills that white cards float on |
| `line-1…4` | Hairline borders, lightest to darkest |
| `faint` / `muted-foreground` | Secondary and tertiary text |
| `brand` (`#ff5c1f`) | **The one accent.** Primary CTAs, the logo's third bar, active states and key pills, used sparingly |
| `inv` | The always-dark surface (up-next card, transcripts, logs) |

Shared building blocks: `.iq-eyebrow` (mono section label), `<MonoPill>`, `<Panel>`,
`.iq-float`, `<PageHeader>`, `<Logo>`, `<ThemeToggle>`, `<Waveform>`. The type is Geist and Geist Mono with
light, tightly tracked headings. Light is the default theme, and dark mode is fully supported.
Every page is built for **375px phones, iPads (768 and 1024px) and desktop**, and respects
`prefers-reduced-motion`.

---

## Product rules we never break

1. **No invented data.** If the backend doesn't have it, the UI says so ("—", "Not scored yet",
   "coming soon"). We never show sample numbers, and never show a control that doesn't work.
2. **The profile summary describes and never ranks.** Scores live in a **separate scoring
   contract**, never inside the profile summary.
3. **Every skill carries evidence, and every achievement carries a source.**
4. **Scores must be explainable.** Every future score traces back to its inputs.
5. **Gating is server-enforced.** Pass marks, cooldowns and unlocks live in the API; the UI only
   reflects them.
6. **Readiness is never a badge or certificate,** and never worded as if the company endorsed it.
7. **Sources are additive, never required.** A resume alone gives a useful profile.

---

## Roadmap and next plans

### MVP modules

| # | Module | Status | What's next |
| --- | --- | --- | --- |
| 1 | **Profile Builder** | ✅ Resume, GitHub, LeetCode, Codeforces, CodeChef, AtCoder and takeUforward collectors; reviewed LinkedIn public-URL snapshots; descriptive profile | LLM-written profile summary (prompt under review); live LinkedIn retrieval validation |
| 2 | **Job & Loop Setup** | ✅ Catalogue, research briefs, roadmap | Per-JD **loop dashboard**; editable rounds (an edited loop is standalone) |
| 3 | **Live Interview Session** | 🟡 Booking, blueprint prep (problems, playbooks, answer keys), room UI, proctoring | Live interviewer that runs the blueprint (paused until then) |
| 4 | **Post-Interview Report** | 🟡 Layout ready | **Scoring contract**: per-question breakdown, strong answers, learn-next, pass mark → unlock or cooldown |
| 5 | **University Admin Panel** | ⏳ Planned | TPO dashboard, batch roster, bulk upload, placement drives |
| 6 | **Platform Essentials** | ✅ Google and email/password auth | Mail provider, notifications, settings, billing (Razorpay) |

### Next milestones

```mermaid
flowchart LR
    M1["Scoring contract<br/>interview score,<br/>explainable"] --> M2["Scored debriefs<br/>pass marks · cooldowns"]
    M2 --> M3["Loops and readiness<br/>official vs edited loops,<br/>readiness levels and report"]
    M3 --> M4["Leaderboards<br/>college · global"]
    M3 --> M5["University pilot<br/>TPO admin panel"]
    M5 --> M6["Company partnerships<br/>exclusive openings"]
    M6 --> M7["Automated early-stage<br/>hiring"]
```

### Open decisions (owner: product)

- **Scoring:** the interview-score formula, pass thresholds, retake cooldown
  (1 or 2 weeks), readiness-level mapping, leaderboard rules, and what ships in the MVP.
- **LeetCode sourcing:** scraping, paste-in, or an unofficial API.
- **Voice pipeline:** stay on Deepgram + an OpenAI-compatible LLM, or move to a realtime speech
  model (cost against latency).
- **Background jobs:** in-process schedulers today, or a real queue once it hurts.

### Known gaps before real users

- Pick an **email provider**. Verification and reset links are console-only today.
- Set Express `trust proxy` behind the hosting proxy, so rate limits see real client IPs.
- Let the debrief show real facts (duration, how the round ended) by exposing them in the
  session contract.

---

## Contributing

- **Contract first.** Change `packages/contracts/openapi.yaml`, then run `pnpm contracts:types`.
  Never hand-write types that mirror API DTOs.
- **Keep logic where it belongs.** LLM work goes in `apps/ai-service`, rules and persistence in
  `apps/api`, presentation in `apps/web`.
- **Web conventions:** Server Components by default; route-specific UI in `_components/`;
  cross-route logic in `features/<name>/`; tokens and shared primitives over raw colours.
- **Tests come with changes.** API tests run in-process (PGlite + in-memory Mongo), so
  `pnpm test` needs no Docker.
- **Commits** follow Conventional Commits (`feat(web): …`, `fix(api): …`, `docs: …`).

Deeper, area-specific guides live in [`CLAUDE.md`](./CLAUDE.md),
[`apps/web/CLAUDE.md`](./apps/web/CLAUDE.md), [`apps/api/CLAUDE.md`](./apps/api/CLAUDE.md) and
[`docs/PROJECT_OVERVIEW.md`](./docs/PROJECT_OVERVIEW.md).
