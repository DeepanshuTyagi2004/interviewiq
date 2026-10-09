# apps/api — InterviewIQ backend (Node.js)

> Project-wide context (product, hard rules, stop-and-ask list) is in the repo-root `CLAUDE.md`.
> This file covers the API only.

The API was migrated from Spring Boot 4 / Java 25 (history preserved in git under this path) to
**Node.js 22+ / Express 5 / TypeScript (ESM)**. The HTTP contract is unchanged: same paths under
`/api/v1`, same JSON field names, same `{ code, message }` error envelope and codes, same auth
cookies/JWT claims — the frontend and the AI service needed no changes.

## Layout

```text
src/
  index.ts            bootstrap: config → Postgres (+migrations) → Mongo → app → schedulers → graceful shutdown
  app.ts              Express app: logging, security headers, CORS, JSON, security middleware, routers, errors
  container.ts        composition root (what Spring DI did) — every repo/service/integration wired here
  config.ts           zod-validated env; required vars fail fast
  http/               security.ts (SecurityConfig port), support.ts (param parsing, multer, router error mapping),
                      rateLimit.ts (in-memory fixed-window limiter for the auth endpoints)
  routes/             one router per former controller group; each maps its own errors to stable codes
  services/           domain services (candidate profile, profile bands, interview sessions, blueprint prep, live, seeder)
  integrations/       aiService client, github (OAuth + GraphQL collector), leetcode (collector + job), platforms
                      (handle-based Codeforces/AtCoder/CodeChef/TUF collectors + shared job), livekit
  auth/               jwt (jose HS256), refresh tokens (rotation), Google OAuth (PKCE), email/password
                      (passwordAuth), single-use email tokens (emailTokens), Mailer (ConsoleMailer for now)
  repositories/       pg.ts (Drizzle) and mongo.ts (native driver) — method names mirror the old Spring repos
  db/pg/              schema.ts (Hibernate-compatible table/column names), client.ts (pool, SSL, migrations)
  db/mongo/           client.ts — collections + indexes
  jobs/               scheduler.ts (fixedDelay/fixedRate, no overlap) + jobs.ts (blueprint reconcile, weekly refreshes)
  lib/                errors, outbound http, json helpers, canonical JSON, crypto, password (scrypt), background tasks, logger
drizzle/              SQL migrations + snapshots (0000_baseline is a no-op against the Hibernate DB)
scripts/              migrate-documents-to-mongo.ts (one-off legacy jsonb → Mongo copy)
test/                 Vitest; support/harness.ts spins PGlite + in-memory Mongo + FakeFetch + FakeMailer
```

## Data split

| Store | What | Why |
| --- | --- | --- |
| Postgres (Supabase) | `app_user`, `refresh_token`, `auth_token`, `companies`, `company_role_configs`, `job_descriptions`, `interview_sessions`, `github_connection`, `leetcode_connection`, `platform_connection` (Codeforces/CodeChef/AtCoder/TUF handles), `interview_processes` (saved custom process graphs), `loops` (confirmed per-JD process, graph snapshot), `targets` (watchlist) | relational, uniqueness + FK, atomic state transitions |
| MongoDB (Atlas) | `candidate_profiles` (_id=userId), `profile_fragments` (unique userId+source), `blueprint_seen` (unique candidateId+slug: problems already given) | document-shaped, schema-flexible |

Cross-store writes are ordered so a retry converges (e.g. a blueprint run is attached to a session
only if none is attached yet, `InterviewSessionRepository.attachRun`). Atomic transitions use
compare-and-set updates (`InterviewSessionRepository.transitionStatus`, `RefreshTokenRepository.consumeActive`,
`AuthTokenRepository.consumeActive`), so multiple API replicas are safe. Migrations stay additive: the
old plan columns (`plan_version`, `input_hash`, `prep_error`) remain in `interview_sessions`, unused.

## Auth

- **Session:** short-lived HS256 access token in the JSON body + an opaque, rotating
  `refresh_token` cookie (httpOnly, `Path=/api/v1/auth`); refresh tokens are stored as SHA-256 hashes.
- **Google** (`/oauth2/authorization/google` → `/login/oauth2/code/google`): "Google claims the
  email". Sign-in looks up `google_sub`, then the email (case-insensitive). An existing account with
  no `google_sub` is linked only if Google says `email_verified`; if that account's email was never
  verified its password is cleared and its refresh tokens revoked (anti pre-hijacking). An email
  owned by a different Google subject fails the login.
- **Email/password** (`/api/v1/auth/{register,login,verify-email,resend-verification,forgot-password,reset-password}`):
  scrypt hashes in `app_user.password_hash` (`scrypt$N$r$p$salt$hash`, `lib/password.ts`);
  `google_sub` is null for password-only accounts. Registering an email owned by a Google account
  is 409 `use_google`. Login errors are one indistinguishable 401 `invalid_credentials` (with a dummy
  scrypt when the account doesn't exist). Reset revokes every refresh token.
- **Email tokens** (`auth_token`): single-use, SHA-256-hashed, per purpose (`verify_email` 24h,
  `reset_password` 1h); issuing a new one burns the user's older unused ones of that purpose.
- **Mail:** the `Mailer` interface is injected via the container. `ConsoleMailer` (the only
  implementation today) logs the link at info level — the one sanctioned place a token reaches
  the logs. Swap in a real provider before real users.
- **Rate limits** (`http/rateLimit.ts`, per process, injectable for tests): login 10/15 min per
  IP+email and 50/15 min per IP; register 10/h per IP; forgot-password 5/h per IP+email;
  resend-verification 5/h per user. Over the limit → 429 `rate_limited` + `Retry-After`. Keys use
  `req.ip`, so behind a proxy set Express `trust proxy` or every client shares one bucket.

## Commands (from repo root or `apps/api`)

```bash
pnpm db:up                                   # local Postgres + Mongo containers
pnpm --filter @interviewiq/api dev           # tsx watch, loads apps/api/.env
pnpm --filter @interviewiq/api test          # Vitest — no Docker needed
pnpm --filter @interviewiq/api typecheck
pnpm --filter @interviewiq/api db:generate   # after editing src/db/pg/schema.ts
pnpm --filter @interviewiq/api db:migrate    # apply migrations without starting the API
pnpm --filter @interviewiq/api migrate:documents [--dry-run] [--overwrite]
pnpm exec tsx --env-file=.env scripts/dev/seed-fit-personas.ts --apply   # 28 fabricated persona accounts (dev DBs)
pnpm exec tsx --env-file=.env scripts/dev/audit-fit-personas.ts          # JD-fit audit over persona × JD
pnpm exec tsx --env-file=.env scripts/dev/user-id.ts <email>                # a user's id (e.g. for LIVE_INTERVIEWER_ALLOWLIST)
pnpm exec tsx --env-file=.env scripts/dev/bench-blueprints.ts [--list]   # blueprint prep audit: 79 bench runs over
                                                                         # personas × researched JDs × round types, report in .blueprint-audit/
# then, from apps/ai-service: .venv/bin/python scripts/judge_blueprints.py --since <ISO>   # Gemini judges those runs
#                                                                         as a senior interviewer; report in .blueprint-judge/
```

## Conventions

- Keep the contract: new endpoints go under `/api/v1/...`; errors are `{ code, message }` with a
  stable snake_case `code`. Map domain errors in the router (`routerErrors`), not in services.
- Services throw `InvalidArgumentError` (router picks the `*_bad_request` code), `ApiError`
  subclasses (carry status + code), or `Upstream*Error` for outbound failures.
- Outbound HTTP goes through `lib/http.ts` with an injectable `fetch` — never call global fetch
  directly, so tests can stub it.
- Postgres schema changes: edit `src/db/pg/schema.ts`, run `db:generate`, keep migrations additive
  (the production DB predates Drizzle).
- Never log tokens, the internal key, OAuth codes, passwords or password hashes, and never full
  emails at warn/error level. Drizzle errors embed query params in `.message` — log
  `safeErrorMessage(err)` from auth code. The GitHub token is AES-256-GCM encrypted at rest.
- Secrets live in `.env` (gitignored). `.env.example` documents every variable.
