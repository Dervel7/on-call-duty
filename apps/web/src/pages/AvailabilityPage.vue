<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarOff, ChevronDown, Pencil } from 'lucide-vue-next'
import type { Doctor, Unavailability } from '@oncall/shared'
import {
  coveredDays,
  eachDay,
  expandDays,
  formatRange,
  groupConsecutiveDays,
  monthRange,
  nextMonthIso,
} from '@oncall/utils'
import * as unavailabilityService from '@/services/unavailability'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import CalendarDialog from '@/components/ui/CalendarDialog.vue'
import Dialog from '@/components/ui/Dialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Label from '@/components/ui/Label.vue'
import MonthPicker from '@/components/ui/MonthPicker.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Select from '@/components/ui/Select.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { useConfirm } from '@/composables/useConfirm'
import { useLatestRequest } from '@/composables/useLatestRequest'

const records = ref<Unavailability[]>([])
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')
/** Set while a dialog request (open/save/delete/toggle) runs; blocks re-entry. */
const busy = ref(false)
const { confirm } = useConfirm()
const { t } = useI18n()

const filterDoctorId = ref('')


const filterMonth = ref(nextMonthIso())

interface EditState {
  open: boolean
  id: number | null
  doctorId: string
  /** Marked days (sorted ISO) that will become exclusions on save. */
  days: string[]
  /** When editing: the day chip that opened the dialog — the only removable day. */
  chipDay: string | null
  /** When editing: every day covered by the record backing the dialog. */
  originDays: string[]
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
  chipDay: null,
  originDays: [],
  reservedDays: [],
  calendarOpen: false,
  errorMsg: '',
})
const edit = ref<EditState>(emptyEdit())

const selectedRanges = computed(() => groupConsecutiveDays(edit.value.days))

/** Other records' days plus the edited record's own days except the chip day. */
const calendarReservedDays = computed(() => [
  ...edit.value.reservedDays,
  ...edit.value.originDays.filter((d) => d !== edit.value.chipDay),
])

interface DoctorGroup {
  doctorId: number
  name: string
  /** One entry per excluded day, pointing at the record that covers it. */
  days: Array<{ iso: string; record: Unavailability }>
}

const expandedDoctorId = ref<number | null>(null)

function toggleDoctor(doctorId: number): void {
  expandedDoctorId.value = expandedDoctorId.value === doctorId ? null : doctorId
}

/** Groups the loaded records into one line per doctor with their excluded days. */
const grouped = computed<DoctorGroup[]>(() => {
  const { from, to } = monthRange(filterMonth.value)
  const byDoctor = new Map<number, { name: string; records: Unavailability[] }>()
  for (const r of records.value) {
    const g = byDoctor.get(r.doctorId)
    if (g) g.records.push(r)
    else byDoctor.set(r.doctorId, { name: `${r.doctorFirstName} ${r.doctorLastName}`, records: [r] })
  }
  return [...byDoctor].map(([doctorId, g]) => ({
    doctorId,
    name: g.name,
    days: expandDays(g.records, from, to),
  }))
})

const latest = useLatestRequest()

async function load() {
  const isCurrent = latest.start()
  loading.value = true
  errorMsg.value = ''
  try {
    const query = {
      doctorId: filterDoctorId.value ? Number(filterDoctorId.value) : undefined,
      ...monthRange(filterMonth.value),
    }
    const res = await unavailabilityService.listAll(query)
    if (!isCurrent()) return
    records.value = res
  } catch (e) {
    if (!isCurrent()) return
    errorMsg.value = e instanceof Error ? e.message : t('availability.loadFailed')
  } finally {
    if (isCurrent()) loading.value = false
  }
}

// Filters apply immediately — no Apply step.
watch([filterDoctorId, filterMonth], () => {
  void load()
})

/** Days covered by the doctor's other records (the edited one excluded). */
async function reservedDaysFor(doctorId: number, exceptId: number | null): Promise<string[]> {
  return coveredDays(await unavailabilityService.listAll({ doctorId }), exceptId)
}

function openCreate() {
  edit.value = { ...emptyEdit(), open: true }
}

/** Opens the dialog scoped to one day: the chip's day, backed by its record. */
async function openUpdate(iso: string, x: Unavailability) {
  if (busy.value) return
  busy.value = true
  let reservedDays: string[]
  try {
    reservedDays = await reservedDaysFor(x.doctorId, x.id)
  } catch {
    // The calendar just loses the dimmed hints; save() re-checks overlaps.
    reservedDays = []
  } finally {
    busy.value = false
  }
  edit.value = {
    open: true,
    id: x.id,
    doctorId: String(x.doctorId),
    days: [iso],
    chipDay: iso,
    originDays: eachDay(x.startDate, x.endDate),
    reservedDays,
    calendarOpen: false,
    errorMsg: '',
  }
}

async function openCalendar() {
  if (!edit.value.doctorId) {
    edit.value.errorMsg = t('availability.selectDoctorFirst')
    return
  }
  try {
    edit.value.reservedDays = await reservedDaysFor(Number(edit.value.doctorId), edit.value.id)
  } catch (e) {
    edit.value.errorMsg = e instanceof Error ? e.message : t('availability.loadExclusionsFailed')
    return
  }
  edit.value.errorMsg = ''
  edit.value.calendarOpen = true
}

/**
 * Saving is scoped to the marked days. Creating groups the marked days into
 * consecutive ranges, one record per range. Editing opens from a single day
 * chip: only that chip's day can be removed there (unmarking it shrinks or
 * splits the record in one atomic request, or deletes it when no day remains;
 * split-off segments keep the record's disabled flag), the record's other
 * days are never touched, and newly marked days become additional records.
 *
 * If a request fails after an earlier one was saved, the dialog's data is
 * stale: the dialog closes, the list reloads and the error names the days
 * that still have to be entered.
 */
async function save() {
  if (busy.value) return
  const st = edit.value
  st.errorMsg = ''
  if (!st.doctorId) {
    st.errorMsg = t('availability.selectDoctor')
    return
  }
  if (st.id === null && st.days.length === 0) {
    st.errorMsg = t('availability.selectAtLeastOneDay')
    return
  }
  const doctorId = Number(st.doctorId)
  busy.value = true
  let wrote = false
  let unsaved: { startDate: string; endDate: string }[] = []
  try {
    const reserved = new Set(await reservedDaysFor(doctorId, st.id))
    let ranges: { startDate: string; endDate: string }[]
    if (st.id !== null) {
      const chipRemoved = st.chipDay !== null && !st.days.includes(st.chipDay)
      const keptDays = chipRemoved
        ? st.originDays.filter((d) => d !== st.chipDay)
        : st.originDays
      if (keptDays.length === 0) {
        // The record's only day was unmarked.
        await unavailabilityService.remove(st.id)
        wrote = true
      } else if (chipRemoved) {
        // The record keeps the rest of its days, split around the removed day.
        await unavailabilityService.split(st.id, { segments: groupConsecutiveDays(keptDays) })
        wrote = true
      }
      ranges = groupConsecutiveDays(
        st.days.filter((d) => !st.originDays.includes(d) && !reserved.has(d)),
      )
    } else {
      ranges = groupConsecutiveDays(st.days.filter((d) => !reserved.has(d)))
    }
    unsaved = [...ranges]
    for (const range of ranges) {
      await unavailabilityService.createForDoctor(doctorId, range)
      unsaved.shift()
      wrote = true
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : t('availability.saveFailed')
    if (!wrote) {
      st.errorMsg = message
      return
    }
    edit.value = emptyEdit()
    await load()
    errorMsg.value =
      unsaved.length > 0
        ? t('availability.unsavedDays', { message, ranges: unsaved.map(formatRange).join(', ') })
        : message
    return
  } finally {
    busy.value = false
  }
  edit.value = emptyEdit()
  await load()
}

/** Deletes the record currently open in the edit dialog. */
async function removeCurrent() {
  if (busy.value) return
  const x = records.value.find((r) => r.id === edit.value.id)
  if (!x) return
  if (
    !(await confirm({
      title: t('availability.deleteTitle'),
      message: t('availability.deleteMessage', {
        name: `${x.doctorFirstName} ${x.doctorLastName}`,
        start: x.startDate,
        end: x.endDate,
      }),
      confirmText: t('common.delete'),
    }))
  )
    return
  busy.value = true
  try {
    await unavailabilityService.remove(x.id)
  } catch (e) {
    edit.value.errorMsg = e instanceof Error ? e.message : t('availability.deleteFailed')
    return
  } finally {
    busy.value = false
  }
  edit.value = emptyEdit()
  await load()
}

/**
 * Disables/re-enables the single day the dialog was opened from. A multi-day
 * record is split in one atomic request: the record keeps only this day with
 * the flag flipped, and its other days keep the previous flag in new records.
 */
async function toggleDisabledCurrent() {
  if (busy.value) return
  const x = records.value.find((r) => r.id === edit.value.id)
  if (!x) return
  const day = edit.value.chipDay ?? x.startDate
  busy.value = true
  try {
    const others = eachDay(x.startDate, x.endDate).filter((d) => d !== day)
    if (others.length > 0) {
      await unavailabilityService.split(x.id, {
        segments: [{ startDate: day, endDate: day }, ...groupConsecutiveDays(others)],
        isDisabled: !x.isDisabled,
      })
    } else {
      await unavailabilityService.setDisabled(x.id, !x.isDisabled)
    }
  } catch (e) {
    edit.value.errorMsg = e instanceof Error ? e.message : t('availability.updateFailed')
    return
  } finally {
    busy.value = false
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
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="CalendarOff" :title="t('nav.availability')" :subtitle="t('availability.subtitle')">
      <template #actions>
        <Button @click="openCreate">{{ t('availability.newExclusion') }}</Button>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-doctor">{{ t('availability.doctor') }}</Label>
        <Select id="f-doctor" v-model="filterDoctorId">
          <option value="">{{ t('availability.allDoctors') }}</option>
          <option v-for="d in doctors" :key="d.id" :value="d.id">
            {{ d.firstName }} {{ d.lastName }}
          </option>
        </Select>
      </div>
      <div class="flex flex-col gap-1">
        <Label for="f-month">{{ t('common.month') }}</Label>
        <MonthPicker id="f-month" v-model="filterMonth" :placeholder="t('availability.anyMonth')" class="w-44" />
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner :size="16" />
      {{ t('common.loading') }}
    </div>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>
    <EmptyState
      v-else-if="grouped.length === 0 && !loading"
      :icon="CalendarOff"
      :title="t('availability.empty')"
    />

    <ul v-if="grouped.length > 0" class="overflow-hidden rounded-lg border border-border/70">
      <li v-for="g in grouped" :key="g.doctorId" class="border-b border-border/70 last:border-b-0">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          :aria-expanded="expandedDoctorId === g.doctorId"
          @click="toggleDoctor(g.doctorId)"
        >
          <span class="font-display font-semibold text-foreground">{{ g.name }}</span>
          <span class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
            {{ t('availability.dayCount', g.days.length) }}
            <template v-if="g.days.some((d) => d.record.isDisabled)"
              >· {{ t('availability.disabledCount', g.days.filter((d) => d.record.isDisabled).length) }}</template
            >
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
            class="rounded-md bg-muted/70 px-2 py-0.5 font-mono text-xs"
            variant="outline"
            :class="{ 'line-through opacity-60': d.record.isDisabled }"
            :title="d.record.isDisabled ? t('availability.disabledTitle') : undefined"
            @click="openUpdate(d.iso, d.record)"
          >
            <Pencil class="size-3 text-muted-foreground" aria-hidden="true" />
            {{ d.iso }}
          </Button>
        </div>
      </li>
    </ul>

    <Dialog
      v-model:open="edit.open"
      :title="edit.id === null ? t('availability.newExclusion') : t('availability.editExclusion')"
    >
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
        <div class="flex flex-col gap-1">
          <Label for="e-doctor">{{ t('availability.doctor') }}</Label>
          <Select id="e-doctor" v-model="edit.doctorId" :disabled="edit.id !== null">
            <option value="" disabled>{{ t('availability.selectDoctor') }}</option>
            <option v-for="d in doctors" :key="d.id" :value="d.id">
              {{ d.firstName }} {{ d.lastName }}
            </option>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="e-days">{{ t('availability.excludedDays') }}</Label>
          <Button id="e-days" type="button" variant="outline" @click="openCalendar">
            {{ t('availability.selectDays') }}
          </Button>
          <p v-if="edit.days.length > 0" class="text-sm text-muted-foreground">
            {{
              t(
                'availability.selectedDays',
                { n: edit.days.length, ranges: selectedRanges.map(formatRange).join(', ') },
                edit.days.length,
              )
            }}
          </p>
        </div>
        <p v-if="edit.errorMsg" class="text-sm text-destructive" role="alert">{{ edit.errorMsg }}</p>
        <div class="flex items-center justify-between gap-2">
          <Button
            v-if="edit.id !== null"
            type="button"
            variant="destructive"
            :disabled="busy"
            @click="removeCurrent"
          >
            {{ t('common.delete') }}
          </Button>
          <Button
            v-if="edit.id !== null"
            type="button"
            variant="secondary"
            :disabled="busy"
            @click="toggleDisabledCurrent"
          >
            {{ records.find((r) => r.id === edit.id)?.isDisabled ? t('common.enable') : t('common.disable') }}
          </Button>
          <Button type="submit" class="ml-auto" :disabled="busy">{{ t('common.save') }}</Button>
        </div>
      </form>
      <CalendarDialog
        v-model:open="edit.calendarOpen"
        v-model="edit.days"
        :initial-month="nextMonthIso()"
        :title="t('availability.calendarTitle')"
        :confirm-text="t('availability.confirmDays')"
        :reserved-days="calendarReservedDays"
        :allow-empty="edit.id !== null"
      />
    </Dialog>
  </div>
</template>
