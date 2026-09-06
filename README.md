# On-Call Duty

Production-ready doctor on-call duty scheduling system for medium-sized hospitals. Monorepo with a Node/Express API and a Vue 3 web app, backed by PostgreSQL.

## Status

**Phase 1 — Foundation** is complete: monorepo scaffold, shared packages, tooling, a minimal Express API (`GET /health`), a minimal Vue 3 app with the medical theme, and the database setup pipeline.

**Phase 2 — Auth & Authorization** is complete. This phase delivers JWT access tokens, httpOnly refresh cookies with rotation, login/logout, silent session restore on reload (the access token is never stored in `localStorage`/`sessionStorage`), profile + change-password, administrator user CRUD, and role-based access control (RBAC). The default seeded administrator can sign in immediately.

**Phase 3 — Doctor Management** is complete. This phase adds a `doctors` profile table linked 1:1 to doctor accounts, a combined admin flow that creates the account and profile atomically, an admin-only Doctors page (create / edit / disable / delete), and a read-only doctor self-view on the profile page. The only stored profile attribute is `max_monthly_duties` (1–7, default 7); other scheduling rules (max 1 consecutive duty, duty spans 07:00 → next day 15:00) live in `AGENTS.md`.

**Phase 4 — Availability Management** is complete. This phase adds a `unavailability` table of doctor exclusions (inclusive whole-day date ranges with a type of vacation / sick / conference / other and an optional note), an admin Availability page (manage any doctor's exclusions with optional doctor / date filters), and a doctor My Availability page (self-service). Doctors are available by default; overlapping records are rejected (409). The scheduling engine (Phase 5) consumes these exclusions.

**Phase 5 — Scheduling Engine** is complete (backend). This phase adds `schedules` + `duties` tables, and a pure greedy scheduling engine (weighted score, deterministic tie-breaks) that respects monthly caps, unavailability, and no back-to-back duties (including across month boundaries), while balancing workload and weekends. Admins can preview a month (`POST /schedules/preview` returns proposed assignments + unfillable-day conflicts), generate atomically (`POST /schedules` — 201 / 409 if the month exists / 422 if unfillable), and manually add/reassign/remove individual duties (re-validated against the same hard constraints).

**Phase 6 — Schedule Management UI** is complete. This phase ships the deferred backend publish/unpublish lifecycle (`POST /schedules/:id/publish`, `POST /schedules/:id/unpublish`) with a service-layer **published-lock** that blocks duty add/reassign/remove and schedule deletion while a schedule is published. On the web, an admin **Schedules** page offers a guided preview → generate flow (Generate stays disabled while the preview reports unfillable-day conflicts), the **Schedule detail** page renders the month as a day-list table with weekend/gap badges, the assignment reason, and per-day Edit / Remove / +Add overrides (re-validated by the server, with 409 surfaced inline), plus publish / revert-to-draft (both confirmed). No DB migration — the `published` status was already reserved in `schema.sql` — and no `@oncall/shared` changes.

**Phase 7 — Statistics & Dashboard** is complete. This phase delivers a role-aware dashboard at `/` (the static marketing card is retired) backed by a new read-only `/stats` API. **Administrators** see hospital-wide statistics for a selectable month: day coverage (including gap days), a fairness/imbalance spread badge, and a per-doctor workload table (CSS bars + inactive-doctor flags). **Doctors** see a personal dashboard: current-month progress vs. their `max_monthly_duties` cap, a published-only "who's on call today + next 7 days" list (their own shifts highlighted), and their upcoming duties. The `/stats` endpoints aggregate `schedules`/`duties` server-side (parameterized SQL, no ORM): `/stats/admin` is admin-only (`authenticate` + `authorize('administrator')`), `/stats/me` resolves the caller's own doctor profile (admin → 404). Doctors see `published` schedules only (enforced in SQL); admins see draft + published; doctors still receive 403 on every `/schedules` and `/duties` route. No DB migration and no new frontend dependencies.

**Phase 8 — Reporting** is complete. This phase delivers an admin-only **Reports** page at `/reports`: an administrator selects a month and sees a consolidated on-call report — a header with the schedule status badge and generation time, a day-by-day duty roster (with weekend badges and gap days marked), a coverage summary, a fairness badge, and a per-doctor workload table. The admin can **export the roster as CSV** (downloads `oncall-{year}-{month}.csv`, generated client-side by a pure RFC 4180 helper in `@oncall/utils`) and **print / save as PDF** via the browser's native print over a scoped `@media print` stylesheet. No schedule for the selected month → an empty state linking to `/schedules`. A new read-only `GET /reports/monthly` endpoint composes Phase 7's `statsService.adminStats` (coverage/workload/fairness) + Phase 5's `scheduleService.getById` (roster) — no aggregation duplication, no DB migration, no new dependencies. The entire `/reports` router is admin-only (`authenticate` + `authorize('administrator')`): doctors get 403 and see no nav link; invalid `year`/`month` → 400; no query → the current UTC month.

## Roadmap

1. Foundation (complete)
2. Auth & Authorization (complete)
3. Doctor Management (complete)
4. Availability Management (complete)
5. Scheduling Engine (complete)
6. Schedule Management UI (complete)
7. Statistics & Dashboard (complete)
8. Reporting (complete)

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

## Definition of Done (Phase 4)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; sample unavailability rows are seeded.
- A doctor can list/create/edit/delete their own exclusions on `/my-availability`; an admin gets 404 on `/unavailability/me`.
- An admin can list all doctors' exclusions (optional `doctorId`/date filters), create for any doctor, and edit/delete any record; a doctor gets 403 on `GET /unavailability` and `POST /unavailability`.
- Overlapping record → 409; `endDate < startDate` → 400; non-numeric `:id` → 400; unknown doctor → 404; a doctor editing another doctor's record → 403.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## Definition of Done (Phase 5)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone (no schedule seed — schedules are produced via the API).
- The engine respects every hard constraint: no doctor over `max_monthly_duties`, no duty during unavailability, no back-to-back (including the cross-month boundary), inactive doctors excluded.
- Admin can `POST /schedules/preview` (200 `{assignments, conflicts}`), `POST /schedules` (201; 409 if the month exists; 422 if unfillable and nothing persisted), `GET /schedules` / `GET /schedules/:id`, `DELETE /schedules/:id`, and override duties via `POST /schedules/:id/duties` / `PATCH /duties/:id` / `DELETE /duties/:id` with 409 on any constraint violation. Doctors get 403 on all schedule/duty routes.
- For solvable months, weekend counts stay within ±1 across eligible doctors; every duty carries a persisted `reason`.
- Deleting a doctor with duties → 409 (disable instead); deleting a schedule cascades its duties.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## Definition of Done (Phase 6)

- Admin can open **Schedules** and generate a month via the guided preview → generate flow (Generate disabled while conflicts exist), then navigate to the detail.
- The **Schedule detail** day-list shows every day with doctor, weekend/gap badges, reason, and per-row Edit / Remove / +Add; overrides validate on the server and surface 409 messages inline.
- Admin can **Publish** (locks editing + delete) and **Revert to draft** (re-enables), both confirmed. A published schedule rejects duty add/reassign/remove and delete with 409 at the service layer.
- Doctors get 403 on all schedule/duty routes; nav links and routes are admin-gated.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## Definition of Done (Phase 7)

- The role-aware home at `/` renders the admin dashboard for administrators and the doctor dashboard for doctors; the static marketing card is gone.
- Admin home shows month-selectable coverage (filled/gaps), a fairness spread badge, and a per-doctor workload table (with CSS bars and inactive flags); an empty state links to `/schedules` when the selected month has no schedule.
- Doctor home shows current-month progress vs. cap, a published-only who's-on-call list (today + 7 days, `isMine` highlighted), and upcoming duties, each with an empty state.
- `GET /stats/admin` is admin-only (doctor → 403, unauth → 401); `GET /stats/me` resolves the caller's own doctor profile (admin → 404, unauth → 401). Doctors see `published` schedules only; admins see draft + published; doctors still receive 403 on every `/schedules` and `/duties` route. The published-only filter is enforced in SQL.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## Definition of Done (Phase 8)

- An admin can open **Reports** (nav link, `/reports`), pick a month, and see a consolidated report: a header with the status badge + generation time, a per-day roster (with weekend badges and gap days marked), a coverage summary, a fairness badge, and a per-doctor workload table.
- An admin can **export the roster as CSV** (downloads `oncall-{year}-{month}.csv`) and **print / save as PDF** (browser print dialog, with nav and action buttons hidden and the report at full width).
- No schedule for the selected month → an empty state that links to `/schedules`.
- `GET /reports/monthly` is admin-only (doctor → 403, unauth → 401); invalid `year`/`month` → 400; no query → the current UTC month. The reports service composes Phase 7's `adminStats` and Phase 5's `getById` — no aggregation duplication, no DB migration.
- Doctors still receive 403 on every `/reports` route; the nav link and route are admin-gated.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass across the monorepo.

## Documentation

- Design: `docs/superpowers/specs/2026-08-06-phase1-foundation-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-06-phase1-foundation-plan.md`
- Phase 3 design: `docs/superpowers/specs/2026-08-06-phase3-doctors-design.md`
- Phase 3 implementation plan: `docs/superpowers/plans/2026-08-06-phase3-doctors-plan.md`
- Phase 4 design: `docs/superpowers/specs/2026-08-07-phase4-availability-design.md`
- Phase 4 implementation plan: `docs/superpowers/plans/2026-08-07-phase4-availability-plan.md`
- Phase 5 design: `docs/superpowers/specs/2026-08-07-phase5-scheduling-engine-design.md`
- Phase 5 implementation plan: `docs/superpowers/plans/2026-08-07-phase5-scheduling-engine-plan.md`
- Phase 6 design: `docs/superpowers/specs/2026-08-07-phase6-schedule-ui-design.md`
- Phase 6 implementation plan: `docs/superpowers/plans/2026-08-07-phase6-schedule-ui-plan.md`
- Phase 7 design: `docs/superpowers/specs/2026-08-07-phase7-statistics-dashboard-design.md`
- Phase 7 implementation plan: `docs/superpowers/plans/2026-08-07-phase7-statistics-dashboard-plan.md`
- Phase 8 design: `docs/superpowers/specs/2026-08-07-phase8-reporting-design.md`
- Phase 8 implementation plan: `docs/superpowers/plans/2026-08-07-phase8-reporting-plan.md`
- Project conventions: `AGENTS.md`
