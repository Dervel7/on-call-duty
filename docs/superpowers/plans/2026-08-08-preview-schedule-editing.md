# Editable Schedule Preview with Relaxed Fill Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the schedule preview editable so an admin can add/remove/replace doctors per day, allow 1-doctor days (warning, not a blocker), and persist exactly what is on screen when Generate is clicked.

**Architecture:** Stateless preview + WYSIWYG generate. The engine still targets 2 doctors/day. A new per-day `availableDoctorIds` pool (active + not on vacation) drives the preview dropdowns. `generate` gains an optional `assignments` parameter: when supplied it validates + persists that exact plan (availability stays hard; cap/weekend/consecutive are overridable; ≥1 doctor/day required); when omitted the existing strict engine path is unchanged.

**Tech Stack:** pnpm monorepo, TypeScript, Express + `pg` + Zod (API), Vue 3 + Pinia (web), vitest (tests).

## Global Constraints

- Backend uses `pg` directly (no ORM). Parameterized queries only.
- Validation via Zod. Shared types live in `packages/shared`.
- Never trust client input — the server re-validates the plan.
- Never leak doctor availability to non-admins: strip `eligibleDoctorIds` AND `availableDoctorIds` for non-admins.
- No Prettier; no new comments in code unless requested.
- Tests are DB-mocked (vitest `vi.mock`); `pnpm typecheck && pnpm lint && pnpm test` runs without a live database.
- Commit style: `type(scope): description`.

---

## File Structure

- `packages/shared/src/types/schedule.ts` — add `availableDoctorIds` to `DayInfo`; add `GenerateAssignment`, `GenerateScheduleRequest`.
- `packages/shared/src/schemas/schedule.ts` — add `generateScheduleSchema`.
- `packages/shared/src/schemas/index.ts` — export the new schema.
- `packages/shared/src/__tests__/schemas.test.ts` — cover the new schema.
- `apps/api/src/services/schedule.service.ts` — populate `availableDoctorIds`; strip for non-admins; new generate plan path + `validatePlan`.
- `apps/api/src/validators/schedule.ts` — re-export `generateScheduleSchema`.
- `apps/api/src/routes/schedule.routes.ts` — validate generate with the new schema.
- `apps/api/src/controllers/schedule.controller.ts` — pass `assignments` through.
- `apps/api/src/__tests__/schedule.service.test.ts` — update broken assertion; add plan-path cases.
- `apps/api/src/__tests__/schedule.routes.test.ts` — assignments passthrough.
- `apps/web/src/components/schedule/DutyCalendar.vue` — `pool` + `allowClear` props; editable conflict cells; fill-status hints.
- `apps/web/src/services/schedule.ts` — `generate` accepts optional assignments.
- `apps/web/src/pages/SchedulePreviewPage.vue` — mutable editable state + WYSIWYG generate.
- `apps/web/src/__tests__/ScheduleDetailPage.test.ts` — fixture: add `availableDoctorIds`.
- `apps/web/src/__tests__/SchedulePreviewPage.test.ts` — new, covers editable preview.

---

### Task 1: Plumb `availableDoctorIds` through the data path

Add the new `DayInfo` field, populate it in the single eligibility producer, and strip it for non-admins. This is a pure data-plumbing change with no behavior change to generate.

**Files:**
- Modify: `packages/shared/src/types/schedule.ts`
- Modify: `apps/api/src/services/schedule.service.ts`
- Modify: `apps/api/src/__tests__/schedule.service.test.ts`
- Modify: `apps/web/src/__tests__/ScheduleDetailPage.test.ts`

**Interfaces:**
- Produces: `DayInfo.availableDoctorIds: number[]` (active doctors not on vacation that date), populated by `computeEligibility`; stripped to `[]` for non-admins in `getById`; kept populated in admin-only `preview`.

- [ ] **Step 1: Add the field to `DayInfo`**

In `packages/shared/src/types/schedule.ts`, change the `DayInfo` interface to:

```ts
export interface DayInfo {
  date: string
  isWeekend: boolean
  isHoliday: boolean
  eligibleDoctorIds: number[]
  availableDoctorIds: number[]
}
```

- [ ] **Step 2: Populate it in `computeEligibility`**

In `apps/api/src/services/schedule.service.ts`, the `computeEligibility` function (around line 155) currently declares `const eligible: number[] = []` inside the day loop and pushes `{ date, isWeekend, isHoliday, eligibleDoctorIds: eligible }`. Change it to also collect available doctors (active + available, independent of cap/weekend/consecutive):

```ts
  for (const day of input.days) {
    const eligible: number[] = []
    const available: number[] = []
    const todays = input.dutiesByDate.get(day.date) ?? new Set<number>()
    const yesterdays = input.dutiesByDate.get(prevDate(day.date))
    const tomorrows = input.dutiesByDate.get(nextDate(day.date))
    for (const doc of input.doctors) {
      const ranges = input.unavailability.get(doc.id)
      const isAvail = isAvailable(doc.id, day.date, ranges).ok
      if (isAvail) available.push(doc.id)
      if (!isAvail) continue
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
      availableDoctorIds: available,
    })
  }
```

- [ ] **Step 3: Strip `availableDoctorIds` for non-admins in `getById`**

In the same file, `getById` (around line 321) currently strips only `eligibleDoctorIds` for non-admins. Update it to strip both:

```ts
  if (!isAdmin) {
    days = days.map((d) => ({ ...d, eligibleDoctorIds: [], availableDoctorIds: [] }))
  }
```

- [ ] **Step 4: Update the broken `toEqual` assertion**

In `apps/api/src/__tests__/schedule.service.test.ts`, the `computeEligibility` describe block has one whole-object assertion (around line 279). Add `availableDoctorIds`:

```ts
    expect(result).toEqual([
      { date: '2026-09-10', isWeekend: false, isHoliday: false, eligibleDoctorIds: [1], availableDoctorIds: [1] },
    ])
```

(The other assertions read `result[0]?.eligibleDoctorIds` only — they remain valid.)

- [ ] **Step 5: Update the web test fixture**

In `apps/web/src/__tests__/ScheduleDetailPage.test.ts`, the `daysFor` helper (around line 40) returns `DayInfo` objects. Add `availableDoctorIds`:

```ts
    return { date: iso, isWeekend: dow === 0 || dow === 6, isHoliday: false, eligibleDoctorIds: [5], availableDoctorIds: [5] }
```

- [ ] **Step 6: Run typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/schedule.ts apps/api/src/services/schedule.service.ts apps/api/src/__tests__/schedule.service.test.ts apps/web/src/__tests__/ScheduleDetailPage.test.ts
git commit -m "feat(schedule): add availableDoctorIds to DayInfo data path"
```

---

### Task 2: Backend generate-with-plan path

Add the optional `assignments` parameter to `generate` plus the plan validation, schema, route, and controller wiring. When `assignments` is omitted, behavior is identical to today (strict engine path). When supplied, the plan is validated (availability hard; ≥1/day; ≤2/day; no dup) and persisted verbatim.

**Files:**
- Modify: `packages/shared/src/types/schedule.ts`
- Modify: `packages/shared/src/schemas/schedule.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts`
- Modify: `apps/api/src/validators/schedule.ts`
- Modify: `apps/api/src/routes/schedule.routes.ts`
- Modify: `apps/api/src/controllers/schedule.controller.ts`
- Modify: `apps/api/src/services/schedule.service.ts`
- Modify: `apps/api/src/__tests__/schedule.service.test.ts`
- Modify: `apps/api/src/__tests__/schedule.routes.test.ts`

**Interfaces:**
- Consumes: `DayInfo.availableDoctorIds` from Task 1.
- Produces: `generateScheduleSchema` (Zod), `GenerateAssignment`/`GenerateScheduleRequest` types, `generate(year, month, actor, assignments?)` accepting an optional plan.

- [ ] **Step 1: Add the generate request types**

In `packages/shared/src/types/schedule.ts`, append after `CreateScheduleRequest`:

```ts
export interface GenerateAssignment {
  date: string
  doctorId: number
  reason?: string
}

export interface GenerateScheduleRequest {
  year: number
  month: number
  assignments?: GenerateAssignment[]
}
```

- [ ] **Step 2: Add `generateScheduleSchema`**

In `packages/shared/src/schemas/schedule.ts`, append:

```ts
export const generateScheduleSchema = createScheduleSchema.extend({
  assignments: z
    .array(
      z.object({
        date: dateStr,
        doctorId: z.number().int().positive(),
        reason: z.string().max(500).optional(),
      }),
    )
    .optional(),
})
```

- [ ] **Step 3: Export the new schema**

In `packages/shared/src/schemas/index.ts`, add `generateScheduleSchema` to the existing `export { ... } from './schedule'` block:

```ts
export {
  createScheduleSchema,
  scheduleQuerySchema,
  holidayQuerySchema,
  createHolidaySchema,
  updateHolidaySchema,
  createDutySchema,
  reassignDutySchema,
  generateScheduleSchema,
} from './schedule'
```

- [ ] **Step 4: Cover the schema in tests**

In `packages/shared/src/__tests__/schemas.test.ts`, inside the `describe('schedule schemas', ...)` block, add an import of `generateScheduleSchema` to the existing import-from-`../index` statement near line 143, then add this test:

```ts
  it('generateScheduleSchema accepts with/without assignments and validates items', () => {
    expect(generateScheduleSchema.safeParse({ year: 2026, month: 9 }).success).toBe(true)
    expect(
      generateScheduleSchema.safeParse({
        year: 2026,
        month: 9,
        assignments: [{ date: '2026-09-01', doctorId: 5 }],
      }).success,
    ).toBe(true)
    expect(
      generateScheduleSchema.safeParse({
        year: 2026,
        month: 9,
        assignments: [{ date: '2026-9-1', doctorId: 5 }],
      }).success,
    ).toBe(false)
    expect(
      generateScheduleSchema.safeParse({
        year: 2026,
        month: 9,
        assignments: [{ date: '2026-09-01', doctorId: 0 }],
      }).success,
    ).toBe(false)
  })
```

- [ ] **Step 5: Re-export the schema in the API validator**

In `apps/api/src/validators/schedule.ts`, add `generateScheduleSchema`:

```ts
export {
  createDutySchema,
  createScheduleSchema,
  generateScheduleSchema,
  reassignDutySchema,
  scheduleQuerySchema,
} from '@oncall/shared'
export { idParams } from './user'
```

- [ ] **Step 6: Validate the generate route with the new schema**

In `apps/api/src/routes/schedule.routes.ts`, change the import (line 6-12) to include `generateScheduleSchema`, and change the `POST '/'` route (line 25) to use it:

```ts
import {
  createDutySchema,
  createScheduleSchema,
  generateScheduleSchema,
  idParams,
  reassignDutySchema,
  scheduleQuerySchema,
} from '../validators/schedule'
```

```ts
scheduleRouter.post('/', authorize('administrator'), validate(generateScheduleSchema, 'body'), scheduleController.generate)
```

- [ ] **Step 7: Pass `assignments` through the controller**

In `apps/api/src/controllers/schedule.controller.ts`, update the `generate` handler (around line 32) to forward `req.body.assignments`:

```ts
  async generate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const detail = await scheduleService.generate(
        req.body.year,
        req.body.month,
        req.user,
        req.body.assignments,
      )
      res.status(201).json(ok(detail))
    } catch (err) {
      next(err)
    }
  },
```

- [ ] **Step 8: Add the import for the new type**

In `apps/api/src/services/schedule.service.ts`, add `GenerateAssignment` to the type import from `@oncall/shared` (line 1-12):

```ts
import type {
  AuthUser,
  CreateDutyRequest,
  DayInfo,
  Duty,
  GenerateAssignment,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
  ScheduleStatus,
} from '@oncall/shared'
```

- [ ] **Step 9: Refactor `generate` to accept an optional plan + add helpers**

In `apps/api/src/services/schedule.service.ts`, replace the existing `generate` function (lines 215-252) with the version below, and add the two helpers immediately after it. The existing engine path (no `assignments`) is preserved exactly (same 409/422 behavior); the new plan path validates and persists the supplied plan.

```ts
interface PlanDuty {
  date: string
  doctorId: number
  isWeekend: boolean
  isHoliday: boolean
  reason: string
}

export async function generate(
  year: number,
  month: number,
  actor: Actor,
  assignments?: GenerateAssignment[],
): Promise<ScheduleDetail> {
  const exists = await query('SELECT id FROM schedules WHERE year = $1 AND month = $2', [
    year,
    month,
  ])
  if (exists.rows.length > 0)
    throw new HttpError(409, 'Schedule already exists for this month; delete it first')

  const ctx = await buildContext(year, month)

  const planDuties = assignments
    ? validatePlan(ctx, assignments)
    : enginePlanToDuties(runEngine(ctx))

  const scheduleId = await withTransaction(async (client) => {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO schedules (year, month, status, created_by) VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [year, month, actor.id],
    )
    const id = ins.rows[0]?.id
    if (id === undefined) throw new HttpError(500, 'Failed to create schedule')
    for (const d of planDuties) {
      await client.query(
        `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, is_holiday, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, d.date, d.doctorId, d.isWeekend, d.isHoliday, d.reason],
      )
    }
    return id
  })
  return getById(scheduleId, actor)
}

function enginePlanToDuties(result: ReturnType<typeof runEngine>): PlanDuty[] {
  if (result.conflicts.length > 0)
    throw new HttpError(
      422,
      `Schedule has ${result.conflicts.length} unfillable day(s); run /schedules/preview for details`,
    )
  return result.assignments.map((a) => ({
    date: a.date,
    doctorId: a.doctorId,
    isWeekend: a.isWeekend,
    isHoliday: a.isHoliday,
    reason: a.reason,
  }))
}

function validatePlan(
  ctx: SchedulingContext,
  assignments: GenerateAssignment[],
): PlanDuty[] {
  const activeIds = new Set(ctx.doctors.map((d) => d.id))
  const dayInfo = new Map(ctx.days.map((d) => [d.date, d]))
  const monthDates = new Set(ctx.days.map((d) => d.date))

  const byDate = new Map<string, GenerateAssignment[]>()
  for (const a of assignments) {
    if (!monthDates.has(a.date))
      throw new HttpError(400, `Assignment date ${a.date} is outside the schedule month`)
    if (!activeIds.has(a.doctorId))
      throw new HttpError(400, `Doctor ${a.doctorId} is not an active doctor`)
    const ranges = ctx.unavailability.get(a.doctorId)
    if (!isAvailable(a.doctorId, a.date, ranges).ok)
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} unavailable on ${a.date}`,
      )
    const arr = byDate.get(a.date) ?? []
    if (arr.some((x) => x.doctorId === a.doctorId))
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} already assigned to ${a.date}`,
      )
    arr.push(a)
    byDate.set(a.date, arr)
  }

  for (const [date, arr] of byDate) {
    if (arr.length > DOCTORS_PER_DAY)
      throw new HttpError(
        409,
        `Too many assignments (${arr.length}) for ${date}; max ${DOCTORS_PER_DAY}`,
      )
  }

  const empty: string[] = []
  for (const date of monthDates) {
    if (!byDate.has(date)) empty.push(date)
  }
  if (empty.length > 0)
    throw new HttpError(
      422,
      `${empty.length} day(s) have no doctor: ${empty.join(', ')}; assign at least one per day`,
    )

  return assignments.map((a) => {
    const info = dayInfo.get(a.date)!
    return {
      date: a.date,
      doctorId: a.doctorId,
      isWeekend: info.isWeekend,
      isHoliday: info.isHoliday,
      reason: a.reason ?? 'plan',
    }
  })
}
```

- [ ] **Step 10: Add plan-path service tests**

In `apps/api/src/__tests__/schedule.service.test.ts`, add a new `describe('generate plan path', ...)` block at the end of the first `describe('schedule.service', ...)` (before the `publish / unpublish` describe). These reuse the mocked `query` and the 12-doctor factory pattern already in the file:

```ts
describe('generate plan path', () => {
  const doctors = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    max_monthly_duties: 7,
    first_name: `D${i + 1}`,
    last_name: `D${i + 1}`,
    is_active: true,
  }))

  function mockContext() {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM holidays')) return { rows: [] }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      if (sql.includes('INSERT INTO schedules')) return { rows: [{ id: 7 }] }
      if (sql.includes('INSERT INTO duties')) return { rows: [] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE id =')) {
        return { rows: [scheduleRow({ id: 7 })] }
      }
      if (sql.includes('FROM duties du')) return { rows: [] }
      return { rows: [] }
    })
  }

  it('persists a valid 1-doctor-per-day plan (relaxed rule)', async () => {
    mockContext()
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: (i % 12) + 1,
      reason: 'manual override',
    }))
    const detail = await generate(2026, 9, { id: 2, role: 'administrator' }, assignments)
    expect(detail.schedule.id).toBe(7)
    const inserts = query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties'))
    expect(inserts.length).toBe(30)
  })

  it('422 when any day has no doctor', async () => {
    mockContext()
    const assignments = Array.from({ length: 29 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: (i % 12) + 1,
    }))
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 422 })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })

  it('409 when a doctor is on vacation that date (availability is hard)', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM holidays')) return { rows: [] }
      if (sql.includes('FROM unavailability'))
        return { rows: [{ doctor_id: 1, start_date: '2026-09-01', end_date: '2026-09-30' }] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      return { rows: [] }
    })
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: 1,
    }))
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('409 when the same doctor is assigned twice on a date', async () => {
    mockContext()
    const assignments = [
      { date: '2026-09-01', doctorId: 1 },
      { date: '2026-09-01', doctorId: 1 },
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('409 when a date has more than 2 doctors', async () => {
    mockContext()
    const assignments = [
      { date: '2026-09-01', doctorId: 1 },
      { date: '2026-09-01', doctorId: 2 },
      { date: '2026-09-01', doctorId: 3 },
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 11: Add a route passthrough test**

In `apps/api/src/__tests__/schedule.routes.test.ts`, inside `describe('schedule routes', ...)`, add a test confirming the generate route forwards an assignments body to the service:

```ts
  it('admin generate forwards an assignments plan to the service (201)', async () => {
    generate.mockResolvedValue(detail())
    const res = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9, assignments: [{ date: '2026-09-01', doctorId: 5 }] })
    expect(res.status).toBe(201)
    expect(generate).toHaveBeenCalledWith(2026, 9, expect.anything(), [
      { date: '2026-09-01', doctorId: 5 },
    ])
  })
```

- [ ] **Step 12: Run typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors.

- [ ] **Step 13: Commit**

```bash
git add packages/shared apps/api
git commit -m "feat(schedule): generate accepts an editable plan with relaxed fill rule"
```

---

### Task 3: DutyCalendar — available pool, editable conflict cells, clear, fill hints

Extend the shared calendar so the preview can render dropdowns from the broad available pool, show dropdowns on conflict (0-doctor) cells, allow clearing a filled slot, and surface amber/red fill hints.

**Files:**
- Modify: `apps/web/src/components/schedule/DutyCalendar.vue`

**Interfaces:**
- Produces: two new optional props — `pool?: 'eligible' | 'available'` (default `'eligible'`), `allowClear?: boolean` (default `false`).

- [ ] **Step 1: Add the two new props**

In `apps/web/src/components/schedule/DutyCalendar.vue`, extend `defineProps` (around line 13) to include `pool` and `allowClear`:

```ts
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
  pool?: 'eligible' | 'available'
  allowClear?: boolean
}>()
```

- [ ] **Step 2: Use the chosen pool when building cell options**

In the `cells` computed (around line 68-84), change how the per-day pool is read so it picks `availableDoctorIds` when `pool === 'available'`:

```ts
  for (const day of props.days) {
    const slotsArr = props.assignmentByDate.get(day.date) ?? []
    const slots: (CalendarAssignment | undefined)[] = Array.from({ length: SLOTS.value }, (_, i) => slotsArr[i])
    const poolIds = props.pool === 'available' ? day.availableDoctorIds : day.eligibleDoctorIds
    const options = slots.map((_, i) => slotOptions(poolIds, slots, i))
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
```

- [ ] **Step 3: Add a filled-count helper**

Add a small helper near `doctorLabel` (around line 95):

```ts
function filledCount(slots: (CalendarAssignment | undefined)[]): number {
  return slots.filter((s) => s).length
}
```

- [ ] **Step 4: Render dropdowns on conflict cells and allow clearing**

In the template, the editable `<Select>` is currently gated by `mode === 'editable' && !c.conflict` (around line 149) and its empty option is `:disabled="!!slot"`. Change the gate to drop `!c.conflict`, and make the empty option respect `allowClear`:

```vue
              <template v-if="mode === 'editable'">
                <Select
                  :model-value="slot ? String(slot.doctorId) : ''"
                  :disabled="savingDates?.has(c.date ?? '')"
                  @update:model-value="onSelect(c.date!, sIdx, $event)"
                >
                  <option value="" :disabled="!!slot && !allowClear">
                    {{ slot ? 'Unassigned' : 'Assign…' }}
                  </option>
                  <option v-for="did in c.options[sIdx]" :key="did" :value="String(did)">
                    {{ doctorLabel(did) }}
                  </option>
                </Select>
              </template>
```

- [ ] **Step 5: Add editable fill-status hints**

Still in the template, immediately after the existing non-editable "Unfillable" `<span>` (around line 173-178), add editable-mode hints:

```vue
              <span
                v-if="mode === 'editable' && filledCount(c.slots) === 0"
                class="block text-[11px] font-medium text-destructive"
                :title="c.conflict"
                >No doctor</span
              >
              <span
                v-else-if="mode === 'editable' && filledCount(c.slots) === 1"
                class="block text-[11px] font-medium text-amber-600"
                >1 of 2</span
              >
```

- [ ] **Step 6: Run typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors (the existing `ScheduleDetailPage.test.ts` still passes because it does not pass the new props, so defaults apply: pool `'eligible'`, `allowClear` false).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/schedule/DutyCalendar.vue
git commit -m "feat(web): duty calendar supports available pool, clear, and fill hints"
```

---

### Task 4: Editable SchedulePreviewPage + WYSIWYG generate

Make the preview hold a mutable copy of the engine plan, render the calendar editable from the available pool, recompute error/warning status locally, and send the final plan on Generate.

**Files:**
- Modify: `apps/web/src/services/schedule.ts`
- Modify: `apps/web/src/pages/SchedulePreviewPage.vue`
- Create: `apps/web/src/__tests__/SchedulePreviewPage.test.ts`

**Interfaces:**
- Consumes: `generate(year, month, assignments?)` (modified below); DutyCalendar `pool` + `allowClear` props (Task 3); `DayInfo.availableDoctorIds` (Task 1).
- Produces: an editable preview that sends `GenerateAssignment[]` on generate.

- [ ] **Step 1: Accept optional assignments in the web service**

In `apps/web/src/services/schedule.ts`, import `GenerateAssignment` and update `generate`:

```ts
import type {
  CreateDutyRequest,
  Duty,
  GenerateAssignment,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
} from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'
```

```ts
export async function generate(
  year: number,
  month: number,
  assignments?: GenerateAssignment[],
): Promise<ScheduleDetail> {
  return apiPost<ScheduleDetail>('/schedules', { year, month, assignments })
}
```

- [ ] **Step 2: Rewrite `SchedulePreviewPage.vue` to be editable**

Replace the entire contents of `apps/web/src/pages/SchedulePreviewPage.vue` with:

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DayInfo, Doctor, PreviewResult } from '@oncall/shared'
import { createScheduleSchema } from '@oncall/shared'
import * as scheduleService from '@/services/schedule'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'

const route = useRoute()
const router = useRouter()

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const result = ref<PreviewResult | null>(null)
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')
const generating = ref(false)

interface PreviewAssignment {
  date: string
  doctorId: number
  firstName: string
  lastName: string
  reason: string
}
const assignments = ref<PreviewAssignment[]>([])

const year = computed(() => Number(route.query.year))
const month = computed(() => Number(route.query.month))
const parsed = computed(() => createScheduleSchema.safeParse({ year: year.value, month: month.value }))
const valid = computed(() => parsed.value.success)
const monthLabel = computed(() =>
  valid.value ? `${MONTHS[month.value - 1]} ${year.value}` : 'Preview',
)

const doctorsById = computed(() => {
  const m = new Map<number, Doctor>()
  for (const d of doctors.value) m.set(d.id, d)
  return m
})

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }[]
  >()
  for (const a of assignments.value) {
    const arr = m.get(a.date) ?? []
    arr.push({ doctorId: a.doctorId, firstName: a.firstName, lastName: a.lastName, reason: a.reason })
    m.set(a.date, arr)
  }
  return m
})

const conflictsByDate = computed(() => {
  const m = new Map<string, string>()
  for (const c of result.value?.conflicts ?? []) m.set(c.date, c.detail)
  return m
})

const days = computed<DayInfo[]>(() => result.value?.days ?? [])

const countByDate = computed(() => {
  const m = new Map<string, number>()
  for (const a of assignments.value) m.set(a.date, (m.get(a.date) ?? 0) + 1)
  return m
})
const errorCount = computed(
  () => days.value.filter((d) => (countByDate.value.get(d.date) ?? 0) === 0).length,
)
const warningCount = computed(
  () => days.value.filter((d) => (countByDate.value.get(d.date) ?? 0) === 1).length,
)

async function load() {
  if (!valid.value) {
    errorMsg.value = 'Invalid or missing year/month.'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    result.value = await scheduleService.preview(year.value, month.value)
    assignments.value = (result.value?.assignments ?? []).map((a) => ({
      date: a.date,
      doctorId: a.doctorId,
      firstName: a.doctorFirstName,
      lastName: a.doctorLastName,
      reason: a.reason,
    }))
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to preview'
  } finally {
    loading.value = false
  }
}

function onSelect(date: string, slotIndex: number, doctorId: number | null) {
  const current = assignments.value.filter((a) => a.date === date)
  if (doctorId === null) {
    if (slotIndex >= current.length) return
    const target = current[slotIndex]
    if (!target) return
    assignments.value = assignments.value.filter((a) => a !== target)
    return
  }
  if (slotIndex < current.length) {
    const target = current[slotIndex]
    if (!target || target.doctorId === doctorId) return
    const doc = doctorsById.value.get(doctorId)
    if (!doc) return
    const idx = assignments.value.indexOf(target)
    const next = [...assignments.value]
    next[idx] = {
      date,
      doctorId,
      firstName: doc.firstName,
      lastName: doc.lastName,
      reason: 'manual override',
    }
    assignments.value = next
    return
  }
  if (current.length >= 2) return
  if (current.some((a) => a.doctorId === doctorId)) return
  const doc = doctorsById.value.get(doctorId)
  if (!doc) return
  assignments.value = [
    ...assignments.value,
    { date, doctorId, firstName: doc.firstName, lastName: doc.lastName, reason: 'manual override' },
  ]
}

async function generate() {
  generating.value = true
  errorMsg.value = ''
  try {
    const detail = await scheduleService.generate(
      year.value,
      month.value,
      assignments.value.map((a) => ({ date: a.date, doctorId: a.doctorId, reason: a.reason })),
    )
    router.push(`/schedules/${detail.schedule.id}`)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to generate'
  } finally {
    generating.value = false
  }
}

onMounted(async () => {
  try {
    doctors.value = await doctorService.list()
  } catch {
    doctors.value = []
  }
  await load()
})
watch([year, month], load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold text-foreground">{{ monthLabel }}</h1>
      <div class="flex items-center gap-2">
        <Button variant="outline" @click="router.push('/schedules')">Back</Button>
        <Button :disabled="errorCount > 0 || generating" @click="generate">
          {{ generating ? 'Generating…' : 'Generate' }}
        </Button>
      </div>
    </div>

    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-else-if="errorCount > 0" class="text-sm text-destructive">
      {{ errorCount }} day(s) with no doctor — assign at least one before generating.
    </p>
    <p v-else-if="warningCount > 0" class="text-sm text-amber-600">
      {{ warningCount }} day(s) with only 1 doctor. Ready to generate.
    </p>
    <p v-else-if="result" class="text-sm text-muted-foreground">
      {{ assignments.length }} assignment(s) ready. No conflicts.
    </p>

    <DutyCalendar
      v-if="valid"
      :year="year"
      :month="month"
      :days="days"
      :assignment-by-date="assignmentByDate"
      :conflicts-by-date="conflictsByDate"
      :doctors="doctors"
      mode="editable"
      pool="available"
      allow-clear
      @select="onSelect"
    />
  </div>
</template>
```

- [ ] **Step 3: Create the preview page test**

Create `apps/web/src/__tests__/SchedulePreviewPage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const preview = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  preview: (...a: unknown[]) => preview(...a),
  generate: (...a: unknown[]) => generate(...a),
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  addDuty: vi.fn(),
  reassignDuty: vi.fn(),
  removeDuty: vi.fn(),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { year: '2026', month: '9' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import SchedulePreviewPage from '../pages/SchedulePreviewPage.vue'

function daysFor(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, i) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    const dow = new Date(`${iso}T00:00:00`).getDay()
    return {
      date: iso,
      isWeekend: dow === 0 || dow === 6,
      isHoliday: false,
      eligibleDoctorIds: [],
      availableDoctorIds: [5, 6],
    }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  preview.mockReset()
  generate.mockReset()
  doctorList.mockResolvedValue([
    { id: 5, userId: 5, email: 'j@b.c', username: 'j', firstName: 'Jane', lastName: 'Roe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
    { id: 6, userId: 6, email: 's@b.c', username: 's', firstName: 'Sam', lastName: 'Doe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('SchedulePreviewPage', () => {
  it('renders editable calendar (selects present)', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.findAll('select').length).toBeGreaterThan(0)
  })

  it('blocks Generate while any day has no doctor; shows error banner', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('day(s) with no doctor')
  })

  it('assigning one doctor per day via selects enables Generate and sends the plan', async () => {
    const days = daysFor(2026, 9)
    preview.mockResolvedValue({ assignments: [], conflicts: [], days })
    generate.mockResolvedValue({
      schedule: { id: 42, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '' },
      duties: [],
      days,
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const selects = wrapper.findAll('select')
    for (const sel of selects) {
      await sel.setValue('5')
    }
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await flushPromises()
    expect(generate).toHaveBeenCalled()
    const sent = generate.mock.calls[0]![2] as Array<{ date: string; doctorId: number }>
    expect(sent.length).toBe(days.length)
    expect(sent.every((a) => a.doctorId === 5)).toBe(true)
  })
})
```

- [ ] **Step 4: Run typecheck, lint, and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/schedule.ts apps/web/src/pages/SchedulePreviewPage.vue apps/web/src/__tests__/SchedulePreviewPage.test.ts
git commit -m "feat(web): editable schedule preview with WYSIWYG generate"
```

---

## Self-Review notes

- Spec coverage: every design section maps to a task (DayInfo pool → T1; generate plan path → T2; calendar affordances → T3; editable preview → T4). The "don't trust client" rule is enforced by `validatePlan` (T2). The no-leak rule is enforced in `getById` (T1 step 3). The WYSIWYG + 0-blocks/1-warns UI is T4.
- Existing direct-Generate flow (`SchedulesPage.vue:96`) is unchanged because `assignments` is optional end-to-end.
- Type/name consistency: `availableDoctorIds`, `GenerateAssignment`, `generateScheduleSchema`, `validatePlan`, `pool`, `allowClear`, `filledCount` are used identically across tasks.
