<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ScrollText } from 'lucide-vue-next'
import type { DutySlotsSettings, OpenDutySettings } from '@oncall/shared'
import { updateDutySlotsSchema, updateOpenDutySchema } from '@oncall/shared'
import * as settingsService from '@/services/settings'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'

const openDuty = ref<OpenDutySettings | null>(null)
const intervalInput = ref('')
const intervalError = ref('')
const intervalSuccess = ref(false)
const intervalSubmitting = ref(false)

const dutySlots = ref<DutySlotsSettings | null>(null)
const openSlotsInput = ref('')
const closedSlotsInput = ref('')
const slotsError = ref('')
const slotsSuccess = ref(false)
const slotsSubmitting = ref(false)

async function loadSettings() {
  intervalError.value = ''
  slotsError.value = ''
  try {
    const [cycle, slots] = await Promise.all([
      settingsService.getOpenDuty(),
      settingsService.getDutySlots(),
    ])
    openDuty.value = cycle
    intervalInput.value = String(cycle.intervalDays)
    dutySlots.value = slots
    openSlotsInput.value = String(slots.openDutySlots)
    closedSlotsInput.value = String(slots.closedDutySlots)
  } catch (e) {
    intervalError.value = e instanceof Error ? e.message : 'Could not load rules'
    slotsError.value = intervalError.value
  }
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
  slotsSubmitting.value = true
  try {
    dutySlots.value = await settingsService.updateDutySlots(
      parsed.data.openDutySlots,
      parsed.data.closedDutySlots,
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
              />
            </div>
            <p v-if="intervalError" class="text-xs text-destructive" role="alert">{{ intervalError }}</p>
            <p v-if="intervalSuccess" class="text-xs text-success" role="status">Interval updated.</p>
            <Button class="mt-auto" type="submit" :disabled="intervalSubmitting">Save interval</Button>
          </form>
        </CardContent>
      </Card>

      <Card class="flex flex-col">
        <CardHeader class="p-5 pb-2">
          <CardTitle>On-call slots</CardTitle>
          <CardDescription class="text-xs">
            How many on-call doctors a single day holds. Open on-call days use their own count; all
            other days (including the day after an open one) use the closed count.
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col p-5 pt-0">
          <form class="flex flex-1 flex-col gap-3" novalidate @submit.prevent="onSubmitSlots">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-slots">Open on-call days (1–7)</Label>
              <Input
                id="open-duty-slots"
                v-model="openSlotsInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="closed-duty-slots">Closed on-call days (1–7)</Label>
              <Input
                id="closed-duty-slots"
                v-model="closedSlotsInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
              />
            </div>
            <p v-if="slotsError" class="text-xs text-destructive" role="alert">{{ slotsError }}</p>
            <p v-if="slotsSuccess" class="text-xs text-success" role="status">Slots updated.</p>
            <Button class="mt-auto" type="submit" :disabled="slotsSubmitting">Save slots</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
