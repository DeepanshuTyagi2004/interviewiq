# infra

Docker Compose for the local InterviewIQ stack + the shared env template. Run from the repo root:

```bash
cp infra/.env.example infra/.env     # fill in
pnpm stack:up                        # docker compose -f infra/docker-compose.yml up --build
pnpm stack:down                      # stop (add -v via docker compose directly to wipe volumes)
pnpm db:up                           # just Postgres + Mongo, for running the apps on the host
```

## Services

| Service | Image / build | Port | Role |
| --- | --- | --- | --- |
| `postgres` | `postgres:16` | 5432 | Local stand-in for **Supabase** — the API's relational data. |
| `mongodb` | `mongo:7` | 27017 | Local stand-in for **MongoDB Atlas** — API documents (`interviewiq` db) + AI-service data (`interviewiq_intelligence` db). |
| `interviewiq-api` | `apps/api/Dockerfile` (root context) | 8080 | Node.js/Express API. Auth, profiles, JD catalogue, interview sessions. |
| `interviewiq-ai-service` | `apps/ai-service/Dockerfile` | 8000 | Python FastAPI. All LLM logic. |
| `interviewiq-web` | `apps/web/Dockerfile` (root context) | 3000 | Next.js frontend. |

## Using Supabase / Atlas instead of the containers

Set these in `infra/.env` (the compose defaults only apply when they are unset):

```bash
DATABASE_URL=postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority   # API
MONGODB_URL=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/interviewiq_intelligence?retryWrites=true&w=majority   # AI service
```

The API enables TLS automatically for Supabase hosts (`DATABASE_SSL=auto`). Atlas needs the
container's egress IP in its network access list.

## The LLM runs on the HOST (or a hosted provider), not in Compose

The AI service reaches any OpenAI-compatible server via `LLM_BASE_URL`. From inside Docker,
`127.0.0.1` is the container — use `http://host.docker.internal:1234` for a host-run server
(LM Studio / llama.cpp / Ollama); `extra_hosts` makes that resolve on Linux too.

## Notes

- `INTERNAL_API_KEY` must be identical for the API and the AI service — it authenticates both
  directions (brief targets, live-session outcomes, and every API → AI call).
- Trigger the brief pipeline manually: `docker compose -f infra/docker-compose.yml exec interviewiq-ai-service python -m app.cli`.
- No Redis: neither service needs a queue/cache yet.
