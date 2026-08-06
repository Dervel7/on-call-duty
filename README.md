# On-Call Duty

Production-ready doctor on-call duty scheduling system for medium-sized hospitals. Monorepo with a Node/Express API and a Vue 3 web app, backed by PostgreSQL.

## Status

**Phase 1 — Foundation** is complete. This phase delivers the monorepo scaffold, shared packages, tooling, a minimal Express API (`GET /health`), a minimal Vue 3 app with the medical theme, and the database setup pipeline. Business features (auth, doctors, scheduling, reports) arrive in later phases.

## Roadmap

1. Foundation (complete)
2. Auth & Authorization
3. Doctor Management
4. Availability Management
5. Scheduling Engine
6. Schedule Management UI
7. Statistics & Dashboard
8. Reporting

Multi-hospital is out of scope: the system targets a single hospital.

## Tech stack

- **Monorepo:** pnpm workspaces
- **Backend:** Node.js, TypeScript, Express, PostgreSQL (`pg`), Zod, Pino
- **Frontend:** Vue 3, Vite, TypeScript, Vue Router, Pinia, VueUse, shadcn-vue, Tailwind CSS v4
- **Testing:** Vitest
- **Lint:** ESLint (flat config). No Prettier — format on save with Volar.

## Prerequisites

- Node.js 20+ (developed on Node 24)
- pnpm 10+
- PostgreSQL 14+ (developed on PostgreSQL 17)

## Repository layout

```
apps/
  api/        Express API (@oncall/api)
  web/        Vue 3 app (@oncall/web)
packages/
  shared/     Shared types & zod schemas (@oncall/shared)
  utils/      Pure helpers (@oncall/utils)
database/
  schema.sql  Idempotent DDL
  seed.sql    Sample data
  scripts/    DB setup runners
docs/superpowers/  Specs & plans
```

## Quickstart

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create the database

The database itself must exist before running setup. Connect to your local PostgreSQL once and create it:

```bash
# If psql is on your PATH:
psql -U postgres -c "CREATE DATABASE oncall;"
```

If `psql` is not on your PATH, use pgAdmin or any client to run:

```sql
CREATE DATABASE oncall;
```

> PostgreSQL 17 installs to `C:\Program Files\PostgreSQL\17\bin`. Add it to your PATH if you want `psql` available.

### 3. Configure environment

Copy the example env files and adjust the database credentials to match your local PostgreSQL:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Edit `apps/api/.env` and set `DATABASE_URL` to your real connection string, e.g.:

```
DATABASE_URL=postgres://postgres:<your_password>@localhost:5432/oncall
```

### 4. Apply schema and seed

```bash
pnpm db:setup
```

This runs `schema.sql` then `seed.sql` (both idempotent). To re-apply seed data only:

```bash
pnpm db:seed
```

### 5. Start the development servers

```bash
pnpm dev
```

- API: http://localhost:3000
- Web: http://localhost:5174

Verify the API:

```bash
curl http://localhost:3000/health
# {"success":true,"data":{"status":"ok"}}
```

## Scripts

Root scripts (run from the repository root):

| Script | Description |
|---|---|
| `pnpm dev` | Start API and web in parallel (watch mode) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Lint all packages |
| `pnpm test` | Run all tests |
| `pnpm db:setup` | Apply schema + seed |
| `pnpm db:seed` | Re-apply seed data |

## Environment variables

| Variable | Location | Description |
|---|---|---|
| `DATABASE_URL` | `apps/api/.env` | PostgreSQL connection string |
| `PORT` | `apps/api/.env` | API port (default 3000) |
| `CORS_ORIGIN` | `apps/api/.env` | Allowed web origin (default http://localhost:5174) |
| `LOG_LEVEL` | `apps/api/.env` | Pino log level (default info) |
| `NODE_ENV` | `apps/api/.env` | development / production / test |
| `VITE_API_URL` | `apps/web/.env` | API base URL for the web client (default http://localhost:3000) |

The database setup scripts read `DATABASE_URL` from `apps/api/.env`, so credentials live in a single place.

## API conventions

- Standard response envelope: `{ "success": true, "data": {} }` or `{ "success": false, "error": "message" }`.
- HTTP status codes are always set: 200 (GET/PUT), 201 (create), 204 (delete), 400/401/403/404/409/422/429/500 (errors).

## Definition of Done (Phase 1)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone.
- `GET /health` returns the success envelope with HTTP 200.
- The web app renders with the medical theme tokens (no hardcoded colors).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass.
- Shared types (`@oncall/shared`) are imported successfully by both API and web.

## Documentation

- Design: `docs/superpowers/specs/2026-08-06-phase1-foundation-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-06-phase1-foundation-plan.md`
- Project conventions: `AGENTS.md`
