# Two Doctors Per Day + Weekend/Friday Rules — Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** Enhancement to Phase 5 (Scheduling Engine)
**Status:** Approved (2026-08-08)
**Scope owner:** backend `apps/api`, frontend `apps/web`, shared `packages/shared`, `database/`
**Builds on:** Phase 5 — Scheduling Engine (complete), Phase 6 — Schedule UI, Phase 7 — Statistics, Phase 8 — Reporting

---

## 1. Purpose

Three new scheduling rules, requested as a set:

1. **Two doctors per on-call day.** Every day in a generated schedule must have two distinct doctors assigned (two equal peers — no primary/secondary distinction).
2. **Max one Saturday and one Sunday per doctor per month.** Hard caps: a doctor may do at most one Saturday and at most one Sunday in a schedule month. "No more than this is accepted."
3. **Friday distribution (soft).** Each active doctor should ideally do about one Friday per month; the scoring spreads Fridays evenly. Not mandatory — relaxed automatically when infeasible.

The change is structural: the current engine, schema, service, stats, and UI all assume **one doctor per day**. This phase extends every layer to two-doctor-per-day and adds the weekend hard caps and the Friday soft term.

The chosen engine strategy is **Approach A — extend the single-pass greedy** (see §2). No solver, no two-phase split.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Doctors per day | `DOCTORS_PER_DAY = 2`, fixed system constant. Two equal peers — no role column, two `duties` rows per date |
| Saturday/Sunday caps | `MAX_SATURDAY_DUTIES = 1`, `MAX_SUNDAY_DUTIES = 1`, hard constraints. Fixed system constants (policy rules, like the consecutive rule) — not per-doctor DB columns |
| Friday | Soft distribution term only — no hard constraint. Weight `W_FRIDAY = 2` (lower than weekend/holiday `4`) |
| Engine strategy | Approach A: keep the single-pass greedy; pick the top **two distinct** winners per day |
| Conflict semantics | Fill up to 2 per day — assign whichever eligible doctors exist; if fewer than 2, still assign what is available **and** emit a `ConflictPlan` describing the shortfall. `generate()` still throws 422 if any conflict, so partial fills surface only in preview |
| Dedupe model | `duties.UNIQUE(schedule_id, duty_date)` → `UNIQUE(schedule_id, duty_date, doctor_id)` — allows two distinct doctors/day, blocks a duplicate same-doctor |
| Day type | `DaySpec` gains `dayOfWeek` (0=Sun…6=Sat) so the engine tells Sat/Sun/Fri apart. `isWeekend`/`isHoliday` stay |
| Weekend/holiday budgets | Doubled to account for 2 slots/day: `weekendBudget = ceil(2*weekendDays/activeDoctors)`, `holidayBudget = ceil(2*holidayDays/activeDoctors)`. Otherwise the 2nd weekend/holiday duty is under-scored and those days do not fill |
| Coverage semantics | A day is "filled" only when it has 2 duties. `AdminCoverage.filled` = fully-staffed days; `gaps` = dates with <2 duties. Type shape unchanged |
| Seed | Expand from 3 → ~12 active doctors so the 2/day + weekend-cap model is feasible in the demo month and exercises the caps |
| Feasibility note | With 2/day + max 1 Sat and 1 Sun per doctor, weekends need ~8–10 distinct doctors per day-type. Thin rosters produce weekend conflicts — correct, reported behavior |

## 3. Architecture & Layering

No new modules or routes. All changes are **inside existing files** of the Phase 5–8 layering. The engine stays a pure module (`apps/api/src/scheduling/`, no `db/`/Express imports); `schedule.service.ts` keeps owning I/O.

```
apps/api/src/
├── scheduling/
│   ├── types.ts          # DaySpec +dayOfWeek; CandidateScore +friday
│   ├── constraints.ts    # +Saturday/Sunday hard caps (reuse underCap)
│   ├── scoring.ts        # +W_FRIDAY, fridayBudget; doubled weekend/holiday budgets
│   ├── engine.ts         # DOCTORS_PER_DAY=2; pick 2 winners; byDate -> Set; +sat/sun/fri counters
│   └── dates.ts          # +dayOfWeekISO()
├── services/
│   ├── schedule.service.ts  # computeEligibility Set-aware; validateAssignment +caps; addDuty allows 2nd
│   └── stats.service.ts     # coverage = fully-staffed days
packages/shared/src/types/schedule.ts   # DayInfo/AssignmentPlan unchanged (arrays already support many/date)
database/schema.sql       # UNIQUE(schedule_id, duty_date, doctor_id)
database/seed.sql         # ~12 doctors
apps/web/src/
├── components/schedule/DutyCalendar.vue   # 2 slots/cell
├── pages/ScheduleDetailPage.vue           # dutyIdByDate -> number[]; per-slot onSelect
├── pages/ScheduleRosterPage.vue           # adopt 2-slot model
├── pages/SchedulePreviewPage.vue          # adopt 2-slot model
├── pages/ReportsPage.vue                  # roster groups by date, up to 2 doctors/row
└── components/dashboard/AdminDashboard.vue # coverage copy: "fully-staffed days (2/2)"
```

## 4. Database Schema

Idempotent migration appended to `database/schema.sql` (repo has no migration runner; follows the `username` ALTER pattern at schema.sql:28).

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

The inline declaration in `CREATE TABLE duties` is updated for fresh installs:

```sql
UNIQUE (schedule_id, duty_date, doctor_id)
```

Design points:
- The auto-name for the old inline `UNIQUE (schedule_id, duty_date)` is `duties_schedule_id_duty_date_key`; `DROP CONSTRAINT IF EXISTS` removes it idempotently.
- `ADD CONSTRAINT IF NOT EXISTS` is not supported; the `DO $$ … $$` guard makes re-runs safe.
- No new columns, no role/position. Two doctors/day = two `duties` rows sharing `(schedule_id, duty_date)` with distinct `doctor_id`.

### 4.1 Seed (`database/seed.sql`)

Expand the doctor set from 3 to ~12 (mix of `max_monthly_duties` 5–7), keeping the existing three and adding ~9, idempotently (`ON CONFLICT (email) DO UPDATE` for users; `ON CONFLICT (user_id) DO UPDATE` for doctor profiles). This makes the demo month 2026-09 feasible under 2/day and exercises the weekend caps. Existing unavailability/holiday seeds stay.

## 5. Scheduling Engine (pure module)

### 5.1 `dates.ts`

Add:

```ts
export function dayOfWeekISO(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() // 0=Sun … 6=Sat
}
```

`isWeekendISO` is unchanged (`=== 0 || === 6`).

### 5.2 `types.ts`

```ts
export interface DaySpec {
  date: string
  dayOfWeek: number   // NEW (0=Sun … 6=Sat)
  isWeekend: boolean
  isHoliday: boolean
}

export interface CandidateScore {
  score: number
  workload: number
  weekend: number
  holiday: number
  friday: number      // NEW
}
```

`DoctorSpec`, `SchedulingContext`, `AssignmentPlan`, `ConflictPlan`, `GenerateResult` are unchanged. `AssignmentPlan` already carries `doctorId`; the engine emits two plans per date.

### 5.3 `constraints.ts` — hard constraints

Reuses the existing `underCap(count, limit)` shape. The two new caps are fixed system constants:

```ts
export const MAX_SATURDAY_DUTIES = 1
export const MAX_SUNDAY_DUTIES = 1
```

- **Saturday cap** — `underCap(saturdayCount, MAX_SATURDAY_DUTIES)` blocks a second Saturday.
- **Sunday cap** — `underCap(sundayCount, MAX_SUNDAY_DUTIES)` blocks a second Sunday.
- Friday gets **no** hard constraint.

The eligibility order for a day becomes: availability → monthly cap → **Saturday/Sunday cap when the day is a Sat/Sun** → consecutive. `isAvailable`, `underCap`, `notConsecutive` are unchanged.

### 5.4 `scoring.ts` — soft rubric

```ts
export const W_WORKLOAD = 3
export const W_WEEKEND  = 4
export const W_HOLIDAY  = 4
export const W_FRIDAY   = 2   // NEW — softer than weekend/holiday (Friday is "ideally, not mandatory")

export function fridayBudget(fridayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((2 * fridayDays) / activeDoctors)
}
```

Existing budgets are doubled for 2 slots/day:

```ts
export function weekendBudget(weekendDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((2 * weekendDays) / activeDoctors)
}
export function holidayBudget(holidayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((2 * holidayDays) / activeDoctors)
}
```

`scoreCandidate` gains `fridayDuties` + `fridayBudgetValue` and returns a `friday` component:

```
score += (doctor.maxMonthlyDuties - dutiesThisMonth)              * W_WORKLOAD
if day.isWeekend: score += max(0, WEEKEND_BUDGET - weekendDuties) * W_WEEKEND
if day.isHoliday: score += max(0, HOLIDAY_BUDGET - holidayDuties) * W_HOLIDAY
if day.dayOfWeek === 5: score += max(0, FRIDAY_BUDGET - fridayDuties) * W_FRIDAY   // Friday only
```

The weekend score term stays combined (Sat + Sun both feed `weekendDuties`) — it provides secondary spreading; the separate hard caps are the real enforcement.

### 5.5 `engine.ts` — `generate(context)`

```ts
export const DOCTORS_PER_DAY = 2
```

`RunState` gains per-doctor counters:

```ts
interface RunState {
  total: Map<number, number>
  weekend: Map<number, number>
  holiday: Map<number, number>
  saturday: Map<number, number>   // NEW
  sunday: Map<number, number>     // NEW
  friday: Map<number, number>     // NEW
  byDate: Map<string, Set<number>> // CHANGED number -> Set<number>
}
```

Per-day loop:
1. Filter eligible (availability → monthly cap → Sat/Sun cap → consecutive). Tally elimination reasons.
2. Score survivors; sort by the deterministic tie-break.
3. Pick the top **`DOCTORS_PER_DAY` distinct** winners.
4. Assign each winner: push an `AssignmentPlan`, increment `total`, add to `byDate[date]` Set, and increment `saturday`/`sunday`/`friday`/`weekend`/`holiday` per the day's type.
5. If fewer than `DOCTORS_PER_DAY` eligible, assign what is available and emit a `ConflictPlan` with detail e.g. `"only 1 of 2 doctors assigned; of N active doctor(s): U unavailable, M at monthly cap, W at weekend cap, B back-to-back"`. The tally buckets: `unavailable`, `at cap` (monthly), `at weekend cap` (Saturday/Sunday cap), `back-to-back`.

Consecutive uses set membership: a doctor is "on duty yesterday" if `priorDayDoctorIds.has(id)` (cross-month — already a Set, now naturally holds the prior month's last day's two doctors) or `byDate.get(prev)?.has(id)`. Both of a day's doctors are blocked the next day.

The two winners come from the same sorted list (the two highest-scoring eligible doctors); they are necessarily distinct. Selecting from one sorted list is the simplest correct approach and avoids re-scoring mid-day.

**Deterministic tie-break (unchanged order):** highest `score` → fewest `dutiesThisMonth` → fewest `weekendDuties` → lower `doctorId`.

**`reason` string:** `"score N (workload +A, weekend +B, holiday +C, friday +D); tie-break: <which tie-break won>"`. Manual overrides still store `"manual override by admin #{userId}"`.

## 6. Service Layer (`apps/api/src/services/schedule.service.ts`)

- **`buildContext`** — add `dayOfWeek: dayOfWeekISO(date)` to each day. `priorDayDoctorIds` already builds a `Set` from the prior-date query; with 2/day the query returns two rows and the Set holds both — unchanged code.
- **`computeEligibility`** — `input.dutiesByDate` type changes `Map<string, number>` → `Map<string, Set<number>>`; use `.has(doc.id)`. `EligibilityInput` gains `saturdayByDoctor: Map<number, number>` and `sundayByDoctor: Map<number, number>`. The loop applies the matching hard cap based on `day.dayOfWeek` (Sat → Saturday cap, Sun → Sunday cap), so the eligibility grid never offers a doctor who would breach a weekend cap. The cap-count subtraction (`assignedToday`) and consecutive check (prev/next) use `.has()`.
- **`preview` / `getById`** — build `dutiesByDate` as a `Map<string, Set<number>>` (`.add()`); build the sat/sun maps by iterating duties/assignments and checking `dayOfWeekISO(date)`.
- **`validateAssignment`** (manual add/reassign) — add the Saturday/Sunday cap check: count the doctor's existing Saturday (or Sun) duties in the schedule; reject with `409 'Constraint violation: <saturday|sunday> cap reached'` when the date is a Sat/Sun and the doctor is already at the cap. The consecutive query already returns multiple adjacent rows and uses `.some()` — unchanged.
- **`addDuty`** — the "Duty already exists for this date" guard changes from "reject if any exists" to "reject only when `DOCTORS_PER_DAY` slots are filled" → `409 'Both on-call slots for this date are already filled'`. Adding a second distinct doctor to a date is now allowed.
- **`reassignDuty` / `removeDuty`** — no structural change (operate on a single `dutyId`); `reassignDuty` re-runs `validateAssignment` (now including the weekend cap).

`generate()` keeps throwing `422` when any conflict exists; partial fills surface only in preview.

## 7. Statistics (`apps/api/src/services/stats.service.ts`)

- **Coverage** — redefine `filled` = dates with **exactly 2** duties; `gaps` = dates with <2. The duties query becomes `SELECT duty_date, COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 GROUP BY duty_date`; `filled = count of dates where n === 2`; `gaps = allDays.filter(d where n < 2)`. `AdminCoverage` shape (`daysInMonth`, `filled`, `gaps`) is unchanged; semantics shift to "fully-staffed days".
- **Workload per-doctor counts** and **`fairness` spreads** stay meaningful — unchanged (each `duties` row counts).
- **`meStats`** — counts and the on-call list already render a flat list; the list may now show up to two entries per date. No structural change.

## 8. Shared Types (`packages/shared/src/types/schedule.ts`)

No type shape changes are required:
- `Duty[]`, `DayInfo`, `AssignmentPlan`, `PreviewResult`, `ScheduleDetail` already model many duties per date as an array.
- `AdminCoverage` semantics change but its fields stay (`daysInMonth`, `filled`, `gaps`).

## 9. Frontend (`apps/web`)

- **`DutyCalendar.vue`** — each cell renders **two slots**: two `<Select>` elements in editable mode (each with its own doctor + an empty "Assign…" option), two doctor labels in readonly. Prop `assignmentByDate` → `Map<string, CalendarAssignment[]>`. Emit `select(date, slotIndex, doctorId | null)`. The `options` for each slot union `eligibleDoctorIds` with the slot's current doctor; a doctor already in the other slot is hidden from this slot's options (a doctor cannot hold both slots of a day).
- **`ScheduleDetailPage.vue`** — `dutyIdByDate` → `Map<string, number[]>`; `assignmentByDate` → array per date. `onSelect(date, slotIndex, doctorId)` dispatches per slot: slot empty + non-null → `addDuty`; slot filled + different doctor → `reassignDuty(dutyId)`; null → `removeDuty(dutyId)`.
- **`ScheduleRosterPage.vue` / `SchedulePreviewPage.vue`** — share `DutyCalendar`; adopt the 2-slot model.
- **`ReportsPage.vue`** — roster groups duties by date and shows up to two doctors per row.
- **`AdminDashboard.vue`** — coverage card copy updates to "fully-staffed days (2/2)".
- **`DoctorDashboard`** — on-call list is flat; no change.

## 10. Security & Testing

### 10.1 Security / integrity
- RBAC unchanged: all schedule/duty mutations stay admin-only; client `doctorId`/`date` still validated by zod and re-checked by `validateAssignment` (now including the weekend caps). Parameterized queries only; no ORM.
- The new `UNIQUE(schedule_id, duty_date, doctor_id)` is the DB backstop preventing a doctor holding both slots of a day; `addDuty`'s 2-slot guard prevents over-filling.
- Manual overrides cannot breach the Saturday/Sunday caps: `validateAssignment` enforces them server-side; the client never trusts its own permission view.

### 10.2 Testing strategy
- **`scheduling/` pure unit tests** (no DB mocks):
  - `constraints.test.ts`: Saturday/Sunday cap boundary (count 1 blocked, 0 allowed) for each day-type; non-weekend days unaffected.
  - `scoring.test.ts`: `fridayBudget` ceiling; Friday term only on `dayOfWeek === 5`; doubled `weekendBudget`/`holidayBudget` math; `W_FRIDAY` weight.
  - `engine.test.ts`: a fixed ~12-doctor fixture → two winners per day; Saturday cap excludes a doctor from a 2nd Saturday; Sunday cap likewise; Friday distribution stays within ±1 across eligible doctors when feasible; consecutive blocks across two-doctor days; a day with <2 eligible emits a `ConflictPlan` and still assigns what it can; `byDate` holds a 2-element Set per filled day; doubled budgets.
- **`@oncall/api` services** (`schedule.service.test.ts`, mock `db/client`): `computeEligibility` Set-aware and weekend-cap-aware; `addDuty` allows the 2nd slot, rejects when both filled; `validateAssignment` rejects a weekend-cap breach; `preview` returns two assignments per date; coverage fixture → `filled` counts only fully-staffed days.
- **`@oncall/api` routes** (`schedule.routes.test.ts`): duty POST succeeds for the 2nd doctor on a date; POST on a date with 2 duties → 409; reassign into a weekend-cap breach → 409.
- **Stats** (`stats.service.test.ts`): coverage `filled` = dates with exactly 2 duties; `gaps` = dates with <2.
- **Frontend** (`DutyCalendar` render test, `ReportsPage.test.ts`): two slots render per cell; reports roster fixtures updated for two-per-date.
- **Seed** — `pnpm db:setup` applies cleanly with ~12 doctors; a smoke preview/generate of 2026-09 succeeds (no conflicts) or reports only genuine shortfalls.

### 10.3 Definition of Done
- `pnpm db:setup`, `pnpm dev` succeed; schema migration applies idempotently; seed has ~12 doctors.
- Every generated day has two doctors; no doctor exceeds `max_monthly_duties`, holds both slots of a day, does a 2nd Saturday or Sunday, or works back-to-back (including cross-month). Fridays are spread within ±1 when feasible.
- Manual add/reassign enforce all hard constraints including the weekend caps; `addDuty` allows a 2nd distinct doctor but not a 3rd.
- Coverage counts fully-staffed days; the UI shows two slots per day.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass across the monorepo.

## 11. Out of Scope

Primary/secondary role distinction; configurable per-doctor weekend caps; backtracking/solver; multi-month rolling generation; swap-request workflow; partial-day/hourly granularity; per-day-type fairness spreads in stats; multi-hospital.
