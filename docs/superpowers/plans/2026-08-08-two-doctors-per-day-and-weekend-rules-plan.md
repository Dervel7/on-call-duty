# Two Doctors Per Day + Weekend/Friday Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine assign two doctors per on-call day, enforce a hard cap of one Saturday and one Sunday per doctor per month, and add a soft Friday-distribution scoring term — across engine, service, stats, schema, seed, and UI.

**Architecture:** Extend the existing single-pass greedy (Approach A). The `duties` unique constraint moves from `(schedule_id, duty_date)` to `(schedule_id, duty_date, doctor_id)` so two distinct doctors can share a day. `DaySpec` gains `dayOfWeek`; the engine picks the top two winners per day; `byDate` becomes a `Map<string, Set<number>>`; Saturday/Sunday caps reuse `underCap(count, 1)`; Friday gets a soft `W_FRIDAY` term. Stats coverage redefines "filled" as a day with two duties. The frontend `DutyCalendar` renders two slots per cell.

**Tech Stack:** Node.js + TypeScript + Express + `pg` + Zod; Vue 3 + Vite + TypeScript + Pinia; `@oncall/shared`; Vitest. PostgreSQL 14+.

## Global Constraints

- **No ORM** — parameterized SQL only (`query<T>(text, params)` and `withTransaction` from `apps/api/src/db/client`); no reliance on PG error codes.
- **No Prettier** — format on save with Volar; do not add a Prettier config or a `format` script.
- **Theme tokens only** in Vue templates (`text-foreground`, `text-primary`, `bg-primary/10`, `bg-muted`, `text-muted-foreground`, `text-destructive`, `border-input`, `bg-background`, `bg-card`) — no hardcoded hex.
- **Response envelope / RBAC** unchanged by this change — all schedule/duty routes stay admin-only; client `doctorId`/`date` re-checked server-side.
- **Engine purity** — `apps/api/src/scheduling/` imports only types and pure math; never `db/client`, never Express.
- **Tests must stay green** — every task ends with `pnpm typecheck`, `pnpm lint`, `pnpm test` passing across the monorepo. Existing tests that encode the old 1-doctor-per-day contract are updated within the task that changes the contract (this is test maintenance, not new test authoring).
- **Node 20+ / pnpm 10+.** Verify from repo root: `pnpm typecheck`, `pnpm lint`, `pnpm test`. DB smoke: `pnpm db:setup`.
- **Constants are fixed system rules** (like the existing consecutive rule) — `DOCTORS_PER_DAY = 2`, `MAX_SATURDAY_DUTIES = 1`, `MAX_SUNDAY_DUTIES = 1`, `W_FRIDAY = 2`. Not per-doctor DB columns.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/api/src/scheduling/dates.ts` | Modify | Add `dayOfWeekISO(date)` |
| `apps/api/src/scheduling/types.ts` | Modify | `DaySpec` +`dayOfWeek`; `CandidateScore` +`friday` |
| `apps/api/src/scheduling/constraints.ts` | Modify | Add `MAX_SATURDAY_DUTIES`, `MAX_SUNDAY_DUTIES` constants |
| `apps/api/src/scheduling/scoring.ts` | Modify | Add `W_FRIDAY`, `fridayBudget`; double `weekendBudget`/`holidayBudget`; `scoreCandidate` +friday args |
| `apps/api/src/scheduling/engine.ts` | Modify | `DOCTORS_PER_DAY=2`; pick 2 winners; `byDate`→Set; +sat/sun/fri counters; conflict short-fill |
| `apps/api/src/services/schedule.service.ts` | Modify | `buildContext` +dayOfWeek; `computeEligibility` Set-aware +weekend caps; `validateAssignment` +caps; `addDuty` allow 2nd |
| `apps/api/src/services/stats.service.ts` | Modify | Coverage `filled` = dates with 2 duties |
| `database/schema.sql` | Modify | `UNIQUE(schedule_id, duty_date, doctor_id)` migration |
| `database/seed.sql` | Modify | Expand to ~12 doctors |
| `apps/api/src/scheduling/__tests__/engine.test.ts` | Modify | Fix helpers/assertions for 2-per-day + friday reason |
| `apps/api/src/scheduling/__tests__/scoring.test.ts` | Modify | Fix helpers; doubled budgets; friday term; 9-arg `scoreCandidate` |
| `apps/api/src/__tests__/schedule.service.test.ts` | Modify | generate fixture ≥12 doctors; addDuty 2-slot; validateAssignment caps; computeEligibility Set+caps |
| `apps/api/src/__tests__/stats.service.test.ts` | Modify | coverage `filled` = 2-duty dates (GROUP BY mock) |
| `apps/web/src/components/schedule/DutyCalendar.vue` | Modify | Two slots per cell; `assignmentByDate`→array; emit `select(date, slotIndex, value)` |
| `apps/web/src/pages/ScheduleDetailPage.vue` | Modify | `dutyIdByDate`→`number[]`; per-slot onSelect |
| `apps/web/src/pages/SchedulePreviewPage.vue` | Modify | `assignmentByDate`→array per date |
| `apps/web/src/pages/ReportsPage.vue` | Modify | Roster groups by date, up to 2 doctors/row |
| `apps/web/src/components/dashboard/AdminDashboard.vue` | Modify | Coverage copy → "fully staffed (2 doctors)" |
| `apps/web/src/__tests__/ReportsPage.test.ts` | Modify | Coverage/fixtures for 2-per-day semantics |

---

## Task 1: Database schema migration + seed expansion

**Files:**
- Modify: `database/schema.sql` (duties table, ~lines 94–107)
- Modify: `database/seed.sql` (doctor seed block, ~lines 22–42)

**Interfaces:**
- Consumes: nothing.
- Produces: a `duties` table that allows two rows per `(schedule_id, duty_date)` with distinct `doctor_id`; a seed with ~12 active doctors.

- [ ] **Step 1: Update the inline duties UNIQUE constraint in `database/schema.sql`**

In the `CREATE TABLE IF NOT EXISTS duties` block, change the trailing unique constraint line from:

```sql
  UNIQUE (schedule_id, duty_date)
```

to:

```sql
  UNIQUE (schedule_id, duty_date, doctor_id)
```

- [ ] **Step 2: Append the idempotent migration to `database/schema.sql`**

Append at the end of the file:

```sql
-- Two-doctors-per-day: allow two distinct doctors per (schedule, date)
ALTER TABLE duties DROP CONSTRAINT IF EXISTS duties_schedule_id_duty_date_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duties_schedule_id_duty_date_doctor_id_key') THEN
    ALTER TABLE duties ADD CONSTRAINT duties_schedule_id_duty_date_doctor_id_key
      UNIQUE (schedule_id, duty_date, doctor_id);
  END IF;
END $$;
```

- [ ] **Step 3: Expand the doctor seed in `database/seed.sql`**

Replace the two doctor seed statements (the `INSERT INTO users … VALUES (dr1,dr2,dr3)` block and the matching `INSERT INTO doctors` block) with a 12-doctor version. Keep `dr1`/`dr2`/`dr3` ids stable (existing unavailability references use `dr1`/`dr2`). Use these exact values:

```sql
-- Phase 3: seed sample doctors (password = email, change on first login)
INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
VALUES
  ('dr1@oncall.local', 'dr1',  '$2b$12$sf0hxnuWvwI17HpZNo.VBubjp35/R3CXtabJsFMpjQxA/erV9m21G', 'doctor', 'Jane',   'Roe',     TRUE),
  ('dr2@oncall.local', 'dr2',  '$2b$12$CxcEXDtGy52WGatK9YCNlOdyS6yp1uNd4Ac8f68YZOmHYXN2HR8Sq', 'doctor', 'John',   'Smith',   TRUE),
  ('dr3@oncall.local', 'dr3',  '$2b$12$nXzGkWp0gNlyFOj8/dp6oOQ0BH7twg.VkgYF95PqOzagOTZsBrJOW', 'doctor', 'Maria',  'Garcia',  TRUE),
  ('dr4@oncall.local', 'dr4',  '$2b$12$33333333333333333333333333333333333333333333333333',    'doctor', 'Ahmed',  'Hassan',  TRUE),
  ('dr5@oncall.local', 'dr5',  '$2b$12$44444444444444444444444444444444444444444444444444444',    'doctor', 'Sara',   ' Cohen',  TRUE),
  ('dr6@oncall.local', 'dr6',  '$2b$12$55555555555555555555555555555555555555555555555555555',    'doctor', 'Liam',   'Novak',   TRUE),
  ('dr7@oncall.local', 'dr7',  '$2b$12$66666666666666666666666666666666666666666666666666666',    'doctor', 'Emma',   'Muller',  TRUE),
  ('dr8@oncall.local', 'dr8',  '$2b$12$77777777777777777777777777777777777777777777777777777',    'doctor', 'Noah',   'Rossi',   TRUE),
  ('dr9@oncall.local', 'dr9',  '$2b$12$88888888888888888888888888888888888888888888888888',    'doctor', 'Olivia', 'Petrov',  TRUE),
  ('dr10@oncall.local','dr10', '$2b$12$99999999999999999999999999999999999999999999999999',    'doctor', 'Lucas',  'Diaz',    TRUE),
  ('dr11@oncall.local','dr11', '$2b$12$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',    'doctor', 'Ava',    'Kowalski',TRUE),
  ('dr12@oncall.local','dr12', '$2b$12$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',    'doctor', 'Ethan',  'Yamada',  TRUE)
ON CONFLICT (email) DO UPDATE SET
  username      = EXCLUDED.username,
  password_hash = EXCLUDED.password_hash,
  role          = EXCLUDED.role,
  is_active     = TRUE,
  updated_at    = NOW();

INSERT INTO doctors (user_id, max_monthly_duties)
VALUES
  ((SELECT id FROM users WHERE email = 'dr1@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr2@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr3@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr4@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr5@oncall.local'),  7),
  ((SELECT id FROM users WHERE email = 'dr6@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr7@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr8@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr9@oncall.local'),  6),
  ((SELECT id FROM users WHERE email = 'dr10@oncall.local'), 5),
  ((SELECT id FROM users WHERE email = 'dr11@oncall.local'), 5),
  ((SELECT id FROM users WHERE email = 'dr12@oncall.local'), 5)
ON CONFLICT (user_id) DO UPDATE SET
  max_monthly_duties = EXCLUDED.max_monthly_duties,
  updated_at         = NOW();
```

> Note: the placeholder bcrypt hashes for dr4–dr12 are deliberately invalid-looking but well-formed (60 chars, `$2b$12$` prefix). They satisfy the `password_hash TEXT NOT NULL` column; login for seeded demo doctors is not part of any test. dr1–dr3 keep their original working hashes. The unavailability seed (`dr1`, `dr2`) and holiday seed below remain unchanged — they already follow this block.

- [ ] **Step 4: Verify the DB applies cleanly**

Run: `pnpm db:setup`
Expected: completes without errors; the `DO $$ … $$` block runs and the new constraint exists. (If a local Postgres is unavailable in the execution environment, skip this step and note it — the SQL is idempotent and will be validated at integration time.)

- [ ] **Step 5: Commit**

```bash
git add database/schema.sql database/seed.sql
git commit -m "feat(db): allow two doctors per duty day; expand seed to 12 doctors"
```

---

## Task 2: Scheduling pure module (dates, types, constraints, scoring, engine) + tests

**Files:**
- Modify: `apps/api/src/scheduling/dates.ts`
- Modify: `apps/api/src/scheduling/types.ts`
- Modify: `apps/api/src/scheduling/constraints.ts`
- Modify: `apps/api/src/scheduling/scoring.ts`
- Modify: `apps/api/src/scheduling/engine.ts`
- Modify: `apps/api/src/scheduling/__tests__/scoring.test.ts`
- Modify: `apps/api/src/scheduling/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (exported, used by Task 3):
  - `dayOfWeekISO(date: string): number` (0=Sun…6=Sat) from `dates.ts`
  - `DaySpec` with required `dayOfWeek: number`; `CandidateScore` with `friday: number`
  - `MAX_SATURDAY_DUTIES`, `MAX_SUNDAY_DUTIES` from `constraints.ts`
  - `W_FRIDAY`, `fridayBudget`, doubled `weekendBudget`/`holidayBudget`, 9-arg `scoreCandidate(doctor, day, dutiesThisMonth, weekendDuties, holidayDuties, fridayDuties, weekendBudgetValue, holidayBudgetValue, fridayBudgetValue)` from `scoring.ts`
  - `DOCTORS_PER_DAY` and `generate(ctx)` returning two `AssignmentPlan`s per filled day from `engine.ts`

- [ ] **Step 1: Add `dayOfWeekISO` to `apps/api/src/scheduling/dates.ts`**

Append:

```ts
export function dayOfWeekISO(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}
```

- [ ] **Step 2: Update `apps/api/src/scheduling/types.ts`**

In `DaySpec`, add `dayOfWeek`:

```ts
export interface DaySpec {
  date: string
  dayOfWeek: number   // 0=Sun … 6=Sat
  isWeekend: boolean
  isHoliday: boolean
}
```

In `CandidateScore`, add `friday`:

```ts
export interface CandidateScore {
  score: number
  workload: number
  weekend: number
  holiday: number
  friday: number
}
```

Leave `DoctorSpec`, `SchedulingContext`, `AssignmentPlan`, `ConflictPlan`, `GenerateResult` unchanged.

- [ ] **Step 3: Add weekend-cap constants to `apps/api/src/scheduling/constraints.ts`**

Append after the existing predicates:

```ts
export const MAX_SATURDAY_DUTIES = 1
export const MAX_SUNDAY_DUTIES = 1
```

(`underCap(count, 1)` is reused at call-sites — no new predicate function needed.)

- [ ] **Step 4: Rewrite `apps/api/src/scheduling/scoring.ts`**

Replace the entire file with:

```ts
import type { CandidateScore, DaySpec, DoctorSpec } from './types'

export const W_WORKLOAD = 3
export const W_WEEKEND = 4
export const W_HOLIDAY = 4
export const W_FRIDAY = 2

export function weekendBudget(weekendDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((2 * weekendDays) / activeDoctors)
}

export function holidayBudget(holidayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((2 * holidayDays) / activeDoctors)
}

export function fridayBudget(fridayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((2 * fridayDays) / activeDoctors)
}

export function scoreCandidate(
  doctor: DoctorSpec,
  day: DaySpec,
  dutiesThisMonth: number,
  weekendDuties: number,
  holidayDuties: number,
  fridayDuties: number,
  weekendBudgetValue: number,
  holidayBudgetValue: number,
  fridayBudgetValue: number,
): CandidateScore {
  const workload = (doctor.maxMonthlyDuties - dutiesThisMonth) * W_WORKLOAD
  const weekend = day.isWeekend ? Math.max(0, weekendBudgetValue - weekendDuties) * W_WEEKEND : 0
  const holiday = day.isHoliday ? Math.max(0, holidayBudgetValue - holidayDuties) * W_HOLIDAY : 0
  const friday = day.dayOfWeek === 5 ? Math.max(0, fridayBudgetValue - fridayDuties) * W_FRIDAY : 0
  return { score: workload + weekend + holiday + friday, workload, weekend, holiday, friday }
}
```

- [ ] **Step 5: Rewrite `apps/api/src/scheduling/engine.ts`**

Replace the entire file with:

```ts
import { prevDate } from './dates'
import { isAvailable, notConsecutive, underCap, MAX_SATURDAY_DUTIES, MAX_SUNDAY_DUTIES } from './constraints'
import { holidayBudget, scoreCandidate, weekendBudget, fridayBudget } from './scoring'
import type {
  AssignmentPlan,
  CandidateScore,
  ConflictPlan,
  DoctorSpec,
  GenerateResult,
  SchedulingContext,
} from './types'

export const DOCTORS_PER_DAY = 2

interface Eligible {
  doctor: DoctorSpec
  score: CandidateScore
}

interface RunState {
  total: Map<number, number>
  weekend: Map<number, number>
  holiday: Map<number, number>
  saturday: Map<number, number>
  sunday: Map<number, number>
  friday: Map<number, number>
  byDate: Map<string, Set<number>>
}

export function generate(ctx: SchedulingContext): GenerateResult {
  const assignments: AssignmentPlan[] = []
  const conflicts: ConflictPlan[] = []

  const state: RunState = {
    total: new Map(),
    weekend: new Map(),
    holiday: new Map(),
    saturday: new Map(),
    sunday: new Map(),
    friday: new Map(),
    byDate: new Map(),
  }
  for (const d of ctx.doctors) {
    state.total.set(d.id, 0)
    state.weekend.set(d.id, 0)
    state.holiday.set(d.id, 0)
    state.saturday.set(d.id, 0)
    state.sunday.set(d.id, 0)
    state.friday.set(d.id, 0)
  }

  const activeCount = ctx.doctors.length
  const weekendDays = ctx.days.filter((d) => d.isWeekend).length
  const holidayDays = ctx.days.filter((d) => d.isHoliday).length
  const fridayDays = ctx.days.filter((d) => d.dayOfWeek === 5).length
  const wBudget = weekendBudget(weekendDays, activeCount)
  const hBudget = holidayBudget(holidayDays, activeCount)
  const fBudget = fridayBudget(fridayDays, activeCount)
  const firstDay = ctx.days[0]
  const firstDayPrev = firstDay ? prevDate(firstDay.date) : ''

  for (const day of ctx.days) {
    const eligible: Eligible[] = []
    const tally = { unavailable: 0, 'at cap': 0, 'at weekend cap': 0, 'back-to-back': 0 }

    for (const doctor of ctx.doctors) {
      const ranges = ctx.unavailability.get(doctor.id)
      if (!isAvailable(doctor.id, day.date, ranges).ok) {
        tally.unavailable++
        continue
      }
      if (!underCap(state.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties).ok) {
        tally['at cap']++
        continue
      }
      if (day.dayOfWeek === 6 && !underCap(state.saturday.get(doctor.id) ?? 0, MAX_SATURDAY_DUTIES).ok) {
        tally['at weekend cap']++
        continue
      }
      if (day.dayOfWeek === 0 && !underCap(state.sunday.get(doctor.id) ?? 0, MAX_SUNDAY_DUTIES).ok) {
        tally['at weekend cap']++
        continue
      }
      const prev = prevDate(day.date)
      const onDutyYesterday =
        prev === firstDayPrev
          ? ctx.priorDayDoctorIds.has(doctor.id)
          : state.byDate.get(prev)?.has(doctor.id) ?? false
      if (!notConsecutive(onDutyYesterday).ok) {
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
          state.friday.get(doctor.id) ?? 0,
          wBudget,
          hBudget,
          fBudget,
        ),
      })
    }

    if (eligible.length === 0) {
      conflicts.push(conflictFor(day.date, activeCount, tally, 0))
      continue
    }

    eligible.sort(
      (a, b) =>
        b.score.score - a.score.score ||
        (state.total.get(a.doctor.id) ?? 0) - (state.total.get(b.doctor.id) ?? 0) ||
        (state.weekend.get(a.doctor.id) ?? 0) - (state.weekend.get(b.doctor.id) ?? 0) ||
        a.doctor.id - b.doctor.id,
    )

    const winners = eligible.slice(0, DOCTORS_PER_DAY)
    for (const winner of winners) {
      assignments.push({
        date: day.date,
        doctorId: winner.doctor.id,
        doctorFirstName: winner.doctor.firstName,
        doctorLastName: winner.doctor.lastName,
        isWeekend: day.isWeekend,
        isHoliday: day.isHoliday,
        reason: `score ${winner.score.score} (workload +${winner.score.workload}, weekend +${winner.score.weekend}, holiday +${winner.score.holiday}, friday +${winner.score.friday})${describeTiebreak(winner, eligible, state)}`,
      })
      state.total.set(winner.doctor.id, (state.total.get(winner.doctor.id) ?? 0) + 1)
      state.byDate.set(day.date, (state.byDate.get(day.date) ?? new Set()).add(winner.doctor.id))
      if (day.isWeekend)
        state.weekend.set(winner.doctor.id, (state.weekend.get(winner.doctor.id) ?? 0) + 1)
      if (day.isHoliday)
        state.holiday.set(winner.doctor.id, (state.holiday.get(winner.doctor.id) ?? 0) + 1)
      if (day.dayOfWeek === 6)
        state.saturday.set(winner.doctor.id, (state.saturday.get(winner.doctor.id) ?? 0) + 1)
      if (day.dayOfWeek === 0)
        state.sunday.set(winner.doctor.id, (state.sunday.get(winner.doctor.id) ?? 0) + 1)
      if (day.dayOfWeek === 5)
        state.friday.set(winner.doctor.id, (state.friday.get(winner.doctor.id) ?? 0) + 1)
    }

    if (winners.length < DOCTORS_PER_DAY) {
      conflicts.push(conflictFor(day.date, activeCount, tally, winners.length))
    }
  }

  return { assignments, conflicts }
}

function conflictFor(
  date: string,
  activeCount: number,
  tally: { unavailable: number; 'at cap': number; 'at weekend cap': number; 'back-to-back': number },
  assigned: number,
): ConflictPlan {
  return {
    date,
    detail: `only ${assigned} of ${DOCTORS_PER_DAY} doctors assigned; of ${activeCount} active doctor(s): ${tally.unavailable} unavailable, ${tally['at cap']} at monthly cap, ${tally['at weekend cap']} at weekend cap, ${tally['back-to-back']} back-to-back`,
  }
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

- [ ] **Step 5b: Export `DOCTORS_PER_DAY` from the scheduling barrel**

The barrel `apps/api/src/scheduling/index.ts` only does `export { generate } from './engine'`, so `DOCTORS_PER_DAY` is not reachable via `'../scheduling'` (which Task 3 needs). Change that line to:

```ts
export { generate, DOCTORS_PER_DAY } from './engine'
```

(`MAX_SATURDAY_DUTIES`/`MAX_SUNDAY_DUTIES` are already reachable through `export * from './constraints'`.)

- [ ] **Step 6: Update `apps/api/src/scheduling/__tests__/scoring.test.ts`**

The helpers must include `dayOfWeek`; `scoreCandidate` now takes 9 args; budgets are doubled. Replace the helpers and the budget test; keep the workload/weekend/holiday term logic but pass `dayOfWeek`. Full replacement:

```ts
import { describe, expect, it } from 'vitest'
import {
  W_FRIDAY,
  W_HOLIDAY,
  W_WEEKEND,
  W_WORKLOAD,
  fridayBudget,
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
const weekday = (d: string): DaySpec => ({ date: d, dayOfWeek: 3, isWeekend: false, isHoliday: false })
const weekend = (d: string): DaySpec => ({ date: d, dayOfWeek: 6, isWeekend: true, isHoliday: false })
const holiday = (d: string): DaySpec => ({ date: d, dayOfWeek: 3, isWeekend: false, isHoliday: true })
const friday = (d: string): DaySpec => ({ date: d, dayOfWeek: 5, isWeekend: false, isHoliday: false })

describe('scoring', () => {
  it('budgets use 2-slots/day ceiling division and 0 on no doctors', () => {
    expect(weekendBudget(8, 3)).toBe(6) // ceil(16/3)
    expect(weekendBudget(9, 3)).toBe(6) // ceil(18/3)
    expect(holidayBudget(0, 3)).toBe(0)
    expect(weekendBudget(8, 0)).toBe(0)
    expect(fridayBudget(4, 8)).toBe(1) // ceil(8/8)
    expect(fridayBudget(0, 8)).toBe(0)
  })

  it('workload term favors doctors with more remaining slots', () => {
    const s0 = scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 0, 0, 0, 0, 0, 0, 0)
    const s6 = scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 6, 0, 0, 0, 0, 0, 0)
    expect(s0.workload).toBe(7 * W_WORKLOAD)
    expect(s6.workload).toBe(1 * W_WORKLOAD)
    expect(s0.score - s6.score).toBe(6 * W_WORKLOAD)
  })

  it('weekend term only applies on weekend days and clamps at 0', () => {
    const onWeekend = scoreCandidate(doctor(1, 7), weekend('2026-09-05'), 0, 2, 0, 0, 3, 0, 0)
    const overServed = scoreCandidate(doctor(1, 7), weekend('2026-09-05'), 0, 5, 0, 0, 3, 0, 0)
    expect(onWeekend.weekend).toBe((3 - 2) * W_WEEKEND)
    expect(overServed.weekend).toBe(0)
    expect(scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 0, 0, 0, 0, 3, 0, 0).weekend).toBe(0)
  })

  it('holiday term only applies on holiday days', () => {
    expect(scoreCandidate(doctor(1, 7), holiday('2026-09-01'), 0, 0, 0, 0, 0, 2, 0).holiday).toBe(
      2 * W_HOLIDAY,
    )
    expect(scoreCandidate(doctor(1, 7), weekday('2026-09-02'), 0, 0, 0, 0, 0, 2, 0).holiday).toBe(0)
  })

  it('friday term only applies on Fridays (dayOfWeek 5) and clamps at 0', () => {
    expect(scoreCandidate(doctor(1, 7), friday('2026-09-04'), 0, 0, 0, 0, 0, 0, 2).friday).toBe(
      2 * W_FRIDAY,
    )
    expect(scoreCandidate(doctor(1, 7), weekday('2026-09-03'), 0, 0, 0, 0, 0, 0, 2).friday).toBe(0)
    const overServed = scoreCandidate(doctor(1, 7), friday('2026-09-04'), 0, 0, 0, 3, 0, 0, 2)
    expect(overServed.friday).toBe(0)
  })
})
```

- [ ] **Step 7: Update `apps/api/src/scheduling/__tests__/engine.test.ts`**

The `day()` helper must set `dayOfWeek`; assertions encoding 1-per-day change. Replace the whole file with a fixture-rich version. Use enough doctors (≥3) so two can be picked per day; for the "lone doctor" scenario expect a short-fill conflict. Full replacement:

```ts
import { describe, expect, it } from 'vitest'
import { DOCTORS_PER_DAY, generate } from '../engine'
import { dayOfWeekISO } from '../dates'
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
  dayOfWeek: dayOfWeekISO(d),
  isWeekend,
  isHoliday,
})

describe('engine.generate', () => {
  it('assigns two distinct doctors per fillable day', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1), dr(2), dr(3)]))
    expect(conflicts).toEqual([])
    for (const date of ['2026-09-01', '2026-09-03', '2026-09-05']) {
      const picked = assignments.filter((a) => a.date === date).map((a) => a.doctorId)
      expect(picked).toHaveLength(DOCTORS_PER_DAY)
      expect(new Set(picked).size).toBe(DOCTORS_PER_DAY) // distinct
    }
    expect(assignments[0]?.reason).toMatch(
      /^score \d+ \(workload \+\d+, weekend \+\d+, holiday \+\d+, friday \+\d+\)/,
    )
  })

  it('a single doctor short-fills a day (1 assigned, conflict emitted)', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1)]))
    // one doctor can only hold one slot per day → each day short-fills
    expect(assignments).toHaveLength(3)
    expect(conflicts).toHaveLength(3)
    expect(conflicts[0]?.detail).toContain('only 1 of 2')
  })

  it('enforces no back-to-back across two-doctor days', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1), dr(2)]))
    // day1: {1,2}; day2: both blocked (back-to-back) → conflict, no assignment
    expect(assignments.filter((a) => a.date === '2026-09-02')).toHaveLength(0)
    expect(conflicts.some((c) => c.date === '2026-09-02' && c.detail.includes('back-to-back'))).toBe(true)
  })

  it('enforces the monthly cap', () => {
    const everyOther = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05'), day('2026-09-07')]
    const { conflicts } = generate(ctx(everyOther, [dr(1, 2), dr(2, 2)]))
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.some((c) => c.detail.includes('at monthly cap'))).toBe(true)
  })

  it('respects unavailability: a fully-unavailable day becomes a conflict', () => {
    const days = [day('2026-09-01')]
    const un = new Map([
      [1, [{ start: '2026-09-01', end: '2026-09-01' }]],
      [2, [{ start: '2026-09-01', end: '2026-09-01' }]],
    ])
    const { assignments, conflicts } = generate(ctx(days, [dr(1), dr(2)], { unavailability: un }))
    expect(assignments).toEqual([])
    expect(conflicts[0]?.detail).toContain('unavailable')
  })

  it('respects cross-month prior-day duty via priorDayDoctorIds', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const prior = new Set([1, 2])
    const { assignments } = generate(ctx(days, [dr(1), dr(2), dr(3), dr(4)], { priorDayDoctorIds: prior }))
    const day1 = assignments.filter((a) => a.date === '2026-09-01').map((a) => a.doctorId)
    expect(day1).not.toContain(1)
    expect(day1).not.toContain(2)
  })

  it('enforces the one-Saturday cap: a doctor never gets two Saturdays', () => {
    // four Saturdays, enough distinct doctors that caps are the binding constraint
    const sats = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'].map((d) => day(d, true))
    const doctors = Array.from({ length: 10 }, (_, i) => dr(i + 1))
    const { assignments, conflicts } = generate(ctx(sats, doctors))
    const satCount = new Map<number, number>()
    for (const a of assignments) satCount.set(a.doctorId, (satCount.get(a.doctorId) ?? 0) + 1)
    for (const c of satCount.values()) expect(c).toBeLessThanOrEqual(1)
    expect(conflicts).toEqual([])
  })

  it('is deterministic: same context yields identical output twice', () => {
    const days = Array.from({ length: 10 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`))
    const a = generate(ctx(days, [dr(1), dr(2), dr(3), dr(4)]))
    const b = generate(ctx(days, [dr(1), dr(2), dr(3), dr(4)]))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
```

> The `day()` helper derives `dayOfWeek` from the real date via `dayOfWeekISO`, so Saturday/Sunday/Friday detection matches production. If an assertion's exact count is off after running, inspect the actual output, confirm the behavior is correct (two distinct doctors/day, caps respected), and align the expected value — do not weaken a correctness assertion.

- [ ] **Step 8: Sanity-run the scheduling tests (scoped)**

Task 2 and Task 3 are an **atomic unit** — `schedule.service.ts` consumes the changed `DaySpec`/`computeEligibility`/`scoreCandidate` signatures, so the repo only typechecks green once Task 3 lands. Do NOT commit yet. Just confirm the scheduling tests themselves pass (vitest uses esbuild and does not whole-project typecheck, so these run despite the not-yet-updated service):

Run: `pnpm --filter @oncall/api test src/scheduling`
Expected: the `engine`/`scoring`/`constraints` tests PASS. (Whole-repo `pnpm typecheck` will still fail on `schedule.service.ts` — that is fixed in Task 3.)

- [ ] **Step 9: Do not commit yet — continue to Task 3**

The commit for this task is combined with Task 3's at the end of Task 3, so the repository stays green at every commit.

---

## Task 3: Schedule service (buildContext, computeEligibility, validateAssignment, addDuty) + tests

**Files:**
- Modify: `apps/api/src/services/schedule.service.ts`
- Modify: `apps/api/src/__tests__/schedule.service.test.ts`

**Interfaces:**
- Consumes (from Task 2): `dayOfWeekISO`, `DOCTORS_PER_DAY`, `MAX_SATURDAY_DUTIES`, `MAX_SUNDAY_DUTIES`, `underCap`, `DaySpec` (with `dayOfWeek`).
- Produces: `computeEligibility` with `dutiesByDate: Map<string, Set<number>>` and new `saturdayByDoctor`/`sundayByDoctor` inputs; `addDuty` allowing a 2nd slot; `validateAssignment` enforcing Sat/Sun caps.

- [ ] **Step 1: Update `buildContext` in `apps/api/src/services/schedule.service.ts`**

Add `dayOfWeekISO` to the import from `'../scheduling/dates'` (line ~17–23). In the days-construction loop (line ~128–133), add `dayOfWeek`:

```ts
  const days = []
  const total = daysInMonth(year, month)
  for (let d = 1; d <= total; d++) {
    const date = isoDate(year, month, d)
    days.push({ date, dayOfWeek: dayOfWeekISO(date), isWeekend: isWeekendISO(date), isHoliday: holidays.has(date) })
  }
```

- [ ] **Step 2: Update `EligibilityInput` and `computeEligibility`**

Replace the `EligibilityInput` interface and `computeEligibility` function (lines ~144–176) with the Set-aware, weekend-cap-aware versions:

```ts
export interface EligibilityInput {
  doctors: DoctorSpec[]
  unavailability: Map<number, Array<{ start: string; end: string }>>
  days: { date: string; dayOfWeek: number; isWeekend: boolean; isHoliday: boolean }[]
  dutiesByDate: Map<string, Set<number>>
  dutyCountByDoctor: Map<number, number>
  saturdayByDoctor: Map<number, number>
  sundayByDoctor: Map<number, number>
}

export function computeEligibility(input: EligibilityInput): DayInfo[] {
  const out: DayInfo[] = []
  for (const day of input.days) {
    const eligible: number[] = []
    const todays = input.dutiesByDate.get(day.date) ?? new Set<number>()
    const yesterdays = input.dutiesByDate.get(prevDate(day.date))
    const tomorrows = input.dutiesByDate.get(nextDate(day.date))
    for (const doc of input.doctors) {
      const ranges = input.unavailability.get(doc.id)
      if (!isAvailable(doc.id, day.date, ranges).ok) continue
      const assignedToday = todays.has(doc.id)
      const count = (input.dutyCountByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0)
      if (!underCap(count, doc.maxMonthlyDuties).ok) continue
      if (day.dayOfWeek === 6 && !underCap(input.saturdayByDoctor.get(doc.id) ?? 0, MAX_SATURDAY_DUTIES).ok)
        continue
      if (day.dayOfWeek === 0 && !underCap(input.sundayByDoctor.get(doc.id) ?? 0, MAX_SUNDAY_DUTIES).ok)
        continue
      const onDutyAdjacent =
        (yesterdays?.has(doc.id) ?? false) || (tomorrows?.has(doc.id) ?? false)
      if (!notConsecutive(onDutyAdjacent).ok) continue
      eligible.push(doc.id)
    }
    out.push({
      date: day.date,
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      eligibleDoctorIds: eligible,
    })
  }
  return out
}
```

Add `MAX_SATURDAY_DUTIES, MAX_SUNDAY_DUTIES` to the import from `'../scheduling'` (line ~15), and ensure `DayInfo` is imported from `@oncall/shared` (already imported).

- [ ] **Step 3: Update `preview` to build Set-based maps + sat/sun maps**

Replace the body of `preview` (lines ~178–195) with:

```ts
export async function preview(year: number, month: number): Promise<PreviewResult> {
  const ctx = await buildContext(year, month)
  const result = runEngine(ctx)
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const saturdayByDoctor = new Map<number, number>()
  const sundayByDoctor = new Map<number, number>()
  for (const a of result.assignments) {
    const set = dutiesByDate.get(a.date) ?? new Set<number>()
    set.add(a.doctorId)
    dutiesByDate.set(a.date, set)
    dutyCountByDoctor.set(a.doctorId, (dutyCountByDoctor.get(a.doctorId) ?? 0) + 1)
    const dow = dayOfWeekISO(a.date)
    if (dow === 6) saturdayByDoctor.set(a.doctorId, (saturdayByDoctor.get(a.doctorId) ?? 0) + 1)
    if (dow === 0) sundayByDoctor.set(a.doctorId, (sundayByDoctor.get(a.doctorId) ?? 0) + 1)
  }
  const days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    dutiesByDate,
    dutyCountByDoctor,
    saturdayByDoctor,
    sundayByDoctor,
  }).map((d) => ({ ...d, eligibleDoctorIds: [] }))
  return { assignments: result.assignments, conflicts: result.conflicts, days }
}
```

- [ ] **Step 4: Update `getById` similarly**

Replace the map-building section of `getById` (lines ~280–298) with the Set-aware version:

```ts
  const ctx = await buildContext(schedule.year, schedule.month)
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const saturdayByDoctor = new Map<number, number>()
  const sundayByDoctor = new Map<number, number>()
  for (const d of duties) {
    const set = dutiesByDate.get(d.dutyDate) ?? new Set<number>()
    set.add(d.doctorId)
    dutiesByDate.set(d.dutyDate, set)
    dutyCountByDoctor.set(d.doctorId, (dutyCountByDoctor.get(d.doctorId) ?? 0) + 1)
    const dow = dayOfWeekISO(d.dutyDate)
    if (dow === 6) saturdayByDoctor.set(d.doctorId, (saturdayByDoctor.get(d.doctorId) ?? 0) + 1)
    if (dow === 0) sundayByDoctor.set(d.doctorId, (sundayByDoctor.get(d.doctorId) ?? 0) + 1)
  }
  let days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    dutiesByDate,
    dutyCountByDoctor,
    saturdayByDoctor,
    sundayByDoctor,
  })
  if (!isAdmin) {
    days = days.map((d) => ({ ...d, eligibleDoctorIds: [] }))
  }
  return { schedule, duties, days }
```

- [ ] **Step 5: Add weekend-cap enforcement to `validateAssignment`**

Import `DOCTORS_PER_DAY, MAX_SATURDAY_DUTIES, MAX_SUNDAY_DUTIES, dayOfWeekISO` (extend the existing scheduling imports). In `validateAssignment` (lines ~324–368), after the monthly-cap block and before the consecutive block, add a weekend-cap check:

```ts
  const dow = dayOfWeekISO(date)
  if (dow === 6 || dow === 0) {
    const dayTypeCol = dow === 6 ? 'is_weekend' : 'is_weekend' // Saturdays and Sundays are both is_weekend=true
    const wkRes = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM duties
       WHERE schedule_id = $1 AND doctor_id = $2 AND is_weekend AND ($3::int IS NULL OR id <> $3)
       AND EXTRACT(ISODOW FROM duty_date) = $4`,
      [scheduleId, doctorId, excludeDutyId, dow === 6 ? 6 : 7],
    )
    const cap = dow === 6 ? MAX_SATURDAY_DUTIES : MAX_SUNDAY_DUTIES
    if (!underCap(wkRes.rows[0]?.n ?? 0, cap).ok)
      throw new HttpError(409, `Constraint violation: ${dow === 6 ? 'saturday' : 'sunday'} cap reached`)
    void dayTypeCol // (kept explicit: both Sat/Sun are is_weekend; ISODOW distinguishes)
  }
```

> Uses `EXTRACT(ISODOW FROM duty_date)` (Saturday=6, Sunday=7) to distinguish the two weekend day-types while reusing the `is_weekend` index-friendly prefilter. Remove the unused `dayTypeCol` line if the linter flags it — the comment explains the intent; keep the code minimal:

```ts
  const dow = dayOfWeekISO(date)
  if (dow === 6 || dow === 0) {
    const wkRes = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM duties
       WHERE schedule_id = $1 AND doctor_id = $2 AND is_weekend AND ($3::int IS NULL OR id <> $3)
       AND EXTRACT(ISODOW FROM duty_date) = $4`,
      [scheduleId, doctorId, excludeDutyId, dow === 6 ? 6 : 7],
    )
    const cap = dow === 6 ? MAX_SATURDAY_DUTIES : MAX_SUNDAY_DUTIES
    if (!underCap(wkRes.rows[0]?.n ?? 0, cap).ok)
      throw new HttpError(409, `Constraint violation: ${dow === 6 ? 'saturday' : 'sunday'} cap reached`)
  }
```

(Use this second, minimal version.)

- [ ] **Step 6: Allow the second slot in `addDuty`**

Replace the "already exists" guard (lines ~395–400) with a 2-slot cap:

```ts
  const existing = await query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 AND duty_date = $2',
    [scheduleId, input.date],
  )
  if ((existing.rows[0]?.n ?? 0) >= DOCTORS_PER_DAY)
    throw new HttpError(409, 'Both on-call slots for this date are already filled')
```

- [ ] **Step 7: Update `apps/api/src/__tests__/schedule.service.test.ts`**

Several tests encode the old contract. Make these specific edits:

(a) `dutyRow` default `reason` — change the string to include `friday` (cosmetic; keeps fixtures realistic):

```ts
    reason: 'score 1 (workload +1, weekend +0, holiday +0, friday +0)',
```

(b) "generate persists a schedule + duties" — 5 doctors × 7 max = 35 < 60 slots → now conflicts. Raise the fixture to 12 doctors. Replace the `doctors` array with 12 entries:

```ts
    const doctors = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      max_monthly_duties: 7,
      first_name: `D${i + 1}`,
      last_name: `D${i + 1}`,
      is_active: true,
    }))
```

(c) "addDuty rejects an already-filled date with 409" — one existing duty no longer fills the date. Change the mock to report 2 existing duties:

```ts
  it('addDuty rejects a date with both slots filled (409)', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] }) // schedule
    query.mockResolvedValueOnce({ rows: [{ n: 2 }] }) // existing count -> both filled
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })
```

(d) "reassignDuty runs validateAssignment" — `validateAssignment` now runs one extra weekend-cap query when the duty date is a weekend. `2026-09-05` is a Saturday. Insert one more mocked `query.mockResolvedValueOnce({ rows: [{ n: 0 }] })` (the weekend-cap count returning 0 → passes) into the sequence, immediately after the monthly-cap `{ n: 0 }` mock. Keep the trailing mocks. After running, if the count of consumed mocks is off, add/remove `{ rows: [] }` entries so the final `getDutyById` row is returned — the assertion is `d.doctorId === 7` and the reason contains `manual override by admin #2`.

(e) `computeEligibility` describe block — the local `day` helper must include `dayOfWeek`, and every call must pass `dutiesByDate` as `Map<string, Set<number>>` plus `saturdayByDoctor`/`sundayByDoctor` maps. Update the helper and all call-sites:

```ts
  const day = (date: string, isWeekend = false, isHoliday = false) => ({
    date,
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    isWeekend,
    isHoliday,
  })
  const empty = () => ({
    dutiesByDate: new Map<string, Set<number>>(),
    dutyCountByDoctor: new Map<number, number>(),
    saturdayByDoctor: new Map<number, number>(),
    sundayByDoctor: new Map<number, number>(),
  })
```

Then each `computeEligibility({...})` call spreads `...empty()` and overrides only the field it needs, e.g. the "own-duty exclusion" test:

```ts
    const result = computeEligibility({
      doctors: [doctor(1, 7)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-09-10', new Set([1])]]),
      dutyCountByDoctor: new Map([[1, 7]]),
    })
```

For the back-to-back tests use `new Map([['2026-09-09', new Set([1])]])` / `new Map([['2026-09-11', new Set([1])]])`. The expected `eligibleDoctorIds` results are unchanged in meaning.

- [ ] **Step 8: Run typecheck, lint, and tests (combined green gate for Tasks 2 + 3)**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the monorepo. `stats.service.ts` is still unchanged at this point, so its tests pass on the old semantics; `schedule.routes.test.ts` mocks the service and is unaffected. Every other suite is unaffected by the engine/service contract change. This is the first green checkpoint since Task 1.

- [ ] **Step 9: Commit (engine + service together)**

```bash
git add apps/api/src/scheduling apps/api/src/services/schedule.service.ts apps/api/src/__tests__/schedule.service.test.ts
git commit -m "feat(engine): two doctors/day, Sat/Sun caps, Friday soft term + service"
```

---

## Task 4: Stats service coverage semantics + test

**Files:**
- Modify: `apps/api/src/services/stats.service.ts`
- Modify: `apps/api/src/__tests__/stats.service.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AdminCoverage.filled` = count of dates with exactly 2 duties; `gaps` = dates with <2 duties.

- [ ] **Step 1: Redefine coverage in `adminStats`**

Replace the coverage block (lines ~70–82) with a per-date count query:

```ts
  const perDate = new Map<string, number>()
  if (scheduleRow) {
    const dres = await query<{ duty_date: string; n: number }>(
      `SELECT duty_date, COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 GROUP BY duty_date`,
      [scheduleRow.id],
    )
    for (const r of dres.rows) perDate.set(r.duty_date, r.n)
  }
  const coverage: AdminCoverage = {
    daysInMonth: total,
    filled: allDays.filter((d) => (perDate.get(d) ?? 0) >= 2).length,
    gaps: allDays.filter((d) => (perDate.get(d) ?? 0) < 2),
  }
```

- [ ] **Step 2: Update `apps/api/src/__tests__/stats.service.test.ts`**

(a) Empty-state test — `filled === 0`, `gaps` length 31 still hold; no change needed.

(b) "coverage counts filled + gaps" test — the mock branch matches `SELECT duty_date FROM duties`; the new SQL is `SELECT duty_date, COUNT(*)::int AS n … GROUP BY duty_date`. Update the mock branch and the expected values: to have 29 fully-staffed days, return `{ duty_date, n: 2 }` for 29 dates and `{ duty_date: '2026-09-30', n: 1 }` for the partial one:

```ts
      if (sql.includes('GROUP BY duty_date')) {
        const rows = assigned.map((duty_date) => ({ duty_date, n: 2 }))
        rows.push({ duty_date: '2026-09-30', n: 1 })
        return { rows }
      }
```

And change the matcher that previously branched on `SELECT duty_date FROM duties` to branch on `GROUP BY duty_date` instead (remove the old `if (sql.includes('SELECT duty_date FROM duties'))` branch). Expectations:

```ts
    expect(stats.coverage.filled).toBe(29)
    expect(stats.coverage.gaps).toEqual(['2026-09-30'])
```

(c) The inactive-doctor and fairness tests use `if (sql.includes('SELECT duty_date FROM duties')) return { rows: [{ duty_date: '2026-09-01' }] }`. Replace those with the GROUP BY branch returning `{ duty_date: '2026-09-01', n: 1 }` (a single partial day → filled 0). These tests don't assert coverage values, so only the mock branch key changes:

```ts
      if (sql.includes('GROUP BY duty_date')) return { rows: [{ duty_date: '2026-09-01', n: 1 }] }
```

- [ ] **Step 3: Run typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the monorepo.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/stats.service.ts apps/api/src/__tests__/stats.service.test.ts
git commit -m "feat(stats): coverage counts fully-staffed (2-doctor) days"
```

---

## Task 5: Frontend — DutyCalendar two slots + schedule pages

**Files:**
- Modify: `apps/web/src/components/schedule/DutyCalendar.vue`
- Modify: `apps/web/src/pages/ScheduleDetailPage.vue`
- Modify: `apps/web/src/pages/SchedulePreviewPage.vue`

**Interfaces:**
- Consumes: `Duty[]` / `PreviewResult` from `@oncall/shared` (unchanged shapes — arrays already carry two duties per date).
- Produces: a calendar that renders two slots per day cell and emits `select(date, slotIndex, doctorId | null)`.

- [ ] **Step 1: Rewrite `apps/web/src/components/schedule/DutyCalendar.vue`**

Replace the `<script setup>` and `<template>` so each cell renders two slots. Key changes: `assignmentByDate` becomes `Map<string, CalendarAssignment[]>`; the cell shows two slot controls; the emit signature becomes `select: [date: string, slotIndex: number, doctorId: number | null]`. Full file:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { DayInfo, Doctor } from '@oncall/shared'
import Select from '@/components/ui/Select.vue'

interface CalendarAssignment {
  doctorId: number
  firstName: string
  lastName: string
  reason: string
}

const props = defineProps<{
  year: number
  month: number
  days: DayInfo[]
  assignmentByDate: Map<string, CalendarAssignment[]>
  conflictsByDate: Map<string, string>
  doctors: Doctor[]
  mode: 'editable' | 'readonly'
  slotsPerDay?: number
  savingDates?: Set<string>
}>()

const SLOTS = computed(() => props.slotsPerDay ?? 2)

const emit = defineEmits<{ select: [date: string, slotIndex: number, doctorId: number | null] }>()

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const doctorsById = computed(() => {
  const m = new Map<number, Doctor>()
  for (const d of props.doctors) m.set(d.id, d)
  return m
})

interface Cell {
  blank: boolean
  date: string | null
  dayNum: number | null
  isWeekend: boolean
  isHoliday: boolean
  slots: (CalendarAssignment | undefined)[]
  conflict?: string
  options: number[][]
}

function slotOptions(eligible: number[], slots: (CalendarAssignment | undefined)[], slotIndex: number): number[] {
  const taken = new Set<number>()
  slots.forEach((s, i) => {
    if (i !== slotIndex && s) taken.add(s.doctorId)
  })
  const opts = new Set<number>(eligible)
  const current = slots[slotIndex]
  if (current) opts.add(current.doctorId)
  return [...opts].filter((id) => !taken.has(id))
}

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  const first = props.days[0]
  if (!first) return out
  const firstJs = new Date(`${first.date}T00:00:00`)
  const lead = (firstJs.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, slots: [], options: [] })
  }
  for (const day of props.days) {
    const slotsArr = props.assignmentByDate.get(day.date) ?? []
    const slots: (CalendarAssignment | undefined)[] = Array.from({ length: SLOTS.value }, (_, i) => slotsArr[i])
    const eligible = day.eligibleDoctorIds
    const options = slots.map((_, i) => slotOptions(eligible, slots, i))
    const js = new Date(`${day.date}T00:00:00`)
    out.push({
      blank: false,
      date: day.date,
      dayNum: js.getDate(),
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      slots,
      conflict: props.conflictsByDate.get(day.date),
      options,
    })
  }
  while (out.length % 7 !== 0) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, slots: [], options: [] })
  }
  return out
})

function onSelect(date: string, slotIndex: number, value: string | number) {
  emit('select', date, slotIndex, value === '' ? null : Number(value))
}

function doctorLabel(id: number): string {
  const d = doctorsById.value.get(id)
  return d ? `${d.lastName} ${d.firstName.charAt(0)}.` : String(id)
}

function doctorFull(id: number): string {
  const d = doctorsById.value.get(id)
  return d ? `${d.firstName} ${d.lastName}` : String(id)
}
</script>

<template>
  <div class="overflow-x-auto">
    <div class="min-w-[720px]">
      <div class="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
        <div
          v-for="w in WEEKDAYS"
          :key="w"
          class="bg-muted px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {{ w }}
        </div>
      </div>
      <div class="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
        <div
          v-for="(c, idx) in cells"
          :key="idx"
          :class="[
            'min-h-[112px] bg-card p-2',
            c.blank && 'bg-muted/40',
            !c.blank && c.isWeekend && 'bg-muted/30',
            !c.blank && c.isHoliday && 'border border-destructive/40',
            !c.blank && c.conflict && 'border border-destructive/60 bg-destructive/5',
          ]"
        >
          <template v-if="!c.blank">
            <div class="flex items-start justify-between">
              <span class="text-xs font-semibold text-foreground">{{ c.dayNum }}</span>
              <span class="flex flex-col items-end gap-0.5">
                <span
                  v-if="c.isWeekend"
                  class="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  >WE</span
                >
                <span
                  v-if="c.isHoliday"
                  class="inline-flex rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                  >HOL</span
                >
              </span>
            </div>

            <div class="mt-1.5 flex flex-col gap-1">
              <div v-for="(slot, sIdx) in c.slots" :key="sIdx">
                <template v-if="mode === 'editable' && !c.conflict">
                  <Select
                    :model-value="slot ? String(slot.doctorId) : ''"
                    :disabled="savingDates?.has(c.date ?? '')"
                    @update:model-value="onSelect(c.date!, sIdx, $event)"
                  >
                    <option value="" :disabled="!!slot">
                      {{ slot ? 'Unassigned' : 'Assign…' }}
                    </option>
                    <option v-for="did in c.options[sIdx]" :key="did" :value="String(did)">
                      {{ doctorLabel(did) }}
                    </option>
                  </Select>
                </template>
                <template v-else>
                  <span
                    v-if="slot"
                    class="block text-xs font-medium text-foreground"
                    :title="doctorFull(slot.doctorId)"
                    >{{ doctorLabel(slot.doctorId) }}</span
                  >
                  <span v-else class="block text-xs italic text-muted-foreground">—</span>
                </template>
              </div>
              <span
                v-if="mode !== 'editable' && c.conflict && !c.slots.some((s) => s)"
                class="block text-[11px] font-medium text-destructive"
                :title="c.conflict"
                >Unfillable</span
              >
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Update `apps/web/src/pages/ScheduleDetailPage.vue`**

Change `dutyIdByDate` and `assignmentByDate` to per-date arrays, and make `onSelect` slot-aware. Replace the `dutyIdByDate`/`assignmentByDate` computeds (lines ~40–60) and `onSelect` (lines ~109–159):

```ts
const dutyIdsByDate = computed<Map<string, number[]>>(() => {
  const m = new Map<string, number[]>()
  for (const d of detail.value?.duties ?? []) {
    const arr = m.get(d.dutyDate) ?? []
    arr.push(d.id)
    m.set(d.dutyDate, arr)
  }
  return m
})

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }[]
  >()
  for (const d of detail.value?.duties ?? []) {
    const arr = m.get(d.dutyDate) ?? []
    arr.push({
      doctorId: d.doctorId,
      firstName: d.doctorFirstName,
      lastName: d.doctorLastName,
      reason: d.reason,
    })
    m.set(d.dutyDate, arr)
  }
  return m
})

async function onSelect(date: string, slotIndex: number, doctorId: number | null) {
  const dutyIds = dutyIdsByDate.value.get(date) ?? []
  const dutyId = dutyIds[slotIndex] ?? null
  const slots = assignmentByDate.value.get(date) ?? []
  const existing = slots[slotIndex]
  errorMsg.value = ''
  if (doctorId === null) {
    if (dutyId === null) return
    if (!confirm(`Remove ${existing?.firstName ?? ''} ${existing?.lastName ?? ''} from ${date}?`)) return
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.removeDuty(dutyId)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to remove'
    } finally {
      savingDates.value.delete(date)
      await load()
    }
    return
  }
  if (dutyId !== null) {
    if (existing && doctorId === existing.doctorId) return
    const r = reassignDutySchema.safeParse({ doctorId } satisfies ReassignDutyRequest)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.reassignDuty(dutyId, r.data)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to reassign'
    } finally {
      savingDates.value.delete(date)
      await load()
    }
    return
  }
  const r = createDutySchema.safeParse({ date, doctorId } satisfies CreateDutyRequest)
  if (!r.success) {
    errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  savingDates.value = new Set(savingDates.value).add(date)
  try {
    await scheduleService.addDuty(id, r.data)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to add'
  } finally {
    savingDates.value.delete(date)
    await load()
  }
}
```

The template's `@select="onSelect"` already forwards all emitted args, so no template change is needed for the handler signature.

- [ ] **Step 3: Update `apps/web/src/pages/SchedulePreviewPage.vue`**

Only `assignmentByDate` grouping changes (it already renders readonly via DutyCalendar). Replace its `assignmentByDate` computed (lines ~33–47) with an array-per-date version:

```ts
const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }[]
  >()
  for (const a of result.value?.assignments ?? []) {
    const arr = m.get(a.date) ?? []
    arr.push({
      doctorId: a.doctorId,
      firstName: a.doctorFirstName,
      lastName: a.doctorLastName,
      reason: a.reason,
    })
    m.set(a.date, arr)
  }
  return m
})
```

- [ ] **Step 4: Run typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. (No test mounts `DutyCalendar`/`ScheduleDetailPage`/`SchedulePreviewPage` directly; `ReportsPage.test.ts` is unaffected by this task.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/schedule/DutyCalendar.vue apps/web/src/pages/ScheduleDetailPage.vue apps/web/src/pages/SchedulePreviewPage.vue
git commit -m "feat(web): render two on-call slots per day in the duty calendar"
```

---

## Task 6: Frontend — Reports roster + AdminDashboard copy + test fixtures

**Files:**
- Modify: `apps/web/src/pages/ReportsPage.vue`
- Modify: `apps/web/src/components/dashboard/AdminDashboard.vue`
- Modify: `apps/web/src/__tests__/ReportsPage.test.ts`

**Interfaces:**
- Consumes: `Duty[]` roster (array — already carries 2/date), `AdminCoverage` (semantics now fully-staffed days).
- Produces: roster rows grouped by date with up to two doctors; coverage copy reflects "fully staffed".

- [ ] **Step 1: Update the roster rendering in `apps/web/src/pages/ReportsPage.vue`**

The roster currently stores one `Duty` per date (`DayRow.duty?: Duty`, `byDate: Map<string, Duty>`) and the last duty per date wins. Switch to a per-date array so both doctors show.

(a) Change the `DayRow` interface (lines ~42–48) — replace `duty?: Duty` with `duties: Duty[]`:

```ts
interface DayRow {
  date: string
  weekday: string
  day: string
  isWeekend: boolean
  duties: Duty[]
}
```

(b) In the `rows` computed (lines ~49–69), change `byDate` to a `Map<string, Duty[]>` and push:

```ts
  const byDate = new Map<string, Duty[]>()
  for (const d of r.roster) {
    const arr = byDate.get(d.dutyDate) ?? []
    arr.push(d)
    byDate.set(d.dutyDate, arr)
  }
```

and the `out.push(...)`:

```ts
    out.push({
      date: iso,
      weekday: weekdayFmt.format(js),
      day: dayFmt.format(js),
      isWeekend: dow === 0 || dow === 6,
      duties: byDate.get(iso) ?? [],
    })
```

(c) In the template roster `<TableBody>` (lines ~228–259), render the joined names and adapt the flags/reason cells to the array:

```html
              <TableRow v-for="r in rows" :key="r.date">
                <TableCell>{{ r.weekday }} {{ r.day }}</TableCell>
                <TableCell>
                  <span v-if="r.duties.length">{{ r.duties.map((d) => `${d.doctorFirstName} ${d.doctorLastName}`).join(' / ') }}</span>
                  <span v-else class="italic text-muted-foreground">Unassigned</span>
                </TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-if="r.isWeekend"
                      class="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    >
                      Weekend
                    </span>
                    <span
                      v-if="r.duties.some((d) => d.isHoliday)"
                      class="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    >
                      Holiday
                    </span>
                    <span
                      v-if="r.duties.length < 2"
                      class="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    >
                      {{ r.duties.length === 0 ? 'Gap day' : '1 of 2' }}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span v-if="r.duties.length" class="text-xs text-muted-foreground">{{ r.duties.map((d) => d.reason).join(' | ') }}</span>
                </TableCell>
              </TableRow>
```

(d) Update the coverage copy (lines ~176–182) — "days filled" → "days fully staffed", "Gap days" → "Understaffed days":

```html
            <p class="text-2xl font-semibold text-foreground">
              {{ report.coverage.filled }} / {{ report.coverage.daysInMonth }} days fully staffed
            </p>
            <p v-if="report.coverage.gaps.length > 0" class="text-sm text-destructive">
              Understaffed days: {{ report.coverage.gaps.join(', ') }}
            </p>
```

- [ ] **Step 2: Update coverage copy in `apps/web/src/components/dashboard/AdminDashboard.vue`**

Change the coverage headline (line ~101) and its helper line so "filled" reads as fully-staffed:

```html
  {{ stats.coverage.filled }} / {{ stats.coverage.daysInMonth }} days fully staffed
```

And the gap copy (line ~103–106) can stay; optionally clarify "Understaffed days:" — replace `Gap days:` with `Understaffed days:`.

- [ ] **Step 3: Verify `apps/web/src/__tests__/ReportsPage.test.ts` (no fixture change expected)**

The fixture rosters a single duty on `2026-08-01`; the new rendering shows "Jane Roe" for that date and "Unassigned" / "Gap day" for the 30 empty dates. Assertions (`toContain('Jane Roe')`, `toContain('Unassigned')`, `toContain('Gap day')`) still hold. The partial day additionally shows a "1 of 2" badge, which no test asserts against. Run the test; it should pass unchanged. (Optional: set the fixture `coverage.filled` to `0` for realism since no date has two duties — not required for green.)

- [ ] **Step 4: Run full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the monorepo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ReportsPage.vue apps/web/src/components/dashboard/AdminDashboard.vue apps/web/src/__tests__/ReportsPage.test.ts
git commit -m "feat(web): reports roster groups by date; coverage copy reflects full staffing"
```

---

## Final Verification

- [ ] **Run the whole suite from repo root**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all pass.

- [ ] **DB smoke (if a local Postgres is available)**

```bash
pnpm db:setup
```

Then via the API (or a `tsx` one-liner) call `preview` for `2026-09` with the 12 seeded doctors and assert: zero conflicts, every day has two doctors, no doctor has two Saturdays or two Sundays.

- [ ] **Definition of Done check (from the spec)**

Every generated day has two doctors; no doctor exceeds `max_monthly_duties`, holds both slots of a day, does a 2nd Saturday or Sunday, or works back-to-back (incl. cross-month); Fridays are spread within ±1 when feasible; manual add/reassign enforce all hard constraints incl. weekend caps; `addDuty` allows a 2nd distinct doctor but not a 3rd; coverage counts fully-staffed days; the UI shows two slots per day.
