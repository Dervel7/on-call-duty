<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ScrollText } from 'lucide-vue-next'
import type { ClinicDutySlots, OpenDutySettings } from '@oncall/shared'
import { updateDutySlotsSchema, updateOpenDutySchema } from '@oncall/shared'
import * as settingsService from '@/services/settings'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'

const auth = useAuthStore()
const clinicId = () => auth.user?.clinicId ?? undefined

const openDuty = ref<OpenDutySettings | null>(null)
const intervalInput = ref('')
const intervalError = ref('')
const intervalSuccess = ref(false)
const intervalSubmitting = ref(false)

const dutySlots = ref<ClinicDutySlots | null>(null)
/** Ceiling for both slot counts: the clinic's active doctors. */
const maxSlots = computed(() => dutySlots.value?.activeDoctors)
const openSlotsInput = ref('')
const closedSlotsInput = ref('')
const slotsError = ref('')
const slotsSuccess = ref(false)
const slotsSubmitting = ref(false)
const loading = ref(true)

function errorText(r: PromiseSettledResult<unknown>): string {
  return r.status === 'rejected' && r.reason instanceof Error ? r.reason.message : 'Could not load rules'
}

async function loadSettings() {
  intervalError.value = ''
  slotsError.value = ''
  loading.value = true
  const [cycle, slots] = await Promise.allSettled([
    settingsService.getOpenDuty(),
    settingsService.getDutySlots(clinicId()),
  ])
  if (cycle.status === 'fulfilled') {
    openDuty.value = cycle.value
    intervalInput.value = String(cycle.value.intervalDays)
  } else {
    intervalError.value = errorText(cycle)
  }
  if (slots.status === 'fulfilled') {
    dutySlots.value = slots.value
    openSlotsInput.value = String(slots.value.openDutySlots)
    closedSlotsInput.value = String(slots.value.closedDutySlots)
  } else {
    slotsError.value = errorText(slots)
  }
  loading.value = false
}

async function onSubmitInterval() {
  intervalError.value = ''
  intervalSuccess.value = false
  const parsed = updateOpenDutySchema.safeParse({ intervalDays: intervalInput.value })
  if (!parsed.success) {
    intervalError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  intervalSubmitting.value = true
  try {
    openDuty.value = await settingsService.updateOpenDutyInterval(parsed.data.intervalDays)
    intervalInput.value = String(openDuty.value.intervalDays)
    intervalSuccess.value = true
  } catch (e) {
    intervalError.value = e instanceof Error ? e.message : 'Could not save interval'
  } finally {
    intervalSubmitting.value = false
  }
}

async function onSubmitSlots() {
  slotsError.value = ''
  slotsSuccess.value = false
  const parsed = updateDutySlotsSchema.safeParse({
    openDutySlots: openSlotsInput.value,
    closedDutySlots: closedSlotsInput.value,
  })
  if (!parsed.success) {
    slotsError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  const max = maxSlots.value ?? 0
  if (parsed.data.openDutySlots > max || parsed.data.closedDutySlots > max) {
    slotsError.value = `On-call slots cannot exceed the clinic's ${max} active doctor${max === 1 ? '' : 's'}`
    return
  }
  slotsSubmitting.value = true
  try {
    dutySlots.value = await settingsService.updateDutySlots(
      parsed.data.openDutySlots,
      parsed.data.closedDutySlots,
      clinicId(),
    )
    openSlotsInput.value = String(dutySlots.value.openDutySlots)
    closedSlotsInput.value = String(dutySlots.value.closedDutySlots)
    slotsSuccess.value = true
  } catch (e) {
    slotsError.value = e instanceof Error ? e.message : 'Could not save slots'
  } finally {
    slotsSubmitting.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <div class="flex flex-col gap-4 animate-rise">
    <PageHeader
      :icon="ScrollText"
      title="Rules"
      subtitle="Every dynamic scheduling rule lives here. Changes apply to new previews and generations immediately and are recorded in the activity log."
    />

    <div class="grid items-start gap-4 md:grid-cols-2">
      <Card class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>On-call duty cycle</CardTitle>
          <CardDescription class="text-xs">
            Days between open on-call duties — the red-bordered days in schedules. The first open
            on-call day is {{ openDuty?.anchorDate ?? '—' }}.
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <form class="flex flex-1 flex-col gap-3" novalidate @submit.prevent="onSubmitInterval">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-interval">Interval (days)</Label>
              <Input
                id="open-duty-interval"
                v-model="intervalInput"
                type="number"
                min="1"
                max="365"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <p v-if="intervalError" class="text-xs text-destructive" role="alert">{{ intervalError }}</p>
            <p v-if="intervalSuccess" class="text-xs text-success" role="status">Interval updated.</p>
            <Button class="mt-auto" type="submit" :disabled="loading || intervalSubmitting">Save interval</Button>
          </form>
        </CardContent>
      </Card>

      <Card class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>On-call slots</CardTitle>
          <CardDescription class="text-xs">
            How many on-call doctors a single day holds in this clinic. Open on-call days use their
            own count; all other days (including the day after an open one) use the closed count.
            Each count can go up to the clinic's active doctors.
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <form class="flex flex-1 flex-col gap-3" novalidate @submit.prevent="onSubmitSlots">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-slots">Open on-call days (1–{{ maxSlots ?? '—' }})</Label>
              <Input
                id="open-duty-slots"
                v-model="openSlotsInput"
                type="number"
                min="1"
                :max="maxSlots"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="closed-duty-slots">Closed on-call days (1–{{ maxSlots ?? '—' }})</Label>
              <Input
                id="closed-duty-slots"
                v-model="closedSlotsInput"
                type="number"
                min="1"
                :max="maxSlots"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <p v-if="slotsError" class="text-xs text-destructive" role="alert">{{ slotsError }}</p>
            <p v-if="slotsSuccess" class="text-xs text-success" role="status">Slots updated.</p>
            <Button class="mt-auto" type="submit" :disabled="loading || slotsSubmitting">Save slots</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
