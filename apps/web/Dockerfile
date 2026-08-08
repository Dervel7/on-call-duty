# syntax=docker/dockerfile:1
#
# Web image.
#
# Build context MUST be the repository root so Vite can resolve the workspace
# packages (@oncall/shared, @oncall/utils) during the bundle:
#   docker build -f apps/web/Dockerfile .
#
# Multi-stage: compile the SPA with Vite, then serve static assets from nginx.

FROM node:20-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.26.0 --activate

WORKDIR /repo

# Install dependencies first (cached layer).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/utils/package.json ./packages/utils/package.json
RUN pnpm install --frozen-lockfile

# VITE_API_URL is baked into the bundle at build time.
# "/api" keeps the SPA on the same origin as the nginx reverse proxy.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages ./packages

RUN pnpm --filter @oncall/web build

# Lean runtime: nginx serving static files only.
FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
