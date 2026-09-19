# Multi-Clinic Hospital Edition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the single-tenant on-call scheduler into a multi-clinic hospital system: one deployment holds one hospital with many clinics; every doctor and administrator belongs to exactly one clinic; monthly schedules are per clinic; a new `manager` role sees the whole hospital (per-clinic drill-down) and manages clinics plus their administrators; the existing `superadmin` stays the vendor audit role.

**Architecture:** A tenancy key (`clinic_id`) is introduced across all four layers (database → shared contracts → API → web), ordered so every commit typechecks: shared types first (additive), then the fresh-start schema/seed, then API scope plumbing (one scope-resolution helper consumed by every controller/service), then domain-by-domain scoping, then web. The scheduling engine itself is untouched — tenancy is injected only where it builds its input (`buildContext`) and where it persists output.

**Tech Stack:** Unchanged: Vue 3 + Vite + Pinia, Express + TypeScript, `pg` parameterized SQL, Zod, Vitest, single idempotent `database/schema.sql` (no migration runner).

---

## 1. Locked Decisions (the contract — do not re-litigate)

| # | Decision | Value |
|---|---|---|
| D1 | Tenancy model | One hospital per deployment. New `clinics` table. `doctors.clinic_id` NOT NULL FK; `users.clinic_id` nullable FK. **1 doctor = 1 clinic, 1 administrator = 1 clinic** (strict 1:1 membership; no doctor or admin spans clinics). |
| D2 | Unavailability | Attached to `doctor_id` as today; therefore per clinic **through the doctor**. No new column on `unavailability`. |
| D3 | Login scoping | Identity is global (unique email/username). The login response and JWT carry the user's clinic; `radiology.admin` sees only Radiology users, schedules, stats, reports, activity. |
| D4 | `superadmin` | Vendor-only audit role, exactly as today (usage metering, billing, global read). **Not** a hospital role. Never assign to customers. |
| D5 | `manager` (new) | Hospital-wide user. **Read-only everywhere** (per-clinic drill-down) **plus** clinic lifecycle (create/rename/deactivate clinics) and administrator lifecycle (create/update/deactivate `administrator` users for any clinic). Cannot touch doctors, unavailability, or schedule content. |
| D6 | Schedules | Per clinic: `UNIQUE (clinic_id, year, month)`. Scheduling rules (caps, adjacency, weekend balance, fairness) apply **within** a clinic's doctor pool; clinics never interact. |
| D7 | Billing | Per hospital — the existing single `app_meta` key `billing_paid_through` and the `authenticate` lock check are unchanged. |
| D8 | Rollout | **Fresh start.** New baseline schema + seed; no backfill of pre-multi-clinic databases. Running this schema against an old DB is out of contract; local dev DBs must be reset (Task 3). |
| D9 | Manager stats | Drill-down only. Manager picks a clinic and sees exactly the existing admin dashboard/reports for it. No cross-clinic merged metrics (cross-clinic fairness numbers are meaningless). |
| D10 | Clinic lifecycle | Clinics are deactivated (`is_active = FALSE`), never deleted. Deactivated clinic: its users cannot log in; manager can still read its history. |

### 1.1 Interpretation notes (pre-empting agent questions)

- "Unavailability is per clinic" (D2) is satisfied structurally: a doctor has exactly one clinic, so every unavailability row is clinic-scoped via `doctors.clinic_id`. Filtering happens through the join `unavailability → doctors`.
- `users.clinic_id` and `doctors.clinic_id` both exist and **must always be equal** for doctor rows. `users.clinic_id` is the auth/scope source for all roles (administrators have no `doctors` row); `doctors.clinic_id` is the domain anchor for the doctor pool. The single write path (doctor/user services) enforces equality; a regression test pins it (Task 7).
- Roles of a user never change clinics implicitly: moving a user across clinics is `superadmin`-only (and `manager` for `administrator` accounts), and must sync both columns for doctors.

---

## 2. Target State

### 2.1 Roles

```
Role = 'superadmin' | 'manager' | 'administrator' | 'doctor'
```

| Capability | superadmin (vendor) | manager (hospital) | administrator (clinic) | doctor |
|---|---|---|---|---|
| Clinics: list / create / rename / deactivate | yes / yes | yes / yes | no | no |
| Users: list/get | any clinic | per clinic (`?clinicId=`) | own clinic | no |
| Users: create/update/soft-delete | any role, any clinic | `administrator` accounts, any clinic | `administrator`/`doctor`, own clinic only | no |
| Doctors: list/get | any clinic | per clinic (read) | own clinic (read) | `/doctors/me` only |
| Doctors: create/update/soft-delete | any clinic | **no** | own clinic only | no |
| Unavailability: read | any clinic | per clinic | own clinic + own records (`/me`) | `/me` |
| Unavailability: create/update/delete | any clinic | **no** | own clinic doctors + own | own records |
| Schedules: list/get/roster | any clinic | per clinic (read) | own clinic | own clinic (read) |
| Schedules: preview/generate/addDuty/reassign/removeDuty/publish/unpublish/delete | any clinic | **no** | own clinic only | no |
| Stats `/admin`, reports `/monthly`, activity | any clinic | per clinic | own clinic | no |
| Stats `/me` | n/a (no doctor profile → 404, unchanged) | n/a | n/a | own |
| Usage (generations/alerts) | **only role** | no | no | no |
| Billing get/set | **only role** | no | no | no |
| Billing payment-alert | yes | yes (hospital-wide value) | yes | yes |
| Auth (login/refresh/logout/me/change-password/theme) | self | self | self | self |

### 2.2 Clinic scope resolution — the one algorithm every endpoint uses

New file `apps/api/src/lib/scope.ts`. Semantics (implement exactly):

```ts
import type { AuthUser } from '@oncall/shared'
import { HttpError } from '../lib/http-error'

/** Fixed to one clinic (from the JWT) for administrator/doctor. */
export interface ClinicScope {
  kind: 'clinic'
  clinicId: number
}

export function resolveClinicScope(
  user: Pick<AuthUser, 'id' | 'role' | 'clinicId'>,
  requestedClinicId: number | undefined,
): ClinicScope {
  if (user.role === 'administrator' || user.role === 'doctor') {
    if (requestedClinicId !== undefined && requestedClinicId !== user.clinicId) {
      throw new HttpError(403, 'Forbidden')
    }
    return { kind: 'clinic', clinicId: user.clinicId as number }
  }
  if (user.role === 'manager' || user.role === 'superadmin') {
    if (requestedClinicId === undefined) {
      throw new HttpError(400, 'clinicId query parameter is required')
    }
    return { kind: 'clinic', clinicId: requestedClinicId }
  }
  throw new HttpError(403, 'Forbidden')
}
```

Rules:

- **administrator/doctor**: scope is the JWT `clinicId`, immutable. Passing a different `clinicId` → 403.
- **manager/superadmin**: `?clinicId=` is a **required query param on every clinic-scoped endpoint — reads and writes alike** (lists, stats, reports, activity, `preview`, `generate`, `POST /doctors`, `POST /unavailability`). Missing → 400. The clinic is **never** taken from a request body; body schemas gain no `clinicId`. Sole exception: `POST /users`, where the target clinic of the *new account* is part of the creation payload (validated per the §2.5 row). A clinic id that does not exist → 404 from the service after the scope check. An **inactive** clinic stays readable for history (D10); only logins of its users and creation of users into it are blocked.
- Object-level access (by `:id` path param): the clinic comes from the row. administrator/doctor with a mismatched clinic → **404** (existence hidden). manager and superadmin pass the object check — manager only ever reaches read routes because write routes reject them at the route layer with **403** before any service call.
- This helper is the ONLY way services receive a clinic scope; controllers feed it `req.query.clinicId`. No service reads `req.query.clinicId` directly.

### 2.3 Identity & tokens

- JWT access payload: `{ sub: number, role: Role, clinicId: number | null }` (`null` for `manager`/`superadmin`). `verifyAccessToken` validates `clinicId` is `number | null`; old tokens without the claim fail verification → users must re-login (fresh start, acceptable).
- `req.user` becomes `{ id, role, clinicId }` (`apps/api/src/types/express.d.ts`).
- `AuthUser` gains `clinicId: number | null` and `clinicName: string | null`; login/refresh/`GET /auth/me` responses include both (single join `users → clinics`).
- Refresh-token rotation, rate limits, cookie handling: unchanged.

### 2.4 Database changes (fresh baseline — Task 3 writes these verbatim)

```sql
CREATE TABLE IF NOT EXISTS clinics (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- `users`: add `clinic_id INTEGER REFERENCES clinics (id)` (nullable) in the `CREATE TABLE`; swap the role CHECK to `CHECK (role IN ('superadmin','manager','administrator','doctor'))`; add the role↔clinic invariant CHECK:

```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin','manager','administrator','doctor'));
ALTER TABLE users ADD CONSTRAINT users_clinic_role_check
  CHECK ( (role IN ('administrator','doctor') AND clinic_id IS NOT NULL)
       OR (role IN ('superadmin','manager')   AND clinic_id IS NULL) );
CREATE INDEX IF NOT EXISTS idx_users_clinic ON users (clinic_id) WHERE is_deleted = FALSE;
```

- `doctors`: add `clinic_id INTEGER NOT NULL REFERENCES clinics (id)` in the `CREATE TABLE`; `CREATE INDEX IF NOT EXISTS idx_doctors_clinic ON doctors (clinic_id);`.
- `schedules`: add `clinic_id INTEGER NOT NULL REFERENCES clinics (id)` in the `CREATE TABLE`; replace `UNIQUE (year, month)` with `UNIQUE (clinic_id, year, month)` (the unique index also serves clinic-prefix lookups; no extra index).
- `duties`: unchanged (scoped via `schedule_id → schedules.clinic_id`).
- `unavailability`: unchanged (scoped via `doctor_id → doctors.clinic_id`).
- `schedule_generation_log`: add `clinic_id INTEGER NOT NULL REFERENCES clinics (id)`; index `idx_schedule_generation_log_clinic ON (clinic_id, year, month)`.
- `activity_log`: add `clinic_id INTEGER REFERENCES clinics (id)` (nullable — null for manager/vendor/self-service-without-clinic actions); index `idx_activity_log_clinic ON activity_log (clinic_id)`.
- `operator_alerts`: no DDL change; the `detail` JSONB gains `clinicId`/`clinicName`.
- `app_meta`, `refresh_tokens`, billing: unchanged (D7).
- Because this is a fresh baseline (D8): the new columns live **inline in the `CREATE TABLE` statements** where the table is first created in this file; the existing drop/re-add ALTER pattern is used only for the `users_role_check` swap. A header comment states: "Multi-clinic baseline (2026-09-19). Not applicable to pre-multi-clinic databases; reset required."

### 2.5 Endpoint scope matrix (current 43 endpoints + 3 new `/clinics` = 46; `GET`+`PATCH /billing` share one row)

Legend — Roles: who passes `authorize`. Scope: what `resolveClinicScope` gets. **New/changed** in bold.

| Endpoint | Roles | Scope source | Change |
|---|---|---|---|
| POST `/auth/login` | public | — | response + token gain clinic fields; clinic-active check (D10) |
| POST `/auth/refresh` | public (cookie) | — | response + token gain clinic fields |
| POST `/auth/logout` | public (cookie) | — | none |
| GET `/auth/me` | auth | — | response gains `clinicId`, `clinicName` |
| POST `/auth/change-password` | auth | — | none |
| **GET `/clinics`** | manager, superadmin | — | **new** — list all incl. inactive (name, isActive, counts) |
| **POST `/clinics`** | manager, superadmin | — | **new** — `{ name }`; duplicate name → 409 |
| **PATCH `/clinics/:id`** | manager, superadmin | — | **new** — `{ name?, isActive? }`; deactivate only (D10) |
| GET `/users` | administrator, manager, superadmin | `?clinicId=` | admin: forced own clinic; manager/superadmin: `clinicId` required |
| GET `/users/:id` | administrator, manager, superadmin | row's clinic | wrong clinic → 404; manager can't read manager/superadmin rows |
| POST `/users` | administrator, manager, superadmin | see rules | admin: role ∈ {administrator, doctor}, own clinic; manager: role forced `administrator`, `clinicId` required; superadmin: anything |
| PATCH `/users/:id` | administrator, manager, superadmin | row's clinic | clinic reassignment: superadmin only (manager: administrator accounts); syncs `doctors.clinic_id` |
| DELETE `/users/:id` | administrator, manager, superadmin | row's clinic | soft delete, same scoping as PATCH |
| PATCH `/users/me/theme` | auth | — | none |
| GET `/doctors` | administrator, manager, superadmin | `?clinicId=` | **manager added (read)** |
| GET `/doctors/me` | auth (doctor) | — | none |
| GET `/doctors/:id` | administrator, manager, superadmin | row's clinic | wrong clinic → 404 |
| POST `/doctors` | administrator, superadmin | `?clinicId=` (superadmin); actor clinic (admin) | `clinic_id` = scope clinic — never from payload |
| PATCH `/doctors/:id` | administrator, superadmin | row's clinic | wrong clinic → 404 |
| DELETE `/doctors/:id` | administrator, superadmin | row's clinic | soft delete, same |
| GET `/unavailability` | administrator, manager, superadmin | `?clinicId=` | **manager added (read)** |
| GET `/unavailability/me` | auth (doctor) | — | none |
| POST `/unavailability` | administrator, superadmin | `?clinicId=` (superadmin); actor clinic (admin) | target doctor must belong to scope clinic → else 404 |
| POST `/unavailability/me` | auth (doctor) | — | none |
| PATCH `/unavailability/:id` | auth | row's clinic | admin: record's doctor in scope clinic; doctor: own record; manager: **403 (service check — route stays authenticate-only for doctor self-service, Task 8)** |
| DELETE `/unavailability/:id` | auth | row's clinic | same as PATCH |
| GET `/schedules` | administrator, doctor, manager, superadmin | `?clinicId=` | doctor: own clinic (was: all); manager: `clinicId` required |
| POST `/schedules/preview` | administrator, superadmin | `?clinicId=` (superadmin); actor clinic (admin) | `buildContext` scoped to clinic |
| POST `/schedules` | administrator, superadmin | `?clinicId=` (superadmin); actor clinic (admin) | pre-check + insert carry `clinic_id` |
| GET `/schedules/:id` | administrator, doctor, manager, superadmin | row's clinic | wrong clinic → 404 (manager passes) |
| POST `/schedules/:id/publish` | administrator, superadmin | row's clinic | manager excluded; wrong clinic → 404 |
| POST `/schedules/:id/unpublish` | administrator, superadmin | row's clinic | same |
| DELETE `/schedules/:id` | administrator, superadmin | row's clinic | same |
| POST `/schedules/:id/duties` | administrator, superadmin | row's clinic | doctor must be in schedule's clinic → 404 |
| PATCH `/duties/:id` | administrator, superadmin | duty → schedule | wrong clinic → 404 |
| DELETE `/duties/:id` | administrator, superadmin | duty → schedule | same |
| GET `/stats/admin` | administrator, manager, superadmin | `?clinicId=` | **manager added**; all queries clinic-filtered |
| GET `/stats/me` | auth (doctor) | doctor's clinic | "published this month" + who's-on-call queries filtered to doctor's clinic |
| GET `/reports/monthly` | administrator, manager, superadmin | `?clinicId=` | **manager added**; header shows clinic name |
| GET `/activity` | administrator, manager, superadmin | `?clinicId=` | **manager added**; filtered on `activity_log.clinic_id` |
| GET `/usage/generations` | superadmin | — | payload gains `clinicId`, `clinicName`; batching partitions by clinic |
| GET `/usage/alerts` | superadmin | — | `detail` gains `clinicId`, `clinicName` |
| PATCH `/usage/alerts/:id/resolve` | superadmin | — | none |
| GET `/billing/payment-alert` | administrator, manager, superadmin | — | manager added (hospital-wide value, D7); doctors remain 403 as today |
| GET+PATCH `/billing` | superadmin | — | none (D7) |

`authorize` middleware semantics: the existing blanket "superadmin passes `administrator` routes" rule (authorize.ts line 7) stays. `manager` is added **explicitly per route** — never to the blanket rule.

### 2.6 The four cross-clinic bug patterns this plan must kill

These are the silent-leak/global-pool sites found in the audit; every one has a task step:

1. **Adjacent-day adjacency** — `schedule.service.ts` lines 143, 215, 622-624 query `duties WHERE duty_date = $` globally. Fix: `JOIN schedules s ON s.id = du.schedule_id WHERE du.duty_date = $1 AND s.clinic_id = $2`. Unfixed, Radiology's Tuesday duty would wrongly block Cardiology's doctor on Wednesday.
2. **"The schedule for a month"** — `generate` pre-check (line 263), `stats.adminStats` (lines 58-60), `meStats` published checks (lines 181-183), `monthCaps`: all assume one schedule per (year, month). Fix: add `AND clinic_id = $`.
3. **Doctor pool** — `buildContext` (line 111-113) loads every active doctor. Fix: `AND u.clinic_id = $`. Unavailability map (123-127): filter via doctor's clinic.
4. **Vendor metering batching** — `usage.service.ts` groups generations by `(year, month, created_at)` (line 115-117) and compares doctor sets across batches. Unscoped, two clinics generating the same month read as "disjoint regeneration" → false vendor alerts. Fix: partition by `(clinic_id, year, month, created_at)`.

---

## 3. Global Constraints

- Branch: `multi-clinic-hospital` (create in Task 1). **Never commit on `main`.** One commit per task; conventional commit messages (`feat(api): scope schedules to clinic`).
- Parameterized SQL only — never concatenate SQL strings.
- `database/schema.sql` stays idempotent (`CREATE TABLE IF NOT EXISTS` + drop/re-add constraint swaps). No migration runner, ever.
- **Fresh start contract (D8):** after Task 3, local/dev databases must be reset (`DROP` + recreate + `pnpm db:setup`). No backfill code for old databases.
- No Prettier, no linting-rule changes, no GitHub-Actions version changes, no new dependencies.
- API envelope shapes (`{ success, data }` / error) unchanged; new fields are additive.
- Every task ends green: `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint` where applicable, and the task's targeted vitest run. Full gates (`pnpm typecheck && pnpm lint && pnpm test`) only at Task 15.
- API service tests that hit `DATABASE_URL` require the reset DB with the new seed; if no Postgres is reachable those specific files fail with `ECONNREFUSED` (pre-existing condition, report it — do not fake a pass).
- The scheduling engine directory (`apps/api/src/scheduling/`) is **read-only** in this plan. If a task seems to need an engine change, stop and re-read §2.6 — the fix belongs in `schedule.service.ts`.

---

## 4. Tasks

### Task 1: Branch and baseline

**Files:** none (git only).

- [ ] From repo root: `git checkout -b multi-clinic-hospital` (from up-to-date `main`).
- [ ] Record baseline: `pnpm typecheck && pnpm lint && pnpm test` — report outcomes verbatim (known `ECONNREFUSED` on DB-backed API tests without a live Postgres is acceptable to note; everything else must pass before proceeding).

### Task 2: Shared package — role, clinic types, schemas (additive)

**Files:**
- Modify: `packages/shared/src/types/auth.ts` — `Role` gains `'manager'`; `AuthUser` gains `clinicId: number | null`, `clinicName: string | null`; `User` inherits; `CreateUserRequest` gains `clinicId?: number`; `UpdateUserRequest` gains `clinicId?: number`.
- Modify: `packages/shared/src/types/doctor.ts` — `Doctor` gains `clinicId: number`, `clinicName: string`.
- Modify: `packages/shared/src/types/schedule.ts` — `ScheduleSummary` gains `clinicId: number`, `clinicName: string`; `ScheduleQuery` gains `clinicId?: number`.
- Modify: `packages/shared/src/types/stats.ts` — `StatsQuery` gains `clinicId?: number`.
- Modify: `packages/shared/src/types/reports.ts`, `types/audit.ts` — query types gain `clinicId?: number`.
- Modify: `packages/shared/src/types/usage.ts` — `GenerationEvent` gains `clinicId: number`, `clinicName: string`.
- Create: `packages/shared/src/types/clinic.ts` — `Clinic { id, name, isActive, doctorCount, adminCount, createdAt }`, `CreateClinicRequest { name }`, `UpdateClinicRequest { name?, isActive? }`.
- Create: `packages/shared/src/schemas/clinic.ts` — `createClinicSchema` (`name` trimmed 2-80 chars), `updateClinicSchema` (`name?`, `isActive?`, at least one key).
- Modify: `packages/shared/src/schemas/index.ts`, `types/index.ts`, root `index.ts` — export the new module; add `clinicId: z.coerce.number().int().positive().optional()` to `scheduleQuerySchema`, `statsQuerySchema`, `reportQuerySchema`, `activityQuerySchema`, `unavailabilityQuerySchema`.
- Modify: `packages/shared/src/__tests__/schemas.test.ts` — cases: `clinicId` coerced/rejected (`0`, `-1`, `'abc'`), clinic name bounds, `manager` accepted wherever `Role` is parsed.

**Interfaces (produces):** everything above is additive — no consumer breaks; Tasks 4-14 rely on these names.

- [ ] Implement; run `pnpm --filter @oncall/shared typecheck && pnpm --filter @oncall/shared test -- --run`. Expect PASS.
- [ ] Run `pnpm typecheck` at root (web+api compile against widened `Role` — `AuthUser.clinicId` is additive, no breakage expected).
- [ ] Commit.

### Task 3: Database — fresh multi-clinic baseline + seed

**Files:**
- Modify: `database/schema.sql` per §2.4 verbatim, plus header comment (fresh baseline note, D8).
- Modify: `database/seed.sql`:
  - 3 clinics: Radiology, Cardiology, Neurology (idempotent `ON CONFLICT (name) DO UPDATE`).
  - `superadmin@oncall.local` unchanged (clinic NULL).
  - New `manager@oncall.local`, username `manager`, password `changeme123` (same bcrypt hash pattern as superadmin row), role `manager`, clinic NULL.
  - Per-clinic administrators: `radiology.admin@oncall.local` / username `radiology.admin`, `cardiology.admin@…` / `cardiology.admin`, `neurology.admin@…` / `neurology.admin` (role `administrator`, respective `clinic_id`, password `changeme123`).
  - Existing `dr1`-`dr8`: dr1-dr3 → Radiology, dr4-dr6 → Cardiology, dr7-dr8 → Neurology; set `users.clinic_id` AND `doctors.clinic_id` (both, equal).
  - Existing unavailability seeds unchanged (dr1/dr2 are Radiology).
  - `app_meta` seeds unchanged (D7).
- No changes to `database/scripts/setup-db.ts` / `seed-only.ts` (they apply files).

- [ ] Reset local DB: drop and recreate the database pointed at by `apps/api/.env` `DATABASE_URL` (psql or your GUI; report the commands used).
- [ ] `pnpm db:setup` — expect clean apply, no errors.
- [ ] Verify: `SELECT c.name, count(DISTINCT d.id) AS doctors FROM clinics c LEFT JOIN doctors d ON d.clinic_id = c.id GROUP BY c.name ORDER BY c.name;` → Radiology 3, Cardiology 3, Neurology 2. Verify `SELECT count(*) FROM users WHERE clinic_id IS NULL AND role IN ('superadmin','manager');` → 2. Verify `SELECT count(*) FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.clinic_id <> u.clinic_id;` → 0.
- [ ] Commit.

### Task 4: API scope plumbing — JWT claim, req.user, auth service, scope helper

**Files:**
- Create: `apps/api/src/lib/scope.ts` — `resolveClinicScope` exactly per §2.2.
- Modify: `apps/api/src/lib/jwt.ts` — payload `{ sub, role, clinicId }`; `verifyAccessToken` rejects tokens whose `clinicId` is not `number | null`.
- Modify: `apps/api/src/types/express.d.ts` — `user?: { id: number; role: Role; clinicId: number | null }`.
- Modify: `apps/api/src/middleware/authenticate.ts` — set `req.user = { id: payload.sub, role: payload.role, clinicId: payload.clinicId }` (lock check unchanged, D7).
- Modify: `apps/api/src/services/auth.service.ts` — row selects join `clinics`; `toAuthUser` returns `clinicId`/`clinicName`; `login`/`refresh` sign tokens with the claim; `login` rejects users whose clinic `is_active = FALSE` (403, "Clinic is deactivated", D10) — the check runs after password verification to avoid leaking which accounts exist.
- Modify: `apps/api/src/__tests__/auth.service.test.ts`, `token.service.test.ts` — fixtures gain `clinicId`/`clinicName`; new cases: deactivated-clinic login → 403; token round-trip carries `clinicId`; manager token has `clinicId: null`.
- Modify: `apps/api/src/__tests__/usage.routes.test.ts` — token builder helper now signs the claim (this file signs tokens directly; it must keep compiling).
- Modify: `apps/api/src/services/activity.service.ts` — `recordActivity` input gains `clinicId?: number | null` and writes the column (column exists from Task 3). This lands **before** Tasks 6-9, which pass `clinicId` on their audit calls; the `list` scoping + route changes stay in Task 13.

**Interfaces (produces):** `req.user.clinicId` available to all controllers; `resolveClinicScope(user, requestedClinicId)` for Tasks 5-11.

- [ ] Implement; `pnpm --filter @oncall/api typecheck` → clean.
- [ ] `pnpm --filter @oncall/api test -- --run src/__tests__/auth.service.test.ts src/__tests__/token.service.test.ts src/__tests__/usage.routes.test.ts` → PASS (DB-backed cases need the Task 3 DB).
- [ ] Commit.

### Task 5: Clinics domain (new)

**Files:**
- Create: `apps/api/src/services/clinic.service.ts` — `list()` (all clinics + `doctorCount` = live doctors, `adminCount` = live administrator users), `create({ name })` (409 on duplicate name, case-insensitive compare), `update(id, { name?, isActive? })` (404 unknown; rename 409 dup; deactivate allowed, delete never — D10).
- Create: `apps/api/src/controllers/clinic.controller.ts`, `routes/clinic.routes.ts` — `GET /` `authorize('manager')`; `POST /` `authorize('manager')` + `validate(createClinicSchema)`; `PATCH /:id` `authorize('manager')` + `validate(updateClinicSchema)` (superadmin passes via the blanket rule).
- Modify: `apps/api/src/app.ts` — mount `/clinics`; `apps/api/src/validators/` — re-export clinic schemas (house pattern: validators wrap shared schemas).
- Create: `apps/api/src/__tests__/clinic.routes.test.ts` — supertest + mocked `query` (pattern: `usage.routes.test.ts`): manager CRUD happy path; administrator → 403 on all three; doctor → 403; duplicate name → 409; unknown id → 404; rename + deactivate flows.
- Modify: `apps/api/src/__tests__/helpers/` — create `clinic-fixtures.ts`: `seedTwoClinics()` returning `{ clinicA, clinicB, adminA, adminB, doctorA, doctorB }` IDs for Tasks 6-11 isolation tests (runs against live DB, cleans up after itself; pattern: `stats.service.test.ts` beforeAll/afterAll).

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 6: Users domain — scoping + role/clinic rules

**Files:**
- Modify: `apps/api/src/services/user.service.ts`:
  - All row selects gain `u.clinic_id`, join `clinics` for `clinic_name`.
  - `list(actor, scope)` — one rule for all roles: `WHERE u.clinic_id = $scope.clinicId` and hide manager/superadmin rows from non-superadmin actors (the existing "hide superadmin" filter stays; superadmin also hides manager rows from others). There is **no "all clinics" list mode** — superadmin passes `?clinicId=` like manager (strict §2.2 rule); the vendor's cross-clinic views are `/clinics` and `/usage`.
  - `getById` — object-level: row's clinic ≠ scope → 404; manager additionally cannot read manager/superadmin rows (404).
  - `create(input, actor)` — enforce §2.5 POST rules: administrator actor → role ∈ {administrator, doctor}, `clinicId` forced to actor's; manager actor → role forced `administrator`, payload `clinicId` required and must reference an active clinic (404 otherwise); superadmin → payload rules. All inserts write `clinic_id` (NULL for manager/superadmin rows).
  - `update(id, input, actor)` — same object scoping; forbid clinic reassignment except superadmin (any) / manager (administrator accounts only); if the row is a doctor and clinic changes, update `doctors.clinic_id` in the same transaction; forbid changing a superadmin's role except by superadmin (current behavior preserved).
  - `remove(id, actor)` — same object scoping; manager may remove administrator accounts of any clinic.
- Modify: `apps/api/src/controllers/user.controller.ts` — call `resolveClinicScope` for GET list (`req.query.clinicId`), pass scope to service; create/update/remove pass actor + optional payload clinicId.
- Modify: `apps/api/src/routes/user.routes.ts` — list/get routes: `authorize('administrator', 'manager')`; write routes: `authorize('administrator', 'manager')` (manager writes allowed **only** for administrator accounts — enforced in service; route stays open, service rejects doctor-targeted writes with 403).
- Modify: `apps/api/src/__tests__/user.routes.test.ts`, `user.service.test.ts` — add isolation matrix (see §5). Existing cases updated for clinic fixtures.

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 7: Doctors domain — clinic anchor

**Files:**
- Modify: `apps/api/src/services/doctor.service.ts` — `SELECT` gains `d.clinic_id` + clinic name join; `list(scope)` / `getById(scope)` scoped (404 cross-clinic); `create` sets `doctors.clinic_id` AND `users.clinic_id` to the scope clinic in one transaction (scope from `resolveClinicScope` — superadmin passes `?clinicId=`, never a payload field); `update`/`remove` object-scoped. `getByUserId` unchanged (self path).
- Modify: `apps/api/src/controllers/doctor.controller.ts`, `routes/doctor.routes.ts` — GET list/get: `authorize('administrator', 'manager')`; writes: `authorize('administrator')` (manager excluded per D5); scope from `resolveClinicScope`.
- Modify: `apps/api/src/__tests__` doctor test file(s) — isolation matrix + **the equality invariant test**: create a doctor via the service, assert `doctors.clinic_id = users.clinic_id`; move-user-clinic via superadmin updates both.

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 8: Unavailability — clinic filtering

**Files:**
- Modify: `apps/api/src/services/unavailability.service.ts` — admin `list` filters via `JOIN doctors d ON d.id = x.doctor_id WHERE d.clinic_id = $scope`; `create` (admin path) takes its scope from `resolveClinicScope` (superadmin via `?clinicId=`) and 404s if the target doctor's clinic ≠ scope; `update`/`remove`: administrator actor → record's doctor must be in scope clinic (404); doctor actor → own record (existing behavior); manager actor → 403 in the service (routes stay authenticate-only, see below).
- Modify: `apps/api/src/controllers/unavailability.controller.ts`, `routes/unavailability.routes.ts` — GET `/` : `authorize('administrator', 'manager')`; POST `/`, PATCH/DELETE `/:id` : `authorize('administrator')` on the admin paths (note: PATCH/DELETE currently rely on service-level ownership checks for doctors — keep that, add the clinic check in service; route-level `authorize('administrator')` would break doctor self-service, so leave those two routes as authenticate-only with service checks, and add an explicit manager 403 check in the service).
- Modify: unavailability tests — cross-clinic create/update/delete → 404; doctor self paths unchanged; manager read works with `clinicId`, write 403.

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 9: Schedules & duties — the core scoping (kill all four §2.6 patterns)

**Files:**
- Modify: `apps/api/src/services/schedule.service.ts`:
  - `buildContext(year, month, clinicId)` — doctor pool `AND u.clinic_id = $clinic`; unavailability map via doctor's clinic; adjacency seeds (`priorDayDoctorIds` + the `nextDate(last)` query at line 215) via the JOIN in §2.6.1.
  - `generate(year, month, actor, scope)` — existence pre-check `WHERE year/month/clinic_id`; INSERT carries `clinic_id`; `recordGeneration` call passes clinicId (signature change made **in this task**: `recordGeneration(client, clinicId, year, month, doctorIds)` writes `clinic_id` and its disjoint-regeneration prev-batch comparison partitions by `(clinic_id, year, month)` — Task 12 then only touches the `generations()` listing and alert detail).
  - `list(filters, actor, scope)` — clinic predicate; doctor role forced own clinic.
  - `getById`, `getScheduleDuties`, `remove`, `publish`, `unpublish`, `addDuty` — fetch schedule, 404 if `s.clinic_id ≠ scope.clinicId`; `addDuty` additionally 404s if the target doctor's clinic ≠ schedule's clinic.
  - `validateAssignment` — neighbor check (622-624) via the §2.6.1 JOIN; per-schedule counts already clinic-safe once the schedule itself is scope-checked.
  - `monthCaps` — grouped per clinic.
  - All `recordActivity` calls include `clinicId` of the schedule's clinic (the optional `clinicId` input field already exists from Task 4).
- Modify: `apps/api/src/controllers/schedule.controller.ts`, `routes/schedule.routes.ts` — read routes `authorize('administrator', 'doctor', 'manager')` (manager read-only); write routes unchanged `authorize('administrator')`; scope via `resolveClinicScope` for list, **preview, and generate** (all three read `req.query.clinicId`; superadmin without it → 400).
- Modify/extend: `apps/api/src/__tests__/schedule*.test.ts` — new cases (see §5): two clinics generate the same month (both succeed — regression for the dropped global UNIQUE); cross-clinic adjacency independence; cross-clinic `getById`/`addDuty`/`publish` → 404; manager write attempts → 403; preview scoped to clinic pool.

**Interfaces:** `schedule.service` exported functions that took `(…)` now take a trailing/`scope` param — controllers are the only callers (verify with `lsp references` before changing signatures).

- [ ] Implement; `pnpm --filter @oncall/api typecheck` (expect fallout in stats/reports/usage tests referencing old signatures — fix compile errors minimally; their behavioral updates are Tasks 10-12).
- [ ] Targeted schedule tests → PASS.
- [ ] Commit.

### Task 10: Stats — admin per clinic, me per doctor's clinic

**Files:**
- Modify: `apps/api/src/services/stats.service.ts` — `adminStats(year, month, scope)`: schedule lookup `WHERE year AND month AND clinic_id`; workload/active/inactive doctor queries filtered to clinic; `meStats(userId)`: resolve doctor → clinic; "published this month" check (181-183), upcoming duties (196-206), and who's-on-call (206+) queries all filter `s.clinic_id = doctor's clinic`.
- Modify: `apps/api/src/controllers/stats.controller.ts`, `routes/stats.routes.ts` — `/admin` : `authorize('administrator', 'manager')`, scope via query; `/me` unchanged.
- Modify: `apps/api/src/__tests__/stats.*.test.ts` — clinic fixtures; manager with `clinicId` sees that clinic's numbers only.

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 11: Reports — pass-through scope

**Files:**
- Modify: `apps/api/src/services/reports.service.ts` — accepts scope, delegates to the scoped schedule/duty reads (it is a thin aggregator over `schedule.service`); response header data gains `clinicName` (from the schedule summary).
- Modify: `apps/api/src/controllers/reports.controller.ts`, `routes/reports.routes.ts` — `authorize('administrator', 'manager')`, scope via query.
- Modify: reports tests — manager happy path + cross-clinic 404.

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 12: Usage metering — per-clinic partitioning

**Files:**
- Modify: `apps/api/src/services/usage.service.ts` — `generations()` groups by `(clinic_id, year, month, created_at)` and joins clinic name; alert `detail` gains `clinicId`, `clinicName`. (`recordGeneration`'s signature + clinic partitioning already landed in Task 9 — do not duplicate it here.)
- Modify: `apps/api/src/__tests__/usage.service.test.ts` — the decisive case: clinic A and clinic B each generate the same month with disjoint doctor sets → **no** alert; within one clinic, disjoint regeneration → alert (existing behavior).

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 13: Activity log — clinic column

**Files:**
- Modify: `apps/api/src/services/activity.service.ts` — `list` gains scope filter (`activity_log.clinic_id = $`); `recordActivity` already accepts `clinicId` since Task 4. Also `apps/api/src/routes/billing.routes.ts` — `GET /billing/payment-alert` becomes `authorize('administrator', 'manager')` (hospital-wide value; doctors stay 403 as today).
- Modify: `apps/api/src/routes/activity.routes.ts`, controller — `authorize('administrator', 'manager')`, scope via query.
- Modify: activity tests — entries carry clinic; admin sees own clinic only; manager drills down.

- [ ] Implement; typecheck + targeted tests → PASS.
- [ ] Commit.

### Task 14: Web — auth surface, guard, manager pages, clinic selector

**Files:**
- Modify: `apps/web/src/stores/auth.ts` — user carries `clinicId`/`clinicName`; no flow changes.
- Modify: `apps/web/src/lib/http.ts` — nothing structural; services append `clinicId` query param where the manager view needs it.
- Create: `apps/web/src/services/clinics.ts` — `list()`, `create()`, `update()`.
- Modify: `apps/web/src/services/{schedule,stats,reports,activity,user,doctor,unavailability}.ts` — optional `clinicId` param on read functions (append to query string when present).
- Modify: `apps/web/src/router/guard.ts` — unchanged logic (`manager` never passes via the superadmin blanket); `apps/web/src/router/index.ts` — role metas per §2.5: manager added to home-stats, schedules list/detail, roster, reports, activity, users, doctors, usage excluded; new `/clinics` route `meta: { roles: ['manager'] }`.
- Create: `apps/web/src/components/layout/ClinicSelector.vue` — dropdown fed by `services/clinics.list()`; emits selection; visible only to `manager` on drill-down pages (persist selection in a Pinia store or route query — pick route query `?clinic=` so links are shareable and back-button works).
- Create: `apps/web/src/pages/ClinicsPage.vue` — table of clinics (name, active badge, doctor count, admin count); create-clinic dialog; rename; deactivate with `useConfirm`; per-clinic administrator management (list administrator users of the selected clinic; create administrator `{ firstName, lastName, email, username, password }`; deactivate/reactivate) via the scoped `/users` endpoints.
- Modify: `apps/web/src/pages/HomePage.vue` + `components/dashboard/AdminDashboard.vue` — manager variant: `ClinicSelector` + existing admin dashboard fed with the selected clinic's `?clinicId=`.
- Modify: `SchedulesPage.vue`, `ScheduleDetailPage.vue`, `ScheduleRosterPage.vue`, `ReportsPage.vue`, `UsersPage.vue`, `MyAvailabilityPage.vue` (admin unavailability list lives here or its sibling — verify during implementation), activity page — manager mode: selector + read-only (hide generate/publish/add/edit controls when role is manager; `UsersPage` hides create/edit for manager).
- Modify: `apps/web/src/components/layout/AppHeader.vue` — clinic chip next to "Hospital Scheduling" (administrator/doctor: their clinic name; manager: selected clinic or "All clinics"; superadmin: nothing new).
- Modify: `apps/web/src/pages/UsagePage.vue` — generations table gains Clinic column.
- Modify: `apps/web/src/pages/ReportsPage.vue` — report header shows clinic name; CSV filename `oncall-{clinicName}-{year}-{month}.csv` (slugified).
- Update/add page tests (`__tests__/`): `ClinicsPage.test.ts` (render/create/rename/deactivate/confirm flows), guard test update (manager allowed on drill-down routes, blocked on preview/generate routes), `HomePage`/`SchedulesPage` manager-mode tests (selector present, edit controls hidden), `UsagePage` clinic column.

**Acceptance (visual, not just tests):** run `pnpm dev`, and with the seeded DB capture: (1) `radiology.admin` login → header shows "Radiology", schedules/users/doctors show only Radiology rows; (2) `manager` login → `/clinics` management works, drill-down to each clinic shows its own stats and rosters, no edit buttons anywhere; (3) `superadmin` → usage shows clinic names. Report what was verified per persona.

- [ ] Implement; `pnpm --filter @oncall/web typecheck && pnpm --filter @oncall/web test -- --run` → PASS.
- [ ] Manual persona walkthrough (above) — report observations.
- [ ] Commit.

### Task 15: Final gates + docs

**Files:**
- Modify: `README.md` — remove "Multi-hospital is out of scope"; describe the clinic model, manager role, and fresh-start schema note.
- Modify: `AGENTS.md` — Domain Rules: add clinics table to the table list; roles list gains Manager (hospital read-only + clinic/admin lifecycle) and clarifies superadmin = vendor audit; Auth section role list updated.
- Modify: `docs/admin-manual/manual.html` — add a "Clinics and the Manager role" section (concept, clinic lifecycle, administrator management, drill-down) and update screenshots-dependent text minimally (text-only addition acceptable).
- [ ] `pnpm db:setup` (re-run idempotency on the populated DB — must be a clean no-op pass).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` at root — all pass (live-DB-dependent API tests included). Report verbatim outcomes.
- [ ] Commit.

---

## 5. Cross-tenant isolation test matrix (the safety net — Tasks 5-13 must cover every row)

Fixture: `seedTwoClinics()` (clinic A + clinic B, each with an administrator, a doctor, and where needed a draft schedule).

| # | Actor | Action | Expected |
|---|---|---|---|
| I1 | admin A | `GET /users?clinicId=B` | 403 |
| I2 | admin A | `GET /users/:idOfBUser` | 404 |
| I3 | admin A | `POST /users {role: doctor, clinicId: B}` | created in A (payload clinic ignored) — 201, row's clinic = A |
| I4 | admin A | `GET /doctors` | only A's doctors |
| I5 | admin A | `POST /doctors` (defaults) | doctor created with clinic A; `doctors.clinic_id = users.clinic_id` |
| I6 | admin A | `GET /schedules?clinicId=B` | 403 |
| I7 | admin A | `GET /schedules/:idOfB` | 404 |
| I8 | admin A | `POST /schedules` for a month where B already has a schedule | 201 — per-clinic uniqueness holds |
| I9 | admin A | `POST /schedules/:idOfA/duties {doctorId: doctorB}` | 404 |
| I10 | admin A | `POST /schedules/:idOfB/publish` | 404 |
| I11 | doctor A on duty date D (clinic A), doctor B free on D+1 | generate month for B | D+1 assignment for doctor B is **not** blocked by A's D duty (adjacency independence) |
| I12 | admin A | `GET /unavailability` | only A-clinic records |
| I13 | admin A | `POST /unavailability {doctorId: doctorB}` | 404 |
| I14 | manager | any write on `/schedules/*`, `/duties/*`, `/doctors`, `/unavailability/*` | 403 |
| I15 | manager | `GET /stats/admin` without `clinicId` | 400 |
| I16 | manager | `GET /stats/admin?clinicId=A` | A's numbers; workload lists only A's doctors |
| I17 | manager | `POST /users {role: doctor}` | 403 (service rejects) |
| I18 | manager | `POST /users {role: administrator, clinicId: A}` | 201 |
| I19 | doctor | `GET /schedules` | own clinic's schedules only |
| I20 | doctor A | `GET /stats/me` | on-call list shows only clinic A duties |
| I21 | admin of deactivated clinic | `POST /auth/login` | 403 "Clinic is deactivated" |
| I22 | A and B both generate the same month, disjoint pools | `GET /usage/generations` (superadmin) | two entries, distinct clinics, **no** disjoint_regeneration alert |
| I23 | admin A | `GET /activity` | only rows with `clinic_id = A` |
| I24 | admin A | `PATCH /users/:idOfBUser` / `DELETE` | 404 |
| I25 | superadmin | `POST /schedules` or `/schedules/preview` without `?clinicId=` | 400 |

---

## 6. What deliberately does NOT change

- Scheduling engine (`src/scheduling/*`), domain rules (07:00–15:00, overnight handoff, caps, back-to-back, weekend balance, fairness, two doctors/day).
- Refresh-token machinery, rate limiting, envelope, error handler, helmet/cors/cookie config.
- Billing subsystem (per hospital, D7) — only change: `payment-alert` route admits `manager` (Task 13); lock mechanics untouched.
- `docker-compose.yml`, nginx, env vars (no new env keys).
- Login page UX, dark mode, CSV export mechanics, published-lock semantics (409).

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Missed clinic predicate → silent cross-clinic data leak | Single choke point (`resolveClinicScope`), §2.6 enumerates the four known global-pool patterns, §5 matrix must be fully implemented and green before Task 15 |
| `users.clinic_id` / `doctors.clinic_id` drift | DB CHECK pins role↔nullability on users; single write path; equality invariant test (Task 7); re-verified in Task 3 seed check |
| Old dev DBs half-upgraded (fresh baseline, D8) | Task 3 mandates drop/recreate; schema header states out-of-contract for old DBs |
| JWT change logs everyone out | Accepted (fresh start); `verifyAccessToken` rejects claim-less tokens explicitly |
| Manager accidentally granted write via blanket superadmin rule | `authorize` blanket rule untouched (superadmin only); manager added per-route only; I14 pins it |
| Test suite relies on single-tenant fixtures | `clinic-fixtures.ts` helper centralizes two-clinic setup for all isolation tests |

---

**Final report requirement:** implementers report actual command outcomes verbatim per gate. If any gate fails, stop and report — do not claim success without output.
