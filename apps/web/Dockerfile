# syntax=docker/dockerfile:1
# Build context: the MONOREPO ROOT (see infra/docker-compose.yml):
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 .

FROM node:24-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
# NEXT_PUBLIC_* are inlined at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter @interviewiq/web... \
 && pnpm --filter @interviewiq/web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@interviewiq/web", "start"]
