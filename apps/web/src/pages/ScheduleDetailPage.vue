<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CalendarDays } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type {
  CreateDutyRequest,
  DayInfo,
  Doctor,
  ReassignDutyRequest,
  ScheduleDetail,
} from '@oncall/shared'
import { createDutySchema, reassignDutySchema } from '@oncall/shared'
import { monthLabel } from '@oncall/utils'
import { useAuthStore } from '@/stores/auth'
import * as scheduleService from '@/services/schedule'
import * as doctorService from '@/services/doctor'
import Button from '@/components/ui/Button.vue'
import DutyCalendar from '@/components/schedule/DutyCalendar.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import Badge from '@/components/ui/Badge.vue'
import { useConfirm } from '@/composables/useConfirm'
import { useIntlLocale } from '@/composables/useIntlLocale'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { confirm } = useConfirm()
const intlLocale = useIntlLocale()
const { t } = useI18n()
const id = Number(route.params.id)

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

const dutyIdsByDate = computed<Map<string, number[]>>(() => {
  const m = new Map<string, number[]>()
  for (const d of detail.value?.duties ?? []) {
    const arr = m.get(d.dutyDate) ?? []
    arr.push(d.id)
    m.set(d.dutyDate, arr)
  }
  return m
})

const assignmentByDate = computed(() => {
  const m = new Map<
    string,
    { doctorId: number; firstName: string; lastName: string; reason: string }[]
  >()
  for (const d of detail.value?.duties ?? []) {
    const arr = m.get(d.dutyDate) ?? []
    arr.push({
      doctorId: d.doctorId,
      firstName: d.doctorFirstName,
      lastName: d.doctorLastName,
      reason: d.reason,
    })
    m.set(d.dutyDate, arr)
  }
  return m
})
const days = computed<DayInfo[]>(() => detail.value?.days ?? [])

async function load() {
  loading.value = true
  // errorMsg is not cleared here: duty actions reload after a failure and
  // their error must stay visible. Each user action clears it up front.
  try {
    detail.value = await scheduleService.get(id)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.loadFailed')
  } finally {
    loading.value = false
  }
}

async function publish() {
  if (
    !(await confirm({
      title: t('scheduleDetail.publishTitle'),
      message: t('scheduleDetail.publishMessage'),
      confirmText: t('scheduleDetail.publish'),
      variant: 'primary',
    }))
  )
    return
  errorMsg.value = ''
  try {
    const updated = await scheduleService.publish(id)
    if (detail.value) detail.value.schedule = { ...detail.value.schedule, status: updated.status }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.publishFailed')
  }
}

async function unpublish() {
  if (
    !(await confirm({
      title: t('scheduleDetail.revertToDraft'),
      message: t('scheduleDetail.revertMessage'),
      confirmText: t('scheduleDetail.revert'),
      variant: 'primary',
    }))
  )
    return
  errorMsg.value = ''
  try {
    const updated = await scheduleService.unpublish(id)
    if (detail.value) detail.value.schedule = { ...detail.value.schedule, status: updated.status }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.revertFailed')
  }
}

async function deleteSchedule() {
  if (
    !(await confirm({
      title: t('scheduleDetail.deleteSchedule'),
      message: t('scheduleDetail.deleteMessage'),
      confirmText: t('common.delete'),
    }))
  )
    return
  errorMsg.value = ''
  try {
    await scheduleService.remove(id)
    router.push('/schedules')
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.deleteFailed')
  }
}

async function onSelect(date: string, slotIndex: number, doctorId: number | null) {
  const dutyIds = dutyIdsByDate.value.get(date) ?? []
  const dutyId = dutyIds[slotIndex] ?? null
  const slots = assignmentByDate.value.get(date) ?? []
  const existing = slots[slotIndex]
  errorMsg.value = ''
  if (doctorId === null) {
    if (dutyId === null) return
    if (
      !(await confirm({
        title: t('scheduleDetail.removeDutyTitle'),
        message: t('scheduleDetail.removeDutyMessage', {
          name: `${existing?.firstName ?? ''} ${existing?.lastName ?? ''}`,
          date,
        }),
        confirmText: t('common.remove'),
      }))
    )
      return
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.removeDuty(dutyId)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.removeFailed')
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
      errorMsg.value = r.error.issues[0]?.message ?? t('common.invalidInput')
      return
    }
    savingDates.value = new Set(savingDates.value).add(date)
    try {
      await scheduleService.reassignDuty(dutyId, r.data)
    } catch (e) {
      errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.reassignFailed')
    } finally {
      savingDates.value.delete(date)
      await load()
    }
    return
  }
  const r = createDutySchema.safeParse({ date, doctorId } satisfies CreateDutyRequest)
  if (!r.success) {
    errorMsg.value = r.error.issues[0]?.message ?? t('common.invalidInput')
    return
  }
  savingDates.value = new Set(savingDates.value).add(date)
  try {
    await scheduleService.addDuty(id, r.data)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('scheduleDetail.addFailed')
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
  <div class="flex flex-col gap-4 animate-rise">
    <p v-if="loading && !detail" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <p v-if="errorMsg" class="text-sm text-destructive" role="alert">{{ errorMsg }}</p>

    <template v-if="schedule">
      <PageHeader :icon="CalendarDays" :title="monthLabel(schedule.year, schedule.month, intlLocale)">
        <template #actions>
          <Badge :variant="isPublished ? 'success' : 'neutral'" dot>{{ isPublished ? t('scheduleStatus.published') : t('scheduleStatus.draft') }}</Badge>
          <template v-if="auth.isAdmin">
            <Button v-if="!isPublished" @click="publish">{{ t('scheduleDetail.publish') }}</Button>
            <Button v-else variant="outline" @click="unpublish">{{ t('scheduleDetail.revertToDraft') }}</Button>
            <Button variant="destructive" :disabled="isPublished" @click="deleteSchedule">
              {{ t('scheduleDetail.deleteSchedule') }}
            </Button>
          </template>
        </template>
      </PageHeader>

      <p v-if="isPublished && auth.isAdmin" class="text-sm text-muted-foreground">
        {{ t('scheduleDetail.lockedNotice') }}
      </p>

      <DutyCalendar :year="schedule.year" :month="schedule.month" :days="days" :assignment-by-date="assignmentByDate"
        :doctors="doctors" :mode="mode" :saving-dates="savingDates" allow-clear
        show-fill-hints @select="onSelect" />
    </template>
  </div>
</template>
