# Phase 7 — Statistics & Dashboard Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 7 of 8 (Statistics & Dashboard)
**Status:** Approved (2026-08-07)
**Scope owner:** full-stack — `apps/api` (new `/stats` router) + `apps/web` (role-aware home)
**Builds on:** Phase 6 — Schedule Management UI (complete); Phase 5 — Scheduling Engine (complete)

---

## 1. Purpose

Phase 7 delivers a **role-aware dashboard at `/`** (replacing the current static marketing card on
`HomePage.vue`) backed by a new **read-only `/stats` API**. The dashboard turns the schedule data produced
in Phases 5–6 into actionable oversight for administrators and personal visibility for doctors.

- **Administrators** get hospital-wide statistics for a selected month: per-doctor workload distribution,
  day coverage (including gap days), and a fairness/imbalance indicator.
- **Doctors** get a personal dashboard: current-month progress vs. their `max_monthly_duties` cap, a narrow
  read-only "who's on call today + next 7 days" view, and their own upcoming duties.

Phase 7 introduces the **first doctor-facing read access to schedule data**, but through a **dedicated,
aggregated `/stats` endpoint only**. Doctors never gain access to `/schedules` or `/duties` (still 403) and
never receive raw duty rows — only the personal/aggregated payloads defined here.

**No database migration.** All required data already exists (`schedules`, `duties`, `doctors`, `users`,
`holidays`). Phase 7 is pure read-only aggregation on top of the existing schema.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Audience | **Role-aware.** Admin sees hospital-wide stats; doctor sees personal stats + narrow "who's on call." Static marketing card on `HomePage.vue` is retired |
| Admin metrics | **Workload distribution per doctor**, **coverage & gap days**, **fairness/imbalance indicator.** No trends-over-time chart, no schedule-status overview, no "upcoming on call" widget on the admin side |
| Admin time scope | **Single selectable month**, default = current month. All admin metrics computed for that one month (matches the monthly schedule model and the engine's ±1 fairness target) |
| Doctor visibility | **Personal stats + narrow "who's on call" (today + next 7 days).** No full read-only month grid exposed to doctors |
| API architecture | **Dedicated `/stats` endpoints with server-side SQL aggregation** (COUNT / `FILTER (WHERE …)` / GROUP BY). One round-trip per dashboard. Aggregation is business logic → lives in services. Doctors never touch `/schedules`; no draft leakage |
| Status policy | **Doctors see `published` schedules only.** Admin sees `draft` + `published`. If the selected month has no schedule, the dashboard shows an empty state that links to `/schedules` |
| Charting | **No charting dependency.** Workload renders as a table with CSS bar cells; fairness is a number + themed badge; coverage is counts + a gap list. Zero new frontend deps |
| "Who's on call" window | **Today + next 7 days**, queried by date range across schedules so it crosses month boundaries naturally |
| Home placement | **Role-aware home at `/`.** `HomePage.vue` becomes a thin switcher rendering `AdminDashboard` or `DoctorDashboard`. No new route; no `AppHeader` change (the existing Home link already points to `/`) |

## 3. Architecture & Layering

Phase 7 reuses the Phase 2–6 layering (Controllers → Services → Database on the API; Pages → Components →
Services → `lib/http` on the web). No new layers, no new dependencies, no new tables.

```
packages/shared/src/
├── types/stats.ts                        # NEW — AdminStats, MeStats, and sub-types; re-exported from types/index.ts
└── schemas/stats.ts                      # NEW — statsQuerySchema (optional coerced year/month); re-exported from schemas/index.ts

apps/api/src/
├── services/stats.service.ts             # NEW — adminStats(), meStats(); server-side SQL aggregation
├── controllers/stats.controller.ts       # NEW — thin admin/me handlers
├── routes/stats.routes.ts                # NEW — GET /stats/admin (admin-only), GET /stats/me (authenticate)
├── validators/stats.ts                   # NEW — re-exports statsQuerySchema from @oncall/shared (mirrors validators/schedule.ts)
├── app.ts                                # EDIT — app.use('/stats', statsRouter)
└── __tests__/
    ├── stats.service.test.ts             # NEW — payload shape, edge cases, published-only filter
    └── stats.routes.test.ts              # NEW — RBAC (403/404/401), query validation

apps/web/src/
├── services/stats.ts                     # NEW — thin wrappers: admin(year?,month?), me()
├── pages/HomePage.vue                    # EDIT — role switcher (renders Admin/Doctor dashboard)
├── components/dashboard/
│   ├── AdminDashboard.vue                # NEW — month picker + coverage/fairness/workload
│   └── DoctorDashboard.vue               # NEW — progress + who's-on-call + upcoming
└── __tests__/
    ├── HomePage.test.ts                  # NEW — renders correct dashboard by role
    ├── AdminDashboard.test.ts            # NEW — picker reload, empty state, metric rendering
    └── DoctorDashboard.test.ts           # NEW — progress, isMine highlight, empty states

database/                                 # none — no migration
```

## 4. Shared Types (`packages/shared/src/types/stats.ts`)

New file, re-exported from `types/index.ts` (and thereby from `@oncall/shared`). Mirrors the existing
type-file conventions (plain interfaces, camelCase).

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
  duties: number       // total duties this month
  weekday: number      // duties - weekend
  weekend: number
  holiday: number
}

export interface AdminCoverage {
  daysInMonth: number
  filled: number
  gaps: string[]       // ISO dates of unstaffed days, ascending
}

export interface AdminFairness {
  dutySpread: number | null      // max - min over doctors with duties > 0; null if < 2 such doctors
  weekendSpread: number | null
  holidaySpread: number | null
}

export interface AdminStats {
  year: number
  month: number
  schedule: ScheduleSummary | null   // the month's schedule (any status); null if none exists
  coverage: AdminCoverage
  workload: AdminWorkloadItem[]      // active doctors + inactive-with-duties, ordered by name
  fairness: AdminFairness
}

// ---- Doctor dashboard ----

export interface MeCurrentMonth {
  year: number
  month: number
  published: boolean           // false when the current month has no published schedule
  duties: number
  weekend: number
  holiday: number
  maxMonthly: number
}

export interface MeUpcomingDuty {
  dutyDate: string             // ISO
  isWeekend: boolean
  isHoliday: boolean
}

export interface OnCallEntry {
  date: string                 // ISO
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  isHoliday: boolean
  isMine: boolean
}

export interface MeStats {
  doctor: { id: number; firstName: string; lastName: string; maxMonthlyDuties: number }
  currentMonth: MeCurrentMonth
  upcoming: MeUpcomingDuty[]     // next 10 published duties from today, ascending
  onCall: OnCallEntry[]          // published duties in [today, today+7]
}
```

No zod request-body schema is needed (both endpoints are GETs). `statsQuerySchema` is defined in
`packages/shared/src/schemas/stats.ts` and re-exported from `@oncall/shared` (mirroring
`scheduleQuerySchema`); `apps/api/src/validators/stats.ts` re-exports it, exactly as
`validators/schedule.ts` re-exports the shared schedule schemas.

## 5. Backend Design (`apps/api`)

### 5.1 Router — `routes/stats.routes.ts`

Mounted at `/stats` in `app.ts` (`app.use('/stats', statsRouter)`), placed after `/schedules`/`/duties`.

```ts
statsRouter.use(authenticate)
statsRouter.get('/admin', authorize('administrator'), validate(statsQuerySchema, 'query'), statsController.admin)
statsRouter.get('/me', statsController.me)
```

`/stats/me` follows the established `/me` convention (`/doctors/me`, `/unavailability/me`): `authenticate`
at the router level only, no `authorize`. The service resolves the doctor profile from `req.user.id` and
throws **404** if none exists — so an administrator (who has no `doctors` row) receives 404, never doctor
data. The web client never calls `/stats/me` for admins (it renders the admin dashboard instead), but the
404 is the defense-in-depth guarantee.

| Method | Path | Auth | Query | Response |
|---|---|---|---|---|
| GET | `/stats/admin` | authenticate + administrator | `?year=&month=` (optional) | 200 `{ stats: AdminStats }` |
| GET | `/stats/me` | authenticate | — | 200 `{ stats: MeStats }` · 404 (no doctor profile) |

### 5.2 Validator — `packages/shared/src/schemas/stats.ts` (re-exported via `@oncall/shared`)

```ts
export const statsQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
```

`z.coerce.number()` mirrors `scheduleQuerySchema` (query params arrive as strings). `min(1970).max(2100)`
matches `scheduleQuerySchema` exactly. Invalid `year`/`month` → 422 via the existing `validate` middleware.
`apps/api/src/validators/stats.ts` is a one-line re-export (`export { statsQuerySchema } from
'@oncall/shared'`), matching `validators/schedule.ts`. When `year` or `month` is absent, the controller
fills in the **current** year/month before calling the service (so `GET /stats/admin` with no query returns
the current month).

### 5.3 Controller — `controllers/stats.controller.ts`

Thin handlers (`try { … } catch (err) { next(err) }`, `res.status(200).json(ok({ stats }))`), mirroring the
existing controllers.

- `admin(req, res, next)`: default `year`/`month` to the current date when absent, then
  `const stats = await statsService.adminStats(year, month)`.
- `me(req, res, next)`: `const stats = await statsService.meStats(req.user.id)`.

### 5.4 Service — `services/stats.service.ts`

Two exported functions. Reuses `query<T>(sql, params)` from `../db/client`, row interfaces + `toX` mappers,
`HttpError(status, message)`, and the date helpers in `../scheduling/dates` (`daysInMonth`, `isoDate`,
`isWeekendISO`). All SQL is parameterized; no ORM; no reliance on PG error codes.

Helper used by both functions: resolve the current local year/month for defaults and for the doctor
"current month" (the service computes "today" once via `new Date()`).

#### `adminStats(year, month): Promise<AdminStats>` — admin sees draft **and** published

1. **Schedule:** `SELECT … FROM schedules WHERE year = $1 AND month = $2` (a month has at most one schedule
   via the `UNIQUE (year, month)` constraint). Map the row to `ScheduleSummary` (same field mapping as the
   private `toSchedule` in `schedule.service.ts`: id, year, month, status, createdBy, createdAt, updatedAt),
   or `null` if no row.
2. **Coverage:**
   - `daysInMonth = daysInMonth(year, month)`.
   - If a schedule exists: `SELECT duty_date FROM duties WHERE schedule_id = $1` → build a `Set` of assigned
     ISO dates. `filled = set.size`. `gaps` = all month days (`isoDate(year, month, d)` for `d = 1..daysInMonth`)
     not in the set, ascending.
   - If no schedule: `filled = 0`, `gaps` = all month days.
3. **Workload** (denominator rule — see §5.5):
   - Active doctors + their cap:
     `SELECT d.id, u.first_name, u.last_name, d.max_monthly_duties FROM doctors d JOIN users u ON u.id = d.user_id WHERE u.is_active = TRUE ORDER BY u.last_name, u.first_name`.
   - Per-doctor duty counts for the schedule (only if a schedule exists):
     `SELECT doctor_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_weekend)::int AS weekend, COUNT(*) FILTER (WHERE is_holiday)::int AS holiday FROM duties WHERE schedule_id = $1 GROUP BY doctor_id`.
   - If any inactive doctor has duties this month, fetch their identity/cap with a second query joining
     `duties`/`doctors`/`users` filtered to `is_active = FALSE` and `schedule_id`. Merge: the workload set
     is the union of (active doctors) and (doctors appearing in the duty counts), each carrying `isActive`
     and `maxMonthly`; counts default to 0 for active doctors with no duty. `weekday = total - weekend`.
   - Ordered by `lastName, firstName`.
4. **Fairness** (computed in TS over the workload array): let `S = workload.filter(w => w.duties > 0)`. If
   `S.length < 2`, all three spreads are `null`. Otherwise `dutySpread = max(S.duties) - min(S.duties)`;
   `weekendSpread` and `holidaySpread` computed the same way over their respective fields.

#### `meStats(userId): Promise<MeStats>` — doctor sees **published only**

Every query below joins `duties` to `schedules` and filters `s.status = 'published'`.

1. **Doctor:** reuse `doctorService.getByUserId(userId)` (throws 404 if none — handles the admin case). Use
   `id`, `firstName`, `lastName`, `maxMonthlyDuties`.
2. **currentMonth** (today's year/month):
   ```sql
   SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE du.is_weekend)::int AS weekend,
          COUNT(*) FILTER (WHERE du.is_holiday)::int AS holiday
   FROM duties du JOIN schedules s ON s.id = du.schedule_id
   WHERE s.status = 'published' AND s.year = $1 AND s.month = $2 AND du.doctor_id = $3
   ```
   `published = true` iff a published schedule exists for `(year, month)` (checkable from the same join:
   a separate `SELECT 1 FROM schedules WHERE status='published' AND year=$1 AND month=$2`). When not
   published, `duties/weekend/holiday = 0`.
3. **upcoming** (the doctor's own published duties from today forward, capped at 10):
   ```sql
   SELECT du.duty_date, du.is_weekend, du.is_holiday
   FROM duties du JOIN schedules s ON s.id = du.schedule_id
   WHERE s.status = 'published' AND du.doctor_id = $1 AND du.duty_date >= $2
   ORDER BY du.duty_date LIMIT 10
   ```
4. **onCall** (published duties across all doctors in `[today, today+7]`):
   ```sql
   SELECT du.duty_date, du.is_weekend, du.is_holiday, u.first_name, u.last_name, du.doctor_id
   FROM duties du JOIN schedules s ON s.id = du.schedule_id
   JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id
   WHERE s.status = 'published' AND du.duty_date BETWEEN $1 AND $2
   ORDER BY du.duty_date
   ```
   Map each row to `OnCallEntry` with `isMine = (row.doctor_id === doctor.id)`. Compute the window with the
   same UTC date arithmetic used by `nextDate` in `scheduling/dates.ts` — `today` is
   `new Date().toISOString().slice(0, 10)` (or `isoDate` on the current UTC year/month/day), and the +7
   bound is `setUTCDate(getUTCDate() + 7)` then `.toISOString().slice(0, 10)`. A published month is fully
   assigned by the engine, so a fully-covered window yields 8 entries; a month that is not yet published
   simply yields fewer/none.

### 5.5 Workload denominator rule (correctness)

The workload table shows **all currently-active doctors**, so the admin always sees the full eligible set
and their caps. It **also** includes any **inactive doctor who still has ≥ 1 duty this month** (flagged
`isActive = false`), because silently dropping them would hide carried-over duties and distort coverage and
fairness. Realistically this arises when an admin deactivates a doctor without reassigning their existing
duties in a past month; the inactive row makes that visible instead of hiding it.

Fairness is computed only over doctors with `duties > 0` (the actually-assigned set), because including
eligible-but-unassigned doctors (0 duties) would make `spread = max`, which is not a meaningful fairness
signal. The scheduling engine targets ±1 across assigned doctors, so `dutySpread ≤ 1` reads as "balanced."

## 6. Frontend Design (`apps/web`)

### 6.1 New service — `services/stats.ts` (mirrors `services/schedule.ts`)

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

`apiGet` unwraps the `{ success, data }` envelope and returns `data`; the service then unwraps the `stats`
key — identical to how `services/schedule.ts` unwraps `{ schedule }`.

### 6.2 `pages/HomePage.vue` (role switcher)

`<script setup>`: `const auth = useAuthStore()`; `onMounted` does nothing (children load their own data).
Template: `<AdminDashboard v-if="auth.isAdmin" />` else `<DoctorDashboard />`. The static marketing card is
removed entirely.

### 6.3 `components/dashboard/AdminDashboard.vue`

- State: `year`/`month` string refs defaulted to today (`String(new Date().getFullYear())`,
  `String(new Date().getMonth() + 1)`); `stats: AdminStats | null`; `loading`; `errorMsg`.
- `load()`: build `StatsQuery` from the refs and call `statsService.admin({ year, month })`, using the
  established `e instanceof Error ? e.message : 'Failed to load statistics'` guard. `onMounted(load)`.
  Re-runs on "Apply".
- **Month picker:** year `Input` (number) + month `<select>` (1–12, MONTHS array reused from the codebase
  pattern) + Apply `Button`. (Mirrors `SchedulesPage.vue`.)
- **Empty state:** when `stats.schedule === null`, render a `Card` "No schedule for {Month Year}" with a
  `Button` that `router.push('/schedules')`.
- **Coverage card:** headline `{filled} / {daysInMonth} days filled`; if `gaps.length > 0`, a
  `text-destructive` line listing the gap dates.
- **Fairness card:** `dutySpread` badge — `0` or `1` (and `null` with < 2 doctors) → primary tint
  ("Well balanced" / "N/A"); `≥ 2` → destructive tint ("Imbalanced — review workload"). Secondary line:
  "Weekend spread {n} · Holiday spread {n}".
- **Workload table** (`Table*`): columns **Doctor** (`{firstName} {lastName}`, inactive → muted + "inactive"
  badge) · **Duties** (number + CSS bar cell) · **Weekend** · **Holiday** · **Cap** (`maxMonthly`). The CSS
  bar: a track `<div class="h-2 w-full rounded bg-muted">` containing a fill `<div>` whose inline
  `width = ${duties / maxInSet * 100}%` (where `maxInSet = max(workload.duties)`, guarded against 0) and
  `class="h-2 rounded bg-primary/20"`. Pure Tailwind — no chart library.

### 6.4 `components/dashboard/DoctorDashboard.vue`

- State: `stats: MeStats | null`; `loading`; `errorMsg`. `onMounted` → `statsService.me()` with the standard
  error guard.
- **Greeting + month progress card:** "Welcome, {firstName}" · "{duties} / {maxMonthly} duties this month"
  with a progress bar (`width = duties / maxMonthly * 100%`, same track/fill pattern). When
  `!currentMonth.published`: a muted note "This month's schedule isn't published yet." Secondary stats:
  weekend count, holiday count.
- **Who's on call card (today + 7 days):** list of `onCall` entries — formatted date (`Intl.DateTimeFormat`
  inline, e.g. "Fri 07 Aug"), `{firstName} {lastName}`, Weekend/Holiday badges. `isMine` rows get
  `class="bg-primary/10"` and a "You" tag. Empty → "No published schedule covers this period."
- **My upcoming duties card:** `upcoming` (≤ 10) — date + Weekend/Holiday badges. Empty → "No upcoming
  on-call duties."

### 6.5 Routing & navigation

- `router/index.ts`: unchanged. The home route `path: ''` already has no `meta.roles`, so both roles reach
  `HomePage.vue` after the auth guard. No new routes.
- `AppHeader.vue`: unchanged. The existing `Home` link points to `/`.

All styling uses existing Tailwind theme tokens (`text-primary`, `bg-primary/10`, `bg-muted`,
`text-muted-foreground`, `text-destructive`, `border-input`, `bg-background`). No hardcoded colors.

## 7. Error Handling

`ApiError` (`lib/http.ts`) carries `.status`; the existing 401 auto-refresh and router guard handle auth.
Both dashboards render errors with the established guard:

```ts
errorMsg.value = e instanceof Error ? e.message : 'Failed to …'
```

- **401** → handled by `lib/http` (silent refresh); the router guard redirects unauthed users to `/login`.
- **403** (`/stats/admin` called by a doctor) → cannot happen in normal flow (the doctor dashboard calls
  `/stats/me`), but if it did the message is shown inline.
- **404** (`/stats/me` called by an admin) → cannot happen in normal flow (admins render the admin
  dashboard); shown inline if it ever occurs.
- **422** (invalid `year`/`month` query) → cannot happen via the UI (the picker constrains values); the
  browser would show the server message.

## 8. Security & Integrity

- **RBAC:** `GET /stats/admin` is `authenticate + authorize('administrator')` (doctor → 403, unauth → 401).
  `GET /stats/me` is `authenticate` only; the service resolves the caller's own doctor profile via
  `req.user.id`, so a doctor can only ever receive **their own** stats. An admin (no `doctors` row) gets 404.
- **No widening of existing schedule access:** doctors still receive 403 on every `/schedules` and `/duties`
  route. The only new doctor-facing surface is the aggregated `/stats/me`, which never returns other
  doctors' personal aggregates (only names in the shared "who's on call" list, which is the explicit product
  requirement).
- **Status policy enforced server-side:** the `published`-only filter for doctors is in the SQL
  (`JOIN schedules s … WHERE s.status = 'published'`), not the client — the single source of truth. Admin
  queries apply no status filter, so draft + published are both visible to administrators.
- **No new SQL surface beyond parameterized SELECTs;** no ORM; no PG-error-code reliance; no request body
  trusted on either endpoint. `:id`-style path params are absent (no object-level authorization needed
  beyond the caller's own identity).

## 9. Testing Strategy

### 9.1 Backend (`apps/api`, mock `query`/`withTransaction` at module level — same style as
`schedule.service.test.ts`)

- **`stats.service.test.ts`:**
  - `adminStats`: correct `coverage` (filled + gaps) for a fully-assigned month and for a month with a
    removed duty (gap); `workload` includes an active doctor with 0 duties; an inactive doctor with duties
    is included and flagged `isActive = false`; `fairness.dutySpread` is `max - min` over doctors with
    `duties > 0`, and `null` when fewer than 2 doctors have duties; empty state (`schedule = null`,
    `filled = 0`, `gaps` = all days, workload all-zero, fairness `null`).
  - `meStats`: resolves the doctor (404 when none — admin case); `currentMonth.published = false` with zero
    counts when no published schedule; counts correct when published; `upcoming` is capped at 10 and only
    published; `onCall` covers the 8-day window, crosses a month boundary, and sets `isMine` correctly.
    Verify the published-only filter is applied (draft-only duties are excluded).
- **`stats.routes.test.ts`** (supertest, service mocked at module level):
  - `GET /stats/admin` → 200 for admin; 403 for doctor; 401 unauth; 422 for invalid `month`/`year`; default
    (no query) resolves to the current month.
  - `GET /stats/me` → 200 for a doctor; 404 for an admin (no profile); 401 unauth.

### 9.2 Frontend (`apps/web/src/__tests__`, Vitest + `@vue/test-utils`, services mocked via `vi.mock`)

- **`HomePage.test.ts`:** renders `AdminDashboard` when `auth.isAdmin`, else `DoctorDashboard`.
- **`AdminDashboard.test.ts`:** month picker reloads on Apply; empty-state card with link when
  `schedule === null`; coverage card shows filled/gaps; fairness badge switches between balanced/imbalanced;
  workload table renders rows, the CSS bar width, the inactive badge, and the cap.
- **`DoctorDashboard.test.ts`:** greeting + progress bar (`duties / maxMonthly`); "not published" note when
  `!published`; who's-on-call list highlights `isMine`; upcoming list renders; both empty states render.

### 9.3 Verification (per `AGENTS.md`)

`pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo. No Prettier (format with
Volar). Manual smoke via `pnpm dev`: admin selects a month → sees coverage/fairness/workload and the empty
state for an ungenerated month; doctor signs in → sees progress, who's-on-call, and upcoming.

## 10. Definition of Done (Phase 7)

- The role-aware home at `/` renders the admin dashboard for administrators and the doctor dashboard for
  doctors; the static marketing card is gone.
- Admin home shows month-selectable **coverage** (filled/gaps), a **fairness** spread badge, and a per-doctor
  **workload** table (with CSS bars and inactive flags); an empty state links to `/schedules` when the
  selected month has no schedule.
- Doctor home shows **current-month progress vs. cap**, a published-only **who's-on-call** list (today + 7
  days, `isMine` highlighted), and **upcoming duties**, each with an empty state.
- Doctors see **published** schedules only; admins see **draft + published**; doctors still receive 403 on
  every `/schedules` and `/duties` route.
- `GET /stats/admin` is admin-only (doctor → 403, unauth → 401); `GET /stats/me` resolves the caller's own
  doctor profile (admin → 404, unauth → 401). The published-only filter is enforced in SQL.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass across the monorepo.

## 11. Out of Scope (Phase 7)

Trends-over-time charts and CSV/PDF export (Phase 8 — Reporting); doctor full read-only month grid;
notifications/emails on publish; arbitrary date-range (non-month) statistics; real-time/push schedule
updates; schedule-status overview and admin "upcoming on call" widget (not chosen for the admin dashboard);
multi-hospital.
