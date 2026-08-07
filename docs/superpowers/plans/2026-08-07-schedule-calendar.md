# Schedule Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the schedule as a big month-calendar; admins edit each day via an inline `<select>` of backend-computed eligible doctors, doctors see plain read-only names, and a new full preview page shows proposed assignments before generation.

**Architecture:** Backend computes per-day eligible doctor IDs by reusing the engine's pure constraint functions against the current/final duty set, and returns them in `ScheduleDetail`/`PreviewResult`. A single presentational `DutyCalendar.vue` renders both the editable detail page and the read-only preview/doctor views. Doctors gain read-only access to published schedules via a new `/roster` entry point.

**Tech Stack:** Node.js + TypeScript + Express, `pg` (direct SQL), Zod, Vue 3 + Vite + TypeScript, Pinia, Vue Router, Tailwind utility classes, existing shadcn-style UI primitives.

## Global Constraints

- Backend: direct SQL via `pg`, parameterized queries only, no ORM. Controllers thin; business logic in services. JWT `req.user = { id, role }` set by `authenticate`.
- Frontend: Vue 3 `<script setup lang="ts">`, Tailwind utility classes (e.g. `bg-muted`, `text-foreground`, `border-input`, `text-destructive`). No Prettier; format via Volar.
- Verification per task: run `pnpm typecheck && pnpm lint` from the repo root. Both must pass with no errors.
- Conventional commit messages scoped like the rest of the repo: `feat(shared):`, `feat(api):`, `feat(web):`, `test(web):`.
- Commit on the current feature branch (not main). One commit per task.
- Do not add code comments unless strictly necessary.
- `createScheduleSchema` validates `{ year: number, month: number }` (numbers, no coerce) — coerce query params with `Number()` before parsing.
- Keep `list`/`getById` service signatures backward-compatible (optional `actor`) so existing backend tests keep compiling.

**Spec:** `docs/superpowers/specs/2026-08-07-schedule-calendar-design.md`

---

### Task 1: Shared types + backend eligibility, service wiring, controller

**Files:**
- Modify: `packages/shared/src/types/schedule.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `apps/api/src/services/schedule.service.ts`
- Modify: `apps/api/src/controllers/schedule.controller.ts`

**Interfaces:**
- Produces (shared): `DayInfo { date: string; isWeekend: boolean; isHoliday: boolean; eligibleDoctorIds: number[] }`; `ScheduleDetail` gains `days: DayInfo[]`; `PreviewResult` gains `days: DayInfo[]`. Both re-exported from `@oncall/shared`.
- Produces (service): `preview(year, month)` and `getById(id, actor?)` and `list(filters?, actor?)` now return/carry `days`. `actor` is `Pick<AuthUser,'id'|'role'> | undefined`.

- [ ] **Step 1: Add the shared types**

Edit `packages/shared/src/types/schedule.ts`:

Replace the `PreviewResult` and `ScheduleDetail` interfaces with:

```ts
export interface DayInfo {
  date: string
  isWeekend: boolean
  isHoliday: boolean
  eligibleDoctorIds: number[]
}

export interface PreviewResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
  days: DayInfo[]
}

export interface ScheduleDetail {
  schedule: ScheduleSummary
  duties: Duty[]
  days: DayInfo[]
}
```

Edit `packages/shared/src/types/index.ts`: in the `export type { ... } from './schedule'` block, add `DayInfo,` (e.g. after `Duty,`).

- [ ] **Step 2: Add `computeEligibility` + wire it into the service**

In `apps/api/src/services/schedule.service.ts`:

The file already imports `isAvailable, notConsecutive, underCap` from `'../scheduling'` and `prevDate, nextDate` from `'../scheduling/dates'`. Add `DayInfo` to the type import from `@oncall/shared`:

```ts
import type {
  AuthUser,
  CreateDutyRequest,
  DayInfo,
  Duty,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
  ScheduleStatus,
} from '@oncall/shared'
```

Add this helper function immediately before the existing `export async function preview`:

```ts
interface EligibilityInput {
  doctors: DoctorSpec[]
  unavailability: Map<number, Array<{ start: string; end: string }>>
  days: { date: string; isWeekend: boolean; isHoliday: boolean }[]
  dutiesByDate: Map<string, number>
  dutyCountByDoctor: Map<number, number>
}

function computeEligibility(input: EligibilityInput): DayInfo[] {
  const out: DayInfo[] = []
  for (const day of input.days) {
    const eligible: number[] = []
    for (const doc of input.doctors) {
      const ranges = input.unavailability.get(doc.id)
      if (!isAvailable(doc.id, day.date, ranges).ok) continue
      const assignedToday = input.dutiesByDate.get(day.date) === doc.id
      const count = (input.dutyCountByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0)
      if (!underCap(count, doc.maxMonthlyDuties).ok) continue
      const onDutyAdjacent =
        input.dutiesByDate.get(prevDate(day.date)) === doc.id ||
        input.dutiesByDate.get(nextDate(day.date)) === doc.id
      if (!notConsecutive(onDutyAdjacent).ok) continue
      eligible.push(doc.id)
    }
    out.push({
      date: day.date,
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      eligibleDoctorIds: eligible,
    })
  }
  return out
}
```

Replace the existing `preview` function with:

```ts
export async function preview(year: number, month: number): Promise<PreviewResult> {
  const ctx = await buildContext(year, month)
  const result = runEngine(ctx)
  const dutiesByDate = new Map<string, number>()
  const dutyCountByDoctor = new Map<number, number>()
  for (const a of result.assignments) {
    dutiesByDate.set(a.date, a.doctorId)
    dutyCountByDoctor.set(a.doctorId, (dutyCountByDoctor.get(a.doctorId) ?? 0) + 1)
  }
  const days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    dutiesByDate,
    dutyCountByDoctor,
  }).map((d) => ({ ...d, eligibleDoctorIds: [] }))
  return { assignments: result.assignments, conflicts: result.conflicts, days }
}
```

Replace the existing `list` function with (adds optional `actor` → published-only for non-admins):

```ts
export async function list(
  filters: ScheduleQuery = {},
  actor?: Actor,
): Promise<ScheduleSummary[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (actor && actor.role !== 'administrator') {
    params.push('published')
    where.push(`status = $${params.length}`)
  }
  if (filters.year !== undefined) {
    params.push(filters.year)
    where.push(`year = $${params.length}`)
  }
  if (filters.month !== undefined) {
    params.push(filters.month)
    where.push(`month = $${params.length}`)
  }
  const sql =
    where.length > 0
      ? `${SELECT_SCHEDULE} WHERE ${where.join(' AND ')} ORDER BY year DESC, month DESC`
      : `${SELECT_SCHEDULE} ORDER BY year DESC, month DESC`
  const res = await query<ScheduleRow>(sql, params)
  return res.rows.map(toSchedule)
}
```

Replace the existing `getById` function with:

```ts
export async function getById(id: number, actor?: Actor): Promise<ScheduleDetail> {
  const sres = await query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE id = $1`, [id])
  const schedule = sres.rows[0]
  if (!schedule) throw new HttpError(404, 'Schedule not found')
  const isAdmin = actor?.role === 'administrator'
  if (actor && !isAdmin && schedule.status !== 'published') {
    throw new HttpError(403, 'Schedule not published')
  }
  const dres = await query<DutyRow>(`${SELECT_DUTY} WHERE du.schedule_id = $1 ORDER BY du.duty_date`, [
    id,
  ])
  const duties = dres.rows.map(toDuty)
  const ctx = await buildContext(schedule.year, schedule.month)
  const dutiesByDate = new Map<string, number>()
  const dutyCountByDoctor = new Map<number, number>()
  for (const d of duties) {
    dutiesByDate.set(d.dutyDate, d.doctorId)
    dutyCountByDoctor.set(d.doctorId, (dutyCountByDoctor.get(d.doctorId) ?? 0) + 1)
  }
  let days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    dutiesByDate,
    dutyCountByDoctor,
  })
  if (!isAdmin) {
    days = days.map((d) => ({ ...d, eligibleDoctorIds: [] }))
  }
  return { schedule: toSchedule(schedule), duties, days }
}
```

- [ ] **Step 3: Pass `req.user` from the controller**

In `apps/api/src/controllers/schedule.controller.ts`, update the `list` and `getById` handlers to forward the actor:

```ts
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const schedules = await scheduleService.list(req.query as ScheduleQuery, req.user)
      res.status(200).json(ok({ schedules }))
    } catch (err) {
      next(err)
    }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const detail = await scheduleService.getById(Number(req.params.id), req.user)
      res.status(200).json(ok(detail))
    } catch (err) {
      next(err)
    }
  },
```

(`req.user` is `{ id, role }` from `authenticate`, matching the service's `Actor`.)

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors. Existing tests keep compiling because `actor` is optional and `computeEligibility` issues no SQL.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/schedule.ts packages/shared/src/types/index.ts apps/api/src/services/schedule.service.ts apps/api/src/controllers/schedule.controller.ts
git commit -m "feat(api): per-day eligibility in schedule detail and preview"
```

---

### Task 2: Relax schedule RBAC for doctor read access

**Files:**
- Modify: `apps/api/src/routes/schedule.routes.ts`

**Interfaces:**
- Consumes: `authorize(...roles: Role[])` from `'../middleware/authorize'`.
- Produces: `GET /schedules` and `GET /schedules/:id` accept the `doctor` role; all other schedule + duty routes remain administrator-only.

- [ ] **Step 1: Split the router authorization**

In `apps/api/src/routes/schedule.routes.ts`, remove the router-wide `scheduleRouter.use(authorize('administrator'))` line (keep `scheduleRouter.use(authenticate)`). Then attach `authorize(...)` per route. Replace the whole block of `scheduleRouter` route registrations with:

```ts
scheduleRouter.use(authenticate)

scheduleRouter.get(
  '/',
  authorize('administrator', 'doctor'),
  validate(scheduleQuerySchema, 'query'),
  scheduleController.list,
)
scheduleRouter.post('/preview', authorize('administrator'), validate(createScheduleSchema, 'body'), scheduleController.preview)
scheduleRouter.post('/', authorize('administrator'), validate(createScheduleSchema, 'body'), scheduleController.generate)
scheduleRouter.get('/:id', authorize('administrator', 'doctor'), validate(idParams, 'params'), scheduleController.getById)
scheduleRouter.post('/:id/publish', authorize('administrator'), validate(idParams, 'params'), scheduleController.publish)
scheduleRouter.post('/:id/unpublish', authorize('administrator'), validate(idParams, 'params'), scheduleController.unpublish)
scheduleRouter.delete('/:id', authorize('administrator'), validate(idParams, 'params'), scheduleController.remove)
scheduleRouter.post('/:id/duties', authorize('administrator'), validate(idParams, 'params'), validate(createDutySchema, 'body'), scheduleController.addDuty)
```

Leave the `dutyRouter` block unchanged (it keeps its own `authenticate` + `authorize('administrator')`).

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/schedule.routes.ts
git commit -m "feat(api): allow doctors to read schedules"
```

---

### Task 3: `DutyCalendar` component (+ `disabled` on `Select`)

**Files:**
- Modify: `apps/web/src/components/ui/Select.vue`
- Create: `apps/web/src/components/schedule/DutyCalendar.vue`

**Interfaces:**
- Produces: default-exported `DutyCalendar.vue` with props `{ year: number; month: number; days: DayInfo[]; assignmentByDate: Map<string, CalendarAssignment>; conflictsByDate: Map<string, string>; doctors: Doctor[]; mode: 'editable' | 'readonly'; savingDates?: Set<string> }` and emit `select: [date: string, doctorId: number | null]`, where `CalendarAssignment = { doctorId: number; firstName: string; lastName: string; reason: string }`.

- [ ] **Step 1: Add a `disabled` prop to `Select.vue`**

In `apps/web/src/components/ui/Select.vue`, add `disabled?: boolean` to `defineProps` and bind it on the native `<select>`:

```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{
  modelValue?: string | number
  id?: string
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function onChange(event: Event) {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div :class="cn('group relative', props.class)">
    <select
      :id="id"
      :value="modelValue"
      :disabled="disabled"
      class="flex h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pl-3 pr-9 py-2 text-sm text-foreground shadow-sm transition-colors hover:border-input/80 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
      @change="onChange"
    >
      <slot />
    </select>
    <ChevronDown
      class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors duration-150 group-focus-within:text-primary group-hover:text-foreground"
    />
  </div>
</template>
```

- [ ] **Step 2: Create `DutyCalendar.vue`**

Create `apps/web/src/components/schedule/DutyCalendar.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { DayInfo, Doctor } from '@oncall/shared'
import Select from '@/components/ui/Select.vue'

interface CalendarAssignment {
  doctorId: number
  firstName: string
  lastName: string
  reason: string
}

const props = defineProps<{
  year: number
  month: number
  days: DayInfo[]
  assignmentByDate: Map<string, CalendarAssignment>
  conflictsByDate: Map<string, string>
  doctors: Doctor[]
  mode: 'editable' | 'readonly'
  savingDates?: Set<string>
}>()

const emit = defineEmits<{ select: [date: string, doctorId: number | null] }>()

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const doctorsById = computed(() => {
  const m = new Map<number, Doctor>()
  for (const d of props.doctors) m.set(d.id, d)
  return m
})

interface Cell {
  blank: boolean
  date: string | null
  dayNum: number | null
  isWeekend: boolean
  isHoliday: boolean
  assignment?: CalendarAssignment
  conflict?: string
  options: number[]
}

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  const first = props.days[0]
  if (!first) return out
  const firstJs = new Date(`${first.date}T00:00:00`)
  const lead = (firstJs.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, options: [] })
  }
  for (const day of props.days) {
    const assignment = props.assignmentByDate.get(day.date)
    const opts = new Set<number>(day.eligibleDoctorIds)
    if (assignment) opts.add(assignment.doctorId)
    const js = new Date(`${day.date}T00:00:00`)
    out.push({
      blank: false,
      date: day.date,
      dayNum: js.getDate(),
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      assignment,
      conflict: props.conflictsByDate.get(day.date),
      options: [...opts],
    })
  }
  while (out.length % 7 !== 0) {
    out.push({ blank: true, date: null, dayNum: null, isWeekend: false, isHoliday: false, options: [] })
  }
  return out
})

function onSelect(date: string, value: string) {
  emit('select', date, value === '' ? null : Number(value))
}

function doctorLabel(id: number): string {
  const d = doctorsById.value.get(id)
  return d ? `${d.lastName} ${d.firstName.charAt(0)}.` : String(id)
}

function doctorFull(id: number): string {
  const d = doctorsById.value.get(id)
  return d ? `${d.firstName} ${d.lastName}` : String(id)
}
</script>

<template>
  <div class="overflow-x-auto">
    <div class="min-w-[720px]">
      <div class="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
        <div
          v-for="w in WEEKDAYS"
          :key="w"
          class="bg-muted px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {{ w }}
        </div>
      </div>
      <div class="grid grid-cols-7 gap-px rounded-md border border-border bg-border">
        <div
          v-for="(c, idx) in cells"
          :key="idx"
          :class="[
            'min-h-[112px] bg-card p-2',
            c.blank && 'bg-muted/40',
            !c.blank && c.isWeekend && 'bg-muted/30',
            !c.blank && c.isHoliday && 'border border-destructive/40',
            !c.blank && c.conflict && 'border border-destructive/60 bg-destructive/5',
            mode === 'editable' && !c.blank && !c.assignment && c.options.length > 0 && 'border border-dashed border-primary/40',
          ]"
        >
          <template v-if="!c.blank">
            <div class="flex items-start justify-between">
              <span class="text-xs font-semibold text-foreground">{{ c.dayNum }}</span>
              <span class="flex flex-col items-end gap-0.5">
                <span
                  v-if="c.isWeekend"
                  class="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  >WE</span
                >
                <span
                  v-if="c.isHoliday"
                  class="inline-flex rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                  >HOL</span
                >
              </span>
            </div>

            <div class="mt-1.5">
              <template v-if="mode === 'editable' && !c.conflict">
                <Select
                  :model-value="c.assignment ? String(c.assignment.doctorId) : ''"
                  :disabled="savingDates?.has(c.date ?? '')"
                  @update:model-value="onSelect(c.date!, $event)"
                >
                  <option value="" :disabled="!c.assignment">
                    {{ c.assignment ? 'Unassigned' : 'Assign…' }}
                  </option>
                  <option v-for="did in c.options" :key="did" :value="String(did)">
                    {{ doctorLabel(did) }}
                  </option>
                </Select>
              </template>
              <template v-else>
                <span
                  v-if="c.assignment"
                  class="block text-xs font-medium text-foreground"
                  :title="doctorFull(c.assignment.doctorId)"
                  >{{ doctorLabel(c.assignment.doctorId) }}</span
                >
                <span v-else-if="c.conflict" class="block text-[11px] font-medium text-destructive" :title="c.conflict"
                  >Unfillable</span
                >
                <span v-else class="block text-xs italic text-muted-foreground">—</span>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/Select.vue apps/web/src/components/schedule/DutyCalendar.vue
git commit -m "feat(web): DutyCalendar component"
```

---

### Task 4: Rewrite `ScheduleDetailPage` as an editable calendar

**Files:**
- Modify: `apps/web/src/pages/ScheduleDetailPage.vue`

**Interfaces:**
- Consumes: `DutyCalendar` (Task 3); `scheduleService.get/addDuty/reassignDuty/removeDuty/publish/unpublish/remove`; `useAuthStore().isAdmin`.
- Produces: the page renders `<DutyCalendar mode="editable|readonly">` and saves inline on each select change.

- [ ] **Step 1: Replace the whole file**

Overwrite `apps/web/src/pages/ScheduleDetailPage.vue` with:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  CreateDutyRequest,
  DayInfo,
  Doctor,
  ReassignDutyRequest,
  ScheduleDetail,
} from '@oncall/shared'
import { createDutySchema, reassignDutySchema } from '@oncall/shared'
import { useAuthStore } from '@/stores/auth'
import * as scheduleService from '@/services/schedule'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const id = Number(route.params.id)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const detail = ref<ScheduleDetail | null>(null)
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')
const savingDates = ref(new Set<string>())

const schedule = computed(() => detail.value?.schedule ?? null)
const isPublished = computed(() => schedule.value?.status === 'published')
const mode = computed<'editable' | 'readonly'>(() =>
  auth.isAdmin && !isPublished.value ? 'editable' : 'readonly',
)

const dutyIdByDate = computed<Map<string, number>>(() => {
  const m = new Map<string, number>()
  for (const d of detail.value?.duties ?? []) m.set(d.dutyDate, d.id)
  return m
})

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }
  >()
  for (const d of detail.value?.duties ?? []) {
    m.set(d.dutyDate, {
      doctorId: d.doctorId,
      firstName: d.doctorFirstName,
      lastName: d.doctorLastName,
      reason: d.reason,
    })
  }
  return m
})
const conflictsByDate = computed(() => new Map<string, string>())
const days = computed<DayInfo[]>(() => detail.value?.days ?? [])

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
    errorMsg.value = e instanceof Error ? e.message : 'Failed to delete'
  }
}

async function onSelect(date: string, doctorId: number | null) {
  const dutyId = dutyIdByDate.value.get(date) ?? null
  const existing = assignmentByDate.value.get(date)
  errorMsg.value = ''
  if (doctorId === null) {
    if (dutyId === null) return
    if (!confirm(`Remove ${existing?.firstName ?? ''} ${existing?.lastName ?? ''} from ${date}?`)) return
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.removeDuty(dutyId)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to remove'
    } finally {
      savingDates.value.delete(date)
      await load()
    }
    return
  }
  if (dutyId !== null) {
    if (existing && doctorId === existing.doctorId) return
    const r = reassignDutySchema.safeParse({ doctorId } satisfies ReassignDutyRequest)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.reassignDuty(dutyId, r.data)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to reassign'
    } finally {
      savingDates.value.delete(date)
      await load()
    }
    return
  }
  const r = createDutySchema.safeParse({ date, doctorId } satisfies CreateDutyRequest)
  if (!r.success) {
    errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  savingDates.value = new Set(savingDates.value).add(date)
  try {
    await scheduleService.addDuty(id, r.data)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to add'
  } finally {
    savingDates.value.delete(date)
    await load()
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
        <div v-if="auth.isAdmin" class="flex items-center gap-2">
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

      <DutyCalendar
        :year="schedule.year"
        :month="schedule.month"
        :days="days"
        :assignment-by-date="assignmentByDate"
        :conflicts-by-date="conflictsByDate"
        :doctors="doctors"
        :mode="mode"
        :saving-dates="savingDates"
        @select="onSelect"
      />
    </template>
  </div>
</template>
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ScheduleDetailPage.vue
git commit -m "feat(web): schedule detail as editable calendar"
```

---

### Task 5: New read-only preview page + route

**Files:**
- Create: `apps/web/src/pages/SchedulePreviewPage.vue`
- Modify: `apps/web/src/router/index.ts`

**Interfaces:**
- Consumes: `DutyCalendar` (Task 3); `scheduleService.preview/generate`; `createScheduleSchema` for query validation.
- Produces: route `/schedules/preview` (admin-only) reading `?year=&month=`; `SchedulePreviewPage` default export.

- [ ] **Step 1: Create the preview page**

Create `apps/web/src/pages/SchedulePreviewPage.vue`:

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

const year = computed(() => Number(route.query.year))
const month = computed(() => Number(route.query.month))
const parsed = computed(() => createScheduleSchema.safeParse({ year: year.value, month: month.value }))
const valid = computed(() => parsed.value.success)
const monthLabel = computed(() =>
  valid.value ? `${MONTHS[month.value - 1]} ${year.value}` : 'Preview',
)

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }
  >()
  for (const a of result.value?.assignments ?? []) {
    m.set(a.date, {
      doctorId: a.doctorId,
      firstName: a.doctorFirstName,
      lastName: a.doctorLastName,
      reason: a.reason,
    })
  }
  return m
})
const conflictsByDate = computed(() => {
  const m = new Map<string, string>()
  for (const c of result.value?.conflicts ?? []) m.set(c.date, c.detail)
  return m
})
const days = computed<DayInfo[]>(() => result.value?.days ?? [])
const conflictCount = computed(() => result.value?.conflicts.length ?? 0)

async function load() {
  if (!valid.value) {
    errorMsg.value = 'Invalid or missing year/month.'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    result.value = await scheduleService.preview(year.value, month.value)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to preview'
  } finally {
    loading.value = false
  }
}

async function generate() {
  generating.value = true
  errorMsg.value = ''
  try {
    const detail = await scheduleService.generate(year.value, month.value)
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
        <Button :disabled="conflictCount > 0 || generating" @click="generate">
          {{ generating ? 'Generating…' : 'Generate' }}
        </Button>
      </div>
    </div>

    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-else-if="conflictCount > 0" class="text-sm text-destructive">
      {{ conflictCount }} unfillable day(s) — resolve before generating.
    </p>
    <p v-else-if="result" class="text-sm text-muted-foreground">
      {{ result.assignments.length }} day(s) ready. No conflicts.
    </p>

    <DutyCalendar
      v-if="valid"
      :year="year"
      :month="month"
      :days="days"
      :assignment-by-date="assignmentByDate"
      :conflicts-by-date="conflictsByDate"
      :doctors="doctors"
      mode="readonly"
    />
  </div>
</template>
```

- [ ] **Step 2: Register the route**

In `apps/web/src/router/index.ts`, add the preview route inside the `DefaultLayout` children, right before the `schedules` route:

```ts
      {
        path: 'schedules/preview',
        name: 'schedule-preview',
        component: () => import('../pages/SchedulePreviewPage.vue'),
        meta: { roles: ['administrator'] },
      },
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SchedulePreviewPage.vue apps/web/src/router/index.ts
git commit -m "feat(web): schedule preview page"
```

---

### Task 6: Doctor roster page + routes + nav + widened guards

**Files:**
- Create: `apps/web/src/pages/ScheduleRosterPage.vue`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/components/layout/AppHeader.vue`

**Interfaces:**
- Consumes: `scheduleService.list()` (backend returns published-only for doctors); existing `Table*` primitives.
- Produces: route `/roster` (doctor-only); nav link "Duty roster" for non-admins; `/schedules` and `/schedules/:id` widened to both roles.

- [ ] **Step 1: Create the roster page**

Create `apps/web/src/pages/ScheduleRosterPage.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ScheduleSummary } from '@oncall/shared'
import * as scheduleService from '@/services/schedule'
import Button from '@/components/ui/Button.vue'
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

const records = ref<ScheduleSummary[]>([])
const loading = ref(false)
const errorMsg = ref('')

function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    records.value = await scheduleService.list()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load schedules'
  } finally {
    loading.value = false
  }
}

function view(scheduleId: number) {
  router.push(`/schedules/${scheduleId}`)
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-xl font-semibold text-foreground">Duty roster</h1>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="s in records" :key="s.id">
          <TableCell>{{ monthLabel(s.year, s.month) }}</TableCell>
          <TableCell class="text-right">
            <Button size="sm" variant="outline" @click="view(s.id)">View</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <p v-if="!loading && records.length === 0" class="text-sm text-muted-foreground">
      No published schedules yet.
    </p>
  </div>
</template>
```

- [ ] **Step 2: Register the roster route + widen schedule guards**

In `apps/web/src/router/index.ts`:

Add the roster route inside the `DefaultLayout` children (e.g. right after the `home` route):

```ts
      {
        path: 'roster',
        name: 'roster',
        component: () => import('../pages/ScheduleRosterPage.vue'),
        meta: { roles: ['doctor'] },
      },
```

Change the `meta` of the existing `schedules` and `schedule-detail` routes from `roles: ['administrator']` to `roles: ['administrator', 'doctor']`:

```ts
      {
        path: 'schedules',
        name: 'schedules',
        component: () => import('../pages/SchedulesPage.vue'),
        meta: { roles: ['administrator', 'doctor'] },
      },
      {
        path: 'schedules/:id',
        name: 'schedule-detail',
        component: () => import('../pages/ScheduleDetailPage.vue'),
        meta: { roles: ['administrator', 'doctor'] },
      },
```

- [ ] **Step 3: Add the doctor nav link**

In `apps/web/src/components/layout/AppHeader.vue`, inside the `navItems` computed, the existing doctor branch is:

```ts
  if (auth.isAuthenticated && !auth.isAdmin) {
    items.push({ to: '/my-availability', label: 'My availability' })
  }
```

Replace it with:

```ts
  if (auth.isAuthenticated && !auth.isAdmin) {
    items.push({ to: '/roster', label: 'Duty roster' })
    items.push({ to: '/my-availability', label: 'My availability' })
  }
```

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ScheduleRosterPage.vue apps/web/src/router/index.ts apps/web/src/components/layout/AppHeader.vue
git commit -m "feat(web): doctor duty roster and read-only schedule access"
```

---

### Task 7: Simplify the New schedule dialog (Preview navigates)

**Files:**
- Modify: `apps/web/src/pages/SchedulesPage.vue`

**Interfaces:**
- Consumes: `scheduleService.generate`; `useRouter().push('/schedules/preview?year=&month=')`.
- Produces: the dialog's Preview button navigates to the preview page; Generate is always enabled (backend 422 still guards conflicts).

- [ ] **Step 1: Trim the generate state**

In `apps/web/src/pages/SchedulesPage.vue`, replace the `GenState` interface and `emptyGen` with a slimmer shape (no preview fields):

```ts
interface GenState {
  open: boolean
  year: string
  month: string
  errorMsg: string
  generating: boolean
}
const emptyGen = (): GenState => ({
  open: false,
  year: String(new Date().getFullYear()),
  month: String(new Date().getMonth() + 1),
  errorMsg: '',
  generating: false,
})
const gen = ref<GenState>(emptyGen())
```

Delete the entire `runPreview` function. Add a navigation helper and update `runGenerate` to clear `errorMsg` at the start (it already does). Add after `openGenerate`:

```ts
function goPreview() {
  const parsed = createScheduleSchema.safeParse({
    year: Number(gen.value.year),
    month: Number(gen.value.month),
  })
  if (!parsed.success) {
    gen.value.errorMsg = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  gen.value.open = false
  router.push({ path: '/schedules/preview', query: { year: gen.value.year, month: gen.value.month } })
}
```

- [ ] **Step 2: Update the dialog template**

Replace the `<div class="flex items-center gap-2"> ... </div>` action block (Preview + Generate buttons) and the conflict/count `<p>` blocks with:

```html
        <div class="flex items-center gap-2">
          <Button type="button" variant="outline" @click="goPreview">Preview</Button>
          <Button type="submit" :disabled="gen.generating">
            {{ gen.generating ? 'Generating…' : 'Generate' }}
          </Button>
        </div>

        <p v-if="gen.errorMsg" class="text-sm text-destructive" role="alert">{{ gen.errorMsg }}</p>
        <p v-else class="text-xs text-muted-foreground">
          Use Preview to review the proposed calendar before generating.
        </p>
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SchedulesPage.vue
git commit -m "feat(web): preview navigates to preview page"
```

---

### Task 8: Update existing tests for the new UI + RBAC coverage

**Files:**
- Modify: `apps/web/src/__tests__/ScheduleDetailPage.test.ts`
- Modify: `apps/web/src/__tests__/SchedulesPage.test.ts`
- Modify: `apps/api/src/__tests__/schedule.routes.test.ts`

**Why:** Tasks 4 and 7 change these pages' UI, so the existing assertions (`'Edit'`, `'Locked'`, `'+ Add'`, in-dialog preview gating) no longer hold. Task 2 relaxed doctor read access, so the route test that asserts blanket doctor forbiddance must be corrected and given positive coverage. This is maintenance + security coverage, not new feature tests.

- [ ] **Step 1: Rewrite `ScheduleDetailPage.test.ts`**

Overwrite `apps/web/src/__tests__/ScheduleDetailPage.test.ts` with a version that mounts with an authenticated admin pinia where needed and asserts the calendar surface. The detail payload now includes `days`:

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
import { useAuthStore } from '../stores/auth'

function daysFor(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, i) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    const dow = new Date(`${iso}T00:00:00`).getDay()
    return { date: iso, isWeekend: dow === 0 || dow === 6, isHoliday: false, eligibleDoctorIds: [5] }
  })
}

function detail(status: 'draft' | 'published') {
  return {
    schedule: {
      id: 1, year: 2026, month: 9, status, createdBy: 1,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    },
    duties: [
      {
        id: 10, scheduleId: 1, dutyDate: '2026-09-05', doctorId: 5,
        doctorFirstName: 'Jane', doctorLastName: 'Roe',
        isWeekend: false, isHoliday: false, reason: 'score 1',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    days: daysFor(2026, 9),
  }
}

function mountAs(role: 'administrator' | 'doctor' = 'administrator') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = {
    id: 1, role, email: 'a@b.c', username: 'a', firstName: 'A', lastName: 'B', isActive: true,
  } as never
  auth.accessToken = 'x'
  return mount(ScheduleDetailPage, { global: { plugins: [pinia] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  get.mockReset()
  publish.mockReset()
  unpublish.mockReset()
  addDuty.mockReset()
  reassignDuty.mockReset()
  removeDuty.mockReset()
  doctorList.mockResolvedValue([
    { id: 5, userId: 5, email: 'j@b.c', username: 'j', firstName: 'Jane', lastName: 'Roe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('ScheduleDetailPage', () => {
  it('renders the calendar with the assigned doctor (admin, draft, editable)', async () => {
    get.mockResolvedValue(detail('draft'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.text()).toContain('Roe J.')
    expect(wrapper.findAll('select').length).toBeGreaterThan(0)
  })

  it('locks to read-only when published (no selects)', async () => {
    get.mockResolvedValue(detail('published'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.text()).toContain('Published')
    expect(wrapper.text()).toContain('Revert to draft')
    expect(wrapper.findAll('select').length).toBe(0)
  })

  it('doctor sees read-only names (no selects, no publish buttons)', async () => {
    get.mockResolvedValue(detail('published'))
    const wrapper = mountAs('doctor')
    await flushPromises()
    expect(wrapper.text()).toContain('Roe J.')
    expect(wrapper.findAll('select').length).toBe(0)
    expect(wrapper.text()).not.toContain('Revert to draft')
  })

  it('adds a duty via the inline select and reloads', async () => {
    get.mockResolvedValueOnce(detail('draft'))
    addDuty.mockResolvedValue({ id: 99 } as never)
    get.mockResolvedValue(detail('draft'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    const select = wrapper.find('select')
    await select.setValue('5')
    await flushPromises()
    expect(addDuty).toHaveBeenCalledWith(1, { date: '2026-09-01', doctorId: 5 })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Rewrite `SchedulesPage.test.ts`**

Overwrite `apps/web/src/__tests__/SchedulesPage.test.ts`. Preview now navigates (assert the push); Generate is enabled by default:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
  preview: vi.fn(),
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
    id: 1, year: 2026, month: 8, status: 'draft', createdBy: 1,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
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

  it('Preview button navigates to the preview page with year/month', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()
    const previewBtn = Array.from(document.body.querySelectorAll('button'))
      .map((el) => el)
      .find((b) => b.textContent?.includes('Preview'))
    expect(previewBtn).toBeTruthy()
    previewBtn!.click()
    await flushPromises()
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/schedules/preview', query: expect.anything() }),
    )
  })
})
```

- [ ] **Step 3: Correct + extend the backend RBAC route test**

In `apps/api/src/__tests__/schedule.routes.test.ts`, the first test currently asserts that a doctor is forbidden from schedule routes via `POST /schedules/preview` (still true) and that unauthenticated `GET /schedules` is 401 (still true). Update the detail fixture to include `days`, rename the test, and add positive doctor read coverage. Replace the `detail` fixture and the first `it(...)` block:

```ts
const detail = () => ({
  schedule: {
    id: 1, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '',
  },
  duties: [],
  days: [],
})
```

Replace the first test with:

```ts
  it('preview stays admin-only (doctor 403); unauthenticated is 401; doctors can read GET routes', async () => {
    const forbidden = await request(build())
      .post('/schedules/preview')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ year: 2026, month: 9 })
    expect(forbidden.status).toBe(403)

    const unauth = await request(build()).get('/schedules')
    expect(unauth.status).toBe(401)

    list.mockResolvedValue([])
    const doctorList = await request(build())
      .get('/schedules')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(doctorList.status).toBe(200)

    getById.mockResolvedValue(detail())
    const doctorDetail = await request(build())
      .get('/schedules/1')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(doctorDetail.status).toBe(200)
  })
```

- [ ] **Step 4: Run typecheck, lint, and the affected test suites**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @oncall/web test -- ScheduleDetailPage SchedulesPage && pnpm --filter @oncall/api test -- schedule.routes`
Expected: PASS — typecheck/lint clean; the three updated suites pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/__tests__/ScheduleDetailPage.test.ts apps/web/src/__tests__/SchedulesPage.test.ts apps/api/src/__tests__/schedule.routes.test.ts
git commit -m "test: schedule calendar UI and doctor read RBAC"
```
