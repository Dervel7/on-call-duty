<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BarChart3 } from 'lucide-vue-next'
import type { Duty, MonthlyReport, ScheduleDetail } from '@oncall/shared'
import { dutiesToCsv, monthLabel as formatMonth, monthNames } from '@oncall/utils'
import { useI18n } from 'vue-i18n'
import { useLatestRequest } from '@/composables/useLatestRequest'
import { useIntlLocale } from '@/composables/useIntlLocale'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Select from '@/components/ui/Select.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'
import * as reportsService from '@/services/reports'
import * as scheduleService from '@/services/schedule'
import { downloadCsv } from '@/lib/download'
import { explainDutyReason } from '@/lib/duty-reason'

const router = useRouter()
const { t } = useI18n()
const intlLocale = useIntlLocale()
const weekdayFmt = new Intl.DateTimeFormat('en', { weekday: 'short' })
const dayFmt = new Intl.DateTimeFormat('en', { day: '2-digit' })

const now = new Date()
const year = ref(String(now.getUTCFullYear()))
const month = ref(String(now.getUTCMonth() + 1))

const report = ref<MonthlyReport | null>(null)
const calendar = ref<ScheduleDetail | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const monthLabel = computed(() =>
  report.value ? formatMonth(report.value.year, report.value.month, intlLocale.value) : '',
)
const months = computed(() => monthNames(intlLocale.value))
const isPublished = computed(() => report.value?.schedule?.status === 'published')

interface DayRow {
  date: string
  weekday: string
  day: string
  isWeekend: boolean
  duties: Duty[]
  slotsRequired: number | null
}
const rows = computed<DayRow[]>(() => {
  const r = report.value
  if (!r || !r.schedule) return []
  const slotsByDate = new Map((calendar.value?.days ?? []).map((d) => [d.date, d.slotsRequired]))
  const total = new Date(Date.UTC(r.year, r.month, 0)).getUTCDate()
  const byDate = new Map<string, Duty[]>()
  for (const d of r.roster) {
    const arr = byDate.get(d.dutyDate) ?? []
    arr.push(d)
    byDate.set(d.dutyDate, arr)
  }
  const out: DayRow[] = []
  for (let dayNum = 1; dayNum <= total; dayNum++) {
    const iso = `${r.year}-${String(r.month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
    const js = new Date(`${iso}T00:00:00Z`)
    const dow = js.getUTCDay()
    out.push({
      date: iso,
      weekday: weekdayFmt.format(js),
      day: dayFmt.format(js),
      isWeekend: dow === 0 || dow === 6,
      duties: byDate.get(iso) ?? [],
      slotsRequired: slotsByDate.get(iso) ?? null,
    })
  }
  return out
})

const maxInSet = computed(() =>
  report.value ? Math.max(1, ...report.value.workload.map((w) => w.duties)) : 1,
)
const fairnessBadge = computed(() => {
  const s = report.value?.fairness.dutySpread ?? null
  if (s === null) return { text: 'N/A', variant: 'neutral' as const }
  return s <= 1
    ? { text: 'Well balanced', variant: 'success' as const }
    : { text: 'Imbalanced — review workload', variant: 'destructive' as const }
})

// The print/PDF export is the duty roster calendar the Schedule page shows;
// it renders from the same schedule detail that view uses.
const calendarAssignmentByDate = computed(() => {
  const m = new Map<string, { doctorId: number; firstName: string; lastName: string; reason: string }[]>()
  for (const d of calendar.value?.duties ?? []) {
    const arr = m.get(d.dutyDate) ?? []
    arr.push({ doctorId: d.doctorId, firstName: d.doctorFirstName, lastName: d.doctorLastName, reason: d.reason })
    m.set(d.dutyDate, arr)
  }
  return m
})
const noConflicts = new Map<string, string>()

function fmtGenerated(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

const latest = useLatestRequest()

async function load() {
  const y = Number(year.value)
  if (!year.value || !Number.isInteger(y) || y < 1970 || y > 2100) {
    errorMsg.value = 'Enter a year between 1970 and 2100'
    return
  }
  const isCurrent = latest.start()
  loading.value = true
  errorMsg.value = ''
  calendar.value = null
  try {
    const res = await reportsService.monthly({ year: y, month: Number(month.value) })
    if (!isCurrent()) return
    report.value = res
    if (res.schedule) {
      try {
        const cal = await scheduleService.get(res.schedule.id)
        if (!isCurrent()) return
        calendar.value = cal
      } catch {
        if (!isCurrent()) return
        errorMsg.value = 'Failed to load the duty roster calendar'
      }
    }
  } catch (e) {
    if (!isCurrent()) return
    report.value = null
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load report'
  } finally {
    if (isCurrent()) loading.value = false
  }
}

// Month changes apply immediately; the year field still requires Apply
// (keystrokes would fire partial years mid-typing).
watch(month, () => {
  if (year.value) load()
})

function exportCsv() {
  const r = report.value
  if (!r?.roster.length) return
  const csv = dutiesToCsv(r.roster)
  downloadCsv(`oncall-${r.year}-${String(r.month).padStart(2, '0')}.csv`, csv)
}

function printReport() {
  window.print()
}

function gotoSchedules() {
  router.push('/schedules')
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="no-print flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="r-year">Year</Label>
        <Input id="r-year" v-model="year" type="number" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="r-month">Month</Label>
        <Select id="r-month" v-model="month">
          <option v-for="(m, i) in months" :key="i" :value="String(i + 1)">{{ m }}</option>
        </Select>
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <div v-if="loading" class="no-print flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Spinner :size="16" /> Loading…</div>
    <p v-if="errorMsg" class="no-print text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card v-if="report && !report.schedule">
      <CardHeader>
        <CardTitle>No schedule for {{ monthLabel }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">Generate a schedule for this month to produce a report.</p>
        <Button class="no-print w-fit" @click="gotoSchedules">Go to Schedules</Button>
      </CardContent>
    </Card>

    <template v-if="report && report.schedule">
      <div class="no-print flex items-center gap-2">
        <Button :disabled="!report.roster.length" @click="exportCsv">Export CSV</Button>
        <Button variant="outline" :disabled="!calendar" @click="printReport">Print / Save as PDF</Button>
      </div>

      <div class="no-print flex flex-col gap-1">
        <PageHeader :icon="BarChart3" title="On-Call Duty" subtitle="Monthly duty report and exports">
          <template #actions>
            <div class="flex flex-wrap items-center gap-3">
              <Badge :variant="isPublished ? 'primary' : 'neutral'" dot>{{ isPublished ? 'Published' : 'Draft' }}</Badge>
              <span class="text-xs text-muted-foreground">Generated {{ fmtGenerated(report.generatedAt) }}</span>
            </div>
          </template>
        </PageHeader>
        <p class="text-lg font-medium text-foreground">{{ monthLabel }}</p>
      </div>

      <div class="no-print grid gap-4 md:grid-cols-2">
        <Card class="animate-rise hud-corners">
          <CardHeader><p class="hud-label">COVERAGE</p><CardTitle>Coverage</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="flex flex-wrap items-baseline gap-2">
              <span class="font-mono text-3xl font-bold tracking-tight tabular-nums text-glow">{{ report.coverage.filled }} / {{ report.coverage.daysInMonth }}</span>
              <span class="text-sm font-medium text-muted-foreground"> days fully staffed</span>
            </p>
            <div class="h-2 w-full rounded-full bg-muted ring-1 ring-inset ring-border/60">
              <div
                class="h-2 rounded-full bg-brand-gradient bar-shine shadow-glow"
                :style="{ width: `${(report.coverage.filled / report.coverage.daysInMonth) * 100}%` }"
              ></div>
            </div>
            <p v-if="report.coverage.gaps.length > 0" class="text-sm text-destructive">
              Understaffed days: {{ report.coverage.gaps.join(', ') }}
            </p>
            <p v-else class="text-sm text-muted-foreground">No understaffed days.</p>
          </CardContent>
        </Card>

        <Card class="animate-rise [animation-delay:60ms]">
          <CardHeader><p class="hud-label">FAIRNESS</p><CardTitle>Fairness</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-sm text-muted-foreground">Duty spread (max − min across assigned doctors)</p>
            <p class="font-mono text-3xl font-bold tracking-tight tabular-nums">{{ report.fairness.dutySpread ?? 'N/A' }}</p>
            <Badge :variant="fairnessBadge.variant" class="w-fit">{{ fairnessBadge.text }}</Badge>
            <p class="text-xs text-muted-foreground">
              Weekend spread {{ report.fairness.weekendSpread ?? 'N/A' }}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card class="no-print">
        <CardHeader><CardTitle>Duty roster</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Why this doctor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="r in rows" :key="r.date">
            <TableCell class="font-mono text-sm">{{ r.weekday }} {{ r.day }}</TableCell>
                <TableCell>
                  <span v-if="r.duties.length">{{ r.duties.map((d) => `${d.doctorFirstName} ${d.doctorLastName}`).join(' / ') }}</span>
                  <span v-else class="italic text-muted-foreground">Unassigned</span>
                </TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1">
                    <Badge v-if="r.isWeekend" variant="primary">Weekend</Badge>
                    <Badge v-if="r.duties.length === 0" variant="destructive">Gap day</Badge>
                    <Badge
                      v-else-if="r.slotsRequired !== null && r.duties.length < r.slotsRequired"
                      variant="warning"
                    >
                      {{ r.duties.length }} of {{ r.slotsRequired }}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <ul v-if="r.duties.length" class="flex flex-col gap-1">
                    <li
                      v-for="d in r.duties"
                      :key="d.id"
                      class="text-xs text-muted-foreground"
                      :title="d.reason"
                    >
                      {{ explainDutyReason(d.reason, t) }}
                    </li>
                  </ul>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card class="no-print">
        <CardHeader><CardTitle>Workload</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead>
                <TableHead>Duties</TableHead>
                <TableHead class="text-right">Weekend</TableHead>
                <TableHead class="text-right">Cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="w in report.workload" :key="w.doctorId">
                <TableCell>
                  <span :class="w.isActive ? 'text-foreground' : 'text-muted-foreground'">
                    {{ w.firstName }} {{ w.lastName }}
                  </span>
                  <Badge v-if="!w.isActive" variant="neutral" class="ml-2">inactive</Badge>
                </TableCell>
                <TableCell>
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-24 rounded-full bg-muted ring-1 ring-inset ring-border/60">
                      <div
                        class="h-2 rounded-full bg-brand-gradient bar-shine"
                        :style="{ width: `${(w.duties / maxInSet) * 100}%` }"
                      ></div>
                    </div>
                    <span class="font-mono text-sm text-foreground">{{ w.duties }}</span>
                  </div>
                </TableCell>
                <TableCell class="text-right font-mono text-sm">{{ w.weekend }}</TableCell>
                <TableCell class="text-right font-mono text-sm">{{ w.maxMonthly }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- Print / PDF export: only the duty roster calendar, exactly as the
           Schedule page renders it (names, weekend/open markers, gaps). -->
      <div v-if="calendar" class="print-only">
        <div class="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
          <div>
            <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Duty roster</p>
            <p class="text-lg font-semibold">{{ monthLabel }}</p>
          </div>
          <Badge :variant="isPublished ? 'primary' : 'neutral'" dot>{{ isPublished ? 'Published' : 'Draft' }}</Badge>
        </div>
        <DutyCalendar
          :year="report.year"
          :month="report.month"
          :days="calendar.days"
          :assignment-by-date="calendarAssignmentByDate"
          :conflicts-by-date="noConflicts"
          :doctors="[]"
          mode="readonly"
          class="calendar-print"
        />
      </div>
    </template>
  </div>
</template>
