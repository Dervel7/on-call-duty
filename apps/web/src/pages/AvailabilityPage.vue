<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import type { Doctor, Unavailability } from '@oncall/shared'
import { eachDay, groupConsecutiveDays } from '@oncall/utils'
import * as unavailabilityService from '@/services/unavailability'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import CalendarDialog from '@/components/ui/CalendarDialog.vue'
import Dialog from '@/components/ui/Dialog.vue'
import DatePicker from '@/components/ui/DatePicker.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import { useConfirm } from '@/composables/useConfirm'

const records = ref<Unavailability[]>([])
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')
const saving = ref(false)
const { confirm } = useConfirm()

const filterDoctorId = ref('')
const filterFrom = ref('')
const filterTo = ref('')

interface EditState {
  open: boolean
  id: number | null
  doctorId: string
  /** Marked days (sorted ISO) that will become exclusions on save. */
  days: string[]
  /** Days already excluded by other records — shown dimmed in the calendar. */
  reservedDays: string[]
  calendarOpen: boolean
  errorMsg: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  doctorId: '',
  days: [],
  reservedDays: [],
  calendarOpen: false,
  errorMsg: '',
})
const edit = ref<EditState>(emptyEdit())

const selectedRanges = computed(() => groupConsecutiveDays(edit.value.days))

function formatRange(r: { startDate: string; endDate: string }): string {
  return r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`
}

/** One entry per excluded day, pointing at the record that covers it. */
interface DayEntry {
  iso: string
  record: Unavailability
}

interface DoctorGroup {
  doctorId: number
  name: string
  days: DayEntry[]
}

const expandedDoctorId = ref<number | null>(null)

function toggleDoctor(doctorId: number): void {
  expandedDoctorId.value = expandedDoctorId.value === doctorId ? null : doctorId
}

/** Groups the loaded records into one line per doctor with their excluded days. */
const grouped = computed<DoctorGroup[]>(() => {
  const byDoctor = new Map<number, DoctorGroup>()
  for (const r of records.value) {
    let g = byDoctor.get(r.doctorId)
    if (!g) {
      g = { doctorId: r.doctorId, name: `${r.doctorFirstName} ${r.doctorLastName}`, days: [] }
      byDoctor.set(r.doctorId, g)
    }
    for (const iso of eachDay(r.startDate, r.endDate)) {
      if (!g.days.some((d) => d.iso === iso)) g.days.push({ iso, record: r })
    }
  }
  for (const g of byDoctor.values()) g.days.sort((a, b) => a.iso.localeCompare(b.iso))
  return [...byDoctor.values()]
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const query = {
      doctorId: filterDoctorId.value ? Number(filterDoctorId.value) : undefined,
      from: filterFrom.value || undefined,
      to: filterTo.value || undefined,
    }
    records.value = await unavailabilityService.listAll(query)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load availability'
  } finally {
    loading.value = false
  }
}

/** Days covered by the doctor's other records (the edited one excluded). */
async function reservedDaysFor(doctorId: number, exceptId: number | null): Promise<string[]> {
  const existing = await unavailabilityService.listAll({ doctorId })
  const days: string[] = []
  for (const r of existing) {
    if (r.id === exceptId) continue
    days.push(...eachDay(r.startDate, r.endDate))
  }
  return days
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

async function openUpdate(x: Unavailability) {
  let reservedDays: string[]
  try {
    reservedDays = await reservedDaysFor(x.doctorId, x.id)
  } catch {
    // The calendar just loses the dimmed hints; save() re-checks overlaps.
    reservedDays = []
  }
  edit.value = {
    open: true,
    id: x.id,
    doctorId: String(x.doctorId),
    days: eachDay(x.startDate, x.endDate),
    reservedDays,
    calendarOpen: false,
    errorMsg: '',
  }
}

async function openCalendar() {
  if (!edit.value.doctorId) {
    edit.value.errorMsg = 'Select a doctor first'
    return
  }
  try {
    edit.value.reservedDays = await reservedDaysFor(Number(edit.value.doctorId), edit.value.id)
  } catch (e) {
    edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to load existing exclusions'
    return
  }
  edit.value.errorMsg = ''
  edit.value.calendarOpen = true
}

/**
 * Saving reconciles the doctor's exclusions with the marked days: days already
 * covered by another record are skipped, the rest are grouped into consecutive
 * ranges. Creating stores one record per range; editing repoints the existing
 * record at the first range, creates the rest, and only deletes the record
 * when every marked day is already covered elsewhere.
 */
async function save() {
  const st = edit.value
  st.errorMsg = ''
  if (!st.doctorId) {
    st.errorMsg = 'Select a doctor'
    return
  }
  if (st.days.length === 0) {
    st.errorMsg = 'Select at least one day'
    return
  }
  const doctorId = Number(st.doctorId)
  saving.value = true
  try {
    const reserved = new Set(await reservedDaysFor(doctorId, st.id))
    const ranges = groupConsecutiveDays(st.days.filter((d) => !reserved.has(d)))
    if (st.id !== null) {
      if (ranges.length === 0) {
        // Every marked day is already covered by another record.
        await unavailabilityService.remove(st.id)
      } else {
        // The edited record becomes the first range (the API excludes it from
        // its own overlap check); any further ranges are created after it.
        await unavailabilityService.update(st.id, ranges[0]!)
        for (const range of ranges.slice(1)) {
          await unavailabilityService.createForDoctor(doctorId, range)
        }
      }
    } else {
      for (const range of ranges) await unavailabilityService.createForDoctor(doctorId, range)
    }
  } catch (e) {
    st.errorMsg = e instanceof Error ? e.message : 'Failed to save availability'
    return
  } finally {
    saving.value = false
  }
  edit.value = emptyEdit()
  await load()
}

/** Deletes the record currently open in the edit dialog. */
async function removeCurrent() {
  const x = records.value.find((r) => r.id === edit.value.id)
  if (!x) return
  if (
    !(await confirm({
      title: 'Delete record',
      message: `Delete ${x.doctorFirstName} ${x.doctorLastName}'s exclusion (${x.startDate} → ${x.endDate})?`,
      confirmText: 'Delete',
    }))
  )
    return
  try {
    await unavailabilityService.remove(x.id)
  } catch (e) {
    edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to delete availability'
    return
  }
  edit.value = emptyEdit()
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
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">Availability</h1>
      <Button @click="openCreate">New exclusion</Button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-doctor">Doctor</Label>
        <Select id="f-doctor" v-model="filterDoctorId">
          <option value="">All</option>
          <option v-for="d in doctors" :key="d.id" :value="d.id">
            {{ d.firstName }} {{ d.lastName }}
          </option>
        </Select>
      </div>
      <div class="flex flex-col gap-1">
        <Label for="f-from">From</Label>
        <DatePicker id="f-from" v-model="filterFrom" placeholder="Any date" class="w-44" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="f-to">To</Label>
        <DatePicker id="f-to" v-model="filterTo" placeholder="Any date" class="w-44" />
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <ul v-if="grouped.length > 0" class="overflow-hidden rounded-lg border border-border/70">
      <li v-for="g in grouped" :key="g.doctorId" class="border-b border-border/70 last:border-b-0">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          :aria-expanded="expandedDoctorId === g.doctorId"
          @click="toggleDoctor(g.doctorId)"
        >
          <span class="font-medium text-foreground">{{ g.name }}</span>
          <span class="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {{ g.days.length }} day(s)
            <ChevronDown
              class="size-4 transition-transform"
              :class="{ 'rotate-180': expandedDoctorId === g.doctorId }"
            />
          </span>
        </button>
        <div v-if="expandedDoctorId === g.doctorId" class="flex flex-wrap gap-2 px-4 pb-4">
          <Button
            v-for="d in g.days"
            :key="d.iso"
            size="sm"
            variant="secondary"
            @click="openUpdate(d.record)"
          >
            {{ d.iso }}
          </Button>
        </div>
      </li>
    </ul>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New exclusion' : 'Edit exclusion'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-doctor">Doctor</Label>
          <Select id="e-doctor" v-model="edit.doctorId">
            <option value="" disabled>Select a doctor</option>
            <option v-for="d in doctors" :key="d.id" :value="d.id">
              {{ d.firstName }} {{ d.lastName }}
            </option>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-days">Excluded days</Label>
          <Button id="e-days" type="button" variant="outline" @click="openCalendar">
            Select days…
          </Button>
          <p v-if="edit.days.length > 0" class="text-sm text-muted-foreground">
            {{ edit.days.length }} day(s): {{ selectedRanges.map(formatRange).join(', ') }}
          </p>
        </div>
        <p v-if="edit.errorMsg" class="text-sm text-destructive" role="alert">{{ edit.errorMsg }}</p>
        <div class="flex items-center justify-between gap-2">
          <Button
            v-if="edit.id !== null"
            type="button"
            variant="destructive"
            :disabled="saving"
            @click="removeCurrent"
          >
            Delete
          </Button>
          <Button type="submit" :disabled="saving">Save</Button>
        </div>
      </form>
      <CalendarDialog
        v-model:open="edit.calendarOpen"
        v-model="edit.days"
        title="Mark excluded days"
        confirm-text="Confirm days"
        :reserved-days="edit.reservedDays"
      />
    </Dialog>
  </div>
</template>
