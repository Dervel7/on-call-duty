# AGENTS.md

## Project Mission
Build a production-ready Doctor On-Call Duty Scheduling System for medium-sized hospitals. Prioritize correctness, maintainability, security, performance, usability, and realistic healthcare workflows over unnecessary complexity.

## Core Principles
- Production-ready code only.
- Prefer simple solutions over clever abstractions.
- Optimize for maintainability and readability.
- Keep architecture consistent throughout the monorepo.
- Every feature must support future multi-hospital expansion.
- Never introduce technical debt for short-term convenience.
- Follow healthcare-grade reliability standards.


## Rules to always follow

- No Flattery: Never compliment an idea. Wasted tokens.
- Never add time estimations for tasks. 
- No Empty Criticism: If you spot a flaw, you must offer a mitigation.
- Add Vector and Velocity: If you agree, expand. If you disagree, counter. Never just nod.
- Never add time estimations for tasks.
- Never suggest pushing git commits.
- Never commit on main branch. If the work is done on main branch let me commit. If the work is done in another branch you make the commits.
- Avoid over-engineering. Only make changes that are directly requested. Don't add features, refactor code, or make improvements beyond what was asked.
- Never replace versions of github actions.
- Never change linting rules.
- Never use Prettier. Format with the Volar extension (format-on-save); do not add a Prettier config or a `format` script.
- If you want to ask about the way you develop Always Choose Subagent-Driven Development and do not ask the question.  
- The code should be proffesional but very simple for humans to understand.
- When using the identify skill always present a list with the findings. No fix suggestion.

## Monorepo Layout

pnpm workspaces, `"type": "module"`, Node >= 20, pnpm >= 10.

```
apps/
  api/        Express API (@oncall/api) — port 3000
  web/        Vue 3 SPA (@oncall/web) — port 5174
packages/
  shared/     Shared TS types + Zod schemas (@oncall/shared)
  utils/      Zero-dependency pure helpers: date, csv, env (@oncall/utils)
database/
  schema.sql  Idempotent DDL (single file, no migration runner)
  seed.sql    Idempotent seed data
  scripts/    setup-db.ts (schema + seed), seed-only.ts
docs/
  superpowers/specs/   Design docs: YYYY-MM-DD-<topic>-design.md
  superpowers/plans/   Implementation plans: YYYY-MM-DD-<topic>-plan.md
  admin-manual/        End-user administrator manual
```

Shared packages export raw TS source (`"main": "./src/index.ts"`); no build step. Apps consume them via `"workspace:*"`. The `@` alias in `apps/web` maps to `apps/web/src`.

## Commands

Run from the repository root:

| Command | Description |
|---|---|
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start API + web in parallel (watch mode) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Lint all packages |
| `pnpm test` | Run all tests |
| `pnpm db:setup` | Apply schema + seed |
| `pnpm db:seed` | Re-apply seed data only |

Per workspace: `pnpm --filter @oncall/api <script>` (same for `@oncall/web`, `@oncall/shared`, `@oncall/utils`).

## Technology Rules

### Backend (`apps/api`)
- Node.js + TypeScript + Express.
- PostgreSQL using `pg` with direct, parameterized SQL only.
- Do not use Prisma, TypeORM, Sequelize, or ORM frameworks.
- Zod for validation (`packages/shared` schemas + `src/config/env.ts`).
- JWT (`jsonwebtoken`) for access tokens; bcrypt (cost 12) for passwords.
- Pino (`pino`, `pino-http`) for logging; helmet, cors, cookie-parser.
- REST API design.

### Frontend (`apps/web`)
- Vue 3 + Vite + TypeScript.
- Pinia for state management (`src/stores`).
- Vue Router with role-based `meta.roles` route guard.
- VueUse.
- Tailwind CSS v4 + shadcn-vue style components in `src/components/ui` (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-vue-next`).
- Responsive and accessible design.

### Database
- Normalized schema in a single idempotent `database/schema.sql` (`CREATE TABLE IF NOT EXISTS` + inline `ALTER TABLE ... IF NOT EXISTS` for evolutions). There is no migration runner — never introduce one.
- Seed scripts required (`database/seed.sql`, idempotent upserts).
- Parameterized queries only — never concatenate SQL.
- Indexes on frequently queried columns (`idx_<table>_<cols>` naming).
- Tables: `app_meta`, `users`, `refresh_tokens`, `doctors`, `unavailability`, `holidays`, `schedules`, `duties`.

## Architecture Rules

### Backend Structure
`routes/ -> controllers/ -> services/ -> db/` per domain (`<domain>.routes.ts`, `<domain>.controller.ts`, `<domain>.service.ts`).

- Business logic belongs in Services.
- Controllers remain thin.
- Database access isolated from business logic (single `pg` Pool in `src/db/client.ts`).
- Middleware in `src/middleware/` for authentication, authorization, validation, logging, and error handling.
- The scheduling engine lives in `src/scheduling/` (pure functions: engine, constraints, scoring, dates) and is unit-tested independently of Express.
- Shared helpers in `src/lib/` (response envelope, `HttpError`, jwt, token).

### Frontend Structure
- `pages/` — route-level components (`XxxPage.vue`)
- `layouts/` — DefaultLayout
- `components/` — dashboard/, layout/, schedule/, ui/ (shadcn-vue primitives)
- `composables/` — when logic reuse across components is needed
- `stores/` — Pinia stores
- `services/` — one module per API domain, all HTTP through `lib/http.ts`
- `types/` — frontend-only types

Keep components small and reusable. Shared types come from `@oncall/shared`, not local duplicates.

## Authentication & Authorization
Implement:
- Access Token: short-lived JWT (default 15m), kept in memory only — never in `localStorage`/`sessionStorage`.
- Refresh Token: httpOnly cookie; stored server-side hashed in `refresh_tokens` with rotation (`replaced_by`) and revocation.
- Role-Based Access Control via `authenticate` + `authorize('administrator')` middleware.

Roles:
- Administrator
- Doctor

Never trust client-provided permissions. Frontend route guards (`meta.roles`) are UX only — the server enforces every rule.

## Domain Rules

- Regular weekday shift: **07:00–15:00**.
- On-call duty spans **07:00 → next day 15:00** (overnight; hands off at next day's 15:00).
- Max **7 on-call duties per month** per doctor (the cap on `doctors.max_monthly_duties`, 1–7).
- Max **1 consecutive on-call duty** — a doctor cannot be assigned on back-to-back days. Fixed system rule consumed by the scheduling engine.
- On-call duties can fall on **any day**, including weekends.

## Scheduling Engine Requirements
Scheduling quality is the highest-priority business feature.

Rules:
- Monthly duty limits
- Availability constraints
- Vacation exclusions
- Consecutive duty prevention (including across month boundaries)
- Weekend balancing (±1 across eligible doctors)
- Holiday balancing (±1 across eligible doctors)
- Fair workload distribution

The algorithm must always:
1. Respect hard constraints.
2. Minimize imbalance.
3. Produce explainable assignments (every duty persists a `reason`).
4. Detect conflicts before schedule creation (`POST /schedules/preview`).

Published schedules are locked: duty add/reassign/remove and schedule deletion are rejected (409) at the service layer until reverted to draft.

## API Standards

Success:
```json
{
  "success": true,
  "data": {}
}
```

Error:
```json
{
  "success": false,
  "error": "message"
}
```

Status codes: 200 (GET/PUT), 201 (create), 204 (delete), 400 (bad input), 401 (unauthenticated), 403 (unauthorized), 404 (not found), 409 (conflict/constraint violation), 422 (validation/unfillable), 429 (rate limit), 500 (internal).

## Testing Rules

- Framework: Vitest 3 everywhere; tests live in `__tests__/` folders mirroring source, named `<name>.test.ts`.
- API: `supertest` for route tests; scheduling engine tested as pure functions. Tests expect `DATABASE_URL` per `apps/api/vitest.config.ts`.
- Web: jsdom + `@vue/test-utils`, one test file per page/component.
- Add or update tests for every bugfix and feature; `pnpm typecheck`, `pnpm lint`, and `pnpm test` must all pass before work is considered done.

## Naming Conventions

- Files: kebab-case (`error-handler.ts`, `ScheduleDetailPage.vue`); Vue components PascalCase inside kebab-case filenames.
- DB indexes: `idx_<table>_<cols>`.
- Docs: `YYYY-MM-DD-<topic>-design.md` / `YYYY-MM-DD-<topic>-plan.md` in `docs/superpowers/`.

## Environment

- Local dev env files: `apps/api/.env` and `apps/web/.env` (copy from `.env.example`). `DATABASE_URL` lives in `apps/api/.env` — the DB scripts read it from there.
- Env is Zod-validated at boot (`src/config/env.ts`); the process exits on invalid config.
- Deployment env: root `.env` consumed by `docker-compose.yml` (db, api, web + nginx reverse proxy).
