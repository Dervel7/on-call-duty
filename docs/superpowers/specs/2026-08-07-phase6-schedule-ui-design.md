# Phase 6 — Schedule Management UI Design

**Project:** Doctor On-Call Duty Scheduling System
**Phase:** 6 of 8 (Schedule Management UI)
**Status:** Approved (2026-08-07)
**Scope owner:** frontend `apps/web`, plus a small backend addition in `apps/api`
**Builds on:** Phase 5 — Scheduling Engine (complete; API surface already shipped)

---

## 1. Purpose

Phase 6 delivers the **admin UI for managing on-call schedules** and the one backend piece Phase 5
deferred: **publishing**. An administrator can preview/generate a month, review conflicts before
committing, manually override individual days, publish (lock) or revert to draft, and manage the
holidays that feed the engine.

Phase 5 already shipped the full scheduling REST surface (`/schedules`, `/schedules/:id/duties`,
`/duties/:id`, `/holidays`) but **always creates `draft` schedules and ships no publish endpoint**.
Phase 6 adds:

- **Backend:** `POST /schedules/:id/publish` and `POST /schedules/:id/unpublish`, plus a service-layer
  **published-lock** that blocks duty mutations and schedule deletion while a schedule is published.
- **Frontend:** two new admin pages (**Schedules** list + detail, **Holidays** CRUD), thin service
  modules, router entries, and nav links — all following the established Phase 2–5 patterns.

No new database migration: `schedules.status CHECK (status IN ('draft','published'))` already reserves
the `published` value (`database/schema.sql:79`). No changes to `@oncall/shared` (publish/unpublish
carry only `:id`; `ScheduleStatus` already includes `'published'`).

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Scope | Schedule Management UI (frontend) + deferred publish backend (publish/unpublish + lock). Holidays admin page included. Doctors remain 403 on all schedule/duty routes — no new doctor read access |
| Schedule display (month) | **Day-list table** — one row per day. Reuses the existing `Table*` component; responsive (scrolls on mobile); room for weekend/holiday/gap badges, reason, and per-row override actions. Calendar grid rejected (cramped on mobile, harder to make accessible); calendar+table toggle rejected (over-engineering) |
| Generate workflow | **Guided: preview → review conflicts → generate.** "New schedule" dialog calls `/schedules/preview` and shows assignments count + conflicts list inline. **Generate is disabled while `conflicts.length > 0`** (the engine 422s on any unfillable day and writes nothing, so this gate avoids the dead-end); enabled only when conflicts = 0, then `POST /schedules` commits and navigates to the new detail. 409 (already exists) surfaced inline |
| Manual override dialog | Dropdown shows **all active doctors**; the server validates (availability / monthly cap / back-to-back) and the dialog surfaces the `409` message inline. No client-side eligibility filtering (would duplicate engine rules and risk drift) |
| Publish lifecycle | **Publish + unpublish (two-way).** `POST /schedules/:id/publish` and `/unpublish`. Once published, duty add/reassign/remove and schedule delete are locked (409). "Revert to draft" re-enables editing. Both transitions require `confirm()`. No downstream consumers exist yet, so unpublish is low-risk and avoids delete+regenerate to fix one duty |
| Lock enforcement | **Service layer (single source of truth).** A private `assertEditable(status)` guard in `schedule.service.ts`; cannot be bypassed by a missed route |
| Status badges | Draft = muted token; Published = primary token. Tailwind theme classes only — no hardcoded colors |
| Holidays page | CRUD table, list-all sorted ascending by date. No date-range filter (YAGNI — holidays are a small global set); the `/holidays?from=&to=` query remains available on the backend if needed later |

## 3. Architecture & Layering

Phase 6 reuses the Phase 2–5 layering and frontend structure (Controllers → Services → Database on the
API; Pages → Services → `lib/http` on the web). No new layers, no new dependencies.

```
apps/api/src/
├── services/schedule.service.ts        # EDIT — +publish, +unpublish, +assertEditable guard,
│                                       #         DutyRow/SELECT_DUTY gain schedule_status
├── controllers/schedule.controller.ts  # EDIT — +publish, +unpublish (thin)
├── routes/schedule.routes.ts           # EDIT — POST /:id/publish, POST /:id/unpublish
└── __tests__/schedule.{service,routes}.test.ts  # EDIT — publish/unpublish + lock coverage

apps/web/src/
├── services/
│   ├── schedule.ts                     # NEW — thin wrappers over /schedules, /schedules/:id/duties, /duties/:id
│   └── holiday.ts                      # NEW — thin wrappers over /holidays
├── pages/
│   ├── SchedulesPage.vue               # NEW — list + guided generate dialog
│   ├── ScheduleDetailPage.vue          # NEW — day-list table + override dialog + publish/unpublish
│   └── HolidaysPage.vue                # NEW — CRUD (mimics AvailabilityPage.vue)
├── router/index.ts                     # EDIT — +/schedules, +/schedules/:id, +/holidays (admin)
├── components/layout/AppHeader.vue     # EDIT — +Schedules, +Holidays nav links
└── __tests__/
    ├── SchedulesPage.test.ts           # NEW
    ├── ScheduleDetailPage.test.ts      # NEW
    └── HolidaysPage.test.ts            # NEW

packages/shared/   # none
database/          # none
```

## 4. Backend Design (`apps/api`)

### 4.1 Route additions — `/schedules` (admin-only, unchanged auth)

The `scheduleRouter` already runs `authenticate` + `authorize('administrator')` for every route
(`routes/schedule.routes.ts:16-17`). Add two routes (id validated by the existing `idParams`):

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/schedules/:id/publish` | — | 200 `{ schedule }` · 404 missing · 409 already published |
| POST | `/schedules/:id/unpublish` | — | 200 `{ schedule }` · 404 missing · 409 already draft |

Both are registered alongside the other `/:id` routes; no collision with `GET /:id` (different methods)
or `POST /`/`POST /preview` (literal distinct paths).

### 4.2 `schedule.service.ts` — additions + lock

**Internal row shape (edit).** Extend the private `SELECT_DUTY` constant and `DutyRow` interface to also
select the parent schedule's status via the existing `schedules` join, so duty-keyed operations can read
it without a second round-trip:

```ts
// DutyRow gains: schedule_status: string
// SELECT_DUTY's join block appends: ... JOIN schedules s ON s.id = du.schedule_id
//                                   ... s.status AS schedule_status ...
```

**Private guard (new).**

```ts
function assertEditable(status: string): void {
  if (status === 'published')
    throw new HttpError(409, 'Schedule is published; revert to draft to edit')
}
```

**New exports.**

- **`publish(id): Promise<ScheduleSummary>`**
  `UPDATE schedules SET status = 'published', updated_at = NOW() WHERE id = $1 AND status = 'draft'
   RETURNING <ScheduleRow columns>`; if `rowCount === 0`, disambiguate with
  `SELECT 1 FROM schedules WHERE id = $1` → no row ⇒ `404 'Schedule not found'`, else ⇒
  `409 'Schedule is already published'`. Map the returned row with `toSchedule`.
- **`unpublish(id): Promise<ScheduleSummary>`** — mirror: `SET status = 'draft' WHERE … status =
  'published' RETURNING …`; 0 rows ⇒ 404 / `409 'Schedule is already draft'`.

**Lock call sites (edit existing methods).**

- `addDuty` (`schedule.service.ts:283`) — already loads the `schedule` row; call
  `assertEditable(schedule.status)` immediately after the 404/month checks.
- `reassignDuty` (`:321`) — `getDutyRow(dutyId)` now returns `schedule_status`; call
  `assertEditable(duty.schedule_status)` before mutating. (Per-action message override optional; the
  generic guard message is sufficient and consistent.)
- `removeDuty` (`:337`) — same: `assertEditable` on the duty's `schedule_status` before `DELETE`.
- `remove` (schedule delete, `:215`) — already loads the row; call `assertEditable` before `DELETE`,
  giving a `409 'Schedule is published; revert to draft before deleting'` (override the message here so
  the destructive action is unambiguous).

No changes to `generate`, `preview`, `list`, `getById`, or `validateAssignment`. Parameterized queries
only; no ORM; no PG-error-code reliance (explicit existence checks), matching Phase 5 style.

### 4.3 Controller + validators

`schedule.controller.ts` gains thin `publish` / `unpublish` handlers (`try { … } catch (err) { next(err) }`,
`res.status(200).json(ok({ schedule }))`). `validators/schedule.ts` is unchanged — `idParams` (re-exported
from `validators/user.ts`) already validates `:id`, and there is no body to validate.

## 5. Frontend Design (`apps/web`)

### 5.1 New services (thin wrappers; mimic `services/doctor.ts` + `toQuery` from `services/unavailability.ts:9`)

**`services/schedule.ts`**

```ts
list(query?)         // GET  /schedules[?year=&month=]   -> unwrap { schedules }
get(id)              // GET  /schedules/:id              -> ScheduleDetail
preview(year, month) // POST /schedules/preview          -> PreviewResult
generate(year, month)// POST /schedules                  -> ScheduleDetail  (201)
remove(id)           // DELETE /schedules/:id            -> void
publish(id)          // POST /schedules/:id/publish      -> unwrap { schedule }
unpublish(id)        // POST /schedules/:id/unpublish    -> unwrap { schedule }
addDuty(sid, {date, doctorId})       // POST   /schedules/:id/duties -> unwrap { duty }
reassignDuty(dutyId, {doctorId})     // PATCH   /duties/:id          -> unwrap { duty }
removeDuty(dutyId)                   // DELETE  /duties/:id          -> void
```

`toQuery({year?,month?})` mirrors `services/unavailability.ts:9-16` (build `?year=&month=` only for
defined fields). Types come from `@oncall/shared`.

**`services/holiday.ts`** — `list()` → `GET /holidays` (unwrap `{ holidays }`); `create({name,date})`
→ `POST` (unwrap `{ holiday }`); `update(id, {name?,date?})` → `PATCH` (unwrap `{ holiday }`);
`remove(id)` → `DELETE`.

### 5.2 `pages/HolidaysPage.vue` (CRUD — mimics `AvailabilityPage.vue`)

`script setup`; `onMounted` loads `holidayService.list()`; `ref` state; `<Table*>` of `Date | Name |
Actions`; `Dialog` form with name `Input` + date `Input`; `createHolidaySchema` / `updateHolidaySchema`
`safeParse` before save (show first issue message on failure); `confirm()` before delete; inline error
rendered via the existing `e instanceof Error ? e.message : 'Failed…'` pattern. Sorted ascending by date
(the service/backend already orders by date). No filter row.

### 5.3 `pages/SchedulesPage.vue` (list + guided generate)

- Header "Schedules" + **New schedule** button. Optional year filter (number `Input` + Apply) calling
  `list({ year })`; default lists all (backend orders `year DESC, month DESC`).
- `<Table*>` columns: **Month** (rendered "August 2026") · **Status** badge (Draft=muted, Published=primary)
  · **Created** · **Actions** → **View** → `router.push('/schedules/:id')`.
- **Generate dialog (guided flow):** year `Input` + month `<select>` (1–12) → **Preview** button calls
  `scheduleService.preview(year, month)`. The dialog then shows the assignment count and a conflicts list
  (each `ConflictPlan` = date + detail).
  - `conflicts.length > 0` ⇒ **Generate disabled**, with the message "Resolve N unfillable day(s) first
    (adjust availability, doctor capacity, or holidays)."
  - `conflicts.length === 0` ⇒ **Generate enabled** → `scheduleService.generate(year, month)` → on
    success close dialog and `router.push('/schedules/<newId>')`.
  - Errors: `409` (already exists) shown inline; `422` (unexpected since conflicts are gated) shown with
    a "review preview" hint. `safeParse` with `createScheduleSchema` before calling preview.

### 5.4 `pages/ScheduleDetailPage.vue` (day-list table — Option B)

- `onMounted`: `scheduleService.get(id)` → `{ schedule, duties }` and `doctorService.list()` (for the
  override dropdown). Route param `:id`.
- **Header:** "August 2026" + status badge + actions:
  - **Draft:** **Publish** button (`confirm('Publish this schedule? Editing will be locked.')` →
    `publish(id)` → reload) and **Delete schedule** (destructive, `confirm()` → `remove(id)` → navigate
    back to `/schedules`).
  - **Published:** **Revert to draft** button (`confirm()` → `unpublish(id)` → reload). No delete while
    published (the backend 409s; the button is hidden/disabled with a "Locked" note).
- **Day-list table:** iterate day `1 .. daysInMonth(schedule.year, schedule.month)`; match a duty by
  `duty_date`. Columns:
  - **Date** — `Intl.DateTimeFormat` (e.g. "Fri 01"); inline helper, no new dependency (reuse
    `packages/utils` date helpers if any already exist).
  - **Doctor** — `doctorFirstName doctorLastName`, or **Unassigned** (muted/italic) when no duty.
  - **Flags** — badges: **Weekend** (when `duty.isWeekend`, or computed for unassigned rows), **Holiday**
    (`duty.isHoliday`), **Gap day** (no duty).
  - **Reason** — `duty.reason` as secondary text / `title` tooltip.
  - **Actions** (draft only): assigned row → **Edit** (reassign) + **Remove**; unassigned row → **+ Add**.
    Published ⇒ actions hidden, "Locked" note.
- **Override dialog (shared add/reassign):** mode `add | reassign`; read-only date display + doctor
  `<select>` (all active doctors). `createDutySchema` / `reassignDutySchema` `safeParse` before submit;
  `add` → `addDuty(scheduleId, { date, doctorId })`; `reassign` → `reassignDuty(dutyId, { doctorId })`.
  On `409` show the server message inline (e.g. "Constraint violation: back-to-back"); on success close
  and reload the detail. **Remove duty:** `confirm()` → `removeDuty(dutyId)` → reload.
- **Gap days** appear in a saved schedule only after `removeDuty` (generation rejects conflicts), so the
  "+ Add" affordance is the re-add path.

### 5.5 Routing + navigation

- `router/index.ts` — three admin routes under the default layout, each `meta: { roles: ['administrator'] }`:
  `/schedules` → `SchedulesPage.vue`, `/schedules/:id` → `ScheduleDetailPage.vue`, `/holidays` →
  `HolidaysPage.vue`. The existing `resolveGuard` enforces the role (doctors redirect/403).
- `AppHeader.vue` — add **Schedules** and **Holidays** `<RouterLink>`s (gated `v-if="auth.isAdmin"`),
  placed after the existing Availability link (`AppHeader.vue:28`).
- All styling uses existing Tailwind theme tokens (`text-primary`, `bg-muted`, `border-input`, etc.) — no
  hardcoded colors, consistent with the medical theme.

## 6. Error Handling

`ApiError` (`lib/http.ts:4`) carries `.status`; the existing 401 auto-refresh and router guard handle
auth. Pages render errors with the established guard:

```ts
errorMsg.value = e instanceof Error ? e.message : 'Failed to …'
```

- **409** (published-lock / schedule-exists / duty-date-filled / override-constraint / dup-holiday) → the
  backend message is already human-readable; show it verbatim inline.
- **404** → "Schedule not found" / "Holiday not found" (the request message).
- **422** (generate — should not occur because the UI gates on preview conflicts) → message + "review preview."
- **401 / 403** → handled by `lib/http` (refresh) and the router guard (admin routes).

## 7. Security & Integrity

- RBAC unchanged: every `/schedules` and `/duties` route stays `authenticate + authorize('administrator')`
  (doctors → 403). `/holidays` GET stays any-authed; `/holidays` mutations stay admin-only. No new doctor
  read access is introduced.
- **Published-lock is enforced in the service layer** — the single source of truth — so it cannot be
  bypassed by a missed frontend check or a forgotten route. The frontend additionally hides/disables
  actions for clarity, but never as the only enforcement.
- `publish`/`unpublish` carry only `:id` (validated by `idParams`); no client body is trusted. No new
  SQL surface; parameterized queries only; no ORM; no PG-error-code reliance.

## 8. Testing Strategy

### 8.1 Backend (`apps/api`, existing `__tests__` style — mock `query`/`withTransaction` at module level)

- **`schedule.service.test.ts`** (extend): `publish` flips draft→published and returns the summary;
  404 when missing; 409 when already published. `unpublish` mirrors (published→draft; 404; 409 already
  draft). **Lock:** `addDuty`, `reassignDuty`, `removeDuty`, and schedule `remove` throw 409 when the
  schedule status is `published`; allow all four when `draft`.
- **`schedule.routes.test.ts`** (extend, supertest with the service mocked at module level): `POST
  /:id/publish` → 200 / 404 / 409; `POST /:id/unpublish` → 200 / 404 / 409; both 403 for a doctor and
  401 unauth; duty/schedule mutations return 409 on a published schedule.

### 8.2 Frontend (`apps/web/src/__tests__`, Vitest + `@vue/test-utils`, services mocked via `vi.mock`)

The existing web suite tests **pages** (not standalone services), so coverage is page-level:
- **`HolidaysPage.test.ts`** — mounts, list renders, create/update via dialog (zod blocks invalid),
  delete confirm, error render.
- **`SchedulesPage.test.ts`** — list renders with status badges; generate dialog: preview renders
  conflicts and disables Generate when `conflicts.length > 0`, enables + commits when 0, navigates to
  detail on success; 409 (exists) shown inline.
- **`ScheduleDetailPage.test.ts`** — day-list renders all days (incl. gap rows after a remove);
  publish toggles lock and disables override actions; revert re-enables; override dialog add/reassign
  (zod blocks invalid, surfaces 409); remove-duty confirm; delete-schedule (draft only).

### 8.3 Verification (per `AGENTS.md`)

`pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass across the monorepo. No Prettier (format with
Volar). Manual smoke via `pnpm dev`: preview→generate→override→publish→revert→delete; holidays CRUD.

## 9. Definition of Done (Phase 6)

- Admin can open **Schedules**, generate a month via the guided preview→generate flow (Generate disabled
  while conflicts exist), and navigate to the detail.
- The detail day-list shows every day with doctor, weekend/holiday/gap badges, reason, and per-row
  Edit/Remove/+Add; overrides validate via the server and surface 409 messages inline.
- Admin can **Publish** (locks editing + delete) and **Revert to draft** (re-enables); both confirmed.
  A published schedule rejects duty add/reassign/remove and delete with 409 at the service layer.
- Admin can manage **Holidays** (create/edit/delete) on a dedicated page.
- Doctors get 403 on all schedule/duty routes and on holiday mutations; any authenticated user can read
  holidays. Nav links and routes are admin-gated.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass across the monorepo.

## 10. Out of Scope (Phase 6)

Doctor read access to schedules; notifications/emails on publish; CSV/PDF export; drag-and-drop
reassignment; client-side eligibility filtering; Home-page schedule cards; holiday date-range filter;
bulk/recurring holiday creation; statistics & dashboard (Phase 7); reporting (Phase 8); multi-hospital.
