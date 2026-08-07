# Phase 8 — Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an admin-only Reporting page (`/reports`) that shows a consolidated monthly on-call report (roster + workload + coverage + fairness + holidays), exports the roster as CSV, and prints/saves-as-PDF via the browser.

**Architecture:** New read-only `/reports` Express router with one GET endpoint that composes Phase 7's `statsService.adminStats` (schedule + coverage + workload + fairness) and Phase 5's `scheduleService.getById` (roster) plus one small holidays-in-month query (no DB migration). The web adds a `ReportsPage` that reuses existing `Table`/`Card` UI, a pure `dutiesToCsv` helper in `@oncall/utils`, a DOM `downloadCsv` in `apps/web/src/lib`, and a minimal global `@media print` block. CSV is generated client-side; PDF uses browser print — no new dependencies.

**Tech Stack:** Node.js + TypeScript + Express + `pg` + Zod; Vue 3 + Vite + Pinia + `@vue/test-utils`; shared `@oncall/shared` types/schemas; pure `@oncall/utils` CSV helper; Vitest.

## Global Constraints

- **No ORM** — parameterized SQL only (`query<T>(text, params)` from `apps/api/src/db/client`); no reliance on PG error codes.
- **No Prettier** — format on save with Volar; do not add a Prettier config or `format` script.
- **Theme tokens only** in Vue templates (`text-foreground`, `text-primary`, `bg-primary/10`, `bg-muted`, `text-muted-foreground`, `text-destructive`, `border-input`, `bg-background`, `bg-card`) — no hardcoded hex colors.
- **Response envelope:** success responses use `ok(data)` from `apps/api/src/lib/envelope.ts` → `{ success: true, data }`; handlers set explicit HTTP status codes.
- **RBAC:** the entire `/reports` router is `authenticate + authorize('administrator')` at the router level (doctor → 403, unauth → 401); the route's `meta.roles: ['administrator']` and the admin-gated nav link keep doctors off the page.
- **Validation status:** the existing `validate` middleware throws `HttpError(400, …)` on parse failure — invalid query params return **400**.
- **No DB migration** — pure read-only aggregation on existing `schedules`/`duties`/`doctors`/`users`/`holidays` tables.
- **Conventions to mirror:** `apps/api/src/services/stats.service.ts` (composition + `query<T>`), `apps/api/src/controllers/stats.controller.ts` (controller object + `currentYearMonthUTC`), `apps/api/src/routes/stats.routes.ts`, `apps/web/src/services/stats.ts` (thin `apiGet` wrappers + `toQuery`), `apps/web/src/pages/ScheduleDetailPage.vue` (full-month day grid), `apps/web/src/components/dashboard/AdminDashboard.vue` (month picker + CSS bars + fairness badge).
- **Node 20+ / pnpm 10+ / PostgreSQL 14+.** Verify with `pnpm typecheck`, `pnpm lint`, `pnpm test` from the repo root.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/types/reports.ts` | Create | `ReportQuery`, `ReportHoliday`, `MonthlyReport` |
| `packages/shared/src/types/index.ts` | Modify | Re-export the reports types |
| `packages/shared/src/schemas/reports.ts` | Create | `reportQuerySchema` (optional coerced year/month) |
| `packages/shared/src/schemas/index.ts` | Modify | Re-export `reportQuerySchema` |
| `packages/utils/src/csv.ts` | Create | `escapeCsvField`, `CsvDutyRow`, `dutiesToCsv` (RFC 4180) |
| `packages/utils/src/index.ts` | Modify | Re-export the CSV helpers |
| `packages/utils/src/__tests__/csv.test.ts` | Create | CSV escape + serialize coverage |
| `apps/api/src/services/reports.service.ts` | Create | `monthlyReport(year, month)` — composes stats + schedule services + holidays query |
| `apps/api/src/controllers/reports.controller.ts` | Create | Thin `monthly` handler |
| `apps/api/src/validators/reports.ts` | Create | Re-export `reportQuerySchema` from `@oncall/shared` |
| `apps/api/src/routes/reports.routes.ts` | Create | `GET /reports/monthly` (admin-only) |
| `apps/api/src/app.ts` | Modify | Mount `/reports` router |
| `apps/api/src/__tests__/reports.service.test.ts` | Create | Composition + empty state + holidays scoping |
| `apps/api/src/__tests__/reports.routes.test.ts` | Create | RBAC + query validation + default month |
| `apps/web/src/services/reports.ts` | Create | `monthly(query?)` wrapper |
| `apps/web/src/lib/download.ts` | Create | `downloadCsv(filename, csv)` |
| `apps/web/src/pages/ReportsPage.vue` | Create | Month picker + consolidated report + CSV/Print |
| `apps/web/src/router/index.ts` | Modify | Add `/reports` route (admin-only) |
| `apps/web/src/components/layout/AppHeader.vue` | Modify | Add "Reports" nav link (admin-gated) |
| `apps/web/src/style.css` | Modify | Add `@media print` rules |
| `apps/web/src/__tests__/ReportsPage.test.ts` | Create | Picker reload, empty state, report + CSV/print |
| `apps/web/src/__tests__/download.test.ts` | Create | `downloadCsv` builds a blob link (jsdom) |

---

## Task 1: Shared types + query schema

**Files:**
- Create: `packages/shared/src/types/reports.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/schemas/reports.ts`
- Modify: `packages/shared/src/schemas/index.ts`

**Interfaces:**
- Consumes: `AdminCoverage`, `AdminFairness`, `AdminWorkloadItem` from `./stats` (Phase 7); `Duty`, `ScheduleSummary` from `./schedule` (Phase 5). Both already exported from `@oncall/shared`.
- Produces (re-exported from `@oncall/shared`): types `ReportQuery`, `ReportHoliday`, `MonthlyReport`; schema `reportQuerySchema`.

- [ ] **Step 1: Create `packages/shared/src/types/reports.ts`**

```ts
import type { AdminCoverage, AdminFairness, AdminWorkloadItem } from './stats'
import type { Duty, ScheduleSummary } from './schedule'

export interface ReportQuery {
  year?: number
  month?: number
}

export interface ReportHoliday {
  date: string
  name: string
}

export interface MonthlyReport {
  year: number
  month: number
  generatedAt: string
  schedule: ScheduleSummary | null
  roster: Duty[]
  coverage: AdminCoverage
  workload: AdminWorkloadItem[]
  fairness: AdminFairness
  holidays: ReportHoliday[]
}
```

- [ ] **Step 2: Re-export the types from `packages/shared/src/types/index.ts`**

Append to the end of the file:

```ts
export type { ReportQuery, ReportHoliday, MonthlyReport } from './reports'
```

- [ ] **Step 3: Create `packages/shared/src/schemas/reports.ts`**

```ts
import { z } from 'zod'

export const reportQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
```

- [ ] **Step 4: Re-export the schema from `packages/shared/src/schemas/index.ts`**

Append to the end of the file:

```ts
export { reportQuerySchema } from './reports'
```

- [ ] **Step 5: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/reports.ts packages/shared/src/types/index.ts packages/shared/src/schemas/reports.ts packages/shared/src/schemas/index.ts
git commit -m "feat(shared): add Phase 8 reports types and reportQuerySchema"
```

---

## Task 2: Pure CSV helper (`@oncall/utils`)

**Files:**
- Create: `packages/utils/src/csv.ts`
- Modify: `packages/utils/src/index.ts`
- Create: `packages/utils/src/__tests__/csv.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no `@oncall/shared` dependency).
- Produces (re-exported from `@oncall/utils`): `escapeCsvField(value: string): string`, interface `CsvDutyRow`, `dutiesToCsv(rows: CsvDutyRow[]): string`. `CsvDutyRow` is structurally compatible with the `Duty` type (Task 1) so the web page can pass `report.roster` directly.

- [ ] **Step 1: Create `packages/utils/src/csv.ts`**

```ts
export interface CsvDutyRow {
  dutyDate: string
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  isHoliday: boolean
  reason: string
}

/** Escape one CSV field per RFC 4180: quote if it contains comma, quote, CR, or LF; double internal quotes. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const CSV_HEADERS = ['Date', 'Weekday', 'Doctor', 'Weekend', 'Holiday', 'Reason']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Serialize roster rows to CSV (RFC 4180; CRLF line endings). The header row is always present. */
export function dutiesToCsv(rows: CsvDutyRow[]): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const r of rows) {
    const d = new Date(`${r.dutyDate}T00:00:00Z`)
    const fields = [
      r.dutyDate,
      WEEKDAYS[d.getUTCDay()] ?? '',
      `${r.doctorFirstName} ${r.doctorLastName}`,
      r.isWeekend ? 'Yes' : 'No',
      r.isHoliday ? 'Yes' : 'No',
      r.reason,
    ].map(escapeCsvField)
    lines.push(fields.join(','))
  }
  return lines.join('\r\n')
}
```

- [ ] **Step 2: Re-export the CSV helpers from `packages/utils/src/index.ts`**

Append to the end of the file:

```ts
export * from './csv'
```

- [ ] **Step 3: Create `packages/utils/src/__tests__/csv.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { dutiesToCsv, escapeCsvField } from '../csv'

describe('escapeCsvField', () => {
  it('passes a clean field through unchanged', () => {
    expect(escapeCsvField('Jane Roe')).toBe('Jane Roe')
  })

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })

  it('quotes a field containing a double quote and doubles it', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes a field containing CR or LF', () => {
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"')
    expect(escapeCsvField('carriage\rreturn')).toBe('"carriage\rreturn"')
  })
})

describe('dutiesToCsv', () => {
  it('emits only the header row for empty input', () => {
    expect(dutiesToCsv([])).toBe('Date,Weekday,Doctor,Weekend,Holiday,Reason')
  })

  it('emits one CRLF-terminated line per row in the right column order', () => {
    const csv = dutiesToCsv([
      {
        dutyDate: '2026-08-07',
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'engine',
      },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Date,Weekday,Doctor,Weekend,Holiday,Reason')
    expect(lines[1]).toBe('2026-08-07,Friday,Jane Roe,No,No,engine')
    expect(lines).toHaveLength(2)
  })

  it('computes the weekday in UTC from dutyDate', () => {
    const csv = dutiesToCsv([
      {
        dutyDate: '2026-08-09',
        doctorFirstName: 'A',
        doctorLastName: 'B',
        isWeekend: true,
        isHoliday: false,
        reason: 'x',
      },
    ])
    // 2026-08-09 is a Sunday
    expect(csv.split('\r\n')[1]).toBe('2026-08-09,Sunday,A B,Yes,No,x')
  })

  it('quotes a reason that contains a comma', () => {
    const csv = dutiesToCsv([
      {
        dutyDate: '2026-08-07',
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'manual override, admin #2',
      },
    ])
    expect(csv.split('\r\n')[1]).toBe('2026-08-07,Friday,Jane Roe,No,No,"manual override, admin #2"')
  })
})
```

- [ ] **Step 4: Run typecheck, lint, and tests to verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors; all CSV tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/utils/src/csv.ts packages/utils/src/index.ts packages/utils/src/__tests__/csv.test.ts
git commit -m "feat(utils): pure dutiesToCsv helper (RFC 4180)"
```

---

## Task 3: Backend reports service

**Files:**
- Create: `apps/api/src/services/reports.service.ts`

**Interfaces:**
- Consumes: `query<T>(text, params)` from `../db/client`; `daysInMonth`, `isoDate` from `../scheduling/dates`; `adminStats(year, month) => Promise<AdminStats>` from `./stats.service` (Phase 7 — returns `{ schedule, coverage, workload, fairness, … }`); `getById(id) => Promise<ScheduleDetail>` from `./schedule.service` (Phase 5 — returns `{ schedule, duties }` with duties ascending by `duty_date`); types from `@oncall/shared` (Task 1).
- Produces: `monthlyReport(year: number, month: number): Promise<MonthlyReport>`, exported from `apps/api/src/services/reports.service`.

- [ ] **Step 1: Create `apps/api/src/services/reports.service.ts`**

```ts
import type { MonthlyReport, ReportHoliday } from '@oncall/shared'
import { query } from '../db/client'
import { daysInMonth, isoDate } from '../scheduling/dates'
import * as scheduleService from './schedule.service'
import * as statsService from './stats.service'

export async function monthlyReport(year: number, month: number): Promise<MonthlyReport> {
  // 1. Reuse Phase 7 aggregation: schedule (or null) + coverage + workload + fairness.
  const stats = await statsService.adminStats(year, month)

  // 2. Roster: only when a schedule exists. stats.schedule is non-null iff the row exists,
  //    so getById cannot throw 404 here.
  let roster: MonthlyReport['roster'] = []
  if (stats.schedule) {
    const detail = await scheduleService.getById(stats.schedule.id)
    roster = detail.duties
  }

  // 3. Holidays falling in this month (month bounds via the existing date helpers).
  const first = isoDate(year, month, 1)
  const last = isoDate(year, month, daysInMonth(year, month))
  const hres = await query<{ date: string; name: string }>(
    `SELECT date, name FROM holidays WHERE date >= $1 AND date <= $2 ORDER BY date`,
    [first, last],
  )
  const holidays: ReportHoliday[] = hres.rows.map((r) => ({ date: r.date, name: r.name }))

  return {
    year,
    month,
    generatedAt: new Date().toISOString(),
    schedule: stats.schedule,
    roster,
    coverage: stats.coverage,
    workload: stats.workload,
    fairness: stats.fairness,
    holidays,
  }
}
```

> Note: `statsService.adminStats` returns `schedule: null` when no schedule exists, with `coverage` computed against zero assigned days (all gaps) and `workload` listing active doctors with 0 duties. The reports service forwards these fields unchanged; the page renders an empty-state card when `schedule === null`.

- [ ] **Step 2: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/reports.service.ts
git commit -m "feat(api): reports service (monthlyReport) composing stats + schedule + holidays"
```

---

## Task 4: Backend controller, validator, routes, mount

**Files:**
- Create: `apps/api/src/controllers/reports.controller.ts`
- Create: `apps/api/src/validators/reports.ts`
- Create: `apps/api/src/routes/reports.routes.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `reportQuerySchema` from `@oncall/shared` (Task 1); `monthlyReport` from `../services/reports.service` (Task 3); `currentYearMonthUTC` from `../services/stats.service` (Phase 7 — already exported); `authenticate` from `../middleware/authenticate`; `authorize` from `../middleware/authorize`; `validate` from `../middleware/validate`; `ok` from `../lib/envelope`.
- Produces: `reportsRouter` (mounted at `/reports`) exposing `GET /reports/monthly`.

- [ ] **Step 1: Create `apps/api/src/validators/reports.ts`**

```ts
export { reportQuerySchema } from '@oncall/shared'
```

- [ ] **Step 2: Create `apps/api/src/controllers/reports.controller.ts`**

```ts
import type { NextFunction, Request, Response } from 'express'
import type { ReportQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { monthlyReport } from '../services/reports.service'
import { currentYearMonthUTC } from '../services/stats.service'

export const reportsController = {
  async monthly(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as ReportQuery
      const now = currentYearMonthUTC()
      const year = q.year ?? now.year
      const month = q.month ?? now.month
      const report = await monthlyReport(year, month)
      res.status(200).json(ok({ report }))
    } catch (err) {
      next(err)
    }
  },
}
```

- [ ] **Step 3: Create `apps/api/src/routes/reports.routes.ts`**

```ts
import { Router } from 'express'
import { reportsController } from '../controllers/reports.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { reportQuerySchema } from '../validators/reports'

export const reportsRouter = Router()

reportsRouter.use(authenticate)
reportsRouter.use(authorize('administrator'))
reportsRouter.get('/monthly', validate(reportQuerySchema, 'query'), reportsController.monthly)
```

- [ ] **Step 4: Mount the router in `apps/api/src/app.ts`**

Add the import alongside the other route imports (after the `statsRouter` import line):

```ts
import { reportsRouter } from './routes/reports.routes'
```

Add the mount alongside the other mounts (after `app.use('/stats', statsRouter)`):

```ts
app.use('/reports', reportsRouter)
```

- [ ] **Step 5: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/controllers/reports.controller.ts apps/api/src/validators/reports.ts apps/api/src/routes/reports.routes.ts apps/api/src/app.ts
git commit -m "feat(api): /reports routes (admin-only monthly report)"
```

---

## Task 5: Backend tests

**Files:**
- Create: `apps/api/src/__tests__/reports.service.test.ts`
- Create: `apps/api/src/__tests__/reports.routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4. Test style mirrors `apps/api/src/__tests__/stats.service.test.ts` (mock dependencies at module level) and `stats.routes.test.ts` (mock the service module, `supertest`, `signAccessToken({ sub, role })`, response body at `res.body.data`).

- [ ] **Step 1: Create `apps/api/src/__tests__/reports.service.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const adminStats = vi.fn()
vi.mock('../services/stats.service', () => ({
  adminStats: (...a: unknown[]) => adminStats(...a),
}))

const getById = vi.fn()
vi.mock('../services/schedule.service', () => ({
  getById: (...a: unknown[]) => getById(...a),
}))

import { monthlyReport } from '../services/reports.service'

beforeEach(() => {
  query.mockReset()
  adminStats.mockReset()
  getById.mockReset()
})

describe('reports.service — monthlyReport', () => {
  it('empty state: schedule null -> roster empty, getById not called, holidays still queried', async () => {
    adminStats.mockResolvedValue({
      schedule: null,
      coverage: { daysInMonth: 31, filled: 0, gaps: [] },
      workload: [],
      fairness: { dutySpread: null, weekendSpread: null, holidaySpread: null },
    })
    query.mockResolvedValue({ rows: [] })

    const report = await monthlyReport(2026, 8)

    expect(report.schedule).toBeNull()
    expect(report.roster).toEqual([])
    expect(getById).not.toHaveBeenCalled()
    expect(report.holidays).toEqual([])
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // holidays query scoped to month bounds
    expect(query).toHaveBeenCalledTimes(1)
    const sql = String(query.mock.calls[0]?.[0])
    expect(sql).toContain('date >= $1 AND date <= $2')
    expect(query.mock.calls[0]?.[1]).toEqual(['2026-08-01', '2026-08-31'])
  })

  it('with schedule: composes roster from getById and forwards stats fields', async () => {
    const schedule = {
      id: 7,
      year: 2026,
      month: 9,
      status: 'published',
      createdBy: 1,
      createdAt: '',
      updatedAt: '',
    }
    adminStats.mockResolvedValue({
      schedule,
      coverage: { daysInMonth: 30, filled: 30, gaps: [] },
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
      ],
      fairness: { dutySpread: 0, weekendSpread: 0, holidaySpread: 0 },
    })
    const duties = [
      {
        id: 1,
        scheduleId: 7,
        dutyDate: '2026-09-01',
        doctorId: 1,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'engine',
        createdAt: '',
      },
    ]
    getById.mockResolvedValue({ schedule, duties })
    query.mockResolvedValue({ rows: [{ date: '2026-09-15', name: 'Mid-Autumn' }] })

    const report = await monthlyReport(2026, 9)

    expect(getById).toHaveBeenCalledWith(7)
    expect(report.roster).toEqual(duties)
    expect(report.coverage.filled).toBe(30)
    expect(report.workload).toHaveLength(1)
    expect(report.fairness.dutySpread).toBe(0)
    expect(report.holidays).toEqual([{ date: '2026-09-15', name: 'Mid-Autumn' }])
    // September month bounds
    expect(query.mock.calls[0]?.[1]).toEqual(['2026-09-01', '2026-09-30'])
  })
})
```

- [ ] **Step 2: Create `apps/api/src/__tests__/reports.routes.test.ts`**

```ts
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const monthlyReport = vi.fn()
vi.mock('../services/reports.service', () => ({
  monthlyReport: (...a: unknown[]) => monthlyReport(...a),
}))
vi.mock('../services/stats.service', () => ({
  currentYearMonthUTC: () => {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  },
}))

import { errorHandler } from '../middleware/error-handler'
import { signAccessToken } from '../lib/jwt'
import { reportsRouter } from '../routes/reports.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/reports', reportsRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

function emptyReport(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    generatedAt: '2026-08-07T00:00:00.000Z',
    schedule: null,
    roster: [],
    coverage: { daysInMonth: 31, filled: 0, gaps: [] },
    workload: [],
    fairness: { dutySpread: null, weekendSpread: null, holidaySpread: null },
    holidays: [],
    ...overrides,
  }
}

beforeEach(() => {
  monthlyReport.mockReset()
})

describe('reports routes', () => {
  it('admin 200; doctor 403; unauth 401', async () => {
    monthlyReport.mockResolvedValue(emptyReport())
    const ok200 = await request(build())
      .get('/reports/monthly')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.report).toBeDefined()

    const forbidden = await request(build())
      .get('/reports/monthly')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)

    const unauth = await request(build()).get('/reports/monthly')
    expect(unauth.status).toBe(401)
  })

  it('rejects invalid month with 400', async () => {
    const res = await request(build())
      .get('/reports/monthly?month=13')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('without query resolves to the current UTC month', async () => {
    monthlyReport.mockResolvedValue(emptyReport())
    await request(build())
      .get('/reports/monthly')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(monthlyReport).toHaveBeenCalledTimes(1)
    const now = new Date()
    expect(monthlyReport.mock.calls[0]?.[0]).toBe(now.getUTCFullYear())
    expect(monthlyReport.mock.calls[0]?.[1]).toBe(now.getUTCMonth() + 1)
  })

  it('passes explicit year/month through', async () => {
    monthlyReport.mockResolvedValue(emptyReport({ year: 2025, month: 12 }))
    await request(build())
      .get('/reports/monthly?year=2025&month=12')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(monthlyReport).toHaveBeenCalledWith(2025, 12)
  })
})
```

- [ ] **Step 3: Run typecheck, lint, and tests to verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors; all new reports tests green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/__tests__/reports.service.test.ts apps/api/src/__tests__/reports.routes.test.ts
git commit -m "test(api): reports service composition + routes RBAC/validation"
```

---

## Task 6: Frontend reports service + download helper

**Files:**
- Create: `apps/web/src/services/reports.ts`
- Create: `apps/web/src/lib/download.ts`

**Interfaces:**
- Consumes: types `MonthlyReport`, `ReportQuery` from `@oncall/shared` (Task 1); `apiGet` from `@/lib/http`.
- Produces: `monthly(query?: ReportQuery): Promise<MonthlyReport>` from `@/services/reports`; `downloadCsv(filename: string, csv: string): void` from `@/lib/download`.

- [ ] **Step 1: Create `apps/web/src/services/reports.ts`**

```ts
import type { MonthlyReport, ReportQuery } from '@oncall/shared'
import { apiGet } from '@/lib/http'

function toQuery(query?: ReportQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.year !== undefined) parts.push(`year=${query.year}`)
  if (query.month !== undefined) parts.push(`month=${query.month}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function monthly(query?: ReportQuery): Promise<MonthlyReport> {
  const { report } = await apiGet<{ report: MonthlyReport }>(`/reports/monthly${toQuery(query)}`)
  return report
}
```

- [ ] **Step 2: Create `apps/web/src/lib/download.ts`**

```ts
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 3: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/services/reports.ts apps/web/src/lib/download.ts
git commit -m "feat(web): reports service wrapper + CSV download helper"
```

---

## Task 7: ReportsPage component

**Files:**
- Create: `apps/web/src/pages/ReportsPage.vue`

**Interfaces:**
- Consumes: `monthly(query?)` from `@/services/reports` (Task 6); `downloadCsv` from `@/lib/download` (Task 6); `dutiesToCsv` from `@oncall/utils` (Task 2); types `MonthlyReport`, `Duty` from `@oncall/shared`; UI components `Button`, `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Input`, `Label`, `Table*` from `@/components/ui/*`; `useRouter` from `vue-router`.
- Produces: default-exported `ReportsPage.vue` SFC consumed by the router (Task 8).

- [ ] **Step 1: Create `apps/web/src/pages/ReportsPage.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Duty, MonthlyReport } from '@oncall/shared'
import { dutiesToCsv } from '@oncall/utils'
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
import * as reportsService from '@/services/reports'
import { downloadCsv } from '@/lib/download'

const router = useRouter()
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const weekdayFmt = new Intl.DateTimeFormat('en', { weekday: 'short' })
const dayFmt = new Intl.DateTimeFormat('en', { day: '2-digit' })

const now = new Date()
const year = ref(String(now.getUTCFullYear()))
const month = ref(String(now.getUTCMonth() + 1))

const report = ref<MonthlyReport | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const monthLabel = computed(() => `${MONTHS[Number(month.value) - 1]} ${year.value}`)
const isPublished = computed(() => report.value?.schedule?.status === 'published')

interface DayRow {
  date: string
  weekday: string
  day: string
  isWeekend: boolean
  duty?: Duty
}
const rows = computed<DayRow[]>(() => {
  const r = report.value
  if (!r || !r.schedule) return []
  const total = new Date(Date.UTC(r.year, r.month, 0)).getUTCDate()
  const byDate = new Map<string, Duty>()
  for (const d of r.roster) byDate.set(d.dutyDate, d)
  const out: DayRow[] = []
  for (let dayNum = 1; dayNum <= total; dayNum++) {
    const iso = `${r.year}-${String(r.month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
    const js = new Date(`${iso}T00:00:00Z`)
    const dow = js.getUTCDay()
    out.push({
      date: iso,
      weekday: weekdayFmt.format(js),
      day: dayFmt.format(js),
      isWeekend: dow === 0 || dow === 6,
      duty: byDate.get(iso),
    })
  }
  return out
})

const maxInSet = computed(() =>
  report.value ? Math.max(1, ...report.value.workload.map((w) => w.duties)) : 1,
)
const fairnessBadge = computed(() => {
  const s = report.value?.fairness.dutySpread
  if (s === null) return { text: 'N/A', class: 'bg-muted text-muted-foreground' }
  return s <= 1
    ? { text: 'Well balanced', class: 'bg-primary/10 text-primary' }
    : { text: 'Imbalanced — review workload', class: 'bg-destructive/10 text-destructive' }
})

function fmtGenerated(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    report.value = await reportsService.monthly({ year: Number(year.value), month: Number(month.value) })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load report'
  } finally {
    loading.value = false
  }
}

function exportCsv() {
  if (!report.value?.roster.length) return
  const csv = dutiesToCsv(report.value.roster)
  downloadCsv(`oncall-${year.value}-${String(month.value).padStart(2, '0')}.csv`, csv)
}

function printReport() {
  window.print()
}

function gotoSchedules() {
  router.push('/schedules')
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="no-print flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="r-year">Year</Label>
        <Input id="r-year" v-model="year" type="number" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="r-month">Month</Label>
        <select
          id="r-month"
          v-model="month"
          class="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
        </select>
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="no-print text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="no-print text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card v-if="report && !report.schedule">
      <CardHeader>
        <CardTitle>No schedule for {{ monthLabel }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">Generate a schedule for this month to produce a report.</p>
        <Button class="no-print w-fit" @click="gotoSchedules">Go to Schedules</Button>
      </CardContent>
    </Card>

    <template v-if="report && report.schedule">
      <div class="no-print flex items-center gap-2">
        <Button :disabled="!report.roster.length" @click="exportCsv">Export CSV</Button>
        <Button variant="outline" @click="printReport">Print / Save as PDF</Button>
      </div>

      <div class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold text-foreground">On-Call Duty</h1>
        <p class="text-lg font-medium text-foreground">{{ monthLabel }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <span
            :class="isPublished
              ? 'inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'"
          >
            {{ isPublished ? 'Published' : 'Draft' }}
          </span>
          <span class="text-xs text-muted-foreground">Generated {{ fmtGenerated(report.generatedAt) }}</span>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Coverage</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-2xl font-semibold text-foreground">
              {{ report.coverage.filled }} / {{ report.coverage.daysInMonth }} days filled
            </p>
            <p v-if="report.coverage.gaps.length > 0" class="text-sm text-destructive">
              Gap days: {{ report.coverage.gaps.join(', ') }}
            </p>
            <p v-else class="text-sm text-muted-foreground">No gap days.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fairness</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-sm text-muted-foreground">Duty spread (max − min across assigned doctors)</p>
            <p class="text-2xl font-semibold text-foreground">{{ report.fairness.dutySpread ?? 'N/A' }}</p>
            <span
              :class="`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ${fairnessBadge.class}`"
            >
              {{ fairnessBadge.text }}
            </span>
            <p class="text-xs text-muted-foreground">
              Weekend spread {{ report.fairness.weekendSpread ?? 'N/A' }} · Holiday spread
              {{ report.fairness.holidaySpread ?? 'N/A' }}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card v-if="report.holidays.length > 0">
        <CardHeader><CardTitle>Holidays this month</CardTitle></CardHeader>
        <CardContent>
          <ul class="flex flex-col gap-1">
            <li v-for="h in report.holidays :key="h.date" class="text-sm text-foreground">
              {{ h.date }} — {{ h.name }}
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Duty roster</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="r in rows" :key="r.date">
                <TableCell>{{ r.weekday }} {{ r.day }}</TableCell>
                <TableCell>
                  <span v-if="r.duty">{{ r.duty.doctorFirstName }} {{ r.duty.doctorLastName }}</span>
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
                      v-if="r.duty?.isHoliday"
                      class="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    >
                      Holiday
                    </span>
                    <span
                      v-if="!r.duty"
                      class="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    >
                      Gap day
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span v-if="r.duty" class="text-xs text-muted-foreground">{{ r.duty.reason }}</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
              <TableRow v-for="w in report.workload" :key="w.doctorId">
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
git add apps/web/src/pages/ReportsPage.vue
git commit -m "feat(web): ReportsPage (consolidated monthly report + CSV/print)"
```

---

## Task 8: Router, nav link, print styles

**Files:**
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/layout/AppHeader.vue`
- Modify: `apps/web/src/style.css`

**Interfaces:**
- Consumes: `ReportsPage.vue` (Task 7); `useAuthStore` (existing).
- Produces: a `/reports` admin-only route, an admin-gated "Reports" nav link, and a global `@media print` block.

- [ ] **Step 1: Add the `/reports` route in `apps/web/src/router/index.ts`**

Inside the `DefaultLayout` children array, after the `holidays` route object and before the `my-availability` route object, add:

```ts
      {
        path: 'reports',
        name: 'reports',
        component: () => import('../pages/ReportsPage.vue'),
        meta: { roles: ['administrator'] },
      },
```

- [ ] **Step 2: Add the "Reports" nav link in `apps/web/src/components/layout/AppHeader.vue`**

In the `<nav>`, after the Holidays `RouterLink` and before the Profile `RouterLink`, add:

```html
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/reports">Reports</RouterLink>
```

- [ ] **Step 3: Append the print rules to `apps/web/src/style.css`**

Append to the end of the file:

```css

@media print {
  header,
  .no-print {
    display: none !important;
  }
  .container {
    max-width: 100% !important;
  }
  main {
    padding: 0 !important;
  }
}
```

- [ ] **Step 4: Run typecheck and lint to verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/router/index.ts apps/web/src/components/layout/AppHeader.vue apps/web/src/style.css
git commit -m "feat(web): /reports route + nav link + print stylesheet"
```

---

## Task 9: Frontend tests

**Files:**
- Create: `apps/web/src/__tests__/ReportsPage.test.ts`
- Create: `apps/web/src/__tests__/download.test.ts`

**Interfaces:**
- Consumes: Tasks 6–8. Test style mirrors `apps/web/src/__tests__/AdminDashboard.test.ts` (`vi.mock('@/services/...')`, `mount` + `flushPromises`, `createPinia`).

- [ ] **Step 1: Create `apps/web/src/__tests__/ReportsPage.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const monthly = vi.fn()
vi.mock('@/services/reports', () => ({
  monthly: (...a: unknown[]) => monthly(...a),
}))
const downloadCsv = vi.fn()
vi.mock('@/lib/download', () => ({
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import ReportsPage from '../pages/ReportsPage.vue'

function fullReport(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    generatedAt: '2026-08-07T10:00:00.000Z',
    schedule: {
      id: 1,
      year: 2026,
      month: 8,
      status: 'published',
      createdBy: 1,
      createdAt: '',
      updatedAt: '',
    },
    roster: [
      {
        id: 1,
        scheduleId: 1,
        dutyDate: '2026-08-01',
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'engine',
        createdAt: '',
      },
    ],
    coverage: { daysInMonth: 31, filled: 1, gaps: [] },
    workload: [
      {
        doctorId: 5,
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthly: 7,
        duties: 1,
        weekday: 1,
        weekend: 0,
        holiday: 0,
      },
    ],
    fairness: { dutySpread: 0, weekendSpread: 0, holidaySpread: 0 },
    holidays: [{ date: '2026-08-15', name: 'Assumption' }],
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  monthly.mockReset()
  downloadCsv.mockReset()
  push.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('ReportsPage', () => {
  it('renders the empty state and navigates to /schedules when no schedule', async () => {
    monthly.mockResolvedValue(
      fullReport({
        schedule: null,
        roster: [],
        coverage: { daysInMonth: 31, filled: 0, gaps: [] },
        workload: [],
        fairness: { dutySpread: null, weekendSpread: null, holidaySpread: null },
        holidays: [],
      }),
    )
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('No schedule for')
    const go = w.findAll('button').find((b) => b.text().includes('Go to Schedules'))!
    await go.trigger('click')
    expect(push).toHaveBeenCalledWith('/schedules')
  })

  it('renders header, roster, workload, fairness, and holidays', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('On-Call Duty')
    expect(w.text()).toContain('Published')
    expect(w.text()).toContain('Jane Roe')
    expect(w.text()).toContain('Well balanced')
    expect(w.text()).toContain('Assumption')
  })

  it('marks an unassigned gap day in the roster', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('Unassigned')
    expect(w.text()).toContain('Gap day')
  })

  it('reloads on Apply', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    expect(monthly).toHaveBeenCalledTimes(2)
  })

  it('Export CSV triggers downloadCsv with the expected filename', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const exportBtn = w.findAll('button').find((b) => b.text().includes('Export CSV'))!
    await exportBtn.trigger('click')
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, csv] = downloadCsv.mock.calls[0]!
    expect(filename).toMatch(/^oncall-\d{4}-\d{2}\.csv$/)
    expect(csv).toContain('Date,Weekday,Doctor,Weekend,Holiday,Reason')
    expect(csv).toContain('Jane Roe')
  })

  it('Print button calls window.print', async () => {
    const printSpy = vi.fn()
    const original = window.print
    window.print = printSpy
    monthly.mockResolvedValue(fullReport())
    try {
      const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
      await flushPromises()
      const printBtn = w.findAll('button').find((b) => b.text().includes('Print'))!
      await printBtn.trigger('click')
      expect(printSpy).toHaveBeenCalledTimes(1)
    } finally {
      window.print = original
    }
  })
})
```

- [ ] **Step 2: Create `apps/web/src/__tests__/download.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from '../lib/download'

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a blob URL, sets the filename, clicks an anchor, and revokes the URL', () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL')
    const clickSpy = vi.fn()

    const origCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLAnchorElement
      if (tag === 'a') el.click = clickSpy
      return el
    })

    downloadCsv('oncall-2026-08.csv', 'Date,Weekday\n2026-08-01,Friday')

    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake')
    createSpy.mockRestore()
  })
})
```

> Note: jsdom defines `URL.createObjectURL`/`revokeObjectURL`, `document.createElement`, `appendChild`, and `removeChild`, so the only mocks needed are the URL spies (to assert revocation) and the anchor `click` spy (to assert the download is triggered). The real `appendChild`/`removeChild` round-trip works because jsdom keeps the node attached between the two calls.

- [ ] **Step 3: Run typecheck, lint, and tests to verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors; all new web tests green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/__tests__/ReportsPage.test.ts apps/web/src/__tests__/download.test.ts
git commit -m "test(web): ReportsPage report rendering + CSV/print + download helper"
```

---

## Final verification

After Task 9, from the repo root:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three must pass across the monorepo. Then optionally smoke-test with `pnpm dev`: sign in as the seeded admin → open **Reports** (nav) → pick a generated month → see the consolidated report (status badge, coverage, fairness, roster with gap days, workload, holidays) → **Export CSV** downloads `oncall-{year}-{month}.csv` → **Print / Save as PDF** opens a chrome-free print dialog → pick an ungenerated month → empty state links to `/schedules`. A doctor signing in sees no **Reports** link and gets 403 on `/reports/monthly`.
