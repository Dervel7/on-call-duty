<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  CreateDutyRequest,
  DayInfo,
  Doctor,
  ReassignDutyRequest,
  ScheduleDetail,
} from '@oncall/shared'
import { createDutySchema, reassignDutySchema } from '@oncall/shared'
import { useAuthStore } from '@/stores/auth'
import * as scheduleService from '@/services/schedule'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const id = Number(route.params.id)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const detail = ref<ScheduleDetail | null>(null)
const doctors = ref<Doctor[]>([])
const loading = ref(false)
const errorMsg = ref('')
const savingDates = ref(new Set<string>())

const schedule = computed(() => detail.value?.schedule ?? null)
const isPublished = computed(() => schedule.value?.status === 'published')
const mode = computed<'editable' | 'readonly'>(() =>
  auth.isAdmin && !isPublished.value ? 'editable' : 'readonly',
)

const dutyIdByDate = computed<Map<string, number>>(() => {
  const m = new Map<string, number>()
  for (const d of detail.value?.duties ?? []) m.set(d.dutyDate, d.id)
  return m
})

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }
  >()
  for (const d of detail.value?.duties ?? []) {
    m.set(d.dutyDate, {
      doctorId: d.doctorId,
      firstName: d.doctorFirstName,
      lastName: d.doctorLastName,
      reason: d.reason,
    })
  }
  return m
})
const conflictsByDate = computed(() => new Map<string, string>())
const days = computed<DayInfo[]>(() => detail.value?.days ?? [])

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    detail.value = await scheduleService.get(id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load schedule'
  } finally {
    loading.value = false
  }
}

async function publish() {
  if (!confirm('Publish this schedule? Editing will be locked.')) return
  errorMsg.value = ''
  try {
    const updated = await scheduleService.publish(id)
    if (detail.value) detail.value.schedule = { ...detail.value.schedule, status: updated.status }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to publish'
  }
}

async function unpublish() {
  if (!confirm('Revert this schedule to draft? Editing will be re-enabled.')) return
  errorMsg.value = ''
  try {
    const updated = await scheduleService.unpublish(id)
    if (detail.value) detail.value.schedule = { ...detail.value.schedule, status: updated.status }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to revert'
  }
}

async function deleteSchedule() {
  if (!confirm('Delete this schedule and all its duties?')) return
  errorMsg.value = ''
  try {
    await scheduleService.remove(id)
    router.push('/schedules')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to delete'
  }
}

async function onSelect(date: string, doctorId: number | null) {
  const dutyId = dutyIdByDate.value.get(date) ?? null
  const existing = assignmentByDate.value.get(date)
  errorMsg.value = ''
  if (doctorId === null) {
    if (dutyId === null) return
    if (!confirm(`Remove ${existing?.firstName ?? ''} ${existing?.lastName ?? ''} from ${date}?`)) return
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.removeDuty(dutyId)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to remove'
    } finally {
      savingDates.value.delete(date)
      await load()
    }
    return
  }
  if (dutyId !== null) {
    if (existing && doctorId === existing.doctorId) return
    const r = reassignDutySchema.safeParse({ doctorId } satisfies ReassignDutyRequest)
    if (!r.success) {
      errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
      return
    }
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.reassignDuty(dutyId, r.data)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : 'Failed to reassign'
    } finally {
      savingDates.value.delete(date)
      await load()
    }
    return
  }
  const r = createDutySchema.safeParse({ date, doctorId } satisfies CreateDutyRequest)
  if (!r.success) {
    errorMsg.value = r.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  savingDates.value = new Set(savingDates.value).add(date)
  try {
    await scheduleService.addDuty(id, r.data)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to add'
  } finally {
    savingDates.value.delete(date)
    await load()
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
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="loading && !detail" class="text-sm text-muted-foreground">Loading…</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <template v-if="schedule">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-semibold text-foreground">
            {{ MONTHS[schedule.month - 1] }} {{ schedule.year }}
          </h1>
          <span
            :class="isPublished
              ? 'inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'"
          >
            {{ isPublished ? 'Published' : 'Draft' }}
          </span>
        </div>
        <div v-if="auth.isAdmin" class="flex items-center gap-2">
          <Button v-if="!isPublished" @click="publish">Publish</Button>
          <Button v-else variant="outline" @click="unpublish">Revert to draft</Button>
          <Button variant="destructive" :disabled="isPublished" @click="deleteSchedule">
            Delete schedule
          </Button>
        </div>
      </div>

      <p v-if="isPublished && auth.isAdmin" class="text-sm text-muted-foreground">
        Schedule is published and locked. Revert to draft to edit duties.
      </p>

      <DutyCalendar
        :year="schedule.year"
        :month="schedule.month"
        :days="days"
        :assignment-by-date="assignmentByDate"
        :conflicts-by-date="conflictsByDate"
        :doctors="doctors"
        :mode="mode"
        :saving-dates="savingDates"
        @select="onSelect"
      />
    </template>
  </div>
</template>
