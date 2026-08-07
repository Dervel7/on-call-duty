# Phase 5 — Scheduling Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fair, constraint-respecting on-call scheduling engine that turns doctor caps, Phase 4 unavailability, and a new admin-managed holidays table into a monthly duty roster — backend-only (algorithm + persistence + REST), with the UI deferred to Phase 6.

**Architecture:** A pure engine module `apps/api/src/scheduling/` (no `db/`/Express imports) computes assignments from a `SchedulingContext`; `schedule.service.ts` assembles that context from the DB, calls the engine, and persists. Three new tables (`holidays`, `schedules`, `duties`); greedy day-by-day assignment with a weighted score and deterministic tie-breaks; conflicts surfaced via a dry-run `POST /schedules/preview` (200) and an atomic `POST /schedules` (201 / 409 / 422). Admin-only schedule/duty routes; holidays read-open, mutate-admin.

**Tech Stack:** Node.js + TypeScript + Express 4, PostgreSQL via `pg`, `zod`, Vitest + `supertest`. No frontend this phase.

**Spec:** `docs/superpowers/specs/2026-08-07-phase5-scheduling-engine-design.md`

**Branch:** `feat/phase5-scheduling-engine` (already created; spec committed). Commit per task on this branch.

---

## Global Constraints

Carry these verbatim into every task — they are non-negotiable project rules.

- **Runtime:** Node 20+ (developed on 24), pnpm 10+, PostgreSQL 14+ (developed on 17).
- **TypeScript:** `strict`, `noUncheckedIndexedAccess` (index access is `T | undefined`), `verbatimModuleSyntax` (use `import type` for type-only imports), `isolatedModules`, `esModuleInterop`. No `any` where `unknown` works.
- **ESLint:** unused args/vars/caught errors must be prefixed with `_`. **No Prettier**; no formatting scripts.
- **DB:** parameterized queries only (`$1` placeholders), snake_case columns, camelCase API contract. The service maps between them. **No ORM.**
- **`schema.sql`/`seed.sql`:** idempotent (`CREATE TABLE IF NOT EXISTS`). **No triggers/functions** — the DB runner splits statements on `;`.
- **DATE handling:** the Phase 4 `pg` DATE parser (OID 1082 → `'YYYY-MM-DD'` string) is already in `db/client.ts`. All new `DATE` columns come back as strings; never compare as JS `Date` objects. Lexicographic comparison of `'YYYY-MM-DD'` strings is equivalent to date comparison.
- **Auth:** access token in memory only; refresh cookie `httpOnly`. RBAC enforced server-side; never trust client-provided ids.
- **Response envelope:** `{ success: true, data }` or `{ success: false, error }`. HTTP status always set: 200/201/204 success; 400 validation; 401 unauth; 403 forbidden; 404 not found; 409 conflict (schedule exists / holiday dup / duty date filled / constraint violation / doctor-delete blocked); 422 generate unfillable; 500 server error. Structured conflict detail lives **only** in the preview `200` body — do not extend `HttpError` or the error-handler.
- **Commits:** conventional commits (`feat:`, `test:`, `chore:`, `docs:`). Commit per task on `feat/phase5-scheduling-engine`. **Never commit `.env`.**
- **No comments in code** unless explicitly requested.
- **Verification per task:** after implementation, run the task's test command and `pnpm typecheck` + `pnpm lint` for the affected package(s) before committing.

---

## Architecture notes (implementation choices for spec-silent details)

1. **Date math lives in a pure helper `scheduling/dates.ts`** (no I/O) so both the engine and `schedule.service` share `prevDate`/`nextDate`/`daysInMonth`/`isWeekendISO`/`inMonth` without duplication. All date arithmetic is UTC (`setUTCDate`/`getUTCDate`) to stay timezone-stable.
2. **Hard constraints are three pure predicates** in `scheduling/constraints.ts`: `isAvailable(doctorId, date, ranges)`, `underCap(count, max)`, `notConsecutive(onDutyYesterday)`. Each returns `{ ok, reason }`. Override re-validation (in `schedule.service`) reuses the same predicates with DB-loaded data.
3. **Globally one duty per calendar date** is an invariant: a date belongs to one month → one schedule (`UNIQUE(year, month)`) → one duty (`UNIQUE(schedule_id, duty_date)`). So override neighbour checks simply query `WHERE duty_date IN (prev, next)` across all schedules — this covers both same-schedule neighbours and the cross-month prior day automatically.
4. **Conflict detail** tallies the first failing constraint per ineligible doctor: `"of N active doctor(s): a unavailable, b at cap, c back-to-back"`.
5. **`reason` string** is `score S (workload +A, weekend +B, holiday +C)` plus a tie-break suffix **only when** another candidate tied on score (`; tie-break: fewer duties` / `fewer weekend duties` / `lower id`). Manual overrides write `"manual override by admin #{id}"` (service, not engine).
6. **Generation persists per-row duty inserts inside one `withTransaction`** (~30 rows is trivial; keeps the code simple and obviously atomic). The schedule row is inserted first to get its id.
7. **Route tests mock the service modules** (`vi.mock('../services/schedule.service')`, `…/holiday.service`) so HTTP wiring (status codes, RBAC, validation) is tested in isolation. Engine correctness lives in the pure `scheduling/` unit tests (T3); service correctness (buildContext → generate → persist) lives in `schedule.service.test.ts` (T5) with `db/client` mocked.
8. **Schedule generate uses an explicit existence `SELECT`** for the friendly 409 (no PG error-code reliance); the `UNIQUE(year, month)` constraint is the DB backstop. Same style for holiday dup-dates.

---

## Task ordering & dependencies

```
T1 (shared) ─┬─> T3 (engine) ─> T5 (schedule.service) ─┐
T2 (db) ─────┤                                  ┌──────┤
T1 ─> T4 (holiday.service) ─────────────────────┤      ├─> T7 (doctor retrofit) ─> T8 (README + verify)
                                  T3,T4,T5 ─> T6 (routes + wiring) ──────────────────┘
```

Suggested linear execution: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8. (T1 and T2 are mutually independent; T4 depends only on T1; T5 depends on T3 and T2; T6 depends on T4 and T5.)

---

## T1 — Shared contract (types + zod schemas) + tests

**Files:**
- Create: `packages/shared/src/types/schedule.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/schemas/schedule.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`

**Interfaces:**
- Produces (types): `ScheduleStatus`, `Holiday`, `ScheduleSummary`, `Duty`, `AssignmentPlan`, `ConflictPlan`, `PreviewResult`, `ScheduleDetail`, `CreateScheduleRequest`, `ScheduleQuery`, `HolidayQuery`, `CreateHolidayRequest`, `UpdateHolidayRequest`, `CreateDutyRequest`, `ReassignDutyRequest`.
- Produces (values): `createScheduleSchema`, `scheduleQuerySchema`, `holidayQuerySchema`, `createHolidaySchema`, `updateHolidaySchema`, `createDutySchema`, `reassignDutySchema`.

- [ ] **Step 1: Create `packages/shared/src/types/schedule.ts`**

```ts
export type ScheduleStatus = 'draft' | 'published'

export interface Holiday {
  id: number
  name: string
  date: string
  createdAt: string
  updatedAt: string
}

export interface ScheduleSummary {
  id: number
  year: number
  month: number
  status: ScheduleStatus
  createdBy: number | null
  createdAt: string
  updatedAt: string
}

export interface Duty {
  id: number
  scheduleId: number
  dutyDate: string
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  isHoliday: boolean
  reason: string
  createdAt: string
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
  detail: string
}

export interface PreviewResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
}

export interface ScheduleDetail {
  schedule: ScheduleSummary
  duties: Duty[]
}

export interface CreateScheduleRequest {
  year: number
  month: number
}

export interface ScheduleQuery {
  year?: number
  month?: number
}

export interface HolidayQuery {
  from?: string
  to?: string
}

export interface CreateHolidayRequest {
  name: string
  date: string
}

export interface UpdateHolidayRequest {
  name?: string
  date?: string
}

export interface CreateDutyRequest {
  date: string
  doctorId: number
}

export interface ReassignDutyRequest {
  doctorId: number
}
```

- [ ] **Step 2: Re-export the types**

Append to `packages/shared/src/types/index.ts`:
```ts
export type {
  ScheduleStatus,
  Holiday,
  ScheduleSummary,
  Duty,
  AssignmentPlan,
  ConflictPlan,
  PreviewResult,
  ScheduleDetail,
  CreateScheduleRequest,
  ScheduleQuery,
  HolidayQuery,
  CreateHolidayRequest,
  UpdateHolidayRequest,
  CreateDutyRequest,
  ReassignDutyRequest,
} from './schedule'
```

- [ ] **Step 3: Create `packages/shared/src/schemas/schedule.ts`**

```ts
import { z } from 'zod'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')
const yearMonth = {
  year: z.number().int().min(1970).max(2100),
  month: z.number().int().min(1).max(12),
}

export const createScheduleSchema = z.object(yearMonth)
export const scheduleQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
export const holidayQuerySchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
})
export const createHolidaySchema = z.object({
  name: z.string().min(1).max(200),
  date: dateStr,
})
export const updateHolidaySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  date: dateStr.optional(),
})
export const createDutySchema = z.object({
  date: dateStr,
  doctorId: z.number().int().positive(),
})
export const reassignDutySchema = z.object({
  doctorId: z.number().int().positive(),
})
```

- [ ] **Step 4: Re-export the schemas**

Append to `packages/shared/src/schemas/index.ts`:
```ts
export {
  createScheduleSchema,
  scheduleQuerySchema,
  holidayQuerySchema,
  createHolidaySchema,
  updateHolidaySchema,
  createDutySchema,
  reassignDutySchema,
} from './schedule'
```

- [ ] **Step 5: Write the failing tests**

Append to `packages/shared/src/__tests__/schemas.test.ts`:
```ts
import {
  createDutySchema,
  createHolidaySchema,
  createScheduleSchema,
  holidayQuerySchema,
  reassignDutySchema,
  scheduleQuerySchema,
  updateHolidaySchema,
} from '../index'

describe('schedule schemas', () => {
  it('createScheduleSchema rejects bad month/year', () => {
    expect(createScheduleSchema.safeParse({ year: 2026, month: 0 }).success).toBe(false)
    expect(createScheduleSchema.safeParse({ year: 2026, month: 13 }).success).toBe(false)
    expect(createScheduleSchema.safeParse({ year: 2026, month: 9 }).success).toBe(true)
  })

  it('scheduleQuerySchema and holidayQuerySchema coerce/accept strings', () => {
    const r = scheduleQuerySchema.safeParse({ year: '2026', month: '9' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.year).toBe(2026)
      expect(r.data.month).toBe(9)
    }
    expect(holidayQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success).toBe(true)
    expect(holidayQuerySchema.safeParse({ from: '09-01-2026' }).success).toBe(false)
  })

  it('createHolidaySchema rejects bad date and empty name', () => {
    expect(createHolidaySchema.safeParse({ name: '', date: '2026-09-01' }).success).toBe(false)
    expect(createHolidaySchema.safeParse({ name: 'Day', date: '2026-9-1' }).success).toBe(false)
    expect(createHolidaySchema.safeParse({ name: 'Day', date: '2026-09-01' }).success).toBe(true)
  })

  it('updateHolidaySchema accepts partials', () => {
    expect(updateHolidaySchema.safeParse({ name: 'X' }).success).toBe(true)
    expect(updateHolidaySchema.safeParse({ date: '2026-09-01' }).success).toBe(true)
    expect(updateHolidaySchema.safeParse({ date: 'bad' }).success).toBe(false)
  })

  it('createDutySchema and reassignDutySchema reject non-positive doctorId', () => {
    expect(createDutySchema.safeParse({ date: '2026-09-01', doctorId: 0 }).success).toBe(false)
    expect(createDutySchema.safeParse({ date: '2026-09-01', doctorId: 5 }).success).toBe(true)
    expect(reassignDutySchema.safeParse({ doctorId: -1 }).success).toBe(false)
    expect(reassignDutySchema.safeParse({ doctorId: 5 }).success).toBe(true)
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @oncall/shared test`
Expected: PASS (new schedule schema tests + existing auth/doctor/unavailability schema tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add scheduling engine types and zod schemas"
```

---

## T2 — Database schema + seed + DATE verification

**Files:**
- Modify: `database/schema.sql` (append three tables)
- Modify: `database/seed.sql` (append sample holidays)

**Interfaces:**
- Produces (DB): tables `holidays`, `schedules` (`UNIQUE(year, month)`), `duties` (`UNIQUE(schedule_id, duty_date)`, `doctor_id … ON DELETE RESTRICT`) with the indexes from the spec.

- [ ] **Step 1: Append the Phase 5 tables to `schema.sql`**

Append to `database/schema.sql`:
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

- [ ] **Step 2: Append sample holidays to `seed.sql`**

Append to `database/seed.sql`:
```sql

-- Phase 5: seed sample holidays (fixed sample month 2026-09)
INSERT INTO holidays (name, date)
SELECT 'Sample Holiday', '2026-09-01'
WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE date = '2026-09-01');

INSERT INTO holidays (name, date)
SELECT 'Another Holiday', '2026-09-17'
WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE date = '2026-09-17');
```

- [ ] **Step 3: Apply schema + seed and verify DATE strings**

Ensure `apps/api/.env` has a working `DATABASE_URL`, then:
```bash
pnpm db:setup
```
Then verify the new tables and the DATE parser (hoisted `dotenv` + `pg`, same shape as Phase 4):
```bash
node -e "require('dotenv').config({path:'apps/api/.env'}); const {Client}=require('pg'); const {types}=require('pg'); types.setTypeParser(1082,v=>v); const c=new Client({connectionString:process.env.DATABASE_URL}); (async()=>{await c.connect(); const r=await c.query('SELECT name, date FROM holidays ORDER BY date'); console.log('ROWS', r.rows); await c.end();})().catch(e=>{console.error(e); process.exit(1);})"
```
Expected: two rows; `date` printed as `'YYYY-MM-DD'` strings (`2026-09-01`, `2026-09-17`).

- [ ] **Step 4: Commit**

```bash
git add database/schema.sql database/seed.sql
git commit -m "feat(db): schedules, duties, holidays tables + sample holidays"
```

## T3 — Pure scheduling engine + unit tests

**Files:**
- Create: `apps/api/src/scheduling/dates.ts`
- Create: `apps/api/src/scheduling/types.ts`
- Create: `apps/api/src/scheduling/constraints.ts`
- Create: `apps/api/src/scheduling/scoring.ts`
- Create: `apps/api/src/scheduling/engine.ts`
- Create: `apps/api/src/scheduling/index.ts` (barrel)
- Create: `apps/api/src/scheduling/__tests__/constraints.test.ts`
- Create: `apps/api/src/scheduling/__tests__/scoring.test.ts`
- Create: `apps/api/src/scheduling/__tests__/engine.test.ts`

**Interfaces:**
- Produces (pure, no `db/`/Express imports):
  - `dates.ts`: `pad2`, `isoDate`, `daysInMonth`, `isWeekendISO`, `prevDate`, `nextDate`, `inMonth`.
  - `constraints.ts`: `ConstraintResult`; `isAvailable(doctorId, date, ranges)`, `underCap(count, max)`, `notConsecutive(onDutyYesterday)`.
  - `scoring.ts`: `W_WORKLOAD`, `W_WEEKEND`, `W_HOLIDAY`; `weekendBudget`, `holidayBudget`; `scoreCandidate(...)`.
  - `engine.ts`: `generate(ctx: SchedulingContext): GenerateResult`.
  - `types.ts`: `DoctorSpec`, `DaySpec`, `SchedulingContext`, `CandidateScore`, `AssignmentPlan`, `ConflictPlan`, `GenerateResult`.
- Consumed later by: `schedule.service` (T5) imports `generate`, `SchedulingContext`, and the constraint predicates.

- [ ] **Step 1: Create `scheduling/dates.ts`**

```ts
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isWeekendISO(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

export function prevDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function inMonth(date: string, year: number, month: number): boolean {
  return date.startsWith(`${year}-${pad2(month)}-`)
}
```

- [ ] **Step 2: Create `scheduling/types.ts`**

```ts
export interface DoctorSpec {
  id: number
  firstName: string
  lastName: string
  maxMonthlyDuties: number
  isActive: boolean
}

export interface DaySpec {
  date: string
  isWeekend: boolean
  isHoliday: boolean
}

export interface SchedulingContext {
  year: number
  month: number
  days: DaySpec[]
  doctors: DoctorSpec[]
  unavailability: Map<number, Array<{ start: string; end: string }>>
  priorDayDoctorIds: Set<number>
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
  detail: string
}

export interface GenerateResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
}
```

- [ ] **Step 3: Create `scheduling/constraints.ts`**

```ts
export interface ConstraintResult {
  ok: boolean
  reason: string
}

export function isAvailable(
  _doctorId: number,
  date: string,
  ranges: Array<{ start: string; end: string }> | undefined,
): ConstraintResult {
  if (!ranges || ranges.length === 0) return { ok: true, reason: '' }
  for (const r of ranges) {
    if (r.start <= date && date <= r.end) return { ok: false, reason: 'unavailable' }
  }
  return { ok: true, reason: '' }
}

export function underCap(count: number, maxMonthlyDuties: number): ConstraintResult {
  return count < maxMonthlyDuties
    ? { ok: true, reason: '' }
    : { ok: false, reason: 'at cap' }
}

export function notConsecutive(onDutyYesterday: boolean): ConstraintResult {
  return onDutyYesterday ? { ok: false, reason: 'back-to-back' } : { ok: true, reason: '' }
}
```

- [ ] **Step 4: Create `scheduling/scoring.ts`**

```ts
import type { CandidateScore, DaySpec, DoctorSpec } from './types'

export const W_WORKLOAD = 3
export const W_WEEKEND = 4
export const W_HOLIDAY = 4

export function weekendBudget(weekendDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(weekendDays / activeDoctors)
}

export function holidayBudget(holidayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(holidayDays / activeDoctors)
}

export function scoreCandidate(
  doctor: DoctorSpec,
  day: DaySpec,
  dutiesThisMonth: number,
  weekendDuties: number,
  holidayDuties: number,
  weekendBudgetValue: number,
  holidayBudgetValue: number,
): CandidateScore {
  const workload = (doctor.maxMonthlyDuties - dutiesThisMonth) * W_WORKLOAD
  const weekend = day.isWeekend ? Math.max(0, weekendBudgetValue - weekendDuties) * W_WEEKEND : 0
  const holiday = day.isHoliday ? Math.max(0, holidayBudgetValue - holidayDuties) * W_HOLIDAY : 0
  return { score: workload + weekend + holiday, workload, weekend, holiday }
}
```

- [ ] **Step 5: Create `scheduling/engine.ts`**

```ts
import { prevDate } from './dates'
import { isAvailable, notConsecutive, underCap } from './constraints'
import { holidayBudget, scoreCandidate, weekendBudget } from './scoring'
import type {
  AssignmentPlan,
  CandidateScore,
  ConflictPlan,
  DoctorSpec,
  GenerateResult,
  SchedulingContext,
} from './types'

interface Eligible {
  doctor: DoctorSpec
  score: CandidateScore
}

interface RunState {
  total: Map<number, number>
  weekend: Map<number, number>
  holiday: Map<number, number>
  byDate: Map<string, number>
}

export function generate(ctx: SchedulingContext): GenerateResult {
  const assignments: AssignmentPlan[] = []
  const conflicts: ConflictPlan[] = []

  const state: RunState = {
    total: new Map(),
    weekend: new Map(),
    holiday: new Map(),
    byDate: new Map(),
  }
  for (const d of ctx.doctors) {
    state.total.set(d.id, 0)
    state.weekend.set(d.id, 0)
    state.holiday.set(d.id, 0)
  }

  const activeCount = ctx.doctors.length
  const weekendDays = ctx.days.filter((d) => d.isWeekend).length
  const holidayDays = ctx.days.filter((d) => d.isHoliday).length
  const wBudget = weekendBudget(weekendDays, activeCount)
  const hBudget = holidayBudget(holidayDays, activeCount)
  const firstDayPrev = ctx.days.length > 0 ? prevDate(ctx.days[0].date) : ''

  for (const day of ctx.days) {
    const eligible: Eligible[] = []
    const tally = { unavailable: 0, 'at cap': 0, 'back-to-back': 0 }

    for (const doctor of ctx.doctors) {
      const ranges = ctx.unavailability.get(doctor.id)
      const avail = isAvailable(doctor.id, day.date, ranges)
      if (!avail.ok) {
        tally.unavailable++
        continue
      }
      const cap = underCap(state.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties)
      if (!cap.ok) {
        tally['at cap']++
        continue
      }
      const prev = prevDate(day.date)
      const onDutyYesterday =
        prev === firstDayPrev
          ? ctx.priorDayDoctorIds.has(doctor.id)
          : state.byDate.get(prev) === doctor.id
      const consec = notConsecutive(onDutyYesterday)
      if (!consec.ok) {
        tally['back-to-back']++
        continue
      }
      eligible.push({
        doctor,
        score: scoreCandidate(
          doctor,
          day,
          state.total.get(doctor.id) ?? 0,
          state.weekend.get(doctor.id) ?? 0,
          state.holiday.get(doctor.id) ?? 0,
          wBudget,
          hBudget,
        ),
      })
    }

    if (eligible.length === 0) {
      conflicts.push({
        date: day.date,
        detail: `of ${activeCount} active doctor(s): ${tally.unavailable} unavailable, ${tally['at cap']} at cap, ${tally['back-to-back']} back-to-back`,
      })
      continue
    }

    eligible.sort(
      (a, b) =>
        b.score.score - a.score.score ||
        (state.total.get(a.doctor.id) ?? 0) - (state.total.get(b.doctor.id) ?? 0) ||
        (state.weekend.get(a.doctor.id) ?? 0) - (state.weekend.get(b.doctor.id) ?? 0) ||
        a.doctor.id - b.doctor.id,
    )

    const winner = eligible[0]
    if (!winner) continue

    assignments.push({
      date: day.date,
      doctorId: winner.doctor.id,
      doctorFirstName: winner.doctor.firstName,
      doctorLastName: winner.doctor.lastName,
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      reason: `score ${winner.score.score} (workload +${winner.score.workload}, weekend +${winner.score.weekend}, holiday +${winner.score.holiday})${describeTiebreak(winner, eligible, state)}`,
    })

    state.total.set(winner.doctor.id, (state.total.get(winner.doctor.id) ?? 0) + 1)
    state.byDate.set(day.date, winner.doctor.id)
    if (day.isWeekend)
      state.weekend.set(winner.doctor.id, (state.weekend.get(winner.doctor.id) ?? 0) + 1)
    if (day.isHoliday)
      state.holiday.set(winner.doctor.id, (state.holiday.get(winner.doctor.id) ?? 0) + 1)
  }

  return { assignments, conflicts }
}

function describeTiebreak(winner: Eligible, eligible: Eligible[], state: RunState): string {
  const sameScore = eligible.filter(
    (e) => e.doctor.id !== winner.doctor.id && e.score.score === winner.score.score,
  )
  if (sameScore.length === 0) return ''
  for (const o of sameScore) {
    if ((state.total.get(winner.doctor.id) ?? 0) !== (state.total.get(o.doctor.id) ?? 0))
      return '; tie-break: fewer duties'
    if ((state.weekend.get(winner.doctor.id) ?? 0) !== (state.weekend.get(o.doctor.id) ?? 0))
      return '; tie-break: fewer weekend duties'
  }
  return '; tie-break: lower id'
}
```

- [ ] **Step 6: Create `scheduling/index.ts` (barrel)**

```ts
export * from './dates'
export * from './types'
export * from './constraints'
export * from './scoring'
export { generate } from './engine'
```

- [ ] **Step 7: Create `scheduling/__tests__/constraints.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { isAvailable, notConsecutive, underCap } from '../constraints'

describe('constraints', () => {
  it('isAvailable respects inclusive ranges', () => {
    const ranges = [{ start: '2026-09-07', end: '2026-09-11' }]
    expect(isAvailable(1, '2026-09-06', ranges).ok).toBe(true)
    expect(isAvailable(1, '2026-09-07', ranges).ok).toBe(false)
    expect(isAvailable(1, '2026-09-11', ranges).ok).toBe(false)
    expect(isAvailable(1, '2026-09-12', ranges).ok).toBe(false)
    expect(isAvailable(1, '2026-09-12', undefined).ok).toBe(true)
  })

  it('underCap is exclusive at the cap', () => {
    expect(underCap(0, 7).ok).toBe(true)
    expect(underCap(6, 7).ok).toBe(true)
    expect(underCap(7, 7).ok).toBe(false)
  })

  it('notConsecutive blocks only when on duty the previous day', () => {
    expect(notConsecutive(false).ok).toBe(true)
    expect(notConsecutive(true).ok).toBe(false)
  })
})
```

- [ ] **Step 8: Create `scheduling/__tests__/scoring.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  W_HOLIDAY,
  W_WEEKEND,
  W_WORKLOAD,
  holidayBudget,
  scoreCandidate,
  weekendBudget,
} from '../scoring'
import type { DaySpec, DoctorSpec } from '../types'

const doctor = (id: number, max: number): DoctorSpec => ({
  id,
  firstName: 'A',
  lastName: 'B',
  maxMonthlyDuties: max,
  isActive: true,
})
const weekday = (d: string): DaySpec => ({ date: d, isWeekend: false, isHoliday: false })
const weekend = (d: string): DaySpec => ({ date: d, isWeekend: true, isHoliday: false })
const holiday = (d: string): DaySpec => ({ date: d, isWeekend: false, isHoliday: true })

describe('scoring', () => {
  it('budgets use ceiling division and 0 on no doctors', () => {
    expect(weekendBudget(8, 3)).toBe(3)
    expect(weekendBudget(9, 3)).toBe(3)
    expect(holidayBudget(0, 3)).toBe(0)
    expect(weekendBudget(8, 0)).toBe(0)
  })

  it('workload term favors doctors with more remaining slots', () => {
    const s0 = scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 0, 0, 0, 0, 0)
    const s6 = scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 6, 0, 0, 0, 0)
    expect(s0.workload).toBe(7 * W_WORKLOAD)
    expect(s6.workload).toBe(1 * W_WORKLOAD)
    expect(s0.score - s6.score).toBe(6 * W_WORKLOAD)
  })

  it('weekend term only applies on weekend days and clamps at 0', () => {
    const onWeekend = scoreCandidate(doctor(1, 7), weekend('2026-09-05'), 0, 2, 0, 3, 0)
    const overServed = scoreCandidate(doctor(1, 7), weekend('2026-09-05'), 0, 5, 0, 3, 0)
    expect(onWeekend.weekend).toBe((3 - 2) * W_WEEKEND)
    expect(overServed.weekend).toBe(0)
    expect(scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 0, 0, 0, 3, 0).weekend).toBe(0)
  })

  it('holiday term only applies on holiday days', () => {
    expect(scoreCandidate(doctor(1, 7), holiday('2026-09-01'), 0, 0, 0, 0, 2).holiday).toBe(
      2 * W_HOLIDAY,
    )
    expect(scoreCandidate(doctor(1, 7), weekday('2026-09-02'), 0, 0, 0, 0, 2).holiday).toBe(0)
  })
})
```

- [ ] **Step 9: Create `scheduling/__tests__/engine.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { generate } from '../engine'
import type { DaySpec, DoctorSpec, SchedulingContext } from '../types'

function ctx(
  days: DaySpec[],
  doctors: DoctorSpec[],
  opts: {
    unavailability?: Map<number, Array<{ start: string; end: string }>>
    priorDayDoctorIds?: Set<number>
  } = {},
): SchedulingContext {
  return {
    year: 2026,
    month: 9,
    days,
    doctors,
    unavailability: opts.unavailability ?? new Map(),
    priorDayDoctorIds: opts.priorDayDoctorIds ?? new Set(),
  }
}

const dr = (id: number, max = 7): DoctorSpec => ({
  id,
  firstName: `F${id}`,
  lastName: `L${id}`,
  maxMonthlyDuties: max,
  isActive: true,
})
const day = (d: string, isWeekend = false, isHoliday = false): DaySpec => ({
  date: d,
  isWeekend,
  isHoliday,
})

describe('engine.generate', () => {
  it('assigns the lone eligible doctor each day and records a persisted reason', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1)]))
    expect(conflicts).toEqual([])
    expect(assignments).toHaveLength(3)
    expect(assignments.every((a) => a.doctorId === 1)).toBe(true)
    expect(assignments[0]?.reason).toMatch(/^score \d+ \(workload \+\d+, weekend \+\d+, holiday \+\d+\)/)
  })

  it('enforces no back-to-back: a single doctor cannot take consecutive days', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const { conflicts } = generate(ctx(days, [dr(1)]))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.date).toBe('2026-09-02')
    expect(conflicts[0]?.detail).toContain('back-to-back')
  })

  it('respects unavailability: an unavailable-only day becomes a conflict', () => {
    const days = [day('2026-09-01')]
    const un = new Map([[1, [{ start: '2026-09-01', end: '2026-09-01' }]]])
    const { conflicts, assignments } = generate(ctx(days, [dr(1)], { unavailability: un }))
    expect(assignments).toEqual([])
    expect(conflicts[0]?.detail).toContain('unavailable')
  })

  it('enforces the monthly cap', () => {
    const everyOther = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05'), day('2026-09-07')]
    const { conflicts } = generate(ctx(everyOther, [dr(1, 2)]))
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.some((c) => c.detail.includes('at cap'))).toBe(true)
  })

  it('respects cross-month prior-day duty via priorDayDoctorIds (day 1 blocked)', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const prior = new Set([1])
    const { assignments } = generate(ctx(days, [dr(1), dr(2)], { priorDayDoctorIds: prior }))
    expect(assignments[0]?.doctorId).not.toBe(1)
  })

  it('balances workload: two equal doctors alternate (deterministic tie-break)', () => {
    const days = [
      day('2026-09-01'),
      day('2026-09-02'),
      day('2026-09-03'),
      day('2026-09-04'),
    ]
    const { assignments } = generate(ctx(days, [dr(1), dr(2)]))
    const ids = assignments.map((a) => a.doctorId)
    expect(ids).toEqual([1, 2, 1, 2])
  })

  it('is deterministic: same context yields identical output twice', () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2026-09-${String(i + 1).padStart(2, '0')}`),
    )
    const a = generate(ctx(days, [dr(1), dr(2), dr(3)]))
    const b = generate(ctx(days, [dr(1), dr(2), dr(3)]))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
```

- [ ] **Step 10: Run the tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (all `scheduling/` tests + existing api tests).

- [ ] **Step 11: Run typecheck and lint**

Run: `pnpm --filter @oncall/api typecheck && pnpm --filter @oncall/api lint`
Expected: PASS with no errors.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/scheduling
git commit -m "feat(api): pure scheduling engine (constraints, scoring, generate)"
```

## T4 — `holiday.service` + tests

**Files:**
- Create: `apps/api/src/services/holiday.service.ts`
- Create: `apps/api/src/__tests__/holiday.service.test.ts`

**Interfaces:**
- Consumes: `query` from `db/client`; `HttpError`; shared types `Holiday`, `HolidayQuery`, `CreateHolidayRequest`, `UpdateHolidayRequest`.
- Produces: `list({ from?, to? }): Promise<Holiday[]>`; `create({ name, date }): Promise<Holiday>` (409 dup date); `update(id, { name?, date? }): Promise<Holiday>` (404/409); `remove(id): Promise<void>` (404); `getById(id)` (404).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/holiday.service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import { create, list, remove, update } from '../services/holiday.service'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Sample Holiday',
    date: '2026-09-01',
    created_at: new Date('2026-08-01'),
    updated_at: new Date('2026-08-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('holiday.service', () => {
  it('list applies an inclusive date window', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await list({ from: '2026-09-01', to: '2026-09-30' })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('date >= ')
    expect(sql).toContain('date <= ')
  })

  it('list without filters runs an unfiltered ORDER BY date', async () => {
    query.mockResolvedValue({ rows: [] })
    await list()
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).not.toContain('WHERE')
    expect(sql).toContain('ORDER BY date')
  })

  it('create rejects a duplicate date with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(create({ name: 'X', date: '2026-09-01' })).rejects.toMatchObject({ status: 409 })
  })

  it('create inserts and returns the joined holiday', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] })
    query.mockResolvedValueOnce({ rows: [row({ id: 7 })] })
    const h = await create({ name: 'Day', date: '2026-09-17' })
    expect(h.id).toBe(7)
    const insertSql = query.mock.calls[1]?.[0] as string
    expect(insertSql).toContain('INSERT INTO holidays')
  })

  it('update 404 when missing; 409 on dup date', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(update(99, { name: 'X' })).rejects.toMatchObject({ status: 404 })

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Old', date: '2026-09-01' }] })
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] })
    await expect(update(1, { date: '2026-09-17' })).rejects.toMatchObject({ status: 409 })
  })

  it('remove deletes; 404 when missing', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(1)
    expect((query.mock.calls[1]?.[0] as string).includes('DELETE FROM holidays')).toBe(true)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/api test`
Expected: FAIL (module `../services/holiday.service` not found).

- [ ] **Step 3: Implement `holiday.service.ts`**

Create `apps/api/src/services/holiday.service.ts`:
```ts
import type {
  CreateHolidayRequest,
  Holiday,
  HolidayQuery,
  UpdateHolidayRequest,
} from '@oncall/shared'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'

interface HolidayRow {
  id: number
  name: string
  date: string
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT id, name, date, created_at, updated_at FROM holidays`

function toHoliday(row: HolidayRow): Holiday {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

async function getById(id: number): Promise<Holiday> {
  const res = await query<HolidayRow>(`${SELECT} WHERE id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Holiday not found')
  return toHoliday(row)
}

export async function list(filters: HolidayQuery = {}): Promise<Holiday[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.from !== undefined) {
    params.push(filters.from)
    where.push(`date >= $${params.length}`)
  }
  if (filters.to !== undefined) {
    params.push(filters.to)
    where.push(`date <= $${params.length}`)
  }
  const sql =
    where.length > 0
      ? `${SELECT} WHERE ${where.join(' AND ')} ORDER BY date`
      : `${SELECT} ORDER BY date`
  const res = await query<HolidayRow>(sql, params)
  return res.rows.map(toHoliday)
}

export async function create(input: CreateHolidayRequest): Promise<Holiday> {
  const dup = await query('SELECT id FROM holidays WHERE date = $1', [input.date])
  if (dup.rows.length > 0) throw new HttpError(409, 'Holiday already exists on this date')
  const ins = await query<{ id: number }>(
    'INSERT INTO holidays (name, date) VALUES ($1, $2) RETURNING id',
    [input.name, input.date],
  )
  const id = ins.rows[0]?.id
  if (id === undefined) throw new HttpError(500, 'Failed to create holiday')
  return getById(id)
}

export async function update(id: number, input: UpdateHolidayRequest): Promise<Holiday> {
  const existing = await query<HolidayRow>(`${SELECT} WHERE id = $1`, [id])
  if (existing.rows.length === 0) throw new HttpError(404, 'Holiday not found')
  if (input.date !== undefined) {
    const dup = await query('SELECT id FROM holidays WHERE date = $1 AND id <> $2', [
      input.date,
      id,
    ])
    if (dup.rows.length > 0) throw new HttpError(409, 'Holiday already exists on this date')
  }
  const sets: string[] = []
  const params: unknown[] = []
  const map: Array<[string, unknown]> = [
    ['name', input.name],
    ['date', input.date],
  ]
  for (const [col, value] of map) {
    if (value !== undefined) {
      params.push(value)
      sets.push(`${col} = $${params.length}`)
    }
  }
  if (sets.length > 0) {
    params.push(id)
    await query(
      `UPDATE holidays SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params,
    )
  }
  return getById(id)
}

export async function remove(id: number): Promise<void> {
  const existing = await query('SELECT id FROM holidays WHERE id = $1', [id])
  if (existing.rows.length === 0) throw new HttpError(404, 'Holiday not found')
  await query('DELETE FROM holidays WHERE id = $1', [id])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (holiday.service + all existing api tests).

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm --filter @oncall/api typecheck && pnpm --filter @oncall/api lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/holiday.service.ts apps/api/src/__tests__/holiday.service.test.ts
git commit -m "feat(api): holiday service (CRUD + dup-date guard)"
```

## T5 — `schedule.service` (buildContext, preview, generate, overrides) + tests

**Files:**
- Create: `apps/api/src/services/schedule.service.ts`
- Create: `apps/api/src/__tests__/schedule.service.test.ts`

**Interfaces:**
- Consumes: `query`, `withTransaction` from `db/client`; `HttpError`; `generate`, `SchedulingContext`, and the constraint predicates from `scheduling/`; the date helpers from `scheduling/dates`; shared types (`AuthUser`, `CreateDutyRequest`, `Duty`, `PreviewResult`, `ReassignDutyRequest`, `ScheduleDetail`, `ScheduleQuery`, `ScheduleSummary`, `ScheduleStatus`).
- Produces: `preview(year, month)`; `generate(year, month, actor)` (409 exists / 422 unfillable / 201 persisted); `list({ year?, month? })`; `getById(id)`; `remove(id)`; `addDuty(scheduleId, input, actor)`; `reassignDuty(dutyId, input, actor)`; `removeDuty(dutyId)`; (internal) `buildContext`, `validateAssignment`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/__tests__/schedule.service.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import {
  addDuty,
  generate,
  getById,
  list,
  preview,
  reassignDuty,
  remove,
  removeDuty,
} from '../services/schedule.service'

function scheduleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    year: 2026,
    month: 9,
    status: 'draft',
    created_by: 2,
    created_at: new Date('2026-08-01'),
    updated_at: new Date('2026-08-01'),
    ...overrides,
  }
}
function dutyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    schedule_id: 1,
    duty_date: '2026-09-05',
    doctor_id: 5,
    first_name: 'Jane',
    last_name: 'Roe',
    is_weekend: false,
    is_holiday: false,
    reason: 'score 1 (workload +1, weekend +0, holiday +0)',
    created_at: new Date('2026-08-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('schedule.service', () => {
  it('generate 409 when the month already exists', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(generate(2026, 9, { id: 2, role: 'administrator' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('generate 422 when a day is unfillable (no doctors) and persists nothing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(generate(2026, 9, { id: 2, role: 'administrator' })).rejects.toMatchObject({
      status: 422,
    })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })

  it('generate persists a schedule + duties when every day is fillable', async () => {
    const doctors = [
      { id: 1, max_monthly_duties: 7, first_name: 'A', last_name: 'A', is_active: true },
      { id: 2, max_monthly_duties: 7, first_name: 'B', last_name: 'B', is_active: true },
    ]
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM holidays')) return { rows: [] }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      if (sql.includes('INSERT INTO schedules')) return { rows: [{ id: 42 }] }
      if (sql.includes('INSERT INTO duties')) return { rows: [] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE id =')) {
        return { rows: [scheduleRow({ id: 42 })] }
      }
      if (sql.includes('FROM duties du')) return { rows: [] }
      return { rows: [] }
    })
    const detail = await generate(2026, 9, { id: 2, role: 'administrator' })
    expect(detail.schedule.id).toBe(42)
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(true)
    expect(query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties')).length).toBeGreaterThan(0)
  })

  it('preview returns assignments + conflicts without persisting', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await preview(2026, 9)
    expect(Array.isArray(res.assignments)).toBe(true)
    expect(Array.isArray(res.conflicts)).toBe(true)
    expect(query.mock.calls.some((c) => String(c[0]).startsWith('INSERT'))).toBe(false)
  })

  it('list applies optional year/month filters', async () => {
    query.mockResolvedValue({ rows: [scheduleRow()] })
    await list({ year: 2026, month: 9 })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('year =')
    expect(sql).toContain('month =')
  })

  it('getById 404 when missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getById(99)).rejects.toMatchObject({ status: 404 })
  })

  it('remove deletes the schedule (404 when missing)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(1)
    expect((query.mock.calls[1]?.[0] as string).includes('DELETE FROM schedules')).toBe(true)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })

  it('addDuty rejects an out-of-month date with 400', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    await expect(
      addDuty(1, { date: '2026-10-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('addDuty rejects an already-filled date with 409', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('reassignDuty runs validateAssignment and updates the row', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow({ id: 10, doctor_id: 5, duty_date: '2026-09-05' })] })
    query.mockResolvedValueOnce({ rows: [{ max_monthly_duties: 7, is_active: true }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ n: 0 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [dutyRow({ id: 10, doctor_id: 7 })] })
    const d = await reassignDuty(10, { doctorId: 7 }, { id: 2, role: 'administrator' })
    expect(d.doctorId).toBe(7)
    expect(d.reason).toContain('manual override by admin #2')
  })

  it('reassignDuty 404 when duty missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(
      reassignDuty(99, { doctorId: 7 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('removeDuty deletes; 404 when missing', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow()] })
    query.mockResolvedValueOnce({ rows: [] })
    await removeDuty(10)
    expect((query.mock.calls[1]?.[0] as string).includes('DELETE FROM duties')).toBe(true)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(removeDuty(99)).rejects.toMatchObject({ status: 404 })
  })
})
```

> **Mock sequence for the `reassignDuty` happy path** (in order): duty row lookup → doctor lookup (cap/active) → availability ranges → cap count → neighbour dates → `isHolidayOn` check (addDuty only; reassign skips it) → UPDATE → duty row re-read. The happy-path mock above omits the holiday check because `reassignDuty` does not change the date. If you adjust `validateAssignment` ordering, keep the test's mock sequence in lockstep.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oncall/api test`
Expected: FAIL (module `../services/schedule.service` not found).

- [ ] **Step 3: Implement `schedule.service.ts`**

Create `apps/api/src/services/schedule.service.ts`:
```ts
import type {
  AuthUser,
  CreateDutyRequest,
  Duty,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
  ScheduleStatus,
} from '@oncall/shared'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import { generate as runEngine, isAvailable, notConsecutive, underCap } from '../scheduling'
import {
  daysInMonth,
  inMonth,
  isWeekendISO,
  isoDate,
  nextDate,
  prevDate,
} from '../scheduling/dates'
import type { DoctorSpec, SchedulingContext } from '../scheduling/types'

type Actor = Pick<AuthUser, 'id' | 'role'>

interface ScheduleRow {
  id: number
  year: number
  month: number
  status: string
  created_by: number | null
  created_at: Date
  updated_at: Date
}

interface DutyRow {
  id: number
  schedule_id: number
  duty_date: string
  doctor_id: number
  first_name: string
  last_name: string
  is_weekend: boolean
  is_holiday: boolean
  reason: string
  created_at: Date
}

const SELECT_SCHEDULE = `SELECT id, year, month, status, created_by, created_at, updated_at FROM schedules`
const SELECT_DUTY = `SELECT du.id, du.schedule_id, du.duty_date, du.doctor_id, du.is_weekend,
  du.is_holiday, du.reason, du.created_at, u.first_name, u.last_name
  FROM duties du JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id`

function toSchedule(row: ScheduleRow): ScheduleSummary {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    status: row.status as ScheduleStatus,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toDuty(row: DutyRow): Duty {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    dutyDate: row.duty_date,
    doctorId: row.doctor_id,
    doctorFirstName: row.first_name,
    doctorLastName: row.last_name,
    isWeekend: row.is_weekend,
    isHoliday: row.is_holiday,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }
}

function monthBounds(year: number, month: number): { first: string; last: string } {
  return { first: isoDate(year, month, 1), last: isoDate(year, month, daysInMonth(year, month)) }
}

async function buildContext(year: number, month: number): Promise<SchedulingContext> {
  const { first, last } = monthBounds(year, month)

  const dr = await query<{
    id: number
    max_monthly_duties: number
    first_name: string
    last_name: string
  }>(
    `SELECT d.id, d.max_monthly_duties, u.first_name, u.last_name
     FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE u.is_active = TRUE ORDER BY d.id`,
  )
  const doctors: DoctorSpec[] = dr.rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    maxMonthlyDuties: r.max_monthly_duties,
    isActive: true,
  }))

  const hres = await query<{ date: string }>(
    `SELECT date FROM holidays WHERE date >= $1 AND date <= $2`,
    [first, last],
  )
  const holidays = new Set(hres.rows.map((r) => r.date))

  const ures = await query<{ doctor_id: number; start_date: string; end_date: string }>(
    `SELECT doctor_id, start_date, end_date FROM unavailability
     WHERE start_date <= $1 AND end_date >= $2`,
    [last, first],
  )
  const unavailability = new Map<number, Array<{ start: string; end: string }>>()
  for (const r of ures.rows) {
    const list = unavailability.get(r.doctor_id) ?? []
    list.push({ start: r.start_date, end: r.end_date })
    unavailability.set(r.doctor_id, list)
  }

  const days = []
  const total = daysInMonth(year, month)
  for (let d = 1; d <= total; d++) {
    const date = isoDate(year, month, d)
    days.push({ date, isWeekend: isWeekendISO(date), isHoliday: holidays.has(date) })
  }

  const firstDayPrev = prevDate(first)
  const pres = await query<{ doctor_id: number }>(`SELECT doctor_id FROM duties WHERE duty_date = $1`, [
    firstDayPrev,
  ])
  const priorDayDoctorIds = new Set(pres.rows.map((r) => r.doctor_id))

  return { year, month, days, doctors, unavailability, priorDayDoctorIds }
}

export async function preview(year: number, month: number): Promise<PreviewResult> {
  const ctx = await buildContext(year, month)
  const result = runEngine(ctx)
  return { assignments: result.assignments, conflicts: result.conflicts }
}

export async function generate(
  year: number,
  month: number,
  actor: Actor,
): Promise<ScheduleDetail> {
  const exists = await query('SELECT id FROM schedules WHERE year = $1 AND month = $2', [
    year,
    month,
  ])
  if (exists.rows.length > 0)
    throw new HttpError(409, 'Schedule already exists for this month; delete it first')

  const ctx = await buildContext(year, month)
  const result = runEngine(ctx)
  if (result.conflicts.length > 0)
    throw new HttpError(
      422,
      `Schedule has ${result.conflicts.length} unfillable day(s); run /schedules/preview for details`,
    )

  const scheduleId = await withTransaction(async (client) => {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO schedules (year, month, status, created_by) VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [year, month, actor.id],
    )
    const id = ins.rows[0]?.id
    if (id === undefined) throw new HttpError(500, 'Failed to create schedule')
    for (const a of result.assignments) {
      await client.query(
        `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, is_holiday, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, a.date, a.doctorId, a.isWeekend, a.isHoliday, a.reason],
      )
    }
    return id
  })
  return getById(scheduleId)
}

export async function list(filters: ScheduleQuery = {}): Promise<ScheduleSummary[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.year !== undefined) {
    params.push(filters.year)
    where.push(`year = $${params.length}`)
  }
  if (filters.month !== undefined) {
    params.push(filters.month)
    where.push(`month = $${params.length}`)
  }
  const sql =
    where.length > 0
      ? `${SELECT_SCHEDULE} WHERE ${where.join(' AND ')} ORDER BY year DESC, month DESC`
      : `${SELECT_SCHEDULE} ORDER BY year DESC, month DESC`
  const res = await query<ScheduleRow>(sql, params)
  return res.rows.map(toSchedule)
}

export async function getById(id: number): Promise<ScheduleDetail> {
  const sres = await query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE id = $1`, [id])
  const schedule = sres.rows[0]
  if (!schedule) throw new HttpError(404, 'Schedule not found')
  const dres = await query<DutyRow>(`${SELECT_DUTY} WHERE du.schedule_id = $1 ORDER BY du.duty_date`, [
    id,
  ])
  return { schedule: toSchedule(schedule), duties: dres.rows.map(toDuty) }
}

export async function remove(id: number): Promise<void> {
  const existing = await query('SELECT id FROM schedules WHERE id = $1', [id])
  if (existing.rows.length === 0) throw new HttpError(404, 'Schedule not found')
  await query('DELETE FROM schedules WHERE id = $1', [id])
}

async function getDutyRow(id: number): Promise<DutyRow> {
  const res = await query<DutyRow>(`${SELECT_DUTY} WHERE du.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Duty not found')
  return row
}

async function getDutyById(id: number): Promise<Duty> {
  return toDuty(await getDutyRow(id))
}

async function validateAssignment(
  scheduleId: number,
  doctorId: number,
  date: string,
  excludeDutyId: number | null,
): Promise<void> {
  const dr = await query<{ max_monthly_duties: number; is_active: boolean }>(
    `SELECT d.max_monthly_duties, u.is_active FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
    [doctorId],
  )
  const doctor = dr.rows[0]
  if (!doctor) throw new HttpError(404, 'Doctor not found')
  if (!doctor.is_active) throw new HttpError(409, 'Constraint violation: doctor inactive')

  const rangesRes = await query<{ start_date: string; end_date: string }>(
    `SELECT start_date, end_date FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $2`,
    [doctorId, date],
  )
  if (
    !isAvailable(
      doctorId,
      date,
      rangesRes.rows.map((r) => ({ start: r.start_date, end: r.end_date })),
    ).ok
  )
    throw new HttpError(409, 'Constraint violation: doctor unavailable on this date')

  const capRes = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 AND doctor_id = $2 AND ($3::int IS NULL OR id <> $3)`,
    [scheduleId, doctorId, excludeDutyId],
  )
  const count = capRes.rows[0]?.n ?? 0
  if (!underCap(count, doctor.max_monthly_duties).ok)
    throw new HttpError(409, 'Constraint violation: monthly cap reached')

  const prev = prevDate(date)
  const next = nextDate(date)
  const nb = await query<{ doctor_id: number }>(
    `SELECT doctor_id FROM duties WHERE duty_date IN ($1, $2)`,
    [prev, next],
  )
  const onDutyAdjacent = nb.rows.some((r) => r.doctor_id === doctorId)
  if (!notConsecutive(onDutyAdjacent).ok)
    throw new HttpError(409, 'Constraint violation: back-to-back')
}

async function isHolidayOn(date: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM holidays WHERE date = $1', [date])
  return res.rows.length > 0
}

export async function addDuty(
  scheduleId: number,
  input: CreateDutyRequest,
  actor: Actor,
): Promise<Duty> {
  const sres = await query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE id = $1`, [scheduleId])
  const schedule = sres.rows[0]
  if (!schedule) throw new HttpError(404, 'Schedule not found')
  if (!inMonth(input.date, schedule.year, schedule.month))
    throw new HttpError(400, 'Date is outside this schedule month')

  const existing = await query('SELECT id FROM duties WHERE schedule_id = $1 AND duty_date = $2', [
    scheduleId,
    input.date,
  ])
  if (existing.rows.length > 0)
    throw new HttpError(409, 'Duty already exists for this date; use PATCH to reassign')

  await validateAssignment(scheduleId, input.doctorId, input.date, null)

  const reason = `manual override by admin #${actor.id}`
  const ins = await query<{ id: number }>(
    `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, is_holiday, reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      scheduleId,
      input.date,
      input.doctorId,
      isWeekendISO(input.date),
      await isHolidayOn(input.date),
      reason,
    ],
  )
  const id = ins.rows[0]?.id
  if (id === undefined) throw new HttpError(500, 'Failed to create duty')
  return getDutyById(id)
}

export async function reassignDuty(
  dutyId: number,
  input: ReassignDutyRequest,
  actor: Actor,
): Promise<Duty> {
  const duty = await getDutyRow(dutyId)
  await validateAssignment(duty.schedule_id, input.doctorId, duty.duty_date, dutyId)
  const reason = `manual override by admin #${actor.id}`
  await query('UPDATE duties SET doctor_id = $1, reason = $2 WHERE id = $3', [
    input.doctorId,
    reason,
    dutyId,
  ])
  return getDutyById(dutyId)
}

export async function removeDuty(dutyId: number): Promise<void> {
  await getDutyRow(dutyId)
  await query('DELETE FROM duties WHERE id = $1', [dutyId])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (schedule.service + all existing api tests).

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm --filter @oncall/api typecheck && pnpm --filter @oncall/api lint`
Expected: PASS with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/schedule.service.ts apps/api/src/__tests__/schedule.service.test.ts
git commit -m "feat(api): schedule service (buildContext, preview, generate, overrides)"
```

## T6 — Controllers, routes, validators, app wiring + route tests

**Files:**
- Create: `apps/api/src/controllers/holiday.controller.ts`
- Create: `apps/api/src/controllers/schedule.controller.ts`
- Create: `apps/api/src/routes/holiday.routes.ts`
- Create: `apps/api/src/routes/schedule.routes.ts`
- Create: `apps/api/src/validators/holiday.ts`
- Create: `apps/api/src/validators/schedule.ts`
- Modify: `apps/api/src/validators/index.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/__tests__/holiday.routes.test.ts`
- Create: `apps/api/src/__tests__/schedule.routes.test.ts`

**Interfaces:**
- Consumes: the two services; `authenticate`, `authorize`, `validate`; shared schemas; `idParams` (existing, in `validators/user.ts`).
- Produces: `holidayRouter` mounted at `/holidays`; `scheduleRouter` mounted at `/schedules` (with nested `/schedules/:id/duties`); `dutyRouter` mounted at `/duties` (for `PATCH/DELETE /:id`).

- [ ] **Step 1: Create `validators/holiday.ts`**

```ts
export {
  createHolidaySchema,
  holidayQuerySchema,
  updateHolidaySchema,
} from '@oncall/shared'
export { idParams } from './user'
```

- [ ] **Step 2: Create `validators/schedule.ts`**

```ts
export {
  createDutySchema,
  createScheduleSchema,
  reassignDutySchema,
  scheduleQuerySchema,
} from '@oncall/shared'
export { idParams } from './user'
```

- [ ] **Step 3: Register the validators**

In `apps/api/src/validators/index.ts`, append:
```ts
export * from './holiday'
export * from './schedule'
```

- [ ] **Step 4: Create `holiday.controller.ts`**

```ts
import type { NextFunction, Request, Response } from 'express'
import type { HolidayQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import * as holidayService from '../services/holiday.service'

export const holidayController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const holidays = await holidayService.list(req.query as HolidayQuery)
      res.status(200).json(ok({ holidays }))
    } catch (err) {
      next(err)
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const holiday = await holidayService.create(req.body)
      res.status(201).json(ok({ holiday }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const holiday = await holidayService.update(Number(req.params.id), req.body)
      res.status(200).json(ok({ holiday }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await holidayService.remove(Number(req.params.id))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 5: Create `schedule.controller.ts`**

```ts
import type { NextFunction, Request, Response } from 'express'
import type { ScheduleQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as scheduleService from '../services/schedule.service'

export const scheduleController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const schedules = await scheduleService.list(req.query as ScheduleQuery)
      res.status(200).json(ok({ schedules }))
    } catch (err) {
      next(err)
    }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const detail = await scheduleService.getById(Number(req.params.id))
      res.status(200).json(ok(detail))
    } catch (err) {
      next(err)
    }
  },
  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await scheduleService.preview(req.body.year, req.body.month)
      res.status(200).json(ok(result))
    } catch (err) {
      next(err)
    }
  },
  async generate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const detail = await scheduleService.generate(req.body.year, req.body.month, req.user)
      res.status(201).json(ok(detail))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await scheduleService.remove(Number(req.params.id))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
  async addDuty(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const duty = await scheduleService.addDuty(Number(req.params.id), req.body, req.user)
      res.status(201).json(ok({ duty }))
    } catch (err) {
      next(err)
    }
  },
  async reassignDuty(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const duty = await scheduleService.reassignDuty(Number(req.params.id), req.body, req.user)
      res.status(200).json(ok({ duty }))
    } catch (err) {
      next(err)
    }
  },
  async removeDuty(req: Request, res: Response, next: NextFunction) {
    try {
      await scheduleService.removeDuty(Number(req.params.id))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 6: Create `holiday.routes.ts`**

```ts
import { Router } from 'express'
import { holidayController } from '../controllers/holiday.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  createHolidaySchema,
  holidayQuerySchema,
  idParams,
  updateHolidaySchema,
} from '../validators/holiday'

export const holidayRouter = Router()

holidayRouter.use(authenticate)
holidayRouter.get('/', validate(holidayQuerySchema, 'query'), holidayController.list)
holidayRouter.post('/', authorize('administrator'), validate(createHolidaySchema, 'body'), holidayController.create)
holidayRouter.patch('/:id', authorize('administrator'), validate(idParams, 'params'), validate(updateHolidaySchema, 'body'), holidayController.update)
holidayRouter.delete('/:id', authorize('administrator'), validate(idParams, 'params'), holidayController.remove)
```

- [ ] **Step 7: Create `schedule.routes.ts` (note `preview` before `/:id`)**

```ts
import { Router } from 'express'
import { scheduleController } from '../controllers/schedule.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  createDutySchema,
  createScheduleSchema,
  idParams,
  reassignDutySchema,
  scheduleQuerySchema,
} from '../validators/schedule'

export const scheduleRouter = Router()

scheduleRouter.use(authenticate)
scheduleRouter.use(authorize('administrator'))

scheduleRouter.get('/', validate(scheduleQuerySchema, 'query'), scheduleController.list)
scheduleRouter.post('/preview', validate(createScheduleSchema, 'body'), scheduleController.preview)
scheduleRouter.post('/', validate(createScheduleSchema, 'body'), scheduleController.generate)
scheduleRouter.get('/:id', validate(idParams, 'params'), scheduleController.getById)
scheduleRouter.delete('/:id', validate(idParams, 'params'), scheduleController.remove)
scheduleRouter.post('/:id/duties', validate(idParams, 'params'), validate(createDutySchema, 'body'), scheduleController.addDuty)

export const dutyRouter = Router()

dutyRouter.use(authenticate)
dutyRouter.use(authorize('administrator'))
dutyRouter.patch('/:id', validate(idParams, 'params'), validate(reassignDutySchema, 'body'), scheduleController.reassignDuty)
dutyRouter.delete('/:id', validate(idParams, 'params'), scheduleController.removeDuty)
```

- [ ] **Step 8: Wire the routers into `app.ts`**

In `apps/api/src/app.ts`, add the imports next to the other router imports:
```ts
import { holidayRouter } from './routes/holiday.routes'
import { dutyRouter, scheduleRouter } from './routes/schedule.routes'
```
and mount them after `app.use('/unavailability', unavailabilityRouter)`:
```ts
app.use('/holidays', holidayRouter)
app.use('/schedules', scheduleRouter)
app.use('/duties', dutyRouter)
```

- [ ] **Step 9: Write the failing holiday route test**

Create `apps/api/src/__tests__/holiday.routes.test.ts`:
```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
vi.mock('../services/holiday.service', () => ({
  list: (...a: unknown[]) => list(...a),
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { holidayRouter } from '../routes/holiday.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/holidays', holidayRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const holiday = { id: 1, name: 'X', date: '2026-09-01', createdAt: '', updatedAt: '' }

beforeEach(() => {
  list.mockReset()
  create.mockReset()
  update.mockReset()
  remove.mockReset()
})

describe('holiday routes', () => {
  it('any authenticated user can list (200); unauthenticated is 401', async () => {
    list.mockResolvedValue([])
    const ok200 = await request(build())
      .get('/holidays')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.holidays).toEqual([])

    const unauth = await request(build()).get('/holidays')
    expect(unauth.status).toBe(401)
  })

  it('admin creates (201); doctor mutate is 403', async () => {
    create.mockResolvedValue(holiday)
    const res = await request(build())
      .post('/holidays')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'X', date: '2026-09-01' })
    expect(res.status).toBe(201)

    const forbidden = await request(build())
      .post('/holidays')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ name: 'X', date: '2026-09-01' })
    expect(forbidden.status).toBe(403)
  })

  it('admin update (200), delete (204); bad id is 400', async () => {
    update.mockResolvedValue(holiday)
    remove.mockResolvedValue(undefined)
    const u = await request(build())
      .patch('/holidays/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Y' })
    expect(u.status).toBe(200)
    const d = await request(build())
      .delete('/holidays/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(d.status).toBe(204)
    const bad = await request(build())
      .patch('/holidays/abc')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Y' })
    expect(bad.status).toBe(400)
  })
})
```

- [ ] **Step 10: Write the failing schedule route test**

Create `apps/api/src/__tests__/schedule.routes.test.ts`:
```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preview = vi.fn()
const generate = vi.fn()
const list = vi.fn()
const getById = vi.fn()
const remove = vi.fn()
const addDuty = vi.fn()
const reassignDuty = vi.fn()
const removeDuty = vi.fn()
vi.mock('../services/schedule.service', () => ({
  preview: (...a: unknown[]) => preview(...a),
  generate: (...a: unknown[]) => generate(...a),
  list: (...a: unknown[]) => list(...a),
  getById: (...a: unknown[]) => getById(...a),
  remove: (...a: unknown[]) => remove(...a),
  addDuty: (...a: unknown[]) => addDuty(...a),
  reassignDuty: (...a: unknown[]) => reassignDuty(...a),
  removeDuty: (...a: unknown[]) => removeDuty(...a),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { dutyRouter, scheduleRouter } from '../routes/schedule.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/schedules', scheduleRouter)
  app.use('/duties', dutyRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const detail = () => ({
  schedule: {
    id: 1,
    year: 2026,
    month: 9,
    status: 'draft',
    createdBy: 1,
    createdAt: '',
    updatedAt: '',
  },
  duties: [],
})
const duty = (id: number, doctorId: number) => ({
  id,
  scheduleId: 1,
  dutyDate: '2026-09-05',
  doctorId,
  doctorFirstName: 'A',
  doctorLastName: 'B',
  isWeekend: false,
  isHoliday: false,
  reason: 'manual override by admin #1',
  createdAt: '',
})

beforeEach(() => {
  [preview, generate, list, getById, remove, addDuty, reassignDuty, removeDuty].forEach((m) =>
    m.mockReset(),
  )
})

describe('schedule routes', () => {
  it('doctor is forbidden from schedule routes (403); unauthenticated is 401', async () => {
    const forbidden = await request(build())
      .post('/schedules/preview')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ year: 2026, month: 9 })
    expect(forbidden.status).toBe(403)

    const unauth = await request(build()).get('/schedules')
    expect(unauth.status).toBe(401)
  })

  it('admin preview returns 200 with assignments + conflicts', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [] })
    const res = await request(build())
      .post('/schedules/preview')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(res.status).toBe(200)
    expect(res.body.data.assignments).toEqual([])
    expect(res.body.data.conflicts).toEqual([])
  })

  it('admin generate 201; 409 exists; 422 unfillable', async () => {
    generate.mockResolvedValue(detail())
    const ok201 = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(ok201.status).toBe(201)

    generate.mockRejectedValue(Object.assign(new Error('exists'), { status: 409 }))
    const exists = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(exists.status).toBe(409)

    generate.mockRejectedValue(Object.assign(new Error('unfillable'), { status: 422 }))
    const unfillable = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(unfillable.status).toBe(422)
  })

  it('admin list (200), getById (200), delete (204)', async () => {
    list.mockResolvedValue([])
    getById.mockResolvedValue(detail())
    remove.mockResolvedValue(undefined)
    const l = await request(build())
      .get('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(l.status).toBe(200)
    const g = await request(build())
      .get('/schedules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(g.status).toBe(200)
    expect(g.body.data.schedule.id).toBe(1)
    const d = await request(build())
      .delete('/schedules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(d.status).toBe(204)
  })

  it('admin add duty (201); reassign (200); remove duty (204)', async () => {
    addDuty.mockResolvedValue(duty(5, 3))
    reassignDuty.mockResolvedValue(duty(5, 4))
    removeDuty.mockResolvedValue(undefined)

    const a = await request(build())
      .post('/schedules/1/duties')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ date: '2026-09-05', doctorId: 3 })
    expect(a.status).toBe(201)

    const p = await request(build())
      .patch('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 4 })
    expect(p.status).toBe(200)

    const r = await request(build())
      .delete('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(r.status).toBe(204)
  })
})
```

- [ ] **Step 11: Run the route tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (holiday.routes + schedule.routes + all existing api tests).

- [ ] **Step 12: Run typecheck and lint**

Run: `pnpm --filter @oncall/api typecheck && pnpm --filter @oncall/api lint`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/controllers apps/api/src/routes apps/api/src/validators apps/api/src/app.ts apps/api/src/__tests__/holiday.routes.test.ts apps/api/src/__tests__/schedule.routes.test.ts
git commit -m "feat(api): holiday + schedule routes (admin-only, preview, generate, overrides)"
```

## T7 — Doctor-deletion retrofit (FK RESTRICT guard) + test

**Why:** T2 added `duties.doctor_id … ON DELETE RESTRICT`. Without a service-level pre-check, hard-deleting a doctor who has duties would surface as a raw Postgres FK error (500) and, worse, the RESTRICT exists precisely to protect historical schedule integrity. Add the friendly `409` and guide admins to disable instead.

**Files:**
- Modify: `apps/api/src/services/doctor.service.ts` (the `remove` function)
- Modify: `apps/api/src/__tests__/doctor.service.test.ts` (update the cascade test's mock sequence + add a 409 case)

**Interfaces:**
- Changes: `remove(id)` now returns `409 'Cannot delete a doctor with scheduled duties; set them inactive instead'` when a `duties` row exists for the doctor. All other `doctor.service` behaviour is unchanged.

- [ ] **Step 1: Update `doctor.service.remove`**

In `apps/api/src/services/doctor.service.ts`, replace the `remove` function:
```ts
export async function remove(id: number): Promise<void> {
  const existing = await query<{ user_id: number }>(
    'SELECT user_id FROM doctors WHERE id = $1',
    [id],
  )
  const row = existing.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  const duties = await query('SELECT 1 FROM duties WHERE doctor_id = $1 LIMIT 1', [id])
  if (duties.rows.length > 0)
    throw new HttpError(
      409,
      'Cannot delete a doctor with scheduled duties; set them inactive instead',
    )
  await query('DELETE FROM users WHERE id = $1', [row.user_id])
}
```

- [ ] **Step 2: Update the `doctor.service.test.ts` remove tests**

In `apps/api/src/__tests__/doctor.service.test.ts`, replace the two existing `remove` tests with:
```ts
  it('remove deletes the underlying user row (cascade) when no duties exist', async () => {
    query.mockResolvedValueOnce({ rows: [{ user_id: 7 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(2)
    const del = query.mock.calls[2]?.[0] as string
    expect(del).toContain('DELETE FROM users')
    expect((query.mock.calls[2]?.[1] as unknown[])[0]).toBe(7)
  })

  it('remove 409 when the doctor has scheduled duties', async () => {
    query.mockResolvedValueOnce({ rows: [{ user_id: 7 }] })
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    await expect(remove(2)).rejects.toMatchObject({ status: 409 })
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM users'))).toBe(false)
  })

  it('remove throws 404 when doctor missing', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @oncall/api test`
Expected: PASS (updated doctor.service tests + all other api tests).

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm --filter @oncall/api typecheck && pnpm --filter @oncall/api lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/doctor.service.ts apps/api/src/__tests__/doctor.service.test.ts
git commit -m "feat(api): block doctor deletion when scheduled duties exist (409)"
```

---

## T8 — README (Phase 5 status + DoD) + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the Phase 5 status paragraph**

In `README.md`, after the Phase 4 paragraph (the one beginning `**Phase 4 — Availability Management** is complete.`), insert:
```md
**Phase 5 — Scheduling Engine** is complete (backend). This phase adds a `holidays` table (admin-managed), `schedules` + `duties` tables, and a pure greedy scheduling engine (weighted score, deterministic tie-breaks) that respects monthly caps, unavailability, and no back-to-back duties (including across month boundaries), while balancing workload, weekends, and holidays. Admins can preview a month (`POST /schedules/preview` returns proposed assignments + unfillable-day conflicts), generate atomically (`POST /schedules` — 201 / 409 if the month exists / 422 if unfillable), and manually add/reassign/remove individual duties (re-validated against the same hard constraints). The Schedule Management UI is Phase 6.
```

- [ ] **Step 2: Update the "Remaining" line**

In `README.md`, replace:
```md
Remaining business features (scheduling, schedule UI, statistics, reports) arrive in later phases.
```
with:
```md
Remaining business features (schedule UI, statistics, reports) arrive in later phases.
```

- [ ] **Step 3: Bump the roadmap**

In `README.md`, replace:
```md
5. Scheduling Engine
```
with:
```md
5. Scheduling Engine (complete)
```

- [ ] **Step 4: Add the Phase 5 Definition of Done**

In `README.md`, after the `## Definition of Done (Phase 4)` block, add:
```md
## Definition of Done (Phase 5)

- `pnpm install`, `pnpm db:setup`, and `pnpm dev` succeed from a clean clone; sample `holidays` rows are seeded (no schedule seed — schedules are produced via the API).
- The engine respects every hard constraint: no doctor over `max_monthly_duties`, no duty during unavailability, no back-to-back (including the cross-month boundary), inactive doctors excluded.
- Admin can `POST /schedules/preview` (200 `{assignments, conflicts}`), `POST /schedules` (201; 409 if the month exists; 422 if unfillable and nothing persisted), `GET /schedules` / `GET /schedules/:id`, `DELETE /schedules/:id`, and override duties via `POST /schedules/:id/duties` / `PATCH /duties/:id` / `DELETE /duties/:id` with 409 on any constraint violation. Doctors get 403 on all schedule/duty routes and on holiday mutations; any authenticated user can `GET /holidays`.
- For solvable months, weekend/holiday counts stay within ±1 across eligible doctors; every duty carries a persisted `reason`.
- Deleting a doctor with duties → 409 (disable instead); deleting a schedule cascades its duties.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo.
```

- [ ] **Step 5: Add the documentation links**

In `README.md`, after the Phase 4 implementation plan documentation line, add:
```md
- Phase 5 design: `docs/superpowers/specs/2026-08-07-phase5-scheduling-engine-design.md`
- Phase 5 implementation plan: `docs/superpowers/plans/2026-08-07-phase5-scheduling-engine-plan.md`
```

- [ ] **Step 6: Final verification**

Run each from the repo root and confirm PASS:
```bash
pnpm db:setup
pnpm typecheck
pnpm lint
pnpm test
```
Expected: all four succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: Phase 5 scheduling engine status, definition of done"
```

---

## Spec coverage self-check

- **§1 Purpose / backend-only** → T3–T6 (no web files touched).
- **§2 Decisions: pure engine module** → T3. **schedules+duties+holidays tables** → T2. **reject-if-exists** → T5 `generate` existence check. **dry-run preview + atomic generate** → T5 `preview`/`generate`. **manual overrides** → T5 `addDuty`/`reassignDuty`/`removeDuty` + T6 routes. **persisted reason** → T3 engine + T5 override reason strings. **cross-month back-to-back** → T3 `priorDayDoctorIds` + T5 buildContext preload. **doctor-deletion RESTRICT** → T2 schema + T7 retrofit.
- **§3 Route tables (holidays / schedules / duties)** → T6.
- **§4 Schema + seed** → T2.
- **§5 Shared types & schemas** → T1.
- **§6 Engine internals (types/constraints/scoring/engine)** → T3.
- **§6 buildContext / preview / generate / list / get / remove / validateAssignment / overrides** → T5.
- **§7 Shared contract** → T1.
- **§8 Security (RBAC, parameterized, FK integrity)** → T6 routes + T7. **Testing strategy** → tests in T1, T3, T4, T5, T6, T7. **DoD** → T8 verification.





