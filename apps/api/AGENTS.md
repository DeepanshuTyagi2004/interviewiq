# AGENTS.md — apps/api

## Project Overview

The InterviewIQ backend API.

- Runtime: Node.js 22.12+ (ESM). Framework: Express 5. Language: TypeScript (strict).
- Data: Postgres (Supabase in prod) via Drizzle ORM + node-postgres; MongoDB (Atlas in prod) via
  the native driver. Local dev uses the containers in `infra/docker-compose.yml`.
- Package manager: pnpm (workspace root is the repo root). Package name: `@interviewiq/api`.
- API style: REST under `/api/v1/...`; errors are `{ code, message }`.

See `CLAUDE.md` in this directory for layout and conventions, and the repo-root `CLAUDE.md` for
product context and hard rules.

## Setup

```sh
pnpm install                      # from the repo root
cp apps/api/.env.example apps/api/.env   # then fill in
pnpm db:up                        # local Postgres + Mongo
pnpm --filter @interviewiq/api dev
```

Never commit real secrets; `.env` is gitignored.

## Checks

```sh
pnpm --filter @interviewiq/api typecheck
pnpm --filter @interviewiq/api test
pnpm --filter @interviewiq/api build
```

Tests run against in-process PGlite and mongodb-memory-server (no Docker). The health check is
`GET /api/v1/main/healthcheck` → `Server Up`.
