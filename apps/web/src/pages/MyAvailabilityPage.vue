<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Unavailability } from '@oncall/shared'
import { eachDay, groupConsecutiveDays, monthRange, nextMonthIso } from '@oncall/utils'
import * as unavailabilityService from '@/services/unavailability'
import Button from '@/components/ui/Button.vue'
import CalendarDialog from '@/components/ui/CalendarDialog.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Label from '@/components/ui/Label.vue'
import MonthPicker from '@/components/ui/MonthPicker.vue'
import { useConfirm } from '@/composables/useConfirm'

const records = ref<Unavailability[]>([])
const loading = ref(false)
const errorMsg = ref('')
const saving = ref(false)
const { confirm } = useConfirm()

const filterMonth = ref(nextMonthIso())

interface EditState {
  open: boolean
  id: number | null
  /** Marked days (sorted ISO) that will become exclusions on save. */
  days: string[]
  calendarOpen: boolean
  errorMsg: string
}

const emptyEdit = (): EditState => ({
  open: false,
  id: null,
  days: [],
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

/**
 * Days overlapping the selected month. /unavailability/me has no filters, so
 * the month is applied client side with the same overlap rule the API uses
 * (record end >= month start, record start <= month end).
 */
const visibleDays = computed<DayEntry[]>(() => {
  const { from, to } = monthRange(filterMonth.value)
  const days: DayEntry[] = []
  for (const r of records.value) {
    if (from !== undefined && r.endDate < from) continue
    if (to !== undefined && r.startDate > to) continue
    for (const iso of eachDay(r.startDate, r.endDate)) {
      if (!days.some((d) => d.iso === iso)) days.push({ iso, record: r })
    }
  }
  return days.sort((a, b) => a.iso.localeCompare(b.iso))
})

/** Days covered by other records of this doctor (the edited one excluded). */
const reservedDays = computed(() => {
  const days: string[] = []
  for (const r of records.value) {
    if (r.id === edit.value.id) continue
    days.push(...eachDay(r.startDate, r.endDate))
  }
  return days
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    records.value = await unavailabilityService.listMine()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load availability'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

function openUpdate(x: Unavailability) {
  edit.value = {
    open: true,
    id: x.id,
    days: eachDay(x.startDate, x.endDate),
    calendarOpen: false,
    errorMsg: '',
  }
}

/** Re-fetches own records so dimmed days reflect concurrent changes. */
async function refreshRecords(): Promise<void> {
  records.value = await unavailabilityService.listMine()
}

async function openCalendar() {
  try {
    await refreshRecords()
  } catch (e) {
    edit.value.errorMsg = e instanceof Error ? e.message : 'Failed to load existing exclusions'
    return
  }
  edit.value.calendarOpen = true
}

/**
 * Saving reconciles this doctor's exclusions with the marked days: days
 * already covered by another record are skipped, the rest are grouped into
 * consecutive ranges. Creating stores one record per range; editing repoints
 * the existing record at the first range, creates the rest, and only deletes
 * the record when every marked day is already covered elsewhere.
 */
async function save() {
  const st = edit.value
  st.errorMsg = ''
  if (st.days.length === 0) {
    st.errorMsg = 'Select at least one day'
    return
  }
  saving.value = true
  try {
    // Fresh reserved days: another session may have added exclusions since
    // the calendar was opened; the API would 409 on overlaps otherwise.
    await refreshRecords()
    const reserved = new Set(reservedDays.value)
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
          await unavailabilityService.createMine(range)
        }
      }
    } else {
      for (const range of ranges) await unavailabilityService.createMine(range)
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
      message: `Delete your exclusion (${x.startDate} → ${x.endDate})?`,
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

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-foreground">My availability</h1>
      <Button @click="openCreate">New exclusion</Button>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-month">Month</Label>
        <MonthPicker id="f-month" v-model="filterMonth" placeholder="Any month" class="w-44" />
      </div>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>
    <p v-else-if="visibleDays.length === 0 && !loading" class="text-sm text-muted-foreground">
      No exclusions for the selected month.
    </p>

    <div
      v-if="visibleDays.length > 0"
      class="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-card p-4"
    >
      <Button
        v-for="d in visibleDays"
        :key="d.iso"
        size="sm"
        variant="secondary"
        :class="{ 'line-through opacity-60': d.record.isDisabled }"
        :title="d.record.isDisabled ? 'Disabled — ignored by scheduling' : undefined"
        @click="openUpdate(d.record)"
      >
        {{ d.iso }}
      </Button>
    </div>

    <Dialog v-model:open="edit.open" :title="edit.id === null ? 'New exclusion' : 'Edit exclusion'">
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
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
          <Button type="submit" class="ml-auto" :disabled="saving">Save</Button>
        </div>
      </form>
      <CalendarDialog
        v-model:open="edit.calendarOpen"
        v-model="edit.days"
        :initial-month="nextMonthIso()"
        title="Mark excluded days"
        confirm-text="Confirm days"
        :reserved-days="reservedDays"
      />
    </Dialog>
  </div>
</template>
