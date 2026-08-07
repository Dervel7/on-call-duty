# Phase 8 — Reporting Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 8 of 8 (Reporting)
**Status:** Approved (2026-08-07)
**Scope owner:** full-stack — `apps/api` (new `/reports` router) + `apps/web` (new `/reports` page) + `packages/utils` (CSV helper)
**Builds on:** Phase 7 — Statistics & Dashboard (complete); Phase 6 — Schedule Management UI (complete); Phase 5 — Scheduling Engine (complete)

---

## 1. Purpose

Phase 8 delivers an **admin-only Reporting** feature: a dedicated `/reports` page where an administrator
selects a month and gets a **consolidated monthly on-call report** (duty roster + workload summary +
coverage), can **export the roster as CSV**, and can **print or save the report as PDF** via the browser's
native print. This is the final business feature on the roadmap and fulfils the "reports" item that
Phase 7 explicitly deferred ("CSV/PDF export — Phase 8").

- The report is the official, archivable view of a month: every day's assigned doctor, weekend/holiday
  flags, the assignment reason, a per-doctor workload table, coverage (filled/gaps), a fairness badge, and
  the holidays falling in the month.
- **CSV** serializes the roster (the primary archival artifact) so it can be ingested by spreadsheets and
  external compliance tooling.
- **PDF** uses the browser's print-to-PDF over a dedicated print stylesheet — no PDF-generation library.

**No database migration.** All required data already exists (`schedules`, `duties`, `doctors`, `users`,
`holidays`). Phase 8 is pure read-only aggregation + presentation on top of the existing schema, exactly
like Phase 7.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Audience | **Administrators only.** Reports are compliance/oversight artifacts. `authenticate + authorize('administrator')`; doctors receive 403 and no nav link / route |
| Scope | **A single consolidated monthly report.** One month selector → one page covering roster + workload + coverage + fairness + holidays. No multi-month trends, no per-doctor historical report, no arbitrary date-range report (YAGNI) |
| Time scope | **Single selectable month**, default = current month (matches the monthly schedule model, the engine's ±1 fairness target, and Phase 7's admin dashboard) |
| Status policy | **Admin sees `draft` + `published`** (consistent with Phase 7 admin). The report header shows the schedule status badge so a draft is never mistaken for an official published month. No schedule for the month → empty state linking to `/schedules` |
| API architecture | **New read-only `/reports` router with one GET endpoint** that composes existing services (`statsService.adminStats` for coverage/workload/fairness/schedule, `scheduleService.getById` for the roster) plus one small holidays-in-month query. The reports service is thin composition — it does not re-implement Phase 7 aggregation |
| CSV | **Client-side generation** via a pure `dutiesToCsv` helper in `@oncall/utils` (pure-helpers package, no deps) and a DOM `downloadCsv` in `apps/web/src/lib`. The API stays pure-JSON (`{ success, data }`); no `text/csv` endpoint, no `lib/http` changes. CSV escaping (RFC 4180) lives in the tested pure helper |
| PDF | **Browser print.** A scoped `@media print` block (added to `style.css`) hides nav/buttons and expands the layout; the page calls `window.print()`. No `puppeteer`/`jsPDF`/`pdfkit` (would violate "no unnecessary dependencies") |
| Routing & nav | **New `/reports` route** (`meta: { roles: ['administrator'] }`) + a "Reports" link in `AppHeader` (admin-gated), placed after "Holidays" |
| Hospital identity | **Static "On-Call Duty" title** on the report header (the system targets a single hospital; multi-hospital is out of scope) |

## 3. Architecture & Layering

Phase 8 reuses the Phase 2–7 layering (Controllers → Services → Database on the API; Pages → Components →
Services → `lib/http` on the web). No new layers, no new dependencies, no new tables.

```
packages/shared/src/
├── types/reports.ts                       # NEW — ReportQuery, ReportHoliday, MonthlyReport; re-exported from types/index.ts
└── schemas/reports.ts                     # NEW — reportQuerySchema (optional coerced year/month); re-exported from schemas/index.ts

packages/utils/src/
├── csv.ts                                 # NEW — escapeCsvField, CsvDutyRow, dutiesToCsv (RFC 4180); re-exported from index.ts
└── __tests__/csv.test.ts                  # NEW — escape + serialize coverage

apps/api/src/
├── services/reports.service.ts            # NEW — monthlyReport(year, month): composes stats + schedule services + holidays query
├── controllers/reports.controller.ts      # NEW — thin monthly handler
├── routes/reports.routes.ts               # NEW — GET /reports/monthly (admin-only)
├── validators/reports.ts                  # NEW — re-exports reportQuerySchema from @oncall/shared (mirrors validators/stats.ts)
├── app.ts                                 # EDIT — app.use('/reports', reportsRouter)
└── __tests__/
    ├── reports.service.test.ts            # NEW — composition, empty state, roster, holidays
    └── reports.routes.test.ts             # NEW — RBAC (403/401), query validation, default month

apps/web/src/
├── services/reports.ts                    # NEW — thin wrapper: monthly(query)
├── lib/download.ts                        # NEW — downloadCsv(filename, csv): Blob + object URL trigger
├── pages/ReportsPage.vue                  # NEW — month picker + consolidated report + CSV/Print buttons
├── router/index.ts                        # EDIT — add /reports route (admin-only)
├── components/layout/AppHeader.vue        # EDIT — add "Reports" nav link (admin-gated)
├── style.css                              # EDIT — add @media print rules (hide nav/buttons, full-width)
└── __tests__/
    ├── ReportsPage.test.ts                # NEW — picker reload, empty state, report rendering, CSV trigger
    └── download.test.ts                   # NEW — downloadCsv builds a blob link (jsdom)

database/                                  # none — no migration
```

## 4. Shared Types (`packages/shared/src/types/reports.ts`)

New file, re-exported from `types/index.ts` (and thereby from `@oncall/shared`). Reuses the Phase 7
`AdminCoverage`, `AdminWorkloadItem`, `AdminFairness` types and the Phase 5 `ScheduleSummary`/`Duty`
types — no duplication of those shapes.

```ts
import type { AdminCoverage, AdminFairness, AdminWorkloadItem } from './stats'
import type { Duty, ScheduleSummary } from './schedule'

export interface ReportQuery {
  year?: number
  month?: number
}

export interface ReportHoliday {
  date: string   // ISO
  name: string
}

export interface MonthlyReport {
  year: number
  month: number
  generatedAt: string            // ISO timestamp of report generation
  schedule: ScheduleSummary | null   // null when no schedule exists for the month
  roster: Duty[]                 // assigned duties, ascending by duty_date; empty when no schedule
  coverage: AdminCoverage        // reuse Phase 7 type
  workload: AdminWorkloadItem[]  // reuse Phase 7 type
  fairness: AdminFairness        // reuse Phase 7 type
  holidays: ReportHoliday[]      // holidays whose date falls in this month, ascending by date
}
```

No zod request-body schema (the endpoint is a GET). `reportQuerySchema` is defined in
`packages/shared/src/schemas/reports.ts` and re-exported from `@oncall/shared`, mirroring
`statsQuerySchema` exactly (same `z.coerce.number().int()` bounds):

```ts
import { z } from 'zod'

export const reportQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
```

`apps/api/src/validators/reports.ts` is a one-line re-export (`export { reportQuerySchema } from
'@oncall/shared'`), matching `validators/stats.ts`. When `year` or `month` is absent, the controller
fills in the **current** year/month (UTC) before calling the service, so `GET /reports/monthly` with no
query returns the current month. Invalid `year`/`month` → **400** via the existing `validate` middleware
(which throws `HttpError(400, …)` on any parse failure — the codebase's de-facto validation status).

## 5. Pure CSV Helper (`packages/utils/src/csv.ts`)

CSV generation is pure and dependency-free, so it lives in the `@oncall/utils` pure-helpers package and is
unit-tested there. The helper is typed against a minimal local interface (it must **not** import from
`@oncall/shared` — utils has no such dependency) that is structurally compatible with the `Duty` type.

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

The weekday is computed from `dutyDate` in UTC (the same calendar the engine and stats use), because the
`Duty` row carries `isWeekend` but not the weekday name. Records use `\r\n` line endings per RFC 4180 for
maximum spreadsheet compatibility.

## 6. Backend Design (`apps/api`)

### 6.1 Router — `routes/reports.routes.ts`

Mounted at `/reports` in `app.ts` (`app.use('/reports', reportsRouter)`), placed after `/stats`.

```ts
reportsRouter.use(authenticate)
reportsRouter.use(authorize('administrator'))
reportsRouter.get('/monthly', validate(reportQuerySchema, 'query'), reportsController.monthly)
```

Unlike `/stats` (which has a `/me` route open to any authenticated user), the entire `/reports` router is
admin-only — reports are an administrative artifact, so the `authorize('administrator')` is applied at the
router level.

| Method | Path | Auth | Query | Response |
|---|---|---|---|---|
| GET | `/reports/monthly` | authenticate + administrator | `?year=&month=` (optional) | 200 `{ report: MonthlyReport }` |

### 6.2 Controller — `controllers/reports.controller.ts`

Thin handler (`try { … } catch (err) { next(err) }`, `res.status(200).json(ok({ report }))`), mirroring
`stats.controller.ts`:

- `monthly(req, res, next)`: default `year`/`month` to the current UTC date when absent, then
  `const report = await reportsService.monthlyReport(year, month)`.

`currentYearMonthUTC` is reused from `stats.service` (already exported there in Phase 7) so the controller
does not duplicate the "today" logic.

### 6.3 Service — `services/reports.service.ts`

One exported function. It is **thin composition**: it reuses `statsService.adminStats(year, month)` for the
schedule lookup + coverage + workload + fairness, reuses `scheduleService.getById(id)` for the roster
(duty rows with doctor names), and adds one small parameterized query for the holidays in the month. No
aggregation logic is duplicated from Phase 7.

```ts
import type { MonthlyReport, ReportHoliday } from '@oncall/shared'
import { query } from '../db/client'
import { daysInMonth, isoDate } from '../scheduling/dates'
import * as scheduleService from './schedule.service'
import * as statsService from './stats.service'

export async function monthlyReport(year: number, month: number): Promise<MonthlyReport> {
  // 1. Reuse Phase 7 aggregation: schedule (or null) + coverage + workload + fairness.
  const stats = await statsService.adminStats(year, month)

  // 2. Roster: only when a schedule exists. getById throws 404 on a missing id, but stats.schedule
  //    being non-null guarantees the row exists, so this never throws in practice.
  let roster: MonthlyReport['roster'] = []
  if (stats.schedule) {
    const detail = await scheduleService.getById(stats.schedule.id)
    roster = detail.duties // already ascending by duty_date and carrying doctor names + flags
  }

  // 3. Holidays in this month (month bounds reuse the existing date helpers).
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

> Note: `statsService.adminStats` returns `schedule: null` when no schedule exists, with `coverage`
> computed against zero assigned days (all gaps) and `workload` listing active doctors with 0 duties. The
> reports service forwards these fields unchanged so the payload is always well-formed; the page renders an
> empty-state card when `schedule === null` rather than showing an all-zero report. This mirrors the Phase 7
> admin-dashboard empty state exactly.

## 7. Frontend Design (`apps/web`)

### 7.1 New service — `services/reports.ts` (mirrors `services/stats.ts`)

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

`apiGet` unwraps `{ success, data }`; the service then unwraps the `report` key — identical to how
`services/stats.ts` unwraps `{ stats }`.

### 7.2 New download helper — `lib/download.ts`

Isolates the DOM-specific file download so the pure `dutiesToCsv` stays in `@oncall/utils` (testable
without jsdom) and the DOM side is a tiny, separately-testable function:

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

### 7.3 New page — `pages/ReportsPage.vue`

- State: `year`/`month` string refs defaulted to today (`String(new Date().getUTCFullYear())`,
  `String(new Date().getUTCMonth() + 1)`); `report: MonthlyReport | null`; `loading`; `errorMsg`.
- `load()`: build `ReportQuery` from the refs and call `reportsService.monthly({ year, month })`, using the
  established `e instanceof Error ? e.message : 'Failed to load report'` guard. `onMounted(load)`.
  Re-runs on "Apply".
- **Month picker** (`class="no-print"`): year `Input` + month `<select>` (1–12) + Apply `Button`. Mirrors
  `AdminDashboard.vue` / `SchedulesPage.vue`.
- **Action bar** (`class="no-print"`): "Export CSV" and "Print / Save as PDF" buttons, disabled when there
  is no schedule (empty state). The CSV handler calls `downloadCsv('oncall-{year}-{month}.csv',
  dutiesToCsv(report.roster))`. The print handler calls `window.print()`.
- **Empty state** (when `report.schedule === null`): a `Card` "No schedule for {Month Year}" with a
  `Button` that `router.push('/schedules')` — identical to the admin-dashboard empty state.
- **Report header** (printable): hospital title ("On-Call Duty"), "{Month Year}", the schedule status
  badge (Published/Draft), and "Generated {generatedAt formatted}".
- **Coverage card**: "{filled} / {daysInMonth} days filled"; gap list when `gaps.length > 0`.
- **Fairness line**: duty spread + a balanced/imbalanced badge (same thresholds as the admin dashboard:
  `≤ 1` balanced, `≥ 2` imbalanced, `null` N/A), with weekend/holiday spreads as a secondary line.
- **Roster table** (`Table*`): columns **Date** (formatted weekday + day) · **Doctor** (or italic
  "Unassigned" for gap days, computed by diffing the month's days against the roster) · **Flags**
  (Weekend/Holiday badges) · **Reason**. Rendered for every day of the month so the printed roster is
  complete (gap days show "Unassigned"), matching the Schedule detail page's day-list approach.
- **Workload table** (`Table*`): columns **Doctor** (inactive → muted + badge) · **Duties** (number + CSS
  bar, same track/fill pattern as the admin dashboard) · **Weekend** · **Holiday** · **Cap**.
- **Holidays list**: inline list of `holidays` (date + name) when non-empty.

Date formatting uses `Intl.DateTimeFormat` inline (same `fmt` helper shape as `DoctorDashboard.vue`),
with `timeZone: 'UTC'` so the printed dates match the stored ISO calendar.

### 7.4 Routing & navigation

- `router/index.ts`: add `{ path: 'reports', name: 'reports', component: () =>
  import('../pages/ReportsPage.vue'), meta: { roles: ['administrator'] } }` inside the `DefaultLayout`
  children, after `holidays`. The auth guard already enforces `meta.roles`.
- `AppHeader.vue`: add `<RouterLink v-if="auth.isAdmin" ... to="/reports">Reports</RouterLink>` after the
  "Holidays" link.

### 7.5 Print stylesheet — `style.css` (global, minimal)

A small `@media print` block is appended to `apps/web/src/style.css`. It hides the app chrome on print and
lets the report use the full page width:

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

This is a sensible global rule (no page prints its nav bar) and keeps print logic out of individual
components. The report page marks its month picker and action buttons with `class="no-print"`.

All styling uses existing Tailwind theme tokens (`text-foreground`, `bg-primary/10`, `bg-muted`,
`text-muted-foreground`, `text-destructive`, `border-input`, `bg-background`, `bg-card`). No hardcoded
colors.

## 8. Error Handling

`ApiError` (`lib/http.ts`) carries `.status`; the existing 401 auto-refresh and router guard handle auth.
The page renders errors with the established guard:

```ts
errorMsg.value = e instanceof Error ? e.message : 'Failed to load report'
```

- **401** → handled by `lib/http` (silent refresh); the router guard redirects unauthed users to `/login`.
- **403** (`/reports/monthly` called by a doctor) → cannot happen via the UI (the route + nav are
  admin-gated), but the message is shown inline if it ever occurred.
- **400** (invalid `year`/`month` query) → cannot happen via the UI (the picker constrains values); the
  browser would show the server message if it ever occurred.

## 9. Security & Integrity

- **RBAC:** the entire `/reports` router is `authenticate + authorize('administrator')` (doctor → 403,
  unauth → 401). The route's `meta.roles: ['administrator']` and the admin-gated nav link mean doctors
  never reach the page.
- **No widening of existing access:** the reports service only **reads** via existing services
  (`statsService`, `scheduleService`) and a parameterized `SELECT` on `holidays`. No new write surface; no
  new object-level authorization beyond the admin role gate. No request body is trusted (GET only).
- **Status policy:** admins see `draft` + `published` (inherited from `statsService.adminStats`, which
  applies no status filter). The report's status badge makes the distinction explicit. Doctors never see
  any report (403).
- **No new SQL surface beyond one parameterized `SELECT`** on `holidays` (`date >= $1 AND date <= $2`);
  no ORM; no PG-error-code reliance.

## 10. Testing Strategy

### 10.1 Utils (`packages/utils`, Vitest)

- **`csv.test.ts`:**
  - `escapeCsvField`: clean field passes through; a field with a comma, a double-quote, a CR, and a LF is
    wrapped in quotes with internal quotes doubled.
  - `dutiesToCsv`: emits the header row even for empty input; emits one line per row in the right column
    order; the weekday matches the `dutyDate` (UTC); `Yes`/`No` booleans; CRLF line endings; a reason
    containing a comma is correctly quoted.

### 10.2 Backend (`apps/api`, service modules mocked at module level — same style as
`stats.service.test.ts`)

- **`reports.service.test.ts`:**
  - Empty state: `statsService.adminStats` returns `schedule: null` → `monthlyReport` returns
    `schedule: null`, `roster: []`, and forwards coverage/workload/fairness; `scheduleService.getById` is
    **not** called; holidays query still runs.
  - With schedule: `adminStats` returns a schedule + coverage/workload/fairness; `getById` returns duties;
    the result `roster` equals the duties and `generatedAt` is an ISO string; `holidays` come from the
    query and are passed through.
  - Holidays query is scoped to the month bounds (assert the SQL substring contains `date >= $1 AND date
    <= $2` and the params are the first/last day of the month).
- **`reports.routes.test.ts`** (supertest, service mocked at module level):
  - `GET /reports/monthly` → 200 for admin; 403 for doctor; 401 unauth; 400 for invalid `month`/`year`;
    default (no query) resolves to the current UTC month.

### 10.3 Frontend (`apps/web/src/__tests__`, Vitest + `@vue/test-utils`, services mocked via `vi.mock`)

- **`ReportsPage.test.ts`:** month picker reloads on Apply; empty-state card + "Go to Schedules" when
  `schedule === null`; report renders the status badge, roster rows (including an "Unassigned" gap day),
  workload rows, and the fairness badge; "Export CSV" calls `downloadCsv` (mocked) with the expected
  filename and the `dutiesToCsv` output; "Print" calls `window.print` (mocked).
- **`download.test.ts`:** `downloadCsv` creates an `<a download>` and triggers a click (jsdom); the helper
  is resilient to a missing body append (cleanup).

### 10.4 Verification (per `AGENTS.md`)

`pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo. No Prettier (format with
Volar). Manual smoke via `pnpm dev`: admin opens `/reports`, picks a generated month → sees the
consolidated report, exports CSV (opens/downloads `oncall-{year}-{month}.csv`), and Print → Save as PDF
shows a clean, chrome-free printout; picks an ungenerated month → empty state.

## 11. Definition of Done (Phase 8)

- An admin can open **Reports** (nav link, `/reports`), pick a month, and see a consolidated report:
  header with status badge + generation time, a per-day roster (with Weekend/Holiday badges and gap days
  marked), a coverage summary, a fairness badge, a per-doctor workload table, and the month's holidays.
- An admin can **export the roster as CSV** (downloads `oncall-{year}-{month}.csv`) and **print / save as
  PDF** (browser print dialog, with nav and action buttons hidden and the report at full width).
- No schedule for the selected month → an empty state that links to `/schedules`.
- `GET /reports/monthly` is admin-only (doctor → 403, unauth → 401); invalid `year`/`month` → 400; no
  query → current UTC month. The reports service composes Phase 7's `statsService.adminStats` and Phase 5's
  `scheduleService.getById` plus one holidays query — no aggregation duplication, no DB migration.
- Doctors still receive 403 on every `/reports` route; the nav link and route are admin-gated.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass across the monorepo.

## 12. Out of Scope (Phase 8)

Multi-month / year-over-year trend charts (would require a charting dependency); per-doctor historical
reports; arbitrary (non-month) date-range reports; server-side PDF generation (`puppeteer`/`jsPDF`); email
delivery of reports; scheduled/automated report generation; report persistence/archival beyond the
underlying schedules; multi-hospital.
