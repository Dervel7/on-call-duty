<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Duty, MonthlyReport } from '@oncall/shared'
import { dutiesToCsv } from '@oncall/utils'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'
import * as reportsService from '@/services/reports'
import { downloadCsv } from '@/lib/download'

const router = useRouter()
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const weekdayFmt = new Intl.DateTimeFormat('en', { weekday: 'short' })
const dayFmt = new Intl.DateTimeFormat('en', { day: '2-digit' })

const now = new Date()
const year = ref(String(now.getUTCFullYear()))
const month = ref(String(now.getUTCMonth() + 1))

const report = ref<MonthlyReport | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const monthLabel = computed(() => `${MONTHS[Number(month.value) - 1]} ${year.value}`)
const isPublished = computed(() => report.value?.schedule?.status === 'published')

interface DayRow {
  date: string
  weekday: string
  day: string
  isWeekend: boolean
  duties: Duty[]
}
const rows = computed<DayRow[]>(() => {
  const r = report.value
  if (!r || !r.schedule) return []
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
    })
  }
  return out
})

const maxInSet = computed(() =>
  report.value ? Math.max(1, ...report.value.workload.map((w) => w.duties)) : 1,
)
const fairnessBadge = computed(() => {
  const s = report.value?.fairness.dutySpread ?? null
  if (s === null) return { text: 'N/A', class: 'bg-muted text-muted-foreground' }
  return s <= 1
    ? { text: 'Well balanced', class: 'bg-primary/10 text-primary' }
    : { text: 'Imbalanced — review workload', class: 'bg-destructive/10 text-destructive' }
})

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

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    report.value = await reportsService.monthly({ year: Number(year.value), month: Number(month.value) })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load report'
  } finally {
    loading.value = false
  }
}

function exportCsv() {
  if (!report.value?.roster.length) return
  const csv = dutiesToCsv(report.value.roster)
  downloadCsv(`oncall-${year.value}-${String(month.value).padStart(2, '0')}.csv`, csv)
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
          <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
        </Select>
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="no-print text-sm text-muted-foreground">Loading…</p>
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
        <Button variant="outline" @click="printReport">Print / Save as PDF</Button>
      </div>

      <div class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold text-foreground">On-Call Duty</h1>
        <p class="text-lg font-medium text-foreground">{{ monthLabel }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <span
            :class="isPublished
              ? 'inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'"
          >
            {{ isPublished ? 'Published' : 'Draft' }}
          </span>
          <span class="text-xs text-muted-foreground">Generated {{ fmtGenerated(report.generatedAt) }}</span>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Coverage</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-2xl font-semibold text-foreground">
              {{ report.coverage.filled }} / {{ report.coverage.daysInMonth }} days fully staffed
            </p>
            <p v-if="report.coverage.gaps.length > 0" class="text-sm text-destructive">
              Understaffed days: {{ report.coverage.gaps.join(', ') }}
            </p>
            <p v-else class="text-sm text-muted-foreground">No understaffed days.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fairness</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-sm text-muted-foreground">Duty spread (max − min across assigned doctors)</p>
            <p class="text-2xl font-semibold text-foreground">{{ report.fairness.dutySpread ?? 'N/A' }}</p>
            <span
              :class="`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ${fairnessBadge.class}`"
            >
              {{ fairnessBadge.text }}
            </span>
            <p class="text-xs text-muted-foreground">
              Weekend spread {{ report.fairness.weekendSpread ?? 'N/A' }}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Duty roster</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="r in rows" :key="r.date">
                <TableCell>{{ r.weekday }} {{ r.day }}</TableCell>
                <TableCell>
                  <span v-if="r.duties.length">{{ r.duties.map((d) => `${d.doctorFirstName} ${d.doctorLastName}`).join(' / ') }}</span>
                  <span v-else class="italic text-muted-foreground">Unassigned</span>
                </TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-if="r.isWeekend"
                      class="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    >
                      Weekend
                    </span>
                    <span
                      v-if="r.duties.length < 2"
                      class="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                    >
                      {{ r.duties.length === 0 ? 'Gap day' : '1 of 2' }}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span v-if="r.duties.length" class="text-xs text-muted-foreground">{{ r.duties.map((d) => d.reason).join(' | ') }}</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
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
                  <span
                    v-if="!w.isActive"
                    class="ml-2 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    inactive
                  </span>
                </TableCell>
                <TableCell>
                  <div class="flex items-center gap-2">
                    <div class="h-2 w-24 rounded bg-muted">
                      <div
                        class="h-2 rounded bg-primary/20"
                        :style="{ width: `${(w.duties / maxInSet) * 100}%` }"
                      ></div>
                    </div>
                    <span class="text-sm text-foreground">{{ w.duties }}</span>
                  </div>
                </TableCell>
                <TableCell class="text-right">{{ w.weekend }}</TableCell>
                <TableCell class="text-right">{{ w.maxMonthly }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
