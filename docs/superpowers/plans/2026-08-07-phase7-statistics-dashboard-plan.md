# Phase 7 — Statistics & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a role-aware dashboard at `/` (admin hospital-wide statistics + doctor personal stats / who's-on-call) backed by a new read-only `/stats` API.

**Architecture:** New `/stats` Express router with two GET endpoints that aggregate existing `schedules`/`duties`/`doctors` data server-side (no DB migration). The web `HomePage.vue` becomes a thin role switcher rendering `AdminDashboard` or `DoctorDashboard`. No new frontend dependencies (CSS bars instead of charts).

**Tech Stack:** Node.js + TypeScript + Express + `pg` + Zod; Vue 3 + Vite + Pinia + `@vue/test-utils`; shared `@oncall/shared` types/schemas; Vitest.

## Global Constraints

- **No ORM** — parameterized SQL only (`query<T>(text, params)` from `apps/api/src/db/client`); no reliance on PG error codes.
- **No Prettier** — format on save with Volar; do not add a Prettier config or `format` script.
- **Theme tokens only** in Vue templates (`text-primary`, `bg-primary/10`, `bg-muted`, `text-muted-foreground`, `text-destructive`, `border-input`, `bg-background`, `bg-card`) — no hardcoded hex colors.
- **Response envelope:** success responses use `ok(data)` from `apps/api/src/lib/envelope.ts` → `{ success: true, data }`; handlers set explicit HTTP status codes.
- **RBAC:** `authenticate` + `authorize('administrator')` for admin routes; `/me` routes resolve the caller's own profile from `req.user.id` (set by `authenticate`) and 404 if none.
- **Validation status:** the existing `validate` middleware throws `HttpError(400, …)` on parse failure — invalid query params return **400** (not 422).
- **Conventions to mirror:** `apps/api/src/services/schedule.service.ts` (row interface + `toX` mapper, `query<T>`, `HttpError`), `apps/api/src/controllers/schedule.controller.ts` (controller object, `try/catch/next`), `apps/web/src/services/schedule.ts` (thin `apiGet` wrappers + `toQuery`), `apps/web/src/pages/SchedulesPage.vue` (page data-loading pattern).
- **Node 20+ / pnpm 10+ / PostgreSQL 14+.** Verify with `pnpm typecheck`, `pnpm lint`, `pnpm test` from the repo root.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/types/stats.ts` | Create | All Phase 7 response interfaces (`AdminStats`, `MeStats`, …) + `StatsQuery` |
| `packages/shared/src/types/index.ts` | Modify | Re-export the stats types |
| `packages/shared/src/schemas/stats.ts` | Create | `statsQuerySchema` (optional coerced year/month) |
| `packages/shared/src/schemas/index.ts` | Modify | Re-export `statsQuerySchema` |
| `apps/api/src/services/stats.service.ts` | Create | `adminStats()`, `meStats()` — server-side SQL aggregation |
| `apps/api/src/controllers/stats.controller.ts` | Create | Thin `admin` / `me` handlers |
| `apps/api/src/validators/stats.ts` | Create | Re-export `statsQuerySchema` from `@oncall/shared` |
| `apps/api/src/routes/stats.routes.ts` | Create | `GET /stats/admin`, `GET /stats/me` |
| `apps/api/src/app.ts` | Modify | Mount `/stats` router |
| `apps/api/src/__tests__/stats.service.test.ts` | Create | Service aggregation + edge cases |
| `apps/api/src/__tests__/stats.routes.test.ts` | Create | RBAC + query validation |
| `apps/web/src/services/stats.ts` | Create | `admin(query?)`, `me()` wrappers |
| `apps/web/src/components/dashboard/AdminDashboard.vue` | Create | Month picker + coverage/fairness/workload |
| `apps/web/src/components/dashboard/DoctorDashboard.vue` | Create | Progress + who's-on-call + upcoming |
| `apps/web/src/pages/HomePage.vue` | Modify | Role switcher |
| `apps/web/src/__tests__/HomePage.test.ts` | Create | Renders correct dashboard by role |
| `apps/web/src/__tests__/AdminDashboard.test.ts` | Create | Picker reload, empty state, metrics |
| `apps/web/src/__tests__/DoctorDashboard.test.ts` | Create | Progress, isMine highlight, empty states |

---

## Task 1: Shared types + query schema

**Files:**
- Create: `packages/shared/src/types/stats.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/schemas/stats.ts`
- Modify: `packages/shared/src/schemas/index.ts`

**Interfaces:**
- Consumes: `ScheduleSummary` from `./schedule` (already exported from `@oncall/shared`).
- Produces (re-exported from `@oncall/shared`): types `StatsQuery`, `AdminWorkloadItem`, `AdminCoverage`, `AdminFairness`, `AdminStats`, `MeCurrentMonth`, `MeUpcomingDuty`, `OnCallEntry`, `MeStats`; schema `statsQuerySchema`.

- [ ] **Step 1: Create `packages/shared/src/types/stats.ts`**

```ts
import type { ScheduleSummary } from './schedule'

export interface StatsQuery {
  year?: number
  month?: number
}

// ---- Admin dashboard ----

export interface AdminWorkloadItem {
  doctorId: number
  firstName: string
  lastName: string
  isActive: boolean
  maxMonthly: number
  duties: number
  weekday: number
  weekend: number
  holiday: number
}

export interface AdminCoverage {
  daysInMonth: number
  filled: number
  gaps: string[]
}

export interface AdminFairness {
  dutySpread: number | null
  weekendSpread: number | null
  holidaySpread: number | null
}

export interface AdminStats {
  year: number
  month: number
  schedule: ScheduleSummary | null
  coverage: AdminCoverage
  workload: AdminWorkloadItem[]
  fairness: AdminFairness
}

// ---- Doctor dashboard ----

export interface MeCurrentMonth {
  year: number
  month: number
  published: boolean
  duties: number
  weekend: number
  holiday: number
  maxMonthly: number
}

export interface MeUpcomingDuty {
  dutyDate: string
  isWeekend: boolean
  isHoliday: boolean
}

export interface OnCallEntry {
  date: string
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  isHoliday: boolean
  isMine: boolean
}

export interface MeStats {
  doctor: { id: number; firstName: string; lastName: string; maxMonthlyDuties: number }
  currentMonth: MeCurrentMonth
  upcoming: MeUpcomingDuty[]
  onCall: OnCallEntry[]
}
```

- [ ] **Step 2: Re-export the types from `packages/shared/src/types/index.ts`**

Append to the end of the file:

```ts
export type {
  StatsQuery,
  AdminWorkloadItem,
  AdminCoverage,
  AdminFairness,
  AdminStats,
  MeCurrentMonth,
  MeUpcomingDuty,
  OnCallEntry,
  MeStats,
} from './stats'
```

- [ ] **Step 3: Create `packages/shared/src/schemas/stats.ts`**

```ts
import { z } from 'zod'

export const statsQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
```

- [ ] **Step 4: Re-export the schema from `packages/shared/src/schemas/index.ts`**

Append to the end of the file:

```ts
export { statsQuerySchema } from './stats'
```

- [ ] **Step 5: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/stats.ts packages/shared/src/types/index.ts packages/shared/src/schemas/stats.ts packages/shared/src/schemas/index.ts
git commit -m "feat(shared): add Phase 7 stats types and statsQuerySchema"
```

---

## Task 2: Backend stats service

**Files:**
- Create: `apps/api/src/services/stats.service.ts`

**Interfaces:**
- Consumes: `query<T>(text, params)` from `../db/client`; `getByUserId(userId: number) => Promise<Doctor>` from `./doctor.service` (throws `HttpError(404)` internally when no profile — handles the admin case); date helpers `daysInMonth`, `isoDate` from `../scheduling/dates`; types from `@oncall/shared` (Task 1).
- Produces: `adminStats(year: number, month: number): Promise<AdminStats>` and `meStats(userId: number): Promise<MeStats>`, exported from `apps/api/src/services/stats.service`.

- [ ] **Step 1: Create `apps/api/src/services/stats.service.ts`**

```ts
import type {
  AdminCoverage,
  AdminFairness,
  AdminStats,
  AdminWorkloadItem,
  MeStats,
  OnCallEntry,
  ScheduleStatus,
  ScheduleSummary,
} from '@oncall/shared'
import { query } from '../db/client'
import { daysInMonth, isoDate } from '../scheduling/dates'
import { getByUserId as getDoctorByUserId } from './doctor.service'

interface ScheduleRow {
  id: number
  year: number
  month: number
  status: string
  created_by: number | null
  created_at: Date
  updated_at: Date
}

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function plusDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function currentYearMonth(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
}

function spread(values: number[]): number | null {
  if (values.length < 2) return null
  return Math.max(...values) - Math.min(...values)
}

export async function adminStats(year: number, month: number): Promise<AdminStats> {
  const sres = await query<ScheduleRow>(
    `SELECT id, year, month, status, created_by, created_at, updated_at
     FROM schedules WHERE year = $1 AND month = $2`,
    [year, month],
  )
  const scheduleRow = sres.rows[0] ?? null
  const schedule: ScheduleSummary | null = scheduleRow ? toSchedule(scheduleRow) : null

  const total = daysInMonth(year, month)
  const allDays: string[] = []
  for (let d = 1; d <= total; d++) allDays.push(isoDate(year, month, d))

  const assigned = new Set<string>()
  if (scheduleRow) {
    const dres = await query<{ duty_date: string }>(
      `SELECT duty_date FROM duties WHERE schedule_id = $1`,
      [scheduleRow.id],
    )
    for (const r of dres.rows) assigned.add(r.duty_date)
  }
  const coverage: AdminCoverage = {
    daysInMonth: total,
    filled: assigned.size,
    gaps: allDays.filter((d) => !assigned.has(d)),
  }

  const activeRes = await query<{
    id: number
    first_name: string
    last_name: string
    max_monthly_duties: number
  }>(
    `SELECT d.id, u.first_name, u.last_name, d.max_monthly_duties
     FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE u.is_active = TRUE`,
  )
  const counts = new Map<number, { total: number; weekend: number; holiday: number }>()
  if (scheduleRow) {
    const cRes = await query<{
      doctor_id: number
      total: number
      weekend: number
      holiday: number
    }>(
      `SELECT doctor_id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_weekend)::int AS weekend,
              COUNT(*) FILTER (WHERE is_holiday)::int AS holiday
       FROM duties WHERE schedule_id = $1 GROUP BY doctor_id`,
      [scheduleRow.id],
    )
    for (const r of cRes.rows)
      counts.set(r.doctor_id, { total: r.total, weekend: r.weekend, holiday: r.holiday })
  }

  const byId = new Map<number, AdminWorkloadItem>()
  for (const a of activeRes.rows) {
    byId.set(a.id, {
      doctorId: a.id,
      firstName: a.first_name,
      lastName: a.last_name,
      isActive: true,
      maxMonthly: a.max_monthly_duties,
      duties: 0,
      weekday: 0,
      weekend: 0,
      holiday: 0,
    })
  }
  if (scheduleRow) {
    const inactiveRes = await query<{
      id: number
      first_name: string
      last_name: string
      max_monthly_duties: number
    }>(
      `SELECT DISTINCT d.id, u.first_name, u.last_name, d.max_monthly_duties
       FROM doctors d JOIN users u ON u.id = d.user_id
       JOIN duties du ON du.doctor_id = d.id
       WHERE u.is_active = FALSE AND du.schedule_id = $1`,
      [scheduleRow.id],
    )
    for (const r of inactiveRes.rows) {
      if (!byId.has(r.id))
        byId.set(r.id, {
          doctorId: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          isActive: false,
          maxMonthly: r.max_monthly_duties,
          duties: 0,
          weekday: 0,
          weekend: 0,
          holiday: 0,
        })
    }
  }

  const workload: AdminWorkloadItem[] = []
  for (const item of byId.values()) {
    const c = counts.get(item.doctorId)
    if (c) {
      item.duties = c.total
      item.weekend = c.weekend
      item.holiday = c.holiday
      item.weekday = c.total - c.weekend
    }
    workload.push(item)
  }
  workload.sort((a, b) =>
    a.lastName === b.lastName
      ? a.firstName.localeCompare(b.firstName)
      : a.lastName.localeCompare(b.lastName),
  )

  const assignedDoctors = workload.filter((w) => w.duties > 0)
  const fairness: AdminFairness = {
    dutySpread: spread(assignedDoctors.map((w) => w.duties)),
    weekendSpread: spread(assignedDoctors.map((w) => w.weekend)),
    holidaySpread: spread(assignedDoctors.map((w) => w.holiday)),
  }

  return { year, month, schedule, coverage, workload, fairness }
}

export async function meStats(userId: number): Promise<MeStats> {
  const doctor = await getDoctorByUserId(userId)
  const { year, month } = currentYearMonth()

  const pubRes = await query(
    `SELECT 1 FROM schedules WHERE status = 'published' AND year = $1 AND month = $2`,
    [year, month],
  )
  const published = pubRes.rows.length > 0

  const countsRes = await query<{ total: number; weekend: number; holiday: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE du.is_weekend)::int AS weekend,
            COUNT(*) FILTER (WHERE du.is_holiday)::int AS holiday
     FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE s.status = 'published' AND s.year = $1 AND s.month = $2 AND du.doctor_id = $3`,
    [year, month, doctor.id],
  )
  const c = countsRes.rows[0] ?? { total: 0, weekend: 0, holiday: 0 }

  const upcomingRes = await query<{ duty_date: string; is_weekend: boolean; is_holiday: boolean }>(
    `SELECT du.duty_date, du.is_weekend, du.is_holiday
     FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE s.status = 'published' AND du.doctor_id = $1 AND du.duty_date >= $2
     ORDER BY du.duty_date LIMIT 10`,
    [doctor.id, todayISO()],
  )

  const start = todayISO()
  const end = plusDaysISO(start, 7)
  const onCallRes = await query<{
    duty_date: string
    is_weekend: boolean
    is_holiday: boolean
    first_name: string
    last_name: string
    doctor_id: number
  }>(
    `SELECT du.duty_date, du.is_weekend, du.is_holiday, u.first_name, u.last_name, du.doctor_id
     FROM duties du JOIN schedules s ON s.id = du.schedule_id
     JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id
     WHERE s.status = 'published' AND du.duty_date BETWEEN $1 AND $2
     ORDER BY du.duty_date`,
    [start, end],
  )
  const onCall: OnCallEntry[] = onCallRes.rows.map((r) => ({
    date: r.duty_date,
    doctorFirstName: r.first_name,
    doctorLastName: r.last_name,
    isWeekend: r.is_weekend,
    isHoliday: r.is_holiday,
    isMine: r.doctor_id === doctor.id,
  }))

  return {
    doctor: {
      id: doctor.id,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      maxMonthlyDuties: doctor.maxMonthlyDuties,
    },
    currentMonth: {
      year,
      month,
      published,
      duties: c.total,
      weekend: c.weekend,
      holiday: c.holiday,
      maxMonthly: doctor.maxMonthlyDuties,
    },
    upcoming: upcomingRes.rows.map((r) => ({
      dutyDate: r.duty_date,
      isWeekend: r.is_weekend,
      isHoliday: r.is_holiday,
    })),
    onCall,
  }
}

// Re-exported so the controller can build the default year/month without duplicating logic.
export { currentYearMonth as currentYearMonthUTC }
```

> Note: `getDoctorByUserId` returns the `Doctor` type (`id`, `firstName`, `lastName`, `maxMonthlyDuties`, …) and throws `HttpError(404, 'Doctor not found')` when the caller has no `doctors` row — that is exactly the admin case, so `meStats` needs no extra branching.

- [ ] **Step 2: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/stats.service.ts
git commit -m "feat(api): stats service (adminStats, meStats) with server-side aggregation"
```

---

## Task 3: Backend controller, validator, routes, mount

**Files:**
- Create: `apps/api/src/controllers/stats.controller.ts`
- Create: `apps/api/src/validators/stats.ts`
- Create: `apps/api/src/routes/stats.routes.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `statsQuerySchema` from `@oncall/shared` (Task 1); `adminStats` / `meStats` / `currentYearMonthUTC` from `../services/stats.service` (Task 2); `authenticate` from `../middleware/authenticate`; `authorize` from `../middleware/authorize`; `validate` from `../middleware/validate`; `ok` from `../lib/envelope`; `HttpError` from `../lib/http-error`.
- Produces: `statsRouter` (mounted at `/stats`) exposing `GET /stats/admin` and `GET /stats/me`.

- [ ] **Step 1: Create `apps/api/src/validators/stats.ts`**

```ts
export { statsQuerySchema } from '@oncall/shared'
```

- [ ] **Step 2: Create `apps/api/src/controllers/stats.controller.ts`**

```ts
import type { NextFunction, Request, Response } from 'express'
import type { StatsQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import { adminStats, currentYearMonthUTC, meStats } from '../services/stats.service'

export const statsController = {
  async admin(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as StatsQuery
      const now = currentYearMonthUTC()
      const year = q.year ?? now.year
      const month = q.month ?? now.month
      const stats = await adminStats(year, month)
      res.status(200).json(ok({ stats }))
    } catch (err) {
      next(err)
    }
  },
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const stats = await meStats(req.user.id)
      res.status(200).json(ok({ stats }))
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 3: Create `apps/api/src/routes/stats.routes.ts`**

```ts
import { Router } from 'express'
import { statsController } from '../controllers/stats.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { statsQuerySchema } from '../validators/stats'

export const statsRouter = Router()

statsRouter.use(authenticate)
statsRouter.get('/admin', authorize('administrator'), validate(statsQuerySchema, 'query'), statsController.admin)
statsRouter.get('/me', statsController.me)
```

- [ ] **Step 4: Mount the router in `apps/api/src/app.ts`**

Add the import alongside the other route imports (after the `scheduleRouter`/`dutyRouter` import line):

```ts
import { statsRouter } from './routes/stats.routes'
```

Add the mount alongside the other mounts (after `app.use('/duties', dutyRouter)`):

```ts
app.use('/stats', statsRouter)
```

- [ ] **Step 5: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/controllers/stats.controller.ts apps/api/src/validators/stats.ts apps/api/src/routes/stats.routes.ts apps/api/src/app.ts
git commit -m "feat(api): /stats routes (admin-only admin, authenticated me)"
```

---

## Task 4: Backend tests

**Files:**
- Create: `apps/api/src/__tests__/stats.service.test.ts`
- Create: `apps/api/src/__tests__/stats.routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3. Test style mirrors `apps/api/src/__tests__/schedule.service.test.ts` (mock `query` at module level, match SQL by substring) and `schedule.routes.test.ts` (mock the service module, `supertest`, `signAccessToken({ sub, role })`, response body at `res.body.data`).

- [ ] **Step 1: Create `apps/api/src/__tests__/stats.service.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const getByUserId = vi.fn()
vi.mock('../services/doctor.service', () => ({
  getByUserId: (...a: unknown[]) => getByUserId(...a),
}))

import { adminStats, meStats } from '../services/stats.service'

beforeEach(() => {
  query.mockReset()
  getByUserId.mockReset()
})

describe('stats.service — adminStats', () => {
  it('empty state when no schedule exists', async () => {
    query.mockResolvedValue({ rows: [] })
    const stats = await adminStats(2026, 8)
    expect(stats.schedule).toBeNull()
    expect(stats.coverage.filled).toBe(0)
    expect(stats.coverage.daysInMonth).toBe(31)
    expect(stats.coverage.gaps).toHaveLength(31)
    expect(stats.workload).toEqual([])
    expect(stats.fairness.dutySpread).toBeNull()
  })

  it('coverage counts filled + gaps; active doctor with 0 duties included', async () => {
    const assigned: string[] = []
    for (let d = 1; d <= 29; d++) assigned.push(`2026-09-${String(d).padStart(2, '0')}`)
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE year'))
        return {
          rows: [
            {
              id: 1,
              year: 2026,
              month: 9,
              status: 'published',
              created_by: 2,
              created_at: new Date('2026-08-01'),
              updated_at: new Date('2026-08-01'),
            },
          ],
        }
      if (sql.includes('SELECT duty_date FROM duties'))
        return { rows: assigned.map((duty_date) => ({ duty_date })) }
      if (sql.includes('WHERE u.is_active = TRUE'))
        return { rows: [{ id: 5, first_name: 'Jane', last_name: 'Roe', max_monthly_duties: 7 }] }
      if (sql.includes('GROUP BY doctor_id'))
        return { rows: [{ doctor_id: 5, total: 29, weekend: 8, holiday: 1 }] }
      if (sql.includes('u.is_active = FALSE')) return { rows: [] }
      return { rows: [] }
    })
    const stats = await adminStats(2026, 9)
    expect(stats.coverage.daysInMonth).toBe(30)
    expect(stats.coverage.filled).toBe(29)
    expect(stats.coverage.gaps).toEqual(['2026-09-30'])
    expect(stats.workload).toHaveLength(1)
    expect(stats.workload[0]!.duties).toBe(29)
    expect(stats.workload[0]!.weekday).toBe(21)
    expect(stats.fairness.dutySpread).toBeNull()
  })

  it('inactive doctor with duties is included and flagged isActive=false', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE year'))
        return {
          rows: [
            {
              id: 1,
              year: 2026,
              month: 9,
              status: 'draft',
              created_by: 2,
              created_at: new Date('2026-08-01'),
              updated_at: new Date('2026-08-01'),
            },
          ],
        }
      if (sql.includes('SELECT duty_date FROM duties')) return { rows: [{ duty_date: '2026-09-01' }] }
      if (sql.includes('WHERE u.is_active = TRUE'))
        return { rows: [{ id: 5, first_name: 'Jane', last_name: 'Roe', max_monthly_duties: 7 }] }
      if (sql.includes('GROUP BY doctor_id'))
        return { rows: [{ doctor_id: 6, total: 1, weekend: 0, holiday: 0 }] }
      if (sql.includes('u.is_active = FALSE'))
        return { rows: [{ id: 6, first_name: 'Old', last_name: 'Doc', max_monthly_duties: 7 }] }
      return { rows: [] }
    })
    const stats = await adminStats(2026, 9)
    const inactive = stats.workload.find((w) => w.doctorId === 6)
    expect(inactive).toBeDefined()
    expect(inactive!.isActive).toBe(false)
    expect(inactive!.duties).toBe(1)
  })

  it('fairness spread = max - min over doctors with duties > 0', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE year'))
        return {
          rows: [
            {
              id: 1,
              year: 2026,
              month: 9,
              status: 'published',
              created_by: 2,
              created_at: new Date('2026-08-01'),
              updated_at: new Date('2026-08-01'),
            },
          ],
        }
      if (sql.includes('SELECT duty_date FROM duties')) return { rows: [{ duty_date: '2026-09-01' }] }
      if (sql.includes('WHERE u.is_active = TRUE'))
        return {
          rows: [
            { id: 1, first_name: 'A', last_name: 'A', max_monthly_duties: 7 },
            { id: 2, first_name: 'B', last_name: 'B', max_monthly_duties: 7 },
            { id: 3, first_name: 'C', last_name: 'C', max_monthly_duties: 7 },
          ],
        }
      if (sql.includes('GROUP BY doctor_id'))
        return {
          rows: [
            { doctor_id: 1, total: 5, weekend: 2, holiday: 0 },
            { doctor_id: 2, total: 7, weekend: 1, holiday: 1 },
          ],
        }
      if (sql.includes('u.is_active = FALSE')) return { rows: [] }
      return { rows: [] }
    })
    const stats = await adminStats(2026, 9)
    expect(stats.fairness.dutySpread).toBe(2)
    expect(stats.fairness.weekendSpread).toBe(1)
  })
})

describe('stats.service — meStats', () => {
  it('404 when no doctor profile (admin case)', async () => {
    getByUserId.mockRejectedValue(Object.assign(new Error('Doctor not found'), { status: 404 }))
    await expect(meStats(99)).rejects.toMatchObject({ status: 404 })
  })

  it('currentMonth.published=false with zeros when no published schedule', async () => {
    getByUserId.mockResolvedValue({ id: 5, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE status')) return { rows: [] }
      if (sql.includes('FILTER (WHERE du.is_weekend)'))
        return { rows: [{ total: 0, weekend: 0, holiday: 0 }] }
      if (sql.includes('du.duty_date >= $2')) return { rows: [] }
      if (sql.includes('du.duty_date BETWEEN')) return { rows: [] }
      return { rows: [] }
    })
    const me = await meStats(5)
    expect(me.currentMonth.published).toBe(false)
    expect(me.currentMonth.duties).toBe(0)
    expect(me.upcoming).toEqual([])
    expect(me.onCall).toEqual([])
  })

  it('counts + upcoming + onCall (isMine) when published', async () => {
    getByUserId.mockResolvedValue({ id: 5, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE status')) return { rows: [{ '?column?': 1 }] }
      if (sql.includes('FILTER (WHERE du.is_weekend)'))
        return { rows: [{ total: 4, weekend: 1, holiday: 0 }] }
      if (sql.includes('du.duty_date >= $2'))
        return { rows: [{ duty_date: '2099-01-01', is_weekend: false, is_holiday: false }] }
      if (sql.includes('du.duty_date BETWEEN'))
        return {
          rows: [
            {
              duty_date: '2099-01-01',
              is_weekend: false,
              is_holiday: false,
              first_name: 'Jane',
              last_name: 'Roe',
              doctor_id: 5,
            },
            {
              duty_date: '2099-01-02',
              is_weekend: true,
              is_holiday: false,
              first_name: 'Other',
              last_name: 'Doc',
              doctor_id: 6,
            },
          ],
        }
      return { rows: [] }
    })
    const me = await meStats(5)
    expect(me.currentMonth.published).toBe(true)
    expect(me.currentMonth.duties).toBe(4)
    expect(me.upcoming).toHaveLength(1)
    expect(me.onCall).toHaveLength(2)
    expect(me.onCall[0]!.isMine).toBe(true)
    expect(me.onCall[1]!.isMine).toBe(false)
  })
})
```

- [ ] **Step 2: Create `apps/api/src/__tests__/stats.routes.test.ts`**

```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const adminStats = vi.fn()
const meStats = vi.fn()
vi.mock('../services/stats.service', () => ({
  adminStats: (...a: unknown[]) => adminStats(...a),
  meStats: (...a: unknown[]) => meStats(...a),
  currentYearMonthUTC: () => {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  },
}))

import { errorHandler } from '../middleware/error-handler'
import { signAccessToken } from '../lib/jwt'
import { statsRouter } from '../routes/stats.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/stats', statsRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const emptyStats = () => ({
  year: 2026,
  month: 8,
  schedule: null,
  coverage: { daysInMonth: 31, filled: 0, gaps: [] },
  workload: [],
  fairness: { dutySpread: null, weekendSpread: null, holidaySpread: null },
})

beforeEach(() => {
  adminStats.mockReset()
  meStats.mockReset()
})

describe('stats routes', () => {
  it('admin 200; doctor 403; unauth 401', async () => {
    adminStats.mockResolvedValue(emptyStats())
    const ok200 = await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.stats).toBeDefined()

    const forbidden = await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)

    const unauth = await request(build()).get('/stats/admin')
    expect(unauth.status).toBe(401)
  })

  it('admin query validation rejects invalid month with 400', async () => {
    const res = await request(build())
      .get('/stats/admin?month=13')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('admin without query resolves to the current month', async () => {
    adminStats.mockResolvedValue(emptyStats())
    await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(adminStats).toHaveBeenCalledTimes(1)
    const now = new Date()
    expect(adminStats.mock.calls[0]?.[0]).toBe(now.getUTCFullYear())
  })

  it('me 200 for doctor; 404 for admin (no profile); 401 unauth', async () => {
    meStats.mockResolvedValue({
      doctor: { id: 10, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 },
      currentMonth: {
        year: 2026,
        month: 8,
        published: false,
        duties: 0,
        weekend: 0,
        holiday: 0,
        maxMonthly: 7,
      },
      upcoming: [],
      onCall: [],
    })
    const ok200 = await request(build())
      .get('/stats/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(ok200.status).toBe(200)

    meStats.mockRejectedValue(Object.assign(new Error('Doctor not found'), { status: 404 }))
    const notFound = await request(build())
      .get('/stats/me')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(notFound.status).toBe(404)

    const unauth = await request(build()).get('/stats/me')
    expect(unauth.status).toBe(401)
  })
})
```

- [ ] **Step 3: Run typecheck, lint, and tests to verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors; all new stats tests green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/__tests__/stats.service.test.ts apps/api/src/__tests__/stats.routes.test.ts
git commit -m "test(api): stats service + routes coverage"
```

---

## Task 5: Frontend stats service

**Files:**
- Create: `apps/web/src/services/stats.ts`

**Interfaces:**
- Consumes: types `AdminStats`, `MeStats`, `StatsQuery` from `@oncall/shared` (Task 1); `apiGet` from `@/lib/http`.
- Produces: `admin(query?: StatsQuery): Promise<AdminStats>` and `me(): Promise<MeStats>` from `@/services/stats`.

- [ ] **Step 1: Create `apps/web/src/services/stats.ts`**

```ts
import type { AdminStats, MeStats, StatsQuery } from '@oncall/shared'
import { apiGet } from '@/lib/http'

function toQuery(query?: StatsQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.year !== undefined) parts.push(`year=${query.year}`)
  if (query.month !== undefined) parts.push(`month=${query.month}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function admin(query?: StatsQuery): Promise<AdminStats> {
  const { stats } = await apiGet<{ stats: AdminStats }>(`/stats/admin${toQuery(query)}`)
  return stats
}

export async function me(): Promise<MeStats> {
  const { stats } = await apiGet<{ stats: MeStats }>(`/stats/me`)
  return stats
}
```

- [ ] **Step 2: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/stats.ts
git commit -m "feat(web): stats service wrappers (admin, me)"
```

---

## Task 6: AdminDashboard component

**Files:**
- Create: `apps/web/src/components/dashboard/AdminDashboard.vue`

**Interfaces:**
- Consumes: `admin(query?)` from `@/services/stats` (Task 5); types `AdminStats` from `@oncall/shared`; UI components `Button`, `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Input`, `Label`, `Table*` from `@/components/ui/*`; `useRouter` from `vue-router`.
- Produces: default-exported `AdminDashboard.vue` SFC consumed by `HomePage.vue` (Task 8).

- [ ] **Step 1: Create `apps/web/src/components/dashboard/AdminDashboard.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AdminStats } from '@oncall/shared'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'
import * as statsService from '@/services/stats'

const router = useRouter()
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const now = new Date()
const year = ref(String(now.getUTCFullYear()))
const month = ref(String(now.getUTCMonth() + 1))

const stats = ref<AdminStats | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const monthLabel = computed(() => `${MONTHS[Number(month.value) - 1]} ${year.value}`)
const maxInSet = computed(() =>
  stats.value ? Math.max(1, ...stats.value.workload.map((w) => w.duties)) : 1,
)
const fairnessBadge = computed(() => {
  const s = stats.value?.fairness.dutySpread
  if (s === null) return { text: 'N/A', class: 'bg-muted text-muted-foreground' }
  return s <= 1
    ? { text: 'Well balanced', class: 'bg-primary/10 text-primary' }
    : { text: 'Imbalanced — review workload', class: 'bg-destructive/10 text-destructive' }
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    stats.value = await statsService.admin({ year: Number(year.value), month: Number(month.value) })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load statistics'
  } finally {
    loading.value = false
  }
}

function gotoSchedules() {
  router.push('/schedules')
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="s-year">Year</Label>
        <Input id="s-year" v-model="year" type="number" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="s-month">Month</Label>
        <select
          id="s-month"
          v-model="month"
          class="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
        </select>
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card v-if="stats && !stats.schedule">
      <CardHeader>
        <CardTitle>No schedule for {{ monthLabel }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">Generate a schedule for this month to see statistics.</p>
        <Button class="w-fit" @click="gotoSchedules">Go to Schedules</Button>
      </CardContent>
    </Card>

    <template v-if="stats && stats.schedule">
      <div class="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Coverage</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-2xl font-semibold text-foreground">
              {{ stats.coverage.filled }} / {{ stats.coverage.daysInMonth }} days filled
            </p>
            <p v-if="stats.coverage.gaps.length > 0" class="text-sm text-destructive">
              Gap days: {{ stats.coverage.gaps.join(', ') }}
            </p>
            <p v-else class="text-sm text-muted-foreground">No gap days.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fairness</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-sm text-muted-foreground">Duty spread (max − min across assigned doctors)</p>
            <p class="text-2xl font-semibold text-foreground">{{ stats.fairness.dutySpread ?? 'N/A' }}</p>
            <span
              :class="`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ${fairnessBadge.class}`"
            >
              {{ fairnessBadge.text }}
            </span>
            <p class="text-xs text-muted-foreground">
              Weekend spread {{ stats.fairness.weekendSpread ?? 'N/A' }} · Holiday spread
              {{ stats.fairness.holidaySpread ?? 'N/A' }}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Workload</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead>
                <TableHead>Duties</TableHead>
                <TableHead class="text-right">Weekend</TableHead>
                <TableHead class="text-right">Holiday</TableHead>
                <TableHead class="text-right">Cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="w in stats.workload" :key="w.doctorId">
                <TableCell>
                  <span :class="w.isActive ? 'text-foreground' : 'text-muted-foreground'">
                    {{ w.firstName }} {{ w.lastName }}
                  </span>
                  <span
                    v-if="!w.isActive"
                    class="ml-2 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    inactive
                  </span>
                </TableCell>
                <TableCell>
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-24 rounded bg-muted">
                      <div
                        class="h-2 rounded bg-primary/20"
                        :style="{ width: `${(w.duties / maxInSet) * 100}%` }"
                      ></div>
                    </div>
                    <span class="text-sm text-foreground">{{ w.duties }}</span>
                  </div>
                </TableCell>
                <TableCell class="text-right">{{ w.weekend }}</TableCell>
                <TableCell class="text-right">{{ w.holiday }}</TableCell>
                <TableCell class="text-right">{{ w.maxMonthly }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/AdminDashboard.vue
git commit -m "feat(web): admin dashboard (coverage, fairness, workload)"
```

---

## Task 7: DoctorDashboard component

**Files:**
- Create: `apps/web/src/components/dashboard/DoctorDashboard.vue`

**Interfaces:**
- Consumes: `me()` from `@/services/stats` (Task 5); type `MeStats` from `@oncall/shared`; `Card*` UI components.
- Produces: default-exported `DoctorDashboard.vue` SFC consumed by `HomePage.vue` (Task 8).

- [ ] **Step 1: Create `apps/web/src/components/dashboard/DoctorDashboard.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { MeStats } from '@oncall/shared'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import * as statsService from '@/services/stats'

const stats = ref<MeStats | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const progress = computed(() => {
  if (!stats.value) return 0
  const cap = stats.value.currentMonth.maxMonthly || 1
  return Math.min(100, (stats.value.currentMonth.duties / cap) * 100)
})

function fmt(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(d)
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    stats.value = await statsService.me()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load statistics'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <template v-if="stats">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {{ stats.doctor.firstName }}</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <p class="text-sm text-muted-foreground">
            {{ stats.currentMonth.duties }} / {{ stats.currentMonth.maxMonthly }} duties this month
          </p>
          <div class="h-2 w-full rounded bg-muted">
            <div class="h-2 rounded bg-primary/20" :style="{ width: `${progress}%` }"></div>
          </div>
          <p v-if="!stats.currentMonth.published" class="text-sm text-muted-foreground">
            This month's schedule isn't published yet.
          </p>
          <p class="text-xs text-muted-foreground">
            Weekend {{ stats.currentMonth.weekend }} · Holiday {{ stats.currentMonth.holiday }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Who's on call (today + 7 days)</CardTitle></CardHeader>
        <CardContent>
          <ul v-if="stats.onCall.length > 0" class="flex flex-col divide-y divide-border">
            <li
              v-for="e in stats.onCall"
              :key="e.date"
              :class="[
                'flex items-center justify-between py-2',
                e.isMine && '-mx-2 rounded bg-primary/10 px-2',
              ]"
            >
              <span class="text-sm text-foreground">
                {{ fmt(e.date) }} · {{ e.doctorFirstName }} {{ e.doctorLastName }}
              </span>
              <span class="flex items-center gap-1">
                <span
                  v-if="e.isMine"
                  class="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                >
                  You
                </span>
                <span
                  v-if="e.isWeekend"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Weekend
                </span>
                <span
                  v-if="e.isHoliday"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Holiday
                </span>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">No published schedule covers this period.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>My upcoming duties</CardTitle></CardHeader>
        <CardContent>
          <ul v-if="stats.upcoming.length > 0" class="flex flex-col divide-y divide-border">
            <li
              v-for="u in stats.upcoming"
              :key="u.dutyDate"
              class="flex items-center justify-between py-2"
            >
              <span class="text-sm text-foreground">{{ fmt(u.dutyDate) }}</span>
              <span class="flex items-center gap-1">
                <span
                  v-if="u.isWeekend"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Weekend
                </span>
                <span
                  v-if="u.isHoliday"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Holiday
                </span>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">No upcoming on-call duties.</p>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/DoctorDashboard.vue
git commit -m "feat(web): doctor dashboard (progress, who's on call, upcoming)"
```

---

## Task 8: HomePage role switcher

**Files:**
- Modify: `apps/web/src/pages/HomePage.vue` (replace entire contents)

**Interfaces:**
- Consumes: `useAuthStore` from `@/stores/auth` (exposes `isAdmin`); `AdminDashboard` (Task 6) and `DoctorDashboard` (Task 7).
- Produces: a `HomePage.vue` that renders the admin dashboard when `auth.isAdmin`, else the doctor dashboard.

- [ ] **Step 1: Replace `apps/web/src/pages/HomePage.vue` with the role switcher**

```vue
<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import AdminDashboard from '@/components/dashboard/AdminDashboard.vue'
import DoctorDashboard from '@/components/dashboard/DoctorDashboard.vue'

const auth = useAuthStore()
</script>

<template>
  <AdminDashboard v-if="auth.isAdmin" />
  <DoctorDashboard v-else />
</template>
```

- [ ] **Step 2: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/HomePage.vue
git commit -m "feat(web): role-aware home rendering admin/doctor dashboard"
```

---

## Task 9: Frontend tests

**Files:**
- Create: `apps/web/src/__tests__/HomePage.test.ts`
- Create: `apps/web/src/__tests__/AdminDashboard.test.ts`
- Create: `apps/web/src/__tests__/DoctorDashboard.test.ts`

**Interfaces:**
- Consumes: Tasks 5–8. Test style mirrors `apps/web/src/__tests__/SchedulesPage.test.ts` (`vi.mock('@/services/...')`, `mount` + `flushPromises`, `createPinia`).

- [ ] **Step 1: Create `apps/web/src/__tests__/HomePage.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/components/dashboard/AdminDashboard.vue', () => ({
  default: { name: 'AdminDashboard', template: '<div data-test="admin">admin</div>' },
}))
vi.mock('@/components/dashboard/DoctorDashboard.vue', () => ({
  default: { name: 'DoctorDashboard', template: '<div data-test="doctor">doctor</div>' },
}))

import type { AuthUser } from '@oncall/shared'
import HomePage from '../pages/HomePage.vue'
import { useAuthStore } from '@/stores/auth'

function user(role: AuthUser['role']): AuthUser {
  return { id: 1, email: 'a@b.c', role, firstName: 'A', lastName: 'B' }
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('HomePage', () => {
  it('renders AdminDashboard for an administrator', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore(pinia).user = user('administrator')
    const w = mount(HomePage, { global: { plugins: [pinia] } })
    expect(w.find('[data-test="admin"]').exists()).toBe(true)
    expect(w.find('[data-test="doctor"]').exists()).toBe(false)
  })

  it('renders DoctorDashboard for a doctor', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore(pinia).user = user('doctor')
    const w = mount(HomePage, { global: { plugins: [pinia] } })
    expect(w.find('[data-test="doctor"]').exists()).toBe(true)
    expect(w.find('[data-test="admin"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Create `apps/web/src/__tests__/AdminDashboard.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const admin = vi.fn()
vi.mock('@/services/stats', () => ({
  admin: (...a: unknown[]) => admin(...a),
  me: vi.fn(),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import AdminDashboard from '../components/dashboard/AdminDashboard.vue'

function fullStats(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    schedule: {
      id: 1,
      year: 2026,
      month: 8,
      status: 'published',
      createdBy: 1,
      createdAt: '',
      updatedAt: '',
    },
    coverage: { daysInMonth: 31, filled: 31, gaps: [] },
    workload: [
      {
        doctorId: 1,
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthly: 7,
        duties: 7,
        weekday: 5,
        weekend: 2,
        holiday: 0,
      },
      {
        doctorId: 2,
        firstName: 'Old',
        lastName: 'Doc',
        isActive: false,
        maxMonthly: 7,
        duties: 1,
        weekday: 1,
        weekend: 0,
        holiday: 0,
      },
    ],
    fairness: { dutySpread: 6, weekendSpread: 2, holidaySpread: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  admin.mockReset()
  push.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('AdminDashboard', () => {
  it('renders coverage, imbalanced fairness, and workload with inactive badge', async () => {
    admin.mockResolvedValue(fullStats())
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('31 / 31 days filled')
    expect(w.text()).toContain('Imbalanced — review workload')
    expect(w.text()).toContain('Jane Roe')
    expect(w.text()).toContain('Old Doc')
    expect(w.text()).toContain('inactive')
  })

  it('shows Well balanced when dutySpread <= 1', async () => {
    admin.mockResolvedValue(
      fullStats({ fairness: { dutySpread: 1, weekendSpread: 0, holidaySpread: 0 } }),
    )
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('Well balanced')
  })

  it('shows the empty state and navigates to /schedules when no schedule', async () => {
    admin.mockResolvedValue(
      fullStats({
        schedule: null,
        coverage: { daysInMonth: 31, filled: 0, gaps: [] },
        workload: [],
        fairness: { dutySpread: null, weekendSpread: null, holidaySpread: null },
      }),
    )
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('No schedule for')
    const go = w.findAll('button').find((b) => b.text().includes('Go to Schedules'))!
    await go.trigger('click')
    expect(push).toHaveBeenCalledWith('/schedules')
  })

  it('reloads stats on Apply', async () => {
    admin.mockResolvedValue(fullStats())
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    expect(admin).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Create `apps/web/src/__tests__/DoctorDashboard.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const me = vi.fn()
vi.mock('@/services/stats', () => ({
  admin: vi.fn(),
  me: (...a: unknown[]) => me(...a),
}))

import DoctorDashboard from '../components/dashboard/DoctorDashboard.vue'

function fullMe(overrides: Record<string, unknown> = {}) {
  return {
    doctor: { id: 10, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 },
    currentMonth: {
      year: 2026,
      month: 8,
      published: true,
      duties: 4,
      weekend: 1,
      holiday: 0,
      maxMonthly: 7,
    },
    upcoming: [{ dutyDate: '2099-01-01', isWeekend: false, isHoliday: false }],
    onCall: [
      {
        date: '2099-01-01',
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        isMine: true,
      },
      {
        date: '2099-01-02',
        doctorFirstName: 'Other',
        doctorLastName: 'Doc',
        isWeekend: true,
        isHoliday: false,
        isMine: false,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  me.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('DoctorDashboard', () => {
  it('renders greeting, progress, isMine highlight, and upcoming', async () => {
    me.mockResolvedValue(fullMe())
    const w = mount(DoctorDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('Welcome, Jane')
    expect(w.text()).toContain('4 / 7 duties this month')
    expect(w.text()).toContain('Jane Roe')
    expect(w.text()).toContain('Other Doc')
    expect(w.text()).toContain('You')
  })

  it('shows the not-published note and both empty states', async () => {
    me.mockResolvedValue(
      fullMe({
        currentMonth: {
          year: 2026,
          month: 8,
          published: false,
          duties: 0,
          weekend: 0,
          holiday: 0,
          maxMonthly: 7,
        },
        upcoming: [],
        onCall: [],
      }),
    )
    const w = mount(DoctorDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain("isn't published yet")
    expect(w.text()).toContain('No published schedule covers this period.')
    expect(w.text()).toContain('No upcoming on-call duties.')
  })
})
```

- [ ] **Step 4: Run typecheck, lint, and tests to verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors; all new web tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/__tests__/HomePage.test.ts apps/web/src/__tests__/AdminDashboard.test.ts apps/web/src/__tests__/DoctorDashboard.test.ts
git commit -m "test(web): HomePage role switch + admin/doctor dashboards"
```

---

## Final verification

After Task 9, from the repo root:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three must pass across the monorepo. Then optionally smoke-test with `pnpm dev`: sign in as the seeded admin → `/` shows the admin dashboard (pick a generated month → coverage/fairness/workload; pick an empty month → empty state); sign in as a doctor (`dr1@oncall.local`) → `/` shows progress, who's-on-call (only populated once a month is **published**), and upcoming duties.
