# Phase 6 — Schedule Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the admin Schedule Management UI (list, guided generate, day-list detail with manual overrides, publish/unpublish) and a Holidays CRUD page, plus the deferred backend publish/unpublish endpoints with published-lock enforcement.

**Architecture:** Backend adds two admin routes (`POST /schedules/:id/publish`, `/unpublish`) and a single service-layer guard that blocks duty mutations + schedule deletion while a schedule is published. Frontend adds two thin service modules, three admin pages that follow the established Phase 2–5 patterns (script setup, `onMounted` load, `ref` state, zod `safeParse`, `Dialog` forms, `Table*`, `confirm()` before destructive actions), router entries, and nav links. No DB migration, no `@oncall/shared` changes.

**Tech Stack:** Node + Express + TypeScript + `pg` (parameterized SQL, no ORM) + Zod + JWT/RBAC; Vue 3 + Vite + TypeScript + Pinia + Vue Router + shadcn-vue + Tailwind v4; pnpm workspaces; Vitest.

## Global Constraints

- Parameterized SQL only; no ORM (no Prisma/TypeORM/Sequelize); no PG-error-code reliance (explicit existence checks).
- `@oncall/shared` is the single source of truth for the API contract (types + zod schemas). Reuse the existing types/schemas; do **not** duplicate them.
- RBAC: every `/schedules`, `/duties`, and holiday-mutation route is admin-only (`authenticate` + `authorize('administrator')`); doctors get 403. The published-lock is enforced in the **service layer** (single source of truth), not only in the UI.
- Styling uses existing Tailwind theme tokens only (`text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `bg-muted`, `bg-primary/10`, `bg-destructive/10`, `border-input`, `bg-background`) — **no hardcoded colors**, no Prettier (format with Volar).
- Controllers stay thin; business logic lives in services.
- Commit style: lowercase conventional commits (e.g. `feat(api): …`, `feat(web): …`, `docs: …`). Never commit on `main` — work happens on branch `feat/phase6-schedule-ui` (already created).
- Verification commands: `pnpm typecheck` and `pnpm lint` (root, all workspaces); `pnpm --filter @oncall/api test` / `pnpm --filter @oncall/web test` for targeted test runs.

**Spec reference:** `docs/superpowers/specs/2026-08-07-phase6-schedule-ui-design.md`

---

## File Structure

**Backend (`apps/api`) — all edits, no new files:**
- `src/services/schedule.service.ts` — add `publish`, `unpublish`, private `assertEditable` guard; extend `DutyRow`/`SELECT_DUTY` with `schedule_status`; add guard call sites in `addDuty`, `reassignDuty`, `removeDuty`, `remove`.
- `src/controllers/schedule.controller.ts` — add thin `publish`, `unpublish` handlers.
- `src/routes/schedule.routes.ts` — register `POST /:id/publish`, `POST /:id/unpublish`.
- `src/__tests__/schedule.service.test.ts` — add publish/unpublish + lock cases.
- `src/__tests__/schedule.routes.test.ts` — add publish/unpublish + lock propagation cases.

**Frontend (`apps/web`) — new + edits:**
- `src/services/schedule.ts` (NEW) — thin wrappers over `/schedules`, `/schedules/:id/duties`, `/duties`.
- `src/services/holiday.ts` (NEW) — thin wrappers over `/holidays`.
- `src/pages/HolidaysPage.vue` (NEW) — admin CRUD (mimics `AvailabilityPage.vue`).
- `src/pages/SchedulesPage.vue` (NEW) — list + guided generate dialog.
- `src/pages/ScheduleDetailPage.vue` (NEW) — day-list table + override dialog + publish/unpublish/delete.
- `src/router/index.ts` (EDIT) — three admin routes.
- `src/components/layout/AppHeader.vue` (EDIT) — two nav links.
- `src/__tests__/{HolidaysPage,SchedulesPage,ScheduleDetailPage}.test.ts` (NEW) — page tests.

**Shared / DB:** none.

---

## Task 1: Backend — publish/unpublish + published-lock + tests

**Files:**
- Modify: `apps/api/src/services/schedule.service.ts`
- Modify: `apps/api/src/controllers/schedule.controller.ts`
- Modify: `apps/api/src/routes/schedule.routes.ts`
- Modify: `apps/api/src/__tests__/schedule.service.test.ts`
- Modify: `apps/api/src/__tests__/schedule.routes.test.ts`

**Interfaces:**
- Produces (service, consumed by controller + tests): `publish(id: number): Promise<ScheduleSummary>`, `unpublish(id: number): Promise<ScheduleSummary>`. Lock is enforced inside the existing `addDuty` / `reassignDuty` / `removeDuty` / `remove` (they now throw `HttpError(409, …)` when the schedule status is `'published'`).
- Produces (routes): `POST /schedules/:id/publish`, `POST /schedules/:id/unpublish` → `200 { schedule }`, `404` missing, `409` already in target state.

- [ ] **Step 1: Extend `DutyRow` + `SELECT_DUTY` with `schedule_status`**

In `apps/api/src/services/schedule.service.ts`, add `schedule_status: string` to the `DutyRow` interface (currently fields end with `created_at: Date`):

```ts
interface DutyRow {
  id: number
  schedule_id: number
  duty_date: string
  doctor_id: number
  first_name: string
  last_name: string
  is_weekend: boolean
  is_holiday: boolean
  reason: string
  created_at: Date
  schedule_status: string
}
```

Update the `SELECT_DUTY` constant to JOIN `schedules` and select its status:

```ts
const SELECT_DUTY = `SELECT du.id, du.schedule_id, du.duty_date, du.doctor_id, du.is_weekend,
  du.is_holiday, du.reason, du.created_at, u.first_name, u.last_name, s.status AS schedule_status
  FROM duties du JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id
  JOIN schedules s ON s.id = du.schedule_id`
```

(`toDuty` is unchanged — it ignores `schedule_status`.)

- [ ] **Step 2: Add the `assertEditable` guard helper**

Add this private function near the other private helpers (e.g. just above `addDuty`):

```ts
function assertEditable(
  status: string,
  message = 'Schedule is published; revert to draft to edit',
): void {
  if (status === 'published') throw new HttpError(409, message)
}
```

- [ ] **Step 3: Add `publish` and `unpublish` service methods**

Append at the end of `apps/api/src/services/schedule.service.ts`:

```ts
export async function publish(id: number): Promise<ScheduleSummary> {
  const upd = await query<ScheduleRow>(
    `UPDATE schedules SET status = 'published', updated_at = NOW()
     WHERE id = $1 AND status = 'draft'
     RETURNING id, year, month, status, created_by, created_at, updated_at`,
    [id],
  )
  if (upd.rows.length === 0) {
    const found = await query('SELECT 1 FROM schedules WHERE id = $1', [id])
    if (found.rows.length === 0) throw new HttpError(404, 'Schedule not found')
    throw new HttpError(409, 'Schedule is already published')
  }
  return toSchedule(upd.rows[0])
}

export async function unpublish(id: number): Promise<ScheduleSummary> {
  const upd = await query<ScheduleRow>(
    `UPDATE schedules SET status = 'draft', updated_at = NOW()
     WHERE id = $1 AND status = 'published'
     RETURNING id, year, month, status, created_by, created_at, updated_at`,
    [id],
  )
  if (upd.rows.length === 0) {
    const found = await query('SELECT 1 FROM schedules WHERE id = $1', [id])
    if (found.rows.length === 0) throw new HttpError(404, 'Schedule not found')
    throw new HttpError(409, 'Schedule is already draft')
  }
  return toSchedule(upd.rows[0])
}
```

- [ ] **Step 4: Wire the guard into `addDuty`**

In `addDuty`, immediately after the out-of-month check (the `if (!inMonth(input.date, …)) throw …` line), add:

```ts
  assertEditable(schedule.status)
```

(`schedule` is the row already loaded at the top of `addDuty`; this adds no new query.)

- [ ] **Step 5: Wire the guard into `reassignDuty` and `removeDuty`**

In `reassignDuty`, immediately after `const duty = await getDutyRow(dutyId)` and before `validateAssignment`, add:

```ts
  assertEditable(duty.schedule_status)
```

In `removeDuty`, immediately after `await getDutyRow(dutyId)` and before the `DELETE`, add:

```ts
  assertEditable(duty.schedule_status)
```

(Both read `schedule_status` from the already-fetched duty row; no new query.)

- [ ] **Step 6: Wire the guard into schedule `remove` (with delete-specific message)**

Replace the existing `remove` function:

```ts
export async function remove(id: number): Promise<void> {
  const existing = await query<{ status: string }>(
    'SELECT status FROM schedules WHERE id = $1',
    [id],
  )
  if (existing.rows.length === 0) throw new HttpError(404, 'Schedule not found')
  assertEditable(
    existing.rows[0].status,
    'Schedule is published; revert to draft before deleting',
  )
  await query('DELETE FROM schedules WHERE id = $1', [id])
}
```

- [ ] **Step 7: Add thin controller handlers**

In `apps/api/src/controllers/schedule.controller.ts`, add two methods to the `scheduleController` object (same shape as the existing handlers):

```ts
  async publish(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await scheduleService.publish(Number(req.params.id))
      res.status(200).json(ok({ schedule }))
    } catch (err) {
      next(err)
    }
  },
  async unpublish(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await scheduleService.unpublish(Number(req.params.id))
      res.status(200).json(ok({ schedule }))
    } catch (err) {
      next(err)
    }
  },
```

- [ ] **Step 8: Register the two routes**

In `apps/api/src/routes/schedule.routes.ts`, add these two lines immediately after the existing `scheduleRouter.get('/:id', …)` line (the router already applies `authenticate` + `authorize('administrator')` to everything):

```ts
scheduleRouter.post('/:id/publish', validate(idParams, 'params'), scheduleController.publish)
scheduleRouter.post('/:id/unpublish', validate(idParams, 'params'), scheduleController.unpublish)
```

(`idParams` is already imported in this file.)

- [ ] **Step 9: Add service tests for publish/unpublish + lock**

In `apps/api/src/__tests__/schedule.service.test.ts`:

1. Add `publish` and `unpublish` to the import from `../services/schedule.service`:

```ts
import {
  addDuty,
  generate,
  getById,
  list,
  preview,
  publish,
  reassignDuty,
  remove,
  removeDuty,
  unpublish,
} from '../services/schedule.service'
```

2. Append these two describe blocks at the end of the file:

```ts
describe('publish / unpublish', () => {
  it('publish flips draft->published; 404 missing; 409 already published', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] })
    const published = await publish(1)
    expect(published.status).toBe('published')

    query.mockResolvedValueOnce({ rows: [] }) // UPDATE matches nothing
    query.mockResolvedValueOnce({ rows: [] }) // existence -> 404
    await expect(publish(99)).rejects.toMatchObject({ status: 404 })

    query.mockResolvedValueOnce({ rows: [] }) // UPDATE matches nothing (already published)
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // exists -> 409
    await expect(publish(1)).rejects.toMatchObject({ status: 409 })
  })

  it('unpublish flips published->draft; 404 missing; 409 already draft', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'draft' })] })
    const draft = await unpublish(1)
    expect(draft.status).toBe('draft')

    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    await expect(unpublish(99)).rejects.toMatchObject({ status: 404 })

    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    await expect(unpublish(1)).rejects.toMatchObject({ status: 409 })
  })
})

describe('published lock', () => {
  it('addDuty 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('reassignDuty 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow({ schedule_status: 'published' })] })
    await expect(
      reassignDuty(10, { doctorId: 7 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('removeDuty 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow({ schedule_status: 'published' })] })
    await expect(removeDuty(10)).rejects.toMatchObject({ status: 409 })
  })

  it('remove (schedule) 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'published' }] })
    await expect(remove(1)).rejects.toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 10: Add route tests for publish/unpublish + lock propagation**

In `apps/api/src/__tests__/schedule.routes.test.ts`:

1. Add `publish` and `unpublish` mock fns next to the others (top of file):

```ts
const publish = vi.fn()
const unpublish = vi.fn()
```

2. Add them to the `vi.mock('../services/schedule.service', …)` factory:

```ts
  publish: (...a: unknown[]) => publish(...a),
  unpublish: (...a: unknown[]) => unpublish(...a),
```

3. Add them to the `beforeEach` reset array:

```ts
  [preview, generate, list, getById, remove, addDuty, reassignDuty, removeDuty, publish, unpublish].forEach((m) =>
    m.mockReset(),
  )
```

4. Append these two tests inside the existing `describe('schedule routes', …)` block:

```ts
  it('admin publish (200) and unpublish (200); doctor 403', async () => {
    publish.mockResolvedValue({
      id: 1, year: 2026, month: 9, status: 'published', createdBy: 1, createdAt: '', updatedAt: '',
    })
    unpublish.mockResolvedValue({
      id: 1, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '',
    })
    const p = await request(build())
      .post('/schedules/1/publish')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(p.status).toBe(200)
    expect(p.body.data.schedule.status).toBe('published')

    const u = await request(build())
      .post('/schedules/1/unpublish')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(u.status).toBe(200)
    expect(u.body.data.schedule.status).toBe('draft')

    const forbidden = await request(build())
      .post('/schedules/1/publish')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)
  })

  it('duty + schedule mutations surface the published-lock as 409', async () => {
    const locked = Object.assign(new Error('Schedule is published; revert to draft to edit'), { status: 409 })
    addDuty.mockRejectedValue(locked)
    reassignDuty.mockRejectedValue(locked)
    removeDuty.mockRejectedValue(locked)
    remove.mockRejectedValue(locked)

    const a = await request(build())
      .post('/schedules/1/duties')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ date: '2026-09-05', doctorId: 3 })
    expect(a.status).toBe(409)
    const r = await request(build())
      .patch('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 4 })
    expect(r.status).toBe(409)
    const d = await request(build())
      .delete('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(d.status).toBe(409)
    const s = await request(build())
      .delete('/schedules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(s.status).toBe(409)
  })
```

- [ ] **Step 11: Run typecheck, lint, and API tests**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/api test`
Expected: PASS with no errors (existing schedule tests remain green; new publish/unpublish/lock tests pass).

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/services/schedule.service.ts apps/api/src/controllers/schedule.controller.ts apps/api/src/routes/schedule.routes.ts apps/api/src/__tests__/schedule.service.test.ts apps/api/src/__tests__/schedule.routes.test.ts
git commit -m "feat(api): schedule publish/unpublish + published-lock enforcement"
```

---

## Task 2: Frontend — schedule + holiday service modules

**Files:**
- Create: `apps/web/src/services/schedule.ts`
- Create: `apps/web/src/services/holiday.ts`

**Interfaces:**
- Consumes: `apiGet`/`apiPost`/`apiPatch`/`apiDelete` from `@/lib/http`; types + zod schemas from `@oncall/shared`.
- Produces (consumed by the pages in Tasks 3–5): see exact signatures in the code below.

- [ ] **Step 1: Create `apps/web/src/services/schedule.ts`**

```ts
import type {
  CreateDutyRequest,
  Duty,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
} from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

function toQuery(query?: ScheduleQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.year !== undefined) parts.push(`year=${query.year}`)
  if (query.month !== undefined) parts.push(`month=${query.month}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function list(query?: ScheduleQuery): Promise<ScheduleSummary[]> {
  const { schedules } = await apiGet<{ schedules: ScheduleSummary[] }>(`/schedules${toQuery(query)}`)
  return schedules
}
export async function get(id: number): Promise<ScheduleDetail> {
  return apiGet<ScheduleDetail>(`/schedules/${id}`)
}
export async function preview(year: number, month: number): Promise<PreviewResult> {
  return apiPost<PreviewResult>('/schedules/preview', { year, month })
}
export async function generate(year: number, month: number): Promise<ScheduleDetail> {
  return apiPost<ScheduleDetail>('/schedules', { year, month })
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/schedules/${id}`)
}
export async function publish(id: number): Promise<ScheduleSummary> {
  const { schedule } = await apiPost<{ schedule: ScheduleSummary }>(`/schedules/${id}/publish`)
  return schedule
}
export async function unpublish(id: number): Promise<ScheduleSummary> {
  const { schedule } = await apiPost<{ schedule: ScheduleSummary }>(`/schedules/${id}/unpublish`)
  return schedule
}
export async function addDuty(scheduleId: number, input: CreateDutyRequest): Promise<Duty> {
  const { duty } = await apiPost<{ duty: Duty }>(`/schedules/${scheduleId}/duties`, input)
  return duty
}
export async function reassignDuty(dutyId: number, input: ReassignDutyRequest): Promise<Duty> {
  const { duty } = await apiPatch<{ duty: Duty }>(`/duties/${dutyId}`, input)
  return duty
}
export async function removeDuty(dutyId: number): Promise<void> {
  await apiDelete<void>(`/duties/${dutyId}`)
}
```

- [ ] **Step 2: Create `apps/web/src/services/holiday.ts`**

```ts
import type { CreateHolidayRequest, Holiday, UpdateHolidayRequest } from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

export async function list(): Promise<Holiday[]> {
  const { holidays } = await apiGet<{ holidays: Holiday[] }>('/holidays')
  return holidays
}
export async function create(input: CreateHolidayRequest): Promise<Holiday> {
  const { holiday } = await apiPost<{ holiday: Holiday }>('/holidays', input)
  return holiday
}
export async function update(id: number, input: UpdateHolidayRequest): Promise<Holiday> {
  const { holiday } = await apiPatch<{ holiday: Holiday }>(`/holidays/${id}`, input)
  return holiday
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/holidays/${id}`)
}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/services/schedule.ts apps/web/src/services/holiday.ts
git commit -m "feat(web): schedule and holiday service modules"
```

---

## Task 3: Frontend — Holidays CRUD page + test

**Files:**
- Create: `apps/web/src/pages/HolidaysPage.vue`
- Create: `apps/web/src/__tests__/HolidaysPage.test.ts`

**Interfaces:**
- Consumes: `* as holidayService from '@/services/holiday'` (`list`, `create`, `update`, `remove`); `createHolidaySchema` / `updateHolidaySchema` from `@oncall/shared`; UI primitives `Button`, `Dialog`, `Input`, `Label`, `Table*`.
- Produces: the default export `HolidaysPage` mounted at `/holidays` (Task 6).

- [ ] **Step 1: Create `apps/web/src/pages/HolidaysPage.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateHolidayRequest, Holiday, UpdateHolidayRequest } from '@oncall/shared'
import { createHolidaySchema, updateHolidaySchema } from '@oncall/shared'
import * as holidayService from '@/services/holiday'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const records = ref<Holiday[]>([])
const loading = ref(false)
const errorMsg = ref('')

interface EditState {
  open: boolean
  id: number | null
  name: string
  date: string
}
const emptyEdit = (): EditState => ({ open: false, id: null, name: '', date: '' })
const edit = ref<EditState>(emptyEdit())

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    records.value = await holidayService.list()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load holidays'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}
function openUpdate(x: Holiday) {
  edit.value = { open: true, id: x.id, name: x.name, date: x.date }
}

async function save() {
  errorMsg.value = ''
  if (edit.value.id === null) {
    const payload: CreateHolidayRequest = { name: edit.value.name, date: edit.value.date }
    const r = createHolidaySchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await holidayService.create(r.data)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to create holiday'
      return
    }
  } else {
    const payload: UpdateHolidayRequest = { name: edit.value.name, date: edit.value.date }
    const r = updateHolidaySchema.safeParse(payload)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    try {
      await holidayService.update(edit.value.id, r.data)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to update holiday'
      return
    }
  }
  edit.value = emptyEdit()
  await load()
}

async function remove(x: Holiday) {
  if (!confirm(`Delete holiday "${x.name}" on ${x.date}?`)) return
  try {
    await holidayService.remove(x.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to delete holiday'
    return
  }
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Holidays</h1>
      <Button @click="openCreate">New holiday</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Name</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="x in records" :key="x.id">
          <TableCell>{{ x.date }}</TableCell>
          <TableCell>{{ x.name }}</TableCell>
          <TableCell class="text-right">
            <div class="inline-flex gap-2">
              <Button size="sm" variant="outline" @click="openUpdate(x)">Edit</Button>
              <Button size="sm" variant="destructive" @click="remove(x)">Delete</Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New holiday' : 'Edit holiday'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-name">Name</Label>
          <Input id="e-name" v-model="edit.name" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-date">Date</Label>
          <Input id="e-date" v-model="edit.date" type="date" />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 2: Create `apps/web/src/__tests__/HolidaysPage.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
vi.mock('@/services/holiday', () => ({
  list: (...a: unknown[]) => list(...a),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import HolidaysPage from '../pages/HolidaysPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('HolidaysPage', () => {
  it('renders the list on mount', async () => {
    list.mockResolvedValue([
      { id: 1, name: 'Sample Holiday', date: '2026-09-01', createdAt: '', updatedAt: '' },
    ])
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Sample Holiday')
    expect(wrapper.text()).toContain('2026-09-01')
  })

  it('shows an error when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
```

- [ ] **Step 3: Run typecheck, lint, and the web test**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/HolidaysPage.vue apps/web/src/__tests__/HolidaysPage.test.ts
git commit -m "feat(web): admin holidays management page"
```

---

## Task 4: Frontend — Schedules list page (guided generate) + test

**Files:**
- Create: `apps/web/src/pages/SchedulesPage.vue`
- Create: `apps/web/src/__tests__/SchedulesPage.test.ts`

**Interfaces:**
- Consumes: `* as scheduleService from '@/services/schedule'` (`list`, `preview`, `generate`); `createScheduleSchema` from `@oncall/shared`; `useRouter` from `vue-router`; UI primitives.
- Produces: the default export `SchedulesPage` mounted at `/schedules` (Task 6); on successful generate it navigates to `/schedules/<id>` (the `ScheduleDetailPage` route).

- [ ] **Step 1: Create `apps/web/src/pages/SchedulesPage.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ConflictPlan, ScheduleSummary } from '@oncall/shared'
import { createScheduleSchema } from '@oncall/shared'
import * as scheduleService from '@/services/schedule'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const router = useRouter()
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

const records = ref<ScheduleSummary[]>([])
const loading = ref(false)
const errorMsg = ref('')
const filterYear = ref('')

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query = filterYear.value ? { year: Number(filterYear.value) } : undefined
    records.value = await scheduleService.list(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load schedules'
  } finally {
    loading.value = false
  }
}

function view(id: number) {
  router.push(`/schedules/${id}`)
}

interface GenState {
  open: boolean
  year: string
  month: string
  previewing: boolean
  assignments: number
  conflicts: ConflictPlan[]
  errorMsg: string
  generating: boolean
}
const emptyGen = (): GenState => ({
  open: false,
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  previewing: false,
  assignments: 0,
  conflicts: [],
  errorMsg: '',
  generating: false,
})
const gen = ref<GenState>(emptyGen())

function openGenerate() {
  gen.value = emptyGen()
  gen.value.open = true
}

async function runPreview() {
  gen.value.errorMsg = ''
  gen.value.conflicts = []
  gen.value.assignments = 0
  const parsed = createScheduleSchema.safeParse({
    year: Number(gen.value.year),
    month: Number(gen.value.month),
  })
  if (!parsed.success) {
    gen.value.errorMsg = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  gen.value.previewing = true
  try {
    const result = await scheduleService.preview(parsed.data.year, parsed.data.month)
    gen.value.assignments = result.assignments.length
    gen.value.conflicts = result.conflicts
  } catch (e) {
    gen.value.errorMsg = e instanceof Error ? e.message : 'Failed to preview'
  } finally {
    gen.value.previewing = false
  }
}

async function runGenerate() {
  gen.value.errorMsg = ''
  const parsed = createScheduleSchema.safeParse({
    year: Number(gen.value.year),
    month: Number(gen.value.month),
  })
  if (!parsed.success) {
    gen.value.errorMsg = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  gen.value.generating = true
  try {
    const detail = await scheduleService.generate(parsed.data.year, parsed.data.month)
    gen.value.open = false
    router.push(`/schedules/${detail.schedule.id}`)
  } catch (e) {
    gen.value.errorMsg = e instanceof Error ? e.message : 'Failed to generate'
  } finally {
    gen.value.generating = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Schedules</h1>
      <Button @click="openGenerate">New schedule</Button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-year">Year</Label>
        <Input id="f-year" v-model="filterYear" type="number" />
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="s in records" :key="s.id">
          <TableCell>{{ monthLabel(s.year, s.month) }}</TableCell>
          <TableCell>
            <span
              :class="s.status === 'published'
                ? 'inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
                : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'"
            >
              {{ s.status === 'published' ? 'Published' : 'Draft' }}
            </span>
          </TableCell>
          <TableCell>{{ s.createdAt.slice(0, 10) }}</TableCell>
          <TableCell class="text-right">
            <Button size="sm" variant="outline" @click="view(s.id)">View</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <Dialog v-model:open="gen.open" title="New schedule">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="runGenerate">
        <div class="flex flex-col gap-1">
          <Label for="g-year">Year</Label>
          <Input id="g-year" v-model="gen.year" type="number" />
        </div>
        <div class="flex flex-col gap-1">
          <Label for="g-month">Month</Label>
          <select
            id="g-month"
            v-model="gen.month"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
          </select>
        </div>

        <div class="flex items-center gap-2">
          <Button type="button" variant="outline" :disabled="gen.previewing" @click="runPreview">
            {{ gen.previewing ? 'Previewing…' : 'Preview' }}
          </Button>
          <Button
            type="submit"
            :disabled="gen.assignments === 0 || gen.conflicts.length > 0 || gen.generating"
          >
            {{ gen.generating ? 'Generating…' : 'Generate' }}
          </Button>
        </div>

        <p v-if="gen.errorMsg" class="text-sm text-destructive" role="alert">{{ gen.errorMsg }}</p>

        <div
          v-if="gen.conflicts.length > 0"
          class="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p class="text-sm font-medium text-destructive">
            Resolve {{ gen.conflicts.length }} unfillable day(s) first (adjust availability, doctor capacity, or holidays).
          </p>
          <ul class="text-xs text-muted-foreground">
            <li v-for="c in gen.conflicts" :key="c.date">{{ c.date }} — {{ c.detail }}</li>
          </ul>
        </div>
        <p v-else-if="gen.assignments > 0" class="text-sm text-muted-foreground">
          {{ gen.assignments }} day(s) ready to assign. No conflicts — Generate to create.
        </p>
      </form>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 2: Create `apps/web/src/__tests__/SchedulesPage.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const preview = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
  preview: (...a: unknown[]) => preview(...a),
  generate: (...a: unknown[]) => generate(...a),
  get: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  addDuty: vi.fn(),
  reassignDuty: vi.fn(),
  removeDuty: vi.fn(),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

import SchedulesPage from '../pages/SchedulesPage.vue'

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    year: 2026,
    month: 8,
    status: 'draft',
    createdBy: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  preview.mockReset()
  generate.mockReset()
  push.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('SchedulesPage', () => {
  it('renders the list with month label and status', async () => {
    list.mockResolvedValue([summary()])
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('August 2026')
    expect(wrapper.text()).toContain('Draft')
  })

  it('shows an error when listing fails', async () => {
    list.mockRejectedValue(new Error('boom'))
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
  })

  it('gates Generate behind a clean preview (disabled while conflicts exist)', async () => {
    list.mockResolvedValue([])
    preview.mockResolvedValue({
      assignments: [],
      conflicts: [{ date: '2026-09-01', detail: '0 doctors' }],
    })
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()

    const buttons = () => wrapper.findAll('button')
    await buttons().find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()

    const gen = buttons().find((b) => b.text().includes('Generate'))!
    // Disabled before any successful preview (assignments === 0)
    expect((gen.element as HTMLButtonElement).disabled).toBe(true)

    // Run preview -> 1 conflict -> still disabled + conflict text shown
    await buttons().find((b) => b.text().includes('Preview'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('1 unfillable day')
    expect((gen.element as HTMLButtonElement).disabled).toBe(true)
    expect(preview).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run typecheck, lint, and the web test**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SchedulesPage.vue apps/web/src/__tests__/SchedulesPage.test.ts
git commit -m "feat(web): schedules list page with guided generate flow"
```

---

## Task 5: Frontend — Schedule detail page (day-list + overrides + publish) + test

**Files:**
- Create: `apps/web/src/pages/ScheduleDetailPage.vue`
- Create: `apps/web/src/__tests__/ScheduleDetailPage.test.ts`

**Interfaces:**
- Consumes: `* as scheduleService from '@/services/schedule'` (`get`, `publish`, `unpublish`, `remove`, `addDuty`, `reassignDuty`, `removeDuty`); `* as doctorService from '@/services/doctor'` (`list`); `createDutySchema` / `reassignDutySchema` from `@oncall/shared`; `useRoute` / `useRouter` from `vue-router`; UI primitives.
- Produces: the default export `ScheduleDetailPage` mounted at `/schedules/:id` (Task 6).

- [ ] **Step 1: Create `apps/web/src/pages/ScheduleDetailPage.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  CreateDutyRequest,
  Doctor,
  Duty,
  ReassignDutyRequest,
  ScheduleDetail,
} from '@oncall/shared'
import { createDutySchema, reassignDutySchema } from '@oncall/shared'
import * as scheduleService from '@/services/schedule'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const weekdayFmt = new Intl.DateTimeFormat('en', { weekday: 'short' })
const dayFmt = new Intl.DateTimeFormat('en', { day: '2-digit' })

const detail = ref<ScheduleDetail | null>(null)
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')

const schedule = computed(() => detail.value?.schedule ?? null)
const isPublished = computed(() => schedule.value?.status === 'published')

interface DayRow {
  date: string
  weekday: string
  day: string
  isWeekend: boolean
  duty?: Duty
}
const rows = computed<DayRow[]>(() => {
  const s = schedule.value
  if (!s) return []
  const total = new Date(s.year, s.month, 0).getDate()
  const byDate = new Map<string, Duty>()
  for (const d of detail.value?.duties ?? []) byDate.set(d.dutyDate, d)
  const out: DayRow[] = []
  for (let dayNum = 1; dayNum <= total; dayNum++) {
    const iso = `${s.year}-${String(s.month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
    const js = new Date(`${iso}T00:00:00`)
    const dow = js.getDay()
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

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    detail.value = await scheduleService.get(id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load schedule'
  } finally {
    loading.value = false
  }
}

async function publish() {
  if (!confirm('Publish this schedule? Editing will be locked.')) return
  errorMsg.value = ''
  try {
    const updated = await scheduleService.publish(id)
    if (detail.value) detail.value.schedule = { ...detail.value.schedule, status: updated.status }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to publish'
  }
}

async function unpublish() {
  if (!confirm('Revert this schedule to draft? Editing will be re-enabled.')) return
  errorMsg.value = ''
  try {
    const updated = await scheduleService.unpublish(id)
    if (detail.value) detail.value.schedule = { ...detail.value.schedule, status: updated.status }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to revert'
  }
}

async function deleteSchedule() {
  if (!confirm('Delete this schedule and all its duties?')) return
  errorMsg.value = ''
  try {
    await scheduleService.remove(id)
    router.push('/schedules')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to delete schedule'
  }
}

interface OverrideState {
  open: boolean
  mode: 'add' | 'reassign'
  date: string
  dutyId: number | null
  doctorId: string
  errorMsg: string
  saving: boolean
}
const emptyOverride = (): OverrideState => ({
  open: false,
  mode: 'add',
  date: '',
  dutyId: null,
  doctorId: '',
  errorMsg: '',
  saving: false,
})
const override = ref<OverrideState>(emptyOverride())

function openAdd(date: string) {
  override.value = { ...emptyOverride(), open: true, mode: 'add', date }
}
function openReassign(d: Duty) {
  override.value = {
    ...emptyOverride(),
    open: true,
    mode: 'reassign',
    date: d.dutyDate,
    dutyId: d.id,
    doctorId: String(d.doctorId),
  }
}

async function saveOverride() {
  override.value.errorMsg = ''
  const doctorId = Number(override.value.doctorId)
  if (override.value.mode === 'add') {
    const payload: CreateDutyRequest = { date: override.value.date, doctorId }
    const r = createDutySchema.safeParse(payload)
    if (!r.success) {
      override.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    override.value.saving = true
    try {
      await scheduleService.addDuty(id, r.data)
    } catch (e) {
      override.value.errorMsg = e instanceof Error ? e.message : 'Failed to add duty'
      return
    } finally {
      override.value.saving = false
    }
  } else {
    const payload: ReassignDutyRequest = { doctorId }
    const r = reassignDutySchema.safeParse(payload)
    if (!r.success) {
      override.value.errorMsg = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    if (override.value.dutyId === null) return
    override.value.saving = true
    try {
      await scheduleService.reassignDuty(override.value.dutyId, r.data)
    } catch (e) {
      override.value.errorMsg = e instanceof Error ? e.message : 'Failed to reassign'
      return
    } finally {
      override.value.saving = false
    }
  }
  override.value = emptyOverride()
  await load()
}

async function removeDuty(d: Duty) {
  if (!confirm(`Remove ${d.doctorFirstName} ${d.doctorLastName} from ${d.dutyDate}?`)) return
  errorMsg.value = ''
  try {
    await scheduleService.removeDuty(d.id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to remove duty'
    return
  }
  await load()
}

onMounted(async () => {
  try {
    doctors.value = await doctorService.list()
  } catch {
    doctors.value = []
  }
  await load()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="loading && !detail" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <template v-if="schedule">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-semibold text-foreground">
            {{ MONTHS[schedule.month - 1] }} {{ schedule.year }}
          </h1>
          <span
            :class="isPublished
              ? 'inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'"
          >
            {{ isPublished ? 'Published' : 'Draft' }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <Button v-if="!isPublished" @click="publish">Publish</Button>
          <Button v-else variant="outline" @click="unpublish">Revert to draft</Button>
          <Button variant="destructive" :disabled="isPublished" @click="deleteSchedule">
            Delete schedule
          </Button>
        </div>
      </div>

      <p v-if="isPublished" class="text-sm text-muted-foreground">
        Schedule is published and locked. Revert to draft to edit duties.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Doctor</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead class="text-right">Actions</TableHead>
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
                <span v-if="r.isWeekend" class="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Weekend</span>
                <span v-if="r.duty?.isHoliday" class="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Holiday</span>
                <span v-if="!r.duty" class="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Gap day</span>
              </div>
            </TableCell>
            <TableCell>
              <span v-if="r.duty" class="text-xs text-muted-foreground" :title="r.duty.reason">{{ r.duty.reason }}</span>
            </TableCell>
            <TableCell class="text-right">
              <template v-if="!isPublished">
                <div v-if="r.duty" class="inline-flex gap-2">
                  <Button size="sm" variant="outline" @click="openReassign(r.duty)">Edit</Button>
                  <Button size="sm" variant="destructive" @click="removeDuty(r.duty)">Remove</Button>
                </div>
                <Button v-else size="sm" variant="outline" @click="openAdd(r.date)">+ Add</Button>
              </template>
              <span v-else class="text-xs text-muted-foreground">Locked</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </template>

    <Dialog
      v-model:open="override.open"
      :title="override.mode === 'add' ? `Add duty — ${override.date}` : `Reassign duty — ${override.date}`"
    >
      <form class="flex flex-col gap-3" novalidate @submit.prevent="saveOverride">
        <div class="flex flex-col gap-1">
          <Label for="o-doctor">Doctor</Label>
          <select
            id="o-doctor"
            v-model="override.doctorId"
            class="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>Select a doctor</option>
            <option v-for="d in doctors" :key="d.id" :value="d.id">
              {{ d.firstName }} {{ d.lastName }}
            </option>
          </select>
        </div>
        <p v-if="override.errorMsg" class="text-sm text-destructive" role="alert">{{ override.errorMsg }}</p>
        <div class="flex justify-end gap-2">
          <Button type="submit" :disabled="override.saving">{{ override.saving ? 'Saving…' : 'Save' }}</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>
```

- [ ] **Step 2: Create `apps/web/src/__tests__/ScheduleDetailPage.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const get = vi.fn()
const publish = vi.fn()
const unpublish = vi.fn()
const addDuty = vi.fn()
const reassignDuty = vi.fn()
const removeDuty = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: vi.fn(),
  preview: vi.fn(),
  generate: vi.fn(),
  get: (...a: unknown[]) => get(...a),
  remove: vi.fn(),
  publish: (...a: unknown[]) => publish(...a),
  unpublish: (...a: unknown[]) => unpublish(...a),
  addDuty: (...a: unknown[]) => addDuty(...a),
  reassignDuty: (...a: unknown[]) => reassignDuty(...a),
  removeDuty: (...a: unknown[]) => removeDuty(...a),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import ScheduleDetailPage from '../pages/ScheduleDetailPage.vue'

function detail(status: 'draft' | 'published') {
  return {
    schedule: {
      id: 1,
      year: 2026,
      month: 9,
      status,
      createdBy: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    duties: [
      {
        id: 10,
        scheduleId: 1,
        dutyDate: '2026-09-05',
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'score 1',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  get.mockReset()
  publish.mockReset()
  unpublish.mockReset()
  doctorList.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('ScheduleDetailPage', () => {
  it('renders the day-list with the assigned doctor and Edit action', async () => {
    get.mockResolvedValue(detail('draft'))
    const wrapper = mount(ScheduleDetailPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.text()).toContain('Jane Roe')
    expect(wrapper.text()).toContain('Edit')
  })

  it('locks override actions when the schedule is published', async () => {
    get.mockResolvedValue(detail('published'))
    const wrapper = mount(ScheduleDetailPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Published')
    expect(wrapper.text()).toContain('Locked')
    expect(wrapper.text()).toContain('Revert to draft')
    expect(wrapper.text()).not.toContain('+ Add')
  })

  it('publish flips status and locks editing', async () => {
    get.mockResolvedValue(detail('draft'))
    publish.mockResolvedValue({
      id: 1, year: 2026, month: 9, status: 'published', createdBy: 1, createdAt: '', updatedAt: '',
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mount(ScheduleDetailPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Edit')

    await wrapper.findAll('button').find((b) => b.text().includes('Publish'))!.trigger('click')
    await flushPromises()
    expect(publish).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('Locked')
    expect(wrapper.text()).not.toContain('+ Add')
  })
})
```

- [ ] **Step 3: Run typecheck, lint, and the web test**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ScheduleDetailPage.vue apps/web/src/__tests__/ScheduleDetailPage.test.ts
git commit -m "feat(web): schedule detail page with day-list, overrides, publish"
```

---

## Task 6: Frontend — routing + nav links + final verification

**Files:**
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/layout/AppHeader.vue`

**Interfaces:**
- Consumes: the three page components created in Tasks 3–5; `useAuthStore` (existing) for the nav gate.

- [ ] **Step 1: Register the three admin routes**

In `apps/web/src/router/index.ts`, add three entries to the `children` array of the default-layout route (after the `availability` entry, before `my-availability`):

```ts
      {
        path: 'schedules',
        name: 'schedules',
        component: () => import('../pages/SchedulesPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'schedules/:id',
        name: 'schedule-detail',
        component: () => import('../pages/ScheduleDetailPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'holidays',
        name: 'holidays',
        component: () => import('../pages/HolidaysPage.vue'),
        meta: { roles: ['administrator'] },
      },
```

- [ ] **Step 2: Add the two nav links**

In `apps/web/src/components/layout/AppHeader.vue`, add these two lines immediately after the Availability `<RouterLink>` (the line ending `to="/availability">Availability</RouterLink>`):

```html
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/schedules">Schedules</RouterLink>
        <RouterLink v-if="auth.isAdmin" class="text-muted-foreground hover:text-foreground" to="/holidays">Holidays</RouterLink>
```

- [ ] **Step 3: Run full typecheck, lint, and the whole test suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS with no errors across all workspaces.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run `pnpm dev` (API on :3000, web on :5174) and verify as admin: open **Schedules** → New schedule → Preview (conflicts shown / Generate gated) → Generate → detail day-list renders → Edit/+Add/Remove an override (409 surfaces inline on constraint violation) → Publish (locks) → Revert to draft (re-enables) → Delete (draft only). Open **Holidays** → create/edit/delete.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/router/index.ts apps/web/src/components/layout/AppHeader.vue
git commit -m "feat(web): wire schedule + holiday routes and nav links"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- §2 day-list table → Task 5. ✓
- §2 guided preview→generate with Generate gated on conflicts → Task 4 (`runPreview`/`runGenerate`, Generate disabled unless `assignments > 0 && conflicts === 0`). ✓
- §2 override dialog show-all-doctors + inline 409 → Task 5 (`saveOverride` catch block). ✓
- §2 publish + unpublish (backend + UI) + lock → Task 1 (service guard + endpoints), Task 5 (Publish/Revert buttons, locked actions). ✓
- §3 holidays CRUD page → Task 3. ✓
- §5 services → Task 2. ✓
- §5.5 routing + nav → Task 6. ✓
- §8 testing → tests embedded in Tasks 1, 3, 4, 5. ✓
- §9 DoD: covered by Tasks 1–6 + final `pnpm typecheck && pnpm lint && pnpm test`. ✓

**2. Placeholder scan:** none — every step contains concrete code or exact edits.

**3. Type consistency:**
- `publish(id)/unpublish(id): Promise<ScheduleSummary>` — service (Task 1) ↔ controller (Task 1) ↔ web service `publish/unpublish` (Task 2) ↔ page usage (Task 5) all return/expect `ScheduleSummary`. ✓
- `DutyRow.schedule_status` added in Task 1 Step 1; read in Steps 4–6 and in the new service tests (Step 9). ✓
- Web service method names (`list/get/preview/generate/remove/publish/unpublish/addDuty/reassignDuty/removeDuty`, holiday `list/create/update/remove`) match the `vi.mock` factories and page calls in Tasks 3–5. ✓
- `get`/`preview`/`generate` return the unwrapped data object (`ScheduleDetail`/`PreviewResult`) directly, matching `lib/http`'s `apiGet`/`apiPost` unwrap of the `{ success, data }` envelope. ✓

No issues found. Plan ready for execution.
