# API Multi-Clinic Migration Plan

Date: 2026-09-20
Scope: `apps/api`, `packages/shared` on `main`
Status: ready for implementation

## Goal

Make main's API use the multi-clinic database schema that is already applied in
`database/schema.sql`. One schema serves both customer shapes: a single-clinic
hospital is a deployment with one row in `clinics`; a multi-clinic hospital has
many. Deployment mode is data, not schema.

## Current state (already done, do not redo)

- `database/schema.sql` is the multi-clinic baseline: `clinics` table,
  `users.clinic_id` with `users_clinic_role_check`
  (administrator/doctor ⇒ `clinic_id NOT NULL`, manager/superadmin ⇒ NULL),
  `doctors.clinic_id NOT NULL`, `schedules.clinic_id` with
  `UNIQUE (clinic_id, year, month)`, `schedule_generation_log.clinic_id`,
  `activity_log.clinic_id`.
- `database/seeds/single-clinic.seed.sql` and
  `database/seeds/multi-clinic.seed.sql`, applied by `pnpm db:seed:single` /
  `pnpm db:seed:multi` (runner `database/scripts/seed.ts`: drop + recreate +
  schema + chosen seed). Both target the database named in `apps/api/.env`
  `DATABASE_URL` (currently `oncall_duty`).
- `docker-compose.yml` and `.github/workflows/ci.yml` already point at the
  single-clinic seed.
- The old single-clinic API code on main does NOT satisfy the new constraints
  (e.g. seeding `admin@oncall.local` without a clinic violates
  `users_clinic_role_check`).

## Strategy: port, do not reimplement

The branch `multi-clinic-hospital` is `main HEAD (58a2c2d)` plus 30 linear
commits. The merge base is main's HEAD and main has no commits the branch
lacks — zero drift. The API migration was implemented, code-reviewed, and
gated there as Tasks 5–13, with tests. Reimplementation would duplicate
finished, reviewed work and re-introduce the bugs already fixed there
(see `be913c9`).

Cherry-picking is not suitable: three of the twelve API commits interleave
`apps/web`, `database/seed.sql`, or docs changes that conflict with main's new
`database/seeds/` layout. A path-scoped checkout of the final tree is exact,
atomic, and conflict-free.

Reference material on the branch (read with `git show
multi-clinic-hospital:<path>`, do not port):

- `docs/superpowers/plans/2026-09-19-multi-clinic-hospital-plan.md` — original
  task plan (Tasks 1–15)
- `docs/superpowers/2026-09-19-multi-clinic-handoff.md` and
  `docs/superpowers/2026-09-19-multi-clinic-handoff-2.md` — per-task
  acceptance details, commit ledger, known quirks

## Do NOT port

- `apps/web` — 16 commits (Tasks 14.1–14.15, manager UI, clinic selector,
  ClinicsPage). Separate follow-up plan.
- `database/` — the branch's `seed.sql` is superseded by main's
  `database/seeds/` layout; `schema.sql` is already identical.
- `.github/`, `AGENTS.md`, `README.md`, `docs/` handoffs — main's versions are
  newer and already describe the new database layout.

## Target contract (what the ported code implements)

- Roles: `superadmin | manager | administrator | doctor`. The DB check
  enforces: administrator/doctor have `clinic_id`, manager/superadmin do not.
- JWT access token payload: `{ sub, role, clinicId: number | null }`. The
  `clinicId` claim is required — tokens without it fail verification (old
  sessions are invalidated by design). Access tokens stay in memory only.
- `apps/api/src/lib/scope.ts` — `resolveClinicScope(user, requestedClinicId)`
  is the single scoping gate for every clinic-scoped endpoint:
  - administrator/doctor: pinned to the JWT clinic; a differing
    `?clinicId=` is 403.
  - manager/superadmin: must pass `?clinicId=` (missing → 400).
- New clinics domain (manager + superadmin): list / create / rename /
  deactivate / reactivate, plus per-clinic administrator lifecycle.
- Domain scoping: users (manager lifecycle rules), doctors, unavailability
  (through the doctor's clinic), schedules and duties
  (`UNIQUE (clinic_id, year, month)`; all four cross-clinic leak patterns
  closed — see `9b618fa`), stats (admin sees own clinic, manager drills down
  via `?clinicId=`, doctor sees own-clinic data), reports (clinicName header,
  roster 404 across clinics), usage metering (partitioned per clinic, batch
  grouping, alert detail, dedup), activity log (`clinic_id` recorded; manager
  admitted to payment-alert).
- Unchanged on purpose: published-schedule lock, billing `app_meta` lockdown,
  response envelope, status-code semantics (400/401/403/404/409/422/429/500),
  layering `routes → controllers → services → db`, parameterized SQL only.

## Tasks

### T1 — Port the ported tree

```
git checkout multi-clinic-hospital -- apps/api packages/shared
```

Expected: 79 files change (+2604 / −715). Highlights: new
`routes/clinic.routes.ts`, `controllers/clinic.controller.ts`,
`services/clinic.service.ts`, `validators/clinic.ts`, `lib/scope.ts`,
`lib/jwt.ts` (clinicId claim), `types/express.d.ts`, and two new live-DB
isolation suites (`doctor.isolation.test.ts`, `schedule.isolation.test.ts`)
with `__tests__/helpers/clinic-fixtures.ts`.

No conflicts are possible: no file under these paths differs between the
merge base and main.

### T2 — Port audit (mechanical)

- `grep -r "seed.sql\|db:setup\|db:seed[^:]" apps/api packages/shared .github docker-compose.yml`
  → must return nothing.
- Confirm `apps/api/package.json` and `apps/api/vitest.config.ts` are
  untouched by the port (no new dependencies; `DATABASE_URL` handling
  unchanged).
- Confirm `ci.yml` still runs `pnpm db:seed:single` (the branch's CI line
  `pnpm db:setup` must not be carried over).
- `git status` must show no changes under `apps/web`, `database/`, `docs/`.

### T3 — Gates

```
pnpm typecheck && pnpm lint && pnpm test
```

- Isolation tests need a live `DATABASE_URL` (they run against `oncall_duty`
  and create their own uniquely-suffixed fixture clinics, cleaned up in
  `dispose()`; any residue is wiped by the next `db:seed:*` run).
- Web tests are mock-based and the API changes are additive for admin/doctor
  flows, so they are expected green. If a web test fails on a renamed or
  removed response field, stop and reconcile the contract — do not weaken the
  API to match the old web code. The web port is a follow-up.

### T4 — Live smoke, single-clinic mode

```
pnpm db:seed:single && pnpm dev
```

- Login `admin@oncall.local` / `changeme123` → access token contains
  `clinicId`; dashboard, schedules list, and stats load (own clinic).
- Generate a schedule for the current month; verify it persists and the
  published lock still behaves (publish → duty edit → 409).
- A pre-migration token (no `clinicId` claim) is rejected on refresh/verify.

### T5 — Live smoke, multi-clinic mode

```
pnpm db:seed:multi && pnpm dev
```

- Login `manager@oncall.local` / `changeme123` → clinics list works; stats,
  reports, users, availability, activity accept `?clinicId=<id>` drill-down;
  omitting `?clinicId=` is 400.
- Login a clinic admin (e.g. `cardiology-a.admin@oncall.local` /
  `changeme123`) → another clinic's roster/schedule is 404; passing
  `?clinicId=<other>` is 403.
- Doctor `dr1@oncall.local` (password = email) sees only own-clinic data.
- Finish by running `pnpm db:seed:single` so the database rests in the
  default state.

## Definition of Done

- T2 audit clean; T3 gates green; T4 and T5 smoke matrices pass.
- `git diff multi-clinic-hospital -- apps/api packages/shared` is empty
  (the port is exact).
- Work happens on `main`; per repo convention the user commits.

## Risks and notes

- The port changes the API contract for web (user objects gain `clinicId`,
  manager role appears, stats/reports gain `?clinicId=`). Main's web keeps
  working for administrator/doctor flows because the changes are additive and
  admins are self-scoped; manager-only flows have no UI until the web port.
- Usage metering partitioning changes the superadmin Usage response shape;
  main's UsagePage may render it acceptably or need the follow-up port —
  verify in T3, do not patch the API for it.
- `be913c9` exists because review found real bugs (published-lock test
  regressions, doctor clinic validation). The port includes those fixes;
  do not "simplify" the ported code afterward.
