<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AdminStats } from '@oncall/shared'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Table from '@/components/ui/Table.vue'
import TableBody from '@/components/ui/TableBody.vue'
import TableCell from '@/components/ui/TableCell.vue'
import TableHead from '@/components/ui/TableHead.vue'
import TableHeader from '@/components/ui/TableHeader.vue'
import TableRow from '@/components/ui/TableRow.vue'
import * as statsService from '@/services/stats'

const router = useRouter()
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const now = new Date()
const year = ref(String(now.getUTCFullYear()))
const month = ref(String(now.getUTCMonth() + 1))

const stats = ref<AdminStats | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const monthLabel = computed(() => `${MONTHS[Number(month.value) - 1]} ${year.value}`)
const maxInSet = computed(() =>
  stats.value ? Math.max(1, ...stats.value.workload.map((w) => w.duties)) : 1,
)
const fairnessBadge = computed(() => {
  const s = stats.value ? stats.value.fairness.dutySpread : null
  if (s === null) return { text: 'N/A', class: 'bg-muted text-muted-foreground' }
  return s <= 1
    ? { text: 'Well balanced', class: 'bg-primary/10 text-primary' }
    : { text: 'Imbalanced — review workload', class: 'bg-destructive/10 text-destructive' }
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    stats.value = await statsService.admin({ year: Number(year.value), month: Number(month.value) })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load statistics'
  } finally {
    loading.value = false
  }
}

function gotoSchedules() {
  router.push('/schedules')
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="s-year">Year</Label>
        <Input id="s-year" v-model="year" type="number" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="s-month">Month</Label>
        <select
          id="s-month"
          v-model="month"
          class="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
        </select>
      </div>
      <Button variant="outline" @click="load">Apply</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <Card v-if="stats && !stats.schedule">
      <CardHeader>
        <CardTitle>No schedule for {{ monthLabel }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <p class="text-sm text-muted-foreground">Generate a schedule for this month to see statistics.</p>
        <Button class="w-fit" @click="gotoSchedules">Go to Schedules</Button>
      </CardContent>
    </Card>

    <template v-if="stats && stats.schedule">
      <div class="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Coverage</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-2xl font-semibold text-foreground">
              {{ stats.coverage.filled }} / {{ stats.coverage.daysInMonth }} days filled
            </p>
            <p v-if="stats.coverage.gaps.length > 0" class="text-sm text-destructive">
              Gap days: {{ stats.coverage.gaps.join(', ') }}
            </p>
            <p v-else class="text-sm text-muted-foreground">No gap days.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fairness</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-sm text-muted-foreground">Duty spread (max − min across assigned doctors)</p>
            <p class="text-2xl font-semibold text-foreground">{{ stats.fairness.dutySpread ?? 'N/A' }}</p>
            <span
              :class="`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ${fairnessBadge.class}`"
            >
              {{ fairnessBadge.text }}
            </span>
            <p class="text-xs text-muted-foreground">
              Weekend spread {{ stats.fairness.weekendSpread ?? 'N/A' }} · Holiday spread
              {{ stats.fairness.holidaySpread ?? 'N/A' }}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Workload</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead>
                <TableHead>Duties</TableHead>
                <TableHead class="text-right">Weekend</TableHead>
                <TableHead class="text-right">Holiday</TableHead>
                <TableHead class="text-right">Cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="w in stats.workload" :key="w.doctorId">
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
                <TableCell class="text-right">{{ w.holiday }}</TableCell>
                <TableCell class="text-right">{{ w.maxMonthly }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
