# syntax=docker/dockerfile:1
#
# API image.
#
# Build context MUST be the repository root so pnpm can resolve the workspace:
#   docker build -f apps/api/Dockerfile .
#
# The Express app re-exports runtime values (zod schemas) from @oncall/shared,
# whose package.json points "main" at TypeScript source. Plain `node` cannot
# import a .ts entrypoint, so the app is run with tsx (the same runtime used in
# development). This keeps the Docker build working without altering the repo's
# package configuration.

FROM node:20-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

# Enable pnpm at the version pinned in the root package.json.
RUN corepack enable && corepack prepare pnpm@10.26.0 --activate

# Build toolchain kept as a safety net so bcrypt can compile a native binding
# even when a prebuilt binary is unavailable for the target platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Install dependencies first (cached layer; only invalidated when manifests change).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/utils/package.json ./packages/utils/package.json
RUN pnpm install --frozen-lockfile

# Application + workspace package sources.
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages ./packages

WORKDIR /repo/apps/api
EXPOSE 3000

CMD ["pnpm", "exec", "tsx", "src/server.ts"]
