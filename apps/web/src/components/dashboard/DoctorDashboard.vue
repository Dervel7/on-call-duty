<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity } from 'lucide-vue-next'
import type { MeStats } from '@oncall/shared'
import Badge from '@/components/ui/Badge.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import * as statsService from '@/services/stats'
import { useIntlLocale } from '@/composables/useIntlLocale'

interface OnCallRow {
  date: string
  names: string[]
  isWeekend: boolean
  isMine: boolean
}

const { t } = useI18n()
const intlLocale = useIntlLocale()
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

const dateFormat = computed(
  () => new Intl.DateTimeFormat(intlLocale.value, { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }),
)

function fmt(iso: string): string {
  return dateFormat.value.format(new Date(`${iso}T00:00:00Z`))
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    stats.value = await statsService.me()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('doctorDashboard.loadFailed')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <template v-if="stats">
      <Card class="relative overflow-hidden hud-corners animate-rise">
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-gradient opacity-10 blur-3xl"
        ></div>
        <CardHeader>
          <p class="hud-label">{{ t('doctorDashboard.vitalsKicker') }}</p>
          <CardTitle class="flex items-center gap-2">
            <Activity class="h-5 w-5 text-primary" />
            {{ t('doctorDashboard.welcome', { name: stats.doctor.firstName }) }}
          </CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-3">
          <p class="tabular-nums">
            <span class="font-mono text-4xl font-bold tracking-tight text-glow">{{ stats.currentMonth.duties }} / {{ stats.currentMonth.maxMonthly }}</span> <span class="text-sm font-medium text-muted-foreground">{{ t('doctorDashboard.dutiesThisMonth') }}</span>
          </p>
          <div class="flex items-center gap-3">
            <div class="h-2.5 w-full rounded-full bg-muted ring-1 ring-inset ring-border/60">
              <div
                class="h-2.5 rounded-full bg-brand-gradient bar-shine shadow-glow transition-[width] duration-700"
                :style="{ width: `${progress}%` }"
              ></div>
            </div>
            <span class="font-mono text-xs font-semibold text-muted-foreground tabular-nums">{{ Math.round(progress) }}%</span>
          </div>
          <p v-if="!stats.currentMonth.published" class="text-sm text-muted-foreground">
            {{ t('doctorDashboard.notPublished') }}
          </p>
          <div>
            <Badge variant="outline">{{ t('doctorDashboard.weekendCount', { n: stats.currentMonth.weekend }) }}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card class="animate-rise [animation-delay:60ms]">
        <CardHeader>
          <p class="hud-label">{{ t('doctorDashboard.nextDaysKicker') }}</p>
          <CardTitle>{{ t('doctorDashboard.whoIsOnCall') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul v-if="onCallRows.length > 0" class="flex flex-col gap-1">
            <li
              v-for="e in onCallRows"
              :key="e.date"
              :class="[
                'flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50',
                e.isMine && 'bg-primary/10 ring-1 ring-inset ring-primary/20',
              ]"
            >
              <span class="text-sm text-foreground">
                {{ fmt(e.date) }} · {{ e.names.join(', ') }}
              </span>
              <span class="flex items-center gap-1">
                <Badge v-if="e.isMine" variant="accent">{{ t('doctorDashboard.you') }}</Badge>
                <Badge v-if="e.isWeekend" variant="neutral">{{ t('common.weekend') }}</Badge>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">{{ t('doctorDashboard.noOnCall') }}</p>
        </CardContent>
      </Card>

      <Card class="animate-rise [animation-delay:120ms]">
        <CardHeader>
          <p class="hud-label">{{ t('doctorDashboard.myDutiesKicker') }}</p>
          <CardTitle>{{ t('doctorDashboard.myUpcomingDuties') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul v-if="stats.upcoming.length > 0" class="flex flex-col gap-1">
            <li
              v-for="u in stats.upcoming"
              :key="u.dutyDate"
              class="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
            >
              <span class="text-sm text-foreground">{{ fmt(u.dutyDate) }}</span>
              <span class="flex items-center gap-1">
                <Badge v-if="u.isWeekend" variant="neutral">{{ t('common.weekend') }}</Badge>
              </span>
            </li>
          </ul>
          <p v-else class="text-sm text-muted-foreground">{{ t('doctorDashboard.noUpcoming') }}</p>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
