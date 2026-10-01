<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarHeart, Check } from 'lucide-vue-next'
import { daysInMonth, isWeekend, toIsoDate, weekdayNames } from '@oncall/utils'
import * as holidayService from '@/services/holiday'
import { useAuthStore } from '@/stores/auth'
import { useConfirm } from '@/composables/useConfirm'
import { useLatestRequest } from '@/composables/useLatestRequest'
import { useIntlLocale } from '@/composables/useIntlLocale'
import Button from '@/components/ui/Button.vue'
import Label from '@/components/ui/Label.vue'
import MonthPicker from '@/components/ui/MonthPicker.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Spinner from '@/components/ui/Spinner.vue'

const { t } = useI18n()
const auth = useAuthStore()
const { confirm } = useConfirm()
const intlLocale = useIntlLocale()
const weekdays = computed(() => weekdayNames(intlLocale.value))

const month = ref(toIsoDate(new Date()).slice(0, 7))
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')

/** Marked weekdays for the viewed month (weekends are holidays by default and never stored). */
const marked = ref(new Set<string>())
const dirty = ref(false)

const year = computed(() => Number(month.value.slice(0, 4)))
const month1 = computed(() => Number(month.value.slice(5, 7)))

const todayIso = toIsoDate(new Date())

interface Cell {
  blank: boolean
  date: string | null
  dayNum: number | null
  weekend: boolean
  holiday: boolean
  today: boolean
}

const cells = computed<Cell[]>(() => {
  const out: Cell[] = []
  if (!/^\d{4}-\d{2}$/.test(month.value)) return out
  const yearNum = year.value
  const month0 = month1.value - 1
  const first = new Date(yearNum, month0, 1)
  const lead = (first.getDay() + 6) % 7
  for (let i = 0; i < lead; i++) {
    out.push({ blank: true, date: null, dayNum: null, weekend: false, holiday: false, today: false })
  }
  const total = daysInMonth(yearNum, month0)
  for (let d = 1; d <= total; d++) {
    const js = new Date(yearNum, month0, d)
    const iso = toIsoDate(js)
    const weekend = isWeekend(js)
    out.push({
      blank: false,
      date: iso,
      dayNum: d,
      weekend,
      holiday: weekend || marked.value.has(iso),
      today: iso === todayIso,
    })
  }
  while (out.length % 7 !== 0) {
    out.push({ blank: true, date: null, dayNum: null, weekend: false, holiday: false, today: false })
  }
  return out
})

const dateLabel = computed(
  () => new Intl.DateTimeFormat(intlLocale.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
)

function dayLabel(c: Cell): string {
  const date = dateLabel.value.format(new Date(`${c.date}T00:00:00`))
  if (c.weekend) return t('holidays.dayWeekend', { date })
  return t(c.holiday ? 'holidays.dayMarked' : 'holidays.dayNotHoliday', { date })
}

function inMonth(ym: string) {
  return (iso: string) => iso.startsWith(`${ym}-`)
}

const latest = useLatestRequest()

async function load() {
  const isCurrent = latest.start()
  const ym = month.value
  loading.value = true
  errorMsg.value = ''
  try {
    const holidays = await holidayService.listHolidays(Number(ym.slice(0, 4)), auth.user?.clinicId ?? undefined)
    if (!isCurrent()) return
    marked.value = new Set(holidays.map((h) => h.date).filter(inMonth(ym)))
    dirty.value = false
  } catch (e) {
    if (!isCurrent()) return
    errorMsg.value = e instanceof Error ? e.message : t('holidays.loadFailed')
  } finally {
    if (isCurrent()) loading.value = false
  }
}

async function changeMonth(next: string) {
  if (next === month.value) return
  if (dirty.value) {
    const ok = await confirm({
      title: t('holidays.discardTitle'),
      message: t('holidays.discardMessage'),
      confirmText: t('holidays.discard'),
    })
    // Not updating `month` keeps the controlled picker on the current month.
    if (!ok) return
  }
  month.value = next
}

watch(month, () => {
  void load()
})
void load()

function toggle(date: string) {
  const next = new Set(marked.value)
  if (next.has(date)) next.delete(date)
  else next.add(date)
  marked.value = next
  dirty.value = true
}

async function save() {
  const ym = month.value
  saving.value = true
  errorMsg.value = ''
  try {
    const holidays = await holidayService.setMonthHolidays(year.value, month1.value, [...marked.value])
    if (ym !== month.value) return
    marked.value = new Set(holidays.map((h) => h.date).filter(inMonth(ym)))
    dirty.value = false
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('holidays.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader :icon="CalendarHeart" :title="t('nav.holidays')" :subtitle="t('holidays.subtitle')">
      <template #actions>
        <Button v-if="dirty" :disabled="saving" @click="save">
          <Spinner v-if="saving" :size="14" class="mr-1" />
          {{ t('common.save') }}
        </Button>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="f-month">{{ t('common.month') }}</Label>
        <MonthPicker id="f-month" :model-value="month" :disabled="saving" class="w-44" @update:model-value="changeMonth" />
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner :size="16" />
      {{ t('common.loading') }}
    </div>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <div v-if="!loading" class="overflow-x-auto">
      <div class="rounded-xl border border-border/60 bg-card/50 p-2 shadow-card backdrop-blur-sm">
        <div class="grid grid-cols-7 gap-1.5">
          <div
            v-for="w in weekdays"
            :key="w"
            class="rounded-md bg-muted/50 px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80"
          >
            {{ w }}
          </div>
        </div>
        <div class="grid grid-cols-7 gap-1.5">
          <template v-for="(c, idx) in cells" :key="idx">
            <div v-if="c.blank" class="min-h-[56px] rounded-lg border border-transparent bg-transparent" />
            <button
              v-else
              type="button"
              :data-date="c.date"
              :disabled="c.weekend"
              :aria-pressed="c.holiday"
              :aria-label="dayLabel(c)"
              :title="c.weekend ? t('holidays.weekendTitle') : undefined"
              :class="[
                'flex min-h-[56px] flex-col items-start rounded-lg border p-2 text-left transition-colors',
                c.weekend
                  ? 'cursor-not-allowed border-border/60 bg-muted/40'
                  : c.holiday
                    ? 'border-primary/40 bg-primary/15 hover:border-primary/60'
                    : 'border-border/60 bg-card hover:border-primary/40',
              ]"
              @click="!c.weekend && c.date && toggle(c.date)"
            >
              <span
                :class="[
                  'font-mono text-xs font-bold',
                  c.today ? 'grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground shadow-glow' : '',
                  c.holiday && !c.today ? 'text-primary' : '',
                ]"
              >{{ c.dayNum }}</span>
              <Check v-if="c.holiday && !c.weekend" :size="14" class="mt-auto self-end text-primary" aria-hidden="true" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <div v-if="!loading" class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-3 rounded-sm border border-border/60 bg-muted/40" />
        {{ t('holidays.legendWeekend') }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-3 rounded-sm border border-primary/40 bg-primary/15" />
        {{ t('holidays.legendMarked') }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-3 w-3 rounded-sm border border-border/60 bg-card" />
        {{ t('holidays.legendNormal') }}
      </span>
    </div>
  </div>
</template>
