<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ChevronDown, ScrollText } from 'lucide-vue-next'
import type { DutyMinimumSettings, DutySlotsSettings, OpenDutySettings } from '@oncall/shared'
import { updateDutyMinimumsSchema, updateDutySlotsSchema, updateOpenDutySchema } from '@oncall/shared'
import * as settingsService from '@/services/settings'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import PageHeader from '@/components/ui/PageHeader.vue'

type RuleKey = 'cycle' | 'slots' | 'minimums'

/** The rule whose form is open; only one rule is expanded at a time. */
const expandedRule = ref<RuleKey | null>(null)

function toggleRule(key: RuleKey): void {
  expandedRule.value = expandedRule.value === key ? null : key
}

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

const dutyMinimums = ref<DutyMinimumSettings | null>(null)
const openMinimumInput = ref('')
const closedMinimumInput = ref('')
const minimumsError = ref('')
const minimumsSuccess = ref(false)
const minimumsSubmitting = ref(false)
const loading = ref(true)

function errorText(r: PromiseSettledResult<unknown>): string {
  return r.status === 'rejected' && r.reason instanceof Error ? r.reason.message : 'Could not load rules'
}

async function loadSettings() {
  intervalError.value = ''
  slotsError.value = ''
  minimumsError.value = ''
  loading.value = true
  const [cycle, slots, minimums] = await Promise.allSettled([
    settingsService.getOpenDuty(),
    settingsService.getDutySlots(),
    settingsService.getDutyMinimums(),
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
  if (minimums.status === 'fulfilled') {
    dutyMinimums.value = minimums.value
    openMinimumInput.value = String(minimums.value.openDutyMinimum)
    closedMinimumInput.value = String(minimums.value.closedDutyMinimum)
  } else {
    minimumsError.value = errorText(minimums)
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

async function onSubmitMinimums() {
  minimumsError.value = ''
  minimumsSuccess.value = false
  const parsed = updateDutyMinimumsSchema.safeParse({
    openDutyMinimum: openMinimumInput.value,
    closedDutyMinimum: closedMinimumInput.value,
  })
  if (!parsed.success) {
    minimumsError.value = parsed.error.issues[0]?.message ?? 'Invalid input'
    return
  }
  minimumsSubmitting.value = true
  try {
    dutyMinimums.value = await settingsService.updateDutyMinimums(
      parsed.data.openDutyMinimum,
      parsed.data.closedDutyMinimum,
    )
    openMinimumInput.value = String(dutyMinimums.value.openDutyMinimum)
    closedMinimumInput.value = String(dutyMinimums.value.closedDutyMinimum)
    minimumsSuccess.value = true
  } catch (e) {
    minimumsError.value = e instanceof Error ? e.message : 'Could not save minimums'
  } finally {
    minimumsSubmitting.value = false
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

    <ul class="overflow-hidden rounded-lg border border-border/70">
      <li class="border-b border-border/70 last:border-b-0">
        <button
          id="rule-cycle-toggle"
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          aria-controls="rule-cycle-panel"
          :aria-expanded="expandedRule === 'cycle'"
          @click="toggleRule('cycle')"
        >
          <span class="font-display font-semibold text-foreground">On-call duty cycle</span>
          <span class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <span v-if="intervalError" class="text-destructive">Error</span>
            <template v-else-if="openDuty">Every {{ openDuty.intervalDays }} days</template>
            <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expandedRule === 'cycle' }" />
          </span>
        </button>
        <div v-if="expandedRule === 'cycle'" id="rule-cycle-panel" class="flex flex-col gap-3 px-4 pb-4">
          <p class="text-xs text-muted-foreground">
            Days between open on-call duties — the red-bordered days in schedules. The first open
            on-call day is {{ openDuty?.anchorDate ?? '—' }}.
          </p>
          <form class="flex max-w-sm flex-col gap-3" novalidate @submit.prevent="onSubmitInterval">
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
            <Button class="self-start" type="submit" :disabled="loading || intervalSubmitting">Save interval</Button>
          </form>
        </div>
      </li>

      <li class="border-b border-border/70 last:border-b-0">
        <button
          id="rule-slots-toggle"
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          aria-controls="rule-slots-panel"
          :aria-expanded="expandedRule === 'slots'"
          @click="toggleRule('slots')"
        >
          <span class="font-display font-semibold text-foreground">On-call slots</span>
          <span class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <span v-if="slotsError" class="text-destructive">Error</span>
            <template v-else-if="dutySlots"
              >Open {{ dutySlots.openDutySlots }} · Closed {{ dutySlots.closedDutySlots }}</template
            >
            <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expandedRule === 'slots' }" />
          </span>
        </button>
        <div v-if="expandedRule === 'slots'" id="rule-slots-panel" class="flex flex-col gap-3 px-4 pb-4">
          <p class="text-xs text-muted-foreground">
            How many on-call doctors a single day holds. Open on-call days use their own count; all
            other days (including the day after an open one) use the closed count.
          </p>
          <form class="flex max-w-sm flex-col gap-3" novalidate @submit.prevent="onSubmitSlots">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-slots">Open on-call days (1–7)</Label>
              <Input
                id="open-duty-slots"
                v-model="openSlotsInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
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
                :disabled="loading"
              />
            </div>
            <p v-if="slotsError" class="text-xs text-destructive" role="alert">{{ slotsError }}</p>
            <p v-if="slotsSuccess" class="text-xs text-success" role="status">Slots updated.</p>
            <Button class="self-start" type="submit" :disabled="loading || slotsSubmitting">Save slots</Button>
          </form>
        </div>
      </li>

      <li class="border-b border-border/70 last:border-b-0">
        <button
          id="rule-minimums-toggle"
          type="button"
          class="flex w-full items-center justify-between gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-primary/[0.035]"
          aria-controls="rule-minimums-panel"
          :aria-expanded="expandedRule === 'minimums'"
          @click="toggleRule('minimums')"
        >
          <span class="font-display font-semibold text-foreground">Minimum on-call doctors</span>
          <span class="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <span v-if="minimumsError" class="text-destructive">Error</span>
            <template v-else-if="dutyMinimums"
              >Open {{ dutyMinimums.openDutyMinimum }} · Closed {{ dutyMinimums.closedDutyMinimum }}</template
            >
            <ChevronDown
              class="size-4 transition-transform"
              :class="{ 'rotate-180': expandedRule === 'minimums' }"
            />
          </span>
        </button>
        <div v-if="expandedRule === 'minimums'" id="rule-minimums-panel" class="flex flex-col gap-3 px-4 pb-4">
          <p class="text-xs text-muted-foreground">
            The fewest on-call doctors a day may hold. Open on-call days use their own minimum; all
            other days (including the day after an open one) use the closed minimum. Each minimum
            must not exceed its slot count. Any count from the minimum up to the slot count is
            accepted; filling every slot is preferred.
          </p>
          <form class="flex max-w-sm flex-col gap-3" novalidate @submit.prevent="onSubmitMinimums">
            <div class="flex flex-col gap-1.5">
              <Label for="open-duty-minimum">Open on-call days (1–7)</Label>
              <Input
                id="open-duty-minimum"
                v-model="openMinimumInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <Label for="closed-duty-minimum">Closed on-call days (1–7)</Label>
              <Input
                id="closed-duty-minimum"
                v-model="closedMinimumInput"
                type="number"
                min="1"
                max="7"
                inputmode="numeric"
                :disabled="loading"
              />
            </div>
            <p v-if="minimumsError" class="text-xs text-destructive" role="alert">{{ minimumsError }}</p>
            <p v-if="minimumsSuccess" class="text-xs text-success" role="status">Minimums updated.</p>
            <Button class="self-start" type="submit" :disabled="loading || minimumsSubmitting">Save minimums</Button>
          </form>
        </div>
      </li>
    </ul>
  </div>
</template>
