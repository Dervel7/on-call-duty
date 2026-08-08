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
const fullCount = computed(
  () => days.value.filter((d) => (countByDate.value.get(d.date) ?? 0) >= 2).length,
)

type StatusTone = 'destructive' | 'warning' | 'success'
const STATUS_TONE: Record<StatusTone, string> = {
  destructive: 'border-destructive/30 bg-destructive/5 text-red-700',
  warning: 'border-amber-500/40 bg-amber-50 text-amber-800',
  success: 'border-success/30 bg-success/5 text-green-700',
}
const status = computed<{ tone: StatusTone; title: string; detail: string } | null>(() => {
  if (!result.value) return null
  if (errorCount.value > 0) {
    return {
      tone: 'destructive',
      title: `${errorCount.value} day(s) with no doctor`,
      detail: 'Assign at least one doctor to every day before generating.',
    }
  }
  if (warningCount.value > 0) {
    return {
      tone: 'warning',
      title: `${warningCount.value} day(s) with only 1 doctor`,
      detail: 'Ready to generate — consider adding a second doctor where you can.',
    }
  }
  return {
    tone: 'success',
    title: 'All days covered',
    detail: `${assignments.value.length} assignment(s) ready. No conflicts.`,
  }
})

async function load() {
  if (!valid.value) {
    errorMsg.value = ''
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
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-foreground">{{ monthLabel }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Review the proposed roster, adjust any day, then generate the schedule.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" @click="router.push('/schedules')">Back</Button>
        <Button :disabled="!result || errorCount > 0 || generating" @click="generate">
          {{ generating ? 'Generating…' : 'Generate schedule' }}
        </Button>
      </div>
    </div>

    <div
      v-if="errorMsg"
      role="alert"
      class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-red-700"
    >
      {{ errorMsg }}
    </div>

    <div
      v-if="!valid"
      class="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6"
    >
      <p class="text-sm font-medium text-foreground">Invalid or missing month.</p>
      <p class="text-sm text-muted-foreground">
        Open this preview from the schedules list to choose a valid month.
      </p>
      <Button variant="outline" size="sm" @click="router.push('/schedules')">
        Back to schedules
      </Button>
    </div>

    <div v-else-if="loading && !result" class="overflow-hidden rounded-lg border border-border bg-card">
      <div class="border-b border-border px-4 py-3">
        <div class="h-4 w-40 animate-pulse rounded bg-muted" />
      </div>
      <div class="grid grid-cols-7 gap-px bg-border p-px">
        <div v-for="n in 28" :key="n" class="min-h-[112px] bg-card p-2">
          <div class="h-3 w-5 animate-pulse rounded bg-muted" />
          <div class="mt-2 h-8 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>

    <template v-else-if="result">
      <div
        v-if="status"
        :class="['rounded-lg border px-4 py-3', STATUS_TONE[status.tone]]"
        :role="status.tone === 'destructive' ? 'alert' : 'status'"
      >
        <p class="text-sm font-semibold text-foreground">{{ status.title }}</p>
        <p class="mt-0.5 text-sm">{{ status.detail }}</p>
      </div>

      <section class="overflow-hidden rounded-lg border border-border bg-card">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"
        >
          <div
            class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground"
          >
            <span><span class="font-semibold text-foreground">{{ days.length }}</span> days</span>
            <span><span class="font-semibold text-green-700">{{ fullCount }}</span> full</span>
            <span><span class="font-semibold text-amber-700">{{ warningCount }}</span> partial</span>
            <span><span class="font-semibold text-red-700">{{ errorCount }}</span> empty</span>
          </div>
          <div class="flex items-center gap-3 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1.5">
              <span
                class="inline-flex rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >WE</span
              >
              Weekend
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span
                class="inline-flex rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                >HOL</span
              >
              Holiday
            </span>
          </div>
        </div>

        <DutyCalendar
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
      </section>
    </template>
  </div>
</template>
