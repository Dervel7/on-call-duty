# Phase 5 — Scheduling Engine Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 5 of 8 (Scheduling Engine)
**Status:** Approved (2026-08-07)
**Scope owner:** backend `apps/api`, shared `packages/shared`, `database/`
**Builds on:** Phase 4 — Availability Management (complete)

---

## 1. Purpose

Phase 5 delivers the **scheduling engine**: the system that turns the doctor profiles (`doctors.max_monthly_duties`), the Phase 4 unavailability exclusions, and a new admin-managed `holidays` table into a fair, constraint-respecting on-call duty roster for a calendar month.

This phase is **backend-only**. It adds the algorithm, the persistence model (`schedules` + `duties` + `holidays`), the `holidays` admin CRUD, and a REST surface for previewing, generating, reading, deleting, and manually overriding schedules. No Vue UI ships here — the Schedule Management UI is Phase 6.

The engine must (per `AGENTS.md`): respect hard constraints, minimize imbalance, produce explainable assignments, and detect conflicts **before** schedule creation.

The full system is decomposed into eight phases. This phase delivers item 5 of 8.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Scope | Backend-only. Engine + persistence + `holidays` CRUD + REST. UI deferred to Phase 6 |
| Algorithm | Greedy day-by-day assignment with a weighted score. Hard constraints filter first; soft balance goals score; deterministic tie-breaks. No solver/ILP dependency |
| Engine placement | Pure module `apps/api/src/scheduling/` — no `db/` or Express imports. `schedule.service.ts` assembles a context (DB), calls `generate()` (pure), persists. Exhaustively unit-testable with plain fixtures |
| Period unit | One calendar month (`year` + `month`). Engine fills the 1st through the last day |
| Storage | `schedules` (one row per month, `UNIQUE(year, month)`) wrapping many `duties` (one row per day, `UNIQUE(schedule_id, duty_date)`). `status draft\|published`; Phase 5 always creates `draft` and ships **no** publish endpoint |
| Regeneration | Reject if a schedule already exists for the month → `409`; admin deletes it first. No auto-replace, no versioning |
| Conflicts | `POST /schedules/preview` runs the engine without persisting and returns `{ assignments, conflicts }` as a **200**. `POST /schedules` persists only when `conflicts` is empty; otherwise `422` and nothing is written (atomic). Structured detail lives in the preview 200 — the `{success, error}` envelope is unchanged |
| Manual overrides | Admin can `POST /schedules/:id/duties` (add), `PATCH /duties/:id` (reassign), `DELETE /duties/:id` (remove). All re-validate hard constraints via a shared `validateAssignment` helper |
| Removal model | A removed duty is a deleted row — the day simply has no duty (an intentional gap). `doctor_id` is `NOT NULL` (atomic generation fills every day) |
| Holidays | New admin-managed `holidays` table (`name`, `date`, `UNIQUE(date)`). Holiday count is a soft balance goal. Seeded with sample rows for the sample month |
| Explainability | Each `duties` row stores a `reason TEXT` capturing why the engine chose that doctor (score breakdown + tie-break). Manual overrides store `manual override by admin #{userId}` |
| Cross-month back-to-back | Real rule. `buildContext` preloads the duty from the day before the month starts so day 1 respects the previous month's last day |
| Doctor deletion | `duties.doctor_id … ON DELETE RESTRICT`; `doctor.service.remove` returns `409` when duties exist (disable instead). Protects historical schedule integrity |

## 3. Architecture & Layering

Phase 5 reuses the Phase 2–4 layering (Controllers → Services → Database) and the Phase 3 `withTransaction` primitive. The core addition is a **pure engine module** (Approach A) that isolates business logic from I/O — the algorithm imports only types and pure math.

```
apps/api/src/
├── scheduling/                          # NEW — pure engine (no db/express imports)
│   ├── types.ts                         # SchedulingContext, CandidateScore, AssignmentPlan, ConflictPlan
│   ├── constraints.ts                   # hard-constraint predicates (return { ok, reason })
│   ├── scoring.ts                       # scoreCandidate() soft rubric + budgets
│   ├── engine.ts                        # generate(context) -> { assignments, conflicts }
│   └── __tests__/*.test.ts              # pure unit tests (no mocks)
├── services/
│   ├── schedule.service.ts              # NEW — buildContext (DB), preview, generate+persist, list/get/delete,
│   │                                    #       addDuty/reassignDuty/removeDuty, validateAssignment
│   └── holiday.service.ts               # NEW — list/create/update/remove (+ overlap-style date filter)
├── controllers/
│   ├── schedule.controller.ts           # NEW — thin
│   └── holiday.controller.ts            # NEW — thin
├── routes/
│   ├── schedule.routes.ts               # NEW — /schedules/* (admin) + /schedules/:id/duties
│   └── holiday.routes.ts                # NEW — /holidays/*
├── validators/
│   ├── schedule.ts                      # NEW — re-export shared schemas + idParams
│   └── holiday.ts                       # NEW — re-export shared schemas + idParams
└── app.ts                               # +app.use('/holidays', …); app.use('/schedules', …)
```

The existing `doctor.service.remove` is retrofitted (§8) to honour the new `RESTRICT` FK.

### 3.1 Route table — `/holidays`

Mounted at `/holidays`. Every route runs `authenticate`. Mutations add `authorize('administrator')`.

| Method | Path | Auth | Body / Query | Response |
|---|---|---|---|---|
| GET | `/holidays` | any authed | query `?from=&to=` (optional; holidays are single dates, so the filter is an inclusive window `date >= $from AND date <= $to`) | 200 `{ holidays }` |
| POST | `/holidays` | admin | `createHolidaySchema` body | 201 `{ holiday }` (409 dup date) |
| PATCH | `/holidays/:id` | admin | `updateHolidaySchema` partial body | 200 `{ holiday }` (409 dup date) |
| DELETE | `/holidays/:id` | admin | — | 204 |

### 3.2 Route table — `/schedules` (all admin-only)

Every route runs `authenticate` + `authorize('administrator')`. `/schedules/preview` is registered **before** `/schedules/:id` so the literal `preview` is not captured by the numeric `:id` validator (same ordering rule Phase 4 used for `/me`).

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/schedules` | query `?year=&month=` (optional) | 200 `{ schedules }` (summaries) |
| GET | `/schedules/:id` | — | 200 `{ schedule, duties }` |
| POST | `/schedules/preview` | `createScheduleSchema` body `{ year, month }` | 200 `{ assignments, conflicts }` (dry-run, **not** persisted) |
| POST | `/schedules` | `createScheduleSchema` body `{ year, month }` | 201 `{ schedule, duties }` · 409 exists · 422 unfillable |
| DELETE | `/schedules/:id` | — | 204 |

### 3.3 Route table — duties (override, admin-only)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/schedules/:id/duties` | `createDutySchema` `{ date, doctorId }` | 201 `{ duty }` (409 if a duty already exists for that date, or constraint violation) |
| PATCH | `/duties/:id` | `reassignDutySchema` `{ doctorId }` | 200 `{ duty }` (409 constraint violation) |
| DELETE | `/duties/:id` | — | 204 |

**Status mapping (all routes):** 200/201/204 success · 400 validation (bad `:id`, out-of-range `month`, duty `date` outside the schedule's month, zod failures) · 401 unauth · 403 non-admin · 404 (schedule/duty/holiday/doctor not found) · 409 (schedule already exists, holiday date dup, duty date already filled, override constraint violation, doctor-delete blocked) · 422 (generate unfillable) · 500 server error. All responses use the standard envelope; structured conflict detail appears **only** in the preview `200` body.

## 4. Database Schema

Appended to `database/schema.sql` (idempotent, `CREATE TABLE IF NOT EXISTS`). No triggers/functions — preserves the `;`-splitting DB runner.

```sql
-- Phase 5: Scheduling Engine

CREATE TABLE IF NOT EXISTS holidays (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL,
  date       DATE NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedules (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS duties (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES schedules (id) ON DELETE CASCADE,
  duty_date   DATE NOT NULL,
  doctor_id   INTEGER NOT NULL REFERENCES doctors (id) ON DELETE RESTRICT,
  is_weekend  BOOLEAN NOT NULL,
  is_holiday  BOOLEAN NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, duty_date)
);
CREATE INDEX IF NOT EXISTS idx_duties_schedule ON duties (schedule_id);
CREATE INDEX IF NOT EXISTS idx_duties_doctor_date ON duties (doctor_id, duty_date);
CREATE INDEX IF NOT EXISTS idx_duties_date ON duties (duty_date);
```

Design points:
- `holidays.date` `UNIQUE` serves both correctness and as the lookup index. Phase 4's DATE type parser (`db/client.ts`, OID 1082 → `'YYYY-MM-DD'` string) already covers all three new `DATE` columns.
- `schedules.UNIQUE(year, month)` is the DB backstop for "reject if exists"; the service does an explicit `SELECT … WHERE year/month` existence check for a friendly `409` and keeps the codebase's no-PG-error-code-reliance style.
- `schedules.created_by` is nullable + `ON DELETE SET NULL` so deleting an admin preserves the schedule (audit reference, not ownership).
- `duties.UNIQUE(schedule_id, duty_date)` ⇒ at most one duty per day. `doctor_id` is `NOT NULL` — atomic generation fills every day; a manual removal deletes the row (the day becomes an intentional gap).
- `duties.doctor_id … ON DELETE RESTRICT` protects historical schedules: a doctor who has duties cannot be hard-deleted (`doctor.service.remove` returns `409`; disable instead). See §8.
- `is_weekend` / `is_holiday` are denormalized at generation/write time from the date + the `holidays` table, so list/preview never recompute.
- Indexes: `(schedule_id)` for the `GET /schedules/:id` join; `(doctor_id, duty_date)` for cap counting and back-to-back neighbour lookups; `(duty_date)` for the cross-schedule prior-day preload and date-range queries.

### 4.1 Seed (`database/seed.sql`)

Sample holidays in the fixed sample month (2026-09), idempotent via `WHERE NOT EXISTS`. **No schedule seed** — schedules are produced on demand via the API (seed.sql cannot run the TS engine, and a hand-crafted schedule would have to stay consistent with the seeded unavailability). One sample entry:

```sql
-- Phase 5: seed sample holidays (fixed sample month 2026-09)
INSERT INTO holidays (name, date)
SELECT 'Sample Holiday', '2026-09-01'
WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE date = '2026-09-01');
```

## 5. Scheduling Engine (pure module)

`apps/api/src/scheduling/` imports **only** types and pure math — never `db/client`, never Express. `schedule.service.ts` owns all I/O: it calls `buildContext()` (DB reads) to produce a `SchedulingContext`, passes it to `generate()` (pure), then persists.

### 5.1 `types.ts`

```ts
export interface DoctorSpec {
  id: number
  firstName: string
  lastName: string
  maxMonthlyDuties: number
  isActive: boolean
}

export interface DaySpec {
  date: string                 // 'YYYY-MM-DD'
  isWeekend: boolean
  isHoliday: boolean
}

export interface SchedulingContext {
  year: number
  month: number
  days: DaySpec[]              // 1st .. last day of the month
  doctors: DoctorSpec[]        // active doctors only (caller filters)
  unavailability: Map<number, Array<{ start: string; end: string }>> // doctorId -> ranges
  priorDayDoctorIds: Set<number> // doctors on duty the day before the month starts (cross-month)
}

export interface CandidateScore {
  score: number
  workload: number
  weekend: number
  holiday: number
}

export interface AssignmentPlan {
  date: string
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  isHoliday: boolean
  reason: string
}

export interface ConflictPlan {
  date: string
  detail: string               // aggregate elimination breakdown
}

export interface GenerateResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
}
```

### 5.2 `constraints.ts` — hard constraints (filter, never relax)

A doctor is **eligible** for a day only if all pass. Each predicate returns `{ ok: boolean; reason: string }` so conflicts and override 409s can quote the cause.

- **Active & profile** — `doctor.isActive` (the caller loads only active doctors, so this is structural).
- **Available** — no `unavailability` range for that doctor covers the date: `start <= date && date <= end` (inclusive, lexicographic on `'YYYY-MM-DD'`).
- **Under cap** — `dutiesThisMonth(doctor) < doctor.maxMonthlyDuties`.
- **No back-to-back** — the doctor is not on duty the previous day. During generation the previous day is the running assignment for `date - 1`; for day 1 it is `context.priorDayDoctorIds`. Override re-validation checks both neighbours (`date - 1`, `date + 1`) from the stored schedule plus the cross-month prior-day set.

When a day has zero eligible doctors, `generate` records a `ConflictPlan` with an aggregate `detail` computed by tallying elimination reasons across all active doctors (e.g. `"5 doctors: 2 unavailable, 2 at cap, 1 back-to-back"`).

### 5.3 `scoring.ts` — soft rubric

Maximize; higher = preferred. Weights are named constants pinned by deterministic unit tests:

```ts
export const W_WORKLOAD = 3 // per remaining monthly slot
export const W_WEEKEND  = 4 // per remaining weekend slot (weekend days only)
export const W_HOLIDAY  = 4 // per remaining holiday slot (holiday days only)
```

```
score += (doctor.maxMonthlyDuties - dutiesThisMonth)              * W_WORKLOAD
if day.isWeekend: score += max(0, WEEKEND_BUDGET - weekendDuties) * W_WEEKEND
if day.isHoliday: score += max(0, HOLIDAY_BUDGET - holidayDuties) * W_HOLIDAY
```

`WEEKEND_BUDGET = ceil(weekendDaysInMonth / activeDoctorCount)`; `HOLIDAY_BUDGET = ceil(holidayDaysInMonth / activeDoctorCount)` (0 when no such days). Budgets make the balance term symmetric around fair share so an under-served doctor scores strictly higher. If `activeDoctorCount === 0`, both budgets are 0 and every day falls through to a conflict (§5.4) — no division-by-zero.

### 5.4 `engine.ts` — `generate(context)`

Deterministic orchestrator:
1. Iterate `context.days` in order (1st → last). Maintain running per-doctor counters: `dutiesThisMonth`, `weekendDuties`, `holidayDuties`, plus a map `date -> doctorId` of assignments made so far.
2. For each day: filter eligible doctors (§5.2); if none, push a `ConflictPlan` and continue.
3. Score each eligible doctor (§5.3); pick the winner by the deterministic tie-break.
4. Record the `AssignmentPlan`, increment the winner's counters, store the day's assignment.
5. Return `{ assignments, conflicts }`.

**Deterministic tie-break (in order):** highest `score` → fewest `dutiesThisMonth` → fewest `weekendDuties` → lower `doctorId`. Fully reproducible — the same context always yields the same roster.

**`reason` string** (persisted per duty): `"score N (workload +A, weekend +B, holiday +C); tie-break: <which tie-break won>"`. Captures the dominant factors without per-doctor noise. Manual overrides store `"manual override by admin #{userId}"` (written by the service, not the engine).

### 5.5 `buildContext` (in `schedule.service.ts`)

Loads, then hands a pure `SchedulingContext` to `generate`:
- Active doctors (`JOIN users … WHERE is_active = TRUE`).
- The month's day list with `isWeekend` (Sat/Sun) and `isHoliday` (membership in the `holidays` table for that month).
- Each active doctor's `unavailability` ranges.
- `priorDayDoctorIds`: `SELECT doctor_id FROM duties WHERE duty_date = $firstDayMinusOne` (across any schedule) → `Set<number>`.

## 6. Backend API surface (`apps/api`)

### 6.1 New dependencies

None. `pg`, `zod`, `withTransaction`, and the shared schemas are already present.

### 6.2 `holiday.service.ts`

Row mapping is `holidays` → `Holiday` (camelCase). The DATE columns arrive as strings via the Phase 4 parser.

- **`list({ from?, to? }): Promise<Holiday[]>`** — optional inclusive `date >= $from AND date <= $to` window. `ORDER BY date`.
- **`create({ name, date }): Promise<Holiday>`** — existence check `SELECT 1 FROM holidays WHERE date = $1` → if exists `409 'Holiday already exists on this date'`; else `INSERT … RETURNING id`; return via `getById`. (No `FOR UPDATE` — there is no parent row to lock; the `UNIQUE(date)` constraint is the DB backstop, same no-error-code-reliance style as schedules.)
- **`update(id, { name?, date? }): Promise<Holiday>`** — load (404); if `date` present, dup-check excluding self (`409`); dynamic `UPDATE`.
- **`remove(id): Promise<void>`** — load (404); `DELETE`.
- **`getById(id)`** — `404 'Holiday not found'` if absent.

### 6.3 `schedule.service.ts`

Consumes `scheduling/*` (pure) + `db/client` (I/O).

- **`buildContext(year, month): Promise<SchedulingContext>`** — §5.5.
- **`preview(year, month): Promise<PreviewResult>`** — `buildContext` → `generate`; map plans to DTOs (doctor names already in context). Returns `{ assignments, conflicts }`.
- **`generate(year, month, actor): Promise<ScheduleDetail>`** — explicit existence check `SELECT 1 FROM schedules WHERE year=$1 AND month=$2` → `409 'Schedule already exists for this month; delete it first'`. `buildContext` → `generate`; if `conflicts.length > 0` → `422 'Schedule has N unfillable day(s); run /schedules/preview for details'` (nothing persisted). Else `withTransaction`: `INSERT INTO schedules (year, month, status, created_by) VALUES ($1,$2,'draft',$3) RETURNING id`; bulk-insert duties (one row per assignment with computed `is_weekend`/`is_holiday`/`reason`); return `getById(id)`.
- **`list({ year?, month? }): Promise<ScheduleSummary[]>`** — dynamic `WHERE`; `ORDER BY year DESC, month DESC`.
- **`getById(id): Promise<ScheduleDetail>`** — schedule row (404) + duties joined to `doctors`/`users` for names.
- **`remove(id): Promise<void>`** — schedule (404); `DELETE` (cascades duties).
- **`validateAssignment(doctorId, date, scheduleDuties, context): { ok: boolean; reason: string }`** — composes `scheduling/constraints` against the stored schedule's neighbour duties (incl. cross-month prior day) and the doctor's cap/availability. Reused by `addDuty` and `reassignDuty`.
- **`addDuty(scheduleId, { date, doctorId }, actor): Promise<Duty>`** — load schedule (404); reject `date` outside the schedule's month (400); reject if a duty exists for `(schedule_id, duty_date)` → `409 'Duty already exists for this date; use PATCH to reassign'`; `validateAssignment` → 409 `'Constraint violation: <reason>'` on failure; compute `is_weekend`/`is_holiday`; `reason = 'manual override by admin #{actor.id}'`; `INSERT … RETURNING id`; return joined duty.
- **`reassignDuty(dutyId, { doctorId }, actor): Promise<Duty>`** — load duty (404); `validateAssignment` for the new doctor on that date excluding self → 409 on violation; `UPDATE doctor_id, reason …`; return joined duty.
- **`removeDuty(dutyId): Promise<void>`** — load duty (404); `DELETE`.

`actor` is `req.user` (`{ id, role }`); all schedule/duty routes are admin-only so `actor.id` is always the admin's id used for audit. Client-provided `doctorId`/`date` are validated by zod and re-checked by `validateAssignment`; they are never trusted past validation.

### 6.4 Controllers, middleware, validators, wiring

Thin controllers (`try { … } catch (err) { next(err) }`, same shape as `unavailability.controller.ts`). No new middleware. `validators/schedule.ts` and `validators/holiday.ts` re-export the shared schemas plus the existing `idParams` (from `validators/user.ts`); `validators/index.ts` re-exports both. `app.ts` mounts `/holidays` and `/schedules` after `/unavailability`.

## 7. Shared Types & Schemas (`@oncall/shared`)

`@oncall/shared` is the single source of truth for the Phase 5 contract — types **and** zod schemas.

```
packages/shared/src/
├── types/schedule.ts            # NEW
├── types/index.ts               # +re-export
├── schemas/schedule.ts          # NEW
└── schemas/index.ts             # +re-export
```

**`types/schedule.ts`** — see §5.1 plans plus the DTOs: `Holiday`, `ScheduleStatus`, `ScheduleSummary`, `Duty`, `AssignmentPlan`, `ConflictPlan`, `PreviewResult`, `ScheduleDetail`, `CreateScheduleRequest`, `ScheduleQuery`, `HolidayQuery`, `CreateHolidayRequest`, `UpdateHolidayRequest`, `CreateDutyRequest`, `ReassignDutyRequest`.

**`schemas/schedule.ts`** — `dateStr` defined locally (same precedent as Phase 4's `schemas/unavailability.ts`, avoiding cross-phase churn):

```ts
import { z } from 'zod'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')
const yearMonth = {
  year: z.number().int().min(1970).max(2100),
  month: z.number().int().min(1).max(12),
}

export const createScheduleSchema = z.object(yearMonth)
export const scheduleQuerySchema = z.object({
  year:  z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
export const holidayQuerySchema = z.object({ from: dateStr.optional(), to: dateStr.optional() })
export const createHolidaySchema = z.object({ name: z.string().min(1).max(200), date: dateStr })
export const updateHolidaySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  date: dateStr.optional(),
})
export const createDutySchema = z.object({ date: dateStr, doctorId: z.number().int().positive() })
export const reassignDutySchema = z.object({ doctorId: z.number().int().positive() })
```

`createScheduleSchema` doubles as the preview body. Query schemas coerce strings (Express query params are always strings). Lexicographic comparison of `'YYYY-MM-DD'` strings is equivalent to date comparison.

## 8. Security & Testing

### 8.1 Security / integrity
- RBAC: every `/schedules` and duties route is `authenticate + authorize('administrator')` (doctors → 403). `/holidays` GET is any-authed; `/holidays` mutations and all duty overrides are admin-only. `created_by` is derived from `req.user.id`, never the body. Override `reason` embeds the admin's userId for audit. Parameterized queries only; no ORM; no PG-error-code reliance (explicit existence checks).
- **Doctor-deletion integrity (required cross-phase retrofit):** `duties.doctor_id … ON DELETE RESTRICT`. Hard-deleting a doctor with duties would otherwise destroy historical schedule rows — unacceptable for a healthcare-grade audit trail. `doctor.service.remove` gains a pre-check `SELECT 1 FROM duties WHERE doctor_id = $1` → `409 'Cannot delete a doctor with scheduled duties; set them inactive instead'`. Disabling (`isActive = false`) is unaffected and remains the recommended lifecycle. This is a Phase 5 owned follow-up (same form as Phase 4's carried-over follow-ups).
- `schedules.created_by … ON DELETE SET NULL` preserves schedules when an admin is deleted; deleting a schedule cascades its duties.

### 8.2 Testing strategy
- **`@oncall/shared`** — extend `schemas.test.ts`: `createScheduleSchema` rejects bad month/year; `scheduleQuerySchema`/`holidayQuerySchema` coerce; `createHolidaySchema` rejects bad date/empty name; `createDutySchema`/`reassignDutySchema` reject non-positive `doctorId`.
- **`scheduling/` pure unit tests (headline coverage)** — no DB mocks, plain fixtures:
  - `constraints.test.ts`: inclusive availability range edges; cap boundary (`count == cap` blocked, `count == cap - 1` allowed); back-to-back blocks the next day; cross-month `priorDayDoctorIds` blocks day 1.
  - `scoring.test.ts`: exact weight math; `WEEKEND_BUDGET`/`HOLIDAY_BUDGET` ceiling division; deterministic tie-break order (score → total → weekend → id).
  - `engine.test.ts`: a fixed 3-doctor / ~10-day fixture → exact expected `assignments` + `reason` strings (snapshot-asserted); one fixture where a day eliminates all doctors → `conflicts` entry with the aggregate `detail`; a full-month fixture asserting weekend/holiday counts differ by ≤ 1 across doctors and every `dutiesThisMonth ≤ maxMonthlyDuties`.
- **`@oncall/api` services** — `schedule.service.test.ts` (mock `db/client`): `buildContext` assembles the context; preview returns assignments + conflicts; generate 409 when exists, 422 when conflicts, 201 persists when clean; `validateAssignment` drives `addDuty`/`reassignDuty` 409s; `removeDuty` deletes. `holiday.service.test.ts`: filtered list, dup-date 409, 404 paths. `doctor.service.test.ts` gains the remove-blocked-by-duties 409 case.
- **`@oncall/api` routes** — `schedule.routes.test.ts` + `holiday.routes.test.ts` with supertest (`query` mocked at module level): admin preview 200; generate 201 / 409 exists / 422 unfillable; doctor 403 on `/schedules`; duty POST 201 / 409; holiday admin CRUD + any-authed GET + doctor-mutate 403.
- **DB** — `pnpm db:setup` applies cleanly; a node one-liner verifies seeded holidays return as `'YYYY-MM-DD'` strings (same check shape as Phase 4's DATE verification).

### 8.3 Definition of Done (Phase 5)
- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; sample `holidays` rows are seeded (no schedule seed — schedules are produced via the API).
- The engine respects every hard constraint: no doctor over `max_monthly_duties`, no duty during unavailability, no back-to-back (including the cross-month boundary), inactive doctors excluded.
- Admin can `POST /schedules/preview` (200 `{assignments, conflicts}`), `POST /schedules` (201; 409 if the month exists; 422 if unfillable and nothing persisted), `GET /schedules` / `GET /schedules/:id`, `DELETE /schedules/:id`, and override duties via `POST /schedules/:id/duties` / `PATCH /duties/:id` / `DELETE /duties/:id` with 409 on any constraint violation. Doctors get 403 on all schedule/duty routes and on holiday mutations; any authenticated user can `GET /holidays`.
- Workload is balanced (greedy + tie-breaks); for solvable months weekend/holiday counts stay within ±1 across eligible doctors; every duty carries a persisted `reason`.
- Deleting a doctor with duties → 409 (disable instead); deleting a schedule cascades its duties.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.

## 9. Out of Scope (Phase 5)

Schedule Management UI (Phase 6), the `publish` endpoint + published-lock enforcement (Phase 6 — the schema reserves the `status` value), statistics & dashboard (Phase 7), reporting (Phase 8); rolling/multi-month generation; swap-request/approval workflow; partial-day/hourly granularity; recurring/templated availability; pagination; multi-hospital.
