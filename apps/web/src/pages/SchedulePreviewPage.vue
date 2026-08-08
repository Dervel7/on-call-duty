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

interface PreviewAssignment {
  date: string
  doctorId: number
  firstName: string
  lastName: string
  reason: string
}
const assignments = ref<PreviewAssignment[]>([])

const year = computed(() => Number(route.query.year))
const month = computed(() => Number(route.query.month))
const parsed = computed(() => createScheduleSchema.safeParse({ year: year.value, month: month.value }))
const valid = computed(() => parsed.value.success)
const monthLabel = computed(() =>
  valid.value ? `${MONTHS[month.value - 1]} ${year.value}` : 'Preview',
)

const doctorsById = computed(() => {
  const m = new Map<number, Doctor>()
  for (const d of doctors.value) m.set(d.id, d)
  return m
})

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }[]
  >()
  for (const a of assignments.value) {
    const arr = m.get(a.date) ?? []
    arr.push({ doctorId: a.doctorId, firstName: a.firstName, lastName: a.lastName, reason: a.reason })
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

const countByDate = computed(() => {
  const m = new Map<string, number>()
  for (const a of assignments.value) m.set(a.date, (m.get(a.date) ?? 0) + 1)
  return m
})
const errorCount = computed(
  () => days.value.filter((d) => (countByDate.value.get(d.date) ?? 0) === 0).length,
)
const warningCount = computed(
  () => days.value.filter((d) => (countByDate.value.get(d.date) ?? 0) === 1).length,
)

async function load() {
  if (!valid.value) {
    errorMsg.value = 'Invalid or missing year/month.'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    result.value = await scheduleService.preview(year.value, month.value)
    assignments.value = (result.value?.assignments ?? []).map((a) => ({
      date: a.date,
      doctorId: a.doctorId,
      firstName: a.doctorFirstName,
      lastName: a.doctorLastName,
      reason: a.reason,
    }))
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to preview'
  } finally {
    loading.value = false
  }
}

function onSelect(date: string, slotIndex: number, doctorId: number | null) {
  const current = assignments.value.filter((a) => a.date === date)
  if (doctorId === null) {
    if (slotIndex >= current.length) return
    const target = current[slotIndex]
    if (!target) return
    assignments.value = assignments.value.filter((a) => a !== target)
    return
  }
  if (slotIndex < current.length) {
    const target = current[slotIndex]
    if (!target || target.doctorId === doctorId) return
    const doc = doctorsById.value.get(doctorId)
    if (!doc) return
    const idx = assignments.value.indexOf(target)
    const next = [...assignments.value]
    next[idx] = {
      date,
      doctorId,
      firstName: doc.firstName,
      lastName: doc.lastName,
      reason: 'manual override',
    }
    assignments.value = next
    return
  }
  if (current.length >= 2) return
  if (current.some((a) => a.doctorId === doctorId)) return
  const doc = doctorsById.value.get(doctorId)
  if (!doc) return
  assignments.value = [
    ...assignments.value,
    { date, doctorId, firstName: doc.firstName, lastName: doc.lastName, reason: 'manual override' },
  ]
}

async function generate() {
  generating.value = true
  errorMsg.value = ''
  try {
    const detail = await scheduleService.generate(
      year.value,
      month.value,
      assignments.value.map((a) => ({ date: a.date, doctorId: a.doctorId, reason: a.reason })),
    )
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
        <Button :disabled="!result || errorCount > 0 || generating" @click="generate">
          {{ generating ? 'Generating…' : 'Generate' }}
        </Button>
      </div>
    </div>

    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">Loading…</p>
    <p v-else-if="errorCount > 0" class="text-sm text-destructive">
      {{ errorCount }} day(s) with no doctor — assign at least one before generating.
    </p>
    <p v-else-if="warningCount > 0" class="text-sm text-amber-600">
      {{ warningCount }} day(s) with only 1 doctor. Ready to generate.
    </p>
    <p v-else-if="result" class="text-sm text-muted-foreground">
      {{ assignments.length }} assignment(s) ready. No conflicts.
    </p>

    <DutyCalendar
      v-if="valid"
      :year="year"
      :month="month"
      :days="days"
      :assignment-by-date="assignmentByDate"
      :conflicts-by-date="conflictsByDate"
      :doctors="doctors"
      mode="editable"
      pool="available"
      allow-clear
      show-fill-hints
      @select="onSelect"
    />
  </div>
</template>
