<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarClock } from 'lucide-vue-next'
import type { Unavailability } from '@oncall/shared'
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
import Button from '@/components/ui/Button.vue'
import CalendarDialog from '@/components/ui/CalendarDialog.vue'
import Dialog from '@/components/ui/Dialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Label from '@/components/ui/Label.vue'
import MonthPicker from '@/components/ui/MonthPicker.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Spinner from '@/components/ui/Spinner.vue'
import { useConfirm } from '@/composables/useConfirm'

const records = ref<Unavailability[]>([])
const loading = ref(false)
const errorMsg = ref('')
const saving = ref(false)
const { confirm } = useConfirm()
const { t } = useI18n()

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

/**
 * Days overlapping the selected month. /unavailability/me has no filters, so
 * the month is applied client side with the same overlap rule the API uses
 * (record end >= month start, record start <= month end).
 */
const visibleDays = computed(() => {
  const { from, to } = monthRange(filterMonth.value)
  return expandDays(records.value, from, to)
})

/** Days covered by other records of this doctor (the edited one excluded). */
const reservedDays = computed(() => coveredDays(records.value, edit.value.id))

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    records.value = await unavailabilityService.listMine()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('availability.loadFailed')
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
    edit.value.errorMsg = e instanceof Error ? e.message : t('availability.loadExclusionsFailed')
    return
  }
  edit.value.calendarOpen = true
}

/**
 * Saving reconciles this doctor's exclusions with the marked days: days
 * already covered by another record are skipped, the rest are grouped into
 * consecutive ranges. Creating stores one record per range. Editing keeps the
 * record only on its original days still marked: none kept deletes it, one
 * range updates it, several ranges split it atomically (split-off parts keep
 * its disabled flag). Newly marked days always become new records.
 */
async function save() {
  const st = edit.value
  st.errorMsg = ''
  if (st.days.length === 0) {
    st.errorMsg = t('availability.selectAtLeastOneDay')
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
        const original = records.value.find((r) => r.id === st.id)
        const originDays = new Set(original ? eachDay(original.startDate, original.endDate) : [])
        const kept = st.days.filter((d) => !reserved.has(d) && originDays.has(d))
        const keptRanges = groupConsecutiveDays(kept)
        if (keptRanges.length === 0) await unavailabilityService.remove(st.id)
        else if (keptRanges.length === 1) await unavailabilityService.update(st.id, keptRanges[0]!)
        else await unavailabilityService.split(st.id, { segments: keptRanges })
        const added = st.days.filter((d) => !reserved.has(d) && !originDays.has(d))
        for (const range of groupConsecutiveDays(added)) {
          await unavailabilityService.createMine(range)
        }
      }
    } else {
      for (const range of ranges) await unavailabilityService.createMine(range)
    }
  } catch (e) {
    st.errorMsg = e instanceof Error ? e.message : t('availability.saveFailed')
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
      title: t('availability.deleteTitle'),
      message: t('availability.deleteMyMessage', { start: x.startDate, end: x.endDate }),
      confirmText: t('common.delete'),
    }))
  )
    return
  try {
    await unavailabilityService.remove(x.id)
  } catch (e) {
    edit.value.errorMsg = e instanceof Error ? e.message : t('availability.deleteFailed')
    return
  }
  edit.value = emptyEdit()
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="CalendarClock" :title="t('nav.myAvailability')" :subtitle="t('availability.mySubtitle')">
      <template #actions>
        <Button @click="openCreate">{{ t('availability.newExclusion') }}</Button>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-end gap-3">
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
      v-else-if="visibleDays.length === 0 && !loading"
      :icon="CalendarClock"
      :title="t('availability.emptyMonth')"
    />

    <div
      v-if="visibleDays.length > 0"
      class="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-card p-4"
    >
      <Button
        v-for="d in visibleDays"
        :key="d.iso"
        size="sm"
        class="rounded-md bg-muted/70 px-2 py-0.5 font-mono text-xs"
        variant="secondary"
        :class="{ 'line-through opacity-60': d.record.isDisabled }"
        :title="d.record.isDisabled ? t('availability.disabledTitle') : undefined"
        @click="openUpdate(d.record)"
      >
        {{ d.iso }}
      </Button>
    </div>

    <Dialog
      v-model:open="edit.open"
      :title="edit.id === null ? t('availability.newExclusion') : t('availability.editExclusion')"
    >
      <form class="flex flex-col gap-3" novalidate @submit.prevent="save">
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
            :disabled="saving"
            @click="removeCurrent"
          >
            {{ t('common.delete') }}
          </Button>
          <Button type="submit" class="ml-auto" :disabled="saving">{{ t('common.save') }}</Button>
        </div>
      </form>
      <CalendarDialog
        v-model:open="edit.calendarOpen"
        v-model="edit.days"
        :initial-month="nextMonthIso()"
        :title="t('availability.calendarTitle')"
        :confirm-text="t('availability.confirmDays')"
        :reserved-days="reservedDays"
      />
    </Dialog>
  </div>
</template>
