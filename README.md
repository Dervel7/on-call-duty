# On-Call Duty

Production-ready doctor on-call duty scheduling system for medium-sized hospitals. Monorepo with a Node/Express API and a Vue 3 web app, backed by PostgreSQL.

## Status

**Phase 1 — Foundation** is complete: monorepo scaffold, shared packages, tooling, a minimal Express API (`GET /health`), a minimal Vue 3 app with the medical theme, and the database setup pipeline.

**Phase 2 — Auth & Authorization** is complete. This phase delivers JWT access tokens, httpOnly refresh cookies with rotation, login/logout, silent session restore on reload (the access token is never stored in `localStorage`/`sessionStorage`), profile + change-password, administrator user CRUD, and role-based access control (RBAC). The default seeded administrator can sign in immediately.

**Phase 3 — Doctor Management** is complete. This phase adds a `doctors` profile table linked 1:1 to doctor accounts, a combined admin flow that creates the account and profile atomically, an admin-only Doctors page (create / edit / disable / delete), and a read-only doctor self-view on the profile page. The only stored profile attribute is `max_monthly_duties` (1–7, default 7); other scheduling rules (max 1 consecutive duty, duty spans 07:00 → next day 15:00) live in `AGENTS.md`.

Remaining business features (availability, scheduling, reports) arrive in later phases.

## Roadmap

1. Foundation (complete)
2. Auth & Authorization (complete)
3. Doctor Management (complete)
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

### Default administrator

`pnpm db:setup` seeds one administrator:

- Email: `admin@oncall.local`
- Password: `changeme123`
- Doctors: `dr1@oncall.local`, `dr2@oncall.local`, `dr3@oncall.local` — the initial password for each is the email itself (change on first login).

This default password is documented and MUST be changed on first login
(Profile → Change password). The seeded bcrypt hash (cost 12) lives in
`database/seed.sql`; the plaintext exists only in documentation.

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
| `JWT_ACCESS_SECRET` | `apps/api/.env` | Access-token signing secret. Required in production; dev default in `.env.example`. |
| `JWT_ACCESS_EXPIRES_IN` | `apps/api/.env` | Access-token lifetime (default `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | `apps/api/.env` | Refresh-token lifetime (default `7d`) |
| `COOKIE_SECURE` | `apps/api/.env` | Refresh-cookie `Secure` flag (default true in production, false in dev) |
| `COOKIE_SAMESITE` | `apps/api/.env` | Refresh-cookie `SameSite` (default `lax`) |
| `COOKIE_DOMAIN` | `apps/api/.env` | Optional refresh-cookie domain |

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

## Definition of Done (Phase 2)

- `POST /auth/login` issues an access token (short-lived JWT) and sets a rotation-ready httpOnly `refresh_token` cookie; `POST /auth/refresh` rotates the refresh token and returns a new access token; `POST /auth/logout` clears the cookie.
- `GET /auth/me` returns the signed-in user; `POST /auth/change-password` validates the current password, enforces the new-password policy, and re-hashes with bcrypt.
- Administrators can list/get/create/update/delete users via the admin endpoints; doctors receive `403 Forbidden`.
- RBAC middleware rejects unauthenticated (`401`) and unauthorized (`403`) access; validation errors return `422`; conflict errors (e.g. duplicate email) return `409`.
- The refresh token is stored only in the in-memory token store (server side) and the httpOnly cookie; the access token is never persisted in the browser's `localStorage`/`sessionStorage`.
- The web app provides a login page, a profile page with change-password, an admin users page, a router guard that redirects unauthenticated users to `/login`, and silent session restore on reload via the refresh cookie.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass from a clean clone.

## Definition of Done (Phase 3)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; the seeded admin and three doctors are present.
- Admin can list/create/edit/disable/delete doctors; create produces a matching account + profile atomically; delete removes the account (cascade).
- A doctor can `GET /doctors/me` (own profile, read-only); an admin gets 404 there.
- The Doctors page is admin-only (doctors get 403 / are redirected); the Users page creates administrators only.
- Duplicate doctor email → 409; out-of-range `maxMonthlyDuties` → 400.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## Documentation

- Design: `docs/superpowers/specs/2026-08-06-phase1-foundation-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-06-phase1-foundation-plan.md`
- Phase 3 design: `docs/superpowers/specs/2026-08-06-phase3-doctors-design.md`
- Phase 3 implementation plan: `docs/superpowers/plans/2026-08-06-phase3-doctors-plan.md`
- Project conventions: `AGENTS.md`
