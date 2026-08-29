<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Activity } from 'lucide-vue-next'
import type { MeStats } from '@oncall/shared'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import * as statsService from '@/services/stats'

interface OnCallRow {
  date: string
  names: string[]
  isWeekend: boolean
  isHoliday: boolean
  isMine: boolean
}

const stats = ref<MeStats | null>(null)
const loading = ref(false)
const errorMsg = ref('')

const onCallRows = computed<OnCallRow[]>(() => {
  const byDate = new Map<string, OnCallRow>()
  for (const e of stats.value?.onCall ?? []) {
    const fullName = `${e.doctorFirstName} ${e.doctorLastName}`
    const row = byDate.get(e.date)
    if (row) {
      row.names.push(fullName)
      row.isMine = row.isMine || e.isMine
    } else {
      byDate.set(e.date, {
        date: e.date,
        names: [fullName],
        isWeekend: e.isWeekend,
        isHoliday: e.isHoliday,
        isMine: e.isMine,
      })
    }
  }
  return [...byDate.values()]
})

const progress = computed(() => {
  if (!stats.value) return 0
  const cap = stats.value.currentMonth.maxMonthly || 1
  return Math.min(100, (stats.value.currentMonth.duties / cap) * 100)
})

function fmt(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(d)
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    stats.value = await statsService.me()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load statistics'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <template v-if="stats">
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <Activity class="h-5 w-5 text-primary" />
            Welcome, {{ stats.doctor.firstName }}
          </CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <p class="text-sm tabular-nums text-muted-foreground">
            {{ stats.currentMonth.duties }} / {{ stats.currentMonth.maxMonthly }} duties this month
          </p>
          <div class="h-2.5 w-full rounded-full bg-muted">
            <div
              class="h-2.5 rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-500"
              :style="{ width: `${progress}%` }"
            ></div>
          </div>
          <p v-if="!stats.currentMonth.published" class="text-sm text-muted-foreground">
            This month's schedule isn't published yet.
          </p>
          <p class="text-xs text-muted-foreground">
            Weekend {{ stats.currentMonth.weekend }} · Holiday {{ stats.currentMonth.holiday }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Who's on call (today + 7 days)</CardTitle></CardHeader>
        <CardContent>
          <ul v-if="onCallRows.length > 0" class="flex flex-col divide-y divide-border">
            <li
              v-for="e in onCallRows"
              :key="e.date"
              :class="[
                'flex items-center justify-between py-2',
                e.isMine && '-mx-2 rounded bg-primary/10 px-2',
              ]"
            >
              <span class="text-sm text-foreground">
                {{ fmt(e.date) }} · {{ e.names.join(', ') }}
              </span>
              <span class="flex items-center gap-1">
                <span
                  v-if="e.isMine"
                  class="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                >
                  You
                </span>
                <span
                  v-if="e.isWeekend"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Weekend
                </span>
                <span
                  v-if="e.isHoliday"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Holiday
                </span>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">No published schedule covers this period.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>My upcoming duties</CardTitle></CardHeader>
        <CardContent>
          <ul v-if="stats.upcoming.length > 0" class="flex flex-col divide-y divide-border">
            <li
              v-for="u in stats.upcoming"
              :key="u.dutyDate"
              class="flex items-center justify-between py-2"
            >
              <span class="text-sm text-foreground">{{ fmt(u.dutyDate) }}</span>
              <span class="flex items-center gap-1">
                <span
                  v-if="u.isWeekend"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Weekend
                </span>
                <span
                  v-if="u.isHoliday"
                  class="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  Holiday
                </span>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">No upcoming on-call duties.</p>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
