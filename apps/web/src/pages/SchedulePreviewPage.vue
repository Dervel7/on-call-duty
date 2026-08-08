<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DayInfo, Doctor, PreviewResult } from '@oncall/shared'
import { createScheduleSchema } from '@oncall/shared'
import * as scheduleService from '@/services/schedule'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'

const route = useRoute()
const router = useRouter()

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const result = ref<PreviewResult | null>(null)
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')
const generating = ref(false)

const year = computed(() => Number(route.query.year))
const month = computed(() => Number(route.query.month))
const parsed = computed(() => createScheduleSchema.safeParse({ year: year.value, month: month.value }))
const valid = computed(() => parsed.value.success)
const monthLabel = computed(() =>
  valid.value ? `${MONTHS[month.value - 1]} ${year.value}` : 'Preview',
)

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }[]
  >()
  for (const a of result.value?.assignments ?? []) {
    const arr = m.get(a.date) ?? []
    arr.push({
      doctorId: a.doctorId,
      firstName: a.doctorFirstName,
      lastName: a.doctorLastName,
      reason: a.reason,
    })
    m.set(a.date, arr)
  }
  return m
})
const conflictsByDate = computed(() => {
  const m = new Map<string, string>()
  for (const c of result.value?.conflicts ?? []) m.set(c.date, c.detail)
  return m
})
const days = computed<DayInfo[]>(() => result.value?.days ?? [])
const conflictCount = computed(() => result.value?.conflicts.length ?? 0)

async function load() {
  if (!valid.value) {
    errorMsg.value = 'Invalid or missing year/month.'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    result.value = await scheduleService.preview(year.value, month.value)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to preview'
  } finally {
    loading.value = false
  }
}

async function generate() {
  generating.value = true
  errorMsg.value = ''
  try {
    const detail = await scheduleService.generate(year.value, month.value)
    router.push(`/schedules/${detail.schedule.id}`)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to generate'
  } finally {
    generating.value = false
  }
}

onMounted(async () => {
  try {
    doctors.value = await doctorService.list()
  } catch {
    doctors.value = []
  }
  await load()
})
watch([year, month], load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold text-foreground">{{ monthLabel }}</h1>
      <div class="flex items-center gap-2">
        <Button variant="outline" @click="router.push('/schedules')">Back</Button>
        <Button :disabled="conflictCount > 0 || generating" @click="generate">
          {{ generating ? 'Generating…' : 'Generate' }}
        </Button>
      </div>
    </div>

    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-else-if="conflictCount > 0" class="text-sm text-destructive">
      {{ conflictCount }} unfillable day(s) — resolve before generating.
    </p>
    <p v-else-if="result" class="text-sm text-muted-foreground">
      {{ result.assignments.length }} day(s) ready. No conflicts.
    </p>

    <DutyCalendar
      v-if="valid"
      :year="year"
      :month="month"
      :days="days"
      :assignment-by-date="assignmentByDate"
      :conflicts-by-date="conflictsByDate"
      :doctors="doctors"
      mode="readonly"
    />
  </div>
</template>
