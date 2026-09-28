<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { TriangleAlert } from 'lucide-vue-next'
import type { AdminStats } from '@oncall/shared'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
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
import * as statsService from '@/services/stats'
import * as billingService from '@/services/billing'

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
const paymentDaysLeft = ref<number | null>(null)
const errorMsg = ref('')

const paymentLabel = computed(() => {
  const days = paymentDaysLeft.value
  if (days === null || days < 0 || days > 3) return ''
  if (days === 0) return 'Payment deadline: due today'
  return `Payment deadline: ${days} ${days === 1 ? 'day' : 'days'} left`
})
const monthLabel = computed(() => `${MONTHS[Number(month.value) - 1]} ${year.value}`)

const maxInSet = computed(() =>
  stats.value ? Math.max(1, ...stats.value.workload.map((w) => w.duties)) : 1,
)
const fairnessBadge = computed(() => {
  const s = stats.value ? stats.value.fairness.dutySpread : null
  if (s === null) return { text: 'N/A', class: 'bg-muted text-muted-foreground' }
  return s <= 1
    ? { text: 'Well balanced', class: 'bg-success/10 text-success' }
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

async function loadPaymentAlert() {
  // Advisory only — a failed fetch must never break the dashboard.
  try {
    paymentDaysLeft.value = (await billingService.paymentAlert()).daysLeft
  } catch {
    paymentDaysLeft.value = null
  }
}

// Month changes apply immediately; the year field still requires Apply
// (keystrokes would fire partial years mid-typing).
watch(month, () => {
  if (year.value) load()
})

function gotoSchedules() {
  router.push('/schedules')
}

onMounted(load)
onMounted(loadPaymentAlert)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="paymentLabel"
      role="alert"
      class="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
      <TriangleAlert class="size-5 shrink-0" />
      {{ paymentLabel }}
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex flex-col gap-1">
        <Label for="s-year">Year</Label>
        <Input id="s-year" v-model="year" type="number" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="s-month">Month</Label>
        <Select id="s-month" v-model="month">
          <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
        </Select>
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
        <Card class="animate-rise">
          <CardHeader><CardTitle>Coverage</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-3">
            <p class="tabular-nums">
              <span class="text-3xl font-bold tracking-tight tabular-nums">{{ stats.coverage.filled }} / {{ stats.coverage.daysInMonth }}</span><span class="text-sm font-medium text-muted-foreground"> days fully staffed</span>
            </p>
            <div class="h-2.5 w-full rounded-full bg-muted">
              <div
                class="h-2.5 rounded-full bg-brand-gradient"
                :style="{ width: `${(stats.coverage.filled / stats.coverage.daysInMonth) * 100}%` }"
              ></div>
            </div>
            <p v-if="stats.coverage.gaps.length > 0" class="text-sm text-destructive">
              Understaffed days: {{ stats.coverage.gaps.join(', ') }}
            </p>
            <p v-else class="text-sm text-muted-foreground">No understaffed days.</p>
          </CardContent>
        </Card>

        <Card class="animate-rise [animation-delay:60ms]">
          <CardHeader><CardTitle>Fairness</CardTitle></CardHeader>
          <CardContent class="flex flex-col gap-2">
            <p class="text-sm text-muted-foreground">Duty spread (max − min across assigned doctors)</p>
            <p class="text-3xl font-semibold tabular-nums text-foreground">
              {{ stats.fairness.dutySpread ?? 'N/A' }}
            </p>
            <span
              :class="`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-xs font-medium ${fairnessBadge.class}`"
            >
              {{ fairnessBadge.text }}
            </span>
            <p class="text-xs text-muted-foreground">
              Weekend spread {{ stats.fairness.weekendSpread ?? 'N/A' }}
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
                <TableHead class="text-right">Cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="w in stats.workload" :key="w.doctorId">
                <TableCell>
                  <div class="flex items-center gap-2.5">
                    <Avatar :name="`${w.firstName} ${w.lastName}`" size="sm" />
                    <span :class="w.isActive ? 'text-foreground' : 'text-muted-foreground'">
                      {{ w.firstName }} {{ w.lastName }}
                    </span>
                    <Badge v-if="!w.isActive" variant="neutral">inactive</Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div class="flex items-center gap-2">
                    <div class="h-2.5 w-24 rounded-full bg-muted">
                      <div
                        class="h-2.5 rounded-full bg-brand-gradient"
                        :style="{ width: `${(w.duties / maxInSet) * 100}%` }"
                      ></div>
                    </div>
                    <span class="text-sm tabular-nums text-foreground">{{ w.duties }}</span>
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
