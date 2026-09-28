<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Activity } from 'lucide-vue-next'
import type { MeStats } from '@oncall/shared'
import Badge from '@/components/ui/Badge.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import * as statsService from '@/services/stats'

interface OnCallRow {
  date: string
  names: string[]
  isWeekend: boolean
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
      <Card class="relative overflow-hidden animate-rise">
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-gradient opacity-10 blur-3xl"
        ></div>
        <CardHeader>
          <CardTitle class="flex items-center gap-2">
            <Activity class="h-5 w-5 text-primary" />
            Welcome, {{ stats.doctor.firstName }}
          </CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <p class="tabular-nums">
            <span class="text-3xl font-bold tracking-tight">{{ stats.currentMonth.duties }} / {{ stats.currentMonth.maxMonthly }}</span><span class="text-sm font-medium text-muted-foreground"> duties this month</span>
          </p>
          <div class="flex items-center gap-3">
            <div class="h-3 w-full rounded-full bg-muted">
              <div
                class="h-3 rounded-full bg-brand-gradient transition-[width] duration-700"
                :style="{ width: `${progress}%` }"
              ></div>
            </div>
            <span class="text-xs font-semibold text-muted-foreground tabular-nums">{{ Math.round(progress) }}%</span>
          </div>
          <p v-if="!stats.currentMonth.published" class="text-sm text-muted-foreground">
            This month's schedule isn't published yet.
          </p>
          <div>
            <Badge variant="outline">Weekend {{ stats.currentMonth.weekend }}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card class="animate-rise [animation-delay:60ms]">
        <CardHeader><CardTitle>Who's on call (today + 6 days)</CardTitle></CardHeader>
        <CardContent>
          <ul v-if="onCallRows.length > 0" class="flex flex-col gap-1">
            <li
              v-for="e in onCallRows"
              :key="e.date"
              :class="[
                'flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50',
                e.isMine && 'bg-primary/10 ring-1 ring-inset ring-primary/20',
              ]"
            >
              <span class="text-sm text-foreground">
                {{ fmt(e.date) }} · {{ e.names.join(', ') }}
              </span>
              <span class="flex items-center gap-1">
                <Badge v-if="e.isMine" variant="accent">You</Badge>
                <Badge v-if="e.isWeekend" variant="neutral">Weekend</Badge>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">No published schedule covers this period.</p>
        </CardContent>
      </Card>

      <Card class="animate-rise [animation-delay:120ms]">
        <CardHeader><CardTitle>My upcoming duties</CardTitle></CardHeader>
        <CardContent>
          <ul v-if="stats.upcoming.length > 0" class="flex flex-col gap-1">
            <li
              v-for="u in stats.upcoming"
              :key="u.dutyDate"
              class="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/50"
            >
              <span class="text-sm text-foreground">{{ fmt(u.dutyDate) }}</span>
              <span class="flex items-center gap-1">
                <Badge v-if="u.isWeekend" variant="neutral">Weekend</Badge>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">No upcoming on-call duties.</p>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
