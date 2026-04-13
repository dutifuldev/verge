FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS build

WORKDIR /app

COPY . .

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

FROM runtime AS api

ENV HOST=0.0.0.0
ENV PORT=8787

CMD ["node", "apps/api/dist/index.js"]

FROM runtime AS worker

CMD ["node", "apps/worker/dist/index.js"]

FROM caddy:2.10-alpine AS web

COPY infra/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
