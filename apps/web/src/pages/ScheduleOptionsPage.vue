<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { ScheduleOption, ScheduleOptionsResult } from '@oncall/shared'
import { createScheduleSchema } from '@oncall/shared'
import { ApiError } from '@/lib/http'
import { monthLabel as formatMonth } from '@oncall/utils'
import * as scheduleService from '@/services/schedule'
import { explainConflict } from '@/lib/conflict-text'
import { useConfirm } from '@/composables/useConfirm'
import { useEstimatedProgress } from '@/composables/useEstimatedProgress'
import { useIntlLocale } from '@/composables/useIntlLocale'
import { useLatestRequest } from '@/composables/useLatestRequest'
import { groupByDate } from '@/lib/calendar'
import Button from '@/components/ui/Button.vue'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'
import Spinner from '@/components/ui/Spinner.vue'

// ~25 s typical primary solve (budget SOLVER_BUDGET_MS = 45 s).
const ESTIMATED_OPTIONS_MS = 25_000
// Mirrors ALTERNATIVE_BUDGET_MS (5 s) of the API.
const ESTIMATED_ALTERNATIVE_MS = 5_000

const route = useRoute()
const router = useRouter()
const intlLocale = useIntlLocale()
const { t } = useI18n()
const { confirm } = useConfirm()
const { progress, start, finish, stop } = useEstimatedProgress(ESTIMATED_OPTIONS_MS)
const alt = useEstimatedProgress(ESTIMATED_ALTERNATIVE_MS)

const result = ref<ScheduleOptionsResult | null>(null)
const selected = ref(0)
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
// 1-based slot of the alternative being computed, the one that came back empty, and the last failure.
const altLoading = ref<number | null>(null)
const noOtherFrom = ref<number | null>(null)
const altError = ref<{ slot: number; message: string } | null>(null)

const year = computed(() => Number(route.query.year))
const month = computed(() => Number(route.query.month))
const parsed = computed(() => createScheduleSchema.safeParse({ year: year.value, month: month.value }))
const valid = computed(() => parsed.value.success)
const monthLabel = computed(() =>
  valid.value ? formatMonth(year.value, month.value, intlLocale.value) : t('scheduleOptions.title'),
)

const options = computed<ScheduleOption[]>(() => result.value?.options ?? [])
const current = computed<ScheduleOption | undefined>(() => options.value[selected.value])
const slots = computed(() => {
  const count = result.value?.moreAvailable ? result.value.maxOptions : 1
  return Array.from({ length: count }, (_, i) => i + 1)
})
const showFewerOptions = computed(() => !!result.value && (!result.value.moreAvailable || noOtherFrom.value !== null))

function tabDisabled(slot: number): boolean {
  if (options.value[slot - 1]) return false
  if (altLoading.value !== null) return true
  if (noOtherFrom.value !== null && slot >= noOtherFrom.value) return true
  return slot > options.value.length + 1
}

function tabHint(slot: number): string {
  const o = options.value[slot - 1]
  if (o) return o.index === 1 ? t('scheduleOptions.firstChoice') : t('scheduleOptions.daysDiffer', { n: o.changedDates.length })
  return noOtherFrom.value === slot ? t('scheduleOptions.noOther') : t('scheduleOptions.notComputed')
}
// All options share the coverage optimum, so a short day is short in every option, and the
// API rejects any plan below a day's minimum.
const understaffed = computed(() => (current.value?.conflicts.length ?? 0) > 0)
const conflictsByDate = computed(
  () => new Map((current.value?.conflicts ?? []).map((c): [string, string] => [c.date, explainConflict(c, t)])),
)

function letterOf(slot: number): string {
  return String.fromCharCode(64 + slot)
}

function letter(option: ScheduleOption): string {
  return letterOf(option.index)
}

const assignmentByDate = computed(() =>
  groupByDate(current.value?.assignments ?? [], (a) => [
    a.date,
    { doctorId: a.doctorId, firstName: a.doctorFirstName, lastName: a.doctorLastName },
  ]),
)

function focusTab(n: number) {
  const count = slots.value.length
  const target = ((n % count) + count) % count
  void nextTick(() => document.getElementById(`option-tab-${target + 1}`)?.focus())
}

const latest = useLatestRequest()
const latestAlt = useLatestRequest()

async function selectTab(i: number) {
  selected.value = i
  const slot = i + 1
  if (options.value[i] || altLoading.value !== null || tabDisabled(slot)) return
  await loadAlternative(slot)
}

async function loadAlternative(slot: number) {
  if (!result.value) return
  const isCurrent = latestAlt.start()
  altLoading.value = slot
  altError.value = null
  alt.start()
  try {
    const res = await scheduleService.alternative(year.value, month.value, slot)
    if (!isCurrent()) return
    await alt.finish()
    if (!isCurrent()) return
    if (res.option) {
      result.value.options.push(res.option)
    } else {
      noOtherFrom.value = slot
    }
  } catch (e) {
    if (!isCurrent()) return
    if (e instanceof ApiError && e.status === 404) {
      void load()
      return
    }
    altError.value = { slot, message: e instanceof Error ? e.message : t('scheduleOptions.loadFailed') }
  } finally {
    if (isCurrent()) {
      alt.stop()
      altLoading.value = null
    }
  }
}

async function load() {
  if (!valid.value) {
    errorMsg.value = ''
    return
  }
  const isCurrent = latest.start()
  loading.value = true
  errorMsg.value = ''
  result.value = null
  selected.value = 0
  noOtherFrom.value = null
  altError.value = null
  altLoading.value = null
  latestAlt.start()
  alt.stop()
  start()
  try {
    const res = await scheduleService.options(year.value, month.value)
    if (!isCurrent()) return
    await finish()
    if (!isCurrent()) return
    result.value = res
  } catch (e) {
    if (!isCurrent()) return
    errorMsg.value = e instanceof Error ? e.message : t('scheduleOptions.loadFailed')
  } finally {
    if (isCurrent()) {
      stop()
      loading.value = false
    }
  }
}

async function chooseOption() {
  const option = current.value
  if (!option) return
  const plan = letter(option)
  if (
    !(await confirm({
      title: t('scheduleOptions.useTitle', { plan }),
      message: t('scheduleOptions.useMessage', { plan, month: monthLabel.value }),
      confirmText: t('scheduleOptions.use', { plan }),
      variant: 'primary',
    }))
  )
    return
  saving.value = true
  errorMsg.value = ''
  try {
    const detail = await scheduleService.generate(
      year.value,
      month.value,
      option.assignments.map((a) => ({ date: a.date, doctorId: a.doctorId, reason: a.reason })),
    )
    await router.replace(`/schedules/${detail.schedule.id}`)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('schedules.generateFailed')
  } finally {
    saving.value = false
  }
}

onMounted(load)
watch([year, month], load)
</script>

<template>
  <div class="flex flex-col gap-6 animate-rise">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-foreground">{{ monthLabel }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('scheduleOptions.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" @click="router.push('/schedules')">
          {{ t('scheduleOptions.backToSchedules') }}
        </Button>
        <Button v-if="current" :disabled="saving || understaffed" @click="chooseOption">
          {{ saving ? t('scheduleOptions.saving') : t('scheduleOptions.use', { plan: letter(current) }) }}
        </Button>
      </div>
    </div>

    <div
      v-if="errorMsg"
      role="alert"
      class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {{ errorMsg }}
    </div>

    <div
      v-if="!valid"
      class="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6"
    >
      <p class="text-sm font-medium text-foreground">{{ t('scheduleOptions.invalidMonth') }}</p>
      <p class="text-sm text-muted-foreground">{{ t('scheduleOptions.invalidMonthHint') }}</p>
      <Button variant="outline" size="sm" @click="router.push('/schedules')">
        {{ t('scheduleOptions.backToSchedules') }}
      </Button>
    </div>

    <div v-else-if="loading" class="flex flex-col items-center gap-2 py-2" role="status">
      <Spinner :size="28" class="text-primary" />
      <div class="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin="0"
        aria-valuemax="100" :aria-valuenow="progress" :aria-label="t('schedules.generating')">
        <div class="h-full rounded-full bg-primary transition-[width] duration-200"
          :style="{ width: `${progress}%` }" />
      </div>
      <span class="font-mono text-xs text-muted-foreground">{{ progress }}%</span>
    </div>

    <template v-else-if="result">
      <div role="tablist" :aria-label="t('scheduleOptions.title')" class="flex flex-wrap gap-2">
        <button
          v-for="(slot, i) in slots"
          :id="`option-tab-${slot}`"
          :key="slot"
          type="button"
          role="tab"
          :aria-selected="i === selected"
          :disabled="tabDisabled(slot)"
          aria-controls="option-panel"
          :class="[
            'flex flex-col items-start rounded-lg border px-4 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            i === selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40',
          ]"
          :tabindex="i === selected ? 0 : -1"
          @click="selectTab(i)"
          @keydown.right.prevent="focusTab(i + 1)"
          @keydown.left.prevent="focusTab(i - 1)"
          @keydown.home.prevent="focusTab(0)"
          @keydown.end.prevent="focusTab(slots.length - 1)"
        >
          <span class="text-sm font-semibold text-foreground">{{ t('scheduleOptions.plan', { plan: letterOf(slot) }) }}</span>
          <span class="text-xs text-muted-foreground">{{ tabHint(slot) }}</span>
        </button>
      </div>

      <p
        v-if="showFewerOptions"
        role="status"
        class="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
      >
        {{ t('scheduleOptions.fewerOptions', { n: options.length }) }}
      </p>

      <div
        v-if="current && understaffed"
        class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        <p>{{ t('scheduleOptions.understaffed', { n: current.conflicts.length }) }}</p>
        <ul class="mt-2 list-disc pl-5">
          <li v-for="[date, text] in conflictsByDate" :key="date">{{ date }}: {{ text }}</li>
        </ul>
      </div>

      <div
        v-if="!current"
        id="option-panel"
        role="tabpanel"
        :aria-labelledby="`option-tab-${selected + 1}`"
      >
        <div v-if="altLoading === selected + 1" class="flex flex-col items-center gap-2 py-2" role="status">
          <Spinner :size="28" class="text-primary" />
          <div class="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin="0"
            aria-valuemax="100" :aria-valuenow="alt.progress.value" :aria-label="t('schedules.generating')">
            <div class="h-full rounded-full bg-primary transition-[width] duration-200"
              :style="{ width: `${alt.progress.value}%` }" />
          </div>
          <span class="font-mono text-xs text-muted-foreground">{{ alt.progress.value }}%</span>
        </div>
        <div
          v-else-if="altError?.slot === selected + 1"
          role="alert"
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <span>{{ altError.message }}</span>
          <Button variant="outline" size="sm" @click="loadAlternative(selected + 1)">
            {{ t('scheduleOptions.retry') }}
          </Button>
        </div>
      </div>

      <div v-else id="option-panel" role="tabpanel" :aria-labelledby="`option-tab-${current.index}`">
        <section class="overflow-hidden rounded-lg border border-border bg-card">
          <div class="flex flex-wrap items-center justify-end gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{{ t('dutyCalendar.weekendBadge') }}</span>
              {{ t('common.weekend') }}
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-flex rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">{{ t('dutyCalendar.openBadge') }}</span>
              {{ t('scheduleOptions.openOnCall') }}
            </span>
          </div>

          <DutyCalendar
            :days="current.days"
            :assignment-by-date="assignmentByDate"
            :conflicts-by-date="conflictsByDate"
            :doctors="[]"
            mode="readonly"
            show-fill-hints
          />
        </section>
      </div>
    </template>
  </div>
</template>
