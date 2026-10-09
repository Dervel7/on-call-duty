<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { ScheduleOption, ScheduleOptionsResult } from '@oncall/shared'
import { createScheduleSchema } from '@oncall/shared'
import { monthLabel as formatMonth } from '@oncall/utils'
import * as scheduleService from '@/services/schedule'
import { explainConflict } from '@/lib/conflict-text'
import { useConfirm } from '@/composables/useConfirm'
import { useEstimatedProgress } from '@/composables/useEstimatedProgress'
import { useIntlLocale } from '@/composables/useIntlLocale'
import { useLatestRequest } from '@/composables/useLatestRequest'
import Button from '@/components/ui/Button.vue'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'
import Spinner from '@/components/ui/Spinner.vue'

// Mirror the API (apps/api cannot be imported here): SCHEDULE_OPTION_COUNT options, and
// SOLVER_BUDGET_MS (10 s) for the primary option plus ALTERNATIVE_BUDGET_MS (5 s) per alternative.
const OPTION_COUNT = 3
const ESTIMATED_OPTIONS_MS = 10_000 + 2 * 5_000

const route = useRoute()
const router = useRouter()
const intlLocale = useIntlLocale()
const { t } = useI18n()
const { confirm } = useConfirm()
const { progress, start, finish, stop } = useEstimatedProgress(ESTIMATED_OPTIONS_MS)

const result = ref<ScheduleOptionsResult | null>(null)
const selected = ref(0)
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')

const year = computed(() => Number(route.query.year))
const month = computed(() => Number(route.query.month))
const parsed = computed(() => createScheduleSchema.safeParse({ year: year.value, month: month.value }))
const valid = computed(() => parsed.value.success)
const monthLabel = computed(() =>
  valid.value ? formatMonth(year.value, month.value, intlLocale.value) : t('scheduleOptions.title'),
)

const options = computed<ScheduleOption[]>(() => result.value?.options ?? [])
const current = computed<ScheduleOption | undefined>(() => options.value[selected.value])
// All options share the coverage optimum, so a short day is short in every option, and the
// API rejects any plan below a day's minimum.
const understaffed = computed(() => (current.value?.conflicts.length ?? 0) > 0)
const conflictsByDate = computed(
  () => new Map((current.value?.conflicts ?? []).map((c): [string, string] => [c.date, explainConflict(c, t)])),
)

function letter(option: ScheduleOption): string {
  return String.fromCharCode(64 + option.index)
}

const assignmentByDate = computed(() => {
  const m = new Map<string, { doctorId: number; firstName: string; lastName: string; reason: string }[]>()
  for (const a of current.value?.assignments ?? []) {
    const slots = m.get(a.date) ?? []
    slots.push({ doctorId: a.doctorId, firstName: a.doctorFirstName, lastName: a.doctorLastName, reason: a.reason })
    m.set(a.date, slots)
  }
  return m
})

const latest = useLatestRequest()

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
    router.push(`/schedules/${detail.schedule.id}`)
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
          {{ t('schedulePreview.backToSchedules') }}
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
      <p class="text-sm font-medium text-foreground">{{ t('schedulePreview.invalidMonth') }}</p>
      <p class="text-sm text-muted-foreground">{{ t('schedulePreview.invalidMonthHint') }}</p>
      <Button variant="outline" size="sm" @click="router.push('/schedules')">
        {{ t('schedulePreview.backToSchedules') }}
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

    <template v-else-if="current">
      <div role="tablist" :aria-label="t('scheduleOptions.title')" class="flex flex-wrap gap-2">
        <button
          v-for="(o, i) in options"
          :id="`option-tab-${o.index}`"
          :key="o.index"
          type="button"
          role="tab"
          :aria-selected="i === selected"
          aria-controls="option-panel"
          :class="[
            'flex flex-col items-start rounded-lg border px-4 py-2 text-left transition-colors',
            i === selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40',
          ]"
          @click="selected = i"
        >
          <span class="text-sm font-semibold text-foreground">{{ t('scheduleOptions.plan', { plan: letter(o) }) }}</span>
          <span class="text-xs text-muted-foreground">
            {{ o.index === 1 ? t('scheduleOptions.firstChoice') : t('scheduleOptions.daysDiffer', { n: o.changedDates.length }) }}
          </span>
        </button>
      </div>

      <p
        v-if="options.length < OPTION_COUNT"
        role="status"
        class="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
      >
        {{ t('scheduleOptions.fewerOptions', { n: options.length }) }}
      </p>

      <div
        v-if="understaffed"
        class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        <p>{{ t('scheduleOptions.understaffed', { n: current.conflicts.length }) }}</p>
        <ul class="mt-2 list-disc pl-5">
          <li v-for="[date, text] in conflictsByDate" :key="date">{{ date }}: {{ text }}</li>
        </ul>
      </div>

      <div id="option-panel" role="tabpanel" :aria-labelledby="`option-tab-${current.index}`">
        <section class="overflow-hidden rounded-lg border border-border bg-card">
          <div class="flex flex-wrap items-center justify-end gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{{ t('dutyCalendar.weekendBadge') }}</span>
              {{ t('common.weekend') }}
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="inline-flex rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">{{ t('dutyCalendar.openBadge') }}</span>
              {{ t('schedulePreview.openOnCall') }}
            </span>
          </div>

          <DutyCalendar
            :year="year"
            :month="month"
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
