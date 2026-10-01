# syntax=docker/dockerfile:1
# Build context: the MONOREPO ROOT (see infra/docker-compose.yml):
#   docker build -f apps/api/Dockerfile .

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @interviewiq/api... \
 && pnpm --filter @interviewiq/api build \
 && pnpm --filter @interviewiq/api deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
# dist/ + drizzle/ migrations + production node_modules only
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
