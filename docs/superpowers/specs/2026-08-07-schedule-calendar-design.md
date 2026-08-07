# Schedule Calendar View Design

**Project:** Doctor On-Call Duty Scheduling System
**Status:** Approved (2026-08-07)
**Scope owner:** frontend `apps/web`, backend `apps/api`, shared `packages/shared`
**Builds on:** Phase 4 — Scheduling Engine + Phase 5 — Schedule Management (complete)

---

## 1. Purpose

Replace the schedule's tabular day-list with a **big month calendar**. Each day cell renders as a square containing either an inline doctor `<select>` (administrator, draft) or the plain doctor name (doctor role, published schedules, and the read-only preview). The admin's select options are restricted to the doctors **eligible for on-call that specific day** — computed by the backend using the same hard constraints the scheduling engine and the duty-validation path already enforce.

This spans two screens: the saved schedule detail page (`/schedules/:id`) becomes an editable calendar, and a new full preview page (`/schedules/preview`) renders the engine's proposed assignments as a read-only calendar before generation. A new doctor-facing roster page (`/roster`) gives non-admins their first entry point into published schedules.

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Target screens | **Both** the schedule detail page and a new full preview page render the calendar. |
| Eligibility source | **Backend per-day eligibility.** `ScheduleDetail.days[].eligibleDoctorIds` computed server-side; the frontend never derives it. |
| Eligibility semantics | A doctor is eligible for a day iff: active, `isAvailable(date)` ok, under monthly cap (counting this schedule's duties, excluding this day's own duty), and not back-to-back with an adjacent assigned duty in this schedule. Identical to `validateAssignment` — the select can never offer a doctor the backend would reject. |
| Engine reuse | Eligibility reuses the **pure constraint functions** (`isAvailable`, `underCap`, `notConsecutive`) evaluated against the current/final duty set. The `generate()` engine is **not** replayed (its mid-run state would drift from final-state semantics). |
| Preview eligibility | `PreviewResult.days[].eligibleDoctorIds` is always `[]` — preview is read-only, no editing, so eligibility is unused there (YAGNI). |
| Save interaction | **Immediate save per select change** → `add`/`reassign`/`remove`, then full `load()` refresh so eligibility recomputes for every day (cap & back-to-back ripple). One API call per change. |
| Preview presentation | **Full preview page** (`/schedules/preview?year=&month=`), not a modal. The New schedule dialog's Preview button navigates here. |
| Doctor access | **New.** Doctors gain read-only access to published schedules. `GET /schedules` and `GET /schedules/:id` are widened to the `doctor` role (published-only; eligibility stripped). Entry point is a new `/roster` list page + nav link. |
| Published behavior | Published schedules render `readonly` for everyone (admin included). Publish/Unpublish/Delete buttons are admin-only. |
| Grid layout | 7-column CSS grid, **Monday-start** header (Mon–Sun). Leading/trailing blanks pad partial weeks. Narrow viewports scroll horizontally with a min cell width (the user wants a calendar, not a collapsed list). |

## 3. Shared Type Changes (`packages/shared/src/types/schedule.ts`)

```ts
export interface DayInfo {
  date: string               // ISO yyyy-mm-dd
  isWeekend: boolean
  isHoliday: boolean
  eligibleDoctorIds: number[] // populated for ScheduleDetail; always [] for PreviewResult
}

export interface ScheduleDetail {
  schedule: ScheduleSummary
  duties: Duty[]
  days: DayInfo[]             // NEW — one entry per day of the month
}

export interface PreviewResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
  days: DayInfo[]             // NEW — eligibleDoctorIds always []
}
```

Both `DayInfo` and the new `days` field are exported from the shared barrel (`types/index.ts`). No other shared types change.

## 4. Backend (`apps/api`)

### 4.1 Eligibility computation (`schedule.service.ts`)

New internal helper `computeEligibility`, invoked by both `preview` and `getById`. It reuses the data already assembled by `buildContext` (active doctors, unavailability ranges, holidays) plus, for `getById`, the schedule's persisted duties.

Inputs:
- `doctors: DoctorSpec[]` (active only),
- `unavailability: Map<doctorId, ranges[]>`,
- `monthDays: { date, isWeekend, isHoliday }[]`,
- `dutiesByDate: Map<date, doctorId>` (the schedule's duties — for preview, the engine's proposed assignments; for `getById`, the persisted rows),
- `dutyCountByDoctor: Map<doctorId, number>`.

Algorithm per day per doctor:
1. `isAvailable(doctorId, date, ranges).ok` — else skip.
2. `underCap(dutyCount - (this doctor already on this date ? 1 : 0), maxMonthlyDuties).ok` — else skip. (Excluding the day's own duty is what lets the current doctor remain selectable on a reassign.)
3. `notConsecutive(dutiesByDate has this doctor on prevDate OR nextDate).ok` — else skip.
4. Passing doctors → `eligibleDoctorIds` for that day.

Output: `DayInfo[]` for the whole month. For `preview`, `eligibleDoctorIds` is set to `[]` regardless (read-only screen).

### 4.2 Service changes

- `preview(year, month)`: after `runEngine`, build `dutiesByDate`/`dutyCountByDoctor` from `result.assignments`, call `computeEligibility`, then blank each day's `eligibleDoctorIds`. Return `{ assignments, conflicts, days }`.
- `getById(id)`: after fetching schedule + duties, run `computeEligibility` against persisted duties and return `{ schedule, duties, days }`. (`generate` already returns `getById(id)`, so freshly created schedules carry eligibility for free.)
- `list(filters, actor)`: when `actor.role !== 'administrator'`, append `status = 'published'` to the WHERE clause. For admins, unchanged.
- `getById` RBAC: when `actor.role !== 'administrator'` and `schedule.status !== 'published'` → throw `HttpError(403)`. When non-admin, strip `eligibleDoctorIds` to `[]` on every day before returning.

Both functions need the `actor` (currently only mutation paths receive it). Thread `req.user` through the controller into `list` and `getById`.

### 4.3 Controller & routes

`schedule.controller.ts`: pass `req.user` to `list` and `getById`. Route-level `authorize('administrator')` on the schedule router is relaxed to `authorize('administrator', 'doctor')` for `GET /` and `GET /:id` only. Everything else — `POST /preview`, `POST /`, `POST /:id/duties`, publish/unpublish/delete, and the entire `dutyRouter` — stays admin-only.

Implementation note: split the router so the two GETs carry the relaxed `authorize` and the rest retain admin-only, preserving the existing `authenticate` + `validate` middleware ordering.

### 4.4 What does NOT change

No database migration. No new tables, columns, or seeds — eligibility is computed live from existing tables (`doctors`, `users`, `unavailability`, `duties`, `holidays`). No new endpoints; only the two existing GETs/preview gain a `days` field and relaxed RBAC.

## 5. Frontend (`apps/web`)

### 5.1 Shared `DutyCalendar` component (`components/schedule/DutyCalendar.vue`)

Presentational; renders both screens.

```ts
interface Props {
  year: number
  month: number
  days: DayInfo[]
  assignmentByDate: Map<string, { doctorId: number; firstName: string; lastName: string; reason: string }>
  conflictsByDate: Map<string, string>   // date -> detail (preview only)
  doctors: Doctor[]                       // id -> name lookup + select options (admin)
  mode: 'editable' | 'readonly'
}
defineEmits<{ select: [date: string, doctorId: number | null] }>()
```

- 7-column CSS grid, Monday-start; weekday header row. Leading blanks = `getDay()` of day 1 offset to Monday-start; trailing blanks pad the final week.
- Cell top: day number + badges (Weekend / Holiday / Gap / Conflict).
- Cell body:
  - `readonly` → plain name (last name + first initial; full name in `title`).
  - `editable` → existing `Select.vue` with options from `day.eligibleDoctorIds` resolved via `doctors`; the assigned doctor is the selected value; a leading **"Unassigned"** option (value `null`) clears the duty.
- Cell visual states: weekend → `bg-muted`; holiday → red-tinted border; gap (editable, no duty, eligible doctors exist) → dashed border; conflict (date in `conflictsByDate`) → red border + "Unfillable" badge + `detail` tooltip.
- Responsive: grid scrolls horizontally under a min cell width on small viewports; header/controls stay sticky.
- Reuses `Select.vue`; badges reuse existing pill classes from `ScheduleDetailPage.vue`.

### 5.2 `ScheduleDetailPage.vue` (admin, editable)

- Replace the `<Table>` with `<DutyCalendar :mode="...">`. Remove the add/reassign `Dialog`, the `override` state machine, `openAdd`/`openReassign`/`saveOverride`, and the now-unused `Dialog`/`Label` imports.
- `mode = computed(() => auth.isAdmin && !isPublished ? 'editable' : 'readonly')`.
- `@select(date, doctorId)` handler:
  1. duty exists & `doctorId !== null` & differs → `reassignDuty(dutyId, { doctorId })`.
  2. no duty & `doctorId !== null` → `addDuty(scheduleId, { date, doctorId })`.
  3. `doctorId === null` & duty exists → confirm, then `removeDuty(dutyId)`.
  4. success → `await load()` (re-fetch; eligibility recomputes). error → revert select to prior value, surface `errorMsg`.
- Per-cell `saving` flag disables only that select during the request.
- `onMounted`: fetch `doctorService.list()` + `scheduleService.get(id)` (now carries `days`).
- Publish/Unpublish/Delete buttons guarded with `v-if="isAdmin"` (currently implicit). Behavior unchanged.

### 5.3 `SchedulePreviewPage.vue` (new, admin, read-only)

- Route `/schedules/preview` (`roles: ['administrator']`). Reads `year`/`month` from `$route.query`, validated with `createScheduleSchema`; invalid/missing → error state.
- `onMounted` + watch on query → `scheduleService.preview(year, month)`.
- Header: month label + conflict count. Renders `<DutyCalendar mode="readonly">` from `assignments`, `conflicts`, `days`.
- Actions: "Back" → `/schedules`; "Generate" → `scheduleService.generate` → redirect to `/schedules/:id`. Generate disabled while `conflicts.length > 0`.

### 5.4 `ScheduleRosterPage.vue` (new, doctor, read-only list)

- Route `/roster` (`roles: ['doctor']`). Calls `scheduleService.list()` (backend returns published-only for doctors).
- Simple table (existing `Table*` primitives) of published months with a "View" link → `/schedules/:id` (renders readonly calendar because `!isAdmin`).

### 5.5 `SchedulesPage.vue` (New schedule dialog)

- Dialog keeps Year + Month inputs and the **Generate** submit (unchanged). Generate remains always enabled; the backend still rejects with 422 if conflicts exist, caught and shown inline.
- The in-dialog **Preview** button becomes `router.push('/schedules/preview?year=…&month=…')` and closes the dialog.
- Removed: `previewing`, `assignments`, `conflicts`, the preview `errorMsg`, and the conflict/count panel — all relocated to the preview page.

### 5.6 Navigation & routing (`AppHeader.vue`, `router/index.ts`)

- Add `/schedules/preview` (admin) and `/roster` (doctor) routes.
- Widen `/schedules` and `/schedules/:id` guards to `['administrator', 'doctor']`.
- Doctor `navItems`: add "Duty roster" → `/roster`.

## 6. Edge Cases

- **Empty month / no active doctors** → empty grid; every day renders as a gap or conflict cell.
- **Admin clears the last eligible doctor on a day** → the "Unassigned" option triggers `removeDuty`; the day reverts to a gap cell.
- **Concurrent/last-write edits** → `load()` after each save re-syncs; backend `validateAssignment` is source of truth; a rejected write reverts the select and shows the 409 message.
- **Query-param tampering on preview** → `createScheduleSchema` validation surfaces an error state.
- **Doctor hits a draft directly** → backend 403; frontend shows an error/empty state.

## 7. Testing

**Backend (Vitest):**
- `computeEligibility`: active/inactive, unavailable, at-cap, back-to-back exclusion; own-duty exclusion on reassign; empty set when nobody passes.
- `preview` returns `days` (blank eligibility) consistent with `assignments`/`conflicts`.
- `getById` returns `days` with correct `eligibleDoctorIds` for a seeded schedule.
- Routes: doctor `GET /schedules` (published-only) and `GET /schedules/:id` (published, eligibility stripped); doctor 403 on draft detail, 403 on preview/generate/mutations; admin unchanged.

**Frontend (Vitest, mocked services):**
- `ScheduleDetailPage`: inline select calls reassign/add/remove correctly, refreshes after save, reverts on error, readonly when published or `!isAdmin`.
- `SchedulePreviewPage`: renders assignments + conflict cells, Generate disabled while conflicts exist, redirects on success.
- `ScheduleRosterPage`: lists published schedules, links to detail.

## 8. Out of Scope (explicit YAGNI)

No drag-and-drop, no undo, no batch/multi-day edits, no per-doctor roster filtering, no printable calendar (printing already exists in Reports).
