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
