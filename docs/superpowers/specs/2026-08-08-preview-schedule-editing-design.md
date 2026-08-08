# Design: Editable Schedule Preview with Relaxed Fill Rule

**Date:** 2026-08-08
**Branch:** `feat/preview-schedule-editing`

## Problem

When an admin previews a monthly schedule, the engine aims for **2 doctors per day**
(`DOCTORS_PER_DAY = 2`, `apps/api/src/scheduling/engine.ts:13`). Any day with fewer
than 2 doctors is reported as an "unfillable" conflict, and the **Generate** button is
disabled until **zero** conflicts remain (`apps/web/src/pages/SchedulePreviewPage.vue:104-114`).

The preview is **read-only** (`mode="readonly"`, `SchedulePreviewPage.vue:127`), so the
admin has no way to resolve a conflict from the preview screen itself. They must leave the
page, edit doctors/availability/holidays elsewhere, and re-preview. Worse, a day with
**1 doctor** (partial but still covered) blocks generation just like a fully unfillable day.

## Goal

Make the preview **editable** and relax the fill rule:

1. The engine still **targets 2 doctors/day** first (unchanged).
2. The admin can **add / remove / replace** doctors directly on the preview.
3. **1 doctor/day becomes acceptable** (warning, not a blocker).
4. Only a day with **0 doctors** blocks generation.
5. Clicking **Generate** persists exactly what is on screen (**WYSIWYG**).

## Locked decisions

| Decision | Choice |
|---|---|
| Override scope | All hard rules overridable **except availability** (vacation stays hard). Monthly cap, Saturday/Sunday cap, and back-to-back can be overridden. |
| Fill threshold | **0 doctors = error (blocks Generate)**; **1 doctor = warning (allowed)**; 2 = satisfied. |
| Generate semantics | **WYSIWYG** — the edited plan is persisted verbatim. Editing day N does not cascade into re-computing other days. |
| Post-generation draft editor | Left **strict** (unchanged `validateAssignment`). The asymmetry is intentional and documented. |

## Architecture (Approach A)

The preview API stays **stateless**. The frontend holds the engine's plan as mutable
local state; the admin edits it; Generate sends the **entire final plan** to the backend,
which re-validates and persists. The engine is **not** re-run on generate when a plan is
supplied.

### Why this approach

- Simplest; WYSIWYG by construction.
- Payload is tiny (~62 rows for a 31-day month × 2).
- Contains the looser override rules to the preview → generate path, leaving the strict
  draft editor untouched.

## Detailed design

### 1. Shared types (`packages/shared`)

**`DayInfo`** gains an `availableDoctorIds` field:

```ts
export interface DayInfo {
  date: string
  isWeekend: boolean
  isHoliday: boolean
  eligibleDoctorIds: number[]   // passes ALL hard rules (existing)
  availableDoctorIds: number[]  // active + NOT on vacation that day (NEW)
}
```

`availableDoctorIds` is the **stable override pool**: it only depends on active status +
unavailability, so it does not shift as the admin edits (unlike `eligibleDoctorIds`, which
also reflects cap/consecutive state).

**New generate payload type:**

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

`assignments` is **optional** so the existing direct-Generate flow
(`SchedulesPage.vue:96`, no plan) keeps working via the strict engine path.

### 2. Shared schema (`packages/shared/src/schemas/schedule.ts`)

```ts
export const generateScheduleSchema = createScheduleSchema.extend({
  assignments: z
    .array(z.object({
      date: dateStr,
      doctorId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
    }))
    .optional(),
})
```

Exported from `schemas/index.ts` and re-exported by the API validator
(`apps/api/src/validators/schedule.ts`).

### 3. Backend service (`apps/api/src/services/schedule.service.ts`)

**`computeEligibility`** — in its single doctor loop, additionally push the doctor's id
into `availableDoctorIds` whenever they pass **only** the availability check (independent
of cap/weekend/consecutive). So each `DayInfo` now carries both pools fully populated.

**`preview()`** — keep `availableDoctorIds` populated; keep stripping `eligibleDoctorIds`
to `[]` (current behavior). Preview is admin-only, so no security stripping needed.

**`getById()`** — strip **both** `eligibleDoctorIds` and `availableDoctorIds` for
non-admins (don't leak who is available to doctors).

**`generate(year, month, actor, assignments?)`** — two paths:

- **No `assignments`** (existing direct-Generate): unchanged engine path. Builds context,
  runs engine, throws `422` if any conflict, persists. (All existing tests stay green.)
- **With `assignments`** (new plan path, from preview):
  1. Reject if a schedule already exists for year/month (`409`).
  2. Build context (active doctors, unavailability, holidays).
  3. Validate the plan via a new `validatePlan(ctx, assignments)` helper:
     - Every assignment `date` is within the month (`400`).
     - Every `doctorId` is an active doctor (`400`).
     - **Availability is hard**: the doctor is not on vacation that date (`409`).
     - No duplicate doctor on the same date (`409`).
     - At most `DOCTORS_PER_DAY` (2) assignments per date (`409`).
     - **Every date in the month has ≥ 1 assignment** — otherwise `422` listing the empty
       dates (this is the "0 blocks" rule, enforced server-side; client is not trusted).
     - Cap, Saturday/Sunday cap, and back-to-back are **NOT** checked.
  4. In a transaction: insert the `draft` schedule, then insert one duty per assignment,
     computing `is_weekend` / `is_holiday` server-side and storing the supplied `reason`
     (default `'plan'`).
  5. Return `getById(newId, actor)`.

### 4. Backend controller + route (`apps/api`)

- Route `POST /schedules` (generate) validates with **`generateScheduleSchema`** instead of
  `createScheduleSchema`.
- Controller `generate` passes `req.body.assignments` through to the service.
- `POST /schedules/preview` is unchanged.

### 5. Frontend service (`apps/web/src/services/schedule.ts`)

```ts
export async function generate(
  year: number,
  month: number,
  assignments?: GenerateAssignment[],
): Promise<ScheduleDetail> {
  return apiPost<ScheduleDetail>('/schedules', { year, month, assignments })
}
```

`SchedulesPage.vue` direct-Generate calls `generate(year, month)` unchanged (no
assignments → engine path).

### 6. Frontend `DutyCalendar.vue`

- New prop `pool?: 'eligible' | 'available'` (default `'eligible'`). The cell option builder
  uses `day.availableDoctorIds` when `pool === 'available'`, else `day.eligibleDoctorIds`.
- **Remove the `&& !c.conflict` gate** on the editable `<Select>` (currently
  `DutyCalendar.vue:149`). This is safe because `ScheduleDetailPage` passes an empty
  `conflictsByDate` (line 67), so the draft editor is unaffected; only the preview will pass
  conflicts, and there we want conflict cells to be editable.
- In editable mode, render a fill-status hint under the slots:
  - **0 filled** → red "No doctor" (title = backend conflict `detail` when available).
  - **1 filled** → amber "1 of 2".
  - (2 filled → no hint.)
- The existing non-editable "Unfillable" badge (`DutyCalendar.vue:173-178`) stays for
  read-only views (e.g. a doctor viewing a published schedule that somehow has gaps).

### 7. Frontend `SchedulePreviewPage.vue`

- Hold a **mutable** `assignments` ref, initialized from `result.assignments` on load.
- `assignmentByDate` is computed from the mutable `assignments` (not directly from
  `result.assignments`).
- `mode="editable"`, `pool="available"`, wire `@select="onSelect"`.
- `onSelect(date, slotIndex, doctorId)` mutates local state only:
  - `doctorId === null` → remove the assignment at `slotIndex`.
  - `doctorId` set, slot exists → replace the doctor (look up name from `doctors`).
  - `doctorId` set, no slot → add a new assignment with `reason: 'manual override'`.
  - No backend call per edit (all local until Generate).
- Recompute status from live counts:
  - `errorDates` = dates with 0 assignments → `errorCount`.
  - `warningCount` = dates with exactly 1 assignment.
  - **Generate disabled** while `errorCount > 0`.
- Banner copy:
  - `errorCount > 0` → red: `"{errorCount} day(s) with no doctor — assign at least one before generating."`
  - else `warningCount > 0` → amber: `"{warningCount} day(s) with only 1 doctor."`
  - else → muted: `"{assignments.length} assignment(s) ready. No conflicts."`
- `generate()` sends the current local assignments:
  `scheduleService.generate(year, month, assignments.map(a => ({ date: a.date, doctorId: a.doctorId, reason: a.reason })))`.

## Edge cases & security

- **Don't trust the client.** The server independently re-checks active status,
  availability, duplicate-same-day, max 2/day, and the ≥1/day rule.
- **No-leak to doctors.** `availableDoctorIds` (and `eligibleDoctorIds`) are stripped for
  non-admins in `getById`. Preview/generate are admin-only routes.
- **Re-preview resets edits.** Because the preview is stateless and edits live only in
  browser memory, navigating away and re-previewing discards manual changes. The banner will
  note the day count is ready; acceptable for v1.
- **Reason text** is display-only (not security-relevant); the server stores the supplied
  reason verbatim, defaulting to `'plan'` when absent.
- **Stable pool.** Because `availableDoctorIds` depends only on active + unavailability, it
  does not change as the admin edits — so dropdown options stay consistent within a session.

## Tests

- **`schedule.service.test.ts`**: update `computeEligibility` `toEqual` assertions to
  include `availableDoctorIds`; add `generate(..., assignments)` plan-path cases:
  rejects vacation doctor (409), rejects duplicate same-day (409), rejects empty day (422),
  rejects >2/day (409), persists a valid 1-doctor plan.
- **`schedule.routes.test.ts`**: generate route accepts optional `assignments`; plan path
  passes the body through.
- **`schemas.test.ts`**: `generateScheduleSchema` validates/parses with and without
  assignments.
- **`SchedulePreviewPage.test.ts`** (new): renders editable calendar; assigning a doctor
  clears the error; removing down to 1 shows a warning; Generate is disabled while any day
  has 0 and sends the plan when enabled.
- **Existing direct-Generate test** (`schedule.service.test.ts:70`) keeps passing unchanged.

## Out of scope

- Changing the engine or its conflict definition.
- Changing the post-generation draft editor's strict `validateAssignment`.
- Persisting preview edits across page reloads.
- Bulk operations (clear all, auto-fill gaps).
